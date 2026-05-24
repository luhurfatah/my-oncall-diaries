# Lab 3: Advanced Group Policy & Software Deployment

## Objective
Go beyond basic GPOs by mastering filtering, targeting, and software distribution—techniques essential for enterprise administration.

## Step 1: Security Filtering
*Objective: Apply a GPO only to a specific group, not everyone in the OU.*

1. Create a new **Group**: `HR_Users`. Add `jane.admin` to it.
2. Create a **GPO**: `HR-Restrictions`. Link it to `_Corp\Users`.
3. Select the **GPO** in **GPMC**.
4. Under **Security Filtering**:
   - Select **Authenticated Users** > **Remove** (Warning: This removes the Apply permission).
   - Click **Add** > `HR_Users`.
5. **Edit the GPO**:
   - **User Configuration** > **Policies** > **Administrative Templates** > **System** > **Prevent access to the command prompt** > **Enabled**.
6. **Verify**:
   - Login as `jane.admin` (It should apply).
   - Login as another user (It should NOT apply).

### 🔍 What Just Happened?
**Security Filtering** controls **who** the GPO applies to, even within the same OU.

**How it works:**
- By default, GPOs apply to `Authenticated Users` (everyone)
- You can restrict to specific users/groups by modifying the **Security Filtering** list
- The group must have both **Read** and **Apply Group Policy** permissions

**When to use:**
- Department-specific policies (HR gets different settings than IT)
- Temporary restrictions (contractors vs full-time employees)
- Pilot testing (apply to a test group before rolling out to everyone)

**Alternative: Group Policy Loopback**  
For computer-based targeting (e.g., "apply these user settings on kiosk computers"), use Loopback Processing instead.


## Step 2: WMI Filtering
*Objective: Apply a GPO only if the OS matches a query (e.g., Windows Server).*

1. In **GPMC**, right-click **WMI Filters** > **New**.
2. **Name**: `Servers Only`.
3. **Query**: `SELECT * FROM Win32_OperatingSystem WHERE ProductType = "3"` (3 = Server, 1 = Workstation).
4. Create a **GPO**: `Server-Baseline`. Link to `_Corp\Computers\Servers`.
5. At the bottom of the **GPO Scope** tab, select **WMI Filtering**: `Servers Only`.
6. This GPO will now *skip* any checking machine that isn't a Server.

### 🔍 What Just Happened?
**WMI Filtering** adds a **conditional check** before applying a GPO.

**How it works:**
- WMI (Windows Management Instrumentation) queries system information
- If the query returns `TRUE`, the GPO applies; if `FALSE`, it's skipped
- Evaluated **before** the GPO is downloaded (saves bandwidth)

**Common Use Cases:**
- OS version: `SELECT * FROM Win32_OperatingSystem WHERE Version LIKE '10.0%'` (Windows 10/11)
- Disk space: `SELECT * FROM Win32_LogicalDisk WHERE FreeSpace < 10737418240` (less than 10GB free)
- Laptop detection: `SELECT * FROM Win32_Battery` (has battery = laptop)

**Performance Note:**  
WMI queries add overhead. Use sparingly and keep queries simple.


## Step 3: Item-Level Targeting (Preferences)
*Objective: Map a drive ONLY if the user is in a specific group, without separate GPOs.*

1. Edit your previous `General-User-Config` GPO.
2. Go to **Drive Maps** (**User Configuration** > **Preferences**).
3. Right-click your `X:` drive > **Properties** > **Common** tab.
4. Check **Item-level targeting**.
5. Click **Targeting...**.
6. **New Item** > **Security Group**.
7. **Select Group**: `HR_Users`.
8. Validation: Now the `X:` drive only maps for HR members, even though the GPO applies to everyone.

### 🔍 What Just Happened?
**Item-Level Targeting (ILT)** is like "mini-WMI filtering" but for **individual preference items**.

**Difference from Security Filtering:**
- **Security Filtering**: Controls the entire GPO (all settings)
- **Item-Level Targeting**: Controls a single preference item (one drive map, one registry key, etc.)

**Available Targeting Items:**
- Security Group membership
- Computer Name (wildcards supported: `KIOSK-*`)
- IP Address Range
- Operating System
- Environment Variables
- File/Folder existence

**Power Feature: Boolean Logic**  
You can combine conditions with AND/OR/NOT:  
*"Apply if user is in HR_Users AND computer name starts with LAPTOP-"*


## Step 4: Software Deployment (MSI) via GPO
*The "Native" alternative to SCCM for simple deployments.*

1. **Prepare the Share**:
   - On **DC1**, create a folder `C:\Deploy`.
   - Right-click > **Sharing** > **Advanced Sharing** > **Share this folder**.
   - **Permissions**: **Everyone** `Read`.
   - Download the **7-Zip MSI** (64-bit) and place it there.
2. **Create GPO**:
   - **Name**: `Deploy-7Zip`. Link it to `_Corp\Computers\Workstations`.
3. **Edit GPO**:
   - Go to: **Computer Configuration** > **Policies** > **Software Settings** > **Software installation**.
   - Right-click > **New** > **Package**.
   - **CRITICAL**: Browse via **UNC Path** (`\\DC1\Deploy\7z.msi`). Do NOT use a local path.
   - Select **Assigned**.
4. **Deploy**:
   - On **Client1**, run `gpupdate /force`.
   - When prompted that the policy requires a restart, type `Y`.
   - During boot, you will see "Installing managed software 7-Zip...".
5. **Verify**:
   - Login. 7-Zip should be installed in Start Menu.

### 🔍 What Just Happened?
You deployed software using **Group Policy Software Installation (GPSI)**—the native, free alternative to SCCM for basic deployments.

**How it works:**
1. GPO points to an MSI file on a network share
2. At computer startup, the client downloads and installs the MSI
3. Installation runs with SYSTEM privileges (no user interaction needed)

**Assigned vs Published:**
- **Assigned (Computer)**: Installs automatically at boot. Users can't uninstall easily. **Best for mandatory software.**
- **Assigned (User)**: Advertised in Start Menu, installs on first use. Follows the user to any computer.
- **Published (User only)**: Available in "Programs and Features" for optional installation.

**Limitations (why enterprises use SCCM/Intune):**
- Only supports MSI files (no EXE installers)
- No scheduling or retry logic
- No detailed reporting
- Requires network share access (problematic for remote workers)

**Best Practices:**
- Use UNC paths (`\\server\share`), never drive letters
- Test on a small OU first
- Keep MSI files on a highly available share (or DFS)

> [!WARNING]
> **Uninstallation**: If you delete the GPO or remove the package, it will **uninstall** from all computers. Use "Advanced → Uninstall when out of scope" carefully!
