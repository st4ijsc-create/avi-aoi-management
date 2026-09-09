/**
 * kpiNoiLogic.ts — §11 #16 "BẢNG KPI NỔI": số liệu thống kê ĐỌC ĐƯỢC NGAY TRÊN
 * cảnh 3D (yêu cầu #6 của chủ sở hữu).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LÀ LỚP PHỦ 2D, KHÔNG PHẢI CHỮ TRONG CẢNH — SỐ ĐO, KHÔNG PHẢI GU
 * ════════════════════════════════════════════════════════════════════════════
 * §4 đặt trần ĐO ĐƯỢC: draw calls ≤ 150, FPS xoay ≥ 30, và nhãn cap ở **30**
 * vì 300 nhãn CSS2D đã đo được là laggy. `troika-three-text` tốn **1 draw call
 * mỗi nhãn**. Đo trên trình duyệt thật 2026-09-07 (`__thongKeVe.calls`, tài
 * khoản `e2e_tai_loE`, `/twin` 1280×720): cảnh hiện tại = **3 draw calls**.
 *
 * Một bảng KPI 8 dòng dựng bằng text-in-scene = +8 draw calls (267 % so với
 * toàn cảnh) và chữ sẽ xoay/che/nhỏ dần theo camera — tức là ĐÚNG THỨ KHÔNG
 * ĐỌC ĐƯỢC khi người vận hành cần đọc nhất. Lớp phủ DOM tốn **0 draw call**,
 * luôn hướng thẳng người đọc, và trình đọc màn hình thấy được (§9.9).
 *
 * ⇒ Module này KHÔNG sinh hình học. Nó chỉ TÍNH các con số; `BangKpiNoi.tsx`
 *   vẽ chúng bằng DOM định vị tuyệt đối trên canvas.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HONEST-NULL LÀ RÀNG BUỘC, KHÔNG PHẢI TUỲ CHỌN (NT-3.5 / G15)
 * ════════════════════════════════════════════════════════════════════════════
 * Mọi ô ở đây trả `number | null`. `null` = **chưa đo được**, và tầng vẽ in `—`
 * qua `hienSo` (`trungThucDuLieu.ts:268`). Một ô KPI in `0` nói *"đã đo, không
 * có cái nào"*; in `—` nói *"chưa đo được"*. Với OEE thì khác biệt đó là khoảng
 * cách giữa "chuyền dừng" và "không ai gắn cảm biến" — hai hành động khác nhau.
 *
 * ⚠ ĐO ĐƯỢC trên DB này (2026-09-07, `factoryCommand.overview`, SIM-FAC):
 *   `oeePercent` là `null` cho **mọi** máy — `oeeService` không đủ đầu vào
 *   availability/performance/quality. Nên `oeeTrungBinh` PHẢI ra `null`, không
 *   phải `0`. Một bảng KPI in "OEE 0 %" trên nhà máy này là lời khai SAI.
 *
 * ★ Module THUẦN (RB-8.1): không three, không react, không `Date.now()` ẩn.
 *   `vitest` chạy `environment: "node"` và chỉ thu `.unit.test.ts`.
 */

/**
 * Một máy như `factoryCommand.overview` trả về — CHỈ những trường bảng KPI đọc.
 *
 * ⚠ Cố ý KHÔNG import `CommandMachineNode` của server: đó là type phía server và
 *   kéo nó vào client buộc bundle client phụ thuộc cây server. Khai lại ĐÚNG
 *   tập con dùng tới — tập con đó là hợp đồng đã đọc tại nguồn
 *   (`server/services/factoryCommandService.ts:54-73`).
 */
export interface MayTongQuanKpi {
  id: number;
  /** `"running" | "idle" | "down" | "offline" | "maintenance"`. */
  status: string;
  /** OEE % (0-100). `null` = honest-null từ server, KHÔNG được coi là 0. */
  oeePercent: number | null;
  andonActive: boolean;
  pdmRiskHigh: boolean;
}

