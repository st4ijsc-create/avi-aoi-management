/**
 * ★★★ doc 79 · VÒNG TỰ ĐỘNG SAU KHI NGƯỜI DUYỆT — **CHÍNH SÁCH THUẦN** (không I/O, không model).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CÁI GÌ ĐƯỢC TỰ ĐỘNG HOÁ — VÀ CÁI GÌ TUYỆT ĐỐI KHÔNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Vòng khép kín *đọc → SỬA → người duyệt → ghi → chạy test → đọc lỗi → sửa tiếp* đã chạy thật
 * (doc 79, phần cuối), nhưng **mỗi bước phải người gõ tay**. Đợt này tự động hoá ĐÚNG BA VIỆC:
 *   1. **CHẠY** lệnh kiểm chứng sau khi người bấm "Duyệt & ghi";
 *   2. **ĐỌC** đầu ra THẬT (mã thoát + số ca đỏ/xanh) — không đoán;
 *   3. **ĐỀ XUẤT** bản sửa kế tiếp dựa trên lỗi vừa đọc ⇒ lại ra thẻ HITL.
 *
 * ⚠⚠⚠ **HITL TRÊN MỖI LƯỢT GHI LÀ BẤT BIẾN.** Không có một dòng nào trong file này (hay trong
 * `server/services/aiCodingVerify.ts`) tự áp diff. Byte chỉ rời ra đĩa qua `apply_diff` →
 * `proposeAction` → NGƯỜI bấm duyệt → `confirmAction`. Vòng tự động chỉ **rút ngắn khoảng cách
 * giữa hai lần bấm**, không thay chỗ cho cái bấm.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO PHẢI CÓ TRẦN VÀ ĐIỀU KIỆN "KHÔNG TIẾN BỘ"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mỗi lượt của vòng là **một lần gọi model 30B** (đo được: ~30–75 s) cộng một lượt chạy test (tới
 * 240 s theo trần danh sách trắng). Model 30B ở repo này có lớp lỗi "vòng suy luận thoái hoá" đã
 * gặp nhiều lần. Một vòng KHÔNG trần là cách đốt VRAM và thời gian mà không ai dừng được.
 * ⇒ Hai cầu chì ĐỘC LẬP, và cả hai đều phải phát biểu được thành phép đo:
 *   • **TRẦN** — số lượt tối đa (mặc định 3, trần cứng 5).
 *   • **KHÔNG TIẾN BỘ** — số ca đỏ KHÔNG giảm, HOẶC đầu ra test lặp lại y hệt, HOẶC bản diff đề
 *     xuất lặp lại y hệt lượt trước. Ba tín hiệu vì mỗi tín hiệu mù ở một chỗ khác nhau (xem
 *     `docKetQuaTest`: `npm run check` không in số ca nào, nên đếm-ca một mình là một cái thước
 *     **tự thoả** — nó không bao giờ đỏ được cho tsc).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE Ở `shared/` CHỨ KHÔNG PHẢI `server/`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bộ điều khiển vòng nằm ở CLIENT (vì giữa hai lượt phải có một cú bấm của người — server không
 * thể giữ một luồng SSE mở qua một lần duyệt). Nhưng *quyết định dừng* thì phải **đo được bằng
 * lưới đơn vị**, không được nằm rải trong một component React. Đặt ở `shared/` để client nhập nó
 * và lưới chạy thẳng trên nó: đột biến "bỏ trần" / "bỏ dừng-khi-không-tiến-bộ" ⇒ ĐỎ ngay tại đây.
 */

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TRẦN
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Trần MẶC ĐỊNH. 3 lượt ≈ 3 lần gọi model + 3 lượt test — đã là vài phút chờ của người dùng. */
export const TRAN_VONG_MAC_DINH = 3;
/** Trần CỨNG của cả hệ: không cấu hình nào vượt được. Xem khối ⚠⚠ ở đầu file (ngân sách 30B). */
export const TRAN_VONG_TOI_DA = 5;
/** Sàn: 1 lượt (chạy test một lần rồi dừng) — vẫn có ích, vẫn không phải "vô hạn". */
export const TRAN_VONG_TOI_THIEU = 1;

/**
 * Kẹp một giá trị trần về khoảng hợp lệ. Đầu vào méo (chuỗi rỗng, NaN, âm, `Infinity`) ⇒ mặc định.
 * ⚠ **Kẹp, không ném**: một `.env` gõ sai không được làm chết đường chat.
 */
