/**
 * locBadge.ts — KHỬ CHỒNG LẤN màn hình cho badge cảnh báo (§10.3 luật 3).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY TỒN TẠI — SỐ ĐO, KHÔNG PHẢI LINH CẢM
 * ════════════════════════════════════════════════════════════════════════════
 * QA Đợt 5 đo bbox DOM thật trên `/twin`: **11 cặp chồng trên 9 badge**, trong đó
 * 4 badge của cùng một máy (`SIM-L1-AOI`) đè lên nhau tới mức không đọc nổi chữ
 * nào. Cùng lúc đó `data-so-an` khai **0** — tức lớp badge đang khai "không giấu
 * cái gì cả" trong khi bốn cảnh báo bị che.
 *
 * Nguyên nhân: `LopCanhBao` chỉ `sort` (theo mức độ) rồi `slice(0, 12)`. Đó là
 * phép chọn theo ƯU TIÊN, KHÔNG phải phép khử chồng lấn theo KHÔNG GIAN. Hai máy
 * cạnh nhau trên mặt bằng chiếu ra hai điểm cách nhau vài pixel, và không có gì
 * trong đường đó biết điều ấy.
 *
 * ⇒ Nghịch lý cay đắng: lớp NHÃN máy (`locNhan.ts`) — lớp thông tin ÍT quan
 *   trọng nhất — **có** khử chồng lấn bbox từ đợt trước, còn lớp CẢNH BÁO — lớp
 *   an toàn, lớp mà §10.3 luật 3 viết riêng cho — là lớp DUY NHẤT không có. Lớp
 *   được bảo vệ kỹ nhất trên giấy lại là lớp trần trụi nhất trong mã.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI BÀI HỌC ĐƯỢC MANG THẲNG TỪ `locNhan.ts` SANG
 * ════════════════════════════════════════════════════════════════════════════
 * **G7 — HÌNH CHỮ NHẬT, KHÔNG PHẢI BÁN KÍNH TRÒN.** Bản đầu của `locNhan` so
 * khoảng cách tâm với một bán kính cố định, tức mô hình hoá nhãn thành đường
 * tròn. Nhãn thật rộng gấp ~9 lần chiều cao, nên hai nhãn "ngoài bán kính" vẫn
 * chồng ngang 66px. Không có bán kính nào đúng cho cả hai chiều: nới đủ rộng thì
 * giết oan các phần tử xếp chồng DỌC. Phải đổi HÌNH, không đổi SỐ. Badge cũng là
 * hộp chữ nhật dẹt (`padding 3px 6px`, `fontSize 11`, `whiteSpace: nowrap`), nên
 * nó thừa hưởng nguyên vẹn bài học ấy.
 *
 * **BỘ ĐẾM PHẢI ĐẾM ĐẦU RA, KHÔNG ĐẾM ĐẦU VÀO.** "Số badge BỊ LOẠI" và "số cặp
 * CÒN chồng trên màn" là hai đại lượng khác nhau, và chính chỗ lẫn hai đại lượng
 * này là gốc của lời khai `chongLap = 0` sai trước đây. Ở đây
 * {@link demCapChongLapBadge} quét toàn bộ cặp trong ĐẦU RA — nó là dụng cụ đo
 * độc lập với thuật toán, nên nó có thể BÁC BỎ thuật toán.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ MỘT KHÁC BIỆT VỚI `locNhan` KHÔNG ĐƯỢC CHÉP NHẦM: ĐIỂM NEO
 * ════════════════════════════════════════════════════════════════════════════
 * Nhãn máy dùng `translate(-50%, -100%)` ⇒ (x, y) là điểm giữa CẠNH DƯỚI.
 * Badge cảnh báo dùng `translate(-50%, -50%)` ⇒ (x, y) là TÂM hộp.
 * Dùng nhầm công thức của bên kia làm mọi hộp lệch nửa chiều cao — và lệch đúng
 * theo hướng khiến bộ đếm báo THIẾU chồng lấp, tức là hỏng một cách CÂM. Vì thế
 * module này có `hopBadge` riêng thay vì import `hopNhan`.
 *
 * ★ Thuần .ts: không three, không react ⇒ test được ở `environment: "node"`.
 */

import { haiHopChongNhau, type HinhChuNhat } from "../loi/locNhan";

