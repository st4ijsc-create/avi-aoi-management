/**
 * vungAnToan.ts — TOÁN của vùng 3D translucent + nhãn (§11.1 #5) và của CRUD
 * vùng an toàn (§11.7 #42).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐO ĐƯỢC TRƯỚC KHI VIẾT (Đợt 7, §11c.4): `twin_vat_the` = 4 hàng, TOÀN
 *     `loai='tuong'`, **0 hàng `'vung'`**.
 * ════════════════════════════════════════════════════════════════════════════
 * Nghĩa là mục #5 chưa làm **ở cả tầng dữ liệu**, và mọi test viết trên dữ liệu
 * hiện có sẽ là test trên tập rỗng (G5). Ca dương phải do chính test dựng ra —
 * xem `vungAnToan.unit.test.ts`, và ca dương trên DB thật do phiên đo dựng rồi
 * khôi phục byte-exact.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẪY HOÁN VỊ TRỤC — `diemDa` LÀ [xMm, yMm] CỦA HỆ DB
 * ════════════════════════════════════════════════════════════════════════════
 * Cột `diemDa` của `twin_vat_the` là polygon MẶT BẰNG: `[[xMm, yMm], …]`, trong
 * đó `yMm` là trục mặt bằng hướng XUỐNG (§5.2), **không phải độ cao**. Độ cao
 * nằm ở `viTriZMm` (chân vùng) và `caoMm` (chiều dày).
 *
 * Quy sang scene: `x → scene.x`, `yMm → scene.z`, độ cao → `scene.y`.
 * Nhầm `yMm` thành độ cao dựng ra một bức tường dựng đứng thay vì một vùng nằm
 * trên sàn — và **không gì nổ**, nó vẫn là một mesh hợp lệ, vẫn translucent,
 * vẫn có nhãn. Test `diemDa-yMm-la-mat-bang-khong-phai-do-cao` canh chỗ này.
 *
 * ★ Module THUẦN: không three, không react. Tất định.
 */

import { bboxRong, mmSangMet, type BBox, type DiemScene } from "../heToaDo";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Hằng số                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Độ mờ mặc định của vùng — 0,22.
 *
 * §10.1 (ISA-101) đòi vùng an toàn KHÔNG được cạnh tranh chú ý với màu trạng
 * thái máy. Đặc hơn ~0,35 thì vùng che mất máy đứng trong nó; nhạt hơn ~0,12
 * thì trên nền sàn sáng nó biến mất hẳn và người dùng tưởng chưa vẽ được gì.
 */
export const DO_MO_VUNG = 0.22;

/** Độ mờ khi vùng đang được chọn — đủ nổi để biết mình chọn đúng cái nào. */
export const DO_MO_VUNG_CHON = 0.4;

/** Chiều dày mặc định của vùng (mm) khi `caoMm` NULL — 1 mm: một lớp sơn sàn. */
export const DAY_VUNG_MAC_DINH_MM = 1;

/** Độ nhấc khỏi sàn (mét) để tránh z-fighting với mặt sàn. */
export const NHAC_KHOI_SAN_M = 0.012;

/** Màu mặc định khi hàng DB không có `mau` — hổ phách cảnh báo, §10.2. */
export const MAU_VUNG_MAC_DINH = "#f59e0b";

/** Số đỉnh tối thiểu để polygon có diện tích. */
export const SO_DINH_TOI_THIEU = 3;

/** Số đỉnh tối đa nhận từ UI — chặn một cú kéo lỗi tạo 100k đỉnh. */
export const SO_DINH_TOI_DA = 200;

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Kiểu                                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Một đỉnh polygon trong hệ DB, milimét, mặt bằng. */
export interface DinhMm {
  xMm: number;
  yMm: number;
}

/** Hàng `twin_vat_the` với `loai='vung'`, đúng hình dạng server trả về. */
export interface HangVung {
  id: number;
  ten: string;
  /** `diemDa` — polygon mặt bằng mm. Có thể NULL/rỗng ở hàng hỏng. */
  diemDa: readonly (readonly [number, number])[] | null;
  viTriZMm: number;
  caoMm: number | null;
  mau: string | null;
  hienThi: boolean;
}

