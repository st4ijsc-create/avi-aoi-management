/**
 * phamViLine.ts — Line là PHẠM VI, không phải vật thể (§10C.1, QĐ-12/QĐ-14).
 *
 * ★★★ LINE KHÔNG CÓ TOẠ ĐỘ RIÊNG. Hình học của nó SUY RA từ các trạm/máy thuộc
 *   nó. Lý do (§10C.1): nếu Line có toạ độ riêng, nó LỆCH khỏi các trạm ngay
 *   khi ai đó kéo một trạm đi — sinh ra nguồn sự thật thứ hai cho cùng một thứ.
 *   Suy ra thì không bao giờ lệch.
 *
 * ⚠ NGOẠI LỆ CÓ CHỦ Ý (§10C.1): `twin_dat_cho` VẪN nhận `loaiThucThe='line'`,
 *   nhưng CHỈ để lưu NHÃN và MÀU dải Line (`mau`, `hienThi`, `daKhoa`). Các cột
 *   `viTriXMm/YMm/ZMm` của hàng đó bị BỎ QUA khi đọc. Đừng "sửa" module này
 *   thành đọc vị trí từ đó — đó chính là nguồn sự thật thứ hai mà QĐ-12 cấm.
 *
 * Dữ liệu đo được (§10C.0): `orderIndex` đầy đủ 37/37 trạm ⇒ chiều dòng chảy
 * suy ra được CHÍNH XÁC, không cần ai nhập tay.
 *
 * ★ Module THUẦN: không import three.js, không import react (vitest env "node").
 * ★ Tất định: không Math.random(), không Date.now(); mọi phép sắp xếp có khoá
 *   phá hoà (tie-break) để không phụ thuộc thứ tự DB trả về.
 */

import {
  type BBox,
  type DiemScene,
  bboxCoThuc,
  bboxTuTamVaKichThuoc,
  gopNhieuBBox,
} from "./heToaDo";

/** Trục chính của một Line trên mặt bằng. Y (độ cao) không bao giờ là trục Line. */
export type TrucLine = "X" | "Z";

/**
 * Một vật thể đã đặt chỗ, đủ thông tin để suy hình học Line.
 * Toạ độ theo hệ SCENE (mét) — người gọi đã quy đổi qua `heToaDo.mmSangScene`.
 */
export interface ViTriDaDat {
  /** Khoá ổn định, ví dụ "station:5" — dùng phá hoà khi sắp xếp. */
  khoa: string;
  /** Tâm vật thể, hệ scene. */
  tam: DiemScene;
  /** Kích thước, hệ scene (mét). Vắng ⇒ coi là điểm (kích thước 0). */
  co?: { rong: number; cao: number; sau: number };
  /**
   * `stations.orderIndex` — thứ tự dòng chảy. `null`/`undefined` với TRẠM là
   * dữ liệu khuyết (§10C.0 nói 37/37 có, nên ca này là bất thường cần cảnh báo);
   * với MÁY thì bình thường vì máy không có orderIndex.
   */
  thuTu?: number | null;
}

/** Hình học suy ra của một Line (§10C.1). */
export interface HinhHocLine {
  /** Bao lồi (bbox) mọi trạm + máy của line. Rỗng khi line không có gì. */
  bbox: BBox;
  /** Trục chính, từ PHƯƠNG SAI lớn hơn của tâm các trạm. */
  truc: TrucLine;
  /** Chiều dòng chảy dọc `truc`, suy từ `orderIndex`. */
  huong: 1 | -1;
  /** Đường tâm: nối tâm các TRẠM theo `orderIndex` tăng dần. */
  diemDuongTam: DiemScene[];
  /**
   * Line có suy được hình học không?
   * ★ G8 — FALSE khi `tram` và `may` đều rỗng, và khi mọi bbox suy biến
   *   (Infinity). TRUE với một trạm bất kỳ có toạ độ. Cờ này gác việc camera có
   *   bay tới phạm vi Line hay không — bay tới một bbox rỗng đưa camera ra
   *   Infinity và cảnh trắng xoá, không lỗi.
   */
  coHinhHoc: boolean;
  /**
   * Trục chính có ĐÁNG TIN không?
   * ★ G8 — FALSE khi chỉ có 1 trạm (không có phương sai để so), và khi phương
   *   sai hai trục BẰNG NHAU (Line hình vuông / chéo 45° — không có trục trội).
   *   TRUE với 12 trạm rải dọc X. Khi false, `truc` vẫn có giá trị (mặc định
   *   'X') nhưng UI phải nói "chưa xác định được hướng Line" thay vì lẳng lặng
   *   xoay camera dọc một trục bịa ra.
   */
  trucDangTin: boolean;
}

