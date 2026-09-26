/**
 * hinhHocCanChinh.ts — Bộ công cụ căn chỉnh của màn Thiết kế (§7.2, 12 công cụ).
 *
 * ★★★ LÝ DO TỒN TẠI CỦA CẢ FILE — RB-2.
 *   `TransformControls` của three snap TỊNH TIẾN theo lưới THẾ GIỚI (tuyệt đối),
 *   nhưng `setRotationSnap()` snap TƯƠNG ĐỐI với góc HIỆN TẠI của vật thể.
 *   Máy đang ở 8° với bước 15° sẽ đi 8° → 23° → 38° → 53°…, và KHÔNG BAO GIỜ
 *   chạm 15°. Hệ quả người dùng thấy: "xoay máy này về đúng hướng chuyền" là
 *   BẤT KHẢ THI — không có chuỗi thao tác nào đưa nó về 0/15/30/45/90°.
 *   Bản vá: bắt sự kiện `objectChange` và làm tròn TUYỆT ĐỐI bằng
 *   {@link snapGocTuyetDoi}. Test ghim: `snapGocTuyetDoi(8, 15) === 15`.
 *
 * ★ Module THUẦN: không import three.js, không import react (vitest env "node").
 *   Toàn bộ nội dung là số học bounding-box — đúng ranh giới tự nhiên của v1
 *   nêu ở §7.2 ("phần thiếu chỉ là số học bounding-box").
 * ★ Tất định: không Math.random(), không Date.now().
 *
 * ĐƠN VỊ: mọi hàm ở đây làm việc trên MỘT hệ đơn vị do người gọi chọn và KHÔNG
 *   trộn. Tên tham số có hậu tố `Mm` thì là milimét (hệ DB); `dsBbox` là bbox
 *   theo hệ nào người gọi đưa vào. Quy đổi nằm ở `heToaDo.ts`, không ở đây.
 */

import {
  type BBox,
  type DiemScene,
  bboxCoThuc,
  gopNhieuBBox,
  khoangCach,
  kichThuocBBox,
  lamTronVeLuoi,
  tamBBox,
} from "./heToaDo";

// ---------------------------------------------------------------------------
// Hằng số — mặc định của §7.2
// ---------------------------------------------------------------------------

/** Bước lưới snap tịnh tiến mặc định, mm (§7.2 công cụ #2). */
export const BUOC_LUOI_MAC_DINH_MM = 100;

/** Bước snap xoay mặc định, ĐỘ (§7.2 công cụ #3: 0/15/30/45/90°). */
export const BUOC_GOC_MAC_DINH_DO = 15;

/** Nudge bằng phím mũi tên, mm (§7.2 công cụ #4). */
export const BUOC_NUDGE_MM = 10;

/** Nudge khi giữ Shift, mm (§7.2 công cụ #4). */
export const BUOC_NUDGE_LON_MM = 100;

/** Số lượng tối đa cho một lần nhân bản — chặn "gõ nhầm 10000" làm treo cảnh. */
export const SO_LUONG_NHAN_BAN_TOI_DA = 500;

// ---------------------------------------------------------------------------
// Kiểu
// ---------------------------------------------------------------------------

/** Trục của hệ SCENE. X = Đông-Tây, Y = ĐỘ CAO, Z = Bắc-Nam trên mặt bằng. */
export type TrucScene = "X" | "Y" | "Z";

/**
 * Sáu hướng align của §7.2 công cụ #6.
 * `trai/giua_ngang/phai` chạy trên trục X; `tren/giua_doc/duoi` chạy trên trục Z
 * (mặt bằng nhìn từ trên xuống — "trên/dưới" của người dùng là trục Z của scene,
 * KHÔNG phải trục Y/độ cao). Ghi rõ ở đây vì đây là chỗ hoán vị trục dễ sai nhất
 * của cả module: người dùng nói "canh lên trên" khi nhìn top-down, không ai định
 * canh máy theo độ cao.
 */
export type HuongCanh =
  | "trai"
  | "giua_ngang"
  | "phai"
  | "tren"
  | "giua_doc"
  | "duoi";

/** Hướng nudge bằng phím mũi tên, theo mặt bằng nhìn từ trên xuống. */
export type HuongNudge = "trai" | "phai" | "tren" | "duoi" | "len" | "xuong";

