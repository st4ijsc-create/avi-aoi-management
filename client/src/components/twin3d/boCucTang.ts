/**
 * boCucTang.ts — Bố cục toà nhà và các tầng theo CON ĐƯỜNG B (§10A.2).
 *
 * Con đường B là con đường MẶC ĐỊNH khi không có bản vẽ: người dùng điền
 * dài × rộng × cao từng mặt sàn, hệ dựng khối. Module này là phần TOÁN của
 * form ba bước — không có nó, mọi phép quy đổi và cộng cao độ nằm rải trong
 * .tsx và KHÔNG test được (vitest environment "node", RB-8.1).
 *
 * ★★★ NHẬP BẰNG MÉT, LƯU BẰNG MILIMÉT — và phép nhân 1000 nằm ở ĐÚNG MỘT chỗ:
 *   `heToaDo.metSangMm`/`mmSangMet`. Không dòng nào trong file này viết hằng số
 *   1000. Lý do: hai chỗ chia 1000 là hai chỗ có thể lệch nhau, và lệch đơn vị
 *   1000 lần chính là lớp lỗi mà §10A.1 dựng cả một hộp thoại để chống.
 *
 * ★★★ NT-4 — SỐ GIẢ ĐỊNH PHẢI TỰ KHAI. Mọi giá trị module này SINH ra (cao độ
 *   tự tính, tường bao, kích thước tầng thừa kế từ toà nhà) mang `nguon='sinh'`
 *   ⇒ UI hiện badge vàng "chưa đo". Giá trị người NHẬP mang `nguon='tay'` và
 *   lần sinh sau KHÔNG ĐÈ (xem `apDungCaoDoTuTinh` — nó giữ nguyên mọi tầng đã
 *   có `caoDoM`).
 *
 * ⚠ TUYỆT ĐỐI KHÔNG đọc `factories.floorWidthM/floorDepthM` (§10A.0): SIM-FAC có
 *   floorWidthM=1500 / floorDepthM=1200 — đọc đúng đơn vị là 1,5 km × 1,2 km,
 *   số rác do ai đó nhập pixel vào ô mét. Module này chỉ nhận số từ form.
 *
 * ★ Module THUẦN: không import three.js, không import react.
 * ★ Tất định: không Math.random(), không Date.now().
 */

import {
  bboxTuTamVaKichThuoc,
  metSangMm,
  mmSangMet,
  type BBox,
} from "./heToaDo";

// ---------------------------------------------------------------------------
// Hằng số thiết kế — mỗi hằng có LÝ DO, không phải số đẹp
// ---------------------------------------------------------------------------

/**
 * Bề dày kết cấu sàn giữa hai tầng, mm (§10A.2).
 * `caoDo(n+1) = caoDo(n) + caoThongThuy(n) + DAY_SAN_MM`.
 * 300 mm là dầm + bản sàn bê tông điển hình của nhà xưởng — một GIẢ ĐỊNH, nên
 * mọi cao độ suy ra từ nó mang `nguon='sinh'`.
 */
export const DAY_SAN_MM = 300;

/** Bề dày tường bao sinh tự động, mm (§10A.2 — "dày 200 mm"). */
export const DAY_TUONG_MM = 200;

/** Cao thông thuỷ mặc định của một tầng, mm — khớp DEFAULT của `twin_tang`. */
export const CAO_THONG_THUY_MAC_DINH_MM = 6000;

/** Nguồn của một giá trị (khớp `twinnguonenum` của DB). */
export type NguonGiaTri = "sinh" | "tay";

/** Nguồn hình học mặt sàn (khớp `twin_tang.nguonHinhHoc`, §10A.4). */
export type NguonHinhHoc = "nhap_tay" | "ban_ve" | "sinh";

// ---------------------------------------------------------------------------
// Đầu vào của form — người dùng nghĩ và gõ bằng MÉT
// ---------------------------------------------------------------------------

