/**
 * cumTram.ts — HÌNH HỌC CỦA BẬC ĐƠN VỊ VẼ THỨ BA: **một biểu tượng = một CỤM TRẠM**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VỊ TRÍ TRONG HỆ
 * ════════════════════════════════════════════════════════════════════════════
 *     tập đoàn  →  biểu tượng TOÀ NHÀ   (`canhTapDoan`, Task 20)
 *     nhà máy   →  biểu tượng CỤM TRẠM  ← TỆP NÀY, khi mật độ vượt ngưỡng
 *     line      →  một khối = một máy   (không đụng tới)
 *
 * Công tắc "khi nào đổi" nằm ở `nguongDonViVe`; tệp này chỉ trả lời "đổi thành cái gì".
 * Hai việc tách bạch để mỗi việc có lưới riêng — gộp lại thì một con số sai không truy được
 * về phía nào.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CỠ BIỂU TƯỢNG SUY NGƯỢC TỪ NGƯỠNG BẤM, KHÔNG PHẢI MỘT HẰNG THẾ GIỚI
 * ════════════════════════════════════════════════════════════════════════════
 * Task 20 dùng `BIEU_TUONG_TOI_THIEU_MM = 20 m` — một sàn trong **không gian thế giới**. Sàn ấy
 * đúng ở đúng một tư thế camera: lùi ra xa là biểu tượng lại nhỏ hơn ngưỡng bấm, và ta quay về
 * đúng bài toán vừa giải.
 *
 * Ở đây cỡ được **suy ngược từ ngưỡng pixel** qua `coThatToiThieuM`, dùng khoảng cách THẬT từ
 * camera tới chính cụm đó. Hệ quả: tiêu chí nghiệm thu *"≥ 90 % đơn vị vẽ đạt 24×24 px"* là
 * **hệ quả của phép dựng**, không phải một điều cần cầu may.
 *
 * ⚠ Cỡ cuối = `max(trung vị cỡ máy thành viên, cỡ tối thiểu theo ngưỡng)`. Giữ vế đầu để một
 *   cụm toàn máy lớn không bị teo lại thành biểu tượng bé hơn máy thật của nó.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ GIỮ LẠI SỰ THẬT ĐÃ BỊ THAY
 * ════════════════════════════════════════════════════════════════════════════
 * Cùng ràng buộc trung thực mà Task 20 chịu: khi vị trí/cỡ trên cảnh là **ước lệ**, giao diện
 * phải NÓI RA. Nên mỗi cụm mang theo `thatRongM`/`thatSauM` — bề rộng THẬT của vùng máy mà biểu
 * tượng đã thay — để banner nêu được CẢ HAI con số thay vì một câu chung chung.
 *
 * ⚠ Máy **chưa gán line** (`lineId == null`) gom thành MỘT cụm mang `lineId: null`, không rải mỗi
 *   máy một cụm (rải thì chúng lại bé như cũ) và cũng không nhét vào một line nào (nhét là bịa
 *   ra một quan hệ). `thatRongM`/`thatSauM` của cụm ấy sẽ lớn bất thường nếu chúng nằm rải rác
 *   khắp sàn — và đó là thông tin đúng, không phải khuyết tật của phép gộp.
 */
import {
  NGUONG_CANH_NHO_PX,
  coThatToiThieuM,
  khoangCachToiMay,
  type DiemMet,
} from "./nguongDonViVe";

/** Máy tối thiểu để gộp cụm — hình dạng con của `MayDaDung` + khoá gộp + cờ bất thường. */
export interface MayDeGopCum {
  machineId: number;
  /** `null` = chưa gán line. Gom riêng, không nhét vào line nào. */
  lineId: number | null;
  /** Hệ CẢNH (mét), `y` là độ cao — cùng quy ước `DiemScene`. */
  viTri: DiemMet;
  kichThuocMm: { rongMm: number; caoMm: number; sauMm: number };
  batThuong?: boolean;
}

/** Một biểu tượng cụm — ĐƠN VỊ VẼ ở cấp nhà máy khi mật độ vượt ngưỡng. */
export interface CumTram {
  /** `null` = cụm "chưa gán line". */
  lineId: number | null;
  soMay: number;
  soBatThuong: number;
  /** Tâm biểu tượng, hệ CẢNH (mét). `y` = nửa chiều cao ⇒ biểu tượng ĐỨNG TRÊN sàn `y = 0`. */
  viTri: DiemMet;
  rongM: number;
  caoM: number;
  sauM: number;
  /** Bề rộng/bề sâu THẬT của vùng máy mà biểu tượng này đã thay (mét). */
  thatRongM: number;
  thatSauM: number;
  /** Id máy thành viên — để bấm vào cụm còn biết mở cái gì, và để lưới đếm lại được. */
  machineIds: number[];
}

export interface TuyChonCum {
  /** Ngưỡng cạnh nhỏ (px). Mặc định {@link NGUONG_CANH_NHO_PX}. */
  nguongPx?: number;
  /** Trường nhìn dọc (độ). Mặc định 45 — khớp mặc định của `KhungCanh`. */
  fovDo?: number;
}

