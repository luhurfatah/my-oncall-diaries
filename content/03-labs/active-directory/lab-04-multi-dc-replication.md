# Lab 4: Multi-DC Architecture & Replication

## Objective
Simulate a real-world enterprise by adding a second Domain Controller, configuring Sites, and managing Replication.

## Prerequisites
1. **Infrastructure**: `terraform apply` to create **DC2**.
2. **Context**: DC1 is up and running as the Primary DC.

## Step 1: Prepare DC2
1. RDP into **DC2**.
2. **Configure DNS**:
   - Set **Preferred DNS** to the **DC1 Private IP**.
   - Set **Alternate DNS** to `127.0.0.1` (once it becomes a DC, it looks at itself).
3. Open **Server Manager**, install **Active Directory Domain Services**.

## Step 2: Promote DC2 (Join Existing Domain)
1. Click **Promote this server to a domain controller**.
2. Select **Add a domain controller to an existing domain**.
3. **Domain**: `corp.example.com`.
4. **Credentials**: click **Change** > Enter `CORP\Administrator`.
5. Click **Next**.
6. **Site Selection**: `Default-First-Site-Name` (we will change this later).
7. Type a **DSRM Password**.
8. **Replicate from**: Any domain controller (or specifically **DC1**).
9. Finish the wizard and **Restart**.

### 🔍 What Just Happened?
You added a **replica Domain Controller** to the existing domain.

**Key Differences from DC1:**
- DC1 created a **new forest** ("Add a new forest")
- DC2 joined an **existing domain** ("Add a domain controller to an existing domain")

**What happened during promotion?**
1. DC2 contacted DC1 via LDAP to authenticate
2. DC1 replicated the entire AD database (NTDS.DIT) to DC2
3. DC2 replicated SYSVOL (Group Policy files) via FRS or DFSR
4. DC2 registered its DNS records (SRV records) so clients can find it
5. Both DCs now share the workload (authentication, LDAP queries)

**Benefits of Multiple DCs:**
- **High Availability**: If DC1 goes down, DC2 continues serving clients
- **Load Balancing**: Clients automatically use the closest DC (via Sites)
- **Disaster Recovery**: You can restore from DC2 if DC1 is corrupted


## Step 3: Verify & Manage Replication
1. Log into **DC1** or **DC2**.
2. Open PowerShell (Admin).
3. Run: `repadmin /replsummary`
   - You should see both DCs with "0 fails".
4. Run: `repadmin /showrepl`
   - Shows detailed replication partners.

### 🔍 What Just Happened?
**Active Directory Replication** keeps all DCs synchronized.

**How it works:**
- **Multi-Master**: All DCs are writable. Changes made on DC1 replicate to DC2 and vice versa.
- **Change Notification**: When you create a user on DC1, it notifies DC2 within 15 seconds (intra-site).
- **Update Sequence Numbers (USNs)**: Each change gets a unique number to track what's been replicated.

**Replication Topology:**
- **Intra-Site** (same site): Fast, automatic, every 15 seconds
- **Inter-Site** (different sites): Scheduled, compressed, configurable (default: every 180 minutes)

**Useful Commands:**
- `repadmin /replsummary`: Overview of replication health
- `repadmin /showrepl`: Detailed partner info
- `repadmin /syncall /AdeP`: Force replication from all partners

**Troubleshooting:**
- Check Event Viewer → Directory Service logs for replication errors
- Ensure DNS is working (DCs find each other via SRV records)
- Verify network connectivity and firewall rules


## Step 4: Configure Sites & Subnets
*Simulate DC2 being in a different office.*

1. Open **Active Directory Sites and Services** (`dssite.msc`).
2. Right-click **Sites** > **New Site**.
   - **Name**: `Branch-Office`.
   - **Link**: `DEFAULTIPSITELINK`.
3. **Move DC2**:
   - Expand `Default-First-Site-Name` > **Servers**.
   - Right-click **DC2** > **Move** > `Branch-Office`.
4. **Create Subnets**:
   - Right-click **Subnets** > **New Subnet**.
   - **Prefix**: `10.0.2.0/24` (Hypothetically, if we had a second subnet).
   - **Select Site**: `Branch-Office`.
   - *Note: Since our lab is all in one VPC subnet, this is for demonstration. Real traffic will still flow, but AD thinks it's separate.*

### 🔍 What Just Happened?
**Sites** represent physical locations (offices, data centers). **Subnets** define IP ranges for each site.

**Why Sites Matter:**
1. **Client Affinity**: Clients authenticate to DCs in their own site (faster, less WAN traffic)
2. **Replication Control**: You can schedule inter-site replication during off-peak hours
3. **Service Location**: DFS, Exchange, and other services use sites to find the nearest server

**Site Links:**
- Define the "cost" of replication between sites (lower = preferred)
- Control replication schedule (e.g., replicate only at night to save bandwidth)
- Example: `HQ-to-Branch` link with cost 100, replicates every 3 hours

**Real-World Scenario:**
- **HQ** (New York): 10.0.0.0/16, has DC1
- **Branch** (London): 10.1.0.0/16, has DC2
- Site link configured to replicate every 6 hours (expensive transatlantic link)

**In our lab:**
We're simulating this with a single subnet, but the concepts are the same!


## Step 5: FSMO Roles
*Flexible Single Master Operation roles are critical.*

1. Check Roles:
   - `netdom query fsmo` (All should be on DC1).
2. **Transfer a Role** (e.g., RID Master) to DC2:
   - PowerShell:
     ```powershell
     Move-ADDirectoryServerOperationMasterRole -Identity DC2 -OperationMasterRole RIDMaster
     ```
   - Press `Y` to confirm.
3. Verify: `netdom query fsmo`.
4. **Move it back** (Best practice: keep them together unless specific design requires split).

### 🔍 What Just Happened?
**FSMO Roles** (Flexible Single Master Operations) are special roles that only **one DC** can hold at a time.

**The 5 FSMO Roles:**

**Forest-Wide (only 1 per forest):**
1. **Schema Master**: Controls changes to the AD schema (adding new object types)
2. **Domain Naming Master**: Controls adding/removing domains in the forest

**Domain-Wide (1 per domain):**
3. **RID Master**: Allocates pools of Relative IDs (used to create unique SIDs for objects)
4. **PDC Emulator**: 
   - Time source for the domain (all computers sync to it)
   - Handles password changes (checked first before other DCs)
   - Backward compatibility with NT4 clients
5. **Infrastructure Master**: Updates cross-domain references (if you have multiple domains)

**Why Single Master?**
Some operations can't handle conflicts (e.g., two DCs assigning the same RID). FSMO roles prevent this.

**Transfer vs Seize:**
- **Transfer**: Graceful, both DCs online (use `Move-ADDirectoryServerOperationMasterRole`)
- **Seize**: Forceful, original DC is dead/offline (use `Move-ADDirectoryServerOperationMasterRole -Force`)

**Best Practice:**
Keep all roles on the same DC (usually the most powerful/reliable one) unless you have a specific reason to split them.

**Checking Role Holders:**
```powershell
Get-ADDomain | Select-Object PDCEmulator, RIDMaster, InfrastructureMaster
Get-ADForest | Select-Object SchemaMaster, DomainNamingMaster
```

> [!SUCCESS]
> You have built a multi-site, multi-DC enterprise environment!
