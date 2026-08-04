/**
 * ★★★ PHA 2A TASK 5 — BẢN LIỆT KÊ ĐẦY ĐỦ ĐƯỜNG CẤP PHÁT VRAM. ĐẦU VÀO CHO PHA 2B.
 *
 * Pha 2B cưỡng chế trên `headroom = trần − Σ leaseBytes`. Một hộ tiêu thụ VẮNG MẶT khỏi bảng
 * này là một khối byte mà sổ tưởng còn TRỐNG trong khi thiết bị đã giữ ⇒ cưỡng chế cho phép cấp
 * phát trên byte ma ⇒ OOM. Vì thế bảng liệt kê CẢ hộ ĐÃ NỐI lẫn hộ CHƯA NỐI, và cả những dòng
 * KHÔNG chạm GPU: `wired: false` không có nghĩa "bỏ qua được", nó có nghĩa "phải phân loại".
 *
 * ⚠⚠ ĐẾM BẰNG `git grep`, ĐẾM LẠI TỪ ĐẦU MỖI LẦN. Con số này ĐÃ SAI HAI LẦN LIÊN TIẾP ở pha
 * trước vì được cộng dồn trong đầu: "12" (thiếu `aiLlmFinetuneSidecar`) rồi "13" (quên đúng điểm
 * mà chính lượt vá đó vừa thêm — `cuda-backend:reranker`).
 *
 *     git grep -nE "await beginVram(Allocation)?[[:space:]]*\(" -- server/ | grep -v "\.test\."
 *
 * cho **16** dòng = **14** điểm gọi + **2** pass-through của lớp bọc. Máy quét (khớp MỌI dạng,
 * kể cả khai báo hàm) thấy **19**, trừ **5** lần KHÔNG PHẢI điểm gọi
 * (`PERMIT_SYMBOL_OCCURRENCES_THAT_ARE_NOT_CALL_SITES`) ⇒ cũng **14**. Hai đường đếm khác nhau,
 * cùng một số.
 *
 * ⚠ ĐỪNG đếm bằng `git grep` KHÔNG có `await` và KHÔNG lọc test: ra 126 + 31, vì nó gộp cả file
 * test lẫn hàng chục lần nhắc trong chú thích.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ BẢNG NÀY LÀ MỘT LƯỚI, KHÔNG PHẢI TÀI LIỆU — VÀ LƯỚI ĐÓ ĐÃ TỪNG THỦNG.
 *
 * `vramAllocationSites.test.ts` quét lại `server/**` + `scripts/**` rồi đòi kết quả khớp TỪNG
 * DÒNG. Bản ĐẦU TIÊN của lưới **để một sidecar GPU đi qua**: reviewer thêm
 * `cp.spawn("llama-server.exe", ["-ngl","999"])` và `execFile("whisper-cuda.exe", …)` ⇒ 7/7 xanh.
 * Nguyên nhân: mẫu `spawn(` chặn dạng gọi thành viên, và `execFile(` vắng mặt — dù whisper.cpp
 * đã được GỌI TÊN trong chính báo cáo của task này.
 *
 * Bản này quét HAI LỚP: mẫu LỜI GỌI (cấp phát ở đâu) + mẫu MODULE `child_process` (file nào CÓ
 * KHẢ NĂNG sinh tiến trình con). Lớp thứ hai là lớp DUY NHẤT bắt được `promisify(execFile)` —
 * đúng cách `kbVideoTranscriber.ts` (whisper) và `kbPdfOcr.ts` gọi. Trước lượt vá này cả hai file
 * đó **không hề xuất hiện** trong bảng.
 *
 * ⚠ KHÔNG TUYÊN BỐ lưới này đóng được lớp lỗi sidecar 7,8 GB của Đợt 0. Bản trước có tuyên bố đó
 * và nó SAI. Xem `CONSUMERS_WITHOUT_A_CODE_SITE` và khối "không bắt được gì" ở đầu file test.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * ★★★★ ĐỌC TRƯỚC KHI DÙNG BẢNG NÀY LÀM ĐẦU VÀO CHO PHA 2B — KẾT LUẬN CUỐI CỦA TASK 5:
 *
 *   > **157 là số dòng mà MẪU QUÉT NGÀY 2026-08-04 nhìn thấy. Nó là cận DƯỚI.
 *   > KHÔNG phương pháp nào trong Pha 2A biến nó thành cận TRÊN.**
 *
 * Đây không phải sự khiêm tốn theo phép lịch sự; nó là một kết luận CẤU TRÚC. Tập hình dạng cấp
 * phát **đóng dưới phép ghép**: alias khi nhập · destructure đổi tên · `await import()` ·
 * `require()` ghép chuỗi · gọi hàm qua khoá tính toán · `Reflect.get` · `globalThis[name]` ·
 * bảng tra cứu · proxy… Quyết định thành viên của một tập như thế bằng biểu thức chính quy là
 * bài toán **KHÔNG QUYẾT ĐỊNH ĐƯỢC** — không phải một danh sách chưa liệt kê xong. "Vòng nào cũng
 * có hình dạng mới đi lọt" vì thế là **hệ quả tất yếu**, không phải rủi ro thống kê.
 *
 * ★ VÀ ĐÓ LÀ SỐ ĐO, KHÔNG CÒN LÀ LẬP LUẬN — **N-2b**: reviewer lấy đúng hình dạng né tránh của
 * `index.cjs` và **chỉ đổi tên một biến** (`child_process_1` → `_0xcp`) ⇒ **10/10 XANH, ĐI LỌT**,
 * sau khi bản vá N-2 đã vào. Nghĩa là mẫu `\bchild_process` **không bắt hình dạng né tránh; nó
 * bắt một QUY ƯỚC ĐẶT TÊN của bundler.** `index.cjs` bị bắt chỉ vì trình làm rối tình cờ giữ
 * nguyên tên biến do TypeScript sinh — trong khi chính file đó đã đổi tên HÀM thành `_0x3a14ef`.
 * ⚠ ĐỪNG VÁ N-2b BẰNG CÁCH THÊM MẪU. Mỗi mẫu mới chỉ đóng một thể hiện, và làm lưới trông mạnh
 * hơn thực chất — đúng cơ chế đã khiến vòng 1 tuyên bố sai.
 *
 * ★★ VÀ BẰNG CHỨNG **THỨ HAI**, RẺ HƠN HẲN — **I-1 (review TOÀN NHÁNH)**: `reportGenerator.ts:384`
 * gọi `puppeteer.launch()` **không `--disable-gpu`**, với `puppeteer` là dependency SẢN XUẤT — và
 * nó vắng mặt HOÀN TOÀN khỏi bảng 151 dòng. Nó KHÔNG né tránh gì cả: nó chỉ đi qua thư viện thứ
 * TƯ, trong khi `MODULE_PATTERNS` liệt kê BẰNG TAY đúng ba. **Một hộ GPU đi qua thư viện chưa được
 * liệt kê là vô hình THEO THIẾT KẾ.** Ai đọc bảng này có thể nghĩ "nó chỉ hụt ở những ca né tránh
 * tinh vi như `index.cjs`" — không phải vậy, nó hụt ở một `import` bình thường.
 *
 * ⇒ HỆ QUẢ CHO PHA 2B: bản liệt kê này **KHÔNG phải bảo đảm**. Nó là một **tiên nghiệm
 * best-effort** — tốt cho việc biết PHẢI ĐI HỎI Ở ĐÂU, vô dụng nếu bị dùng như một bằng chứng đã
 * đủ. Lớp an toàn thật phải là **đối chiếu với SỰ THẬT THIẾT BỊ lúc chạy**, không phải một danh
 * sách tĩnh (dù dài bao nhiêu).
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Số **ĐIỂM GỌI** `beginVramAllocation()` (kể cả qua lớp bọc `beginVram()`) trong mã sản xuất
 * của `server/`. Không phải số lần xuất hiện của ký hiệu — xem docstring đầu file.
 *
 * Đếm lại ngày 2026-08-04 bằng HAI cách độc lập sau khi nới mẫu quét (I-7), cùng ra 14.
 *
 * ⚠ 14 → **15** (Pha 2B Task 3): điểm gọi MỚI ở `vram/vramLoadOutcome.ts` mở giấy phép cho MỖI
 * LƯỢT THỬ của §5.5. Nó KHÔNG phải một hộ tiêu thụ mới — nó là điểm gọi 2/14 cũ (`gguf:<modelId>`)
 * **chuyển chỗ**: lượt nạp model nay mở/đóng một giấy phép riêng cho từng lượt thử, thay vì giữ
 * MỘT giấy phép suốt cả lượt đầu lẫn lượt lùi. Dòng `aiGgufEngine.ts` cũ ở lại vì nó vẫn là điểm
 * gọi THẬT của **đường dự phòng** (khi `vramLoadOutcome` không nạp được).
 * ⚠⚠ Điểm gọi mới chỉ đếm được vì biến nhận hàm ở đó **ĐƯỢC ĐẶT TÊN `beginVram`**. Đặt tên khác
 * (`begin`, `fn`, …) làm nó vô hình — xem chú thích tại chỗ.
 *
 * ⚠⚠⚠ **HẠ GIỌNG (M-7, review vòng 1) — ĐỪNG ĐỌC RÀNG BUỘC TÊN Ở TRÊN NHƯ MỘT LUẬT ĐÓNG LỖ.**
 * Nó bảo vệ **ĐÚNG ĐIỂM GỌI HIỆN CÓ**, và chỉ thế. Reviewer đo hai đột biến:
 *   • đổi tên biến đã ràng buộc (`beginVram` → `moGiayPhep`) ⇒ **3 ca ĐỎ** ⇒ ràng buộc CÓ hiệu lực;
 *   • thêm một điểm cấp phát **MỚI** qua `import { beginVramAllocation as moChoTrongSoPhu }` rồi
 *     gọi `moChoTrongSoPhu({…})` ⇒ **12/12 XANH, không một ca nào đỏ**. Một điểm mở giấy phép THẬT,
 *     trong mã sản xuất, **hoàn toàn vô hình**, và `WIRED_ALLOCATION_SITE_COUNT` vẫn khớp.
 * ⇒ **Lớp alias VẪN MỞ.** Đây KHÔNG phải hồi quy — nó nhất quán với kết luận N-2b/I-1 của chính
 * file này (*"157 là cận DƯỚI; quyết định thành viên bằng regex là bài toán KHÔNG QUYẾT ĐỊNH
 * ĐƯỢC"*). Đừng cố đóng nó ở đây. Và **Task 5 tuyệt đối không được dùng con số này như một bảo
 * đảm** rằng mọi hộ tiêu thụ đều trong sổ.
 */