const trungVi = (ds: number[]): number =>
  ds.length === 0 ? 0 : [...ds].sort((a, b) => a - b)[Math.floor((ds.length - 1) / 2)];

/**
 * Gộp máy thành cụm theo `lineId`.
 *
 * ★ Thứ tự đầu ra ỔN ĐỊNH: theo `lineId` tăng dần, cụm `null` xếp CUỐI. Thứ tự ổn định không
 *   phải chuyện thẩm mỹ — `LoBatchMay` ghi màu theo chỉ số instance, nên một thứ tự nhảy giữa
 *   hai lần dựng là màu nhảy theo.
 */
export function gopTheoLine(may: readonly MayDeGopCum[]): Map<number | null, MayDeGopCum[]> {
  const theo = new Map<number | null, MayDeGopCum[]>();
  for (const m of may) {
    const k = m.lineId ?? null;
    const ds = theo.get(k);
    if (ds) ds.push(m);
    else theo.set(k, [m]);
  }
  const khoa = [...theo.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });
  const raSapXep = new Map<number | null, MayDeGopCum[]>();
  for (const k of khoa) raSapXep.set(k, theo.get(k)!);
  return raSapXep;
}

/**
 * Dựng biểu tượng cụm cho một tập máy, ở một tư thế camera cụ thể.
 *
 * Tập rỗng ⇒ mảng rỗng (KHÔNG phải một cụm rỗng — một biểu tượng đại diện cho 0 máy là một lời
 * nói dối trên cảnh).
 */
export function dungCumTram(
  may: readonly MayDeGopCum[],
  camera: DiemMet,
  caoCanvasPx: number,
  tuyChon: TuyChonCum = {},
): CumTram[] {
  if (may.length === 0) return [];
  const nguongPx = tuyChon.nguongPx ?? NGUONG_CANH_NHO_PX;
  const fovDo = tuyChon.fovDo ?? 45;

  const ra: CumTram[] = [];
  for (const [lineId, ds] of gopTheoLine(may)) {
    const xs = ds.map((m) => m.viTri.x);
    const zs = ds.map((m) => m.viTri.z);
    const tamX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const tamZ = (Math.min(...zs) + Math.max(...zs)) / 2;
    const thatRongM = Math.max(...xs) - Math.min(...xs);
    const thatSauM = Math.max(...zs) - Math.min(...zs);

    /*
     * Khoảng cách lấy tại TÂM cụm và ở độ cao 0 — cùng chỗ mà biểu tượng sẽ đứng. Lấy ở độ cao
     * của biểu tượng sau khi đã biết cỡ sẽ thành vòng lặp (cỡ phụ thuộc d, d phụ thuộc cỡ);
     * chênh lệch do nửa chiều cao là bậc mét trên khoảng cách bậc trăm mét, không đáng kể.
     */
    const d = khoangCachToiMay(camera, { x: tamX, y: 0, z: tamZ });
    const toiThieuM = coThatToiThieuM(nguongPx, d, fovDo, caoCanvasPx);

    const rongM = Math.max(trungVi(ds.map((m) => m.kichThuocMm.rongMm)) / 1000, toiThieuM);
    const sauM = Math.max(trungVi(ds.map((m) => m.kichThuocMm.sauMm)) / 1000, toiThieuM);
    const caoM = Math.max(trungVi(ds.map((m) => m.kichThuocMm.caoMm)) / 1000, toiThieuM);

    ra.push({
      lineId,
      soMay: ds.length,
      soBatThuong: ds.filter((m) => m.batThuong === true).length,
      viTri: { x: tamX, y: caoM / 2, z: tamZ },
      rongM, caoM, sauM,
      thatRongM, thatSauM,
      machineIds: ds.map((m) => m.machineId),
    });
  }
  return ra;
}

/**
 * Đếm số CẶP biểu tượng chồng nhau trên mặt bằng (hình chiếu xuống sàn).
 *
 * ★ Vì sao phải có: cỡ biểu tượng được PHÓNG TO cho đạt ngưỡng bấm, nên chúng có thể đè lên
 *   nhau — và hai đích bấm chồng nhau thì con số "đạt 24×24" trở thành nửa sự thật. Hàm này để
 *   lưới và phép nghiệm thu ĐẾM ĐƯỢC chuyện đó thay vì để nó trôi qua.
 *   ⚠ Nó KHÔNG sửa chồng lấn — sửa là một quyết định bố cục riêng, cần số trước đã.
 */
export function demCapChongNhau(cum: readonly CumTram[]): number {
  let so = 0;
  for (let i = 0; i < cum.length; i++) {
    for (let j = i + 1; j < cum.length; j++) {
      const a = cum[i], b = cum[j];
      const chongX = Math.abs(a.viTri.x - b.viTri.x) < (a.rongM + b.rongM) / 2;
      const chongZ = Math.abs(a.viTri.z - b.viTri.z) < (a.sauM + b.sauM) / 2;
      if (chongX && chongZ) so += 1;
    }
  }
  return so;
}
