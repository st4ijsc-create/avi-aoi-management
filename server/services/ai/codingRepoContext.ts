/**
 * ★★★ doc 79 · TRỤC 1 (D) — **NGỮ CẢNH MÃ THẬT CHO ĐƯỜNG SINH MÃ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LỖ ĐƯỢC ĐÓNG Ở ĐÂY — VÀ MỘT TIỀN ĐỀ SAI PHẢI ĐÍNH CHÍNH TRƯỚC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đường LẬP TRÌNH (`streamCodingGenerate`) trước lượt này **không gọi một lời truy hồi nào**. Toàn
 * bộ "hiểu biết về repo" mà model có khi sinh mã là `nguCanhDuAnChoPrompt()` = **tên dự án + ≤24
 * mục ở thư mục gốc**. Hỏi *"hệ thống này xác thực người dùng thế nào"* thì nó không tra gì cả —
 * nó viết một câu nghe-đúng về một hệ thống nó chưa từng nhìn.
 *
 * ⚠ TIỀN ĐỀ SAI (đã kiểm bằng mã, 2026-08-20): *"đường ống ĐÃ CÓ, `gatherRepoIndexContext` dùng
 *   chunk tóm tắt để TÌM tệp rồi đọc mã thật — việc chỉ là nối dây"*. **KHÔNG ĐÚNG.**
 *   `gatherRepoIndexContext()` gọi `gatherRepoContext({ objective, includeRag: true })` — **KHÔNG
 *   truyền `files`** ⇒ vòng `for (const raw of input.files ?? [])` chạy trên tập RỖNG ⇒ **không một
 *   byte tệp nào được đọc**. Thứ nó trả về là `ragSnippets`, tức **văn bản CHUNK TÓM TẮT**, mà một
 *   chunk router trong `knowledge/chunks.jsonl` trông đúng như thế này:
 *
 *       "Router file: server/routers/aiAdvancedRouter.ts
 *        Router names: aiAdvancedRouter
 *        Procedure calls: 44
 *        protectedProcedure usages: 27"
 *
 *   Đó là **MỤC LỤC**, không phải mã. Bước nhảy *mục lục → mã thật* **chưa từng tồn tại**. Module
 *   này LÀ bước nhảy ấy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÍNH CHÍNH 2026-08-20 — BẢN ĐẦU DỰNG XONG, LƯỚI 101/101 XANH, **VÀ KHÔNG CHẠY ĐƯỢC LIVE.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nghiệm thu live (đăng nhập thật, `/ai-coding-workspace`, dự án "Repo chính"): ba lượt liên tiếp
 * **không giao được một byte ngữ cảnh nào** — không thẻ "Đọc tệp trong repo", không chân nguồn, và
 * ở lượt đầu model **bịa** một lớp C# `UserAuthenticator` băm SHA-256 cho một repo TypeScript dùng
 * bcrypt. Không một dòng log lỗi. Nguyên nhân **KHÔNG** phải một lỗi lập trình: nó là **hình dạng
 * của kho tri thức**, và lưới cũ mù đúng chỗ ấy vì mọi ca đều dùng chunk giả tưởng "đẹp"
 * (`[["server/a.ts", 0.9]]`) — một hình dạng dữ liệu **không tồn tại** trong `chunks.jsonl`.
 *
 * ─── SỐ ĐO (đường sản phẩm đầy đủ: embed 0.6B + keyword + trọng số + rerank gguf, topK=8) ──────
 *   câu hỏi                                          │ điểm top-1 │ đoạn thuộc VÙNG MÃ
 *   ─────────────────────────────────────────────────┼────────────┼────────────────────
 *   "hệ thống này xác thực người dùng như thế nào?"  │   0,531    │ **0 / 8**
 *   "phân quyền RBAC trong repo này hoạt động ra sao?"│   0,590    │ **0 / 8**
 *   "luồng ingest ảnh AOI … đi qua những bước nào?"  │   0,794    │ **0 / 8**
 *
 * ⇒ **HAI cổng đóng độc lập**, mỗi cổng một mình đã đủ giết tính năng:
 *   (1) `laDuongDanMaNguon` — 0/8 sống ở CẢ BA câu hỏi;
 *   (2) `minScore = 0,60` — 2/3 câu hỏi có top-1 DƯỚI ngưỡng.
 *   Vì thế lượt 3 (hạ `AI_COPILOT_REPO_INDEX_MIN_SCORE` xuống 0,25) **vẫn** rỗng: nó chỉ mở cổng
 *   (2), còn (1) vẫn đóng kín.
 *
 * ⚠⚠ VÀ MỘT TIỀN ĐỀ NỮA BỊ BÁC BỎ: *"ngưỡng điểm là cổng lọc câu hỏi LẠC ĐỀ"*. **SAI.** Cùng phép
 *    đo, câu LẠC đề ghi 0,519–0,677 — **chồng lên** dải 0,531–0,794 của câu TRÚNG đề. Điểm không
 *    phân biệt được hai phân bố ấy, nên **không có con số nào** đặt vào `minScore` cứu được tính
 *    năng. Hạ ngưỡng là chữa sai bệnh.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA TẦNG — và vì sao tầng ba bắt buộc phải đi qua CỬA TOOL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **MỤC LỤC · PHA A — TRUY HỒI TRONG KHO MÃ.** `cheDoVungMa:"corpus"` thu hẹp kho xuống
 *      `server/ client/ shared/ drizzle/ scripts/` **TRƯỚC** khi xếp hạng. Đây là cách DUY NHẤT
 *      lấy được thứ hạng của tệp mã: lọc SAU khi xếp hạng toàn kho luôn cho 0, vì 4.312/7.582
 *      chunk là tài liệu tiếng Việt 1.500–1.800 ký tự còn chunk mã là tóm tắt tiếng Anh 114–166
 *      ký tự — một câu hỏi kiến trúc tiếng Việt không bao giờ thắng nổi phân bố ấy.
 *   2. **MỤC LỤC · PHA B — CẦU TÀI LIỆU → MÃ.** `cheDoVungMa:"tat"` lấy chunk BẤT KỲ (thường là
 *      tài liệu), rồi `motDuongDanMaTrongVanBan` mót các đường dẫn tệp mã được NGƯỜI viết nhắc
 *      trong đó. Một tín hiệu KHÁC HẲN pha A: *"tệp này liên quan tới CHỦ ĐỀ"* chứ không phải
 *      *"tóm tắt tệp này gần vector câu hỏi"*. **`block` và `text` của pha B bị VỨT** — không một
 *      byte văn bản tài liệu nào vào prompt sinh mã.
 *   3. **MÃ THẬT** — đọc từng đường dẫn qua `docTep`, một hàm do NGƯỜI GỌI tiêm vào và bắt buộc
 *      phải là `executeDecision({tool:"read_file"})`.
 *
 * ⚠ Hai pha XEN KẼ nhau (A1, B1, A2, B2…) chứ không nối đuôi: pha B trả **0** đường cho câu RBAC
 *   và pha A trả toàn tệp `aiLocalTools/**` cho cùng câu ấy — mỗi cây cầu hỏng ở một chỗ khác nhau,
 *   nên cho một cây cầu độc chiếm cả 3 ô là đặt cược vào đúng cái nó không làm được.
 *
 * ⚠⚠ **FILE NÀY KHÔNG NHẬP `fs` VÀ KHÔNG ĐƯỢC PHÉP NHẬP.** Cửa đọc đi qua `read_file` nghĩa là ta
 *    thừa hưởng NGUYÊN vẹn: `confineTargetUnder` (realpath, `nlink > 1`) → `readConfined` (hỏi
 *    `isFile`/`nlink`/`size` trên chính fd, chống TOCTOU) → `redactSecretsOnly` → trần byte mỗi
 *    tệp/mỗi phiên → RBAC `ai_repo_read/canView` → **gốc dự án đang chọn** (`__projectRoot` do
 *    `argsWithAuthCtx` tiêm). Mở một cửa `fs` thứ hai ở đây là dựng lại tất cả những thứ đó bằng
 *    trí nhớ — đúng lớp lỗi `programmingFileIo.census.test.ts` được lập ra để chặn.
 *    ⚠ Tiêm cửa đọc qua THAM SỐ (không `import`) cũng loại luôn một vòng nhập vòng tròn
 *      (`aiLocalTools` → … → `aiLocalKnowledgeService` → module này).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ TRỤC 2 (ĐA DỰ ÁN) — CHỖ SAI LẶNG NGUY HIỂM NHẤT CỦA TÍNH NĂNG NÀY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `knowledge/chunks.jsonl` mô tả **DUY NHẤT repo chính**. Đếm theo thư mục gốc của `sourcePath`:
 * `docs` 4.113 · `server` 2.298 · `knowledge` 525 · `client` 224 · `drizzle` 202 · `apidocs` 199 ·
 * `shared` 21 — và **0** chunk nào thuộc `sandbox-projects/**`.
 *
 * ⇒ Nếu người dùng đang mở **Demo Csharp** mà ta vẫn đi truy hồi, mục lục sẽ trả về đường dẫn của
 *   **repo chính**. Hai hậu quả, cả hai đều câm:
 *     • `read_file` với `__projectRoot` = gốc C# sẽ `NOT_FOUND` ⇒ tính năng im lặng không làm gì
 *       (tốn một lượt embed + rerank cho hư không); hoặc tệ hơn,
 *     • nếu về sau ai đó "sửa" bằng cách bỏ qua `projectRoot`, ta sẽ đọc mã của **dự án KHÁC** đưa
 *       vào prompt của dự án này — rò rỉ xuyên dự án, có giấy chứng nhận vô can.
 * ⇒ `chiMucKhopGoc()` là cổng **fail-closed** đứng TRƯỚC cả lượt truy hồi: gốc đang chọn ≠ gốc mà
 *   chỉ mục mô tả ⇒ `"khac-goc"`, KHÔNG truy hồi, KHÔNG đọc.
 */
