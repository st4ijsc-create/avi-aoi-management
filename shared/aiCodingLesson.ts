/**
 * ★★★ doc 82 · BỘ NHỚ XUYÊN PHIÊN — **LUẬT VỀ HÌNH DẠNG MỘT BÀI HỌC.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ FILE NÀY — MỘT LỖ ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `ai_coding_sessions` (doc 79, mig 0333) **lưu** hội thoại nhưng **không có gì đọc ngược vào
 * model** — nó là NHẬT KÝ, không phải TRÍ NHỚ. doc 81 mở trí nhớ TRONG một phiên (truyền
 * `history`); xuyên phiên vẫn chưa có. Hệ quả: chủ dự án sửa tay sau khi AI làm sai, bài học ấy
 * bốc hơi, lần sau AI sai y hệt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BẤT BIẾN SỐ MỘT: **MỘT BÀI HỌC LÀ DỮ LIỆU KHÔNG TIN CẬY, MỘT DÒNG, ĐÃ LÀM SẠCH.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bài học do NGƯỜI DÙNG GÕ, được LƯU LẠI, rồi NHÉT VÀO MỌI PROMPT SAU ĐÓ. Đó đúng định nghĩa một
 * mặt tiêm prompt bền vững — nguy hiểm hơn một câu hỏi độc lập, vì nó **sống lâu** và **tự động
 * tới**. Ba hàng rào, không phải một lời dặn:
 *
 *   1. **MỘT DÒNG.** `chuanHoaNoiDung()` gộp mọi khoảng trắng (kể cả `\n`, `\r`) thành một dấu
 *      cách. Nhiều lớp tấn công dựa vào ranh giới DÒNG để giả một vai mới (`\nSystem:` ở đầu dòng,
 *      một khối ``` giả, một dòng mốc `<<<<<<< SEARCH` giả). Gộp dòng làm chúng mất chỗ đứng —
 *      đây là phép biến đổi, không phải phép kiểm tra, nên không có nhánh nào để quên.
 *   2. **QUÉT + LÀM SẠCH bằng `ai/aiSafety.sanitizeUntrustedBlock`** — khuôn ĐÃ CÓ của repo
 *      (`scanUntrustedContent` ∪ trung hoà dấu rào ∪ `redactSecretsAndPII` ∪ cắt trần). File này
 *      **cố ý KHÔNG nhập** module ấy: `shared/` phải thuần và dùng chung với client. Việc gọi nằm
 *      ở `server/services/ai/codingLessonContext.ts` — MỘT chỗ, cho cả cửa GHI lẫn cửa ĐỌC.
 *   3. **BỌC trong khối `wrapUntrustedBlock`** khi vào prompt: model được bảo tường minh rằng phần
 *      ấy là DỮ KIỆN, không phải chỉ dẫn.
 *
 * ⚠ Và một phát biểu phải đứng vững bằng LƯỚI chứ không bằng lời hứa: **bài học KHÔNG nới được
 *   quyền.** Nó chỉ bao giờ là một chuỗi nối vào `prompt`; nó KHÔNG BAO GIỜ vào `systemPrompt`
 *   (persona — nơi chứa luật), không vào danh sách tool, không vào `AUTONOMY_INELIGIBLE`, không
 *   vào `locQuyetDinhLLMLapTrinh`, không vào hộp cát. Xem §5 của `aiCodingLesson.stream.test.ts`.
 *
 * ⚠ File này **THUẦN** (không I/O, không `process.env`, không nhập server) để luật về hình dạng chỉ
 *   có MỘT bản. Hai bản sao của một luật là cách chúng lệch nhau.
 */

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GIỚI HẠN — mỗi con số là một quyết định
// ══════════════════════════════════════════════════════════════════════════════════════════════

