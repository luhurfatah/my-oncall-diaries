# AWS Interview Questions & Explanation

## Common Interview Questions

### Q1: What is a VPC, and what are its core components?
A **Virtual Private Cloud (VPC)** is a logically isolated virtual network dedicated to your AWS account. Its core components include:
- **Subnets:** Segments of a VPC's IP range where you can launch resources. Subnets can be Public (have a route to an Internet Gateway) or Private.
- **Route Tables:** A set of rules (routes) used to determine where network traffic is directed.
- **Internet Gateway (IGW):** Allows communication between instances in your VPC and the internet (attached to public subnets).
- **NAT Gateway:** Allows instances in private subnets to connect to the internet (e.g., for updates) but prevents the internet from initiating connections with them.
- **Security Groups & Network ACLs (NACLs):** Firewalls at the instance level (Security Groups) and subnet level (NACLs).

### Q2: What is the difference between a Security Group and a Network Access Control List (NACL)?
- **Security Group:** Operates at the **instance level** (e.g., EC2). Supports **allow rules only**. It is **stateful** (return traffic is automatically allowed, regardless of inbound rules). Evaluates all rules before deciding to allow traffic.
- **Network ACL (NACL):** Operates at the **subnet level**. Supports **allow and deny rules**. It is **stateless** (return traffic must be explicitly allowed by rules). Evaluates rules in numerical order (lowest to highest) and applies the first match.

### Q3: What is the difference between a Public Subnet and a Private Subnet?
- **Public Subnet:** Has a route table entry pointing to an **Internet Gateway (IGW)**, allowing resources (like web servers) to send and receive traffic directly to/from the internet, requiring public IP addresses.
- **Private Subnet:** Does not have a direct route to an IGW. Resources (like databases) have private IPs and can only access the internet outbound via a **NAT Gateway** located in a public subnet.

### Q4: Explain the difference between an Application Load Balancer (ALB) and a Network Load Balancer (NLB).
- **ALB:** Operates at **Layer 7 (Application Layer)**. Supports HTTP/HTTPS routing, path-based routing (e.g., `/api` vs `/static`), host-based routing, and target groupings (EC2, containers, Lambdas).
- **NLB:** Operates at **Layer 4 (Transport Layer)**. Handles TCP/UDP protocols, routing millions of requests per second with ultra-low latency. Provides a static IP address per Availability Zone and supports Elastic IP allocation.

### Q5: What are VPC Endpoints (PrivateLink), and why are they used?
VPC Endpoints allow you to privately connect your VPC to supported AWS services (like S3 or DynamoDB) and VPC endpoint services powered by PrivateLink without using an Internet Gateway, NAT Gateway, VPN, or Direct Connect. 
- **Types:** **Gateway Endpoints** (free, supports S3 and DynamoDB via route tables) and **Interface Endpoints** (provisioned as ENIs with private IPs, charges apply, powered by PrivateLink).
- **Benefit:** Traffic stays within the AWS network, improving security and reducing data transfer costs.

### Q6: What is AWS Transit Gateway?
AWS Transit Gateway acts as a cloud router, simplifying network topology by connecting VPCs, AWS accounts, and on-premises networks (via VPN or Direct Connect) through a central hub. It eliminates the need for complex mesh VPC peering relationships, scaling easily to thousands of VPCs.

### Q7: Explain the difference between Latency, Geoproximity, and Geolocation routing policies in Route 53.
- **Latency-based routing:** Routes traffic to the AWS region that provides the lowest network latency for the user.
- **Geolocation routing:** Routes traffic based on the geographic location of the user (e.g., users in Europe go to a EU server, users in Asia go to a Tokyo server).
- **Geoproximity routing:** Routes traffic based on the physical distance between your users and your resources, allowing you to shift traffic dynamically using a bias value.

### Q8: What is Amazon CloudFront, and how does it speed up content delivery?
Amazon CloudFront is a fast Content Delivery Network (CDN) service that securely delivers data, videos, applications, and APIs to customers globally with low latency. It caches static and dynamic content at **Edge Locations** closer to end-users, reducing load on the origin server (S3, EC2, or ALB).

