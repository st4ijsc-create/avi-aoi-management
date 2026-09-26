/**
 * heToaDo.ts — Quy đổi toạ độ, module NỀN của mọi module Twin 3D khác (§5.2).
 *
 * Quy ước bất biến (spec §5.2):
 *   DB lưu milimét (numeric 14,3) · Scene dùng mét (float)
 *
 *     scene.x =  viTriXMm / 1000        // Đông  →
 *     scene.y =  viTriZMm / 1000        // Z trong DB là ĐỘ CAO
 *     scene.z =  viTriYMm / 1000        // Y mặt bằng hướng XUỐNG → Z scene
 *
 * Y của mặt bằng hướng XUỐNG (quy ước ảnh/CAD), Y của scene hướng LÊN.
 * Toàn bộ quy đổi nằm trong MỘT module này — không nơi nào khác được chia 1000.
 *
 * ★ Module THUẦN: không import three.js, không import react (vitest environment "node").
 * ★ Tất định: không Math.random(), không Date.now().
 */

/** Điểm trong hệ DB — milimét, Y hướng xuống mặt bằng, Z là độ cao. */
export interface DiemMm {
  xMm: number;
  yMm: number;
  zMm: number;
}

/** Điểm trong hệ scene — mét, Y hướng lên. */
export interface DiemScene {
  x: number;
  y: number;
  z: number;
}

/** Quaternion. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Hộp bao trục-song-song, đơn vị tuỳ ngữ cảnh gọi (mm hoặc m — không trộn). */
export interface BBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Số mm trong một mét — hằng duy nhất, không viết 1000 rải rác. */
export const MM_MOI_MET = 1000;

/** Sai số cho phép khi kiểm chuẩn hoá quaternion (spec T6). */
export const SAI_SO_QUAT = 1e-6;

// ---------------------------------------------------------------------------
// mm <-> mét
// ---------------------------------------------------------------------------

/** Milimét sang mét. */
export function mmSangMet(mm: number): number {
  return mm / MM_MOI_MET;
}

/** Mét sang milimét. */
export function metSangMm(met: number): number {
  return met * MM_MOI_MET;
}

// ---------------------------------------------------------------------------
// Quy ước trục DB <-> scene
// ---------------------------------------------------------------------------

/**
 * Điểm DB (mm) sang điểm scene (m), áp dụng hoán vị trục của §5.2.
 * scene.x = xMm/1000 · scene.y = zMm/1000 (độ cao) · scene.z = yMm/1000.
 */
export function mmSangScene(diem: DiemMm): DiemScene {
  return {
    x: mmSangMet(diem.xMm),
    y: mmSangMet(diem.zMm),
    z: mmSangMet(diem.yMm),
  };
}

/** Nghịch đảo của {@link mmSangScene}: scene (m) sang DB (mm). */
export function sceneSangMm(diem: DiemScene): DiemMm {
  return {
    xMm: metSangMm(diem.x),
    yMm: metSangMm(diem.z),
    zMm: metSangMm(diem.y),
  };
}

// ---------------------------------------------------------------------------
// Quaternion
// ---------------------------------------------------------------------------

/** Chuẩn quaternion: căn bậc hai của x²+y²+z²+w². */
export function chuanQuat(q: Quat): number {
  return Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
}

/**
 * Quaternion đã chuẩn hoá chưa? x²+y²+z²+w² xấp xỉ 1 (sai số mặc định 1e-6).
 * Khớp CHECK constraint của DB (spec T6).
 */
export function laQuatChuanHoa(q: Quat, saiSo: number = SAI_SO_QUAT): boolean {
  const binhPhuong = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  return Math.abs(binhPhuong - 1) <= saiSo;
}

/**
 * Chuẩn hoá quaternion. Quaternion độ dài 0 (không biểu diễn được phép xoay nào)
 * trả về identity (0,0,0,1) thay vì NaN — ở tầng toán học identity là giá trị an
 * toàn duy nhất, và người gọi phải tự phát hiện bằng {@link laQuatSuyBien}.
 */
export function chuanHoaQuat(q: Quat): Quat {
  const chuan = chuanQuat(q);
  if (chuan === 0 || !Number.isFinite(chuan)) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return { x: q.x / chuan, y: q.y / chuan, z: q.z / chuan, w: q.w / chuan };
}

