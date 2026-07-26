#Requires -Version 5.1
<#
.SYNOPSIS
  WS-F1-T3 - builds the ST4I Machine Simulator MSI installer end to end.

.DESCRIPTION
  Orchestrates the exact same publish steps README.md section 13.2 documents (web UI build, engine publish,
  desktop shell publish) and then builds packaging/installer/St4i.Installer.wixproj against the
  resulting publish-desktop\ tree. Idempotent - safe to re-run; publish-desktop\ is wiped and
  rebuilt from scratch each time so a re-run can never mix stale files from a previous version/commit
  into the new MSI.

  This does NOT need the `wix` global dotnet tool on PATH - the installer project restores its own
  pinned WixToolset.Sdk/WixToolset.Heat NuGet packages (see St4i.Installer.wixproj) and is built via
  plain `dotnet build`. Installing the `wix` CLI is only useful for optional diagnostics
  (`wix msi decompile`/`wix msi validate` - see README.md's "Toolchain" section for the exact version
  to pin, 4.0.5, and why NOT to install the newest one).

.PARAMETER SkipWebBuild
  Skip `npm run build` in web\ (reuse whatever's already in web\dist\). Useful for iterating on just
  the installer authoring without waiting on a full Vite build every time.

.PARAMETER SkipDotnetPublish
  Skip both `dotnet publish` steps (reuse whatever's already in publish-desktop\engine\ and
  publish-desktop\*.exe from a previous run). Combine with -SkipWebBuild to iterate on ONLY
  Package.wxs/the .wixproj against an already-published payload.

.EXAMPLE
  .\packaging\installer\build-installer.ps1
  Full pipeline: web build -> engine publish -> shell publish -> MSI build.

.EXAMPLE
  .\packaging\installer\build-installer.ps1 -SkipWebBuild -SkipDotnetPublish
  Rebuild just the MSI against an existing publish-desktop\ payload (fast iteration on Package.wxs).
#>
[CmdletBinding()]
param(
    [switch]$SkipWebBuild,
    [switch]$SkipDotnetPublish
)

$ErrorActionPreference = 'Stop'

function Invoke-Step {
    <# Runs a native command and throws (with the exit code) if it fails - PowerShell's own
       $ErrorActionPreference='Stop' does NOT catch a non-zero exit code from a native exe, only
       terminating PowerShell errors, so every external tool call in this script is routed through
       this helper instead of being invoked bare. #>
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Command
    )
    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Step '$Name' failed with exit code $LASTEXITCODE."
    }
}

# tools/machine-simulator (this script lives at packaging/installer/build-installer.ps1).
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $repoRoot
try {
    # ---- Version - single source of truth is Directory.Build.props (WS-F1-T1). ----------------
    $propsPath = Join-Path $repoRoot 'Directory.Build.props'
    [xml]$buildProps = Get-Content -Raw $propsPath
    $version = $buildProps.Project.PropertyGroup.Version
    if ([string]::IsNullOrWhiteSpace($version)) {
        throw "Could not read <Version> from $propsPath."
    }
    Write-Host "ST4I Machine Simulator installer build - version $version" -ForegroundColor Green

    # ---- Step 1: web UI (skippable - see -SkipWebBuild) -----------------------------------------
    if (-not $SkipWebBuild) {
        Invoke-Step -Name 'npm run build (web UI -> web/dist)' -Command {
            Push-Location (Join-Path $repoRoot 'web')
            try { npm run build } finally { Pop-Location }
        }
    }
    else {
        Write-Host "`n==> Skipping npm run build (-SkipWebBuild); reusing web/dist as-is." -ForegroundColor Yellow
    }

    if (-not $SkipDotnetPublish) {
        # Wipe any previous publish-desktop\ first - re-running this script must never let a stale
        # file from an older version/commit silently ride along into the new MSI.
        $publishDesktop = Join-Path $repoRoot 'publish-desktop'
        if (Test-Path $publishDesktop) {
            Write-Host "`n==> Removing stale $publishDesktop" -ForegroundColor Cyan
            Remove-Item -Recurse -Force $publishDesktop
        }

        # ---- Step 2: engine (serves the web UI too - README.md section 13.2 step 2) ---------------------
        Invoke-Step -Name 'dotnet publish St4i.EngineApi -> publish-desktop/engine' -Command {
            dotnet publish src/St4i.EngineApi/St4i.EngineApi.csproj -c Release -r win-x64 `
                --self-contained true -p:PublishSingleFile=true -o publish-desktop/engine
        }

        # ---- Step 3: desktop shell (README.md section 13.2 step 3) --------------------------------------
        Invoke-Step -Name 'dotnet publish St4i.DesktopShell -> publish-desktop' -Command {
            dotnet publish src/St4i.DesktopShell/St4i.DesktopShell.csproj -c Release -r win-x64 `
                --self-contained true -p:PublishSingleFile=true -o publish-desktop
        }
    }
    else {
        Write-Host "`n==> Skipping dotnet publish (-SkipDotnetPublish); reusing publish-desktop/ as-is." -ForegroundColor Yellow
        if (-not (Test-Path (Join-Path $repoRoot 'publish-desktop/St4i.DesktopShell.exe'))) {
            throw "publish-desktop/St4i.DesktopShell.exe not found - -SkipDotnetPublish needs a previous publish to reuse."
        }
    }

    # ---- Step 4: the MSI itself ---------------------------------------------------------------
    # No `-p:Platform=x64` needed on the command line - St4i.Installer.wixproj already hardcodes
    # <Platform>x64</Platform> to match the win-x64-only publish-desktop\ payload.
    #
    # Deliberately NOT built with `-o publish-desktop`, and the result is deliberately NOT copied
    # into publish-desktop\ afterward either. St4i.Installer.wixproj's HarvestDirectory harvests the
    # WHOLE publish-desktop\ tree, so having the .msi live inside that same tree - even briefly, even
    # only as a copy made AFTER the harvest completes - means the very next build (the common
    # "tweak Package.wxs, rebuild" inner loop) would harvest the PREVIOUS run's own .msi as if it
    # were part of the app payload, silently ballooning the file count and doubling the .msi size on
    # every rebuild. Confirmed empirically while authoring this script (twice - once building
    # straight into publish-desktop, once copying the result back into it afterward). The one
    # correct fix is to keep the .msi OUT of publish-desktop\ entirely: it stays at the project's own
    # default bin\x64\Release\ output (already covered by this repo's generic `bin/` .gitignore
    # rule), never inside the folder that's also a harvest source.
    Invoke-Step -Name 'dotnet build St4i.Installer.wixproj -> packaging/installer/bin/x64/Release/St4iMachineSimulator.msi' -Command {
        dotnet build packaging/installer/St4i.Installer.wixproj -c Release `
            -p:DefineConstants="Version=$version"
    }

    $msiPath = Join-Path $repoRoot 'packaging/installer/bin/x64/Release/St4iMachineSimulator.msi'
    $msi = Get-Item $msiPath
    Write-Host ""
    Write-Host "Built $($msi.FullName) ($([math]::Round($msi.Length / 1MB, 1)) MB), version $version." -ForegroundColor Green
    Write-Host "All optional features (background service, launch-at-sign-in, exhibition launcher) are OFF by default." -ForegroundColor Green
    Write-Host "See packaging/installer/README.md for install/uninstall commands and how to opt into them (ADDLOCAL)." -ForegroundColor Green
}
finally {
    Pop-Location
}