### Q9: How does Route 53 health checking work with failover routing?
Route 53 continuously monitors the health of endpoints (via HTTP, HTTPS, or TCP requests). In a active-passive failover configuration, Route 53 routes all traffic to the primary resource. If the primary health check fails, Route 53 automatically updates DNS records to point to the secondary (passive) resource.

### Q10: What is the difference between AWS Client VPN and Site-to-Site VPN?
- **AWS Client VPN:** A client-based OpenVPN service that allows remote workers to securely connect to resources in AWS and on-premises networks from their laptops.
- **Site-to-Site VPN:** Connects your on-premises office or data center (via a physical customer gateway) directly to your AWS VPC (via a virtual private gateway or Transit Gateway) over an encrypted IPsec tunnel.

---

### Q11: Explain the difference between IAM Roles and IAM Users. When would you use a Role?
- **IAM User:** Represents a specific person or application with long-term credentials (username/password, access keys).
- **IAM Role:** Does not have long-term credentials. It defines a set of permissions assumed by trusted entities (users, AWS services, or external applications) using temporary, short-lived security credentials.
- **When to use a Role:** Use IAM Roles to grant AWS services (like an EC2 instance or Lambda function) permission to access other AWS resources, or to delegate access to users in different AWS accounts without sharing access keys.

### Q12: How do you design an application for High Availability and Fault Tolerance on AWS?
To build high availability (HA) and fault-tolerant architectures:
- **Multi-AZ Deployments:** Run compute resources (EC2, ECS, EKS) across multiple Availability Zones (AZs) behind an Application Load Balancer (ALB).
- **Auto Scaling Groups (ASG):** Set up ASGs to scale up/down based on traffic demands, replacing unhealthy instances dynamically.
- **Database Replication:** Use Amazon RDS Multi-AZ deployments for automatic failover, and use Read Replicas across AZs/Regions to scale read traffic.
- **Serverless Architectures:** Use managed serverless services like AWS Lambda, S3, DynamoDB, and API Gateway, which have built-in high availability.
- **Route 53 Routing:** Use failover, latency, or multi-value routing policies across regions.

### Q13: What are EC2 Launch Templates, and how do they differ from Launch Configurations?
Both define the configuration of EC2 instances launched by an Auto Scaling Group (AMI, instance type, security groups, keys). However:
- **Launch Templates:** The modern standard. They support **versioning**, allowing you to update configurations without creating a new resource from scratch. They also support mixed instance types, spot allocation strategies, and T2/T3 unlimited configurations.
- **Launch Configurations:** Legacy, immutable resources. You cannot modify them or use multiple versions; you must create a new one every time you want to make a change.

### Q14: Explain the difference between AWS Lambda and EC2.
- **EC2 (Infrastructure as a Service):** You provision and manage virtual servers. You have complete control over OS, patches, networking, and software stack. You pay for the virtual machine running time, regardless of resource utilization.
- **AWS Lambda (Serverless Compute):** You upload code, and AWS automatically provisions, manages, and scales the infrastructure required to run it. You only pay for the execution time (measured in milliseconds) and request count. Code execution is limited to 15 minutes.

### Q15: What is the difference between ECS (Elastic Container Service) and EKS (Elastic Kubernetes Service)?
- **ECS:** AWS-native container orchestration service. It is deeply integrated with the AWS ecosystem (IAM, Route 53, CloudWatch) and has a simpler learning curve.
- **EKS:** AWS-managed Kubernetes service. It provides standard Kubernetes APIs, making workloads portable to/from on-premises Kubernetes or other clouds. It requires more setup and management overhead than ECS.

### Q16: What is AWS Fargate, and when should you use it?
AWS Fargate is a serverless compute engine for containers that works with both ECS and EKS. 
- **When to use:** Use Fargate when you want to run containers without provisioning, configuring, or scaling EC2 instances. AWS manages the underlying VM infrastructure, and you only pay for the vCPU and memory resource allocations per container.

### Q17: What are EC2 Spot Instances, and what is their recovery mechanism?
Spot Instances allow you to request unused EC2 capacity at steep discounts (up to 90% off compared to On-Demand prices). 
- **Catch:** AWS can terminate them with a **2-minute notification** if it needs the capacity back.
- **Recovery:** You can configure Auto Scaling Groups or Spot Fleets to handle interruptions by automatically provisioning new instances or falling back to On-Demand instances, using Spot Instance termination notices to gracefully drain workloads.

