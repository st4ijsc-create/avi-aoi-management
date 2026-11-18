/**
 * `__chunkSanCo.ts` — THUẦN (bộ chạy truy vấn GIẢ, không DB): chọn thời điểm hàng thử TRONG chunk có sẵn để giao dịch dài không tạo chunk mới (giữ khoá machines).
 * ĐỘT BIẾN PHẢI BẮT: chọn ngoài chunk · bỏ kiểm "trống ±nửa độ" · chọn chunk đã nén · không rơi về mặc định khi lỗi / không chunk · nối tên bảng không kiểm · đảo thứ tự tham số.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chonMocTheoDb, chonThoiDiemTrongChunkSanCo, coChunkChuaThoiDiem, cuaSoChuaGioTron, viTriTrongChunk, type ChayTruyVan } from "./__chunkSanCo";

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
    expect(ngan.nguon).toBe("mac-dinh:chunk-qua-ngan");
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

// ═══ Phương án A (HST duyệt 17/11): nhận chunk HIỆN HÀNH ở phần đã qua. Giờ là THAM SỐ (`bayGio`), không dùng đồng hồ thật, không dùng fake timers. ═══
describe("chonThoiDiemTrongChunkSanCo — chunk hiện hành (phương án A)", () => {
  const NGAY = 86_400_000;
  const MUON = new Date(BAY_GIO.getTime() - NGAY); // hôm qua: mút trên cho phép của mọi vị trí
  const CHUNK_11_HIEN_HANH = { range_start: new Date("2026-11-01T00:00:00.000Z"), range_end: new Date("2026-12-01T00:00:00.000Z") };
  const tuyChon = (ts: number) => ({ bang: "product_inspections", cot: "inspectionTime", ts, macDinh: MAC_DINH, bayGio: BAY_GIO });

  it("★★★ (b) chunk ĐÃ QUA và chunk HIỆN HÀNH cùng hợp lệ ⇒ chọn chunk ĐÃ QUA (đủ nhiều ts để không thể do tình cờ)", async () => {
    for (let ts = 1_800_000_000_000; ts < 1_800_000_000_000 + 600; ts += 31) {
      const { chay } = gia([CHUNK_11_HIEN_HANH, CHUNK_10], [0]); // thứ tự truy vấn: mới nhất trước ⇒ hiện hành đứng ĐẦU
      const r = await chonThoiDiemTrongChunkSanCo(chay, tuyChon(ts));
      expect(r.nguon).toBe("chunk-san-co");
      expect(r.chunk).toEqual({ batDau: CHUNK_10.range_start, ketThuc: CHUNK_10.range_end });
      expect(r.at.getTime()).toBeGreaterThan(CHUNK_10.range_start.getTime());
      expect(r.at.getTime()).toBeLessThan(CHUNK_10.range_end.getTime());
    }
  });
  it("★★★ (c) chỉ còn chunk hiện hành (chunk cũ đã nén) và range_end > bây giờ − 1 ngày ⇒ mút trên ĐÚNG BẰNG bây giờ − 1 ngày; mọi vị trí (cả cửa sổ ±30 s) nằm trong [đầu, bây giờ − 1 ngày]", async () => {
    let max = 0;
    for (let ts = 1_800_000_000_000; ts < 1_800_000_000_000 + 3000; ts += 7) {
      const { chay } = gia([CHUNK_11_HIEN_HANH], [0]);
      const r = await chonThoiDiemTrongChunkSanCo(chay, tuyChon(ts));
      expect(r.nguon).toBe("chunk-san-co");
      expect(r.chunk!.ketThuc.getTime(), "mút trên bị cắt đúng về bây giờ − 1 ngày").toBe(MUON.getTime());
      expect(r.chunk!.batDau).toEqual(CHUNK_11_HIEN_HANH.range_start);
      expect(r.at.getTime() + 30_000, "cửa sổ ±30 s không vượt hôm qua").toBeLessThanOrEqual(MUON.getTime());
      expect(r.at.getTime() - 30_000).toBeGreaterThanOrEqual(CHUNK_11_HIEN_HANH.range_start.getTime());
      max = Math.max(max, r.at.getTime());
    }
    expect(max, "vị trí phải phủ phần lớn đoạn đã qua, không dồn một đầu").toBeGreaterThan(CHUNK_11_HIEN_HANH.range_start.getTime() + 10 * NGAY);
  });
  it("★★★ (a) NGÀY ĐẦU của chunk mới: phần đã qua < 2 phút ⇒ về MẶC ĐỊNH với lý do riêng 'chunk-qua-ngan', không chạy truy vấn đếm nào", async () => {
    const dauChunk = { range_start: new Date(MUON.getTime() - 119_999), range_end: new Date(MUON.getTime() + 30 * NGAY) }; // phần đã qua 119,999 s < 4 × 30 s
    const { chay, goi } = gia([dauChunk], [0]);
    const r = await chonThoiDiemTrongChunkSanCo(chay, tuyChon(5));
    expect(r).toEqual({ at: MAC_DINH, nguon: "mac-dinh:chunk-qua-ngan" });
    expect(goi.filter((g) => !/timescaledb_information/.test(g.q))).toHaveLength(0);
  });
  it("biên: phần đã qua ĐÚNG 2 phút ⇒ dùng được (at = đầu + lề 60 s); thiếu 1 ms ⇒ mặc định", async () => {
    const dung = { range_start: new Date(MUON.getTime() - 120_000), range_end: new Date(MUON.getTime() + 30 * NGAY) };
    const r = await chonThoiDiemTrongChunkSanCo(gia([dung], [0]).chay, tuyChon(5));
    expect(r.nguon).toBe("chunk-san-co");
    expect(r.at.getTime()).toBe(dung.range_start.getTime() + 60_000);
    const thieu = { range_start: new Date(MUON.getTime() - 119_999), range_end: new Date(MUON.getTime() + 30 * NGAY) };
    expect((await chonThoiDiemTrongChunkSanCo(gia([thieu], [0]).chay, tuyChon(5))).nguon).toBe("mac-dinh:chunk-qua-ngan");
  });
  it("chunk ngắn VÀ chunk khác dùng được ⇒ bỏ chunk ngắn, vẫn chọn chunk dùng được (không về mặc định oan)", async () => {
    const ngan = { range_start: new Date(MUON.getTime() - 60_000), range_end: new Date(MUON.getTime() + 30 * NGAY) };
    const r = await chonThoiDiemTrongChunkSanCo(gia([ngan, CHUNK_10], [0]).chay, tuyChon(9));
    expect(r.nguon).toBe("chunk-san-co");
    expect(r.chunk).toEqual({ batDau: CHUNK_10.range_start, ketThuc: CHUNK_10.range_end });
  });
  it("truy vấn chunk: chunk hiện hành lọt được (điều kiện theo range_start < hôm qua, KHÔNG còn theo range_end), vẫn lọc chưa nén và cận sớm nhất", async () => {
    const { chay, goi } = gia([CHUNK_11_HIEN_HANH], [0]);
    await chonThoiDiemTrongChunkSanCo(chay, tuyChon(1));
    expect(goi[0]!.q).toContain("range_start < $2");
    expect(goi[0]!.q).not.toContain("range_end <=");
    expect(goi[0]!.q).toContain("not is_compressed");
    expect(goi[0]!.p[1]).toBe(MUON.toISOString());
  });
  it("cửa sổ lát của chunk hiện hành bị chiếm hết ⇒ mặc định 'khong-co-chunk-phu-hop' (không phải 'chunk-qua-ngan')", async () => {
    const r = await chonThoiDiemTrongChunkSanCo(gia([CHUNK_11_HIEN_HANH], Array(5).fill(4)).chay, tuyChon(3));
    expect(r).toEqual({ at: MAC_DINH, nguon: "mac-dinh:khong-co-chunk-phu-hop" });
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

// ═══ Nhiều hypertable cùng mốc (`cungBang`) và bọc theo `db` drizzle (`chonMocTheoDb`) — dùng cho reportServiceScope (product_inspections + oee_metrics) ═══
describe("chonThoiDiemTrongChunkSanCo — cungBang (mốc nằm trong chunk có sẵn của CẢ HAI bảng)", () => {
  const MUON = new Date(BAY_GIO.getTime() - 86_400_000);
  const tuyChon = (ts: number, cungBang: string[]) => ({ bang: "product_inspections", cot: "inspectionTime", ts, macDinh: MAC_DINH, bayGio: BAY_GIO, cungBang });
  /** Bộ chạy giả: chunk của bảng chính + chunk của bảng khác theo khoảng [dau, cuoi) (rỗng ⇒ bảng không có chunk nào). */
  function giaHaiBang(chinh: Array<Record<string, unknown>>, khac: { dau: Date; cuoi: Date } | null) {
    const goiKhac: Array<{ p: unknown[] }> = [];
    const chay: ChayTruyVan = async (q, p) => {
      if (/range_start <= \$2 and range_end > \$3/.test(q)) {
        goiKhac.push({ p });
        if (!khac) return [];
        const a = new Date(p[1] as string).getTime();
        const b = new Date(p[2] as string).getTime();
        return a >= khac.dau.getTime() && b <= khac.cuoi.getTime() ? [{ co: 1 }] : [];
      }
      if (/timescaledb_information\.chunks/.test(q)) return chinh;
      return [{ n: 0 }];
    };
    return { chay, goiKhac };
  }

  it("★★★ bảng khác có chunk phủ MỘT PHẦN chunk chính ⇒ mốc chọn được luôn nằm trong phần giao (đủ nhiều ts), cả hai đầu cửa sổ nằm trong chunk của bảng khác", async () => {
    const khac = { dau: new Date("2026-10-10T00:00:00.000Z"), cuoi: new Date("2026-10-20T00:00:00.000Z") }; // chỉ 10 ngày trong chunk chính 10/2026
    let dungChunk = 0;
    for (let ts = 1_800_000_000_000; ts < 1_800_000_000_000 + 400; ts += 13) {
      const { chay } = giaHaiBang([CHUNK_10], khac);
      const r = await chonThoiDiemTrongChunkSanCo(chay, tuyChon(ts, ["oee_metrics"]));
      if (r.nguon === "chunk-san-co") {
        dungChunk++;
        expect(r.at.getTime() - 30_000).toBeGreaterThanOrEqual(khac.dau.getTime());
        expect(r.at.getTime() + 30_000).toBeLessThanOrEqual(khac.cuoi.getTime());
      } else {
        expect(r.nguon).toBe("mac-dinh:khong-co-chunk-phu-hop");
      }
    }
    expect(dungChunk, "phần giao ~1/3 chunk, 5 lần thử ⇒ đa số lượt phải chọn được").toBeGreaterThan(20);
  });
  it("★★★ HAI BẢNG KHÔNG CÓ KHOẢNG CHUNG (bảng khác không có chunk nào, hoặc chunk không giao) ⇒ MẶC ĐỊNH 'khong-co-chunk-phu-hop' (người gọi cảnh báo), không chọn mốc ngoài chunk của bảng khác", async () => {
    const khongCo = giaHaiBang([CHUNK_10, CHUNK_09], null);
    const r1 = await chonThoiDiemTrongChunkSanCo(khongCo.chay, tuyChon(7, ["oee_metrics"]));
    expect(r1).toEqual({ at: MAC_DINH, nguon: "mac-dinh:khong-co-chunk-phu-hop" });
    expect(khongCo.goiKhac.length, "đã thử kiểm bảng khác ở mọi vị trí (2 chunk × 5)").toBe(10);
    const khongGiao = giaHaiBang([CHUNK_10], { dau: new Date("2025-01-01T00:00:00.000Z"), cuoi: new Date("2025-02-01T00:00:00.000Z") });
    expect((await chonThoiDiemTrongChunkSanCo(khongGiao.chay, tuyChon(7, ["oee_metrics"]))).nguon).toBe("mac-dinh:khong-co-chunk-phu-hop");
  });
  it("bảng khác phủ trọn ⇒ chọn như không có cungBang; truy vấn bảng khác dùng đúng tên + cửa sổ ±nửa-độ-trống quanh `at`; tên bảng khác không hợp lệ ⇒ mặc định không truy vấn", async () => {
    const { chay, goiKhac } = giaHaiBang([CHUNK_10], { dau: new Date("2026-09-01T00:00:00.000Z"), cuoi: new Date("2026-12-01T00:00:00.000Z") });
    const r = await chonThoiDiemTrongChunkSanCo(chay, tuyChon(11, ["oee_metrics"]));
    expect(r.nguon).toBe("chunk-san-co");
    expect(goiKhac[0]!.p[0]).toBe("oee_metrics");
    expect(new Date(goiKhac[0]!.p[2] as string).getTime() - new Date(goiKhac[0]!.p[1] as string).getTime()).toBe(60_000);
    const xau = giaHaiBang([CHUNK_10], null);
    const rx = await chonThoiDiemTrongChunkSanCo(xau.chay, tuyChon(11, ["oee_metrics; drop table machines"]));
    expect(rx.nguon).toBe("mac-dinh:ten-bang-cot-khong-hop-le");
    expect(xau.goiKhac).toHaveLength(0);
  });
  /**
   * Bộ chạy giả CÓ MÔ HÌNH NÉN cho bảng phụ: chunk của bảng phụ mang cờ `nen`; câu truy vấn chỉ loại chunk nén KHI văn bản câu lệnh chứa `not is_compressed`
   * (đúng như Postgres). Nhờ vậy đột biến "bỏ `not is_compressed` ở nhánh cungBang" làm helper chọn nhầm mốc trong chunk NÉN của bảng phụ ⇒ ca ĐỎ.
   */
  function giaBangPhuCoNen(chinh: Array<Record<string, unknown>>, chunkPhu: Array<{ dau: Date; cuoi: Date; nen: boolean }>) {
    const chay: ChayTruyVan = async (q, p) => {
      if (/range_start <= \$2 and range_end > \$3/.test(q)) {
        const a = new Date(p[1] as string).getTime();
        const b = new Date(p[2] as string).getTime();
        const chiLayChuaNen = /not is_compressed/.test(q);
        return chunkPhu.some((c) => c.dau.getTime() <= a && b <= c.cuoi.getTime() && (!chiLayChuaNen || !c.nen)) ? [{ co: 1 }] : [];
      }
      if (/timescaledb_information\.chunks/.test(q)) return chinh;
      return [{ n: 0 }];
    };
    return chay;
  }

  it("★★★ bảng phụ (oee_metrics) CHỈ có chunk ĐÃ NÉN phủ chunk chính ⇒ chunk nén bị LOẠI ⇒ mặc định 'khong-co-chunk-phu-hop' (đột biến: bỏ `not is_compressed` ở nhánh cungBang phải ĐỎ)", async () => {
    const chay = giaBangPhuCoNen([CHUNK_10], [{ dau: new Date("2026-09-01T00:00:00.000Z"), cuoi: new Date("2026-12-01T00:00:00.000Z"), nen: true }]);
    for (let ts = 1_800_000_000_000; ts < 1_800_000_000_000 + 200; ts += 17) {
      expect(await chonThoiDiemTrongChunkSanCo(chay, tuyChon(ts, ["oee_metrics"]))).toEqual({ at: MAC_DINH, nguon: "mac-dinh:khong-co-chunk-phu-hop" });
    }
  });
  it("★★★ bảng phụ có chunk NÉN phủ nửa đầu và chunk CHƯA NÉN phủ nửa sau ⇒ mốc chọn được chỉ nằm trong phần CHƯA NÉN (không bao giờ trong phần nén)", async () => {
    const giua = new Date("2026-10-16T00:00:00.000Z");
    const chay = giaBangPhuCoNen(
      [CHUNK_10],
      [
        { dau: CHUNK_10.range_start, cuoi: giua, nen: true },
        { dau: giua, cuoi: CHUNK_10.range_end, nen: false },
      ],
    );
    let chon = 0;
    for (let ts = 1_800_000_000_000; ts < 1_800_000_000_000 + 600; ts += 7) {
      const r = await chonThoiDiemTrongChunkSanCo(chay, tuyChon(ts, ["oee_metrics"]));
      if (r.nguon === "chunk-san-co") {
        chon++;
        expect(r.at.getTime() - 30_000, "mốc phải nằm TRỌN trong phần chưa nén").toBeGreaterThanOrEqual(giua.getTime());
      }
    }
    expect(chon, "phần chưa nén là nửa chunk ⇒ nhiều lượt vẫn chọn được").toBeGreaterThan(30);
  });
  it("lát bị chiếm ở bảng chính thì KHÔNG hỏi bảng khác (không phí truy vấn, không chọn lát bẩn)", async () => {
    const goi: string[] = [];
    const chay: ChayTruyVan = async (q) => {
      goi.push(q);
      if (/timescaledb_information\.chunks where hypertable_name = \$1 and not is_compressed and range_start </.test(q)) return [CHUNK_10];
      if (/count\(\*\)/.test(q)) return [{ n: 3 }];
      return [{ co: 1 }];
    };
    const r = await chonThoiDiemTrongChunkSanCo(chay, tuyChon(5, ["oee_metrics"]));
    expect(r.nguon).toBe("mac-dinh:khong-co-chunk-phu-hop");
    expect(goi.filter((q) => /range_start <= \$2 and range_end > \$3/.test(q))).toHaveLength(0);
  });
});

