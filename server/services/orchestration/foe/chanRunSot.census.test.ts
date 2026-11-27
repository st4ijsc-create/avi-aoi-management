/**
 * TEST-DB-RUN-SOT (HST 27/11) — CENSUS: one door to the FOE boot scan in test code.
 *
 * The scan (foeEngine's boot hook) takes EVERY queued / running / compensating run the handle sees — in a DB case that handle is the case's
 * transaction, and it sees the COMMITTED leftovers of `_test` too: it holds them, fails them, re-sends a compensation, and with FOE_DURABLE
 * continues them (their commands go out). So a test file that calls it calls it in ONE place: `async function quetBoot()`, whose FIRST
 * statement is `await chanRunSot(docSot ?? (await realGetDb())!, "<file>")` (__foeGateRunFixture.ts: refuses when `_test` holds such a run).
 *
 * Population (found, not listed): every `*.test.ts` and every `__*.ts` fixture under server/, this census excepted (its own constant names
 * the scan). By the AST (typescript), not by text. A REFERENCE is the identifier, `x["<name>"]`, or ANY string literal whose text is exactly
 * the name (`const { "<name>": f } = …`, `Reflect.get(x, "<name>")`), except a test title (first argument of it / test / describe) and the
 * literals counted in CHUOI_DUOC_PHEP. Comments are not in the AST. Per file, outside import declarations:
 *   • 0 references ⇒ nothing to keep;
 *   • otherwise EXACTLY ONE: the callee of a call (bare, `x.name`, `x["name"]`) inside `async function quetBoot()`, in a statement AFTER its
 *     first; that first statement is `await chanRunSot(docSot ?? (await realGetDb())!, "<file>")` with "<file>" = the last two dotted parts of
 *     the file's name before `.test.ts` (foeKetCucKhongRo.a2n.db.test.ts ⇒ "a2n.db"); `chanRunSot` is a plain named import from
 *     `…/__foeGateRunFixture` and is declared nowhere else in the file; `realGetDb` is `const realGetDb = (conn as unknown as { __realGetDb:
 *     typeof conn.getDb }).__realGetDb` with `conn` the namespace import of `…/db/connection` and a vi.mock of that same module handing out
 *     `__realGetDb: real.getDb` (real = await importOriginal…); `docSot` is `let docSot: Tx | null = null` and is only ever set to null / tx;
 *   • an import alias (`name as other`) and a re-export are refused anywhere.
 * ALLOWED (named; each must still reference the scan, else it leaves the list, and must still mock db/connection WITHOUT importOriginal —
 * no real database): the files whose getDb is a fake. Everything else that references the scan is pinned (CO_QUET_BOOT).
 * `quetBoot` takes no parameter. Blind spots (named limits): a key built at run time (a variable, a concatenation) — RUN-SOT-KHOA-DONG; a
 * deliberate dodge of the docSot rule (an alias variable, eval, a setter) — RUN-SOT-LACH-CO-Y; CHUOI_DUOC_PHEP counts literals per file, not
 * their places — RUN-SOT-CHO-PHEP-THEO-SO; helper modules that are neither a
 * test nor a `__` fixture are outside the population — RUN-SOT-NGOAI-QUAN-THE; a server booted on `_test` (server/_core/index.ts runs the scan
 * at every start) — RUN-SOT-MAY-CHU-THAT.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TEN = "rehydrateInterruptedRuns";
const CUA = "quetBoot";
const CHAN = "chanRunSot";
const DOC_CHAN = "docSot ?? (await realGetDb())!";
const REAL_GET_DB = "(conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb";
const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CHINH_NO = "server/services/orchestration/foe/chanRunSot.census.test.ts";

/** getDb is a fake in these files (vi.mock of db/connection with no importOriginal). foeDurable.test.ts imports only autoResumeInterruptedRuns:
 * it never references the scan, so it is not listed (a listed file must reference it). */
