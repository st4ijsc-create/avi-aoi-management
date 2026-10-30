/**
 * ★ Đợt 10.3 Task 6 — CỔNG AI NGOÀI với nhà cung cấp GIẢ (không mạng) trên CSDL `_test` THẬT: nhà máy A/B thử, khoá mã hoá thật, cấu
 * hình / danh mục / sổ / bộ đếm thật. Khoá giả SINH lúc chạy.
 */
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SECRET_ENCRYPTION_KEY ??= "khoa-thu-cong-ngoai-0123456789";
});

import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { encryptSecret } from "../../security/secretBox";
import { goiAiNgoai, phuThuocMacDinh, type PhuThuocCong, type YeuCauGoiNgoai } from "./congNgoai";
import { LoiNgoai } from "./loi";
import { TU_DIEN_RONG } from "./cheDuLieu";
import { taoNhaCungCapGia, type KichBanGia, type NhaCungCapGia } from "./nhaCungCap/gia";
import { VECTOR_CHE, KHOA_GIA } from "./vectorChe";
import { bamDinhNghia } from "./duyetNgoai";
import { ghepPhan, type LoaiPhan } from "./ghepPhan";
import type { TinNhanNgoai } from "./nhaCungCap/kieu";

/** ★ 10.4b L0a — cổng chỉ nhận `tinNhan` do bộ dựng tạo: lưới dựng qua `ghepPhan` (mặc định loại ky-thuat — giữ ngữ nghĩa cũ `phanDaGhep: []`). */
const ghep = (ds: TinNhanNgoai[], loai: Exclude<LoaiPhan, "truy-hoi-kb" | "nguon-kiem-dinh"> = "cau-go-lap-trinh") =>
  ghepPhan(ds.map((m) => ({ vaiTro: m.vaiTro, phan: [{ loai, noiDung: m.noiDung }], ...(m.tenTool !== undefined ? { tenTool: m.tenTool } : {}) }))).tinNhan;

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const TAG = `cn${Date.now().toString(36)}`;
const LUONG = `${TAG}-luong`;
let A = 0;
let B = 0;
const KHOA_THAT = "sk-ant-api03-" + "Q".repeat(95);

async function exec(q: ReturnType<typeof sql>) {
  return hang(await ((await getDb()) as unknown as { execute(q: unknown): Promise<unknown> }).execute(q));
}

beforeAll(async () => {
  [A, B] = await Promise.all(
    ["a", "b"].map(async (x) => Number((await exec(sql`INSERT INTO factories (code, name) VALUES (${`${TAG}${x}`}, ${`NM thu ${x}`}) RETURNING id`))[0]!.id)),
  );
  for (const f of [A, B]) {
    const [k] = await exec(sql`INSERT INTO ai_api_keys (name, provider, "encryptedKey", status, "createdBy", "factoryId")
      VALUES (${`${TAG}-k${f}`}, 'anthropic', ${encryptSecret(KHOA_THAT)}, 'active', 1, ${f}) RETURNING id`);
    await exec(sql`INSERT INTO ai_ngoai_nha_may ("factoryId", "batNgoai", "tranTokenNgay", "tranLanPhut") VALUES (${f}, true, 10000000, 600)`);
    await exec(sql`INSERT INTO ai_ngoai_model ("factoryId", "nhaCungCap", model, nhan, "keyId", "tranTokenLuot", "batModel")
      VALUES (${f}, 'anthropic', 'claude-thu', 'Claude thu', ${k!.id}, 5000000, true)`);
  }
  // Luồng của A: v1 ĐÃ duyệt ngoài (băm khớp), v2 CHƯA duyệt.
  const def = { id: LUONG, name: "l", version: 1, nodes: [{ id: "t", type: "kich-hoat.thu-cong", typeVersion: 1, name: "t", position: [0, 0], parameters: {} }, { id: "ai", type: "ai.llm", typeVersion: 1, name: "ai", position: [0, 0], parameters: { chonModel: "ngoai:anthropic:claude-thu" } }], connections: [] };
  await exec(sql`INSERT INTO ai_flows (id, name, "riskClass", "factoryId") VALUES (${LUONG}, 'l', 'thuan', ${A})`);
  await exec(sql`INSERT INTO ai_flow_versions ("flowId", version, definition, "riskClass", "coNodeNgoai", "ngoaiDuyetLuc", "ngoaiBamDuyet")
    VALUES (${LUONG}, 1, ${JSON.stringify(def)}::jsonb, 'thuan', true, now(), ${bamDinhNghia(def as never)})`);
  await exec(sql`INSERT INTO ai_flow_versions ("flowId", version, definition, "riskClass", "coNodeNgoai") VALUES (${LUONG}, 2, ${JSON.stringify({ ...def, version: 2 })}::jsonb, 'thuan', true)`);
});

