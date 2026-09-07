/**
 * Test của `cayPhanCapLogic.ts` — Đợt 8 Lô B, mục #8/#9/#10/#11/#15.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TRỤC CANH NẶNG NHẤT: BÀN PHÍM ĐO TRÊN CÂY CÓ NHÁNH ĐÓNG
 * ════════════════════════════════════════════════════════════════════════════
 * Một cây MỞ HẾT làm mọi bản cài đặt bàn phím trông đúng: danh sách phẳng khi ấy
 * bằng đúng phép duyệt tiền-thứ-tự, nên cả bản đúng lẫn bản sai (đi vào con của
 * node đang gập) cho **cùng một kết quả**. Đó là G5 ở dạng cấu trúc — tập đo
 * không rỗng nhưng **không chứa ca phân biệt**.
 *
 * ⇒ Cây mẫu dưới đây cố ý có nhánh ĐÓNG nằm GIỮA, và các test ↓/→/← đều ghim
 *   rằng con của nhánh đóng KHÔNG được đi vào. Xoá điều kiện `dangMo` trong
 *   `duyetPhang` là đột biến mà bộ test này phải bắt.
 *
 * ★ G20 — bộ test này import CHÍNH module giao hàng (`./cayPhanCapLogic`), không
 *   khai lại luật. Việc component có THẬT SỰ GỌI chúng được đo riêng ở
 *   `CayPhanCap.dom.test.tsx` (render component thật trên jsdom, bấm phím thật).
 *   Thiếu vế nào cũng là "xanh mà không giao được gì" — G16.
 */
import { describe, it, expect } from "vitest";
import {
  catNhanTheoTim,
  demTrucTiep,
  duyetPhang,
  khoaCanMo,
  khoaNhanTab,
  locTheoCanhBao,
  phamViCuaNhanh,
  phamViRong,
  phimCay,
  ropCanhBao,
} from "./cayPhanCapLogic";
import {
  dungCayThietKe,
  khoaNode,
  type CayThietKe,
  type KhoaNode,
  type MayDauVao,
  type NodeCay,
} from "./trangThaiThietKe";

// ---------------------------------------------------------------------------
// Cây mẫu — DỰNG BẰNG `dungCayThietKe` THẬT, không bịa hình dạng
// ---------------------------------------------------------------------------
//
// ★ Vì sao không tự viết literal `NodeCay`: một cây bịa tay có thể có hình dạng
//   mà `dungCayThietKe` không bao giờ sinh ra (ví dụ máy nằm thẳng dưới xưởng),
//   và test khi đó đo một cấu trúc KHÔNG TỒN TẠI trong sản phẩm — đúng lớp lỗi
//   VRAM PHA 7 ("lưới đo hình dạng không tồn tại"). Dùng hàm dựng thật thì cây
//   mẫu luôn là cây hợp lệ.
//
// Hình dạng: W1 ─┬─ L1 ─┬─ S1 ─┬─ M1 (machine:1)
//                │      │      └─ M2 (machine:2)
//                │      └─ S2 ─── M3 (machine:3)
//                └─ L2 ─── S3 ─── M4 (machine:4)

function may(id: number, ma: string, stationId: number): MayDauVao {
  return { id, ma, ten: null, loaiMay: "aoi", isActive: true, stationId };
}

function dungCayMau(): CayThietKe {
  return dungCayThietKe(
    [{ id: 1, ma: "W1", ten: null, factoryId: 1, tangId: 1 }],
    [
      { id: 1, ma: "L1", ten: null, workshopId: 1 },
      { id: 2, ma: "L2", ten: null, workshopId: 1 },
    ],
    [
      { id: 1, ma: "S1", ten: null, lineId: 1, thuTu: 1 },
      { id: 2, ma: "S2", ten: null, lineId: 1, thuTu: 2 },
      { id: 3, ma: "S3", ten: null, lineId: 2, thuTu: 1 },
    ],
    [may(1, "M1", 1), may(2, "M2", 1), may(3, "M3", 2), may(4, "M4", 3)],
    [1, 2, 3, 4].map((id) => ({
      id,
      tangId: 1,
      loaiThucThe: "machine" as const,
      thucTheId: id,
      viTriXMm: 0,
      viTriYMm: 0,
      viTriZMm: 0,
      rongMm: null,
      caoMm: null,
      sauMm: null,
      kichThuocDaDo: false,
      quatX: 0,
      quatY: 0,
      quatZ: 0,
      quatW: 1,
      daKhoa: false,
      hienThi: true,
      nguon: "sinh" as const,
    })),
  );
}