/** Một vật thể có bbox và định danh — đơn vị làm việc của align/distribute. */
export interface VatTheCoBBox {
  /** Khoá ổn định (ví dụ "machine:42"). Thứ tự kết quả bám theo thứ tự đầu vào. */
  khoa: string;
  bbox: BBox;
}

/** Kết quả dịch chuyển một vật thể: bbox mới + vector đã dịch. */
export interface KetQuaDich {
  khoa: string;
  bbox: BBox;
  dich: DiemScene;
}

// ---------------------------------------------------------------------------
// #3 — VÁ SNAP XOAY TUYỆT ĐỐI (RB-2)
// ---------------------------------------------------------------------------

/**
 * ★★★ RB-2 — snap góc TUYỆT ĐỐI, đơn vị ĐỘ.
 *
 *   snapGocTuyetDoi(8, 15)  === 15    ← ĐÚNG (tuyệt đối)
 *   8 + 15                  === 23    ← SAI (công thức tương đối của three)
 *
 * Công thức: `Math.round(goc / buoc) * buoc`. Đây là toàn bộ bản vá — nó không
 * biết gì về three; nơi gọi bắt `objectChange` rồi ghi đè `object.rotation.y`.
 *
 * Trả về NGUYÊN GIÁ TRỊ khi `buoc <= 0` hoặc không hữu hạn: bước 0 nghĩa là
 * "không lưới", và chia cho 0 sẽ cho Infinity rồi NaN — một máy có góc NaN biến
 * mất khỏi cảnh mà không có lỗi nào.
 *
 * -0 chuẩn hoá về 0 (qua `lamTronVeLuoi`) để deep-equal của test không lệch.
 */
export function snapGocTuyetDoi(gocDo: number, buocDo: number): number {
  return lamTronVeLuoi(gocDo, buocDo);
}

/**
 * Góc hiện tại ĐÃ nằm đúng trên lưới snap chưa (sai số `saiSo` độ)?
 *
 * ★ LUẬT G8 — đầu vào nào làm cờ này trả FALSE:
 *   `daSnapGoc(8, 15)` → false (8 không phải bội của 15).
 *   Trả TRUE với `daSnapGoc(30, 15)`. Đây là cờ mà UI dùng để tắt badge "lệch
 *   lưới" trong Inspector, nên nó phải phân biệt được hai ca đó — nếu nó luôn
 *   true thì badge không bao giờ hiện và người dùng không biết máy đang lệch.
 */
export function daSnapGoc(gocDo: number, buocDo: number, saiSo = 1e-9): boolean {
  if (!Number.isFinite(buocDo) || buocDo <= 0) return true;
  return Math.abs(gocDo - snapGocTuyetDoi(gocDo, buocDo)) <= saiSo;
}

/**
 * Đưa góc về khoảng [0, 360). Dùng trước khi hiển thị, KHÔNG dùng trước khi
 * snap — chuẩn hoá rồi snap và snap rồi chuẩn hoá cho cùng kết quả với bước là
 * ước của 360 (0/15/30/45/90 đều là), nhưng gọi thừa làm khó truy vết.
 */
export function chuanHoaGocDo(gocDo: number): number {
  if (!Number.isFinite(gocDo)) return 0;
  const du = gocDo % 360;
  const ket = du < 0 ? du + 360 : du;
  return ket === 0 ? 0 : ket;
}

// ---------------------------------------------------------------------------
// #2 — Snap lưới tịnh tiến (tuyệt đối theo lưới THẾ GIỚI)
// ---------------------------------------------------------------------------

/**
 * Snap một vị trí về lưới thế giới bước `buocMm`, cả ba trục.
 *
 * ⚠ Snap TUYỆT ĐỐI theo gốc toạ độ thế giới, không phải theo vị trí ban đầu của
 *   vật: hai máy cùng snap bước 100 luôn nằm trên cùng một lưới, kể cả khi
 *   chúng xuất phát lệch nhau 37 mm. Snap tương đối giữ nguyên độ lệch đó và
 *   người dùng không bao giờ căn được hai máy thẳng hàng.
 */
export function snapLuoi(
  viTri: DiemScene,
  buocMm: number = BUOC_LUOI_MAC_DINH_MM,
): DiemScene {
  return {
    x: lamTronVeLuoi(viTri.x, buocMm),
    y: lamTronVeLuoi(viTri.y, buocMm),
    z: lamTronVeLuoi(viTri.z, buocMm),
  };
}

