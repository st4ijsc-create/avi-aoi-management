/**
 * W5-B1 (doc 44, gap G4.12) — trained NTF/false-call classifier tests.
 *
 * PURE core (synthetic feature contexts — no DB):
 *  (a) feature engineering: vocab + one-hot + "other" bucket + vector width;
 *  (b) train → eval → GATE: the learned boundary BEATS the fixed-threshold
 *      heuristic on the independent TEST split (only then does the gate pass);
 *  (c) honest guards: insufficient labels / single class → NOT trained;
 *  (d) determinism (seed).
 *
 * DB round-trip (ISOLATED test DB — soft-skip when unreachable):
 *  (e) train → persist → ACTIVE → computeNtfScore serves method:'trained' when
 *      NTF_CLASSIFIER_ENABLED, and honest method:'heuristic' fallback when OFF.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import * as dbApi from "../../db";
import { mulberry32, normalizeLabel } from "../aiMetrics";
import { predictWithHead } from "./embeddingHeadTrainer";
import { productInspections, measurementResults, measurementCorrections, ntfClassifierModels } from "../../../drizzle/schema";
import { computeNtfScore } from "./ntfPredictorService";
import {
  buildVocab,
  buildFeatureVector,
  ntfFeatureNames,
  trainNtfFromLabeledContexts,
  trainNtfClassifier,
  getActiveNtfClassifier,
  classifyNtfContext,
  _resetNtfClassifierCache,
  parseNtfArtifact,
  FEATURE_SCHEMA,
  LABEL_FALSE_CALL,
  LABEL_TRUE_DEFECT,
  type LabeledNtfContext,
  type NtfClassifierArtifact,
} from "./ntfClassifierService";
import type { NtfFeatureContext } from "./ntfPredictorService";

// ─── Synthetic feature contexts ──────────────────────────────────────────────

function mkCtx(id: number, o: Partial<NtfFeatureContext> & { repeat: number; blend: number }): NtfFeatureContext {
  return {
    inspectionId: id,
    machineId: o.machineId ?? 1,
    signals: {
      repeatOffender: o.repeat,
      limitMargin: o.signals?.limitMargin ?? 0.5,
      machineTrend: o.signals?.machineTrend ?? 0.5,
    },
    heuristicBlend: o.blend,
    ngPointCount: o.ngPointCount ?? 1,
    hasNumericMargin: o.hasNumericMargin ?? true,
    measurementType: o.measurementType ?? "DIMENSION",
    stationId: o.stationId ?? 5,
  };
}

/**
 * Two separable groups whose boundary the FIXED-0.7 heuristic gets wrong:
 *  - false_call: blend ≈ 0.6 (BELOW 0.7 → heuristic mislabels as true_defect),
 *  - true_defect: blend ≈ 0.3.
 * The trained head learns the ≈0.45 boundary → beats the heuristic.
 */
function syntheticLabeled(nPerClass = 40, seed = 7): LabeledNtfContext[] {
  const rand = mulberry32(seed);
  const jit = (c: number, r = 0.06) => c + (rand() - 0.5) * r;
  const out: LabeledNtfContext[] = [];
  let id = 1;
  for (let i = 0; i < nPerClass; i++) {
    out.push({
      label: LABEL_FALSE_CALL,
      ctx: mkCtx(id++, { repeat: jit(0.85), blend: jit(0.6), measurementType: "PRESENCE", stationId: 5 }),
    });
    out.push({
      label: LABEL_TRUE_DEFECT,
      ctx: mkCtx(id++, { repeat: jit(0.2), blend: jit(0.3), measurementType: "DIMENSION", stationId: 7 }),
    });
  }
  return out;
}

// ─── (a) feature engineering ─────────────────────────────────────────────────

describe("(a) feature engineering", () => {
  it("vocab + one-hot + other-bucket + stable vector width", () => {
    const labeled = syntheticLabeled(10);
    const vocab = buildVocab(labeled.map((l) => l.ctx));
    expect(vocab.measurementTypes).toContain(normalizeLabel("PRESENCE"));
    expect(vocab.measurementTypes).toContain(normalizeLabel("DIMENSION"));
    expect(vocab.stations).toContain(5);
    expect(vocab.stations).toContain(7);

    const names = ntfFeatureNames(vocab);
    const vec = buildFeatureVector(labeled[0].ctx, vocab);
    expect(vec.length).toBe(names.length);
    // 6 numeric + (M + other) + (S + other).
    expect(vec.length).toBe(6 + (vocab.measurementTypes.length + 1) + (vocab.stations.length + 1));

    // An UNSEEN category lands in the "other" bucket (all one-hots 0, other=1).
    const unseen = mkCtx(999, { repeat: 0.5, blend: 0.5, measurementType: "OCR_NEW", stationId: 4242 });
    const uvec = buildFeatureVector(unseen, vocab);
    const otherMIdx = names.indexOf("mtype:__other__");
    const otherSIdx = names.indexOf("station:__other__");
    expect(uvec[otherMIdx]).toBe(1);
    expect(uvec[otherSIdx]).toBe(1);
  });
});