afterAll(async () => {
  await exec(sql`DELETE FROM ai_flows WHERE id = ${LUONG}`);
  for (const f of [A, B].filter(Boolean)) {
    await exec(sql`DELETE FROM ai_ngoai_model WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_ngoai_nha_may WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_api_keys WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_ngoai_dem WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_ngoai_dem_phut WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM ai_external_call_noi_dung WHERE "factoryId" = ${f}`);
    await exec(sql`DELETE FROM factories WHERE id = ${f}`);
  }
});

function dep(gia: NhaCungCapGia, o: Partial<PhuThuocCong> = {}): PhuThuocCong & { buoc: string[] } {
  const buoc: string[] = [];
  return {
    ...phuThuocMacDinh,
    env: () => ({ AI_NGOAI_ENABLED: "true" }),
    layTuDien: async () => TU_DIEN_RONG,
    layNhaCungCap: (ma) => (ma === "anthropic" ? gia : null),
    ghiBuoc: (b) => void buoc.push(b),
    buoc,
    ...o,
  };
}

const yc = (o: Partial<YeuCauGoiNgoai> = {}, ngu: Partial<YeuCauGoiNgoai["ngu"]> = {}): YeuCauGoiNgoai => ({
  dich: { nhaCungCap: "anthropic", model: "claude-thu" },
  tinNhan: ghep([
    { vaiTro: "system", noiDung: "Bạn là người rà mã." },
    { vaiTro: "user", noiDung: "Rà giúp hàm này" },
  ]),
  maxTokens: 200,
  mucDich: "kiem-dinh",
  ...o,
  ngu: { userId: 7, flowId: null, runId: null, tuDong: false, nhaMayNguoiGoi: [A, B], nhaMayChuDuLieu: [A], nguonMuc: { loai: "be-mat", beMat: "chat", phanDaGhep: [] }, ...ngu },
});

const maLoi = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiNgoai ? e.ma : `KHAC:${String(e)}`;
  }
};
const soHangSo = async (f: number) => Number((await exec(sql`SELECT count(*)::int AS n FROM ai_external_calls WHERE "factoryId" = ${f}`))[0]!.n);
const tokenGiu = async (f: number) => Number((await exec(sql`SELECT COALESCE(SUM("tokenGiu"),0)::int AS n FROM ai_ngoai_dem WHERE "factoryId" = ${f} AND khoa = 'nha-may'`))[0]!.n);

