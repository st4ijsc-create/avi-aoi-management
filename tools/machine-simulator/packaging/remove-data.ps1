#Requires -Version 5.1
<#
.SYNOPSIS
  DESTRUCTIVE, MANUAL, admin-run script: purges ST4I Machine Simulator runtime data and the
  background service, if installed. NOT run by the MSI uninstaller - see the warning below for why.

.DESCRIPTION
  The MSI installer (packaging/installer/) only ever removes what IT installed, under Program Files -
  it has no idea this exe/service, once running, goes on to create THIRTEEN directories under
  %ProgramData%\ST4I\sim\ - the historian database, the store-and-forward WAL buffer, the local
  user/session/audit-log database, the DPAPI-protected machine credential, the alarm-notification
  channel configuration and its credentials, the DEVICE IDENTITY PRIVATE KEY, saved device connections
  (whose OPC-UA map carries a plaintext password), the OPC-UA client certificate and key, the Site link
  and its pinned PEM, the alarm store, the asset registry, fleet settings, and the bridge spool. That is entirely
  intentional: uninstalling (or upgrading via MajorUpgrade) must never silently destroy a customer's
  production history, audit trail, or credentials. This script is the separate, explicit, opt-in tool
  for an operator who genuinely wants a clean-slate wipe (e.g. decommissioning a machine, resetting a
  demo box back to a fresh-install state).

  Run this from an elevated ("Run as administrator") PowerShell prompt - stopping/deleting the
  service needs it, and %ProgramData% is typically not writable by a non-admin user either.

.PARAMETER Force
  Skip the interactive confirmation prompt for every destructive action (service stop/delete, each
  directory deletion). Still fully respects -WhatIf. Intended for scripted/automated wipes only -
  for a one-off manual run, leave this off and read each prompt.

