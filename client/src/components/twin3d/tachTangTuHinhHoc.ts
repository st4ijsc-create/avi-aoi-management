/**
 * tachTangTuHinhHoc.ts — Tách bản vẽ nhiều tầng thành từng tầng (§10A.3).
 *
 * Cầu nối con-đường-A → con-đường-B: người dùng nhập một file CAD/GLB chứa cả
 * toà nhà, hệ đề nghị ranh giới tầng theo trục cao, người dùng sửa rồi áp dụng.
 *
 * Thuật toán (§10A.3): chiếu bbox MỌI node lên trục cao, tìm KHOẢNG TRỐNG rộng
 * hơn `NGUONG_KHOANG_TRONG_MM` (0,5 m) làm ranh giới.
 *
 * ★★★ ĐÂY LÀ GỢI Ý, KHÔNG PHẢI KẾT LUẬN. Spec nói thẳng: "người dùng sửa được
 *   ranh giới trước khi áp dụng". Nên module trả về `laGoiY = true` trên mọi cụm
 *   nó tự tìm, và `apDungRanhGioi()` nhận danh sách ranh giới NGƯỜI DÙNG chốt —
 *   hai đường tách bạch. NT-4 áp cả ở đây: cụm do máy tìm mang `nguon='sinh'`.
 *
 * ⚠ Vì sao khoảng trống chứ không phải phân cụm k-means: nhà xưởng có SÀN, và
 *   sàn tạo ra một dải rỗng thật giữa hai tầng. Đó là tín hiệu VẬT LÝ, đọc được
 *   trực tiếp; k-means phải cho trước số cụm k — mà "toà này mấy tầng" chính là
 *   thứ ta đang đi tìm. Chọn k sai thì cụm ra trông vẫn hợp lý và không có gì
 *   báo sai — đúng lớp lỗi câm mà NT-3 cấm.
 *
 * ★ Module THUẦN: không import three.js, không import react.
 * ★ Tất định: không Math.random(), không Date.now(). Cùng đầu vào ⇒ cùng đầu ra,
 *   kể cả thứ tự node đảo (danh sách được sắp trước khi quét).
 */

import { mmSangMet, type BBox } from "./heToaDo";

/**
 * Khoảng trống tối thiểu theo trục cao để coi là RANH GIỚI giữa hai tầng, mm.
 * 0,5 m theo §10A.3. Nhỏ hơn ngưỡng này thì đó là khe giữa hai thiết bị trong
 * cùng một tầng, không phải một mặt sàn.
 */
export const NGUONG_KHOANG_TRONG_MM = 500;

/**
 * Một node hình học của file đã nhập, đã QUY VỀ MILIMÉT và hệ Y-up của scene
 * (tức đã đi qua `hieuChinhNhapModel.apDungHieuChinh`).
 *
 * ⚠ Trục cao ở đây là `bbox.minY/maxY` (hệ SCENE), không phải Z của hệ DB —
 * module này chạy NGAY SAU hiệu chỉnh, khi dữ liệu còn ở hệ scene.
 */
export interface NodeHinhHoc {
  ten: string;
  /** BBox của node, MILIMÉT, hệ Y-up. */
  bbox: BBox;
  /** Số tam giác — để hiện trong hộp thoại ("12.408 tam giác"). */
  soTamGiac: number;
}

/** Một cụm tầng ĐƯỢC ĐỀ NGHỊ. */
export interface CumTang {
  /** Cận dưới của cụm theo trục cao, mm. */
  duoiMm: number;
  /** Cận trên của cụm theo trục cao, mm. */
  trenMm: number;
  /** Tên các node rơi vào cụm này, giữ thứ tự đã sắp theo cao độ. */
  tenNode: string[];
  soTamGiac: number;
  /**
   * ★ true = máy đề nghị (§10A.3), chưa ai xác nhận ⇒ badge "chưa đo".
   * `apDungRanhGioi` với ranh giới người dùng chốt cho ra `laGoiY = false`.
   */
  laGoiY: boolean;
}

/** Kết quả của một lượt tách. */
export interface KetQuaTachTang {
  cum: CumTang[];
  /** Ranh giới (cao độ mm) giữa các cụm — `cum.length - 1` phần tử. */
  ranhGioiMm: number[];
  /** Khoảng cao tổng của toàn bộ hình học, mm. */
  duoiMm: number;
  trenMm: number;
  /**
   * ★ KHÔNG TÁCH ĐƯỢC: 0 node, hoặc mọi node chồng nhau nên chỉ có 1 cụm.
   * KHÁC với "tách ra 1 tầng": UI phải nói "không phát hiện được ranh giới nào",
   * không im lặng dựng một toà nhà một tầng như thể đó là kết luận (NT-3).
   */
  khongTachDuoc: boolean;
}

