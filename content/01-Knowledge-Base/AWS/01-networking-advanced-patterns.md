# AWS Networking & Connectivity — Advanced Patterns, Edge Cases & Design Decisions

> **Scope:** Multi-account, Landing Zone-aware networking patterns. Assumes Transit Gateway (TGW) as the backbone. All patterns are production-tested and include non-obvious gotchas.

---

## Table of Contents

| Section | Topic |
| :---: | :--- |
| **01** | [Centralized Egress with NAT Gateway via TGW](#1-centralized-egress-with-nat-gateway-via-tgw) |
| **02** | [Centralized VPC Endpoints (PrivateLink Hub-and-Spoke)](#2-centralized-vpc-endpoints-privatelink-hub-and-spoke) |
| **03** | [Gateway Load Balancer (GWLB)](#3-gateway-load-balancer-gwlb) |
| **04** | [DNS at Scale — Route 53 Resolver Inbound/Outbound Endpoints](#4-dns-at-scale--route-53-resolver-inboundoutbound-endpoints) |
| **05** | [Transit Gateway Inter-Region Peering & Route Table Segmentation](#5-transit-gateway-inter-region-peering--route-table-segmentation) |
| **06** | [AWS PrivateLink vs VPC Peering vs TGW — Decision Matrix](#6-aws-privatelink-vs-vpc-peering-vs-tgw--decision-matrix) |
| **07** | [VPC Sharing (Resource Access Manager) — When and Why](#7-vpc-sharing-resource-access-manager--when-and-why) |

---

## 1. Centralized Egress with NAT Gateway via TGW

### Concept

Instead of provisioning a NAT Gateway per spoke VPC, all internet-bound traffic is routed through a **central Egress VPC** via Transit Gateway. The Egress VPC owns the NAT Gateways and the Internet Gateway.

```
Spoke VPC A ──┐
Spoke VPC B ──┼──► TGW ──► Egress VPC (NAT GW + IGW) ──► Internet
Spoke VPC C ──┘
```

### Architecture

- **Egress VPC** lives in the Network/Shared Services account
- NAT Gateways sit in public subnets; TGW attachment sits in private subnets
- Spoke VPCs have a default route `0.0.0.0/0 → TGW`
- TGW route table for spokes: `0.0.0.0/0 → Egress VPC attachment`
- Egress VPC private subnet route: `0.0.0.0/0 → NAT GW`
- Egress VPC public subnet route: `0.0.0.0/0 → IGW`, return traffic back to TGW for RFC1918 ranges

### Advantages

- **Cost:** Pay for NAT GW in one place, not per VPC (significant savings at scale: 30+ spoke VPCs)
- **Visibility:** All egress flows through one point — easy to attach Network Firewall or inspection here
- **Elastic IP management:** Whitelisted IPs (for SaaS vendors, partners) are centralized
- **Auditability:** VPC Flow Logs on Egress VPC captures all outbound internet traffic

### Edge Cases & Gotchas

- **Hairpin routing problem:** Return traffic from internet enters IGW → NAT GW → must route RFC1918 back to TGW. You **must** add RFC1918 summary routes (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) in the Egress VPC public subnet route table pointing to TGW. Missing this breaks return traffic asymmetrically.
- **TGW attachment subnet sizing:** Use `/28` subnets for TGW attachments — AWS reserves IPs per AZ. If you run 3 AZs, that's 3 × `/28` attachment subnets in the Egress VPC.
- **NAT GW per AZ:** For HA, deploy one NAT GW per AZ. Traffic from TGW comes in on a specific AZ-local attachment — if you route all AZs to a single NAT GW you introduce cross-AZ data transfer costs and a single point of failure.
- **Blackhole routes:** Add blackhole routes in TGW route tables for RFC1918 ranges that don't have valid attachments, to prevent accidental route leakage.
- **Flow log gaps:** TGW flow logs and VPC flow logs are separate. You need both enabled to get full path visibility.
- **NAT GW bandwidth cap:** Each NAT GW supports up to 100 Gbps. At very high egress scale, consider multiple NAT GWs behind an NLB or split egress by environment.

### Terraform Key Resources

```hcl
# Spoke VPC default route to TGW
resource "aws_route" "spoke_default_to_tgw" {
  route_table_id         = aws_route_table.spoke_private.id
  destination_cidr_block = "0.0.0.0/0"
  transit_gateway_id     = var.tgw_id
}

# Egress VPC: return RFC1918 to TGW
resource "aws_route" "egress_rfc1918_to_tgw" {
  for_each               = toset(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"])
  route_table_id         = aws_route_table.egress_public.id
  destination_cidr_block = each.value
  transit_gateway_id     = var.tgw_id
}
```

---

## 2. Centralized VPC Endpoints (PrivateLink Hub-and-Spoke)

### Concept

Rather than creating VPC Interface Endpoints (ENIs) in every spoke VPC, a **central Shared Services VPC** hosts the endpoints and shares them via TGW + DNS forwarding.

```
Spoke VPC A ──┐
Spoke VPC B ──┼──► TGW ──► Shared Services VPC ──► Interface Endpoint ──► AWS Service
Spoke VPC C ──┘                  (hosts endpoints)       (e.g. S3, ECR, SSM)
```

### Why This Matters

- Interface Endpoints cost **$0.01/hour per AZ per endpoint** — at 3 AZs × 20 services × 50 VPCs = $30,000+/month if deployed per-VPC
- Centralized = 3 AZs × 20 services = ~$432/month

### Architecture Details

- Endpoint ENIs live in the Shared Services VPC, in dedicated `/28` endpoint subnets per AZ
- **Private DNS is DISABLED** on the endpoint (critical — see gotcha below)
- Each spoke VPC has a Route 53 **forwarding rule** for the service FQDN (e.g. `ssm.ap-southeast-1.amazonaws.com`) pointing to the Shared Services VPC resolver endpoint IP
- DNS query from spoke → Route 53 Resolver → forwarding rule → Shared Services resolver → endpoint private IP returned → traffic flows over TGW

### Enabling Private DNS Without Enabling It on the Endpoint

Private DNS on the endpoint (`enable_dns` = true) only works if the endpoint is in the same VPC as the consumer. For cross-VPC, you replicate the behavior manually:

1. Create the endpoint with `private_dns_enabled = false`
2. Note the endpoint's DNS name (e.g. `vpce-xxx.ssm.ap-southeast-1.vpce.amazonaws.com`)
3. Create a **private hosted zone** in Route 53 for `ssm.ap-southeast-1.amazonaws.com`
4. Add an `A` alias or CNAME record pointing to the endpoint DNS
5. Associate the hosted zone with all spoke VPCs

Alternatively (and more scalable): use **Route 53 Resolver forwarding rules** shared via RAM.

### S3 and DynamoDB — Gateway Endpoints Are Different

- S3 and DynamoDB use **Gateway Endpoints**, not Interface Endpoints
- Gateway Endpoints are free and inject routes into VPC route tables
- They **do not traverse TGW** — they must be created per VPC
- Do not try to centralize Gateway Endpoints; it does not work

### Edge Cases & Gotchas

- **`enable_dns_hostnames` and `enable_dns_support` must be `true`** in the Shared Services VPC — endpoints rely on Route 53 resolver being active
- **Security Group on endpoint ENI:** The endpoint SG must allow HTTPS (443) inbound from the TGW CIDR range or spoke VPC CIDRs, not just local VPC CIDR
- **Endpoint policies:** You can scope what actions/principals are allowed via endpoint policy — easy to over-restrict and break SSM Agent, ECR pulls, etc. Start permissive, tighten later
- **ECR endpoint dependency chain:** ECR image pulls require **three** endpoints: `ecr.api`, `ecr.dkr`, and `s3` (for layer data). Missing the S3 Gateway Endpoint in the spoke breaks ECR pulls silently
- **SSM Session Manager** requires: `ssm`, `ssmmessages`, `ec2messages` endpoints — all three
- **Cross-AZ traffic costs:** If a spoke VPC in AZ-a routes to an endpoint ENI in AZ-b, you pay $0.01/GB cross-AZ. For high-throughput services, create endpoint ENIs in each AZ and use latency-based DNS or AZ-aware routing

### Terraform Pattern

```hcl
resource "aws_vpc_endpoint" "ssm" {
  vpc_id              = aws_vpc.shared_services.id
  service_name        = "com.amazonaws.${var.region}.ssm"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.endpoint[*].id
  security_group_ids  = [aws_security_group.endpoint.id]
  private_dns_enabled = false  # MUST be false for cross-VPC pattern

  tags = { Name = "central-ssm-endpoint" }
}

# Route 53 private hosted zone for spoke VPCs
resource "aws_route53_zone" "ssm" {
  name = "ssm.${var.region}.amazonaws.com"
  vpc { vpc_id = aws_vpc.shared_services.id }
}

resource "aws_route53_record" "ssm" {
  zone_id = aws_route53_zone.ssm.zone_id
  name    = "ssm.${var.region}.amazonaws.com"
  type    = "A"
  alias {
    name                   = aws_vpc_endpoint.ssm.dns_entry[0].dns_name
    zone_id                = aws_vpc_endpoint.ssm.dns_entry[0].hosted_zone_id
    evaluate_target_health = true
  }
}
```

---

## 3. Gateway Load Balancer (GWLB)

### Concept

GWLB enables **transparent, inline traffic inspection** by third-party virtual appliances (firewalls, IDS/IPS) without requiring source/destination NAT or changes to application routing. Uses **GENEVE encapsulation** (UDP/6081) to preserve original packet headers.

```
Client ──► IGW ──► GWLB ──► Appliance (Palo Alto / Fortinet / Suricata)
                      ▲               │
                      └───────────────┘ (inspected traffic returned)
                             │
                         Application
```

### How It Works

- GWLB presents a single IP to the route table as a **VPC Endpoint (GWLBE)**
- Traffic hits the GWLBE, gets tunneled (GENEVE) to an appliance target group
- Appliance inspects, allows/blocks, returns traffic back to GWLB
- GWLB forwards to the original destination
- From the application's perspective: completely transparent

### Deployment Models

**Centralized (recommended):**
```
Spoke VPCs ──► TGW ──► Inspection VPC (GWLB + Appliances) ──► Egress VPC ──► Internet
```

**Distributed (per-VPC):**
```
App VPC: IGW ──► GWLBE ──► GWLB (in same or different VPC) ──► Appliance
```

Centralized is more cost-efficient; distributed gives per-VPC isolation.

### GWLB vs Network Firewall

| Feature | GWLB | AWS Network Firewall |
|---|---|---|
| Appliance | Third-party (your choice) | AWS-managed (Suricata rules) |
| Protocol support | Any (L3/L4) | TCP, UDP, HTTP/S |
| Deep packet inspection | Appliance-dependent | Yes (stateful) |
| Cost model | Pay for appliance EC2 + GWLB hours | Per GB + endpoint hours |
| Operational overhead | High (you manage appliances) | Low |
| Use case | Compliance requiring specific vendor | General AWS-native inspection |

### Edge Cases & Gotchas

- **Flow stickiness:** GWLB uses 5-tuple hashing to stick flows to the same appliance. If an appliance fails mid-flow, the flow is re-hashed — stateful appliances may drop the connection. Use connection draining carefully.
- **GENEVE overhead:** The GENEVE tunnel adds ~50 bytes per packet. Factor this into MTU sizing — set appliance network interfaces MTU to 8500 (Jumbo frames) to avoid fragmentation.
- **Asymmetric routing breaks inspection:** Inbound and outbound flows for the same session must hit the same appliance instance. GWLB handles this with flow affinity, but if you have multiple GWLBs or split inspection paths, you'll get asymmetric flows that stateful appliances will drop.
- **Health checks:** GWLB uses TCP health checks to appliances. If your appliance firewall policy blocks the health check port, targets go unhealthy and traffic blackholes silently.
- **TGW + GWLB integration:** When using TGW appliance mode, enable **TGW Appliance Mode** on the inspection VPC attachment — this pins both directions of a flow to the same AZ, preventing asymmetric routing across AZs through TGW.

---

## 4. DNS at Scale — Route 53 Resolver Inbound/Outbound Endpoints

### Concept

Route 53 Resolver is the VPC-local DNS resolver (169.254.169.253 / VPC+2 address). For hybrid environments or multi-account setups, **Resolver Endpoints** extend DNS resolution across boundaries.

```
On-Premises ──► Inbound Endpoint (ENIs in VPC) ──► Route 53 Resolver ──► Private Hosted Zones
                                                                        ──► AWS Service FQDNs

VPC ──► Outbound Endpoint ──► Forwarding Rule ──► On-Premises DNS ──► corp.internal zones
```

### Inbound Endpoint

- AWS-provisioned ENIs in your VPC that accept DNS queries **from outside** (on-prem, other VPCs via TGW)
- On-prem DNS conditionally forwards `*.aws.internal`, `*.amazonaws.com` to these IPs
- Inbound endpoint IPs are **stable** — safe to hardcode in on-prem forwarders
- Requires SG allowing UDP/TCP 53 from on-prem IP ranges

### Outbound Endpoint

- ENIs that **originate** DNS queries from the VPC toward external resolvers
- Paired with **Resolver Rules** (forwarding rules) that match a domain and send to a target IP
- Example: queries for `corp.internal` → forward to `10.0.0.53` (on-prem DNS)
- Rules are shared across accounts via **RAM** — create once in Network account, share to all spoke accounts

### Centralized DNS Architecture (Multi-Account)

```
Network Account
  └── Route 53 Resolver
        ├── Inbound Endpoint (for on-prem → AWS resolution)
        ├── Outbound Endpoint (for AWS → on-prem resolution)
        ├── Forwarding Rules shared via RAM
        └── Private Hosted Zones associated to Shared Services VPC
              └── VPC associations to spoke VPCs (cross-account)
```

### Edge Cases & Gotchas

- **Inbound endpoint AZ redundancy:** Deploy at least 2 ENIs in different AZs. Each ENI gets its own IP — give on-prem DNS both IPs for failover.
- **Route 53 Resolver rule priority:** The most specific rule wins. `corp.internal` takes precedence over `.internal`. System rules (`.amazonaws.com`, `.internal`) always take precedence over custom rules — you cannot override them.
- **PHZ association limit:** A private hosted zone can be associated with up to 300 VPCs by default. For large organizations, use a centralized DNS VPC and resolver forwarding instead of direct associations.
- **Split-horizon DNS:** If you need `api.example.com` to resolve differently inside AWS vs on-prem, create a private hosted zone for `api.example.com` and associate it only with AWS VPCs. Public DNS remains unchanged.
- **Cross-account PHZ association:** Associating a PHZ from Account A with a VPC in Account B requires a CLI/SDK call — the console doesn't support this. It's a two-step process: authorize from the PHZ account, then create the association from the VPC account.
- **Endpoint query rate limits:** Each resolver endpoint supports 10,000 queries/second/IP. For very high DNS query rates, deploy multiple IPs per endpoint.
- **TTL matters:** Low TTLs on service discovery records + high query volumes = high Route 53 costs. Tune TTLs for internal service records to 60–300s.

### Terraform Pattern

```hcl
resource "aws_route53_resolver_endpoint" "outbound" {
  name      = "central-outbound"
  direction = "OUTBOUND"
  security_group_ids = [aws_security_group.resolver.id]

  ip_address { subnet_id = aws_subnet.resolver_az1.id }
  ip_address { subnet_id = aws_subnet.resolver_az2.id }
}

resource "aws_route53_resolver_rule" "on_prem" {
  domain_name          = "corp.internal"
  name                 = "forward-to-onprem"
  rule_type            = "FORWARD"
  resolver_endpoint_id = aws_route53_resolver_endpoint.outbound.id

  target_ip { ip = "10.0.0.53" }
  target_ip { ip = "10.0.0.54" }
}

resource "aws_ram_resource_share" "resolver_rules" {
  name                      = "resolver-rules-share"
  allow_external_principals = false
}

resource "aws_ram_resource_association" "rule" {
  resource_arn       = aws_route53_resolver_rule.on_prem.arn
  resource_share_arn = aws_ram_resource_share.resolver_rules.arn
}
```

---

## 5. Transit Gateway Inter-Region Peering & Route Table Segmentation

### Route Table Segmentation (Isolation Model)

TGW route tables enable **traffic segmentation** without separate TGWs. Common models:

**Full mesh (default — avoid at scale):**
- One route table, all attachments associate and propagate
- Every VPC can reach every other VPC — no segmentation

**Segmented model (recommended):**

```
Route Table: Production
  ├── Associates: Prod VPCs, Egress VPC
  └── Propagates: Prod VPCs only → 0.0.0.0/0 static to Egress

Route Table: Non-Production
  ├── Associates: Dev/Staging VPCs, Egress VPC
  └── Propagates: Dev/Staging VPCs only → 0.0.0.0/0 static to Egress

Route Table: Shared Services
  ├── Associates: Shared Services VPC
  └── Propagates: ALL VPCs (shared services must be reachable by all)
```

This prevents Dev → Prod lateral movement while allowing all to reach shared services and egress.

**Inspection model (with Network Firewall or GWLB):**
```
Route Table: Pre-Inspection
  └── 0.0.0.0/0 → Inspection VPC attachment

Route Table: Post-Inspection
  └── Routes to spoke VPCs after passing inspection
```

### Inter-Region Peering

TGW peering connects two TGWs across regions. Key properties:

- **Static routes only** — no route propagation across peering. You must manually add routes on both sides.
- **Encrypted by default** — traffic traverses the AWS backbone, encrypted.
- **Bandwidth:** No dedicated bandwidth limit per peering; constrained by underlying infrastructure.
- **Latency:** Same as standard inter-region latency — no optimization.

```
us-east-1 TGW ◄──── Peering Attachment ────► ap-southeast-1 TGW
  Route Table:                                 Route Table:
  10.20.0.0/16 → peering                      10.10.0.0/16 → peering
```

### Edge Cases & Gotchas

- **Propagation vs static routes:** Propagation populates routes automatically from attachments. Static routes take precedence over propagated routes for the same prefix. Use statics for Egress (`0.0.0.0/0`) and blackholes.
- **Overlapping CIDRs:** TGW will install only one route if two attachments advertise the same CIDR — the other is silently dropped. Enforce non-overlapping VPC CIDRs via SCP before this becomes a problem.
- **TGW attachment in the wrong route table:** A misconfigured association (VPC attached to wrong RT) is a silent misconfiguration — traffic just doesn't flow. Always verify association + propagation separately.
- **Inter-region peering is not transitive:** Traffic from region A cannot transit region B's TGW to reach region C. You need a direct peering between A and C.
- **ECMP across peering:** TGW supports ECMP (Equal Cost Multi-Path) for VPN attachments but **not** for peering attachments. Don't rely on ECMP for peering-based redundancy.
- **Route table limits:** Default limit is 10,000 routes per TGW route table. Large environments with many /32 propagated routes (e.g., from Direct Connect) can hit this — request a limit increase proactively.
- **Blackhole routes are your friend:** For any CIDR range allocated to your org but not yet deployed, add a blackhole static route in TGW route tables. This prevents traffic from leaking out via the default route.

### TGW Limits Worth Knowing

| Limit | Default |
|---|---|
| VPC attachments per TGW | 5,000 |
| Route tables per TGW | 20 |
| Routes per route table | 10,000 |
| Peering attachments per TGW | 50 |
| Bandwidth per VPC attachment | 50 Gbps |

---

## 6. AWS PrivateLink vs VPC Peering vs TGW — Decision Matrix

### Quick Reference

| Criteria | PrivateLink | VPC Peering | Transit Gateway |
|---|---|---|---|
| **Traffic direction** | One-way (consumer → service) | Bidirectional | Bidirectional |
| **Overlapping CIDRs** | ✅ Supported | ❌ Not supported | ❌ Not supported |
| **Transitive routing** | N/A | ❌ Not supported | ✅ Supported |
| **Cross-account** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Cross-region** | ✅ Yes (inter-region PrivateLink) | ✅ Yes (inter-region peering) | ✅ Yes (TGW peering) |
| **Scale** | Per-service | Per-pair (mesh complexity) | Hub-and-spoke |
| **Cost** | Endpoint hours + per GB | Free (just data transfer) | Attachment hours + per GB |
| **Bandwidth** | 10 Gbps per AZ per endpoint | Up to 50 Gbps | 50 Gbps per attachment |
| **DNS** | Private DNS via endpoint | Requires custom DNS | Requires custom DNS |
| **Use case** | Expose a service to many consumers | Simple 1:1 or few VPC connectivity | Many VPC, hub-and-spoke, centralized routing |

### When to Use PrivateLink

- Exposing a **service** (not a full network) to external consumers/tenants
- Consumer and provider have **overlapping CIDRs**
- You want **provider-controlled access** (NLB-fronted, endpoint policy)
- SaaS model: one provider, many consumers across accounts/orgs
- Example: expose an internal API, RDS Proxy, or ALB to partner accounts

### When to Use VPC Peering

- Simple, **low-VPC-count** connectivity (< 5 VPC pairs)
- You need **lowest latency** with no per-GB TGW charge
- Both VPCs are in the same region (or you're OK with inter-region peering)
- Traffic is **high-volume and bidirectional** where TGW per-GB charges would add up
- Example: application VPC ↔ data VPC, tightly coupled workloads

### When to Use TGW

- **Many VPCs** (5+) needing any-to-any or segmented connectivity
- **Centralized routing** (egress, inspection, shared services)
- **On-premises connectivity** — TGW integrates with Direct Connect Gateway and VPN natively
- You need **route table segmentation** (prod/non-prod isolation)
- Multi-region with inter-region peering

### Common Anti-Patterns

- **VPC Peering mesh at scale:** N VPCs require N×(N-1)/2 peering connections. At 20 VPCs = 190 peerings. Use TGW instead.
- **PrivateLink for full network access:** PrivateLink is for service exposure, not network connectivity. If you need to access multiple services in a VPC, use peering or TGW.
- **TGW for 2 VPCs:** Overkill. Peering is simpler and cheaper for simple pairs.

---

## 7. VPC Sharing (Resource Access Manager) — When and Why

### Concept

VPC Sharing allows a **owner account** to share subnets with **participant accounts** within the same AWS Organization. Participants can deploy resources (EC2, RDS, ECS, Lambda, etc.) into subnets they don't own.

```
Network Account (VPC Owner)
  └── VPC: 10.0.0.0/16
        ├── Subnet A (10.0.1.0/24) ──► shared to ──► App Account A
        ├── Subnet B (10.0.2.0/24) ──► shared to ──► App Account B
        └── Subnet C (10.0.3.0/24) ──► shared to ──► Database Account
```

### Key Properties

- Participants **see and use** the subnet but cannot modify it (no route table changes, no NACL changes)
- Resources deployed by participants are **billed to the participant account**
- Security Groups created by participants are usable only within their own account
- ENIs created in shared subnets are owned by the participant, visible to the owner
- Works with: EC2, RDS, ECS, Lambda (in VPC), ELB, EKS nodes

### Advantages

- **Fewer VPCs:** Reduce VPC sprawl — multiple teams share one VPC without a TGW hop
- **No TGW cost:** Resources in the same VPC communicate without TGW data processing charges
- **Simplified networking:** No inter-VPC routing, no TGW route tables to manage for intra-environment traffic
- **Centralized network control:** Network team owns VPC, subnets, NACLs, route tables; app teams own their resources

### VPC Sharing vs TGW — Choosing the Right Model

| Factor | VPC Sharing | TGW Hub-and-Spoke |
|---|---|---|
| Network blast radius | Larger (all in one VPC) | Smaller (isolated VPCs) |
| Cost | Lower (no TGW per-GB) | Higher (TGW attachment + per GB) |
| Security isolation | NACL + SG only | VPC boundary + SG |
| Compliance requirements | May be insufficient for strict isolation | Better for PCI, HIPAA workload separation |
| Operational model | Centralized (network team controls) | Delegated (each team owns VPC) |
| Scale | Up to 200 subnets per VPC shared | Thousands of VPCs |

### Edge Cases & Gotchas

- **Security Group referencing across accounts:** A participant in Account A cannot reference a SG created by Account B in the same shared subnet — they can only reference SGs within their own account. For cross-account SG rules, you must use CIDR-based rules.
- **NACLs are owner-controlled:** Participants cannot modify NACLs. If a NACL blocks traffic, the participant has no self-service recourse — creates a dependency on the network team.
- **Resource limits apply per account:** EC2 limits, EIP limits, etc. apply per participant account, not the VPC owner. But subnet IP space is shared — a participant depleting a subnet's IPs affects everyone.
- **Prefix delegation (EKS):** When using VPC CNI with prefix delegation in a shared subnet, the ENI prefix reservations are made by the participant account. Plan IP space generously.
- **RAM sharing requires Organization membership:** VPC sharing via RAM only works within an AWS Organization. Cross-org sharing is not supported.
- **Unsharing a subnet:** If you remove a subnet share while participant resources exist in it, those resources continue to run but the participant can no longer create new resources. Existing resources are not deleted — but they lose the ability to be replaced in the same subnet.
- **Route table changes affect all:** Adding or removing routes in the shared VPC affects all participants simultaneously. Change management on the network account's route tables must account for all tenants.

### Terraform Pattern

```hcl
resource "aws_ram_resource_share" "vpc_share" {
  name                      = "shared-vpc-subnets"
  allow_external_principals = false
}

resource "aws_ram_resource_association" "subnet_a" {
  resource_arn       = aws_subnet.app_a.arn
  resource_share_arn = aws_ram_resource_share.vpc_share.arn
}

resource "aws_ram_principal_association" "app_account_a" {
  principal          = "arn:aws:organizations::${var.org_id}:account/${var.app_account_id}"
  resource_share_arn = aws_ram_resource_share.vpc_share.arn
}
```

---

## Quick Reference — Common Networking Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| NAT GW per spoke VPC | Cost explosion at scale | Centralized Egress via TGW |
| VPC Endpoint per spoke VPC | Interface endpoint cost × VPC count | Centralized endpoints in Shared Services VPC |
| VPC Peering mesh (10+ VPCs) | N×(N-1)/2 complexity | Replace with TGW |
| No blackhole routes in TGW | Unintended route leakage | Add blackholes for all allocated-but-undeployed CIDRs |
| Private DNS enabled on cross-VPC endpoint | Only works in owner VPC | Disable private DNS, use PHZ or forwarding rules |
| On-prem DNS hardcoded to VPC+2 | Doesn't work cross-VPC/account | Use Route 53 Resolver inbound endpoint IPs |
| Single AZ NAT GW | AZ failure = full egress outage | One NAT GW per AZ |
| Overlapping VPC CIDRs | TGW route conflicts, peering impossible | Enforce CIDR allocation via SCP + IPAM |
| TGW without route table segmentation | Prod/non-prod flat network | Segment by environment with separate route tables |
| Missing ECR/S3 endpoint trio | ECR pulls fail in private subnets | Deploy ecr.api + ecr.dkr + S3 Gateway Endpoint |

---