/**
 * Kích thước SUY ĐOÁN của một badge chưa đo được, pixel.
 *
 * Suy từ CSS thật của `LopCanhBao.tsx`: `fontSize 11`, `lineHeight 1`,
 * `padding: "3px 6px"`, `gap: 4`, nội dung = ký tự hình dạng + nhãn ngắn.
 * ⇒ cao ≈ 11 + 3×2 = 17; rộng ≈ 6×2 + 11 (ký tự hình) + 4 (gap) + ~9 ký tự nhãn
 *   × ~6px ≈ 81. Lấy tròn 84×18.
 *
 * ⚠ Lấy trị GIỮA dải chứ không lấy cận trên — cùng lý do như `RONG_SUY_DOAN_PX`
 *   của `locNhan`: suy đoán quá rộng giết oan badge ở khung ĐẦU TIÊN, và badge
 *   đó rồi không bao giờ được render để đo thật ⇒ tự khoá mình. Ở khung sau
 *   người gọi đã có `rongPx`/`caoPx` THẬT và trị suy đoán hết vai trò.
 */
export const RONG_BADGE_SUY_DOAN_PX = 84;
export const CAO_BADGE_SUY_DOAN_PX = 18;

/** Một badge ứng viên, đã được người gọi chiếu sang toạ độ MÀN HÌNH (pixel). */
export interface BadgeUngVien {
  /** Khoá ổn định — `andon_events.id`. */
  id: number;
  /** Toạ độ màn hình của TÂM badge, pixel. */
  x: number;
  y: number;
  /**
   * Điểm ưu tiên đã tính sẵn bởi người gọi (mức độ + đã-ack). CAO hơn = giữ
   * trước. Truyền vào thay vì tính ở đây để module này không phải biết về
   * `MucCanhBao` — thứ tự ưu tiên là chính sách của `LopCanhBao`.
   */
  diemUuTien: number;
  /**
   * Badge đã bị KẸP VỀ RÌA vì alarm nằm ngoài khung (luật 3).
   *
   * ★★★ Badge ngoài khung KHÔNG BAO GIỜ bị loại vì chồng lấn. Chúng bị kẹp về
   * cùng một dải rìa hẹp nên chúng chồng nhau là chuyện đương nhiên; loại chúng
   * đi là làm ĐÚNG cái mà luật 3 cấm — để một alarm biến mất khỏi màn hình vì
   * góc camera.
   */
  ngoaiKhung?: boolean;
  /** Bề rộng thật, px — `getBoundingClientRect` của badge đã render. */
  rongPx?: number;
  /** Bề cao thật, px. */
  caoPx?: number;
}

/**
 * Hộp bao MÀN HÌNH của một badge — phải khớp CSS thật của `LopCanhBao.tsx`.
 *
 * ★ `transform: translate(-50%, -50%)` ⇒ (x, y) là TÂM, nên hộp trải ĐỀU hai
 *   phía trên cả hai trục. Khác `hopNhan` của `locNhan` (neo cạnh dưới).
 */
export function hopBadge(
  b: Pick<BadgeUngVien, "x" | "y" | "rongPx" | "caoPx">,
  rongMacDinh = RONG_BADGE_SUY_DOAN_PX,
  caoMacDinh = CAO_BADGE_SUY_DOAN_PX,
): HinhChuNhat {
  const rong = Number.isFinite(b.rongPx) && (b.rongPx as number) > 0 ? (b.rongPx as number) : rongMacDinh;
  const cao = Number.isFinite(b.caoPx) && (b.caoPx as number) > 0 ? (b.caoPx as number) : caoMacDinh;
  return {
    trai: b.x - rong / 2,
    phai: b.x + rong / 2,
    tren: b.y - cao / 2,
    duoi: b.y + cao / 2,
  };
}

export interface KetQuaLocBadge {
  /** Badge được vẽ, đã sắp ưu tiên GIẢM DẦN. Tối đa `tran`. */
  ve: BadgeUngVien[];
  /**
   * Số badge KHÔNG được vẽ — vì chồng lấn HOẶC vì chạm trần.
   *
   * ⚠ Đây là con số phải đi vào `data-so-an`. Trước bản vá, `data-so-an` chỉ đếm
   *   phần vượt trần và khai `0` trong khi 4 badge bị che — nó đo một đại lượng
   *   KHÁC với đại lượng người đọc tưởng nó đo.
   */
  soAn: number;
  /** Tách riêng để gỡ lỗi: bao nhiêu bị loại vì bbox chồng. */
  soBiChongLap: number;
  /** Tách riêng để gỡ lỗi: bao nhiêu bị loại vì chạm trần. */
  soVuotTran: number;
}

export interface CauHinhLocBadge {
  tran?: number;
  rongSuyDoanPx?: number;
  caoSuyDoanPx?: number;
}

