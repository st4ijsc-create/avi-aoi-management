/**
 * ★ Đợt 10.3 Task 8 — cấu hình / danh mục / host nội bộ / xem nội dung / DUYỆT NGOÀI (caller tRPC thật, CSDL `_test` thật).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ cho: null as number[] | null }));
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
  process.env.SECRET_ENCRYPTION_KEY ??= "khoa-thu-cau-hinh-duyet-0123456789";
});
vi.mock("../../flow/phamViLuong", async (goc) => {
  const that = await goc<typeof import("../../flow/phamViLuong")>();
  return { ...that, nhaMayChoPhep: vi.fn(async (pv: never) => (h.cho !== null ? h.cho : that.nhaMayChoPhep(pv))) };
});

import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiNgoaiRouter } from "../../../routers/aiNgoaiRouter";
import { luuPhienBan } from "../../flow/dongCo";
import { createLocalUser } from "../../../db/auth";
import { bamDinhNghia, coNodeNgoai, kiemDuyetNgoaiTruocKhiBat } from "./duyetNgoai";
import { layModelDaBat } from "./cauHinhNgoai";
import type { FlowDefinition } from "../../../../shared/flow/model";

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const exec = async (q: ReturnType<typeof sql>) => hang(await ((await getDb()) as unknown as { execute(q: unknown): Promise<unknown> }).execute(q));
const TAG = `cd${Date.now().toString(36)}`;
let A = 0;
let B = 0;
let uid = 0;
const admin = () => ({ user: { id: uid, role: "admin", name: "cau-hinh" } }) as never;
const maLoi = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string; ma?: string }).code ?? (e as { ma?: string }).ma ?? String(e);
  }
};
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, position: [number, number] = [0, 0]) => ({ id, type, typeVersion: 1, name: id, position, parameters });
const luong = (id: string, nodes: ReturnType<typeof nut>[]) =>
  ({ id, name: id, version: 1, nodes, connections: nodes.slice(1).map((n) => ({ from: { node: nodes[0]!.id, port: "main" }, to: { node: n.id, port: "main" } })) }) as unknown as FlowDefinition;

beforeAll(async () => {
  [A, B] = await Promise.all(["a", "b"].map(async (x) => Number((await exec(sql`INSERT INTO factories (code, name) VALUES (${`${TAG}${x}`}, ${"NM"}) RETURNING id`))[0]!.id)));
  const bcrypt = await import("bcryptjs");
  uid = (await createLocalUser({ username: `${TAG}-u`, passwordHash: await bcrypt.hash("Mk-cau-hinh!1", 10), name: "ch", role: "admin" })).id;
});
afterAll(async () => {
  for (const f of [A, B].filter(Boolean)) {
    await exec(sql`DELETE FROM ai_ngoai_model WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_ngoai_nha_may WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_ngoai_host_noi_bo WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_api_keys WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_flows WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM factories WHERE id = ${f}`);
  }
  if (uid) {
    await exec(sql`DELETE FROM user_secrets WHERE "userId" = ${uid}`);
    await exec(sql`DELETE FROM users WHERE id = ${uid}`);
  }
});

describe("băm định nghĩa + kiểm trước khi bật (đơn vị)", () => {
  const goc = luong("f", [nut("t", "kich-hoat.thu-cong"), nut("ai", "ai.llm", { chonModel: "ngoai:anthropic:m", loiNhac: "x" }, [10, 20])]);
  it("kéo node (position) không đổi băm; thêm nhánh ot.doc-tag ⇒ băm đổi; không node ngoài ⇒ không cần duyệt", () => {
    const keo = luong("f", [nut("t", "kich-hoat.thu-cong"), nut("ai", "ai.llm", { chonModel: "ngoai:anthropic:m", loiNhac: "x" }, [99, 99])]);
    const them = luong("f", [nut("t", "kich-hoat.thu-cong"), nut("ai", "ai.llm", { chonModel: "ngoai:anthropic:m", loiNhac: "x" }), nut("ot", "ot.doc-tag", { may: 1 })]);
    expect(bamDinhNghia(keo)).toBe(bamDinhNghia(goc));
    expect(bamDinhNghia(them)).not.toBe(bamDinhNghia(goc));
    expect(coNodeNgoai(goc)).toBe(true);
    expect(coNodeNgoai(luong("g", [nut("t", "kich-hoat.thu-cong")]))).toBe(false);
    expect(() => kiemDuyetNgoaiTruocKhiBat({ definition: luong("g", [nut("t", "kich-hoat.thu-cong")]), ngoaiDuyetLuc: null, ngoaiBamDuyet: null }, null)).not.toThrow();
  });
  it("chưa duyệt / băm lệch ⇒ NGOAI_CHUA_DUYET; luồng toàn hệ thống ⇒ NGOAI_LUONG_TOAN_CUC; duyệt + băm khớp ⇒ qua", () => {
    const ma = (f: () => void) => {
      try {
        f();
        return null;
      } catch (e) {
        return (e as { ma?: string }).ma;
      }
    };
    expect(ma(() => kiemDuyetNgoaiTruocKhiBat({ definition: goc, ngoaiDuyetLuc: null, ngoaiBamDuyet: null }, A))).toBe("NGOAI_CHUA_DUYET");
    expect(ma(() => kiemDuyetNgoaiTruocKhiBat({ definition: goc, ngoaiDuyetLuc: new Date(), ngoaiBamDuyet: "0".repeat(64) }, A))).toBe("NGOAI_CHUA_DUYET");
    expect(ma(() => kiemDuyetNgoaiTruocKhiBat({ definition: goc, ngoaiDuyetLuc: new Date(), ngoaiBamDuyet: bamDinhNghia(goc) }, null))).toBe("NGOAI_LUONG_TOAN_CUC");
    expect(ma(() => kiemDuyetNgoaiTruocKhiBat({ definition: goc, ngoaiDuyetLuc: new Date(), ngoaiBamDuyet: bamDinhNghia(goc) }, A))).toBeNull();
  });
});

describe("cấu hình / danh mục / host (tRPC + CSDL)", () => {
  it("ghiCauHinh: audit cũ/mới; layModelDaBat theo cờ env + nhà máy + model", async () => {
    const goi = aiNgoaiRouter.createCaller(admin());
    const cfg = { factoryId: A, batNgoai: true, choDuLieuVanHanh: false, luuNguyenVan: false, hanGiuNgay: 30, tranTokenNgay: 1000, tranTienNgayUsd: null, tranTokenNguoiNgay: null, tranTokenLuongNgay: null, tranTokenLuot: null, tranLanPhut: 20 };
    await goi.ghiCauHinh(cfg);
    await goi.ghiCauHinh({ ...cfg, tranTokenNgay: 2000 });
    const [a] = await exec(sql`SELECT details FROM audit_logs WHERE "entityType" = 'ai_ngoai_cau_hinh' AND "entityId" = ${A} ORDER BY id DESC LIMIT 1`);
    const d = JSON.parse(String(a!.details));
    expect(d.before.tranTokenNgay).toBe(1000);
    expect(d.after.tranTokenNgay).toBe(2000);

    const k = await goi.taoKhoa({ factoryId: A, nhaCungCap: "anthropic", ten: `${TAG}-k`, khoa: "sk-ant-api03-" + "M".repeat(95) });
    await goi.datModel({ factoryId: A, nhaCungCap: "anthropic", model: "claude-thu", nhan: "C", keyId: k.id, giaVaoUsdTrieu: null, giaRaUsdTrieu: null, tranTokenLuot: 5000, batModel: true });
    const db = (await getDb()) as never;
    expect(await layModelDaBat(db, A, {})).toEqual([]);
    expect(await layModelDaBat(db, A, { AI_NGOAI_ENABLED: "true" })).toEqual([{ nhaCungCap: "anthropic", model: "claude-thu", nhan: "C" }]);
    expect(await layModelDaBat(db, B, { AI_NGOAI_ENABLED: "true" })).toEqual([]);
    expect(await layModelDaBat(db, null, { AI_NGOAI_ENABLED: "true" })).toEqual([]);
  });

  it("datModel: khoá khác nhà cung cấp / khác nhà máy ⇒ BAD_REQUEST; không giá + không trần lượt ⇒ BAD_REQUEST", async () => {
    const goi = aiNgoaiRouter.createCaller(admin());
    const k = await goi.taoKhoa({ factoryId: A, nhaCungCap: "openai", ten: `${TAG}-o`, khoa: "sk-proj-" + "N".repeat(48) });
    const kB = await goi.taoKhoa({ factoryId: B, nhaCungCap: "anthropic", ten: `${TAG}-b`, khoa: "sk-ant-api03-" + "N".repeat(95) });
    const m = { factoryId: A, nhaCungCap: "anthropic" as const, model: "x", nhan: "X", giaVaoUsdTrieu: 1, giaRaUsdTrieu: 1, tranTokenLuot: null, batModel: true };
    expect(await maLoi(goi.datModel({ ...m, keyId: k.id }))).toBe("BAD_REQUEST");
    expect(await maLoi(goi.datModel({ ...m, keyId: kB.id }))).toBe("BAD_REQUEST");
    expect(await maLoi(goi.datModel({ ...m, nhaCungCap: "openai", keyId: k.id, giaVaoUsdTrieu: null }))).toBe("BAD_REQUEST");
  });

  it("host nội bộ: admin KHÔNG toàn hệ ⇒ FORBIDDEN; toàn hệ ⇒ được + audit", async () => {
    h.cho = [A];
    try {
      expect(await maLoi(aiNgoaiRouter.createCaller(admin()).datHostNoiBo({ factoryId: A, hostCong: "llm.local:8000" }))).toBe("FORBIDDEN");
    } finally {
      h.cho = null;
    }
    await aiNgoaiRouter.createCaller(admin()).datHostNoiBo({ factoryId: A, hostCong: "LLM.local:8000" });
    expect(await exec(sql`SELECT "hostCong" FROM ai_ngoai_host_noi_bo WHERE "factoryId" = ${A}`)).toEqual([{ hostCong: "llm.local:8000" }]);
    expect((await exec(sql`SELECT count(*)::int AS n FROM audit_logs WHERE "entityType" = 'ai_ngoai_host_noi_bo' AND "entityId" = ${A}`))[0]!.n).toBe(1);
  });

  it("xemNoiDung: ngoài phạm vi ⇒ NOT_FOUND; hợp lệ ⇒ trả nội dung ĐÃ che + audit mỗi lần xem", async () => {
    const [y] = await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "tuDong", "nhaCungCap", model, "bamNoiDung") VALUES (${A}, 'y-dinh', false, 'anthropic', 'm', ${"e".repeat(64)}) RETURNING id`);
    await exec(sql`INSERT INTO ai_external_call_noi_dung ("callId", "factoryId", "noiDungDaChe", "hetHanLuc") VALUES (${y!.id}, ${A}, 'da che', now() + interval '1 day')`);
    h.cho = [B];
    try {
      expect(await maLoi(aiNgoaiRouter.createCaller(admin()).xemNoiDung({ callId: Number(y!.id) }))).toBe("NOT_FOUND");
    } finally {
      h.cho = null;
    }
    const kq = await aiNgoaiRouter.createCaller(admin()).xemNoiDung({ callId: Number(y!.id) });
    expect(kq.noiDungDaChe).toBe("da che");
    expect((await exec(sql`SELECT count(*)::int AS n FROM audit_logs WHERE "entityType" = 'ai_external_call_noi_dung' AND "entityId" = ${Number(y!.id)}`))[0]!.n).toBe(1);
    await exec(sql`DELETE FROM ai_external_call_noi_dung WHERE "callId" = ${y!.id}`);
  });
});

describe("duyệt ngoài (tRPC + CSDL)", () => {
  it("phiên bản có node ngoài đánh dấu coNodeNgoai lúc lưu; tự duyệt luồng kỹ thuật ⇒ ngoaiTuDuyet + audit mức cao; tự duyệt luồng có số liệu ⇒ FORBIDDEN", async () => {
    const kyThuat = luong(`${TAG}-kt`, [nut("t", "kich-hoat.thu-cong"), nut("ai", "ai.llm", { chonModel: "ngoai:anthropic:claude-thu", loiNhac: "x" })]);
    const vanHanh = luong(`${TAG}-vh`, [nut("t", "kich-hoat.thu-cong"), nut("sl", "du-lieu.so-lieu", { truyVan: "oee" }), nut("ai", "ai.llm", { chonModel: "ngoai:anthropic:claude-thu", loiNhac: "x" })]);
    const a = await luuPhienBan(kyThuat, uid, A);
    const b = await luuPhienBan(vanHanh, uid, A);
    const [v] = await exec(sql`SELECT "coNodeNgoai" FROM ai_flow_versions WHERE "flowId" = ${a.flowId} AND version = ${a.version}`);
    expect(v!.coNodeNgoai).toBe(true);
    const kq = await aiNgoaiRouter.createCaller(admin()).duyetNgoai({ flowId: a.flowId, version: a.version });
    expect(kq.tuDuyet).toBe(true);
    const [d] = await exec(sql`SELECT "ngoaiTuDuyet", "ngoaiBamDuyet" FROM ai_flow_versions WHERE "flowId" = ${a.flowId} AND version = ${a.version}`);
    expect(d).toEqual({ ngoaiTuDuyet: true, ngoaiBamDuyet: bamDinhNghia({ ...kyThuat, version: a.version } as FlowDefinition) });
    const [au] = await exec(sql`SELECT details FROM audit_logs WHERE "entityType" = 'ai_flow_duyet_ngoai' AND "entityName" = ${`${a.flowId}@${a.version}`}`);
    expect(JSON.parse(String(au!.details)).metadata.muc).toBe("cao");
    expect(await maLoi(aiNgoaiRouter.createCaller(admin()).duyetNgoai({ flowId: b.flowId, version: b.version }))).toBe("FORBIDDEN");
  });
});
