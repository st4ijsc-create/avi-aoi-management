/**
 * ★ Đợt 10.3 (rà kiem-dinh Task 8 A) — DUYỆT NGOÀI kiểm ở CỬA DUY NHẤT tạo lượt (`taoRunTx`): mọi lượt (chạy ngay, lượt con ghim
 * phiên bản …) của phiên bản có node model ngoài phải đã duyệt + băm khớp; luồng toàn hệ thống bị chặn. CSDL `_test` thật.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { batDauRun, chayLuotDongBo, luuPhienBan, LoiLuong } from "./dongCo";
import { bamDinhNghia } from "../ai/ngoai/duyetNgoai";
import { __datBoKiemChuLuongChoTest } from "./boKiemPhamVi";
import "./nut/index";
import type { FlowDefinition } from "../../../shared/flow/model";

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const exec = async (q: ReturnType<typeof sql>) => hang(await ((await getDb()) as unknown as { execute(q: unknown): Promise<unknown> }).execute(q));
const TAG = `dn${Date.now().toString(36)}`;
let F = 0;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const luong = (id: string, nodes: ReturnType<typeof nut>[]) =>
  ({ id, name: id, version: 1, nodes, connections: nodes.slice(1).map((n, i) => ({ from: { node: nodes[i]!.id, port: "main" }, to: { node: n.id, port: "main" } })) }) as unknown as FlowDefinition;
const maLoi = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiLuong ? e.code : String(e);
  }
};
const duyet = async (flowId: string, version: number) => {
  const [v] = await exec(sql`SELECT definition FROM ai_flow_versions WHERE "flowId" = ${flowId} AND version = ${version}`);
  await exec(sql`UPDATE ai_flow_versions SET "ngoaiDuyetLuc" = now(), "ngoaiBamDuyet" = ${bamDinhNghia(v!.definition as never)} WHERE "flowId" = ${flowId} AND version = ${version}`);
};

beforeAll(async () => {
  F = Number((await exec(sql`INSERT INTO factories (code, name) VALUES (${TAG}, 'NM') RETURNING id`))[0]!.id);
});
afterAll(async () => {
  __datBoKiemChuLuongChoTest(null);
  await exec(sql`DELETE FROM ai_flow_runs WHERE "flowId" LIKE ${`${TAG}%`}`);
  await exec(sql`DELETE FROM ai_flows WHERE id LIKE ${`${TAG}%`}`);
  await exec(sql`DELETE FROM factories WHERE id = ${F}`);
});

describe("taoRunTx — duyệt ngoài cho MỌI lượt", () => {
  it("(1) chạy phiên bản chưa duyệt ⇒ NGOAI_CHUA_DUYET; duyệt ⇒ tạo được; (3) sửa băm duyệt ⇒ lại bị chặn; luồng không node ngoài ⇒ không cần duyệt", async () => {
    const { flowId, version } = await luuPhienBan(luong(`${TAG}-a`, [nut("t", "kich-hoat.thu-cong"), nut("ai", "ai.llm", { chonModel: "ngoai:anthropic:m", loiNhac: "x" })]), null, F);
    expect(await maLoi(batDauRun({ flowId, version }))).toBe("NGOAI_CHUA_DUYET");
    await duyet(flowId, version);
    expect(await maLoi(batDauRun({ flowId, version }))).toBeNull();
    await exec(sql`UPDATE ai_flow_versions SET "ngoaiBamDuyet" = ${"a".repeat(64)} WHERE "flowId" = ${flowId} AND version = ${version}`);
    expect(await maLoi(batDauRun({ flowId, version }))).toBe("NGOAI_CHUA_DUYET");
    const sach = await luuPhienBan(luong(`${TAG}-s`, [nut("t", "kich-hoat.thu-cong"), nut("ai", "ai.llm", { loiNhac: "x" })]), null, F);
    expect(await maLoi(batDauRun(sach))).toBeNull();
  });

  it("luồng TOÀN HỆ THỐNG có node ngoài ⇒ bị chặn kể cả đã 'duyệt'", async () => {
    const { flowId, version } = await luuPhienBan(luong(`${TAG}-g`, [nut("t", "kich-hoat.thu-cong"), nut("ai", "ai.llm", { chonModel: "ngoai:anthropic:m", loiNhac: "x" })]), null, null);
    await duyet(flowId, version);
    expect(await maLoi(batDauRun({ flowId, version }))).toBe("NGOAI_CHUA_DUYET");
  });

  it("(2) cha SẠCH gọi luồng CON ghim phiên bản có node ngoài CHƯA duyệt ⇒ lượt con không tạo được, lượt cha kết thúc lỗi", async () => {
    const con = await luuPhienBan(luong(`${TAG}-con`, [nut("t", "kich-hoat.thu-cong"), nut("ai", "ai.llm", { chonModel: "ngoai:anthropic:m", loiNhac: "x" })]), null, F);
    const cha = await luuPhienBan(luong(`${TAG}-cha`, [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: con.flowId, version: con.version })]), null, F);
    // con BẬT (không có kill switch che mất phép thử) — chỉ thiếu DUYỆT NGOÀI
    await exec(sql`UPDATE ai_flows SET enabled = true, "activeVersion" = ${con.version} WHERE id = ${con.flowId}`);
    // phạm vi chủ lượt cho qua — lưới này kiểm DUYỆT NGOÀI, không phải phạm vi
    __datBoKiemChuLuongChoTest(async () => ({ may: async () => true, biMat: async () => true, luong: async () => true }));
    const runId = await batDauRun(cha);
    const kq = await chayLuotDongBo(runId, 30_000);
    expect(kq.status).not.toBe("xong");
    const loi = await exec(sql`SELECT r.error AS e FROM ai_flow_runs r WHERE r.id = ${runId} UNION ALL SELECT s.error FROM ai_flow_steps s WHERE s."runId" = ${runId}`);
    expect(JSON.stringify(loi)).toContain("NGOAI_CHUA_DUYET");
    expect((await exec(sql`SELECT count(*)::int AS n FROM ai_flow_runs WHERE "parentRunId" = ${runId}`))[0]!.n).toBe(0);
  });
});