/**
 * Snap chỉ trên MẶT BẰNG (X, Z), giữ nguyên độ cao Y.
 * Máy đứng trên sàn ở cao độ tầng — snap độ cao về bội của 100 mm sẽ nhấc nó
 * lên hoặc dìm nó xuống khỏi mặt sàn, một hiệu ứng không ai muốn khi kéo ngang.
 */
export function snapLuoiMatBang(
  viTri: DiemScene,
  buocMm: number = BUOC_LUOI_MAC_DINH_MM,
): DiemScene {
  return {
    x: lamTronVeLuoi(viTri.x, buocMm),
    y: viTri.y,
    z: lamTronVeLuoi(viTri.z, buocMm),
  };
}

/**
 * Vị trí đã nằm trên lưới chưa?
 *
 * ★ G8 — trả FALSE với `daSnapLuoi({x:37,y:0,z:0}, 100)`; TRUE với x=100.
 *   Cờ này gác badge "lệch lưới" của Inspector, y hệt `daSnapGoc`.
 */
export function daSnapLuoi(
  viTri: DiemScene,
  buocMm: number = BUOC_LUOI_MAC_DINH_MM,
  saiSo = 1e-9,
): boolean {
  if (!Number.isFinite(buocMm) || buocMm <= 0) return true;
  const s = snapLuoi(viTri, buocMm);
  return (
    Math.abs(viTri.x - s.x) <= saiSo &&
    Math.abs(viTri.y - s.y) <= saiSo &&
    Math.abs(viTri.z - s.z) <= saiSo
  );
}

// ---------------------------------------------------------------------------
// Tiện ích bbox nội bộ
// ---------------------------------------------------------------------------

/** Dịch một bbox theo vector. */
export function dichBBox(b: BBox, dich: DiemScene): BBox {
  if (!bboxCoThuc(b)) return b;
  return {
    minX: b.minX + dich.x,
    minY: b.minY + dich.y,
    minZ: b.minZ + dich.z,
    maxX: b.maxX + dich.x,
    maxY: b.maxY + dich.y,
    maxZ: b.maxZ + dich.z,
  };
}

const KHONG_DICH: DiemScene = { x: 0, y: 0, z: 0 };

function giuNguyen(v: VatTheCoBBox): KetQuaDich {
  return { khoa: v.khoa, bbox: v.bbox, dich: { ...KHONG_DICH } };
}

/** Vật thể hợp lệ để tham gia align/distribute (bbox có thực). */
function hopLe(v: VatTheCoBBox): boolean {
  return bboxCoThuc(v.bbox);
}

// ---------------------------------------------------------------------------
// #6 — Align 6 hướng
// ---------------------------------------------------------------------------

/**
 * Căn các vật thể theo một trong 6 hướng, lấy MỐC là bbox bao chung của cả nhóm
 * (khuôn của Figma khi chọn nhiều đối tượng không có "đối tượng chủ").
 *
 * · trai/phai      → mép min/max theo trục X của bbox bao chung
 * · giua_ngang     → tâm X của bbox bao chung
 * · tren/duoi      → mép min/max theo trục Z (mặt bằng, xem {@link HuongCanh})
 * · giua_doc       → tâm Z
 *
 * Độ cao Y KHÔNG BAO GIỜ đổi: máy đứng trên sàn.
 *
 * Danh sách < 2 vật thể trả về nguyên trạng — align một vật thể với chính nó là
 * thao tác vô nghĩa và việc dịch nó về "mốc" (chính nó) là một lệnh undo rỗng
 * làm bẩn stack.
 */
export function canhTheoBien(
  dsBbox: readonly VatTheCoBBox[],
  huong: HuongCanh,
): KetQuaDich[] {
  const hopLes = dsBbox.filter(hopLe);
  if (hopLes.length < 2) return dsBbox.map(giuNguyen);

  const bao = gopNhieuBBox(hopLes.map((v) => v.bbox));
  const tam = tamBBox(bao);

  return dsBbox.map((v) => {
    if (!hopLe(v)) return giuNguyen(v);
    let dx = 0;
    let dz = 0;
    switch (huong) {
      case "trai":
        dx = bao.minX - v.bbox.minX;
        break;
      case "phai":
        dx = bao.maxX - v.bbox.maxX;
        break;
      case "giua_ngang":
        dx = tam.x - (v.bbox.minX + v.bbox.maxX) / 2;
        break;
      case "tren":
        dz = bao.minZ - v.bbox.minZ;
        break;
      case "duoi":
        dz = bao.maxZ - v.bbox.maxZ;
        break;
      case "giua_doc":
        dz = tam.z - (v.bbox.minZ + v.bbox.maxZ) / 2;
        break;
    }
    const dich: DiemScene = { x: dx, y: 0, z: dz };
    return { khoa: v.khoa, bbox: dichBBox(v.bbox, dich), dich };
  });
}

