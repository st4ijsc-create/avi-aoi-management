/**
 * phamViCanh.ts — NĂM CẤP PHẠM VI (§10C.2) và cách camera/bộ lọc đổi theo.
 *
 *   Tập đoàn → Nhà máy → Tầng → **Line** → Máy
 *
 * ★★★ LINE KHÔNG CÓ TOẠ ĐỘ RIÊNG (QĐ-14). Hình học của phạm vi Line suy ra từ
 *   trạm/máy thuộc nó, bằng `phamViLine.hinhHocLine()` — module này KHÔNG được
 *   đọc vị trí từ hàng `twin_dat_cho` có `loaiThucThe='line'` (hàng đó chỉ giữ
 *   nhãn/màu). Cho Line một vị trí riêng là tạo nguồn sự thật thứ hai, và nó sẽ
 *   lệch khỏi các trạm ngay lần đầu ai đó kéo một trạm đi.
 *
 * ★ Module THUẦN: không three, không react. Camera trả về dưới dạng SỐ (vị trí +
 *   mục ngắm), người gọi tự tween — nhờ vậy toàn bộ luật "chọn cấp nào thì nhìn
 *   thấy gì" test được ở `environment: "node"` mà không cần WebGL.
 */

import {
  bboxCoThuc,
  bboxRong,
  gopNhieuBBox,
  kichThuocBBox,
  tamBBox,
  type BBox,
  type DiemScene,
} from "../heToaDo";
import type { CapPhamVi, PhamVi } from "./duongDanTwin";

/** Thời lượng tween khi chuyển cấp (§10C.2). */
export const TWEEN_DOI_CAP_MS = 500;

/**
 * Độ mờ của vật thể NGOÀI phạm vi đang chọn (§10C.2 bảng).
 * Line khác mờ 12 %, tường/cột mờ 40 % — nghĩa là chúng vẫn CÓ MẶT (để người
 * dùng còn thấy ngữ cảnh không gian) nhưng lùi hẳn khỏi tiền cảnh.
 */
export const DO_MO_NGOAI_PHAM_VI = 0.12;
export const DO_MO_HA_TANG = 0.4;

/** Một vật thể có thể được lọc theo phạm vi. */
export interface VatTheCoPhamVi {
  machineId: number;
  stationId: number | null;
  lineId: number | null;
  workshopId: number | null;
  factoryId: number | null;
  tangId: number | null;
}

/**
 * Vật thể có nằm TRONG phạm vi đang chọn không?
 *
 * ⚠ Trả `true` cho cấp `tapDoan` với MỌI vật thể — đó là cấp bao trùm, không
 *   phải "chưa chọn gì". Và trả `true` khi `pv.id === null` ở các cấp khác: một
 *   phạm vi thiếu id là phạm vi CHƯA phân giải được, và lọc sạch màn hình vì một
 *   id thiếu là cách nhanh nhất để người dùng thấy "nhà máy trống rỗng".
 */
export function trongPhamVi(v: VatTheCoPhamVi, pv: PhamVi): boolean {
  if (pv.cap === "tapDoan" || pv.id === null) return true;
  switch (pv.cap) {
    case "nhaMay":
      return v.factoryId === pv.id;
    case "tang":
      return v.tangId === pv.id;
    case "line":
      return v.lineId === pv.id;
    case "may":
      return v.machineId === pv.id;
  }
}

/**
 * Độ mờ áp cho một vật thể theo phạm vi (§10C.2).
 *
 * Trong phạm vi ⇒ 1 (đầy đủ). Ngoài ⇒ `DO_MO_NGOAI_PHAM_VI`.
 *
 * ⚠ Ở cấp `may`, các máy KHÁC không bị mờ 12 % — chọn một máy không có nghĩa là
 *   xoá cả nhà máy khỏi màn hình; người vận hành vẫn cần thấy hàng xóm của nó để
 *   định vị. Cấp `may` chỉ siết CAMERA lại gần, không siết bộ lọc.
 */
export function doMoTheoPhamVi(v: VatTheCoPhamVi, pv: PhamVi): number {
  if (pv.cap === "may" || pv.cap === "tapDoan" || pv.id === null) return 1;
  return trongPhamVi(v, pv) ? 1 : DO_MO_NGOAI_PHAM_VI;
}

/**
 * Tỉ lệ pha màu về nền cho vật thể NGOÀI phạm vi (0 = giữ nguyên, 1 = biến mất
 * vào nền). 0,72 để lại vừa đủ hình khối đọc được.
 */
export const TI_LE_PHA_NGOAI_PHAM_VI = 0.72;

