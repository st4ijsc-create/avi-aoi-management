/**
 * ★ Đợt 10.3 (rà kiem-dinh Task 8) — cổng DUYỆT NGOÀI lúc BẬT qua router THẬT (`createCaller`, giấy phép tắt), CẢ hai thủ tục bật:
 * `datPhienBanHoatDong` (luồng thường) và `batLuongOt` (hạng ot). Mỗi thủ tục: chưa duyệt / băm duyệt lệch định nghĩa / luồng toàn
 * hệ thống ⇒ FORBIDDEN (lý do ổn định); đã duyệt + băm khớp ⇒ bật được. OTP giả như `flowRouterOt.db.test.ts`.
 */
import { vi } from "vitest";
import { donLuongTheoTienTo, donNhaMayVaNguoiTheoMa } from "../services/flow/__donDuLieuTest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
  process.env.AUDIT_ALL_MUTATIONS = "false";
});
vi.mock("../_core/totpOnce", async (orig) => ({
  ...(await orig<typeof import("../_core/totpOnce")>()),
  verifyTotpOnce: vi.fn(async ({ token }: { token: string }) => ({ hopLe: token === "135790", phatLai: false })),
}));
vi.mock("../db", async (orig) => ({
  ...(await orig<typeof import("../db")>()),
  get2FAStatus: vi.fn(async () => ({ twoFactorEnabled: true, twoFactorSecret: "GIA" })),
}));
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiFlowRuns, aiFlows } from "../../drizzle/schema";
import { readAppErrorMeta } from "../_core/appError";
import { bamDinhNghia } from "../services/ai/ngoai/duyetNgoai";
import { flowRouter } from "./flowRouter";
import { donNguoiDungTest, taoNguoiDungTest } from "../testing/nguoiDungTest";

const TT = "t103bn";
const MA_NM = `${TT}F`;
let uid = 0;
let fid = 0;
const goi = (role: string) => flowRouter.createCaller({ user: { id: uid, role, twoFactorEnabled: true }, sessionToken: `phien-${role}-${Math.random()}` } as never);
const exec = async (q: ReturnType<typeof sql>) => (await (await getDb())!.execute(q)) as unknown as Array<Record<string, unknown>>;
const lyDo = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const m = readAppErrorMeta(e) as { appParams?: { reason?: string } } | null;
    return `${(e as { code?: string }).code}:${m?.appParams?.reason ?? "?"}`;
  }
};
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
const noi = (a: string, pa: string, b: string) => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const AI_NGOAI = nut("ai", "ai.llm", { chonModel: "ngoai:anthropic:m", loiNhac: "tóm tắt" });
const luongThuong = (id: string) => ({ id: `${TT}-${id}`, name: id, version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), AI_NGOAI], connections: [noi("t", "main", "ai")] });
const luongOt = (id: string) => ({
  id: `${TT}-${id}`,
  name: id,
  version: 1,
  nodes: [nut("t", "kich-hoat.thu-cong"), AI_NGOAI, nut("d", "ot.de-xuat-lenh", { may: 7, lenh: "stop" })],
  connections: [noi("t", "main", "ai"), noi("ai", "main", "d")],
});
const duyet = async (flowId: string, version: number, bam?: string) => {
  const [v] = await exec(sql`SELECT definition FROM ai_flow_versions WHERE "flowId" = ${flowId} AND version = ${version}`);
  await exec(sql`UPDATE ai_flow_versions SET "ngoaiDuyetLuc" = now(), "ngoaiBamDuyet" = ${bam ?? bamDinhNghia(v!.definition as never)} WHERE "flowId" = ${flowId} AND version = ${version}`);
};

