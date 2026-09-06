/**
 * ════════════════════════════════════════════════════════════════════════════
 * NGUỒN SỰ THẬT DUY NHẤT cho MÀU TRẠNG THÁI trong cảnh 3D Twin.
 * (spec 2026-09-06-nha-may-3d-digital-twin-design §10.1, §10.2, NT-3)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Trước tệp này có **ba** hệ màu lệch nhau, đo được:
 *   1. `server/services/digitalTwinService.ts:6`  — TWIN_STATUS_COLORS, hex cứng
 *   2. `client/src/index.css`                    — token oklch (theo theme)
 *   3. `client/src/lib/canonicalStatusColor.ts`  — ánh xạ canonical → tông
 * Ba nguồn nghĩa là màu "đang chạy" ở màn A và màn B có thể khác nhau mà không ai
 * phát hiện. Từ đây, **cảnh 3D chỉ đọc tệp này**. `digitalTwinService.colorForStatus`
 * giữ lại cho tương thích ngược nhưng Twin KHÔNG đọc nữa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★ ISA-101: XÁM LÀ MẶC ĐỊNH, MÀU CHỈ DÀNH CHO BẤT THƯỜNG (§10.1)
 * ────────────────────────────────────────────────────────────────────────────
 * Đây là điểm đa số twin 3D làm sai: tô xanh lá rực cho "đang chạy". Hệ quả là khi
 * 42/43 máy chạy tốt, màn hình rực rỡ toàn màu — và cái máy DUY NHẤT bị lỗi không
 * nổi bật hơn gì cả. Màu bão hoà là tài nguyên khan hiếm, tiêu vào tình trạng bình
 * thường thì hết phần cho bất thường.
 * Nên: `running` → xám ngả xanh rất nhạt (`--packml-run`, low-chroma), KHÔNG success
 * xanh lá; chỉ `error` được đỏ bão hoà (`--destructive`), và nó là màu bão hoà DUY NHẤT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ NT-3: KHÔNG CÓ DỮ LIỆU ≠ BÌNH THƯỜNG — vì sao `khong_ro` là hạng nhất
 * ────────────────────────────────────────────────────────────────────────────
 * Chế độ hỏng chết người nhất của HMI: tag vẫn `Quality=Good` trong khi timestamp
 * ngừng tiến; màn hình vẫn vẽ giá trị cuối, badge vẫn xanh, không alarm nào nổ.
 * Người vận hành nhìn một cái máy đã mất tín hiệu 40 phút và thấy nó "khoẻ".
 *
 * `khong_ro` KHÔNG BAO GIỜ được suy biến về `running` hay `error` — nó có ô riêng,
 * màu riêng (`--muted`), và `hoaTiet='gach_cheo'`. Hoạ tiết là mã hoá DƯ THỪA: người
 * mù màu, màn hình chói nắng, hay ảnh chụp đen trắng vẫn phân biệt được. Test cưỡng
 * chế `khong_ro` khác mọi trạng thái "khoẻ".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠ VÌ SAO TRẢ VỀ TÊN TOKEN CHỨ KHÔNG PHẢI HEX — và cách WebGL dùng
 * ────────────────────────────────────────────────────────────────────────────
 * WebGL/three.js không parse được `oklch()`. Cám dỗ là hardcode hex ở đây — nhưng
 * hex cứng KHÔNG đổi theo theme sáng/tối, và §10.4 bắt 3D phải đúng ở CẢ HAI theme.
 *
 * Nên tệp này trả về **tên token** (`--destructive`), và `giaiMauCanh()` phân giải
 * token → rgb lúc chạy bằng `getComputedStyle` (chính trình duyệt tính oklch → rgb,
 * không cần thư viện màu). Đổi theme ⇒ gọi lại ⇒ cảnh đổi màu. Tách đôi như vậy còn
 * làm phần ÁNH XẠ (bảng dưới) test được trong môi trường **node** không DOM — vitest
 * của repo chạy `environment: "node"` (RB-8).
 *
 * ⚠ Bảng màu ≤ 7 mã (ASM Guideline 6.1 — giới hạn trí nhớ ngắn hạn). Đếm token khác
 * nhau dùng dưới đây: packml-run, info, warning, alarm-medium, muted-foreground,
 * destructive, muted = **7**. Test cưỡng chế trần này; thêm mã thứ 8 sẽ ĐỎ.
 */