describe("cổng AI ngoài — từ chối sớm (không gọi, không sổ)", () => {
  it("cờ env tắt ⇒ NGOAI_TAT", async () => {
    const g = taoNhaCungCapGia();
    const truoc = await soHangSo(A);
    expect(await maLoi(goiAiNgoai(yc(), dep(g, { env: () => ({}) })))).toBe("NGOAI_TAT");
    expect(g.nhan).toHaveLength(0);
    expect(await soHangSo(A)).toBe(truoc);
  });

  it("chủ dữ liệu không xác định ⇒ NOT_FOUND; luồng toàn cục ⇒ NGOAI_LUONG_TOAN_CUC; nhà máy ngoài phạm vi người gọi ⇒ NOT_FOUND", async () => {
    const g = taoNhaCungCapGia();
    expect(await maLoi(goiAiNgoai(yc({}, { nhaMayChuDuLieu: [null] }), dep(g)))).toBe("NGOAI_KHONG_TON_TAI");
    expect(await maLoi(goiAiNgoai(yc({}, { nhaMayChuDuLieu: [null], nguonMuc: { loai: "luong", mucDuLieu: async () => "ky-thuat" } }), dep(g)))).toBe("NGOAI_LUONG_TOAN_CUC");
    expect(await maLoi(goiAiNgoai(yc({}, { nhaMayNguoiGoi: [B], nhaMayChuDuLieu: [A] }), dep(g)))).toBe("NGOAI_KHONG_TON_TAI");
    expect(await maLoi(goiAiNgoai(yc({ dich: { nhaCungCap: "anthropic", model: "khong-co" } }), dep(g)))).toBe("NGOAI_KHONG_TON_TAI");
    expect(g.nhan).toHaveLength(0);
  });

  it("đính kèm ⇒ NGOAI_CAM_DINH_KEM; chuỗi 257 KB ⇒ NGOAI_QUA_LON", async () => {
    const g = taoNhaCungCapGia();
    expect(await maLoi(goiAiNgoai(yc({ dinhKem: [{}] }), dep(g)))).toBe("NGOAI_CAM_DINH_KEM");
    expect(await maLoi(goiAiNgoai(yc({ tinNhan: ghep([{ vaiTro: "user", noiDung: "x".repeat(257 * 1024) }]) }), dep(g)))).toBe("NGOAI_QUA_LON");
    expect(g.nhan).toHaveLength(0);
  });

  it("dữ liệu vận hành + nhà máy chưa cho ⇒ NGOAI_DU_LIEU_VAN_HANH; luồng không có hàm mức ⇒ coi là vận hành", async () => {
    const g = taoNhaCungCapGia();
    expect(await maLoi(goiAiNgoai(yc({}, { nguonMuc: { loai: "be-mat", beMat: "chat", phanDaGhep: ["van-hanh"] } }), dep(g)))).toBe("NGOAI_DU_LIEU_VAN_HANH");
    expect(await maLoi(goiAiNgoai(yc({}, { nguonMuc: { loai: "luong" }, flowId: LUONG, phienBan: 1 }), dep(g)))).toBe("NGOAI_DU_LIEU_VAN_HANH");
    expect(g.nhan).toHaveLength(0);
  });

  it("★ 10.4b L0a — tinNhan KHÔNG do bộ dựng tạo (tự dựng / chép mảng đã ghép) ⇒ NGOAI_KHONG_QUA_BO_GHEP TRƯỚC mọi bước (không gọi, không giữ chỗ)", async () => {
    const g = taoNhaCungCapGia([{ kieu: "tra", noiDung: "ok" }]);
    const truoc = await tokenGiu(A);
    expect(await maLoi(goiAiNgoai(yc({ tinNhan: [{ vaiTro: "user", noiDung: "tự dựng" }] }), dep(g)))).toBe("NGOAI_KHONG_QUA_BO_GHEP");
    expect(await maLoi(goiAiNgoai(yc({ tinNhan: [...ghep([{ vaiTro: "user", noiDung: "chép" }])] }), dep(g)))).toBe("NGOAI_KHONG_QUA_BO_GHEP");
    expect(g.nhan).toHaveLength(0);
    expect(await tokenGiu(A)).toBe(truoc);
  });

  it("★ 10.4b L0a — mức = MAX(nguồn khai, BỘ DỰNG): phần `cau-go-van-hanh` + nguồn khai `phanDaGhep: []` ⇒ vẫn NGOAI_DU_LIEU_VAN_HANH", async () => {
    const g = taoNhaCungCapGia([{ kieu: "tra", noiDung: "ok" }]);
    const tin = ghep([{ vaiTro: "user", noiDung: "máy L3 dừng mấy lần hôm nay?" }], "cau-go-van-hanh");
    expect(await maLoi(goiAiNgoai(yc({ tinNhan: tin }, { nguonMuc: { loai: "be-mat", beMat: "chat", phanDaGhep: [] } }), dep(g)))).toBe("NGOAI_DU_LIEU_VAN_HANH");
    expect(g.nhan).toHaveLength(0);
  });

  it("không dựng được từ điển che ⇒ NGOAI_CHE_HONG (không gửi)", async () => {
    const g = taoNhaCungCapGia();
    expect(await maLoi(goiAiNgoai(yc(), dep(g, { layTuDien: async () => Promise.reject(new Error("db")) })))).toBe("NGOAI_CHE_HONG");
    expect(g.nhan).toHaveLength(0);
  });

  it("kiểu: người gọi KHÔNG khai được mức dữ liệu / nhà máy tính trần", () => {
    expectTypeOf<YeuCauGoiNgoai["ngu"]>().not.toHaveProperty("mucDuLieu");
    expectTypeOf<YeuCauGoiNgoai["ngu"]>().not.toHaveProperty("factoryId");
  });
});

