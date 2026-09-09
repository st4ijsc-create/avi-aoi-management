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
import type { CapPhamVi, PhamVi, TuTheCamera } from "./duongDanTwin";
import { byteMau } from "./byteMau";

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

/**
 * Tách một chuỗi màu CSS thành ba kênh 0–255.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G29 — TRƯỚC BẢN VÁ NÀY, HÀM CHỈ ĐỌC `rgb()`/`#hex`, VÀ `--muted` LÀ
 *     `oklch(...)` ⇒ `phaVeNen()` TRẢ NGUYÊN MÀU GỐC ⇒ "MỜ 12 % CHO LINE
 *     NGOÀI PHẠM VI" (§10C) **CHƯA TỪNG CÓ HIỆU LỰC**.
 * ════════════════════════════════════════════════════════════════════════════
 * Mã chạy, không lỗi, không cảnh báo, **không làm gì**. Đây là G5 ở dạng độc
 * nhất: không phải "tập rỗng" mà là "phép biến đổi đồng nhất" — hàm được gọi
 * với dữ liệu KHÁC RỖNG và trả về đúng đầu vào của nó.
 *
 * Nhánh thứ ba (`byteMau`) quy MỌI cú pháp màu CSS qua canvas 2D. Nó trả `null`
 * trong `environment: "node"` (không DOM), nên module này VẪN THUẦN về phía
 * test — hai nhánh regex đầu đủ cho mọi test node, và ca oklch được đo ở
 * `phaVeNen.dom.test.tsx` (jsdom + canvas tiêm).
 */
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
  // ★ oklch/oklab/lab/lch/color()/hwb — quy qua canvas 2D. `null` khi không DOM.
  return byteMau(s);
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
  khung?: KhungKhop,
): KhungNhin | null {
  if (!bboxCoThuc(bbox)) return null;
  // ★ Đợt 35 — có khung canvas ⇒ KHỚP khoảng cách để 8 đỉnh lọt frustum (`khopKhungNhin` cuối tệp).
  const khop = (k: KhungNhin | null) => (k && khung ? khopKhungNhin(bbox, k, khung) : k);
  if (!trucDangTin) return khop(khungNhinCho(bbox, "line"));

  const tam = tamBBox(bbox);
  const co = kichThuocBBox(bbox);
  const banKinh = Math.max(1, 0.5 * Math.hypot(co.rong, co.cao, co.sau));
  const cao = banKinh * HE_SO_CAO.line;
  // Lùi theo trục PHỤ (vuông góc với dòng chảy) một khoảng đủ thấy hết bề ngang.
  const luiPhu = Math.max(4, (truc === "X" ? co.sau : co.rong) * 1.6 + banKinh * 0.5);

  return khop({
    viTri:
      truc === "X"
        ? [tam.x, tam.y + cao, tam.z + luiPhu]
        : [tam.x + luiPhu, tam.y + cao, tam.z],
    muc: [tam.x, tam.y, tam.z],
    banKinh,
  });
}

/**
 * ★★★ ĐỢT 33 (Pareto #9) — `?cam=` TRÊN MÀN LINE/MÁY KHÔNG ĐƯỢC NUỐT IM LẶNG.
 *
 * Đợt 32 a3b đo `/twin/line/2?cam=10,5,10,0,0` ⇒ `camDoiCamera: false`: tham số
 * đọc được (`docCamera`), ghi được, nhưng **không màn mới nào dùng nó** — đúng lớp
 * G67 "tính năng chết ở tầng đầu tiên". Hàm này biến tư thế camera trong URL
 * thành một `KhungNhin` để `CanhVanHanh` bay tới, y như khung nhìn theo cấp.
 *
 * ★ `muc.y = 0`: `TuTheCamera` chỉ mang `mucX`/`mucZ` (mục ngắm trên sàn) — đó là
 *   hợp đồng URL từ §9.4, không mở rộng ở đây (G40).
 * ★ `banKinh` = khoảng cách camera↔mục (sàn 1 m): người gọi hiện không dùng nó để
 *   đặt `far` (CanhVanHanh lấy theo cỡ sàn), giữ để hợp đồng `KhungNhin` không
 *   có trường "vô nghĩa".
 */
