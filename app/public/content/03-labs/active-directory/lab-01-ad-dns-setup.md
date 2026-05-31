# Lab 1: Active Directory Domain Services & DNS Setup

## Objective
In this lab, you will configure a Windows Server 2022 instance as the first Domain Controller (DC) in a new Active Directory Forest. You will also configure basic DNS zones and creating a structured Organizational Unit (OU) hierarchy.

## Prerequisites
1. **Terraform Applied**: Ensure you have run `terraform apply` and the distinct resources are created.
2. **Connectivity**: Retrieve the **Public IP** and **Private Key** from the Terraform outputs (`terraform output`).
   - Decrypt the **Administrator** password using the `.pem` file.

## Step 1: Connect to the Server
1. Open your RDP client (Remote Desktop Connection).
2. Connect to the **Public IP** of the DC.
3. Username: `Administrator`.
4. Password: [Decrypted Password from Terraform].

## Step 2: Rename the Server
*It is best practice to rename your server before promoting it to a Domain Controller.*
1. In **Server Manager**, click **Local Server** on the left.
2. Click the default computer name (e.g., `EC2AMAZ-...`).
3. Click **Change...**.
4. Computer name: `DC1`.
5. Click **OK** and **Restart** the server immediately.
6. Reconnect via RDP.

## Step 3: Install AD DS Role
1. Open **Server Manager** (it usually opens automatically).
2. Click **Manage** > **Add Roles and Features**.
3. Click **Next** until you reach **Server Roles**.
4. Check **Active Directory Domain Services**.
   - Click **Add Features** when prompted.
5. Click **Next** through Features and AD DS content.
6. Click **Install**.
7. *Wait for installation to complete. Do NOT close the window yet.*

