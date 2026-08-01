# ST4I Machine Simulator — WiX v4 MSI installer (WS-F1-T3)

A per-machine MSI that installs the `publish-desktop\` deliverable (`St4i.DesktopShell.exe` + the
spawned engine + web UI + default fleet/mapping data — README.md §13.2) with a Start Menu shortcut
and three OFF-by-default optional features (background service, launch-at-sign-in, exhibition
launcher). **Built and verified in this environment** — see "STEP 0 outcome" below; this is not a
documented-not-built recipe.

## Files in this folder

| File | Purpose |
|---|---|
| `St4i.Installer.wixproj` | The WiX v4 MSBuild project. Not part of `St4iMachineSimulator.sln`. |
| `Package.wxs` | The MSI source: directories, components, features, service, shortcuts. |
| `exclude-shell-and-engine-exe.xslt` | heat.exe harvest transform — see "How the payload is packaged" below. |
| `build-installer.ps1` | One command that runs the whole pipeline (web build → 2× publish → MSI). |
| `README.md` | This file. |

`packaging/remove-data.ps1` (one level up) is the separate, manual, destructive data-purge script —
see "Uninstall and data retention" below.

## STEP 0 outcome — WiX v4 toolset attempt

`dotnet tool install --global wix` was attempted first, per this task's instructions. **It
installed successfully** — network/NuGet access was available in this environment (unlike the
Rust/Cargo/MSVC toolchain unavailability documented for the Tauri path in README.md §13.4). The
default install pulled **WiX v7.0.0** (the newest version on nuget.org at the time), but invoking
essentially anything (`wix build -h`, `wix msi -h`, …) failed with:

```
error WIX7015: You must accept the Open Source Maintenance Fee (OSMF) EULA to use WiX Toolset v7.
```

WiX v7 (and v6) are stewarded under a new licensing model — the CLI now gates on accepting an
"Open Source Maintenance Fee" EULA (`wix eula accept wix7`) before it will do anything at all. Since
this task is explicitly titled "WiX v4" and the goal is a clean, unambiguously-licensed build
dependency for a commercial product installer, the global tool was **uninstalled and reinstalled
pinned to `--version 4.0.5`** instead — the last classic, pre-OSMF, .NET Foundation-era WiX release
(Apache-2.0/MS-RL). `dotnet tool install --global wix --version 4.0.5` installed cleanly with no
EULA gate, and every command below was built and verified against it.

**Practical implication for anyone rebuilding this:** the global `wix` CLI tool is actually only
needed for optional diagnostics (`wix msi decompile`/`wix msi validate` — see "How this was
verified" below) — `build-installer.ps1` never invokes it. The real toolset dependency is the
`WixToolset.Sdk`/`WixToolset.Heat` NuGet packages, which `St4i.Installer.wixproj` pins to **`4.0.5`
explicitly** (not a floating `4.*`) and restores automatically on the first `dotnet build`/
`dotnet restore` of that project — no separate install step needed for the actual MSI build, only
for the optional CLI diagnostics. If you do want the CLI for diagnostics, install it the same
pinned way: `dotnet tool install --global wix --version 4.0.5` (do NOT `dotnet tool install
--global wix` with no version — that pulls the OSMF-gated newest release).

## Prerequisites

- .NET 10 SDK (already required by the rest of this repo).
- Node/npm (for `web/`'s `npm run build` — already required by README.md §13.2).
- Internet access the first time `St4i.Installer.wixproj` builds, to restore `WixToolset.Sdk`/
  `WixToolset.Heat` 4.0.5 from nuget.org (cached locally after that — no network needed for
  subsequent builds).
- *(Optional, diagnostics only)* the `wix` CLI, pinned: `dotnet tool install --global wix --version
  4.0.5`.

## Build

```powershell
cd tools/machine-simulator
.\packaging\installer\build-installer.ps1
```

This runs, in order (see the script's own comments for the full rationale on each step):
1. `npm run build` in `web/` (→ `web/dist/`).
2. Wipes any previous `publish-desktop\` and republishes `St4i.EngineApi` (self-contained,
   single-file, win-x64) into `publish-desktop/engine/`.
3. Publishes `St4i.DesktopShell` (self-contained, single-file, win-x64) into `publish-desktop/`.
4. `dotnet build packaging/installer/St4i.Installer.wixproj -c Release -p:DefineConstants="Version=<X.Y.Z>"`,
   version read live from `tools/machine-simulator/Directory.Build.props`.

**Output:** `packaging/installer/bin/x64/Release/St4iMachineSimulator.msi` (already covered by this
repo's generic `bin/` `.gitignore` rule — see "What's gitignored" below). This location is
deliberate, not an accident — see the big comment in `build-installer.ps1`'s Step 4 for why the MSI
must **never** be built into (or copied into) `publish-desktop\` itself: `St4i.Installer.wixproj`'s
`HarvestDirectory` harvests the *entire* `publish-desktop\` tree, so an `.msi` sitting inside it
would get harvested into the *next* build as if it were part of the app payload — confirmed
empirically while authoring this script (file count and `.msi` size both silently doubled on a
second build, twice, until this was fixed structurally).

Useful flags for iterating on just the installer without waiting on a full web/dotnet republish
every time:

```powershell
.\packaging\installer\build-installer.ps1 -SkipWebBuild -SkipDotnetPublish
```

## How the payload is packaged

`St4i.Installer.wixproj` uses `WixToolset.Heat`'s `HarvestDirectory` MSBuild item — the classic
heat.exe-based directory harvester, integrated into the WiX v4 MSBuild SDK — to auto-generate one
`<Component>`/`<File>` per file under `publish-desktop\**`, preserving the `engine\`, `engine\
wwwroot\`, `engine\mapping\`, `engine\ecosystem\` subtree exactly as published. **This is
deliberately not** WiX v4's own `wix build`-CLI `<Files Include="...">` harvesting element — that
was confirmed, empirically, to be a v5+-only feature, not present in the pinned 4.0.5 CLI/SDK; the
heat-based MSBuild harvest is the correct v4 mechanism (this task's brief anticipated exactly this:
"a `<Files Include=.../>` … or an explicit component group — pick what WiX v4 supports cleanly").

Two files are **excluded** from this bulk harvest (via `exclude-shell-and-engine-exe.xslt`, wired
through `HarvestDirectory`'s `Transforms` metadata) and installed instead as their own explicit,
hand-authored `<Component>` in `Package.wxs`:

- **`St4i.DesktopShell.exe`** — needs a real, known component so the Start Menu `<Shortcut>` can
  nest inside its `<File>` element (a WiX v4 feature: a `Shortcut` nested in `File` needs no
  separate component of its own, and its `Target` auto-resolves to `[#FileId]`).
- **`engine\St4i.EngineApi.exe`** — Windows Installer requires the file that becomes a service's
  binary to be the **KeyPath file of the same component** as its `<ServiceInstall>` row; heat's
  auto-generated, non-deterministic component/file Ids can't be referenced ahead of time for this.

Without the exclusion, both files would be installed twice (once by the bulk harvest, once by the
explicit component) — invalid, two components claiming the same target path. The transform matches
by `File/@Source` **suffix**, not `@Name` — heat's directory harvester omits `File/@Name` entirely
when the name is inferable from `@Source` (confirmed empirically), so a `@Name=` match would
silently never fire.

## Directory layout installed

```
%ProgramFiles%\ST4I\Machine Simulator\        <- INSTALLFOLDER (ProgramFiles6432Folder\ST4I\...)
  St4i.DesktopShell.exe                       <- Start Menu shortcut targets this
  WebView2Loader.dll, *.dll, ...
  run-exhibition.bat                          <- only if the "Exhibition launcher" feature is on
  engine\
    St4i.EngineApi.exe                        <- ServiceInstall targets this (if service feature on)
    wwwroot\**                                 <- the built web UI
    fleet.json, mapping\*.json, ecosystem\**
```

Start Menu: `ST4I Machine Simulator\ST4I Machine Simulator.lnk` (its own subfolder, in case a future
build adds more shortcuts). Optional Startup-folder shortcut (per-user, current-user Startup) and
optional Windows service `St4iEngineApi` — see "Optional features" below.

## Package identity

- **UpgradeCode:** `6B54CD27-1D8F-4325-8E62-ECC84F1E7097` — minted once (2026-07-27), **never
  regenerate it** (see the comment directly above `<Package>` in `Package.wxs`). This is what lets a
  newer MSI upgrade an older install in place instead of installing side-by-side.
- **ProductCode:** left as WiX's default (`Id="*"`, auto-generated fresh each build) — the correct
  choice alongside a fixed `UpgradeCode` + `<MajorUpgrade>`: every build gets a distinct
  ProductCode, but `MajorUpgrade` matching is keyed off `UpgradeCode`, so upgrade detection still
  works correctly build to build.
- **Version:** read from `tools/machine-simulator/Directory.Build.props`'s `<Version>` (currently
  `1.0.0`) and passed to `wix`/MSBuild as the `Version` preprocessor variable
  (`Package/@Version="$(var.Version)"`).