describe("cổng AI ngoài — gọi", () => {
  it("thành công: khongTinCay, khoá GIẢI MÃ tới nhà cung cấp, thứ tự bước cố định, sổ ý định + kết quả, bộ đếm tăng", async () => {
    const g = taoNhaCungCapGia([{ kieu: "tra", noiDung: "đã rà", tokenVao: 30, tokenRa: 20 }]);
    const d = dep(g);
    const truocSo = await soHangSo(A);
    const kq = await goiAiNgoai(yc(), d);
    expect(kq).toMatchObject({ noiDung: "đã rà", khongTinCay: true, tokenVao: 30, tokenRa: 20 });
    expect(g.nhan[0]!.khoa).toBe(KHOA_THAT);
    expect(d.buoc).toEqual(["co-env", "nha-may", "dinh-kem", "muc-du-lieu", "lap", "che", "dat-truoc", "so-y-dinh", "nha-cung-cap", "ket-toan", "kiem-tool", "so-ket-qua"]);
    expect(await soHangSo(A)).toBe(truocSo + 2);
  });

  it("★ mọi vector che đặt vào system / lịch sử / kết quả tool / mô tả + schema tool ⇒ yêu cầu nhà cung cấp NHẬN không còn chuỗi nhạy", async () => {
    const g = taoNhaCungCapGia([{ kieu: "tra", noiDung: "ok" }]);
    for (const v of VECTOR_CHE.filter((x) => x.phaiKhongCon.length && !x.tuDien)) {
      const s = typeof v.dauVao === "string" ? v.dauVao : JSON.stringify(v.dauVao);
      await goiAiNgoai(
        yc({
          tinNhan: ghep([
            { vaiTro: "system", noiDung: `Hệ thống. ${s}` },
            { vaiTro: "user", noiDung: s },
            { vaiTro: "assistant", noiDung: `đã đọc ${s}` },
            { vaiTro: "tool", noiDung: s, tenTool: "tra_tai_lieu" },
          ]),
          congCu: [{ ten: "tra_tai_lieu", moTa: `tra cứu ${s}`, schema: { type: "object", properties: { q: { type: "string", description: s } }, required: ["q"], additionalProperties: false } }],
        }),
        dep(g),
      );
      const nhan = JSON.stringify(g.nhan.at(-1)!.yc);
      for (const bm of v.phaiKhongCon) expect(nhan, `${v.ten}: còn "${bm}"`).not.toContain(bm);
    }
  });

  it("loi-nhac-lai: lỗi nhà cung cấp nhắc lại khoá ⇒ lỗi ném ra đã che; sổ ghi kết quả 'loi' với mã, không nội dung", async () => {
    const g = taoNhaCungCapGia([{ kieu: "loi", thongDiep: `400 invalid request: echo ${KHOA_GIA.anthropic} and password=hunter99` }]);
    let loi: unknown;
    try {
      await goiAiNgoai(yc(), dep(g));
    } catch (e) {
      loi = e;
    }
    expect(loi).toBeInstanceOf(LoiNgoai);
    const chu = JSON.stringify({ m: (loi as Error).message, c: (loi as LoiNgoai).chiTiet });
    expect(chu).not.toContain(KHOA_GIA.anthropic);
    expect(chu).not.toContain("hunter99");
    const [r] = await exec(sql`SELECT "ketCuc", "maLoi" FROM ai_external_calls WHERE "factoryId" = ${A} AND loai = 'ket-qua' ORDER BY id DESC LIMIT 1`);
    expect(r).toEqual({ ketCuc: "loi", maLoi: "NGOAI_NHA_CUNG_CAP_LOI" });
  });

  it("sổ ý định không ghi được ⇒ nhà cung cấp KHÔNG được gọi, chỗ giữ được HOÀN", async () => {
    const g = taoNhaCungCapGia();
    const truoc = await tokenGiu(A);
    const goc = phuThuocMacDinh.db;
    const dbHong = async () => {
      const db = (await goc())!;
      return {
        ...db,
        transaction: db.transaction.bind(db),
        execute: (q: unknown) => {
          const s = JSON.stringify(q);
          if (s.includes("INSERT INTO ai_external_calls") && s.includes("'y-dinh'")) return Promise.reject(new Error("sổ hỏng"));
          return db.execute(q as never);
        },
      } as never;
    };
    expect(await maLoi(goiAiNgoai(yc(), dep(g, { db: dbHong })))).toBe("NGOAI_SO_HONG");
    expect(g.nhan).toHaveLength(0);
    expect(await tokenGiu(A)).toBe(truoc);
  });

  it("thử lại: lỗi tạm lần 1 ⇒ lần 2 thành công; bộ đếm giữ HAI lần ước tính (lần 1 đã rời máy ⇒ không hoàn)", async () => {
    const g = taoNhaCungCapGia([{ kieu: "loi", thongDiep: "503", thuLai: true }, { kieu: "tra", noiDung: "ok", tokenVao: null, tokenRa: null }]);
    const truoc = await tokenGiu(A);
    await goiAiNgoai(yc(), dep(g));
    expect(g.nhan).toHaveLength(2);
    const tang = (await tokenGiu(A)) - truoc;
    const motLan = Math.ceil(Buffer.byteLength(JSON.stringify(g.nhan[0]!.yc), "utf8") / 2) + 200;
    expect(tang).toBeGreaterThanOrEqual(2 * motLan - 10);
  });

  it("nha-may-cheo: người {A,B}, A bật / B tắt — dữ liệu B ⇒ NOT_FOUND; dữ liệu A ⇒ qua, đếm vào A không vào B", async () => {
    await exec(sql`UPDATE ai_ngoai_nha_may SET "batNgoai" = false WHERE "factoryId" = ${B}`);
    try {
      const g = taoNhaCungCapGia();
      expect(await maLoi(goiAiNgoai(yc({}, { nhaMayChuDuLieu: [B] }), dep(g)))).toBe("NGOAI_KHONG_TON_TAI");
      expect(await maLoi(goiAiNgoai(yc({}, { nhaMayChuDuLieu: [A, B] }), dep(g)))).toBe("NGOAI_KHONG_TON_TAI");
      expect(g.nhan).toHaveLength(0);
      const truocA = await tokenGiu(A);
      const truocB = await tokenGiu(B);
      await goiAiNgoai(yc({}, { nhaMayChuDuLieu: [A] }), dep(g));
      expect(await tokenGiu(A)).toBeGreaterThan(truocA);
      expect(await tokenGiu(B)).toBe(truocB);
    } finally {
      await exec(sql`UPDATE ai_ngoai_nha_may SET "batNgoai" = true WHERE "factoryId" = ${B}`);
    }
    // A cho dữ liệu vận hành, B thì không ⇒ dữ liệu vận hành trộn A+B bị chặn
    await exec(sql`UPDATE ai_ngoai_nha_may SET "choDuLieuVanHanh" = true WHERE "factoryId" = ${A}`);
    const g = taoNhaCungCapGia();
    expect(await maLoi(goiAiNgoai(yc({}, { nhaMayChuDuLieu: [A, B], nguonMuc: { loai: "be-mat", beMat: "chat", phanDaGhep: ["van-hanh"] } }), dep(g)))).toBe("NGOAI_DU_LIEU_VAN_HANH");
    await goiAiNgoai(yc({}, { nhaMayChuDuLieu: [A], nguonMuc: { loai: "be-mat", beMat: "chat", phanDaGhep: ["van-hanh"] } }), dep(g));
    expect(g.nhan).toHaveLength(1);
  });

  it("tool-tra-ve-la: tool không cấp / sai schema ⇒ NGOAI_TOOL_KHONG_CAP, sổ kết quả 'tu-choi'", async () => {
    const congCu = [{ ten: "tra_tai_lieu", moTa: "tra", schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false } }];
    for (const kb of [
      { kieu: "tra", toolCalls: [{ ten: "ot_write", thamSo: { tag: "X", gia: 1 } }] },
      { kieu: "tra", toolCalls: [{ ten: "xoa_luong", thamSo: {} }] },
      { kieu: "tra", toolCalls: [{ ten: "tra_tai_lieu", thamSo: { q: 1, them: "x" } }] },
    ] as KichBanGia[]) {
      expect(await maLoi(goiAiNgoai(yc({ congCu }), dep(taoNhaCungCapGia([kb]))))).toBe("NGOAI_TOOL_KHONG_CAP");
      const [r] = await exec(sql`SELECT "ketCuc", "maLoi" FROM ai_external_calls WHERE "factoryId" = ${A} AND loai = 'ket-qua' ORDER BY id DESC LIMIT 1`);
      expect(r).toEqual({ ketCuc: "tu-choi", maLoi: "NGOAI_TOOL_KHONG_CAP" });
    }
    const ok = await goiAiNgoai(yc({ congCu }), dep(taoNhaCungCapGia([{ kieu: "tra", toolCalls: [{ ten: "tra_tai_lieu", thamSo: { q: "abc" } }] }])));
    expect(ok.toolCalls).toEqual([{ ten: "tra_tai_lieu", thamSo: { q: "abc" } }]);
  });

  it("khoá thu hồi giữa chừng ⇒ NGOAI_KHOA_KHONG_HOP_LE, chỗ hoàn (chưa gửi)", async () => {
    await exec(sql`UPDATE ai_api_keys SET status = 'inactive' WHERE "factoryId" = ${A}`);
    try {
      const g = taoNhaCungCapGia();
      const truoc = await tokenGiu(A);
      expect(await maLoi(goiAiNgoai(yc(), dep(g)))).toBe("NGOAI_KHOA_KHONG_HOP_LE");
      expect(g.nhan).toHaveLength(0);
      expect(await tokenGiu(A)).toBe(truoc);
    } finally {
      await exec(sql`UPDATE ai_api_keys SET status = 'active' WHERE "factoryId" = ${A}`);
    }
  });
});

