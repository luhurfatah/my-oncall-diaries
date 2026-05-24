# Infrastructure as Code (IaC) Interview Questions & Explanation

## Common Interview Questions

### Q1: What is Infrastructure as Code (IaC) and what are its key benefits?
Infrastructure as Code (IaC) is the practice of managing and provisioning computing infrastructure (servers, networks, databases, load balancers, etc.) through machine-readable definition files, rather than physical hardware configuration or interactive configuration tools.
- **Key Benefits:**
  - **Speed & Efficiency:** Automation eliminates manual human tasks, enabling rapid environment setup.
  - **Consistency:** Avoids "configuration drift" by ensuring the exact same configuration is deployed every time.
  - **Version Control:** IaC files live in Git, enabling peer review (Pull Requests), audit trails, and instant rollbacks.
  - **Reusability & Scalability:** Standardized modules can be shared across teams to provision resources instantly.

### Q2: What is the difference between Declarative and Imperative IaC?
- **Declarative (e.g., Terraform, CloudFormation, Kubernetes YAML):**
  - You define the **desired end state** of the infrastructure (e.g., "I want 3 EC2 instances and 1 VPC").
  - The IaC tool figures out the steps, dependencies, and ordering to reach that state.
  - Easier to maintain and keep in sync, as the code directly reflects what is running in the cloud.
- **Imperative (e.g., Ansible, AWS CLI scripts, Pulumi/SDK-based loops):**
  - You define the **exact steps/commands** to execute to configure resources (e.g., "Step 1: Create VPC, Step 2: Spin up EC2, Step 3: Configure server").
  - Requires writing logic for handling failures, dependencies, and state changes.

### Q3: Explain the role of the Terraform State file and how to secure it.
Terraform records the mapping between your configuration files and the real-world resources deployed in the cloud in a state file (`terraform.tfstate`).
- **Purpose:**
  - Tracks metadata (resource IDs, dependencies).
  - Determines which resources need to be created, modified, or destroyed.
  - Detects resource changes made outside of Terraform (drift).
- **Security & Best Practices:**
  - **Never commit state files to Git** (they contain sensitive information like database passwords in plain text).
  - Use **Remote Backends** (like Amazon S3, Azure Blob, or Terraform Cloud) to store the state file.
  - Enable **Encryption at Rest** (e.g., S3 bucket encryption) and **Transit Encryption**.
  - Implement **State Locking** (using DynamoDB or Consul) to prevent race conditions (two team members running plans concurrently, leading to corruption).

### Q4: What is Configuration Drift and how do you handle it in IaC?
Configuration drift occurs when manual updates, scripts, or cloud provider changes modify the live infrastructure, causing it to deviate from the state defined in the IaC source code.
- **Handling Drift:**
  - Run `terraform plan` to compare the actual state with the configuration. Terraform will output the differences.
  - **Reconciliation:** Apply the configuration again (`terraform apply`) to override manual changes, or update the IaC code to import and match the manual changes if they were intentional.
  - **Prevention:** Enforce strict IAM policies to block manual modifications in staging/production, requiring all changes to go through a GitOps CI/CD pipeline.

### Q5: What is the difference between Terraform Modules and Workspaces?
- **Modules:** Self-contained packages of Terraform configurations that manage a group of related resources (e.g., a "VPC module" that provisions subnets, NAT, and route tables). They enable code reusability, consistency, and clean organization across projects.
- **Workspaces:** Allow you to manage separate instances of the same configuration files on a single backend (e.g., running the same configuration for `dev` and `prod` environments). Each workspace has its own independent state file. Best for testing variations or managing small, identical envs (though many teams prefer separate folder structures for dev/prod to prevent accidental destruction).

### Q6: How does Terraform differ from configuration management tools like Ansible or Chef?
- **Provisioning vs. Configuration Management:**
  - **Terraform/CloudFormation:** Designed for **provisioning** infrastructure (creating networks, VMs, databases, routing). They excel at lifecycle management of cloud objects.
  - **Ansible/Chef/Puppet:** Designed for **configuration management** (installing software, running commands, copying files, managing system services *inside* already running VMs).
- **State Management:** Terraform is stateful and tracks resources in a state file; Ansible is stateless and relies on SSH to run tasks procedurally.
- **Common Pattern:** Use Terraform to provision the server and network infrastructure, then use Ansible or cloud-init/startup scripts to configure the software running inside those servers.

---

## Infrastructure as Code (IaC) Topic Explanation

### What is IaC?
Infrastructure as Code (IaC) is a methodology that treats infrastructure definitions in the same way software developers treat source code. By defining infrastructure in files, operations teams can apply software engineering practices (version control, automated testing, continuous integration) to physical and cloud resources.

### Evolution of Infrastructure Provisioning
1. **Manual Era:** Operators logged into cloud consoles or physical servers, clicking buttons or running ad-hoc terminal commands. This led to human errors, untrackable changes, and undocumented systems ("Snowflake Servers").
2. **Scripted Era:** Shell scripts or custom Python programs automated steps. Hard to scale, error-prone when updates failed mid-way, and lacked state management.
3. **Declarative IaC Era:** Modern tools emerged that manage the state of infrastructure dynamically, handling resource dependency graphs automatically (e.g., creating a subnet only after the VPC exists).

### Core Concepts of Terraform (The Industry Leader)
Terraform uses HashiCorp Configuration Language (HCL) and works in a simple lifecycle:
1. **`write`:** Define resources in `.tf` files.
2. **`init`:** Initializes the working directory, downloads required cloud provider plug-ins (e.g., AWS, Azure provider).
3. **`plan`:** Generates an execution plan showing what actions Terraform will take (create, update, delete) to match the configuration.
4. **`apply`:** Executes the actions proposed in the plan.
5. **`destroy`:** Removes all resources managed by the configuration.

### Best Practices in IaC
- **Immutable Infrastructure:** Instead of updating software packages in-place on running VMs, build a new golden image (using Packer), provision new servers, and terminate the old ones.
- **Keep States Small:** Don't put your entire global infrastructure in a single Terraform state file. Separate states by environment (Dev, Prod) and layer (Networking, Database, Application Compute) to limit the "blast radius" of code errors or corruptions.
- **Apply Policy-as-Code:** Integrate security scanning tools like Checkov, tfsec, or Open Policy Agent (OPA) into your CI/CD pipelines to validate that the IaC configuration adheres to security standards before it is applied (e.g., check that S3 buckets are not public).
