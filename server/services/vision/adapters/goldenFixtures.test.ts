/**
 * Golden-file conformance harness for ALL vision adapters (doc 27 C2/C6).
 *
 * Table-driven: every file under __fixtures__/<vendorKey>/ (except *.expect.json + README)
 * is one machine result export. For each fixture the harness:
 *   1. feeds it to getVisionAdapter(vendorKey).normalize() — objects for *.json, RAW TEXT
 *      for *.csv / *.xml (exactly what the hot-folder service can hand over);
 *   2. asserts the shared canonical invariants (serial present; results only OK/NG/NTF;
 *      inspectionTime tz-aware when present; bbox sane; no NaN/Infinity anywhere);
 *   3. asserts the optional <name>.expect.json sidecar (serial / overall / count / machine);
 *   4. snapshots the full canonical output so ANY mapping/schema drift is caught in review.
 *
 * Real machine exports are onboarded by DROPPING FILES into __fixtures__ (see README.md
 * there) — no code changes required unless the vendor's real field names differ, in which
 * case only the adapter's *_FIELD_MAP / *_DEFECT_MAP table is adjusted.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { getVisionAdapter, listVisionAdapters } from "../index";
import type { CanonicalInspection } from "../visionAdapterRegistry";
import { RFC3339_TZ_RE } from "./_parsing";

const FIXTURES_ROOT = path.join(__dirname, "__fixtures__");
const RESULT_TOKENS = new Set(["OK", "NG", "NTF"]);

interface Expectation {
  serialNumber?: string;
  machineCode?: string;
  overallResult?: string;
  measurementCount?: number;
  ngCount?: number;
}

/** Shared invariant checker — every adapter output must satisfy these (doc 27 W1-C KPI semantics). */
function assertCanonicalInvariants(c: CanonicalInspection, label: string): void {
  // Serial drives traceability + FPY — must always be present.
  expect(typeof c.serialNumber, `${label}: serialNumber must be a string`).toBe("string");
  expect(c.serialNumber.trim().length, `${label}: serialNumber must be non-empty`).toBeGreaterThan(0);

  expect(RESULT_TOKENS.has(c.overallResult), `${label}: overallResult "${c.overallResult}" not OK/NG/NTF`).toBe(true);
  expect(Array.isArray(c.measurements), `${label}: measurements must be an array`).toBe(true);
  for (const [i, m] of c.measurements.entries()) {
    expect(RESULT_TOKENS.has(m.result), `${label}: measurements[${i}].result "${m.result}" not OK/NG/NTF`).toBe(true);
    // bbox sanity (when any bbox field is set, all must be sane).
    const bbox = [m.defectBboxX, m.defectBboxY, m.defectBboxW, m.defectBboxH];
    if (bbox.some((v) => v !== undefined)) {
      expect(bbox.every((v) => typeof v === "number" && Number.isFinite(v)), `${label}: measurements[${i}] bbox must be 4 finite numbers`).toBe(true);
      expect(m.defectBboxX!, `${label}: measurements[${i}] bbox x >= 0`).toBeGreaterThanOrEqual(0);
      expect(m.defectBboxY!, `${label}: measurements[${i}] bbox y >= 0`).toBeGreaterThanOrEqual(0);
      expect(m.defectBboxW!, `${label}: measurements[${i}] bbox w > 0`).toBeGreaterThan(0);
      expect(m.defectBboxH!, `${label}: measurements[${i}] bbox h > 0`).toBeGreaterThan(0);
    }
  }

  // Timestamps: when present they must parse AND carry an explicit UTC offset (doc 27 A2).
  if (c.inspectionTime !== undefined) {
    expect(Number.isFinite(Date.parse(c.inspectionTime)), `${label}: inspectionTime "${c.inspectionTime}" must parse`).toBe(true);
    expect(RFC3339_TZ_RE.test(c.inspectionTime), `${label}: inspectionTime "${c.inspectionTime}" must carry an explicit UTC offset`).toBe(true);
  }

  // No NaN / Infinity anywhere in the canonical output.
  const walk = (v: unknown, p: string): void => {
    if (typeof v === "number") {
      expect(Number.isFinite(v), `${label}: non-finite number at ${p}`).toBe(true);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
    }
  };
  walk(c, "canonical");
}

function loadExpectation(dir: string, fixtureFile: string): Expectation | undefined {
  const base = fixtureFile.replace(/\.[^.]+$/, "");
  const p = path.join(dir, `${base}.expect.json`);
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, "utf8")) as Expectation;
}

const vendorDirs = fs
  .readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("golden fixture conformance (all vision adapters)", () => {
  it("has at least one fixture dir and every dir matches a registered adapter", () => {
    expect(vendorDirs.length).toBeGreaterThan(0);
    const registered = new Set(listVisionAdapters().map((a) => a.vendorKey));
    for (const vendor of vendorDirs) {
      expect(registered.has(vendor), `fixture dir "${vendor}" has no registered adapter`).toBe(true);
    }
  });

  for (const vendor of vendorDirs) {
    const dir = path.join(FIXTURES_ROOT, vendor);
    const fixtures = fs
      .readdirSync(dir)
      .filter((f) => !f.endsWith(".expect.json") && !/^readme/i.test(f))
      .sort();

    describe(vendor, () => {
      it("has at least one fixture", () => {
        expect(fixtures.length).toBeGreaterThan(0);
      });

      for (const file of fixtures) {
        it(`normalizes ${file} to a valid canonical inspection`, () => {
          const text = fs.readFileSync(path.join(dir, file), "utf8");
          // *.json → parsed object (hot-folder may pre-parse); *.csv/*.xml → raw text.
          const input: unknown = file.endsWith(".json") ? JSON.parse(text) : text;
          const adapter = getVisionAdapter(vendor);
          const canonical = adapter.normalize(input);

          assertCanonicalInvariants(canonical, `${vendor}/${file}`);

          const expected = loadExpectation(dir, file);
          if (expected) {
            if (expected.serialNumber !== undefined) expect(canonical.serialNumber).toBe(expected.serialNumber);
            if (expected.machineCode !== undefined) expect(canonical.machineCode).toBe(expected.machineCode);
            if (expected.overallResult !== undefined) expect(canonical.overallResult).toBe(expected.overallResult);
            if (expected.measurementCount !== undefined) {
              expect(canonical.measurements).toHaveLength(expected.measurementCount);
            }
            if (expected.ngCount !== undefined) {
              expect(canonical.measurements.filter((m) => m.result === "NG")).toHaveLength(expected.ngCount);
            }
          }

          // Schema-drift tripwire: full canonical output is snapshotted per fixture.
          expect(canonical).toMatchSnapshot();
        });
      }
    });
  }
});
