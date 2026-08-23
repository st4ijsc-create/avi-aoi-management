#Requires -Version 5.1
<#
.SYNOPSIS
  DESTRUCTIVE, MANUAL, admin-run script: purges ST4I Machine Simulator runtime data and the
  background service, if installed. NOT run by the MSI uninstaller - see the warning below for why.

.DESCRIPTION
  The MSI installer (packaging/installer/) only ever removes what IT installed, under Program Files -
  it has no idea this exe/service, once running, goes on to create SIXTEEN directories under
  %ProgramData%\ST4I\sim\ - the historian database, the store-and-forward WAL buffer, the local
  user/session/audit-log database, the DPAPI-protected machine credential, the alarm-notification
  channel configuration and its credentials, the DEVICE IDENTITY PRIVATE KEY, saved device connections
  (whose OPC-UA map carries a plaintext password), the OPC-UA client certificate and key, the Site link
  and its pinned PEM, the alarm store, the asset registry, fleet settings, the bridge spool, the machine
  operating configuration, the product/recipe configuration, and the simulated-ecosystem configuration.
  That is entirely
  intentional: uninstalling (or upgrading via MajorUpgrade) must never silently destroy a customer's
  production history, audit trail, or credentials. This script is the separate, explicit, opt-in tool
  for an operator who genuinely wants a clean-slate wipe (e.g. decommissioning a machine, resetting a
  demo box back to a fresh-install state).

  IT CREATES SIXTEEN AND PURGES FOURTEEN. Two of the sixteen - `products` and `ecosystem`, holding the
  four files products.json / recipes.json / ecosystem-products.json / ecosystem-recipes.json - are
  DELIBERATELY KEPT, by the owner's ruling of 2026-08-23(b), and are listed separately in the banner
  this script prints. The reason, in the owner's words: CONFIGURATION AN OPERATOR AUTHORED IS NOT
  OPERATIONAL DATA - IT IS SOMETHING THEY BUILT, and "remove data" should not cost them that. This is
  NOT the pre-2026-08-23 arrangement re-labelled: before that date those files sat beside the binary and
  went when the install directory went, which was an accident of layout; now they are under
  %ProgramData% and are kept ON PURPOSE, which is a decision with a name and a date on it.

  THE OTHER DIRECTION OF THE SAME RULING, because a kept directory is a survival and survivals cut both
  ways: a machine handed on, scrapped or returned after running this script still carries its product
  and recipe definitions, including anything an operator typed into them. They hold no credential and no
  production history - that is why the ruling was available at all - but they are not nothing. An
  operator who wants them gone deletes those two directories by hand; the banner prints their resolved
  paths for exactly that reason.

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

.PARAMETER MachineConfigDir
  Task BF-1, owner ruling 2026-08-23(a) - the machine operating configuration
  (ST4I_MACHINE_CONFIG_DIR): per-machine parameter baselines, the operator's adjustments, and the
  append-only History list behind them. Until 2026-08-23 this store wrote BESIDE THE BINARY and this
  script deliberately had no parameter for it - see the retraction in .NOTES.

.PARAMETER ProductsDir
  Task BF-1 - the product/recipe configuration (ST4I_PRODUCTS_DIR), holding products.json and
  recipes.json. RESOLVED FOR REPORTING, NOT FOR DELETION: this directory is on the KEPT list by the
  owner's ruling of 2026-08-23(b). Pass it so the banner prints the right path for a relocated install;
  passing it does NOT cause a purge, and there is no flag that makes it one.

.PARAMETER EcosystemDir
  Task BF-1 - the simulated-ecosystem configuration (ST4I_ECOSYSTEM_DIR), holding
  ecosystem-products.json and ecosystem-recipes.json. Same status as -ProductsDir: resolved for
  reporting, KEPT by the 2026-08-23(b) ruling, never deleted by this script.