/** Bước 1 của form: kích thước bao ngoài toà nhà, đơn vị MÉT. */
export interface ToaNhaNhapMet {
  ma: string;
  ten: string;
  /** Dài (trục X, Đông) — mét. */
  daiM: number;
  /** Rộng (trục Y mặt bằng) — mét. */
  rongM: number;
  /** Cao bao ngoài — mét. */
  caoM: number;
  /** Vị trí góc toà nhà trong khuôn viên — mét. Mặc định 0. */
  viTriXM?: number;
  viTriYM?: number;
}

/** Một dòng của bảng tầng ở bước 2, đơn vị MÉT. */
export interface TangNhapMet {
  capSo: number;
  ten: string;
  /**
   * Dài mặt sàn (m). `undefined` = "cùng kích thước với toà nhà" (ô tích ở
   * §10A.2) ⇒ thừa kế, và giá trị thừa kế là SINH chứ không phải ĐO.
   */
  daiM?: number;
  rongM?: number;
  caoThongThuyM: number;
  /**
   * Cao độ sàn (m). `undefined` = để hệ tự tính (§10A.2). Có giá trị = người
   * dùng SỬA ĐÈ ⇒ `nguon='tay'` và lần tự tính sau không được đè lên.
   */
  caoDoM?: number;
}

// ---------------------------------------------------------------------------
// Đầu ra — đơn vị MILIMÉT, sẵn sàng ghi vào twin_toa_nha / twin_tang
// ---------------------------------------------------------------------------

/** Toà nhà đã quy đổi sang mm, đúng tên cột của `twin_toa_nha`. */
export interface ToaNhaMm {
  ma: string;
  ten: string;
  /** ⚠ `twin_toa_nha` gọi cạnh trục X là `rongMm` (bao ngoài) — DÀI của form vào đây. */
  rongMm: number;
  /** ⚠ `twin_toa_nha` gọi cạnh trục Y mặt bằng là `sauMm` — RỘNG của form vào đây. */
  sauMm: number;
  caoMm: number;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  nguon: NguonGiaTri;
}

/** Tầng đã quy đổi sang mm, đúng tên cột của `twin_tang`. */
export interface TangMm {
  capSo: number;
  ten: string;
  caoDoMm: number;
  caoThongThuyMm: number;
  /** Dài mặt sàn (trục X). */
  daiMm: number;
  /** Rộng mặt sàn (trục Y mặt bằng). */
  rongMm: number;
  nguonHinhHoc: NguonHinhHoc;
  /** ★ NT-4 — cao độ này do người nhập hay do hệ tính? */
  caoDoNguon: NguonGiaTri;
  /** ★ NT-4 — kích thước mặt sàn do người nhập hay thừa kế từ toà nhà? */
  kichThuocNguon: NguonGiaTri;
  /** Nguồn tổng của hàng, ghi vào cột `twin_tang.nguon`. */
  nguon: NguonGiaTri;
}

/** Một tường bao sinh tự động (§10A.2), sẵn sàng ghi vào `twin_vat_the`. */
export interface TuongBaoMm {
  loai: "tuong";
  ten: string;
  /** Tâm tường, mm, gốc = góc mặt sàn (0,0). Z là ĐỘ CAO (§5.2). */
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  rongMm: number;
  caoMm: number;
  sauMm: number;
  /** ★ Tường bao LUÔN 'sinh' — không ai đo bốn bức tường này (§10A.2). */
  nguon: NguonGiaTri;
}

// ---------------------------------------------------------------------------
// Quy đổi toà nhà
// ---------------------------------------------------------------------------

/**
 * Bước 1 → hàng `twin_toa_nha`. Mét vào, milimét ra.
 *
 * ⚠ Ánh xạ tên KHÔNG hiển nhiên và là chỗ dễ sai nhất của cả module:
 *   form "Dài"  (trục X) → cột `rongMm`
 *   form "Rộng" (trục Y) → cột `sauMm`
 * Tên cột do §5.3 đặt theo góc nhìn "nhà rộng bao nhiêu, sâu bao nhiêu"; form do
 * §10A.2 đặt theo góc nhìn "xưởng dài 84 mét". Hai cách gọi CÙNG MỘT cạnh. Ghi
 * rõ ở đây để không ai hoán vị nhầm hai trục rồi dựng ra nhà xoay 90°.
 *
 * `nguon='tay'`: đây là số NGƯỜI GÕ, không phải hệ đoán ⇒ không badge "chưa đo".
 */
