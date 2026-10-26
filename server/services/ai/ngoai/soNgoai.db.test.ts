/**
 * ★ Đợt 10.3 Task 5 — sổ AI ngoài trên CSDL `_test` THẬT (vai `avi_app`). Sổ là WORM ⇒ hàng thử ở lại (nhà máy thử số lớn ngẫu nhiên,
 * không đụng dữ liệu khác); bảng nội dung thì dọn.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { bamNoiDung, doiSoatYDinhMoCoi, ghiKetQua, ghiYDinh, luuNoiDungNeuBat, xoaNoiDungHetHan, type DbSo, type HangYDinh } from "./soNgoai";

const F = 900_000_000 + Math.floor(Math.random() * 99_000_000);
const db = async () => (await getDb()) as unknown as DbSo;
const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const yd = (o: Partial<HangYDinh> = {}): HangYDinh => ({
  factoryId: F, nhaMayDuLieu: [F], userId: 7, flowId: null, runId: null, tuDong: false, nhaCungCap: "anthropic", model: "m",
  mucDich: "kiem-dinh", mucDuLieu: "ky-thuat", soTruongDaChe: 2, bamNoiDung: bamNoiDung("noi dung da che"), ...o,
});
const maLoi = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code ?? String(e);
  }
};

afterAll(async () => {
  await (await db()).execute(sql`DELETE FROM ai_external_call_noi_dung WHERE "factoryId" = ${F}`);
});

describe("sổ AI ngoài (WORM)", () => {
  it("ghiYDinh trả id; hàng có factoryId + băm 64 hex; ghiKetQua một lần, lần hai bỏ qua (không ghi trùng)", async () => {
    const d = await db();
    const id = await ghiYDinh(d, yd());
    expect(id).toBeGreaterThan(0);
    const [y] = hang(await d.execute(sql`SELECT "factoryId", "bamNoiDung", "nhaMayDuLieu" FROM ai_external_calls WHERE id = ${id}`));
    expect(y).toMatchObject({ factoryId: F, nhaMayDuLieu: [F] });
    expect(String(y!.bamNoiDung)).toMatch(/^[0-9a-f]{64}$/);
    await ghiKetQua(d, id, { tokenVao: 10, tokenRa: 5, chiPhiUocUsd: null, ketCuc: "ok" });
    await ghiKetQua(d, id, { tokenVao: 99, tokenRa: 99, chiPhiUocUsd: null, ketCuc: "loi", maLoi: "X" });
    const kq = hang(await d.execute(sql`SELECT "ketCuc", "tokenVao" FROM ai_external_calls WHERE "yDinhId" = ${id}`));
    expect(kq).toEqual([{ ketCuc: "ok", tokenVao: 10 }]);
  });

  it("avi_app KHÔNG sửa / xoá được sổ (42501)", async () => {
    const d = await db();
    const id = await ghiYDinh(d, yd());
    expect(await maLoi(d.execute(sql`UPDATE ai_external_calls SET model = 'x' WHERE id = ${id}`))).toBe("42501");
    expect(await maLoi(d.execute(sql`DELETE FROM ai_external_calls WHERE id = ${id}`))).toBe("42501");
  });

  it("luuNguyenVan=false ⇒ không hàng nội dung; true ⇒ hàng với hetHanLuc = lúc + hanGiuNgay; xoá chỉ hàng hết hạn", async () => {
    const d = await db();
    const a = await ghiYDinh(d, yd());
    const b = await ghiYDinh(d, yd());
    const luc = new Date("2026-10-26T00:00:00Z");
    expect(await luuNoiDungNeuBat(d, a, F, "x", { luuNguyenVan: false, hanGiuNgay: 30 }, luc)).toBe(false);
    await luuNoiDungNeuBat(d, a, F, "da che A", { luuNguyenVan: true, hanGiuNgay: 1 }, luc);
    await luuNoiDungNeuBat(d, b, F, "da che B", { luuNguyenVan: true, hanGiuNgay: 30 }, luc);
    const [h] = hang(await d.execute(sql`SELECT "hetHanLuc" FROM ai_external_call_noi_dung WHERE "callId" = ${a}`));
    expect(new Date(String(h!.hetHanLuc)).toISOString()).toBe("2026-10-27T00:00:00.000Z");
    await xoaNoiDungHetHan(d, new Date("2026-10-28T00:00:00Z"));
    const con = hang(await d.execute(sql`SELECT "callId" FROM ai_external_call_noi_dung WHERE "factoryId" = ${F} ORDER BY "callId"`)).map((r) => Number(r.callId));
    expect(con).toEqual([b]);
  });

  it("mo-coi: ý định 31 phút không kết quả ⇒ hàng khong-ro; 29 phút ⇒ không; chạy lại không ghi trùng", async () => {
    const d = await db();
    const bayGio = new Date();
    const taoY = async (phut: number) =>
      Number(
        hang(
          await d.execute(sql`INSERT INTO ai_external_calls ("factoryId", loai, "tuDong", "nhaCungCap", model, "bamNoiDung", "taoLuc")
            VALUES (${F}, 'y-dinh', true, 'openai', 'm', ${bamNoiDung(String(phut))}, ${new Date(bayGio.getTime() - phut * 60_000).toISOString()}::timestamptz) RETURNING id`),
        )[0]!.id,
      );
    const cu = await taoY(31);
    const moi = await taoY(29);
    await doiSoatYDinhMoCoi(d, 30, bayGio);
    await doiSoatYDinhMoCoi(d, 30, bayGio);
    const kq = hang(await d.execute(sql`SELECT "yDinhId", "ketCuc", "maLoi" FROM ai_external_calls WHERE loai = 'ket-qua' AND "yDinhId" IN (${cu}, ${moi})`));
    expect(kq.map((r) => ({ ...r, yDinhId: Number(r.yDinhId) }))).toEqual([{ yDinhId: cu, ketCuc: "khong-ro", maLoi: "MO_COI" }]);
  });
});