- **Scope:** `perMachine` (needs elevation to install/uninstall — a UAC prompt if launched by
  double-click).

## Optional features (all OFF by default)

No custom install UI is authored (see "WiX UI choice" below), so there is no feature-selection
checkbox tree — opt in via `ADDLOCAL` on the `msiexec` command line:

| Feature Id | What it does | Enable with |
|---|---|---|
| `MainFeature` | The app itself (always installed, Level 1). | *(default)* |
| `ServiceFeature` | Registers `St4i.EngineApi.exe` as a Windows service (`St4iEngineApi`, LocalSystem, `Start=auto`) via native `<ServiceInstall>`/`<ServiceControl>` — **not** the exe's own command-line install verb (`ServiceInstallVerbs`, WS-F1-T1). Pick one mechanism, never both. | `ADDLOCAL=ServiceFeature` |
| `StartupFeature` | Adds a shortcut to the **installing user's** Startup folder (`St4i.DesktopShell.exe` launches at sign-in). | `ADDLOCAL=StartupFeature` |
| `ExhibitionFeature` | Installs `run-exhibition.bat` (README.md §13.5 — sets `ST4I_DEMO_ENABLED=true` then launches the shell) next to the exe. | `ADDLOCAL=ExhibitionFeature` |

```powershell
# Product default: MainFeature only, all optional features OFF, basic progress UI
msiexec /i St4iMachineSimulator.msi /passive

# Also register the background service and the launch-at-sign-in shortcut
msiexec /i St4iMachineSimulator.msi ADDLOCAL=MainFeature,ServiceFeature,StartupFeature /passive

# Every optional feature
msiexec /i St4iMachineSimulator.msi ADDLOCAL=ALL /passive

# Fully silent (no progress UI at all)
msiexec /i St4iMachineSimulator.msi ADDLOCAL=ALL /quiet

# Uninstall
msiexec /x St4iMachineSimulator.msi /passive
```