export const GIOI_HAN_BAI_HOC = {
  /**
   * Ký tự tối đa của MỘT bài học sau khi chuẩn hoá. 400 ≈ 150 token — đủ cho *"dự án này dùng
   * `bcryptjs`, đừng dùng `crypto`; mật khẩu ở bảng `user_secrets`"* và ngắn hơn hẳn một lượt lịch
   * sử (2.400). Ngắn là một tính chất AN TOÀN ở đây: bài học đi vào **mọi** prompt sau đó, nên một
   * bài học dài là một khoản thuế vĩnh viễn trên ngân sách token.
   */
  KY_TU_MOI_BAI: 400,
  /**
   * Số bài học tối đa đi vào MỘT prompt. Trần khối vì thế **suy ra được** (≤ 3 × 400 + khung
   * ≈ 1.400 ký tự ≈ 500 token) chứ không phải một hằng số thứ hai để trôi.
   */
  SO_BAI_VAO_PROMPT: 3,
  /** Số bài học tối đa lưu cho một (người dùng × dự án). Chặn bảng phình theo thời gian. */
  SO_BAI_TOI_DA: 200,
  /** Số bài học tối đa liệt kê khi người dùng hỏi. */
  SO_BAI_LIET_KE: 50,
} as const;

/**
 * Hình dạng id dự án — **dùng lại nguyên** luật của phiên. Bài học bám dự án y như phiên: một bài
 * học *"dự án này dùng bcryptjs"* nói về MỘT dự án, và rò sang dự án khác là một lời khai sai.
 */
export { RE_ID_DU_AN, RE_ID_PHIEN, laIdDuAnHopLe, laIdPhienHopLe } from "./aiCodingSession";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CHUẨN HOÁ — hàng rào số 1 (xem bất biến số một ở đầu file)
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Gộp mọi khoảng trắng thành một dấu cách, cắt hai đầu, cắt theo trần.
 *
 * ⚠ CẮT SAU khi gộp, không phải trước: gộp trước cho ra một chuỗi ngắn hơn nên phép cắt ít khi
 *   phải chạy; và một chuỗi đã một dòng thì điểm cắt không thể rơi vào giữa một dấu xuống dòng để
 *   đẻ ra một dòng cụt trông như một dòng mốc.
 */
export function chuanHoaNoiDung(x: unknown): string {
  if (typeof x !== "string") return "";
  const mot = x.replace(/\s+/g, " ").trim();
  return mot.length <= GIOI_HAN_BAI_HOC.KY_TU_MOI_BAI ? mot : mot.slice(0, GIOI_HAN_BAI_HOC.KY_TU_MOI_BAI).trim();
}

/**
 * ★★★ KHOÁ CHỐNG TRÙNG — và vì sao nó là một cột CSDL chứ không phải một phép so lúc chạy.
 *
 * Yêu cầu *"bài học trùng ⇒ không nhân bản"* nếu chỉ hiện thực bằng `SELECT rồi INSERT` thì nó là
 * một điều kiện chạy đua (hai tab, hai lượt gửi cùng lúc) và nó **biến mất** khi có cửa ghi thứ
 * hai. Cột này + `UNIQUE (userId, projectId, khoaTrung)` biến nó thành thuộc tính của **cái bảng**
 * — đúng lý lẽ đã dùng cho `CHECK ("projectId" ~ …)` ở mig 0333, và đúng chỗ đột biến M5 của doc 79
 * đã chứng minh là một hàng rào THẬT chứ không phải trang trí.
 *
 * Phép chuẩn hoá cố ý THÔ (thường hoá + bỏ dấu câu hai đầu): *"Dùng bcryptjs."* và *"dùng bcryptjs"*
 * là một bài học. Nó KHÔNG cố nhận ra hai câu khác chữ cùng nghĩa — đó là việc của model, không
 * phải của một khoá duy nhất.
 */
export function khoaTrungBaiHoc(noiDung: string): string {
  return chuanHoaNoiDung(noiDung)
    .toLowerCase()
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .replace(/\s+/g, " ")
    .slice(0, GIOI_HAN_BAI_HOC.KY_TU_MOI_BAI);
}

