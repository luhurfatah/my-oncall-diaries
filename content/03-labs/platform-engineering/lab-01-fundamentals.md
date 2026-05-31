# Lab 01 — Platform Engineering Fundamentals

## 🎯 Objectives

By the end of this lab, you will:

- Understand what Platform Engineering is and why it exists.
- Know the difference between Platform Engineering, DevOps, and SRE.
- Understand the concept of an Internal Developer Platform (IDP).
- Learn the "Golden Triangle" architecture: **Backstage + Argo CD + Crossplane**.
- Map the end-to-end developer self-service workflow.
- Set up your mental model for the entire lab series.

---

## 📋 Prerequisites

- Basic understanding of the software development lifecycle.
- Familiarity with cloud computing concepts (VMs, databases, networking).
- Basic knowledge of containers and Kubernetes (helpful but not required).

---

## 📚 Part 1: What is Platform Engineering?

### The Problem: Developer Cognitive Overload

Modern software teams face an explosion of tools and infrastructure complexity. Over the past decade, the scope of a software developer's job has expanded massively:

| Developer Scope (2015) | Developer Scope (2025) |
|---|---|
| **Core Responsibilities:**<br>• Write application code.<br>• Basic server deployments. | **Expanded Responsibilities:**<br>• Write application code.<br>• Write and configure Dockerfiles.<br>• Author complex CI/CD pipeline YAML definitions.<br>• Manage complex Kubernetes manifests.<br>• Set up application monitoring and alerts.<br>• Configure service meshes and ingress routing.<br>• Manage cloud IAM policies.<br>• Handle application secrets management.<br>• Set up database migrations.<br>• Configure networking across multi-environment nodes.<br>• Deal with compliance and security policy updates. |

The average developer now needs to understand **20+ tools** just to ship a feature. This cognitive overload is unsustainable.

### The Solution: Platform Engineering

**Platform Engineering** is the discipline of designing and building **self-service capabilities** that reduce cognitive load for developers while maintaining organizational standards.

> 💡 **Key Insight**: Platform Engineering is NOT about removing developer autonomy. It's about providing **paved roads** (Golden Paths) that make the right thing the easy thing.

### Core Principles

| Principle | Description |
|---|---|
| **Self-Service** | Developers provision what they need without tickets or manual wait times. |
| **Golden Paths** | Pre-built, opinionated workflows that automatically encode best practices. |
| **Abstraction** | Hide unnecessary infrastructure complexity; expose only what developers need to decide. |
| **Guardrails, Not Gates** | Enable rapid deployments with built-in compliance and security controls. |
| **Product Thinking** | Treat the platform as a product; developers are your active customers. |

---

## 📚 Part 2: Platform Engineering vs. DevOps vs. SRE

These are **complementary** disciplines, not competitors. They focus on different dimensions of organizational scaling:

- **DevOps (Culture & Practices):** Focuses on the cultural shifts and automation required to break down silos between development and operations. Focuses on *how* teams work together.
- **SRE (Reliability & Operations):** Focuses on the reliability, availability, scaling, and recovery of live production environments. Focuses on *how* to keep it running.
- **Platform Engineering (Self-Service Infrastructure):** Focuses on building the developer-facing platform that encapsulates DevOps and SRE practices into standard APIs. Focuses on *what* to build for developers.

### Discipline Alignment

| Aspect | DevOps | SRE | Platform Engineering |
|---|---|---|---|
| **Focus** | Culture & collaboration | Reliability & operations | Developer self-service |
| **Goal** | Break silos between Dev & Ops | Keep systems reliable | Reduce developer cognitive load |
| **Metric** | Deployment frequency, lead time | SLOs, error budgets, MTTR | Developer satisfaction, time-to-production |
| **Output** | CI/CD pipelines, automation | Monitoring, incident response | Internal Developer Platform (IDP) |

---

## 📚 Part 3: The Internal Developer Platform (IDP)

### What is an IDP?

An **Internal Developer Platform** is a layer of technology and tooling that a platform team builds and maintains to enable developer self-service. It acts as an integration layer between developers and the underlying cloud infrastructure.

### The Four Core Layers of an IDP

1.  **Developer Experience / Portal Layer (UI):** The developer-facing dashboard (e.g., Backstage, Port) that acts as the single pane of glass for cataloging and self-service creation.
2.  **Integration & Delivery Layer (GitOps):** The automated engine (e.g., Argo CD, Flux) that synchronizes Git manifests with the target execution clusters.
3.  **Infrastructure Control Plane Layer (IaC):** The declarative orchestrator (e.g., Crossplane, Terraform) that provisions, reconciles, and manages cloud resources natively.
4.  **Cloud / On-Prem Resources Layer (Infra):** The physical or virtual infrastructure endpoints (e.g., AWS, Azure, GCP, on-prem Kubernetes clusters).

### The Five Core Capabilities of an IDP