describe("chonMocTheoDb — bọc db drizzle (`$client.unsafe`), test không phải import driver", () => {
  it("★★★ db vắng / không có $client.unsafe ⇒ mặc định 'khong-co-ket-noi' (không ném)", async () => {
    for (const db of [null, undefined, {}, { $client: {} }, { $client: { unsafe: 5 } }]) {
      expect(await chonMocTheoDb(db, { bang: "product_inspections", cot: "inspectionTime", ts: 1, macDinh: MAC_DINH, bayGio: BAY_GIO })).toEqual({ at: MAC_DINH, nguon: "mac-dinh:khong-co-ket-noi" });
    }
  });
  it("★★★ có $client.unsafe ⇒ dùng nó (giữ ràng buộc `this`), truyền đúng câu lệnh + tham số, chọn mốc trong chunk", async () => {
    const goi: Array<{ q: string; p: unknown[] }> = [];
    const client = {
      tenDaGoi: 0,
      unsafe(this: { tenDaGoi: number }, q: string, p: unknown[]) {
        this.tenDaGoi++;
        goi.push({ q, p });
        return Promise.resolve(/timescaledb_information/.test(q) ? [CHUNK_10] : [{ n: 0 }]);
      },
    };
    const r = await chonMocTheoDb({ $client: client }, { bang: "product_inspections", cot: "inspectionTime", ts: 99, macDinh: MAC_DINH, bayGio: BAY_GIO });
    expect(r.nguon).toBe("chunk-san-co");
    expect(client.tenDaGoi).toBe(goi.length);
    expect(goi[0]!.p[0]).toBe("product_inspections");
  });
});

