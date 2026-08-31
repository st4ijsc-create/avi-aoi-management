import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig, devices } from "@playwright/test"

const here = dirname(fileURLToPath(import.meta.url))
// SM-6 — see this file's own webServer env block below for the full store-by-store audit this
// isolates.
const e2eDataDir = join(here, ".e2e-data")

/**
 * Task 10 — E2E + visual-regression + axe a11y suite for the 7 screens (Dashboard, Inspector,
 * Machine Detail, Onboarding, Settings, Scenario, `/tokens`).
 *
 * `webServer` boots BOTH halves of the dev split (Task 3/9) so `npm run test:e2e` is a single
 * command with no manual setup: Vite on :5173 (the page under test) proxying nothing itself, and
 * `St4i.EngineApi` on :5199 (the real engine — Demo mode is its default transport, so the whole
 * fleet is fabricated locally with zero network dependency). `reuseExistingServer` (true outside
 * CI) means a dev server you already have running is reused rather than fighting over the port.
 *
 * `workers: 1` / `fullyParallel: false` is deliberate, not a leftover default: `FleetHost` inside
 * the engine is a SINGLETON — cycles/scenario/settings are shared, mutable, process-lifetime state,
 * same as a real machine fleet. Running specs one-at-a-time, in the fixed order the numeric file
 * prefixes below impose, is what makes the suite deterministic against that shared backend:
 * `00-visual-and-a11y.spec.ts` captures every screen's PRISTINE baseline (fleet never started —
 * provably zero live counters, not just "probably stable") before any later spec ever calls
 * `POST /v1/fleet/start`. See `tests/support/screens.ts` for the shared per-screen "wait until
 * ready" helpers both the visual/a11y pass and the functional specs use.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // backlog-test-deadlines task 2 — MEASURED, not assumed. A full run of all 210 tests on an idle
  // machine: median 2 130 ms, p90 4 316 ms, p99 10 386 ms, max 18 161 ms. The slowest test in the
  // suite therefore uses 40% of this ceiling and the median uses 5%, so 45 000 ms is not the
  // constraint anybody thought it was and raising it would buy nothing real. What was over the
  // ceiling was the DECLARED total: 45 of 137 test bodies summed their own explicit bounds past it,
  // so those bounds could never have been spent. `scripts/check-test-budgets.mjs` is the gate that
  // keeps that true; run it with `--measured <playwright json>` to re-check both halves against a
  // real run.
  timeout: 45_000,
  expect: {
    // The single most load-bearing number in the suite: with the 63 ritual `{ timeout: 15_000 }` /
    // `{ timeout: 10_000 }` annotations removed (see `tests/support/deadlines.ts` for the measurement
    // that condemned them), this is the bound on almost every wait in it. Measured worst case for a
    // wait that carries no bound of its own: 8 520 ms — but that one site (`24-connectors`, whose
    // cost is a server-side 8 s connection-test timeout) is now annotated with a bound that says so,
    // and the worst remaining un-annotated wait measures 596 ms (`waitForEngineConnected`, over 137
    // calls). 10 000 ms is ~17x that, and it is a TIGHTENING of the 15 000 ms that used to be pasted
    // at 40 of these sites.
    timeout: 10_000,
    toHaveScreenshot: {
      // Freezes CSS transitions/animations and finite Web Animations (Framer Motion's enter
      // transitions included) to their end state before the pixel comparison — the default, kept
      // explicit here because it's load-bearing for baseline stability.
      animations: "disabled",
      // H4 job 3 — tightened from 0.02 (2%) → 0.0005 (0.05%) → 0.00002 (0.002%). The 2% figure was
      // wide enough that a FULL PALETTE CHANGE left 11 of this suite's 28 baselines "passing
      // unchanged", and a later whole-screen restyle (H3b) was reported as "legitimately falling
      // under the suite's tolerance" — i.e. this gate could not see a redesign, so it could not see
      // a regression either.
      //
      // Every genuinely-live pixel source on these screens was found and either masked or made
      // layout-stable (see the `.hmi-clock` class on `TopBar.tsx`'s/`Nameplate.tsx`'s clocks,
      // `hmi-readout-value` on `Readout.tsx`'s value+unit ROW and `sub` line, the constant-radius
      // defect dot in `AoiSchematic.tsx`, and `sub !== undefined` reserving the STATUS tile's sub-row
      // height unconditionally so it can't shift the layout below it — every one of these was a REAL
      // reproduced flake, not a hypothetical one). A SEPARATE, bigger source of nondeterminism was
      // `ProductConfigStore`/`SimulatedEcosystem` persisting recipe/product edits to a JSON file
      // beside the built engine binary that survived across `dotnet run` restarts — see
      // `scripts/reset-engine-state.mjs`'s doc comment for the reproduced ~1% diff this caused before
      // it was wired into the `webServer` command below. With BOTH of those fixed, re-running this
      // suite twice against a fresh engine at 0.0000001 (~0 pixels) produced EXACT pixel matches on
      // all 30 baselines both times — genuine noise floor is provably zero on this machine.
      //
      // 0.00002 was calibrated against a real injected regression, not picked blind: hiding the
      // `.sheet` registration corners (index.css's `.sheet > .corner`, the shared L-shaped marks
      // EVERY panel across all 14 screens renders — see `industrial/Sheet.tsx`) is about as subtle a
      // structural regression as this UI can produce, and at 0 tolerance it reproducibly diffed
      // 68–273px per screen (68px on single-panel screens like `machines`/`inspector`, up to 273px on
      // panel-dense ones like `product-config-points`) — NEVER more than ~0.03% of a 1440×900 frame.
      // 0.0005 (648px cap) was proven too loose to catch it: all 28 baselines "passed unchanged" with
      // every corner hidden. 0.00002 (≈26px cap on 1440×900) sits below that 68px floor with margin
      // while staying ~2,500x looser than the machine's own proven noise floor — room for font/AA
      // variance on a different machine/CI runner, nowhere near enough to hide a moved/recolored/
      // reshaped panel. NOT a license for structural drift.
      maxDiffPixelRatio: 0.00002,
    },
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Relative to this config file's directory (web/) — resolves to
      // tools/machine-simulator/src/St4i.EngineApi/St4i.EngineApi.csproj. `--no-launch-profile`
      // is defensive (no Properties/launchSettings.json exists in that project today) so a future
      // one added for `dotnet run` convenience in normal dev use can't silently repoint the port
      // this suite depends on.
      //
      // H4 job 2/3 — `node ./scripts/reset-engine-state.mjs &&` runs FIRST, every time this
      // webServer boots. `ProductConfigStore`/`SimulatedEcosystem` persist to a JSON file beside
      // the built binary and load it as-is on the next boot instead of reseeding once it exists —
      // correct for the real kiosk app surviving a restart, but it means a `dotnet run` here reused
      // whatever an EARLIER test session's edit/push test had already mutated on disk, so "fresh
      // engine" wasn't actually fresh. See the script's own doc comment for the reproduced diff.
      command: "node ./scripts/reset-engine-state.mjs && dotnet run --project ../src/St4i.EngineApi/St4i.EngineApi.csproj --no-launch-profile",
      url: "http://localhost:5199/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      // WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.2) — the engine's own default flipped from Demo to
      // Live (a fresh install/product deployment now comes up Live, connected to nothing until
      // configured). This whole suite is built on the OPPOSITE assumption (see this file's own top
      // comment: "Demo mode is its default transport, so the whole fleet is fabricated locally with
      // zero network dependency") and stays that way on purpose — Demo is what makes the suite
      // deterministic and offline. Setting ST4I_DEMO_ENABLED=true here is what makes that true again:
      // DemoModeGate reads it at startup and BOTH starts the engine directly in Demo mode (the same
      // "exhibition packaging" contract §2.5 describes for a real `.exe`) AND permits `PUT /v1/mode`
      // to switch there, so nothing downstream of this webServer needs its own mode-switch step.
      // GĐ3 closeout WI-1 — this device now advertises itself over mDNS by default whenever the UNS
      // spine is enabled (§17.8), and Demo mode still runs a real UNS spine. Left on, this webServer
      // would multicast `_st4i-machine._tcp` onto whatever LAN the dev/CI machine is attached to on
      // every `npm run test:e2e`/`npm run dev`. That default-on decision was signed off for installs,
      // not test runs — this suite has no business touching the network at all, so keep it silent.
      //
      // SM-6 — full audit of every `%ProgramData%\ST4I\sim\*` store `St4i.EngineApi` touches at
      // runtime, AS IT STOOD THEN (12 names, historical: security, historian, assets, alarms,
      // connector-config, settings, identity, sitelink, bridge-spool, wal, opcua-pki, creds — note it
      // omits `notifications`, which did not exist yet, and that omission is the C-5 defect described
      // below rather than a typo).
      // 🔴 Dot F branch review, F-7: the four counts in this file were off by one against the
      // THIRTEEN-member set of MACHINE-WIDE directories the product actually declares, and the `env:`
      // block below set exactly thirteen entries — one per machine-wide store.
      // 🔴 TASK H-1c: it now sets FOURTEEN, and the extra one is NOT a fourteenth machine-wide store.
      // `ST4I_MACHINE_CONFIG_DIR` relocates a store whose default is BESIDE THE BINARY, not under
      // `%ProgramData%`; see its own note at the bottom of the block. Every "thirteen" in this file means
      // machine-wide directories and is still true; the entry count is fourteen because two populations
      // are being isolated by one mechanism. The list above is left at its historical 12 and labelled as such, because it
      // is a record of what SM-6 audited, not a claim about today. Before that fix NONE of them were isolated
      // here — every `npm run test:e2e`/`npm run dev` wrote real data into the SAME directory a real
      // install uses, which is how this harness ended up creating real, login-capable "e2e-user-*"
      // Operator accounts (`18-users.spec.ts` mints one per run — its own comment notes "the roster
      // only ever grows across repeated runs") directly in the production security.db — 10 of them
      // by the time this was cleaned up (SM-6 report), not the 6 an earlier audit had counted.
      // (Several .NET xunit suites already isolate their OWN equivalents of these stores via
      // ST4I_*_DIR env vars set in test fixtures — a separate, already-working mechanism unrelated to
      // this Playwright-launched engine process.) task-7 (below) isolates historian; task C-5 added
      // `notifications`; the test-hygiene batch added `creds`, the last one out.
      //
      // 🔴 TASK BF-1 (2026-08-23) — THE TWO "🔴" BLOCKS ABOVE ARE RETRACTED, kept verbatim. The owner
      // moved all three beside-the-binary store defaults under `%ProgramData%\ST4I\sim`, so there are now
      // SIXTEEN machine-wide directories, SIXTEEN `ST4I_*_DIR` variables and SIXTEEN entries in the `env:`
      // block below — one population, one number. "Every 'thirteen' in this file means machine-wide
      // directories and is still true" is the sentence that stopped being true; every one of them now
      // reads sixteen. The historical 12-name SM-6 list is left alone, still labelled as a record.
      //
      // 📎 🔴 READ THIS FIRST — 2026-08-30 (whole-branch review of WS-HMI-0a, Minor 4). THE THREE
      // "SIXTEEN"s IN THE PARAGRAPH DIRECTLY ABOVE ARE STALE, and so is "every one of them now reads
      // sixteen". WS-HMI-0a Task 5 added `ST4I_HMI_MODEL_DIR`/`ST4I_HMI_TAGS_DIR` and made the count
      // EIGHTEEN, but corrected it only at the block beside those two entries ~120 lines below — this
      // repository's retract-in-place marker normally sits AT the stale sentence, which is why this one
      // is here rather than only there. Today: EIGHTEEN machine-wide directories, EIGHTEEN `ST4I_*_DIR`
      // variables, EIGHTEEN entries in the `env:` block below.
      //
      // WHAT IS NOT RETRACTED: BF-1's substance. The second population really is empty, the three stores
      // really did move under `%ProgramData%\ST4I\sim`, and "one population, one number" is still the
      // shape — only the number moved. And the isolation property this file rests on is unchanged: the
      // harness isolates on "the engine CAN write there", not on "this suite exercises it".
      //
      // 🔴 ALL THIRTEEN MACHINE-WIDE stores are now redirected under an isolated `../.e2e-data` root that
      // `scripts/reset-engine-state.mjs` wipes in full before every boot — isolated AND disposable,
      // not merely relocated to accumulate somewhere else instead. Three separate audits each declared
      // this list complete and each was missing one: SM-6 missed `historian` and `notifications`, C-5
      // missed `creds`. If a fourteenth machine-wide store appears, it belongs here — and so does any
      // further beside-the-binary store that grows a seam, for the same reason `ST4I_MACHINE_CONFIG_DIR`
      // is in the block: the property this harness needs is "the engine writes there", not "the default
      // is under %ProgramData%". And
      // `EveryStoreTheEngineCreates_IsIsolatedByThePlaywrightHarness` in St4i.EngineApi.Tests now fails
      // until it is, so the next omission is caught by a test rather than by a census of a developer's
      // %ProgramData%.
      //
      // historian — task-7 (whole-batch review, CRITICAL) fix. SM-6 left this store DELIBERATELY
      // unisolated and documented the reason at length right here: `SqliteHistorianStore.
      // ApplyRealPresenceGateAsync` unconditionally excludes every explicitly-fabricated row from the
      // default (non-`includeFabricated`) query, this suite's whole fleet is 100%
      // `driverKind: simulated`, and no web route ever sent `includeFabricated=true` — so a genuinely
      // pristine historian store could never produce a single default-visible row, which would hang
      // `15-historian.spec.ts`'s and `16-reports.spec.ts`'s shared `waitForHistorianRows` helper for
      // its full 30s timeout on every run, forever. SM-6's report called this "a genuine, pre-existing
      // product characteristic" and left it alone — WRONG on both counts: `git show
      // f6c4821d:.../SqliteHistorianStore.cs` (the commit before this whole batch) has no provenance
      // filtering of any kind, so the zero-rows-by-default behavior was introduced BY this batch, not
      // pre-existing; and it is not a separate, unrelated finding either — it is the batch's own
      // Critical bug (a fresh demo/exhibition install's `/historian`/`/reports` render nothing,
      // permanently), caught here as "the harness can't isolate this store" instead of "the product is
      // broken on day one." Fixed at the root: `HistorianEndpoints.ResolveIncludeFabricated` now
      // defaults `includeFabricated` to `true` whenever `DemoModeGate.Enabled` (true for this
      // webServer, via `ST4I_DEMO_ENABLED` below) — the SAME default a real exhibition/demo install
      // gets — so an isolated, pristine `historian.db` now DOES produce default-visible rows the
      // moment the demo fleet cycles a few times, same as every other store here. Isolating it exposes
      // exactly what a fresh demo box would show, rather than masking the bug behind this dev machine's
      // ~55k pre-migration production rows (provenance NULL, "Unknown origin") the OLD unconditional
      // gate happened to let through.
      //
      // 🔴 Test-hygiene batch — `creds` is now isolated too, and the note that used to stand here was
      // WRONG on its load-bearing claim. It read: "this suite never calls anything that writes there."
      // It does. `04-onboarding.spec.ts` mints a machine code per run — `SIM-E2E-${Date.now()}`,
      // `SIM-E2E-IOT-*`, `SIM-E2E-RESET-*`, `SIM-PASTE-*`, `SIM-E2E-FLAGOFF-*` — and those flows end in
      // `OnboardingService`, which calls `CredentialStore.Save`. A census of the real
      // `%ProgramData%\ST4I\sim\creds` found 2,999 `.bin` files, of which 613 carry exactly those five
      // prefixes: one NEW, never-overwritten DPAPI-sealed credential per e2e run, growing without
      // bound, in the directory `packaging/remove-data.ps1` exists to purge on decommissioning.
      // 🔴 THE SPEC MINTS A SIXTH, `SIM-LIVE-${Date.now()}` (line 294), AND IT IS THE ONE EXCEPTION TO
      // THE SENTENCE ABOVE — stated here rather than achieved by leaving it out (branch review,
      // Important 4). That test `page.route`s `**/v1/onboarding/claim` and fulfils it IN THE BROWSER, so
      // the request never reaches the engine, `CredentialStore.Save` never runs, and no `SIM-LIVE-*.bin`
      // was ever written — which is why the census found five prefixes and not six. A universal whose
      // counterexample is quietly dropped from its own evidence list reads as stronger than it is, and
      // this file is where that exact move was already paid for once.
      // 🔴 This said "633 ... those four prefixes" until task K-1 re-measured it. Both were wrong, and
      // this is the site where it mattered most: 613 is the number that FALSIFIED the claim this block
      // replaced ("this suite never calls anything that writes there"), so it is load-bearing here in a
      // way it is nowhere else. The 2,999 is untouched and correct — a directly measured total
      // (leak-report.md:13) that decomposes as 2,366 xunit + 613 e2e + 9 named + 11 kept.
      //
      // The xunit fixtures were the larger share (2,366 files) and the old note was right about them,
      // but "the other harness is worse" was never a reason this one could not be isolated — and the
      // stated reason it could not be ("no env-var override in the product at all — a static class
      // with a hardcoded path") was a fact about the PRODUCT that this batch fixed rather than routed
      // around: `CredentialStore` now resolves explicit > `ST4I_CREDS_DIR` > default, the same seam its
      // twelve siblings already had. This is the same defect class as task C-5's
      // `ST4I_NOTIFICATIONS_DIR` — a store the audit list did not cover writing to a real install —
      // and the same fix.
      env: {
        ST4I_DEMO_ENABLED: "true",
        ST4I_MDNS_ADVERTISE: "0",
        ST4I_SECURITY_DIR: join(e2eDataDir, "security"),
        ST4I_ASSETS_DIR: join(e2eDataDir, "assets"),
        ST4I_ALARMS_DIR: join(e2eDataDir, "alarms"),
        // Task C-5 — the 13th store, and the one SM-6's audit could not have caught: C-2 added
        // `notifications` (`NotificationConfigStore`, SQLite + DPAPI-sealed secrets) AFTER that audit ran,
        // so every `npm run test:e2e`/`npm run dev` since has been reading and writing a REAL install's
        // `%ProgramData%\ST4I\sim\notifications`. That store holds webhook URLs and SMTP passwords, which
        // makes it the one store in the list where the un-isolated case is a credential concern rather than
        // only a tidiness one. Isolated here on exactly the same terms as its twelve neighbours.
        ST4I_NOTIFICATIONS_DIR: join(e2eDataDir, "notifications"),
        ST4I_CONNECTOR_CONFIG_DIR: join(e2eDataDir, "connector-config"),
        ST4I_SETTINGS_DIR: join(e2eDataDir, "settings"),
        ST4I_IDENTITY_DIR: join(e2eDataDir, "identity"),
        ST4I_SITELINK_DIR: join(e2eDataDir, "sitelink"),
        ST4I_BRIDGE_SPOOL_DIR: join(e2eDataDir, "bridge-spool"),
        ST4I_WAL_DIR: join(e2eDataDir, "wal"),
        ST4I_OPCUA_PKI_DIR: join(e2eDataDir, "opcua-pki"),
        ST4I_HISTORIAN_DIR: join(e2eDataDir, "historian"),
        // Test-hygiene batch — the 13th store, and the last un-isolated one. See the note above for
        // why the previous audit concluded this suite never wrote here, and what the census found.
        ST4I_CREDS_DIR: join(e2eDataDir, "creds"),
        // 🔴 TASK H-1c — THE FOURTEENTH VARIABLE, AND IT IS NOT A FOURTEENTH %ProgramData% STORE.
        // Everything above relocates one of the THIRTEEN machine-wide directories under
        // `%ProgramData%\ST4I\sim\<name>`. `MachineConfigStore` is in the product's SECOND store
        // population: it defaults to `AppContext.BaseDirectory`, i.e. beside the built engine binary, and
        // H-1c added its seam without moving that default. So the entry below is genuinely useful here
        // (this suite drives machine-config writes, and without it they land in the engine's build output
        // and persist across runs) while the count sentences above stay correct: thirteen machine-wide
        // directories, fourteen `ST4I_*_DIR` variables. Those are two numbers about two populations, not
        // an off-by-one. `EveryStoreTheEngineCreates_IsIsolatedByThePlaywrightHarness` derives its subject
        // set from EVERY `ST4I_*_DIR` literal in `src/` — its property is "every store the engine writes
        // to is isolated", which is population-blind on purpose — so this line is required, not optional.
        ST4I_MACHINE_CONFIG_DIR: join(e2eDataDir, "machine-config"),
        // 🔴 TASK BF-1, owner ruling 2026-08-23(a) — THE BLOCK ABOVE IS RETRACTED, kept verbatim. Its
        // premise ("MachineConfigStore defaults to AppContext.BaseDirectory") ended that day: all three
        // beside-the-binary defaults moved under `%ProgramData%\ST4I\sim`, so the count sentences in this
        // file now read SIXTEEN machine-wide directories and SIXTEEN `ST4I_*_DIR` variables — ONE
        // population, not two, and the second population is empty. What did NOT change is the reason the
        // line above is required: this harness isolates on "the engine writes there", and it always did.
        //
        // 📎 🔴 2026-08-30 (whole-branch review of WS-HMI-0a, Minor 4) — "SIXTEEN … and SIXTEEN" in the
        // sentence directly above is STALE: it is EIGHTEEN since WS-HMI-0a Task 5 added
        // ST4I_HMI_MODEL_DIR/ST4I_HMI_TAGS_DIR (block ~15 lines below). Marked here, at the stale
        // sentence, because that is where this repository puts a retraction — the correction existed only
        // downstream until now, which is a marker a reader passing THIS line never sees. BF-1's substance
        // is untouched: one population, second population empty, the count is the only thing that moved.
        //
        // The two new entries are what stops `npm run test:e2e` and `npm run dev` from reading and writing
        // a REAL install's products/recipes — which, before the move, they merely did to the engine's own
        // build output. That is a strictly larger blast radius, and it is the reason these two lines are
        // not optional either.
        ST4I_PRODUCTS_DIR: join(e2eDataDir, "products"),
        ST4I_ECOSYSTEM_DIR: join(e2eDataDir, "ecosystem"),
        // 🔴 WS-HMI-0a Task 5, 2026-08-30 — THE SEVENTEENTH AND EIGHTEENTH MACHINE-WIDE STORES.
        // ComponentModelStore/TagNamespaceStore (Tasks 2/3) were wired into St4i.EngineApi's DI graph by
        // this task (Program.cs), which is what makes them reachable from THIS webServer process — not
        // merely declared in `src/`. `EveryStoreTheEngineCreates_IsIsolatedByThePlaywrightHarness`
        // derives its subject set from every `ST4I_*_DIR` literal in `src/`, population-blind on purpose
        // (see that test's own doc comment), so both were required the moment the two stores' `EnvVarDir`
        // constants existed — before this task even wired the DI registration. Every "sixteen" above this
        // point is therefore now EIGHTEEN: eighteen machine-wide directories, eighteen `ST4I_*_DIR`
        // variables, eighteen entries in this block. Isolated on exactly the same terms as their sixteen
        // neighbours — this suite never calls anything that reads or writes a component tree or a tag
        // namespace today (WS-HMI-0b is the API layer that will), but the harness isolates on "the engine
        // CAN write there", not on "this suite's specs happen to exercise it".
        ST4I_HMI_MODEL_DIR: join(e2eDataDir, "hmi-model"),
        ST4I_HMI_TAGS_DIR: join(e2eDataDir, "hmi-tags"),
        // 🔴 WS-HMI-0c — THE NINETEENTH. Every "eighteen" above this point is now NINETEEN.
        // Unlike its eighteen neighbours this leaf is an INPUT the engine READS and never writes — one
        // hand-authored {machineCode}.json tag map per machine, ingested at startup. Isolated anyway, and
        // the reason matters because "we only read it" is exactly the argument that has been wrong here
        // before: an un-isolated read makes every `npm run test:e2e` and `npm run dev` depend on whatever
        // tag maps happen to exist on the developer's own machine, so the suite would pass or fail by
        // accident of the host. The guard isolates every ST4I_*_DIR the engine names, population-blind on
        // purpose, and that is the right property for a read too.
        ST4I_HMI_TAGMAPS_DIR: join(e2eDataDir, "hmi-tagmaps"),
      },
    },
  ],
})