beforeAll(async () => {
  await donLuongTheoTienTo(TT);
  await donNhaMayVaNguoiTheoMa(MA_NM, TT + "-");
  const [fa] = await exec(sql`INSERT INTO factories (code, name, "isActive") VALUES (${MA_NM}, ${"T103 " + MA_NM}, true) RETURNING id`);
  fid = Number(fa!.id);
  // census nguoiDungTest: người dùng test qua helper (tự dọn theo daTao), không INSERT INTO users trực tiếp — dieu-phoi 2026-10-26 lúc gộp.
  const u = await taoNguoiDungTest("bat", "admin", { tienTo: TT, ten: "người bật", extra: { loginMethod: "password", isActive: true, passwordChangedAt: new Date() } });
  uid = u.id;
  await exec(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid}, ${MA_NM})`);
});
afterAll(async () => {
  const db = (await getDb())!;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await exec(sql`DELETE FROM user_factory_assignments WHERE "userId" = ${uid} AND "factoryCode" = ${MA_NM}`);
  await exec(sql`DELETE FROM factories WHERE id = ${fid}`);
  await donNguoiDungTest();
});

describe("datPhienBanHoatDong — phiên bản có node model ngoài", () => {
  it("chưa duyệt ⇒ FORBIDDEN; băm duyệt lệch (định nghĩa bị sửa sau duyệt) ⇒ FORBIDDEN; duyệt + băm khớp ⇒ bật được", async () => {
    const d = luongThuong("thuong");
    const { version } = await goi("engineer").luu({ definition: d, factoryId: fid } as never);
    expect(await lyDo(goi("engineer").datPhienBanHoatDong({ flowId: d.id, version, bat: true }))).toBe("FORBIDDEN:NGOAI_CHUA_DUYET");
    await duyet(d.id, version, "b".repeat(64));
    expect(await lyDo(goi("engineer").datPhienBanHoatDong({ flowId: d.id, version, bat: true }))).toBe("FORBIDDEN:NGOAI_CHUA_DUYET");
    await duyet(d.id, version);
    // định nghĩa đổi SAU khi duyệt (ghi thẳng CSDL) ⇒ băm cũ không còn khớp
    await exec(sql`UPDATE ai_flow_versions SET definition = jsonb_set(definition, '{nodes,1,parameters,loiNhac}', '"lời khác"') WHERE "flowId" = ${d.id} AND version = ${version}`);
    expect(await lyDo(goi("engineer").datPhienBanHoatDong({ flowId: d.id, version, bat: true }))).toBe("FORBIDDEN:NGOAI_CHUA_DUYET");
    await duyet(d.id, version);
    expect(await lyDo(goi("engineer").datPhienBanHoatDong({ flowId: d.id, version, bat: true }))).toBeNull();
  });

  it("chayTay ('chạy ngay') phiên bản chưa duyệt / băm lệch ⇒ FORBIDDEN, không tạo lượt; đã duyệt ⇒ chạy được", async () => {
    const d = luongThuong("chay-ngay");
    const { version } = await goi("engineer").luu({ definition: d, factoryId: fid } as never);
    expect(await lyDo(goi("engineer").chayTay({ flowId: d.id, version }))).toBe("FORBIDDEN:NGOAI_CHUA_DUYET");
    await duyet(d.id, version, "d".repeat(64));
    expect(await lyDo(goi("engineer").chayTay({ flowId: d.id, version }))).toBe("FORBIDDEN:NGOAI_CHUA_DUYET");
    expect((await exec(sql`SELECT count(*)::int AS n FROM ai_flow_runs WHERE "flowId" = ${d.id}`))[0]!.n).toBe(0);
    await duyet(d.id, version);
    expect(await lyDo(goi("engineer").chayTay({ flowId: d.id, version }))).toBeNull();
  });

  it("luồng TOÀN HỆ THỐNG (factoryId NULL) có node ngoài ⇒ FORBIDDEN kể cả đã duyệt", async () => {
    const d = luongThuong("toan-he");
    const { version } = await goi("admin").luu({ definition: d } as never);
    expect((await exec(sql`SELECT "factoryId" FROM ai_flows WHERE id = ${d.id}`))[0]!.factoryId).toBeNull();
    await duyet(d.id, version);
    expect(await lyDo(goi("admin").datPhienBanHoatDong({ flowId: d.id, version, bat: true }))).toBe("FORBIDDEN:NGOAI_LUONG_TOAN_CUC");
  });
});

describe("batLuongOt — phiên bản hạng ot có node model ngoài", () => {
  it("chưa duyệt ⇒ FORBIDDEN; băm lệch ⇒ FORBIDDEN; duyệt + băm khớp ⇒ bật được", async () => {
    const d = luongOt("ot");
    const r = await goi("engineer").luu({ definition: d, factoryId: fid } as never);
    expect(r.hang).toBe("ot");
    const bat = () => goi("admin").batLuongOt({ flowId: d.id, version: r.version, totpCode: "135790" });
    expect(await lyDo(bat())).toBe("FORBIDDEN:NGOAI_CHUA_DUYET");
    await duyet(d.id, r.version, "c".repeat(64));
    expect(await lyDo(bat())).toBe("FORBIDDEN:NGOAI_CHUA_DUYET");
    await duyet(d.id, r.version);
    expect(await lyDo(bat())).toBeNull();
  });

  it("luồng ot TOÀN HỆ THỐNG có node ngoài ⇒ FORBIDDEN kể cả đã duyệt", async () => {
    const d = luongOt("ot-toan-he");
    const r = await goi("admin").luu({ definition: d } as never);
    await duyet(d.id, r.version);
    expect(await lyDo(goi("admin").batLuongOt({ flowId: d.id, version: r.version, totpCode: "135790" }))).toBe("FORBIDDEN:NGOAI_LUONG_TOAN_CUC");
  });
});

describe("★ Đợt 10.4 (D8) — flow.chiTiet.ngoai: đã duyệt chưa + ĐANG DUYỆT GÌ", () => {
  it("chưa duyệt ⇒ daDuyet false + danh sách node ngoài (tóm tắt lời nhắc ĐÃ CHE); duyệt ⇒ true + duyetLuc; không node ngoài ⇒ {coNodeNgoai:false}", async () => {
    const d = {
      ...luongThuong("chi-tiet"),
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("ai", "ai.llm", { chonModel: "ngoai:anthropic:claude-x", loiNhac: "kiểm tra mã; password=Hunter2xyz99 đừng lộ" })],
    };
    const { version } = await goi("engineer").luu({ definition: d, factoryId: fid } as never);
    const t1 = (await goi("engineer").chiTiet({ flowId: d.id, version })).ngoai;
    expect(t1).toMatchObject({ coNodeNgoai: true, daDuyet: false, tuDuyet: false, toanHeThong: false, taoBoi: uid, mucTinhLuong: "ky-thuat" });
    expect(t1.coNodeNgoai && t1.nodes).toEqual([{ nodeId: "ai", nhaCungCap: "anthropic", model: "claude-x", mucTinh: "ke-thua", tomTatLenh: expect.any(String), thamChieu: [] }]);
    expect(JSON.stringify(t1)).not.toContain("Hunter2xyz99");
    await duyet(d.id, version);
    const t2 = (await goi("engineer").chiTiet({ flowId: d.id, version })).ngoai;
    expect(t2).toMatchObject({ coNodeNgoai: true, daDuyet: true, duyetLuc: expect.any(String) });
    const s = { id: `${TT}-khong-ngoai`, name: "k", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] };
    const r = await goi("engineer").luu({ definition: s, factoryId: fid } as never);
    expect((await goi("engineer").chiTiet({ flowId: s.id, version: r.version })).ngoai).toEqual({ coNodeNgoai: false });
  });

  it("luồng toàn hệ thống ⇒ toanHeThong true, daDuyet false kể cả đã ghi duyệt", async () => {
    const d = luongThuong("chi-tiet-toan-he");
    const { version } = await goi("admin").luu({ definition: d } as never);
    await duyet(d.id, version);
    expect((await goi("admin").chiTiet({ flowId: d.id, version })).ngoai).toMatchObject({ coNodeNgoai: true, toanHeThong: true, daDuyet: false });
  });
});

describe("★ Đợt 10.4 (luong-ui báo lỗi) — node ai.kiem-dinh-ngoai đi HẾT vòng xuất → xem trước nhập → nhập", () => {
  it("chonModel ngoai ⇒ xuất bỏ chonModel + việc chon-model; nhapXemTruoc hợp lệ; nhap LƯU ĐƯỢC (không bị chặn bởi kiểm chonModel chung)", async () => {
    const d = {
      id: `${TT}-xuat-kd`, name: "xkd", version: 1,
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("kd", "ai.kiem-dinh-ngoai", { chonModel: "ngoai:anthropic:claude-x", cauHoi: "{{ $json.cauHoi }}", traLoi: "{{ $json.traLoi }}", truongRa: "kiemDinh" })],
      connections: [noi("t", "main", "kd")],
    };
    const { version } = await goi("engineer").luu({ definition: d, factoryId: fid } as never);
    const x = await goi("engineer").xuat({ flowId: d.id, version });
    expect(x.goi.luong.nodes.find((n) => n.id === "kd")!.parameters).not.toHaveProperty("chonModel");
    expect(x.viec).toContainEqual(expect.objectContaining({ nodeId: "kd", truong: "chonModel", viec: "chon-model" }));
    const xt = await goi("engineer").nhapXemTruoc({ goi: x.goi });
    expect(xt.hopLe).toBe(true);
    const n = await goi("engineer").nhap({ goi: x.goi, ten: `${TT}-nhap-kd`, factoryId: fid } as never);
    expect(n.viec).toContainEqual(expect.objectContaining({ nodeId: "kd", viec: "chon-model" }));
  });
});