// ---------------------------------------------------------------------------
// #6 — Distribute
// ---------------------------------------------------------------------------

/**
 * Rải đều các vật thể theo một trục: KHOẢNG TRỐNG giữa hai vật liền kề bằng nhau.
 *
 * ⚠ Đây là "distribute spacing" (Figma: *Tidy up*), KHÔNG phải "distribute
 *   centers". Hai cách cho kết quả KHÁC NHAU khi các vật khác kích thước: rải
 *   đều TÂM làm hai máy to đứng cạnh nhau chạm nhau trong khi hai máy nhỏ hở
 *   một khoảng lớn — đúng thứ người dùng đang cố sửa. Bố cục nhà máy cần lối đi
 *   đều nhau, tức là khoảng TRỐNG đều nhau.
 *
 * Vật ĐẦU và vật CUỐI (theo toạ độ trên trục đó) đứng yên làm mốc; phần giữa
 * được rải. Dưới 3 vật thể thì không có gì để rải → trả nguyên trạng.
 *
 * Trục 'Y' bị TỪ CHỐI (trả nguyên trạng): rải đều theo độ cao nghĩa là nhấc máy
 * khỏi sàn — không phải thao tác của bố cục mặt bằng.
 */
export function danDeu(
  dsBbox: readonly VatTheCoBBox[],
  truc: TrucScene,
): KetQuaDich[] {
  if (truc === "Y") return dsBbox.map(giuNguyen);
  const hopLes = dsBbox.filter(hopLe);
  if (hopLes.length < 3) return dsBbox.map(giuNguyen);

  const min = (b: BBox) => (truc === "X" ? b.minX : b.minZ);
  const max = (b: BBox) => (truc === "X" ? b.maxX : b.maxZ);
  const be = (b: BBox) =>
    truc === "X" ? kichThuocBBox(b).rong : kichThuocBBox(b).sau;

  // Sắp theo mép min; hoà thì theo khoá để TẤT ĐỊNH (không phụ thuộc thứ tự đầu vào).
  const daSap = [...hopLes].sort((a, b) => {
    const d = min(a.bbox) - min(b.bbox);
    return d !== 0 ? d : a.khoa < b.khoa ? -1 : a.khoa > b.khoa ? 1 : 0;
  });

  const dau = daSap[0];
  const cuoi = daSap[daSap.length - 1];
  const tongBe = daSap.reduce((s, v) => s + be(v.bbox), 0);
  const nhipTong = max(cuoi.bbox) - min(dau.bbox);
  const khoangTrong = (nhipTong - tongBe) / (daSap.length - 1);

  const dichTheoKhoa = new Map<string, number>();
  let con = min(dau.bbox);
  for (const v of daSap) {
    dichTheoKhoa.set(v.khoa, con - min(v.bbox));
    con += be(v.bbox) + khoangTrong;
  }

  return dsBbox.map((v) => {
    if (!hopLe(v)) return giuNguyen(v);
    const d = dichTheoKhoa.get(v.khoa) ?? 0;
    const dich: DiemScene =
      truc === "X" ? { x: d, y: 0, z: 0 } : { x: 0, y: 0, z: d };
    return { khoa: v.khoa, bbox: dichBBox(v.bbox, dich), dich };
  });
}

// ---------------------------------------------------------------------------
// #11 — Array / nhân bản theo mẫu
// ---------------------------------------------------------------------------

/**
 * Nhân bản TUYẾN TÍNH: `soLuong` bản sao cách nhau `buocMm` dọc `truc`.
 *
 * Trả về `soLuong` bbox MỚI, KHÔNG gồm bản gốc — người gọi giữ bản gốc và thêm
 * các bản sao. `soLuong <= 0` trả mảng rỗng; vượt {@link SO_LUONG_NHAN_BAN_TOI_DA}
 * bị KẸP (không ném lỗi): người dùng gõ nhầm số 0 thừa không được phép làm treo
 * trình duyệt, và một cảnh 500 bản sao đã đủ để họ thấy mình gõ sai.
 *
 * `buocMm = 0` cho ra `soLuong` bản CHỒNG KHÍT lên gốc — hợp lệ về mặt toán học
 * nhưng vô nghĩa về mặt bố cục, nên UI phải chặn trước bằng {@link buocNhanBanHopLe}.
 */
