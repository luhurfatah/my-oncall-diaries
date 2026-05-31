# Egress Inspection with AWS Gateway Load Balancer

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Fundamentals & Use Case Landscape](#1-fundamentals-use-case-landscape) | What GWLB is, what inspection problems it solves, and when not to use it. |
| **02** | [GWLB Architecture Internals](#2-gwlb-architecture-internals) | Geneve encapsulation, endpoint mechanics, flow symmetry guarantees, and health check behavior. |
| **03** | [Centralized vs Distributed Inspection](#3-centralized-vs-distributed-inspection) | Hub-and-spoke vs per-VPC appliance models — full trade-off comparison with routing diagrams. |
| **04** | [Routing Design](#4-routing-design) | Ingress routing, VPC route tables, Transit Gateway integration, and the hairpin pattern. |
| **05** | [Appliance Integration](#5-appliance-integration) | Vendor appliance requirements, Geneve support, health check configuration, and scaling. |
| **06** | [Auto Scaling Appliance Fleets](#6-auto-scaling-appliance-fleets) | Target group registration, scale-out triggers, connection draining, and warm pool strategy. |
| **07** | [TLS Inspection](#7-tls-inspection) | Bumping vs passthrough, certificate authority deployment, OCSP/CRL, and browser trust. |
| **08** | [Multi-Account & Multi-Region](#8-multi-account-multi-region) | GWLB endpoint sharing via PrivateLink, cross-account trust, and multi-region HA patterns. |
| **09** | [Failure Modes & Blast Radius](#9-failure-modes-blast-radius) | What breaks when an appliance fails, AZ affinity behavior, and fail-open vs fail-closed design. |
| **10** | [Operational Runbooks](#10-operational-runbooks) | Traffic blackhole diagnosis, appliance replacement, emergency bypass, health check failures. |
| **11** | [Observability](#11-observability) | VPC Flow Logs with GWLB, appliance metrics, CloudWatch alarms, and traffic analytics. |
| **12** | [Cost Model](#12-cost-model) | GWLB endpoint pricing, data processing cost, appliance licensing, and cost vs security trade-off. |
| **13** | [Alternatives & Trade-offs](#13-alternatives-trade-offs) | GWLB vs NAT GW + NACLs vs AWS Network Firewall vs proxy-based egress vs Security Groups. |
| **14** | [Day-2 Ops Checklist](#14-day-2-ops-checklist) | Weekly hygiene, appliance patching without downtime, quarterly threat model review. |

---

## 1. Fundamentals & Use Case Landscape

### What Gateway Load Balancer Is

AWS Gateway Load Balancer is a transparent Layer 3/4 load balancer purpose-built for inline traffic inspection. "Transparent" means the source and destination IP addresses are preserved end-to-end — the appliance sees the original packet, not a proxied copy. The traffic path is: packet leaves a workload VPC → routed to a GWLB endpoint → GWLB encapsulates the packet in Geneve and forwards it to an appliance → appliance inspects and returns the packet → GWLB decapsulates and forwards to the original destination.

GWLB operates at Layer 3 using the Geneve protocol (UDP/6081) for encapsulation. It is not a proxy — it does not terminate TCP connections. This distinguishes it fundamentally from a proxy-based approach (Squid, Zscaler) where the appliance opens a new connection on behalf of the workload.

### Problems GWLB Solves

Prior to GWLB (launched November 2020), inserting a virtual appliance into an AWS traffic path required NAT, policy-based routing hacks, or source IP rewriting — all of which broke the original packet's addressing. The alternatives were either a proxy (which breaks non-HTTP traffic and requires workload-side configuration) or AWS Network Firewall (which is Suricata-based and limited to stateful rule sets).

GWLB solves the transparent inline inspection problem cleanly. Key use cases:

| Use Case | Description |
| :--- | :--- |
| **Egress IDS/IPS** | Inspect all outbound internet traffic for malware, C2 beaconing, data exfiltration |
| **DPI / protocol visibility** | Deep packet inspection for compliance (PCI-DSS, HIPAA) requiring full packet capture or protocol-level analytics |
| **TLS decryption + inspection** | Decrypt HTTPS, inspect payload, re-encrypt before forwarding |
| **Third-party NGFW enforcement** | Route traffic through Palo Alto, Fortinet, Check Point, or Cisco appliances already standardized in your organization |
| **Egress DNS inspection** | Force DNS through an inspecting resolver for DNS-over-HTTPS stripping or domain category filtering |

### When *Not* to Use GWLB

GWLB adds latency, cost, and operational complexity. It is the wrong choice in several situations:

| Situation | Better Approach |
| :--- | :--- |
| You only need IP-level allow/deny | AWS Network Firewall or Security Groups + NACLs — far simpler |
| You only need outbound FQDN filtering | AWS Network Firewall with domain list rules or Route 53 Resolver DNS Firewall |
| You need HTTP proxy with user authentication | Explicit proxy (Squid, Zscaler, Netskope) — GWLB cannot tie connections to IAM identities |
| Your workloads are Lambda or Fargate in VPC | GWLB adds complexity that is disproportionate; evaluate Network Firewall first |
| You are inspecting < 100 Mbps total egress | The operational overhead of GWLB + appliances exceeds the benefit at small scale |
| You need east-west inspection within a VPC | Security Groups + Traffic Mirroring or a dedicated inspection VPC with TGW |

---

## 2. GWLB Architecture Internals

### The Geneve Encapsulation Model

GWLB uses the Generic Network Virtualization Encapsulation (Geneve) protocol on UDP port 6081. When a packet arrives at the GWLB, it is wrapped in a Geneve header and forwarded to an appliance in the target group. The Geneve header carries the original source and destination IPs, MAC addresses, and GWLB-specific metadata (including the flow cookie used to maintain stickiness).

The appliance must:
- Listen on UDP/6081
- Strip the Geneve header to access the inner packet
- Inspect the inner packet
- Re-wrap in Geneve
- Return the packet to the GWLB on the same UDP/6081 port

The GWLB then decapsulates and forwards to the original destination. From the workload and destination's perspective, this is entirely invisible — they see direct source/destination addressing.

### GWLB Endpoints vs the GWLB Itself

This distinction causes significant confusion in initial deployments:

- **The GWLB** lives in the **inspection VPC** (also called the security VPC or firewall VPC). It is a regional resource that load-balances traffic across your appliance fleet.
- **GWLB Endpoints** live in **spoke VPCs** (or a centralized egress VPC). They are PrivateLink-based interface endpoints. Traffic is routed *to* a GWLB endpoint using VPC route table entries, then the endpoint forwards traffic to the GWLB over the AWS backbone.

You can have one GWLB serving hundreds of GWLB endpoints across many VPCs and accounts. The GWLB endpoint is an ENI in a specific subnet; you route to it by its ID in route table entries.

### Flow Symmetry

GWLB maintains strict flow symmetry: both directions of a given TCP/UDP flow are always sent to the same appliance instance. This is critical for stateful inspection — if the SYN goes to appliance A and the SYN-ACK goes to appliance B, a stateful firewall will drop the SYN-ACK.

GWLB achieves symmetry using a 5-tuple hash (source IP, destination IP, source port, destination port, protocol) that is consistent for the lifetime of the flow. The flow cookie embedded in the Geneve header carries this binding.

**Implication:** You cannot use GWLB with appliances that do not support Geneve encapsulation. An appliance that strips Geneve and returns a raw packet will break the flow symmetry mechanism. Always verify Geneve support in your appliance vendor's documentation before procurement.

### Health Checks

GWLB uses TCP or HTTP health checks against each appliance instance. Default configuration:
- Protocol: TCP
- Port: 80 (configurable)
- Healthy threshold: 3 consecutive successes
- Unhealthy threshold: 3 consecutive failures
- Interval: 30 seconds

When an appliance fails health checks, it is removed from the GWLB target group. Existing flows that were pinned to that appliance are **dropped** — GWLB does not migrate existing flows to healthy appliances. New flows are distributed only to healthy appliances.

This is the core failure behavior to plan around. See [Section 9](#9-failure-modes--blast-radius) for full failure mode analysis.

### Connection Draining

When you deregister an appliance from the GWLB target group (for a maintenance window or scaling event), GWLB supports connection draining. During the draining period, GWLB stops sending new flows to the deregistering instance but allows existing flows to complete. Default draining timeout is 300 seconds (5 minutes). Set this to match your longest-lived connection type — for a database over TLS, 300 seconds is usually sufficient; for long-lived SSH sessions, increase to 900 seconds.

---

## 3. Centralized vs Distributed Inspection

### Model A: Centralized Inspection (Hub-and-Spoke)

All egress traffic from all spoke VPCs is funneled through a central **inspection VPC** before reaching the internet. The inspection VPC hosts the GWLB and the appliance fleet. Spoke VPCs reach the internet only via the inspection VPC.

Traffic path:
```
Workload (spoke VPC)
  → TGW attachment
  → TGW Inspection route table → Inspection VPC
  → GWLB Endpoint
  → GWLB → Appliance fleet (inspect)
  → GWLB → GWLB Endpoint
  → NAT Gateway (in inspection VPC)
  → Internet Gateway
  → Internet
```

**Trade-offs:**

| Factor | Centralized |
| :--- | :--- |
| Appliance count | One fleet for all traffic — lower appliance cost and management overhead |
| Failure blast radius | All egress breaks if the inspection VPC is misconfigured |
| Latency | One extra TGW hop + GWLB processing (~1–3 ms typically) |
| Visibility | Single pane of glass for all egress flows |
| Cost | One set of GWLB endpoints; TGW data processing charges apply for cross-VPC traffic |
| Compliance | Easier to demonstrate all egress is inspected |

### Model B: Distributed Inspection (Per-VPC)

Each VPC has its own GWLB endpoint connected to a shared or per-environment GWLB. Traffic does not leave the VPC boundary before inspection.

Traffic path:
```
Workload subnet
  → Route to GWLB endpoint (in same VPC)
  → GWLB → Appliance fleet (in inspection VPC, shared)
  → GWLB → GWLB endpoint
  → NAT Gateway (in same spoke VPC)
  → Internet Gateway
  → Internet
```

**Trade-offs:**

| Factor | Distributed |
| :--- | :--- |
| Appliance count | Still one shared fleet (GWLB endpoints in each VPC, one GWLB) |
| Failure blast radius | Isolated per VPC — a misconfigured route table affects one VPC |
| Latency | Lower — no TGW hop |
| Cost | More GWLB endpoints (one per AZ per VPC); more NAT Gateways |
| Complexity | More route tables to manage; harder to enforce universally |
| Compliance | Harder to prove: each VPC must be independently validated |

### Choosing Between Models

The dominant factor is whether you have a centralized egress VPC already. If you are building on top of a Transit Gateway hub-and-spoke architecture with centralized NAT (the recommended pattern for multi-account environments), **centralized inspection is the natural fit** and is operationally simpler.

Distributed inspection makes sense when:
- VPCs have hard latency requirements that cannot absorb the TGW hop.
- Regulatory requirements mandate traffic not leave a VPC boundary before inspection.
- You are retrofitting inspection into a flat, non-TGW architecture where centralization is not practical.

---

## 4. Routing Design

### The Core Routing Problem

GWLB inspection requires **ingress routing** — a VPC routing feature that lets you route traffic based on the destination before it reaches the target resource. Without ingress routing, you cannot intercept traffic coming *back into* a VPC from the internet for inspection on the return path.

AWS introduced ingress routing specifically for this use case. An **ingress route table** is associated with an Internet Gateway or Virtual Private Gateway, and its routes redirect traffic destined for specific subnets to a GWLB endpoint first.

### Centralized Inspection Routing Tables

In the centralized model, the critical route tables are:

**TGW Route Table — spoke attachments:**
All spoke VPC routes point to the inspection VPC TGW attachment for 0.0.0.0/0.

**TGW Route Table — inspection VPC attachment:**
Routes back to spoke VPCs go directly to their TGW attachments (no re-inspection of return traffic through GWLB — that would double-inspect).

**Inspection VPC — firewall subnet route table:**
- `0.0.0.0/0` → GWLB Endpoint (sends egress traffic to inspection)
- Spoke VPC CIDRs → TGW (return traffic goes back to spokes)

**Inspection VPC — NAT Gateway subnet route table:**
- `0.0.0.0/0` → Internet Gateway
- Spoke VPC CIDRs → TGW

**Inspection VPC — Internet Gateway ingress route table:**
- Spoke VPC CIDRs → GWLB Endpoint (return traffic from internet is inspected before going back to spokes)

### The Hairpin (Return Path) Problem

The most common routing misconfiguration in GWLB deployments is asymmetric inspection — egress traffic is inspected but return traffic bypasses the appliance. Because GWLB appliances are stateful, uninspected return packets will be rejected by the appliance's connection table.

Validate symmetric inspection by:
- Checking that the Internet Gateway's ingress route table routes spoke CIDRs to the GWLB endpoint.
- Running `traceroute` from a workload and confirming the appliance's IP appears in the path in both directions.
- Checking appliance session tables — a legitimate TCP session should show bidirectional traffic in the session.

### Terraform Route Table Skeleton

```hcl
# Inspection VPC — firewall subnet routes
resource "aws_route_table" "firewall_subnet" {
  vpc_id = aws_vpc.inspection.id

  route {
    cidr_block      = "0.0.0.0/0"
    vpc_endpoint_id = aws_vpc_endpoint.gwlb.id
  }

  route {
    cidr_block         = "10.0.0.0/8"
    transit_gateway_id = aws_ec2_transit_gateway.hub.id
  }
}

# Inspection VPC — NAT Gateway subnet routes
resource "aws_route_table" "nat_subnet" {
  vpc_id = aws_vpc.inspection.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.inspection.id
  }

  route {
    cidr_block         = "10.0.0.0/8"
    transit_gateway_id = aws_ec2_transit_gateway.hub.id
  }
}

# Internet Gateway — ingress route table (return traffic inspection)
resource "aws_route_table" "igw_ingress" {
  vpc_id = aws_vpc.inspection.id

  route {
    cidr_block      = "10.0.0.0/8"
    vpc_endpoint_id = aws_vpc_endpoint.gwlb.id
  }
}

resource "aws_gateway_route_table_association" "igw_ingress" {
  gateway_id     = aws_internet_gateway.inspection.id
  route_table_id = aws_route_table.igw_ingress.id
}
```

### AZ-Local Routing Requirement

GWLB endpoints must be in the same AZ as the resource sending traffic. If a workload in `ap-southeast-1a` sends traffic to a GWLB endpoint in `ap-southeast-1b`, AWS will route it to `ap-southeast-1b` — but the GWLB return path will be in `1b`, creating an AZ asymmetry that breaks statefulness.

**Rule:** Deploy one GWLB endpoint per AZ in each VPC where inspection is needed. Route table entries should target the GWLB endpoint in the same AZ as the subnet. Use separate route tables per AZ subnet to enforce this.

---

## 5. Appliance Integration

### Appliance Requirements for GWLB

Not all virtual network appliances support GWLB. The appliance must:

- Support **Geneve encapsulation** on UDP/6081.
- Be deployable as an EC2 instance (VM import, AMI from AWS Marketplace, or BYOL).
- Expose a **health check endpoint** on a configurable port (TCP or HTTP).
- Handle return traffic by re-encapsulating and returning packets to the GWLB on the same Geneve session.

Verified GWLB-compatible appliances as of 2025:

| Vendor | Product | Marketplace |
| :--- | :--- | :--- |
| Palo Alto Networks | VM-Series | Yes |
| Fortinet | FortiGate VM | Yes |
| Check Point | CloudGuard Network | Yes |
| Cisco | Firepower Threat Defense Virtual | Yes |
| Suricata (open source) | Community build | No — self-managed AMI |
| Snort (open source) | Community build | No — self-managed AMI |

### Appliance Placement

Appliances go in a dedicated **appliance subnet** within the inspection VPC. Do not place appliances in the same subnet as the GWLB endpoints or the NAT Gateway. Use separate subnets per AZ for appliances.

Appliances need outbound internet access for:
- Threat intelligence feed updates (IPS signature updates)
- License activation
- CloudWatch agent metric emission

Route appliance subnet traffic to a NAT Gateway for this management plane internet access. This is separate from the inspection data plane.

### Health Check Configuration

Configure the GWLB target group health check to match what the appliance exposes:

```hcl
resource "aws_lb_target_group" "appliances" {
  name        = "gwlb-appliance-tg"
  port        = 6081
  protocol    = "GENEVE"
  vpc_id      = aws_vpc.inspection.id
  target_type = "instance"

  health_check {
    port                = 80
    protocol            = "HTTP"
    path                = "/health"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 10
    timeout             = 5
  }

  stickiness {
    enabled = true
    type    = "source_ip_dest_ip"
  }
}
```

**Health check port selection:** Most NGFW appliances expose a management HTTP endpoint on port 80 or 8080. For Palo Alto VM-Series, the health check endpoint is configured in the appliance's management interface settings. Confirm the health check port is in the appliance's security group ingress rules — from the GWLB's subnet CIDR, not 0.0.0.0/0.

### Instance Sizing for Appliances

GWLB does not perform any packet modification — all inspection compute is in the appliance. Size appliances based on your peak inspection throughput plus headroom for burst:

| Instance Family | Typical Throughput | Use Case |
| :--- | :--- | :--- |
| `c6in.xlarge` | 3–5 Gbps per appliance | Dev/test inspection VPC |
| `c6in.4xlarge` | 12–15 Gbps per appliance | Production with moderate egress |
| `c6in.8xlarge` | 25 Gbps per appliance | High-throughput production |
| `c6in.16xlarge` | 50 Gbps per appliance | Large-scale centralized inspection |

Use `c6in` (network-optimized, Intel) or `c6gn` (Graviton, network-optimized) instances. Avoid general-purpose instance families for appliances — you are paying for network throughput, and general instances throttle at lower rates.

---

## 6. Auto Scaling Appliance Fleets

### Why You Must Auto Scale

A fixed appliance fleet has two failure modes:
- **Under-provisioned:** A traffic surge exceeds appliance capacity; packets are dropped.
- **Over-provisioned:** You pay for idle appliance instances 24/7.

GWLB integrates directly with EC2 Auto Scaling — new instances are automatically registered with the GWLB target group on launch and deregistered with connection draining on termination.

### Launch Template for Appliances

```hcl
resource "aws_launch_template" "appliance" {
  name_prefix   = "gwlb-appliance-"
  image_id      = var.appliance_ami_id
  instance_type = "c6in.4xlarge"

  network_interfaces {
    associate_public_ip_address = false
    subnet_id                   = aws_subnet.appliance_az1.id
    security_groups             = [aws_security_group.appliance.id]
  }

  iam_instance_profile {
    name = aws_iam_instance_profile.appliance.name
  }

  user_data = base64encode(templatefile("${path.module}/appliance-bootstrap.sh.tpl", {
    license_server = var.license_server_url
    config_bucket  = var.config_s3_bucket
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name        = "gwlb-appliance"
      Environment = var.environment
    }
  }
}
```

### Auto Scaling Group Configuration

```hcl
resource "aws_autoscaling_group" "appliances" {
  name                = "gwlb-appliances"
  min_size            = 2
  max_size            = 10
  desired_capacity    = 2
  vpc_zone_identifier = [
    aws_subnet.appliance_az1.id,
    aws_subnet.appliance_az2.id
  ]

  launch_template {
    id      = aws_launch_template.appliance.id
    version = "$Latest"
  }

  target_group_arns         = [aws_lb_target_group.appliances.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 300

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
    }
  }
}

resource "aws_autoscaling_policy" "scale_out" {
  name                   = "appliance-scale-out"
  autoscaling_group_name = aws_autoscaling_group.appliances.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 60.0
  }
}
```

**Scale-out trigger selection:** CPU utilization is a reasonable proxy for appliance load but is not perfect — network throughput can saturate before CPU does on throughput-optimized instances. For more precision, use a custom CloudWatch metric emitted by the appliance (most NGFW products expose throughput metrics via their management API or CloudWatch agent integration).

### Warm Pool Strategy

Cold start for NGFW appliances is slow — license activation, signature download, and configuration push can take 5–10 minutes. During a traffic burst, new instances that take 10 minutes to become healthy provide no protection for the surge.

Configure an ASG Warm Pool to keep pre-initialized appliances in a stopped state, ready to activate in 60–90 seconds rather than 10 minutes:

```hcl
resource "aws_autoscaling_group" "appliances" {
  # ... other config ...

  warm_pool {
    pool_state                  = "Stopped"
    min_size                    = 1
    max_group_prepared_capacity = 3
  }
}
```

The tradeoff: warm pool instances in `Stopped` state still incur EBS volume costs and are counted against EC2 quota.

---

## 7. TLS Inspection

### The TLS Inspection Problem

Without TLS decryption, an inspection appliance can see only the outer metadata of HTTPS traffic — source/destination IP, port, SNI hostname from the TLS ClientHello — but not the HTTP request, response, or payload. A C2 beacon or data exfiltration payload riding inside TLS is invisible.

TLS inspection ("SSL bumping") requires the appliance to:
1. Terminate the client's TLS session (acting as the server to the client).
2. Inspect the decrypted payload.
3. Open a new TLS session to the actual destination (acting as a client to the server).
4. Re-encrypt and forward traffic in both directions.

### Certificate Authority Deployment

For TLS inspection to work without browser certificate errors, your organization's internal CA must be trusted by all workload instances. The appliance dynamically generates certificates signed by this CA for each domain it bumps.

Deployment steps:

- Generate an intermediate CA certificate signed by your organization's root CA. Do not use the root CA directly on the appliance.
- Load the intermediate CA private key and certificate into the appliance's TLS decryption profile.
- Distribute the root CA certificate to all workload instances via a configuration management tool or EC2 user data.
- For Linux instances: place the CA certificate in `/etc/pki/ca-trust/source/anchors/` (RHEL/Amazon Linux) or `/usr/local/share/ca-certificates/` (Debian/Ubuntu) and run `update-ca-trust` or `update-ca-certificates`.

```bash
# User data snippet for Amazon Linux 2 instances
#!/bin/bash
cat << 'EOF' > /etc/pki/ca-trust/source/anchors/corporate-inspection-ca.pem
-----BEGIN CERTIFICATE-----
<base64 encoded corporate root CA>
-----END CERTIFICATE-----
EOF
update-ca-trust extract
```

### Bypass Lists

You must configure bypass rules for categories of traffic that should not be decrypted:

| Category | Reason for Bypass |
| :--- | :--- |
| Banking and financial sites | Many enforce certificate pinning |
| Healthcare portals | HIPAA may restrict decryption of patient data |
| Software update services (Windows Update, apt, yum) | Certificate pinning; decryption breaks update verification |
| AWS service endpoints | Decrypting calls to `s3.amazonaws.com` may interfere with signature validation |
| Video conferencing (Zoom, Teams) | Certificate pinning; user experience degradation |
| Internal/private domains | Traffic to `*.corp.internal` should never route through a bumping appliance |

Configure bypass by SNI hostname category in the appliance's decryption policy. Most NGFW products support URL categorization for bypass rules.

### Certificate Pinning Failures

Certificate pinning is the silent killer of TLS inspection deployments. Applications that pin certificates validate the exact certificate presented — not just whether it is signed by a trusted CA. When the appliance presents a dynamically generated certificate (even if signed by a trusted CA), the pinning check fails and the connection is dropped.

Modern browsers use HSTS Preloading and CT (Certificate Transparency) which can also cause issues. Chrome's CT log requires all publicly trusted certificates to be logged — a private CA does not submit to CT logs, so Chrome may flag these certificates in some configurations.

**Diagnosis:** When a workload reports a TLS error connecting to a domain that other workloads reach fine, check if the domain is in the appliance bypass list. If not, add it and test again. For a quick bypass test without changing appliance policy, temporarily route that workload's traffic around the appliance.

---

## 8. Multi-Account & Multi-Region

### Sharing a GWLB Across Accounts via PrivateLink

The GWLB and its appliance fleet live in a central **security account** (separate from your Shared Services account — security workloads should be isolated). Spoke accounts consume the GWLB via GWLB endpoints that are provisioned as PrivateLink endpoints.

The sharing mechanism:

- In the security account, create a VPC Endpoint Service from the GWLB.
- Configure the endpoint service to require acceptance, and whitelist the spoke account IDs (or use AWS Organizations principal for automatic acceptance).
- In each spoke account/VPC, create a GWLB endpoint (`aws_vpc_endpoint`) pointing to the endpoint service.

```hcl
# Security account — expose GWLB as endpoint service
resource "aws_vpc_endpoint_service" "gwlb_service" {
  acceptance_required        = false
  gateway_load_balancer_arns = [aws_lb.gwlb.arn]

  allowed_principals = [
    "arn:aws:iam::${var.spoke_account_1}:root",
    "arn:aws:iam::${var.spoke_account_2}:root"
  ]
}

# Spoke account — create GWLB endpoint
resource "aws_vpc_endpoint" "gwlb_ep" {
  provider            = aws.spoke_account
  vpc_id              = var.spoke_vpc_id
  service_name        = var.gwlb_endpoint_service_name
  vpc_endpoint_type   = "GatewayLoadBalancer"
  subnet_ids          = [var.firewall_subnet_id]
}
```

**Gotcha:** GWLB endpoint services are regional. A GWLB in `ap-southeast-1` cannot serve endpoints in `ap-southeast-3`. For multi-region coverage, you need a GWLB deployment per region. This is a significant cost and operational consideration.

### AWS Organizations-Based Acceptance

Instead of listing individual account ARNs, allow any principal in your organization:

```hcl
resource "aws_vpc_endpoint_service" "gwlb_service" {
  acceptance_required        = false
  gateway_load_balancer_arns = [aws_lb.gwlb.arn]

  allowed_principals = [
    "arn:aws:iam::*:root"  # Only works with acceptance_required=false + Org-level SCP
  ]
}
```

The better approach: use `acceptance_required = false` combined with an SCP that permits GWLB endpoint creation only toward approved endpoint service names. This is more maintainable than listing every account ARN.

### Multi-Region HA Design

| Pattern | Description | Trade-offs |
| :--- | :--- | :--- |
| **Active-Active** | Independent GWLB + appliance fleet in each region; no cross-region failover | Highest availability; doubles appliance cost; different policy version possible per region |
| **Active-Passive** | Primary GWLB region; secondary region has appliances in warm standby; failover via Route 53 health checks | Lower steady-state cost; failover is slow (minutes); cross-region latency if traffic routes to secondary |
| **Primary-Only with AZ redundancy** | Single region, multi-AZ appliances; no cross-region | Acceptable if workloads are single-region; simplest; does not survive a regional outage |

For most multi-account AWS environments, **active-active per region** is the right model. Design each region's inspection VPC as an independent stack. Centralize policy management (push appliance policy from a single management plane to all regions) but keep the data plane independent.

---

## 9. Failure Modes & Blast Radius

### Failure Taxonomy

Understanding exactly what breaks under each failure scenario is essential for setting the correct failure mode on your appliance (fail-open vs fail-closed).

| Failure | Impact | Recovery Time | Fail-Open? |
| :--- | :--- | :--- | :--- |
| Single appliance fails health check | Existing flows to that appliance drop; new flows go to healthy appliances | Immediate for new flows; 30–90s for health check convergence | Not applicable — GWLB handles this |
| All appliances fail health check | All traffic through GWLB endpoint is blackholed | Until appliances recover or bypass route is activated | Depends on your bypass design |
| GWLB endpoint ENI failure | Traffic from that AZ cannot reach GWLB; full AZ egress outage | Automatic if multi-AZ routing is configured | Route to GWLB endpoint in another AZ |
| GWLB itself (service-level failure) | AWS-managed; extremely rare | AWS SLA handles it | N/A |
| Misconfigured route table | Routing loop or blackhole; all egress from affected VPC/subnet drops | Immediately on route table correction | N/A |
| Appliance over-capacity | Packets dropped at appliance; CPU/throughput saturation | ASG scale-out (minutes) | Warm pool reduces to 60–90s |

### Fail-Open vs Fail-Closed

This is a security vs availability trade-off with no universally correct answer:

**Fail-closed:** If all appliances are unhealthy, all egress traffic is blocked. Nothing passes uninspected.
- Correct for: PCI-DSS, HIPAA, or environments where uninspected egress is a compliance violation.
- Implication: An appliance outage is also a business outage. You need extremely robust appliance HA and on-call procedures.

**Fail-open:** If appliances are unhealthy, a bypass route is activated (typically pointing directly to the NAT Gateway, skipping the GWLB endpoint).
- Correct for: Environments where availability outweighs the risk of temporarily uninspected egress; good for dev/test.
- Implication: Requires automation to activate and deactivate the bypass route. AWS Lambda + CloudWatch alarm on GWLB `HealthyHostCount = 0` is the standard implementation.

```python
# Lambda handler — activate bypass on unhealthy GWLB
import boto3

def handler(event, context):
    ec2 = boto3.client("ec2")
    alarm_state = event["detail"]["state"]["value"]

    if alarm_state == "ALARM":
        # Activate bypass: replace GWLB endpoint route with direct IGW/NAT route
        ec2.replace_route(
            RouteTableId=FIREWALL_SUBNET_ROUTE_TABLE,
            DestinationCidrBlock="0.0.0.0/0",
            NatGatewayId=BYPASS_NAT_GATEWAY_ID
        )
    elif alarm_state == "OK":
        # Restore inspection path
        ec2.replace_route(
            RouteTableId=FIREWALL_SUBNET_ROUTE_TABLE,
            DestinationCidrBlock="0.0.0.0/0",
            VpcEndpointId=GWLB_ENDPOINT_ID
        )
```

Trigger this Lambda from an EventBridge rule on the `HealthyHostCount` CloudWatch alarm. Test the bypass activation monthly to ensure it works before you need it in an incident.

### AZ Affinity and Single-AZ Failure

GWLB is AZ-aware. If you have appliances in AZ1 and AZ2, and AZ1 goes down, all traffic that was routed to AZ1's GWLB endpoint will fail — there is no automatic rerouting to AZ2's endpoint. The route table entry for AZ1 subnets still points to the AZ1 GWLB endpoint.

Mitigation: For a zonal failure, an automated Lambda (triggered by AZ health events or GWLB `HealthyHostCount` per AZ) can update the affected route tables to point to the surviving AZ's GWLB endpoint. This introduces cross-AZ GWLB traffic (which breaks the AZ affinity optimization) but maintains connectivity. Cross-AZ GWLB data processing incurs additional charges.

---

## 10. Operational Runbooks

### Runbook: Traffic Blackhole — No Egress from Workloads

**Symptoms:** Workloads cannot reach the internet. `curl` times out. No response on any external endpoint. Internal VPC traffic works normally.

**Diagnosis — routing layer:**
- From the workload instance, run `traceroute 8.8.8.8`. If it stops at the first hop (the VPC router), the route table in the workload subnet is missing a `0.0.0.0/0` route or it points to a non-functional target.
- Check the workload subnet's route table. The default route should point to the GWLB endpoint (or TGW in the centralized model).
- If using TGW: confirm the TGW route table for the spoke attachment has a `0.0.0.0/0` route to the inspection VPC attachment.

**Diagnosis — GWLB + appliance layer:**
- Check GWLB target group `HealthyHostCount` metric in CloudWatch. If zero, all appliances are unhealthy — this is the blackhole cause.
- SSH into an appliance (via Systems Manager Session Manager, not via the internet). Check the appliance process status and Geneve listener: `ss -ulnp | grep 6081`.
- Check appliance CPU and memory — if the appliance is overloaded, the health check HTTP endpoint may be timing out even though the appliance process is running.

**Resolution:**
- If appliances are unhealthy: restart the appliance process, or terminate and replace the instance (ASG will launch a replacement).
- If appliances are healthy but traffic is still blackholed: the routing is incorrect. Check the inspection VPC firewall subnet route table — ensure `0.0.0.0/0` routes to the GWLB endpoint, not elsewhere.
- For immediate recovery while debugging: activate the fail-open bypass route manually.

### Runbook: Appliance Replacement Without Downtime

When replacing an appliance instance (for patching, instance type change, or failure):

- Deregister the target instance from the GWLB target group. Do not terminate first.
- Wait for connection draining to complete (default 300 seconds). Monitor `ActiveFlowCount` on the target group — wait until this reaches zero or the timeout expires.
- Terminate the old instance.
- The ASG will launch a replacement. Monitor `HealthyHostCount` until the replacement is healthy.
- Confirm new flows are being processed by checking appliance session tables.

For planned maintenance requiring full fleet replacement (major version upgrade), use the ASG instance refresh feature, which handles deregistration, draining, and replacement automatically with a configurable minimum healthy percentage.

### Runbook: Health Check Failing on New Appliance

**Symptom:** A newly launched appliance instance never becomes healthy. GWLB target group shows the instance as `unhealthy`.

**Diagnosis:**
- Check the security group on the appliance instance. The GWLB health check originates from the GWLB's subnet IP range — ensure the appliance security group allows inbound TCP on the health check port from the GWLB subnet CIDR, not just from the GWLB security group (GWLB does not have a security group — it uses subnet-level addressing).
- SSH into the appliance and confirm the health check HTTP endpoint is actually listening: `curl http://localhost:80/health`.
- Check if the appliance is still bootstrapping (signature download, license activation). GWLB health checks begin immediately on registration. Set a sufficient `health_check_grace_period` on the ASG (300–600 seconds for most NGFW appliances) to prevent premature unhealthy marking.
- Verify the Geneve listener is active: `ss -ulnp | grep 6081`.

**Resolution:**
- Add the GWLB subnet CIDR to the appliance security group health check port rule.
- Increase the ASG health check grace period to cover the appliance bootstrap time.
- For license activation failures, check network path from appliance subnet to the license server.

### Runbook: Emergency Bypass Activation

When egress is completely broken and time-to-recovery takes priority over inspection:

- In the inspection VPC firewall subnet route table, replace the `0.0.0.0/0` → GWLB endpoint route with `0.0.0.0/0` → NAT Gateway.
- Confirm egress is restored from a workload instance.
- Alert the security team — uninspected egress is now active.
- Root-cause the GWLB/appliance failure and restore the inspection path.
- Replace the bypass route with the GWLB endpoint route.
- Confirm inspection is restored by checking appliance session tables for active flows.

**SLA for bypass restoration:** Define this with your security team before you need it. A common contract is: bypass is acceptable for up to 30 minutes for unplanned outages; beyond that, the incident escalates to a Sev1 security event.

---

## 11. Observability

### VPC Flow Logs with GWLB

Standard VPC Flow Logs capture traffic at the ENI level. In a GWLB inspection deployment, you need flow logs in multiple places to get complete visibility:

| Flow Log Location | What It Captures |
| :--- | :--- |
| Spoke VPC workload ENI | Original source/destination before GWLB; best for workload-level visibility |
| GWLB endpoint ENI | Traffic entering/exiting the GWLB endpoint; encapsulated (Geneve) — less useful for application-level analysis |
| Appliance ENI | Post-decapsulation traffic; the appliance sees inner packets — most useful for security analytics |
| NAT Gateway | Post-inspection egress; confirms traffic actually left the inspection VPC |
| Internet Gateway | All inbound and outbound; requires ingress route table flow logs for complete picture |

Enable flow logs in **custom format** to capture additional fields useful for GWLB debugging:

```hcl
resource "aws_flow_log" "inspection_vpc" {
  iam_role_arn         = aws_iam_role.flow_log.arn
  log_destination      = aws_cloudwatch_log_group.flow_logs.arn
  traffic_type         = "ALL"
  vpc_id               = aws_vpc.inspection.id
  log_destination_type = "cloud-watch-logs"

  destination_options {
    file_format        = "parquet"
    hive_compatible_partitions = true
  }
}
```

Send flow logs to S3 in Parquet format for Athena querying — CloudWatch is fine for real-time alerting but expensive for long-term storage and ad-hoc analysis.

### CloudWatch Alarms for GWLB

| Alarm | Metric | Threshold | Severity |
| :--- | :--- | :--- | :--- |
| No healthy appliances | `HealthyHostCount` | < 1 for 1 minute | Critical |
| Appliance unhealthy (partial) | `HealthyHostCount` | < `desired_capacity` for 5 min | Warning |
| High active flows | `ActiveFlowCount` | > 80% of appliance capacity | Warning |
| New flow rate spike | `NewFlowCount` rate | > 3× baseline for 5 min | Info |
| GWLB endpoint traffic drop | `ProcessedBytes` | < baseline × 0.1 (sudden drop) | Critical |

The `ProcessedBytes` sudden-drop alarm is your most important blackhole detector — if traffic drops to near zero while workloads are running, something broke in the routing or inspection path.

### Appliance-Level Metrics

Most NGFW appliances support CloudWatch metric emission via the CloudWatch agent or their own AWS integration. Metrics to collect and alarm on:

- CPU utilization (scale trigger + capacity alarm)
- Session table usage (% of max concurrent sessions)
- Throughput (Gbps) per appliance
- Dropped packets (IPS blocks + capacity drops — distinguish these)
- Signature update age (alarm if signatures are more than 24 hours old)

### Athena Query: Top Talkers by Destination

For identifying which workloads generate the most egress (useful for right-sizing appliances and detecting anomalies):

```sql
SELECT
  srcaddr,
  dstaddr,
  SUM(bytes) as total_bytes,
  COUNT(*) as flow_count
FROM vpc_flow_logs
WHERE
  action = 'ACCEPT'
  AND dstaddr NOT LIKE '10.%'
  AND dstaddr NOT LIKE '172.16.%'
  AND dstaddr NOT LIKE '192.168.%'
  AND year = '2025'
  AND month = '06'
GROUP BY srcaddr, dstaddr
ORDER BY total_bytes DESC
LIMIT 100;
```

---

## 12. Cost Model

### GWLB Pricing Components

GWLB pricing has two dimensions:

| Component | Price (ap-southeast-1, ~2025) | Notes |
| :--- | :--- | :--- |
| GWLB endpoint per AZ | ~$0.013/hour | Per endpoint, per AZ. 2 AZs × 3 spoke VPCs = 6 endpoints |
| GWLB data processing | ~$0.004/GB | Charged once per GB (not per direction) |

A deployment with 6 GWLB endpoints running 24/7 costs approximately:
- Endpoint hours: 6 × $0.013 × 730 = **$56.94/month**
- Data processing (assuming 5 TB/month egress): 5,000 × $0.004 = **$20/month**

**GWLB itself is essentially free.** The costs are in the endpoints and the appliances.

### Full Cost Model

| Component | Monthly Cost Estimate |
| :--- | :--- |
| GWLB endpoints (6, 24/7) | ~$57 |
| GWLB data processing (5 TB) | ~$20 |
| Appliance instances (2× c6in.4xlarge, on-demand) | ~$1,050 |
| Appliance BYOL/marketplace license | Varies: $500–$5,000/month depending on vendor and throughput tier |
| NAT Gateway (centralized, 5 TB) | ~$230 |
| VPC Flow Logs (S3, 5 TB) | ~$115 |
| **Total (ex-licensing)** | **~$1,470/month** |

The appliance license is often the largest cost. Always evaluate Reserved Instance pricing for appliance EC2 instances (1-year RI on `c6in.4xlarge` saves ~35% vs on-demand). Most NGFW vendors also offer annual licensing that is significantly cheaper per month than pay-as-you-go marketplace rates.

### Cost vs Security Trade-off

The question "is GWLB inspection worth the cost" depends on what you are protecting:

| Scenario | Annual GWLB Cost | Justified? |
| :--- | :--- | :--- |
| Single dev/test environment, low egress | ~$20,000 (including licensing) | Probably not — use Network Firewall |
| Production multi-account, 20+ VPCs, compliance requirement | ~$50,000–$150,000 | Yes — compliance mandate plus centralized policy |
| High-egress production (50+ TB/month) | Scale data processing costs accordingly | Evaluate throughput-based licensing tiers |

---

## 13. Alternatives & Trade-offs

| Solution | L7 Inspection | TLS Decryption | Multi-account | Managed? | Relative Cost |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **GWLB + NGFW appliance** | Full | Yes (with config) | Yes (PrivateLink) | No | High |
| **AWS Network Firewall** | Suricata rules | No | Yes (via Firewall Manager) | Yes | Medium |
| **NAT GW + NACLs** | No (IP only) | No | Yes | Yes | Low |
| **Route 53 DNS Firewall** | DNS only | No | Yes (via RAM) | Yes | Very low |
| **Explicit HTTP proxy (Squid/Zscaler)** | HTTP/HTTPS only | Yes | Yes (client config) | Depends | Medium–High |
| **PrivateLink for all external services** | No — eliminates egress | No | Yes | Yes | No egress cost |

### AWS Network Firewall vs GWLB

This is the most common decision point for teams new to egress inspection:

| Factor | AWS Network Firewall | GWLB + NGFW Appliance |
| :--- | :--- | :--- |
| **Operational overhead** | Low — fully managed | High — you manage EC2 appliances, patches, licenses |
| **Policy flexibility** | Suricata rule groups + domain lists | Full NGFW feature set (app-ID, user-ID, URL categories) |
| **TLS inspection** | No | Yes |
| **Throughput** | Up to 100 Gbps (managed) | Scales with appliance fleet |
| **Vendor lock-in** | AWS | Third-party vendor |
| **Compliance (PCI, HIPAA)** | Acceptable for many frameworks | Stronger audit trail; vendor-specific compliance certifications |
| **Time to deploy** | Hours | Days to weeks |
| **Cost** | $0.395/hour per AZ + $0.065/GB | Higher (appliance licensing) |

**Rule of thumb:** Start with AWS Network Firewall. Upgrade to GWLB + NGFW only when you hit Network Firewall's limits (no TLS inspection, no app-ID, Suricata rule complexity) or when your organization already standardizes on a specific NGFW vendor.

---

## 14. Day-2 Ops Checklist

### Weekly Hygiene

- Review `HealthyHostCount` CloudWatch metric history — confirm no partial unhealthy periods went undetected.
- Check `ProcessedBytes` baseline — an unexplained spike may indicate a new high-egress workload bypassing inspection or a workload that should be scheduled.
- Verify appliance signature update timestamps — signatures older than 48 hours indicate an update failure.
- Review GWLB target group metrics for any instances showing elevated dropped packets or latency.

### Monthly Review

- Pull appliance CPU and throughput metrics for the past 30 days. Assess whether current instance sizing and fleet size are appropriate. If peak CPU exceeds 70%, plan a scale-up.
- Review the bypass activation log — if bypass was triggered in the past month, post-mortem the root cause and implement a prevention.
- Audit GWLB endpoint service `AllowedPrincipals` list — remove any decommissioned spoke accounts.
- Validate the fail-open/fail-closed bypass Lambda by simulating an unhealthy target group in a non-production environment.
- Check appliance OS and software versions — apply security patches in a rolling fashion using the ASG instance refresh.

### Quarterly Review

- Conduct a full routing audit: for each spoke VPC and subnet, trace the egress path and confirm it routes through the inspection GWLB endpoint. Document any subnets not covered by inspection.
- Review the TLS bypass list with the security team — add new domains that cause inspection problems; remove domains that no longer require bypass.
- Assess whether any new spoke accounts or VPCs added in the quarter are enrolled in inspection.
- Revisit the appliance fleet's RI coverage. As the fleet size becomes predictable, converting on-demand instances to 1-year Reserved Instances reduces appliance EC2 cost by 30–35%.
- Run a tabletop exercise for the "all appliances unhealthy" failure scenario — ensure on-call engineers can execute the bypass runbook within the target SLA.

### Patching Appliances Without Downtime

For major version upgrades that cannot be done in-place:

- Confirm `min_size = 2` on the ASG so at least 2 instances remain healthy during the upgrade.
- Trigger an ASG instance refresh with `min_healthy_percentage = 50`. This replaces instances one at a time, waiting for the replacement to become healthy before terminating the next.
- Monitor GWLB `HealthyHostCount` throughout the refresh. If it drops to 1, the refresh will pause by default — investigate before proceeding.
- Validate post-upgrade by confirming inspection policy is intact (check appliance security policy version) and running a synthetic traffic test through the GWLB.