.PARAMETER HistorianDir
  Override the historian directory to purge, for a deployment that relocated it via
  ST4I_HISTORIAN_DIR (README section 15.2). If omitted, falls back to the ST4I_HISTORIAN_DIR environment
  variable IN THIS SHELL (not the service's own registry Environment - see the WARNING below), then
  to the default %ProgramData%\ST4I\sim\historian.

.PARAMETER WalDir
  Same idea as -HistorianDir, for the WAL directory (ST4I_WAL_DIR).

.PARAMETER SecurityDir
  Same idea as -HistorianDir, for the security directory (ST4I_SECURITY_DIR).

.PARAMETER NotificationsDir
  Task C-8 - same idea as -HistorianDir, for the alarm-notification configuration directory
  (ST4I_NOTIFICATIONS_DIR, README section 22.5). This one holds notifications.db, which stores every
  configured channel AND its DPAPI-protected credentials - webhook URLs, webhook signing secrets,
  webhook auth tokens and SMTP passwords.

.PARAMETER IdentityDir
  Task C-8 review (I-1) - same idea as -HistorianDir, for the device identity directory
  (ST4I_IDENTITY_DIR). Holds device-identity.bin: the device's PFX PRIVATE KEY, sealed with DPAPI at
  LocalMachine scope, so any local administrator on the machine can unseal it.

.PARAMETER ConnectorConfigDir
  Task C-8 review (I-1) - same idea as -HistorianDir, for saved device connections
  (ST4I_CONNECTOR_CONFIG_DIR). Holds the register/node-map JSON verbatim; an OPC-UA node map carries
  its password as a PLAINTEXT field.

.PARAMETER OpcUaPkiDir
  Task C-8 review (I-1) - the OPC-UA application-certificate store (ST4I_OPCUA_PKI_DIR): the client
  certificate, its private key, and the trusted-peer store.

.PARAMETER SiteLinkDir
  Task C-8 review (I-1) - the Site link configuration and the operator-pinned Site PEM
  (ST4I_SITELINK_DIR).

.PARAMETER AlarmsDir
  Task C-8 review (I-1) - the alarm store, alarms.db (ST4I_ALARMS_DIR).

.PARAMETER AssetsDir
  Task C-8 review (I-1) - the asset registry, assets.db (ST4I_ASSETS_DIR).

.PARAMETER SettingsDir
  Task C-8 review (I-1) - fleet settings (ST4I_SETTINGS_DIR).

.PARAMETER BridgeSpoolDir
  Task C-8 review (I-1) - the durable northbound bridge spool (ST4I_BRIDGE_SPOOL_DIR).

.EXAMPLE
  .\packaging\remove-data.ps1 -WhatIf
  Preview exactly what would be stopped/deleted, without touching anything.

.EXAMPLE
  .\packaging\remove-data.ps1
  Interactive - prompts (Y/N) before stopping/deleting the service and before deleting each of the
  14 data directories (each resolved per the matching -XxxDir parameter or the matching
  ST4I_*_DIR environment variable or the default %ProgramData%\ST4I\sim\<name> - see the
  WARNING below about relocated directories this script cannot discover on its own).

.EXAMPLE
  .\packaging\remove-data.ps1 -Force
  Non-interactive - deletes everything immediately, no prompts. Use with real care.

.EXAMPLE
  .\packaging\remove-data.ps1 -HistorianDir D:\St4iData\historian -WalDir D:\St4iData\wal -SecurityDir D:\St4iData\security -IdentityDir D:\St4iData\identity
  Purges relocated data directories explicitly - needed whenever the service was configured (via its
  registry Environment value, README section 15.2) with a directory that is NOT the default
  %ProgramData%\ST4I\sim\<name>. There is one -XxxDir parameter per relocatable directory; see the
  full list under .PARAMETER above.

.NOTES
  WS-F1 final-review fix F3 - README section 15.2 advertises ST4I_HISTORIAN_DIR/ST4I_WAL_DIR/
  ST4I_SECURITY_DIR as relocatable, but this script used to hardcode %ProgramData%\ST4I\sim\* only -
  a relocated deployment's REAL data would silently survive a "wipe" untouched (the default,
  now-empty directory gets deleted; the real one elsewhere never does). This script now resolves
  each of those three per -XxxDir parameter > same-named ST4I_XXX_DIR environment variable (read from
  THIS PowerShell process only) > the %ProgramData% default.

  WARNING - this does NOT read the Windows Service's own registry Environment value
  (HKLM\SYSTEM\CurrentControlSet\Services\St4iEngineApi\Environment, README section 15.2) - only this
  script's OWN process/shell environment. If the service was relocated via THAT registry value and
  this shell does not have the matching ST4I_*_DIR variables exported, pass the matching -XxxDir
  parameter explicitly (check the registry value first, e.g. `Get-ItemProperty
  'HKLM:\SYSTEM\CurrentControlSet\Services\St4iEngineApi' -Name Environment`) - otherwise a relocated
  directory is silently missed by this script and must be removed manually.

  TEST-HYGIENE BATCH - `creds` IS NOW RELOCATABLE (ST4I_CREDS_DIR) and resolves through the same
  -CredsDir > env var > %ProgramData% default order as every other directory here. It was previously
  the sole exception, hardcoded to %ProgramData%\ST4I\sim\creds, because CredentialStore was a static
  class that resolved its directory straight from CommonApplicationData with no override. That made it
  the one store a test could not point somewhere harmless - which is how ~3,000 test-generated
  DPAPI-sealed .bin blobs came to accumulate in the real credential directory of a developer machine.
  Adding the override to the store made the exception here unnecessary; leaving this script hardcoded
  afterwards would have been strictly worse than before, because a relocated install's credential
  directory would then be silently missed by the very wipe that exists to remove it.

  TASK C-8 - `notifications` was ADDED to the purge list, and its absence was a real defect rather than
  a documentation gap. Dot C (C-2..C-7) introduced %ProgramData%\ST4I\sim\notifications\notifications.db,
  which stores every configured alarm-notification channel together with its DPAPI-protected secrets:
  webhook URLs (a Slack/Teams incoming webhook URL IS a bearer capability - whoever holds it can post),
  webhook HMAC signing secrets, webhook auth tokens, and SMTP passwords. Before this change a
  decommissioning wipe deleted the machine's own credential and its audit log but left all of THOSE
  behind on a box being handed on, scrapped or returned - the exact outcome this script exists to
  prevent. It is relocatable via ST4I_NOTIFICATIONS_DIR and resolves through the same
  -NotificationsDir > env var > %ProgramData% default order as the other three.

  TASK C-8 REVIEW ROUND 1 (I-1) - THE PURGE LIST WENT FROM FIVE DIRECTORIES TO ALL THIRTEEN, and the
  reason is that fixing `notifications` alone did not close the class the fix's own argument named.
  The engine creates thirteen directories under %ProgramData%\ST4I\sim (one default-path constant per
  store, verified against src/); this script purged five while its .DESCRIPTION claimed to wipe what
  the engine creates. Two of the eight it missed hold CREDENTIALS, and the argument written above for
  `notifications` applied to them verbatim - and to the first one more strongly:

    identity          - device-identity.bin is the device's PFX PRIVATE KEY, sealed with DPAPI at
                        *LocalMachine* scope rather than CurrentUser, so ANY local administrator on the
                        machine can unseal it. It is created unconditionally on every boot, so it is
                        present even on a box that never configured a Site link.
    connector-config  - persists the register/node-map JSON verbatim, and an OPC-UA node map carries
                        `Password` as a PLAINTEXT string field.

  The remaining six (opcua-pki, sitelink, alarms, assets, settings, bridge-spool) are customer data or
  trust material rather than bearer credentials, but this script's stated purpose is a CLEAN-SLATE wipe
  for decommissioning - leaving them meant it did not do that, and an operator reading the old output
  would reasonably have believed the machine was clean. All eight are relocatable and each resolves
  through the same -XxxDir > env var > %ProgramData% default order as the original three.

  Every one of the fourteen directories is now relocatable; there is no longer any exception.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