describe("cổng AI ngoài — luồng, dữ liệu vận hành từ phạm vi chủ lượt", () => {
  it("mức van-hanh: MỌI nhà máy trong phạm vi chủ lượt phải bật + cho dữ liệu vận hành; hàm phạm vi lỗi ⇒ từ chối", async () => {
    await exec(sql`UPDATE ai_ngoai_nha_may SET "choDuLieuVanHanh" = true WHERE "factoryId" = ${A}`);
    await exec(sql`UPDATE ai_ngoai_nha_may SET "choDuLieuVanHanh" = false WHERE "factoryId" = ${B}`);
    const g = taoNhaCungCapGia();
    const luong = (nhaMayKhiVanHanh: () => Promise<number[]>) =>
      yc({}, { nhaMayNguoiGoi: null, nhaMayChuDuLieu: [A], nguonMuc: { loai: "luong", mucDuLieu: async () => "van-hanh" }, nhaMayKhiVanHanh, flowId: LUONG, phienBan: 1 });
    expect(await maLoi(goiAiNgoai(luong(async () => [A, B]), dep(g)))).toBe("NGOAI_DU_LIEU_VAN_HANH");
    expect(await maLoi(goiAiNgoai(luong(async () => Promise.reject(new Error("pham vi"))), dep(g)))).toBe("NGOAI_DU_LIEU_VAN_HANH");
    expect(g.nhan).toHaveLength(0);
    await goiAiNgoai(luong(async () => [A]), dep(g));
    expect(g.nhan).toHaveLength(1);
    const [r] = await exec(sql`SELECT "nhaMayDuLieu" FROM ai_external_calls WHERE "factoryId" = ${A} AND loai = 'y-dinh' ORDER BY id DESC LIMIT 1`);
    expect(r!.nhaMayDuLieu).toEqual([A]);
  });
});

