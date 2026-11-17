/**
 * `__chunkSanCo.ts` — THUẦN (bộ chạy truy vấn GIẢ, không DB): chọn thời điểm hàng thử TRONG chunk có sẵn để giao dịch dài không tạo chunk mới (giữ khoá machines).
 * ĐỘT BIẾN PHẢI BẮT: chọn ngoài chunk · bỏ kiểm "trống ±nửa độ" · chọn chunk đã nén · không rơi về mặc định khi lỗi / không chunk · nối tên bảng không kiểm · đảo thứ tự tham số.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chonThoiDiemTrongChunkSanCo, coChunkChuaThoiDiem, viTriTrongChunk, type ChayTruyVan } from "./__chunkSanCo";

const MAC_DINH = new Date("2017-11-08T05:00:00.000Z");
const BAY_GIO = new Date("2026-11-17T09:00:00.000Z");
const CHUNK_10 = { range_start: new Date("2026-10-01T00:00:00.000Z"), range_end: new Date("2026-11-01T00:00:00.000Z") };
const CHUNK_09 = { range_start: new Date("2026-09-01T00:00:00.000Z"), range_end: new Date("2026-10-01T00:00:00.000Z") };

function gia(chunks: Array<Record<string, unknown>>, demTheoLan: number[]): { chay: ChayTruyVan; goi: Array<{ q: string; p: unknown[] }> } {
  const goi: Array<{ q: string; p: unknown[] }> = [];
  let lanDem = 0;
  const chay: ChayTruyVan = async (q, p) => {
    goi.push({ q, p });
    if (/timescaledb_information\.chunks/.test(q)) return chunks;
    return [{ n: demTheoLan[lanDem++] ?? 0 }];
  };
  return { chay, goi };
}

describe("viTriTrongChunk", () => {
  it("★★★ luôn nằm TRONG [đầu + lề, cuối − lề], tất định theo (ts, k), đổi theo ts và theo lần thử", () => {
    const d = new Date("2026-10-01T00:00:00.000Z");
    const c = new Date("2026-11-01T00:00:00.000Z");
    const le = 60_000;
    const mau = new Set<number>();
    for (let ts = 1_700_000_000_000; ts < 1_700_000_000_000 + 400; ts += 7) {
      for (let k = 0; k < 5; k++) {
        const t = viTriTrongChunk(d, c, ts, k, le).getTime();
        expect(t).toBeGreaterThanOrEqual(d.getTime() + le);
        expect(t).toBeLessThan(c.getTime() - le + 1);
        mau.add(t);
      }
    }
    expect(mau.size, "vị trí phải đa dạng (không dồn một chỗ)").toBeGreaterThan(200);
    // chunk NGẮN (5 phút, lề 1 phút): sai lệch biên lộ ngay
    const d2 = new Date("2026-10-01T00:00:00.000Z");
    const c2 = new Date("2026-10-01T00:05:00.000Z");
    for (let ts = 1; ts < 500; ts += 3) {
      const t = viTriTrongChunk(d2, c2, ts * 7919, ts & 3, le).getTime();
      expect(t).toBeGreaterThanOrEqual(d2.getTime() + le);
      expect(t).toBeLessThanOrEqual(c2.getTime() - le);
    }
    expect(viTriTrongChunk(d, c, 123, 2, le).getTime()).toBe(viTriTrongChunk(d, c, 123, 2, le).getTime());
    expect(viTriTrongChunk(d, c, 123, 0, le).getTime()).not.toBe(viTriTrongChunk(d, c, 123, 1, le).getTime());
  });
});

describe("chonThoiDiemTrongChunkSanCo", () => {
  it("★★★ có chunk và lát trống ⇒ chọn TRONG chunk đầu tiên (mới nhất), nguồn 'chunk-san-co'; truy vấn chunk lọc chưa nén, đúng thứ tự tham số", async () => {
    const { chay, goi } = gia([CHUNK_10, CHUNK_09], [0]);
    const r = await chonThoiDiemTrongChunkSanCo(chay, { bang: "product_inspections", cot: "inspectionTime", ts: 1_800_000_000_123, macDinh: MAC_DINH, bayGio: BAY_GIO });
    expect(r.nguon).toBe("chunk-san-co");
    expect(r.at.getTime()).toBeGreaterThan(CHUNK_10.range_start.getTime());
    expect(r.at.getTime()).toBeLessThan(CHUNK_10.range_end.getTime());
    expect(r.chunk).toEqual({ batDau: CHUNK_10.range_start, ketThuc: CHUNK_10.range_end });
    expect(goi[0]!.q).toContain("not is_compressed");
    expect(goi[0]!.q).toContain("hypertable_name = $1");
    expect(goi[0]!.p[0]).toBe("product_inspections");
    // $2 = muộn nhất (bây giờ − 1 ngày), $3 = sớm nhất (bây giờ − 3500 ngày)
    expect(goi[0]!.p[1]).toBe("2026-11-16T09:00:00.000Z");
    expect(new Date(goi[0]!.p[2] as string).getTime()).toBe(BAY_GIO.getTime() - 3500 * 86_400_000);
    // truy vấn đếm: cửa sổ ±30 s quanh `at`
    const dem = goi[1]!;
    expect(dem.q).toContain('from product_inspections where "inspectionTime" >= $1 and "inspectionTime" < $2');
    expect(new Date(dem.p[1] as string).getTime() - new Date(dem.p[0] as string).getTime()).toBe(60_000);
  });
  it("★★★ lát bị chiếm (đếm > 0) ⇒ thử vị trí khác; đủ 5 lần vẫn bận ⇒ chunk kế; không bao giờ trả vị trí đã đếm > 0", async () => {
    const { chay, goi } = gia([CHUNK_10, CHUNK_09], [3, 1, 0]);
    const r = await chonThoiDiemTrongChunkSanCo(chay, { bang: "product_inspections", cot: "inspectionTime", ts: 99, macDinh: MAC_DINH, bayGio: BAY_GIO });
    expect(r.nguon).toBe("chunk-san-co");
    expect(goi.filter((g) => !/timescaledb_information/.test(g.q))).toHaveLength(3);
    const lanCuoi = goi[goi.length - 1]!;
    const giua = (new Date(lanCuoi.p[0] as string).getTime() + new Date(lanCuoi.p[1] as string).getTime()) / 2;
    expect(r.at.getTime()).toBe(giua);
    const { chay: chayBan, goi: goiBan } = gia([CHUNK_10, CHUNK_09], Array(10).fill(2));
    const r2 = await chonThoiDiemTrongChunkSanCo(chayBan, { bang: "product_inspections", cot: "inspectionTime", ts: 99, macDinh: MAC_DINH, bayGio: BAY_GIO });
    expect(r2.nguon).toBe("mac-dinh:khong-co-chunk-phu-hop");
    expect(r2.at).toBe(MAC_DINH);
    expect(goiBan.filter((g) => !/timescaledb_information/.test(g.q))).toHaveLength(10); // 2 chunk × 5 lần
  });
  it("★★★ không có chunk / chunk quá ngắn / dữ liệu lạ ⇒ mặc định (hành vi cũ) kèm lý do; lỗi đọc ⇒ mặc định, KHÔNG ném", async () => {
    const khong = await chonThoiDiemTrongChunkSanCo(gia([], []).chay, { bang: "product_inspections", cot: "inspectionTime", ts: 1, macDinh: MAC_DINH, bayGio: BAY_GIO });
    expect(khong).toEqual({ at: MAC_DINH, nguon: "mac-dinh:khong-co-chunk-phu-hop" });
    const ngan = await chonThoiDiemTrongChunkSanCo(gia([{ range_start: new Date("2026-10-01T00:00:00Z"), range_end: new Date("2026-10-01T00:01:00Z") }], []).chay, { bang: "product_inspections", cot: "inspectionTime", ts: 1, macDinh: MAC_DINH, bayGio: BAY_GIO });
    expect(ngan.nguon).toBe("mac-dinh:khong-co-chunk-phu-hop");
    const la = await chonThoiDiemTrongChunkSanCo(gia([{ range_start: "khong-phai-ngay", range_end: null }], []).chay, { bang: "product_inspections", cot: "inspectionTime", ts: 1, macDinh: MAC_DINH, bayGio: BAY_GIO });
    expect(la.nguon).toBe("mac-dinh:khong-co-chunk-phu-hop");
    const hong = await chonThoiDiemTrongChunkSanCo(
      async () => {
        throw new Error("permission denied for view chunks");
      },
      { bang: "product_inspections", cot: "inspectionTime", ts: 1, macDinh: MAC_DINH, bayGio: BAY_GIO },
    );
    expect(hong.at).toBe(MAC_DINH);
    expect(hong.nguon).toBe("mac-dinh:loi-doc:permission denied for view chunks");
  });
  it("★★★ tên bảng / cột không hợp lệ (chống nối chuỗi SQL) ⇒ mặc định và KHÔNG chạy truy vấn nào", async () => {
    for (const [bang, cot] of [["product_inspections; drop table machines", "inspectionTime"], ["Product", "inspectionTime"], ["product_inspections", 'x" or 1=1 --'], ["", "inspectionTime"]] as const) {
      const { chay, goi } = gia([CHUNK_10], [0]);
      const r = await chonThoiDiemTrongChunkSanCo(chay, { bang, cot, ts: 1, macDinh: MAC_DINH, bayGio: BAY_GIO });
      expect(r.nguon, `${bang} / ${cot}`).toBe("mac-dinh:ten-bang-cot-khong-hop-le");
      expect(goi).toHaveLength(0);
    }
  });
});

describe("coChunkChuaThoiDiem", () => {
  it("★★★ có hàng ⇒ true; rỗng ⇒ false; lỗi ⇒ null (không rõ); tên bảng sai ⇒ null không truy vấn", async () => {
    expect(await coChunkChuaThoiDiem(async () => [{ co: 1 }], "product_inspections", BAY_GIO)).toBe(true);
    expect(await coChunkChuaThoiDiem(async () => [], "product_inspections", BAY_GIO)).toBe(false);
    expect(
      await coChunkChuaThoiDiem(async () => {
        throw new Error("x");
      }, "product_inspections", BAY_GIO),
    ).toBeNull();
    let goi = 0;
    expect(await coChunkChuaThoiDiem(async () => { goi++; return []; }, "a;b", BAY_GIO)).toBeNull();
    expect(goi).toBe(0);
  });
});

describe("statisticsScope.test.ts — dùng chunk có sẵn, không tự đặt lát vào ngày chưa có chunk", () => {
  const nguon = readFileSync(join(__dirname, "..", "db", "statisticsScope.test.ts"), "utf8");
  it("★★★ lát 2 giây lấy từ `chonThoiDiemTrongChunkSanCo` TRƯỚC khi mở giao dịch; ngày 2017 chỉ còn là mặc định rơi về; có cảnh báo khi còn có thể tạo chunk mới", () => {
    expect(nguon).toMatch(/const THOI_DIEM = await chonLatCoChunkSanCo\(\);\s*const AT = THOI_DIEM\.at;/);
    expect(nguon).toMatch(/chonThoiDiemTrongChunkSanCo\(chay, \{ bang: "product_inspections", cot: "inspectionTime", ts, macDinh \}\)/);
    expect(/const AT = new Date\(Date\.UTC/.test(nguon), "AT không được đặt thẳng vào ngày 2017").toBe(false);
    expect(nguon).toMatch(/const macDinh = new Date\(Date\.UTC\(2017, 10, 8\)/);
    expect(nguon).toMatch(/beforeAll\(async \(\) => \{\s*\/\/[^\n]*\n\s*if \(THOI_DIEM\.nguon !== "chunk-san-co" \|\| THOI_DIEM\.coChunkHomNay === false\)[\s\S]{0,400}?await moGiaoDichHoanTac\(\);/);
    // đọc chunk dùng kết nối riêng, đóng ngay, không phải tx
    expect(nguon).toMatch(/const cli = postgres\(url, \{ max: 1[^}]*\}\);[\s\S]{0,700}?finally \{\s*await cli\.end\(/);
  });
});
