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

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const TAG = `cn${Date.now().toString(36)}`;
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
});

afterAll(async () => {
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
  tinNhan: [
    { vaiTro: "system", noiDung: "Bạn là người rà mã." },
    { vaiTro: "user", noiDung: "Rà giúp hàm này" },
  ],
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
    expect(await maLoi(goiAiNgoai(yc({ tinNhan: [{ vaiTro: "user", noiDung: "x".repeat(257 * 1024) }] }), dep(g)))).toBe("NGOAI_QUA_LON");
    expect(g.nhan).toHaveLength(0);
  });

  it("dữ liệu vận hành + nhà máy chưa cho ⇒ NGOAI_DU_LIEU_VAN_HANH; luồng không có hàm mức ⇒ coi là vận hành", async () => {
    const g = taoNhaCungCapGia();
    expect(await maLoi(goiAiNgoai(yc({}, { nguonMuc: { loai: "be-mat", beMat: "chat", phanDaGhep: ["van-hanh"] } }), dep(g)))).toBe("NGOAI_DU_LIEU_VAN_HANH");
    expect(await maLoi(goiAiNgoai(yc({}, { nguonMuc: { loai: "luong" } }), dep(g)))).toBe("NGOAI_DU_LIEU_VAN_HANH");
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
          tinNhan: [
            { vaiTro: "system", noiDung: `Hệ thống. ${s}` },
            { vaiTro: "user", noiDung: s },
            { vaiTro: "assistant", noiDung: `đã đọc ${s}` },
            { vaiTro: "tool", noiDung: s, tenTool: "tra_tai_lieu" },
          ],
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
      yc({}, { nhaMayNguoiGoi: null, nhaMayChuDuLieu: [A], nguonMuc: { loai: "luong", mucDuLieu: async () => "van-hanh" }, nhaMayKhiVanHanh });
    expect(await maLoi(goiAiNgoai(luong(async () => [A, B]), dep(g)))).toBe("NGOAI_DU_LIEU_VAN_HANH");
    expect(await maLoi(goiAiNgoai(luong(async () => Promise.reject(new Error("pham vi"))), dep(g)))).toBe("NGOAI_DU_LIEU_VAN_HANH");
    expect(g.nhan).toHaveLength(0);
    await goiAiNgoai(luong(async () => [A]), dep(g));
    expect(g.nhan).toHaveLength(1);
    const [r] = await exec(sql`SELECT "nhaMayDuLieu" FROM ai_external_calls WHERE "factoryId" = ${A} AND loai = 'y-dinh' ORDER BY id DESC LIMIT 1`);
    expect(r!.nhaMayDuLieu).toEqual([A]);
  });
});