/** Vùng đã sẵn sàng vẽ trong scene (mét). */
export interface VungVe {
  khoa: string;
  ten: string;
  /** Polygon trên mặt phẳng X–Z của scene, mét. */
  dinh: { x: number; z: number }[];
  /** Cao độ mặt trên của vùng (scene.y, mét). */
  caoDoY: number;
  dayM: number;
  mau: string;
  doMo: number;
  /** Điểm đặt nhãn — trọng tâm đa giác, hệ scene. */
  nhan: DiemScene;
  /** Diện tích mặt bằng, m². Hiện trong Inspector; 0 = polygon suy biến. */
  dienTichM2: number;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Kiểm tra polygon                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Polygon hợp lệ để LƯU? Đây là cổng của #42 — đường ghi.
 *
 * ★ LUẬT G8 — đầu vào làm hàm này trả FALSE, liệt kê tường minh để chỉ báo này
 *   không phải một hằng `true` trá hình:
 *     `[]`                                    → false (0 đỉnh)
 *     `[[0,0],[100,0]]`                       → false (2 đỉnh, không có diện tích)
 *     201 đỉnh                                → false (quá trần)
 *     `[[0,0],[100,0],[NaN,50]]`              → false (toạ độ không hữu hạn)
 *     `[[0,0],[100,0],[200,0]]`               → false (thẳng hàng ⇒ diện tích 0)
 */
export function polygonHopLe(dinh: readonly DinhMm[] | null | undefined): boolean {
  if (!dinh || dinh.length < SO_DINH_TOI_THIEU || dinh.length > SO_DINH_TOI_DA) return false;
  for (const d of dinh) {
    if (!Number.isFinite(d.xMm) || !Number.isFinite(d.yMm)) return false;
  }
  return dienTichCoDauMm2(dinh) !== 0;
}

/**
 * Diện tích CÓ DẤU (mm²) theo công thức dây giày. Dấu cho biết chiều quay:
 * dương = ngược kim đồng hồ trong hệ toán học. Ta cần giá trị có dấu vì
 * {@link trongTam} chia cho nó — lấy trị tuyệt đối quá sớm sẽ lật trọng tâm của
 * polygon quay theo chiều kia sang phía đối diện.
 */
export function dienTichCoDauMm2(dinh: readonly DinhMm[]): number {
  const n = dinh.length;
  if (n < SO_DINH_TOI_THIEU) return 0;
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const a = dinh[i];
    const b = dinh[(i + 1) % n];
    s += a.xMm * b.yMm - b.xMm * a.yMm;
  }
  return s / 2;
}

/** Diện tích mặt bằng, m². Luôn không âm. */
export function dienTichM2(dinh: readonly DinhMm[]): number {
  return Math.abs(dienTichCoDauMm2(dinh)) / 1e6;
}

/**
 * Trọng tâm DIỆN TÍCH của đa giác (mm).
 *
 * ★★★ KHÔNG dùng trung bình cộng các đỉnh. Trung bình đỉnh phụ thuộc **mật độ
 *   đỉnh**, không phụ thuộc hình dạng: chia đôi một cạnh (thêm một đỉnh giữa,
 *   hình dạng KHÔNG đổi) đã kéo trung bình đỉnh dịch đi. Trọng tâm diện tích
 *   bất biến với phép đó.
 *
 * ⚠ **KHÔNG hứa nằm trong đa giác.** Với đa giác lõm, trọng tâm diện tích vẫn
 *   có thể rơi vào chỗ lõm — đo được: chữ L `(0,0)-(12,0)-(12,4)-(3,4)-(3,12)-
 *   (0,12)` (mét) cho trọng tâm `(4.5, 4.0)` nằm NGOÀI. Vì thế **nhãn KHÔNG
 *   dùng thẳng hàm này** mà đi qua {@link diemDatNhan}, hàm có bảo đảm.
 *   Đây là chỗ dễ khai quá tay nhất của module; ghi rõ giới hạn thay vì hứa.
 *
 * Polygon suy biến (diện tích 0) rơi về trung bình đỉnh — ở đó không có trọng
 * tâm diện tích nào để tính, và trung bình đỉnh là câu trả lời duy nhất không
 * phải NaN.
 */
