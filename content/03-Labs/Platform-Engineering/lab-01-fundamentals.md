# Lab 01 — Platform Engineering Fundamentals

> **Difficulty**: Beginner | **Duration**: 1.5 hours | **Type**: Conceptual + Exploration

---

## 🎯 Objectives

By the end of this lab, you will:

- Understand what Platform Engineering is and why it exists
- Know the difference between Platform Engineering, DevOps, and SRE
- Understand the concept of an Internal Developer Platform (IDP)
- Learn the "Golden Triangle" architecture: **Backstage + Argo CD + Crossplane**
- Map the end-to-end developer self-service workflow
- Set up your mental model for the entire lab series

---

## 📋 Prerequisites

- Basic understanding of software development lifecycle
- Familiarity with cloud computing concepts (VMs, databases, networking)
- Basic knowledge of containers and Kubernetes (helpful but not required)

---

## 📚 Part 1: What is Platform Engineering?

### The Problem: Developer Cognitive Overload

Modern software teams face an explosion of tools and infrastructure complexity:

```
Developer in 2015:          Developer in 2025:
─────────────────           ─────────────────
• Write code                • Write code
• Deploy to server          • Write Dockerfile
                            • Configure CI/CD pipeline
                            • Manage Kubernetes manifests
                            • Set up monitoring & alerting
                            • Configure service mesh
                            • Manage cloud IAM policies
                            • Handle secrets management
                            • Set up database migrations
                            • Configure networking/ingress
                            • Manage multiple environments
                            • Deal with compliance/security
```

The average developer now needs to understand **20+ tools** just to ship a feature. This is unsustainable.

### The Solution: Platform Engineering

**Platform Engineering** is the discipline of designing and building **self-service capabilities** that reduce cognitive load for developers while maintaining organizational standards.

> 💡 **Key Insight**: Platform Engineering is NOT about removing developer autonomy. It's about providing **paved roads** (Golden Paths) that make the right thing the easy thing.

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Self-Service** | Developers provision what they need without tickets or waiting |
| **Golden Paths** | Pre-built, opinionated workflows that encode best practices |
| **Abstraction** | Hide complexity, expose only what developers need to decide |
| **Guardrails, Not Gates** | Enable speed with built-in compliance and security |
| **Product Thinking** | Treat the platform as a product; developers are your customers |

---

## 📚 Part 2: Platform Engineering vs. DevOps vs. SRE

These are **complementary** disciplines, not competitors:

```
┌──────────────────────────────────────────────────────────────────┐
│                         Organization                             │
│                                                                  │
│  ┌─────────────┐   ┌─────────────┐   ┌──────────────────────┐   │
│  │   DevOps    │   │     SRE     │   │ Platform Engineering │   │
│  │             │   │             │   │                      │   │
│  │ Culture &   │   │ Reliability │   │ Self-Service         │   │
│  │ Practices   │   │ & Operations│   │ Infrastructure       │   │
│  │             │   │             │   │                      │   │
│  │ • CI/CD     │   │ • SLOs/SLIs │   │ • Internal Developer │   │
│  │ • IaC       │   │ • Incident  │   │   Platform (IDP)     │   │
│  │ • Collab    │   │   Response  │   │ • Golden Paths       │   │
│  │ • Automation│   │ • Toil      │   │ • Developer Portal   │   │
│  │             │   │   Reduction │   │ • Self-Service APIs  │   │
│  └─────────────┘   └─────────────┘   └──────────────────────┘   │
│                                                                  │
│  Focus: HOW         Focus: HOW        Focus: WHAT               │
│  teams work         to keep it        to build for              │
│  together           running           developers                 │
└──────────────────────────────────────────────────────────────────┘
```

| Aspect | DevOps | SRE | Platform Engineering |
|--------|--------|-----|---------------------|
| **Focus** | Culture & collaboration | Reliability & operations | Developer self-service |
| **Goal** | Break silos between Dev & Ops | Keep systems reliable | Reduce developer cognitive load |
| **Metric** | Deployment frequency, lead time | SLOs, error budgets, MTTR | Developer satisfaction, time-to-production |
| **Output** | CI/CD pipelines, automation | Monitoring, incident response | Internal Developer Platform |

---

## 📚 Part 3: The Internal Developer Platform (IDP)

### What is an IDP?

An **Internal Developer Platform** is a layer of technology and tooling that a platform team builds and maintains to enable developer self-service.