- **Service Catalog:** A central registry of all active services, APIs, libraries, and infrastructure with clear ownership, documentation, and health metrics.
- **Self-Service Provisioning:** Allowing developers to instantly spin up environments, databases, and message queues without opening manual tickets.
- **Golden Paths:** YAML-defined templates that automate standard repository boot-ups with correct code architecture and default pipeline setups.
- **Visibility & Observability:** A unified, single-pane-of-glass dashboard displaying active deployments, service connections, and telemetry metrics.
- **Governance & Compliance:** Continuous, shift-left policy engines enforcing standards silently behind the scenes.

---

## 📚 Part 4: The Golden Triangle — Our Toolchain

Throughout this lab series, we will build an IDP using three best-in-class open-source tools:

### The Self-Service Workflow

1.  **Developer Action:** A developer accesses **Backstage** and triggers a "Create New Microservice" template.
2.  **Manifest Generation:** Backstage generates the application code, Kubernetes manifests, and Crossplane infrastructure claims, committing them directly to a **Git Repository**.
3.  **GitOps Sync:** **Argo CD** detects the new commits in Git and reconciles the target Kubernetes cluster to match the declared state.
4.  **IaC Provisioning:** **Crossplane** reads the infrastructure claims applied to the cluster, compares them with the target cloud provider state, and provisions the physical AWS/Azure S3 buckets, RDS nodes, and VPC resources.
5.  **Status Propagation:** The live resource status and credentials are fed back to the Backstage service catalog for developer consumption.

### Tool Overview

#### 🎭 Backstage — The Developer Portal

- **Origin:** Created by Spotify (2020), donated to the CNCF.
- **Purpose:** Developer portal / service catalog / self-service UI.
- **Key Features:** Software Catalog, Software Templates (Scaffolder), TechDocs, and a rich Plugin ecosystem.
- **Implementation:** TypeScript (React frontend, Node.js backend).
- **Platform Value:** Eliminates context switching by gathering status, docs, and integrations in a single workspace.

#### 🔄 Argo CD — The GitOps Engine

- **Origin:** Created by Intuit (2018), CNCF Graduated project.
- **Purpose:** Declarative, GitOps continuous delivery engine for Kubernetes environments.
- **Key Features:** Auto-sync, real-time drift detection, automatic rollbacks, and multi-cluster ApplicationSets.
- **Implementation:** Go-based continuous reconciliation controller.
- **Platform Value:** Git becomes the immutable source of truth for both code and environment configurations.

#### ☁️ Crossplane — The Infrastructure Control Plane

- **Origin:** Created by Upbound (2018), CNCF Incubating project.
- **Purpose:** Manage cloud infrastructure using Kubernetes-native APIs and resource definitions.
- **Key Features:** Composite Resource Definitions (XRDs), Compositions, multi-cloud Providers, and developer Claims.
- **Implementation:** Kubernetes-native CRD controller.
- **Platform Value:** Unifies application and infrastructure management into a single, continuously reconciled control loop.

### Comparative Workflow Delivery

| Architectural Metric | Traditional Ticket-Based Approach | Golden Triangle IDP Approach |
|---|---|---|
| **Trigger Mechanism** | Manual Jira tickets submitted to ops. | Backstage template commit to Git. |
| **Delivery Time** | 3 to 5 business days of backlog waiting. | 5 to 15 minutes of fully automated sync. |
| **IaC Execution** | Manual local `terraform apply` runs. | Continuous, provider-driven Crossplane sync. |
| **Audit Trails** | Scattered Slack threads and emails. | Immutable Git commit history and pull requests. |
| **Fidelity Parity** | High drift and manual "snowflake" states. | 100% reproducible environments. |

---

## 📚 Part 5: Key Concepts Deep Dive

### GitOps Principles

GitOps is a set of operational practices where **Git is the single source of truth** for declarative systems. It is built on four core pillars:

1.  **Declarative:** The entire environment and system state is described declaratively in code.
2.  **Versioned & Immutable:** Desired states are locked in Git, creating an immutable history of changes.
3.  **Pulled Automatically:** In-cluster agents continuously pull the desired state from Git, eliminating push-access requirements for builders.
4.  **Continuously Reconciled:** The system runs a continuous control loop, automatically correcting configuration drift between Git and live resources.

### Infrastructure as Code: Terraform vs. Crossplane

Crossplane shifts the IaC paradigm from client-side execution to server-side continuous reconciliation:

| Operational Dimension | Terraform (Pushed Engine) | Crossplane (Continuous Control Plane) |
|---|---|---|
| **State Storage** | External JSON file (S3/DynamoDB locks). | Native Kubernetes etcd database. |
| **API Interface** | HashiCorp Configuration Language (HCL). | Standard Kubernetes API (`kubectl` / JSON / YAML). |
| **Reconciliation** | Client-side `terraform apply` triggers. | Server-side continuous controller loop. |
| **Drift Correction** | Manual planning cycles (`terraform plan`). | Real-time automated cloud override corrections. |
| **Abstraction Layer** | Custom parameterized modules. | Composite Resource Definitions (XRDs) / Compositions. |
| **RBAC Integration** | Custom provider permissions. | Native Kubernetes RBAC profiles. |

### The Kubernetes Control Loop Pattern

All components of our Platform engineering stack rely on the same fundamental three-step loop:

