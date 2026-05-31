# Workload Identity & IRSA on EKS

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [The Problem: Static Credentials in Pods](#1-the-problem-static-credentials-in-pods) | Why long-lived IAM credentials in pods are an unacceptable risk at scale. |
| **02** | [The Foundation: OIDC & STS Token Exchange](#2-the-foundation-oidc-sts-token-exchange) | How OIDC federation works, what a web identity token contains, and how STS validates it. |
| **03** | [The EKS OIDC Provider](#3-the-eks-oidc-provider) | How EKS acts as an OIDC issuer and what registering it in IAM establishes. |
| **04** | [Service Account as Identity](#4-service-account-as-identity) | Kubernetes service accounts as the unit of workload identity, and the role annotation pattern. |
| **05** | [Token Projection & Credential Injection](#5-token-projection-credential-injection) | How the mutating webhook, projected tokens, and the AWS SDK wire together transparently. |
| **06** | [Trust Policy Design & Hardening](#6-trust-policy-design-hardening) | Anatomy of a federation trust policy, condition key precision, and privilege escalation misconfigurations. |
| **07** | [Cross-Account Role Assumption](#7-cross-account-role-assumption) | Extending IRSA-federated identities across AWS account boundaries in a Landing Zone. |
| **08** | [IRSA vs EKS Pod Identity](#8-irsa-vs-eks-pod-identity) | When to prefer the newer Pod Identity agent over IRSA, and what changes operationally. |
| **09** | [Operational Considerations](#9-operational-considerations) | Token TTLs, credential rotation, CloudTrail observability, and when the model breaks down. |

---

## 1. The Problem: Static Credentials in Pods

The traditional approach to giving a pod access to AWS resources is to create an IAM user, generate an access key pair, and inject `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as environment variables or Kubernetes secrets. This pattern is pervasive, well-understood, and deeply problematic.

Static IAM credentials do not expire. A key that escapes into a container image layer, a Kubernetes secret synced to the wrong namespace, or a misconfigured logging pipeline will grant AWS access indefinitely until it is manually rotated or deactivated. The operational discipline required to rotate credentials across dozens of workloads and clusters reliably does not scale — and the blast radius of a leaked static credential is bounded only by whatever IAM policies are attached to the user.

More fundamentally, a static credential has no binding to the workload that is supposed to use it. Once the bytes are known, any principal anywhere can use them. There is no mechanism for STS or IAM to verify: *is this request actually coming from the pod I intended to have this credential?*

IRSA solves both problems. Credentials are short-lived tokens — typically valid for one hour — issued fresh for each workload session. And crucially, the token contains cryptographically verifiable claims about *who is asking*: which cluster, which namespace, which service account. IAM makes authorization decisions based on those claims, binding access tightly to the specific pod identity.

---

## 2. The Foundation: OIDC & STS Token Exchange

IRSA is built on a three-party trust model: an **identity provider** that issues tokens, **AWS STS** that validates and exchanges them, and an **IAM role** that defines what the resulting session can do. Understanding this model is the prerequisite for understanding every other part of IRSA.

### OpenID Connect Tokens

An OIDC token — specifically a JWT (JSON Web Token) — is a base64-encoded, cryptographically signed document that makes claims about an identity. For IRSA, the relevant claims are:

| Claim | Description | IRSA Example |
| :--- | :--- | :--- |
| `iss` (issuer) | URL of the OIDC provider that signed the token | EKS cluster OIDC URL |
| `sub` (subject) | The specific identity within the provider | `system:serviceaccount:payments:api` |
| `aud` (audience) | The intended recipient of the token | `sts.amazonaws.com` |
| `exp` (expiration) | Unix timestamp after which the token is invalid | Short-lived; rotated by kubelet |

The token is signed using the OIDC provider's private key. AWS STS validates the signature by fetching the provider's public keys from its JWKS endpoint — published at `{issuer}/.well-known/openid-configuration`. This is why registering an OIDC provider in AWS requires the issuer URL and its certificate thumbprint: STS needs to know whose signatures it should accept.

### The Token Exchange: AssumeRoleWithWebIdentity

Credential issuance happens through a single STS API call: `AssumeRoleWithWebIdentity`. The caller presents the ARN of the IAM role it wants to assume and the OIDC JWT it received from the identity provider. STS then performs four checks before issuing credentials:

- **Issuer trust** — is the token's `iss` claim registered as a trusted OIDC provider in this AWS account?
- **Signature validity** — does the JWT's signature verify against the provider's published public keys?
- **Token expiry** — is the `exp` claim in the future?
- **Trust policy conditions** — do the token's claims satisfy the `Condition` block in the IAM role's trust policy?

If all four pass, STS returns a temporary credential set — `AccessKeyId`, `SecretAccessKey`, and `SessionToken` — with a TTL matching the requested duration. These credentials are indistinguishable from any other STS-issued temporary credentials; the AWS SDK uses them transparently.

This exchange is the complete underlying mechanism. Everything that follows — the EKS OIDC provider, the service account annotation, the mutating webhook — is infrastructure that automates this exchange invisibly on behalf of the pod.

---

## 3. The EKS OIDC Provider

Every EKS cluster has a built-in OIDC issuer. When the cluster is created, AWS generates an OIDC provider URL unique to that cluster:

```
https://oidc.eks.ap-southeast-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE
```

This URL is the cluster's identity as an OIDC provider. The random suffix at the end is derived from the cluster's certificate authority and is globally unique — two clusters in the same region with the same name will have different OIDC URLs.

### Registering the Provider in IAM

To use IRSA, a platform administrator registers this URL as an **IAM OIDC Identity Provider** in the AWS account that hosts the cluster. The registration tells IAM and STS: "I trust JWTs signed by this cluster's control plane." EKS manages the signing keys automatically; AWS fetches the public keys from the cluster's JWKS endpoint at validation time.

One OIDC provider registration is required per cluster. In a multi-cluster environment — even within the same AWS account — each cluster has its own provider URL and its own registration. There is no mechanism to share a single OIDC registration across clusters.

The registration is a lightweight, account-level resource. It does not grant any access by itself; access is controlled entirely by the trust policies of IAM roles that reference the provider ARN.

### Why the OIDC URL Is Sensitive

The OIDC URL acts as the root of trust for all IRSA credentials in the cluster. An attacker who can register a rogue OIDC provider in the AWS account — one whose signing keys they control — could forge tokens that pass STS validation. This is why SCPs should restrict `iam:CreateOpenIDConnectProvider` to platform or network accounts, preventing spoke-account teams from registering providers arbitrarily.

---

## 4. Service Account as Identity

In Kubernetes, a **service account** is a namespaced object that represents an application identity within the cluster. Every pod runs under a service account — by default, the `default` service account in its namespace, which is a shared, undifferentiated identity unsuitable for fine-grained IAM access.

IRSA elevates the service account into a real IAM identity by introducing a one-to-one mapping between a Kubernetes service account and an IAM role. This mapping is declared via a single annotation on the service account:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payments-api
  namespace: payments
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/payments-api-role
```

This annotation is the declaration of intent: pods running under this service account should receive temporary credentials for the annotated IAM role. The annotation itself does not grant access — the IAM role's trust policy must also permit assumption from this specific service account, as covered in Section 6.

### Identity Granularity

The service account is the atomic unit of identity in IRSA. One service account maps to one IAM role. If a namespace hosts three different microservices that need different AWS permissions, they should each have their own service account and their own IAM role — not a shared service account with a union of all permissions.

This granularity is what makes IRSA meaningfully more secure than node-level identity. In the older approach, pods inherited the IAM instance profile attached to the EC2 worker node, meaning every pod on a node had identical AWS permissions. IRSA allows a cluster running hundreds of pods across a handful of nodes to have hundreds of distinct, least-privilege IAM identities.

---

## 5. Token Projection & Credential Injection

The credential machinery that makes IRSA work involves two Kubernetes components and the AWS SDK, all operating transparently below the application layer.

### The Mutating Admission Webhook

When a pod is scheduled, the **EKS Pod Identity Webhook** — a mutating admission webhook running on the EKS control plane — intercepts the pod spec before the pod starts. If the pod's service account carries the IRSA annotation, the webhook mutates the pod spec to inject two things:

- A **projected service account token** mounted at `/var/run/secrets/eks.amazonaws.com/serviceaccount/token`. This is a short-lived, audience-scoped JWT signed by the cluster's OIDC issuer, with the pod's service account encoded in the `sub` claim.
- Two environment variables — `AWS_ROLE_ARN` pointing to the annotated IAM role ARN, and `AWS_WEB_IDENTITY_TOKEN_FILE` pointing to the token file path.

The application container itself is never aware of this mutation. From the pod's perspective, these appear as a standard projected volume and standard environment variables.

### SDK Credential Resolution

The AWS SDK checks a fixed credential provider chain on startup. One entry in that chain is the **web identity token file provider** — it looks for the `AWS_WEB_IDENTITY_TOKEN_FILE` and `AWS_ROLE_ARN` environment variables. When both are present, the SDK reads the JWT from the token file, calls `AssumeRoleWithWebIdentity` with the JWT and role ARN, caches the resulting temporary credentials in memory, and automatically refreshes them before they expire.

Application code calls `s3.GetObject()` or `secretsmanager.GetSecretValue()` with no awareness that credentials are being fetched, rotated, and exchanged in the background. The abstraction is complete.

### Token Rotation

The projected service account token is not static. The kubelet refreshes it automatically before it expires — typically with a TTL of one hour and a refresh threshold at 80% of that lifetime. The token file on disk is updated in place; the SDK reads the latest token on each `AssumeRoleWithWebIdentity` call. At no point does the pod hold a credential valid for more than one hour, and rotation requires no restart or manual intervention.

---

## 6. Trust Policy Design & Hardening

The IAM role trust policy is the single access control gate between a Kubernetes service account and AWS credentials. A correctly written trust policy makes IRSA precise and auditable; a poorly written one creates privilege escalation paths that are difficult to detect from CloudTrail alone.

### Anatomy of an IRSA Trust Policy

An IRSA trust policy always follows the same structure. The Federated principal references the OIDC provider ARN registered for the cluster, and the Condition block validates the JWT claims:

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/oidc.eks.ap-southeast-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.ap-southeast-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:aud": "sts.amazonaws.com",
          "oidc.eks.ap-southeast-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:sub": "system:serviceaccount:payments:payments-api"
        }
      }
    }
  ]
}
```

Three components work together:

- **Principal (Federated)** — scopes trust to tokens from this specific cluster's OIDC provider. Tokens from any other cluster or provider are rejected at the issuer check.
- **Action** — always `sts:AssumeRoleWithWebIdentity` for OIDC federation.
- **Condition** — validates the `aud` and `sub` claims from the JWT. This is where workload precision lives.

### The Audience Check Is Non-Negotiable

Every IRSA trust policy must include a `StringEquals` condition on the `aud` claim matching `sts.amazonaws.com`. Without it, a token issued for a different audience could theoretically be replayed against the role. AWS does not enforce the audience check automatically — it is the operator's responsibility to include it.

### Subject Condition Precision

The `sub` condition is the primary binding between the IAM role and the Kubernetes workload. The specificity of this binding determines the blast radius if a service account or cluster is compromised.

| Condition on `sub` | What it permits | Risk |
| :--- | :--- | :--- |
| No condition | Any service account in the cluster | Critical |
| `StringLike` with `system:serviceaccount:payments:*` | Any service account in the `payments` namespace | High — future workloads included automatically |
| `StringEquals` on exact `system:serviceaccount:payments:payments-api` | Only the `payments-api` SA in `payments` | Correct — minimum viable binding |

Always use `StringEquals` on the fully qualified subject. A namespace-level wildcard silently expands the role's trust surface every time a new service account is created in that namespace by any team with namespace access.

### Common Misconfigurations

**Namespace wildcard in `sub`.** Using `system:serviceaccount:payments:*` is a common shortcut when a team owns a namespace. It expands the role's trust surface with every new service account created there, without any IAM change required.

**Missing `aud` condition.** Omitting the audience check is the most common omission in manually crafted trust policies. Always include it explicitly.

**Reusing the same IAM role across clusters.** Because each cluster has a unique OIDC provider ARN, a trust policy can only permit assumption from one specific cluster per statement. Sharing a role across clusters requires multiple `Statement` blocks — one per cluster — which becomes unmanageable and risks cross-cluster impersonation if service account names collide across clusters.

**No SCP on OIDC provider registration.** Without a guardrail, developers in spoke accounts can register arbitrary OIDC providers and create roles that trust them, bypassing the intended identity model entirely. Restrict `iam:CreateOpenIDConnectProvider` to platform accounts.

---

## 7. Cross-Account Role Assumption

A common pattern in multi-account Landing Zones is for pods in one account to assume IAM roles in another — for example, a workload in a shared platform account writing to an S3 bucket owned by an application account. IRSA-federated credentials are fully compatible with cross-account role chaining.

### The Two-Hop Pattern

The pod first exchanges its OIDC JWT for temporary credentials in its home account — the account where the EKS cluster and its OIDC provider registration live. It then uses those credentials to call `sts:AssumeRole` in the target account. The second hop is standard cross-account IAM role assumption; the origin of the credentials is transparent to the target account's STS.

The target account's role trust policy permits assumption from the source account's role ARN:

```json
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::SOURCE_ACCOUNT:role/payments-api-role"
  },
  "Action": "sts:AssumeRole"
}
```

No OIDC provider registration is needed in the target account. OIDC trust terminates at the source account; the cross-account leg uses only conventional IAM.

### Direct Cross-Account OIDC Trust

Alternatively, the EKS OIDC provider can be registered in the target account directly, and the target role's trust policy references the federated principal. This eliminates one credential exchange hop but requires the OIDC provider to be registered in every target account — significant operational overhead in a large Landing Zone.

The two-hop pattern is the standard recommendation: OIDC provider registrations stay centralized in platform accounts, and cross-account access is managed through conventional IAM role trust.

| Approach | Provider registrations | Hops | Preferred for |
| :--- | :--- | :--- | :--- |
| Two-hop (federate → chain) | One per cluster | 2 | Multi-account Landing Zones |
| Direct cross-account OIDC | One per target account | 1 | Simple two-account setups |

---

## 8. IRSA vs EKS Pod Identity

AWS introduced **EKS Pod Identity** in late 2023 as an architectural successor to IRSA. Both solve the same problem — fine-grained, automatically rotated IAM credentials for pods — but they differ meaningfully in where the binding lives and how credentials are delivered.

### How Pod Identity Differs

IRSA routes credentials through the Kubernetes mutating webhook and the OIDC/STS exchange. Pod Identity introduces a different path: an **EKS Pod Identity Agent** DaemonSet runs on every worker node, and pods retrieve credentials by calling a node-local link-local endpoint (`169.254.170.23`) rather than going through STS directly.

The role-to-service-account binding is defined as an **EKS Pod Identity Association** — an EKS API resource managed outside the cluster. This is the most significant operational difference: application teams with `kubectl` access cannot inspect or modify the binding, and it does not live in the cluster's etcd or GitOps manifests.

### Side-by-Side Comparison

| Property | IRSA | EKS Pod Identity |
| :--- | :--- | :--- |
| Credential delivery | Projected token → STS `AssumeRoleWithWebIdentity` | Node agent → EKS Pod Identity endpoint |
| Role binding location | Service account annotation (in-cluster) | EKS Pod Identity Association (EKS API) |
| OIDC provider required | Yes, per cluster | No |
| Cross-account support | Via role chaining | Native in the association definition |
| Multi-cluster role reuse | Separate trust policy per cluster | Same role across clusters without policy changes |
| EKS version requirement | All versions | 1.24+ with agent add-on |
| AWS SDK requirement | Any version with web identity support | Newer SDK versions with Pod Identity support |

### When to Prefer Each

IRSA is the right choice for clusters on older EKS versions, for teams migrating existing workloads where the annotation pattern is already established, or for environments where per-cluster trust policy control is required. It is also the only option for self-managed Kubernetes clusters outside EKS.

Pod Identity is preferable for new clusters where the platform team wants to keep IAM bindings outside the cluster, removing the ability for application teams to self-annotate service accounts and potentially assume unintended roles. It also simplifies multi-cluster architectures: the same IAM role can be assumed from multiple clusters without maintaining per-cluster trust policy statements.

The two mechanisms can coexist in the same cluster — they use different credential resolution paths, so a cluster can run both simultaneously during a gradual migration.

---

## 9. Operational Considerations

### Token TTLs and Credential Rotation

IRSA projected tokens are typically valid for one hour. The kubelet refreshes the token file before expiry, and the AWS SDK re-calls `AssumeRoleWithWebIdentity` when the cached STS credentials approach expiration. This rotation is fully automatic — no application restart, no manual intervention, and no window where the pod holds an expired credential.

The STS session duration defaults to one hour and can be extended up to the role's `MaxSessionDuration` setting (up to 12 hours). Increasing session duration reduces the frequency of `AssumeRoleWithWebIdentity` calls but extends the validity window of any credential that leaks — a deliberate trade-off, not a free optimization.

### CloudTrail Observability

Every `AssumeRoleWithWebIdentity` call is recorded in CloudTrail in the cluster's home account. The event includes the IAM role ARN being assumed, the OIDC provider ARN identifying the cluster, and the `sub` claim from the JWT encoding the namespace and service account name.

This makes IRSA significantly more auditable than node-level instance profiles, where all pods on a node share a single credential and attribution is impossible from the IAM side. With IRSA, every AWS API call made by a pod can be traced back to a specific service account in a specific namespace on a specific cluster.

Useful patterns for IRSA monitoring in CloudTrail:

- Filter on `eventName: AssumeRoleWithWebIdentity` to enumerate all OIDC-federated credential requests.
- The `userIdentity.sessionContext.webIdFederationData.federatedProvider` field identifies which cluster issued the token.
- Unusual spikes in `AssumeRoleWithWebIdentity` frequency for a given role may indicate token re-use attempts or a misconfigured credential cache in the application.

### When the Model Breaks Down

IRSA's security guarantee depends on the EKS OIDC issuer being trustworthy — which means the Kubernetes API server must not be compromised. A cluster-admin-level attacker can create arbitrary service accounts and generate valid OIDC tokens for any service account on the cluster. The IAM trust policy is the last line of defence in that scenario: a tight `sub` condition limits damage to the specific roles bound to the compromised service accounts.

This is precisely why subject condition precision in Section 6 matters. An attacker with cluster-admin access and a wildcard `sub` condition on a broad-permission role can cause significant damage. The same attacker against a cluster where every role uses exact `StringEquals` subject conditions has a much narrower blast radius per impersonated identity.