export function kepTranVong(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return TRAN_VONG_MAC_DINH;
  return Math.min(TRAN_VONG_TOI_DA, Math.max(TRAN_VONG_TOI_THIEU, Math.trunc(n)));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ĐỌC ĐẦU RA THẬT
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface KetQuaTest {
  /**
   * XANH HẾT. **Fail-closed**: đòi mã thoát 0 **VÀ** không quá hạn **VÀ** (không đếm được ca đỏ
   * HOẶC đếm được 0). Một lượt chạy mã thoát 0 mà đầu ra vẫn khai "Failed: 2" là mâu thuẫn — coi
   * là CHƯA xanh còn hơn báo "xong" rồi dừng vòng trên một hệ vẫn hỏng.
   */
  xanh: boolean;
  /** Số ca ĐỎ đọc được, `null` khi bộ chạy không in con số nào (vd `tsc`). */
  soDo: number | null;
  /** Số ca XANH đọc được, `null` như trên. */
  soXanh: number | null;
}

/**
 * Bốn khuôn đầu ra THẬT của bốn bộ chạy trong danh sách trắng. Viết rời nhau, không "một regex
 * thông minh": mỗi bộ chạy có một cách nói dối riêng khi bị ép vào khuôn của bộ khác.
 *
 *   • `dotnet test` → `Failed! - Failed: 2, Passed: 4, Skipped: 0, Total: 6`
 *   • `node --test` → `# fail 2` / `# pass 4` (tap) hoặc `ℹ fail 2` / `ℹ pass 4` (spec)
 *   • `npx vitest run` → `Tests  2 failed | 4 passed (6)`
 *   • `npm run check` / `check:tests` (tsc) → **KHÔNG in con số nào** ⇒ `null`, và đó là câu trả
 *     lời ĐÚNG, không phải một khiếm khuyết cần vá bằng phép đoán.
 */
export function docKetQuaTest(dauRa: string | null | undefined, maThoat: number | null, hetGio = false): KetQuaTest {
  const s = typeof dauRa === "string" ? dauRa : "";
  let soDo: number | null = null;
  let soXanh: number | null = null;

  const dn = s.match(/Failed:\s*(\d+)\s*,\s*Passed:\s*(\d+)/i);
  if (dn) {
    soDo = Number(dn[1]);
    soXanh = Number(dn[2]);
  } else {
    const vt = s.match(/Tests?\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed/i);
    if (vt) {
      soDo = vt[1] === undefined ? 0 : Number(vt[1]);
      soXanh = Number(vt[2]);
    } else {
      // node --test: dòng bắt đầu bằng `#` (tap) hoặc `ℹ` (spec), rồi `fail N` / `pass N`.
      const nf = s.match(/^[\s#ℹ]*fail\s+(\d+)\s*$/im);
      const np = s.match(/^[\s#ℹ]*pass\s+(\d+)\s*$/im);
      if (nf) soDo = Number(nf[1]);
      if (np) soXanh = Number(np[1]);
    }
  }

  const xanh = maThoat === 0 && !hetGio && (soDo === null || soDo === 0);
  return { xanh, soDo, soXanh };
}

/**
 * Chuẩn hoá đầu ra trước khi so hai lượt: bỏ những thứ ĐỔI mỗi lượt mà không mang tin (thời gian
 * chạy, dấu thời gian, đường tuyệt đối chứa tên máy).
 *
 * ⚠ VÌ SAO CẦN: `dotnet test` in `Elapsed Time 1.9312s` — hai lượt HỎNG Y HỆT vẫn cho hai chuỗi
 * khác nhau, nên phép "đầu ra lặp lại" sẽ KHÔNG BAO GIỜ đúng và cầu chì thứ hai thành trang trí.
 * Đây đúng lớp "thước tự thoả" đã trả giá ở Pha 7.
 */
export function chuanHoaDauRa(dauRa: string | null | undefined): string {
  return String(dauRa ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\b\d+([.,]\d+)?\s*(ms|s|giây|sec|secs|seconds?)\b/gi, "<t>")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?\b/g, "<ts>")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * Băm rẻ, tất định, KHÔNG mã hoá — chỉ để trả lời *"chuỗi này có ĐÚNG BẰNG chuỗi lượt trước không"*.
 * ⚠ Cố ý không dùng `node:crypto`: file này chạy CẢ ở trình duyệt (bộ điều khiển vòng ở client).
 */
export function bamChuoi(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16)}-${h2.toString(16)}-${s.length}`;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// QUYẾT ĐỊNH DỪNG / ĐI TIẾP
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Vì sao vòng dừng. Mỗi giá trị là một CÂU KHÁC NHAU với người dùng — gộp chúng lại là nói dối về
 * nguyên nhân ("hết trần" và "không tiến bộ" đòi hai hành động khác nhau của người).
 */
export type LyDoDungVong =
  | "xanh"            // test XANH HẾT — việc đã xong
  | "het_tran"        // chạm trần số lượt
  | "khong_tien_bo"   // số ca đỏ không giảm / đầu ra lặp / diff lặp
  | "nguoi_tu_choi"   // người bấm Hủy ở thẻ duyệt
  | "khong_co_lenh"   // không suy ra được lệnh kiểm chứng cho dự án này
  | "khong_quyen"     // thiếu ai_repo_exec/canCreate ⇒ không được chạy lệnh
  | "co_tat"          // AI_CODING_AUTOLOOP=0
  | "loi";            // hỏng thật (server/model) — kèm thông điệp gốc

/** Trạng thái đủ để quyết định, sau khi một lượt test vừa chạy xong. */
export interface TrangThaiSauTest {
  /** Lượt VỪA chạy (1-based). */
  luot: number;
  tran: number;
  xanh: boolean;
  soDo: number | null;
  /** Số ca đỏ của lượt TRƯỚC (null ở lượt 1 hoặc khi không đọc được). */
  soDoTruoc: number | null;
  /** Băm đầu ra ĐÃ CHUẨN HOÁ của lượt này / lượt trước. */
  bamDauRa: string | null;
  bamDauRaTruoc: string | null;
}

export interface PhanQuyetVong {
  tiep: boolean;
  lyDo: LyDoDungVong | null;
}

/**
 * ★★★ CẦU CHÌ CỦA VÒNG. Thứ tự có tải trọng:
 *   1. **XANH trước hết** — xanh ở đúng lượt cuối phải báo "xong", KHÔNG phải "hết trần".
 *   2. **KHÔNG TIẾN BỘ** trước **HẾT TRẦN** — nếu cả hai cùng đúng thì lý do đắt giá hơn với người
 *      đọc là "nó đang giậm chân", chứ không phải "nó vừa hết lượt".
 *   3. **HẾT TRẦN**.
 *
 * ⚠ Hai tín hiệu không-tiến-bộ là **HOẶC**, không phải VÀ: đếm-ca mù với `tsc` (không có số), còn
 * so-đầu-ra mù khi đầu ra có nhiễu không chuẩn hoá hết. Đòi cả hai cùng đúng ⇒ một vị từ **tự
 * thoả** không bao giờ dừng được vòng.
 */
export function quyetDinhTiep(s: TrangThaiSauTest): PhanQuyetVong {
  if (s.xanh) return { tiep: false, lyDo: "xanh" };

  const doKhongGiam = s.soDo !== null && s.soDoTruoc !== null && s.soDo >= s.soDoTruoc;
  const dauRaLap = s.bamDauRa !== null && s.bamDauRaTruoc !== null && s.bamDauRa === s.bamDauRaTruoc;
  if (doKhongGiam || dauRaLap) return { tiep: false, lyDo: "khong_tien_bo" };

  if (s.luot >= s.tran) return { tiep: false, lyDo: "het_tran" };
  return { tiep: true, lyDo: null };
}

/**
 * Tín hiệu không-tiến-bộ THỨ BA, đo ở một thời điểm KHÁC: khi model vừa đề xuất bản sửa kế tiếp.
 * Model 30B thoái hoá hay trả lại **đúng bản diff vừa bị chứng minh là sai**. Bắt được ở đây thì
 * ta tiết kiệm nguyên một lượt chạy test (tới 240 s) so với đợi vòng sau.
 *
 * ⚠ So trên nội dung `modified` (thứ SẼ được ghi), không so trên câu chữ model nói — câu chữ đổi
 * mỗi lượt kể cả khi mã y hệt.
 */
export function deXuatLapLai(bamMoi: string | null, bamTruoc: string | null): boolean {
  return bamMoi !== null && bamTruoc !== null && bamMoi === bamTruoc;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CẮT ĐẦU RA ĐƯA VÀO PROMPT SỬA
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Trần ký tự đầu ra test nhét vào câu hỏi lượt sau.
 *
 * ⚠ `TRAN_DAU_RA` của hộp cát lệnh là 32 KB. Nhét cả 32 KB vào prompt CÙNG với nội dung tệp (tới
 * 60 KB) là đẩy một lượt suy luận 30B vượt cửa sổ ngữ cảnh — và cách nó hỏng là **cắt mất phần
 * ĐẦU**, tức mất chính nội dung tệp mà model phải chép lại. Giữ ĐẦU + CUỐI: bộ chạy in tên ca hỏng
 * ở đầu và bảng tổng kết ở cuối.
 */
export const TRAN_LOI_VAO_PROMPT = 4_000;

export function catLoiChoPrompt(dauRa: string | null | undefined, tran = TRAN_LOI_VAO_PROMPT): string {
  const s = String(dauRa ?? "");
  if (s.length <= tran) return s;
  const dau = Math.floor(tran * 0.4);
  const cuoi = tran - dau;
  const boQua = s.length - tran;
  return `${s.slice(0, dau)}\n… [bỏ qua ${boQua} ký tự ở giữa] …\n${s.slice(s.length - cuoi)}`;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-23 — "VÒNG ĐỜI ĐÃ CHẠY XONG" ≠ "BYTE ĐÃ VÀO ĐĨA"
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ **LỖI THẬT, ĐO ĐƯỢC — VÀ NÓ ĐÃ TỪNG ĐƯỢC VÁ Ở ĐÚNG MỘT NƠI TRONG HAI NƠI.**
 *
 * `ConfirmResult.ok === true` chỉ phát biểu *"vòng đời HITL chạy hết các chặng"*. Nó **KHÔNG**
 * phát biểu *"tệp trên đĩa đã đổi"*. Khi băm neo lệch (`BASE_MISMATCH` — ai đó sửa tệp giữa lúc
 * thẻ duyệt hiện ra và lúc bấm) hoặc tệp bẩn (`FILE_DIRTY`), `execute()` **TỪ CHỐI đúng như thiết
 * kế** và trả một `ToolResult` mang `note`, nhưng `confirmAction` vẫn trả
 * `{ok:true, status:"executed", result:<ToolResult mang note>}` (xem `aiCopilotActions.confirmAction`).
 *
 * ⇒ Phía WEB đọc `res.ok` rồi báo *"Đã ghi tệp."* + đẩy *"Đã áp diff"* vào transcript, rồi **vòng
 *   tự động chạy tiếp trên một bản vá chưa hề vào đĩa**. Một cổng an toàn chạy ĐÚNG mà **báo cáo
 *   SAI** thì người dùng (và tác nhân) hành động theo lời báo cáo, không theo sự thật.
 *
 * ⚠⚠ **VÌ SAO VỊ TỪ NÀY Ở `shared/` VÀ CHỈ CÓ MỘT BẢN**: CLI đã vá đúng lỗi này (2026-08-23) bằng
 *   một biểu thức viết TẠI CHỖ. Web cần đúng phán quyết ấy. Hai bản sao của một vị từ an toàn là
 *   cách chắc chắn nhất để chúng trôi khỏi nhau, và bản lỏng hơn bao giờ cũng là bản đang chạy —
 *   bài học đã trả giá nhiều lần ở repo này. Nên nó đứng MỘT MÌNH, thuần, có lưới riêng, và cả
 *   `aiCodingCli/cli.ts` lẫn `AICodingWorkspace.tsx` đều gọi CHÍNH nó.
 *
 * ⚠ Quy ước máy-đọc-được: `note` là chỗ cả nhóm tool repo khai mã từ chối (`PATH_REJECTED`,
 *   `FILE_DIRTY`, `BASE_MISMATCH`, `NOT_FOUND`…). Có `note` KHÔNG rỗng ⇒ **TỪ CHỐI**.
 * ⚠ `null`/`undefined`/không phải chuỗi/chuỗi rỗng ⇒ **KHÔNG** phải từ chối. Đảo chiều mặc định ở
 *   đây sẽ biến mọi lượt ghi THÀNH CÔNG (tool ghi thành công không đặt `note`) thành "bị từ chối"
 *   — tức đổi một lời khai sai lấy một lời khai sai khác.
 */
export function daBiTuChoiGhi(ketQua: unknown): boolean {
  if (ketQua == null || typeof ketQua !== "object") return false;
  const note = (ketQua as { note?: unknown }).note;
  return typeof note === "string" && note !== "";
}

/**
 * Mã từ chối máy-đọc-được của một lượt ghi bị từ chối. `null` ⇔ `daBiTuChoiGhi()` nói `false`.
 * Tách khỏi vị từ trên để nơi hiển thị không phải tự đào lại `note` (và tự nghĩ ra một quy ước thứ hai).
 */
export function maTuChoiGhi(ketQua: unknown): string | null {
  return daBiTuChoiGhi(ketQua) ? String((ketQua as { note?: unknown }).note) : null;
}