export const WIRED_ALLOCATION_SITE_COUNT = 15;

/**
 * Số DÒNG của `KNOWN_ALLOCATION_SITES` = số lần xuất hiện mà mẫu quét ngày 2026-08-04 nhìn thấy.
 *
 * ⚠⚠ **159 LÀ CẬN DƯỚI, KHÔNG PHẢI CẬN TRÊN.** Xem khối "ĐỌC TRƯỚC KHI DÙNG BẢNG NÀY" ở đầu file.
 * Bốn vòng review, bốn lần nới mẫu: 65 → 120 → 151 → 157, trong khi số điểm gọi vẫn 14. Con số này
 * nói về *mẫu quét*, không nói về *hệ thống*.
 *
 * ⚠ 157 → **159** (Pha 2B Task 1): hai dòng MỚI đều thuộc `vramGpuHolders.ts` (`child_process` +
 * `execFile(`) và cả hai `wired: false` — file đó ĐỌC danh tính tiến trình đang giữ GPU, không cấp
 * phát gì. Số điểm gọi `beginVramAllocation()` KHÔNG đổi (`WIRED_ALLOCATION_SITE_COUNT` vẫn 14).
 *
 * ⚠ 159 → **160** (Pha 2B Task 3): MỘT dòng mới — `vram/vramLoadOutcome.ts` → `beginVram(`
 * (ĐIỂM GỌI 15/15). Ba lần xuất hiện khác của `beginVramAllocation` trong file đó (import, kiểu
 * của tham số tiêm, giá trị mặc định) đều KHÔNG có `(` theo sau nên máy quét không đếm — và lần
 * xuất hiện thứ tư nằm trong một chuỗi mẫu (`console.warn`), thứ mà máy quét đã xoá trước khi khớp.
 */
export const KNOWN_ALLOCATION_SITE_ROW_COUNT = 160;

/**
 * ★★ HAI CÁI BẪY ĐẾM-HAI-LẦN, khai TƯỜNG MINH thay vì lọc ngầm bằng regex.
 *
 * Sau khi mẫu quét bỏ ràng buộc `\(\s*\{` (I-7), ký hiệu giấy phép còn khớp thêm hai thứ KHÔNG
 * phải điểm gọi: **khai báo hàm** và **pass-through bên trong lớp bọc**. Đếm chúng vào là báo
 * thừa 5 hộ; lọc chúng bằng một regex kiểu "bỏ dòng có `function`" thì một ngày nào đó sẽ lặng
 * lẽ nuốt một điểm gọi THẬT. Nên: liệt kê từng cái, và ca `3b` bắt buộc mỗi cái phải còn tồn tại.
 */
export const PERMIT_SYMBOL_OCCURRENCES_THAT_ARE_NOT_CALL_SITES: readonly {
  file: string;
  symbol: string;
  why: string;
}[] = [
  { file: "server/services/vram/vramWiring.ts", symbol: "beginVramAllocation(", why: ":517 KHAI BÁO hàm — nơi định nghĩa, không phải nơi gọi." },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", why: ":752 KHAI BÁO lớp bọc nội bộ `beginVram()`." },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVramAllocation(", why: ":757 PASS-THROUGH bên trong lớp bọc — đếm nó là đếm hai lần cùng bốn điểm gọi của file này." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "beginVram(", why: ":22 KHAI BÁO lớp bọc nội bộ `beginVram()`." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "beginVramAllocation(", why: ":27 PASS-THROUGH bên trong lớp bọc." },
];

/**
 * MỘT DÒNG = MỘT LẦN XUẤT HIỆN của `symbol` trong `file` — **157 dòng / 2026-08-04**, khoá bằng
 * `KNOWN_ALLOCATION_SITE_ROW_COUNT` và một ca test riêng.
 *
 * ⚠ P-1 (re-review vòng 2): dòng này từng ghi "120" **sau khi** bảng đã lên 151 — một con số cũ
 * sót lại nằm ĐÚNG trong file có docstring cảnh báo về việc cộng dồn số cũ, và **không ca test
 * nào ràng buộc độ dài bảng** nên không có gì đỏ. Nay độ dài bảng được khoá bằng khẳng định.
 *
 * `symbol` là ĐÚNG khoá mà máy quét dùng, không phải tên hàm bao quanh — có vậy bảng mới đối
 * chiếu được. Tên hàm / chủ sở hữu / số dòng nằm trong `note`.
 *
 * `wired`:
 *   • `true`  — lượt cấp phát này nằm TRONG một cửa sổ `beginVramAllocation()`/`commitMeasured()`,
 *               hoặc chính là điểm mở giấy phép.
 *   • `false` — KHÔNG giấy phép nào bao quanh. Gồm cả những dòng KHÔNG chạm GPU (ghi rõ trong
 *               `note`) — chúng ở đây để BẮT BUỘC phân loại, không phải vì chúng là hộ.
 *
 * ⚠ `wired: true` chỉ nói "có giấy phép", KHÔNG nói "số đúng". Ví dụ sống: `gguf-embed-ctx` có
 * giấy phép, commit 526,0 MiB, và thiết bị vẫn cho thấy thiếu ~128 MiB (xem khối cuối file).
 *
 * ⚠⚠ BA CHỖ Ô `wired` NÓI KHÔNG ĐỦ — đọc trước khi lấy nó làm đầu vào cho Pha 2B:
 *
 *   1. **5 dòng "KHÔNG phải điểm gọi"** (3 khai báo hàm + 2 pass-through) mang `wired: true`
 *      chỉ vì chúng thuộc bộ máy giấy phép. Chúng KHÔNG phải lượt cấp phát và cũng KHÔNG phải
 *      điểm nối — ở những dòng đó ô `wired` **vô nghĩa**, đừng cộng chúng vào bất cứ tổng nào.
 *
 *   2. **`wired: true` ở `scripts/` là CÓ ĐIỀU KIỆN, không phải tính chất.** SÁU dòng
 *      (`_gguf-embed.mjs` ×4 kể cả lượt nạp thư viện, `eval-rag.mjs` ×4) chỉ được phủ khi tiến
 *      trình API SPAWN chúng. `_gguf-embed.mjs` có **5 đường vào, chỉ 2 đi qua giấy phép**;
 *      `eval-rag.mjs` chỉ được phủ với cờ `--ci` do scheduler truyền — mà `npm run kb:eval` là
 *      lệnh CÓ THẬT trong `package.json`. Cùng dòng mã đó, chạy tay, là **không giấy phép nào**.
 *      Một ô boolean không diễn tả được "phụ thuộc vào ai khởi động".
 *
 *   3. **`wired: true` KHÔNG có nghĩa "chặn được".** Với `contextSize:"auto"`
 *      (`aiReranker.ts:486`) giấy phép chỉ ĐO SAU khi cấp phát xong; ở thời điểm cưỡng chế phải
 *      quyết định thì chưa tồn tại con số nào.
 *
 * ⚠⚠ M-1 (review TOÀN NHÁNH) — **SỐ DÒNG TRONG `note` KHÔNG CÓ LƯỚI NÀO CANH, VÀ ĐÓ LÀ CÓ CHỦ Ý.**
 * Ca test khoá `file` + `symbol` (thứ máy quét đối chiếu được); `note` là văn bản cho người đọc.
 * Hệ quả đã XẢY RA THẬT, không phải rủi ro lý thuyết: Task 6 sửa `vramWiring.ts` và
 * `vramProcessProbe.ts` **SAU KHI** Task 5 chốt bảng, làm mọi số dòng bảng trích cho hai file đó
 * lệch đi — mà bảng vẫn XANH. Đó đúng là "lưới còn nguyên, BẰNG CHỨNG của lưới thì mục".
 * ⇒ KỶ LUẬT: sửa một file được bảng trích dẫn thì **đọc lại các ô `note` của file đó**. Ba số đã
 * được kiểm lại bằng máy ngày 2026-08-04 sau lượt vá review TOÀN NHÁNH: `vramWiring.ts` `:397 →
 * :517`, `vramProcessProbe.ts` `:151 → :309`, `aiInferenceEngine.ts` `:181/:192 → :213/:224`.
 * ⚠ KHÔNG khoá số dòng bằng test: một lưới đỏ mỗi lần ai đó thêm một dòng chú thích sẽ bị tắt.
 * Số dòng đúng ở **2026-08-04** và sẽ trôi. Khoá đối chiếu vẫn là `file` + `symbol`.
 */
