# AWS Knowledge Base Index

This directory contains deep-dive, production-grade technical logs and design references for AWS cloud architecture. They are organized in a logical sequence:

| Module | Topic | Description |
| :---: | :--- | :--- |
| **01** | [AWS Control Tower & Landing Zone Architecture](landing-zone.md) | Standard enterprise baseline setup using AWS Organizations, global Service Control Policies (SCPs), Account Factory for Terraform (AFT), and cross-account customization pipelines. |
| **02** | [Centralized Egress via Transit Gateway & NAT Gateway](centralized-egress-tgw-nat.md) | High-performance multi-account outbound routing design using Transit Gateway, NAT Gateway capacity/limitations, centralized Route 53 resolver architectures, and inline security inspection via AWS Network Firewall. |
| **03** | [AWS Well-Architected Framework Reference](well-architected-framework.md) | Complete production-grade guide for all six pillars of the AWS Well-Architected Framework, containing active metric dashboards, committed use optimization rules, Graviton migration plans, and review facilitation playbooks. |
| **04** | [Egress Inspection with AWS Gateway Load Balancer](egress-inspection-gwlb.md) | L7 egress inspection architecture using Gateway Load Balancer (GWLB) and third-party virtual appliances. Covers GWLB internals, appliance integration patterns, routing design, centralized vs distributed inspection models, failure modes, and Day-2 operational runbooks. |
| **05** | [EC2 Instance Scheduler - Cost Optimization](ec2-instance-scheduler.md) | Cost optimization pattern for automatically starting and stopping EC2 instances based on business hours, using Lambda, DynamoDB, EventBridge, and CI/CD-safe deployment patterns. Includes full runbooks for production environments. |
| **06** | [Workload Identity - IRSA Deep Dive](workload-identity-irsa.md) | Comprehensive guide to AWS IAM Roles for Service Accounts (IRSA), covering production deployment patterns, security best practices, CI/CD pipelines for managing OIDC providers, and failure mode runbooks. |
| **07** | [Centralized VPC Endpoints Design](centralized-vpc-endpoints.md) | High-performance, cost-optimized design patterns for VPC endpoint architectures, covering interface and gateway endpoint strategies, multi-account PrivateLink sharing, and routing designs that minimize cross-AZ data transfer costs. |
| **08** | [Centralized Egress using Transit Gateway & NAT Gateway - The Runbooks](centralized-egress-tgw-nat-runbooks.md) | Production-grade operational runbooks for the Transit Gateway & NAT Gateway egress architecture, covering traffic blackhole scenarios, NAT Gateway scaling incidents, Route 53 DNS failure recovery, and emergency egress bypass procedures. |