# PSScriptAnalyzer matches the substring "Cred" in a [string] parameter name and assumes it carries a
# password. -CredsDir is a DIRECTORY PATH (the creds store's location, the -XxxDir sibling of
# -IdentityDir/-SecurityDir/...), never a secret, so SecureString/PSCredential would be actively wrong
# here. Suppressed by name rather than renamed: the parameter has to stay -CredsDir to match the
# `creds` directory and ST4I_CREDS_DIR, and every other directory parameter follows the same shape.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
    'PSAvoidUsingPlainTextForPassword', 'CredsDir',
    Justification = 'CredsDir is a filesystem path to the credential STORE directory, not a credential.')]
param(
    [switch]$Force,
    [string]$HistorianDir,
    [string]$WalDir,
    [string]$SecurityDir,
    [string]$NotificationsDir,
    [string]$AlarmsDir,
    [string]$AssetsDir,
    [string]$SettingsDir,
    [string]$IdentityDir,
    [string]$SiteLinkDir,
    [string]$OpcUaPkiDir,
    [string]$BridgeSpoolDir,
    [string]$ConnectorConfigDir,
    [string]$CredsDir
)

$ErrorActionPreference = 'Stop'

# -Force disables the interactive Y/N confirmation prompt for the rest of this script (via
# $PSCmdlet.ShouldProcess below) while -WhatIf keeps working regardless - they are independent
# PowerShell mechanisms, not opposites of each other.
if ($Force) {
    $ConfirmPreference = 'None'
}

$serviceName = 'St4iEngineApi'
$programData = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
$root = Join-Path $programData 'ST4I\sim'

# WS-F1 final-review fix F3 - resolve each relocatable directory the SAME "explicit override wins,
# else the matching env var, else the %ProgramData% default" order Program.cs itself uses for
# ST4I_HISTORIAN_DIR/ST4I_WAL_DIR/ST4I_SECURITY_DIR (README section 15.2) - see this script's own
# .NOTES for why the env var here is only ever THIS shell's, never the service's registry Environment.
function Resolve-DataDir {
    param([string]$Explicit, [string]$EnvVarName, [string]$DefaultPath)
    if (-not [string]::IsNullOrWhiteSpace($Explicit)) { return $Explicit }
    $fromEnv = [Environment]::GetEnvironmentVariable($EnvVarName)
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) { return $fromEnv }
    return $DefaultPath
}