export const KNOWN_ALLOCATION_SITES: readonly {
  file: string;
  symbol: string;
  wired: boolean;
  note: string;
}[] = [
  // ═════════════════════════════════════════════════════════════════════════════════════════
  // A. server/ — 14 ĐIỂM MỞ GIẤY PHÉP + 5 lần xuất hiện KHÔNG phải điểm gọi
  // ═════════════════════════════════════════════════════════════════════════════════════════
  { file: "server/services/vram/vramWiring.ts", symbol: "beginVramAllocation(", wired: true, note: ":517 KHAI BÁO hàm — không phải điểm gọi. Xem PERMIT_SYMBOL_OCCURRENCES_THAT_ARE_NOT_CALL_SITES." },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", wired: true, note: ":752 KHAI BÁO lớp bọc nội bộ — không phải điểm gọi (nuốt lỗi rồi uỷ quyền cho vramWiring)." },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVramAllocation(", wired: true, note: ":757 PASS-THROUGH trong lớp bọc `beginVram()` — không phải điểm gọi độc lập." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "beginVram(", wired: true, note: ":22 KHAI BÁO lớp bọc nội bộ — không phải điểm gọi." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "beginVramAllocation(", wired: true, note: ":27 PASS-THROUGH trong lớp bọc `beginVram()` — không phải điểm gọi độc lập." },

  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", wired: true, note: ':399 ĐIỂM GỌI 1/14 — owner "cuda-backend", gguf-backend, production. Backend CUDA của cả tiến trình. ĐO ĐƯỢC 431,6 MiB trong tiến trình sạch 2026-08-04.' },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", wired: true, note: 'ĐIỂM GỌI 2/15 — owner "gguf:<modelId>", gguf-model, interactive. ⚠ Pha 2B Task 3: đây nay là ĐƯỜNG DỰ PHÒNG (chạy KHI VÀ CHỈ KHI `vram/vramLoadOutcome` không nạp được). Đường CHÍNH mở giấy phép ở vramLoadOutcome.ts, một giấy phép cho MỖI lượt thử của §5.5. Cả hai đường đều bao quanh llama.loadModel() và model.createContext().' },
  { file: "server/services/vram/vramLoadOutcome.ts", symbol: "beginVram(", wired: true, note: 'ĐIỂM GỌI 15/15 (Pha 2B Task 3) — MỘT giấy phép cho MỖI lượt thử của §5.5 (lượt đầu · 2 lượt thử lại · lượt hạ số lớp). Lượt hỏng TRẢ CHỖ ngay tại chỗ hỏng (finally), nên chỉ giấy phép của lượt THẮNG còn mở và nó được giao lại cho loadGgufModel() để commitMeasured(). owner/kind/priority do điểm gọi truyền — hôm nay chỉ có "gguf:<modelId>"/gguf-model/interactive.' },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", wired: true, note: ':1041 ĐIỂM GỌI 3/14 — owner "gguf-ctx:<modelId>", gguf-context, interactive. Bao quanh createContext() LƯỜI ở :1046.' },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", wired: true, note: ':2824 ĐIỂM GỌI 4/14 — owner "gguf-embed-ctx:<modelId>", gguf-embed-context, background. Bao quanh createEmbeddingContext() ở :2830.' },
  { file: "server/services/aiInferenceEngine.ts", symbol: "beginVram(", wired: true, note: ':213 ĐIỂM GỌI 5/14 — owner "onnx:<code>", onnx-session, production, releaseProof "unverified". EP = DirectML vì ENABLE_GPU=true.' },
  { file: "server/services/aiImageEmbedding.ts", symbol: "beginVramAllocation(", wired: true, note: ':506 ĐIỂM GỌI 6/14 — owner "onnx-img:<code>", onnx-session, production, releaseProof "unverified".' },
  { file: "server/services/ai/ocrService.ts", symbol: "beginVramAllocation(", wired: true, note: ':328 ĐIỂM GỌI 7/14 — owner "onnx-ocr:<modelPath>", onnx-session, production.' },
  { file: "server/services/aiReranker.ts", symbol: "beginVramAllocation(", wired: true, note: ':393 ĐIỂM GỌI 8/14 — owner "cuda-backend:reranker", gguf-backend, background. getLlama() THỨ HAI của tiến trình (thể hiện Llama RIÊNG). fallbackBytes theo RAG_RERANKER_GPU (=false ⇒ 0).' },
  { file: "server/services/aiReranker.ts", symbol: "beginVramAllocation(", wired: true, note: ':468 ĐIỂM GỌI 9/14 — owner "reranker:<modelPath>", gguf-model, background. Cửa sổ bao CẢ loadModel(:480) LẪN createRankingContext(:486); commitMeasured() ở :488.' },
  { file: "server/services/llamaVisionSidecar.ts", symbol: "beginVramAllocation(", wired: true, note: ':255 ĐIỂM GỌI 10/14 — owner "sidecar:vision", external-process, interactive, releaseProof "process-exit". HỘ LỚN NHẤT HỆ (7,8 GB, Đợt 0).' },
  { file: "server/services/kbSyncScheduler.ts", symbol: "beginVramAllocation(", wired: true, note: ':264 ĐIỂM GỌI 11/14 — owner "cron:kb-eval-gate", external-process, releaseProof "process-exit", ttl 10 phút. CỐ Ý không commitMeasured().' },
  { file: "server/services/kbSyncScheduler.ts", symbol: "beginVramAllocation(", wired: true, note: ':482 ĐIỂM GỌI 12/14 — owner "cron:kb-sync", ttl 30 phút. ⚠ KHÔNG khai releaseProof ⇒ mặc định "device-disposed", SAI ngữ nghĩa (nó nhả ở nhánh exit/error của tiến trình con). Ước lượng 1251 MiB; ĐO ĐƯỢC đỉnh 1.367,7 MiB.' },
  { file: "server/services/localSidecarTrainer.ts", symbol: "beginVramAllocation(", wired: true, note: ':353 ĐIỂM GỌI 13/14 — owner "sidecar:local-trainer", external-process, releaseProof "process-exit", ttl 2 GIỜ. CỐ Ý không commitMeasured().' },
  { file: "server/services/aiLlmFinetuneSidecar.ts", symbol: "beginVramAllocation(", wired: true, note: ':466 ĐIỂM GỌI 14/14 — owner "sidecar:llm-finetune", external-process, releaseProof "process-exit", ttl 4 GIỜ (trần lớn nhất hệ).' },

  // ═════════════════════════════════════════════════════════════════════════════════════════
  // B. server/ — lượt cấp phát THẬT nằm TRONG cửa sổ giấy phép
  // ═════════════════════════════════════════════════════════════════════════════════════════
  { file: "server/services/aiGgufEngine.ts", symbol: "getLlama(", wired: true, note: ":338 KHAI BÁO hàm nội bộ `getLlama()`. Lượt khởi tạo backend THẬT (initLlama của node-llama-cpp) ở :376, BÊN TRONG cửa sổ giấy phép :399." },
  { file: "server/services/aiGgufEngine.ts", symbol: "getLlama(", wired: true, note: ":841 lời gọi trong loadGgufModel(). Lượt thứ hai trở đi trả thể hiện đã cache (:339) ⇒ không cấp phát thêm; giấy phép :399 chỉ mở đúng một lần cho cả tiến trình." },
  { file: "server/services/aiGgufEngine.ts", symbol: ".loadModel(", wired: true, note: "llama.loadModel({gpuLayers: plan.gpuLayers}) — callback `load` truyền cho loadWithVramOutcomes(). MỘT dòng mã, CHẠY TỚI 4 LƯỢT (lượt đầu · 2 lượt thử lại · lượt hạ số lớp), mỗi lượt trong một cửa sổ giấy phép RIÊNG do vramLoadOutcome mở. ⚠ Pha 2B Task 3: bản trước có HAI dòng (:861 'max' + :888 'auto') vì đường lùi được viết tay tại chỗ." },
  { file: "server/services/aiGgufEngine.ts", symbol: ".loadModel(", wired: true, note: "llama.loadModel() của ĐƯỜNG DỰ PHÒNG (nhánh `else` khi vram/vramLoadOutcome không nạp được). Một lượt, không thử lại, không hạ số lớp — nhưng vẫn trong cửa sổ giấy phép của beginVram() ngay trên, và vẫn CHẶN gpuLayers âm." },
  { file: "server/services/aiGgufEngine.ts", symbol: ".createContext(", wired: true, note: ":904 context thường tạo NGAY trong loadGgufModel() (bỏ qua khi embeddingOnly). Trong cửa sổ :851 ⇒ actualBytes của `gguf:*` gồm CẢ trọng số LẪN context này." },
  { file: "server/services/aiGgufEngine.ts", symbol: ".createContext(", wired: true, note: ":1046 context LƯỜI của ensureTextContext(), trong cửa sổ giấy phép :1041." },
  { file: "server/services/aiGgufEngine.ts", symbol: ".createEmbeddingContext(", wired: true, note: ":2830, trong cửa sổ :2824. contextSize = EMBED_CTX (:288, chốt theo GGUF_EMBED_CTX/GGUF_MAX_CTX) — KHÔNG phải 'auto', nên kích thước KHÔNG phụ thuộc dư địa lúc gọi." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "InferenceSession.create(", wired: true, note: ":224, trong cửa sổ giấy phép :213. EP từ getExecutionProviders() (:157) — ENABLE_GPU=true ⇒ DirectML ⇒ CÓ chiếm VRAM." },
  { file: "server/services/aiImageEmbedding.ts", symbol: "InferenceSession.create(", wired: true, note: ":521, trong cửa sổ :506. ⚠⚠ EP Ở ĐÂY KHÁC hai hộ ONNX kia: :493-495 CHỈ đẩy 'cuda' khi ENABLE_CUDA==='true', KHÔNG gọi getExecutionProviders() và KHÔNG BAO GIỜ đẩy 'dml'. .env hôm nay có ENABLE_GPU=true nhưng KHÔNG có ENABLE_CUDA ⇒ hộ này chạy CPU, 0 byte, trong khi onnx:* và onnx-ocr:* chạy DirectML. Đổi đúng MỘT cờ là nó thành hộ thật — docstring :439 đã cảnh báo." },
  { file: "server/services/ai/ocrService.ts", symbol: "InferenceSession.create(", wired: true, note: ":337, trong cửa sổ :328. CHỈ model `rec` được nạp (:388) — không có session `det` nào trong repo hôm nay." },
  { file: "server/services/aiReranker.ts", symbol: "getLlama(", wired: true, note: ":417, trong cửa sổ giấy phép :393 (đóng ngay ở :448 TRƯỚC khi mở cửa sổ model — cố ý, để hai cửa sổ không chồng nhau)." },
  { file: "server/services/aiReranker.ts", symbol: ".loadModel(", wired: true, note: 'trong cửa sổ giấy phép ngay trên. ⚠⚠ Pha 2B Task 3 (I-3): `gpuLayers` từng là `useGpu ? -1 : 0` — và `-1` KHÔNG nghĩa "tất cả các lớp", nó nghĩa **0 LỚP** (Math.max(0, Math.min(totalLayers, -1))). ĐO TRÊN PHẦN CỨNG THẬT với đúng file bge-reranker-v2-m3-Q8_0.gguf: model.gpuLayers === 0 trong khi totalLayers === 25 ⇒ reranker chạy CPU trong IM LẶNG ngay khi ai đó bật RAG_RERANKER_GPU=true. Nay là `useGpu ? "auto" : 0`. RAG_RERANKER_GPU=false trong .env ⇒ vẫn 0 byte VRAM hôm nay.' },
  { file: "server/services/aiReranker.ts", symbol: ".createRankingContext(", wired: true, note: ':486 ⚠⚠ contextSize:"auto" — ĐIỂM "auto" THỨ HAI, và là điểm DUY NHẤT nằm trong MÃ SẢN XUẤT (I-1 review vòng 1; bản trước của tôi khẳng định chỉ có một, ở scripts/ — SAI). Mở khoá bằng RAG_RERANKER_GPU=true. ⚠ "ĐÃ NỐI" KHÔNG cứu được lớp này: giấy phép ĐO SAU khi cấp phát xong, còn cưỡng chế phải quyết định TRƯỚC — không có con số nào để từ chối dựa vào.' },
  { file: "server/services/llamaVisionSidecar.ts", symbol: "child_process", wired: true, note: ":30 import spawn — tiến trình con là llama-server CUDA, nằm trong giấy phép :255." },
  { file: "server/services/llamaVisionSidecar.ts", symbol: "spawn(", wired: true, note: ":283 spawn(LLAMA_SERVER_BIN, ['-ngl', GPU_LAYERS, …]). .env: LLAMA_SERVER_BIN=D:/SOURCES/16.AI/llama-cuda/llama-server.exe, LLAMA_VISION_GPU_LAYERS=999. Trong cửa sổ :255." },
  { file: "server/services/kbSyncScheduler.ts", symbol: "child_process", wired: true, note: ":63 import spawn — hai lượt spawn của file này đều nằm trong giấy phép (:264 / :482)." },
  { file: "server/services/kbSyncScheduler.ts", symbol: "spawn(", wired: true, note: ":291 spawn(node, [eval-rag.mjs, '--ci']) — trong cửa sổ giấy phép :264." },
  { file: "server/services/kbSyncScheduler.ts", symbol: "spawn(", wired: true, note: ":505 spawn('npm', ['run','kb:sync']) — trong cửa sổ :482. Kẻ cấp phát THẬT là tiến trình CHÁU (npm → node embed-incremental.mjs → _gguf-embed.mjs), nên phạm vi đo BẮT BUỘC cộng theo CÂY." },
  { file: "server/services/localSidecarTrainer.ts", symbol: "child_process", wired: true, note: ":29 import spawn — tiến trình huấn luyện nằm trong giấy phép :353." },
  { file: "server/services/localSidecarTrainer.ts", symbol: "spawn(", wired: true, note: "★★ :298 spawn(LOCAL_TRAINER_CMD) — `.env:259` ĐANG BẬT (KHÔNG bị chú thích): `python tools/trainer/train.py` = PyTorch + ultralytics YOLO trên CUDA. Giấy phép :353 KHÔNG truyền filePath/fileBytes/configDefaultBytes ⇒ ước lượng 0, và CỐ Ý không commitMeasured() ⇒ sổ KHÔNG BAO GIỜ có số cho hộ này, ttl 2 GIỜ. Activation + optimizer state không suy được từ kích thước file. Có thể LỚN HƠN sidecar thị giác 7,8 GB, và Pha 2A không có một điểm đo nào cho nó — xem mục 6 ở khối cuối file." },
  { file: "server/services/aiLlmFinetuneSidecar.ts", symbol: "child_process", wired: true, note: ":92 import spawn — tiến trình fine-tune nằm trong giấy phép :466." },
  { file: "server/services/aiLlmFinetuneSidecar.ts", symbol: "spawn(", wired: true, note: ":425 spawn(LLM_FINETUNE_CMD) — CHƯA đặt trong .env ⇒ đường này bất động hôm nay. Trong cửa sổ :466." },

  // ───── N-1: lượt NẠP THƯ VIỆN GPU (lớp bắt alias). Xem MODULE_PATTERNS trong file test. ─────
  { file: "server/services/aiGgufEngine.ts", symbol: "import node-llama-cpp", wired: true, note: ":376 lượt nạp thư viện DUY NHẤT thật sự khởi tạo backend CUDA — nằm trong cửa sổ giấy phép :399." },
  { file: "server/services/aiGgufEngine.ts", symbol: "import node-llama-cpp", wired: true, note: ":1619 nạp LlamaChatSession cho generateText(). KHÔNG cấp phát trọng số — nhưng ĐÂY là loại điểm KÍCH HOẠT bộ đệm tính toán lười (xem khối cuối file): byte lên SAU commitMeasured()." },
  { file: "server/services/aiGgufEngine.ts", symbol: "import node-llama-cpp", wired: true, note: ":1702 nạp LlamaChatSession cho chatCompletion() — cùng lớp kích hoạt bộ đệm lười như :1619." },
  { file: "server/services/aiGgufEngine.ts", symbol: "import node-llama-cpp", wired: true, note: ":1797 nạp LlamaJsonSchemaGrammar + LlamaChatSession cho generateJSON(). Grammar dựng trên CPU." },
  { file: "server/services/aiGgufEngine.ts", symbol: "import node-llama-cpp", wired: true, note: ":2035 nạp LlamaCompletion cho generateFimNative() — đường FIM, cùng lớp kích hoạt bộ đệm lười." },
  { file: "server/services/aiGgufEngine.ts", symbol: "import node-llama-cpp", wired: true, note: ":2231 nạp LlamaChatSession cho generateTextStream() — cùng lớp kích hoạt bộ đệm lười." },
  { file: "server/services/aiGgufEngine.ts", symbol: "import node-llama-cpp", wired: true, note: ":2361 nạp LlamaChatSession cho chatCompletionStream() — cùng lớp kích hoạt bộ đệm lười." },
  { file: "server/services/aiGgufEngine.ts", symbol: "import node-llama-cpp", wired: true, note: ":2628 isGgufAvailable() — chỉ THỬ nạp module để trả true/false, không chạm GPU." },
  { file: "server/services/aiReranker.ts", symbol: "import node-llama-cpp", wired: true, note: ":382 nạp getLlama/LlamaLogLevel cho backend RIÊNG của reranker — trong cửa sổ giấy phép :393." },
  { file: "server/services/ai/ocrService.ts", symbol: "import onnxruntime-node", wired: true, note: ":308 nạp ort trong getOnnxSession() — lượt tạo session ở :337 nằm trong cửa sổ giấy phép :328." },
  { file: "server/services/ai/ocrService.ts", symbol: "import onnxruntime-node", wired: true, note: ":387 nạp ort trong recognizeSingleLine() CHỈ để dựng ort.Tensor — không tạo session, không cấp phát." },
  { file: "server/services/aiImageEmbedding.ts", symbol: "import onnxruntime-node", wired: true, note: ":1 import tĩnh — session ở :521 nằm trong cửa sổ giấy phép :506 (EP là CPU hôm nay, xem dòng :521)." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "import onnxruntime-node", wired: true, note: ":1 import tĩnh — session ở :224 nằm trong cửa sổ giấy phép :213 (EP DirectML)." },

  // ═════════════════════════════════════════════════════════════════════════════════════════
  // C. server/ — CHƯA NỐI. Phần Pha 2B phải quyết định.
  // ═════════════════════════════════════════════════════════════════════════════════════════
  { file: "server/services/kbVideoTranscriber.ts", symbol: "child_process", wired: false, note: '★★ :55 import execFile → promisify → execFileAsync(:212) chạy WHISPER.CPP (:361) và ffmpeg (:337). KHÔNG giấy phép nào. Một bản whisper.cpp dựng với CUDA là hộ tiêu thụ THẬT. VIDEO_INGEST_ENABLED=true trong .env nhưng WHISPER_BIN còn bị chú thích ⇒ bất động HÔM NAY. ffmpeg KHÔNG có -hwaccel ⇒ giải mã CPU. ⚠ File này CHỈ xuất hiện được nhờ mẫu MODULE: mọi lời gọi đi qua alias promisify nên không mẫu tên-hàm nào bắt được (đây chính là lỗ C-1).' },
  { file: "server/services/kbPdfOcr.ts", symbol: "child_process", wired: false, note: ":48 import execFile → promisify → runPdftoppm(:181) chạy pdftoppm/poppler. Kết xuất ảnh CPU, KHÔNG chạm GPU. (Ảnh sau đó đi vào ocrService — hộ ĐÃ NỐI.) PDFTOPPM_BIN chưa đặt trong .env." },
  { file: "server/services/aiLocalTraining.ts", symbol: "InferenceSession.create(", wired: false, note: ":130 trainClassifierHead() — executionProviders GHIM CỨNG ['cpu'] ⇒ 0 byte VRAM. KHÔNG nối là ĐÚNG. ⚠ Đổi một chữ 'cpu' thành 'dml'/'cuda' là sinh một hộ VÔ HÌNH — bốn dòng này ở đây để lượt đổi đó không im lặng." },
  { file: "server/services/aiLocalTraining.ts", symbol: "InferenceSession.create(", wired: false, note: ":387 trainFewShot() — executionProviders ['cpu']. Cùng lý do như :130." },
  { file: "server/services/aiLocalTraining.ts", symbol: "InferenceSession.create(", wired: false, note: ":564 trainIncremental() — executionProviders ['cpu']. Cùng lý do như :130." },
  { file: "server/services/aiLocalTraining.ts", symbol: "InferenceSession.create(", wired: false, note: ":882 classifyWithHead() — executionProviders ['cpu']. ⚠ File này có NĂM lời gọi session.release() (:332, :504, :765, :889, :954) ⇒ câu ở vramWiring.ts:49 TỪNG viết 'grep toàn repo: KHÔNG một .release() nào lên ort.InferenceSession' và SAI NHƯ VẬY; I-2 (review TOÀN NHÁNH) đã sửa TẠI CHỖ ở CẢ HAI file (vramWiring.ts:49 và aiInferenceEngine.ts:96) thành 'không session CÓ KHẢ NĂNG GPU nào được release' — đính chính không còn nằm riêng ở dòng này. Kết luận releaseProof='unverified' KHÔNG đổi." },
  { file: "server/services/aiLocalTraining.ts", symbol: "import onnxruntime-node", wired: false, note: ":11 import tĩnh — BỐN session của file này đều ghim EP ['cpu'] ⇒ 0 byte VRAM. Dòng này là chỗ lượt đổi 'cpu'→'dml' sẽ đi qua." },

  // ───── N-2: `server/license/sdk/index.cjs` — BẰNG CHỨNG SỐNG của hình dạng né tránh ─────
  // 1.543 dòng, nằm ngay trong `server/`, và CHƯA TỪNG được quét cho tới lượt vá này (`.cjs`
  // không có trong SCAN_EXTS). Nó né được CẢ HAI lớp mẫu: specifier bị cắt đôi
  // (`require('child_pr' + f(…))`) nên mẫu dạng-nhập vô dụng, và tên hàm nằm trong CHUỖI
  // (`child_process_1['execSync'](…)`) nên mẫu lời gọi vô dụng. Chỉ hiện ra nhờ mẫu ĐỊNH DANH
  // bỏ `\b` đuôi. HÔM NAY: `wmic` / `dmidecode` / `sysctl` lấy vân tay phần cứng cho license —
  // CPU, KHÔNG phải hộ VRAM. Giữ TÁM dòng (không gộp) đúng theo kỷ luật một-dòng-một-lần-xuất-hiện.
  { file: "server/license/sdk/index.cjs", symbol: "child_process", wired: false, note: ":63 `child_process_1 = require('child_pr' + …)` — lượt NẠP bị làm rối, specifier cắt đôi. Đây là dòng làm mọi mẫu dạng-nhập vô dụng." },
  { file: "server/license/sdk/index.cjs", symbol: "child_process", wired: false, note: ":113 `child_process_1[…]('wmic cpu …')` — đọc định danh CPU cho vân tay license. KHÔNG chạm GPU." },
  { file: "server/license/sdk/index.cjs", symbol: "child_process", wired: false, note: ":117 `child_process_1[…]('… model …')` — nhánh đọc định danh CPU trên Linux. KHÔNG chạm GPU." },
  { file: "server/license/sdk/index.cjs", symbol: "child_process", wired: false, note: ":128 `child_process_1['execSync']('sysctl -…')` — nhánh macOS. Tên hàm nằm TRONG CHUỖI ⇒ mẫu lời gọi không thấy." },
  { file: "server/license/sdk/index.cjs", symbol: "child_process", wired: false, note: ":177 `child_process_1['execSync']('wmic diskdrive … serialnumber')` — số sê-ri ổ đĩa. KHÔNG chạm GPU." },
  { file: "server/license/sdk/index.cjs", symbol: "child_process", wired: false, note: ":181 `child_process_1['execSync'](… SERIAL …)` — nhánh Linux đọc sê-ri ổ đĩa. KHÔNG chạm GPU." },
  { file: "server/license/sdk/index.cjs", symbol: "child_process", wired: false, note: ":213 `child_process_1['execSync']('wmic baseboard … serialnumber')` — sê-ri bo mạch. KHÔNG chạm GPU." },
  { file: "server/license/sdk/index.cjs", symbol: "child_process", wired: false, note: ":217 `child_process_1[…]('dmidecode -s baseboard-serial…')` — nhánh Linux. KHÔNG chạm GPU." },

  { file: "server/services/plugins/sidecar/nodeSpawner.ts", symbol: "child_process", wired: false, note: ":9 import spawn — cổng vào của mọi plugin sidecar. Lệnh do plugin khai, KHÔNG giấy phép nào." },
  { file: "server/services/plugins/sidecar/nodeSpawner.ts", symbol: "spawn(", wired: false, note: ":42 createSupervisedTransportSpawner() — spawn LỆNH TUỲ Ý (PLUGIN_SIDECAR_CMD / manifest). Cổng PLUGIN_SIDECAR mặc định OFF và KHÔNG đặt trong .env ⇒ bất động. ⚠ Pha 2B: một plugin GPU nạp qua đường này là hộ mà sổ KHÔNG THỂ biết trước kích thước." },
  { file: "server/services/plugins/sidecar/nodeSpawner.ts", symbol: "spawn(", wired: false, note: ":47 spawnSidecarWithTransport() — cùng lớp với :42, dùng bởi pluginConformance." },
  { file: "server/services/plugins/sidecar/nodeSpawner.ts", symbol: "spawn(", wired: false, note: ":65 createNodeSpawner() — cùng lớp với :42, dùng bởi pluginSidecarBootstrap lúc boot." },
  { file: "server/services/plugins/sidecar/pluginSupervisor.ts", symbol: "spawn(", wired: false, note: ":110 this.deps.spawn(...) — gọi THÀNH VIÊN qua injected dependency. ⚠ Dòng này VÔ HÌNH với bản quét đầu tiên (lỗ C-1 #1) và chỉ hiện ra sau khi mẫu `spawn(` bỏ ràng buộc `(?<![.\\w])`." },
  { file: "server/services/apsSolver.ts", symbol: "child_process", wired: false, note: ":15 import spawn — solver CP-SAT/OR-Tools, xem :276." },
  { file: "server/services/apsSolver.ts", symbol: "spawn(", wired: false, note: ":276 runApsSolver() → APS_SOLVER_CMD, mặc định .venv python + scripts/aps_solver.py (CP-SAT). Solver tổ hợp CHẠY CPU — KHÔNG phải hộ VRAM. Ở đây để bắt buộc phân loại." },
  { file: "server/services/backupService.ts", symbol: "child_process", wired: false, note: ":10 import spawn/execFile — pg_dump và psql, KHÔNG chạm GPU." },
  { file: "server/services/backupService.ts", symbol: "execFile(", wired: false, note: ":370 execFile(pgDump, ['--version']) — kiểm phiên bản, KHÔNG chạm GPU." },
  { file: "server/services/backupService.ts", symbol: "spawn(", wired: false, note: ":397 spawn(pg_dump) — sao lưu CSDL, KHÔNG chạm GPU." },
  { file: "server/services/backupService.ts", symbol: "spawn(", wired: false, note: ":578 spawn(psql) — phục hồi CSDL, KHÔNG chạm GPU." },
  { file: "server/services/backupReplicationService.ts", symbol: "child_process", wired: false, note: ":1 import spawn — đẩy bản sao lên S3, KHÔNG chạm GPU." },
  { file: "server/services/backupReplicationService.ts", symbol: "spawn(", wired: false, note: ":87 spawn('aws', …) — sao chép đối tượng, KHÔNG chạm GPU." },
  { file: "server/services/aiGgufEngine.ts", symbol: "child_process", wired: false, note: ":476 execFile('nvidia-smi', ['--query-gpu=memory.used,…']) qua promisify — ĐỌC VRAM, không cấp phát. Bản đồng bộ của chính lời gọi này từng làm đóng băng xử lý request (xem chú thích :474)." },
  { file: "server/services/vram/vramProbe.ts", symbol: "child_process", wired: false, note: ":92 execFile('nvidia-smi') qua promisify — đầu dò TOÀN THIẾT BỊ, đọc chứ không cấp phát." },
  { file: "server/services/vram/vramProcessProbe.ts", symbol: "child_process", wired: false, note: ":1 import execFile — đầu dò THEO TIẾN TRÌNH (PDH), đọc chứ không cấp phát." },
  { file: "server/services/vram/vramProcessProbe.ts", symbol: "execFile(", wired: false, note: ":309 execFile('powershell.exe', …) đọc bộ đếm \\GPU Process Memory. ~1,5 s mỗi lượt; KHÔNG cấp phát VRAM. (M-1 review TOÀN NHÁNH — số cũ `:151` đã mục vì Task 6 sửa file này SAU Task 5.)" },
  { file: "server/services/vram/vramGpuHolders.ts", symbol: "child_process", wired: false, note: "Pha 2B Task 1 — :1 import execFile. Đầu dò DANH TÍNH (ai đang giữ GPU), đọc chứ không cấp phát." },
  { file: "server/services/vram/vramGpuHolders.ts", symbol: "execFile(", wired: false, note: "Pha 2B Task 1 — MỘT lời gọi `execFile` dùng chung cho `nvidia-smi --query-compute-apps` (~70 ms) và `powershell.exe` Win32_Process (~200 ms, CHỈ khi có ứng viên mồ côi). Trả về AI đang giữ GPU, KHÔNG trả về BAO NHIÊU (`used_memory = [N/A]` trên WDDM) ⇒ đủ để TỪ CHỐI chốt nền, KHÔNG đủ để TRỪ. Không cấp phát VRAM." },

  // ───── I-1 (review TOÀN NHÁNH): MÁY DUYỆT HEADLESS — thư viện GPU THỨ TƯ, vô hình cho tới nay ─────
  { file: "server/services/reportGenerator.ts", symbol: "import puppeteer", wired: false, note: '★★ :382 `await import("puppeteer")` trong generateNGVisualPDF(). `puppeteer` là **dependency SẢN XUẤT** (package.json:164). Đây là hộ ĐẦU TIÊN có điểm cấp phát trong `server/` mà bảng bỏ sót HOÀN TOÀN qua ba vòng nới mẫu — và nó lọt KHÔNG PHẢI vì né tránh, mà vì `MODULE_PATTERNS` liệt kê tay đúng ba thư viện. Xem khối I-1 ở `vramAllocationSites.test.ts`: đây là bằng chứng THỨ HAI (rẻ hơn `index.cjs`) cho kết luận "151/157 là cận DƯỚI".' },
  { file: "server/services/reportGenerator.ts", symbol: ".launch(", wired: false, note: '★★ :384 `puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox"] })` — **KHÔNG có `--disable-gpu`** ⇒ Chromium headless hiện đại khởi tạo một tiến trình GPU RIÊNG trên Windows+NVIDIA. KHÔNG giấy phép nào. BẤT ĐỘNG hôm nay: `generateNGVisualPDF` chỉ có một người gọi gián tiếp (`universalExportService.ts:717`) mà hàm đó không có người gọi nào — cùng mức bất động với `LLM_FINETUNE_CMD`/`WHISPER_BIN` vốn ĐANG được liệt kê. ⚠ Pha 2B: thêm `--disable-gpu` là cách rẻ nhất để hộ này thôi tồn tại; đó là ĐỔI HÀNH VI nên không thuộc Pha 2A.' },
  { file: "scripts/audit/p1-live-triad.mjs", symbol: ".launch(", wired: false, note: ":124 `chromium.launch({ headless: true })` (@playwright/test, :23) — KHÔNG `--disable-gpu`. Script audit chạy TAY, không có mục package.json, không tiến trình API nào spawn ⇒ không giấy phép nào phủ. Cùng lớp với (E3) trong khối vùng mù: VRAM do mã của CHÍNH sản phẩm sinh ra nhưng đang bị đếm vào 'nền desktop'." },
  { file: "scripts/audit/s5-net-probe.mjs", symbol: ".launch(", wired: false, note: ":8 `chromium.launch({ headless: true })` (@playwright/test, :2) — cùng lớp với p1-live-triad.mjs, chạy tay." },
  { file: "scripts/audit/s5-poc.mjs", symbol: ".launch(", wired: false, note: ":25 `chromium.launch({ headless: true })` (@playwright/test, :12) — cùng lớp với p1-live-triad.mjs, chạy tay." },
  { file: "scripts/audit/s6-pro-audit.mjs", symbol: ".launch(", wired: false, note: ":35 `chromium.launch({ headless: true })` (@playwright/test, :14) — cùng lớp với p1-live-triad.mjs, chạy tay." },

  // ═════════════════════════════════════════════════════════════════════════════════════════
  // D. scripts/ — CHẠY NGOÀI TIẾN TRÌNH API. Sổ cái là biến TRONG BỘ NHỚ của MỘT tiến trình,
  //    nên KHÔNG script nào được ghi vào sổ của tiến trình API, kể cả khi mã nó đi qua đúng
  //    `beginVramAllocation()`. Hai script được API SPAWN thì được phủ GIÁN TIẾP bằng giấy phép
  //    `external-process`; phần còn lại KHÔNG được phủ bởi bất cứ thứ gì.
  // ═════════════════════════════════════════════════════════════════════════════════════════
  { file: "scripts/ai-kb/_gguf-embed.mjs", symbol: "getLlama(", wired: true, note: ":73 — module nhúng DÙNG CHUNG. NĂM đường vào, chỉ HAI được giấy phép phủ: embed-incremental.mjs (trong chuỗi kb:sync ⇒ `cron:kb-sync`) và eval-rag.mjs --ci (⇒ `cron:kb-eval-gate`). BA đường chạy TAY KHÔNG được phủ: generate-embeddings.mjs (npm run kb:embed), backfill-image-embeddings.mjs, verify-embedding-cosine.mjs." },
  { file: "scripts/ai-kb/_gguf-embed.mjs", symbol: ".loadModel(", wired: true, note: ":75 gpuLayers -1. ⚠ `-1` đáng ngờ — aiGgufEngine.ts:864-865 ghi node-llama-cpp 3.x hiểu -1 là 0 lớp (CPU im lặng) và CẤM truyền -1. Nhưng ở ĐÂY nó VẪN LÊN GPU: đo trực tiếp trong cửa sổ cron THẬT 2026-08-04, tiến trình embed-incremental.mjs (pid 38492) giữ 1.167,7 → đỉnh 1.367,7 MiB. Số ĐO thắng." },
  { file: "scripts/ai-kb/_gguf-embed.mjs", symbol: ".createEmbeddingContext(", wired: true, note: ":87 contextSize = min(GGUF_EMBED_CTX, GGUF_MAX_CTX) — CÓ CHẶN TRÊN, cùng công thức với EMBED_CTX của aiGgufEngine." },
  { file: "scripts/ai-kb/eval-rag.mjs", symbol: "getLlama(", wired: true, note: ":211 gpu 'auto'. Chạy dưới `cron:kb-eval-gate` (kbSyncScheduler:291, cờ --ci) ⇒ wired gián tiếp. `npm run kb:eval` chạy tay thì KHÔNG." },
  { file: "scripts/ai-kb/eval-rag.mjs", symbol: ".loadModel(", wired: true, note: ":221 gpuLayers -1 — model rerank/sinh chữ, cộng thêm vào cùng tiến trình con với embedder." },
  { file: "scripts/ai-kb/eval-rag.mjs", symbol: ".createContext(", wired: true, note: ":222 contextSize { min: 2048, max: 8192 } — CÓ CHẶN TRÊN." },
  { file: "scripts/ai-kb/_gguf-embed.mjs", symbol: "import node-llama-cpp", wired: true, note: ":66 lượt nạp thư viện của module nhúng dùng chung — phủ CÓ ĐIỀU KIỆN (chỉ 2/5 đường vào đi qua giấy phép)." },
  { file: "scripts/ai-kb/eval-rag.mjs", symbol: "import node-llama-cpp", wired: true, note: ":210 lượt nạp thư viện — phủ CÓ ĐIỀU KIỆN, chỉ khi scheduler spawn với cờ --ci." },
  { file: "scripts/ai-kb/embed-programming.mjs", symbol: "import node-llama-cpp", wired: false, note: ":100 lượt nạp thư viện — script chỉ chạy TAY, không giấy phép nào phủ." },
  { file: "scripts/ai-bench/bench.mjs", symbol: "import node-llama-cpp", wired: false, note: ":279 importLlama() nạp thư viện cho lượt bench THẬT (có nạp model ở :618)." },
  { file: "scripts/ai-bench/bench.mjs", symbol: "import node-llama-cpp", wired: false, note: ":517 lượt nạp CHỈ để kiểm module có import được không — engine KHÔNG được khởi tạo ở đây." },
  { file: "scripts/ai-kb/reembed-images-onnx.mjs", symbol: "import onnxruntime-node", wired: false, note: ":40 import tĩnh — session ONNX ở :184 với EP động, chạy tay, không giấy phép." },
  { file: "scripts/check-tier3-env.mjs", symbol: "import onnxruntime-node", wired: false, note: ":149 require('onnxruntime-node') — script chẩn đoán, tạo cả session dml lẫn cuda ở dưới." },
  { file: "scripts/check-tier3-env.mjs", symbol: "import onnxruntime-node", wired: false, note: ":150 require('onnxruntime-node/package.json') — chỉ đọc số phiên bản, không nạp runtime." },
  { file: "scripts/validate-models.mjs", symbol: "import onnxruntime-node", wired: false, note: ":23 nạp ort để kiểm tính hợp lệ file model bằng EP ['cpu'] — không VRAM." },
  { file: "scripts/ai-kb/embed-programming.mjs", symbol: "getLlama(", wired: false, note: ":101 gpu 'auto'. KHÔNG có mục nào trong package.json và KHÔNG được server spawn ⇒ chỉ chạy TAY. Không giấy phép nào phủ." },
  { file: "scripts/ai-kb/embed-programming.mjs", symbol: ".loadModel(", wired: false, note: ":102 gpuLayers 'max' — nạp toàn bộ lên GPU." },
  { file: "scripts/ai-kb/embed-programming.mjs", symbol: ".createEmbeddingContext(", wired: false, note: ':103 ⚠⚠ contextSize:"auto" — KHÔNG CÓ CHẶN TRÊN. node-llama-cpp co giãn context theo VRAM CÒN TRỐNG lúc gọi. ĐO ĐƯỢC 2026-08-04 trên máy rảnh: cùng model 0,6B, "auto" chiếm 3.916,1 MiB so với 526,0 MiB khi chốt bằng EMBED_CTX (gấp 7,4 lần). Với Pha 2B đây là lớp NGUY HIỂM NHẤT: không có kích thước để ước lượng, và nó ăn ĐÚNG BẰNG dư địa broker vừa chừa ra.' },
  { file: "scripts/ai-kb/reembed-images-onnx.mjs", symbol: "InferenceSession.create(", wired: false, note: ":184 executionProviders động. Chỉ chạy TAY — không có mục package.json, không được server spawn." },
  { file: "scripts/ai-bench/bench.mjs", symbol: "getLlama(", wired: false, note: ":584 gpu theo cờ. `npm run ai:bench` — chỉ chạy TAY. Chính công cụ đo này từng MÙ ba lần (Đợt 0/1) nên nó phải nằm trong bảng." },
  { file: "scripts/ai-bench/bench.mjs", symbol: ".loadModel(", wired: false, note: ":618 gpuLayers 'max' khi bật GPU — nạp model thật để đo." },
  { file: "scripts/ai-bench/bench.mjs", symbol: ".createContext(", wired: false, note: ":329 context thường — bench cố ý tạo nó TRƯỚC context nhúng." },
  { file: "scripts/ai-bench/bench.mjs", symbol: ".createEmbeddingContext(", wired: false, note: ":420 context nhúng — thứ tự này tái hiện đúng bug hụt 2.030 MiB của Đợt 1 Task 2." },
  { file: "scripts/ai-bench/bench.mjs", symbol: "child_process", wired: false, note: ":82 import execFileSync — chạy nvidia-smi để đọc VRAM, không cấp phát." },
  { file: "scripts/ai-bench/bench.mjs", symbol: "execFileSync(", wired: false, note: ":231 execFileSync('nvidia-smi', …) — ĐỌC VRAM cho bảng bench, không cấp phát." },
  { file: "scripts/check-tier3-env.mjs", symbol: "InferenceSession.create(", wired: false, note: ":171 EP ['cpu'] — không VRAM. Script chẩn đoán môi trường, chạy tay." },
  { file: "scripts/check-tier3-env.mjs", symbol: "InferenceSession.create(", wired: false, note: ":181 EP ['dml'] — CÓ chiếm VRAM. Script chẩn đoán, chạy tay, không giấy phép." },
  { file: "scripts/check-tier3-env.mjs", symbol: "InferenceSession.create(", wired: false, note: ":193 EP ['cuda'] — CÓ chiếm VRAM nếu EP nạp được. Script chẩn đoán, chạy tay." },
  { file: "scripts/check-tier3-env.mjs", symbol: "child_process", wired: false, note: ":15 import spawnSync — dò nvidia-smi/driver, không cấp phát." },
  { file: "scripts/check-tier3-env.mjs", symbol: "spawnSync(", wired: false, note: ":36 spawnSync(cmd, args) — chạy công cụ chẩn đoán (nvidia-smi, nvcc), KHÔNG cấp phát VRAM." },
  { file: "scripts/validate-models.mjs", symbol: "InferenceSession.create(", wired: false, note: ":38 EP ['cpu'] — kiểm tính hợp lệ của file model, không VRAM." },
  { file: "scripts/ai-kb/run-phase1.mjs", symbol: "child_process", wired: false, note: ":1 import spawn — điều phối các bước kb (kb:phase1), chạy tay." },
  { file: "scripts/ai-kb/run-phase1.mjs", symbol: "spawn(", wired: false, note: ":14 spawn(step.cmd[0], …) — chạy TỪNG BƯỚC kb tuần tự. Bản thân không nạp model; các bước con thì CÓ (xem _gguf-embed.mjs). Chạy tay ⇒ không giấy phép." },
  { file: "scripts/ai-survey/vi-quality-ab.mjs", symbol: "child_process", wired: false, note: ":43 import execFileSync — công cụ khảo sát chất lượng tiếng Việt, chạy tay." },
  { file: "scripts/ai-survey/vi-quality-ab.mjs", symbol: "execFileSync(", wired: false, note: ":82 execFileSync(...) — script này import THẲNG aiGgufEngine.ts (:365) ⇒ chạy đúng mã ĐÃ NỐI nhưng trong tiến trình RIÊNG, tức SỔ RIÊNG. Cùng lớp với embed-space-probe.mjs." },
  { file: "scripts/ai-eval/eval-specialist.mjs", symbol: "child_process", wired: false, note: ":136 import execFileSync — chấm điểm agent chuyên gia, chạy tay." },
  { file: "scripts/ai-eval/eval-specialist.mjs", symbol: "execFileSync(", wired: false, note: ":145 execFileSync(node, …) — gọi lại chính repo qua CLI; model nạp trong tiến trình CON, ngoài mọi sổ." },
  { file: "scripts/ai-kb/check-kb-stale.mjs", symbol: "child_process", wired: false, note: ":39 import execSync — kiểm KB có cũ không, chỉ chạy git." },
  { file: "scripts/ai-kb/check-kb-stale.mjs", symbol: "execSync(", wired: false, note: ":63 execSync('git …') — đọc lịch sử git, KHÔNG chạm GPU." },
  { file: "scripts/ai-kb/install-git-hooks.mjs", symbol: "child_process", wired: false, note: ":18 import execSync — cài git hook, KHÔNG chạm GPU." },
  { file: "scripts/ai-kb/install-git-hooks.mjs", symbol: "execSync(", wired: false, note: ":30 execSync('git config …') — đọc cấu hình hook, KHÔNG chạm GPU." },
  { file: "scripts/ai-kb/install-git-hooks.mjs", symbol: "execSync(", wired: false, note: ":39 execSync('git rev-parse …') — tìm thư mục .git, KHÔNG chạm GPU." },
  { file: "scripts/build-offline-package.mjs", symbol: "child_process", wired: false, note: ":29 import execSync/spawnSync — đóng gói bản offline, KHÔNG chạm GPU." },
  { file: "scripts/build-offline-package.mjs", symbol: "execSync(", wired: false, note: ":82 execSync('npm run build') — dựng bản phát hành, KHÔNG chạm GPU." },
  { file: "scripts/build-offline-package.mjs", symbol: "execSync(", wired: false, note: ":164 execSync(npm install …) — cài phụ thuộc vào thư mục deploy, KHÔNG chạm GPU." },
  { file: "scripts/build-offline-package.mjs", symbol: "execSync(", wired: false, note: ":170 execSync(npm install …) — cài thêm gói tuỳ chọn, KHÔNG chạm GPU." },
  { file: "scripts/build-offline-package.mjs", symbol: "execSync(", wired: false, note: ":178 execSync('npm install onnxruntime-common …') — chỉ CÀI gói, không nạp model." },
  { file: "scripts/build-secure.mjs", symbol: "child_process", wired: false, note: ":23 import execSync — dựng bản có ký, KHÔNG chạm GPU." },
  { file: "scripts/build-secure.mjs", symbol: "execSync(", wired: false, note: ":51 execSync('npm run build') — dựng bản phát hành, KHÔNG chạm GPU." },
  { file: "scripts/build-secure.mjs", symbol: "execSync(", wired: false, note: ":125 execSync(...) — bước ký/băm artefact, KHÔNG chạm GPU." },
  { file: "scripts/pack-offline.mjs", symbol: "child_process", wired: false, note: ":21 import execSync — đóng gói offline (biến thể), KHÔNG chạm GPU." },
  { file: "scripts/pack-offline.mjs", symbol: "execSync(", wired: false, note: ":49 execSync('npm run build') — dựng bản phát hành, KHÔNG chạm GPU." },
  { file: "scripts/pack-offline.mjs", symbol: "execSync(", wired: false, note: ":140 execSync(npm …) — chuẩn bị thư mục staging, KHÔNG chạm GPU." },
  { file: "scripts/pack-offline.mjs", symbol: "execSync(", wired: false, note: ":149 execSync(npm …) — cài phụ thuộc trong staging, KHÔNG chạm GPU." },
  { file: "scripts/pack-offline.mjs", symbol: "execSync(", wired: false, note: ":462 execSync(...) — nén/đóng gói kết quả, KHÔNG chạm GPU." },
  { file: "scripts/contracts-compat-check.mjs", symbol: "child_process", wired: false, note: ":21 import execFileSync — cổng tương thích hợp đồng schema, KHÔNG chạm GPU." },
  { file: "scripts/contracts-compat-check.mjs", symbol: "execFileSync(", wired: false, note: ":78 execFileSync('git', …) — đọc bản schema cũ để so, KHÔNG chạm GPU." },
  { file: "scripts/setup-test-db.mjs", symbol: "child_process", wired: false, note: ":23 import execFileSync — dựng CSDL test, KHÔNG chạm GPU." },
  { file: "scripts/setup-test-db.mjs", symbol: "execFileSync(", wired: false, note: ":97 execFileSync(node, [migrate…]) — áp migration cho CSDL test, KHÔNG chạm GPU." },
  { file: "scripts/plugin-scaffold.mjs", symbol: "child_process", wired: false, note: ":22 import spawn — sinh khung plugin, KHÔNG chạm GPU." },
  { file: "scripts/plugin-scaffold.mjs", symbol: "spawn(", wired: false, note: ":199 spawn(sidecar.command, …) — chạy thử sidecar mẫu vừa sinh ra, KHÔNG chạm GPU." },
  { file: "scripts/sim/sim-devices.mjs", symbol: "child_process", wired: false, note: ":23 import spawn — trình mô phỏng thiết bị, KHÔNG chạm GPU." },
  { file: "scripts/sim/sim-devices.mjs", symbol: "spawn(", wired: false, note: ":99 spawn(cmd, nodeArgs) — sinh tiến trình mô phỏng máy, KHÔNG chạm GPU." },
  { file: "scripts/verify/worker-leader-proof.run.mjs", symbol: "child_process", wired: false, note: ":8 import spawn — kiểm chứng bầu leader, KHÔNG chạm GPU." },
  { file: "scripts/verify/worker-leader-proof.run.mjs", symbol: "spawn(", wired: false, note: ":15 spawn(node, [SCRIPT]) — chạy hai worker để chứng minh chỉ một thành leader, KHÔNG chạm GPU." },
];