/** Một chỉ số đã tính, kèm ĐỦ thông tin để tầng vẽ không phải đoán gì. */
export interface OKpi {
  /** Khoá i18n ổn định — tầng vẽ tra `t()`. */
  khoa: string;
  /** `null` = CHƯA ĐO ĐƯỢC ⇒ in `—`. */
  giaTri: number | null;
  /** Hậu tố đơn vị, ví dụ `"%"`. `null` = không đơn vị. */
  donVi: string | null;
  /**
   * Sắc thái để tầng vẽ chọn màu. KHÔNG phải mã màu — G29: `THREE.Color` không
   * đọc `oklch()`, nó WARN rồi trả TRẮNG mà không ném lỗi. Module thuần này vì
   * vậy không được sinh chuỗi màu nào; tầng vẽ ánh xạ sắc thái → lớp Tailwind.
   */
  sacThai: SacThaiKpi;
}

export type SacThaiKpi = "trung_tinh" | "tot" | "canh_bao" | "xau";

/** Kết quả đầy đủ của một lượt tính. */
export interface KetQuaKpiNoi {
  o: OKpi[];
  /**
   * ★ TỔNG SỐ MÁY ĐƯỢC ĐO — mẫu số của mọi tỉ lệ ở trên. Hiện RA MÀN vì một
   *   tỉ lệ không kèm mẫu số là một nửa sự thật: "80 % chạy" trên 5 máy và trên
   *   500 máy là hai câu khác nhau.
   */
  mauSo: number;
  /**
   * Số máy CÓ số OEE thật. `oeeTrungBinh` là trung bình của RIÊNG nhóm này —
   * và mẫu số đó phải hiện ra, nếu không "OEE 72 %" trên 1/42 máy trông y hệt
   * "OEE 72 %" trên 42/42.
   */
  mauSoOee: number;
}

/** Thứ tự và danh sách ô — khai MỘT lần, dùng cho cả nhánh rỗng lẫn nhánh đủ. */
const KHOA_O = [
  "dangChay",
  "dungLoi",
  "baoTri",
  "matKetNoi",
  "tyLeChay",
  "oeeTrungBinh",
  "andonMo",
  "ruiRoPdm",
] as const;

/** Ô nào mang đơn vị `%` — khai một lần để hai nhánh không thể lệch nhau (G12). */
const DON_VI: Readonly<Record<string, string | null>> = {
  tyLeChay: "%",
  oeeTrungBinh: "%",
};

/**
 * ★★★ HÀM TRUNG TÂM. Đầu vào RỖNG ⇒ mọi ô `null`, KHÔNG phải 0.
 *
 * Đây là điểm G5/G32 của module: một bản cài đặt `f(x) = 0` sẽ cho mọi cổng
 * xanh trên một nhà máy im lặng, vì "0 máy chạy" trông y hệt "chưa đo". Test
 * `kpiNoiLogic.unit.test.ts` vì vậy đo CẢ HAI chiều: tập rỗng phải ra `null`,
 * và tập KHÁC RỖNG phải ra số KHÁC với tập rỗng.
 *
 * @param may    Máy từ `factoryCommand.overview` — ĐÃ lọc theo phạm vi đang xem.
 * @param chuaDo `true` khi truy vấn đang tải / bị 403 / chưa từng chạy. Mọi ô
 *               ra `null` bất kể `may` chứa gì (CHẶN-2, Đợt 5).
 */