/** Tám giá trị `operationStatusEnum` (drizzle/schema/enums.ts) + hai trạng thái Twin. */
export type TrangThaiCanh =
  // ─ operationStatusEnum, nguyên văn ─
  | "running"
  | "stopped"
  | "error"
  | "maintenance"
  | "warming_up"
  | "changeover"
  | "starved"
  | "blocked"
  // ─ hai trạng thái CHỈ TỒN TẠI trong cảnh 3D, không có trong DB ─
  /** Mất tín hiệu / dữ liệu quá 5 phút. NT-3: hạng nhất, không suy biến. */
  | "khong_ro"
  /** Thiết bị đã ngừng khai thác — còn trong bố cục nhưng không còn vận hành. */
  | "ngung_khai_thac";

/** Hoạ tiết bề mặt — mã hoá DƯ THỪA cạnh màu (§10.3 luật 2). */
export type HoaTiet = "khong" | "gach_cheo" | "soc_cheo";

export interface MauTrangThai {
  /** Tên biến CSS trong index.css, KÈM `--`. Phân giải bằng `giaiMauCanh()`. */
  token: string;
  /** 0–1. <1 nghĩa vật thể mờ đi, KHÔNG phải màu nhạt hơn. */
  doMo: number;
  hoaTiet: HoaTiet;
  /** true = màu bão hoà, được phép "kêu to". Chỉ `error`. */
  laBatThuong: boolean;
  /** Khoá i18n cho nhãn hiển thị (`twin3d.trangThai.*`). */
  khoaNhan: string;
}

/**
 * BẢNG ÁNH XẠ CỐ ĐỊNH. Đây là toàn bộ "quyết định màu" của cảnh 3D.
 *
 * ⚠ `running` dùng `--packml-run` (oklch chroma 0.06 — gần như xám) chứ KHÔNG
 * `--success` (chroma 0.17 — xanh lá rực). Xem docblock ISA-101 ở trên.
 */
const BANG_MAU: Readonly<Record<TrangThaiCanh, MauTrangThai>> = {
  // Bình thường — KHÔNG nổi bật. Đây là 42/43 máy trong giờ sản xuất.
  running: {
    token: "--packml-run",
    doMo: 1,
    hoaTiet: "khong",
    laBatThuong: false,
    khoaNhan: "twin3d.trangThai.running",
  },
  // Chuyển tiếp — xanh dương nhạt: "đang tiến triển, chưa cần ai chạy tới".
  warming_up: {
    token: "--info",
    doMo: 1,
    hoaTiet: "khong",
    laBatThuong: false,
    khoaNhan: "twin3d.trangThai.warmingUp",
  },
  changeover: {
    token: "--info",
    doMo: 1,
    hoaTiet: "khong",
    laBatThuong: false,
    khoaNhan: "twin3d.trangThai.changeover",
  },
  // Mất cân bằng chuyền — vàng/cam theo mức. `blocked` nặng hơn `starved`: nghẽn hạ
  // nguồn lan ngược lên cả chuyền, đói vật tư chỉ dừng một trạm.
  starved: {
    token: "--alarm-medium",
    doMo: 1,
    hoaTiet: "khong",
    laBatThuong: false,
    khoaNhan: "twin3d.trangThai.starved",
  },
  blocked: {
    token: "--warning",
    doMo: 1,
    hoaTiet: "khong",
    laBatThuong: false,
    khoaNhan: "twin3d.trangThai.blocked",
  },
  // Dừng chủ động — xám đậm. Dừng KHÔNG phải lỗi; tô đỏ ở đây là "mòn cảnh báo".
  stopped: {
    token: "--muted-foreground",
    doMo: 1,
    hoaTiet: "khong",
    laBatThuong: false,
    khoaNhan: "twin3d.trangThai.stopped",
  },
  // Bảo trì có kế hoạch — xanh dương + sọc chéo (hoạ tiết phân biệt với changeover).
  maintenance: {
    token: "--info",
    doMo: 1,
    hoaTiet: "soc_cheo",
    laBatThuong: false,
    khoaNhan: "twin3d.trangThai.maintenance",
  },
  // ★ MÀU BÃO HOÀ DUY NHẤT trong toàn cảnh.
  error: {
    token: "--destructive",
    doMo: 1,
    hoaTiet: "khong",
    laBatThuong: true,
    khoaNhan: "twin3d.trangThai.error",
  },
  // ★★★ NT-3 — xám GẠCH CHÉO. Không bao giờ suy biến về khoẻ hay lỗi.
  khong_ro: {
    token: "--muted",
    doMo: 1,
    hoaTiet: "gach_cheo",
    laBatThuong: false,
    khoaNhan: "twin3d.trangThai.khongRo",
  },
  // Ngừng khai thác — MỜ 35%, không mang màu trạng thái. Nó vẫn chiếm chỗ trong bố
  // cục (nên vẫn vẽ) nhưng không tham gia vận hành (nên phải lùi khỏi tiền cảnh).
  ngung_khai_thac: {
    token: "--muted",
    doMo: 0.35,
    hoaTiet: "khong",
    laBatThuong: false,
    khoaNhan: "twin3d.trangThai.ngungKhaiThac",
  },
};