/** Tách một chuỗi màu CSS `rgb(r, g, b)` / `#rrggbb` thành ba kênh 0–255. */
function tachRgb(mau: string): [number, number, number] | null {
  const s = mau.trim();
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = s.match(/^#([0-9a-f]{6})$/i);
  if (h) {
    const n = parseInt(h[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const h3 = s.match(/^#([0-9a-f]{3})$/i);
  if (h3) {
    const [r, g, b] = h3[1].split("");
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  return null;
}

/**
 * ★★★ "MỜ ĐI" = PHA VỀ NỀN, KHÔNG PHẢI LÀM TỐI.
 *
 * `LoBatchMay` (Đợt 1) chỉ có kênh LÀM TỐI (`c.multiplyScalar`), vì vật liệu
 * `BatchedMesh` phải đục. Nghiệm thu bằng ảnh đo được hậu quả: trên theme SÁNG,
 * làm tối một màu vốn nhạt cho ra khối gần như ĐEN trên nền sàn sáng — nó đọc
 * như MÁY HỎNG chứ không như "lùi khỏi tiền cảnh", tức là dồn tương phản CAO
 * vào đúng những máy BÌNH THƯỜNG ngoài phạm vi (ngược §10.1).
 *
 * Pha về nền cho ra hiệu ứng "nhạt đi" đúng nghĩa ở CẢ hai theme, mà không phải
 * sửa kit: kết quả vẫn là một màu đục truyền qua ô `mau` như thường.
 *
 * Trả về NGUYÊN màu gốc khi không phân giải được đầu vào — thà đậm còn hơn trả
 * một màu bịa (người gọi vẫn thấy vật thể, chỉ là không nhạt đi).
 */
export function phaVeNen(mau: string, nen: string, tiLe: number): string {
  const a = tachRgb(mau);
  const b = tachRgb(nen);
  if (!a || !b) return mau;
  const t = Math.min(1, Math.max(0, Number.isFinite(tiLe) ? tiLe : 0));
  const k = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${k(0)}, ${k(1)}, ${k(2)})`;
}

/** Tư thế camera cho một phạm vi — SỐ thuần, người gọi tween tới. */
export interface KhungNhin {
  viTri: [number, number, number];
  muc: [number, number, number];
  /** Bán kính bao — người gọi dùng để đặt `far` và giới hạn zoom. */
  banKinh: number;
}

/**
 * Hệ số khoảng cách camera theo cấp (§10C.2 cột "Camera").
 *
 * Cấp càng cao, camera càng lùi xa và càng nghiêng về top-down; cấp `may` ép sát
 * (≤ 8 m theo bảng §10C.2). Đây là toàn bộ phần "cảm giác" của việc đổi cấp, nên
 * để thành hằng đặt tên được thay vì số ma thuật rải trong component.
 */
export const HE_SO_LUI: Readonly<Record<CapPhamVi, number>> = {
  tapDoan: 2.4,
  nhaMay: 1.9,
  tang: 1.6,
  line: 1.35,
  may: 1.1,
};

/** Độ cao camera tương đối so với bán kính cảnh, theo cấp. */
export const HE_SO_CAO: Readonly<Record<CapPhamVi, number>> = {
  // Tập đoàn nhìn gần như thẳng đứng (ortho nghiêng) — đọc bố cục khuôn viên.
  tapDoan: 1.8,
  nhaMay: 1.1,
  tang: 0.9,
  // Line nhìn thấp và dọc trục chính — để đọc được DÒNG CHẢY, không phải diện tích.
  line: 0.55,
  may: 0.7,
};

/** Trần khoảng cách camera ở cấp `may` (mét) — §10C.2 "Orbit gần, ≤ 8 m". */
export const KHOANG_CACH_TOI_DA_CAP_MAY = 8;

/**
 * Khung nhìn cho một bbox ở một cấp phạm vi.
 *
 * ★ G8 — bbox KHÔNG THỰC (rỗng/Infinity) trả `null`, KHÔNG trả một khung nhìn
 *   mặc định trông hợp lệ. Bay camera tới một bbox rỗng đưa nó ra Infinity và
 *   cho một màn hình TRẮNG XOÁ không lỗi — đúng lớp lỗi chia-cho-0 của G11.
 *   Người gọi phải xử ca `null` (giữ nguyên camera + nói "phạm vi này chưa có gì").
 */
export function khungNhinCho(bbox: BBox, cap: CapPhamVi): KhungNhin | null {
  if (!bboxCoThuc(bbox)) return null;
  const tam = tamBBox(bbox);
  const co = kichThuocBBox(bbox);
  const banKinh = Math.max(1, 0.5 * Math.hypot(co.rong, co.cao, co.sau));

  let lui = banKinh * HE_SO_LUI[cap];
  let cao = banKinh * HE_SO_CAO[cap];
  if (cap === "may") {
    lui = Math.min(lui, KHOANG_CACH_TOI_DA_CAP_MAY);
    cao = Math.min(cao, KHOANG_CACH_TOI_DA_CAP_MAY);
  }

  return {
    // Nhìn từ hướng (+X, +Y, +Z) — cùng quy ước với `khungHinhBaoTron` của kit,
    // để camera không "nhảy hướng" khi đổi giữa hai đường tính khung nhìn.
    viTri: [tam.x + lui, tam.y + cao, tam.z + lui],
    muc: [tam.x, tam.y, tam.z],
    banKinh,
  };
}

/**
 * Khung nhìn cho phạm vi LINE, ĐẶC BIỆT hơn mọi cấp khác (§10C.2 "Orbit dọc
 * trục chính của Line").
 *
 * Camera đứng lệch sang bên trục PHỤ và nhìn dọc trục CHÍNH, thay vì nhìn chéo
 * 45° như các cấp khác. Lý do: một Line 12 trạm dài 30 m nhìn chéo thì hai đầu
 * xa nhau tới mức không đọc nổi; nhìn dọc trục thì cả dây chuyền vào khung.
 *
 * `trucDangTin === false` (§10C.1: chỉ 1 trạm, hoặc phương sai hai trục bằng
 * nhau) ⇒ rơi về khung nhìn CHUNG thay vì xoay camera dọc một trục bịa ra.
 */
export function khungNhinLine(
  bbox: BBox,
  truc: "X" | "Z",
  trucDangTin: boolean,
): KhungNhin | null {
  if (!bboxCoThuc(bbox)) return null;
  if (!trucDangTin) return khungNhinCho(bbox, "line");

  const tam = tamBBox(bbox);
  const co = kichThuocBBox(bbox);
  const banKinh = Math.max(1, 0.5 * Math.hypot(co.rong, co.cao, co.sau));
  const cao = banKinh * HE_SO_CAO.line;
  // Lùi theo trục PHỤ (vuông góc với dòng chảy) một khoảng đủ thấy hết bề ngang.
  const luiPhu = Math.max(4, (truc === "X" ? co.sau : co.rong) * 1.6 + banKinh * 0.5);

  return {
    viTri:
      truc === "X"
        ? [tam.x, tam.y + cao, tam.z + luiPhu]
        : [tam.x + luiPhu, tam.y + cao, tam.z],
    muc: [tam.x, tam.y, tam.z],
    banKinh,
  };
}

/**
 * BBox của một tập vật thể đã lọc theo phạm vi. Rỗng ⇒ bbox rỗng (KHÔNG ném) —
 * "phạm vi này chưa có gì" là trạng thái hợp lệ, không phải sự cố.
 */
export function bboxCuaTap(
  vatThe: readonly { tam: DiemScene; co?: { rong: number; cao: number; sau: number } }[],
): BBox {
  if (vatThe.length === 0) return bboxRong();
  return gopNhieuBBox(
    vatThe.map((v) => {
      const c = v.co ?? { rong: 0, cao: 0, sau: 0 };
      return {
        minX: v.tam.x - c.rong / 2,
        maxX: v.tam.x + c.rong / 2,
        minY: v.tam.y,
        maxY: v.tam.y + c.cao,
        minZ: v.tam.z - c.sau / 2,
        maxZ: v.tam.z + c.sau / 2,
      };
    }),
  );
}

/** Một mắt xích breadcrumb (§9.1 dòng đầu màn hình). */
export interface MatXich {
  cap: CapPhamVi;
  id: number | null;
  nhan: string;
}

/**
 * Dựng breadcrumb từ phạm vi hiện tại — ĐƯỜNG ĐI LÊN của §10C.2.
 *
 * Luôn bắt đầu bằng Tập đoàn và dừng ở cấp đang chọn: người dùng phải bấm được
 * vào bất kỳ tổ tiên nào để nhảy thẳng lên đó, không phải bấm "lên" nhiều lần.
 *
 * `ten` tra nhãn cho từng cấp; thiếu nhãn thì mắt xích đó vẫn hiện (với chuỗi
 * rỗng do người gọi quyết định) chứ không bị bỏ — một breadcrumb thiếu mắt xích
 * làm người dùng tưởng cấp đó không tồn tại.
 */
export function dungBreadcrumb(
  pv: PhamVi,
  ten: (cap: CapPhamVi, id: number | null) => string,
): MatXich[] {
  const thuTu: CapPhamVi[] = ["tapDoan", "nhaMay", "tang", "line", "may"];
  const den = thuTu.indexOf(pv.cap);
  const ra: MatXich[] = [];
  for (let i = 0; i <= den; i += 1) {
    const cap = thuTu[i];
    // Chỉ cấp ĐANG CHỌN mới biết chắc id của mình; các cấp trên là tổ tiên mà
    // module thuần này không suy được (cần cây phân cấp) — người gọi truyền nhãn.
    const id = cap === pv.cap ? pv.id : null;
    ra.push({ cap, id, nhan: ten(cap, id) });
  }
  return ra;
}

/** Cấp cha của một cấp — dùng cho nút "lên một cấp" và phím Escape. */
export function capCha(cap: CapPhamVi): CapPhamVi | null {
  switch (cap) {
    case "tapDoan":
      return null;
    case "nhaMay":
      return "tapDoan";
    case "tang":
      return "nhaMay";
    case "line":
      return "tang";
    case "may":
      return "line";
  }
}
