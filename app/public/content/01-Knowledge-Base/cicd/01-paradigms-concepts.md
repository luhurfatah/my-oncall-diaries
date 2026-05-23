# CI/CD Paradigms, Concepts, & Philosophies

This document covers the high-level paradigms, philosophies, and architectural patterns that define modern Continuous Integration, Continuous Delivery, and software delivery engineering.

## 1. Core Paradigms & Philosophies

### DevOps vs. DevSecOps vs. Platform Engineering
- **DevOps (The Culture):** A cultural and professional movement aimed at breaking down silos between Development (Dev) and Operations (Ops). It emphasizes shared responsibility, automation, feedback loops, and continuous learning.
- **DevSecOps (Shift Left Security):** The integration of security practices, tooling, and compliance audits directly into the DevOps pipeline from the very beginning. Security is no longer a final "gate" before release; it is automated within the CI/CD feedback loop.
- **Platform Engineering (The Productization):** The practice of designing and building toolchains and workflows that enable developer self-service. Platform teams build an **Internal Developer Platform (IDP)** to package CI/CD, IaC, and Kubernetes configurations into standard, easily consumable products (Golden Paths), reducing cognitive load on developers.

---

### Inner Loop vs. Outer Loop
Modern software development is split into two distinct lifecycle loops:
- **The Inner Loop:** The developer's local workflow. It consists of writing code, running local builds, starting local containers, debugging, and running unit tests on their workstation. Fast iteration here is critical (ideally measured in seconds).
- **The Outer Loop:** Begins when the developer pushes code to the shared repository. It involves code reviews, automated CI pipelines, integration testing, vulnerability scans, container image registry uploads, and environment deployments (Staging/Production).

---

### Immutable Infrastructure (Cattle vs. Pets)
- **Pets (Mutable):** Traditional servers that are manually configured, patched, and kept alive for years. If a Pet server fails, it requires intensive debugging.
- **Cattle (Immutable):** Infrastructure that is never modified after deployment. If a change is needed (a configuration update, patch, or new release), a new server or container is built from a template/image, deployed, and the old one is terminated.
- **Philosophy:** Immutable infrastructure guarantees environment parity, eliminates configuration drift, and makes deployments highly predictable and repeatable.

---

### Shift Left
- **The Philosophy:** Moving tasks (like testing, security scanning, performance auditing, and compliance validation) as early as possible in the software development lifecycle.
- **Why it matters:** Fixing a security vulnerability or bug in the local editor or pull request phase is orders of magnitude cheaper and faster than fixing it after it has reached production.

---

## 2. Delivery & Reconciliation Paradigms

### Declarative vs. Imperative
- **Imperative (How):** Running commands to reach a state (e.g., "Install this package, pull this repository, restart this service"). Shell scripts, Ansible, and manual procedures are imperative.
- **Declarative (What):** Describing the desired end state of the system (e.g., "I want 3 container replicas running version 1.2.0, exposed on port 80"). Terraform, Kubernetes YAMLs, and Flux/ArgoCD resources are declarative.
- **Philosophy:** Modern delivery pipelines favor declarative definitions because they are version-controlled, auditable, and self-healing.

---

### Push-based vs. Pull-based CD
- **Push-based (Imperative CD):** The CI tool (e.g., GitHub Actions, GitLab CI) executes commands to connect to the target environment (e.g., via SSH or `kubectl`) and deploy the application.
  - *Risk:* The CI tool requires administrative credentials to the target cluster/infrastructure, creating a large security blast radius if the CI runner is compromised.
- **Pull-based (Declarative GitOps):** An agent (e.g., ArgoCD, Flux) runs inside the target cluster and continuously polls Git/Registries. When it detects a new release, it pulls the manifests and reconciles the state locally.
  - *Benefit:* Cluster credentials never leave the cluster network, and security boundaries are tightly preserved.

---

### Continuous Reconciliation & Self-Healing
- **The Concept:** Traditional deployments are point-in-time events. Once complete, there is no guarantee the system stays in that state.
- **Continuous Reconciliation:** The deployment operator continuously compares the active system state with the declared state in Git.
- **Self-Healing:** If an operator manually modifies a resource in the cluster (e.g., changing replicas or ports), the GitOps controller automatically overwrites it to match the source of truth in Git, eliminating ad-hoc changes.

---

## 3. Branching & Release Philosophies

### Trunk-Based Development vs. Git Flow
- **Git Flow:** Utilizes long-lived feature branches, release branches, and separate `develop` and `master` branches.
  - *Pros:* High isolation, structured release cycles.
  - *Cons:* Promotes massive merge conflicts ("merge hell") and delays integration feedback.
- **Trunk-Based Development:** Developers merge small, frequent changes directly into the main branch (the trunk) multiple times a day.
  - *Pros:* Eliminates merge conflicts, keeps code integrated, accelerates feedback.
  - *Cons:* Requires automated test suites and feature flags to protect production.

---

### Decoupling Deployment from Release
- **Deployment:** The technical act of installing, configuring, and running a new version of software in an environment (e.g., shipping code to production servers).
- **Release:** The business decision to expose that new functionality to customers or users.
- **Tooling:** This decoupling is accomplished via **Feature Flags** (toggles) or **Canary Traffic Shifting**. Developers can safely deploy untested or incomplete code to production in a dormant state, and release it dynamically without running a new deployment pipeline.
