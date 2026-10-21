/**
 * ★★★ H2 (audit bảo mật 2026-10-21) — `flow.duyet` thi hành `vaiTroDuyet` + TÁCH người duyệt khỏi người bật / người chạy tay, trên
 * CSDL `_test` qua router thật. Kịch bản audit nguyên văn: operator duyệt bước "trưởng ca duyệt"; tác giả tự duyệt lượt của mình.
 * Sai ⇒ FORBIDDEN + dòng kiểm toán FLOW_DUYET_TU_CHOI, hàng chờ GIỮ NGUYÊN.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlows } from "../../../drizzle/schema";
import { flowRouter } from "../../routers/flowRouter";
import { batDauRun, chayMotMuc } from "./dongCo";

const TT = "h2qd";
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
const noi = (a: string, pa: string, b: string) => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const duyetDef = (id: string, vaiTroDuyet?: string) => ({
  id: `${TT}-${id}`,
  name: id,
  version: 1,
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "nguoi.duyet", { tieuDe: "Duyệt", ...(vaiTroDuyet ? { vaiTroDuyet } : {}) }), nut("ok", "du-lieu.dat", { truong: { kq: "ok" } })],
  connections: [noi("t", "main", "d"), noi("d", "dong-y", "ok")],
});

let A = 0; // tác giả / người bật
let B = 0; // người chạy tay
let C = 0; // người duyệt hợp lệ
let D = 0; // người thứ tư
const as = (role: string, id: number) => flowRouter.createCaller({ user: { id, role } } as never);
const db = async () => (await getDb())!;

beforeAll(async () => {
  const us = (await (await db()).execute(sql`SELECT id FROM users ORDER BY id LIMIT 4`)) as unknown as { id: number }[];
  [A, B, C, D] = [us[0].id, us[1].id, us[2].id, us[3].id];
});
afterAll(async () => {
  const d = await getDb();
  if (!d) return;
  const runs = await d.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await d.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await d.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});
async function chayHet() {
  for (let i = 0; i < 200 && (await chayMotMuc("w-h2", undefined, TT)); i++);
}
const conCho = async (runId: string) =>
  ((await (await db()).execute(sql`SELECT 1 AS c FROM ai_flow_waits WHERE "runId" = ${runId} AND kind = 'duyet'`)) as unknown as unknown[]).length;
const kiemToan = async (runId: string) => {
  const rows = (await (await db()).execute(sql`SELECT details FROM audit_logs WHERE action = 'FLOW_DUYET_TU_CHOI' AND "entityName" = ${runId} ORDER BY id`)) as unknown as { details: unknown }[];
  // `details` lưu dạng chuỗi JSON (serializeAuditDetails) hoặc jsonb tuỳ cột — chuẩn hoá.
  return rows.map((r) => ({ details: (typeof r.details === "string" ? JSON.parse(r.details) : r.details) as { ma: string; vaiNguoiDuyet: string } }));
};
/** Lưu + bật bằng `bat`, chạy tay bằng `chay` ⇒ lượt chờ duyệt. */
async function dungLuotCho(def: ReturnType<typeof duyetDef>, bat: { role: string; id: number }, chay: { role: string; id: number }) {
  const r = await as(bat.role, bat.id).luu({ definition: def });
  await as(bat.role, bat.id).datPhienBanHoatDong({ flowId: def.id, version: r.version, bat: true });
  const { runId } = await as(chay.role, chay.id).chayTay({ flowId: def.id });
  await chayHet();
  expect(await conCho(runId)).toBe(1);
  return { runId, flowId: def.id, version: r.version };
}