$subdirs = @(
    @{ Name = 'historian'; Path = (Resolve-DataDir $HistorianDir 'ST4I_HISTORIAN_DIR' (Join-Path $root 'historian')); Warning = 'ALL production/OEE history and cycle data (SqliteHistorianStore)' }
    @{ Name = 'wal';       Path = (Resolve-DataDir $WalDir       'ST4I_WAL_DIR'       (Join-Path $root 'wal'));       Warning = 'any buffered store-and-forward writes not yet delivered to the server' }
    @{ Name = 'security';  Path = (Resolve-DataDir $SecurityDir  'ST4I_SECURITY_DIR'  (Join-Path $root 'security'));  Warning = 'the user database, sessions, and the hash-chained AUDIT LOG (security.db)' }
    # Test-hygiene batch - `creds` is relocatable now (ST4I_CREDS_DIR); see this script's own .NOTES.
    @{ Name = 'creds';     Path = (Resolve-DataDir $CredsDir     'ST4I_CREDS_DIR'     (Join-Path $root 'creds'));     Warning = 'the DPAPI-protected machine credential(s) (mk_...) - re-onboarding required after this' }
    # Task C-8 - see this script's .NOTES. Added because its ABSENCE left live third-party credentials
    # on a decommissioned machine, which is the one outcome this script exists to prevent.
    @{ Name = 'notifications'; Path = (Resolve-DataDir $NotificationsDir 'ST4I_NOTIFICATIONS_DIR' (Join-Path $root 'notifications')); Warning = 'alarm notification channels AND their DPAPI-protected credentials - webhook URLs, webhook signing secrets, webhook auth tokens, SMTP passwords (notifications.db)' }

    # ---- Task C-8 review round 1 (I-1) --------------------------------------------------------
    # The eight directories this script has NEVER purged. The engine creates THIRTEEN under
    # %ProgramData%\ST4I\sim (one constant per store, verified against src/); this script purged five,
    # while its own .DESCRIPTION claimed to wipe what the engine creates. Two of the eight hold
    # CREDENTIALS, so the security argument written for `notifications` above applied verbatim - and
    # more strongly - to them:
    #
    #   identity          - device-identity.bin is the device's PFX PRIVATE KEY. It is sealed with
    #                       DPAPI at *LocalMachine* scope (DeviceIdentityStore.cs:143), NOT CurrentUser,
    #                       so ANY local administrator on the box can unseal it. Created unconditionally
    #                       on every boot (Program.cs), so it is present even on a machine that never
    #                       configured a Site link.
    #   connector-config  - persists the register/node-map JSON VERBATIM (ConnectorConfigVisibilitySeeder),
    #                       and OpcUaNodeMap.Password is a PLAINTEXT string field inside that JSON
    #                       (OpcUaNodeMap.cs:231). The product's own UI says so out loud.
    #
    # The other six are customer data rather than credentials, but the script's stated purpose is a
    # clean-slate wipe for decommissioning - leaving them meant it did not do that.
    @{ Name = 'identity';         Path = (Resolve-DataDir $IdentityDir        'ST4I_IDENTITY_DIR'         (Join-Path $root 'identity'));         Warning = 'the DEVICE IDENTITY PRIVATE KEY (device-identity.bin, a PFX sealed with LocalMachine-scoped DPAPI - any local admin can unseal it) - the Site must re-trust this device after this' }
    @{ Name = 'connector-config'; Path = (Resolve-DataDir $ConnectorConfigDir 'ST4I_CONNECTOR_CONFIG_DIR' (Join-Path $root 'connector-config')); Warning = 'saved device connections INCLUDING the register/node-map JSON verbatim - an OPC-UA map carries its password in PLAINTEXT' }
    @{ Name = 'opcua-pki';        Path = (Resolve-DataDir $OpcUaPkiDir        'ST4I_OPCUA_PKI_DIR'        (Join-Path $root 'opcua-pki'));        Warning = "the OPC-UA client application certificate AND ITS PRIVATE KEY, plus the trusted-peer store - the server's trust list must be updated after this" }
    @{ Name = 'sitelink';         Path = (Resolve-DataDir $SiteLinkDir        'ST4I_SITELINK_DIR'         (Join-Path $root 'sitelink'));         Warning = 'the Site link configuration and the operator-pinned Site CA/server PEM - the ecosystem link must be re-established and re-pinned by hand' }
    @{ Name = 'alarms';           Path = (Resolve-DataDir $AlarmsDir          'ST4I_ALARMS_DIR'           (Join-Path $root 'alarms'));           Warning = 'the active alarm set and the append-only alarm history (alarms.db)' }
    @{ Name = 'assets';           Path = (Resolve-DataDir $AssetsDir          'ST4I_ASSETS_DIR'           (Join-Path $root 'assets'));           Warning = 'the asset registry - every registered asset and its lifecycle state (assets.db)' }
    @{ Name = 'settings';         Path = (Resolve-DataDir $SettingsDir        'ST4I_SETTINGS_DIR'         (Join-Path $root 'settings'));         Warning = 'fleet settings - server URL, machine code, TLS verification, transport mode' }
    @{ Name = 'bridge-spool';     Path = (Resolve-DataDir $BridgeSpoolDir     'ST4I_BRIDGE_SPOOL_DIR'     (Join-Path $root 'bridge-spool'));     Warning = 'any northbound bridge messages spooled but not yet delivered to the Site' }
)