export function tinhKpiNoi(may: readonly MayTongQuanKpi[], chuaDo = false): KetQuaKpiNoi {
  // ★ `chuaDo` THẮNG dữ liệu: một mảng rỗng vì 403 không được in ra `0`.
  if (chuaDo || may.length === 0) {
    return {
      o: KHOA_O.map((khoa) => ({
        khoa,
        giaTri: null,
        donVi: DON_VI[khoa] ?? null,
        sacThai: "trung_tinh" as const,
      })),
      mauSo: 0,
      mauSoOee: 0,
    };
  }

  let chay = 0;
  let dung = 0;
  let baoTri = 0;
  let matKetNoi = 0;
  let andon = 0;
  let pdm = 0;
  let tongOee = 0;
  let mauSoOee = 0;

  for (const m of may) {
    if (m.status === "running") chay += 1;
    else if (m.status === "down") dung += 1;
    else if (m.status === "maintenance") baoTri += 1;
    else if (m.status === "offline") matKetNoi += 1;
    // ★ `idle` KHÔNG rơi vào ô nào ở trên, và đó là có chủ ý: nó là một trạng
    //   thái THẬT của hợp đồng, nhét nó vào "dừng lỗi" sẽ thổi phồng số sự cố.
    //   Nó vẫn nằm trong `mauSo`, nên các ô cộng lại có thể NHỎ HƠN `mauSo` —
    //   một bảng KPI ép tổng bằng mẫu số sẽ phải bịa ra chỗ để nhét `idle`.

    // ★ Đợt 34 (Pareto #1 QA Đợt 32): ô này đếm **MÁY** có andon (`andonActive` là cờ theo máy), còn
    //   `DaiCanhBao` "Alarms (N)" và badge vỏ đếm **SỰ KIỆN** `andon.active`. Đo 2026-09-10 trên `/twin`:
    //   6 máy · 7 sự kiện (máy 2 có 2 andon) ⇒ hai số đúng, hai đơn vị. Hợp đồng fleet không mang số
    //   sự kiện/máy, nên KHÔNG đổi phép đếm; nhãn i18n `twin3d.kpiNoi.o.andonMo` đổi thành "Machines w/
    //   andon" / "Máy có andon" để đơn vị nói ra trên màn, cạnh "Alarms (7)".
    if (m.andonActive) andon += 1;
    if (m.pdmRiskHigh) pdm += 1;

    // ★ honest-null: chỉ máy CÓ số mới vào trung bình. `?? 0` ở đây sẽ kéo
    //   trung bình xuống theo số máy KHÔNG ĐO ĐƯỢC — đúng lớp lỗi G7 (đo nhầm
    //   đại lượng: "OEE trung bình" biến thành "OEE × tỉ lệ máy có cảm biến").
    if (typeof m.oeePercent === "number" && Number.isFinite(m.oeePercent)) {
      tongOee += m.oeePercent;
      mauSoOee += 1;
    }
  }

  const mauSo = may.length;
  const tyLeChay = lamTron1(( chay / mauSo) * 100);
  // ★ KHÔNG máy nào có OEE ⇒ `null`, không phải 0 (ca THẬT của DB này).
  const oeeTrungBinh = mauSoOee === 0 ? null : lamTron1(tongOee / mauSoOee);

  const giaTri: Record<string, number | null> = {
    dangChay: chay,
    dungLoi: dung,
    baoTri,
    matKetNoi,
    tyLeChay,
    oeeTrungBinh,
    andonMo: andon,
    ruiRoPdm: pdm,
  };

  return {
    o: KHOA_O.map((khoa) => ({
      khoa,
      giaTri: giaTri[khoa] ?? null,
      donVi: DON_VI[khoa] ?? null,
      sacThai: sacThaiCua(khoa, giaTri[khoa]),
    })),
    mauSo,
    mauSoOee,
  };
}

/** Một chữ số thập phân. Tách hàm để hai chỗ dùng không lệch cách làm tròn. */
function lamTron1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Sắc thái của một ô. `null` luôn `trung_tinh` — "chưa đo được" không phải tin
 * tốt và cũng không phải tin xấu, tô nó thành đỏ hay xanh đều là bịa.
 *
 * ⚠ Các ngưỡng ở đây là QUY ƯỚC TRÌNH BÀY, KHÔNG phải ngưỡng nghiệp vụ đã được
 *   duyệt. Chúng không sinh cảnh báo và không chặn thao tác nào — `DaiCanhBao`/
 *   `andon.active` mới là nguồn sự thật của "có sự cố hay không". Ở đây chúng
 *   chỉ chọn màu chữ, nên một ngưỡng lệch không đẻ ra lời khai sai về nhà máy.
 */
function sacThaiCua(khoa: string, v: number | null): SacThaiKpi {
  if (v === null) return "trung_tinh";
  switch (khoa) {
    case "dangChay":
      return v > 0 ? "tot" : "trung_tinh";
    case "dungLoi":
    case "andonMo":
      return v > 0 ? "xau" : "trung_tinh";
    case "baoTri":
    case "matKetNoi":
    case "ruiRoPdm":
      return v > 0 ? "canh_bao" : "trung_tinh";
    case "tyLeChay":
    case "oeeTrungBinh":
      if (v >= 70) return "tot";
      if (v >= 40) return "canh_bao";
      return "xau";
    default:
      return "trung_tinh";
  }
}