import path from "node:path";
import { uocLuongSoToken } from "../aiLlamaServerClient";
import { nhanNgonNgu } from "../aiCodingAgent";
import { gocHopCat } from "../aiLocalTools/repoSandbox";
import {
  catTheoNganSachToken,
  gatherRepoIndexContext,
  motDuongDanMaTrongVanBan,
  REPO_INDEX_TRUNCATION_MARK,
  type GatherRepoIndexContextInput,
  type RepoIndexContextResult,
} from "./repoContextService";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CỜ — RIÊNG cho đường lập trình, KHÔNG dùng chung với `AI_COPILOT_REPO_INDEX_ENABLED`
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Biến môi trường bật/tắt ngữ cảnh mã của đường lập trình. */
export const BIEN_CO_NGU_CANH_MA = "AI_CODING_REPO_CONTEXT";

/**
 * ★ MẶC ĐỊNH **BẬT** — và đây là một kết luận có lập luận, không phải sự hào hứng.
 *
 * ⚠ Vì sao KHÔNG dùng chung cờ `AI_COPILOT_REPO_INDEX_ENABLED` (đang TẮT): cờ ấy tắt vì một phép
 *   đo về **đường PLC/robot** — ở đó câu hỏi là *cú pháp của HÃNG* nên chunk của repo này là NHIỄU
 *   (`tm-pick-place` kéo `drizzle/schema/robot.ts` lên 0,70). Ở đây câu hỏi là **về chính repo
 *   này**, và cùng phép đo ấy ghi 0,580–0,782 với đoạn TRÚNG ĐÍCH. **Phép đo biện minh cho việc
 *   TẮT không chuyển sang được đường này** — nên hai cờ phải rời nhau, bật/tắt độc lập.
 *
 * ⚠ Và khác biệt thứ hai, quan trọng hơn: đường PLC nhét **văn bản chunk** (tóm tắt) vào prompt —
 *   một lượt xếp hạng trượt là một lời khai SAI đi thẳng vào ngữ cảnh. Ở đây chunk chỉ dùng để
 *   **CHỌN TỆP**; một lượt chọn trượt tốn token chứ không nói dối, vì thứ vào prompt luôn là byte
 *   thật trên đĩa.
 *
 * Chi phí đã đo và có trần: một lượt truy hồi (ẤM 245–283 ms; LẠNH 14.351 ms, chặn bởi hạn giờ
 * `REPO_INDEX_DEFAULT_TIMEOUT_MS` = 20 s) + ≤3 lượt `read_file` ≤12 KB. Ngân sách token: ≤4.000
 * trên một đường còn **29.383 token** dư địa (đo thật, xem `TRAN_TOKEN_NGU_CANH_MA`).
 * Mọi nhánh hỏng ⇒ khối RỖNG ⇒ **đúng hành vi cũ**, không lượt sinh mã nào chết vì tính năng này.
 *
 * Đường tắt: `AI_CODING_REPO_CONTEXT=0`.
 */