.PARAMETER CredsDir
  Dot F branch review (F-9) - the DPAPI-sealed machine credential store, one .bin per machine code
  (ST4I_CREDS_DIR). THIS BLOCK WAS MISSING while the parameter itself has existed since the test-hygiene
  batch, so `.NOTES` below could say "one -XxxDir parameter per relocatable directory; see the full list
  under .PARAMETER above" while pointing at a list of twelve. It is the thirteenth, and it is the one
  holding bearer credentials - see the test-hygiene note further down for why `creds` stopped being the
  sole non-relocatable exception.

.EXAMPLE
  .\packaging\remove-data.ps1 -WhatIf
  Preview exactly what would be stopped/deleted, without touching anything.

.EXAMPLE
  .\packaging\remove-data.ps1
  Interactive - prompts (Y/N) before stopping/deleting the service and before deleting each of the
  14 purged data directories (each resolved per the matching -XxxDir parameter or the matching
  ST4I_*_DIR environment variable or the default %ProgramData%\ST4I\sim\<name> - see the
  WARNING below about relocated directories this script cannot discover on its own). The 2 KEPT
  directories (products, ecosystem - owner ruling 2026-08-23(b)) are printed but never prompted for,
  because there is nothing to confirm: this script does not delete them.

.EXAMPLE
  .\packaging\remove-data.ps1 -Force
  Non-interactive - deletes everything immediately, no prompts. Use with real care.