export function toaNhaMetSangMm(nhap: ToaNhaNhapMet): ToaNhaMm {
  return {
    ma: nhap.ma,
    ten: nhap.ten,
    rongMm: metSangMm(nhap.daiM),
    sauMm: metSangMm(nhap.rongM),
    caoMm: metSangMm(nhap.caoM),
    viTriXMm: metSangMm(nhap.viTriXM ?? 0),
    viTriYMm: metSangMm(nhap.viTriYM ?? 0),
    viTriZMm: 0,
    nguon: "tay",
  };
}

/**
 * BBox bao ngoài toà nhà trong hệ SCENE (mét), để xem trước ở bước 3.
 * Toà nhà đứng TRÊN sàn: đáy tại y=0, không phải tâm tại y=0.
 */
export function bboxToaNhaScene(toaNha: ToaNhaMm): BBox {
  const rong = mmSangMet(toaNha.rongMm);
  const sau = mmSangMet(toaNha.sauMm);
  const cao = mmSangMet(toaNha.caoMm);
  const gocX = mmSangMet(toaNha.viTriXMm);
  const gocZ = mmSangMet(toaNha.viTriYMm);
  return bboxTuTamVaKichThuoc(
    { x: gocX + rong / 2, y: cao / 2, z: gocZ + sau / 2 },
    { rong, cao, sau },
  );
}

// ---------------------------------------------------------------------------
// Cao độ tự tính — và luật KHÔNG ĐÈ của NT-4
// ---------------------------------------------------------------------------

/**
 * Cao độ SINH của tầng kế trên: `caoDo(n) + caoThongThuy(n) + DAY_SAN_MM`.
 * Tách riêng thành một hàm để phép tiêm-lỗi của sàng mật độ assertion nhắm trúng
 * đúng một chỗ, thay vì rải phép cộng này trong vòng lặp.
 */
export function caoDoTangKeTiepMm(caoDoMm: number, caoThongThuyMm: number): number {
  return caoDoMm + caoThongThuyMm + DAY_SAN_MM;
}

/**
 * Điền cao độ cho danh sách tầng (tự sắp theo `capSo` tăng dần).
 *
 * ★★★ LUẬT NT-4 — KHÔNG ĐÈ: tầng nào người dùng đã gõ `caoDoM` thì GIỮ NGUYÊN và
 *   đánh dấu `nguon='tay'`; tầng bỏ trống mới được tính. Và cao độ tính cho tầng
 *   kế tiếp LUÔN nối từ cao độ THỰC TẾ của tầng ngay dưới (dù cao độ đó là tay
 *   hay sinh) — nếu nối từ một chuỗi sinh thuần, một lần sửa tay ở giữa sẽ làm
 *   mọi tầng trên nó lệch mà không có gì báo (lỗi câm).
 *
 * Tầng ÂM (hầm) chạy đúng luật này: `capSo = -1` đứng trước `1` sau khi sắp, nên
 * nó là mốc và tầng 1 tính từ nó.
 */
export function apDungCaoDoTuTinh(
  tangs: readonly TangNhapMet[],
  mocCaoDoMm = 0,
): { capSo: number; caoDoMm: number; nguon: NguonGiaTri }[] {
  const daSap = [...tangs].sort((a, b) => a.capSo - b.capSo);
  const ket: { capSo: number; caoDoMm: number; nguon: NguonGiaTri }[] = [];
  let caoDoChay = mocCaoDoMm;

  for (const t of daSap) {
    const daNhapTay = t.caoDoM !== undefined && Number.isFinite(t.caoDoM);
    const caoDoMm = daNhapTay ? metSangMm(t.caoDoM as number) : caoDoChay;
    ket.push({ capSo: t.capSo, caoDoMm, nguon: daNhapTay ? "tay" : "sinh" });
    // Nối từ cao độ THỰC TẾ của tầng này, không từ chuỗi sinh thuần.
    caoDoChay = caoDoTangKeTiepMm(caoDoMm, metSangMm(t.caoThongThuyM));
  }
  return ket;
}

// ---------------------------------------------------------------------------
// Quy đổi tầng
// ---------------------------------------------------------------------------