1.  **Observe:** Read the actual live state of the cloud resources or cluster assets.
2.  **Compare:** Calculate the delta between the actual state and the declared desired state.
3.  **Act:** Execute provider API calls to close the gap and reconcile the systems.

---

## 🔬 Hands-On Exercise: Explore the Ecosystem

Even though this lab is primarily conceptual, let's get familiar with the tools by exploring their documentation and communities.

### Exercise 1: Explore the CNCF Landscape

1.  Open the CNCF Landscape: [landscape.cncf.io](https://landscape.cncf.io/)
2.  Locate these key projects in the taxonomy:
    - **Argo:** Under App Definition and Development → Continuous Integration & Delivery.
    - **Crossplane:** Under Provisioning → Automation & Configuration.
    - **Backstage:** Under App Definition and Development → Application Definition & Image Build.
3.  Note their CNCF maturity level (Sandbox, Incubating, or Graduated), active contributor counts, and the primary enterprise maintainers sponsoring their development.

### Exercise 2: Review the Official Documentation

Spend 15 minutes exploring each:

1.  **Backstage:** [backstage.io/docs](https://backstage.io/docs)
    - Read the core architecture concepts.
    - Explore the active plugin marketplace.
2.  **Argo CD:** [argo-cd.readthedocs.io](https://argo-cd.readthedocs.io/)
    - Review the continuous reconciliation engine details.
    - Analyze the primary cluster connection patterns.
3.  **Crossplane:** [crossplane.io/docs](https://crossplane.io/docs/)
    - Understand the architectural distinction between Managed Resources (MRs) and Composites (XRs).
    - Review the cloud provider installation workflows.

### Exercise 3: Map Your Organization (Thought Exercise)

Evaluate your current organizational processes across the following dimensions:

#### 1. Infrastructure Provisioning Requests
- **Process:** Are resources requested via Jira tickets, manual Slack messages, direct cloud console click-ops, or custom scripts?
- **Cycle Time:** Does it take minutes, hours, days, or weeks to get a new environment stood up?

#### 2. Service Discovery and Parity
- **Source of Truth:** Does your infrastructure state live in version-controlled Git repos, floating local Terraform states, or a wiki page?
- **Discovery Method:** How do developers locate existing endpoints and services? (Unified catalog, README files, or word of mouth).

---

## ✅ Knowledge Check

Answer these questions to verify your understanding:

1.  **What is the primary goal of Platform Engineering?**
    <details>
    <summary>Answer</summary>
    To reduce developer cognitive load by providing standardized self-service capabilities and golden paths that automate organizational best practices.
    </details>

2.  **What are the three layers of the Golden Triangle architecture?**
    <details>
    <summary>Answer</summary>
    - **Presentation Layer:** Backstage (Developer Portal / UI).
    - **Delivery Layer:** Argo CD (GitOps Synchronization Engine).
    - **Control Plane Layer:** Crossplane (Continuous Cloud Orchestration Plane).
    </details>

3.  **What are the four principles of GitOps?**
    <details>
    <summary>Answer</summary>
    1. Declarative declarations.
    2. Versioned and immutable state tracking.
    3. Pull-based automated delivery.
    4. Continuous runtime reconciliation.
    </details>

4.  **How does Crossplane differ from Terraform?**
    <details>
    <summary>Answer</summary>
    Crossplane runs continuously server-side using the Kubernetes control loop pattern, keeping state in the etcd database. It monitors and overrides cloud drift automatically and continuously without manual developer plans.
    </details>

5.  **In the self-service workflow, what triggers Argo CD to sync?**
    <details>
    <summary>Answer</summary>
    A Git commit. When Backstage generates manifests and commits them to Git, Argo CD detects the new repository commit and synchronizes the target cluster resources.
    </details>

---

## 📝 Key Takeaways

- **Platform Engineering** builds standardized golden paths and self-service capabilities to support application teams.
- **The Golden Triangle** (Backstage + Argo CD + Crossplane) combines UI portal delivery, GitOps triggers, and continuous cloud orchestration.
- **GitOps** enforces Git as the absolute, immutable source of truth for both application code and cloud infrastructures.
- **The Control Loop** (Observe → Compare → Act) continuously runs behind the scenes to eliminate manual deployment steps and configuration drift.

---

## 🔗 References

- [CNCF Platform Engineering Whitepaper](https://tag-app-delivery.cncf.io/whitepapers/platforms/)
- [Backstage Portal Portal](https://backstage.io/)
- [Argo CD Documentation](https://argo-cd.readthedocs.io/)
- [Crossplane Documentation](https://crossplane.io/docs/)
- [OpenGitOps Principles](https://opengitops.dev/)
- [Team Topologies Guide](https://teamtopologies.com/) — Operational models for platform teams.
- [Humanitec IDP Reference Architecture](https://humanitec.com/reference-architectures)

---

## ➡️ Next Lab

**[Lab 02 — Kubernetes Foundation & Cluster Setup](lab-02-k8s-foundation.md)**

In the next lab, we will validate our Kubernetes baseline cluster environment in the sandbox, establish namespaces, and deploy application workloads declarative using Helm and YAML manifests.