const CHO_PHEP: Record<string, string> = {
  "server/services/orchestration/foe/foe.test.ts": "getDb mocked: fakeDb",
  "server/services/orchestration/foe/foeBootQuaHan.a2n.test.ts": "getDb mocked: fakeDb (the stand-in disk)",
  "server/services/orchestration/foe/foeRunStoreParity.dot10.test.ts": "getDb mocked",
  "server/services/orchestration/foe/foeSchema0367.dot7.test.ts": "getDb mocked: fake",
  "server/services/orchestration/foe/foeStopChuaRaGhi.a2n.test.ts": "getDb mocked: fakeDb",
};

/** String literals whose text is exactly the name and that are NOT a reference (not a title), counted per file. */
const CHUOI_DUOC_PHEP: Record<string, number> = {
  "server/routers/engineeringAssignment.db.test.ts": 1, // [["<name>", rehydrateHold], …] — the label of a case built in a loop; it hand-writes the shape the scan writes
};

/** The five DB files that run the scan today (a new one is classified here before this pin moves). */
const CO_QUET_BOOT = [
  "server/services/orchestration/foe/foeDuplicateInFlight.r1b2b2.db.test.ts",
  "server/services/orchestration/foe/foeKetCucKhongRo.a2n.db.test.ts",
  "server/services/orchestration/foe/foeStopHangMoi.a2m.db.test.ts",
  "server/services/orchestration/foe/foeStopHangMoi.a2m2.db.test.ts",
  "server/services/ot/hangFoeDaTieu.a2k.db.test.ts",
];

const chu = (n: ts.Node, sf: ts.SourceFile) => n.getText(sf).replace(/\s+/g, " ").trim();
const laChuoiTen = (n: ts.Node) => ts.isStringLiteralLike(n) && n.text === TEN;

/** The first argument of it / test / describe (any chain: it.skip, describe.skipIf(x), it.each(t)). */
function laTieuDe(n: ts.Node): boolean {
  const goi = n.parent;
  if (!goi || !ts.isCallExpression(goi) || goi.arguments[0] !== n) return false;
  let e: ts.Expression = goi.expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(e)) e = e.expression;
    else if (ts.isCallExpression(e)) e = e.expression;
    else break;
  }
  return ts.isIdentifier(e) && (e.text === "it" || e.text === "test" || e.text === "describe");
}

/** The references to the scan (see the header), and the count of exact-name literals that are not titles. */
function thamChieuCua(sf: ts.SourceFile): { refs: ts.Node[]; chuoi: number } {
  const refs: ts.Node[] = [];
  let chuoi = 0;
  const di = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isElementAccessExpression(n) && laChuoiTen(n.argumentExpression)) {
      refs.push(n);
      ts.forEachChild(n.expression, di);
      return;
    }
    if (ts.isIdentifier(n) && n.text === TEN) refs.push(n);
    else if (laChuoiTen(n) && !laTieuDe(n)) {
      chuoi++;
      refs.push(n);
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { refs, chuoi };
}

/** `n` is the identifier `ten`, or holds it anywhere below (a destructuring target). */
function coTen(n: ts.Node, ten: string): boolean {
  if (ts.isIdentifier(n)) return n.text === ten;
  let co = false;
  ts.forEachChild(n, (c) => {
    if (!co && coTen(c, ten)) co = true;
  });
  return co;
}

const tenTep = (rel: string) => rel.split("/").pop()!.replace(/\.test\.ts$/, "").split(".").slice(-2).join(".");

