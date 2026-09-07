import { describe, it, expect } from "vitest";
// ★★★ G20 — import CHÍNH module giao hàng, không chép logic sang đây.
import {
  xepKhuCho,
  nhanLineTaiCentroid,
  PHA_KHU_CHO,
  BUOC_MAC_DINH,
  MOI_COT_MAC_DINH,
} from "./khuChoVaNhanLine";

/**
 * §11 #53 (khu chờ xếp chỗ) + #54 (nhãn Line tại centroid).
 *
 * ⚠⚠ CẢ HAI ĐO TRÊN TẬP RỖNG NẾU CHỈ MỞ `/twin` (G5). Đo được trên DB dev:
 * **42 máy sống / 42 có đặt chỗ ⇒ 0 máy chưa xếp chỗ**, và banner đối soát hiện
 * đúng "0 máy chưa xếp chỗ". Nên mọi ca dưới đây DỰNG DỮ LIỆU BẰNG TAY — một
 * phép nghiệm thu "mở trang xem có khu chờ không" trên DB này trông y hệt nhau
 * dù mã đúng hay hỏng hoàn toàn.
 */
describe("#53 xepKhuCho — máy chưa đặt phải CÓ CHỖ ĐỨNG trước khi nói tới độ mờ", () => {
  it("★★★ TẤT ĐỊNH — cùng tập máy, khác thứ tự đầu vào, RA CÙNG toạ độ", () => {
    /*
     * Nếu để nguyên thứ tự DB trả, cùng một tập máy sẽ nhảy chỗ giữa hai lần
     * tải trang. Một vật thể tự di chuyển khi không ai chạm vào phá niềm tin
     * vào cả màn hình — cùng luật tất định mà `sinhBoCuc` T1-T9 đã ghim.
     */
    const a = xepKhuCho([3, 1, 2], { mepX: 0, mepZ: 0 });
    const b = xepKhuCho([2, 3, 1], { mepX: 0, mepZ: 0 });
    expect(a).toEqual(b);
    expect(a.map((m) => m.machineId)).toEqual([1, 2, 3]);
  });

  it("★★★ đứng NGOÀI mép mặt bằng (X giảm dần), KHÔNG đè lên nhà xưởng", () => {
    const ra = xepKhuCho([1, 2], { mepX: 10, mepZ: -5 });
    for (const m of ra) expect(m.viTri.x).toBeLessThan(10);
  });

  it("★★★ đứng TRÊN SÀN (`y = 0`) — không lơ lửng giữa không trung", () => {
    // Một vật thể bay đọc như lỗi render, không như một thông điệp.
    for (const m of xepKhuCho([1, 2, 3], { mepX: 0, mepZ: 0 })) expect(m.viTri.y).toBe(0);
  });

  it("KHÔNG máy nào chồng chỗ máy nào", () => {
    const ra = xepKhuCho([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], { mepX: 0, mepZ: 0 });
    const khoa = new Set(ra.map((m) => `${m.viTri.x}|${m.viTri.z}`));
    expect(khoa.size).toBe(ra.length);
  });

  it("xuống cột mới sau `MOI_COT_MAC_DINH` máy", () => {
    const ra = xepKhuCho(
      Array.from({ length: MOI_COT_MAC_DINH + 1 }, (_, i) => i + 1),
      { mepX: 0, mepZ: 0 },
    );
    // Máy thứ 11 mở cột thứ hai ⇒ X xa hơn máy thứ nhất đúng một `buoc`.
    expect(ra[MOI_COT_MAC_DINH].viTri.x).toBeCloseTo(ra[0].viTri.x - BUOC_MAC_DINH);
    expect(ra[MOI_COT_MAC_DINH].viTri.z).toBeCloseTo(ra[0].viTri.z);
  });

  it("tập RỖNG ⇒ mảng rỗng (không sinh khu chờ ma)", () => {
    expect(xepKhuCho([], { mepX: 0, mepZ: 0 })).toEqual([]);
  });

  it("★ `PHA_KHU_CHO` nhạt RÕ RỆT nhưng chưa tan hẳn vào nền", () => {
    // Là hằng có tên vì 3D và 2D phải dùng CHUNG một con số.
    expect(PHA_KHU_CHO).toBeGreaterThan(0.3);
    expect(PHA_KHU_CHO).toBeLessThan(1);
  });
});