describe("H2 — vai duyệt (vaiTroDuyet được THI HÀNH)", () => {
  it("★ KỊCH BẢN AUDIT: bước yêu cầu supervisor — operator / maintenance / quality_inspector / engineer bị FORBIDDEN (kiểm toán, hàng chờ giữ), supervisor người khác duyệt được", async () => {
    const { runId } = await dungLuotCho(duyetDef("vai"), { role: "supervisor", id: A }, { role: "engineer", id: B });
    for (const role of ["operator", "maintenance", "quality_inspector", "engineer"]) {
      await expect(as(role, C).duyet({ runId, nodeId: "d", dongY: true }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await conCho(runId)).toBe(1); // trước bản vá: operator duyệt xong ngay
    expect((await kiemToan(runId)).map((k) => k.details.ma)).toEqual(["VAI_THAP", "VAI_THAP", "VAI_THAP", "VAI_THAP"]);
    expect(await as("supervisor", C).duyet({ runId, nodeId: "d", dongY: true })).toEqual({ ok: true, cong: "dong-y" });
  });

  it("admin (người khác) duyệt được mọi bước, kể cả vai yêu cầu lạ; bước yêu cầu operator thì engineer duyệt được", async () => {
    const la = await dungLuotCho(duyetDef("la", "ke-toan-truong"), { role: "supervisor", id: A }, { role: "engineer", id: B });
    await expect(as("supervisor", C).duyet({ runId: la.runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await as("admin", C).duyet({ runId: la.runId, nodeId: "d", dongY: true })).toMatchObject({ ok: true });
    const thap = await dungLuotCho(duyetDef("thap", "operator"), { role: "supervisor", id: A }, { role: "engineer", id: B });
    expect(await as("engineer", C).duyet({ runId: thap.runId, nodeId: "d", dongY: false })).toMatchObject({ ok: true, cong: "tu-choi" });
  });
});

describe("H2 — TÁCH người duyệt khỏi người bật / người chạy tay", () => {
  it("★ tác giả/người bật KHÔNG tự duyệt; người chạy tay KHÔNG tự duyệt; người thứ ba đúng vai duyệt được; admin cũng không được miễn", async () => {
    const { runId } = await dungLuotCho(duyetDef("tach"), { role: "supervisor", id: A }, { role: "engineer", id: B });
    await expect(as("supervisor", A).duyet({ runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/BẬT phiên bản/) });
    await expect(as("admin", A).duyet({ runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("supervisor", B).duyet({ runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/kích hoạt lượt/) });
    expect((await kiemToan(runId)).map((k) => k.details.ma)).toEqual(["TRUNG_NGUOI_BAT", "TRUNG_NGUOI_BAT", "TRUNG_NGUOI_CHAY"]);
    expect(await conCho(runId)).toBe(1);
    expect(await as("supervisor", C).duyet({ runId, nodeId: "d", dongY: true })).toMatchObject({ ok: true });
  });

  it("lượt từ lịch/webhook/MCP (startedBy NULL): chỉ ràng buộc khác người bật", async () => {
    const def = duyetDef("lich");
    const r = await as("supervisor", A).luu({ definition: def });
    await as("supervisor", A).datPhienBanHoatDong({ flowId: def.id, version: r.version, bat: true });
    const runId = await batDauRun({ flowId: def.id, version: r.version, triggerKind: "lich" }); // không qua chayTay ⇒ startedBy NULL
    await chayHet();
    await expect(as("supervisor", A).duyet({ runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await as("supervisor", B).duyet({ runId, nodeId: "d", dongY: true })).toMatchObject({ ok: true });
  });

  it("luồng CON: người chạy tay lượt GỐC, người bật luồng cha và người bật luồng con đều KHÔNG duyệt được bước chờ nằm trong luồng con", async () => {
    const con = duyetDef("con");
    const rc = await as("supervisor", C).luu({ definition: con });
    await as("supervisor", C).datPhienBanHoatDong({ flowId: con.id, version: rc.version, bat: true }); // C bật luồng con
    const cha = { id: `${TT}-cha`, name: "cha", version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: con.id })], connections: [noi("t", "main", "g")] };
    const rcha = await as("supervisor", A).luu({ definition: cha });
    await as("supervisor", A).datPhienBanHoatDong({ flowId: cha.id, version: rcha.version, bat: true }); // A bật luồng cha
    const { runId } = await as("engineer", B).chayTay({ flowId: cha.id }); // B chạy tay lượt gốc
    await chayHet();
    const [conRun] = (await (await db()).select().from(aiFlowRuns).where(eq(aiFlowRuns.flowId, con.id))).filter((x) => x.parentRunId === runId);
    expect(conRun).toBeTruthy();
    for (const nguoi of [A, B, C]) {
      await expect(as("supervisor", nguoi).duyet({ runId: conRun.id, nodeId: "d", dongY: true }), `người ${nguoi}`).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await as("supervisor", D).duyet({ runId: conRun.id, nodeId: "d", dongY: true })).toMatchObject({ ok: true });
  });

  it("dữ liệu CŨ chưa ghi người bật/người chạy (NULL) ⇒ chỉ áp luật vai — không khoá hàng chờ có trước bản vá", async () => {
    const { runId, flowId, version } = await dungLuotCho(duyetDef("cu"), { role: "supervisor", id: A }, { role: "engineer", id: B });
    await (await db()).execute(sql`UPDATE ai_flow_versions SET "enabledBy" = NULL WHERE "flowId" = ${flowId} AND version = ${version}`);
    await (await db()).execute(sql`UPDATE ai_flow_runs SET "startedBy" = NULL WHERE id = ${runId}`);
    expect(await as("supervisor", A).duyet({ runId, nodeId: "d", dongY: true })).toMatchObject({ ok: true });
  });
});
