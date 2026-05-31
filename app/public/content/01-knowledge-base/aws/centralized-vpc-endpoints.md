# Centralized VPC Endpoints & Private DNS Resolution

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Why Centralize VPC Endpoints?](#1-why-centralize-vpc-endpoints) | The cost and operational problem that centralization solves. |
| **02** | [Endpoint Types: Gateway vs Interface](#2-endpoint-types-gateway-vs-interface) | Core distinctions, routing mechanics, and where each type lives in the architecture. |
| **03** | [The Centralized Hub Architecture](#3-the-centralized-hub-architecture) | Shared-services VPC design, TGW attachment, and traffic flow. |
| **04** | [Private DNS & PHZ Sharing](#4-private-dns-phz-sharing) | How Route 53 Private Hosted Zones are associated across accounts, and why it is non-trivial. |
| **05** | [DNS Resolution Flow End-to-End](#5-dns-resolution-flow-end-to-end) | Step-by-step DNS lookup path from a spoke workload to the endpoint. |
| **06** | [Route 53 Resolver: Inbound & Outbound Rules](#6-route-53-resolver-inbound-outbound-rules) | Where Resolver endpoints live, and the forwarding rule design for spoke accounts. |
| **07** | [Security Controls & Endpoint Policies](#7-security-controls-endpoint-policies) | Endpoint-level resource policies, SCPs, and network-layer controls. |
| **08** | [Operational Considerations & Trade-offs](#8-operational-considerations-trade-offs) | Availability, blast radius, latency, and when not to centralize. |

---

## 1. Why Centralize VPC Endpoints?

In a multi-account AWS Landing Zone, every spoke VPC that needs private access to AWS services — S3, EC2, SSM, ECR, Secrets Manager, and dozens of others — would, by default, provision its own set of VPC endpoints. At scale, this becomes expensive and operationally noisy.

Interface endpoints are billed per hour per Availability Zone plus per-GB data processing. A single Interface Endpoint for SSM across three AZs costs roughly $0.01/hr × 3 AZs × 730 hrs ≈ **~$22/month per endpoint per spoke VPC**. Multiply that by 15 services and 30 spoke accounts and the idle infrastructure cost alone reaches tens of thousands of dollars monthly before a single byte of traffic flows.

Centralization collapses that sprawl into a single shared-services VPC that owns the endpoints on behalf of every spoke account. The spoke VPCs reach those endpoints over Transit Gateway, and DNS resolution is handled by Route 53 Resolver forwarding rules that push endpoint hostname queries to the hub's private resolvers. The result is a hub-and-spoke PrivateLink topology where the infrastructure is provisioned once and consumed by many.

The trade-off is added architectural complexity — particularly around DNS — and a single point of failure that requires deliberate availability design. Both are discussed in later sections.

---

## 2. Endpoint Types: Gateway vs Interface

The two endpoint types behave fundamentally differently at the network layer, and understanding that distinction is essential before designing a centralized model.

### Gateway Endpoints

Gateway Endpoints are a routing construct, not a network interface. They work by injecting a prefix list entry into the route table of the VPC that owns the endpoint. When a resource in that VPC sends traffic to `s3.amazonaws.com` or DynamoDB, the route table matches the prefix list and forwards the packet to the endpoint gateway — bypassing the internet gateway entirely.

| Property | Detail |
| :--- | :--- |
| Supported services | Amazon S3 and DynamoDB only |
| Billing | No hourly or data-processing charge |
| DNS behaviour | No private DNS override; uses public endpoint hostnames |
| Routing mechanism | Prefix list injected into VPC route tables |
| Cross-account sharing | Not directly shareable; must be owned by the VPC using them |

This last point is critical: **Gateway Endpoints cannot be centralized in the same way as Interface Endpoints.** Because the routing mechanism is a route table entry local to the owning VPC, a Gateway Endpoint in a shared-services hub VPC does not extend its prefix list routes to spoke VPCs connected over Transit Gateway. TGW does not propagate prefix list routes.

The practical outcome is that every spoke VPC should provision its own S3 and DynamoDB Gateway Endpoints. These are free, so there is no cost justification to centralize them — and no clean architectural path to do so. The centralization effort is therefore concentrated entirely on Interface Endpoints.

### Interface Endpoints (AWS PrivateLink)

Interface Endpoints provision one or more Elastic Network Interfaces (ENIs) directly inside the subnets of the VPC where the endpoint is created. Each ENI gets a private IP address within that subnet's CIDR range. Service traffic is routed to these ENIs using standard VPC routing and DNS.

| Property | Detail |
| :--- | :--- |
| Supported services | Most AWS services and AWS Marketplace third-party services |
| Billing | Per-AZ hourly charge + per-GB data processing fee |
| DNS behaviour | Generates a private DNS hostname that resolves to the ENI IPs |
| Routing mechanism | Standard VPC routing to ENI IPs; no route table injection |
| Cross-account sharing | ENI IPs are routable over TGW; DNS is the challenge |

Because Interface Endpoint ENIs have regular private IP addresses, traffic from a spoke VPC can reach them over a Transit Gateway attachment just like any other cross-VPC traffic — provided the routing and security groups are configured correctly. The architectural challenge is not routing; it is **DNS**. The private hostnames that AWS generates for Interface Endpoints (e.g., `ec2.us-east-1.vpce.amazonaws.com`) resolve to the ENI IPs only when queried from within the VPC that owns the endpoint, or from a VPC that has the corresponding Private Hosted Zone associated.

This is the problem that the PHZ sharing pattern solves.

---

## 3. The Centralized Hub Architecture

The shared-services VPC acts as the endpoint hub. It is a purpose-built VPC inside a dedicated network or shared-services AWS account, connected to all spoke VPCs via Transit Gateway.

### Hub VPC Layout

The hub VPC is typically small in CIDR — there are no workloads running here, only endpoint ENIs and resolver infrastructure. A `/24` or `/25` per AZ dedicated to endpoint subnets is common. The subnets hosting endpoint ENIs should be isolated from internet-facing routing and protected by security groups that restrict inbound traffic to the RFC1918 CIDR ranges of your spoke VPCs.

Every Interface Endpoint is deployed across all active Availability Zones in the hub VPC. This is non-negotiable for a shared infrastructure layer: a single-AZ endpoint becomes a blast-radius risk for all downstream spoke accounts during AZ-level impairments.

### Transit Gateway Attachment

The hub VPC attaches to the Transit Gateway like any other spoke. What distinguishes it is its role in the TGW route tables. A dedicated **Inspection** or **Shared Services** route table in TGW should have a static route that attracts traffic destined for the endpoint ENI subnets. Spoke VPCs propagate their CIDRs into this table, and the hub VPC is the default or next-hop for traffic that is not destined for another spoke.

The key routing requirement: spoke VPCs must have a route for the hub VPC's endpoint subnet CIDRs pointing at the TGW attachment. This is usually achieved via propagation from the hub VPC attachment into the spoke route tables, or via static routes in the TGW route table with return routes pushed to spoke VPCs.

### Traffic Flow (Non-DNS Path)

Once DNS resolution is working correctly (covered in the next section), the actual data-plane flow for a spoke workload calling, for example, the SSM service is:

1. Workload in Spoke VPC sends a packet destined for the SSM endpoint ENI IP (e.g., `10.1.2.45`).
2. Spoke VPC route table matches the hub subnet CIDR and forwards to TGW attachment.
3. TGW route table routes the packet to the hub VPC attachment.
4. Hub VPC routes the packet to the endpoint subnet, where the ENI receives it.
5. AWS PrivateLink carries the request to the SSM service backend over AWS internal fabric.
6. Return traffic follows the reverse path.

No traffic ever leaves the AWS network. No NAT gateway is involved. The flow is symmetric and deterministic.

---

## 4. Private DNS & PHZ Sharing

This is where most engineers encounter friction. Understanding it requires understanding how AWS generates and manages DNS for Interface Endpoints.

### What AWS Creates Automatically

When you create an Interface Endpoint with **private DNS enabled**, AWS does two things:

1. It creates a **Private Hosted Zone** (PHZ) in Route 53 scoped to the endpoint's service hostname — for example, `ssm.us-east-1.amazonaws.com`. This PHZ contains an `A` record (or alias) that resolves to the ENI private IPs.
2. It **associates that PHZ with the VPC** that owns the endpoint.

Any EC2 instance or resource inside that VPC will resolve `ssm.us-east-1.amazonaws.com` to the ENI IPs automatically. Resources outside the VPC — including those in spoke VPCs reachable over TGW — do not benefit from this association. They will resolve `ssm.us-east-1.amazonaws.com` to the public AWS SSM endpoints, and their traffic will either fail (if they have no internet route) or take a suboptimal public path.

### Cross-Account PHZ Association

Route 53 allows a PHZ owned in one account to be associated with a VPC in a different account. This is the mechanism that makes centralized endpoint DNS work. The process involves an authorization step from the PHZ-owning account, followed by an association request from the VPC-owning account.

Crucially, AWS does not expose PHZ cross-account association in the console — it is an API-only operation, typically automated via Lambda or Terraform during account vending. The association must be explicitly authorized by the network account, and it must be repeated for every new spoke VPC that is onboarded.

| Step | Actor | Action |
| :---: | :--- | :--- |
| 1 | Network account (hub) | Authorizes the spoke VPC to associate with the PHZ: `aws route53 create-vpc-association-authorization` |
| 2 | Spoke account | Executes the association: `aws route53 associate-vpc-with-hosted-zone` |
| 3 | Network account (hub) | Optionally deletes the authorization record after association is confirmed |

Once the association is in place, any resource inside the spoke VPC that queries `ssm.us-east-1.amazonaws.com` will receive the ENI IPs from the hub VPC — and route over TGW to reach them.

### The Scale Problem with PHZ Association

A centralized endpoint design with 20 services means 20 PHZs. A Landing Zone with 50 spoke VPCs means 50 associations per PHZ — 1,000 association operations total during initial build, plus new ones for every account onboarded afterward. This must be automated; manual management is not viable at any meaningful scale.

The preferred pattern is to trigger PHZ association as part of the account vending pipeline, typically via an EventBridge rule that fires when a new TGW attachment is created, invoking a Lambda in the network account that performs the authorization and kicks off an association workflow.

---

## 5. DNS Resolution Flow End-to-End

With centralized endpoints and PHZ associations in place, the full DNS and data-plane flow for a spoke workload looks like this:

### Step-by-Step Resolution

**Step 1 — Application query.** A workload in a spoke VPC issues a DNS query for `ssm.us-east-1.amazonaws.com`.

**Step 2 — VPC Resolver receives the query.** Every VPC has an implicit DNS resolver at the base CIDR + 2 address (e.g., `10.2.0.2`). The spoke VPC's resolver receives the query.

**Step 3 — Resolver checks Route 53 Resolver rules.** If a Resolver forwarding rule is attached to the spoke VPC for the domain `ssm.us-east-1.amazonaws.com` (or a wildcard covering it), the query is forwarded to the Inbound Resolver Endpoints in the hub VPC. If no forwarding rule exists, the resolver checks the PHZ associations — and if the PHZ is associated, resolves locally. If neither, it falls through to public DNS.

**Step 4 — Hub VPC resolves the query.** The Inbound Resolver Endpoint in the hub VPC receives the forwarded query. Because the hub VPC owns the endpoint and has the PHZ associated, its resolver returns the ENI private IPs.

**Step 5 — Response returned to spoke.** The ENI IPs (e.g., `10.1.2.45`, `10.1.3.61`) are returned to the workload in the spoke VPC.

**Step 6 — Traffic routed over TGW.** The workload connects to the ENI IP. The spoke VPC route table routes the packet over TGW to the hub VPC.

There are two valid paths for step 3: either PHZ association alone (without Resolver forwarding rules), or Resolver forwarding rules pointing at the hub. Both work. The difference is discussed in the next section.

---

## 6. Route 53 Resolver: Inbound & Outbound Rules

### Two DNS Delivery Mechanisms

| Approach | How it works | When to prefer |
| :--- | :--- | :--- |
| **PHZ association only** | Spoke VPCs have the hub's PHZs directly associated. Spoke's local resolver answers from the PHZ. | Simpler; works well when all spoke VPCs are in the same AWS organization and PHZ automation is solid. |
| **Resolver forwarding rules** | Spoke VPCs forward specific domains to Inbound Resolver Endpoints in the hub. Hub resolver answers. | Required when spoke VPCs are in a different organization or when centralized DNS policy control is needed. |

Most Landing Zone designs use a hybrid: PHZ association for AWS service endpoints, and Resolver forwarding rules for custom internal domains. For the centralized endpoint use case specifically, PHZ association is typically sufficient if the account vending pipeline reliably performs the associations.

### Inbound Resolver Endpoints

Inbound Resolver Endpoints are ENIs provisioned in the hub VPC that accept DNS queries forwarded from spoke VPCs. They should be deployed in at least two AZs for availability. Their IP addresses are static within the hub VPC's subnets and are referenced in the Outbound Resolver rules of spoke VPCs.

```
Hub VPC Endpoint Subnet (AZ-a): Inbound Resolver ENI → 10.1.2.10
Hub VPC Endpoint Subnet (AZ-b): Inbound Resolver ENI → 10.1.3.10
```

Spoke VPCs configure a Resolver rule targeting these IPs for each domain that should resolve to the hub.

### Outbound Resolver Rules (Spoke VPCs)

Each spoke VPC needs a Route 53 Resolver rule that matches the relevant service hostnames and forwards to the hub's Inbound Resolver IPs. In a Landing Zone, these rules are created centrally in the network account and shared to spoke accounts via AWS RAM, then associated to spoke VPCs during account vending.

The domain patterns to forward typically follow `*.us-east-1.amazonaws.com` or, more specifically, `ssm.us-east-1.amazonaws.com`, `ec2.us-east-1.amazonaws.com`, etc. Using a wildcard rule is operationally simpler but may forward more traffic than intended. Per-service rules are more precise but require updating as new endpoints are added.

---

## 7. Security Controls & Endpoint Policies

Centralizing endpoints does not mean abandoning endpoint-level security. Interface Endpoints support resource-based **Endpoint Policies** — IAM-style JSON policies attached to the endpoint itself that control which principals, actions, and resources can be accessed through it.

### Endpoint Policy Design

A well-designed centralized endpoint policy should express three things:

- **Who can use the endpoint** — typically restricted to principals within the AWS Organization, using the `aws:PrincipalOrgID` condition key.
- **What actions are permitted** — either a broad allow for all actions on the service, or a tighter list for sensitive services like KMS or Secrets Manager.
- **Which resources are accessible** — for S3 Interface Endpoints, you can restrict access to specific bucket ARNs belonging to your organization.

An illustrative policy for an SSM Interface Endpoint that restricts usage to your organization looks like:

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "ssm:*",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:PrincipalOrgID": "o-xxxxxxxxxxxx"
        }
      }
    }
  ]
}
```

This ensures that even if an attacker were to route traffic to the endpoint ENI IPs from outside the organization, the endpoint policy would deny the request at the PrivateLink layer.

### SCP Guardrails

Service Control Policies complement endpoint policies at the organizational level. Common SCP patterns that reinforce centralized endpoint usage include:

- **Deny creation of VPC endpoints in spoke accounts** — forces all endpoint provisioning to happen in the network account, preventing spoke teams from creating duplicate or uncentralized endpoints.
- **Deny access to services if not via VPC endpoint** — using the `aws:sourceVpce` condition to require that API calls to sensitive services traverse a specific endpoint.

The `deny endpoint creation` SCP is particularly important for operational hygiene. Without it, spoke teams can create their own endpoints that bypass the centralized model, creating DNS split-horizon scenarios that are difficult to troubleshoot.

### Security Group Design

The security group attached to each endpoint ENI should:

- Allow inbound HTTPS (TCP 443) only from the RFC1918 CIDR ranges used across your spoke VPCs.
- Deny all other inbound traffic.
- Allow all outbound (or restrict to the ENI's own VPC subnets if you prefer strict egress).

Avoid using overly broad security groups that accept traffic from `0.0.0.0/0` — the endpoint subnets should not be internet-routable anyway, but defence in depth applies here.

---

## 8. Operational Considerations & Trade-offs

### Availability

A centralized endpoint hub is shared infrastructure. Its availability envelope directly determines whether spoke workloads can reach AWS services privately. The mitigation is straightforward: deploy endpoints across all AZs and ensure TGW attachments have multi-AZ coverage. Route 53 Resolver Inbound endpoints similarly need multi-AZ deployment.

Design for the case where the hub VPC itself becomes unreachable — for example, if the TGW route table is misconfigured or if a hub VPC security group change inadvertently blocks traffic. In that scenario, spoke workloads will fail to reach endpoints even if the endpoints themselves are healthy. Monitoring should cover TGW attachment state, Resolver endpoint health, and endpoint ENI reachability.

### Blast Radius

A misconfiguration in the hub VPC — an endpoint policy that is too restrictive, a PHZ record that resolves to wrong IPs, or a security group rule update — will affect all spoke accounts simultaneously. Change management for hub VPC configurations should be gated behind a review and approval process with mandatory staging deployment in a non-production environment.

### Latency

Traffic from spoke VPCs to the hub's endpoint ENIs traverses TGW. TGW adds single-digit millisecond latency in most configurations. For the vast majority of AWS API calls (SSM, ECR, Secrets Manager, etc.), this is imperceptible. For extremely latency-sensitive workloads making high-frequency API calls to services like DynamoDB, a local endpoint in the spoke VPC may be preferable — though this is a rare edge case given DynamoDB also supports a free Gateway Endpoint.

### When Not to Centralize

| Scenario | Recommendation |
| :--- | :--- |
| Fewer than 5 spoke VPCs | Per-VPC endpoints are likely cheaper and simpler. |
| Spoke VPCs span multiple AWS organizations | PHZ cross-organization association is not supported; Resolver forwarding is required, adding complexity. |
| Latency-critical PrivateLink to third-party services | Evaluate per-VPC endpoints; TGW hop adds latency that may matter for p99. |
| Teams with strict blast-radius requirements | Consider per-team endpoint accounts rather than a single shared hub. |

The centralized model pays off reliably at 10+ spoke VPCs with a consistent set of AWS service endpoints. Below that threshold, the operational overhead of PHZ automation and TGW routing management may outweigh the cost savings.