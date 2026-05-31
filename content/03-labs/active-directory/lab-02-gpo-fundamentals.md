# Lab 2: Group Policy Fundamentals

## Objective
In this lab, you will join a client machine to the domain and create your first Group Policies (GPOs) to control the user environment.

## Prerequisites
1. **Infrastructure**: Ensure `terraform apply` has been run again to create the **Client Instance**.
2. **Lab 1 Completion**: The Domain Controller must be active with DNS configured.

## Step 1: Prepare the Client Machine
1. RDP into the **Client Instance** (`Client1`).
   - Use the same **Key/Password** as the DC initially.
2. **Configure DNS**:
   - Open **Network Connections** (`ncpa.cpl`).
   - Right-click **Ethernet** > **Properties**.
   - Select **Internet Protocol Version 4 (TCP/IPv4)** > **Properties**.
   - Set **Preferred DNS server** to the **Private IP of your DC** (e.g., `10.0.1.x`).
   - Click **OK**.
3. Open **CMD** and ping the domain: `ping corp.example.com`.
   - It should resolve to your DC's IP.

### 🔍 What Just Happened?
**Why point DNS to the DC?**  
Active Directory **requires** DNS to function. When you join a domain, the client needs to:
1. Resolve `corp.example.com` to find the DC
2. Query SRV records like `_ldap._tcp.corp.example.com` to locate LDAP services
3. Find Kerberos servers for authentication

Without the DC as DNS server, the client can't find the domain!


## Step 2: Join the Domain
1. Open **Server Manager** > **Local Server**.
2. Click the **Workgroup** name.
3. Click **Change**.
4. Select **Domain** and enter `corp.example.com`.
5. Enter credentials: `CORP\Administrator` and password.
6. Welcome message should appear. **Restart** the client.

### 🔍 What Just Happened?
**Domain Join Process:**
1. Client queries DNS for `_ldap._tcp.corp.example.com` to find a DC
2. Client authenticates with the credentials you provided
3. DC creates a **Computer Account** in AD (check `Computers` container in ADUC)
4. Client receives a **machine password** (changes every 30 days automatically)
5. A **secure channel** is established between client and DC

**Why restart?**  
The computer needs to apply its new domain identity and load domain-based policies.

**Security Note:**  
By default, any authenticated user can join up to 10 computers to the domain. In production, you'd restrict this via the `ms-DS-MachineAccountQuota` attribute.


## Step 3: Create "General Users" GPO (Wallpaper)
*Switch back to your Domain Controller (DC1).*

1. Open **Group Policy Management** (`gpmc.msc`).
2. Expand **Forest** > **Domains** > `corp.example.com` > `_Corp` > **Users**.
3. Right-click the **Users** OU > **Create a GPO in this domain, and Link it here...**.
4. **Name**: `General-User-Config`.
5. Right-click the new GPO > **Edit**.
6. **Set a Wallpaper**:
   - Go to: **User Configuration** > **Policies** > **Administrative Templates** > **Desktop** > **Desktop**.
   - Double-click **Desktop Wallpaper**.
   - Select **Enabled**.
   - **Wallpaper Name**: `C:\Windows\Web\Wallpaper\Windows\img0.jpg` (or a network path).
   - **Style**: **Fill**.
   - Click **OK**.

### 🔍 What Just Happened?
You created your first **Group Policy Object (GPO)**!

**Key Concepts:**
- **GPO**: A collection of settings that control user/computer environments
- **Linking**: Connecting a GPO to an OU (or domain/site). The GPO only affects objects in that container.
- **User Configuration**: Settings that apply when a user logs in (wallpaper, drive maps, Start menu)
- **Computer Configuration**: Settings that apply to the machine itself (firewall, software installation)

**Policies vs Preferences:**
- **Policies** (Administrative Templates): Enforced, users can't change them. Reverts when GPO is removed.
- **Preferences** (like Drive Maps): Applied once, users can modify. Persists even after GPO removal.

**Processing Order:**  
GPOs are applied in this order: **L**ocal → **S**ite → **D**omain → **OU** ("LSDOU"). If multiple GPOs conflict, the last one wins.


## Step 4: Create "Drive Map" GPO
1. In the same GPO Editor (`General-User-Config`).
2. Go to: **User Configuration** > **Preferences** > **Windows Settings** > **Drive Maps**.
3. Right-click > **New** > **Mapped Drive**.
4. **Action**: **Create**.
5. **Location**: `\\DC1\SYSVOL` (Just for testing).
6. **Label**: `CorpData`.
7. **Drive Letter**: `X:`.
8. Click **OK**.

### 🔍 What Just Happened?
**Group Policy Preferences** are more flexible than Policies:
- Can target specific users/groups (Item-Level Targeting)
- Support variables like `%USERNAME%`, `%COMPUTERNAME%`
- Don't enforce—users can disconnect the drive if they want

**Why use `\\DC1\SYSVOL`?**  
SYSVOL is a special share on every DC that stores Group Policy templates. It's always available and replicated between DCs. In production, you'd map to file servers instead.


## Step 5: Verify on Client
1. RDP into **Client1**.
2. Login as your created user: `jane.admin`.
   - *Note: Ensure jane.admin is in the "Remote Desktop Users" group if not using a Domain Admin account.*
3. Open the **Command Prompt** and run: `gpupdate /force`.
4. **Verify**:
   - Is **Drive X:** mapped in File Explorer?
   - Is the **Wallpaper** set? (Note: RDP often disables wallpaper rendering).
5. Run `gpresult /r` to see exactly which policies were applied.

### 🔍 What Just Happened?
**GPO Application Process:**
1. Client contacts DC every 90 minutes (+ random 0-30 min offset)
2. Downloads applicable GPOs based on OU membership
3. Applies settings in order (Computer policies at boot, User policies at login)

**Useful Commands:**
- `gpupdate /force`: Immediately refresh policies (doesn't wait 90 min)
- `gpresult /r`: Shows which GPOs are applied to current user/computer
- `gpresult /h report.html`: Generates detailed HTML report
- `rsop.msc`: GUI tool showing "Resultant Set of Policy"

**Troubleshooting:**
- If GPO doesn't apply: Check OU membership, Security Filtering, and WMI Filters
- Check Event Viewer → Applications and Services Logs → Microsoft → Windows → GroupPolicy

> [!TIP]
> **Background Refresh**: Most policies refresh in the background every 90 minutes. But some (like Software Installation, Folder Redirection) only apply at startup/login.
