# Vision adapter golden fixtures (conformance suite)

Each sub-directory is a **registered adapter vendorKey** (`st4i-standard`, `saki-aoi`,
`mirtec`, `ict-aoi`, `koh-young`, `cognex`, `keyence`, `tri`, `generic-json`). Every file in
it (except `*.expect.json` and this README) is ONE machine result export ("golden file")
that `goldenFixtures.test.ts` feeds through `adapter.normalize()`.

## What the test verifies for EVERY fixture

1. **Shared invariants** (`assertCanonicalInvariants`):
   - `serialNumber` present + non-empty (drives traceability/FPY — doc 27 W1-C);
   - `overallResult` and every measurement `result` are exactly `OK | NG | NTF`;
   - `inspectionTime`, when present, is a parseable timestamp **with an explicit UTC
     offset** (doc 27 A2 lesson — offset-less local times are forbidden);
   - defect bbox, when present, is sane (x,y ≥ 0; w,h > 0; all finite);
   - no `NaN`/`Infinity` anywhere in the canonical output.
2. **Sidecar expectations** — optional `<name>.expect.json` next to the fixture
   (`board-ng.csv` → `board-ng.expect.json`; the three `board-ng.st4i.*` encodings share
   one sidecar): asserts `serialNumber`, `overallResult`, `measurementCount`, and
   optionally `machineCode` / `ngCount`.
3. **Snapshot** — the full canonical output is snapshotted (`__snapshots__/`), so ANY
   mapping/schema drift shows up as a diff in review.

## How input is fed (mirrors the hot-folder service)

- `*.json` → parsed with `JSON.parse`, the **object** is passed to `normalize()`;
- `*.csv` / `*.xml` → the **raw file text** is passed to `normalize()` (all adapters that
  own a text encoding accept raw text and parse it themselves).

## Dropping in a REAL machine export (doc 27 C2 — do this per machine model/firmware)

1. Copy the machine's real result file into the vendor's directory, named
   `<model>-<firmware>-<case>.<ext>` (e.g. `saki-aoi/bf3si-v2.1-ng-board.csv`).
   Redact serials if required — keep the structure byte-identical.
2. Run `npx vitest run server/services/vision/adapters/goldenFixtures.test.ts`.
   - If it fails to parse or violates an invariant → adjust ONLY the adapter's
     `*_FIELD_MAP` / `*_DEFECT_MAP` object (each adapter keeps its full field mapping in
     that single table) until green.
3. Add a `<name>.expect.json` sidecar with the values you verified by eye against the
   machine's own UI (serial, overall result, measurement count).
4. Commit fixture + sidecar + updated snapshot. The adapter header's "ASSUMED
   REPRESENTATIVE SHAPE" warning can be downgraded for that model once a real file is
   locked in here.

Representative fixtures authored before real samples exist are honest placeholders — they
lock in the DOCUMENTED assumed shape, so swapping in real files later is a fixture change,
not a code rewrite. The `st4i-standard` fixtures are different: they are NORMATIVE
compliance examples of docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md.
