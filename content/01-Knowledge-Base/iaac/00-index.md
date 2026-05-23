# Infrastructure as Code (IaC) Knowledge Base Index

This directory contains the split topics from the Terraform Best Practices cheatsheet. Please select a topic from the guides below:

- **[High-Level Paradigms, Concepts & Philosophies](paradigms-concepts.md)**: Conceptual foundations of IaC including Declarative vs. Imperative, Pets vs. Cattle, Immutable Infrastructure, GitOps for Infra, and Blast Radius Isolation.
- **[Best Practices & Core Principles](best-practices.md)**: Standard syntax rules, project structures, provider and version pinning, remote state backends, variable validation, module design, looping/dynamics, and common anti-patterns.
- **[Terragrunt Guide (DRY at Scale)](terragrunt.md)**: How to eliminate duplication in backend/provider configs, manage dependency graphs, orchestrate multi-account assume role workflows, and run-all recursive commands.
- **[Pre-commit & Shift-Left Validation](pre-commit.md)**: Detailed guide on configuring pre-commit hook suites locally to validate formatting, check for hardcoded secrets, lint with tflint, scan with Checkov, and enforce policy-as-code (OPA/Conftest).
