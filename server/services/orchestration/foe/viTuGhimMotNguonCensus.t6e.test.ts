/**
 * A2(n) T6e — ONE "pinned STOP" predicate (rà T6b: the sweep's verifier compared the RAW write, the dispatcher the COERCED one; a STOP writing "true" to a declared bool
 * pin was the dispatcher's STOP and the verifier's notPinned: not sent, nobody told). Census over the source (TypeScript AST, every non-test .ts under server/):
 *   • the coercion of a "pinned" question is ONE function, commandDispatcher.epKieuGhiTheoTag: gate (1) (writesEpKieuChoRangBuoc), the FOE stop verifier
 *     (foeStepClass.makeStopVerifier) call it; the verifier holds no coercion of its own;
 *   • the edge PAIR compares the RAW write on purpose (commit đóng T6e): the package's builder (edgeRunAnalysis.analyseDefinition → isPinnedOtStop) and the edge dispatcher
 *     (otEdgeDispatch.classifyEdgeOtStop). They coerce together or not at all (EP-KIEU-EDGE, outside A2(n)): one of them alone is red here (rà T6e Q1);
 *   • the inventory of every call of the pinned-STOP classifiers and of the coercion is pinned here: a new one is red until it is listed, with what it reads;
 *   • a table over the same inputs: the edge pair agrees on every row; it differs from central's coerced verdict on exactly the rows the coercion changes, one way only.
 * No database, no mock.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { classifyEdgeOtStop } from "../../ot/otEdgeDispatch";
import { isPinnedOtStop } from "../../edge/edgeRunAnalysis";
import { epKieuGhiTheoTag } from "../../ot/commandDispatcher";
import { stopPinsFromTagRows } from "../../ot/stopPin";

const ROOT = path.resolve(__dirname, "../../../..");
const TEN = ["classifyOtStop", "phanLoaiStopGhimRangBuoc", "matchPinnedStop", "epKieuGhiTheoTag", "writesEpKieuChoRangBuoc", "epKieuKenh", "epKieuGiaTri"];
/** what a verifier must never hold of its own: the coercion pieces */
const EP_RIENG = ["epKieuGiaTri", "epKieuKenh", "kenhDaKhaiGhi", "boolTuGiaTri", "epBool", "epInt", "epFloat", "kiemGiaTriGhi", "canonicalOtValue"];

/** every non-test .ts under server/ (as guiLaiXetMotPhanCensus), forward slashes, from the repo root */
function tepNguon(): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const n of readdirSync(path.join(ROOT, d))) {
      const p = `${d}/${n}`;
      if (statSync(path.join(ROOT, p)).isDirectory()) {
        if (n !== "node_modules") di(p);
      } else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n) && !/\.d\.ts$/.test(n) && !/testkit/.test(n)) ra.push(p);
    }
  };
  di("server");
  return ra;
}
const doc = (f: string) => ts.createSourceFile(f, readFileSync(path.join(ROOT, f), "utf8"), ts.ScriptTarget.Latest, true);
function hamCua(n: ts.Node): string {
  for (let p = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.text;
  }
  return "<top>";
}
function duyet(n: ts.Node, f: (x: ts.Node) => void) {
  f(n);
  ts.forEachChild(n, (c) => duyet(c, f));
}
function hamTen(sf: ts.SourceFile, ten: string): ts.FunctionDeclaration {
  let out: ts.FunctionDeclaration | undefined;
  duyet(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === ten) out = n;
  });
  expect(out, `function ${ten} in ${sf.fileName}`).toBeDefined();
  return out!;
}