// ─── (b) train → eval → gate beats heuristic ─────────────────────────────────

describe("(b) train → eval → gate", () => {
  it("beats the fixed-threshold heuristic on the TEST split and passes the gate", () => {
    const labeled = syntheticLabeled(40);
    const core = trainNtfFromLabeledContexts(labeled, { seed: 1337, gateMetric: "f1", gateEpsilon: 0 });
    expect(core.trained).toBe(true);
    expect(core.classLabels).toEqual([LABEL_FALSE_CALL, LABEL_TRUE_DEFECT]);
    expect(core.testMetrics!.f1Score).toBeGreaterThan(core.baselineMetrics!.f1Score);
    expect(core.gate!.pass).toBe(true);
    expect(core.gate!.candidate).toBeGreaterThan(core.gate!.baseline ?? 1);

    // The served signal ranks a false-call-like board above a real-defect-like one.
    const art = core.artifact!;
    const pFalse = predictWithHead(art.head, buildFeatureVector(labeled[0].ctx, art.vocab))
      .probabilities.find((p) => normalizeLabel(p.label) === normalizeLabel(LABEL_FALSE_CALL))!.confidence;
    const pTrue = predictWithHead(art.head, buildFeatureVector(labeled[1].ctx, art.vocab))
      .probabilities.find((p) => normalizeLabel(p.label) === normalizeLabel(LABEL_FALSE_CALL))!.confidence;
    expect(pFalse).toBeGreaterThan(pTrue);
  });

  it("is deterministic under a fixed seed", () => {
    const labeled = syntheticLabeled(40);
    const a = trainNtfFromLabeledContexts(labeled, { seed: 1337 });
    const b = trainNtfFromLabeledContexts(labeled, { seed: 1337 });
    expect(b.artifact!.head.weights).toEqual(a.artifact!.head.weights);
    expect(b.datasetChecksum).toBe(a.datasetChecksum);
  });
});

// ─── (c) honest guards ───────────────────────────────────────────────────────

describe("(c) honest guards → NOT trained (heuristic stays)", () => {
  it("insufficient labels", () => {
    const core = trainNtfFromLabeledContexts(syntheticLabeled(4), { minSamples: 30 });
    expect(core.trained).toBe(false);
    expect(core.reason).toMatch(/insufficient/i);
  });

  it("single class", () => {
    const labeled = syntheticLabeled(40).filter((l) => l.label === LABEL_FALSE_CALL);
    const core = trainNtfFromLabeledContexts(labeled, { minSamples: 10 });
    expect(core.trained).toBe(false);
    expect(core.reason).toMatch(/single_class/i);
  });

  it("a class below the per-class floor", () => {
    const many = syntheticLabeled(40).filter((l) => l.label === LABEL_FALSE_CALL);
    const few = syntheticLabeled(3).filter((l) => l.label === LABEL_TRUE_DEFECT); // 3 true_defect
    const core = trainNtfFromLabeledContexts([...many, ...few], { minSamples: 10, minPerClass: 8 });
    expect(core.trained).toBe(false);
    expect(core.reason).toMatch(/< 8 samples/);
  });
});

// ─── (d) artifact round-trips ────────────────────────────────────────────────

describe("(d) artifact parse", () => {
  it("parseNtfArtifact validates + round-trips the trained artifact", () => {
    const core = trainNtfFromLabeledContexts(syntheticLabeled(40), { seed: 1337 });
    const parsed: NtfClassifierArtifact = parseNtfArtifact(JSON.parse(JSON.stringify(core.artifact)));
    expect(parsed.type).toBe("ntf_logreg_classifier");
    expect(parsed.featureSchema).toBe(FEATURE_SCHEMA);
    expect(() => parseNtfArtifact({ type: "wrong" })).toThrow();
  });
});

// ─── (e) DB round-trip: persist → active → serve (soft-skip) ──────────────────

const STAMP = Date.now();
const SERIAL_PREFIX = `NTFCLF-${STAMP}`;
let db: Awaited<ReturnType<typeof getDb>>;
/** false when the isolated test DB is unreachable — DB test soft-skips (pure tests still run). */
let dbReady = false;
let machineId: number;
let productModelId: number;
let pointId: number;