Write-Host ""
Write-Host "=================================================================================" -ForegroundColor Red
Write-Host " DESTRUCTIVE - this permanently deletes ST4I Machine Simulator runtime data" -ForegroundColor Red
Write-Host "=================================================================================" -ForegroundColor Red
Write-Host ""
Write-Host "Default root: $root (every directory may be relocated - resolved path shown per entry)" -ForegroundColor Yellow
foreach ($d in $subdirs) {
    Write-Host ("  {0,-10} - {1}" -f $d.Name, $d.Warning) -ForegroundColor Yellow
    Write-Host ("               -> $($d.Path)") -ForegroundColor DarkYellow
}
Write-Host ""
Write-Host "None of this is recoverable. Nothing here is touched by the MSI uninstaller by design -" -ForegroundColor Yellow
Write-Host "this is a separate, explicit, manual step. Ctrl-C now if you are not certain." -ForegroundColor Yellow
Write-Host ""
Write-Host "NOTE: relocated dirs are only found via the matching -XxxDir parameter or this SHELL's" -ForegroundColor Yellow
Write-Host "own ST4I_*_DIR env vars - NOT the service's registry Environment value. If none of those" -ForegroundColor Yellow
Write-Host "match how the service was actually configured, remove the real directory by hand." -ForegroundColor Yellow
Write-Host ""

# ---- Step 1: stop + delete the Windows service, if present ------------------------------------
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -eq $svc) {
    Write-Host "Service '$serviceName' is not installed - nothing to stop/delete." -ForegroundColor DarkGray
}
elseif ($PSCmdlet.ShouldProcess("Windows service '$serviceName'", "Stop and delete")) {
    if ($svc.Status -ne 'Stopped') {
        Write-Host "Stopping service '$serviceName'..." -ForegroundColor Cyan
        Stop-Service -Name $serviceName -Force -Confirm:$false
    }
    Write-Host "Deleting service '$serviceName'..." -ForegroundColor Cyan
    & sc.exe delete $serviceName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "sc.exe delete '$serviceName' exited $LASTEXITCODE (it may already be gone, or this needs an elevated prompt)."
    }
}

# ---- Step 2: delete the 14 data subdirectories (each already resolved above per -XxxDir / ST4I_*_DIR
# / the %ProgramData% default - see $subdirs) --------------------------------------------------
Write-Host ""
foreach ($d in $subdirs) {
    $path = $d.Path
    if (-not (Test-Path $path)) {
        Write-Host "$path does not exist - nothing to remove." -ForegroundColor DarkGray
        continue
    }

    if ($PSCmdlet.ShouldProcess($path, "Permanently delete directory and all contents")) {
        Remove-Item -Recurse -Force -Confirm:$false $path
        Write-Host "Deleted $path" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