/** Mọi trạng thái cảnh — cho test, showcase và chú giải. */
export const MOI_TRANG_THAI_CANH = Object.keys(BANG_MAU) as TrangThaiCanh[];

/** Tám giá trị `operationStatusEnum` — KHÔNG gồm hai trạng thái riêng của cảnh. */
export const TRANG_THAI_DB: readonly TrangThaiCanh[] = [
  "running", "stopped", "error", "maintenance",
  "warming_up", "changeover", "starved", "blocked",
] as const;

/**
 * Trạng thái → mô tả thị giác. Hàm THUẦN, test được trong node.
 *
 * ⚠ Đầu vào `unknown` chứ không `TrangThaiCanh`: giá trị đến từ DB/WS runtime, nơi
 * kiểu TypeScript KHÔNG cưỡng chế được gì. Chuỗi lạ (enum nở thêm giá trị ở
 * migration sau, hoặc `null` từ máy chưa từng báo cáo) rơi về **`khong_ro`**, KHÔNG
 * về `running`. Mặc định-về-khoẻ chính là lỗi NT-3 mà cả tệp này sinh ra để chặn.
 */
export function mauChoTrangThai(trangThai: unknown): MauTrangThai {
  if (typeof trangThai === "string" && trangThai in BANG_MAU) {
    return BANG_MAU[trangThai as TrangThaiCanh];
  }
  return BANG_MAU.khong_ro;
}

/**
 * Ba mức tươi theo tuổi dữ liệu (NT-3 mục 3).
 *
 * ⚠ `thoiDiemDuLieu` PHẢI là `max(timestamp)` của dữ liệu nền, **KHÔNG** phải thời
 * điểm render trang. Riêng phân biệt này diệt cả một lớp bug "giả tươi": trang vừa
 * render xong thì mọi thứ trông mới, kể cả dữ liệu từ hôm qua.
 */
export type MucTuoi = "tuoi" | "cu" | "khong_ro";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ T-3 (Đợt 5) — NGƯỠNG TƯƠI KHAI ĐÚNG MỘT LẦN                            */
/* ═══════════════════════════════════════════════════════════════════════════ */
/*
 * Hai ngưỡng này TỪNG tồn tại thành HAI BẢN SAO: số ma thuật `60_000`/`300_000`
 * viết thẳng trong `mucTuoi()` dưới đây, và hằng `NGUONG_TUOI_MS`/`NGUONG_CU_MS`
 * khai lại ở `van-hanh/trungThucDuLieu.ts`. Hai bản sao của một ngưỡng chỉ đồng ý
 * với nhau cho tới lần sửa đầu tiên — và khi lệch, chúng KHÔNG nổ: màu 3D dùng
 * bản này, ô đếm dùng bản kia, nên cùng một máy được tô "cũ" ở cảnh và đếm vào
 * "không rõ" ở panel. Đúng bài học G12: "hai bản cài đặt" hiếm khi chỉ lệch MỘT chỗ.
 *
 * ⚠ HƯỚNG IMPORT — cố ý NGƯỢC với đề xuất ban đầu (cho `mauTrangThai` import từ
 *   `trungThucDuLieu`). `trungThucDuLieu` ĐÃ import `mucTuoi` từ tệp này (:32),
 *   nên nhập ngược lại tạo VÒNG TRÒN import. Tệp này là LÁ (0 import), nên nó
 *   phải là nơi KHAI; `trungThucDuLieu` re-export để mọi call site cũ giữ nguyên.
 */

