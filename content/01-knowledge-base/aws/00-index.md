# AWS Knowledge Base Index

This directory contains deep-dive, production-grade technical logs and design references for AWS cloud architecture. They are organized in a logical sequence:

| Module | Topic | Description |
| :---: | :--- | :--- |
| **01** | [AWS Control Tower & Landing Zone Architecture](landing-zone.md) | Standard enterprise baseline setup using AWS Organizations, global Service Control Policies (SCPs), Account Factory for Terraform (AFT), and cross-account customization pipelines. |
| **02** | [Centralized Egress via Transit Gateway & NAT Gateway](centralized-egress-tgw-nat.md) | High-performance multi-account outbound routing design using Transit Gateway, NAT Gateway capacity/limitations, centralized Route 53 resolver architectures, and inline security inspection via AWS Network Firewall. |
| **03** | [AWS Well-Architected Framework Reference](well-architected-framework.md) | Complete production-grade guide for all six pillars of the AWS Well-Architected Framework, containing active metric dashboards, committed use optimization rules, Graviton migration plans, and review facilitation playbooks. |

---

*Last updated: 2026-05 | Author: Personal KB | Stack: AWS Cloud Architecture*