/**
 * Bước 2 → các hàng `twin_tang`. Mét vào, milimét ra, cao độ tự tính đã áp.
 *
 * Tầng KHÔNG khai `daiM`/`rongM` thì THỪA KẾ kích thước toà nhà và mang
 * `kichThuocNguon='sinh'` + `nguonHinhHoc='sinh'` ⇒ badge vàng "chưa đo". Thừa
 * kế là một PHỎNG ĐOÁN ("chắc tầng 2 cũng bằng tầng 1"), và NT-4 buộc phỏng đoán
 * phải tự khai.
 *
 * Tầng khai kích thước riêng (tầng lửng, tầng kỹ thuật — §10A.2) mang
 * `nguonHinhHoc='nhap_tay'`.
 *
 * `nguon` tổng của hàng là 'tay' khi CÓ ÍT NHẤT MỘT ô người dùng thật sự gõ
 * (kích thước hoặc cao độ); 'sinh' khi mọi thứ đều suy ra.
 */
export function tangMetSangMm(
  tangs: readonly TangNhapMet[],
  toaNha: ToaNhaMm,
  mocCaoDoMm = 0,
): TangMm[] {
  const caoDos = apDungCaoDoTuTinh(tangs, mocCaoDoMm);
  const theoCap = new Map(caoDos.map((c) => [c.capSo, c]));
  const daSap = [...tangs].sort((a, b) => a.capSo - b.capSo);

  return daSap.map((t) => {
    const coKichThuocRieng =
      t.daiM !== undefined &&
      Number.isFinite(t.daiM) &&
      t.rongM !== undefined &&
      Number.isFinite(t.rongM);
    const caoDo = theoCap.get(t.capSo);
    const caoDoMm = caoDo ? caoDo.caoDoMm : mocCaoDoMm;
    const caoDoNguon: NguonGiaTri = caoDo ? caoDo.nguon : "sinh";

    return {
      capSo: t.capSo,
      ten: t.ten,
      caoDoMm,
      caoThongThuyMm: metSangMm(t.caoThongThuyM),
      daiMm: coKichThuocRieng ? metSangMm(t.daiM as number) : toaNha.rongMm,
      rongMm: coKichThuocRieng ? metSangMm(t.rongM as number) : toaNha.sauMm,
      nguonHinhHoc: coKichThuocRieng ? "nhap_tay" : "sinh",
      caoDoNguon,
      kichThuocNguon: coKichThuocRieng ? "tay" : "sinh",
      nguon: coKichThuocRieng || caoDoNguon === "tay" ? "tay" : "sinh",
    };
  });
}

/**
 * BBox của một mặt sàn trong hệ SCENE (mét). Sàn là khối MỎNG (dày = DAY_SAN_MM)
 * nằm NGAY DƯỚI cao độ: `caoDoMm` là cốt MẶT TRÊN của sàn, đúng nghĩa "cao độ
 * sàn" trong xây dựng, nên máy đặt tại z = caoDo đứng TRÊN mặt sàn chứ không lún
 * nửa người vào nó.
 */
export function bboxTangScene(tang: TangMm, toaNha: ToaNhaMm): BBox {
  const dai = mmSangMet(tang.daiMm);
  const rong = mmSangMet(tang.rongMm);
  const day = mmSangMet(DAY_SAN_MM);
  const gocX = mmSangMet(toaNha.viTriXMm);
  const gocZ = mmSangMet(toaNha.viTriYMm);
  const matTren = mmSangMet(tang.caoDoMm);
  return bboxTuTamVaKichThuoc(
    { x: gocX + dai / 2, y: matTren - day / 2, z: gocZ + rong / 2 },
    { rong: dai, cao: day, sau: rong },
  );
}

/**
 * Tầng có nhỏ hơn toà nhà không (tầng lửng / tầng kỹ thuật — §10A.2)?
 * Dùng để UI chú thích, thay vì để người dùng tự đoán vì sao mặt sàn hụt.
 */
export function tangNhoHonToaNha(tang: TangMm, toaNha: ToaNhaMm): boolean {
  return tang.daiMm < toaNha.rongMm || tang.rongMm < toaNha.sauMm;
}