export function trongTam(dinh: readonly DinhMm[]): DinhMm {
  const n = dinh.length;
  if (n === 0) return { xMm: 0, yMm: 0 };
  const dt = dienTichCoDauMm2(dinh);
  if (dt === 0) {
    let sx = 0;
    let sy = 0;
    for (const d of dinh) {
      sx += d.xMm;
      sy += d.yMm;
    }
    return { xMm: sx / n, yMm: sy / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = dinh[i];
    const b = dinh[(i + 1) % n];
    const chung = a.xMm * b.yMm - b.xMm * a.yMm;
    cx += (a.xMm + b.xMm) * chung;
    cy += (a.yMm + b.yMm) * chung;
  }
  return { xMm: cx / (6 * dt), yMm: cy / (6 * dt) };
}

/**
 * Điểm ĐẶT NHÃN — **bảo đảm nằm trong đa giác** (khi đa giác có diện tích).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHÔNG DÙNG THẲNG `trongTam`
 * ════════════════════════════════════════════════════════════════════════════
 * `trongTam` là trọng tâm diện tích — đúng về mặt toán, nhưng với vùng lõm nó
 * rơi ra ngoài (xem docblock của nó, kèm ca đo được). Hậu quả người dùng thấy:
 * nhãn "Vùng an toàn robot" nổi **giữa lối đi**, cách vùng nó gọi tên vài mét.
 * Không lỗi nào nổ, và nghiệm thu thị giác trên một vùng hình chữ nhật (ca phổ
 * biến nhất) sẽ **không bao giờ** bắt được.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THUẬT TOÁN — quét ngang, chọn NHỊP TRONG DÀI NHẤT
 * ════════════════════════════════════════════════════════════════════════════
 *   1. Nếu trọng tâm đã nằm trong ⇒ dùng luôn (ca phổ biến: mọi vùng lồi).
 *   2. Ngược lại: bắn tia NGANG ở cao độ `y` của trọng tâm, tìm mọi giao điểm
 *      với biên, sắp xếp, ghép thành các NHỊP TRONG (chẵn/lẻ), chọn nhịp DÀI
 *      NHẤT và lấy điểm giữa của nó.
 *   3. Tia ở đúng `y` của trọng tâm có thể trượt qua một đỉnh và cho 0 nhịp
 *      (ca suy biến). Khi đó quét thêm vài cao độ rải đều trong bbox và lấy
 *      nhịp dài nhất trong toàn bộ. Điều này biến "không tìm được" thành một
 *      trường hợp cực hiếm thay vì một trả về sai.
 *   4. Bí quá ⇒ trả `trongTam`. Thà đặt nhãn hơi lệch còn hơn trả `NaN` làm
 *      nhãn biến mất hẳn khỏi cảnh.
 *
 * Đây KHÔNG phải "cực điểm khó tiếp cận" (polylabel) — nó rẻ hơn nhiều và đủ
 * cho việc đặt một dòng chữ. Nói rõ phạm vi thay vì gọi tên một thuật toán
 * mạnh hơn thứ thật sự chạy ở đây.
 */
export function diemDatNhan(dinh: readonly DinhMm[]): DinhMm {
  const tt = trongTam(dinh);
  if (dinh.length < SO_DINH_TOI_THIEU) return tt;
  if (diemTrongPolygon(tt, dinh)) return tt;

  const b = bboxPolygonMm(dinh);
  const cao = b.maxY - b.minY;
  // Cao độ trọng tâm trước, rồi 9 lát cắt rải đều — thứ tự này giữ kết quả gần
  // trọng tâm nhất có thể, tức nhãn không nhảy sang đầu kia của vùng.
  const caoDo = [tt.yMm];
  for (let i = 1; i <= 9; i += 1) caoDo.push(b.minY + (cao * i) / 10);

  let totNhat: { giua: number; y: number; dai: number } | null = null;
  for (const y of caoDo) {
    for (const nhip of nhipTrongTaiCaoDo(dinh, y)) {
      if (!totNhat || nhip.dai > totNhat.dai) totNhat = { ...nhip, y };
    }
    // Nhịp ở đúng cao độ trọng tâm, nếu có, đã đủ tốt — dừng sớm để nhãn bám
    // sát trọng tâm thay vì nhảy tới chỗ rộng nhất của cả vùng.
    if (totNhat && y === tt.yMm) break;
  }
  if (!totNhat) return tt;
  return { xMm: totNhat.giua, yMm: totNhat.y };
}

/** Các nhịp NẰM TRONG đa giác trên đường ngang `y`. Nội bộ của {@link diemDatNhan}. */
function nhipTrongTaiCaoDo(
  dinh: readonly DinhMm[],
  y: number,
): { giua: number; dai: number }[] {
  const n = dinh.length;
  const cat: number[] = [];
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const a = dinh[i];
    const b = dinh[j];
    // Quy ước nửa mở `>` / `>` giống `diemTrongPolygon`: đỉnh nằm đúng trên
    // đường ngang được đếm MỘT lần, nên số giao điểm luôn chẵn.
    if (a.yMm > y !== b.yMm > y) {
      cat.push(((b.xMm - a.xMm) * (y - a.yMm)) / (b.yMm - a.yMm) + a.xMm);
    }
  }
  cat.sort((p, q) => p - q);
  const ra: { giua: number; dai: number }[] = [];
  for (let i = 0; i + 1 < cat.length; i += 2) {
    const dai = cat[i + 1] - cat[i];
    if (dai > 0) ra.push({ giua: (cat[i] + cat[i + 1]) / 2, dai });
  }
  return ra;
}

