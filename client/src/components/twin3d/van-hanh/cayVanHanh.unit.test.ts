import { describe, it, expect } from "vitest";
// ★★★ G20 — import CHÍNH module giao hàng, không chép logic sang đây.
import { demMayTrucTiep, dieuHuongTuKhoa, lineCuaMay, tapChonTuUrl } from "./cayVanHanh";
// ★★★ Và import CHÍNH `ropCanhBao` mà component dùng — nếu test tự viết một
//     phép cộng riêng thì nó đo phép cộng CỦA NÓ, không đo cái đang giao hàng.
import { ropCanhBao } from "../thiet-ke/cayPhanCapLogic";
import { dungCayThietKe, khoaNode } from "../thiet-ke/trangThaiThietKe";

/**
 * Đợt 22 · Z4 (G-7) — cây phân cấp đa site có roll-up cho màn **Vận hành**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO DỰNG CÂY BẰNG TAY CHỨ KHÔNG DÙNG DB (G5)
 * ════════════════════════════════════════════════════════════════════════════
 * DB dev có **2 nhà máy / 43 máy / 82 đặt chỗ**, và một phép nghiệm thu kiểu
 * "mở `/twin` xem cây có hiện không" sẽ **trông y hệt nhau** dù roll-up cộng
 * đúng, cộng nhầm khu chờ vào nhánh chính, hay không cộng gì. Mọi ca dưới đây
 * dựng dữ liệu tay để con số kỳ vọng **tính được bằng đầu**, và ca âm đứng cạnh
 * ca dương để chỉ báo phải biết KÊU.
 */

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Đồ gá — một nhà máy nhỏ tính nhẩm được                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Cây mẫu, cố ý KHÔNG cân:
 *
 *   xưởng 1 ─┬─ line 1 ─┬─ trạm 1 ── máy 1, máy 2      (2 máy)
 *            │          └─ trạm 2 ── máy 3             (1 máy)
 *            └─ line 2 ──── trạm 3 ── (rỗng)           (0 máy)
 *   ── khu chờ: máy 9 (có `stationId` NHƯNG chưa đặt chỗ)
 *
 * ⇒ line 1 = 3 · line 2 = 0 · xưởng 1 = 3 (KHÔNG phải 4 — máy 9 ở khu chờ).
 */
function cayMau() {
  return dungCayThietKe(
    [{ id: 1, ma: "X1", ten: "Xuong 1", factoryId: 1 }],
    [
      { id: 1, ma: "L1", ten: "Line 1", workshopId: 1 },
      { id: 2, ma: "L2", ten: "Line 2", workshopId: 1 },
    ],
    [
      { id: 1, ma: "T1", ten: "Tram 1", lineId: 1, thuTu: 1 },
      { id: 2, ma: "T2", ten: "Tram 2", lineId: 1, thuTu: 2 },
      { id: 3, ma: "T3", ten: "Tram 3", lineId: 2, thuTu: 1 },
    ],
    [
      { id: 1, ma: "M1", ten: "May 1", loaiMay: "aoi", isActive: true, stationId: 1 },
      { id: 2, ma: "M2", ten: "May 2", loaiMay: "aoi", isActive: true, stationId: 1 },
      { id: 3, ma: "M3", ten: "May 3", loaiMay: "avi", isActive: true, stationId: 2 },
      // ★ Máy 9 có trạm NHƯNG không có `twin_dat_cho` ⇒ `dungCayThietKe` đẩy nó
      //   sang `khuCho`. Đây là máy làm ca "khu chờ không được cộng vào" đo được.
      { id: 9, ma: "M9", ten: "May 9", loaiMay: "aoi", isActive: true, stationId: 3 },
    ],
    [
      { loaiThucThe: "machine", thucTheId: 1 },
      { loaiThucThe: "machine", thucTheId: 2 },
      { loaiThucThe: "machine", thucTheId: 3 },
    ],
  );
}

