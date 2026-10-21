/**
 * ★★★ H2 (audit bảo mật 2026-10-21) — `flow.duyet` thi hành `vaiTroDuyet` + TÁCH người duyệt khỏi người bật / chủ lượt, trên CSDL
 * `_test` qua router thật. Kịch bản audit nguyên văn: operator duyệt bước "trưởng ca duyệt"; tác giả tự duyệt lượt của mình.
 * Sai ⇒ FORBIDDEN + dòng kiểm toán FLOW_DUYET_TU_CHOI, hàng chờ GIỮ NGUYÊN.
 *
 * Nền (Đợt 9, phạm vi nhà máy): luồng gắn nhà máy của người tạo ⇒ MỌI người trong test là người dùng RIÊNG được gán cùng một nhà máy
 * riêng của test (admin tạo luồng ⇒ nhà máy NULL ⇒ người thường không thấy). "Người bật" = `ai_flow_versions.approvedBy`,
 * "chủ lượt" = `ai_flow_runs.chuLuong` (chạy tay = người bấm; lịch/webhook/MCP = người bật; luồng con kế thừa lượt cha).
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
const MA_NM = `${TT}F`;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
const noi = (a: string, pa: string, b: string) => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const duyetDef = (id: string, vaiTroDuyet?: string) => ({
  id: `${TT}-${id}`,
  name: id,
  version: 1,
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "nguoi.duyet", { tieuDe: "Duyệt", ...(vaiTroDuyet ? { vaiTroDuyet } : {}) }), nut("ok", "du-lieu.dat", { truong: { kq: "ok" } })],
  connections: [noi("t", "main", "d"), noi("d", "dong-y", "ok")],
});

const db = async () => (await getDb())!;
let fid = 0;
const nguoiDaTao = new Map<string, number>();
/** Người dùng RIÊNG (vai cho trước) được gán nhà máy của test; cùng khoá ⇒ cùng người. */
async function nguoi(role: string, ten: string): Promise<{ role: string; id: number }> {
  const khoa = `${role}#${ten}`;
  let id = nguoiDaTao.get(khoa);
  if (id === undefined) {
    const d = await db();
    const hau = `${khoa}-${Date.now().toString(36)}`.replace(/[^a-z0-9-]/gi, "");
    const [r] = (await d.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
      VALUES (${TT + "-" + hau}, ${TT + "_" + hau}, ${"H2 " + khoa}, ${"password"}, ${role}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
    id = r.id;
    await d.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${id}, ${MA_NM})`);
    nguoiDaTao.set(khoa, id);
  }
  return { role, id };
}
const as = (n: { role: string; id: number }) => flowRouter.createCaller({ user: { id: n.id, role: n.role } } as never);

beforeAll(async () => {
  const d = await db();
  const [f] = (await d.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${MA_NM}, ${"H2 " + MA_NM}, true) RETURNING id`)) as unknown as { id: number }[];
  fid = f.id;
});
afterAll(async () => {
  const d = await getDb();
  if (!d) return;
  const runs = await d.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await d.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await d.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  const ids = [...nguoiDaTao.values()];
  if (ids.length) {
    await d.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql.raw(`(${ids.join(",")})`)}`);
    await d.execute(sql`DELETE FROM users WHERE id IN ${sql.raw(`(${ids.join(",")})`)}`).catch(() => undefined); // hàng kiểm toán WORM có thể giữ khoá ngoại
  }
  await d.execute(sql`DELETE FROM factories WHERE id = ${fid}`).catch(() => undefined);
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
  const r = await as(bat).luu({ definition: def });
  await as(bat).datPhienBanHoatDong({ flowId: def.id, version: r.version, bat: true });
  const { runId } = await as(chay).chayTay({ flowId: def.id });
  await chayHet();
  expect(await conCho(runId)).toBe(1);
  return { runId, flowId: def.id, version: r.version };
}

describe("H2 — vai duyệt (vaiTroDuyet được THI HÀNH)", () => {
  it("★ KỊCH BẢN AUDIT: bước yêu cầu supervisor — operator / maintenance / quality_inspector / engineer bị FORBIDDEN (kiểm toán, hàng chờ giữ), supervisor người khác duyệt được", async () => {
    const A = await nguoi("supervisor", "A");
    const B = await nguoi("engineer", "B");
    const { runId } = await dungLuotCho(duyetDef("vai"), A, B);
    for (const role of ["operator", "maintenance", "quality_inspector", "engineer"]) {
      await expect(as(await nguoi(role, "duyet")).duyet({ runId, nodeId: "d", dongY: true }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await conCho(runId)).toBe(1); // trước bản vá: operator duyệt xong ngay
    expect((await kiemToan(runId)).map((k) => k.details.ma)).toEqual(["VAI_THAP", "VAI_THAP", "VAI_THAP", "VAI_THAP"]);
    expect(await as(await nguoi("supervisor", "C")).duyet({ runId, nodeId: "d", dongY: true })).toEqual({ ok: true, cong: "dong-y" });
  });

  it("admin (người khác) duyệt được mọi bước, kể cả vai yêu cầu lạ; bước yêu cầu operator thì engineer duyệt được", async () => {
    const A = await nguoi("supervisor", "A");
    const B = await nguoi("engineer", "B");
    const la = await dungLuotCho(duyetDef("la", "ke-toan-truong"), A, B);
    await expect(as(await nguoi("supervisor", "C")).duyet({ runId: la.runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [adm] = (await (await db()).execute(sql`SELECT id FROM users WHERE role = 'admin' AND "isActive" ORDER BY id LIMIT 1`)) as unknown as { id: number }[];
    expect(await as({ role: "admin", id: adm.id }).duyet({ runId: la.runId, nodeId: "d", dongY: true })).toMatchObject({ ok: true });
    const thap = await dungLuotCho(duyetDef("thap", "operator"), A, B);
    expect(await as(await nguoi("engineer", "C")).duyet({ runId: thap.runId, nodeId: "d", dongY: false })).toMatchObject({ ok: true, cong: "tu-choi" });
  });
});

describe("H2 — TÁCH người duyệt khỏi người bật / chủ lượt", () => {
  it("★ tác giả/người bật KHÔNG tự duyệt; chủ lượt (người chạy tay) KHÔNG tự duyệt; người thứ ba đúng vai duyệt được", async () => {
    const A = await nguoi("supervisor", "A");
    const B = await nguoi("supervisor", "B2"); // đủ vai nhưng là chủ lượt
    const { runId } = await dungLuotCho(duyetDef("tach"), A, B);
    await expect(as(A).duyet({ runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/BẬT phiên bản/) });
    await expect(as(B).duyet({ runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/chủ lượt/) });
    expect((await kiemToan(runId)).map((k) => k.details.ma)).toEqual(["TRUNG_NGUOI_BAT", "TRUNG_NGUOI_CHAY"]);
    expect(await conCho(runId)).toBe(1);
    expect(await as(await nguoi("supervisor", "C")).duyet({ runId, nodeId: "d", dongY: true })).toMatchObject({ ok: true });
  });

  it("lượt không có chủ lượt (chuLuong NULL — tạo thẳng): chỉ ràng buộc khác người bật", async () => {
    const A = await nguoi("supervisor", "A");
    const def = duyetDef("lich");
    const r = await as(A).luu({ definition: def });
    await as(A).datPhienBanHoatDong({ flowId: def.id, version: r.version, bat: true });
    const runId = await batDauRun({ flowId: def.id, version: r.version, triggerKind: "lich" }); // không chuLuong ⇒ NULL
    await chayHet();
    await expect(as(A).duyet({ runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await as(await nguoi("supervisor", "B2")).duyet({ runId, nodeId: "d", dongY: true })).toMatchObject({ ok: true });
  });

  it("luồng CON: chủ lượt GỐC, người bật luồng cha và người bật luồng con đều KHÔNG duyệt được bước chờ nằm trong luồng con", async () => {
    const A = await nguoi("supervisor", "A");
    const B = await nguoi("engineer", "B");
    const C = await nguoi("supervisor", "C");
    const D = await nguoi("supervisor", "D");
    const con = duyetDef("con");
    const rc = await as(C).luu({ definition: con });
    await as(C).datPhienBanHoatDong({ flowId: con.id, version: rc.version, bat: true }); // C bật luồng con
    const cha = { id: `${TT}-cha`, name: "cha", version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: con.id })], connections: [noi("t", "main", "g")] };
    const rcha = await as(A).luu({ definition: cha });
    await as(A).datPhienBanHoatDong({ flowId: cha.id, version: rcha.version, bat: true }); // A bật luồng cha
    const { runId } = await as(B).chayTay({ flowId: cha.id }); // B chạy tay lượt gốc
    await chayHet();
    const [conRun] = (await (await db()).select().from(aiFlowRuns).where(eq(aiFlowRuns.flowId, con.id))).filter((x) => x.parentRunId === runId);
    expect(conRun).toBeTruthy();
    const duyetTheo = async (n: { role: string; id: number }) => as({ role: "supervisor", id: n.id }).duyet({ runId: conRun.id, nodeId: "d", dongY: true });
    for (const n of [A, B, C]) await expect(duyetTheo(n), `người ${n.id}`).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await duyetTheo(D)).toMatchObject({ ok: true });
  });

  it("dữ liệu CŨ chưa ghi người bật/chủ lượt (NULL) ⇒ chỉ áp luật vai — không khoá hàng chờ có trước bản vá", async () => {
    const A = await nguoi("supervisor", "A");
    const B = await nguoi("engineer", "B");
    const { runId, flowId, version } = await dungLuotCho(duyetDef("cu"), A, B);
    await (await db()).execute(sql`UPDATE ai_flow_versions SET "approvedBy" = NULL WHERE "flowId" = ${flowId} AND version = ${version}`);
    await (await db()).execute(sql`UPDATE ai_flow_runs SET "chuLuong" = NULL WHERE id = ${runId}`);
    expect(await as(A).duyet({ runId, nodeId: "d", dongY: true })).toMatchObject({ ok: true });
  });
});