### 🔍 What Just Happened?
You installed the **Active Directory Domain Services (AD DS)** role, which includes:
- **Directory database** (NTDS.DIT): Stores all domain objects (users, computers, groups)
- **LDAP service**: Allows clients to query the directory
- **Kerberos KDC**: Authentication service for secure logins
- **Replication engine**: Syncs data between multiple DCs (we'll use this in Lab 4)

**Why separate installation from promotion?**  
Microsoft separates "installing binaries" from "configuring the domain" to allow flexibility—you can install AD DS on multiple servers and promote them later.

## Step 3: Promote to Domain Controller
1. In the notification flag (top right of **Server Manager**), click **Promote this server to a domain controller**.
2. Select **Add a new forest**.
3. **Root domain name**: `corp.example.com` (or your preferred name). Click **Next**.
4. **Domain Controller Options**:
   - **Forest/Domain functional level**: `Windows Server 2016`.
   - Ensure **DNS Server** and **Global Catalog (GC)** are checked.
   - Enter a **DSRM Password** (e.g., `Passw0rd123!`). REMEMBER THIS.
5. Click **Next** past **DNS Options** (warning is normal).
6. **NetBIOS name**: `CORP` (Auto-populated).
7. **Paths**: Default.
8. **Prerequisites Check**: Wait for it to pass (green check).
9. Click **Install**.
10. The server will **restart automatically**.

### 🔍 What Just Happened?
You created a **new Active Directory Forest** and promoted this server to be the first Domain Controller.

**Key Concepts:**
- **Forest**: The top-level security boundary. Everything in a forest trusts each other. Your forest root is `corp.example.com`.
- **Domain**: A partition within a forest. In enterprises, you might have `us.corp.com`, `eu.corp.com`, etc.
- **Functional Level**: Determines which AD features are available. Higher levels = more features, but older DCs can't join.
- **DSRM Password**: "Directory Services Restore Mode" password. Used to boot the DC into a special recovery mode if AD is corrupted. **Critical for disaster recovery!**
- **DNS Server**: AD **requires** DNS to function. Clients use DNS to find DCs (via SRV records like `_ldap._tcp.corp.example.com`).
- **Global Catalog (GC)**: A searchable index of all objects in the forest. The first DC is always a GC.

**What happened during promotion?**
1. Created the AD database (`C:\Windows\NTDS\NTDS.DIT`)
2. Created SYSVOL folder (`C:\Windows\SYSVOL`) for Group Policy storage
3. Configured DNS with AD-integrated zones
4. Set up Kerberos authentication
5. Migrated the local Administrator account to the domain

## Step 4: Verification & DNS
1. Reconnect via RDP after 5-10 minutes.
   - **Login**: `CORP\Administrator` (You are now a Domain Admin!).
2. Open **Tools** > **DNS**.
3. Expand **DC1** > **Forward Lookup Zones** > `corp.example.com`.
   - Verify you see `_msdcs`, `_sites`, `_tcp`, `_udp` folders (SRV records).
4. **Reverse Lookup Zone**:
   - Right-click **Reverse Lookup Zones** > **New Zone**.
   - **Zone Type**: **Primary Zone** > Ensure **Store the zone in Active Directory** is checked > **Next**.
   - **Replication Scope**: Select **To all DNS servers running on domain controllers in this domain: corp.example.com** > **Next**.
   - **Reverse Lookup Zone Name**: **IPv4 Reverse Lookup Zone** > **Next**.
   - **Network ID**: `10.0.1` (First 3 octets of your Subnet CIDR: `10.0.1.0/24`).
   - **Dynamic Update**: Select **Allow only secure dynamic updates** > **Next**.
   - **Finish**.

5. **Register PTR Records**:
   - The zone is now created but empty. The DC needs to register its PTR record.
   - Open **PowerShell (Admin)** on the DC.
   - Run: `ipconfig /registerdns`
   - Wait 30-60 seconds for DNS registration to complete.
6. **Verify PTR Record**:
   - In **DNS Manager**, expand **Reverse Lookup Zones** > `1.0.10.in-addr.arpa`.
   - You should see a **PTR record** (e.g., `172` if your DC IP is `10.0.1.172`).
   - Double-click it to verify it points to your DC's FQDN (e.g., `DC1.corp.example.com`).

   > [!TIP]
   > **Still nothing?** If `ipconfig /registerdns` didn't create the record, go to **Forward Lookup Zones** > double-click your **DC1** (Host A) record > check **Update associated pointer (PTR) record** > **OK**. This forces the registration!

### 🔍 What Just Happened?
**SRV Records (`_tcp`, `_udp` folders):**  
These are **Service Location Records** that tell clients where to find domain services:
- `_ldap._tcp.corp.example.com` → Points to your DC for LDAP queries
- `_kerberos._tcp.corp.example.com` → Points to Kerberos authentication
- Clients use these to automatically discover DCs without hardcoding IPs

**Reverse Lookup Zone:**  
Maps IP addresses back to hostnames (PTR records). Used for:
- Security verification (many apps check if IP resolves to a valid hostname)
- Logging and troubleshooting
- Some AD features expect reverse DNS to work properly

**Understanding the Zone Name:**  
When you enter Network ID `10.0.1`, Windows creates the zone `1.0.10.in-addr.arpa`.

**Why the reverse order?**
- Your subnet: `10.0.1.0/24`
- DNS reads right-to-left (hierarchical), so octets are reversed: `1.0.10`
- The `.in-addr.arpa` suffix is the standard for IPv4 reverse DNS
- Final zone name: `1.0.10.in-addr.arpa`

**Example PTR Record:**
- IP: `10.0.1.50`
- PTR record name: `50.1.0.10.in-addr.arpa`
- Points to: `DC1.corp.example.com`

**Verification:**  
After creating the zone, you can test with:
```cmd
nslookup 10.0.1.x
```
It should return the hostname of that IP.

## Step 5: Create OU Structure
1. Open **Tools** > **Active Directory Users and Computers (ADUC)**.
2. Right-click the domain (`corp.example.com`) > **New** > **Organizational Unit**.
   - **Name**: `_Corp` (Underscore keeps it at the top).
3. **Create the Nested Structure**:
   Follow this tree to build your organization. For each level, right-click the **parent** OU > **New** > **Organizational Unit**.

   **Target Tree:**
   ```text
   corp.example.com
   └── _Corp
       ├── Computers
       │   ├── Workstations
       │   └── Servers
       ├── Users
       │   ├── Admins
       │   └── Employees
       └── Groups
           ├── Security
           └── Distribution
   ```

   **Instructions:**
   - Right-click `_Corp` > New OU > name it `Computers`.
     - Right-click `Computers` > New OU > name it `Workstations`.
     - Right-click `Computers` > New OU > name it `Servers`.
   - Right-click `_Corp` > New OU > name it `Users`.
     - Right-click `Users` > New OU > name it `Admins`.
     - Right-click `Users` > New OU > name it `Employees`.
   - Right-click `_Corp` > New OU > name it `Groups`.
     - Right-click `Groups` > New OU > name it `Security`.
     - Right-click `Groups` > New OU > name it `Distribution`.

### 🔍 What Just Happened?
**Organizational Units (OUs)** are containers for organizing AD objects. Think of them as folders.

**Why create this structure?**
- **Group Policy Scope**: GPOs are applied to OUs. By separating Workstations/Servers, you can apply different policies (e.g., stricter security on servers).
- **Delegation**: You can give HR the ability to manage users in the `Employees` OU without giving them full domain admin rights.
- **Clarity**: In a real enterprise with thousands of objects, a clean OU structure is essential.

**Design Patterns:**
- **Geographic**: `US`, `EU`, `APAC` (if you have offices worldwide)
- **Functional**: `IT`, `HR`, `Finance` (by department)
- **Hybrid**: `_Corp/US/Workstations` (we're using a simple functional model)

**Why `_Corp` with underscore?**  
It sorts to the top alphabetically, making it easy to find. It also separates your custom structure from default containers like `Computers` and `Users`.

## Step 6: Create an Admin User
1. In `_Corp\Users\Admins`, right-click > **New** > **User**.
2. **First Name**: `Jane`, **Logon Name**: `jane.admin`.
3. **Password**: `Passw0rd123!`.
4. Right-click the new user > **Properties** > **Member Of**.
5. Add the **Domain Admins** group.

### 🔍 What Just Happened?
You created a **named administrator account** instead of using the default `Administrator` account.

**Why?**
- **Auditing**: Logs will show "jane.admin did X" instead of generic "Administrator did X"
- **Security**: You can disable the default Administrator account (best practice)
- **Accountability**: In a team, each admin should have their own account

**Domain Admins Group:**  
This is the most powerful group in the domain. Members can:
- Modify any object in the domain
- Install software on any computer
- Change Group Policies
- Promote/demote DCs

**Best Practice:**  
Use a **regular user account** for daily work and a separate **admin account** (like `jane.admin`) only when you need elevated privileges. This is called "Least Privilege" principle.

> [!SUCCESS]
> You now have a functional Domain Controller and a clean structure ready for Policy application!