/** BBox của một vật thể đã đặt: khối có kích thước, hoặc điểm nếu thiếu `co`. */
function bboxCua(v: ViTriDaDat): BBox {
  if (v.co) return bboxTuTamVaKichThuoc(v.tam, v.co);
  return bboxTuTamVaKichThuoc(v.tam, { rong: 0, cao: 0, sau: 0 });
}

/**
 * Sắp trạm theo `orderIndex` tăng dần. Trạm thiếu `thuTu` xuống CUỐI (không bị
 * loại: chúng vẫn thuộc Line và vẫn phải nằm trong bbox); hoà thì theo `khoa`
 * để TẤT ĐỊNH — nếu không, cùng đầu vào mà DB trả khác thứ tự sẽ cho hai đường
 * tâm khác nhau.
 */
export function sapTramTheoThuTu(tram: readonly ViTriDaDat[]): ViTriDaDat[] {
  return [...tram].sort((a, b) => {
    const ta = a.thuTu ?? Number.POSITIVE_INFINITY;
    const tb = b.thuTu ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.khoa < b.khoa ? -1 : a.khoa > b.khoa ? 1 : 0;
  });
}

/** Phương sai (dân số) của một dãy số. Dãy < 2 phần tử cho 0. */
export function phuongSai(ds: readonly number[]): number {
  if (ds.length < 2) return 0;
  const tb = ds.reduce((s, v) => s + v, 0) / ds.length;
  return ds.reduce((s, v) => s + (v - tb) * (v - tb), 0) / ds.length;
}

/**
 * Trục chính của Line: trục có PHƯƠNG SAI lớn hơn giữa X và Z.
 *
 * Không dùng bề rộng bbox vì bbox bị một trạm lạc chỗ kéo méo hoàn toàn; phương
 * sai tính trên MỌI tâm nên một điểm ngoại lai không lật được kết luận của 11
 * điểm còn lại.
 *
 * Hoà (kể cả ca 0 = 0 khi chỉ có 1 trạm) trả 'X' — và {@link HinhHocLine.trucDangTin}
 * báo false để UI không trình bày phỏng đoán này như một sự thật (NT-4).
 */
export function trucChinh(tam: readonly DiemScene[]): {
  truc: TrucLine;
  dangTin: boolean;
} {
  const psX = phuongSai(tam.map((t) => t.x));
  const psZ = phuongSai(tam.map((t) => t.z));
  if (psX === psZ) return { truc: "X", dangTin: false };
  return { truc: psX > psZ ? "X" : "Z", dangTin: true };
}

/**
 * Chiều dòng chảy dọc trục chính, suy từ `orderIndex`.
 *
 * Trạm có `orderIndex` NHỎ NHẤT là đầu vào của Line; trạm LỚN NHẤT là đầu ra.
 * `huong = 1` nghĩa là toạ độ tăng dần theo trục khi đi từ đầu vào ra đầu ra;
 * `-1` là ngược lại.
 *
 * ⚠ So TRẠM ĐẦU với TRẠM CUỐI, không so hai trạm liền kề: hai trạm giữa Line có
 *   thể lệch ngược một chút sau nhiều lần kéo tay, và một cặp như vậy sẽ lật cả
 *   mũi tên dòng chảy của Line 12 trạm.
 *
 * Hoà (đầu và cuối cùng toạ độ trên trục, hoặc < 2 trạm) trả 1.
 */
export function huongDongChay(
  tramDaSap: readonly ViTriDaDat[],
  truc: TrucLine,
): 1 | -1 {
  if (tramDaSap.length < 2) return 1;
  const lay = (v: ViTriDaDat) => (truc === "X" ? v.tam.x : v.tam.z);
  const dau = lay(tramDaSap[0]);
  const cuoi = lay(tramDaSap[tramDaSap.length - 1]);
  return cuoi < dau ? -1 : 1;
}

/**
 * Hình học suy ra của một Line (§10C.1).
 *
 * `tram` và `may` đều tham gia bbox (bao lồi mọi trạm + máy), nhưng CHỈ `tram`
 * quyết định trục, hướng và đường tâm: máy thuộc trạm nên chúng chỉ nhân bản
 * thông tin vị trí của trạm, trong khi một máy đặt lệch ra rìa lại kéo phương
 * sai đi mà không mang thêm thông tin nào về dòng chảy.
 *
 * Đầu vào rỗng trả bbox rỗng, `coHinhHoc = false`, KHÔNG ném lỗi (một Line vừa
 * tạo chưa có trạm nào là trạng thái hợp lệ, không phải sự cố).
 */