```
┌──────────────────────────────────────────────────────────┐
│                    Developer Experience                    │
│  ┌────────────────────────────────────────────────────┐   │
│  │              Developer Portal (UI)                 │   │
│  │         (Backstage / Port / Cortex)                │   │
│  └──────────────────────┬─────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────▼─────────────────────────────┐   │
│  │            Integration & Delivery Layer            │   │
│  │         (Argo CD / Flux / Tekton)                  │   │
│  └──────────────────────┬─────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────▼─────────────────────────────┐   │
│  │              Infrastructure Control Plane          │   │
│  │      (Crossplane / Terraform / Pulumi)             │   │
│  └──────────────────────┬─────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────▼─────────────────────────────┐   │
│  │              Cloud / On-Prem Resources             │   │
│  │       (AWS / Azure / GCP / On-Premises)            │   │
│  └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### The Five Core Capabilities of an IDP

1. **Service Catalog** — "What do we have?"
   - Central registry of all services, APIs, libraries, and infrastructure
   - Ownership, documentation, dependencies, and health status

2. **Self-Service Provisioning** — "I need a thing"
   - Developers can spin up environments, databases, and services
   - No tickets, no waiting for ops team

3. **Golden Paths** — "How should I build this?"
   - Pre-built templates for common patterns (new microservice, new API, etc.)
   - Encode organizational best practices

4. **Visibility & Observability** — "What's happening?"
   - Unified view of deployments, infrastructure, and application health
   - Single pane of glass for the developer

5. **Governance & Compliance** — "Are we doing it right?"
   - Automated policy enforcement
   - Audit trails and compliance checks

---

## 📚 Part 4: The Golden Triangle — Our Toolchain

Throughout this lab series, we will build an IDP using three best-in-class open-source tools:

### The Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│    👨‍💻 Developer                                              │
│       │                                                      │
│       │  1. "I need a new service                            │
│       │      with a database"                                │
│       ▼                                                      │
│  ┌─────────────────────────────────────────────┐             │
│  │           🎭 BACKSTAGE (Portal)             │             │
│  │                                             │             │
│  │  • Software Catalog                         │             │
│  │  • Software Templates (Scaffolder)          │             │
│  │  • TechDocs                                 │             │
│  │  • Plugin Ecosystem                         │             │
│  └────────────────┬────────────────────────────┘             │
│                   │                                          │
│                   │  2. Generates manifests                  │
│                   │     & commits to Git                     │
│                   ▼                                          │
│  ┌─────────────────────────────────────────────┐             │
│  │          📦 GIT REPOSITORY                  │             │
│  │                                             │             │
│  │  • Kubernetes manifests                     │             │
│  │  • Crossplane Claims                        │             │
│  │  • Helm values                              │             │
│  │  • Kustomize overlays                       │             │
│  └────────────────┬────────────────────────────┘             │
│                   │                                          │
│                   │  3. Detects changes                      │
│                   │     & reconciles                         │
│                   ▼                                          │
│  ┌─────────────────────────────────────────────┐             │
│  │          🔄 ARGO CD (GitOps)                │             │
│  │                                             │             │
│  │  • Continuous Reconciliation                │             │
│  │  • Drift Detection                          │             │
│  │  • Sync Policies                            │             │
│  │  • Multi-Cluster Management                 │             │
│  └────────────────┬────────────────────────────┘             │
│                   │                                          │
│                   │  4. Applies manifests                    │
│                   │     to cluster                           │
│                   ▼                                          │
│  ┌─────────────────────────────────────────────┐             │
│  │        ☁️  CROSSPLANE (IaC)                 │             │
│  │                                             │             │
│  │  • Composite Resource Definitions (XRDs)    │             │
│  │  • Compositions                             │             │
│  │  • Provider-AWS / Azure / GCP               │             │
│  │  • Managed Resources                        │             │
│  └────────────────┬────────────────────────────┘             │
│                   │                                          │
│                   │  5. Provisions real                      │
│                   │     cloud resources                      │
│                   ▼                                          │
│  ┌─────────────────────────────────────────────┐             │
│  │        ☁️  CLOUD RESOURCES                  │             │
│  │                                             │             │
│  │  • RDS Database                             │             │
│  │  • S3 Buckets                               │             │
│  │  • VPCs & Subnets                           │             │
│  │  • EKS/AKS/GKE Clusters                    │             │
│  └─────────────────────────────────────────────┘             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Tool Overview

#### 🎭 Backstage — The Developer Portal

| Aspect | Details |
|--------|---------|
| **Created by** | Spotify (2020), donated to CNCF |
| **Purpose** | Developer portal / service catalog / self-service UI |
| **Key Features** | Software Catalog, Software Templates, TechDocs, Plugin ecosystem |
| **Language** | TypeScript (React frontend, Node.js backend) |
| **Why it matters** | Single pane of glass for developers; eliminates context switching |

#### 🔄 Argo CD — The GitOps Engine

| Aspect | Details |
|--------|---------|
| **Created by** | Intuit (2018), CNCF Graduated project |
| **Purpose** | Declarative, GitOps continuous delivery for Kubernetes |
| **Key Features** | Auto-sync, drift detection, rollbacks, multi-cluster, ApplicationSets |
| **How it works** | Watches Git repos, reconciles cluster state to match Git |
| **Why it matters** | Git becomes the single source of truth for ALL infrastructure |

#### ☁️ Crossplane — The Infrastructure Control Plane

| Aspect | Details |
|--------|---------|
| **Created by** | Upbound (2018), CNCF Incubating project |
| **Purpose** | Manage cloud infrastructure using Kubernetes APIs |
| **Key Features** | Compositions, XRDs, multi-cloud providers, Claims |
| **How it works** | Extends Kubernetes with CRDs to provision cloud resources |
| **Why it matters** | Infrastructure becomes Kubernetes-native; no separate IaC tool needed |

### Why This Combination?

```
Traditional Approach:              Golden Triangle:
───────────────────                ─────────────────
Jira ticket → Ops team             Backstage template → Git commit
Wait 3 days                        Argo CD auto-sync (seconds)
Manual Terraform apply             Crossplane auto-provision
Email back with credentials        Status in Backstage catalog
                                   
