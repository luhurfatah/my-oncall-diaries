# Industry Standard CI/CD References

This document serves as a curated list of foundational industry standards, frameworks, books, and articles that define modern Continuous Integration, Continuous Delivery, and Platform Engineering.

---

## 1. Core Frameworks & Metrics

### **DORA Metrics (DevOps Research and Assessment)**
Google Cloud’s DORA research identifies four key metrics that indicate the performance of a software development team. These are the gold standard for measuring CI/CD success:
- **Deployment Frequency:** How often an organization successfully releases to production.
- **Lead Time for Changes:** The amount of time it takes a commit to get into production.
- **Change Failure Rate:** The percentage of deployments causing a failure in production.
- **Time to Restore Service:** How long it takes an organization to recover from a failure in production.

🔗 *Reference:* [State of DevOps Report](https://cloud.google.com/devops/state-of-devops)

### **The Twelve-Factor App**
A methodology for building software-as-a-service (SaaS) apps that are portable and resilient across environments. Essential for any application being deployed via CI/CD.

🔗 *Reference:* [12factor.net](https://12factor.net/)

### **OpenGitOps Principles**
A set of open-source standards defining what GitOps is, maintained by the CNCF. It defines the four pillars: Declarative, Versioned/Immutable, Pulled Automatically, and Continuously Reconciled.

🔗 *Reference:* [opengitops.dev](https://opengitops.dev/)

---

## 2. Foundational Literature

### **Accelerate**
*By Nicole Forsgren, Jez Humble, and Gene Kim*
The scientific research behind DORA. It explains the capabilities that drive software delivery performance and organizational culture. This is considered required reading for Platform and DevOps Engineers.

### **Continuous Delivery**
*By Jez Humble and David Farley*
The foundational textbook that defined the automated deployment pipeline, explaining how to reliably release software at any time.

### **The Phoenix Project / The DevOps Handbook**
*By Gene Kim et al.*
Narrative and practical guides on how to transform an IT organization through DevOps principles, the "Three Ways" (Flow, Feedback, Continuous Learning), and CI/CD.

---

## 3. Foundational Articles & Guides

### **Continuous Integration by Martin Fowler**
The definitive original article explaining what CI is, why it matters, and the practices required (e.g., maintain a single source repository, automate the build, make the build self-testing, everyone commits every day).

🔗 *Reference:* [MartinFowler.com - Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html)

### **Git Branching Strategies**
Understanding branching is critical for pipeline triggers:
- **GitHub Flow:** A lightweight, branch-based workflow that supports teams and projects where deployments are made regularly. ([GitHub Flow Guide](https://docs.github.com/en/get-started/using-github/github-flow))
- **GitLab Flow:** Introduces environment branches (e.g., staging, production) on top of feature branches. ([GitLab Flow Guide](https://docs.gitlab.com/ee/topics/gitlab_flow.html))
- **Trunk-Based Development:** A model where all developers commit directly to a single shared branch (trunk) multiple times a day, heavily relying on feature flags. ([TrunkBasedDevelopment.com](https://trunkbaseddevelopment.com/))

---

## 4. CNCF Landscape (Continuous Integration & Delivery)

The Cloud Native Computing Foundation (CNCF) maintains the definitive landscape of modern cloud-native tooling.
- **Graduated/Incubating Tools:** Argo CD, Flux, Tekton, Keptn, Jenkins.

🔗 *Reference:* [landscape.cncf.io](https://landscape.cncf.io/)
