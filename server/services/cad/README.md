# Centroid / Pick-and-Place import (doc 31 · MP5 / PM4 · decision #5)

Authoring 200 measurement points one-by-one is the #1 deployment cost (doc 31 §3
MP5). This module turns a **centroid / pick-place CSV** (the placement export that
every SMT line already produces) into measurement points in seconds.

Per **decision #5** (§8) we ship a **GENERIC parser with a configurable column
map** — we deliberately do **not** hardcode any vendor's format. A real Fuji /
Panasonic / Siemens (Siplace) / JUKI / Yamaha / Altium / KiCad file is onboarded
by **mapping its columns in the UI** — no code change. Only if a vendor ships a
non-CSV binary/proprietary layout would a new parser be needed (deferred).

## Files

| File | Purpose |
|------|---------|
| `centroidParser.ts` | Pure parse (`parseCentroidCsv`) + coordinate transform (`transformCentroidRows`) + header guess (`inspectCentroidHeaders`, `guessColumnMap`). No DB. |
| `centroidImportService.ts` | `previewCentroidImport` / `commitCentroidImport` / `applyCentroidImport` wired to the existing `cad_import_jobs` / `cad_import_candidates` ledger + `measurement_point_defs`. |
| tRPC | `cadImport.centroidInspect / centroidPreview / centroidCommit / centroidApply` (in `productRouters.ts`). |
| UI | `client/src/components/products/CentroidImportDialog.tsx`, launched from the point-editor toolbar on `/products`. |
| Fixtures | `__fixtures__/centroid/*.csv` — three real-world header styles. |

## The configurable column map

You map **your file's columns** to these logical fields. A column reference is
either a **0-based index** or a **header name** (case/space-insensitive).

| Field | Required | Notes |
|-------|:--------:|-------|
| `refDesignator` | ✅ | Board position, e.g. `R12`, `U3`. Becomes the point `code` + `refDesignator`. Rows with a blank refdes are skipped. Duplicate refdes → first wins. |
| `x`, `y` | ✅ | Placement coordinates (see units + transform below). |
| `rotation` | | Degrees. Stored on the point (`geometry.centroid.rotation`). |
| `side` | | `top` / `bottom` — normalized from `T/B/1/2/Top Layer/F.Cu/…`. |
| `package` | | Footprint (e.g. `0402`, `QFN48`). Shown in the name; stored for reference. |
| `componentCode` | | Value / MPN. Populates the point's `componentCode` → **lights up Pareto-by-package** (doc 31 WB-1). |
| `placedStatus` | | Placed / DNP / skip flag, stored for reference. |
| `name` | | Optional human label (defaults to `refdes · package`). |

`guessColumnMap()` pre-fills the map from common header aliases (see the
`HEADER_ALIASES` table in `centroidParser.ts`, which already covers RefDes / Mid
X / Center-X / PosX / Rot / Layer / Footprint / Value / Comment / etc., plus a
few CJK headers). The user confirms/overrides in the wizard.

## Parse options (messy real files)

- **delimiter**: `,` `;` `\t` or `auto` (auto = the delimiter that best splits
  the header line).
- **decimal**: `.` or `,`. Comma-decimal files (EU/Altium) use `1.234,56`
  form — set delimiter to `;` or Tab so the decimal comma is unambiguous.
- **hasHeader**: first non-comment row is a header (default true).
- **comment lines** starting with `#` or `//` are skipped; blank rows are
  skipped; quoted fields (`"CONN,2P"`) and doubled-quote escapes are handled;
  rows with fewer columns than the header tolerate missing trailing fields.
- Embedded newlines inside a quoted field are **not** supported (centroid files
  are line-oriented).

## Coordinate transform

Centroid files are usually **board coordinates in mm, origin bottom-left (Y up)**;
product images are **pixels, origin top-left (Y down)**. `transformCentroidRows`
bridges that:

1. **unit** → normalize `mm | cm | mil | inch | um` to mm.
2. **flipX / flipY** → mirror about the point-cloud bounding box (flipY handles
   bottom-left → top-left).
3. **target space** = the product's `coordinateMode`:
   - **pixel** + product has an image: `fitToImage` (default) auto-scales the
     cloud to fit the image with a margin (recommended — you don't need to know
     px-per-mm); or supply a manual `scale` (px per mm).
   - **mm**: points are placed in mm (rounded). Without an image + dimensions the
     coordinates aren't pixel-portable (doc 31 PM8) — the preview warns.
4. **normalized X/Y** (0..1) are computed when image dimensions are known, so the
   points survive a resolution change across machines.

## Apply → measurement points

`applyCentroidImport` (one transaction, audited):

- generates one `measurement_point_defs` row per **selected** candidate;
- `code` = refdes, `refDesignator` + `componentCode` filled from the file;
- `measurementType` = configurable (default **VISUAL**);
- **idempotent**: a candidate whose refdes/code already exists on the product is
  **skipped**, so re-applying (or importing a file that overlaps an existing set)
  never duplicates points;
- bumps `pointsConfigVersion` so machines re-fetch via delta-sync.

## Onboarding a real vendor file

1. Export the pick-place / centroid CSV from your placement software.
2. Open a product → point-editor toolbar → **Import centroid (CAD/pick-place)**.
3. Upload; the wizard auto-detects delimiter + guesses the column map. Fix any
   mapping, pick unit, toggle Y-flip if the board looks upside-down in preview.
4. Review the candidate table (live re-parse), then **Create + Apply**.

If your file's coordinates or headers differ, only the **mapping** changes — no
code. Genuinely different formats to add later: Gerber pick-place variants,
IPC-2581 (`<Component>` placement), and any binary vendor export.