/** null ⇔ the file keeps the rule; otherwise why not (short). `duocPhep` = exact-name literals this file may hold (CHUOI_DUOC_PHEP). */
function kiemNguon(rel: string, src: string, duocPhep = 0): string | null {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const thay: { loi: string | null; connMod: string | null } = { loi: null, connMod: null };
  const di0 = (n: ts.Node): void => {
    if (ts.isImportSpecifier(n) && n.propertyName && (n.propertyName.text === TEN || n.name.text === TEN)) thay.loi ??= "import alias";
    if (ts.isExportSpecifier(n) && (n.name.text === TEN || n.propertyName?.text === TEN)) thay.loi ??= "re-export";
    ts.forEachChild(n, di0);
  };
  di0(sf);
  if (thay.loi) return thay.loi;
  const { refs: tatCa, chuoi } = thamChieuCua(sf);
  if (chuoi < duocPhep) return `${chuoi} allowed literals, ${duocPhep} expected (stale CHUOI_DUOC_PHEP)`;
  // the allowed literals are the first `duocPhep` exact-name literals; only a file with no other reference may hold them
  const refs = duocPhep > 0 ? tatCa.filter((n) => !laChuoiTen(n)).concat(tatCa.filter(laChuoiTen).slice(duocPhep)) : tatCa;
  if (refs.length === 0) return null;
  if (refs.length > 1) return `${refs.length} references`;
  const ref = refs[0]!;
  const bt = ts.isIdentifier(ref) && ref.parent && ts.isPropertyAccessExpression(ref.parent) && ref.parent.name === ref ? ref.parent : ref;
  const goi = bt.parent;
  if (!goi || !ts.isCallExpression(goi) || goi.expression !== bt) return "not a call (a value)";
  let ham: ts.Node | undefined = goi.parent;
  while (ham && !ts.isFunctionLike(ham)) ham = ham.parent;
  if (!ham || !ts.isFunctionDeclaration(ham) || ham.name?.text !== CUA || !ham.body) return `called outside ${CUA}`;
  if (ham.parameters.length > 0) return `${CUA} takes parameters`;
  const dau = ham.body.statements[0];
  const chan =
    dau && ts.isExpressionStatement(dau) && ts.isAwaitExpression(dau.expression) && ts.isCallExpression(dau.expression.expression) && ts.isIdentifier(dau.expression.expression.expression) && dau.expression.expression.expression.text === CHAN
      ? dau.expression.expression
      : null;
  if (!chan) return `${CUA} does not start with await ${CHAN}(`;
  let cau: ts.Node = goi;
  while (cau.parent && cau.parent !== ham.body) cau = cau.parent;
  if (ham.body.statements.indexOf(cau as ts.Statement) < 1) return `called inside the ${CHAN} statement`;
  // D2 — what the refusal reads, and where its parts come from
  if (chan.arguments.length !== 2 || chu(chan.arguments[0]!, sf) !== DOC_CHAN) return `${CHAN} does not read ${DOC_CHAN}`;
  const a1 = chan.arguments[1]!;
  if (!ts.isStringLiteral(a1) || a1.text !== tenTep(rel)) return `${CHAN} does not name the file "${tenTep(rel)}"`;
  let nhapChan = 0;
  let khaiChan = 0;
  const khaiReal: ts.VariableDeclaration[] = [];
  const khaiDoc: ts.VariableDeclaration[] = [];
  const ganDoc: string[] = [];
  const mock: ts.CallExpression[] = [];
  const di = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const m = n.moduleSpecifier.text;
      const b = n.importClause?.namedBindings;
      if (b && ts.isNamedImports(b)) for (const e of b.elements) if (e.name.text === CHAN && !e.propertyName && /(^|\/)__foeGateRunFixture$/.test(m)) nhapChan++;
      if (b && ts.isNamespaceImport(b) && b.name.text === "conn" && /(^|\/)db\/connection$/.test(m)) thay.connMod = m;
      return;
    }
    const ten = (n as { name?: ts.Node }).name;
    if (ten && ts.isIdentifier(ten) && ten.text === CHAN && (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isClassDeclaration(n) || ts.isBindingElement(n))) khaiChan++;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "realGetDb") khaiReal.push(n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "docSot") khaiDoc.push(n);
    // every write of docSot: `docSot = x` keeps x; any other form (compound, destructuring target, ++ / --, for-in / for-of target) is kept whole ⇒ refused
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      if (ts.isIdentifier(n.left) && n.left.text === "docSot") ganDoc.push(n.operatorToken.kind === ts.SyntaxKind.EqualsToken ? chu(n.right, sf) : chu(n, sf));
      else if ((ts.isArrayLiteralExpression(n.left) || ts.isObjectLiteralExpression(n.left)) && coTen(n.left, "docSot")) ganDoc.push(chu(n, sf));
    }
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) && coTen(n.operand, "docSot")) ganDoc.push(chu(n, sf));
    if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && !ts.isVariableDeclarationList(n.initializer) && coTen(n.initializer, "docSot")) ganDoc.push(chu(n.initializer, sf));
    if (ts.isCallExpression(n) && chu(n.expression, sf) === "vi.mock") mock.push(n);
    ts.forEachChild(n, di);
  };
  di(sf);
  if (nhapChan !== 1 || khaiChan !== 0) return `${CHAN} is not the one imported from __foeGateRunFixture`;
  const r = khaiReal[0];
  if (khaiReal.length !== 1 || !r || !r.initializer || chu(r.initializer, sf) !== REAL_GET_DB || !(r.parent.flags & ts.NodeFlags.Const)) return "realGetDb is not the db/connection mock's __realGetDb";
  const connMod = thay.connMod;
  if (!connMod) return "conn is not the namespace import of db/connection";
  const traReal = mock.some((m) => {
    const s0 = m.arguments[0];
    const f = m.arguments[1];
    if (!s0 || !ts.isStringLiteralLike(s0) || s0.text !== connMod || !f) return false;
    let coGan = false;
    let coReal = false;
    const x = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "__realGetDb" && chu(n.initializer, sf) === "real.getDb") coGan = true;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "real" && n.initializer && /^await importOriginal\b/.test(chu(n.initializer, sf))) coReal = true;
      ts.forEachChild(n, x);
    };
    x(f);
    return coGan && coReal;
  });
  if (!traReal) return "the db/connection mock does not hand out the real getDb as __realGetDb";
  const d = khaiDoc[0];
  if (khaiDoc.length !== 1 || !d || !d.initializer || chu(d.initializer, sf) !== "null" || !d.type || chu(d.type, sf) !== "Tx | null") return "docSot is not `let docSot: Tx | null = null`";
  if (ganDoc.some((g) => g !== "null" && g !== "tx")) return "docSot is set to something other than null / tx";
  return null;
}