export function khungNhinTuCamera(cam: TuTheCamera): KhungNhin {
  const dx = cam.x - cam.mucX;
  const dz = cam.z - cam.mucZ;
  return {
    viTri: [cam.x, cam.y, cam.z],
    muc: [cam.mucX, 0, cam.mucZ],
    banKinh: Math.max(1, Math.hypot(dx, cam.y, dz)),
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

/* ══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 35 (Pareto #5) — KHỚP KHUNG: MỌI ĐỈNH bbox LỌT FRUSTUM, CHỪA LỀ NHÃN     */
/* ══════════════════════════════════════════════════════════════════════════ */
/*
 * QA Đợt 32 a3 (1600×900) + đo lại Đợt 35 (`.qa-dot35/truoc/e4-line-2-*.json`):
 * `khungNhinLine` chỉ dùng `HE_SO_CAO.line = 0,55` và một khoảng lùi theo bề
 * ngang — nó KHÔNG biết canvas rộng/cao bao nhiêu, cũng không biết FOV. Kết
 * quả trên chuyền 2 (12 máy, 27,5 m): **6/12** máy trong khung, cột WIP xuyên
 * mép trên (709 pixel lạ ở 4 hàng đầu canvas), nửa dưới cảnh trống — ở CẢ hai
 * viewport. Hệ số theo cấp là cảm giác; lọt khung là hình học.
 *
 * ⇒ Giữ NGUYÊN hướng nhìn của cấp (thấp, dọc trục chính — §10C.2), chỉ đổi
 *   KHOẢNG CÁCH: tiến/lùi camera dọc hướng ấy tới khoảng NHỎ NHẤT mà cả 8 đỉnh
 *   bbox (kèm đỉnh cột WIP, người gọi gộp) nằm trong frustum, chừa `lePx` mỗi
 *   mép để nhãn của máy đầu/cuối chuyền vẫn vẽ TRỌN (`locNhan.hopTrongKhung`).
 *   Module vẫn THUẦN: phép chiếu pinhole viết tay (lookAt, up +Y — cùng quy ước
 *   `Matrix4.lookAt` của three), test được ở `environment: "node"`.
 */

/** FOV DỌC của `KhungCanh` (độ). G91: test đọc `fov = 45` từ chính `KhungCanh.tsx`. */
export const FOV_DOC_MAC_DINH = 45;
/**
 * Lề pixel chừa quanh mép canvas khi khớp khung. Nhãn thật rộng 112–198 px
 * (`locNhan.ts`), neo ở TÂM nóc máy ⇒ nửa nhãn ≤ 99 px thò ra mỗi bên. 100 để
 * nhãn máy đầu/cuối không bị `hopTrongKhung` loại vì thò mép.
 */
export const LE_KHOP_KHUNG_PX = 100;

/** Khung canvas để khớp khung nhìn. Thiếu ⇒ `khungNhinLine` giữ hành vi cũ. */
export interface KhungKhop {
  rongPx: number;
  caoPx: number;
  /** Mặc định {@link FOV_DOC_MAC_DINH}. */
  fovDoc?: number;
  /** Mặc định {@link LE_KHOP_KHUNG_PX}. */
  lePx?: number;
}

/** Toạ độ chuẩn hoá thiết bị (NDC): |x|,|y| ≤ 1 là trong khung; `sau` = độ sâu (m) trước camera. */
export interface DiemNdc {
  x: number;
  y: number;
  sau: number;
}

/**
 * Chiếu một điểm thế giới qua camera pinhole đặt tại `viTri` nhìn về `muc`
 * (up = +Y, cùng quy ước `Matrix4.lookAt` của three) với FOV dọc `fovDoc` (độ)
 * và tỉ lệ khung `tiLe` = rộng/cao. Trả `null` khi điểm ở sau/ngang camera.
 */
export function chieuNdc(
  diem: DiemScene,
  viTri: readonly [number, number, number],
  muc: readonly [number, number, number],
  fovDoc: number,
  tiLe: number,
): DiemNdc | null {
  const fx0 = muc[0] - viTri[0];
  const fy0 = muc[1] - viTri[1];
  const fz0 = muc[2] - viTri[2];
  const fl = Math.hypot(fx0, fy0, fz0);
  if (fl === 0 || !Number.isFinite(fl)) return null;
  const fx = fx0 / fl;
  const fy = fy0 / fl;
  const fz = fz0 / fl;
  // right = forward × up(0,1,0) = (−f.z, 0, f.x); suy biến khi nhìn thẳng đứng ⇒ lấy +X.
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-9) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  // up' = right × forward
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const vx = diem.x - viTri[0];
  const vy = diem.y - viTri[1];
  const vz = diem.z - viTri[2];
  const sau = vx * fx + vy * fy + vz * fz;
  if (!(sau > 1e-6)) return null;
  const t = Math.tan((fovDoc * Math.PI) / 360);
  return {
    x: (vx * rx + vz * rz) / (sau * t * tiLe),
    y: (vx * ux + vy * uy + vz * uz) / (sau * t),
    sau,
  };
}

/** Tám đỉnh của một bbox. */
export function dinhBBox(b: BBox): DiemScene[] {
  const ra: DiemScene[] = [];
  for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) ra.push({ x, y, z });
  return ra;
}