/** Quaternion suy biến (độ dài 0 hoặc không hữu hạn) — không xoay được. */
export function laQuatSuyBien(q: Quat): boolean {
  const chuan = chuanQuat(q);
  return chuan === 0 || !Number.isFinite(chuan);
}

/**
 * Quaternion xoay quanh trục ĐỨNG của scene (trục Y) một góc radian.
 * Đây là phép xoay duy nhất mà bố cục nhà máy cần (máy đứng trên sàn).
 */
export function quatXoayQuanhTrucDung(gocRad: number): Quat {
  const nua = gocRad / 2;
  return { x: 0, y: Math.sin(nua), z: 0, w: Math.cos(nua) };
}

/** Góc (radian) quanh trục Y suy ra từ quaternion xoay-quanh-Y. */
export function gocTuQuatTrucDung(q: Quat): number {
  const chuanHoa = chuanHoaQuat(q);
  return 2 * Math.atan2(chuanHoa.y, chuanHoa.w);
}

// ---------------------------------------------------------------------------
// BBox
// ---------------------------------------------------------------------------

/** BBox rỗng — dùng làm phần tử trung hoà cho {@link gopBBox}. */
export function bboxRong(): BBox {
  return {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
}

/** BBox có chứa ít nhất một điểm không? */
export function bboxCoThuc(b: BBox): boolean {
  return b.minX <= b.maxX && b.minY <= b.maxY && b.minZ <= b.maxZ;
}

/**
 * BBox của một khối đặt tại `tam` với kích thước `kichThuoc`.
 * Tâm nằm giữa theo cả ba trục.
 */
export function bboxTuTamVaKichThuoc(
  tam: { x: number; y: number; z: number },
  kichThuoc: { rong: number; cao: number; sau: number },
): BBox {
  const nuaRong = kichThuoc.rong / 2;
  const nuaCao = kichThuoc.cao / 2;
  const nuaSau = kichThuoc.sau / 2;
  return {
    minX: tam.x - nuaRong,
    minY: tam.y - nuaCao,
    minZ: tam.z - nuaSau,
    maxX: tam.x + nuaRong,
    maxY: tam.y + nuaCao,
    maxZ: tam.z + nuaSau,
  };
}

/** BBox bao mọi điểm trong danh sách. Danh sách rỗng cho ra {@link bboxRong}. */
export function bboxTuDiem(diem: { x: number; y: number; z: number }[]): BBox {
  const ket = bboxRong();
  for (const d of diem) {
    if (d.x < ket.minX) ket.minX = d.x;
    if (d.y < ket.minY) ket.minY = d.y;
    if (d.z < ket.minZ) ket.minZ = d.z;
    if (d.x > ket.maxX) ket.maxX = d.x;
    if (d.y > ket.maxY) ket.maxY = d.y;
    if (d.z > ket.maxZ) ket.maxZ = d.z;
  }
  return ket;
}

/** Gộp (union) hai bbox. BBox rỗng là phần tử trung hoà. */
export function gopBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

/** Gộp một danh sách bbox. Rỗng cho ra {@link bboxRong}. */
export function gopNhieuBBox(ds: BBox[]): BBox {
  return ds.reduce<BBox>((acc, b) => gopBBox(acc, b), bboxRong());
}

/** Kích thước bbox theo ba trục. BBox rỗng cho ra 0. */
export function kichThuocBBox(b: BBox): { rong: number; cao: number; sau: number } {
  if (!bboxCoThuc(b)) return { rong: 0, cao: 0, sau: 0 };
  return {
    rong: b.maxX - b.minX,
    cao: b.maxY - b.minY,
    sau: b.maxZ - b.minZ,
  };
}

/** Tâm bbox. BBox rỗng cho ra gốc toạ độ. */
export function tamBBox(b: BBox): { x: number; y: number; z: number } {
  if (!bboxCoThuc(b)) return { x: 0, y: 0, z: 0 };
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    z: (b.minZ + b.maxZ) / 2,
  };
}

/**
 * Hai bbox 3D có GIAO NHAU không — phép so CHẶT: chạm mép KHÔNG tính là giao.
 * Dùng cho test T4 của thuật toán sinh ("không chồng lấn").
 * Chạm mép phải không tính, vì hai máy đặt sát nhau đúng bằng kích thước
 * của chúng là bố cục HỢP LỆ; nếu tính là giao thì T4 đỏ oan ở mọi lưới đặc.
 */