describe("cổng AI ngoài — rà kiem-dinh lô 2 (kẹp / trần đầu ra / sổ mỗi lần thử)", () => {
  it("maxTokens 10^9 ⇒ nhà cung cấp nhận ≤ 32 000 (trần cứng) — không giữ chỗ khổng lồ", async () => {
    const g = taoNhaCungCapGia([{ kieu: "tra", noiDung: "ok" }]);
    const truoc = await tokenGiu(A);
    await goiAiNgoai(yc({ maxTokens: 1e9 }), dep(g));
    expect(g.nhan[0]!.yc.maxTokens).toBe(32_000);
    expect((await tokenGiu(A)) - truoc).toBeLessThan(40_000);
  });

  it("★ 11.0 (rà kiem-dinh) — trường THỪA trên tin nhắn / phần (vd reasoning_content của lõi agent khi giữ nghĩ) KHÔNG tới nhà cung cấp", async () => {
    const g = taoNhaCungCapGia([{ kieu: "tra", noiDung: "ok" }]);
    const to = yc();
    to.tinNhan = ghepPhan([
      { vaiTro: "user", phan: [{ loai: "cau-go-lap-trinh", noiDung: "hỏi" }] },
      { vaiTro: "assistant", phan: [{ loai: "dau-ra-model", noiDung: "đáp", reasoning_content: "NỘI-TÂM-BÍ-MẬT" } as never], nghiTruoc: "NGHĨ-CŨ" } as never,
      { vaiTro: "tool", phan: [{ loai: "ma-repo", noiDung: "kq" }], tenTool: "read_file" },
    ]).tinNhan;
    await goiAiNgoai(to, dep(g));
    const gui = g.nhan[0]!.yc.tinNhan;
    expect(gui[1]).toEqual({ vaiTro: "assistant", noiDung: "đáp" });
    expect(gui[2]).toEqual({ vaiTro: "tool", noiDung: "kq", tenTool: "read_file" });
    expect(JSON.stringify(g.nhan[0]!.yc)).not.toMatch(/NỘI-TÂM-BÍ-MẬT|NGHĨ-CŨ|reasoning_content|nghiTruoc/);
  });

  it("★ 10.4 — trần MỖI LƯỢT của model (lời gọi ngoài lượt chạy): CO maxTokens để vào + ra vừa trần (trước đây: luôn NGOAI_VUOT_TRAN khi trần = maxTokens); không còn chỗ cho đầu ra ⇒ VUOT_TRAN 'luot', nhà cung cấp không được gọi", async () => {
    await exec(sql`UPDATE ai_ngoai_model SET "tranTokenLuot" = 4000 WHERE "factoryId" = ${A} AND model = 'claude-thu'`);
    try {
      const g = taoNhaCungCapGia([{ kieu: "tra", noiDung: "ok" }]);
      await goiAiNgoai(yc({ maxTokens: 4000 }), dep(g));
      const m = g.nhan[0]!.yc.maxTokens;
      expect(m).toBeLessThan(4000);
      expect(m).toBeGreaterThanOrEqual(256);
      const g2 = taoNhaCungCapGia([{ kieu: "tra", noiDung: "ok" }]);
      const to = yc({ maxTokens: 4000 });
      to.tinNhan = ghep([{ vaiTro: "user", noiDung: "abc ".repeat(2000) }]); // ~4000 token vào (có khoảng trắng — chuỗi liền dài bị che) ⇒ không còn chỗ cho đầu ra
      expect(await maLoi(goiAiNgoai(to, dep(g2)))).toBe("NGOAI_VUOT_TRAN");
      expect(g2.nhan).toHaveLength(0);
      // rà kiem-dinh (NÊN) — còn 600 token cho đầu ra: kiểm định (cần ≥ 1000) ⇒ từ chối SỚM, không gọi; mục đích khác (≥ 256) ⇒ co về 600
      const vao = 4000 - m;
      await exec(sql`UPDATE ai_ngoai_model SET "tranTokenLuot" = ${vao + 600} WHERE "factoryId" = ${A} AND model = 'claude-thu'`);
      const g3 = taoNhaCungCapGia([{ kieu: "tra", noiDung: "ok" }]);
      expect(await maLoi(goiAiNgoai(yc({ maxTokens: 4000 }), dep(g3)))).toBe("NGOAI_VUOT_TRAN");
      expect(g3.nhan).toHaveLength(0);
      const g4 = taoNhaCungCapGia([{ kieu: "tra", noiDung: "ok" }]);
      await goiAiNgoai(yc({ maxTokens: 4000, mucDich: "luong" }), dep(g4));
      const m4 = g4.nhan[0]!.yc.maxTokens; // ước vào lệch ±vài token theo yêu cầu (mucDich khác)
      expect(m4).toBeGreaterThan(580);
      expect(m4).toBeLessThan(620);
    } finally {
      await exec(sql`UPDATE ai_ngoai_model SET "tranTokenLuot" = 5000000 WHERE "factoryId" = ${A} AND model = 'claude-thu'`);
    }
  });

  it("phản hồi > 256 KB ⇒ NGOAI_PHAN_HOI_QUA_LON, sổ kết quả 'tu-choi' (chi phí đã kết toán)", async () => {
    const g = taoNhaCungCapGia([{ kieu: "tra", noiDung: "x".repeat(257 * 1024) }]);
    expect(await maLoi(goiAiNgoai(yc(), dep(g)))).toBe("NGOAI_PHAN_HOI_QUA_LON");
    const [r] = await exec(sql`SELECT "ketCuc", "maLoi" FROM ai_external_calls WHERE "factoryId" = ${A} AND loai = 'ket-qua' ORDER BY id DESC LIMIT 1`);
    expect(r).toEqual({ ketCuc: "tu-choi", maLoi: "NGOAI_PHAN_HOI_QUA_LON" });
  });

  it("thử lại: MỖI lần thử một hàng ý định + kết quả (lần 1 'loi', lần 2 'ok') — đối soát chi phí khớp bộ đếm", async () => {
    const g = taoNhaCungCapGia([{ kieu: "loi", thongDiep: "503", thuLai: true }, { kieu: "tra", noiDung: "ok" }]);
    const moc = Number((await exec(sql`SELECT COALESCE(max(id) FILTER (WHERE id <= COALESCE(pg_sequence_last_value(pg_get_serial_sequence('ai_external_calls', 'id')::regclass), 0)),0)::bigint AS m FROM ai_external_calls`))[0]!.m);
    await goiAiNgoai(yc(), dep(g));
    const hangMoi = await exec(sql`SELECT loai, "ketCuc" FROM ai_external_calls WHERE "factoryId" = ${A} AND id > ${moc} ORDER BY id`);
    expect(hangMoi).toEqual([
      { loai: "y-dinh", ketCuc: null },
      { loai: "ket-qua", ketCuc: "loi" },
      { loai: "y-dinh", ketCuc: null },
      { loai: "ket-qua", ketCuc: "ok" },
    ]);
  });
});