async function insertInspection(suffix: string, overall: "OK" | "NG" | "NTF", acknowledged = false): Promise<number> {
  const id = await dbApi.createProductInspection({
    machineId,
    productModelId,
    serialNumber: `${SERIAL_PREFIX}-${suffix}`,
    overallResult: overall,
    originalResult: "NG",
    inspectionTime: new Date(),
  });
  await dbApi.createMeasurementResult({ inspectionId: id, pointDefId: pointId, result: "NG", measuredValue: "2.010000" });
  if (acknowledged && db) {
    await db.update(productInspections).set({ acknowledgedAt: new Date() }).where(eq(productInspections.id, id));
  }
  return id;
}

beforeAll(async () => {
  // Resilient: a connectable-but-missing test DB throws on the first query. Catch
  // it so the PURE tests above still run; the DB test soft-skips on !dbReady.
  try {
    db = await getDb();
    if (!db) return;
    const factoryId = await dbApi.createFactory({ code: `TF_NC_${STAMP}`, name: "NC factory" });
    const workshopId = await dbApi.createWorkshop({ factoryId, code: `TW_NC_${STAMP}`, name: "NC ws" });
    const lineId = await dbApi.createProductionLine({ workshopId, code: `TL_NC_${STAMP}`, name: "NC line" });
    const stationId = await dbApi.createStation({ lineId, code: `TS_NC_${STAMP}`, name: "NC st", sequence: 1 });
    machineId = await dbApi.createMachine({
      stationId, code: `TM_NC_${STAMP}`, name: "NC machine", machineType: "AOI", apiKey: `test_nc_${STAMP}`,
    });
    productModelId = await dbApi.createProductModel({ code: `TP_NC_${STAMP}`, name: "NC product", version: "1.0" });
    pointId = await dbApi.createMeasurementPointDef({
      productModelId, code: `MP_NC_${STAMP}`, name: "NC point", measurementType: "DIMENSION",
      lowerLimit: "1.000000", upperLimit: "2.000000", positionX: 10, positionY: 10,
    });

    // 10 cleared (false_call) + 10 kept-NG acknowledged (true_defect).
    for (let i = 0; i < 10; i++) await insertInspection(`fc-${i}`, "NTF");
    for (let i = 0; i < 10; i++) await insertInspection(`td-${i}`, "NG", true);
    dbReady = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ntfClassifier.test] test DB unavailable — DB round-trip soft-skipped:", (err as Error)?.message);
    dbReady = false;
  }
}, 60_000);

afterEach(() => {
  delete process.env.NTF_CLASSIFIER_ENABLED;
  _resetNtfClassifierCache();
});

afterAll(async () => {
  if (!db || !dbReady) return;
  const inspIds = (
    await db.select({ id: productInspections.id }).from(productInspections)
      .where(sql`${productInspections.serialNumber} LIKE ${SERIAL_PREFIX + "%"}`)
  ).map((r) => r.id);
  if (inspIds.length > 0) {
    await db.delete(measurementCorrections).where(inArray(measurementCorrections.inspectionId, inspIds));
    await db.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspIds));
    await db.delete(productInspections).where(inArray(productInspections.id, inspIds));
  }
  await db.delete(ntfClassifierModels).where(eq(ntfClassifierModels.machineId, machineId));
});

describe("(e) DB: train → persist → active → serve", () => {
  it("promotes on a passing gate and serves method:'trained' only when the flag is on", async () => {
    if (!db || !dbReady) return;
    // gateEpsilon:1 forces the gate to pass regardless of the synthetic metric,
    // so this test exercises the PERSIST/ACTIVATE/SERVE wiring deterministically.
    const result = await trainNtfClassifier({
      machineId, minSamples: 16, minPerClass: 6, gateEpsilon: 1, seed: 1337,
    });
    expect(result.trained).toBe(true);
    expect(result.activated).toBe(true);
    expect(result.modelId).not.toBeNull();

    _resetNtfClassifierCache();
    const active = await getActiveNtfClassifier(machineId);
    expect(active).not.toBeNull();
    expect(active!.artifact.featureSchema).toBe(FEATURE_SCHEMA);

    // Score a FRESH machine-NG board.
    const target = await insertInspection("score-me", "NG");

    // Flag OFF → honest heuristic fallback.
    _resetNtfClassifierCache();
    const heuristic = await computeNtfScore(target);
    expect(heuristic).not.toBeNull();
    expect(heuristic!.method).toBe("heuristic");

    // Flag ON + active model → trained.
    process.env.NTF_CLASSIFIER_ENABLED = "true";
    _resetNtfClassifierCache();
    const trained = await computeNtfScore(target);
    expect(trained).not.toBeNull();
    expect(trained!.method).toBe("trained");
    expect(trained!.score).toBeGreaterThanOrEqual(0);
    expect(trained!.score).toBeLessThanOrEqual(1);
  }, 60_000);
});