export function bboxGiaoNhau(a: BBox, b: BBox): boolean {
  if (!bboxCoThuc(a) || !bboxCoThuc(b)) return false;
  return (
    a.minX < b.maxX &&
    b.minX < a.maxX &&
    a.minY < b.maxY &&
    b.minY < a.maxY &&
    a.minZ < b.maxZ &&
    b.minZ < a.maxZ
  );
}

/**
 * Hai bbox có giao nhau khi CHIẾU XUỐNG MẶT SÀN (bỏ trục cao Y của scene)?
 * Đây mới là phép so mà T4 cần: hai máy chồng lấn mặt bằng là sai kể cả khi
 * chúng khác độ cao, vì máy đứng trên sàn.
 */
export function bboxGiaoNhauTrenSan(a: BBox, b: BBox): boolean {
  if (!bboxCoThuc(a) || !bboxCoThuc(b)) return false;
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

/** BBox `trong` nằm TRỌN trong `ngoai` (cho phép chạm mép) — test T5. */
export function bboxNamTrong(trong: BBox, ngoai: BBox): boolean {
  if (!bboxCoThuc(trong) || !bboxCoThuc(ngoai)) return false;
  return (
    trong.minX >= ngoai.minX &&
    trong.maxX <= ngoai.maxX &&
    trong.minY >= ngoai.minY &&
    trong.maxY <= ngoai.maxY &&
    trong.minZ >= ngoai.minZ &&
    trong.maxZ <= ngoai.maxZ
  );
}

/** Quy đổi cả một bbox từ mm (hệ DB) sang scene (m), gồm hoán vị trục. */
export function bboxMmSangScene(b: BBox): BBox {
  if (!bboxCoThuc(b)) return bboxRong();
  const g1 = mmSangScene({ xMm: b.minX, yMm: b.minY, zMm: b.minZ });
  const g2 = mmSangScene({ xMm: b.maxX, yMm: b.maxY, zMm: b.maxZ });
  return {
    minX: Math.min(g1.x, g2.x),
    minY: Math.min(g1.y, g2.y),
    minZ: Math.min(g1.z, g2.z),
    maxX: Math.max(g1.x, g2.x),
    maxY: Math.max(g1.y, g2.y),
    maxZ: Math.max(g1.z, g2.z),
  };
}

// ---------------------------------------------------------------------------
// Làm tròn về bước lưới
// ---------------------------------------------------------------------------

/**
 * Làm tròn TUYỆT ĐỐI về bội của `buoc` (không phải tương đối như three).
 * Bước <= 0 hoặc không hữu hạn thì trả nguyên giá trị (không lưới = không snap).
 * -0 được chuẩn hoá về 0 để deep-equal của test T1 không lệch.
 */
export function lamTronVeLuoi(giaTri: number, buoc: number): number {
  if (!Number.isFinite(buoc) || buoc <= 0) return giaTri;
  const ket = Math.round(giaTri / buoc) * buoc;
  return ket === 0 ? 0 : ket;
}

/** Làm tròn một điểm scene về lưới `buoc` (mét) theo cả ba trục. */
export function lamTronDiemVeLuoi(diem: DiemScene, buoc: number): DiemScene {
  return {
    x: lamTronVeLuoi(diem.x, buoc),
    y: lamTronVeLuoi(diem.y, buoc),
    z: lamTronVeLuoi(diem.z, buoc),
  };
}

/**
 * Làm tròn góc (radian) về bội TUYỆT ĐỐI của `buocDo` độ.
 * Đây là phép vá RB-2: snap xoay của three là TƯƠNG ĐỐI với góc hiện tại,
 * nên 8° + snap 15° đi 8 -> 23 -> 38 và không bao giờ chạm 15. Hàm này tuyệt đối:
 * 8° với bước 15° cho ra 15°.
 */
export function lamTronGocVeBuocDo(gocRad: number, buocDo: number): number {
  if (!Number.isFinite(buocDo) || buocDo <= 0) return gocRad;
  const gocDo = (gocRad * 180) / Math.PI;
  const tronDo = lamTronVeLuoi(gocDo, buocDo);
  return (tronDo * Math.PI) / 180;
}

/** Khoảng cách Euclid giữa hai điểm scene (mét). */
export function khoangCach(a: DiemScene, b: DiemScene): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