/** Dưới ngưỡng này là dữ liệu "tươi" (ms). */
export const NGUONG_TUOI_MS = 60_000;
/** Tới ngưỡng này còn là "cũ"; QUÁ nó là `khong_ro` (ms). NT-3 "quá 5 phút". */
export const NGUONG_CU_MS = 300_000;

export function mucTuoi(thoiDiemDuLieu: number | null | undefined, bayGio: number): MucTuoi {
  if (thoiDiemDuLieu === null || thoiDiemDuLieu === undefined) return "khong_ro";
  const tuoiMs = bayGio - thoiDiemDuLieu;
  if (tuoiMs < NGUONG_TUOI_MS) return "tuoi";
  if (tuoiMs <= NGUONG_CU_MS) return "cu";
  return "khong_ro";
}

/**
 * Áp mức tươi LÊN màu trạng thái — điểm hợp lưu của hai trục.
 *
 * ★ `khong_ro` (quá 5 phút) THẮNG mọi trạng thái được báo cáo. Một máy báo "running"
 * từ 40 phút trước KHÔNG được vẽ như đang chạy; nó được vẽ xám gạch chéo. Đây chính
 * là chỗ NT-3 được cưỡng chế bằng mã, thay vì bằng lời hứa của người gọi.
 */
export function mauTheoTuoi(
  trangThai: unknown,
  thoiDiemDuLieu: number | null | undefined,
  bayGio: number,
): MauTrangThai {
  const tuoi = mucTuoi(thoiDiemDuLieu, bayGio);
  if (tuoi === "khong_ro") return BANG_MAU.khong_ro;
  const goc = mauChoTrangThai(trangThai);
  // "cũ" = nhạt 40% + (UI kèm badge đồng hồ, do lớp nhãn vẽ, không thuộc tệp này).
  if (tuoi === "cu") return { ...goc, doMo: goc.doMo * 0.6 };
  return goc;
}

/** Tập token thực sự dùng — cho cầu chì trần 7 mã (ASM 6.1). */
export const TOKEN_DA_DUNG: readonly string[] = [
  ...new Set(MOI_TRANG_THAI_CANH.map((t) => BANG_MAU[t].token)),
];

/**
 * Phân giải tên token → chuỗi màu WebGL dùng được (`rgb(r, g, b)`).
 *
 * PHỤ THUỘC DOM — cố ý tách khỏi phần ánh xạ thuần ở trên để bảng màu test được
 * trong `environment: "node"`. Trình duyệt tự tính `oklch()` → `rgb()`, nên không
 * cần thư viện chuyển đổi màu nào.
 *
 * `docGiaTri` được TIÊM VÀO (mặc định `getComputedStyle`) để test bơm giá trị giả
 * mà không cần jsdom.
 *
 * ⚠ Trả `null` khi token rỗng/không đọc được, KHÔNG trả một màu dự phòng thầm lặng —
 * người gọi phải quyết định làm gì, vì một màu dự phòng câm sẽ vẽ máy lỗi thành màu
 * nào đó trông ổn (lại đúng lớp lỗi NT-3).
 */
export function giaiMauCanh(
  token: string,
  docGiaTri: (ten: string) => string = (ten) =>
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement).getPropertyValue(ten),
): string | null {
  const gt = docGiaTri(token).trim();
  return gt.length > 0 ? gt : null;
}