/** Mọi điểm có lọt khung (với lề) từ tư thế camera này không? */
export function lotKhung(
  diem: readonly DiemScene[],
  viTri: readonly [number, number, number],
  muc: readonly [number, number, number],
  khung: KhungKhop,
): boolean {
  if (!(khung.rongPx > 0) || !(khung.caoPx > 0)) return false;
  const tiLe = khung.rongPx / khung.caoPx;
  const fov = khung.fovDoc ?? FOV_DOC_MAC_DINH;
  const le = khung.lePx ?? LE_KHOP_KHUNG_PX;
  const bx = Math.max(0, 1 - (2 * le) / khung.rongPx);
  const by = Math.max(0, 1 - (2 * le) / khung.caoPx);
  for (const d of diem) {
    const p = chieuNdc(d, viTri, muc, fov, tiLe);
    if (!p || Math.abs(p.x) > bx || Math.abs(p.y) > by) return false;
  }
  return true;
}

/**
 * Tiến/lùi camera DỌC hướng nhìn có sẵn của `goc` tới khoảng cách NHỎ NHẤT mà
 * mọi đỉnh `bbox` lọt khung. Hướng (góc nghiêng, phía đứng), `muc`, `banKinh`
 * giữ nguyên — đây là cách đổi "bao nhiêu xa" mà không đổi "nhìn từ đâu".
 *
 * Quét hình học d₀/8 → d₀·256 (bước 3 %) lấy s nhỏ nhất lọt, rồi bisection 12
 * bước giữa (s/1,03; s]. Tất định. Không khớp được (bbox suy biến, khung lạ)
 * ⇒ trả `goc` nguyên vẹn — không bay tới một chỗ bịa.
 */
export function khopKhungNhin(bbox: BBox, goc: KhungNhin, khung: KhungKhop): KhungNhin {
  if (!bboxCoThuc(bbox)) return goc;
  const dinh = dinhBBox(bbox);
  const ux = goc.viTri[0] - goc.muc[0];
  const uy = goc.viTri[1] - goc.muc[1];
  const uz = goc.viTri[2] - goc.muc[2];
  const d0 = Math.hypot(ux, uy, uz);
  if (!(d0 > 0)) return goc;
  const tai = (s: number): [number, number, number] => [
    goc.muc[0] + (ux / d0) * s,
    goc.muc[1] + (uy / d0) * s,
    goc.muc[2] + (uz / d0) * s,
  ];
  let sDau: number | null = null;
  let s = d0 / 8;
  for (let i = 0; i < 400 && s <= d0 * 256; i += 1) {
    if (lotKhung(dinh, tai(s), goc.muc, khung)) {
      sDau = s;
      break;
    }
    s *= 1.03;
  }
  if (sDau === null) return goc;
  let lo = sDau / 1.03;
  let hi = sDau;
  for (let i = 0; i < 12; i += 1) {
    const m = (lo + hi) / 2;
    if (lotKhung(dinh, tai(m), goc.muc, khung)) hi = m;
    else lo = m;
  }
  return { viTri: tai(hi), muc: goc.muc, banKinh: goc.banKinh };
}