### Q18: What are ASG Warm Pools?
Auto Scaling Group (ASG) Warm Pools help reduce the startup latency of applications (especially those with long initialization/bootstrapping times). It keeps a pool of pre-initialized EC2 instances in a stopped or running state, ready to quickly scale out into the active application pool when needed, saving time compared to starting from an AMI.

---

### Q19: What are S3 Storage Classes and how do you optimize S3 costs?
Amazon S3 offers different storage classes based on access frequency:
- **S3 Standard:** Active, frequently accessed data.
- **S3 Intelligent-Tiering:** Automatically moves data between frequent and infrequent tiers based on access patterns (no retrieval fees).
- **S3 Standard-IA / One Zone-IA:** Infrequent access storage. Cheaper storage cost, but retrieval fees apply.
- **S3 Glacier Flexible Retrieval / Deep Archive:** Archive storage. Lowest storage cost, but requires minutes to hours for data retrieval.
- **Cost Optimization:** Use **S3 Lifecycle Policies** to transition objects to cheaper storage tiers or delete them permanently after a specified period (e.g., move logs older than 30 days to Glacier, delete after 90 days).

### Q20: Explain the difference between EBS and EFS.
- **Amazon EBS (Elastic Block Store):** High-performance block storage designed for use with a single EC2 instance (though Multi-Attach is supported for some SSD volumes). It is bound to a single Availability Zone.
- **Amazon EFS (Elastic File System):** Managed network file system (NFS) that can be mounted simultaneously by hundreds of EC2 instances, containers, or on-premises servers across multiple Availability Zones. Scales automatically up to petabytes.

### Q21: What are the different types of EBS volumes, and when should you use them?
- **gp3 / gp2 (General Purpose SSD):** Balanced price and performance for a wide variety of workloads (system boot volumes, development environments). gp3 allows independent configuration of IOPS and throughput.
- **io2 / io1 (Provisioned IOPS SSD):** Extreme performance for latency-sensitive applications and critical databases requiring high IOPS and throughput.
- **st1 (Throughput Optimized HDD):** Low-cost magnetic storage for frequently accessed, throughput-intensive workloads (MapReduce, Kafka, log processing). Cannot be a boot volume.
- **sc1 (Cold HDD):** Lowest cost magnetic storage for infrequently accessed workloads. Cannot be a boot volume.

### Q22: What is the S3 Object Lock feature?
S3 Object Lock enables you to store objects using a **WORM (Write Once, Read Many)** model. It prevents an object from being deleted or overwritten for a fixed retention period or indefinitely. It helps meet compliance requirements and protects against ransomware or malicious deletion.
- **Modes:** **Compliance mode** (cannot be bypassed by anyone, including the root user) and **Governance mode** (users with special IAM permissions can bypass).

### Q23: How do you migrate large amounts of data to S3 when bandwidth is limited?
- **AWS Snowball Edge:** A physical storage and compute device shipped by AWS to your location. You load your data onto it locally and ship it back to AWS, where it is uploaded directly to S3.
- **AWS Snowmobile:** An exabyte-scale data transfer service using a physical shipping container on a truck (up to 100 PB per container).
- **AWS DataSync:** An online data transfer service that accelerates copying data between on-premises storage and S3 over the network.

### Q24: What is S3 Transfer Acceleration?
S3 Transfer Acceleration enables fast, easy, and secure transfers of files over long distances between your client and an S3 bucket. It utilizes Amazon CloudFront's globally distributed Edge Locations. Traffic is routed over the optimized AWS global network back to the bucket instead of the public internet.

### Q25: What is S3 Versioning, and what are its benefits?
S3 Versioning allows you to keep multiple versions of an object in the same bucket. 
- **Benefits:** Provides a recovery mechanism from accidental user actions (like deleting or overwriting an object). Deleting an object creates a "Delete Marker" instead of deleting it permanently, allowing you to restore previous versions easily.

---

### Q26: What is the difference between Amazon RDS, DynamoDB, and Redshift?
- **Amazon RDS:** Managed relational database service supporting engines like PostgreSQL, MySQL, and Aurora. Ideal for transactional databases (OLTP) requiring ACID compliance and complex SQL queries.
- **Amazon DynamoDB:** Fully managed NoSQL key-value and document database. Designed for single-digit millisecond latency at any scale. Best for high-write, horizontally scalable applications.
- **Amazon Redshift:** Fully managed data warehouse service (OLAP). Columnar storage optimized for running complex analytical queries over massive datasets.