/**
 * Tầng có TRÀN ra ngoài bao ngoài toà nhà không — lỗi nhập liệu thật (gõ 840 thay
 * vì 84). Trả về true là điều kiện CHẶN ở bước 3, không phải cảnh báo mềm.
 */
export function tangTranKhoiToaNha(tang: TangMm, toaNha: ToaNhaMm): boolean {
  return tang.daiMm > toaNha.rongMm || tang.rongMm > toaNha.sauMm;
}

/**
 * ★★★ Đợt 3 THƯỜNG-4 — tầng có ĐỘI QUA MÁI toà nhà không?
 *
 * `tangTranKhoiToaNha` ở trên chỉ so HAI trục MẶT BẰNG (dài × rộng) và bỏ trục
 * CAO hoàn toàn. Hệ quả đo được:
 *
 *   toà cao 12 000 mm, 3 tầng × 6 m
 *     → đỉnh tầng 3 ở 18 600 mm — vượt 6,6 m RA NGOÀI MÁI
 *     → `kiemTraNhapLieu` trả về mảng **RỖNG** (không lỗi, không cảnh báo)
 *
 * Người dùng bấm [Tạo], API nhận, DB ghi, và cảnh 3D dựng ra ba tầng chọc thủng
 * nóc một toà nhà 12 m. Không gì trong đường đi nói cho họ biết — đúng lớp lỗi
 * câm mà NT-3 chống: một phỏng đoán sai được ghi xuống như một sự thật.
 *
 * ⚠ So ĐỈNH CAO NHẤT trong toàn bộ tầng, không so từng tầng riêng lẻ: cao độ
 *   `caoDoMm` có thể ÂM (tầng hầm) và tầng hầm KHÔNG được tính là "vượt mái".
 *   Điều phải hỏi là "chỗ cao nhất của công trình có quá mái không", tức
 *   `max(caoDoMm + caoThongThuyMm)` — một phép max trên toàn danh sách.
 *
 * ⚠ KHÔNG cộng `DAY_SAN_MM` vào đỉnh: `caoDoMm` là cốt MẶT TRÊN của sàn (xem
 *   `bboxTangScene`), nên `caoDo + caoThongThuy` đã đúng là mặt dưới của sàn kế
 *   trên. Cộng thêm bề dày sàn là đếm đúp và sẽ báo lỗi giả cho một toà nhà vừa khít.
 */
export function tangVuotChieuCaoToaNha(
  tangs: readonly TangMm[],
  toaNha: ToaNhaMm,
): boolean {
  if (tangs.length === 0) return false;
  const dinhCaoNhat = Math.max(...tangs.map((t) => t.caoDoMm + t.caoThongThuyMm));
  return dinhCaoNhat > toaNha.caoMm;
}

// ---------------------------------------------------------------------------
// Sinh tường bao (§10A.2)
// ---------------------------------------------------------------------------

/**
 * Sinh ĐÚNG 4 tường bao theo chu vi mặt sàn, dày `DAY_TUONG_MM`.
 *
 * "Để tầng không phải một mặt phẳng trơ" (§10A.2) — và để người dùng thấy ngay
 * tỉ lệ của không gian ở bước xem trước.
 *
 * Quy ước: gốc mặt sàn tại (0,0); tường nằm BÊN TRONG chu vi (mép ngoài tường
 * trùng mép sàn), nên mặt bằng không tự phình ra ngoài bao ngoài toà nhà. Hai
 * tường theo trục X kéo hết chiều dài; hai tường theo trục Y bị RÚT NGẮN đúng
 * hai lần bề dày để bốn góc KHÔNG chồng nhau — chồng góc làm mọi phép đếm thể
 * tích / kiểm giao nhau về sau sai một lượng nhỏ mà không ai truy ra.
 *
 * Toạ độ trả về là TÂM khối, hệ DB (mm), Z = ĐỘ CAO (§5.2). Tường cao đúng
 * `caoThongThuyMm` của tầng, đáy tại `caoDoMm`.
 */