const W1 = khoaNode("workshop", 1);
const L1 = khoaNode("line", 1);
const L2 = khoaNode("line", 2);
const S1 = khoaNode("station", 1);
const S2 = khoaNode("station", 2);
const S3 = khoaNode("station", 3);
const M1 = khoaNode("machine", 1);
const M2 = khoaNode("machine", 2);
const M3 = khoaNode("machine", 3);
const M4 = khoaNode("machine", 4);

describe("cây mẫu — kiểm CHÍNH CÂY trước khi đo gì trên nó", () => {
  it("dựng đúng 5 tầng ISA-95 và 4 máy", () => {
    const cay = dungCayMau();
    expect(cay.goc).toHaveLength(1);
    expect(cay.goc[0].khoa).toBe(W1);
    expect(cay.goc[0].con.map((n) => n.khoa)).toEqual([L1, L2]);
    expect(cay.theoKhoa.size).toBe(1 + 2 + 3 + 4);
    expect(cay.khuCho).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #8 — roll-up đếm
// ═══════════════════════════════════════════════════════════════════════════

describe("#8 roll-up đếm cảnh báo", () => {
  it("★★★ CHA CÓ 0 TRỰC TIẾP NHƯNG 3 CON ĐỎ PHẢI HIỆN 3, KHÔNG PHẢI 0", () => {
    // Hiện 0 nghĩa là người dùng gập nhánh lại và nhánh tự khai "sạch" — có dữ
    // liệu, và dữ liệu bị giấu.
    const cay = dungCayMau();
    const truc = demTrucTiep([M1, M2, M3]);
    const dem = ropCanhBao(cay.goc, truc);
    expect(dem.get(W1)).toBe(3);
    expect(dem.get(L1)).toBe(3);
    expect(dem.get(S1)).toBe(2);
    expect(dem.get(S2)).toBe(1);
    expect(dem.get(L2)).toBe(0);
    expect(dem.get(S3)).toBe(0);
    expect(dem.get(M1)).toBe(1);
    expect(dem.get(M4)).toBe(0);
  });

  it("★ tổng ở GỐC bằng tổng số cảnh báo gắn được — đối chiếu hai mô hình", () => {
    const cay = dungCayMau();
    const ds = [M1, M1, M2, M4];
    const dem = ropCanhBao(cay.goc, demTrucTiep(ds));
    expect(dem.get(W1)).toBe(ds.length); // mô hình 1: roll-up
    expect(dem.get(S1)! + dem.get(S2)! + dem.get(S3)!).toBe(ds.length); // mô hình 2: cộng lá
  });

  it("★★★ G8 — cây KHÔNG có cảnh báo cho bản đồ toàn 0 (không phải luôn-dương)", () => {
    const cay = dungCayMau();
    const dem = ropCanhBao(cay.goc, new Map());
    expect([...dem.values()].every((v) => v === 0)).toBe(true);
    expect(dem.size).toBe(10);
  });

  it("★ khoá NGOÀI cây bị bỏ qua — không cộng cảnh báo nhà máy khác vào tổng", () => {
    const cay = dungCayMau();
    const dem = ropCanhBao(cay.goc, demTrucTiep([M1, khoaNode("machine", 999)]));
    expect(dem.get(W1)).toBe(1);
    expect(dem.has(khoaNode("machine", 999))).toBe(false);
  });

  it("demTrucTiep cộng dồn khoá lặp", () => {
    expect(demTrucTiep([M1, M1, M2])).toEqual(new Map([[M1, 2], [M2, 1]]));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #9 — highlight
// ═══════════════════════════════════════════════════════════════════════════

describe("#9 cắt nhãn để highlight <mark>", () => {
  it("★★★ TÔ MỌI LẦN KHỚP, không chỉ lần đầu", () => {
    // Bản gốc `CommandCenter.tsx:245` dùng `indexOf` một lần: tìm "st" trên
    // "SIM-ST-ST" chỉ tô đoạn đầu, người dùng thấy một "ST" tô và một "ST" không.
    const m = catNhanTheoTim("SIM-ST-ST", "st");
    expect(m).toEqual([
      { chu: "SIM-", khop: false },
      { chu: "ST", khop: true },
      { chu: "-", khop: false },
      { chu: "ST", khop: true },
    ]);
    expect(m.filter((x) => x.khop)).toHaveLength(2);
  });

  it("★★★ trả CHỮ GỐC, không trả chữ đã hạ thường", () => {
    // Trả chữ thường làm nhãn `SIM-L1-AOI` biến thành `sim-l1-aoi` ngay khi gõ
    // tìm kiếm — nhãn tự đổi hình dạng dưới tay người dùng.
    const m = catNhanTheoTim("SIM-L1-AOI", "aoi");
    expect(m.map((x) => x.chu).join("")).toBe("SIM-L1-AOI");
    expect(m.find((x) => x.khop)?.chu).toBe("AOI");
  });

  it("★ G8 — chuỗi tìm RỖNG trả 1 mảnh chứa cả nhãn (nhãn không biến mất)", () => {
    expect(catNhanTheoTim("SIM-L1-AOI", "")).toEqual([{ chu: "SIM-L1-AOI", khop: false }]);
    expect(catNhanTheoTim("SIM-L1-AOI", "   ")).toEqual([{ chu: "SIM-L1-AOI", khop: false }]);
  });

  it("★ không khớp ⇒ 1 mảnh, không throw", () => {
    expect(catNhanTheoTim("SIM-L1-AOI", "zzz")).toEqual([{ chu: "SIM-L1-AOI", khop: false }]);
  });

  it("★ khớp TOÀN BỘ nhãn, và khớp ở ĐẦU / ở CUỐI", () => {
    expect(catNhanTheoTim("AOI", "aoi")).toEqual([{ chu: "AOI", khop: true }]);
    expect(catNhanTheoTim("AOI-1", "aoi")).toEqual([
      { chu: "AOI", khop: true },
      { chu: "-1", khop: false },
    ]);
    expect(catNhanTheoTim("1-AOI", "aoi")).toEqual([
      { chu: "1-", khop: false },
      { chu: "AOI", khop: true },
    ]);
  });

  it("★ ghép lại luôn bằng nhãn gốc — bất biến của mọi ca", () => {
    for (const q of ["", "s", "st", "sim-l1", "zzz", "1"]) {
      expect(catNhanTheoTim("SIM-L1-ST1", q).map((x) => x.chu).join("")).toBe("SIM-L1-ST1");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #10 — lọc chỉ node có cảnh báo
// ═══════════════════════════════════════════════════════════════════════════

describe("#10 lọc 'chỉ node có cảnh báo'", () => {
  it("★★★ CA DƯƠNG: cha 0 TRỰC TIẾP / con 1 ⇒ đường xuống lá phải CÒN LIỀN", () => {
    // Lọc theo số TRỰC TIẾP sẽ cắt cả xưởng ⇒ máy đỏ biến mất khỏi bộ lọc mang
    // tên "chỉ node có cảnh báo". Hỏng im lặng, ngược hẳn ý định tính năng.
    const cay = dungCayMau();
    const dem = ropCanhBao(cay.goc, demTrucTiep([M3]));
    const loc = locTheoCanhBao(cay.goc, dem);

    expect(loc).toHaveLength(1);
    expect(loc[0].khoa).toBe(W1);
    expect(loc[0].con.map((n) => n.khoa)).toEqual([L1]); // L2 (0 cảnh báo) bị cắt
    expect(loc[0].con[0].con.map((n) => n.khoa)).toEqual([S2]); // S1 bị cắt
    expect(loc[0].con[0].con[0].con.map((n) => n.khoa)).toEqual([M3]);
  });

  it("★ 0 cảnh báo ở đâu cả ⇒ cây rỗng (không phải cây nguyên vẹn)", () => {
    const cay = dungCayMau();
    expect(locTheoCanhBao(cay.goc, ropCanhBao(cay.goc, new Map()))).toEqual([]);
  });

  it("★ nhiều nhánh cùng có cảnh báo ⇒ giữ cả hai", () => {
    const cay = dungCayMau();
    const dem = ropCanhBao(cay.goc, demTrucTiep([M1, M4]));
    const loc = locTheoCanhBao(cay.goc, dem);
    expect(loc[0].con.map((n) => n.khoa)).toEqual([L1, L2]);
  });

  it("★★★ auto-expand gồm MỌI node có con, KHÔNG gồm lá", () => {
    // `aria-expanded` của lá phải là undefined (WAI-ARIA), và mở một lá vô nghĩa.
    const cay = dungCayMau();
    const mo = khoaCanMo(cay.goc);
    expect([...mo].sort()).toEqual([L1, L2, S1, S2, S3, W1].sort());
    expect(mo.has(M1)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #15 — phạm vi nhánh
// ═══════════════════════════════════════════════════════════════════════════

describe("#15 scope filter theo subtree", () => {
  it("★★★ CHỌN LÁ ⇒ phạm vi GỒM CHÍNH NÓ (không rỗng)", () => {
    // Không tính chính nó ⇒ tập rỗng ⇒ dải cảnh báo báo "không có cảnh báo" cho
    // đúng cái máy người dùng vừa click vì nó đang đỏ. G5 ở dạng độc nhất: bộ
    // lọc luôn cho tập rỗng, và tập rỗng trông y hệt "máy này ổn".
    const p = phamViCuaNhanh(dungCayMau(), M1);
    expect([...p.machineIds]).toEqual([1]);
    expect(p.khoa.has(M1)).toBe(true);
    expect(p.khoa.size).toBe(1);
  });

  it("chọn trạm ⇒ gồm trạm + máy con", () => {
    const p = phamViCuaNhanh(dungCayMau(), S1);
    expect([...p.stationIds]).toEqual([1]);
    expect([...p.machineIds].sort()).toEqual([1, 2]);
  });

  it("chọn xưởng ⇒ gồm TOÀN BỘ cây con, đủ 4 tầng", () => {
    const p = phamViCuaNhanh(dungCayMau(), W1);
    expect([...p.workshopIds]).toEqual([1]);
    expect([...p.lineIds].sort()).toEqual([1, 2]);
    expect([...p.stationIds].sort()).toEqual([1, 2, 3]);
    expect([...p.machineIds].sort()).toEqual([1, 2, 3, 4]);
    expect(p.khoa.size).toBe(10);
  });

  it("chọn chuyền L2 ⇒ KHÔNG lẫn máy của L1", () => {
    const p = phamViCuaNhanh(dungCayMau(), L2);
    expect([...p.machineIds]).toEqual([4]);
    expect(p.machineIds.has(1)).toBe(false);
  });

  it("khoá null / khoá lạ ⇒ phạm vi rỗng, không throw", () => {
    const cay = dungCayMau();
    expect(phamViCuaNhanh(cay, null).khoa.size).toBe(0);
    expect(phamViCuaNhanh(cay, "machine:999").khoa.size).toBe(0);
    expect(phamViRong().khoa.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #11 — cây phẳng + bàn phím WAI-ARIA
// ═══════════════════════════════════════════════════════════════════════════

/** Tập mở "một nửa": W1 và L1 mở, S1 mở, nhưng **S2 và L2 ĐÓNG**. */
function moMotNua(): Set<KhoaNode> {
  return new Set([W1, L1, S1]);
}

describe("#11 duyetPhang — cây con của node ĐÓNG không vào danh sách", () => {
  it("★★★ NHÁNH ĐÓNG BỊ BỎ QUA HOÀN TOÀN", () => {
    // Nếu con của nhánh gập vẫn nằm trong danh sách thì focus đi vào một hàng
    // KHÔNG TỒN TẠI trên màn: trình đọc màn hình đọc tên nó, người dùng nhìn
    // thấy con trỏ biến mất.
    const hang = duyetPhang(dungCayMau().goc, moMotNua());
    expect(hang.map((h) => h.node.khoa)).toEqual([W1, L1, S1, M1, M2, S2, L2]);
    expect(hang.map((h) => h.node.khoa)).not.toContain(M3); // con của S2 (đóng)
    expect(hang.map((h) => h.node.khoa)).not.toContain(S3); // con của L2 (đóng)
  });

  it("bậc thụt lề đúng theo tầng", () => {
    const hang = duyetPhang(dungCayMau().goc, moMotNua());
    expect(hang.map((h) => h.bac)).toEqual([0, 1, 2, 3, 3, 2, 1]);
  });

  it("cờ mo/coCon: lá luôn coCon=false, mo=false", () => {
    const hang = duyetPhang(dungCayMau().goc, moMotNua());
    const m1 = hang.find((h) => h.node.khoa === M1)!;
    expect(m1.coCon).toBe(false);
    expect(m1.mo).toBe(false);
    const s2 = hang.find((h) => h.node.khoa === S2)!;
    expect(s2.coCon).toBe(true);
    expect(s2.mo).toBe(false);
  });

  it("tập mở RỖNG ⇒ chỉ còn hàng gốc", () => {
    expect(duyetPhang(dungCayMau().goc, new Set()).map((h) => h.node.khoa)).toEqual([W1]);
  });

  it("mở HẾT ⇒ đủ 10 hàng", () => {
    const cay = dungCayMau();
    expect(duyetPhang(cay.goc, khoaCanMo(cay.goc))).toHaveLength(10);
  });
});

describe("#11 phimCay — ↑ ↓ Home End", () => {
  const hang = () => duyetPhang(dungCayMau().goc, moMotNua()); // [W1,L1,S1,M1,M2,S2,L2]

  it("↓ đi xuống hàng KẾ TIẾP theo thứ tự thị giác", () => {
    expect(phimCay(hang(), W1, "ArrowDown")?.focus).toBe(L1);
    expect(phimCay(hang(), M1, "ArrowDown")?.focus).toBe(M2);
  });

  it("★★★ ↓ TỪ HÀNG CUỐI CỦA NHÁNH MỞ NHẢY SANG ANH EM, KHÔNG CHUI VÀO NHÁNH ĐÓNG", () => {
    // M2 là máy cuối của S1. Hàng sau nó là S2 (trạm anh em), KHÔNG phải M3
    // (con của S2 đang gập).
    expect(phimCay(hang(), M2, "ArrowDown")?.focus).toBe(S2);
    // Và từ S2 (đang ĐÓNG) đi tiếp là L2, bỏ qua M3.
    expect(phimCay(hang(), S2, "ArrowDown")?.focus).toBe(L2);
  });

  it("↑ đi ngược lại", () => {
    expect(phimCay(hang(), L2, "ArrowUp")?.focus).toBe(S2);
    expect(phimCay(hang(), M1, "ArrowUp")?.focus).toBe(S1);
  });

  it("★★★ ↑ ở hàng ĐẦU và ↓ ở hàng CUỐI: DỪNG, không cuộn vòng", () => {
    // Cuộn vòng trên cây dài làm mất cảm giác về biên (APG quy định dừng).
    expect(phimCay(hang(), W1, "ArrowUp")?.focus).toBeNull();
    expect(phimCay(hang(), L2, "ArrowDown")?.focus).toBeNull();
  });

  it("Home/End đi tới hàng đầu / hàng CUỐI ĐANG NHÌN THẤY", () => {
    expect(phimCay(hang(), M1, "Home")?.focus).toBe(W1);
    expect(phimCay(hang(), W1, "End")?.focus).toBe(L2); // KHÔNG phải M4 (đang bị gập)
  });
});

describe("#11 phimCay — → ← phụ thuộc trạng thái mở/đóng", () => {
  const hang = () => duyetPhang(dungCayMau().goc, moMotNua());

  it("★★★ → trên node ĐÓNG thì MỞ nó (focus giữ nguyên)", () => {
    const v = phimCay(hang(), S2, "ArrowRight")!;
    expect(v.mo).toBe(S2);
    expect(v.focus).toBeNull();
  });

  it("★★★ → trên node ĐANG MỞ thì ĐI VÀO CON ĐẦU (không mở lại)", () => {
    // Đây là hành vi APG và là thứ phân biệt một cây thật với một danh sách có
    // mũi tên. Bản `CommandCenter.tsx:335` chỉ làm nửa đầu (`&& !isOpen`).
    const v = phimCay(hang(), S1, "ArrowRight")!;
    expect(v.focus).toBe(M1);
    expect(v.mo).toBeNull();
  });

  it("★ → trên LÁ không làm gì", () => {
    const v = phimCay(hang(), M1, "ArrowRight")!;
    expect(v).toEqual({ focus: null, mo: null, dong: null, chon: null });
  });

  it("★★★ ← trên node ĐANG MỞ thì ĐÓNG nó", () => {
    const v = phimCay(hang(), S1, "ArrowLeft")!;
    expect(v.dong).toBe(S1);
    expect(v.focus).toBeNull();
  });

  it("★★★ ← trên node ĐÓNG (hoặc lá) thì LÊN CHA", () => {
    expect(phimCay(hang(), M1, "ArrowLeft")?.focus).toBe(S1);
    expect(phimCay(hang(), S2, "ArrowLeft")?.focus).toBe(L1);
    expect(phimCay(hang(), L2, "ArrowLeft")?.focus).toBe(W1);
  });

  it("★ ← trên GỐC đang đóng: không throw, không cuộn về cuối cây", () => {
    const chiGoc = duyetPhang(dungCayMau().goc, new Set());
    expect(phimCay(chiGoc, W1, "ArrowLeft")).toEqual({
      focus: null, mo: null, dong: null, chon: null,
    });
  });

  it("★★★ ← LÊN CHA đi theo DANH SÁCH PHẲNG, không theo node.cha", () => {
    // Khi cây bị LỌC, cha thật có thể không nằm trên màn. Ở đây lọc còn đúng
    // W1→L1→S2→M3; ← từ M3 phải về S2 (hàng trên màn), và tiếp là L1.
    const cay = dungCayMau();
    const loc = locTheoCanhBao(cay.goc, ropCanhBao(cay.goc, demTrucTiep([M3])));
    const h = duyetPhang(loc, khoaCanMo(loc));
    expect(h.map((x) => x.node.khoa)).toEqual([W1, L1, S2, M3]);
    // M3 là LÁ ⇒ ← lên cha. Cha THẬT của M3 là S2, và ở đây S2 cũng là hàng trên
    // màn — nhưng phép tìm đi theo BẬC trong danh sách phẳng, không theo `node.cha`.
    expect(phimCay(h, M3, "ArrowLeft")?.focus).toBe(S2);

    // Ca phân biệt thật: S2 ĐÓNG lại (nên ← trên nó là "lên cha", không phải
    // "đóng"). Cha THẬT của S2 là L1 — và L1 vẫn trên màn, nhưng S1 (anh em của
    // S2, cùng bậc) đã bị lọc mất. Phép tìm phải nhảy qua bậc, không dừng ở
    // hàng liền trước.
    const dong = new Set([W1, L1]); // S2 KHÔNG mở
    const h2 = duyetPhang(loc, dong);
    expect(h2.map((x) => x.node.khoa)).toEqual([W1, L1, S2]);
    expect(phimCay(h2, S2, "ArrowLeft")?.focus).toBe(L1);
  });

  it("★★★ → trên node mở LẤY CON ĐẦU ĐANG NHÌN THẤY, không lấy node.con[0]", () => {
    // Cây đã lọc: con thật đầu tiên của L1 là S1, nhưng S1 đã bị cắt khỏi màn.
    // Lấy `node.con[0]` sẽ đưa focus vào hàng vô hình.
    const cay = dungCayMau();
    const loc = locTheoCanhBao(cay.goc, ropCanhBao(cay.goc, demTrucTiep([M3])));
    const h = duyetPhang(loc, khoaCanMo(loc));
    expect(cay.theoKhoa.get(L1)!.con[0].khoa).toBe(S1); // con thật đầu tiên
    expect(phimCay(h, L1, "ArrowRight")?.focus).toBe(S2); // con ĐANG NHÌN THẤY
  });
});

describe("#11 phimCay — Enter/Space và các ca G8", () => {
  const hang = () => duyetPhang(dungCayMau().goc, moMotNua());

  it("Enter và Space đều KÍCH HOẠT node đang focus", () => {
    expect(phimCay(hang(), M1, "Enter")?.chon).toBe(M1);
    expect(phimCay(hang(), M1, " ")?.chon).toBe(M1);
  });

  it("★★★ G8 — PHÍM LẠ TRẢ null (không được preventDefault ⇒ không nhốt Tab)", () => {
    // Nếu hàm luôn trả một việc thì `preventDefault` nuốt cả Tab và người dùng
    // bàn phím bị NHỐT TRONG CÂY — lỗi trợ năng nặng hơn hẳn lỗi nó đang vá.
    for (const p of ["Tab", "Escape", "a", "PageDown", "Shift"]) {
      expect(phimCay(hang(), M1, p)).toBeNull();
    }
  });

  it("★ danh sách RỖNG ⇒ null cho mọi phím", () => {
    expect(phimCay([], null, "ArrowDown")).toBeNull();
    expect(phimCay([], M1, "Enter")).toBeNull();
  });

  it("★ chưa có focus ⇒ phím điều hướng đưa về HÀNG ĐẦU (không im lặng)", () => {
    expect(phimCay(hang(), null, "ArrowDown")?.focus).toBe(W1);
    expect(phimCay(hang(), null, "ArrowUp")?.focus).toBe(W1);
    // Nhưng Enter khi chưa focus gì thì không chọn bừa hàng đầu.
    expect(phimCay(hang(), null, "Enter")).toBeNull();
  });

  it("★ focus trỏ vào hàng đã bị LỌC MẤT ⇒ đưa về hàng đầu, không throw", () => {
    expect(phimCay(hang(), M3, "ArrowDown")?.focus).toBe(W1);
  });

  it("Home/End vẫn chạy khi chưa có focus", () => {
    expect(phimCay(hang(), null, "Home")?.focus).toBe(W1);
    expect(phimCay(hang(), null, "End")?.focus).toBe(L2);
  });
});

describe("#11 khoaNhanTab — roving tabindex", () => {
  const hang = () => duyetPhang(dungCayMau().goc, moMotNua());

  it("★★★ ĐÚNG MỘT hàng nhận tabIndex=0", () => {
    // Cho mọi hàng tabIndex=0 biến một cây 82 máy thành 82 chặng Tab.
    const k = khoaNhanTab(hang(), null, []);
    const so = hang().filter((h) => h.node.khoa === k).length;
    expect(so).toBe(1);
  });

  it("ưu tiên 1 — node đang FOCUS", () => {
    expect(khoaNhanTab(hang(), M2, [M1])).toBe(M2);
  });

  it("★★★ ưu tiên 2 — node đang CHỌN (Tab vào cây rơi đúng máy chọn từ 3D)", () => {
    expect(khoaNhanTab(hang(), null, [M1])).toBe(M1);
    // Phần tử CUỐI của tập chọn là node chủ đạo.
    expect(khoaNhanTab(hang(), null, [M1, M2])).toBe(M2);
  });

  it("ưu tiên 3 — hàng ĐẦU khi không có gì", () => {
    expect(khoaNhanTab(hang(), null, [])).toBe(W1);
  });

  it("★ focus/chọn trỏ ra NGOÀI màn (bị lọc mất) ⇒ rơi về hàng đầu", () => {
    expect(khoaNhanTab(hang(), M3, [])).toBe(W1);
    expect(khoaNhanTab(hang(), null, [M3])).toBe(W1);
    // Chọn nhiều, chỉ một cái còn trên màn ⇒ lấy cái còn.
    expect(khoaNhanTab(hang(), null, [M1, M3])).toBe(M1);
  });

  it("★ danh sách rỗng ⇒ null (không có hàng nào để gắn)", () => {
    expect(khoaNhanTab([], M1, [M1])).toBeNull();
  });
});