### Q27: How does Amazon Aurora differ from standard RDS MySQL/PostgreSQL?
Amazon Aurora is a cloud-native relational database engine designed by AWS:
- **Storage:** Aurora uses a shared, distributed, auto-scaling SSD storage tier that replicates data 6 ways across 3 Availability Zones.
- **Performance:** Up to 5x throughput of standard MySQL and 3x of standard PostgreSQL.
- **Failover:** Rapid failover (usually under 30 seconds) with minimal data loss since replicas share the same storage volume.
- **Serverless:** Offers Aurora Serverless v2, which scales compute capacity (ACUs) up and down dynamically based on application demand.

### Q28: What is DynamoDB DAX (DynamoDB Accelerator)?
DAX is a fully managed, highly available, in-memory cache specifically built for DynamoDB. It provides up to a 10x performance improvement — reducing response times from single-digit milliseconds to microseconds — for read-intensive tables. It is API-compatible, requiring no changes to application logic.

### Q29: What are Global Tables in Amazon DynamoDB?
DynamoDB Global Tables provide a fully managed, multi-region, multi-active database. It automatically replicates DynamoDB tables across your choice of AWS regions. This allows local read/write performance for global users and serves as a robust disaster recovery solution.

### Q30: What is ElastiCache, and what are its two main engine options?
Amazon ElastiCache is a managed in-memory data store and cache service.
- **Engines:**
  - **Redis:** Supports complex data structures (hashes, lists, sets), replication, high availability (Multi-AZ), and persistence. Often used for pub/sub, queues, and session state.
  - **Memcached:** Simple, multi-threaded key-value store. Best for simple caching layers to offload database reads.

### Q31: How do RDS Multi-AZ deployments differ from RDS Read Replicas?
- **RDS Multi-AZ:**
  - **Purpose:** High Availability and disaster recovery.
  - **Replication:** Synchronous replication to a standby instance in another AZ.
  - **Active/Passive:** Only the primary instance accepts writes and reads; standby is passive until failover.
- **RDS Read Replicas:**
  - **Purpose:** Read scalability and offloading database query performance.
  - **Replication:** Asynchronous replication.
  - **Active/Active:** Replicas are active and accept read-only traffic. Can be promoted to a standalone database if needed.

### Q32: What is Amazon DocumentDB?
Amazon DocumentDB is a fully managed, fast, scalable, and highly available document database service that supports MongoDB workloads. It uses a decoupled compute and storage architecture similar to Amazon Aurora.

---

### Q33: How do you manage secrets securely using AWS Systems Manager Parameter Store and AWS Secrets Manager?
Both services store configuration data and secrets, but they have key differences:
- **Secrets Manager:** Designed specifically for secrets. Supports automatic credentials rotation (e.g., rotating database passwords using Lambda), integrates with RDS out-of-the-box, and generates random secrets. Charges apply per secret.
- **Parameter Store:** General-purpose configuration store for hierarchical configuration data (plain text) and secrets (SecureString encrypted via KMS). Standard parameters are free. Does not have native automatic rotation.

### Q34: What is AWS KMS (Key Management Service)?
AWS KMS is a managed service that makes it easy to create and control the cryptographic keys used to encrypt your data.
- **Key Concepts:** Uses **Customer Master Keys (CMKs)**. It is integrated with most AWS services (S3, EBS, RDS) to enable envelope encryption. KMS is secured by FIPS 140-2 cryptoprocessors.

### Q35: What is the difference between AWS WAF and AWS Shield?
- **AWS WAF (Web Application Firewall):** Protects web applications from common web exploits (Layer 7) like SQL injection, cross-site scripting (XSS), and bad bots. You define rules to allow or block traffic.
- **AWS Shield:** Provides managed Distributed Denial of Service (DDoS) protection at Layers 3 and 4. **Shield Standard** is enabled for all AWS customers at no extra charge. **Shield Advanced** provides additional mitigation, 24/7 access to the DDoS Response Team, and financial protection against DDoS-related charges.