export function nhanBanTuyenTinh(
  bbox: BBox,
  truc: TrucScene,
  buocMm: number,
  soLuong: number,
): BBox[] {
  if (!bboxCoThuc(bbox)) return [];
  const n = kepSoLuong(soLuong);
  if (n <= 0 || !Number.isFinite(buocMm)) return [];
  const ket: BBox[] = [];
  for (let i = 1; i <= n; i++) {
    const d = buocMm * i;
    const dich: DiemScene =
      truc === "X"
        ? { x: d, y: 0, z: 0 }
        : truc === "Y"
          ? { x: 0, y: d, z: 0 }
          : { x: 0, y: 0, z: d };
    ket.push(dichBBox(bbox, dich));
  }
  return ket;
}

/**
 * Bước nhân bản có tách được các bản sao ra khỏi nhau không?
 *
 * ★ G8 — trả FALSE với `buocNhanBanHopLe(0)` và với bước NaN; TRUE với 1400.
 *   Đây là cờ UI dùng để tắt nút [Áp dụng] của hộp thoại Array — nếu nó luôn
 *   true thì người dùng bấm Áp dụng với bước 0 và nhận N bản chồng khít, mà
 *   nhìn trong 3D thì y hệt như không có gì xảy ra.
 */
export function buocNhanBanHopLe(buocMm: number): boolean {
  return Number.isFinite(buocMm) && Math.abs(buocMm) > 0;
}

/** Một bản sao toả tròn: bbox xem trước + góc xoay (độ) để ghi vào quaternion. */
export interface BanSaoToaTron {
  bbox: BBox;
  gocDo: number;
}

/**
 * Nhân bản TOẢ TRÒN quanh trục ĐỨNG đi qua `tamXoay`: `soLuong` bản, mỗi bản
 * lệch thêm `gocBuocDo` độ.
 *
 * Trả về cả bbox ĐÃ QUAY QUANH TÂM và góc (độ) để người gọi ghi vào quaternion —
 * bbox trục-song-song không mang được phép xoay, nên nếu chỉ trả bbox thì thông
 * tin "bản sao này quay 45°" MẤT và mọi bản sao sẽ hướng y như bản gốc.
 *
 * ⚠ BBox trả về là bbox của TÂM đã quay, giữ nguyên KÍCH THƯỚC gốc — tức là bao
 *   của khối đã quay chỉ đúng khi góc là bội của 90°. Đây là bbox XEM TRƯỚC
 *   (§7.2 #11: "xem trước bằng bounding box trước khi Áp dụng"), không phải bbox
 *   va chạm. Ghi rõ để không ai dùng nó cho phép kiểm chồng lấn.
 */
