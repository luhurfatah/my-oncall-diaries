# Platform Engineering Lab Series

> *Comprehensive 15-part hands-on curriculum building an Internal Developer Platform (IDP) with Backstage, Crossplane, and Argo CD. Progresses from container orchestration basics to enterprise-grade self-service infrastructure golden paths.*

| Lab | Topic | Description |
| :---: | :--- | :--- |
| **Lab 01** | [Platform Engineering Fundamentals](lab-01-fundamentals.md) | Understanding IDP concepts, developer cognitive load, the Golden Triangle, and architecture patterns. |
| **Lab 02** | [Kubernetes Foundation & Cluster Setup](lab-02-k8s-foundation.md) | Cluster validation, namespace isolation, deployments, services, ConfigMaps, Secrets, RBAC, and Helm setup. |
| **Lab 03** | [GitOps with Argo CD: Installation & Basics](lab-03-gitops-basics.md) | Installing Argo CD, configuring repo connectors, manual vs. automatic sync, and pull-based delivery. |
| **Lab 04** | [Argo CD & Helm: Dynamic Deployments](lab-04-argocd-helm.md) | Packaging application manifests into Helm charts, variable parameterization, and Argo CD tracking. |
| **Lab 05** | [Crossplane Installation & Cloud Providers](lab-05-crossplane-install.md) | Installing Crossplane, setting up AWS/Azure provider credentials, OIDC, and custom controller states. |
| **Lab 06** | [Provisioning Primitive Managed Resources (MRs)](lab-06-managed-resources.md) | Deploying cloud-managed VPCs, subnets, database nodes, and storage buckets using direct HCL-free manifests. |
| **Lab 07** | [Encapsulation with Compositions & XRDs](lab-07-compositions-xrds.md) | Defining Composite Resource Definitions (XRDs) and Compositions to bundle cloud resources into developer APIs. |
| **Lab 08** | [Backstage Portal Setup & Cataloging](lab-08-backstage-setup.md) | Deploying Backstage, defining organizational models, setting up catalog entities, and custom dashboards. |
| **Lab 09** | [Golden Paths via Software Templates](lab-09-software-templates.md) | Writing Software Templates in YAML to automate repository bootstrapping, CI setups, and catalog registration. |
| **Lab 10** | [GitOps for IaC: Pipeline Integrations](lab-10-gitops-iac.md) | Connecting Crossplane provisioning with Argo CD GitOps pipelines to deliver automated infra-on-commit. |
| **Lab 11** | [Argo CD ApplicationSets: Scaling Multi-Tenancy](lab-11-applicationsets.md) | Automating multi-cluster and multi-environment application generator pipelines using dynamic ApplicationSets. |
| **Lab 12** | [Advanced Compositions & Environment Patching](lab-12-advanced-compositions.md) | Designing advanced Crossplane patches, nesting resource groups, and handling conditional parameter overrides. |
| **Lab 13** | [Backstage Plugin Integrations](lab-13-backstage-plugins.md) | Configuring Argo CD, Kubernetes, and Prometheus plugins to render live runtime environments in Backstage. |
| **Lab 14** | [Assembling the Full Internal Developer Platform (IDP)](lab-14-full-idp.md) | Orchestrating software templates, Crossplane provisioning, and Argo CD GitOps into a unified developer portal. |
| **Lab 15** | [Platform Security & Day-2 Observability](lab-15-security-observability.md) | Implementing resource limits, security scans, network policies, and deploying Prometheus-Grafana telemetry. |