.EXAMPLE
  .\packaging\remove-data.ps1 -HistorianDir D:\St4iData\historian -WalDir D:\St4iData\wal -SecurityDir D:\St4iData\security -IdentityDir D:\St4iData\identity
  Purges relocated data directories explicitly - needed whenever the service was configured (via its
  registry Environment value, README section 15.2) with a directory that is NOT the default
  %ProgramData%\ST4I\sim\<name>. There is one -XxxDir parameter per relocatable directory - SIXTEEN of
  them, all sixteen documented under .PARAMETER above (-CredsDir's block was missing until the Dot F
  branch review, F-9; -MachineConfigDir, -ProductsDir and -EcosystemDir arrived with task BF-1). FOURTEEN
  of those sixteen name a directory this script PURGES; -ProductsDir and -EcosystemDir resolve the two the
  owner's 2026-08-23(b) ruling KEEPS, so passing them changes what is PRINTED and never what is deleted.

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
  -NotificationsDir > env var > %ProgramData% default order as the four that already had the idiom
  (historian, wal, security, creds).

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
  through the same -XxxDir > env var > %ProgramData% default order as the five that already did
  (historian, wal, security, creds, notifications).

  Every one of the thirteen MACHINE-WIDE directories is now relocatable; there is no longer any
  exception within that population.

  TASK H-1c - AND "WITHIN THAT POPULATION" IS NOT A HEDGE. This script purges %ProgramData%, and the
  thirteen names below are every directory the engine creates there. The product ALSO writes three
  persistent stores BESIDE THE ENGINE BINARY - MachineConfigStore (machine-operating-config.json),
  ProductConfigStore (products.json, recipes.json) and SimulatedEcosystem (ecosystem\*.json). This
  script has never purged them and is not being taught to: they go when the install directory goes,
  which is what an uninstall does.

  THE ONE CASE THAT LEAVES DATA BEHIND, said here because nothing else would say it. H-1c gave
  MachineConfigStore a relocation seam, ST4I_MACHINE_CONFIG_DIR. An operator who sets it has put
  customer data somewhere neither the install directory nor this script covers, and there is
  deliberately NO -MachineConfigDir parameter: adding one would put a beside-the-binary store into a
  parameter list whose own count sentences are about %ProgramData%, which is the population confusion
  H-1c exists to end. If ST4I_MACHINE_CONFIG_DIR is set anywhere in the deployment, delete that
  directory by hand. README section 15.9's second-population subsection says the same thing where an
  operator reads. That variable is also why the ST4I_*_DIR literal count in src/ is FOURTEEN while the
  directory count here is THIRTEEN - two populations, not an off-by-one.

  TASK BF-1, 2026-08-23 - THE TWO BLOCKS DIRECTLY ABOVE ARE RETRACTED, kept verbatim and not struck
  through, in the house style docs/owner-decisions.md established. Every sentence in them was true from
  H-1c until the owner's ruling of 2026-08-23(a); the ruling moved all three beside-the-binary defaults
  under %ProgramData%\ST4I\sim, and each clause fails for that one reason:
    * "the thirteen names below are every directory the engine creates there" - SIXTEEN now.
    * "This script has never purged them and is not being taught to" - it is being taught to purge ONE
      of the three, machine-config. The other two are on the KEPT list, which is a THIRD status this
      script did not previously have and is not the same thing as being out of reach.
    * "they go when the install directory goes" - they no longer live in the install directory, so an
      uninstall no longer touches them at all. For products/ecosystem that is now the POINT (ruling (b));
      for machine-config it is why the -MachineConfigDir parameter had to exist.
    * "there is deliberately NO -MachineConfigDir parameter ... would put a beside-the-binary store into
      a parameter list whose own count sentences are about %ProgramData%" - the reasoning was sound and
      its premise is gone: machine-config IS a %ProgramData% leaf now, so the parameter belongs in the
      list rather than confusing it.
    * "FOURTEEN ... while the directory count here is THIRTEEN - two populations" - SIXTEEN and SIXTEEN,
      ONE population. The beside-the-binary population is empty, and PerHostDataRootsTests pins it at
      exactly zero rather than merely quantifying over it.
  What SURVIVES unretracted is the shape of the warning, in a new subject: this script still reads only
  its OWN shell's environment, so a deployment that relocated any of the sixteen through the service's
  registry Environment value still needs the matching -XxxDir passed by hand.

  TASK BF-1 - THE KEPT LIST, AND WHY A THIRD STATUS WAS NEEDED RATHER THAN A SILENT OMISSION. Moving
  products/recipes/ecosystem-products/ecosystem-recipes under %ProgramData% automatically enlisted them
  in this purge, because NotificationDocumentationTests.
  EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript required EVERY leaf
  the engine declares to appear as a `Name = '<leaf>'` entry here. That was a NEW data-loss path nobody
  had asked for, and the owner ruled on it explicitly (2026-08-23(b)): the four config files are exempt,
  because configuration an operator authored is not operational data. The published assertion was
  therefore RETRACTED and NARROWED rather than deleted - it now reads "every leaf is either purged or
  KEPT BY NAME with a stated reason", the kept set is pinned at exactly {ecosystem, products}, and a
  leaf that is in neither list still fails the run. The mechanical difference that makes it checkable:
  a purged directory is spelled `Name = '<leaf>'` and a kept one `Keep = '<leaf>'`, so the two can never
  be confused by the scan and a leaf cannot appear in both.

  TASK F-1 CENSUS - THE COUNT ABOVE SAID "FOURTEEN" IN THREE PLACES AND "THIRTEEN" IN FOUR, about
  the same set, since Task C-8. Measured rather than reasoned about: this script declares thirteen
  `Name = '<dir>'` entries and thirteen -XxxDir parameters, and
  PerHostDataRootsTests.EveryMachineWideDirectory_IsRelocatable_ByADerivableEnvVarName derives the
  same thirteen from src/. The number is THIRTEEN; the three "fourteen"/"14" readings were wrong and
  are corrected here. Nothing about what the script DOES changed.

  TASK F-1 REVIEW (M-3) - AND THAT SAME COUNTING CENSUS LEFT TWO AMBIGUOUS ANTECEDENTS STANDING IN THE
  BLOCK IT WAS EDITING: "as the other three" and "as the original three", both of which name a count
  of directories that had already grown past three by the point each sentence describes. Corrected to
  name the directories instead of counting them, which is the form a count cannot rot into. A rule that
  scans for NUMBERS reads digits and spelled-out numerals; "three" inside a comparative clause is both,
  and it survived a pass of that very rule over this very file.

  TASK F-1 - AND THE WARNING ABOVE IS NOW WORSE THAN IT READS, because a machine can run TWO ST4I
  hosts (St4i.EngineApi and St4i.EdgeService, README section 24) and per-host data roots are a
  SUPPORTED deployment (README section 15.9). Each host has its OWN registry Environment value, so a
  wipe run from a shell without the variables exported can miss BOTH sets. Check each service key
  (`Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\<service>' -Name Environment`) and run
  this script once per host with that host's -XxxDir parameters. Data left behind by a "clean-slate"
  wipe is the exact outcome this script exists to prevent.
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
    [string]$CredsDir,
    # Task BF-1 - the three leaves the owner's 2026-08-23(a) ruling created. -MachineConfigDir is a
    # purge parameter like the thirteen above it; -ProductsDir and -EcosystemDir are RESOLVED FOR
    # REPORTING ONLY (ruling (b) keeps those two), and nothing in this script deletes what they name.
    [string]$MachineConfigDir,
    [string]$ProductsDir,
    [string]$EcosystemDir
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

    # ---- Task BF-1, owner ruling 2026-08-23(a) --------------------------------------------------
    # machine-config joined this list the day its store's default moved under %ProgramData%. It is
    # PURGED and its two new siblings are not, and the split is the owner's ruling (b) rather than a
    # judgement made here: this file holds the machine's operating parameters and the append-only
    # History of every adjustment - a record of what the machine DID, which is operational data - while
    # products/ecosystem hold definitions an operator AUTHORED. See $keptByDesign below.
    @{ Name = 'machine-config';   Path = (Resolve-DataDir $MachineConfigDir   'ST4I_MACHINE_CONFIG_DIR'   (Join-Path $root 'machine-config'));   Warning = 'per-machine operating parameters, every operator adjustment, and the append-only History behind them (machine-operating-config.json)' }
)

