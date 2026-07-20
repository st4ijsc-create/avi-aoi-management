// H4 job 2/3 — deletes ProductConfigStore's and SimulatedEcosystem's persisted state files
// (products.json/recipes.json beside the built St4i.EngineApi binary, and
// ecosystem/ecosystem-products.json/ecosystem-recipes.json under it) before every Playwright
// webServer boot of the engine.
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
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const engineApiDir = join(here, "..", "..", "src", "St4i.EngineApi")
const binDir = join(engineApiDir, "bin")

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
  `[reset-engine-state] removed ${deleted} persisted state file(s) — ProductConfigStore/SimulatedEcosystem will reseed from ProductConfigStore.SeedProducts()/SeedRecipes() on next boot.`
)