/**
 * ★★★ Đợt 3 THƯỜNG-5 — mặt sàn có QUÁ HẸP để sinh nổi 4 tường bao không?
 *
 * `sinhTuongBao` đặt tường BÊN TRONG chu vi, dày `DAY_TUONG_MM` mỗi bên. Một
 * cạnh nhỏ hơn `2 × DAY_TUONG_MM` thì hai bức tường đối diện ĂN HẾT cạnh đó và
 * còn chồng lên nhau. Đo được với `rong = 300 mm` (DAY_TUONG_MM = 200):
 *
 *   · tường Tây/Đông:  `sauMm = max(300 − 400, 0) = 0`  ⇒ khối SUY BIẾN
 *   · tường Bắc ở y=100, tường Nam ở y=200, mỗi bức dày 200 ⇒ CHỒNG NHAU
 *
 * Rồi router `twinCanhRouter` có `.positive()` trên mọi cạnh nên nó TỪ CHỐI
 * `sauMm = 0` — người dùng nhận một lỗi validate về một con số họ chưa từng gõ
 * (0 là do phép trừ ở đây sinh ra, không phải do họ nhập). Không đường nào từ
 * thông báo đó về lại ô "Rộng" mà họ cần sửa.
 *
 * ⇒ Chặn ở bước 3 với một câu nói ĐÚNG chỗ sai, thay vì để nó vỡ ở tầng API.
 *
 * ⚠ Dùng `<=` chứ KHÔNG `<`, và đây là chỗ dễ sai một-đơn-vị: cạnh ĐÚNG BẰNG
 *   `2 × DAY_TUONG_MM` (400 mm) vẫn hỏng — `max(400 − 400, 0) = 0`, tức tường
 *   Tây/Đông vẫn suy biến thành `sauMm = 0` và router `.positive()` vẫn từ chối.
 *   Ca biên ấy PHẢI nằm trong vùng bị chặn, nên phép so là `<=`. Dùng `<` sẽ để
 *   lọt đúng một giá trị — và đúng cái giá trị mà người dùng hay gõ tròn số.
 */
export function sanQuaHepChoTuongBao(tang: TangMm): boolean {
  const toiThieu = 2 * DAY_TUONG_MM;
  return tang.daiMm <= toiThieu || tang.rongMm <= toiThieu;
}

export function sinhTuongBao(tang: TangMm): TuongBaoMm[] {
  const dai = tang.daiMm;
  const rong = tang.rongMm;
  const cao = tang.caoThongThuyMm;
  const d = DAY_TUONG_MM;
  const zTam = tang.caoDoMm + cao / 2;

  // Rút hai đầu để không chồng góc. Sàn hẹp hơn 2 lần bề dày cho ra 0 (không âm)
  // — hình suy biến, nhưng KHÔNG được là số âm: kích thước âm làm three dựng mặt
  // lộn trong ra ngoài mà không có lỗi nào nổ.
  const daiTrucY = Math.max(rong - 2 * d, 0);

  return [
    {
      loai: "tuong",
      ten: "Tường Bắc",
      viTriXMm: dai / 2,
      viTriYMm: d / 2,
      viTriZMm: zTam,
      rongMm: dai,
      caoMm: cao,
      sauMm: d,
      nguon: "sinh",
    },
    {
      loai: "tuong",
      ten: "Tường Nam",
      viTriXMm: dai / 2,
      viTriYMm: rong - d / 2,
      viTriZMm: zTam,
      rongMm: dai,
      caoMm: cao,
      sauMm: d,
      nguon: "sinh",
    },
    {
      loai: "tuong",
      ten: "Tường Tây",
      viTriXMm: d / 2,
      viTriYMm: rong / 2,
      viTriZMm: zTam,
      rongMm: d,
      caoMm: cao,
      sauMm: daiTrucY,
      nguon: "sinh",
    },
    {
      loai: "tuong",
      ten: "Tường Đông",
      viTriXMm: dai - d / 2,
      viTriYMm: rong / 2,
      viTriZMm: zTam,
      rongMm: d,
      caoMm: cao,
      sauMm: daiTrucY,
      nguon: "sinh",
    },
  ];
}

// ---------------------------------------------------------------------------
// Kiểm tra đầu vào của form (bước 3 chặn trước khi gọi API)
// ---------------------------------------------------------------------------