/**
 * Đề nghị ranh giới tầng từ hình học (§10A.3).
 *
 * Cách làm: sắp các node theo cận dưới, quét một lượt giữ "mức cao nhất đã phủ";
 * mỗi lần node kế tiếp bắt đầu CAO HƠN mức đã phủ quá `nguongMm` là một khoảng
 * trống ⇒ chốt cụm và mở cụm mới. Ranh giới đặt ở GIỮA khoảng trống — đó là chỗ
 * mặt sàn hợp lý nhất khi ta chỉ biết dải rỗng chứ không biết bề dày sàn.
 *
 * Độ phức tạp O(n log n) do bước sắp; n ở đây là số node của một file bản vẽ
 * (hàng trăm tới hàng nghìn), nên chạy trong worker vẫn tức thời.
 */
export function deNghiTachTang(
  nodes: readonly NodeHinhHoc[],
  nguongMm: number = NGUONG_KHOANG_TRONG_MM,
): KetQuaTachTang {
  const hopLe = nodes.filter(
    (n) => Number.isFinite(n.bbox.minY) && Number.isFinite(n.bbox.maxY) && n.bbox.minY <= n.bbox.maxY,
  );

  if (hopLe.length === 0) {
    return { cum: [], ranhGioiMm: [], duoiMm: 0, trenMm: 0, khongTachDuoc: true };
  }

  // Sắp theo cận dưới; đồng hạng thì theo cận trên rồi theo TÊN — bước cuối làm
  // kết quả tất định kể cả khi hai node có bbox trùng khít nhau.
  const daSap = [...hopLe].sort(
    (a, b) =>
      a.bbox.minY - b.bbox.minY ||
      a.bbox.maxY - b.bbox.maxY ||
      (a.ten < b.ten ? -1 : a.ten > b.ten ? 1 : 0),
  );

  const cum: CumTang[] = [];
  const ranhGioiMm: number[] = [];

  let dauCum = daSap[0].bbox.minY;
  let daPhu = daSap[0].bbox.maxY;
  let tenNode: string[] = [daSap[0].ten];
  let soTamGiac = daSap[0].soTamGiac;

  for (let i = 1; i < daSap.length; i += 1) {
    const n = daSap[i];
    const khoangTrong = n.bbox.minY - daPhu;
    if (khoangTrong > nguongMm) {
      cum.push({ duoiMm: dauCum, trenMm: daPhu, tenNode, soTamGiac, laGoiY: true });
      // Ranh giới ở GIỮA khoảng trống: ta biết dải rỗng, không biết bề dày sàn.
      ranhGioiMm.push(daPhu + khoangTrong / 2);
      dauCum = n.bbox.minY;
      daPhu = n.bbox.maxY;
      tenNode = [n.ten];
      soTamGiac = n.soTamGiac;
    } else {
      daPhu = Math.max(daPhu, n.bbox.maxY);
      tenNode.push(n.ten);
      soTamGiac += n.soTamGiac;
    }
  }
  cum.push({ duoiMm: dauCum, trenMm: daPhu, tenNode, soTamGiac, laGoiY: true });

  return {
    cum,
    ranhGioiMm,
    duoiMm: cum[0].duoiMm,
    trenMm: cum[cum.length - 1].trenMm,
    // Một cụm duy nhất = không tìm được ranh giới nào. Đó KHÔNG phải "toà nhà
    // một tầng đã xác nhận"; hộp thoại phải nói vậy thay vì im lặng cho qua.
    khongTachDuoc: cum.length <= 1,
  };
}

/**
 * Áp danh sách ranh giới NGƯỜI DÙNG đã chốt (sau khi sửa gợi ý — §10A.3).
 *
 * ★ `laGoiY = false` trên mọi cụm trả về: đây là ranh giới người xác nhận, không
 *   phải máy đoán ⇒ tầng sinh ra mang `nguon='tay'` chứ không 'sinh'.
 *
 * Node bị ranh giới CẮT NGANG (cột suốt hai tầng, cầu thang, vách thông tầng)
 * được xếp vào cụm chứa TÂM của nó — chọn tâm thay vì cận dưới vì một mái đua
 * xuống thấp vẫn thuộc về tầng trên, còn cận dưới sẽ kéo nó xuống nhầm tầng.
 * Đây là quy ước tự quyết (spec không nói), khai rõ ở đây để đo lại được.
 */
