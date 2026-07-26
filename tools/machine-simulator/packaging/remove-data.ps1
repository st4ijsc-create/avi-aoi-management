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

.EXAMPLE
  .\packaging\remove-data.ps1 -WhatIf
  Preview exactly what would be stopped/deleted, without touching anything.

.EXAMPLE
  .\packaging\remove-data.ps1
  Interactive - prompts (Y/N) before stopping/deleting the service and before deleting each of the
  4 data directories.

.EXAMPLE
  .\packaging\remove-data.ps1 -Force
  Non-interactive - deletes everything immediately, no prompts. Use with real care.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [switch]$Force
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
$subdirs = @(
    @{ Name = 'historian'; Warning = 'ALL production/OEE history and cycle data (SqliteHistorianStore)' }
    @{ Name = 'wal';       Warning = 'any buffered store-and-forward writes not yet delivered to the server' }
    @{ Name = 'security';  Warning = 'the user database, sessions, and the hash-chained AUDIT LOG (security.db)' }
    @{ Name = 'creds';     Warning = 'the DPAPI-protected machine credential(s) (mk_...) - re-onboarding required after this' }
)

Write-Host ""
Write-Host "=================================================================================" -ForegroundColor Red
Write-Host " DESTRUCTIVE - this permanently deletes ST4I Machine Simulator runtime data" -ForegroundColor Red
Write-Host "=================================================================================" -ForegroundColor Red
Write-Host ""
Write-Host "Target: $root" -ForegroundColor Yellow
foreach ($d in $subdirs) {
    Write-Host ("  {0,-10} - {1}" -f $d.Name, $d.Warning) -ForegroundColor Yellow
}
Write-Host ""
Write-Host "None of this is recoverable. Nothing here is touched by the MSI uninstaller by design -" -ForegroundColor Yellow
Write-Host "this is a separate, explicit, manual step. Ctrl-C now if you are not certain." -ForegroundColor Yellow
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

# ---- Step 2: delete the 4 data subdirectories --------------------------------------------------
Write-Host ""
foreach ($d in $subdirs) {
    $path = Join-Path $root $d.Name
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