/** Một lỗi nhập liệu — `khoa` là hậu tố khoá i18n, `capSo` chỉ có khi lỗi ở một tầng. */
export interface LoiNhapLieu {
  khoa: string;
  capSo?: number;
}

/**
 * Kiểm bộ dữ liệu form trước khi cho bấm [Tạo].
 *
 * ⚠ Trả về DANH SÁCH lỗi, không phải lỗi đầu tiên: người dùng sửa một vòng thay
 * vì bấm-lỗi-sửa-bấm-lỗi. (Bài học Khối D: "danh sách thay vì bất biến".)
 */
export function kiemTraNhapLieu(
  toaNha: ToaNhaNhapMet,
  tangs: readonly TangNhapMet[],
): LoiNhapLieu[] {
  const loi: LoiNhapLieu[] = [];

  if (!toaNha.ma || toaNha.ma.trim().length === 0) loi.push({ khoa: "thieuMa" });
  if (!toaNha.ten || toaNha.ten.trim().length === 0) loi.push({ khoa: "thieuTen" });
  for (const [ten, gt] of [
    ["daiM", toaNha.daiM],
    ["rongM", toaNha.rongM],
    ["caoM", toaNha.caoM],
  ] as const) {
    if (!Number.isFinite(gt) || (gt as number) <= 0) {
      loi.push({ khoa: `kichThuocKhongHopLe.${ten}` });
    }
  }

  if (tangs.length === 0) loi.push({ khoa: "khongCoTang" });

  const daGap = new Set<number>();
  for (const t of tangs) {
    if (!Number.isInteger(t.capSo) || t.capSo === 0) {
      // capSo = 0 bị cấm ở migration 0350: nhập nhằng "tầng trệt" vs "chưa đặt".
      loi.push({ khoa: "capSoKhongHopLe", capSo: t.capSo });
    } else if (daGap.has(t.capSo)) {
      loi.push({ khoa: "capSoTrung", capSo: t.capSo });
    }
    daGap.add(t.capSo);

    if (!t.ten || t.ten.trim().length === 0) {
      loi.push({ khoa: "thieuTenTang", capSo: t.capSo });
    }
    if (!Number.isFinite(t.caoThongThuyM) || t.caoThongThuyM <= 0) {
      loi.push({ khoa: "caoThongThuyKhongHopLe", capSo: t.capSo });
    }
  }

  // Tràn khỏi bao ngoài — chỉ kiểm khi kích thước toà nhà đã hợp lệ, nếu không
  // một lỗi gốc sẽ đẻ ra N lỗi phái sinh và che mất chính nó.
  if (!loi.some((l) => l.khoa.startsWith("kichThuocKhongHopLe"))) {
    const tn = toaNhaMetSangMm(toaNha);
    const tangsMm = tangMetSangMm(tangs, tn);
    for (const t of tangsMm) {
      if (tangTranKhoiToaNha(t, tn)) {
        loi.push({ khoa: "tangTranKhoiToaNha", capSo: t.capSo });
      }
      // ★ Đợt 3 THƯỜNG-5 — sàn hẹp hơn hai lần bề dày tường ⇒ tường suy biến +
      //   chồng nhau, và router `.positive()` sẽ từ chối `sauMm = 0` bằng một
      //   câu người dùng không nối được về ô nào. Nói ở đây, đúng chỗ họ gõ.
      if (sanQuaHepChoTuongBao(t)) {
        loi.push({ khoa: "sanQuaHepChoTuongBao", capSo: t.capSo });
      }
    }

    // ★★★ Đợt 3 THƯỜNG-4 — trục CAO, thứ mà `tangTranKhoiToaNha` bỏ hoàn toàn.
    //   Kiểm MỘT LẦN trên cả bộ (không phải mỗi tầng): câu hỏi là "công trình có
    //   đội mái không", và một lỗi cho cả bộ đọc dễ hơn N lỗi giống nhau.
    if (tangVuotChieuCaoToaNha(tangsMm, tn)) {
      loi.push({ khoa: "tangVuotChieuCaoToaNha" });
    }
  }

  return loi;
}