/** An ALLOWED file: still a vi.mock of db/connection, and that mock never reaches the real module. */
function kiemMockDb(rel: string, src: string): string | null {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const mock: ts.CallExpression[] = [];
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && chu(n.expression, sf) === "vi.mock" && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && /(^|\/)db\/connection$/.test(n.arguments[0].text)) mock.push(n);
    ts.forEachChild(n, di);
  };
  di(sf);
  if (mock.length === 0) return "no vi.mock of db/connection";
  for (const m of mock) {
    const f = m.arguments[1];
    if (!f || !(ts.isArrowFunction(f) || ts.isFunctionExpression(f))) return "the db/connection mock has no factory";
    if (f.parameters.length > 0 || /\bimportOriginal\b|\bimportActual\b/.test(f.getText(sf))) return "the db/connection mock reaches the real module";
  }
  return null;
}

function quanThe(): string[] {
  const ra: string[] = [];
  const di = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f !== "node_modules") di(p);
      } else if (f.endsWith(".test.ts") || (f.startsWith("__") && f.endsWith(".ts") && !f.endsWith(".d.ts"))) {
        ra.push(relative(GOC, p).replace(/\\/g, "/"));
      }
    }
  };
  di(join(GOC, "server"));
  return ra.sort().filter((f) => f !== CHINH_NO);
}