Time: 3-5 days                     Time: 5-15 minutes
Audit trail: Email threads         Audit trail: Git history
Reproducible: Maybe                Reproducible: Always
```

---

## 📚 Part 5: Key Concepts Deep Dive

### GitOps Principles

GitOps is a set of practices where **Git is the single source of truth** for declarative infrastructure and applications.

**The Four Principles of GitOps (OpenGitOps):**

1. **Declarative** — All system state is described declaratively
2. **Versioned & Immutable** — The desired state is stored in Git (versioned, immutable history)
3. **Pulled Automatically** — Agents pull the desired state from Git and apply it
4. **Continuously Reconciled** — Agents continuously observe and correct drift

```
┌─────────┐     push      ┌─────────┐    pull/watch    ┌──────────┐
│Developer│ ──────────────▶│   Git   │◀────────────────│ Argo CD  │
└─────────┘               └─────────┘                  └────┬─────┘
                                                            │
                                                            │ reconcile
                                                            ▼
                                                       ┌──────────┐
                                                       │Kubernetes│
                                                       │ Cluster  │
                                                       └──────────┘
```

### Infrastructure as Code (IaC) with Crossplane

Traditional IaC (Terraform, CloudFormation) uses **separate tools and state files**. Crossplane is different:

| Aspect | Terraform | Crossplane |
|--------|-----------|------------|
| **State** | External state file (S3, etc.) | Kubernetes etcd (built-in) |
| **API** | HCL / Terraform CLI | Kubernetes API (`kubectl`) |
| **Reconciliation** | Manual `terraform apply` | Continuous (control loop) |
| **Drift Detection** | Manual `terraform plan` | Automatic & continuous |
| **Abstraction** | Modules | Compositions & XRDs |
| **Access Control** | Custom IAM | Kubernetes RBAC |
| **Integration** | External | Native to Kubernetes ecosystem |

### The Kubernetes Control Loop

Understanding this pattern is **critical** — it's how ALL three tools work:

```
     ┌──────────────────────────────────────────┐
     │                                          │
     │   1. OBSERVE                             │
     │   Read current state                     │
     │          │                               │
     │          ▼                               │
     │   2. COMPARE                             │
     │   Current state vs. Desired state        │
     │          │                               │
     │          ▼                               │
     │   3. ACT                                 │
     │   Make changes to reach desired state    │
     │          │                               │
     │          └──────────────────────────┐    │
     │                                     │    │
     └─────────────────────────────────────┘    │
                        ▲                       │
                        │     Continuous Loop    │
                        └───────────────────────┘
