# CI/CD Interview Questions & Explanation

## Common Interview Questions

### Q1: What is the difference between Continuous Integration, Continuous Delivery, and Continuous Deployment?
- **Continuous Integration (CI):** The practice of automatically building and testing code changes frequently (usually daily or multiple times a day) when developers merge code to a shared repository.
- **Continuous Delivery (CD):** An extension of CI where code changes are automatically built, tested, and prepared for release to production. However, the actual deployment to production requires manual approval.
- **Continuous Deployment (CD):** The final stage of automation where every change that passes all stages of the production pipeline is automatically released to production without human intervention.

### Q2: What is the "Build Once, Deploy Many" pattern?
It is the practice of compiling or packaging your application code into a single immutable artifact (like a Docker image or a jar/binary) exactly once during the build phase of your pipeline. This same artifact is then promoted and deployed across all environments (Dev, Staging, Prod). Environment-specific configurations (like database credentials, API keys, or feature flags) are injected at runtime via environment variables, secrets managers, or configuration maps, rather than rebuilding the application for each environment. This ensures that the exact code tested in staging is what runs in production.

### Q3: What are the DORA metrics and why are they important?
DORA (DevOps Research and Assessment) metrics are four key indicators used to measure the performance of a software delivery team:
1. **Deployment Frequency (DF):** How often code is successfully deployed to production.
2. **Lead Time for Changes (LT):** The time it takes for a commit to go from code check-in to running in production.
3. **Change Failure Rate (CFR):** The percentage of deployments causing a failure in production that requires a rollback or hotfix.
4. **Mean Time to Restore (MTTR) / Time to Restore Service:** How long it takes to recover from a failure in production.

These metrics help teams balance speed (Deployment Frequency, Lead Time) and stability (Change Failure Rate, MTTR).

### Q4: How do you handle secrets and credentials securely in a CI/CD pipeline?
- **Never hardcode secrets** in application repositories or CI/CD configuration files (like YAML files).
- **Use CI/CD secret variables** (e.g., GitHub Actions Secrets, GitLab CI Variables) for environment-specific keys.
- **Integrate with centralized Secrets Managers** (like AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager) to fetch sensitive data dynamically during runtime or deployment.
- **Leverage OIDC (OpenID Connect)** or short-lived credentials for authenticating CI runners to cloud providers, avoiding long-lived static credentials.
- **Use secret scanning tools** (like TruffleHog or GitLeaks) as pre-commit hooks or pipeline steps to detect accidental commits of sensitive data.

### Q5: Explain the difference between Rolling, Blue/Green, and Canary deployments.
- **Rolling Update:** Gradually replaces instances of the old version of an application with the new version. It does not require double the resources, but during deployment, both versions run concurrently, which can cause issues if backward compatibility is not maintained.
- **Blue/Green Deployment:** Two identical physical or virtual environments exist (Blue is current production, Green is new release). The new version is deployed to Green and fully tested. Once ready, router/load balancer traffic is flipped to Green. It allows instant rollbacks, but requires double the hosting resources.
- **Canary Deployment:** Releases the new version to a tiny subset of users (e.g., 5%) while the rest stay on the old version. Metrics (error rates, latency) are monitored. If clean, the rollout continues to 100%. This minimizes the blast radius of potential failures.

### Q6: What is GitOps, and how does it change Continuous Delivery?
GitOps is a practice where Git is used as the single source of truth for declarative infrastructure and application deployments. In GitOps, an agent running inside the target cluster (like Argo CD or Flux) continuously monitors a Git repository containing the desired state of the system and automatically reconciles any drift between the Git repository and the active cluster. This shifts the deployment model from a "push" model (where CI scripts directly run deployment commands) to a "pull" model (where the cluster pulls configurations and applies them locally).

---

## CI/CD Topic Explanation

### What is CI/CD?
CI/CD stands for **Continuous Integration** and **Continuous Delivery** (or **Continuous Deployment**). It represents a set of operating principles, practices, and automated pipelines that enable software development teams to deliver code changes more frequently, reliably, and securely.

### Core Pillars of CI/CD
1. **Continuous Integration (CI):** The focus is on automating the feedback loop for developers. When code is pushed to a branch or pull request:
   - Automated linters check code style.
   - Static Application Security Testing (SAST) checks for security flaws.
   - Unit and integration tests validate the business logic.
   - An artifact is generated if all checks pass.
2. **Continuous Delivery (CD):** The focus is on automated release readiness. The artifact built in the CI stage is automatically deployed to a non-production environment (like staging) where automated integration, end-to-end (E2E), and performance tests are executed. Once verified, the release is parked, awaiting manual authorization (a push of a button) to deploy to production.
3. **Continuous Deployment (CD):** The ultimate goal of automation. The deployment to production is fully automated, relying entirely on the success of the upstream pipeline tests.

### Key Practices for High-Performing Pipelines
- **Fail Fast:** Configure the pipeline stages in order of cost and execution speed. Run linting and unit tests first. If they fail, stop the pipeline before executing expensive builds, integration tests, or security scans.
- **Immutable Infrastructure & Artifacts:** Never modify code, configuration files, or environments after they are created. If an issue is found, fix the source code, trigger a new build, and run the pipeline from the start.
- **Trunk-Based Development:** Encourage developers to make small, incremental changes on short-lived branches that are merged into the main branch frequently. This prevents merge conflicts and long feedback loops.
- **Environment Parity:** Keep your Dev, Staging, and Production environments as identical as possible in terms of OS versions, architecture, and network configurations to eliminate "works on my machine" issues.
