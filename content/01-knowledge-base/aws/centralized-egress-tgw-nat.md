# Centralized Egress — Transit Gateway & NAT Gateway

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Architecture Overview & Design Decisions](#1-architecture-overview-design-decisions) | The problems centralized egress solves, traffic flows, and architectural variants. |
| **02** | [Transit Gateway — Deep Configuration](#2-transit-gateway-deep-configuration) | Creating the TGW, sharing via RAM, route tables, and manual VPC acceptance rules. |
| **03** | [Egress VPC Design](#3-egress-vpc-design) | Designing public and TGW-only subnets, EIPs, and AZ-local NAT routing tables. |
| **04** | [NAT Gateway — Patterns & Gotchas](#4-nat-gateway-patterns-gotchas) | Limits (55k ports), critical performance metrics, and NAT instance trade-offs. |
| **05** | [TGW Routing — Advanced Patterns](#5-tgw-routing-advanced-patterns) | Route propagation vs static routing, and complete cross-account configurations. |
| **06** | [DNS Architecture for Centralized Egress](#6-dns-architecture-for-centralized-egress) | Routing spoke query traffic to outbound Route 53 resolvers in Shared Services. |
| **07** | [Security Inspection in the Egress Path](#7-security-inspection-in-the-egress-path) | Redirection paths and stateful appliance mode with AWS Network Firewall. |
| **08** | [Spoke VPC Design](#8-spoke-vpc-design) | Enforcing zero internet paths locally and bypassing endpoints for standard S3/DynamoDB. |
| **09** | [Failure Modes & Resilience](#9-failure-modes-resilience) | Failover matrices, NAT GW AZ failovers, and handling offline Network accounts. |
| **10** | [Cost Model & Optimization](#10-cost-model-optimization) | TGW/NAT base charges, data processing fees, and optimization strategies. |
| **11** | [Day-2 Operations](#11-day-2-operations) | VPC Flow Log analytics via Athena, routing troubleshooting, and quarterly review drills. |

---

## 1. Architecture Overview & Design Decisions

### What Centralized Egress Solves

Without centralized egress, every spoke account independently manages:
- NAT Gateways per AZ (minimum 2 per account in a multi-AZ setup).
- Security groups and NACLs per account.
- Egress logging per account.
- Firewall rules replicated across dozens of accounts.

At 20 accounts × 2 AZs × $0.045/hr NAT GW = ~$630/month in NAT Gateway costs alone, before data processing charges. Centralized egress collapses this to one set of NAT Gateways shared across all accounts.

### High-Level Traffic Flow

1.  **Workload Pod/EC2 (Spoke VPC):** Evaluates local route table and forwards internet traffic (`0.0.0.0/0`) to the local Transit Gateway attachment.
2.  **Transit Gateway:** Evaluates TGW route tables and forwards the outbound traffic to the Egress VPC attachment.
3.  **Egress VPC (Network Account):** Forwards the traffic through the local Availability Zone's NAT Gateway.
4.  **NAT Gateway:** Performs Source NAT, replaces the private IP with a static Elastic IP, and pushes the packets through the Internet Gateway to the public Internet.
5.  **Return Path:** The Internet routes return traffic back to the NAT Gateway Elastic IP. The Egress VPC route table maps return packets back through the TGW, which evaluates and forwards the packets back to the source Spoke VPC attachment and final destination.

### Centralized vs Distributed — The Trade-off in Full

| Dimension | Centralized Egress | Distributed (per-account NAT) |
|---|---|---|
| **Cost** | 1 set of NAT GWs, shared. | N sets × M AZs, independent. |
| **Security** | Single inspection point, consistent policy. | Policy must be replicated, easy to miss. |
| **Blast radius** | Network account outage = all egress down. | One account's NAT failure is isolated. |
| **Latency** | +TGW hop (~1ms), negligible for most. | Slightly lower latency. |
| **Operational complexity** | High initial setup, low ongoing per-account. | Low initial, grows with account count. |
| **Egress IP control** | Fixed EIPs in one place, easy allowlisting. | EIPs spread across accounts. |
| **Audit & visibility** | Centralized VPC Flow Logs, one place to query. | Logs fragmented across accounts. |
| **Bandwidth limits** | TGW: 50 Gbps per AZ; NAT GW: 45 Gbps. | NAT GW: 45 Gbps per gateway. |

> [!NOTE]
> **Decision Rule:** Centralized egress pays off when you have >5 production accounts or any compliance requirement for consistent egress policy. Below that, distributed NAT is simpler.

### Architecture Variants

*   **Variant A: TGW + NAT GW only (most common)**
    *   *Flow:* Spoke VPCs → TGW → Egress VPC → NAT GW → Internet
    *   *Use Case:* Simplest. No deep packet inspection. Use when threat detection (GuardDuty) + VPC Flow Logs is sufficient.
*   **Variant B: TGW + AWS Network Firewall + NAT GW**
    *   *Flow:* Spoke VPCs → TGW → Egress VPC → Network Firewall → NAT GW → Internet
    *   *Use Case:* Layer 7 inspection, FQDN-based egress filtering, IDS/IPS. Use for regulated workloads or when you need to whitelist specific domains.
*   **Variant C: TGW + Appliance (Palo Alto, Fortinet, Checkpoint)**
    *   *Flow:* Spoke VPCs → TGW → Inspection VPC → Firewall Appliance → Egress VPC → NAT GW → Internet
    *   *Use Case:* Full NGFW capability, existing enterprise firewall policy integration. Highest cost, highest capability.

This reference guide focuses primarily on Variant A and B — the Appliance variant follows similar routing principles with the inspection VPC added.

---

## 2. Transit Gateway — Deep Configuration

### TGW Creation in the Network Account

```hcl
resource "aws_ec2_transit_gateway" "main" {
  description = "Central TGW — hub for all spoke VPCs"

  amazon_side_asn = 64512          # Private ASN for BGP (if using DX/VPN)
                                   # Must not conflict with on-prem ASN

  auto_accept_shared_attachments  = "disable"   # CRITICAL: manual approval only
                                                # Auto-accept lets any account attach
  default_route_table_association = "disable"   # We manage route tables explicitly
  default_route_table_propagation = "disable"   # No automatic route propagation

  dns_support      = "enable"      # Enables DNS resolution across VPCs
  vpn_ecmp_support = "enable"      # Equal-cost multi-path for VPN redundancy
  multicast_support = "disable"    # Enable only if you need multicast

  tags = {
    Name        = "main-tgw"
    managed-by  = "terraform"
  }
}
```

> [!IMPORTANT]
> **Why `auto_accept_shared_attachments = disable`:** With auto-accept enabled, any account in the resource share can attach their VPC without approval. This bypasses your CIDR conflict checking and network segmentation controls. Always require explicit acceptance.

### Sharing TGW via RAM

```hcl
# Share to entire AWS Organization — new accounts inherit the share automatically
resource "aws_ram_resource_share" "tgw" {
  name                      = "tgw-org-share"
  allow_external_principals = false    # Org-only, no external AWS accounts
}

resource "aws_ram_resource_association" "tgw" {
  resource_arn       = aws_ec2_transit_gateway.main.arn
  resource_share_arn = aws_ram_resource_share.tgw.arn
}

resource "aws_ram_principal_association" "org" {
  principal          = data.aws_organizations_organization.main.arn
  resource_share_arn = aws_ram_resource_share.tgw.arn
}
```

After sharing, spoke accounts can see the TGW and create attachments, but the attachment stays in `pendingAcceptance` state until the Network account accepts it.

### TGW Route Tables

The key to network segmentation in a centralized model is separate TGW route tables per trust tier:

```hcl
# Route table for production spokes
resource "aws_ec2_transit_gateway_route_table" "prod" {
  transit_gateway_id = aws_ec2_transit_gateway.main.id
  tags = { Name = "prod-rt" }
}

# Route table for non-production spokes
resource "aws_ec2_transit_gateway_route_table" "nonprod" {
  transit_gateway_id = aws_ec2_transit_gateway.main.id
  tags = { Name = "nonprod-rt" }
}

# Route table for the egress VPC attachment
resource "aws_ec2_transit_gateway_route_table" "egress" {
  transit_gateway_id = aws_ec2_transit_gateway.main.id
  tags = { Name = "egress-rt" }
}

# Route table for shared services (tooling, DNS, internal services)
resource "aws_ec2_transit_gateway_route_table" "shared" {
  transit_gateway_id = aws_ec2_transit_gateway.main.id
  tags = { Name = "shared-rt" }
}
```

### TGW Attachment Acceptance

```hcl
# In Network account — accept spoke attachment after CIDR validation
resource "aws_ec2_transit_gateway_vpc_attachment_accepter" "spoke" {
  transit_gateway_attachment_id = var.spoke_attachment_id   # From spoke account

  tags = {
    Name        = var.spoke_account_name
    account-id  = var.spoke_account_id
    environment = var.environment
    team        = var.team
  }
}

# Associate accepted attachment to correct route table based on environment
resource "aws_ec2_transit_gateway_route_table_association" "spoke" {
  transit_gateway_attachment_id  = var.spoke_attachment_id
  transit_gateway_route_table_id = (
    var.environment == "prod"
      ? aws_ec2_transit_gateway_route_table.prod.id
      : aws_ec2_transit_gateway_route_table.nonprod.id
  )
}
```

---

## 3. Egress VPC Design

### Subnet Layout

The Egress VPC requires careful subnet design — NAT Gateways live in public subnets; TGW attachments live in dedicated TGW subnets:

*   **Egress VPC CIDR:** `10.0.0.0/16`
*   **AZ-A (ap-southeast-1a):**
    *   *Public Subnet:* `10.0.0.0/24` (NAT Gateway + IGW Route)
    *   *TGW Subnet:* `10.0.2.0/28` (TGW Attachment ENIs only. `/28` is sufficient)
    *   *Firewall Subnet:* `10.0.4.0/24` (Network Firewall Endpoints if using Variant B)
*   **AZ-B (ap-southeast-1b):**
    *   *Public Subnet:* `10.0.1.0/24`
    *   *TGW Subnet:* `10.0.3.0/28`
    *   *Firewall Subnet:* `10.0.5.0/24`

> [!TIP]
> **Why Dedicated /28 TGW Subnets:** TGW attachment ENIs should be isolated from other resources. A `/28` subnet provides 11 usable IPs, which is more than enough for TGW ENIs (requiring exactly 1 IP per ENI per AZ). Using a larger shared subnet risks running out of IPs or having TGW ENIs conflict with other resources.

### Egress VPC Terraform

```hcl
resource "aws_vpc" "egress" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "egress-vpc" }
}

resource "aws_internet_gateway" "egress" {
  vpc_id = aws_vpc.egress.id
  tags   = { Name = "egress-igw" }
}

# Public subnets — one per AZ — NAT Gateways live here
resource "aws_subnet" "public" {
  for_each = {
    "ap-southeast-1a" = "10.0.0.0/24"
    "ap-southeast-1b" = "10.0.1.0/24"
  }

  vpc_id            = aws_vpc.egress.id
  cidr_block        = each.value
  availability_zone = each.key

  # NAT Gateway needs a public IP — do NOT set this on spoke subnets
  map_public_ip_on_launch = false   # We control EIPs explicitly via NAT GW

  tags = { Name = "egress-public-${each.key}" }
}

# TGW subnets — /28, attachment ENIs only
resource "aws_subnet" "tgw" {
  for_each = {
    "ap-southeast-1a" = "10.0.2.0/28"
    "ap-southeast-1b" = "10.0.3.0/28"
  }

  vpc_id            = aws_vpc.egress.id
  cidr_block        = each.value
  availability_zone = each.key

  tags = { Name = "egress-tgw-${each.key}" }
}

# Elastic IPs for NAT Gateways — static egress IPs
resource "aws_eip" "nat" {
  for_each = aws_subnet.public
  domain   = "vpc"
  tags     = { Name = "egress-nat-eip-${each.key}" }
}

# NAT Gateways — one per AZ
resource "aws_nat_gateway" "main" {
  for_each = aws_subnet.public

  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = each.value.id

  tags = { Name = "egress-nat-${each.key}" }

  depends_on = [aws_internet_gateway.egress]
}
```

### Route Tables in the Egress VPC

The Egress VPC requires three distinct route table behaviors:

```hcl
# 1. Public subnet route table — NAT GW points to IGW
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.egress.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.egress.id
  }

  tags = { Name = "egress-public-rt" }
}

# 2. TGW subnet route table — route to NAT GW (AZ-local)
# CRITICAL: route to NAT GW in the SAME AZ to avoid cross-AZ data transfer costs
resource "aws_route_table" "tgw_az_a" {
  vpc_id = aws_vpc.egress.id

  route {
    cidr_block           = "0.0.0.0/0"
    nat_gateway_id       = aws_nat_gateway.main["ap-southeast-1a"].id
  }

  # Return routes to spoke VPC CIDRs back through TGW
  route {
    cidr_block         = "10.0.0.0/8"    # All RFC1918 → TGW (don't NAT internal traffic)
    transit_gateway_id = aws_ec2_transit_gateway.main.id
  }

  tags = { Name = "egress-tgw-rt-az-a" }
}

resource "aws_route_table" "tgw_az_b" {
  vpc_id = aws_vpc.egress.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main["ap-southeast-1b"].id
  }

  route {
    cidr_block         = "10.0.0.0/8"
    transit_gateway_id = aws_ec2_transit_gateway.main.id
  }

  tags = { Name = "egress-tgw-rt-az-b" }
}

# Associate subnets to route tables
resource "aws_route_table_association" "tgw_az_a" {
  subnet_id      = aws_subnet.tgw["ap-southeast-1a"].id
  route_table_id = aws_route_table.tgw_az_a.id
}

resource "aws_route_table_association" "tgw_az_b" {
  subnet_id      = aws_subnet.tgw["ap-southeast-1b"].id
  route_table_id = aws_route_table.tgw_az_b.id
}
```

> [!IMPORTANT]
> **The AZ-local NAT GW rule:** Traffic entering TGW from AZ-A should exit via the NAT GW in AZ-A. If you use a single route table pointing all TGW traffic to one AZ's NAT GW, every packet crossing AZs generates a cross-AZ data transfer charge ($0.01/GB each way). At scale, this cost is significant.

---

## 4. NAT Gateway — Patterns & Gotchas

### Capacity & Limits

*   **Bandwidth:** 45 Gbps (burst).
*   **Connections:** 55,000 simultaneous connections to a single destination IP:port combination.
*   **Packets per second:** Up to 4 million PPS.
*   **Max unique flows:** No documented limit, but performance degrades beyond millions of concurrent flows.
*   **NAT Processing Cost:** $0.059 per GB (in + out, both directions).
*   **Public Data Transfer:** $0.09/GB (to public internet).
*   **Cross-AZ:** $0.01/GB (if traffic crosses AZ to reach NAT GW).

> [!WARNING]
> **The 55,000 connection limit gotcha:** Each NAT Gateway supports 55,000 simultaneous connections to the same destination IP:port combination. If one service (e.g., a Lambda fleet) hammers a single external API endpoint with thousands of concurrent connections, you will hit this limit and see `ErrorPortAllocation` errors. Resolution: spread load across multiple NAT Gateways, or use multiple outbound IPs at the application layer.

Configure CloudWatch alarms on your NAT Gateways to trigger alerts on any `ErrorPortAllocation` metrics immediately so you can identify connection limit bottlenecks before they cause service downtime.

### Critical NAT GW Metrics to Monitor

*   **ErrorPortAllocation:** Alert on `Sum >= 1`. Indicates port exhaustion (too many connections to the same destination IP:port).
*   **PacketsDropCount:** Alert on `Sum >= 100`. Packets are being dropped; possible SYN flood or capacity limit hit.
*   **ConnectionAttemptCount:** Alert on anomalous increases. Unusually high connection attempts; investigate source.
*   **BytesOutToDestination:** Alert on anomalies relative to baseline. High volume egress indicator (possible exfiltration).

### NAT Gateway vs NAT Instance Trade-off

| Feature | NAT Gateway | NAT Instance (EC2-based) |
|---|---|---|
| **Throughput** | 45 Gbps (highly elastic) | Instance-limited (c5n.18xl = 100Gbps, but costly) |
| **Availability** | Managed HA, AWS-operated | You manage failover scripts |
| **Processing Cost** | $0.059/GB | EC2 cost only, no per-GB fee |
| **Break-even Point** | ~1.5–3 TB/month (depends on instance) | Above ~3 TB/month |
| **Operational Burden** | Zero | Patching, failover scripts, monitoring |
| **Security Groups** | Not supported on NAT GW itself | Full Security Group control |
| **Recommendation** | Default choice | Consider only if egress >3 TB/month and managed by dedicated NetOps teams |

For centralized egress where the NAT GW is shared across many accounts, the volume threshold for NAT Instance break-even drops significantly. Run the numbers at your actual egress volume.

### Egress-Only Internet Gateway vs NAT Gateway

*   **NAT Gateway:** Allows IPv4 private → public internet (stateful, bidirectional per flow). Use for IPv4 egress (the standard case).
*   **Egress-Only Internet Gateway (EIGW):** Allows IPv6 private → public internet ONLY (blocks inbound IPv6 connections). Use for IPv6 egress without inbound exposure. (For dual-stack workloads, use both).

---

## 5. TGW Routing — Advanced Patterns

### Route Table Propagation vs Static Routes

*   **Propagation:** Spoke VPC CIDR is automatically added to the TGW route table when the attachment is created. Use this for spoke VPC CIDRs (automatic, less error-prone).
*   **Static Routes:** Manually defined routes in the TGW route table. Use this for default routes (`0.0.0.0/0` → Egress VPC), blackhole routes, and supernet routes to shared services.

### Full Routing Configuration

```hcl
# Egress VPC attachment
resource "aws_ec2_transit_gateway_vpc_attachment" "egress" {
  transit_gateway_id = aws_ec2_transit_gateway.main.id
  vpc_id             = aws_vpc.egress.id
  subnet_ids         = values(aws_subnet.tgw)[*].id

  # Appliance mode: required if using Network Firewall or stateful appliances
  # Ensures return traffic uses same AZ as outbound to maintain flow symmetry
  appliance_mode_support = "enable"

  transit_gateway_default_route_table_association = false
  transit_gateway_default_route_table_propagation = false

  tags = { Name = "egress-attachment" }
}

# Associate egress attachment to its own route table
resource "aws_ec2_transit_gateway_route_table_association" "egress" {
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_vpc_attachment.egress.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway_route_table.egress.id
}

# Propagate all spoke CIDRs into egress route table
# (so return traffic knows which attachment to send responses back through)
resource "aws_ec2_transit_gateway_route_table_propagation" "spokes_to_egress" {
  for_each = var.spoke_attachment_ids

  transit_gateway_attachment_id  = each.value
  transit_gateway_route_table_id = aws_ec2_transit_gateway_route_table.egress.id
}

# Prod route table: default route to egress, propagate spoke CIDRs internally
resource "aws_ec2_transit_gateway_route" "prod_default" {
  destination_cidr_block         = "0.0.0.0/0"
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_vpc_attachment.egress.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway_route_table.prod.id
}
```

---

## 6. DNS Architecture for Centralized Egress

For spokes to resolve external DNS domains without bypassing your security controls, route internal DNS requests to a centralized Route 53 Resolver endpoint.

### Architecture Topology

```
Spoke VPC EC2
  ↓ Route 53 Resolver (10.x.0.2)
Route 53 Resolver Rule (forward * to Shared Services)
  ↓ Outbound Endpoint (Shared Services VPC)
DNS Request → Public Recursive Resolver (or corporate DNS)
```

### Shared Services DNS Config

```hcl
# In Shared Services VPC — Outbound Resolver Endpoint
resource "aws_route53_resolver_endpoint" "outbound" {
  name      = "central-dns-outbound"
  direction = "OUTBOUND"

  security_group_ids = [aws_security_group.dns_outbound.id]

  ip_address {
    subnet_id = aws_subnet.shared_services_private_a.id
  }
  ip_address {
    subnet_id = aws_subnet.shared_services_private_b.id
  }
}

# Share the rules to the AWS Organization via RAM
resource "aws_ram_resource_share" "dns_rules" {
  name                      = "dns-resolver-rules-share"
  allow_external_principals = false
}

resource "aws_ram_resource_association" "rule" {
  resource_arn       = aws_route53_resolver_rule.forward_all.arn
  resource_share_arn = aws_ram_resource_share.dns_rules.arn
}
```

Spoke VPCs associate their local resolver with this shared rule, forcing all external DNS queries to resolve via the central network egress route.

---

## 7. Security Inspection in the Egress Path

To enforce strict Layer 7 controls or whitelisting on outbound traffic, deploy AWS Network Firewall into the Egress VPC path (Variant B).

### Traffic Redirection Routing

```
Outbound:
TGW Attachment Subnet → Route Table: 0.0.0.0/0 → Network Firewall Endpoint
Network Firewall Subnet → Route Table: 0.0.0.0/0 → NAT Gateway
Public Subnet → Route Table: 0.0.0.0/0 → Internet Gateway

Inbound:
Internet Gateway → Route Table: 10.0.0.0/8 (RFC1918) → Network Firewall Endpoint
Network Firewall Subnet → Route Table: 10.0.0.0/8 → Transit Gateway
```

> [!IMPORTANT]
> **Appliance Mode support must be enabled** on the Egress VPC TGW attachment. Without Appliance Mode, the TGW does not enforce flow symmetry across Availability Zones. This causes return traffic to route through a different AZ's firewall endpoint, leading to dropped stateful TCP connections.

---

## 8. Spoke VPC Design

Spoke VPC route tables should route all internet traffic through the TGW, but route internal/AWS service traffic locally to avoid NAT charges.

### Route Table Design

*   **Subnet Route Table:**
    *   `10.0.0.0/8` (RFC 1918 supernet) → local TGW attachment.
    *   `0.0.0.0/0` (default route) → local TGW attachment.
*   **VPC Endpoint Route (Gateway Endpoint):**
    *   `pl-xxxxxxxx` (S3 Prefix List) → `vpce-xxxxxxxx` (S3 Gateway Endpoint).
    *   `pl-yyyyyyyy` (DynamoDB Prefix List) → `vpce-yyyyyyyy` (DynamoDB Gateway Endpoint).

### VPC Gateway Endpoint Pattern

Enabling S3 Gateway Endpoints directly in your spoke route tables bypasses the TGW and NAT Gateway path completely, routing S3 API requests directly over the private AWS backbone for free.

```hcl
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.spoke.id
  service_name      = "com.amazonaws.ap-southeast-1.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  # Endpoint policy — restrict to your org's S3 buckets only
  policy = jsonencode({
    Statement = [{
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:*"
      Resource  = "*"
      Condition = {
        StringEquals = {
          "aws:ResourceOrgID" = data.aws_organizations_organization.main.id
        }
      }
    }]
  })
}
```

---

## 9. Failure Modes & Resilience

### Failure Scenario Matrix

| Failure | Impact | Detection | Recovery |
|---|---|---|---|
| **Single NAT GW failure** | AZ-A egress down. | CloudWatch `ErrorPortAllocation`, VPC Flow Logs. | Reroute AZ-A TGW subnet to AZ-B NAT GW (manual or automated Lambda). |
| **TGW attachment failure** | Spoke loses all connectivity. | TGW attachment state alarm. | Re-create attachment (automated via platform pipeline). |
| **Egress VPC route error** | All egress silently broken. | VPC Flow Logs showing `REJECT` on TGW traffic. | Correct the route table configuration; verify with test instance. |
| **Network account outage** | All centralized egress down. | CloudWatch cross-account alarms. | Pre-approved emergency procedure: deploy temporary distributed NAT. |
| **Network Firewall AZ failure**| AZ traffic stalls. | Network Firewall metric alarms. | Route failover to other AZ endpoint. |
| **TGW bandwidth saturation** | Packet loss across all attachments. | TGW `BytesIn`/`BytesOut` metrics. | Deploy a second TGW and re-attach spokes. (Extremely rare). |

### Egress VPC Resilience Checklist

Configure these components to guarantee high availability across your egress topology:

*   **Multi-AZ NAT Gateways:** Deploy at least 2 NAT Gateways (one per AZ) in active spoke zones.
*   **Multi-AZ TGW Attachments:** Subnets mapping TGW attachments must exist in every AZ utilized by spokes.
*   **Per-AZ Route Tables:** Enforce AZ-isolated route tables on TGW subnets to prevent cross-AZ traffic leakage.
*   **CloudWatch Anomaly Alarms:** Alert on NAT GW `ErrorPortAllocation` and `PacketsDropCount` anomalies.
*   **VPC Flow Logs:** Keep Flow Logs active across both Egress and Spoke VPC interfaces.
*   **Multi-AZ Firewall Endpoints:** Match Network Firewall endpoints across all AZs if utilizing L7 filtering.
*   **Emergency Runbooks:** Document and regularly test out-of-band disaster recovery procedures.

### The "Network Account Is Down" Scenario

This is the highest-blast-radius failure in centralized egress. Prepare for it explicitly:

1.  **Trigger:** Network account API or console is entirely inaccessible for >15 minutes.
2.  **Authorization:** VP of Engineering sign-off required (bypasses normal change management).
3.  **Action:** Deploy emergency distributed NAT Gateways directly in spoke accounts using break-glass roles.
4.  **Runbook Script:** Maintain a verified bash deployment script on a secure backup repository (e.g., `s3://internal-runbooks/emergency-distributed-nat.sh`).

---

## 10. Cost Model & Optimization

Centralized egress saves massive amounts of hourly base costs but introduces TGW processing fees. Analyze the trade-offs:

*   **NAT Gateway Hour:** $0.045/hour (~$32/month per gateway).
*   **NAT Gateway Processing:** $0.045/GB (in + out).
*   **TGW Attachment Hour:** $0.05/hour (~$36/month per attachment).
*   **TGW Processing:** $0.006/GB (one-time fee as traffic enters the TGW).

### Data Transfer Optimization

*   **Enable VPC Gateway Endpoints:** Deploy S3 and DynamoDB Gateway Endpoints in every spoke VPC. This cuts NAT and TGW processing charges to zero for your heaviest storage API traffic.
*   **Enforce AZ-Local Routing:** Ensure your spoke applications only communicate with other services inside their same AZ to bypass cross-AZ TGW transport charges ($0.01/GB each way).
*   **VPC Peering for High-Volume Channels:** If two spoke accounts pass >5 TB/month of traffic directly to one another, establish a private VPC peering connection instead of routing the traffic through the Transit Gateway to bypass TGW processing fees.

---

## 11. Day-2 Operations

### Analyzing Egress Traffic with Athena

Create an Athena table over your centralized VPC Flow Logs to query and analyze egress traffic volumes and patterns:

```sql
-- Athena: Top 20 sources of blocked traffic
SELECT
    srcaddr,
    dstaddr,
    dstport,
    protocol,
    COUNT(*) as reject_count
FROM vpc_flow_logs
WHERE
    action = 'REJECT'
    AND year = '2026' AND month = '05' AND day = '24'
GROUP BY srcaddr, dstaddr, dstport, protocol
ORDER BY reject_count DESC
LIMIT 20;

-- Athena: Egress volume by source account
SELECT
    account_id,
    SUM(bytes) / 1024 / 1024 / 1024 as egress_gb
FROM vpc_flow_logs
WHERE
    flowdirection = 'egress'
    AND dstaddr NOT LIKE '10.%'
    AND year = '2026' AND month = '05'
GROUP BY account_id
ORDER BY egress_gb DESC;
```

### Connectivity Troubleshooting Playbook

1.  **Check IP:** Verify the destination instance has no public IP assigned (correct — spoke instances should be private-only).
2.  **Verify Security Groups:** Confirm outbound `0.0.0.0/0` is explicitly permitted on the EC2 security group.
3.  **Check Subnet Routes:** Confirm the default subnet route points directly to your Transit Gateway attachment.
4.  **Confirm TGW State:** Check the spoke account's Transit Gateway attachment state; it must read `available`.
5.  **Verify Propagations:** Ensure the spoke CIDR block is actively propagated to the TGW's Egress route table in the Network account.
6.  **Check Egress VPC Routes:** Confirm the Egress VPC TGW subnets route `0.0.0.0/0` to the local NAT Gateway.
7.  **Check NAT Status:** Check that the egress NAT Gateway reads `available` in the Network account console.
8.  **Evaluate NACLs:** Confirm the public subnet NACLs in the Egress VPC allow return traffic on ephemeral ports (`1024-65535`).
9.  **Analyze logs:** Run an Athena query against the centralized Flow Log bucket to identify any `REJECT` actions in the transit path.

### Quarterly Network Review

Execute this review quarterly to optimize capacity and minimize costs:

#### Cost Analysis
- Analyze TGW data processing metrics and identify top-volume attachments.
- Query Athena to identify the accounts driving the highest NAT Gateway data processing fees.
- Verify if any spoke accounts are routing high-volume S3 or DynamoDB API traffic through the NAT Gateway instead of local gateway endpoints.
- Review inter-account traffic to identify VPC Peering candidates (any spoke pair exceeding >5 TB/month).

#### Security Audit
- Review the central Network Firewall domain allowlist and remove any stale or unneeded FQDN records.
- Query VPC Flow Log `REJECT` actions to identify anomalous outbound traffic attempts.
- Scan for unusual egress volume anomalies across accounts.
- Audit TGW attachments to ensure no unauthorized or obsolete accounts are connected.

#### Resilience Testing
- Perform a simulated NAT Gateway failure drill to verify automated failover routing logic.
- Monitor total TGW attachment counts to prevent reaching default service limits (5,000 attachments).
- Test backup failover routes (e.g., Direct Connect failover to backup site-to-site VPN).

#### Infrastructure Hygiene
- Detach and delete obsolete TGW attachments belonging to decommissioned spoke accounts.
- Audit TGW route tables and remove stale static route records.
- Conduct a security review of active Network Firewall rule sets and purge outdated permissions.
- Reconcile IPAM records and verify all active spoke VPC CIDRs are correctly logged.