/** BBox mặt bằng của polygon (mm). Rỗng cho ra {@link bboxRong}. */
export function bboxPolygonMm(dinh: readonly DinhMm[]): BBox {
  const b = bboxRong();
  for (const d of dinh) {
    if (d.xMm < b.minX) b.minX = d.xMm;
    if (d.xMm > b.maxX) b.maxX = d.xMm;
    if (d.yMm < b.minY) b.minY = d.yMm;
    if (d.yMm > b.maxY) b.maxY = d.yMm;
  }
  b.minZ = 0;
  b.maxZ = 0;
  return b;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Điểm trong vùng — dùng cho chọn bằng chuột                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Điểm mặt bằng có nằm trong polygon không — ray casting (chẵn/lẻ).
 * Điểm đúng trên cạnh trả về kết quả không xác định giữa hai lượt; đó là hành
 * vi chuẩn của thuật toán này và chấp nhận được cho việc CHỌN bằng chuột.
 */
export function diemTrongPolygon(diem: DinhMm, dinh: readonly DinhMm[]): boolean {
  const n = dinh.length;
  if (n < SO_DINH_TOI_THIEU) return false;
  let trong = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const a = dinh[i];
    const b = dinh[j];
    const cat =
      a.yMm > diem.yMm !== b.yMm > diem.yMm &&
      diem.xMm < ((b.xMm - a.xMm) * (diem.yMm - a.yMm)) / (b.yMm - a.yMm) + a.xMm;
    if (cat) trong = !trong;
  }
  return trong;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Hàng DB → vùng vẽ                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Chuẩn hoá `diemDa` (jsonb, lỏng kiểu) thành danh sách đỉnh đã kiểm. */
export function docDiemDa(
  diemDa: readonly (readonly [number, number])[] | null | undefined,
): DinhMm[] {
  if (!Array.isArray(diemDa)) return [];
  const ra: DinhMm[] = [];
  for (const c of diemDa) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const x = Number(c[0]);
    const y = Number(c[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    ra.push({ xMm: x, yMm: y });
  }
  return ra;
}

/**
 * Hàng DB → vùng vẽ được. Trả `null` khi hàng không vẽ được (ẩn, hoặc polygon
 * không hợp lệ) — **không** trả một vùng rỗng: một mesh 0 đỉnh vẫn tốn draw
 * call và vẫn nhận nhãn, tức hệ sẽ tự khai là có một vùng ở đó.
 */
export function vungTuHang(h: HangVung, dangChon = false): VungVe | null {
  if (!h.hienThi) return null;
  const dinh = docDiemDa(h.diemDa);
  if (!polygonHopLe(dinh)) return null;

  const dayMm = h.caoMm != null && Number.isFinite(h.caoMm) && h.caoMm > 0
    ? h.caoMm
    : DAY_VUNG_MAC_DINH_MM;
  const chanY = mmSangMet(Number(h.viTriZMm) || 0);
  // ★ `diemDatNhan`, KHÔNG `trongTam`: với vùng lõm, trọng tâm diện tích rơi ra
  //   ngoài và nhãn nổi giữa lối đi. Xem docblock `diemDatNhan`.
  const tt = diemDatNhan(dinh);

  return {
    khoa: `vung:${h.id}`,
    ten: h.ten,
    // ★ HOÁN VỊ TRỤC: xMm → scene.x, yMm → scene.z (mặt bằng). Xem đầu tệp.
    dinh: dinh.map((d) => ({ x: mmSangMet(d.xMm), z: mmSangMet(d.yMm) })),
    caoDoY: chanY + NHAC_KHOI_SAN_M,
    dayM: mmSangMet(dayMm),
    mau: h.mau ?? MAU_VUNG_MAC_DINH,
    doMo: dangChon ? DO_MO_VUNG_CHON : DO_MO_VUNG,
    nhan: {
      x: mmSangMet(tt.xMm),
      // ★ Nhãn nổi TRÊN mặt vùng, không nằm trong nó — chữ đặt đúng cao độ mặt
      //   sẽ bị chính mặt translucent nhuộm màu và mất tương phản.
      y: chanY + mmSangMet(dayMm) + 0.35,
      z: mmSangMet(tt.yMm),
    },
    dienTichM2: dienTichM2(dinh),
  };
}

/** Nhiều hàng → nhiều vùng, bỏ hàng không vẽ được. */
export function vungTuDanhSach(
  ds: readonly HangVung[],
  khoaDangChon: string | null = null,
): VungVe[] {
  const ra: VungVe[] = [];
  for (const h of ds) {
    const v = vungTuHang(h, `vung:${h.id}` === khoaDangChon);
    if (v) ra.push(v);
  }
  return ra;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Đường GHI (#42) — dựng payload từ thao tác vẽ                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Payload gửi lên server để tạo/sửa một vùng. */
export interface VungGhi {
  id?: number;
  tangId: number;
  ten: string;
  diemDa: [number, number][];
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  caoMm: number;
  mau: string;
}

/**
 * Dựng payload ghi từ các đỉnh người dùng vừa vẽ.
 * Trả `null` khi polygon không hợp lệ — **cổng ở đây, không ở server**, để
 * người dùng biết ngay thay vì bấm Lưu rồi nhận lỗi 400.
 *
 * `viTriXMm/viTriYMm` đặt ở TRỌNG TÂM: cột vị trí của `twin_vat_the` là điểm
 * neo dùng chung cho mọi loại; với vùng, trọng tâm là điểm duy nhất có nghĩa
 * (một góc polygon sẽ làm phép sắp xếp theo vị trí cho ra thứ tự vô nghĩa).
 */
export function dungVungGhi(
  tangId: number,
  ten: string,
  dinh: readonly DinhMm[],
  tuyChon: { id?: number; caoDoZMm?: number; dayMm?: number; mau?: string } = {},
): VungGhi | null {
  if (!polygonHopLe(dinh)) return null;
  const tenSach = ten.trim();
  if (tenSach.length === 0) return null;
  const tt = trongTam(dinh);
  return {
    ...(tuyChon.id != null ? { id: tuyChon.id } : {}),
    tangId,
    ten: tenSach,
    diemDa: dinh.map((d) => [d.xMm, d.yMm] as [number, number]),
    viTriXMm: tt.xMm,
    viTriYMm: tt.yMm,
    viTriZMm: tuyChon.caoDoZMm ?? 0,
    caoMm: tuyChon.dayMm ?? DAY_VUNG_MAC_DINH_MM,
    mau: tuyChon.mau ?? MAU_VUNG_MAC_DINH,
  };
}