describe("cổng — phòng thủ chiều sâu: lượt luồng phải ĐÃ DUYỆT NGOÀI (rà kiem-dinh Task 8 A)", () => {
  it("phiên bản chưa duyệt / thiếu phiên bản / băm duyệt bị sửa ⇒ NGOAI_CHUA_DUYET, nhà cung cấp không được gọi; v1 đã duyệt ⇒ qua", async () => {
    const g = taoNhaCungCapGia();
    const luong = (o: Partial<YeuCauGoiNgoai["ngu"]>) => yc({}, { nhaMayNguoiGoi: null, nhaMayChuDuLieu: [A], nguonMuc: { loai: "luong", mucDuLieu: async () => "ky-thuat" }, flowId: LUONG, ...o });
    expect(await maLoi(goiAiNgoai(luong({ phienBan: 2 }), dep(g)))).toBe("NGOAI_CHUA_DUYET");
    expect(await maLoi(goiAiNgoai(luong({}), dep(g)))).toBe("NGOAI_CHUA_DUYET");
    await exec(sql`UPDATE ai_flow_versions SET "ngoaiBamDuyet" = ${"f".repeat(64)} WHERE "flowId" = ${LUONG} AND version = 1`);
    try {
      expect(await maLoi(goiAiNgoai(luong({ phienBan: 1 }), dep(g)))).toBe("NGOAI_CHUA_DUYET");
    } finally {
      const [v] = await exec(sql`SELECT definition FROM ai_flow_versions WHERE "flowId" = ${LUONG} AND version = 1`);
      await exec(sql`UPDATE ai_flow_versions SET "ngoaiBamDuyet" = ${bamDinhNghia(v!.definition as never)} WHERE "flowId" = ${LUONG} AND version = 1`);
    }
    expect(g.nhan).toHaveLength(0);
    await goiAiNgoai(luong({ phienBan: 1 }), dep(g));
    expect(g.nhan).toHaveLength(1);
  });
});