### Q36: What is Amazon GuardDuty?
Amazon GuardDuty is a continuous security monitoring service that analyzes data sources (VPC Flow Logs, CloudTrail Event Logs, DNS Logs, EKS audit logs) using machine learning and threat intelligence to identify unexpected and potentially unauthorized activity in your AWS account (such as crypto-mining or data exfiltration).

### Q37: What is AWS IAM Access Analyzer?
IAM Access Analyzer helps identify resources in your organization and accounts (such as S3 buckets or IAM roles) that are shared with an external entity. It uses mathematical logic to analyze resource-based policies, helping you achieve the principle of least privilege.

### Q38: What is AWS Cognito, and what is the difference between User Pools and Identity Pools?
AWS Cognito provides authentication, authorization, and user management for web and mobile apps.
- **User Pools:** An identity provider directory that handles user sign-up, sign-in, and password recovery. Users authenticate directly with the User Pool to receive JWT tokens.
- **Identity Pools (Federated Identities):** Authorizes users to obtain temporary, limited-privilege AWS credentials to access AWS resources directly (like S3 or DynamoDB), federating logins from User Pools, Google, Facebook, or SAML.

---

### Q39: What is the difference between Amazon SQS and Amazon SNS?
- **Amazon SQS (Simple Queue Service):** A message queueing service. It uses a **pull model** where receivers poll the queue to retrieve messages. It is designed for decoupling microservices, where one receiver processes one message.
- **Amazon SNS (Simple Notification Service):** A pub/sub messaging service. It uses a **push model** where a publisher sends a message to a topic, and SNS pushes it to all subscribed endpoints (Lambda, SQS, Email, HTTP endpoints) simultaneously.

### Q40: What is Amazon EventBridge?
Amazon EventBridge is a serverless event bus service that makes it easy to connect applications using data from your own applications, integrated SaaS applications, and AWS services. It is the modern evolution of CloudWatch Events, featuring schema registries and API destinations.

### Q41: What is the difference between SQS Standard and SQS FIFO queues?
- **Standard Queue:** Offers nearly unlimited throughput, at-least-once delivery (occasionally more than one copy of a message is delivered), and best-effort ordering.
- **FIFO (First-In-First-Out) Queue:** Guarantees that messages are processed exactly once and in the exact order they are sent. It has a limited throughput (up to 3,000 messages per second with batching).

### Q42: What is Amazon Kinesis, and what are its primary types?
Kinesis is a platform for streaming data on AWS. Its primary services are:
- **Kinesis Data Streams:** Collects and stores continuous streams of data records (shards determine throughput). Consumers pull data for real-time processing.
- **Kinesis Data Firehose:** Buffers and loads streaming data into destinations like S3, Redshift, Elasticsearch, or Splunk with zero consumer management.
- **Kinesis Video Streams:** Streams video securely from devices to AWS.

### Q43: What is AWS Step Functions?
AWS Step Functions is a low-code visual workflow orchestrator used to build distributed applications and automate processes using AWS services. It manages state, branching logic, timeouts, and error handling for complex, multi-step workflows (e.g., chaining multiple Lambda functions together).

---

### Q44: What is the difference between Amazon CloudWatch and AWS CloudTrail?
- **Amazon CloudWatch:** Focuses on **performance and monitoring** of applications and resources. It collects metrics, CPU/memory stats, application logs, and sets up alerts (alarms).
- **AWS CloudTrail:** Focuses on **governance, compliance, and auditing**. It records AWS API calls made in your account (who did what, from where, and when).

### Q45: What is AWS Systems Manager (SSM) Session Manager?
Session Manager is a fully managed service that lets you manage your EC2 instances, on-premises instances, and VMs through an interactive one-click browser-based shell or the AWS CLI. 
- **Benefit:** You do not need to open inbound SSH/RDP ports, configure bastions, or manage SSH keys, enhancing security while auditing all executed commands.

### Q46: What is AWS Config?
AWS Config is a service that enables you to assess, audit, and evaluate the configurations of your AWS resources. It continuously monitors resource configurations, records changes, and evaluates them against rules (e.g., alert if an S3 bucket becomes public) for compliance.