export function nhanBanToaTron(
  bbox: BBox,
  tamXoay: DiemScene,
  gocBuocDo: number,
  soLuong: number,
): BanSaoToaTron[] {
  if (!bboxCoThuc(bbox)) return [];
  const n = kepSoLuong(soLuong);
  if (n <= 0 || !Number.isFinite(gocBuocDo)) return [];

  const tam = tamBBox(bbox);
  const co = kichThuocBBox(bbox);
  const rx = tam.x - tamXoay.x;
  const rz = tam.z - tamXoay.z;

  const ket: BanSaoToaTron[] = [];
  for (let i = 1; i <= n; i++) {
    const gocDo = gocBuocDo * i;
    const rad = (gocDo * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Quay quanh trục ĐỨNG (Y): mặt phẳng quay là (X, Z).
    const x = tamXoay.x + rx * cos - rz * sin;
    const z = tamXoay.z + rx * sin + rz * cos;
    ket.push({
      gocDo: chuanHoaGocDo(gocDo),
      bbox: {
        minX: x - co.rong / 2,
        maxX: x + co.rong / 2,
        minY: bbox.minY,
        maxY: bbox.maxY,
        minZ: z - co.sau / 2,
        maxZ: z + co.sau / 2,
      },
    });
  }
  return ket;
}

function kepSoLuong(soLuong: number): number {
  if (!Number.isFinite(soLuong)) return 0;
  const n = Math.floor(soLuong);
  if (n <= 0) return 0;
  return Math.min(n, SO_LUONG_NHAN_BAN_TOI_DA);
}

// ---------------------------------------------------------------------------
// #12 — Đo khoảng cách
// ---------------------------------------------------------------------------

/**
 * Khoảng cách Euclid giữa hai điểm, cùng đơn vị với đầu vào (§7.2 #12).
 * Uỷ nhiệm cho `heToaDo.khoangCach` để không có phép căn thứ hai trong repo.
 */
export function doKhoangCach(diemA: DiemScene, diemB: DiemScene): number {
  return khoangCach(diemA, diemB);
}

/**
 * Khoảng cách chiếu xuống MẶT BẰNG (bỏ độ cao Y).
 * "Hai máy này cách nhau bao xa" trong xưởng là khoảng cách đi bộ trên sàn,
 * không phải khoảng cách qua không khí giữa đỉnh máy này và chân máy kia.
 */
export function doKhoangCachMatBang(diemA: DiemScene, diemB: DiemScene): number {
  const dx = diemA.x - diemB.x;
  const dz = diemA.z - diemB.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Khe HỞ giữa hai bbox theo mặt bằng: khoảng cách ngắn nhất giữa hai mép.
 * Trả 0 khi hai bbox chạm nhau hoặc chồng lên nhau — không trả số âm, vì "chồng
 * nhau 300 mm" và "cách nhau -300 mm" là hai câu khác nghĩa và ô đo trên UI chỉ
 * nói được câu thứ hai.
 */
export function doKheHoMatBang(a: BBox, b: BBox): number {
  if (!bboxCoThuc(a) || !bboxCoThuc(b)) return 0;
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ));
  return Math.sqrt(dx * dx + dz * dz);
}

// ---------------------------------------------------------------------------
// #4 — Nudge phím mũi tên
// ---------------------------------------------------------------------------

/**
 * Dịch một vị trí bằng phím mũi tên (§7.2 #4: 10 mm, Shift 100 mm).
 *
 * Quy ước hướng theo góc nhìn TOP-DOWN của màn Thiết kế:
 *   trai/phai → trục X (−/+)
 *   tren/duoi → trục Z (−/+)   ← mặt bằng, KHÔNG phải độ cao
 *   len/xuong → trục Y (+/−)   ← độ cao, chỉ dùng khi đã bỏ khoá trục Y
 *
 * `tren` giảm Z vì Y của mặt bằng hướng XUỐNG trong hệ DB (§5.2) và đã hoán vị
 * thành Z của scene — "lên trên màn hình" là về phía gốc toạ độ.
 */
export function nudge(
  viTri: DiemScene,
  huong: HuongNudge,
  buocMm: number = BUOC_NUDGE_MM,
): DiemScene {
  const b = Number.isFinite(buocMm) ? buocMm : 0;
  switch (huong) {
    case "trai":
      return { ...viTri, x: viTri.x - b };
    case "phai":
      return { ...viTri, x: viTri.x + b };
    case "tren":
      return { ...viTri, z: viTri.z - b };
    case "duoi":
      return { ...viTri, z: viTri.z + b };
    case "len":
      return { ...viTri, y: viTri.y + b };
    case "xuong":
      return { ...viTri, y: viTri.y - b };
  }
}

/** Bước nudge theo phím bổ trợ Shift (§7.2 #4). */
export function buocNudgeCho(giuShift: boolean): number {
  return giuShift ? BUOC_NUDGE_LON_MM : BUOC_NUDGE_MM;
}

// ---------------------------------------------------------------------------
// #2 — Ngữ nghĩa ĐẢO của phím Ctrl (Blender)
// ---------------------------------------------------------------------------

/**
 * Snap có hiệu lực cho thao tác này không?
 *
 * §7.2 #2: giữ `Ctrl` để ĐẢO trạng thái snap — một phím phục vụ cả "snap ngay"
 * lẫn "thoát snap". "Snap không có đường thoát còn tệ hơn không snap".
 *
 * ★ G8 — trả FALSE khi `snapBat=true, giuCtrl=true` (người dùng đang tạm thoát
 *   snap để đặt máy vào khe 37 mm) và khi cả hai đều false. Trả TRUE khi đúng
 *   một trong hai bật. Nếu hàm này luôn true thì phím Ctrl không làm gì và
 *   người dùng không có đường thoát khỏi lưới.
 */
export function snapCoHieuLuc(snapBat: boolean, giuCtrl: boolean): boolean {
  return snapBat !== giuCtrl;
}