(`ADDLOCAL` always needs `MainFeature` included too if you list any features explicitly — MSI does
not implicitly add features you didn't name — hence `MainFeature` appearing in the second example.
`ADDLOCAL=ALL` is the simpler way to mean "everything".)

## WiX UI choice

**No custom UI is authored** — `WixToolset.UI.wixext` (the extension that provides the canned
`WixUI_FeatureTree`/`WixUI_InstallDir`/`WixUI_Minimal` dialog sets) is deliberately **not**
referenced, per this task's explicit guidance to avoid another toolchain dependency beyond the base
WiX v4 SDK + `WixToolset.Heat`. The practical effect: installing/uninstalling shows only Windows
Installer's own built-in progress UI (no wizard pages, no Back/Next/Finish, no feature-selection
checkbox tree) — a "silent/basic UI" install, one of the two options this task's brief explicitly
allowed. Optional-feature selection happens entirely via `ADDLOCAL` on the command line (see above)
instead of a GUI. `ARPPRODUCTICON` is still set, so the product gets its own icon in Add/Remove
Programs / installed-apps.

## Per-machine install / elevation

`Scope="perMachine"` — every install/uninstall/repair needs administrator rights. Double-clicking
the `.msi` triggers the normal UAC elevation prompt; scripted installs need an elevated shell (or
`msiexec`'s own elevation prompt, same as any per-machine MSI).

## Uninstall and data retention

Uninstalling (via Add/Remove Programs, `msiexec /x`, or a `MajorUpgrade`'s automatic remove-old-
version pass) removes **only what the MSI itself installed** — everything under `%ProgramFiles%\
ST4I\Machine Simulator\`, the Start Menu/Startup shortcuts, and (if the service feature was
enabled) stops + deletes the `St4iEngineApi` service (`<ServiceControl Remove="uninstall">`).

**Customer data is kept automatically — no extra authoring needed.** The MSI has no idea
`St4i.EngineApi.exe`, once it *runs*, goes on to create `%ProgramData%\ST4I\sim\{historian,wal,
security,creds}\` (historian/OEE database, store-and-forward WAL buffer, the local user/session/
audit-log database, the DPAPI-protected machine credential) — those are runtime-created, not
installed by any `<Component>`, so Windows Installer's uninstall action never touches them. This is
the desired behavior: an uninstall or upgrade must never silently destroy production history, the
audit trail, or a machine's credential.

**To actually purge that data** (decommissioning a machine, resetting a demo box to fresh-install
state), run the separate, manual, destructive script — **never** run by the MSI itself:

```powershell
# Preview only — nothing is stopped/deleted
.\packaging\remove-data.ps1 -WhatIf

# Interactive — prompts before stopping/deleting the service and before deleting each directory
.\packaging\remove-data.ps1

# Non-interactive (scripted wipes only)
.\packaging\remove-data.ps1 -Force
```

It (1) stops and `sc delete`s the `St4iEngineApi` service if present, then (2) deletes the 4
`%ProgramData%\ST4I\sim\*` subdirectories — printing an explicit "this destroys the audit chain +
historian + credentials" warning up front and gating every destructive action through PowerShell's
own `ShouldProcess`/`-WhatIf`/`-Confirm` machinery (so `-WhatIf` is always safe to run first). Needs
an elevated prompt for the same reasons the install does.

## Signing gap

**This MSI is unsigned** — no code-signing certificate is available in this environment. Installing
it will show "Unknown Publisher" and may trigger SmartScreen, exactly the same gap README.md §13.4
documents for the (unbuilt) Tauri path. Authenticode-signing both the `.msi` itself and the payload
binaries (`signtool.exe sign /fd sha256 /tr ... /td sha256 ...`) is deferred to a future task once a
certificate is available — no code changes needed here to add it later, just an extra signing step
after `build-installer.ps1` produces the `.msi`.

## How this was verified (and what wasn't)

Verified in this environment:
- `dotnet tool install --global wix --version 4.0.5` installs cleanly (STEP 0 — see above).
- `dotnet build packaging/installer/St4i.Installer.wixproj` succeeds and produces a real `.msi`
  (`packaging/installer/bin/x64/Release/St4iMachineSimulator.msi`), built against a real,
  freshly-published `publish-desktop\` tree (full `npm run build` + both `dotnet publish` steps, not
  mocked/stubbed content).
- `wix msi decompile` on the built `.msi` confirms: correct directory tree (`ProgramFiles6432Folder
  \ST4I\Machine Simulator\`, `engine\` nested correctly, no spurious extra folder), every file under
  `publish-desktop\` present exactly once (verified across several from-scratch pipeline runs during
  authoring — the exact count varies build to build with whatever `npm run build` happens to emit,
  e.g. 119 vs 65 source files seen across two different runs in this session, but the harvested-file
  count in the `.msi` always matched `(files under publish-desktop) - 2 + 3` exactly: minus the 2
  files excluded from the bulk harvest, plus the 3 explicit components — shell exe, engine exe,
  `run-exhibition.bat` — with never a duplicate or a drop), correct `UpgradeCode`/`Version`/
  `Manufacturer`, `ServiceInstall`/`ServiceControl` wired to the right component, both `Shortcut`
  elements present with correct targets, `ARPPRODUCTICON` set, all 4 `Feature` elements present with
  the correct `Level` (1 vs 1000).
- `wix msi validate St4iMachineSimulator.msi -sice ICE43 -sice ICE57 -sice ICE64` — **passes clean,
  zero remaining issues.** Those 3 ICEs are suppressed (`St4i.Installer.wixproj`'s `SuppressIces`)
  because they are well-known, widely-documented false positives for any per-machine (`ALLUSERS=1`)
  package that also authors a plain (non-advertised) Start Menu shortcut — the standard MSI
  validation suite statically flags `ProgramMenuFolder` as an inherently "per-user" location
  regardless of the package's own `Scope`/`ALLUSERS` setting. This is the standard, widely-cited
  workaround for exactly this scenario, scoped to only these 3 IDs — not a way of hiding a real
  defect (confirmed: suppressing only these 3 leaves validation fully clean, no other ICE fires).
- **Idempotency:** `build-installer.ps1` (both the full pipeline and the `-SkipWebBuild
  -SkipDotnetPublish` fast path) was run **3 times in a row** — the resulting `.msi` size and file
  count stayed identical every time (this is exactly the check that caught the harvest-
  self-contamination bug described in the Build section above, before it was fixed).

**Not verified here** (matches this task's own expectation — "a full clean-VM install/uninstall …
is likely NOT possible in this sandbox"):
- An actual `msiexec /i` install/uninstall was **not** run on this environment's real Windows
  install, deliberately — this box is a shared dev sandbox, not a disposable VM, and a real
  per-machine install would register a real service and write real files under this machine's own
  `Program Files`/registry with no guaranteed clean rollback path. The decompile + `wix msi
  validate` checks above are the strongest verification available without that.
- Consequently: no observed Start Menu shortcut actually launching the app, no observed
  `St4iEngineApi` service actually starting under the SCM, no observed uninstall actually leaving
  `%ProgramData%` untouched at runtime (only confirmed by static authoring: no `<Component>` in
  `Package.wxs` references anything under `%ProgramData%`, so Windows Installer's uninstall/remove
  sequence has nothing there to act on).
- The ≤30-minute timing goal from this task's Step B guidance — the actual `wix build` step itself
  takes under 30 seconds; the two `dotnet publish` steps (self-contained single-file, ~5-10s each)
  and `npm run build` (~1s once `node_modules`/Vite cache are warm) make the full pipeline a few
  minutes end-to-end, well inside the budget.

## What's gitignored

- `publish-desktop/` (the whole payload tree) — already covered by this repo's top-level `.gitignore`
  before this task.
- `packaging/installer/bin/` and `packaging/installer/obj/` (the wixproj's own build output,
  including the final `.msi`/`.wixpdb`) — already covered by this repo's generic `bin/`/`obj/`
  patterns (no leading slash — they match at any depth).
- `*.msi`/`*.wixpdb` were additionally added explicitly to `tools/machine-simulator/.gitignore` for
  defense-in-depth/self-documentation, even though the patterns above already cover every location
  this project actually writes one.

No large build output (`publish-desktop/`, the `.msi` itself) is committed by this task.