export function hinhHocLine(
  tram: readonly ViTriDaDat[],
  may: readonly ViTriDaDat[],
): HinhHocLine {
  const daSap = sapTramTheoThuTu(tram);
  const moiThu = [...daSap, ...may];
  const bbox = gopNhieuBBox(moiThu.map(bboxCua));
  const coHinhHoc = bboxCoThuc(bbox);

  const tamTram = daSap.map((t) => t.tam);
  const { truc, dangTin } = trucChinh(tamTram);
  const huong = huongDongChay(daSap, truc);

  return {
    bbox,
    truc,
    huong,
    diemDuongTam: tamTram.map((t) => ({ x: t.x, y: t.y, z: t.z })),
    coHinhHoc,
    trucDangTin: dangTin,
  };
}

// ---------------------------------------------------------------------------
// §10C.4 — ba công cụ Line của màn Thiết kế
// ---------------------------------------------------------------------------

/** Bước rải trạm mặc định dọc Line, mm (§10C.4). */
export const BUOC_RAI_TRAM_MAC_DINH_MM = 2500;

/** Vị trí mới của một trạm sau một công cụ Line — một lệnh undo được. */
export interface ViTriMoi {
  khoa: string;
  tam: DiemScene;
}

/**
 * **Rải trạm dọc Line** (§10C.4). Xếp lại toàn bộ trạm theo `orderIndex` trên
 * MỘT đường thẳng, cách nhau `buoc` (đơn vị của hệ toạ độ đầu vào — mét nếu tâm
 * là mét).
 *
 * Mốc: trạm ĐẦU TIÊN theo `orderIndex` đứng yên; các trạm sau xếp về phía
 * `huong` của Line. Giữ nguyên toạ độ trên trục PHỤ và độ cao — rải trạm là
 * thao tác một chiều, và tự tiện nắn cả trục phụ là việc của "Nắn thẳng Line".
 *
 * ⚠ Trả về CẢ trạm không đổi vị trí (dịch 0): lệnh undo cần trạng thái `truoc`
 *   đầy đủ của mọi target, và lọc bớt ở đây làm nơi gọi phải ghép lại.
 *
 * Trả mảng rỗng khi không có trạm nào.
 */
export function raiTramDocLine(
  tram: readonly ViTriDaDat[],
  hinhHoc: Pick<HinhHocLine, "truc" | "huong">,
  buoc: number,
): ViTriMoi[] {
  const daSap = sapTramTheoThuTu(tram);
  if (daSap.length === 0) return [];
  const b = Number.isFinite(buoc) ? buoc : 0;
  const goc = daSap[0].tam;
  return daSap.map((t, i) => {
    const lech = b * i * hinhHoc.huong;
    return {
      khoa: t.khoa,
      tam:
        hinhHoc.truc === "X"
          ? { x: goc.x + lech, y: t.tam.y, z: t.tam.z }
          : { x: t.tam.x, y: t.tam.y, z: goc.z + lech },
    };
  });
}

/** Đường thẳng bình phương tối thiểu trên mặt bằng, dạng tham số. */
export interface DuongThang {
  /** Một điểm trên đường (trọng tâm các trạm). */
  diem: DiemScene;
  /** Vector chỉ phương ĐÃ CHUẨN HOÁ, thành phần y luôn 0 (đường nằm ngang). */
  huongVector: DiemScene;
}

/**
 * Fit đường thẳng bình phương tối thiểu qua tâm các trạm, trên MẶT BẰNG (X, Z).
 *
 * ⚠ Dùng TOTAL least squares (trục chính của ma trận hiệp phương sai), KHÔNG
 *   phải hồi quy z-theo-x thông thường. Lý do: hồi quy thường cực tiểu hoá sai
 *   số THEO MỘT TRỤC và VỠ (hệ số vô hạn) với Line thẳng đứng dọc trục Z — mà
 *   đó là một nửa số Line trong bất kỳ nhà máy nào. Total least squares cực
 *   tiểu hoá khoảng cách VUÔNG GÓC nên nó không có trục ưu tiên.
 *
 * Dưới 2 trạm trả về đường qua điểm đó theo trục X (không có gì để fit).
 */