const coThamChieu = (rel: string, src: string): boolean => {
  if (!src.includes(TEN)) return false;
  const { refs, chuoi } = thamChieuCua(ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return refs.length - Math.min(chuoi, CHUOI_DUOC_PHEP[rel] ?? 0) > 0;
};

// synthetic sources: single quotes on vi.mock (foeNapMotLan.test.ts reads every double-quoted vi.mock specifier in this directory's tests)
const DUNG = [
  `import * as conn from '../../../db/connection';`,
  `import { ${CHAN} } from './__foeGateRunFixture';`,
  `import { ${TEN} } from './foeEngine';`,
  `vi.mock('../../../db/connection', async (importOriginal) => {`,
  `  const real = await importOriginal<typeof import('../../../db/connection')>();`,
  `  return { ...real, getDb: async () => null, __realGetDb: real.getDb };`,
  `});`,
  `const realGetDb = ${REAL_GET_DB};`,
  `let docSot: Tx | null = null;`,
  `async function ${CUA}() {`,
  `  await ${CHAN}(${DOC_CHAN}, "mau.db");`,
  `  return ${TEN}();`,
  `}`,
  `it("t", async () => { await trongGiaoDich(async (tx) => { docSot = tx; }); docSot = null; });`,
  ``,
].join("\n");
const REL = "server/x/tep.mau.db.test.ts";

describe("TEST-DB-RUN-SOT — one door to the FOE boot scan in test code", () => {
  it("the instrument sees each form (synthetic sources)", () => {
    const k = (src: string, duocPhep = 0) => kiemNguon(REL, src, duocPhep);
    const doi = (a: string, b: string) => {
      expect(DUNG.split(a).length, `the template holds ${a} once`).toBe(2);
      return DUNG.replace(a, b);
    };
    const ngoai = (dong: string) => `${dong}\n`; // a file with no door at all
    expect(k(DUNG)).toBeNull();
    expect(tenTep("server/services/orchestration/foe/foeKetCucKhongRo.a2n.db.test.ts")).toBe("a2n.db");
    // references and where they may be
    expect(k(ngoai(`// ${TEN}() in a comment\nit("${TEN}", () => {});\ndescribe.skipIf(!x)("${TEN}", () => {});\nconst s = \`a ${TEN} b\`;`))).toBeNull();
    expect(k(`import { ${TEN} as quet } from './foeEngine';\n${DUNG}`)).toBe("import alias");
    expect(k(ngoai(`export { ${TEN} } from './foeEngine';`))).toBe("re-export");
    expect(k(`${DUNG}it("a", async () => { await ${TEN}(); });\n`)).toBe("2 references");
    expect(k(ngoai(`it("a", async () => { await ${TEN}(); });`))).toBe(`called outside ${CUA}`);
    expect(k(ngoai(`it("a", async () => { await eng.${TEN}(); });`))).toBe(`called outside ${CUA}`);
    expect(k(ngoai(`it("a", async () => { await eng["${TEN}"](); });`))).toBe(`called outside ${CUA}`);
    expect(k(ngoai(`const f = ${TEN};`))).toBe("not a call (a value)");
    expect(k(ngoai(`await chay([${TEN}]);`))).toBe("not a call (a value)");
    expect(k(ngoai(`vi.mock('./foeEngine', () => ({ ${TEN}: vi.fn() }));`))).toBe("not a call (a value)");
    expect(k(ngoai(`const { ${TEN}: quet } = await import('./foeEngine');`))).toBe("not a call (a value)");
    expect(k(ngoai(`const { "${TEN}": quet } = await import('./foeEngine');`))).toBe("not a call (a value)");
    expect(k(ngoai(`await Reflect.get(eng, "${TEN}")();`))).toBe("not a call (a value)");
    expect(k(ngoai(`const nhan = [["${TEN}", 1]];`))).toBe("not a call (a value)");
    expect(k(ngoai(`const nhan = [["${TEN}", 1]];`), 1)).toBeNull(); // CHUOI_DUOC_PHEP
    expect(k(ngoai(`const a = 1;`), 1)).toBe("0 allowed literals, 1 expected (stale CHUOI_DUOC_PHEP)");
    // the door itself
    expect(k(doi(`  await ${CHAN}(${DOC_CHAN}, "mau.db");\n  return ${TEN}();`, `  const r = await ${TEN}();\n  await ${CHAN}(${DOC_CHAN}, "mau.db");\n  return r;`))).toBe(`${CUA} does not start with await ${CHAN}(`);
    expect(k(doi(`  await ${CHAN}(${DOC_CHAN}, "mau.db");\n  return ${TEN}();`, `  await ${CHAN}(await ${TEN}(), "mau.db");`))).toBe(`called inside the ${CHAN} statement`);
    expect(k(doi(`  return ${TEN}();`, `  void (async () => { await ${TEN}(); })();`))).toBe(`called outside ${CUA}`);
    expect(k(doi(`async function ${CUA}() {`, `async function khac() {`))).toBe(`called outside ${CUA}`);
    // D2 — what the refusal reads, and where its parts come from
    expect(k(doi(`${CHAN}(${DOC_CHAN}, "mau.db")`, `${CHAN}(H.tx, "mau.db")`))).toBe(`${CHAN} does not read ${DOC_CHAN}`);
    expect(k(doi(`${CHAN}(${DOC_CHAN}, "mau.db")`, `${CHAN}(docSot ?? rong, "mau.db")`))).toBe(`${CHAN} does not read ${DOC_CHAN}`);
    expect(k(doi(`"mau.db");`, `"khac.db");`))).toBe(`${CHAN} does not name the file "mau.db"`);
    expect(k(doi(`from './__foeGateRunFixture'`, `from './khac'`))).toBe(`${CHAN} is not the one imported from __foeGateRunFixture`);
    expect(k(`${DUNG}async function ${CHAN}() {}\n`)).toBe(`${CHAN} is not the one imported from __foeGateRunFixture`);
    expect(k(doi(`const realGetDb = ${REAL_GET_DB};`, `const realGetDb = async () => rong;`))).toBe("realGetDb is not the db/connection mock's __realGetDb");
    expect(k(doi(`__realGetDb: real.getDb`, `__realGetDb: async () => rong`))).toBe("the db/connection mock does not hand out the real getDb as __realGetDb");
    expect(k(doi(`docSot = null; });`, `docSot = rong; });`))).toBe("docSot is set to something other than null / tx");
    expect(k(doi(`docSot = null; });`, `docSot ??= rong; });`))).toBe("docSot is set to something other than null / tx");
    expect(k(doi(`docSot = null; });`, `docSot ||= rong; });`))).toBe("docSot is set to something other than null / tx");
    expect(k(doi(`docSot = null; });`, `[docSot] = [rong]; });`))).toBe("docSot is set to something other than null / tx");
    expect(k(doi(`docSot = null; });`, `({ d: docSot } = o); });`))).toBe("docSot is set to something other than null / tx");
    expect(k(doi(`docSot = null; });`, `for (docSot of ds) {} });`))).toBe("docSot is set to something other than null / tx");
    expect(k(doi(`async function ${CUA}() {`, `async function ${CUA}(doc: unknown) {`))).toBe(`${CUA} takes parameters`);
    // an ALLOWED (mock-DB) file
    expect(kiemMockDb("a.test.ts", `vi.mock('../../../db/connection', () => ({ getDb: vi.fn(async () => fakeDb) }));\n`)).toBeNull();
    expect(kiemMockDb("a.test.ts", `vi.mock('../../../db/connection', async (importOriginal) => ({ ...(await importOriginal()), getDb: vi.fn() }));\n`)).toBe("the db/connection mock reaches the real module");
    expect(kiemMockDb("a.test.ts", `const a = 1;\n`)).toBe("no vi.mock of db/connection");
  });

  it("every test file and __ fixture under server/ that references the scan keeps the one door; the allowed (mock-DB) ones still reference it and still fake the database", () => {
    const tep = quanThe();
    // the walk sees both kinds it must (a fixture, a DB test in another directory); the pins below fail on a blind walk
    expect(tep).toContain("server/services/orchestration/foe/__foeGateRunFixture.ts");
    expect(tep).toContain("server/services/ot/hangFoeDaTieu.a2k.db.test.ts");
    const doc = (f: string) => readFileSync(join(GOC, f), "utf8");
    const co = tep.filter((f) => coThamChieu(f, doc(f)));
    const choPhepMat = Object.keys(CHO_PHEP).filter((f) => !co.includes(f));
    expect(choPhepMat, JSON.stringify(choPhepMat)).toEqual([]);
    const choPhepThat = Object.keys(CHO_PHEP).map((f) => [f, kiemMockDb(f, doc(f))]).filter(([, l]) => l !== null);
    expect(choPhepThat, JSON.stringify(choPhepThat)).toEqual([]);
    const ngoaiGhim = co.filter((f) => !(f in CHO_PHEP));
    expect(ngoaiGhim, JSON.stringify(ngoaiGhim)).toEqual(CO_QUET_BOOT);
    const sai = tep.filter((f) => !(f in CHO_PHEP) && doc(f).includes(TEN)).map((f) => [f, kiemNguon(f, doc(f), CHUOI_DUOC_PHEP[f] ?? 0)]).filter(([, l]) => l !== null);
    expect(sai, JSON.stringify(sai)).toEqual([]);
  });
});