/**
 * ★★★ HỘ TIÊU THỤ KHÔNG CÓ ĐIỂM CẤP PHÁT NÀO TRONG REPO — máy quét KHÔNG THỂ thấy chúng, nên
 * chúng phải được viết ra bằng tay. Bỏ chúng khỏi Pha 2B là lặp lại đúng lỗi Đợt 0.
 *
 * ⚠ TIÊU CHÍ (phải nhất quán, nếu không danh sách này thành tuỳ hứng): liệt kê mọi hộ CÓ THỂ
 * chiếm VRAM mà **không có dòng mã nào trong repo tạo ra nó**, kể cả khi hôm nay nó bất động vì
 * cấu hình. whisper.cpp KHÔNG còn ở đây vì nó CÓ điểm cấp phát (`kbVideoTranscriber.ts:361` →
 * `:212`) — nó chỉ từng vô hình vì máy quét thiếu `execFile`, và nay đã nằm trong bảng chính.
 *
 * 1. **Byte đến SAU khi cửa sổ đo đã đóng** — ĐO ĐƯỢC, và không nằm trong sổ.
 *
 *    QUAN SÁT (2026-08-04, tiến trình API): PDH self **2.223,7 MiB** so với Σ sổ **2.095,7 MiB**
 *    (431,6 `cuda-backend` + 1.138,0 `gguf:embed` + 526,0 `gguf-embed-ctx`) ⇒ **lệch 128,0 MiB**.
 *
 *    HAI CƠ CHẾ ỨNG VIÊN, chưa tách được:
 *      (a) **bộ đệm tính toán LƯỜI** — llama.cpp cấp phát compute buffer ở lượt SUY LUẬN ĐẦU
 *          TIÊN, tức SAU `commitMeasured()`. `aiGgufEngine.ts:915-919` đã ghi điều này cho
 *          `gguf-model` nhưng KHÔNG ai cộng nó. Đo trực tiếp: lượt nhúng đầu tiên **+132,0 MiB**.
 *      (b) **cửa sổ đo bị CẮT NGỌN** — đầu dò "sau" đọc trước khi lượt cấp phát lắng xong.
 *
 *    ⚠⚠ BA CHỖ BẢN TRƯỚC CỦA KHỐI NÀY TỰ CHỌI, đã sửa — đọc kỹ, vì Pha 2B thiết kế dựa vào đây:
 *
 *      • **"hai nguồn ĐỘC LẬP" là SAI.** Cả hai đều dùng chung số hạng 526 và đều phải GIẢ ĐỊNH
 *        hai lease kia (431,6 + 1.138,0) chính xác — mà điều đó **mâu thuẫn trực tiếp** với chính
 *        câu "mọi lease GGUF đều báo thiếu". Nếu lease model cũng thiếu X thì X + Y = 128 chứ
 *        không phải Y = 128. Nói đúng: **hai lượt đọc CÙNG PHỤ THUỘC một tập giả định**, chúng
 *        củng cố nhau chứ không xác nhận chéo nhau.
 *      • **"khoản thiếu KHÔNG phải hằng số" bị chính dữ liệu bác.** 128 MiB ở context 526 MiB so
 *        với 132 MiB ở context 3.916 MiB = lệch **3 %** qua một thay đổi **7,4 lần**, CÙNG một
 *        model. Đó là bằng chứng khoản thiếu **gần như ĐỘC LẬP với context** — khớp với vật lý
 *        compute buffer của llama.cpp. Vế "co giãn theo MODEL" thì **chưa có một điểm đo nào**.
 *        ⚠ Hệ quả: câu cũ đang đẩy Pha 2B **RỜI XA** phương án biên-cố-định-theo-`kind`, trong
 *        khi dữ liệu hiện có thật ra hơi **ỦNG HỘ** phương án đó.
 *      • **PHẠM VI: không được chốt.** Nếu cơ chế là (b) thì **mọi** lease dùng `commitMeasured()`
 *        đều báo thiếu — gồm `onnx:*` và bốn sidecar — chứ KHÔNG riêng GGUF. Bản trước để mở
 *        *cơ chế* nhưng lại chốt *phạm vi* ở "GGUF"; không được làm vậy khi cơ chế còn hai ứng viên.
 *
 *    ⚠ TRÍCH DẪN PHẢI GIỮ ĐỊNH NGỮ: `aiGgufEngine.ts:2801` viết **"4 lượt tuần tự = 654 MiB"**,
 *    KHÔNG phải "context nhúng thật là 654 MiB". Và cách đọc khiến phép trừ `654 − 526 = 128` có
 *    nghĩa **chính là ứng viên (a)** — nên nguồn đó **không trung lập** giữa (a) và (b), không
 *    được dùng nó làm trọng tài.
 *
 *    ⇒ HAI ĐIỀU **ĐÃ KIỂM BẰNG MÃ** và giữ nguyên: `vramReconciler` **chỉ PHÁT HIỆN lệch dương,
 *    KHÔNG bù sổ** (không một phép gán `actualBytes` nào trong `vramReconciler.ts`), và **chiều
 *    sai số đúng dấu** — `headroom = trần − Σ leaseBytes` bị **phóng đại**, tức nghiêng về
 *    **cho phép cấp phát khi thiết bị đã đầy**. Hộ 30B (~17-19 GB) **chưa từng quan sát được**.
 *
 * 2. **Tiến trình `worker` — VÀ tiến trình `edge`, tức BA sổ chứ không phải hai** (M-6, review
 *    TOÀN NHÁNH). Sổ cái là biến trong bộ nhớ của MỘT tiến trình.
 *      • `server/worker.ts` → `runWorkerProcess` (`ROLE=worker`);
 *      • **`server/edge/edgeGatewayMain.ts`** — `package.json` có `start:edge` (`node
 *        dist/edgeGatewayMain.js`) và `dev:edge`, và `build` esbuild-đóng-gói nó thành một
 *        artefact RIÊNG. Bản trước của mục này chỉ nói `worker` ⇒ đếm thiếu đúng một sổ.
 *    ⇒ mỗi sổ chỉ thấy phần của mình trên MỘT thiết bị. Pha 1 đã ghi nhận ("ROLE=api ⇒ sổ MỘT
 *    tiến trình trong khi hệ chạy NĂM"); vẫn CHƯA giải. Cùng lớp: `vi-quality-ab.mjs` /
 *    `embed-space-probe.mjs` import thẳng `aiGgufEngine.ts` ⇒ chạy đúng mã đã nối, trong tiến
 *    trình riêng, sổ riêng.
 *    ⚠ Cùng lớp, cấp độ triển khai: **`_deploy/avi-aoi-v1.0.0/`** là một BẢN SAO ĐẦY ĐỦ mang cùng
 *    `node-llama-cpp`/`onnxruntime-node`/`puppeteer` kèm `install-service.bat` (wrapper NSSM) ⇒
 *    chạy được như một DỊCH VỤ WINDOWS, song song với bản đang phát triển, với sổ riêng của nó.
 *    ⚠ Và: **backend Vulkan CŨNG được cài** (`node_modules/@node-llama-cpp/win-x64-vulkan` bên
 *    cạnh `win-x64-cuda`). Không đổi kết luận nào, nhưng "backend CUDA = 431,6 MiB" là hằng số
 *    ĐO ĐƯỢC CỦA MỘT BACKEND — đừng đem nó áp cho một tiến trình chạy backend khác.
 *
 * 3. **`llama-server` bền bỉ khởi động BẰNG TAY** — `LLAMA_SERVER_ENABLED` + runbook
 *    `scripts/ai/llama-server.md`. Thêm: `.env:660-661` có `LLAMA_CODER_PORT=8090` /
 *    `LLAMA_CODER_CTX` nhưng **không một dòng mã nào trong repo đọc `LLAMA_CODER_PORT`/
 *    `LLAMA_CODER_BIN`** — cấu hình cho một tiến trình mà mã không biết tới.
 *
 * 4. **`ollama serve`** — SÁU file đọc `OLLAMA_BASE_URL` (`aiImageEmbedding.ts`,
 *    `aiLocalKnowledgeService.ts`, `aiLocalTools/intentClassifier.ts`, và ba script
 *    `ai-kb/*embed*.mjs`). Đường HTTP tới một daemon GPU RIÊNG mà repo không spawn.
 *    Bất động hôm nay (`USE_LEGACY_OLLAMA` không bật) — **đúng bằng mức bất động của #3**, nên
 *    tiêu chí đòi nó phải có mặt.
 *
 * 5. **Nền desktop Windows** — 1.707,9 MiB lúc rảnh (dwm.exe 865,9 là khoản lớn nhất), đo
 *    2026-08-04. ⚠ Đây KHÔNG phải hằng số, và cũng không hoàn toàn "của người khác": nó chứa
 *    **client của chính sản phẩm này** (`client/**` nằm NGOÀI `SCAN_ROOTS` — một tab trình duyệt
 *    mở dashboard/`@react-three` twin 3D là VRAM của ta, do mã của ta, mà bảng này không quét).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * ★★ PHẠM TRÙ KHÁC — KHÔNG thuộc danh sách năm hộ ở trên, và KHÔNG được cộng vào
 * `CONSUMERS_WITHOUT_A_CODE_SITE`: hộ này **CÓ** điểm cấp phát và **ĐÃ NỐI** (nên nó nằm trong
 * bảng chính, dòng `localSidecarTrainer.ts` → `spawn(`). Vấn đề của nó là **sổ không có SỐ**,
 * chứ không phải sổ không biết nó tồn tại. Tách ra để tiêu chí của danh sách trên không bị nới.
 *
 * **`sidecar:local-trainer` ĐANG BẬT HÔM NAY, và giấy phép của nó KHÔNG CÓ CƠ SỞ ƯỚC LƯỢNG.**
 *    `.env:259 LOCAL_TRAINER_CMD=python tools/trainer/train.py` — không bị chú thích, khác hẳn
 *    `LLM_FINETUNE_CMD`/`WHISPER_BIN`. `tools/trainer/train.py` là PyTorch + (tuỳ chọn)
 *    ultralytics YOLO. Giấy phép ở `localSidecarTrainer.ts:353` KHÔNG truyền `filePath`,
 *    `fileBytes` hay `configDefaultBytes` ⇒ ước lượng **0**, và nó CỐ Ý không bao giờ
 *    `commitMeasured()` (`external-process`) ⇒ **sổ không bao giờ có một con số nào cho hộ này**,
 *    trong khi `ttlMs` = 2 GIỜ.
 *    ⚠ Trọng số chỉ là phần NHỎ: activation + optimizer state (Adam giữ 2 bản sao moment) mới là
 *    phần lớn, và chúng co giãn theo batch size / độ phân giải ảnh — **không suy được từ kích
 *    thước file model**. Đây là hộ có thể **lớn hơn** sidecar thị giác 7,8 GB của Đợt 0, và nó
 *    KHÔNG có một điểm đo nào trong toàn bộ Pha 2A. Cùng lớp đang ngủ: `tools/trainer/
 *    finetune_lora.py` (QLoRA 4-bit) qua `LLM_FINETUNE_CMD`.
 *    ⇒ Pha 2B **không được** coi `external-process` là "đã nối nên đã biết".
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ (E) VÙNG MÙ — bốn thứ mà câu "client/** và tools/** nằm ngoài SCAN_ROOTS" NGỤ Ý SAI rằng
 * bên trong đã phủ. Chúng nằm ở đây vì không có chúng thì bảng tự nhận rộng hơn sự thật.
 *
 *   (E1) **`.py` vô hình với máy quét — nhưng ĐO RỒI, sản lượng bằng KHÔNG.** Máy quét mù **theo
 *        NGÔN NGỮ** chứ không chỉ theo thư mục (mọi mẫu là cú pháp JS/TS), và `scripts/` có 13
 *        file Python. **Nhưng: 0/13 file có điểm cấp phát GPU** — đo bằng `torch|cuda|onnxruntime|
 *        ultralytics|tensorflow|cupy`, cả 13 đều trả **0**. Nội dung thật: 1 solver CP-SAT
 *        (`aps_solver.py`, đã phân loại đúng là CPU trong bảng), 1 mô phỏng MQTT, 1 migration,
 *        1 test websocket, **9 codemod dùng một lần**.
 *        ⚠ Bản trước đặt "13 file Python" cạnh câu "đúng những file dễ chạm CUDA nhất" — câu đó
 *        **phân bổ sai chú ý**: nó làm 13 file vô hại trông như 13 rủi ro.
 *        **Toàn bộ GPU-Python của repo = ĐÚNG HAI file, cả hai NGOÀI `SCAN_ROOTS`**:
 *        `tools/trainer/train.py` (5 lần chạm `cuda`; `:260`
 *        `use_cuda = torch.cuda.is_available() and device_req != "cpu"` ⇒ **mặc định là CUDA**)
 *        và `tools/trainer/finetune_lora.py` (3 lần). **Cả hai đã được gọi đích danh ở mục 6.**
 *        ⇒ QUYẾT ĐỊNH: **KHÔNG thêm vòng quét `.py`** — sản lượng đo được 0 dòng, chi phí là một
 *        bộ mẫu Python phải nuôi mãi mãi (đúng lớp lỗi đã hai lần bị từ chối). Thay bằng **dây
 *        bẫy 3 dòng** trong `vramAllocationSites.test.ts` ca 7c: hai file đó phải còn tồn tại và
 *        còn chứa `cuda`; mất một trong hai thì mục 6 đã cũ. (`.ps1` ×3 cùng lớp, cùng kết luận.)
 *   (E2) **`apps/` KHÔNG phải "gốc thứ ba" đáng quét — nói đúng độ lớn.** `apps/` có **4 file và
 *        0 file mã nguồn**: 2 `README.md`, 1 `Cargo.toml`, 1 `tauri.conf.json`
 *        (`apps/machine-shell`, vỏ desktop, `frontendDist` → `client/dist`). Nó nằm ngoài
 *        `SCAN_ROOTS` và ngoài câu tự khai cũ — nhưng gọi nó là "gốc thứ ba" như bản trước là
 *        **thổi phồng**: quét nó hôm nay trả về 0 dòng. VRAM thật của vỏ đó là VRAM của
 *        `client/dist` mà nó nạp, tức đã nằm ở (E3).
 *   (E3) **`client/**` bị lượng hoá quá nhẹ.** Kiểm 2026-08-04: **13 file** trong `client/src`
 *        chạm lớp WebGL/three (qua `<Canvas>` của `@react-three/fiber`; **0** lời gọi
 *        `new WebGLRenderer` trực tiếp — nên một máy quét tìm tên lớp đó sẽ báo "sạch" và sai).
 *        Thêm: Playwright chạy Chromium **không** `--disable-gpu`. VRAM này do **mã của chính
 *        sản phẩm** sinh ra nhưng đang bị đếm vào "nền".
 *   (E4) **`tools/machine-simulator/**` (.NET/C#) — ĐÃ QUÉT, gần như KHÔNG có đường cấp phát GPU:**
 *        zero hit cho `Process.Start`/SharpDX/Vortice/Silk.NET/D3D/WebView2/OnnxRuntime/CUDA, và
 *        không có web UI. Thứ duy nhất chạm GPU là **WPF** (MilCore hợp thành qua D3D9, cỡ vài
 *        chục MiB nền). Ghi ra đây vì nó là **phần mềm của chính sản phẩm đang bị đếm vào "nền
 *        desktop"** — cùng lớp lỗi với (E3), chỉ nhỏ hơn nhiều.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * ⚠ ĐÍNH CHÍNH một suy đoán dễ mắc: ba cron cùng nổ lúc 03:00 (`KB_AUTOSYNC_CRON`,
 * `ANOMALY_BANK_REBUILD_CRON`, `AI_SELF_LEARNING_CRON` — cả ba đều BẬT trong `.env`). ĐÃ KIỂM:
 * **chỉ `kbSyncScheduler` là đường GPU.** `aiAnomalyBankScheduler` đọc vector ĐÃ LƯU trong
 * `ai_image_embeddings` (docstring :4), `aiSelfLearningScheduler` thuần DB/thống kê.
 * "Ba cron 03:00" ≠ "ba hộ tiêu thụ 03:00".
 */
export const CONSUMERS_WITHOUT_A_CODE_SITE = 5 as const;