export function fitDuongThang(tram: readonly ViTriDaDat[]): DuongThang {
  const tam = tram.map((t) => t.tam);
  if (tam.length === 0) {
    return { diem: { x: 0, y: 0, z: 0 }, huongVector: { x: 1, y: 0, z: 0 } };
  }
  const n = tam.length;
  const tbX = tam.reduce((s, t) => s + t.x, 0) / n;
  const tbY = tam.reduce((s, t) => s + t.y, 0) / n;
  const tbZ = tam.reduce((s, t) => s + t.z, 0) / n;
  const diem: DiemScene = { x: tbX, y: tbY, z: tbZ };
  if (n < 2) return { diem, huongVector: { x: 1, y: 0, z: 0 } };

  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (const t of tam) {
    const dx = t.x - tbX;
    const dz = t.z - tbZ;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  // Trị riêng lớn nhất của ma trận [[sxx, sxz], [sxz, szz]].
  const nua = (sxx + szz) / 2;
  const hieu = Math.sqrt(((sxx - szz) / 2) ** 2 + sxz * sxz);
  const triRieng = nua + hieu;

  let vx = sxz;
  let vz = triRieng - sxx;
  if (Math.abs(vx) < 1e-12 && Math.abs(vz) < 1e-12) {
    // Đám điểm ĐẲNG HƯỚNG (mọi hướng như nhau) — không có trục chính. Chọn X.
    vx = 1;
    vz = 0;
  }
  const dai = Math.sqrt(vx * vx + vz * vz);
  return {
    diem,
    huongVector: { x: vx / dai, y: 0, z: vz / dai },
  };
}

/**
 * **Nắn thẳng Line** (§10C.4): chiếu VUÔNG GÓC mọi trạm lên đường thẳng bình
 * phương tối thiểu. Sửa Line bị lệch sau nhiều lần kéo tay.
 *
 * Giữ nguyên độ cao của từng trạm — nắn thẳng là thao tác trên mặt bằng.
 * Thứ tự trạm trên đường KHÔNG bị đảo, vì phép chiếu vuông góc bảo toàn thứ tự
 * dọc theo vector chỉ phương.
 */
export function nanThangLine(tram: readonly ViTriDaDat[]): ViTriMoi[] {
  if (tram.length === 0) return [];
  const duong = fitDuongThang(tram);
  return tram.map((t) => {
    const dx = t.tam.x - duong.diem.x;
    const dz = t.tam.z - duong.diem.z;
    const chieu = dx * duong.huongVector.x + dz * duong.huongVector.z;
    return {
      khoa: t.khoa,
      tam: {
        x: duong.diem.x + chieu * duong.huongVector.x,
        y: t.tam.y,
        z: duong.diem.z + chieu * duong.huongVector.z,
      },
    };
  });
}

/**
 * **Đổi hướng Line** (§10C.4): xoay CẢ Line quanh tâm bbox của nó, quanh trục
 * ĐỨNG. Giữ nguyên thứ tự trạm.
 *
 * `gocDo` chỉ nhận 90 / 180 / 270 / -90 … — thực ra hàm chấp nhận mọi góc, và
 * cấp trên (hộp thoại) là nơi giới hạn về bội 90°: ở tầng toán học không có gì
 * sai với 37°, còn ở tầng UI thì §10C.4 chỉ mở hai nút 90° và 180°.
 *
 * ⚠ Hàm này CHỈ trả vị trí mới. Hướng (quaternion) của từng máy phải được nơi
 *   gọi CỘNG THÊM đúng `gocDo` — §10C.4 nói "giữ nguyên hướng máy TƯƠNG ĐỐI",
 *   tức là máy phải quay theo Line. Nếu chỉ áp vị trí, mọi máy sẽ đứng nguyên
 *   hướng cũ trong một Line đã xoay 90° và cả dây chuyền quay lưng vào dòng chảy.
 */
export function doiHuongLine(
  vatThe: readonly ViTriDaDat[],
  gocDo: number,
): ViTriMoi[] {
  if (vatThe.length === 0) return [];
  const bbox = gopNhieuBBox(vatThe.map(bboxCua));
  if (!bboxCoThuc(bbox)) return vatThe.map((v) => ({ khoa: v.khoa, tam: v.tam }));
  const tamX = (bbox.minX + bbox.maxX) / 2;
  const tamZ = (bbox.minZ + bbox.maxZ) / 2;
  const rad = ((Number.isFinite(gocDo) ? gocDo : 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return vatThe.map((v) => {
    const dx = v.tam.x - tamX;
    const dz = v.tam.z - tamZ;
    return {
      khoa: v.khoa,
      tam: {
        x: tamX + dx * cos - dz * sin,
        y: v.tam.y,
        z: tamZ + dx * sin + dz * cos,
      },
    };
  });
}

/**
 * Line có trạm nào THIẾU `orderIndex` không?
 *
 * ★ G8 — TRUE khi có ít nhất một trạm `thuTu == null`; FALSE với dữ liệu thật
 *   của repo (§10C.0: 37/37 trạm có orderIndex). Cờ này gác cảnh báo "chưa xác
 *   định được thứ tự dòng chảy" — nếu nó luôn false thì một Line mới nhập
 *   thiếu thứ tự sẽ vẽ mũi tên dòng chảy theo thứ tự chữ cái của mã trạm mà
 *   không ai biết con số đó là bịa.
 */
export function coTramThieuThuTu(tram: readonly ViTriDaDat[]): boolean {
  return tram.some((t) => t.thuTu === null || t.thuTu === undefined);
}