describe("reportExportScope / reportServiceScope — mốc lấy từ chunk có sẵn (không còn giờ ngẫu nhiên 2001–2024)", () => {
  const doc = (t: string) => readFileSync(join(__dirname, "..", "routers", t), "utf8");
  it("★★★ cả hai tệp: INSPECTED_AT = MOC_CHON.at từ `chonMocTheoDb` (cửa sổ ±60 s), công thức cũ chỉ còn là mặc định rơi về + cảnh báo; reportServiceScope còn đòi chunk của oee_metrics", () => {
    for (const t of ["reportExportScope.test.ts", "reportServiceScope.test.ts"]) {
      const n = doc(t);
      expect(n, t).toMatch(/const MOC_MAC_DINH = new Date\(1_000_000_000_000 \+ \(ts % 200_000\) \* 3_600_000\);/);
      expect(n, t).toMatch(/const MOC_CHON = await chonMocTheoDb\(await getDb\(\), \{[\s\S]{0,260}?nuaDoTrongMs: 60_000,/);
      expect(n, t).toMatch(/const INSPECTED_AT = MOC_CHON\.at;/);
      expect(/const INSPECTED_AT = new Date\(1_000_000_000_000/.test(n), `${t}: INSPECTED_AT không được tính thẳng từ công thức cũ`).toBe(false);
      expect(n, t).toMatch(/MOC_CHON\.nguon !== "chunk-san-co"\) console\.warn\(/);
      expect(n, t).toMatch(/const WINDOW_START = new Date\(INSPECTED_AT\.getTime\(\) - 60_000\);/);
    }
    expect(doc("reportServiceScope.test.ts")).toMatch(/cungBang: \["oee_metrics"\],/);
    expect(/cungBang/.test(doc("reportExportScope.test.ts").replace(/\/\*[\s\S]*?\*\//g, ""))).toBe(false);
  });
});

describe("defectHeatmapSavedScope / inspectionKhongKhop.db / defectSpatialHeatmap.scope.db — mốc lấy từ chunk có sẵn, cửa sổ co về ±60 s, mặc định cũ khi rơi về", () => {
  const doc = (...d: string[]) => readFileSync(join(__dirname, "..", ...d), "utf8");
  const CA_BA: Array<[string, string, RegExp, RegExp]> = [
    ["routers/defectHeatmapSavedScope.test.ts", "2019-06-05T03:00:00Z", /const INSPECTED_AT = MOC_CHON\.at;/, /const WIN_START = TRONG_CHUNK \? new Date\(INSPECTED_AT\.getTime\(\) - 60_000\)\.toISOString\(\) : "2019-06-01T00:00:00\.000Z";/],
    ["routers/inspectionKhongKhop.db.test.ts", "2031-03-15T12:00:00.000Z", /const T = MOC_CHON\.at;/, /const WIN = TRONG_CHUNK\s*\? \{ startDate: new Date\(T\.getTime\(\) - 60_000\), endDate: new Date\(T\.getTime\(\) \+ 60_000\) \}/],
    ["services/defectSpatialHeatmap.scope.db.test.ts", "2031-03-05T03:00:00Z", /const INSPECTED_AT = MOC_CHON\.at;/, /const WINDOW_START = TRONG_CHUNK \? new Date\(INSPECTED_AT\.getTime\(\) - 60_000\) : new Date\("2031-03-01T00:00:00Z"\);/],
  ];
  for (const [tep, macDinh, reMoc, reCuaSo] of CA_BA) {
    it(`★★★ ${tep}: mặc định cũ ${macDinh} chỉ còn khi rơi về; mốc = MOC_CHON.at; cửa sổ ±60 s khi chọn được chunk, cửa sổ cũ khi không; kết nối đọc chunk riêng, đóng ngay`, () => {
      const n = doc(...tep.split("/"));
      expect(n).toContain(`const MOC_MAC_DINH = new Date("${macDinh}");`);
      expect(n).toMatch(/const MOC_CHON = await chonMocTrongChunkSanCo\(\);\s*const TRONG_CHUNK = MOC_CHON\.nguon === "chunk-san-co";/);
      expect(n).toMatch(/bang: "product_inspections", cot: "inspectionTime", ts, macDinh: MOC_MAC_DINH, nuaDoTrongMs: 60_000/);
      expect(n).toMatch(reMoc);
      expect(n).toMatch(reCuaSo);
      expect(n).toMatch(/if \(!TRONG_CHUNK\) console\.warn\(/);
      expect(n).toMatch(/const cli = postgres\(url, \{ max: 1, onnotice: \(\) => undefined \}\);[\s\S]{0,500}?finally \{\s*await cli\.end\(/);
      expect(/\bconst INSPECTED_AT = new Date\(|\bconst T = new Date\(/.test(n), "mốc không được đặt thẳng").toBe(false);
    });
  }
});

describe("X-16 · khongChuaGioTron + kiểm trống bảng phụ", () => {
  const H = 3_600_000;
  const NUA = 30_000;
  it("★★★ cuaSoChuaGioTron: cửa sổ chứa ranh giờ (kể cả đúng đầu / đúng cuối) ⇒ true; nằm giữa hai ranh ⇒ false", () => {
    const mocGio = Date.UTC(2026, 9, 10, 10, 0, 0);
    expect(cuaSoChuaGioTron(new Date(mocGio + 15_000), NUA), "ranh 10:00 nằm TRONG cửa sổ 09:59:45–10:00:45").toBe(true);
    expect(cuaSoChuaGioTron(new Date(mocGio + NUA), NUA), "cửa sổ BẮT ĐẦU đúng 10:00:00.000").toBe(true);
    expect(cuaSoChuaGioTron(new Date(mocGio - NUA), NUA), "cửa sổ KẾT THÚC đúng 10:00:00.000 (thận trọng)").toBe(true);
    expect(cuaSoChuaGioTron(new Date(mocGio + NUA + 1), NUA), "đầu cửa sổ vừa quá ranh 1 ms").toBe(false);
    expect(cuaSoChuaGioTron(new Date(mocGio + H / 2), NUA)).toBe(false);
    expect(cuaSoChuaGioTron(new Date(mocGio + H - NUA - 1), NUA), "cuối cửa sổ cách ranh kế 1 ms").toBe(false);
  });
  const CH = { range_start: new Date("2026-10-01T00:00:00.000Z"), range_end: new Date("2026-11-01T00:00:00.000Z") };
  /** Bộ chạy giả: bảng chính luôn trống; `oee_metrics` bận khi tâm cửa sổ nằm trong NỬA ĐẦU chunk; đếm số truy vấn trống của bảng phụ. */
  function giaPhu() {
    const hoiPhu: string[] = [];
    const cua: Array<[number, number]> = [];
    const chay: ChayTruyVan = async (q, p) => {
      if (/range_start <= \$2 and range_end > \$3/.test(q)) return [{ co: 1 }];
      if (/timescaledb_information\.chunks/.test(q)) return [CH];
      if (/from oee_metrics where "timestamp"/.test(q)) {
        hoiPhu.push(q);
        cua.push([new Date(p[0] as string).getTime(), new Date(p[1] as string).getTime()]);
        const tam = (new Date(p[0] as string).getTime() + new Date(p[1] as string).getTime()) / 2;
        return [{ n: tam < (CH.range_start.getTime() + CH.range_end.getTime()) / 2 ? 2 : 0 }];
      }
      return [{ n: 0 }];
    };
    return { chay, hoiPhu, cua };
  }
  const goc = (ts: number, them: object = {}) => ({ bang: "product_inspections", cot: "inspectionTime", ts, macDinh: MAC_DINH, bayGio: BAY_GIO, cungBang: ["oee_metrics"], ...them });
  it("★★★ cotCungBang: bảng phụ phải TRỐNG ±nửa-độ-trống — mốc chọn được luôn ở nửa chunk mà bảng phụ trống; không có cotCungBang ⇒ KHÔNG hỏi đếm bảng phụ (hành vi cũ)", async () => {
    const giuaChunk = (CH.range_start.getTime() + CH.range_end.getTime()) / 2;
    let chon = 0;
    for (let ts = 1_800_000_000_000; ts < 1_800_000_000_000 + 400; ts += 3) {
      const { chay, cua } = giaPhu();
      const r = await chonThoiDiemTrongChunkSanCo(chay, goc(ts, { cotCungBang: { oee_metrics: "timestamp" } }));
      if (r.nguon === "chunk-san-co") {
        chon++;
        const [tu, den] = cua[cua.length - 1]!;
        expect(den - tu, "cửa sổ đếm bảng phụ rộng đúng 2 × nửa-độ-trống và từ < đến (đột biến: đảo hai mốc / cửa sổ một phía phải ĐỎ)").toBe(2 * NUA);
        expect((tu + den) / 2, "tâm cửa sổ đếm bảng phụ = mốc được chọn").toBe(r.at.getTime());
        expect(r.at.getTime(), "bảng phụ bận ở nửa đầu").toBeGreaterThan(giuaChunk);
      }
    }
    expect(chon, "nửa sau trống ⇒ phần lớn lượt chọn được").toBeGreaterThan(100);
    const cu = giaPhu();
    await chonThoiDiemTrongChunkSanCo(cu.chay, goc(1_800_000_000_123));
    expect(cu.hoiPhu, "không khai cột ⇒ không đếm bảng phụ").toHaveLength(0);
  });
  it("★★★ bảng phụ bận khắp chunk ⇒ mặc định 'khong-co-chunk-phu-hop'; tên bảng/cột phụ sai ⇒ mặc định và KHÔNG truy vấn", async () => {
    const chayBan: ChayTruyVan = async (q) => (/range_start <= \$2 and range_end > \$3/.test(q) ? [{ co: 1 }] : /timescaledb_information\.chunks/.test(q) ? [CH] : /oee_metrics/.test(q) ? [{ n: 1 }] : [{ n: 0 }]);
    expect(await chonThoiDiemTrongChunkSanCo(chayBan, goc(5, { cotCungBang: { oee_metrics: "timestamp" } }))).toEqual({ at: MAC_DINH, nguon: "mac-dinh:khong-co-chunk-phu-hop" });
    // đếm bảng phụ trả MẢNG RỖNG (không đọc được số) ⇒ coi là BẬN (fail-closed), không coi là trống
    const chayMu: ChayTruyVan = async (q) => (/range_start <= \$2 and range_end > \$3/.test(q) ? [{ co: 1 }] : /timescaledb_information\.chunks/.test(q) ? [CH] : /oee_metrics/.test(q) ? [] : [{ n: 0 }]);
    expect((await chonThoiDiemTrongChunkSanCo(chayMu, goc(5, { cotCungBang: { oee_metrics: "timestamp" } }))).nguon).toBe("mac-dinh:khong-co-chunk-phu-hop");
    for (const cotCungBang of [{ oee_metrics: 'timestamp" or 1=1 --' }, { "oee_metrics;x": "timestamp" }]) {
      const { chay, hoiPhu } = giaPhu();
      const goi: string[] = [];
      const r = await chonThoiDiemTrongChunkSanCo(async (q, p) => (goi.push(q), chay(q, p)), goc(5, { cotCungBang }));
      expect(r.nguon).toBe("mac-dinh:ten-bang-cot-khong-hop-le");
      expect(goi).toHaveLength(0);
      expect(hoiPhu).toHaveLength(0);
    }
  });
  it("★★★ khongChuaGioTron: mọi mốc chọn được có cửa sổ KHÔNG chứa ranh giờ; đối chứng: không bật thì có lượt chọn mốc chứa ranh giờ (ca không rỗng)", async () => {
    let coGioKhiTat = 0;
    let chonKhiBat = 0;
    for (let ts = 1_800_000_000_000; ts < 1_800_000_000_000 + 6000; ts += 7) {
      const tat = await chonThoiDiemTrongChunkSanCo(giaPhu().chay, goc(ts, { cungBang: [] }));
      if (tat.nguon === "chunk-san-co" && cuaSoChuaGioTron(tat.at, NUA)) coGioKhiTat++;
      const bat = await chonThoiDiemTrongChunkSanCo(giaPhu().chay, goc(ts, { cungBang: [], khongChuaGioTron: true }));
      if (bat.nguon === "chunk-san-co") {
        chonKhiBat++;
        expect(cuaSoChuaGioTron(bat.at, NUA), `ts=${ts} at=${bat.at.toISOString()}`).toBe(false);
      }
    }
    expect(coGioKhiTat, "tắt tuỳ chọn thì phải có lượt rơi vào cửa sổ chứa ranh giờ (xác suất ~1/60)").toBeGreaterThan(5);
    expect(chonKhiBat, "bật vẫn chọn được phần lớn lượt (thử 5 vị trí)").toBeGreaterThan(800);
  });
});
