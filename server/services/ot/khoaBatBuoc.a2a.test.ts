/**
 * SCADA R1b-2b-2a A2(a) — các chỗ NGỦ có thể đưa lệnh KHÔNG khoá tới `dispatch()` (kiểm kê a2a-kiem-ke-khoa.md), mỗi chỗ tự từ chối / tự sinh khoá
 * (không dựa vào zod của router):
 *   • `adapterFacade.executeCommand` — cả `idempotency_key` lẫn `command_id` rỗng (thiếu / không phải chuỗi / chỉ khoảng trắng) ⇒ ack INVALID_ARGS, KHÔNG gọi dispatch();
 *   • `gem300.buildHitlDispatchInput` — `idempotencyKey` "" / chỉ khoảng trắng ⇒ khoá sinh (ngữ nghĩa `||` có cắt trắng, không phải `??`);
 *   • `khoaDispatchLapTrinh` — phần bên gọi rỗng / chỉ khoảng trắng / khoá miền `pd:u<N>:` đúng chữ (phần sau rỗng) ⇒ null (từ chối); adapter Mitsubishi
 *     trả lời từ chối có mã, KHÔNG gọi dispatch(); URSim từ chối, không chạm gì.
 * `dispatch()` là mock (không DB, không thiết bị); không cờ nào được bật.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const H = vi.hoisted(() => ({ goi: [] as Array<{ idempotencyKey: unknown }> }));
vi.mock("./commandDispatcher", () => ({
  dispatch: async (input: { idempotencyKey: unknown }) => {
    H.goi.push(input);
    return { ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [] };
  },
}));
vi.mock("./otManager", () => ({ getActiveDriver: () => undefined }));

import { createAdapterFacade } from "./adapterFacade";
import type { CanonicalCommand } from "./otDriver";
import { buildHitlDispatchInput, mapHostCommandToProposal } from "../secsgem/gem300";
import { khoaDispatchLapTrinh, khoaMienLapTrinh } from "../programming/khoaMienLapTrinh";
import { MitsubishiEngineeringAdapter } from "../programming/mitsubishi/mitsubishiEngineeringAdapter";
import { deployUrscriptToUrsim } from "../robot/ursim/ursimDeployService";

beforeEach(() => {
  H.goi.length = 0;
});

describe("A2(a) — adapterFacade.executeCommand: không khoá ⇒ INVALID_ARGS, dispatch() KHÔNG được gọi", () => {
  const cmd = (over: Record<string, unknown>): CanonicalCommand =>
    ({ command_id: "cmd-1", asset_id: "urn:asset:10", verb: "tag.write", args: { tag: "t", value: 1 }, issued_by: 7, idempotency_key: "idem-1", ...over }) as CanonicalCommand;
  const facade = () => createAdapterFacade({ adapterId: 10, machineId: 5 } as never);

  for (const [ten, over] of [
    ["cả hai rỗng", { idempotency_key: "", command_id: "" }],
    ["cả hai chỉ khoảng trắng", { idempotency_key: "   ", command_id: " \t " }],
    ["cả hai thiếu", { idempotency_key: undefined, command_id: undefined }],
    ["cả hai không phải chuỗi", { idempotency_key: 42, command_id: null }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`★ ${ten} ⇒ ack rejected INVALID_ARGS, 0 lời gọi dispatch()`, async () => {
      const ack = await facade().executeCommand(cmd(over));
      expect(ack).toMatchObject({ status: "rejected", reason: "INVALID_ARGS" });
      expect(H.goi).toHaveLength(0);
    });
  }

  it("★ idempotency_key rỗng / chỉ khoảng trắng / thiếu nhưng command_id có ⇒ dispatch() nhận command_id NGUYÊN VĂN", async () => {
    for (const k of ["", "   ", undefined]) await facade().executeCommand(cmd({ idempotency_key: k, command_id: "  C-9 " }));
    expect(H.goi.map((g) => g.idempotencyKey)).toEqual(["  C-9 ", "  C-9 ", "  C-9 "]);
  });

  it("idempotency_key có ⇒ dùng nó nguyên văn (không cắt trắng), kể cả khi command_id rỗng", async () => {
    await facade().executeCommand(cmd({ idempotency_key: " K ", command_id: "" }));
    expect(H.goi.map((g) => g.idempotencyKey)).toEqual([" K "]);
  });
});

describe("A2(a) — gem300.buildHitlDispatchInput: khoá rỗng / chỉ khoảng trắng ⇒ khoá SINH (không bao giờ \"\" tới dispatch)", () => {
  const cu = process.env.GEM300_ENABLED;
  beforeEach(() => {
    process.env.GEM300_ENABLED = "true";
  });
  afterEach(() => {
    if (cu === undefined) delete process.env.GEM300_ENABLED;
    else process.env.GEM300_ENABLED = cu;
  });
  const ctx = (idempotencyKey?: string) => ({ adapterId: 5, machineId: 42, confirmedBy: 7, requestedBy: 9, actionId: "act-1", tool: "gem300.host_command", ...(idempotencyKey === undefined ? {} : { idempotencyKey }) });

  it("★ \"\" và \"   \" ⇒ khoá sinh `gem300-s2f41-<lệnh>-<ms>` (không rỗng)", () => {
    const p = mapHostCommandToProposal("START");
    for (const k of ["", "   ", undefined]) {
      const key = buildHitlDispatchInput(p, ctx(k)).idempotencyKey;
      expect(key.trim()).not.toBe("");
      expect(key).toMatch(/^gem300-s2f41-start-\d+$/);
    }
  });

  it("khoá có ⇒ giữ NGUYÊN VĂN (kể cả khoảng trắng hai đầu)", () => {
    expect(buildHitlDispatchInput(mapHostCommandToProposal("START"), ctx(" K-1 ")).idempotencyKey).toBe(" K-1 ");
  });
});

describe("A2(a) — khoaDispatchLapTrinh: phần bên gọi rỗng ⇒ null (từ chối); bên gọi xử lý", () => {
  it("★ \"\", \"  \", `pd:u7:` (người 7), `pd:u7:  `, `pd:u3:` (miền người khác, phần sau rỗng) ⇒ null", () => {
    for (const k of ["", "  ", "pd:u7:", "pd:u7:  ", "pd:u3:"]) expect(khoaDispatchLapTrinh(k, 7), JSON.stringify(k)).toBeNull();
    expect(khoaDispatchLapTrinh(undefined as never, 7)).toBeNull();
  });

  it("khoá thường không đổi: miền đúng người giữ nguyên; khoá thô ⇒ miền người yêu cầu", () => {
    expect(khoaDispatchLapTrinh("pd:u7:K", 7)).toBe("pd:u7:K");
    expect(khoaDispatchLapTrinh("progdeploy-12", 7)).toBe(khoaMienLapTrinh(7, "progdeploy-12"));
    expect(khoaDispatchLapTrinh(" K ", 7)).toBe(khoaMienLapTrinh(7, " K "));
  });

  it("★ adapter Mitsubishi: khoá rỗng ⇒ từ chối có mã IDEMPOTENCY_KEY_REQUIRED, 0 lời gọi dispatch()", async () => {
    const build = { ok: true, diagnostics: [], meta: { paramMap: { D100: "1" } } } as never;
    for (const k of ["", "   ", "pd:u6:"]) {
      const r = await new MitsubishiEngineeringAdapter().deploy(build, { stage: "staging", idempotencyKey: k, deviceId: 41, hitl: { actionId: "act", requestedBy: 6, confirmedBy: 8 } });
      expect(r).toMatchObject({ ok: false, status: "rejected" });
      expect(String(r.error)).toMatch(/^IDEMPOTENCY_KEY_REQUIRED\b/);
    }
    expect(H.goi).toHaveLength(0);
  });

  it("URSim: khoá rỗng ⇒ rejected, không ghi / không chạm thiết bị", async () => {
    const r = await deployUrscriptToUrsim({ urscript: "def p():\nend", targetId: "default", idempotencyKey: "  ", hitl: { actionId: "act", requestedBy: 6, confirmedBy: 8 } });
    expect(r).toMatchObject({ status: "rejected", simulated: true });
    expect(String(r.reason)).toMatch(/^IDEMPOTENCY_KEY_REQUIRED\b/);
    expect(r.deploymentId).toBeUndefined();
  });
});

describe("A2(a) fix round 2 — MỌI phép thử rỗng của khoá trong dispatcher đi qua laKhoaRong (quét AST nguồn — ghim từng chỗ dùng, độc lập với khoaChuanHoa)", () => {
  const nguon = readFileSync(fileURLToPath(new URL("./commandDispatcher.ts", import.meta.url)), "utf8");
  const sf = ts.createSourceFile("commandDispatcher.ts", nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const laKhoa = (e: ts.Node): boolean => ts.isPropertyAccessExpression(e) && e.name.text === "idempotencyKey";
  const hamBao = (n: ts.Node): string => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    return "<module>";
  };
  const viPham: string[] = [];
  const goiLyDo: string[] = [];
  const dong = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const tham = (n: ts.Node): void => {
    // `!x.idempotencyKey`
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken && laKhoa(n.operand)) viPham.push(`:${dong(n)} !…idempotencyKey`);
    // `x.idempotencyKey === "" / !== ""` (hai phía)
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) {
      const rong = (e: ts.Expression) => ts.isStringLiteral(e) && e.text === "";
      if ((laKhoa(n.left) && rong(n.right)) || (rong(n.left) && laKhoa(n.right))) viPham.push(`:${dong(n)} idempotencyKey === ""`);
    }
    // `x.idempotencyKey.length`
    if (ts.isPropertyAccessExpression(n) && n.name.text === "length" && laKhoa(n.expression)) viPham.push(`:${dong(n)} idempotencyKey.length`);
    // khoá dùng làm ĐIỀU KIỆN thật/giả: `cond ? …`, `a && x.idempotencyKey`, `x.idempotencyKey || …`, `if (x.idempotencyKey)`
    if (ts.isConditionalExpression(n)) {
      const dk = n.condition;
      const thanhPhan = ts.isBinaryExpression(dk) && dk.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? [dk.left, dk.right] : [dk];
      if (thanhPhan.some(laKhoa)) viPham.push(`:${dong(n)} … ? (idempotencyKey làm điều kiện)`);
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.BarBarToken && laKhoa(n.left)) viPham.push(`:${dong(n)} idempotencyKey || …`);
    if (ts.isIfStatement(n) && laKhoa(n.expression)) viPham.push(`:${dong(n)} if (idempotencyKey)`);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "lyDoStopKhoaMoi") goiLyDo.push(hamBao(n));
    ts.forEachChild(n, tham);
  };
  tham(sf);

  it("★ không còn phép thử rỗng rời trên khoá (`!key`, `key === \"\"`, `key.length`, khoá làm điều kiện thật/giả)", () => {
    expect(viPham).toEqual([]);
  });
  it("★ lyDoStopKhoaMoi chỉ được gọi từ lyDoStopKhoaMoiCho (\"không khoá\" = laKhoaRong); bước 2 và giữ chỗ đều gọi lyDoStopKhoaMoiCho", () => {
    expect(goiLyDo).toEqual(["lyDoStopKhoaMoiCho"]);
    expect(nguon.match(/lyDoStopKhoaMoiCho\(qd, kqPhatLai, input\.idempotencyKey\)/g)).toHaveLength(2);
  });
  it("★ quét không rỗng: bắt được mẫu cũ trên tệp ảo (đột biến chỗ dùng)", () => {
    const ao = ts.createSourceFile("ao.ts", `function f(input){ const a = lyDoStopKhoaMoi(qd, kq, !input.idempotencyKey); const b = typeof s === "string" && s.idempotencyKey ? s.idempotencyKey : null; }`, ts.ScriptTarget.Latest, true);
    const truoc = viPham.length;
    tham(ao);
    expect(viPham.length - truoc).toBe(2);
    viPham.length = truoc;
  });
});