# ---- Task BF-1, owner ruling 2026-08-23(b): THE KEPT LIST -----------------------------------------
# Directories the engine creates under %ProgramData%\ST4I\sim that this script resolves, REPORTS, and
# deliberately does NOT delete. Spelled `Keep =` rather than `Name =` so the census in
# NotificationDocumentationTests can tell the two statuses apart mechanically and a leaf can never be
# silently counted as purged because it appeared in a list at all.
#
# This is a THIRD status, and it is new. Before 2026-08-23 a leaf was either purged or did not exist;
# these four files existed beside the binary, out of this script's reach by ACCIDENT OF LAYOUT. Keeping
# them is now a decision with a date and an owner on it, and the reason is recorded where it is acted
# on rather than only in a report: configuration an operator authored is not operational data.
$keptByDesign = @(
    @{ Keep = 'products';  Path = (Resolve-DataDir $ProductsDir  'ST4I_PRODUCTS_DIR'  (Join-Path $root 'products'));  Reason = 'products.json + recipes.json - product and recipe definitions an operator authored' }
    @{ Keep = 'ecosystem'; Path = (Resolve-DataDir $EcosystemDir 'ST4I_ECOSYSTEM_DIR' (Join-Path $root 'ecosystem')); Reason = 'ecosystem-products.json + ecosystem-recipes.json - the simulated ecosystem an operator authored' }
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
Write-Host "KEPT BY DESIGN - owner ruling 2026-08-23(b). These are created by the engine under the same" -ForegroundColor Cyan
Write-Host "root and are NOT deleted: configuration an operator authored is not operational data." -ForegroundColor Cyan
foreach ($k in $keptByDesign) {
    Write-Host ("  {0,-10} - {1}" -f $k.Keep, $k.Reason) -ForegroundColor Cyan
    Write-Host ("               -> $($k.Path)") -ForegroundColor DarkCyan
}
Write-Host "If you want these gone too, delete those directories by hand - there is no flag for it." -ForegroundColor Cyan
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

# ---- Step 2: delete the 14 purged data subdirectories (each already resolved above per -XxxDir /
# ST4I_*_DIR / the %ProgramData% default - see $subdirs). $keptByDesign is deliberately NOT iterated
# here: the owner's 2026-08-23(b) ruling keeps those two, and the way that ruling is enforced is that
# this loop has no access to the list at all. ---------------------------------------------------
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
