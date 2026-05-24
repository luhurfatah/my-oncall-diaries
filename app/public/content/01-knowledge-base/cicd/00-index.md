# CI/CD Knowledge Base Index

This directory contains the split topics from the CI/CD Best Practices cheatsheet. They are numbered in the recommended reading order:

| Module | Topic | Description |
| :---: | :--- | :--- |
| **01** | [High-Level Paradigms, Concepts & Philosophies](01-paradigms-and-concepts.md) | Conceptual foundations including DevOps vs. DevSecOps vs. Platform Engineering, Inner vs. Outer Loop, cattle vs. pets, declarative models, pull-based GitOps, and decoupling deploy from release. |
| **02** | [Best Practices & Core Principles](02-best-practices.md) | Core pipeline design tenets, DORA metrics, secret management, testing strategies, deployment strategies, and common anti-patterns. |
| **03** | [Build Once, Deploy Many Guide](03-build-once-deploy-many.md) | Standard patterns for backend container configurations and solving the frontend runtime environment variable injection problem. |
| **04** | [Pipeline Optimization & Speed](04-pipeline-optimization.md) | Practical optimization methods to reduce pipeline times under 10 minutes, covering Docker layer caching, dependency caching, and parallelization. |
| **05** | [GitHub Actions Enterprise Pattern](05-github-actions-pattern.md) | Complete reference template for a production-ready, secure, and parallelized GitHub Actions workflow using AWS OIDC. |
| **06** | [Blue/Green Deployment Implementation Guide](06-blue-green-deployment.md) | Kubernetes and GitOps (Flux CD + Helm) blueprint for setting up blue/green canary rollouts with automated rollbacks. |
| **07** | [GitOps Best Practices Cheatsheet](07-gitops-best-practices.md) | Core pillars, branch strategies, repository structures, and configuration details for GitOps setups. |
| **08** | [ArgoCD Deep Dive](08-argocd-deep-dive.md) | ArgoCD specific implementation details including App of Apps, ApplicationSets, and Image Updater. |
| **09** | [Flux CD Deep Dive](09-flux-cd-deep-dive.md) | Flux CD specific implementation details including Kustomization, HelmRelease, and Image Automation. |
| **10** | [Industry Standard CI/CD References](99-references.md) | Curated list of foundational industry standards, frameworks (DORA, 12-Factor App), books, and articles defining modern CI/CD. |