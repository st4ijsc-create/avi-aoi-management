/**
 * ★ Đợt 10.3 Task 4 — trần chi phí đặt-trước NGUYÊN TỬ trên CSDL `_test` THẬT (không giả SQL: lỗi `ON CONFLICT` không khớp khoá chính
 * phải hiện ra ở đây). Nhà máy thử là số lớn ngẫu nhiên (bảng đếm không có FK) ⇒ không đụng dữ liệu khác; dọn sau mỗi ca.
 */
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { chotTranLuot, datTruoc, docConLaiNgay, donDemCu, xemTranNgay, huyGiuChuaGui, ketToan, ngayUtc7, uocTokenVao, type DbDem, type TranNhaMay, type YeuCauGiuCho } from "./tranChiPhi";
import { LoiNgoai } from "./loi";

const NM = () => 900_000_000 + Math.floor(Math.random() * 99_000_000);
const daDung = new Set<number>();
const nm = () => {
  const f = NM();
  daDung.add(f);
  return f;
};
const db = async () => (await getDb()) as unknown as DbDem;
const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;

const TRAN: TranNhaMay = { tranTokenNgay: 1000, tranTienNgayUsd: null, tranTokenNguoiNgay: null, tranTokenLuongNgay: null, tranTokenLuot: null, tranLanPhut: 100 };
const yc = (factoryId: number, tokenUoc: number, o: Partial<YeuCauGiuCho> = {}): YeuCauGiuCho => ({ factoryId, userId: null, flowId: null, runId: null, tokenUoc, tienUocUsd: null, ...o });

async function giu(factoryId: number, khoa = "nha-may"): Promise<{ token: number; tien: number } | null> {
  const r = hang(await (await db()).execute(sql`SELECT "tokenGiu"::int AS t, "tienGiuUsd"::float AS m FROM ai_ngoai_dem WHERE "factoryId" = ${factoryId} AND khoa = ${khoa}`));
  return r[0] ? { token: Number(r[0].t), tien: Number(r[0].m) } : null;
}
const maLoi = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiNgoai ? e.ma : String(e);
  }
};

afterEach(async () => {
  const d = await db();
  for (const f of daDung) {
    await d.execute(sql`DELETE FROM ai_ngoai_dem WHERE "factoryId" = ${f}`);
    await d.execute(sql`DELETE FROM ai_ngoai_dem_phut WHERE "factoryId" = ${f}`);
  }
  daDung.clear();
});