### Q47: What are Service Control Policies (SCPs) in AWS Organizations?
SCPs are organization policies used to manage permissions in your organization. They offer central control over the maximum available permissions for all accounts in your organization, allowing you to restrict actions (e.g., preventing any account from disabling CloudTrail) even for the root user of member accounts. SCPs do not grant permissions; they act as a filter.

---

### Q48: Explain the difference between Savings Plans and Reserved Instances (RIs).
Both offer discounts (up to 72%) in exchange for a commitment to a consistent amount of usage (1 or 3 years).
- **Savings Plans:** Provide more flexibility. You commit to a dollar-per-hour spending limit (e.g., $10/hour). It automatically applies across any instance family, OS, region, or even compute type (EC2, Fargate, Lambda).
- **Reserved Instances:** Historically tied to specific instance configurations (family, size, region) and OS, though Convertible RIs offer some flexibility.

### Q49: What are the main Disaster Recovery (DR) strategies on AWS?
Ordered by increasing cost and decreasing recovery time (RTO):
1. **Backup and Restore (Hours):** Easiest, lowest cost. Periodically back up data to S3. Restore resources from backups if disaster strikes.
2. **Pilot Light (Tens of minutes):** Keep critical core databases running and updated in a passive region (data replication), while application servers are off and provisioned only during disaster.
3. **Warm Standby (Minutes):** Run a scaled-down, fully functional version of your system in the passive region. Scale up to full capacity during failover.
4. **Multi-Site Active-Active (Real-time):** Run fully operational copies of your system in multiple regions simultaneously, splitting traffic. Zero RTO.

### Q50: Define RPO and RTO.
- **Recovery Point Objective (RPO):** The maximum acceptable amount of data loss measured in time (e.g., "We can tolerate up to 4 hours of data loss"). Determines backup frequency.
- **Recovery Time Objective (RTO):** The maximum acceptable duration of downtime before service is restored (e.g., "The system must be back online within 1 hour"). Determines infrastructure restore automation.

---

## AWS Topic Explanation

### What is AWS?
Amazon Web Services (AWS) is the world's most comprehensive and broadly adopted cloud platform. It offers over 200 fully featured services from data centers globally, allowing organizations of all sizes to replace upfront capital infrastructure expenses with low, variable operational costs that scale with demand.

### Cloud Architecture Core Tenets

#### 1. High Availability & Disaster Recovery
AWS enables developers to build highly available systems by leveraging its global network infrastructure:
- **Regions:** Geographic areas containing isolated clusters of data centers.
- **Availability Zones (AZs):** Distinct locations within a Region engineered to be isolated from failures in other AZs. Running applications across multiple AZs guarantees fault tolerance.
- **Edge Locations:** Caches static content closer to users globally, managed by CloudFront.

#### 2. Security & The Shared Responsibility Model
Security on AWS is divided between the cloud provider and the customer:
- **Security OF the Cloud (AWS):** AWS secures the physical infrastructure, servers, storage, virtual hypervisors, and core networking.
- **Security IN the Cloud (Customer):** The customer is responsible for patch management of virtual machines (EC2), configuring security groups and NACLs, managing data encryption keys, and writing restrictive Identity and Access Management (IAM) policies.

#### 3. Scaling & Elasticity
Instead of over-provisioning hardware to meet peak traffic capacity, AWS architecture promotes elasticity:
- **Vertical Scaling (Scale Up/Down):** Increasing or decreasing instance size (CPU, RAM).
- **Horizontal Scaling (Scale Out/In):** Adding or removing the number of instances running in parallel (managed automatically by Auto Scaling Groups).
- **Serverless:** Using event-driven compute (Lambda) and managed storage (S3, DynamoDB) to scale scaling logic out of the application configuration completely.

### The Five Pillars of the AWS Well-Architected Framework
AWS evaluates cloud architectures against five core pillars:
1. **Operational Excellence:** Running and monitoring systems to deliver business value and continuously improve processes.
2. **Security:** Protecting information, systems, and assets while delivering business value through risk assessments and mitigation strategies.
3. **Reliability:** Ensuring a workload performs its intended function correctly and consistently when expected (fault tolerance and recovery).
4. **Performance Efficiency:** Using IT and computing resources efficiently as demand changes and technologies evolve.
5. **Cost Optimization:** Avoiding unnecessary costs, tracking spending, and choosing the correct resource types at the right scale.