/** every call (and every member read) of the classifiers and of the coercion, by file and enclosing function; what each reads, said once */
const KIEM_KE: Record<string, string> = {
  "classifyOtStop\tserver/services/edge/edgeRunAnalysis.ts\tisPinnedOtStop": "edge package (analyseDefinition) and /authorize (edgeAuthorizeCentral): RAW on purpose, paired with the edge dispatcher (EP-KIEU-EDGE)",
  "classifyOtStop\tserver/services/orchestration/foe/foeStepClass.ts\tverified": "FOE sweep verifier: the write coerced by epKieuGhiTheoTag (T6e)",
  "classifyOtStop\tserver/services/ot/commandDispatcher.ts\tdispatchCore": "dispatcher: the step-3b writes (coerced by congKenhSom pass 1)",
  "classifyOtStop\tserver/services/ot/commandDispatcher.ts\tisStopByContent": "dispatcher: content stop (key purpose), not the pinned predicate",
  "classifyOtStop\tserver/services/ot/commandDispatcher.ts\tlabelUnpinnedStop": "dispatcher: a label only",
  "classifyOtStop\tserver/services/ot/commandDispatcher.ts\tphanLoaiStopGhimRangBuoc": "THE pinned predicate of gate (1) and 5a-stop",
  "classifyOtStop\tserver/services/ot/otEdgeDispatch.ts\tclassifyEdgeOtStop": "edge dispatcher: RAW write, as the edge package",
  "classifyOtStop(ref)\tserver/services/orchestration/foe/foeEngine.ts\tstopClassifierProbe": "module probe only",
  "classifyOtStop(ref)\tserver/services/orchestration/foe/foeStepClass.ts\tmakeStopVerifier": "the verifier takes the dispatcher's own function",
  "classifyOtStop(ref)\tserver/services/orchestration/foe/foeStepClass.ts\tverified": "the same, read at the question",
  "epKieuGhiTheoTag\tserver/services/ot/commandDispatcher.ts\twritesEpKieuChoRangBuoc": "gate (1): THE coercion",
  "epKieuGhiTheoTag(ref)\tserver/services/orchestration/foe/foeStepClass.ts\tmakeStopVerifier": "the verifier: THE coercion, the dispatcher's own",
  "epKieuGiaTri\tserver/services/ot/commandDispatcher.ts\tepKieuKenh": "the coercion's core",
  "epKieuGiaTri\tserver/services/scada/kenhScada.ts\tkiemGiaTriGhi": "SCADA write check (range, step): not a pinned question",
  "epKieuKenh\tserver/services/ot/commandDispatcher.ts\tcongKenhSom": "dispatcher step 3b pass 1: the same coercion as gate (1)",
  "epKieuKenh\tserver/services/ot/commandDispatcher.ts\tepKieuGhiTheoTag": "THE coercion",
  "matchPinnedStop\tserver/services/ot/aiControlGate.safety.ts\tmucKenhChoAi": "AI control gate (HMI pins): outside FOE, listed for the kiểm kê (T13/T16)",
  "matchPinnedStop\tserver/services/ot/commandDispatcher.ts\tclassifyOtStop": "the rule itself",
  "matchPinnedStop\tserver/services/ot/commandDispatcher.ts\tdispatchCore": "dispatcher, step-3 rows",
  "matchPinnedStop\tserver/services/ot/commandDispatcher.ts\tkhopGhim": "dispatcher, early channel gate exemption (coerced writes)",
  "matchPinnedStop\tserver/services/ot/commandDispatcher.ts\tphanLoaiStopKhoa": "dispatcher: key purpose",
  "matchPinnedStop\tserver/services/ot/commandDispatcher.ts\twritesOverrideStopPin": "dispatcher: override check",
  "phanLoaiStopGhimRangBuoc\tserver/services/ot/commandDispatcher.ts\tdispatchCore": "5a-stop",
  "phanLoaiStopGhimRangBuoc\tserver/services/ot/commandDispatcher.ts\tlaStopGhimTaiCong1": "gate (1) (phanLoaiStopGhimChoFoe, the FOE engine's sink question)",
  "writesEpKieuChoRangBuoc\tserver/services/ot/commandDispatcher.ts\tdispatchCore": "binding re-check, coerced form",
  "writesEpKieuChoRangBuoc\tserver/services/ot/commandDispatcher.ts\tlaStopGhimTaiCong1": "gate (1): the coerced form",
};

