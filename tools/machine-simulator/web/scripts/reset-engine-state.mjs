// H4 job 2/3 — deletes ProductConfigStore's and SimulatedEcosystem's persisted state files
// (products.json/recipes.json beside the built St4i.EngineApi binary, and
// ecosystem/ecosystem-products.json/ecosystem-recipes.json under it) before every Playwright
// webServer boot of the engine.
//
// Task 4/5 (docs/plans/2026-07-21-machine-config.md) — also deletes `machine-operating-config.json`,
// `MachineConfigStore`'s own persisted file (same `AppContext.BaseDirectory`-relative, load-as-is-if-
// present convention as the two files above — see `mc-task12-report.md`'s own flagged follow-up #2).
// Left out of this list, it would reproduce the EXACT test-contamination bug this file already exists
// to fix once for `products.json`/`recipes.json`: an earlier Playwright session's machine-settings
// edits (a PUT/DELETE against `/v1/machines/{code}/settings/{key}`) would silently persist into the
// next "pristine" `00-visual-and-a11y` baseline capture, since `MachineConfigStore` loads whatever it
// finds on disk rather than reseeding.
//
// ROOT CAUSE this fixes: both stores write their state to a JSON file in AppContext.BaseDirectory
// (the `dotnet run` build-output folder, e.g. bin/Debug/net10.0-windows/) and, once that file
// exists, load it AS-IS on the next boot instead of reseeding — correct behavior for the real
// exhibition kiosk app (recipes/products must survive a restart), but it means Playwright's
// webServer, which runs `dotnet run` against that SAME folder on every `npm run test:e2e`
// invocation, was NOT actually getting a pristine engine: a mutation any earlier test session left
// on disk (e.g. `09-points-editor`/`10-recipe-config` saving an edit, a config-sync push test
// syncing the ecosystem) silently carried into the next session's "pristine" 00-visual-and-a11y
// baseline capture.
//
// Reproduced live during H4: `recipes.json` on disk was sitting at Version 3 (torqueTarget 1.4,
// English-transliterated `notes`) from an earlier session's recipe edit/push, while
// `ProductConfigStore.SeedRecipes()` seeds Version 2 (torqueTarget 1.35, Vietnamese `notes`) — a
// real, reproducible ~1% pixel diff on `recipe-config-detail`, `product-config-points`, and
// `machine-detail-config` (which surfaces recipe/config-sync state too) that had nothing to do with
// font rendering or animation timing and everything to do with this file surviving between runs.
//
// Deletes are best-effort (ENOENT is fine — first-ever run, or an already-clean tree) and cover
// every bin output folder found under St4i.EngineApi (Debug/Release, any TFM) so the fix isn't
// pinned to today's `net10.0-windows` moniker.
//
// 🔴 TASK BF-1 (2026-08-23) — EVERYTHING ABOVE IS RETRACTED AS A DESCRIPTION OF WHERE THESE FILES LIVE,
// and kept verbatim because it is the only written record of the contamination it fixed. The owner moved
// all three stores' default roots to `%ProgramData%\ST4I\sim\{products,ecosystem,machine-config}` and
// `playwright.config.ts` now redirects all three into `../.e2e-data`, which the block at the bottom of
// this file wipes WHOLESALE before every boot. So the pristine-engine guarantee is now delivered by that
// one `rmSync`, not by the five named deletes below.
//
// The five deletes are KEPT, and not as decoration. Two reasons, both measurable:
//   1. LEGACY RESIDUE. A checkout that ran the engine before 2026-08-23 has real files sitting in those
//      bin folders. They are no longer read by the engine — but `LegacyRootMigration` reads exactly that
//      location on a DEFAULT-rooted start, so leaving them is leaving an input for a code path that is
//      supposed to be inert here.
//   2. THE REDIRECT COULD REGRESS. If someone removes `ST4I_PRODUCTS_DIR` from the webServer env block,
//      the engine falls back to `%ProgramData%` — not to bin/ — so these deletes would NOT catch it. That
//      is stated so nobody reads them as a safety net they are not:
//      `EveryStoreTheEngineCreates_IsIsolatedByThePlaywrightHarness` is what catches that, and it is a
//      test rather than a cleanup.
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const engineApiDir = join(here, "..", "..", "src", "St4i.EngineApi")
const binDir = join(engineApiDir, "bin")

// SM-6 — the isolated stand-in for %ProgramData%\ST4I\sim\* this webServer's engine now writes to
// instead of the real one (see playwright.config.ts's own env block for the full store-by-store
// audit and its one deliberate exception, historian). Wiped in full before every boot so this
// harness's own data — the "e2e-user-*" accounts task SM-6 found piled up as real, login-capable
// rows in the PRODUCTION security.db being the whole reason this exists — never survives past a
// single run to accumulate anywhere, isolated or not.
const e2eDataDir = join(here, "..", ".e2e-data")

/** @param {string} dir */
function findTfmOutputDirs(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const config of readdirSync(dir)) {
    const configDir = join(dir, config)
    if (!statSync(configDir).isDirectory()) continue
    for (const tfm of readdirSync(configDir)) {
      const tfmDir = join(configDir, tfm)
      if (statSync(tfmDir).isDirectory()) out.push(tfmDir)
    }
  }
  return out
}

let deleted = 0
for (const outDir of findTfmOutputDirs(binDir)) {
  const targets = [
    join(outDir, "products.json"),
    join(outDir, "recipes.json"),
    join(outDir, "machine-operating-config.json"),
    join(outDir, "ecosystem", "ecosystem-products.json"),
    join(outDir, "ecosystem", "ecosystem-recipes.json"),
  ]
  for (const target of targets) {
    if (existsSync(target)) {
      rmSync(target, { force: true })
      deleted++
    }
  }
}

console.log(
  `[reset-engine-state] removed ${deleted} persisted state file(s) — ProductConfigStore/SimulatedEcosystem/MachineConfigStore will reseed from their own defaults (ProductConfigStore.SeedProducts()/SeedRecipes(), MachineParameterSchema's baseline defaults) on next boot.`
)

if (existsSync(e2eDataDir)) {
  rmSync(e2eDataDir, { recursive: true, force: true })
  console.log(`[reset-engine-state] wiped isolated E2E ProgramData stand-in: ${e2eDataDir}`)
}