describe("datTruoc — trần nguyên tử", () => {
  it("trần 1000: giữ 600 ⇒ ok; giữ thêm 600 ⇒ NGOAI_VUOT_TRAN và MỌI khoá rollback (nha-may 600, nguoi không tăng)", async () => {
    const f = nm();
    const tran = { ...TRAN, tranTokenNguoiNgay: 5000 };
    await datTruoc(await db(), yc(f, 600, { userId: 7 }), tran);
    expect(await maLoi(datTruoc(await db(), yc(f, 600, { userId: 7 }), tran))).toBe("NGOAI_VUOT_TRAN");
    expect(await giu(f)).toEqual({ token: 600, tien: 0 });
    expect(await giu(f, "nguoi:7")).toEqual({ token: 600, tien: 0 });
  });

  it("★ chen-vuot-tran: hàng CHƯA có + 1500 > 1000 ⇒ NGOAI_VUOT_TRAN và KHÔNG có hàng (nhánh INSERT cũng kiểm trần)", async () => {
    const f = nm();
    expect(await maLoi(datTruoc(await db(), yc(f, 1500), TRAN))).toBe("NGOAI_VUOT_TRAN");
    expect(await giu(f)).toBeNull();
  });

  it("dong-thoi: hai lượt 600 cùng lúc trên trần 1000 (hàng chưa có) ⇒ đúng MỘT qua", async () => {
    const f = nm();
    const kq = await Promise.allSettled([datTruoc(await db(), yc(f, 600), TRAN), datTruoc(await db(), yc(f, 600), TRAN)]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    expect(kq.filter((k) => k.status === "rejected" && (k.reason as LoiNgoai).ma === "NGOAI_VUOT_TRAN")).toHaveLength(1);
    expect(await giu(f)).toEqual({ token: 600, tien: 0 });
  });

  it("tran-tien: 1,00 USD — 0,60 ok, thêm 0,60 ⇒ từ chối; nhà máy mới + 1,50 ⇒ từ chối, 0 hàng", async () => {
    const f = nm();
    const tran = { ...TRAN, tranTokenNgay: null, tranTienNgayUsd: 1 };
    await datTruoc(await db(), yc(f, 10, { tienUocUsd: 0.6 }), tran);
    expect(await maLoi(datTruoc(await db(), yc(f, 10, { tienUocUsd: 0.6 }), tran))).toBe("NGOAI_VUOT_TRAN");
    expect((await giu(f))!.tien).toBeCloseTo(0.6);
    const g = nm();
    expect(await maLoi(datTruoc(await db(), yc(g, 10, { tienUocUsd: 1.5 }), tran))).toBe("NGOAI_VUOT_TRAN");
    expect(await giu(g)).toBeNull();
  });

  it("tach-nha-may: A và B cùng nguoi:7 trần người 1000 — mỗi bên 600 ok (đếm RIÊNG); A thêm 600 ⇒ từ chối, B không đổi", async () => {
    const a = nm();
    const b = nm();
    const tran = { ...TRAN, tranTokenNgay: null, tranTokenNguoiNgay: 1000 };
    await datTruoc(await db(), yc(a, 600, { userId: 7 }), tran);
    await datTruoc(await db(), yc(b, 600, { userId: 7 }), tran);
    expect(await maLoi(datTruoc(await db(), yc(a, 600, { userId: 7 }), tran))).toBe("NGOAI_VUOT_TRAN");
    expect(await giu(a, "nguoi:7")).toEqual({ token: 600, tien: 0 });
    expect(await giu(b, "nguoi:7")).toEqual({ token: 600, tien: 0 });
  });

  it("lan-phut: tranLanPhut=2 ⇒ lần 3 trong cùng phút bị từ chối", async () => {
    const f = nm();
    const tran = { ...TRAN, tranTokenNgay: null, tranLanPhut: 2 };
    const luc = new Date("2026-10-26T03:04:05Z");
    await datTruoc(await db(), yc(f, 1), tran, luc);
    await datTruoc(await db(), yc(f, 1), tran, new Date(luc.getTime() + 20_000));
    expect(await maLoi(datTruoc(await db(), yc(f, 1), tran, new Date(luc.getTime() + 40_000)))).toBe("NGOAI_VUOT_TRAN");
    await datTruoc(await db(), yc(f, 1), tran, new Date(luc.getTime() + 61_000)); // phút kế
  });

  it("trần LƯỢT với lời gọi không thuộc lượt chạy áp cho chính lời gọi; thuộc lượt ⇒ cộng dồn khoá luot:<runId>", async () => {
    const f = nm();
    const tran = { ...TRAN, tranTokenNgay: null, tranTokenLuot: 500 };
    expect(await maLoi(datTruoc(await db(), yc(f, 600), tran))).toBe("NGOAI_VUOT_TRAN");
    await datTruoc(await db(), yc(f, 300, { runId: "r1" }), tran);
    expect(await maLoi(datTruoc(await db(), yc(f, 300, { runId: "r1" }), tran))).toBe("NGOAI_VUOT_TRAN");
  });

  it("nua-dem UTC+7", () => {
    expect(ngayUtc7(new Date("2026-10-26T16:59:59Z"))).toBe("2026-10-26");
    expect(ngayUtc7(new Date("2026-10-26T17:00:00Z"))).toBe("2026-10-27");
  });

  it("DB hỏng ⇒ NGOAI_DEM_HONG", async () => {
    const hong: DbDem = { transaction: async () => Promise.reject(new Error("connection lost")), execute: async () => Promise.reject(new Error("x")) };
    expect(await maLoi(datTruoc(hong, yc(1, 10), TRAN))).toBe("NGOAI_DEM_HONG");
  });
});

describe("kết toán / hoàn / dọn", () => {
  it("ketToan có usage ⇒ trừ chênh; usage VẮNG ⇒ giữ nguyên ước tính (không hoàn sau khi gửi); huyGiuChuaGui ⇒ về 0", async () => {
    const f = nm();
    const p1 = await datTruoc(await db(), yc(f, 600), TRAN);
    await ketToan(await db(), p1, { tokenVao: 100, tokenRa: 50, tienUsd: null });
    expect((await giu(f))!.token).toBe(150);
    const p2 = await datTruoc(await db(), yc(f, 400), TRAN);
    await ketToan(await db(), p2, null);
    expect((await giu(f))!.token).toBe(550);
    await huyGiuChuaGui(await db(), p2);
    expect((await giu(f))!.token).toBe(150);
  });

  it("uoc-bi-quan: 1 000 ký tự CJK / Việt có dấu ⇒ ≥ 1 000", () => {
    expect(uocTokenVao({ t: "漢".repeat(1000) })).toBeGreaterThanOrEqual(1000);
    expect(uocTokenVao({ t: "ộ".repeat(1000) })).toBeGreaterThanOrEqual(1000);
  });

  it("don-dem: hàng 91 ngày bị xoá, 89 ngày còn", async () => {
    const f = nm();
    const bayGio = new Date("2026-10-26T05:00:00Z");
    const d = await db();
    for (const n of [89, 91]) {
      await d.execute(sql`INSERT INTO ai_ngoai_dem ("factoryId", ngay, khoa, "tokenGiu") VALUES (${f}, ${ngayUtc7(new Date(bayGio.getTime() - n * 86_400_000))}::date, ${`k${n}`}, 1)`);
    }
    await donDemCu(d, 90, bayGio);
    expect(await giu(f, "k89")).not.toBeNull();
    expect(await giu(f, "k91")).toBeNull();
  });
});

describe("★ 10.4 — docConLaiNgay (đọc, không giữ chỗ)", () => {
  it("trần nhà máy token + USD và trần người: còn lại = trần − đã giữ; trần null ⇒ null; KHÔNG ghi hàng nào", async () => {
    const f = nm();
    const tran = { ...TRAN, tranTokenNgay: 1000, tranTienNgayUsd: 2, tranTokenNguoiNgay: 500 };
    expect(await docConLaiNgay(await db(), f, 7, tran)).toEqual({ nhaMay: { token: 1000, usd: 2 }, nguoi: { token: 500 } });
    expect(await giu(f)).toBeNull();
    await datTruoc(await db(), yc(f, 300, { userId: 7, tienUocUsd: 0.5 }), tran);
    const c = await docConLaiNgay(await db(), f, 7, tran);
    expect(c.nhaMay.token).toBe(700);
    expect(c.nhaMay.usd).toBeCloseTo(1.5);
    expect(c.nguoi.token).toBe(200);
    expect(await docConLaiNgay(await db(), f, 8, tran)).toMatchObject({ nguoi: { token: 500 } });
    expect(await docConLaiNgay(await db(), f, null, { ...tran, tranTokenNgay: null, tranTienNgayUsd: null })).toEqual({ nhaMay: { token: null, usd: null }, nguoi: { token: null } });
  });
});

describe("★ 10.4 — xemTranNgay (ĐỌC, cùng khoá với datTruoc) + chotTranLuot", () => {
  it("lượt / nhà máy / người / phút — lý do đầu tiên vượt; không ghi hàng nào; vừa khít ⇒ null", async () => {
    const f = nm();
    const tran = { ...TRAN, tranTokenNgay: 1000, tranTokenNguoiNgay: 500, tranLanPhut: 2 };
    expect(await xemTranNgay(await db(), yc(f, 500, { userId: 7 }), tran)).toBeNull();
    expect(await giu(f)).toBeNull();
    expect(await xemTranNgay(await db(), yc(f, 501, { userId: 7 }), tran)).toBe("nguoi");
    await datTruoc(await db(), yc(f, 600), tran);
    expect(await xemTranNgay(await db(), yc(f, 401), tran)).toBe("nha-may");
    expect(await xemTranNgay(await db(), yc(f, 400), tran)).toBeNull();
    await datTruoc(await db(), yc(f, 10), tran); // phút thứ 2
    expect(await xemTranNgay(await db(), yc(f, 1), tran)).toBe("lan-phut");
    expect(await xemTranNgay(await db(), yc(f, 501), { ...tran, tranTokenLuot: 500, tranLanPhut: 100 })).toBe("luot");
  });
  it("chotTranLuot: co maxTokens vừa trần; còn < 256 ⇒ NGOAI_VUOT_TRAN 'luot'; trong lượt chạy / không trần ⇒ giữ nguyên", () => {
    expect(chotTranLuot(1000, 4000, 4000, null)).toBe(3000);
    expect(chotTranLuot(1000, 2000, 4000, null)).toBe(2000);
    expect(() => chotTranLuot(3800, 4000, 4000, null)).toThrow(LoiNgoai);
    expect(chotTranLuot(3800, 4000, 4000, "run-1")).toBe(4000);
    expect(chotTranLuot(3800, 4000, null, null)).toBe(4000);
  });
});
