#Requires -Version 5.1
<#
.SYNOPSIS
  DESTRUCTIVE, MANUAL, admin-run script: purges ST4I Machine Simulator runtime data and the
  background service, if installed. NOT run by the MSI uninstaller - see the warning below for why.

.DESCRIPTION
  The MSI installer (packaging/installer/) only ever removes what IT installed, under Program Files -
  it has no idea this exe/service, once running, goes on to create %ProgramData%\ST4I\sim\{historian,
  wal,security,creds}\ (the historian database, the store-and-forward WAL buffer, the local user/
  session/audit-log database, and the DPAPI-protected machine credential). That is entirely
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

.EXAMPLE
  .\packaging\remove-data.ps1 -WhatIf
  Preview exactly what would be stopped/deleted, without touching anything.

.EXAMPLE
  .\packaging\remove-data.ps1
  Interactive - prompts (Y/N) before stopping/deleting the service and before deleting each of the
  4 data directories (historian/wal/security resolved per -HistorianDir/-WalDir/-SecurityDir or the
  matching ST4I_*_DIR environment variable or the default %ProgramData%\ST4I\sim\<name> - see the
  WARNING below about relocated directories this script cannot discover on its own).

.EXAMPLE
  .\packaging\remove-data.ps1 -Force
  Non-interactive - deletes everything immediately, no prompts. Use with real care.

.EXAMPLE
  .\packaging\remove-data.ps1 -HistorianDir D:\St4iData\historian -WalDir D:\St4iData\wal -SecurityDir D:\St4iData\security
  Purges relocated data directories explicitly - needed whenever the service was configured (via its
  registry Environment value, README section 15.2) with a historian/wal/security directory that is NOT the
  default %ProgramData%\ST4I\sim\<name>.

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
  this shell does not have the matching ST4I_*_DIR variables exported, pass -HistorianDir/-WalDir/
  -SecurityDir explicitly (check the registry value first, e.g. `Get-ItemProperty
  'HKLM:\SYSTEM\CurrentControlSet\Services\St4iEngineApi' -Name Environment`) - otherwise a relocated
  directory is silently missed by this script and must be removed manually.

  `creds` (the DPAPI-protected machine credential) has no relocation env var - CredentialStore is not
  relocatable - so it is always purged at %ProgramData%\ST4I\sim\creds.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [switch]$Force,
    [string]$HistorianDir,
    [string]$WalDir,
    [string]$SecurityDir
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
    # `creds` has no relocation env var (CredentialStore is not relocatable) - always under $root.
    @{ Name = 'creds';     Path = (Join-Path $root 'creds');                                                          Warning = 'the DPAPI-protected machine credential(s) (mk_...) - re-onboarding required after this' }
)

Write-Host ""
Write-Host "=================================================================================" -ForegroundColor Red
Write-Host " DESTRUCTIVE - this permanently deletes ST4I Machine Simulator runtime data" -ForegroundColor Red
Write-Host "=================================================================================" -ForegroundColor Red
Write-Host ""
Write-Host "Default root: $root (historian/wal/security may be relocated - resolved path shown per entry)" -ForegroundColor Yellow
foreach ($d in $subdirs) {
    Write-Host ("  {0,-10} - {1}" -f $d.Name, $d.Warning) -ForegroundColor Yellow
    Write-Host ("               -> $($d.Path)") -ForegroundColor DarkYellow
}
Write-Host ""
Write-Host "None of this is recoverable. Nothing here is touched by the MSI uninstaller by design -" -ForegroundColor Yellow
Write-Host "this is a separate, explicit, manual step. Ctrl-C now if you are not certain." -ForegroundColor Yellow
Write-Host ""
Write-Host "NOTE: relocated dirs are only found via -HistorianDir/-WalDir/-SecurityDir or this SHELL's" -ForegroundColor Yellow
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

# ---- Step 2: delete the 4 data subdirectories (each already resolved above per -XxxDir / ST4I_*_DIR
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