/** Roll-up số máy — đúng đường mà component đi (`ropCanhBao` + `demMayTrucTiep`). */
function ropMay(cay: ReturnType<typeof cayMau>) {
  return ropCanhBao([...cay.goc, ...cay.khuCho], demMayTrucTiep(cay));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 1. ROLL-UP SỐ MÁY                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("Z4 · demMayTrucTiep + ropCanhBao — roll-up SỐ MÁY", () => {
  it("★★★ CỘNG DỒN LÊN CHA — line có 3 máy phải hiện 3, không phải 0", () => {
    /*
     * Đây là luật trung tâm của G-7. Một `line:` KHÔNG mang máy trực tiếp (máy
     * treo dưới `station:`), nên nếu roll-up hỏng thì con số của nó là **0** —
     * và người dùng gập nhánh lại thì nhánh tự khai là rỗng. Cùng lớp lỗi mà
     * `ropCanhBao` docblock gọi là "có dữ liệu, và dữ liệu bị giấu".
     */
    const dem = ropMay(cayMau());
    expect(dem.get(khoaNode("line", 1))).toBe(3);
    expect(dem.get(khoaNode("station", 1))).toBe(2);
    expect(dem.get(khoaNode("station", 2))).toBe(1);
    expect(dem.get(khoaNode("workshop", 1))).toBe(3);
  });

  it("★★★ CA ÂM (G8) — cây KHÔNG máy nào cho roll-up **0 ở mọi cấp**", () => {
    // Chỉ báo chỉ biết nói "có" thì không đo gì. Ca này ghim vế "không".
    const rong = dungCayThietKe(
      [{ id: 1, ma: "X1", ten: "X", factoryId: 1 }],
      [{ id: 1, ma: "L1", ten: "L", workshopId: 1 }],
      [{ id: 1, ma: "T1", ten: "T", lineId: 1, thuTu: 1 }],
      [],
      [],
    );
    const dem = ropCanhBao([...rong.goc, ...rong.khuCho], demMayTrucTiep(rong));
    expect(demMayTrucTiep(rong).size).toBe(0);
    expect(dem.get(khoaNode("line", 1))).toBe(0);
    expect(dem.get(khoaNode("workshop", 1))).toBe(0);
  });

  it("nhánh RỖNG THẬT hiện 0 — line 2 có trạm nhưng không máy nào", () => {
    const dem = ropMay(cayMau());
    expect(dem.get(khoaNode("line", 2))).toBe(0);
    expect(dem.get(khoaNode("station", 3))).toBe(0);
  });

  it("★★★ MÁY KHU CHỜ **KHÔNG** cộng vào nhánh chính (hai mẫu số — G9)", () => {
    /*
     * Máy 9 có `stationId = 3` (thuộc line 2 trên giấy tờ) nhưng chưa có đặt
     * chỗ ⇒ nó KHÔNG đứng trên sàn. Nếu nó lọt vào tổng của line 2 thì con số
     * "0 máy" của line ấy thành "1", và người vận hành đi tìm một cái máy không
     * có ở đó. Tổng nhánh chính = số máy ĐỨNG TRÊN SÀN, đúng một câu.
     */
    const cay = cayMau();
    const dem = ropMay(cay);
    expect(cay.khuCho.map((n) => n.khoa)).toContain(khoaNode("machine", 9));
    expect(dem.get(khoaNode("line", 2))).toBe(0);
    expect(dem.get(khoaNode("workshop", 1))).toBe(3);
    // ...nhưng chính nó vẫn đếm được (nó là node máy trong `khuCho`).
    expect(dem.get(khoaNode("machine", 9))).toBe(1);
  });

  it("★ mỗi node MÁY tự nó là 1 — mẫu số của lá", () => {
    const dem = ropMay(cayMau());
    for (const id of [1, 2, 3]) expect(dem.get(khoaNode("machine", id))).toBe(1);
  });

  it("★★★ SỐ MÁY và SỐ CẢNH BÁO là HAI bản đồ RỜI (chống lớp lỗi §13d Z3)", () => {
    /*
     * Cùng một cây, hai bản đồ đầu vào khác nhau phải cho hai kết quả khác
     * nhau. Nếu ai đó gộp chúng lại thì hai lời gọi dưới đây trả CÙNG một thứ —
     * và badge "6" trên một line 6 máy / 0 cảnh báo sẽ đọc như 6 cảnh báo.
     */
    const cay = cayMau();
    const may = ropCanhBao([...cay.goc, ...cay.khuCho], demMayTrucTiep(cay));
    const canhBao = ropCanhBao(
      [...cay.goc, ...cay.khuCho],
      new Map([[khoaNode("machine", 1), 2]]),
    );
    expect(may.get(khoaNode("line", 1))).toBe(3);
    expect(canhBao.get(khoaNode("line", 1))).toBe(2);
    expect(may.get(khoaNode("line", 1))).not.toBe(canhBao.get(khoaNode("line", 1)));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 2. ĐIỀU HƯỚNG — khoá node → URL `/twin`                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("Z4 · dieuHuongTuKhoa — cây CHỈ ĐỌC, chạm = ĐIỀU HƯỚNG", () => {
  it("★★★ LINE — ca DUY NHẤT khớp một-một với `PhamVi`", () => {
    expect(dieuHuongTuKhoa(khoaNode("line", 7))).toEqual({
      phamVi: { cap: "line", id: 7 },
      chon: { loai: "line", id: 7 },
    });
  });

  it("★★★ MÁY — mở panel bằng `chon`, KHÔNG đổi `pv` (§11 lô G: không redirect)", () => {
    const ra = dieuHuongTuKhoa(khoaNode("machine", 114));
    expect(ra).toEqual({ phamVi: null, chon: { loai: "machine", id: 114 } });
    // `phamVi: null` = GIỮ NGUYÊN, không phải "về gốc". Ghim để bản vá sau không
    // lặng lẽ đổi nghĩa `null` thành `{cap:"nhaMay", id:null}`.
    expect(ra?.phamVi).toBeNull();
  });

  it("TRẠM — chỉ `chon` (thang `PhamVi` không có cấp trạm)", () => {
    expect(dieuHuongTuKhoa(khoaNode("station", 4))).toEqual({
      phamVi: null,
      chon: { loai: "station", id: 4 },
    });
  });

  it("★★★ XƯỞNG — KHÔNG đi đâu cả, và đó là câu trả lời CÓ CHỦ ĐÍCH", () => {
    /*
     * Xưởng KHÔNG phải tầng (`XuongThietKe.tsx:252`). Đưa `?pv=tang:<idXuong>`
     * sẽ nạp tầng của một toà nhà khác **mà không lỗi nào nổ** — đúng lớp "sai
     * mà không kêu". Nên node xưởng chỉ để gộp/mở-gập.
     */
    expect(dieuHuongTuKhoa(khoaNode("workshop", 1))).toEqual({ phamVi: null, chon: null });
  });

  it("khoá RÁC ⇒ `null` (không đoán bừa một điều hướng)", () => {
    expect(dieuHuongTuKhoa("khong-phai-khoa")).toBeNull();
    expect(dieuHuongTuKhoa("machine:0")).toBeNull();
    expect(dieuHuongTuKhoa("machine:-3")).toBeNull();
    expect(dieuHuongTuKhoa("")).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 3. ĐỒNG BỘ NGƯỢC — URL → khoá node đang chọn                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("Z4 · tapChonTuUrl — vế NGƯỢC của đồng bộ hai chiều", () => {
  it("★★★ chọn máy trong 3D ⇒ cây đánh dấu ĐÚNG máy đó", () => {
    expect(tapChonTuUrl({ loai: "machine", id: 12 }, { cap: "nhaMay", id: 1 })).toEqual([
      khoaNode("machine", 12),
    ]);
  });

  it("★★★ KHÔNG có `chon` mà `pv=line:3` ⇒ đánh dấu node line 3", () => {
    // Thiếu nhánh này thì tới `/twin?pv=line:3` bằng breadcrumb để cây trống trơn.
    expect(tapChonTuUrl(null, { cap: "line", id: 3 })).toEqual([khoaNode("line", 3)]);
  });

  it("`chon` THẮNG `pv` — nó là thứ người dùng vừa chạm gần nhất", () => {
    expect(tapChonTuUrl({ loai: "machine", id: 5 }, { cap: "line", id: 3 })).toEqual([
      khoaNode("machine", 5),
    ]);
  });

  it("★ `factory` KHÔNG có node trong cây ⇒ RỖNG, không đánh dấu bừa", () => {
    expect(tapChonTuUrl({ loai: "factory", id: 1 }, { cap: "nhaMay", id: 1 })).toEqual([]);
  });

  it("★★★ CA ÂM — phạm vi nhà máy, không `chon` ⇒ RỖNG (G8)", () => {
    expect(tapChonTuUrl(null, { cap: "nhaMay", id: 1 })).toEqual([]);
    expect(tapChonTuUrl(null, { cap: "tapDoan", id: null })).toEqual([]);
    expect(tapChonTuUrl(null, { cap: "line", id: null })).toEqual([]);
  });

  it("★★★ khoá sinh ra ĐỌC NGƯỢC ĐƯỢC bởi `dieuHuongTuKhoa` (vòng tròn khép)", () => {
    /*
     * G12 — hai bản cài đặt hiếm khi chỉ lệch một chỗ. Hai hàm này dùng CÙNG
     * `khoaNode`/`tachKhoaNode`, và ca này ghim điều đó: đi ra rồi đi vào phải
     * về đúng chỗ cũ. Nếu ai đó đổi công thức khoá ở một bên, ca này đỏ.
     */
    const khoa = tapChonTuUrl({ loai: "machine", id: 77 }, { cap: "nhaMay", id: 1 })[0];
    expect(dieuHuongTuKhoa(khoa)?.chon).toEqual({ loai: "machine", id: 77 });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 4. LINE CỦA MÁY                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("Z4 · lineCuaMay", () => {
  const stationCuaMay = new Map<number, number | null>([
    [1, 10],
    [2, 20],
    [3, null],
  ]);
  const lineCuaTram = new Map<number, number>([[10, 100]]);

  it("máy → trạm → line", () => {
    expect(lineCuaMay(1, stationCuaMay, lineCuaTram)).toBe(100);
  });

  it("★★★ trạm KHÔNG tra ra line ⇒ `null` = GIỮ NGUYÊN phạm vi", () => {
    // Trạm 20 không có trong `lineCuaTram` (dữ liệu hẹp hơn schema — G19).
    expect(lineCuaMay(2, stationCuaMay, lineCuaTram)).toBeNull();
  });

  it("máy KHÔNG có trạm ⇒ `null`", () => {
    expect(lineCuaMay(3, stationCuaMay, lineCuaTram)).toBeNull();
  });

  it("★ máy KHÔNG có trong bản đồ ⇒ `null`, không ném", () => {
    expect(lineCuaMay(999, stationCuaMay, lineCuaTram)).toBeNull();
  });
});