export function apDungRanhGioi(
  nodes: readonly NodeHinhHoc[],
  ranhGioiMm: readonly number[],
): CumTang[] {
  const hopLe = nodes.filter(
    (n) => Number.isFinite(n.bbox.minY) && Number.isFinite(n.bbox.maxY) && n.bbox.minY <= n.bbox.maxY,
  );
  const moc = [...ranhGioiMm].sort((a, b) => a - b);

  const soCum = moc.length + 1;
  const gio: NodeHinhHoc[][] = Array.from({ length: soCum }, () => []);

  for (const n of hopLe) {
    const tam = (n.bbox.minY + n.bbox.maxY) / 2;
    let chiSo = 0;
    while (chiSo < moc.length && tam >= moc[chiSo]) chiSo += 1;
    gio[chiSo].push(n);
  }

  return gio.map((ds, i) => {
    const daSap = [...ds].sort(
      (a, b) =>
        a.bbox.minY - b.bbox.minY || (a.ten < b.ten ? -1 : a.ten > b.ten ? 1 : 0),
    );
    // Cụm RỖNG (ranh giới người dùng đặt vào chỗ không có gì) vẫn được trả về:
    // xoá nó âm thầm làm số cụm khác số ranh giới người dùng vừa chốt, và họ sẽ
    // không hiểu tầng của mình đi đâu. Cận lấy từ chính hai ranh giới bao quanh.
    const duoiMm = daSap.length > 0 ? Math.min(...daSap.map((n) => n.bbox.minY)) : (moc[i - 1] ?? 0);
    const trenMm = daSap.length > 0 ? Math.max(...daSap.map((n) => n.bbox.maxY)) : (moc[i] ?? duoiMm);
    return {
      duoiMm,
      trenMm,
      tenNode: daSap.map((n) => n.ten),
      soTamGiac: daSap.reduce((s, n) => s + n.soTamGiac, 0),
      laGoiY: false,
    };
  });
}

/**
 * Cụm tầng → dòng nhập của form con-đường-B (§10A.2), để hai con đường ghi vào
 * CÙNG một chỗ.
 *
 * `caoThongThuyM` lấy đúng chiều cao đo được của cụm — đây là số ĐO TỪ HÌNH HỌC,
 * nên `nguonHinhHoc` của tầng sinh ra là `'ban_ve'`, KHÁC với `'sinh'` (hệ đoán)
 * và `'nhap_tay'` (người gõ). Ba nguồn ba nghĩa, không được trộn.
 */
export function cumTangSangDongNhap(
  cum: readonly CumTang[],
  tenMacDinh: (capSo: number) => string,
): {
  capSo: number;
  ten: string;
  caoDoM: number;
  caoThongThuyM: number;
  nguonHinhHoc: "ban_ve";
  soTamGiac: number;
}[] {
  return cum.map((c, i) => ({
    capSo: i + 1,
    ten: tenMacDinh(i + 1),
    caoDoM: mmSangMet(c.duoiMm),
    caoThongThuyM: mmSangMet(c.trenMm - c.duoiMm),
    nguonHinhHoc: "ban_ve" as const,
    soTamGiac: c.soTamGiac,
  }));
}

/**
 * Gộp cụm thứ `chiSo` xuống cụm ngay dưới — hành vi của ô "bỏ tích" trong hộp
 * thoại §10A.3 ("bỏ tích = gộp vào tầng dưới"; mái thường bị gộp như vậy).
 *
 * Cụm đầu tiên không gộp xuống đâu được ⇒ trả về danh sách NGUYÊN VẸN thay vì
 * ném: hộp thoại phải disable ô tích đó, và nếu nó lọt thì mất một cụm còn tệ
 * hơn một cú bấm không có tác dụng.
 */
export function gopCumXuongDuoi(cum: readonly CumTang[], chiSo: number): CumTang[] {
  if (chiSo <= 0 || chiSo >= cum.length) return [...cum];
  const ket = [...cum];
  const tren = ket[chiSo];
  const duoi = ket[chiSo - 1];
  ket[chiSo - 1] = {
    duoiMm: Math.min(duoi.duoiMm, tren.duoiMm),
    trenMm: Math.max(duoi.trenMm, tren.trenMm),
    tenNode: [...duoi.tenNode, ...tren.tenNode],
    soTamGiac: duoi.soTamGiac + tren.soTamGiac,
    // Gộp là một quyết định NGƯỜI DÙNG ⇒ cụm kết quả không còn là gợi ý máy.
    laGoiY: false,
  };
  ket.splice(chiSo, 1);
  return ket;
}