export const NGU_CANH_MA_MAC_DINH_BAT = true;

/** Vị từ DUY NHẤT của cờ — mọi nơi khác gọi hàm này, không tự đọc env (lưới lật env theo từng ca). */
export function nguCanhMaEnabled(): boolean {
  const raw = (process.env[BIEN_CO_NGU_CANH_MA] ?? "").trim().toLowerCase();
  if (raw === "") return NGU_CANH_MA_MAC_DINH_BAT;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return NGU_CANH_MA_MAC_DINH_BAT;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TRẦN — mỗi con số một lý lẽ
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★ Trần token cho TOÀN BỘ khối ngữ cảnh mã.
 *
 * Đo thật (2026-08-20, `serverSlotContextTokens()` = 32.768): prompt sinh mã hiện tại với persona
 * đầy đủ + ngữ cảnh dự án 24 mục = **385 token vào**, `MAX_TOKENS_SINH` = 3.000 ra ⇒ còn **29.383
 * token** dư địa. 4.000 dùng ~13,6% chỗ trống ấy và vẫn để lại lối cho lịch sử hội thoại.
 * ⚠ Đây là một cái TRẦN, không phải một cái ĐÍCH: `thuThapNguCanhMa` dừng sớm khi hết tệp liên quan.
 */
export const TRAN_TOKEN_NGU_CANH_MA = 4_000;

/**
 * Số tệp tối đa. 3 vì hai lý do đo được, không phải vì tròn số:
 *   • ngân sách 4.000 token chia 3 ⇒ ~1.330 token/tệp ≈ 3.700 ký tự — đủ để thấy khai báo, import
 *     và vài hàm đầu của một tệp TypeScript thật;
 *   • trần byte MỖI PHIÊN của hộp cát là 1 MB/15 phút (`TRAN_BYTE_MOI_PHIEN`). 3 × 12 KB = 36 KB
 *     mỗi lượt ⇒ ~29 lượt sinh mã trước khi chạm trần. 5 tệp × 12 KB sẽ hạ xuống ~17 lượt và bắt
 *     đầu **ăn vào ngân sách của chính người dùng** khi họ tự gọi `read_file`.
 */
export const SO_TEP_TOI_DA = 3;

/**
 * Trần byte xin `read_file` cho MỖI tệp ngữ cảnh (kẹp dưới `TRAN_BYTE_MOI_TEP` = 65.536).
 * ⚠ Đặt ở đây chứ không để mặc định 64 KB: mỗi byte đọc về đều bị trừ vào sổ ngân sách PHIÊN, kể cả
 *   byte ta cắt đi ngay sau đó vì hết ngân sách token. Xin đúng thứ mình dùng được.
 */
export const TRAN_BYTE_MOI_TEP_NGU_CANH = 12_288;

/** Xin nhiều hơn `SO_TEP_TOI_DA` ở tầng mục lục: sau khi khử trùng đường dẫn và bỏ tệp đọc-không-được. */
export const TOP_K_MUC_LUC = 8;

/**
 * ★★★ NGƯỠNG ĐIỂM CỦA RIÊNG ĐƯỜNG NÀY — và một **tiền đề bị phép đo BÁC BỎ** phải ghi ra.
 *
 * Tiền đề cũ (`REPO_INDEX_DEFAULT_MIN_SCORE = 0,60`): *"ngưỡng điểm tách câu hỏi VỀ REPO khỏi câu
 * hỏi LẠC đề"*. Đo lại 2026-08-20 trên đường sản phẩm đầy đủ:
 *
 *   pha              │ TRÚNG đề (3 câu)        │ LẠC đề (3 câu)
 *   ─────────────────┼─────────────────────────┼──────────────────────────
 *   toàn kho, top-1  │ 0,531 · 0,590 · 0,794   │ 0,519 · 0,552 · 0,677
 *   kho MÃ,  top-1   │ 0,413 · 0,434 · 0,547   │ 0,368 · 0,508
 *
 * **Hai phân bố CHỒNG NHAU ở cả hai pha.** Không tồn tại con số nào đặt vào `minScore` mà tách được
 * chúng ⇒ ngưỡng điểm **không phải** cổng chủ đề, và mọi lượt "chỉnh ngưỡng" là chữa sai bệnh.
 *
 * ⇒ Việc CÒN LẠI của ngưỡng ở đây rất hẹp: bỏ đoạn mà **chính bộ truy hồi** coi là nhiễu. Bộ truy
 *   hồi tự đặt sàn `MIN_CITATION_SCORE = 0,18` (giữ top-1 dù yếu); 0,25 nằm ngay trên sàn ấy và
 *   NẰM DƯỚI mọi số đo được (thấp nhất 0,309). Đặt cao hơn là tự bịt lại đúng cái lỗ vừa mở.
 * ⚠ Chi phí của một lượt chọn TRƯỢT ở đây là **token, không phải một lời khai sai**: thứ vào prompt
 *   luôn là byte thật trên đĩa, và persona buộc model nói rõ nó đang dựa vào tệp nào.
 * ⚠ **KHÔNG dùng chung `AI_COPILOT_REPO_INDEX_MIN_SCORE`** — đó là núm của đường PLC. Dùng chung là
 *   để một kết luận đo trên đường khác lặng lẽ điều khiển đường này (đúng lỗi vừa xảy ra ở live).
 */
export const NGUONG_DIEM_NGU_CANH_MA = 0.25;

/** Núm riêng của đường lập trình. `AI_CODING_REPO_CONTEXT_MIN_SCORE`. */
export const BIEN_NGUONG_DIEM = "AI_CODING_REPO_CONTEXT_MIN_SCORE";

/**
 * ★★★ HẠN GIỜ **TỔNG** cho CẢ HAI pha mục lục — không phải mỗi pha một hạn.
 *
 * Vì sao tổng: người dùng chờ ~75 s cho một lượt sinh mã; ngữ cảnh là thứ PHỤ TRỢ nên nó được một
 * ngân sách cố định, và hai pha CHIA NHAU ngân sách ấy. Pha A ăn hết ⇒ pha B bị bỏ, không phải
 * ngân sách nhân đôi. Đo: ẤM 245–283 ms mỗi pha (GPU) ⇒ hai pha ≈ 0,6 s, hạn giờ không bao giờ chạm.
 *
 * ⚠ Lượt NGUỘI mới là chỗ hạn giờ này bắn — và ở live nó ĐÃ bắn (`QUÁ HẠN 20000 ms`, lượt 1).
 *   Nguyên nhân KHÔNG phải truy hồi chậm mà là ba lượt nạp một-lần cộng dồn: `ensureDataLoaded`
 *   (162 MB `embeddings.jsonl`) + nạp embedder + **dựng ngữ cảnh rerank gguf (11–14 s đo được)**.
 *   Cách chữa ĐÚNG là làm ấm lúc khởi động (`warmUpOllamaModels` nay chạy một lượt truy hồi thật),
 *   không phải nới hạn giờ — nới hạn giờ chỉ chuyển "mất ngữ cảnh" thành "chờ 45 s rồi vẫn mất".
 */
export const HAN_GIO_MUC_LUC_MS = 20_000;

/** Núm riêng của đường lập trình. `AI_CODING_REPO_CONTEXT_TIMEOUT_MS`. */
export const BIEN_HAN_GIO = "AI_CODING_REPO_CONTEXT_TIMEOUT_MS";

/**
 * Dưới mức này thì KHÔNG khởi động pha B: một lượt truy hồi có hạn giờ 300 ms gần như chắc chắn
 * trả `timeout`, tức trả tiền embed + rerank để nhận một mảng rỗng.
 */
export const HAN_GIO_TOI_THIEU_PHA_B_MS = 1_500;

/**
 * Trần số ỨNG VIÊN đem đi `read_file`. Mỗi ứng viên là một lượt gọi tool thật (RBAC + hộp cát +
 * sổ ngân sách byte của PHIÊN), và ứng viên MÓT từ tài liệu có thể trỏ vào tệp không tồn tại —
 * đo được: `client/src/pages/AOIPackages.ts` và `scripts/__tmp-task9-dongbo.mjs` đều KHÔNG có trên
 * đĩa. 9 = 3 ô × 3 lượt trượt cho phép, đủ rộng mà vẫn có trần.
 */
export const SO_UNG_VIEN_TOI_DA = 9;

function soTuEnv(ten: string, macDinh: number): number {
  const n = Number(process.env[ten]);
  return Number.isFinite(n) && n >= 0 ? n : macDinh;
}

/** Ngưỡng điểm ĐANG dùng cho đường lập trình. Vị từ DUY NHẤT — không nơi nào tự đọc env. */
export function nguongDiemNguCanhMa(): number {
  return soTuEnv(BIEN_NGUONG_DIEM, NGUONG_DIEM_NGU_CANH_MA);
}

/** Hạn giờ TỔNG đang dùng cho đường lập trình. */
export function hanGioMucLucMs(): number {
  return Math.floor(soTuEnv(BIEN_HAN_GIO, HAN_GIO_MUC_LUC_MS));
}

/**
 * Ngân sách token cấp cho `gatherRepoIndexContext` — chỉ để **giữ đủ thứ hạng**. Ta vứt `block` của
 * nó đi; con số này tồn tại vì hàm ấy cắt danh sách `snippets` theo ngân sách của khối văn bản.
 */
export const TRAN_TOKEN_MUC_LUC = 6_000;

/** Tiêu đề khối — hằng số vì prompt, lưới và log đều phải nói CÙNG một chuỗi. */
export const KHOI_HEADER_NGU_CANH_MA =
  "=== MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ (đọc từ đĩa TRONG LƯỢT NÀY, không phải trí nhớ của model) ===";

/** Chân khối — đóng lại để model không lẫn ngữ cảnh với yêu cầu. */
export const KHOI_FOOTER_NGU_CANH_MA = "=== HẾT MÃ NGUỒN THAM CHIẾU ===";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GỐC CHỈ MỤC — cổng fail-closed của trục 2
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Gốc mà `knowledge/chunks.jsonl` MÔ TẢ. `knowledge/` nằm trong repo chính, nên gốc ấy là
 * `process.cwd()`. Cho phép khai đè để một triển khai chạy chỉ mục ở nơi khác vẫn nói được sự thật.
 */
export const BIEN_GOC_CHI_MUC = "AI_KNOWLEDGE_INDEX_ROOT";

export function gocChiMucTriThuc(): string {
  const raw = (process.env[BIEN_GOC_CHI_MUC] ?? "").trim();
  return raw === "" ? path.resolve(process.cwd()) : path.resolve(raw);
}

/**
 * ★★★ Gốc dự án ĐANG CHỌN có đúng là gốc mà chỉ mục mô tả không.
 *
 * ⚠ `projectRoot` VẮNG **không** có nghĩa là "khớp": khi vắng, ba read tool rơi về `gocHopCat()`,
 *   và `gocHopCat()` đọc `AI_REPO_SANDBOX_ROOT` — một triển khai trỏ hộp cát vào một worktree khác
 *   sẽ có gốc mặc định ≠ gốc chỉ mục. Nên ca vắng cũng phải đi qua đúng phép so này.
 */
export function chiMucKhopGoc(projectRoot?: string | null): boolean {
  const goc = typeof projectRoot === "string" && projectRoot.trim() !== ""
    ? path.resolve(projectRoot.trim())
    : gocHopCat();
  return goc === gocChiMucTriThuc();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// KIỂU
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Hình dạng TỐI THIỂU của một `ToolResult` mà module này đọc (không nhập kiểu tool để khỏi buộc chặt). */
export interface KetQuaDocTepTho {
  note?: string;
  data?: unknown;
}

/**
 * Cây cầu nào đã đưa một tệp vào danh sách ứng viên.
 *   • `"kho-ma"`      — pha A: truy hồi TRONG kho mã nguồn.
 *   • `"cau-tai-lieu"`— pha B: đường dẫn được nhắc nguyên văn trong một chunk tài liệu.
 * ⚠ Có mặt để LOG và LƯỚI phát biểu được "cây cầu nào còn sống", chứ không phải để trang trí: hai
 *   cây cầu hỏng ở hai chỗ khác nhau, và một lưới chỉ đếm tổng số tệp sẽ vẫn xanh khi một cây cầu
 *   chết hẳn.
 */
export type NguonUngVien = "kho-ma" | "cau-tai-lieu";

/** Một tệp ĐÃ VÀO prompt — đúng thứ người dùng phải được thấy. */
export interface TepNguCanh {
  /** Cây cầu đã tìm ra tệp này. */
  nguon: NguonUngVien;
  /** Đường dẫn TƯƠNG ĐỐI so với gốc dự án đang chọn (do chính `read_file` trả về). */
  duong: string;
  /** Byte THẬT trên đĩa (có thể lớn hơn phần đã đưa vào prompt). */
  byteTrenDia: number;
  /** Số ký tự THỰC SỰ đưa vào prompt. */
  kyTuVaoPrompt: number;
  /** `true` ⇔ đã bị cắt (bởi trần byte của `read_file` HOẶC bởi ngân sách token ở đây). */
  daCat: boolean;
  /** Điểm liên quan của mục lục — hiện ra để người đọc log biết vì sao tệp này được chọn. */
  diem: number;
}

export type LyDoNguCanhMa =
  /** có ít nhất một tệp vào prompt */
  | "ok"
  /** cờ `AI_CODING_REPO_CONTEXT` tắt */
  | "co-tat"
  /** gốc dự án đang chọn KHÁC gốc mà chỉ mục mô tả (trục 2) */
  | "khac-goc"
  /** không có cửa đọc (`execCtx` vắng ⇒ không có RBAC/hộp cát để đi qua) */
  | "khong-cua-doc"
  /** câu hỏi rỗng */
  | "khong-cau-hoi"
  /** ngân sách token ≤ 0 hoặc quá nhỏ */
  | "khong-ngan-sach"
  /** mục lục không trả đường dẫn nào đạt ngưỡng */
  | "muc-luc-rong"
  /** có đường dẫn nhưng KHÔNG tệp nào đọc được (hộp cát/RBAC/không tồn tại) */
  | "khong-doc-duoc";

export interface KetQuaNguCanhMa {
  /** Khối chữ sẵn sàng chèn vào prompt. `""` ⇔ không chèn gì. */
  khoi: string;
  /** Token ƯỚC LƯỢNG của `khoi` (0 khi rỗng). */
  tokens: number;
  tep: TepNguCanh[];
  lyDo: LyDoNguCanhMa;
  /** Số đường dẫn mục lục trả về TRƯỚC khi đọc — để log biết cổng đọc đang cắt bao nhiêu. */
  soDuongDanMucLuc: number;
}

function rong(lyDo: LyDoNguCanhMa, soDuongDanMucLuc = 0): KetQuaNguCanhMa {
  return { khoi: "", tokens: 0, tep: [], lyDo, soDuongDanMucLuc };
}

export interface DauVaoNguCanhMa {
  /** Câu hỏi của người dùng — thứ quyết định tệp nào liên quan. */
  cauHoi: string;
  /** Gốc dự án ĐANG CHỌN (tuyệt đối). Vắng ⇒ so với `gocHopCat()`, xem `chiMucKhopGoc`. */
  projectRoot?: string | null;
  /** Vai RBAC thật — xuyên xuống cổng corpus Studio của `retrieveKnowledge`. */
  callerRole?: string;
  /** Trần token cho toàn khối. Mặc định `TRAN_TOKEN_NGU_CANH_MA`. */
  tranToken?: number;
  /**
   * ★★★ CỬA ĐỌC — **BẮT BUỘC** là `executeDecision({tool:"read_file", args:{path, maxBytes}})` của
   * người gọi. Module này cố ý không tự tạo được cửa nào: không có cửa ⇒ không có ngữ cảnh.
   */
  docTep: (duong: string, tranByte: number) => Promise<KetQuaDocTepTho | null>;
  /** Seam cho lưới: thay bước MỤC LỤC. Mặc định `gatherRepoIndexContext`. */
  timMucLuc?: (i: GatherRepoIndexContextInput) => Promise<RepoIndexContextResult>;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THU THẬP
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ MỤC LỤC (2 pha) → MÃ THẬT. FAIL-SAFE tuyệt đối: mọi lỗi ⇒ khối RỖNG, **KHÔNG BAO GIỜ ném** —
 * một lượt truy hồi hỏng không được phép giết một lượt sinh mã vốn vẫn chạy được mà không có nó.
 *
 * ⚠⚠ **LUÔN ghi một dòng log kết cục.** Triệu chứng live tệ nhất của bản đầu không phải "sai" mà là
 *    **CÂM**: không thẻ, không chân nguồn, không lỗi, không log — người trực không có cách nào phân
 *    biệt "truy hồi trả 0 tệp" với "tính năng chưa từng được gọi". Im lặng là nói dối.
 */
export async function thuThapNguCanhMa(y: DauVaoNguCanhMa): Promise<KetQuaNguCanhMa> {
  if (!nguCanhMaEnabled()) return rong("co-tat");

  const cauHoi = String(y?.cauHoi ?? "").trim();
  if (cauHoi === "") return rong("khong-cau-hoi");
  if (typeof y?.docTep !== "function") return rong("khong-cua-doc");

  // ⚠ Cổng TRỤC 2 đứng TRƯỚC lượt truy hồi: sai gốc thì không được tốn một lượt embed nào, và
  //   tuyệt đối không được đọc tệp của một dự án khác.
  if (!chiMucKhopGoc(y.projectRoot)) return rong("khac-goc");

  const tranToken = Math.floor(y.tranToken ?? TRAN_TOKEN_NGU_CANH_MA);
  const tokenHeader = uocLuongSoToken(KHOI_HEADER_NGU_CANH_MA) + uocLuongSoToken(KHOI_FOOTER_NGU_CANH_MA);
  // Cổng RẺ trước cổng TỐN: không đủ chỗ cho (khung + một mẩu mã có nghĩa) thì KHÔNG embed.
  if (tranToken - tokenHeader < 120) return rong("khong-ngan-sach");

  const tim = y.timMucLuc ?? gatherRepoIndexContext;
  const nguong = nguongDiemNguCanhMa();
  const hanGioTong = hanGioMucLucMs();
  const batDau = Date.now();

  /** Một lượt mục lục, FAIL-SAFE: mọi lỗi ⇒ `null`, người gọi đi tiếp bằng cây cầu còn lại. */
  const goiMucLuc = async (
    cheDoVungMa: NonNullable<GatherRepoIndexContextInput["cheDoVungMa"]>,
    timeoutMs: number,
  ): Promise<RepoIndexContextResult | null> => {
    try {
      return await tim({
        query: cauHoi,
        maxTokens: TRAN_TOKEN_MUC_LUC,
        topK: TOP_K_MUC_LUC,
        // Ngưỡng + hạn giờ truyền TƯỜNG MINH: núm của đường PLC
        // (`AI_COPILOT_REPO_INDEX_MIN_SCORE`/`_TIMEOUT_MS`) KHÔNG được điều khiển đường này.
        minScore: nguong,
        timeoutMs,
        callerRole: y.callerRole,
        // Cờ RIÊNG của đường này đã quyết ở trên; không để cờ của đường PLC bịt đường này.
        boQuaCo: true,
        cheDoVungMa,
      });
    } catch (e) {
      console.warn(
        `[codingRepoContext] MỤC LỤC pha "${cheDoVungMa}" hỏng (bỏ qua, sinh mã vẫn chạy):`,
        (e as Error)?.message ?? e,
      );
      return null;
    }
  };

  // ── PHA A — truy hồi TRONG KHO MÃ (xem docblock đầu tệp về vì sao lọc-sau luôn cho 0 tệp) ──
  const phaA = await goiMucLuc("corpus", hanGioTong);

  // ── PHA B — toàn kho, chỉ để MÓT đường dẫn mã trong thân chunk; `block`/`text` bị vứt ──
  const conLaiMs = hanGioTong - (Date.now() - batDau);
  const phaB = conLaiMs >= HAN_GIO_TOI_THIEU_PHA_B_MS ? await goiMucLuc("tat", conLaiMs) : null;

  /**
   * XEN KẼ hai cây cầu (A1, B1, A2, B2…), khử trùng theo đường dẫn, giữ nguyên thứ hạng bên trong
   * mỗi cầu. Đo được vì sao KHÔNG nối đuôi: câu "phân quyền RBAC" cho pha B **0** đường dẫn, còn
   * pha A cho toàn tệp `aiLocalTools/**`; câu "xác thực người dùng" thì pha B mới là cầu tìm ra
   * `server/routers/userRouters.ts`. Cho một cầu độc chiếm cả 3 ô là cược vào đúng cái nó thiếu.
   */
  const tuA: Array<{ duong: string; diem: number; nguon: NguonUngVien }> = [];
  for (const s of phaA?.snippets ?? []) {
    const p = String(s?.sourcePath ?? "").trim();
    if (p !== "") tuA.push({ duong: p, diem: Number(s?.score ?? 0), nguon: "kho-ma" });
  }
  const tuB: Array<{ duong: string; diem: number; nguon: NguonUngVien }> = [];
  for (const s of phaB?.snippets ?? []) {
    for (const p of motDuongDanMaTrongVanBan(String(s?.text ?? ""))) {
      tuB.push({ duong: p, diem: Number(s?.score ?? 0), nguon: "cau-tai-lieu" });
    }
  }

  const daThay = new Set<string>();
  const ungVien: Array<{ duong: string; diem: number; nguon: NguonUngVien }> = [];
  for (let i = 0; i < Math.max(tuA.length, tuB.length); i++) {
    for (const uv of [tuA[i], tuB[i]]) {
      if (!uv || daThay.has(uv.duong) || ungVien.length >= SO_UNG_VIEN_TOI_DA) continue;
      daThay.add(uv.duong);
      ungVien.push(uv);
    }
  }

  /**
   * Dòng log kết cục — MỘT dòng, luôn có, đủ để người trực chẩn đoán mà không cần gắn debugger:
   * mỗi cây cầu trả về bao nhiêu, hai pha ra `reason` gì, mất bao lâu, và cuối cùng còn mấy tệp.
   * Chính dòng này là thứ bản đầu KHÔNG có, nên ba lượt live hỏng mà nhật ký hoàn toàn trống.
   */
  const khaiPha = (r: RepoIndexContextResult | null, ten: string) =>
    r === null ? `${ten}=HỎNG` : `${ten}=${r.reason}/${r.snippets.length}(thô ${r.retrieved})`;
  console.log(
    `[codingRepoContext] ${khaiPha(phaA, "phaA-khoMa")} ${phaB === null ? "phaB=BỎ-QUA/HỎNG" : khaiPha(phaB, "phaB-cauTaiLieu")} ` +
      `· ứng viên ${ungVien.length} (kho-mã ${tuA.length}, cầu-tài-liệu ${tuB.length}) · ngưỡng ${nguong} · ${Date.now() - batDau} ms`,
  );

  if (ungVien.length === 0) return rong("muc-luc-rong");

  let conLai = tranToken - tokenHeader;
  const tep: TepNguCanh[] = [];
  const doan: string[] = [];

  for (const uv of ungVien) {
    if (tep.length >= SO_TEP_TOI_DA) break;
    if (conLai <= 0) break;

    let kq: KetQuaDocTepTho | null = null;
    try {
      kq = await y.docTep(uv.duong, TRAN_BYTE_MOI_TEP_NGU_CANH);
    } catch (e) {
      console.warn(`[codingRepoContext] không đọc được "${uv.duong}":`, (e as Error)?.message ?? e);
      continue;
    }
    // `note` có mặt ⇔ hộp cát/RBAC/không-tồn-tại đã TỪ CHỐI. Bỏ qua trong im lặng là ĐÚNG ở đây:
    // đây là ngữ cảnh PHỤ TRỢ, và một câu từ chối của hộp cát không phải câu trả lời cho câu hỏi.
    if (!kq || kq.note) continue;

    const d = kq.data as { path?: unknown; content?: unknown; bytes?: unknown; truncated?: unknown } | undefined;
    const noiDung = typeof d?.content === "string" ? d.content : "";
    if (noiDung.trim() === "") continue;
    const duongThat = typeof d?.path === "string" && d.path ? d.path : uv.duong;
    const byteTrenDia = typeof d?.bytes === "number" ? d.bytes : noiDung.length;

    const nhan = `[M${tep.length + 1}] ${duongThat} (${byteTrenDia} byte trên đĩa)`;
    const rao = "```" + nhanNgonNgu(duongThat);
    const chiPhiKhung = uocLuongSoToken(`${nhan}\n${rao}\n\n\`\`\``);
    const nganSachThan = conLai - chiPhiKhung;
    // Không còn chỗ cho một mẩu mã có nghĩa ⇒ DỪNG (không nhảy cóc xuống tệp kém liên quan hơn chỉ
    // vì nó ngắn — như thế thứ hạng của mục lục mất nghĩa).
    if (nganSachThan < 60) break;

    const { text, truncated } = catTheoNganSachToken(noiDung, nganSachThan);
    if (!text) break;

    doan.push(`${nhan}\n${rao}\n${text}\n\`\`\``);
    tep.push({
      nguon: uv.nguon,
      duong: duongThat,
      byteTrenDia,
      kyTuVaoPrompt: text.length,
      daCat: truncated || d?.truncated === true,
      diem: uv.diem,
    });
    conLai -= chiPhiKhung + uocLuongSoToken(text);
  }

  if (tep.length === 0) {
    console.warn(
      `[codingRepoContext] ${ungVien.length} ứng viên nhưng KHÔNG đọc được tệp nào ` +
        `(hộp cát/RBAC/không tồn tại) ⇒ lượt sinh mã đi tiếp KHÔNG có ngữ cảnh mã.`,
    );
    return rong("khong-doc-duoc", ungVien.length);
  }

  console.log(
    `[codingRepoContext] ĐÃ ĐỌC ${tep.length} tệp vào prompt: ` +
      tep.map((t) => `${t.duong}[${t.nguon} ${t.diem.toFixed(3)}]`).join(", "),
  );
  const khoi = `${KHOI_HEADER_NGU_CANH_MA}\n${doan.join("\n\n")}\n${KHOI_FOOTER_NGU_CANH_MA}`;
  return { khoi, tokens: uocLuongSoToken(khoi), tep, lyDo: "ok", soDuongDanMucLuc: ungVien.length };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// NGƯỜI DÙNG PHẢI THẤY
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ CHÂN NGUỒN — *"AI vừa đọc những tệp nào"*, nối vào CUỐI câu trả lời.
 *
 * ⚠⚠ Vì sao nối vào CHUỖI chứ không chỉ phát một sự kiện SSE: một phiên đã lưu **chỉ chứa
 *    `{role, content}`** (bất biến số một của `locLuot()`, doc 79 §danh sách phiên). Thẻ tool là
 *    một sự kiện, không phải `content` ⇒ mở lại phiên cũ thì thẻ biến mất và câu trả lời trở lại
 *    thành "AI nói vậy thôi". Chân nguồn nằm TRONG `content` nên nó sống sót qua lượt nạp lại.
 *    Cả hai đều được phát: thẻ cho lượt đang xem, chân nguồn cho lượt sau.
 *
 * ⚠ Khai luôn phần bị CẮT. Một mẩu mã cụt mà không nói là cụt thì người đọc (và model) tưởng đó là
 *   toàn bộ sự thật — đúng lý lẽ của `REPO_INDEX_TRUNCATION_MARK`.
 */
export function chanNguonNguCanhMa(tep: readonly TepNguCanh[], lang: "vi" | "en" | "zh"): string {
  if (tep.length === 0) return "";
  const dong = tep.map((t) => {
    const cat =
      t.daCat
        ? lang === "en"
          ? ` — first ${t.kyTuVaoPrompt}/${t.byteTrenDia} bytes only`
          : lang === "zh"
            ? ` — 仅前 ${t.kyTuVaoPrompt}/${t.byteTrenDia} 字节`
            : ` — chỉ ${t.kyTuVaoPrompt}/${t.byteTrenDia} byte đầu`
        : "";
    return `• \`${t.duong}\`${cat}`;
  });
  const dau =
    lang === "en"
      ? "📄 Answer grounded in these files, read from disk this turn:"
      : lang === "zh"
        ? "📄 本轮回答依据以下文件（本轮从磁盘读取）："
        : "📄 Câu trả lời dựa trên các tệp sau, ĐỌC TỪ ĐĨA trong lượt này:";
  return `\n\n${dau}\n${dong.join("\n")}`;
}

/** Dấu hiệu một mẩu mã bị cắt — dùng lại hằng của `repoContextService`, không định nghĩa bản thứ hai. */
export const DAU_CAT = REPO_INDEX_TRUNCATION_MARK;
