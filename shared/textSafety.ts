/**
 * ★★★ Pha 4 — vá review TOÀN NHÁNH, C-1: **MỘT BẤT BIẾN XUYÊN NGANG THÌ KHÔNG ĐÓNG GÓI ĐƯỢC.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI (đọc trước khi thêm/bớt một dòng)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `stripInterpolationSyntax()` được viết ở `client/src/lib/errorCodes.ts` (Pha 2B Task 4, C-1) và
 * **luật của nó được phát biểu cho CẢ REPO**: *"mọi giá trị đi vào câu chữ phải qua CÙNG hàm làm
 * sạch đã có — đừng viết hàm thứ hai"*. Nhưng **cổng canh luật đó chỉ quét `client/src`**, và
 * `server/services/aiLocalTools/vramTools.ts` (Task 4) dựng một bề mặt câu chữ MỚI ở `server/`, nối
 * thẳng `owner`/`leaseKey`/`processKey` — chuỗi do **TIẾN TRÌNH ANH EM** ghi vào `vram_leases` — vào
 * `textSummary`, thứ được nhồi vào **prompt của LLM**. Đo được: **3.869 ký tự NGUYÊN VĂN**, chứa
 * `<|im_start|>` · `{{}}` · `${}` · `$t()`.
 *
 * ⇒ Hàm nằm ở `client/` thì `server/` **không với tới được** (kéo theo cả `i18next` vào bundle máy
 * chủ). Đóng gói ở một phía là **công cụ SAI cho một bất biến xuyên ngang** — đúng bài học vừa rút
 * ở Task 5. Nên hàm xuống `shared/` (nơi CẢ HAI phía đã nhập được: `@shared/*` có alias ở
 * `tsconfig.json`, `vite.config.ts` và `vitest.config.ts`), và `errorCodes.ts` **tái xuất** nó để
 * mọi lời gọi cũ (kể cả ca kiểm) không đổi một chữ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HAI HÀM, HAI **BỘ DIỄN GIẢI**, KHÔNG PHẢI HAI BẢN SAO CỦA MỘT VỊ TỪ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Luật *"đừng viết hàm thứ hai"* cấm **hai bản cài đặt cho MỘT bất biến**. Ở đây có **HAI bất biến
 * khác nhau**, vì có **HAI bộ diễn giải** đọc chuỗi:
 *   • `i18next` — cú pháp `{{…}}` / `$t(…)` ⇒ lớp ký tự `{`, `}`, `$` (`stripInterpolationSyntax`);
 *   • **chat template của LLM** — `<|im_start|>` / `<|im_end|>` / `<|endoftext|>` (ChatML, thứ
 *     Qwen3 đang dùng), `</s>`, `<s>` ⇒ lớp ký tự `<`, `>`, `|` (`stripChatControlTokens`).
 * Một bề mặt đi qua **cả hai** bộ diễn giải (câu tóm tắt của Agent: vào prompt, rồi có thể ra màn
 * hình) thì **ghép cả hai**; một bề mặt chỉ có một bộ diễn giải thì chỉ dùng hàm của nó.
 * ⚠ Ai thêm bộ diễn giải thứ ba: thêm **một** hàm ở ĐÂY, tuyệt đối không viết lại hai hàm trên.
 *
 * ⚠⚠⚠ VÌ SAO XOÁ **LỚP KÝ TỰ** CHỨ KHÔNG THAY THẾ MẪU — và vì sao đó là điều kiện SỐNG CÒN:
 * một lượt quét thay-thế-mẫu **không quét lại**, nên payload TỰ HUỶ tái tạo được cú pháp SAU khi
 * quét (Pha 2B đo được 3/3 biến thể sống, một biến thể **treo tiến trình > 8 phút**). Xoá một tập
 * ký tự thì kết quả **không còn ký tự nào** để lượt sau bắt được ⇒ phép làm sạch **BẤT ĐỘNG**:
 * `S(S(x)) === S(x)`. Tính chất đó có ca kiểm riêng ở `shared/textSafety.test.ts`.
 * ⚠ Một regex kiểu `/<\|[^|]*\|>/g` **KHÔNG bất động**: `<|<|im_start|>|>` → `<||>` → `` (hai lượt
 * ra hai kết quả khác nhau). Đã thử và BỎ — đó chính là bẫy mà Pha 2B rơi vào lần đầu.
 */

/**
 * Bộ diễn giải **i18next**. Mọi cú pháp nó nhận diện (`{{…}}`, `}}`, `$t(…)`) đều **bắt buộc** chứa
 * ít nhất một trong ba ký tự `{`, `}`, `$` ⇒ xoá sạch ba ký tự là **không tồn tại đường dựng**.
 * Giá phải trả: một tên chủ sở hữu có `{`/`}`/`$` mất đúng mấy ký tự đó.
 */
export function stripInterpolationSyntax(value: string): string {
  return value.replace(/[{}$]/g, "");
}

/**
 * Bộ diễn giải **chat template của LLM**. Mọi token điều khiển của mọi họ template đang dùng ở repo
 * này — ChatML (`<|im_start|>`, `<|im_end|>`, `<|endoftext|>`), Llama (`<s>`, `</s>`) — đều **bắt
 * buộc** chứa ít nhất một trong ba ký tự `<`, `>`, `|` ⇒ cùng phép đóng lớp như trên.
 *
 * ⚠⚠ ĐÂY KHÔNG PHẢI MỘT LỖI HIỂN THỊ. Một chuỗi **dữ liệu** chèn được ranh giới vai vào prompt là
 * **vỡ tính toàn vẹn của khung hội thoại** — và bề mặt cụ thể (`owner` của một giấy phép VRAM do
 * tiến trình anh em ghi) là thứ người trực đọc **đúng lúc hệ đang từ chối nạp model**.
 *
 * ⚠ Sau khi làm sạch, `<|im_start|>` còn lại `im_start` — **cố ý**: mục tiêu là làm chuỗi TRƠ, không
 * phải xoá dấu vết. Người đọc vẫn thấy hộ đó tên gì; bộ diễn giải thì không còn gì để diễn giải.
 */
export function stripChatControlTokens(value: string): string {
  return value.replace(/[<>|]/g, "");
}

/** Kết quả một lượt cắt — **cờ đi cùng câu**, đo ở ĐÚNG chỗ cắt. */
export interface CatChuoiKetQua {
  readonly cau: string;
  readonly daCat: boolean;
}

/**
 * ★★★ **MỘT** phép cắt-và-khai cho cả repo (M-5, review Task 1 → Task 4 `vramPreempt.catCau()`).
 *
 * ⚠⚠ Vì sao cờ `daCat` phải sinh **tại đây** chứ không đo lại ở người đọc: một phép so
 * `cau.length === TOI_DA` ở đầu kia là **bản sao thứ hai của một vị từ** — và bản sao ấy còn **SAI**
 * (một câu dài đúng bằng trần thì **không** bị cắt, nhưng phép so kia khai là đã cắt). Đây là lớp
 * lỗi đã đẻ ba Critical trong chuỗi pha này.
 *
 * ⚠ Người gọi truyền `toiDa` RIÊNG vì mỗi bề mặt có trần riêng **có lý do riêng** (cột DB · trần
 * `input` của một lệnh · ngân sách ngữ cảnh LLM) — nhưng **phép cắt thì chỉ có một**.
 */
export function catChuoi(tho: string, toiDa: number): CatChuoiKetQua {
  return { cau: tho.slice(0, toiDa), daCat: tho.length > toiDa };
}