/**
 * Bỏ dấu tiếng Việt để so khớp. **Bài học nhóm C (2026-08-16)**: tiếng Việt KHÔNG DẤU vô hình với
 * mọi phép quét theo dấu — người dùng thật gõ *"nho gium: du an nay dung bcryptjs"*.
 */
export function boDau(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    /**
     * ⚠ `\p{Mn}` (nonspacing mark) chứ KHÔNG phải một dải ký tự thô `[U+0300-U+036F]`. Hai lý do:
     *   1. dải ấy gồm toàn **dấu kết hợp VÔ HÌNH** — dán nguyên bản vào mã nguồn là mời một lượt
     *      định dạng/sao chép nào đó nuốt mất chúng trong im lặng, và khi ấy `boDau` lặng lẽ biến
     *      thành phép đồng nhất mà không lưới nào kêu (đúng lớp "hàng rào không ai đo");
     *   2. `\p{Mn}` phủ ĐÚNG lớp ký tự cần bỏ, kể cả ngoài dải Latin — cùng khuôn `\p{L}`/`\p{N}`
     *      mà `ai/aiSafety.ts` đã dùng cho biên từ, nên không đẻ ra quy ước thứ hai.
     */
    .replace(/\p{Mn}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ PHÉP CHIẾU — cửa DUY NHẤT cho cả lượt GHI lẫn lượt ĐỌC (cùng khuôn `locLuot` của doc 79)
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Một bài học đã lưu, **đúng bốn ô**. Không có ô nào mang được một thẻ duyệt hay một quyền. */
export interface BaiHoc {
  id: string;
  /** Đã chuẩn hoá MỘT DÒNG và đã qua bộ làm sạch. */
  noiDung: string;
  updatedAt: string;
  /** `"none" | "low"` — `"high"` KHÔNG BAO GIỜ lưu được (bị từ chối ở cửa ghi). Để kiểm toán. */
  mucRuiRo: string;
}

/** Đúng bốn khoá được phép tồn tại. Dùng cho cả phép chiếu lẫn lưới đột biến. */
export const KHOA_BAI_HOC_HOP_LE = ["id", "noiDung", "updatedAt", "mucRuiRo"] as const;

/**
 * **CHIẾU** một hàng bất kỳ (kể cả `unknown` đọc lên từ CSDL) xuống hình dạng hợp lệ.
 *
 * ⚠ Dựng object MỚI từ bốn ô, **không** `{...o}` — đây là dòng làm nên bất biến. Một hàng bị đầu
 *   độc bằng SQL thẳng (nhét thêm `tool`, `actionId`, `chayNgay`) vẫn không phát ra được ô nào lạ.
 */
export function locBaiHoc(x: unknown): BaiHoc | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const noiDung = chuanHoaNoiDung(o.noiDung);
  if (id === "" || noiDung === "") return null;
  const updatedAt = typeof o.updatedAt === "string" ? o.updatedAt : "";
  const mucRuiRo = o.mucRuiRo === "low" ? "low" : "none";
  return { id, noiDung, updatedAt, mucRuiRo };
}

/** Chiếu cả danh sách; phần tử méo bị BỎ (không "sửa cho đúng"). */
export function locDanhSachBaiHoc(x: unknown): BaiHoc[] {
  if (!Array.isArray(x)) return [];
  const ra: BaiHoc[] = [];
  for (const raw of x) {
    const b = locBaiHoc(raw);
    if (b) ra.push(b);
  }
  return ra;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NHẬN Ý ĐỊNH — và vì sao ở ĐÂY một DANH SÁCH TRẮNG DẤU CÂU LẠI LÀ LỰA CHỌN ĐÚNG
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ Bài học `REPO_PATH_REGEX` (2026-08-21) nói: *"mọi danh sách trắng đều có phần tử thứ N+1, và
 * cái thiếu tiếp theo hỏng IM LẶNG"* ⇒ ở đó ta đổi sang phát biểu "token đã KẾT THÚC". Ở ĐÂY ta
 * làm NGƯỢC LẠI — đòi một dấu ngăn tường minh (`:` `：`) — và đó **không** phải quên bài học, mà là
 * cùng bài học áp cho một **CHIỀU HỎNG NGƯỢC**:
 *
 *   • Ở `REPO_PATH_REGEX`, thiếu một dấu câu ⇒ một đường dẫn BIẾN MẤT ⇒ `apply_diff_batch` thành mã
 *     chết. Hỏng theo chiều **MẤT**, và **CÂM**.
 *   • Ở đây, thiếu dấu ngăn ⇒ câu rơi xuống đường lập trình BÌNH THƯỜNG, người dùng thấy ngay là
 *     nó không được lưu (không có xác nhận). Hỏng theo chiều **KHÔNG LÀM GÌ**, và **NHÌN THẤY ĐƯỢC**.
 *   • Chiều nguy hiểm ở đây là chiều NGƯỢC LẠI: một bộ nhận QUÁ RỘNG sẽ **NUỐT một yêu cầu lập
 *     trình thật** (*"hãy nhớ đọc file X rồi sửa hàm Y"*) và biến nó thành một bài học vĩnh viễn —
 *     vừa mất việc người dùng xin, vừa đầu độc mọi prompt sau đó.
 *
 * ⇒ Hẹp ở đây là fail-safe; rộng ở kia mới là fail-safe. Cùng một nguyên tắc, hai kết luận khác nhau.
 *
 * ⚠ Mọi mẫu đều nhận cả bản CÓ DẤU lẫn KHÔNG DẤU (xem `boDau` và bài học nhóm C).
 */

/**
 * Cụm khởi phát cho lượt GHI, ở ĐẦU câu. Đã bỏ dấu — so trên chuỗi đã `boDau().toLowerCase()`.
 *
 * ⚠ **`nhớ` TRẦN KHÔNG PHẢI cụm khởi phát** — nó chỉ được nhận khi đi sau một mệnh lệnh tường minh
 *   (`hãy nhớ:`, `xin nhớ:`) hoặc kèm một hậu tố riêng (`nhớ giùm/dùm/rằng`). Lý do: *"nhớ: xong
 *   thì báo tôi"* là một câu nói bình thường, và nuốt nó thành bài học vĩnh viễn là đúng chiều hỏng
 *   nguy hiểm mà khối chú thích trên vừa mô tả. Ca âm ghim quyết định này ở `§1`.
 */
const RE_GHI =
  /^\s*(?:(?:hay|xin|lam\s*on|please)\s+(?:nho|remember)|nho\s*(?:gium|dum|rang)|ghi\s*(?:nho|nhan)|bai\s*hoc|remember(?:\s+that)?|note\s+to\s+self|keep\s+in\s+mind|记住|请记住)\s*[:：]\s*\S/i;

/**
 * Lượt QUÊN: `quên bài học 2` / `xoá bài học 2` / `forget lesson 2` / `忘记经验 2`.
 *
 * ⚠ Cố ý đòi **cả động từ LẪN danh từ LẪN số thứ tự**. Xoá là thao tác mất dữ liệu, và số thứ tự
 *   ấy chỉ có nghĩa ngay sau một lượt LIỆT KÊ — nên câu lệnh phải trông như một câu lệnh, không
 *   như một câu nói. (Động từ `bỏ`/`gỡ` bị loại: *"bỏ bài học 3 dòng đầu"* là một câu khác hẳn.)
 */
const RE_QUEN =
  /^\s*(?:quen|xoa)\s*(?:bai\s*hoc|lesson)\s*(?:so\s*|#\s*)?(\d{1,3})\s*$|^\s*forget\s+lesson\s*(?:no\.?\s*|#\s*)?(\d{1,3})\s*$|^\s*(?:忘记|删除)\s*(?:经验|记忆)\s*(\d{1,3})\s*$/i;

/**
 * Lượt LIỆT KÊ. ⚠ Cố ý **đòi một động từ** (`liệt kê`/`danh sách`/`xem`/`list`/`show`): nhận trần
 * cụm *"bài học"* sẽ nuốt câu *"bài học của lần trước là gì"* — một câu hỏi, không phải một lệnh.
 */
const RE_LIET_KE =
  /^\s*(?:liet\s*ke|danh\s*sach|xem|list|show)\s+(?:cac\s+|the\s+|my\s+)?(?:bai\s*hoc|lessons?)(?:\s*(?:da\s*luu|da\s*nho|saved))?\s*[?？]?\s*$/i;

export type YDinhBaiHoc =
  | { kieu: "ghi"; noiDung: string }
  | { kieu: "quen"; thuTu: number }
  | { kieu: "liet_ke" };

/**
 * Nhận ý định về BÀI HỌC từ một câu người dùng gõ. `null` ⇒ **không phải** lượt bài học ⇒ câu đi
 * tiếp xuống đường lập trình bình thường, không đổi một byte.
 *
 * ⚠ Thứ tự xét có tải trọng: GHI trước (nó đòi dấu ngăn + nội dung nên hẹp nhất), rồi QUÊN, rồi
 *   LIỆT KÊ. Ba mẫu rời nhau theo cấu tạo, thứ tự chỉ để đọc cho rõ.
 * ⚠ Nội dung trả về CHƯA qua bộ làm sạch — làm sạch là việc của tầng server (một chỗ, `aiSafety`).
 *   Ở đây chỉ chuẩn hoá MỘT DÒNG, vì đó là luật về HÌNH DẠNG và nó thuộc file này.
 */
export function bocYDinhBaiHoc(cauHoi: unknown): YDinhBaiHoc | null {
  if (typeof cauHoi !== "string" || cauHoi.trim() === "") return null;
  const phang = boDau(cauHoi).toLowerCase();

  if (RE_GHI.test(phang)) {
    /**
     * ★ Nội dung lấy từ chuỗi **GỐC** (còn dấu) — `boDau` chỉ dùng để NHẬN DẠNG; lưu bản không dấu
     * là làm hỏng dữ liệu của người dùng.
     *
     * ⚠⚠ Và lấy bằng **phép tách ở dấu ngăn ĐẦU TIÊN**, KHÔNG bằng chỉ số của regex trên bản phẳng:
     *   `normalize("NFD")` TÁCH một ký tự có dấu thành hai mã đơn vị trước khi xoá, nên bản phẳng
     *   có độ dài KHÁC bản gốc và **mọi chỉ số đều lệch** — một lượt lệch ở đây cắt cụt đầu bài học
     *   trong im lặng. Phép tách thì không có chỉ số nào để lệch: `RE_GHI` đã chứng minh câu mở đầu
     *   bằng cụm khởi phát và cụm ấy KHÔNG chứa `:`/`：`, nên dấu ngăn đầu tiên của chuỗi gốc **là**
     *   dấu ngăn của cụm khởi phát. Mọi `:` sau đó (URL, `key: value`) nằm trong nội dung và ở lại.
     */
    const cat = cauHoi.search(/[:：]/);
    const sach = cat < 0 ? "" : chuanHoaNoiDung(cauHoi.slice(cat + 1));
    return sach === "" ? null : { kieu: "ghi", noiDung: sach };
  }

  const mQuen = RE_QUEN.exec(phang);
  if (mQuen) {
    const so = Number(mQuen[1] ?? mQuen[2] ?? mQuen[3] ?? "");
    if (Number.isInteger(so) && so >= 1 && so <= GIOI_HAN_BAI_HOC.SO_BAI_LIET_KE) {
      return { kieu: "quen", thuTu: so };
    }
    return null;
  }

  if (RE_LIET_KE.test(phang)) return { kieu: "liet_ke" };
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ XẾP HẠNG — ĐÓNG VÒNG (E): bài học liên quan **TỰ TỚI**, không chờ ai nhớ đọc bảng
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Kế hoạch LACP để việc *"đọc bảng lessons"* cho một nhịp THỦ CÔNG hằng tháng. Một nhịp thủ công
 * là một nhịp sẽ trôi. Ở đây phép chọn chạy **mỗi lượt**, tất định, **không gọi model, không gọi
 * embedding** — kho của một (người × dự án) là vài chục hàng, một lượt truy hồi vector ở đó tốn
 * nhiều hơn giá trị nó mang lại (và đường truy hồi ấy đã đo được là NGUỘI ~14 s, xem doc 79).
 *
 * ⚠⚠ **VÌ SAO ĐIỂM 0 VẪN ĐƯỢC VÀO PROMPT.** Một bài học *"dự án này dùng bcryptjs"* có giao 0 từ
 *   với câu *"viết hàm đăng nhập"*, mà nó lại chính là bài học phải tới. Một ngưỡng điểm ở đây
 *   tái tạo đúng lỗ mà mục (E) sinh ra để bịt: bài học im lặng vắng mặt. ⇒ Luật là **xếp hạng, rồi
 *   LẤP ĐẦY**: các bài có giao > 0 đứng trước (đúng thứ tự điểm), phần ô còn trống lấp bằng bài
 *   MỚI NHẤT. Trần `SO_BAI_VAO_PROMPT` = 3 là thứ giữ cho việc ấy rẻ.
 *   ⇒ Mệnh đề đo được: **có bài học ⇒ prompt LUÔN có; không có bài học ⇒ prompt không một byte.**
 */

/** Từ có nghĩa để so khớp: ≥3 ký tự sau khi bỏ dấu, bỏ dấu câu. */
export function tachTu(s: string): string[] {
  return boDau(String(s ?? ""))
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 3);
}

/** Số từ chung giữa câu hỏi và một bài học. Thuần, không phụ thuộc thứ tự. */
export function diemGiaoTu(cauHoi: string, noiDung: string): number {
  const a = new Set(tachTu(cauHoi));
  if (a.size === 0) return 0;
  let n = 0;
  for (const t of new Set(tachTu(noiDung))) if (a.has(t)) n++;
  return n;
}

/**
 * Chọn ≤ `SO_BAI_VAO_PROMPT` bài học cho một câu hỏi. `dsMoiNhatTruoc` phải đã sắp **mới nhất
 * trước** (CSDL sắp, không sắp lại ở đây — một phép sắp thứ hai là một chỗ để lệch).
 */
export function chonBaiHocChoPrompt(cauHoi: string, dsMoiNhatTruoc: readonly BaiHoc[]): BaiHoc[] {
  const co = dsMoiNhatTruoc.filter((b) => diemGiaoTu(cauHoi, b.noiDung) > 0);
  // Sắp GIẢM theo điểm; hoà điểm ⇒ giữ nguyên thứ tự CSDL (mới nhất trước) — `sort` của V8 ổn định.
  const xep = [...co].sort((x, y) => diemGiaoTu(cauHoi, y.noiDung) - diemGiaoTu(cauHoi, x.noiDung));
  const ra: BaiHoc[] = xep.slice(0, GIOI_HAN_BAI_HOC.SO_BAI_VAO_PROMPT);
  if (ra.length >= GIOI_HAN_BAI_HOC.SO_BAI_VAO_PROMPT) return ra;
  const daCo = new Set(ra.map((b) => b.id));
  for (const b of dsMoiNhatTruoc) {
    if (ra.length >= GIOI_HAN_BAI_HOC.SO_BAI_VAO_PROMPT) break;
    if (!daCo.has(b.id)) ra.push(b);
  }
  return ra;
}