```

- **Argo CD**: Observes Git, compares to cluster, applies changes
- **Crossplane**: Observes CRDs, compares to cloud state, provisions/updates resources
- **Kubernetes**: Observes pod specs, compares to running pods, creates/kills pods

---

## 🔬 Hands-On Exercise: Explore the Ecosystem

Even though this lab is primarily conceptual, let's get familiar with the tools by exploring their documentation and communities.

### Exercise 1: Explore the CNCF Landscape

1. Open the CNCF Landscape: https://landscape.cncf.io/
2. Find these projects and note their maturity level:
   - **Argo** (under App Definition and Development → Continuous Integration & Delivery)
   - **Crossplane** (under Provisioning → Automation & Configuration)
   - **Backstage** (under App Definition and Development → Application Definition & Image Build)

3. Answer these questions:
   - What is the CNCF maturity level of each project? (Sandbox → Incubating → Graduated)
   - How many contributors does each project have?
   - What companies are behind each project?

### Exercise 2: Review the Official Documentation

Spend 15 minutes exploring each:

1. **Backstage**: https://backstage.io/docs
   - Read the "What is Backstage?" page
   - Explore the plugin marketplace

2. **Argo CD**: https://argo-cd.readthedocs.io/
   - Read the "Overview" and "Core Concepts" pages
   - Look at the Architecture diagram

3. **Crossplane**: https://crossplane.io/docs/
   - Read the "Introduction" page
   - Understand the provider model

### Exercise 3: Map Your Organization (Thought Exercise)

Think about your current organization (or a hypothetical one) and answer:

```
1. How do developers currently request infrastructure?
   □ Jira tickets → Ops team
   □ Slack messages
   □ Self-service portal
   □ Direct cloud console access
   □ Other: ________________

2. How long does it take to provision a new environment?
   □ Minutes
   □ Hours
   □ Days
   □ Weeks

3. What is your current source of truth for infrastructure?
   □ Terraform state files
   □ Cloud console (ClickOps)
   □ Wiki/Confluence pages
   □ Git repositories
   □ "Ask Dave, he knows"

4. How do developers discover existing services?
   □ Service catalog
   □ README files
   □ Word of mouth
   □ grep through repos

5. Top 3 developer pain points:
   1. ________________
   2. ________________
   3. ________________
```

---

## ✅ Knowledge Check

Answer these questions to verify your understanding:

1. **What is the primary goal of Platform Engineering?**
   <details>
   <summary>Answer</summary>
   To reduce developer cognitive load by providing self-service capabilities and golden paths that encode organizational best practices.
   </details>

2. **What are the three layers of the Golden Triangle architecture?**
   <details>
   <summary>Answer</summary>
   
   - **Presentation Layer**: Backstage (Developer Portal)
   - **Delivery Layer**: Argo CD (GitOps Engine)
   - **Control Plane Layer**: Crossplane (Infrastructure as Code)
   </details>

3. **What are the four principles of GitOps?**
   <details>
   <summary>Answer</summary>
   
   1. Declarative
   2. Versioned & Immutable
   3. Pulled Automatically
   4. Continuously Reconciled
   </details>

4. **How does Crossplane differ from Terraform?**
   <details>
   <summary>Answer</summary>
   Crossplane uses the Kubernetes API and control loop for continuous reconciliation. State is stored in etcd (not an external state file). It provides native RBAC, drift detection is automatic, and it integrates natively with the Kubernetes ecosystem.
   </details>

5. **In the self-service workflow, what triggers Argo CD to sync?**
   <details>
   <summary>Answer</summary>
   A Git commit. When Backstage generates manifests and commits them to a Git repository, Argo CD detects the change and reconciles the cluster state to match.
   </details>

---

## 📝 Key Takeaways

- **Platform Engineering** is about building self-service capabilities for developers
- The **IDP** has 5 core capabilities: Catalog, Provisioning, Golden Paths, Visibility, and Governance
- The **Golden Triangle** (Backstage + Argo CD + Crossplane) provides a complete IDP stack
- **GitOps** makes Git the single source of truth for everything
- **Crossplane** brings IaC into the Kubernetes ecosystem with continuous reconciliation
- **Backstage** provides the developer-facing portal and self-service UI
- All three tools use the **Kubernetes control loop** pattern

---

## 🔗 References

- [CNCF Platform Engineering Whitepaper](https://tag-app-delivery.cncf.io/whitepapers/platforms/)
- [Backstage.io](https://backstage.io/)
- [Argo CD Documentation](https://argo-cd.readthedocs.io/)
- [Crossplane Documentation](https://crossplane.io/docs/)
- [OpenGitOps Principles](https://opengitops.dev/)
- [Team Topologies](https://teamtopologies.com/) — The book that formalized Platform Teams
- [Humanitec IDP Reference Architecture](https://humanitec.com/reference-architectures)

---

## ➡️ Next Lab

**[Lab 02 — Kubernetes Foundation & Cluster Setup](lab-02-kubernetes-foundation.md)**

In the next lab, we'll set up our Kubernetes environment using a Pluralsight sandbox and deploy our first workloads. This foundation is essential for everything that follows.