describe("A2(n) T6e — one pinned predicate: census", () => {
  it("T6E-MOT-NGUON the verifier coerces by the dispatcher's own function and holds no coercion of its own; gate (1) calls the same one", () => {
    const sc = doc("server/services/orchestration/foe/foeStepClass.ts");
    const mv = hamTen(sc, "makeStopVerifier");
    let layHam = false;
    duyet(mv, (n) => {
      if (ts.isPropertyAccessExpression(n) && n.name.text === "epKieuGhiTheoTag") layHam = true;
    });
    expect(layHam, "makeStopVerifier takes commandDispatcher.epKieuGhiTheoTag").toBe(true);
    // the writes the verifier classifies come out of that function
    let tu: string | null = null;
    duyet(mv, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "classifyOtStop" && n.arguments[1] && ts.isIdentifier(n.arguments[1])) {
        const ten = n.arguments[1].text;
        duyet(mv, (m) => {
          if (ts.isVariableDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === ten && m.initializer) tu = m.initializer.getText(sc);
        });
      }
    });
    expect(tu, "the writes classifyOtStop gets").toMatch(/^epKieu\(/);
    const rieng: string[] = [];
    duyet(sc, (n) => {
      if (ts.isIdentifier(n) && EP_RIENG.includes(n.text)) rieng.push(`${n.text}@${sc.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    });
    expect(rieng, "a coercion of its own in foeStepClass.ts").toEqual([]);
    // commit đóng T6e — the edge pair: the package's builder and the edge dispatcher coerce TOGETHER or not at all (both raw today, EP-KIEU-EDGE)
    const epTrong = (f: string, hams: readonly string[]) => {
      const sf = doc(f);
      const ra: string[] = [];
      for (const ham of hams) {
        duyet(hamTen(sf, ham), (n) => {
          if (ts.isIdentifier(n) && [...EP_RIENG, "epKieuGhiTheoTag", "writesEpKieuChoRangBuoc"].includes(n.text)) ra.push(`${ham}:${n.text}`);
        });
      }
      return ra;
    };
    const goiEp = epTrong("server/services/edge/edgeRunAnalysis.ts", ["analyseDefinition", "isPinnedOtStop", "stopPinsOf"]);
    const edgeEp = epTrong("server/services/ot/otEdgeDispatch.ts", ["classifyEdgeOtStop", "resolveWrites"]);
    expect({ goi: goiEp.length > 0, dispatcherEdge: edgeEp.length > 0 }, `the edge pair coerces together or not at all: package ${goiEp.join(",") || "raw"}, edge dispatcher ${edgeEp.join(",") || "raw"}`).toEqual({ goi: false, dispatcherEdge: false });
    // the dispatcher: declared once, gate (1)'s coercion is its call
    const cd = doc("server/services/ot/commandDispatcher.ts");
    const w = hamTen(cd, "writesEpKieuChoRangBuoc");
    let goi = 0;
    duyet(w, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "epKieuGhiTheoTag") goi++;
    });
    expect(goi).toBe(1);
    const e = hamTen(cd, "epKieuGhiTheoTag");
    expect(e.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
    const trong = new Set<string>();
    duyet(e, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) trong.add(n.expression.text);
    });
    expect([...trong].filter((x) => ["kenhDaKhaiGhi", "epKieuKenh"].includes(x)).sort()).toEqual(["epKieuKenh", "kenhDaKhaiGhi"]);
    const khai: string[] = [];
    for (const f of tepNguon()) {
      const t = readFileSync(path.join(ROOT, f), "utf8");
      if (!t.includes("epKieuGhiTheoTag")) continue;
      duyet(doc(f), (n) => {
        if ((ts.isFunctionDeclaration(n) && n.name?.text === "epKieuGhiTheoTag") || (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "epKieuGhiTheoTag")) khai.push(f);
      });
    }
    expect(khai, "declared once").toEqual(["server/services/ot/commandDispatcher.ts"]);
  });

  it("T6E-KIEM-KE every call of the pinned-STOP classifiers and of the coercion is listed, with what it reads (a new one is red until listed)", () => {
    const thay = new Set<string>();
    for (const f of tepNguon()) {
      const t = readFileSync(path.join(ROOT, f), "utf8");
      if (!TEN.some((x) => t.includes(x))) continue;
      duyet(doc(f), (n) => {
        if (ts.isCallExpression(n)) {
          const e = n.expression;
          const ten = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
          if (ten && TEN.includes(ten)) thay.add(`${ten}\t${f}\t${hamCua(n)}`);
        }
        if (ts.isPropertyAccessExpression(n) && TEN.includes(n.name.text) && !ts.isCallExpression(n.parent)) thay.add(`${n.name.text}(ref)\t${f}\t${hamCua(n)}`);
      });
    }
    expect([...thay].sort()).toEqual(Object.keys(KIEM_KE).sort());
  });

  it("T6E-EDGE the edge pair (package, edge dispatcher) classifies the same RAW write and agrees on every row; it differs from central's coerced verdict on exactly the coerced rows, one way", async () => {
    // AST: both pass the write as it came to classifyOtStop; neither file holds a coercion (commit đóng T6e: the package is raw again, on purpose)
    for (const [f, ham, doc2] of [
      ["server/services/ot/otEdgeDispatch.ts", "classifyEdgeOtStop", "input.writes"],
      ["server/services/edge/edgeRunAnalysis.ts", "isPinnedOtStop", "rb.writes"],
    ] as const) {
      const sf = doc(f);
      let thay: string | null = null;
      duyet(hamTen(sf, ham), (n) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "classifyOtStop") thay = n.arguments[1]?.getText(sf) ?? null;
      });
      expect(thay, `${ham}: the write classifyOtStop gets`).toBe(doc2);
      const ep: string[] = [];
      duyet(sf, (n) => {
        if (ts.isIdentifier(n) && [...EP_RIENG, "epKieuGhiTheoTag", "writesEpKieuChoRangBuoc"].includes(n.text)) ep.push(n.text);
      });
      expect(ep, `${f}: a coercion`).toEqual([]);
    }
    // the table: the same inputs, one verdict
    const tags = [
      { tagKey: "haltk", address: "00011", dataType: "bool", stopValue: true, scale: null, offset: null, channelKind: "output" },
      { tagKey: "nk", address: "40011", dataType: "int", stopValue: 5, scale: 1, offset: 0, channelKind: "output" },
      { tagKey: "fk", address: "40013", dataType: "float", stopValue: 1.5, scale: null, offset: null, channelKind: "output" },
      { tagKey: "sk", address: "40014", dataType: "string", stopValue: "OFF", scale: null, offset: null, channelKind: "output" },
      { tagKey: "haltu", address: "00012", dataType: "bool", stopValue: true, scale: null, offset: null },
    ].map((t) => ({ ...t, writable: true, isEnabled: true }));
    const adapter = { id: 501, connectionFingerprint: "fp", tags } as never;
    const pins = stopPinsFromTagRows(tags.map((t) => ({ tagKey: t.tagKey, dataType: t.dataType, stopValue: t.stopValue, writable: t.writable, isEnabled: t.isEnabled })));
    const values: unknown[] = ["true", "false", "1", "0", " TRUE ", 1, 0, true, false, null, "abc", 5, 2.5, "5", 6, 1.5, "1.5", "OFF", "off"];
    const lech: string[] = [];
    const khacGoi: string[] = [];
    let ghim = 0;
    for (const t of tags) {
      for (const value of values) {
        const writes = [{ tagKey: t.tagKey, value }];
        const d = classifyEdgeOtStop({ commandType: "stop", writes } as never, adapter, "fp").pinned;
        const g = (await isPinnedOtStop({ kind: "ot", stopTyped: true, commandType: "stop", writes } as never, pins)).pinned;
        const goi = (await isPinnedOtStop({ kind: "ot", stopTyped: true, commandType: "stop", writes: epKieuGhiTheoTag(tags as never, writes) ?? writes } as never, pins)).pinned;
        if (d) ghim++;
        if (d !== g) lech.push(`${t.tagKey}=${JSON.stringify(value)} edge dispatcher:${d} package:${g}`);
        if (d !== goi) khacGoi.push(`${t.tagKey}=${JSON.stringify(value)} edge:${d} central:${goi}`);
      }
    }
    expect(lech).toEqual([]);
    expect(ghim, "the table reaches pinned rows").toBeGreaterThan(0);
    // EP-KIEU-EDGE, measured: central (coerced) says pinned and the edge pair does not on exactly these rows, never the other way (loại (1)). Central names such a step in the
    // T6e-K1 words when the edge drops it (dieu-phoi 08/11 T6e-K2, parity T6E-EC6-EP)
    expect(khacGoi.sort()).toEqual(['fk="1.5" edge:false central:true', 'haltk=" TRUE " edge:false central:true', 'haltk="1" edge:false central:true', 'haltk="true" edge:false central:true', 'nk="5" edge:false central:true'].sort());
  });
});