describe("#54 nhanLineTaiCentroid — nhãn phải nằm ở NƠI CÓ THIẾT BỊ", () => {
  it("★★★ CENTROID là trung bình tâm, KHÔNG phải tâm bbox — và điều đó khác nhau", () => {
    /*
     * 3 máy chụm ở x≈0 và 1 máy lẻ ở x=100. Tâm bbox = 50 (chỗ KHÔNG CÓ GÌ);
     * trung bình tâm = 25, kéo nhãn về phía cụm thật sự có thiết bị.
     * ⇒ Ca này ĐỎ với bản cài đặt dùng tâm bbox, nên nó phân biệt được hai bản.
     */
    const [n] = nhanLineTaiCentroid([
      {
        lineId: 1,
        ma: "L1",
        ten: "Chuyền 1",
        tamVatThe: [
          { x: 0, y: 1, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 100, y: 1, z: 0 },
        ],
      },
    ]);
    expect(n.viTri.x).toBeCloseTo(25);
    expect(n.viTri.x).not.toBeCloseTo(50); // ← tâm bbox, bản SAI
  });

  it("★★★ `y` lấy MAX + hở — nhãn NỔI TRÊN đỉnh cụm, không chìm vào giữa khối", () => {
    const [n] = nhanLineTaiCentroid(
      [{ lineId: 1, ma: "L1", ten: "C1", tamVatThe: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 5, z: 0 }] }],
      2,
    );
    expect(n.viTri.y).toBe(7); // max(1,5) + 2 — KHÔNG phải trung bình (3+2=5)
  });

  it("★★★ Line KHÔNG có vật thể nào ⇒ BỎ QUA, không sinh nhãn ở gốc toạ độ", () => {
    /*
     * Một nhãn "Chuyền 3" nằm ở (0,0,0) nói rằng CÓ một chuyền ở đó, và điều đó
     * SAI — đúng lớp lỗi NT-3 "không có dữ liệu ≠ bình thường".
     */
    const ra = nhanLineTaiCentroid([
      { lineId: 1, ma: "L1", ten: "C1", tamVatThe: [] },
      { lineId: 2, ma: "L2", ten: "C2", tamVatThe: [{ x: 1, y: 1, z: 1 }] },
    ]);
    expect(ra.map((n) => n.lineId)).toEqual([2]);
  });

  it("★★★ toạ độ KHÔNG hữu hạn bị loại, không kéo centroid ra NaN/Infinity", () => {
    // Một `NaN` lọt vào trung bình sẽ làm CẢ nhãn biến mất khỏi cảnh mà không lỗi.
    const [n] = nhanLineTaiCentroid([
      {
        lineId: 1,
        ma: "L1",
        ten: "C1",
        tamVatThe: [
          { x: Number.NaN, y: 1, z: 0 },
          { x: Number.POSITIVE_INFINITY, y: 1, z: 0 },
          { x: 4, y: 1, z: 8 },
        ],
      },
    ]);
    expect(Number.isFinite(n.viTri.x)).toBe(true);
    expect(n.viTri.x).toBeCloseTo(4);
    expect(n.soVatThe).toBe(1);
  });

  it("TẤT ĐỊNH theo `lineId`, không theo thứ tự đầu vào", () => {
    const ra = nhanLineTaiCentroid([
      { lineId: 9, ma: "L9", ten: "C9", tamVatThe: [{ x: 0, y: 0, z: 0 }] },
      { lineId: 2, ma: "L2", ten: "C2", tamVatThe: [{ x: 0, y: 0, z: 0 }] },
    ]);
    expect(ra.map((n) => n.lineId)).toEqual([2, 9]);
  });
});
