# How AWS PrivateLink Works

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [What PrivateLink Is](#1-what-privatelink-is) | The core abstraction, what problem it solves, and how it differs from VPC Peering and Transit Gateway. |
| **02** | [The Five Endpoint Types](#2-the-five-endpoint-types) | Complete taxonomy — Interface, Resource, Service-Network, Gateway Load Balancer, and Gateway endpoints. |
| **03** | [Interface Endpoints for AWS Services](#3-interface-endpoints-for-aws-services) | How Interface Endpoints work for native AWS services, which services need them, and common patterns. |
| **04** | [Custom Endpoint Services: Producer & Consumer Model](#4-custom-endpoint-services-producer-consumer-model) | Building your own PrivateLink-backed service — NLB design, endpoint service creation, and consumer connection. |
| **05** | [NLB Design for Endpoint Services](#5-nlb-design-for-endpoint-services) | Target group patterns, health checks, preserve client IP, and NLB constraints that affect PrivateLink. |
| **06** | [Resource Endpoints & Resource Configurations](#6-resource-endpoints-resource-configurations) | Accessing resources directly without an NLB — resource configuration types, resource gateway, and use cases. |
| **07** | [Service-Network Endpoints & VPC Lattice](#7-service-network-endpoints-vpc-lattice) | Single endpoint for multiple services and resources via a VPC Lattice service network. |
| **08** | [Gateway Load Balancer Endpoints](#8-gateway-load-balancer-endpoints) | Routing traffic through virtual appliances — firewalls, IDS/IPS — using GWLB endpoints. |
| **09** | [Gateway Endpoints: S3 and DynamoDB](#9-gateway-endpoints-s3-and-dynamodb) | The route-table-based endpoint type that is NOT PrivateLink — and why that distinction matters. |
| **10** | [DNS for PrivateLink](#10-dns-for-privatelink) | Private DNS override, custom DNS hostnames, PHZ design, split-horizon DNS, and resolution from on-premises. |
| **11** | [Acceptance Policies & Allowlisting](#11-acceptance-policies-allowlisting) | Manual vs automatic acceptance, principal allowlisting, and managing consumer connections at scale. |
| **12** | [Cross-Account PrivateLink](#12-cross-account-privatelink) | Producer and consumer in different AWS accounts — trust model, RAM sharing, and centralized endpoint patterns. |
| **13** | [Cross-Region PrivateLink](#13-cross-region-privatelink) | How PrivateLink extends across regions via inter-region VPC peering, and the constraints involved. |
| **14** | [SaaS & Third-Party PrivateLink](#14-saas-third-party-privatelink) | AWS Marketplace PrivateLink, vendor-managed endpoint services, and the consumer operational model. |
| **15** | [On-Premises Access via Direct Connect & VPN](#15-on-premises-access-via-direct-connect-vpn) | How on-premises workloads reach PrivateLink endpoints through hybrid connectivity and the DNS resolution challenge. |
| **16** | [Overlapping CIDR Handling](#16-overlapping-cidr-handling) | Why PrivateLink is the canonical solution to overlapping IP address spaces, and how to design for it. |
| **17** | [Security Controls](#17-security-controls) | Endpoint policies, security groups, VPC endpoint conditions in IAM, and SCP guardrails. |
| **18** | [Limits, Scaling & Availability](#18-limits-scaling-availability) | Per-AZ ENI limits, NLB connection limits, endpoint service availability design, and scaling patterns. |

---

## 1. What PrivateLink Is

AWS PrivateLink lets you connect VPCs, AWS services, and on-premises networks without sending traffic over the public internet — and without VPC peering or Transit Gateway. The fundamental building block is an **Elastic Network Interface (ENI)** provisioned inside the consumer's VPC subnet. Traffic sent to that ENI is forwarded by AWS's internal fabric to wherever the backing service lives, without ever leaving the AWS network.

The most important property of PrivateLink is **unidirectionality and IP isolation**. Compare this to VPC peering, which creates bidirectional routes and exposes the full CIDR of both VPCs. With PrivateLink, the consumer can reach a specific service through the endpoint ENI — but the service cannot initiate connections back into the consumer VPC, and neither side needs to know the other's IP address space. That makes PrivateLink the right tool whenever you need service-level access rather than full network-level routing.

### PrivateLink vs VPC Peering vs Transit Gateway

| Property | PrivateLink | VPC Peering | Transit Gateway |
| :--- | :--- | :--- | :--- |
| Traffic direction | Consumer → service (one-way) | Bidirectional | Bidirectional |
| IP space exposure | Endpoint ENI IPs only | Full VPC CIDR | Full VPC CIDR |
| Overlapping CIDRs | Supported — irrelevant to PrivateLink | Not supported | Not supported |
| Transitive routing | Not applicable | Not supported | Supported |
| Use case | Service and resource consumption | VPC interconnect | Hub-and-spoke networking |
| Scales to many consumers | Yes — one endpoint service, many consumers | No — one peering per pair | Yes — attach many VPCs |

PrivateLink is not a general-purpose networking solution. It doesn't replace TGW or peering for workloads that need full bidirectional connectivity. It is purpose-built for the **service consumption pattern**: one party produces a service or resource, and many others consume it privately.

---

## 2. The Five Endpoint Types

PrivateLink surfaces as five distinct endpoint types. Before diving in, there's one framing concept that makes the whole taxonomy click.

### The Producer / Consumer Split

Every PrivateLink connection has two sides:

- The **producer** (also called the provider) owns the service or resource and publishes it for private access.
- The **consumer** creates a VPC endpoint in their own VPC to connect to what the producer published.

For AWS-managed services like SSM, ECR, and KMS, AWS is always the producer — you only ever act as the consumer. For your own internal services, your team is the producer and other teams or accounts are consumers.

This distinction matters because **when you are the producer of a custom service, you must provision a Network Load Balancer** to back the endpoint service. When consuming an AWS-managed service, AWS owns all the backing infrastructure — there's nothing for you to build on the producer side.

### Endpoint Type Summary

| Endpoint Type | Who provisions the NLB | Consumer creates | Producer-side construct | PrivateLink? |
| :--- | :--- | :--- | :--- | :--- |
| Interface — AWS service | AWS (hidden) | Interface Endpoint | None (AWS-managed) | Yes |
| Interface — Custom service | You (the producer) | Interface Endpoint | NLB + Endpoint Service | Yes |
| Resource | None required | Resource Endpoint | Resource Gateway + Resource Configuration | Yes |
| Service-Network | None required | Service-Network Endpoint | VPC Lattice Service Network | Yes |
| Gateway Load Balancer | You (the producer) | GWLB Endpoint + route entries | GWLB + Endpoint Service | Yes |
| Gateway | None — AWS-managed | Gateway Endpoint + route entries | None | No |

---

### Type 1a — Interface Endpoint (Consumer of AWS-Managed Services)

When consuming an AWS-managed service, you create an Interface Endpoint in your VPC. AWS provisions ENIs in your chosen subnets, and each ENI gets a private IP from that subnet's CIDR. With private DNS enabled, the service's public hostname automatically resolves to those ENI IPs — no application code changes needed.

**You need:** An Interface Endpoint per service, per region, in the VPC that needs access.

**You do not need:** An NLB, an endpoint service resource, or any producer-side infrastructure.

**Use when:** Accessing SSM, ECR, Secrets Manager, KMS, STS, CloudWatch Logs, EKS, and similar AWS services from private subnets with no internet path.

---

### Type 1b — Interface Endpoint Backed by a Custom Endpoint Service

When you want to share your own service privately, you act as the producer. You provision an NLB fronting your service, then create an **endpoint service** resource tied to that NLB. Other VPCs — in the same account, different accounts, or different organizations — create Interface Endpoints pointing at your endpoint service name. The NLB receives their traffic and routes it to your backends.

The consumer still creates the same Interface Endpoint type as above, but what's behind it is your NLB and your service instead of an AWS-managed backend.

**Producer needs:** An NLB, an endpoint service resource, an allowlist of permitted consumer principals, and an acceptance policy.

**Consumer needs:** An Interface Endpoint pointing at your service name.

**Use when:** Sharing an internal platform API, authentication service, or data endpoint across accounts or teams without exposing VPC routing.

---

### Type 2 — Resource Endpoint

A Resource Endpoint connects to a **resource configuration** rather than an endpoint service. It doesn't require an NLB — a **resource gateway** in the provider VPC acts as the ingress point. The resource can be an IP address, a domain name, or an ARN-identified AWS resource like an RDS database.

**Producer needs:** A resource gateway in their VPC, a resource configuration describing the resource, and a RAM share to grant consumer access.

**Consumer needs:** A Resource Endpoint pointing at the shared resource configuration.

**Use when:** Accessing a specific resource (RDS database, application IP, domain endpoint) in another VPC or on-premises, without the overhead of spinning up an NLB purely to satisfy PrivateLink's endpoint service requirement.

---

### Type 3 — Service-Network Endpoint

A Service-Network Endpoint connects a VPC to a **VPC Lattice service network** — a single endpoint that gives access to all resource configurations and VPC Lattice services associated with that network. Instead of one endpoint per service, the consumer creates one endpoint and gets the whole catalog.

**Producer needs:** A VPC Lattice service network with resource configurations and/or Lattice services associated to it, shared via RAM.

**Consumer needs:** A single Service-Network Endpoint pointing at the service network.

**Use when:** A consumer VPC needs access to many internal services or resources managed under a unified platform catalog.

---

### Type 4 — Gateway Load Balancer Endpoint

A GWLB Endpoint routes traffic **transparently** through a fleet of virtual network appliances — firewalls, IDS/IPS, deep packet inspection — before it reaches its destination. Unlike Interface Endpoints which are DNS-directed, GWLB Endpoints are inserted into the traffic path via **route table entries**, making them completely invisible to the application.

**Producer needs:** A Gateway Load Balancer fronting the appliance fleet, an endpoint service backed by the GWLB.

**Consumer needs:** A GWLB Endpoint and route table entries that direct traffic through it.

**Use when:** Inline traffic inspection is required — centralized security inspection architectures, east-west traffic inspection, or egress filtering.

---

### Type 5 — Gateway Endpoint

Gateway Endpoints are a routing construct, not a PrivateLink construct. They inject prefix list routes into VPC route tables, directing S3 and DynamoDB traffic to an AWS-managed gateway. No ENI is provisioned, no PrivateLink pricing applies, and there is no producer/consumer relationship — this is a purely local VPC configuration.

**You need:** A Gateway Endpoint resource associated with the VPC route tables you want to cover.

**Use when:** Private access to S3 or DynamoDB from within a VPC. Gateway Endpoints are free and should always be provisioned regardless of whether Interface Endpoints also exist for those services.

---

## 3. Interface Endpoints for AWS Services

Interface Endpoints are the most common PrivateLink pattern you'll encounter. They make AWS service APIs accessible from within a VPC using private IP addresses, eliminating the need for an internet gateway, NAT gateway, or public IP on the calling resource.

### How They Work

When you create an Interface Endpoint for a service (for example, `com.amazonaws.ap-southeast-1.ssm`), AWS provisions one ENI per selected Availability Zone in your specified subnets. Each ENI gets a private IP from the subnet's CIDR range. When private DNS is enabled, a Private Hosted Zone overrides the service's public hostname so that callers inside the VPC automatically resolve to the ENI private IPs — no application code changes required.

### Commonly Used AWS Service Endpoints

Not all AWS services need Interface Endpoints. S3 and DynamoDB are better served for free by Gateway Endpoints. The services most commonly accessed via Interface Endpoints in a production Landing Zone are:

| Service | Why It Matters |
| :--- | :--- |
| SSM + SSM Messages + EC2 Messages | Required for Session Manager and Run Command on instances with no internet |
| ECR API + ECR Docker | Image manifest and layer pull for private registries |
| Secrets Manager | Secret retrieval without internet access |
| KMS | Encryption/decryption operations from private subnets |
| STS | AssumeRole calls (IRSA, federated identity flows) |
| CloudWatch Logs | Log shipping from private instances and containers |
| EKS | EKS API server access from private networks |
| S3 (Interface) | When bucket policy requires `aws:sourceVpce` enforcement; complements the Gateway Endpoint |

### Private DNS Enablement

When `enableDnsSupport` is true on the VPC (the default) and private DNS is enabled on the endpoint, the endpoint creates a Private Hosted Zone overriding the public resolution of the service hostname. From inside the VPC, `ssm.ap-southeast-1.amazonaws.com` resolves to the endpoint ENI IPs rather than the public SSM IPs.

If private DNS is not enabled, callers must use the endpoint-specific DNS name — which requires application-level changes and is rarely the right approach outside of very specific compliance requirements.

---

## 4. Custom Endpoint Services: Producer & Consumer Model

When an organization wants to share its own service privately across VPCs or accounts, it creates an **endpoint service** backed by a Network Load Balancer. This turns any TCP/UDP service into a privately consumable API that other teams can access without VPC routing exposure.

### Producer Side

The producer provisions an NLB fronting the service, then creates an endpoint service resource associated with that NLB. AWS assigns a service name in the format `com.amazonaws.vpce.{region}.{vpce-svc-id}`. The producer controls two things: the allowlist of AWS principals permitted to connect, and whether new connection requests require manual acceptance or are automatically approved.

### Consumer Side

The consumer creates an Interface Endpoint specifying the producer's service name, subnets, and security group. Once the connection is accepted, the endpoint ENIs are provisioned and DNS is configured. From the consumer's application perspective, the service is accessed via its DNS hostname — the consumer has zero visibility into the producer's VPC, NLB, or backend topology.

### Connection Lifecycle

| State | Meaning |
| :--- | :--- |
| `pendingAcceptance` | Consumer request submitted; awaiting producer acceptance |
| `pending` | Accepted; ENIs being provisioned |
| `available` | ENIs active; connection usable |
| `rejected` | Producer rejected the request |
| `expired` | Request not accepted within 7 days |
| `deleting` / `deleted` | Teardown in progress or complete |

---

## 5. NLB Design for Endpoint Services

The NLB is the mandatory infrastructure behind every custom Interface Endpoint service. Its design directly affects availability, performance, and behavior of the PrivateLink service — getting it wrong is a common source of AZ-level failures.

### AZ Coverage

The NLB must have load balancer nodes in all AZs where the endpoint service is offered. If the NLB doesn't have a node in an AZ where a consumer's endpoint ENI is provisioned, traffic from that AZ fails silently. Always deploy the NLB and endpoint service across all AZs where consumers may create endpoint ENIs.

### Target Group Patterns

| Target Type | Use Case | Notes |
| :--- | :--- | :--- |
| Instance | EC2-backed services | AZ-aware; NLB routes to instances in same AZ by default |
| IP | Container workloads, Lambda, any IP-addressable target | More flexible; enables cross-AZ targeting if needed |
| ALB | HTTP/HTTPS services needing L7 routing | NLB fronts an ALB for content-based routing behind PrivateLink |

### Preserve Client IP

By default, the NLB does not preserve the consumer's source IP for PrivateLink traffic — the backend sees the NLB node IP as the source. Enabling **proxy protocol v2** on the target group causes the NLB to prepend a header carrying the original source IP. The backend must be configured to parse this header. This is the only mechanism to pass the consumer's IP to the backend in a PrivateLink setup.

### Health Checks

Health check source IPs come from the NLB node's subnet — ensure backend security groups allow health check traffic from the NLB subnet CIDRs, not just from consumer VPC CIDRs. This is a common misconfiguration that causes endpoints to appear healthy while backends are silently unhealthy.

---

## 6. Resource Endpoints & Resource Configurations

Resource Endpoints are a newer PrivateLink type that enables direct private access to a resource — a database, an IP address, a domain name, or an ARN-identified AWS resource — without requiring a Network Load Balancer in front of it. This significantly simplifies architecture for resource-sharing use cases that previously required NLB provisioning solely to satisfy PrivateLink's endpoint service requirement.

### Resource Gateway

The resource provider creates a **resource gateway** in the VPC where the resource lives. The resource gateway is a set of ENIs that act as the ingress point for consumer traffic. From the resource's perspective, traffic appears to originate locally from the resource gateway's IPs — not from any consumer VPC.

Multiple resource configurations can share the same resource gateway. The resource gateway is the VPC-level construct; resource configurations are the logical objects describing the specific resources being shared.

### Resource Configuration Types

| Type | What It Represents | Shareable Independently |
| :--- | :--- | :--- |
| Single | A single IP address or domain name | Yes |
| Group | A collection of child resource configurations | Yes |
| Child | A member of a Group; an IP address or domain name | No — shared as part of the Group only |
| ARN | A supported AWS resource identified by ARN (currently RDS databases) | Yes — child configurations auto-managed by AWS |

The ARN type is the most powerful option for AWS-managed resources. When a producer creates an ARN resource configuration for an RDS instance, AWS automatically manages the child configurations — tracking the instance's IP addresses and DNS names and keeping them current as the resource changes. The consumer never needs to know or manage the underlying IPs.

### Resource Endpoint Use Cases

**Cross-account RDS access** is the primary production use case. A database team provisions an RDS instance in a shared data account and creates an ARN resource configuration. Spoke accounts create resource endpoints to access the database privately — no NLB, no custom DNS management, no CIDR routing changes needed.

**On-premises resource exposure** is another key use case. An on-premises application endpoint reachable via Direct Connect can be registered as a domain-name or IP resource configuration. AWS consumers create resource endpoints to access it via PrivateLink, with traffic flowing over the DX connection on the provider side.

**IP address sharing** allows a specific private IP — for example, a stateful application endpoint in a shared services VPC — to be consumed by other VPCs without exposing the full VPC routing.

### Accessing Resource Configurations

Consumers can access resource configurations in two ways:

- **Directly** via a Resource Endpoint in their VPC — a one-to-one relationship between the endpoint and the resource configuration.
- **Through a service network** via a Service-Network Endpoint — allowing multiple resource configurations and VPC Lattice services to be accessed through a single endpoint.

When sharing resource configurations with other accounts, the provider uses AWS RAM to grant access. The consumer accepts the RAM resource share and then creates a resource endpoint.

### Transitive Sharing Controls

When a resource configuration is shared via RAM to Account B, Account B can either use it directly or associate it with a service network. If Account B associates the resource configuration with a shareable service network, it could become accessible to Account C — transitive sharing. The resource provider can prevent this by configuring the resource configuration to disallow association with shareable service networks.

---

## 7. Service-Network Endpoints & VPC Lattice

A Service-Network Endpoint connects a VPC to a **VPC Lattice service network** — a single endpoint that provides access to all resources and services associated with that network. This is the model for platform teams that publish a catalog of internal services and resources for many consuming teams.

### What a Service Network Is

A service network is a logical grouping managed by VPC Lattice. It can contain VPC Lattice services (L7 HTTP/HTTPS applications with routing, auth, and observability) and resource configurations (PrivateLink-backed resources like databases or IP endpoints). A single service-network endpoint in a consumer VPC provides access to the entire collection.

This is architecturally distinct from creating one Interface Endpoint per service. With service-network endpoints, the platform team manages a single service network and associates resources and services to it. Consuming teams create one endpoint to get access to the whole catalog.

### DNS for Service-Network Endpoints

When a service-network endpoint is created, AWS generates DNS names for each resource configuration and VPC Lattice service associated with the network. These DNS names are publicly resolvable but return private IP addresses — so they work from on-premises as well as from within the VPC, as long as the network path to the endpoint exists.

For custom domain names on resource configurations, enabling private DNS on the service-network endpoint causes VPC Lattice to provision private hosted zones automatically in the consumer VPC. The consumer controls which domains get private hosted zones via the `privateDnsPreferences` setting — options range from only verified domains, to all domains, to a specific list.

### Billing Model

Service-network endpoint billing differs from Interface Endpoint billing. There is no hourly charge for the service-network endpoint itself — billing is per-GB of data processed and hourly per resource configuration associated with the service network.

### When to Use Service-Network Endpoints vs Individual Endpoints

| Scenario | Preferred Approach |
| :--- | :--- |
| Accessing one or two specific AWS services | Individual Interface Endpoints per service |
| Accessing a catalog of internal platform services | Service-Network Endpoint to a VPC Lattice service network |
| Accessing a specific database cross-account | Resource Endpoint directly |
| Accessing many resources managed by a platform team | Service-Network Endpoint — one endpoint, full catalog access |

---

## 8. Gateway Load Balancer Endpoints

Gateway Load Balancer Endpoints are a specialized PrivateLink type for **inline traffic inspection**. Rather than connecting a consumer to a service by DNS, GWLB Endpoints are inserted into the traffic path via route table entries — traffic is routed through the endpoint to a fleet of virtual appliances and back before continuing to its destination. The application has no idea this is happening.

### How GWLB Endpoints Work

The architecture follows the same producer/consumer pattern as other PrivateLink types. The **producer** deploys a fleet of virtual appliances (firewalls, IDS/IPS, DPI tools) behind a Gateway Load Balancer in a dedicated inspection VPC. The GWLB distributes traffic across the appliance fleet using GENEVE encapsulation (port 6081), preserving the original packet headers so appliances see the actual source and destination IPs.

The **consumer** creates a GWLB Endpoint in their VPC and configures route tables to send traffic through it. Traffic destined for inspection is routed to the GWLB Endpoint, forwarded to the appliance fleet, and then returned through the endpoint to its original destination.

### Traffic Flow for Centralized Egress Inspection

1. Traffic from application instances is routed to the GWLB Endpoint via a route table entry targeting the endpoint ID.
2. The GWLB Endpoint forwards the traffic to the Gateway Load Balancer in the inspection VPC via PrivateLink.
3. The GWLB distributes the traffic to an appliance instance for inspection.
4. The appliance allows or blocks the traffic and returns it to the GWLB.
5. The GWLB Endpoint returns the traffic to the consumer VPC, where it continues to the internet gateway.

### GWLB Endpoints vs Interface Endpoints

| Property | Interface Endpoint | GWLB Endpoint |
| :--- | :--- | :--- |
| Traffic direction | DNS-directed, application-initiated | Route-table-directed, transparent to application |
| Use case | Service consumption | Inline traffic inspection |
| Backing service | NLB | Gateway Load Balancer |
| Protocol | TCP/UDP | Any (GENEVE encapsulation) |
| Application awareness | Application must call the endpoint | Application unaware — all traffic intercepted |

### IPv6 Support

GWLB Endpoints support IPv4, IPv6, and dualstack IP address types. The VPC and subnets must have appropriate CIDR blocks configured for the selected IP type, and the GWLB must also be configured for dualstack if IPv6 is required.

---

## 9. Gateway Endpoints: S3 and DynamoDB

Gateway Endpoints are the oldest VPC endpoint type and are fundamentally different from every other type on this list. They do not provision ENIs, do not use PrivateLink, and have no per-hour or per-GB pricing. They work by injecting prefix list routes into VPC route tables.

### How They Work

When a Gateway Endpoint is created for S3 or DynamoDB, AWS automatically adds a route to the selected VPC route tables. The destination is a managed prefix list for the service (all S3 IP ranges in the region, for example), and the target is the gateway endpoint ID. When a resource in those subnets sends traffic to S3 or DynamoDB, the longest-prefix match routes it to the gateway endpoint rather than the internet gateway.

Traffic via a Gateway Endpoint still reaches the service's public endpoints — it just does so via AWS's internal network rather than the internet. The key distinction from PrivateLink Interface Endpoints is that Gateway Endpoints do not assign private IPs from the VPC CIDR to the service.

### Gateway Endpoints Are Free

There is no charge for Gateway Endpoints. This makes them universally applicable — every VPC that accesses S3 or DynamoDB should have Gateway Endpoints provisioned. The only reason to add an Interface Endpoint for S3 alongside a Gateway Endpoint is when endpoint policy enforcement (`aws:sourceVpce`) is required or when resolving S3 hostnames to private IPs is necessary for compliance.

### Route Table Considerations

Gateway Endpoint routes use longest-prefix match. If both a `0.0.0.0/0` route to an internet gateway and a Gateway Endpoint route for S3 exist in the same route table, S3 traffic matches the more specific endpoint route and is handled accordingly. Traffic to S3 in other regions bypasses the gateway endpoint because the prefix list is region-specific — that traffic falls back to the internet gateway route.

### Gateway Endpoint vs S3 Interface Endpoint

| Property | Gateway Endpoint | S3 Interface Endpoint |
| :--- | :--- | :--- |
| Pricing | Free | Hourly + per-GB |
| ENI provisioned | No | Yes |
| Private IP for S3 | No | Yes |
| DNS override | No | Yes (with private DNS enabled) |
| Endpoint policy | Yes | Yes |
| Cross-account | No | Yes (via centralized design) |
| On-premises access | No | Yes (via DX + Resolver) |
| `aws:sourceVpce` enforcement | Yes | Yes |

The recommendation for most deployments: always provision a Gateway Endpoint for S3 and DynamoDB (free, no complexity), and add an S3 Interface Endpoint only when private DNS resolution or on-premises access to S3 is required.

---

## 10. DNS for PrivateLink

DNS is the most operationally nuanced aspect of PrivateLink, particularly in multi-account and hybrid environments. There are four distinct patterns you'll encounter depending on the endpoint type and use case.

### Pattern 1 — AWS Private DNS (Interface Endpoints for AWS Services)

When private DNS is enabled on an Interface Endpoint for an AWS service, AWS creates a Private Hosted Zone overriding the public service hostname. This PHZ is associated with the VPC that owns the endpoint. From inside the VPC, the service hostname resolves to the endpoint ENI IPs automatically.

In centralized endpoint designs, these PHZs must be associated with spoke VPCs via cross-account PHZ association.

### Pattern 2 — Private DNS for Custom Endpoint Services

Producers of custom endpoint services can configure a private DNS name for their service — a custom hostname like `payments-api.internal.company.com`. AWS verifies domain ownership before allowing this. When enabled, AWS creates a PHZ for the configured hostname and associates it with each consumer VPC that has an active endpoint connection. Consumers resolve the custom hostname to the endpoint ENI IPs without needing to know the `vpce-*` DNS names.

### Pattern 3 — Split-Horizon DNS

Split-horizon DNS allows the same domain name to resolve differently inside and outside a VPC. For example, `api.company.com` resolves to a PrivateLink endpoint ENI IP from within the consumer VPC (via the PHZ), but resolves to a public ALB IP from the internet. Route 53 achieves this by associating a private hosted zone for the domain with specific VPCs — those VPCs get the private resolution, while all other resolvers get the public records.

This is the correct pattern for services that need to be reachable both publicly and privately without requiring clients to use different hostnames.

### Pattern 4 — On-Premises DNS Resolution

On-premises resolvers cannot query Route 53 Private Hosted Zones directly. For on-premises workloads to resolve PrivateLink endpoint hostnames, DNS queries must be forwarded through the VPC's DNS resolver using Route 53 Resolver **Inbound Endpoints**. The on-premises DNS server is configured with a conditional forwarder for the relevant domains, pointing at the Resolver Inbound Endpoint IPs. The Resolver resolves the query against the VPC's PHZ associations and returns the endpoint ENI private IPs. The on-premises workload then connects to those IPs over Direct Connect or VPN.

---

## 11. Acceptance Policies & Allowlisting

Every custom endpoint service (Interface or GWLB type) has an acceptance policy controlling which consumers can connect and whether connections require manual approval.

### Automatic vs Manual Acceptance

**Automatic acceptance** approves all connection requests from allowlisted principals immediately. This is correct for internal platform services consumed by known, trusted accounts — the allowlist is the access control, and manual approval adds operational overhead without security benefit.

**Manual acceptance** queues requests for explicit approval. This is appropriate for services consumed by external parties where each new consumer relationship requires explicit vetting. Pending requests expire after 7 days.

### Principal Allowlisting

Allowlist entries can be a specific AWS account ID, an IAM role ARN, an IAM user ARN, an AWS Organization path, or the wildcard `*`. The allowlist is the first gate — non-allowlisted principals are rejected immediately without entering the acceptance queue.

For Landing Zone designs where all spoke accounts belong to the same organization, allowlisting at the Organization level (`arn:aws:organizations::*:organization/o-xxxx`) is the operationally correct approach — new accounts are automatically allowed without manual allowlist updates.

### Resource Configuration Sharing vs Endpoint Service Allowlisting

Resource configurations use a different access control mechanism from endpoint services. Resource configurations are shared via **AWS RAM** rather than an allowlist on the endpoint service. The provider creates a RAM resource share targeting specific accounts, OUs, or the full organization. Consumers accept the RAM resource share and then create resource endpoints. There is no acceptance step for individual resource endpoint connections — access is controlled entirely at the RAM sharing level.

---

## 12. Cross-Account PrivateLink

Cross-account PrivateLink is the most common Landing Zone pattern: a service or resource in one AWS account is consumed privately by many spoke accounts.

### Interface Endpoint Services Cross-Account

The producer account creates the NLB, the service, and the endpoint service. The consumer account creates the Interface Endpoint. No VPC peering, TGW attachment, or route table changes are needed between accounts. The only cross-account trust is the allowlist entry on the endpoint service.

### Resource Configurations Cross-Account

The producer account creates the resource configuration and resource gateway, then shares the resource configuration via RAM to the consumer account or organization. The consumer accepts the RAM share and creates a resource endpoint. AWS manages the DNS and routing — the consumer doesn't need to know the producer's VPC CIDR or resource IP addresses.

### Centralized Endpoint Pattern

In a Landing Zone, the most common cross-account pattern is centralization: a network account owns Interface Endpoints for all AWS services and exposes them to spoke accounts via TGW routing and shared PHZs.

For custom services, the reverse is common: a platform service in a platform account creates an endpoint service or resource configuration, and spoke accounts consume it via endpoints — without the platform account needing any routing changes to accommodate new consumers.

### RAM Sharing for Discoverability

AWS RAM can share both endpoint services and resource configurations across accounts within an organization. When shared via RAM, the service or resource appears in the consumer account's endpoint creation workflow as a discoverable option, eliminating the need for the producer to communicate service names or resource configuration IDs to each consumer manually.

---

## 13. Cross-Region PrivateLink

PrivateLink is inherently regional — an endpoint service and its consumers must be in the same region. Cross-region access requires a bridge.

### The Inter-Region VPC Peering Bridge

The standard pattern uses inter-region VPC peering. A VPC in Region B peers with a VPC in Region A. The VPC in Region A holds the endpoint ENIs. Consumers in Region B route traffic through the peering connection to the Region A VPC, where the endpoint delivers it to the service.

This works but carries important constraints: inter-region traffic incurs data transfer charges on the peering link in addition to PrivateLink data processing charges, DNS resolution requires careful configuration, and latency includes the full inter-region hop.

### When Cross-Region PrivateLink Is Needed

Cross-region PrivateLink is relatively rare. It arises when a custom internal service hosted in one region needs to be consumed privately by workloads in another region, and deploying the service locally in each region isn't feasible. For most multi-region architectures, deploying the service independently per region is cleaner, cheaper, and lower-latency than bridging regions via peering.

---

## 14. SaaS & Third-Party PrivateLink

AWS Marketplace PrivateLink integrations allow customers to consume third-party SaaS services without public internet exposure. The vendor operates an endpoint service in their AWS infrastructure; the customer subscribes via Marketplace and creates a consumer Interface Endpoint in their VPC.

### Consumer Operational Model

The customer receives an endpoint service name from the vendor (or via Marketplace), creates an Interface Endpoint in their VPC, and waits for acceptance. Once connected, workloads access the SaaS service via the endpoint ENI's DNS hostname. Traffic never leaves the AWS network.

### DNS for Third-Party Services

Vendors typically provide one of three DNS options: a vendor-managed private DNS name automatically associated by AWS, a public hostname the customer overrides in their own PHZ, or no DNS support requiring the customer to use the `vpce-*` hostname. The most operationally clean pattern is vendor-managed private DNS with AWS automatic association.

### Evaluating Vendor PrivateLink Offerings

| Question | Why It Matters |
| :--- | :--- |
| Which AZs is the service offered in? | Service not offered in all AZs creates single-AZ dependency |
| Is acceptance automatic or manual? | Manual acceptance adds lead time to new environment setups |
| Is private DNS provided and managed? | Manual DNS management adds operational overhead |
| What is the NLB connection limit? | High-throughput workloads may hit per-connection NLB limits |
| Is the service endpoint per-region or global? | Multi-region deployments may need separate endpoints per region |

---

## 15. On-Premises Access via Direct Connect & VPN

On-premises workloads can access PrivateLink endpoints through an established Direct Connect or VPN connection to the VPC that holds the endpoint ENI. The endpoint ENI has a private IP in the VPC subnet — as long as the on-premises network has a route to that subnet via DX or VPN, the on-premises workload can connect to the endpoint IP directly.

### Routing Requirements

In most DX setups, BGP route advertisement over the DX Virtual Interface includes all VPC subnets — the endpoint ENI subnet is part of the VPC CIDR and is included automatically. No special routing configuration is required beyond standard hybrid connectivity.

### The DNS Challenge

Routing is the easy part. DNS is where on-premises access consistently causes friction. On-premises resolvers don't have access to Route 53 Private Hosted Zones. Without intervention, querying `ssm.ap-southeast-1.amazonaws.com` from on-premises returns the public SSM IPs, not the endpoint ENI IPs.

The solution is a **conditional forwarder** on the on-premises DNS server pointing at Route 53 Resolver Inbound Endpoints in the VPC. Queries for `amazonaws.com` (or specific service hostnames) are forwarded to the Resolver Inbound Endpoint IPs. The Resolver answers from the VPC's PHZ associations, returning the correct endpoint ENI IPs. The Inbound Resolver Endpoint subnets must be routable via DX or VPN, and their security groups must allow DNS (UDP/TCP 53) from on-premises CIDR ranges.

---

## 16. Overlapping CIDR Handling

PrivateLink is the canonical AWS solution for connectivity between networks with overlapping IP address spaces — one of its most architecturally significant and underappreciated properties.

### Why Overlapping CIDRs Block Other Solutions

VPC peering and Transit Gateway require non-overlapping CIDR ranges. If two VPCs both use `10.0.0.0/16`, they cannot be peered — routing is ambiguous. This is a real constraint in large organizations where independent teams have provisioned VPCs with identical CIDRs, or in acquired-company scenarios where two organizations' IP spaces collide.

### Why PrivateLink Is Unaffected

PrivateLink doesn't route between VPCs. The consumer connects to the endpoint ENI using the ENI's IP address — which is in the consumer VPC's own subnet CIDR. The producer VPC's CIDR is never seen, never advertised, and never matters. Two parties with identical CIDRs can exchange services via PrivateLink without any conflict.

This makes PrivateLink the only scalable solution for service sharing between networks with overlapping address spaces. The Resource Endpoint model extends this to resource sharing: the producer's resource IP is irrelevant to the consumer, since routing terminates at the resource gateway ENI in the producer VPC.

---

## 17. Security Controls

### Endpoint Policies

Interface Endpoints support resource-based **endpoint policies** — IAM-style JSON policies that control which principals can use the endpoint to call which APIs on which resources. Both the endpoint policy and the caller's IAM identity policy must allow the action.

An endpoint policy restricting SSM usage to the organization:

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

Resource Endpoints and Service-Network Endpoints do not currently support endpoint policies — access control for these types is managed at the RAM sharing level (who can create the endpoint) and at the application or service level.

### Security Groups on Endpoint ENIs

Every Interface, Resource, and Service-Network Endpoint ENI has a security group. Inbound rules should restrict access to the CIDR ranges of the subnets or VPCs that legitimately use the endpoint. Leaving the security group open to `0.0.0.0/0` is a common misconfiguration — while the ENI isn't internet-routable, restricting to known VPC CIDRs adds meaningful defence-in-depth.

### IAM Condition Keys

The `aws:sourceVpce` condition key requires that API calls arrive via a specific VPC endpoint. This enforces that a service can only be called through the designated private endpoint — even if credentials leak, the API call is denied unless it originates from within the designated VPC through the designated endpoint.

### SCP Guardrails

Key SCP patterns for PrivateLink governance:

- Deny creation of Interface Endpoints for non-approved service names in spoke accounts — preventing shadow endpoint sprawl.
- Deny direct access to sensitive AWS service APIs without `aws:sourceVpce` — enforcing the private endpoint path for all sensitive calls.
- Deny deletion of endpoint ENI security groups without a change process.
- Deny creation of resource gateways in accounts that should not be resource providers — limiting who can expose resources via PrivateLink.

---

## 18. Limits, Scaling & Availability

### Interface Endpoint Limits

| Limit | Default Value | Notes |
| :--- | :--- | :--- |
| Interface endpoints per VPC | 50 | Soft limit; can be raised via support |
| Endpoint connections per endpoint service | 125,000 | Per endpoint service, across all consumers |
| Availability zones per endpoint service | Up to all AZs in region | Must match NLB AZ coverage |

### Resource and Service-Network Endpoint Limits

Resource configurations, resource gateways, and service-network endpoints have their own per-account and per-region limits. In production deployments consuming many resource configurations through a service network, the number of IP addresses assigned to the service-network endpoint ENI scales in `/28` blocks per subnet as more resource configurations are associated — ensure endpoint subnets have sufficient contiguous address space.

### NLB Connection Limits

The NLB backing a custom endpoint service handles up to 55,000 simultaneous connections per minute per target (per IP target). High-throughput services should size their target pool accordingly. NLB nodes scale automatically within AWS limits, but very high connection rates should be tested before production launch.

### Availability Design

- Deploy NLBs and endpoint services across all AZs in the region — not just where the service currently runs.
- Use multiple NLB targets per AZ. A single target per AZ means a target failure in that AZ makes the service unreachable for consumers in that AZ.
- For resource configurations, ensure the resource gateway has ENIs in all AZs where consumer resource endpoints may be provisioned.
- Use aggressive health checks — unhealthy targets should be deregistered quickly.

### Cross-AZ Traffic and Cost

When an endpoint ENI in AZ-a connects to an NLB target in AZ-b, cross-AZ data transfer charges apply. The mitigation is AZ affinity: configure NLB target groups to prefer same-AZ targets. This requires sufficient target capacity in each AZ independently but eliminates most cross-AZ data transfer costs.