/**
 * Lọc badge: sắp ưu tiên → khử chồng lấn BBOX (chỉ badge TRONG khung) → cắt trần.
 *
 * Hàm THUẦN và TẤT ĐỊNH: cùng đầu vào ở bất kỳ thứ tự nào cho cùng đầu ra.
 *
 * ★ HẬU ĐIỀU KIỆN: mọi cặp badge TRONG KHUNG trong `ve` KHÔNG chồng bbox — ghim
 *   bằng {@link demCapChongLapBadge} trong `locBadge.unit.test.ts`.
 *
 * ⚠ Vì sao khử chồng lấn chạy TRƯỚC phép cắt trần (giống `locNhan`): cắt 12
 *   trước rồi mới khử chồng có thể để lại 5 badge hiển thị trong khi 7 suất đã
 *   bị các badge chồng nhau ăn mất.
 */
export function locBadge(
  ungVien: readonly BadgeUngVien[],
  cauHinh: CauHinhLocBadge = {},
): KetQuaLocBadge {
  const tran = cauHinh.tran ?? Infinity;
  const rongMacDinh = cauHinh.rongSuyDoanPx ?? RONG_BADGE_SUY_DOAN_PX;
  const caoMacDinh = cauHinh.caoSuyDoanPx ?? CAO_BADGE_SUY_DOAN_PX;

  // Sắp trên BẢN SAO — không làm biến dạng mảng của người gọi. Hoà điểm thì so
  // `id` tăng dần: thiếu nhánh này, hai alarm cùng mức cùng lúc sẽ đổi chỗ ngẫu
  // nhiên mỗi khung, tức badge nhấp nháy.
  const daSap = [...ungVien].sort((a, b) =>
    a.diemUuTien !== b.diemUuTien ? b.diemUuTien - a.diemUuTien : a.id - b.id,
  );

  const ve: BadgeUngVien[] = [];
  const hopDaGiu: HinhChuNhat[] = [];
  let soBiChongLap = 0;
  let soVuotTran = 0;

  for (const b of daSap) {
    if (ve.length >= tran) {
      soVuotTran += 1;
      continue;
    }

    // ★ Badge ngoài khung được MIỄN phép khử chồng lấn (xem `ngoaiKhung`), và
    //   cũng KHÔNG góp hộp vào `hopDaGiu` — nếu góp, một chùm badge bị kẹp ở rìa
    //   sẽ dựng một bức tường vô hình giết các badge TRONG khung đi ngang qua đó.
    if (b.ngoaiKhung) {
      ve.push(b);
      continue;
    }

    const hop = hopBadge(b, rongMacDinh, caoMacDinh);
    let chongLap = false;
    for (const g of hopDaGiu) {
      if (haiHopChongNhau(g, hop)) {
        chongLap = true;
        break;
      }
    }
    if (chongLap) {
      soBiChongLap += 1;
      continue;
    }
    ve.push(b);
    hopDaGiu.push(hop);
  }

  return { ve, soAn: soBiChongLap + soVuotTran, soBiChongLap, soVuotTran };
}

/**
 * Đếm số CẶP badge chồng bbox trong một danh sách — dụng cụ ĐO ĐỘC LẬP.
 *
 * ★★★ Tách khỏi `locBadge` có chủ đích và đây là điểm mấu chốt của cả bản vá:
 * `soBiChongLap` đếm ĐẦU VÀO bị loại, hàm này đếm ĐẦU RA còn chồng. Chỉ hàm này
 * mới trả lời được câu hỏi mà §10.3 luật 3 thật sự hỏi — *"trên màn hình lúc này
 * có badge nào che badge nào không?"* — và chỉ nó mới có thể BÁC BỎ `locBadge`.
 * Một bộ đếm sinh ra từ chính thuật toán nó đo thì không bao giờ bác bỏ được
 * thuật toán ấy; đó đúng là cách `chongLap = 0` từng nói dối.
 *
 * ⚠ Badge `ngoaiKhung` được BỎ QUA: chúng bị kẹp vào một dải rìa hẹp nên chồng
 *   nhau là hành vi ĐÚNG theo luật 3 (thà chồng còn hơn biến mất). Tính cả chúng
 *   thì phép đo sẽ báo "hỏng" trên đúng cái hành vi mà spec yêu cầu.
 */
export function demCapChongLapBadge(
  badge: readonly (Pick<BadgeUngVien, "x" | "y" | "rongPx" | "caoPx"> & { ngoaiKhung?: boolean })[],
  rongMacDinh = RONG_BADGE_SUY_DOAN_PX,
  caoMacDinh = CAO_BADGE_SUY_DOAN_PX,
): number {
  const trongKhung = badge.filter((b) => !b.ngoaiKhung);
  const hop = trongKhung.map((b) => hopBadge(b, rongMacDinh, caoMacDinh));
  let so = 0;
  for (let i = 0; i < hop.length; i++) {
    for (let j = i + 1; j < hop.length; j++) {
      if (haiHopChongNhau(hop[i], hop[j])) so += 1;
    }
  }
  return so;
}
