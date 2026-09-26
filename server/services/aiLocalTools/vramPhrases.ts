/**
 * ★★★ Pha 5 Task 4 (N10) — **BỀ MẶT AGENT CỦA VRAM, ĐỦ BA NGÔN NGỮ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG DÙNG `i18n.exists()` / KHÔNG ĐỔ VÀO `client/src/i18n/locales/*.json`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Brief của task viết *"Modify: … · ba file locale"* và *"cổng vét cạn phải dùng
 * `i18n.exists(…, { lng, fallbackLng: false })`"*. **Bước 2 của chính brief bắt kiểm TRƯỚC:
 * "máy chủ dịch bằng đường nào".** Kết quả đo:
 *
 *   • `git grep "from \"i18next\"" -- server/ shared/` ⇒ **KHÔNG một dòng nào**. Máy chủ **không có**
 *     thực thể i18next; `client/src/i18n/index.ts` dùng `i18next-browser-languagedetector` +
 *     `import … from './locales/vi.json?url'` — **chỉ chạy trong trình duyệt**.
 *   • `git grep "i18n/locales" -- server/ shared/` ⇒ chỉ **một** kết quả và nó là **file TEST**
 *     (`server/services/vram/refusal.test.ts:65`, đọc bằng `readFileSync` để **đối chiếu**, không
 *     phải để **render**).
 *   • Đường dịch THẬT của máy chủ là hàm `w(lang, vi, en, zh)`. ⚠ **TÁM bản sao**, không phải ba
 *     (`git grep -n "function w(" -- server/`): `readToolsProgramming.ts:72` +
 *     `writeHandlers/{engineering,interlock,machineControl,maintenance,programmingFile,
 *     qualityAdvisory,visionControl}.ts`. Cộng `DENY: Record<ToolLang, string>` **ngay trong
 *     `vramTools.ts`**. ⚠⚠ Một trong tám nằm ở một **READ tool** (`readToolsProgramming.ts`) —
 *     con số "ba writeHandler" ở bản trước **che mất đúng sự thật ấy**, và chính file đó là nơi
 *     C-1 nổ (một ô tên `lang` **không phải** ngôn ngữ hiển thị). Xem `toolRegistry.ts`.
 *
 * ⇒ Đổ câu vào `locales/*.json` **bắt buộc phải đẻ một người đọc MỚI ở máy chủ** (nạp 3 file JSON
 * ~2,4 MB của client vào tiến trình server, dựng một instance i18next thứ hai) — **đúng thứ ràng
 * buộc ⚠⚠ "ĐỪNG ĐẺ ĐƯỜNG THỨ HAI" cấm**. Và nó vô nghĩa về mặt đường đi: `textSummary` được
 * **nhồi thẳng vào prompt LLM ở máy chủ** (`aiLocalKnowledgeService`), **không bao giờ** đi qua
 * i18next của trình duyệt.
 *
 * ⇒ File này dùng **đúng cơ chế đã có** (`w(lang, vi, en, zh)`), chỉ **lập bảng hoá** nó để cổng
 * vét cạn **mạnh hơn** `i18n.exists()`: thiếu một ngôn ngữ thì **`tsc` không biên dịch được**, chứ
 * không phải "chạy rồi mới biết". Bất biến mà `fallbackLng: false` bảo vệ (**`zh` KHÔNG được mượn
 * `vi`**) được cưỡng chế trực tiếp ở `vramPhrases.exhaustive.test.ts` bằng ba luật **PHẢI-LÀ**
 * (xem dưới), không bằng một danh sách cấm.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ LUẬT PHÂN CÔNG: **VĂN XUÔI ⇒ KHOÁ · ĐỊNH DANH/DỮ LIỆU ⇒ THAM SỐ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `leaseKey=`, `basis=`, `estimateKind=`… là **tên trường máy đọc**, giống nhau ở mọi ngôn ngữ ⇒
 * chúng là **dữ liệu**, ghép ở `vramTools.ts` rồi truyền vào làm tham số. Mọi thứ **có nghĩa cho
 * người đọc** đều là một khoá ở bảng dưới. Nhờ luật này, **mọi** khoá đều có văn xuôi ở cả ba
 * ngôn ngữ, nên ba luật PHẢI-LÀ của cổng vét cạn áp được cho **toàn bảng**, không cần một miễn
 * trừ nào (miễn trừ là chỗ phần tử thứ N+1 chui vào).
 *
 * ⚠⚠ M-3 (review) — **GẶP CỔNG §A THÌ CÓ HAI LỐI ĐÚNG, VÀ MỘT LỐI SAI RẺ HƠN CẢ HAI.**
 * Cổng đòi `vi` phải có dấu / `zh` phải có Hán tự. Một khuôn **thuần kỹ thuật** sẽ đỏ. Hai lối
 * ĐÚNG: (1) **viết văn xuôi thật** — nói hành động tiếp theo, thứ khuôn ấy đang thiếu; (2) **đẩy
 * phần kỹ thuật xuống THAM SỐ**, để khoá chỉ còn giữ văn xuôi.
 * Lối SAI: **nhét một chữ có dấu cho qua cổng** — cổng xanh mà không trả lại điều cổng đang đòi,
 * và một lưới NỘI DUNG bị hạ cấp thành một lưới CHÍNH TẢ. Hai khoá `basis` /
 * `baselineUnverifiedList` đi lối (1); đọc chú thích tại chỗ.
 *
 * ⚠⚠ I-3 (review) — **THÂN MỖI HÀM KHUÔN PHẢI LÀ MỘT BIỂU THỨC CHUỖI, KHÔNG RẼ NHÁNH.**
 * Người review dựng đột biến **RV-2**: rẽ nhánh **theo GIÁ TRỊ THAM SỐ** ngay trong ô `en`
 * (`p.stale === "true" ? <tiếng Việt> : <tiếng Anh>`) ⇒ **106/106 xanh, `tsc` sạch**, và nhánh ấy
 * **tới được thật** (bản sao sổ chung cũ 10 phút ⇒ một dòng tiếng Việt ở phiên `en`). Gốc: §A
 * render mỗi khuôn **đúng MỘT lần** ⇒ chỉ quan sát được **một** nhánh, trong khi tập giá trị tham
 * số là **vô hạn** — *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"* ở một nấc mới: thứ bị liệt kê
 * lần này là **điểm dữ liệu render**.
 * ⇒ Mọi rẽ nhánh phải nằm ở `vramTools.ts` và chọn giữa **HAI KHOÁ** (`degradedYes`/`degradedNo`,
 * `unledgeredEstimateUsable`/`Unusable`, `beginFailures*` đã đúng khuôn ấy). Cưỡng chế bằng ca AST
 * §A-AST ở `vramPhrases.exhaustive.test.ts`.
 *
 * ⚠⚠ **CÂU ĐÚNG MÀ VÔ DỤNG VẪN LÀ HỎNG.** Đây là bề mặt cho **Agent**: mỗi câu phải nói **hành
 * động tiếp theo**. Ví dụ hỏng mà brief nêu đích danh — dịch `owner-not-in-local-ledger` thành
 * *"chủ sở hữu không có trong sổ cục bộ"* — đúng từng chữ và **vô dụng**. Bản `en`/`zh` của khoá
 * `reclaimOwnerProcess` dưới đây nói thẳng điều duy nhất người đọc cần: **hộ đó do tiến trình
 * KHÁC giữ, lệnh phải ra ở tiến trình ĐÓ, đừng thử lại ở đây.**
 *
 * ⚠ **NHÃN `beginVramAllocation` TUYỆT ĐỐI KHÔNG ĐƯỢC ĐỨNG TRƯỚC `(` HOẶC `{`** — lưới
 * `enforcement.test.ts` quét `\bbeginVramAllocation\s*[({]` bằng `git grep` và nó **không bỏ
 * chuỗi**. Hai khoá `beginFailures*` dưới đây viết `(hàm beginVramAllocation)` / `(function
 * beginVramAllocation)` / `（函数 beginVramAllocation）` — ký tự ngay sau luôn là `)` hoặc `）`.
 */

import type { ToolLang } from "./toolRegistry";

/** Giá trị nhét vào một khuôn câu: **dữ liệu đã định dạng**, không bao giờ là văn xuôi chưa dịch. */
export type Tham = Record<string, string | number | boolean>;

/** Khuôn không tham số. */
export type KhongTham = Record<string, never>;

/**
 * Một **cụm** = ba khuôn, một cho mỗi ngôn ngữ. Ba ô là **bắt buộc theo KIỂU** ⇒ quên một ngôn
 * ngữ thì `tsc` đỏ, không cần chờ một ca chạy. Đây là phần "đổi kiểu để phát biểu sai không viết
 * ra được" mà chuỗi pha này đã dùng thành công bốn lần.
 */
export interface Cum<P extends Tham> {
  readonly vi: (p: P) => string;
  readonly en: (p: P) => string;
  readonly zh: (p: P) => string;
}

export function ba<P extends Tham>(vi: (p: P) => string, en: (p: P) => string, zh: (p: P) => string): Cum<P> {
  return { vi, en, zh };
}

/**
 * ★★★ **NHÃN KIỂU CỦA MỘT DÒNG BẢN TÓM TẮT.** `tomTat()` trả `Dong[]`; `Dong` chỉ ra đời từ
 * `noi()`. ⇒ `d.push("Câu mới tiếng Việt")` **không biên dịch được** — đột biến "thêm một câu mới
 * không dịch" bị chặn ở tầng KIỂU, trước cả khi có ca test nào chạy.
 *
 * ⚠ Phép ép kiểu **duy nhất** hợp lệ nằm trong `noi()` ngay dưới. `vramPhrases.exhaustive.test.ts`
 * có một ca khẳng định `vramTools.ts` **không chứa một phép ép kiểu nào sang `Dong`** — nếu
 * không, đường lách hiển nhiên là `"..." as Dong`.
 */
declare const NHAN_DONG: unique symbol;
export type Dong = string & { readonly [NHAN_DONG]: true };

type ThamCua<K extends keyof typeof CAU> = (typeof CAU)[K] extends Cum<infer P> ? P : never;

/** Dựng một **DÒNG** của bản tóm tắt. Kết quả mang nhãn `Dong` ⇒ đẩy được vào `tomTat()`. */
export function noi<K extends keyof typeof CAU>(lang: ToolLang, key: K, tham: ThamCua<K>): Dong {
  return (CAU[key] as Cum<Tham>)[lang](tham) as Dong;
}

/** Dựng một **MẢNH** để nhét vào một dòng khác. Trả `string` trần ⇒ **không** tự thành một dòng. */
export function cum<K extends keyof typeof CAU>(lang: ToolLang, key: K, tham: ThamCua<K>): string {
  return (CAU[key] as Cum<Tham>)[lang](tham);
}

/**
 * ★★★ BẢNG CÂU. Mọi câu của bề mặt Agent VRAM nằm ở đây và **chỉ** ở đây.
 *
 * ⚠ `vi` giữ **nguyên văn từng byte** so với bản Pha 4 — `vramTools.test.ts` và
 * `vramTools.promptSafety.test.ts` khẳng định nội dung tiếng Việt, và đổi chúng là đổi hợp đồng
 * của một lưới đang canh thứ khác. `en`/`zh` được viết **hành-động-trước**, nên chúng dài hơn
 * `vi` ở vài chỗ — đó là chủ ý, không phải lệch.
 */
export const CAU = {
  // ── DƯ ĐỊA ─────────────────────────────────────────────────────────────────────────────────
  /**
   * ★★★ I-3 (review TOÀN NHÁNH Pha 6) — **CÂU "NÓ ĐANG CHẢY" NAY ĐI CÙNG CON SỐ.**
   *
   * ⚠⚠ Task 2 đổi KIỂU của `effectiveBytes` để **không ai dùng được nó làm bằng chứng trước/sau**
   * (`notAnInvariant` · `variesWith` · `beforeAfterEvidence`). Đo lại ở review: ba ô ấy là **424
   * byte/lượt · ≈298 KiB/giờ/panel · 0 lượt đọc** — và với **Agent** thì lượt đổi kiểu ấy **VÔ
   * HÌNH**, vì Agent **chỉ nhận `textSummary`** (`aiLocalKnowledgeService.ts:2351` đường stream ·
   * `:2070`/`:2396` đường không stream — `data.state` **không bao giờ** tới LLM). Tức: cơ chế dựng
   * ra để chặn *"vừa nhả 426 MiB"* không tới được **đúng người** nó bảo vệ.
   * ⇒ Câu cảnh báo nay nằm **trong chính dòng mang con số**, không phải trong một ô payload.
   * ⚠ Giá đã được Task 2 tính đúng: **3 chuỗi khuôn, 0 khoá i18n mới**.
   */
  /**
   * ⚠⚠⚠ **ĐÍNH CHÍNH Pha 7 Task 2 (M-1 của review) — BẢN CHÉP TAY ĐÃ ĐƯỢC GỠ KHỎI ĐÂY.**
   * Bản trước nối thêm một câu *"con số ĐANG CHẢY…"* **viết tay**, và Pha 7 thêm khoá
   * `effectiveFlowing` in **chính ba ô payload** nói cùng điều đó ⇒ **hai dòng liền nhau nói MỘT
   * sự thật**, phồng ngữ cảnh (xem I-2: bản tóm tắt có TRẦN) và để nguyên **nguồn trôi** (bản chép
   * tay lệch khỏi `variesWith` mà không ai thấy). ⇒ Câu cảnh báo nay sống **đúng một chỗ**: khoá
   * `effectiveFlowing`, nơi nó đi **cùng dữ liệu đẻ ra nó**.
   * ⚠ Câu *"lấy EFFECTIVE, đừng lấy raw"* **ở lại** đây — nó nói về **hai ô của chính dòng này**.
   */
  headroom: ba<{ eff: string; raw: string; ceiling: string; used: string }>(
    (p) =>
      `Dư địa hiệu lực: ${p.eff} (thô ${p.raw}) · trần ${p.ceiling} · đang dùng ${p.used}. ` +
      `Tính mọi lượt nạp mới theo con số HIỆU LỰC, không bao giờ theo con số thô.`,
    (p) =>
      `Effective headroom: ${p.eff} (raw ${p.raw}) · ceiling ${p.ceiling} · in use ${p.used}. ` +
      `Size any new model load against the EFFECTIVE number, never the raw one.`,
    (p) =>
      `有效余量：${p.eff}（原始 ${p.raw}）· 上限 ${p.ceiling} · 已用 ${p.used}。` +
      `规划新模型加载时一律以“有效余量”为准，不要用原始值。`,
  ),
  /**
   * ⚠ Bản `vi` **có thêm một câu so với Pha 4**, và đó là cổng §A của
   * `vramPhrases.exhaustive.test.ts` làm việc đúng chức năng: khuôn cũ (`basis=… · trusted=…`) là
   * **thuần kỹ thuật**, không một chữ tiếng Việt nào — tức nó **chưa từng nói hành động tiếp theo**
   * cho người đọc `vi`, trong khi `en`/`zh` mới viết thì có. Luật *"câu đúng mà VÔ DỤNG vẫn là
   * hỏng"* áp cho **cả ba** ngôn ngữ, nên phần thiếu được trả ở đây thay vì miễn trừ cho `vi`.
   */
  basis: ba<{ basis: string; blind: string; trusted: string; degraded: string }>(
    (p) =>
      `basis=${p.basis}${p.blind} · trusted=${p.trusted}${p.degraded} ` +
      `Xem basis và trusted như hai cái chốt: chốt nào hở thì chỉ được nêu con số như một ƯỚC LƯỢNG, không phải một sự thật.`,
    (p) =>
      `basis=${p.basis}${p.blind} · trusted=${p.trusted}${p.degraded} ` +
      `Treat basis and trusted as gates: if either is off, quote the number as an estimate, not a fact.`,
    (p) =>
      `basis=${p.basis}${p.blind} · trusted=${p.trusted}${p.degraded} ` +
      `请把 basis 与 trusted 当作闸门：任一不成立时，只能把数字当估算引用，不能当事实。`,
  ),
  basisBlind: ba<KhongTham>(
    () => " (MÙ ⇒ con số này là CHẶN TRÊN, không phải trạng thái an toàn)",
    () => " (BLIND ⇒ this number is an UPPER BOUND, not a safe state; verify before loading anything)",
    () => "（盲态 ⇒ 该数字只是上界，并非安全状态；加载任何东西之前先核实）",
  ),
  degradedYes: ba<{ reasons: string }>(
    (p) => ` · ĐANG SUY GIẢM vì: ${p.reasons}.`,
    (p) => ` · DEGRADED because: ${p.reasons}. Clear these causes before you trust the headroom figure.`,
    (p) => ` · 正在降级，原因：${p.reasons}。请先消除这些原因，再采信余量数字。`,
  ),
  degradedNo: ba<KhongTham>(
    () => " · không lý do suy giảm nào.",
    () => " · no degradation reason.",
    () => " · 没有任何降级原因。",
  ),

  /**
   * ★★★ Pha 7 Task 2 — **CHẶNG CUỐI: BA Ô CỦA PHA 6 TASK 2 NAY TỚI ĐÚNG NGƯỜI CHÚNG BẢO VỆ.**
   *
   * ⚠⚠ Khoá `headroom` ở trên đã mang **câu** *"nó đang chảy"* — nhưng câu ấy là một **BẢN SAO VIẾT
   * TAY** của một sự thật mà payload đã mang sẵn ở `effective.notAnInvariant` / `variesWith` /
   * `beforeAfterEvidence`. Đo được ở Pha 7 Bước 1: ba ô ấy có **0 người đọc** (424 B/lượt ·
   * ≈298 KiB/giờ/panel), tức hai bản của **một** sự thật, và bản **có số liệu** thì không ai thấy.
   * ⇒ Dòng này in **chính ba ô ấy**: câu chữ nói *ý nghĩa*, tham số mang *nội dung máy đọc*.
   * ⚠ `p.varies` là danh sách **ĐƯỜNG DẪN** và `p.evidence` là một **NHÃN ASCII** (xem
   * `VRAM_BEFORE_AFTER_EVIDENCE`) — cả hai là **dữ liệu**, giống nhau ở ba ngôn ngữ, đúng luật
   * *"văn xuôi ⇒ khoá · định danh/dữ liệu ⇒ tham số"*.
   */
  effectiveFlowing: ba<{ notAnInvariant: string; varies: string; evidence: string }>(
    (p) =>
      `Con số hiệu lực là một đại lượng ĐANG CHẢY, và nó TỰ KHAI điều đó ` +
      `(notAnInvariant=${p.notAnInvariant}); nó đổi theo các ô: ${p.varies}, ` +
      `kể cả khi KHÔNG một byte nào đổi. Bằng chứng trước/sau DUY NHẤT chấp nhận được: ${p.evidence}. ` +
      `Đừng so hai lượt hỏi rồi kết luận "vừa nhả" hay "vừa chiếm".`,
    (p) =>
      `The effective figure is a FLOWING quantity and it DECLARES that itself ` +
      `(notAnInvariant=${p.notAnInvariant}); it moves with these fields: ${p.varies}, ` +
      `even when not a single byte changed. The only acceptable before/after evidence is: ${p.evidence}. ` +
      `Never diff two answers and call it "freed" or "taken".`,
    (p) =>
      `有效余量是流动量，并且它自我声明了这一点（notAnInvariant=${p.notAnInvariant}）；` +
      `它会随这些字段变化：${p.varies}，即使一个字节都没变也会变。` +
      `唯一可接受的前后对比证据是：${p.evidence}。` +
      `切勿比较两次回答就断定“刚释放”或“刚占用”。`,
  ),

  /**
   * ★★★ Pha 7 Task 2 — **DẤU ĐỌC: thứ làm hai lượt đọc KHÔNG BAO GIỜ bằng nhau, nay Agent thấy.**
   *
   * ⚠⚠ Đo được ở Pha 6 (#1): **18/20** cặp lượt đọc liên tiếp rơi vào **cùng một mili giây** ⇒ mốc
   * tường **TRÙNG ĐƯỢC**, và khi nó trùng thì một phép so *"y hệt nhau"* xanh **dù 5,27 GB vừa rời
   * sổ**. `readMark` (`${processKey}#${sốĐếmĐơnĐiệu}`) là thứ không trùng được. Với Agent —
   * người **chỉ nhận `textSummary`** — cả `readMark` lẫn `atMs`/`processKey` trước bản này đều
   * **vô hình**, nên nó không có cách nào phân biệt hai bản tóm tắt của hai lượt hỏi.
   * ⚠ Dòng này in **cả hai mốc** một cách CỐ Ý: mốc tường để trả lời *"bao giờ"*, dấu đọc để trả
   * lời *"có phải cùng một lượt đọc không"* — và câu nói thẳng rằng chỉ cái thứ hai làm được việc ấy.
   */
  /**
   * ⚠⚠ **M-3 của review — `readAtMs` KHÔNG CÒN ĐƯỢC IN NHƯ MỘT CON SỐ THỨ HAI.**
   * `readAtMs ≡ atMs` **theo cấu tạo** (`vramReadModel.ts` gán cùng một hằng) ⇒ bản trước in
   * **cùng một số hai lần trong một câu** — một người đọc dựng cho LƯỚI, không cho người đọc, tức
   * đúng hình dạng nhỏ của chính lớp lỗi Task này đóng. Nay ô ấy được đọc bằng một **PHÉP SO**, và
   * câu chỉ nêu con số khi phép so **LỆCH** — lúc đó nó mới là thông tin (một bất biến vừa vỡ).
   */
  snapshotMark: ba<{ processKey: string; atMs: string; readMark: string; mocDau: string }>(
    (p) =>
      `Ảnh chụp của tiến trình ${p.processKey} lúc ${p.atMs} ms · dấu đọc=${p.readMark} ` +
      `(${p.mocDau}). Hai lượt hỏi TRÙNG mốc tường được, nên muốn biết hai bản tóm tắt có phải ` +
      `cùng một lượt đọc hay không thì so DẤU ĐỌC, đừng so mốc tường.`,
    (p) =>
      `Snapshot from process ${p.processKey} at ${p.atMs} ms · read mark=${p.readMark} ` +
      `(${p.mocDau}). Two answers CAN share the same wall-clock millisecond, so compare the ` +
      `READ MARK, never the wall clock, to tell two reads apart.`,
    (p) =>
      `来自进程 ${p.processKey} 的快照，时刻 ${p.atMs} ms · 读取标记=${p.readMark}` +
      `（${p.mocDau}）。两次回答可能落在同一毫秒，` +
      `因此要区分两次读取请比较读取标记，不要比较墙上时钟。`,
  ),
  /** Mốc tường của dấu đọc **KHỚP** mốc ảnh chụp — trạng thái ĐÚNG theo cấu tạo. */
  markSameAsSnapshot: ba<KhongTham>(
    () => "mốc tường của dấu KHỚP mốc ảnh chụp",
    () => "the wall clock of that mark equals the snapshot time",
    () => "该标记的墙上时钟与快照时刻一致",
  ),
  /** ⚠ Mốc **LỆCH** — một bất biến của mặt đọc vừa vỡ; nêu SỐ vì lúc này nó mới là thông tin. */
  markDiffersFromSnapshot: ba<{ readAtMs: string }>(
    (p) =>
      `⚠ mốc tường của dấu LỆCH mốc ảnh chụp (${p.readAtMs} ms) — một bất biến của mặt đọc vừa vỡ, ` +
      `báo cho người vận hành thay vì tự chọn một trong hai mốc`,
    (p) =>
      `WARNING: the wall clock of that mark DIFFERS from the snapshot time (${p.readAtMs} ms) — ` +
      `an invariant of the read surface just broke; report it instead of picking one of the two marks`,
    (p) =>
      `⚠ 该标记的墙上时钟与快照时刻不一致（${p.readAtMs} ms）——读取面的一个不变量刚被破坏；` +
      `请上报，不要自行在两个时刻中挑一个`,
  ),

  /**
   * ★★★ Pha 7 Task 2 — **NĂM KHOẢN TRỪ: dựng lại được phép tính, không phải tin một con số vô danh.**
   *
   * ⚠ `headroom.charges.*` + `safetyReserveBytes` có **0 người đọc** trước bản này, trong khi ba
   * trong bốn khoản trừ nằm ngay ở `effective.variesWith` — tức chính chúng làm con số dư địa nhúc
   * nhích, và Agent không có cách nào biết **khoản nào** đang ăn dư địa.
   */
  charges: ba<{ stale: string; sharedLedger: string; unledgered: string; distrust: string; reserve: string }>(
    (p) =>
      `Các khoản TRỪ khỏi dư địa: biên quá hạn ${p.stale} · biên sổ chung ${p.sharedLedger} · ` +
      `phụ phí ngoài sổ ${p.unledgered} · phụ phí mất tin cậy ${p.distrust} · dự trữ an toàn ${p.reserve}. ` +
      `Khoản nào lớn bất thường thì chữa NGUYÊN NHÂN của nó, đừng đề nghị nới trần.`,
    (p) =>
      `Deductions applied to headroom: stale margin ${p.stale} · shared-ledger margin ${p.sharedLedger} · ` +
      `off-ledger charge ${p.unledgered} · distrust charge ${p.distrust} · safety reserve ${p.reserve}. ` +
      `If one of them is unusually large, fix its CAUSE instead of advising a higher ceiling.`,
    (p) =>
      `从余量中扣除的项目：过期余量 ${p.stale} · 共享账本余量 ${p.sharedLedger} · ` +
      `账本外附加 ${p.unledgered} · 失信附加 ${p.distrust} · 安全预留 ${p.reserve}。` +
      `若某一项异常偏大，请去解决它的成因，而不是建议调高上限。`,
  ),

  /**
   * ★★★ Pha 7 Task 2 — **CỬA SỔ MÙ XUYÊN TIẾN TRÌNH, viết bằng SỐ.**
   * `ledger.sharedRefreshIntervalMs` / `sharedStaleAfterMs` có **0 người đọc** trước bản này, dù
   * docstring của chúng đã nói đúng hậu quả: một giấy phép 17 GB vừa mở ở tiến trình anh em có thể
   * mất **trọn một chu kỳ** mới hiện ra ở đây, và trong cửa sổ đó **hai bên cùng tưởng card còn trống**.
   */
  sharedWindow: ba<{ refreshMs: string; staleAfterMs: string }>(
    (p) =>
      `Độ trễ cưỡng chế xuyên tiến trình: bản sao sổ chung làm mới mỗi ${p.refreshMs} ms, ` +
      `coi là quá hạn sau ${p.staleAfterMs} ms. Một giấy phép vừa mở ở tiến trình anh em có thể mất ` +
      `trọn một chu kỳ mới hiện ra ở đây — đừng khẳng định card còn trống trong cửa sổ đó.`,
    (p) =>
      `Cross-process enforcement lag: the shared-ledger replica refreshes every ${p.refreshMs} ms and ` +
      `is treated as stale after ${p.staleAfterMs} ms. A lease just opened in a sibling process may take ` +
      `a full cycle to appear here — do not assert the card is free inside that window.`,
    (p) =>
      `跨进程强制判定延迟：共享账本副本每 ${p.refreshMs} ms 刷新一次，超过 ${p.staleAfterMs} ms 视为过期。` +
      `兄弟进程刚开出的租约可能要等一整个周期才会出现在这里——在该窗口内不要断言显卡是空闲的。`,
  ),

  // ── QUY TRÁCH NHIỆM ────────────────────────────────────────────────────────────────────────
  attributableKnown: ba<{ bytes: string }>(
    (p) => `Quy trách nhiệm được (attributable): ${p.bytes}.`,
    (p) => `Attributable to known holders: ${p.bytes}.`,
    (p) => `可归因于已知占用者（attributable）：${p.bytes}。`,
  ),
  attributableUnknown: ba<{ reason: string; meaning: string }>(
    (p) => `attributable KHÔNG BIẾT (${p.reason}) ⇒ ${p.meaning}: dư địa đang là CHẶN TRÊN.`,
    (p) =>
      `attributable is UNKNOWN (${p.reason}) ⇒ ${p.meaning}: headroom is only an UPPER BOUND. ` +
      `Do not schedule a load against it — ask for a fresh measurement first.`,
    (p) =>
      `attributable 未知（${p.reason}）⇒ ${p.meaning}：余量只是上界。` +
      `不要据此排程加载，请先要求重新测量。`,
  ),

  // ── NỀN ────────────────────────────────────────────────────────────────────────────────────
  baseline: ba<{ verified: string; origin: string; unverified: string }>(
    (p) => `Nền (baseline): verified=${p.verified} · origin=${p.origin} · ${p.unverified}`,
    (p) =>
      `Baseline: verified=${p.verified} · origin=${p.origin} · ${p.unverified} ` +
      `Until the baseline is verified, every number derived from it inherits that doubt.`,
    (p) =>
      `基线（baseline）：verified=${p.verified} · origin=${p.origin} · ${p.unverified} ` +
      `在基线通过验证之前，由它派生出的每个数字都带着同样的不确定性。`,
  ),
  baselineOriginNone: ba<KhongTham>(
    () => "CHƯA CÓ NHỊP NÀO",
    () => "NO TICK HAS RUN",
    () => "尚未跑过任何节拍",
  ),
  baselineUnverifiedNull: ba<KhongTham>(
    () => "unverifiedReasons=null (CHƯA CÓ NHỊP NÀO — khác hẳn mảng rỗng).",
    () =>
      "unverifiedReasons=null (NO TICK HAS RUN — this is NOT an empty array; nothing has been checked yet, " +
      "so answer with unknown rather than with a clean bill of health).",
    () =>
      "unverifiedReasons=null（尚未跑过任何节拍——这不是空数组：还没做过任何检查，" +
      "请回答“未知”，不要报平安）。",
  ),
  baselineUnverifiedEmpty: ba<KhongTham>(
    () => "unverifiedReasons=[] (có nhịp, không lý do nào).",
    () => "unverifiedReasons=[] (a tick ran and found no reason).",
    () => "unverifiedReasons=[]（节拍跑过了，未发现任何原因）。",
  ),
  baselineUnverifiedList: ba<{ reasons: string }>(
    (p) => `unverifiedReasons: ${p.reasons}. Nền chưa được xác minh vì các lý do này — giải quyết xong rồi hãy trích dẫn số phái sinh.`,
    (p) => `unverifiedReasons: ${p.reasons}. Resolve these before quoting any derived number.`,
    (p) => `unverifiedReasons：${p.reasons}。在引用任何派生数字之前，请先解决它们。`,
  ),

  // ── SỔ ─────────────────────────────────────────────────────────────────────────────────────
  ledgerLocal: ba<{ local: string; total: string }>(
    (p) => `Sổ cục bộ: ${p.local} · tổng (cục bộ + anh em): ${p.total}.`,
    (p) => `Local ledger: ${p.local} · total (local + sibling processes): ${p.total}.`,
    (p) => `本地账本：${p.local} · 合计（本地 + 兄弟进程）：${p.total}。`,
  ),
  foreignBlind: ba<{ meaning: string }>(
    (p) =>
      `Sổ chung: ${p.meaning} — ĐANG MÙ về tiến trình anh em. ` +
      `TUYỆT ĐỐI không đọc thành "không ai khác giữ gì".`,
    (p) =>
      `Shared ledger: ${p.meaning} — BLIND to sibling processes. ` +
      `Never read this as "nobody else is holding anything": report sibling usage as unknown and refuse to promise free VRAM.`,
    (p) =>
      `共享账本：${p.meaning}——对兄弟进程处于盲态。` +
      `绝不可理解为“没有别人占用”：请把兄弟进程的占用如实报告为未知，不要承诺显存可用。`,
  ),
  /**
   * ★★★ I-2 (review TOÀN NHÁNH Pha 6) — **`truncatedIdentityWrites` NAY CÓ NGƯỜI ĐỌC.**
   *
   * ⚠⚠ Task 5 đưa lời khai *"sổ chung đã CẮT danh tính"* vào `ledger.foreign.truncatedIdentityWrites`
   * và đặt tên ca canh nó là *"lời khai phải TỚI ĐƯỢC NGƯỜI ĐỌC"* — nhưng đo lại: **0** điểm đọc ở
   * `client/**`, **0** ở `vramTools.ts`. Ô ấy chỉ **tới được một ô**, không tới được một người đọc.
   * Và **chính nhánh này** đã chứng minh nó không thể tới Agent: Task 2 đo và ghi rằng Agent **chỉ
   * nhận `textSummary`**. ⇒ Con số nay đi trong **dòng chữ**, chỗ Agent thật sự đọc.
   */
  foreignKnown: ba<{
    bytes: string;
    count: number;
    ageMs: string;
    stale: string;
    unsynced: string;
    fails: string;
    truncated: string;
  }>(
    (p) =>
      `Sổ chung (anh em): ${p.bytes} · ${p.count} hộ · tuổi bản sao ${p.ageMs} ms (stale=${p.stale}) · ` +
      `ghi chưa đồng bộ=${p.unsynced} · hỏng liên tiếp=${p.fails} · lượt ghi bị CẮT danh tính=${p.truncated}.`,
    (p) =>
      `Shared ledger (siblings): ${p.bytes} · ${p.count} holder(s) · replica age ${p.ageMs} ms (stale=${p.stale}) · ` +
      `unsynced writes=${p.unsynced} · consecutive failures=${p.fails} · writes with a TRUNCATED identity=${p.truncated}. ` +
      `If stale is true, re-read before you act on it.`,
    (p) =>
      `共享账本（兄弟进程）：${p.bytes} · ${p.count} 个占用者 · 副本年龄 ${p.ageMs} ms（stale=${p.stale}）· ` +
      `未同步写入=${p.unsynced} · 连续失败=${p.fails} · 身份被截断的写入=${p.truncated}。若 stale 为真，请先重新读取再据此行动。`,
  ),
  /**
   * ★★★ I-2 — dòng **HÀNH ĐỘNG** khi con số trên khác 0. Một con số trần không nói được hậu quả:
   * hộ mang danh tính cụt **không thu hồi được** vì `preempt({owner})` gửi chuỗi của **mặt đọc**
   * còn sổ giữ chuỗi **đã cắt** ⇒ hai chuỗi không khớp.
   */
  foreignTruncatedIdentity: ba<{ count: string }>(
    (p) =>
      `⚠ ${p.count} hàng trong sổ chung mang DANH TÍNH ĐÃ CẮT ⇒ những hộ ấy có thể KHÔNG thu hồi được: ` +
      `chuỗi \`owner\` của mặt đọc sẽ không khớp chuỗi đã cắt trong sổ. Đừng hứa thu hồi được chúng.`,
    (p) =>
      `WARNING: ${p.count} shared-ledger row(s) carry a TRUNCATED identity, so those holders may NOT be reclaimable: ` +
      `the owner string on the read surface will not match the truncated string in the ledger. Do not promise to reclaim them.`,
    (p) =>
      `⚠ 共享账本中有 ${p.count} 行的身份已被截断，这些占用方可能无法回收：` +
      `读取面的 owner 字符串与账本中被截断的字符串不一致。不要承诺能回收它们。`,
  ),
  /**
   * ★★★ Pha 7 Task 5 (B) — **VẾ THỨ BA của cùng một sự thật.** `identityTruncated` là `NULL` ⇒
   * người ghi hàng ấy **chưa biết cột này tồn tại** (một tiến trình bản CŨ còn sống).
   * ⚠ Câu này **KHÔNG** được gộp vào `foreignTruncatedIdentity`: *"đã cắt"* là một sự thật,
   *   *"không biết"* là **sự vắng mặt** của sự thật ấy — và cách xử lý cũng khác (một bên là đổi
   *   thư mục model, một bên là **nâng cấp nốt tiến trình còn lại**).
   */
  foreignUnknownIdentity: ba<{ count: string }>(
    (p) =>
      `⚠ ${p.count} hàng trong sổ chung do một tiến trình bản CŨ ghi ⇒ KHÔNG BIẾT danh tính của ` +
      `chúng có bị cắt hay không. Hãy coi \`owner\` của những hàng ấy là KHÔNG ĐÁNG TIN cho tới khi ` +
      `mọi tiến trình lên bản mới; đừng dùng chúng làm tham số lệnh.`,
    (p) =>
      `WARNING: ${p.count} shared-ledger row(s) were written by an OLD process, so it is UNKNOWN ` +
      `whether their identities were truncated. Treat those owner strings as UNTRUSTED until every ` +
      `process is upgraded; do not use them as command arguments.`,
    (p) =>
      `⚠ 共享账本中有 ${p.count} 行由旧版本进程写入，因此无法确定其身份是否被截断。` +
      `在所有进程升级前，请将这些 owner 字符串视为不可信；不要将它们用作命令参数。`,
  ),
  noHolders: ba<KhongTham>(
    () => 'Đang giữ (theo sổ): KHÔNG hộ nào — nhưng xem "CẬN DƯỚI" ngay dưới trước khi kết luận card trống.',
    () =>
      'Held (per ledger): NO holder — but read the "LOWER BOUND" line below before you conclude the card is empty.',
    () => "账本记录的占用：没有任何占用者——但在断定显卡是空的之前，请先看下面的“下界”那一行。",
  ),

  // ── HỘ ─────────────────────────────────────────────────────────────────────────────────────
  atThisProcess: ba<KhongTham>(
    () => "tiến trình NÀY",
    () => "THIS process",
    () => "本进程",
  ),
  atProcess: ba<{ processKey: string }>(
    (p) => `tiến trình ${p.processKey}`,
    (p) => `process ${p.processKey}`,
    (p) => `进程 ${p.processKey}`,
  ),
  reclaimHere: ba<{ owner: string; reclaimer: string }>(
    (p) => `vram.preempt("${p.owner}") VỚI TỚI (người thi hành: ${p.reclaimer})`,
    (p) =>
      `vram.preempt("${p.owner}") CAN reach it (reclaimer: ${p.reclaimer}) — ` +
      `ask the operator to press Preempt on the VRAM panel with exactly this owner string`,
    (p) =>
      `vram.preempt("${p.owner}") 可以触达（执行者：${p.reclaimer}）——` +
      `请让操作员在 VRAM 面板上用这一串 owner 原文点击“抢占”`,
  ),
  reclaimOwnerProcess: ba<{ reclaimer: string }>(
    (p) =>
      `CHỈ tiến trình chủ thu hồi được (đã khai ${p.reclaimer}); ` +
      `từ đây vram.preempt sẽ trả owner-not-in-local-ledger`,
    (p) =>
      `ONLY the owning process can reclaim this (declared reclaimer: ${p.reclaimer}); ` +
      `calling vram.preempt from here returns owner-not-in-local-ledger. ` +
      `That holder belongs to ANOTHER process — the command has to be issued in THAT process, ` +
      `so route the request there instead of retrying here`,
    (p) =>
      `只有持有方进程能回收它（已声明的执行者：${p.reclaimer}）；` +
      `从这里调用 vram.preempt 只会返回 owner-not-in-local-ledger。` +
      `该占用属于另一个进程——命令必须在那个进程里下达，` +
      `请把请求转到那边，不要在这里重试`,
  ),
  reclaimNone: ba<{ why: string }>(
    (p) => `KHÔNG lệnh nào với tới (${p.why})`,
    (p) =>
      `NO command can reach it (${p.why}) — do not spend a call; ` +
      `report it as unreclaimable from here and escalate to the operator`,
    (p) => `没有任何命令能触达（${p.why}）——不要浪费一次调用；请如实报告在此无法回收，并上报操作员`,
  ),
  ttl: ba<{ ttlMs: string; expired: string; note: string }>(
    (p) => ` · TTL ${p.ttlMs} ms, quá hạn=${p.expired}${p.note}`,
    (p) => ` · TTL ${p.ttlMs} ms, expired=${p.expired}${p.note}`,
    (p) => ` · TTL ${p.ttlMs} ms，已过期=${p.expired}${p.note}`,
  ),
  ttlExpiredNote: ba<KhongTham>(
    () => " (KHÔNG có nhịp nào tự gặt theo TTL — phải ra lệnh thu hồi)",
    () => " (NO tick harvests by TTL — expiry alone frees nothing, a reclaim command must be issued)",
    () => "（没有任何节拍会按 TTL 自动回收——光过期不释放任何东西，必须下达回收命令）",
  ),
  holderLine: ba<{
    owner: string;
    kind: string;
    priority: string;
    where: string;
    bytes: string;
    measured: string;
    leaseKeyPart: string;
    ttlPart: string;
    command: string;
    identityPart: string;
  }>(
    (p) =>
      `Hộ "${p.owner}" (${p.kind}, ${p.priority}) ở ${p.where}: ${p.bytes} · số đo=${p.measured}` +
      `${p.leaseKeyPart}${p.ttlPart}${p.identityPart} · ${p.command}.`,
    (p) =>
      `Holder "${p.owner}" (${p.kind}, ${p.priority}) on ${p.where}: ${p.bytes} · measured=${p.measured}` +
      `${p.leaseKeyPart}${p.ttlPart}${p.identityPart} · ${p.command}.`,
    (p) =>
      `占用者 "${p.owner}"（${p.kind}，${p.priority}）在 ${p.where}：${p.bytes} · 已测量=${p.measured}` +
      `${p.leaseKeyPart}${p.ttlPart}${p.identityPart} · ${p.command}。`,
  ),

  /**
   * ★★★ Pha 7 Task 5 (B) — **DANH TÍNH NÀY ĐÃ MẤT CHỮ. ĐỪNG DÙNG NÓ LÀM THAM SỐ LỆNH.**
   *
   * ⚠⚠⚠ VÌ SAO CÂU NÀY PHẢI CÓ MẶT — và đây là đường **THẬT SỰ ĐANG MỞ**, đã đo lại ở Bước 5:
   * `vramTools.tomTat()` gộp `localHolders` với `foreign.holders` rồi đưa `owner` của **cả hai**
   * vào `textSummary`; docstring của chính `vramTools` nói *"`owner` là DANH TÍNH mà Agent lấy từ
   * mặt đọc rồi truyền THẲNG vào `vram.preempt`"*. Với hộ **anh em**, chuỗi ấy **đã bị cắt tại DB**
   * ⇒ Agent gọi một lệnh phá huỷ bằng **một cái tên không phải tên của ai cả**, và lệnh ấy **im
   * lặng không khớp hộ nào**.
   *
   * ⚠⚠ **ĐÍNH CHÍNH MỘT CÂU TÔI ĐÃ VIẾT SAI Ở BƯỚC 2** (báo cáo §2.3(i)): mặt **NGƯỜI** KHÔNG đi
   * đường này. Nút *Thu hồi* chỉ render khi `reclaim.kind === "reclaimable-here"`, và `hoAnhEm()`
   * **không bao giờ** sinh ra nhãn ấy (nó chỉ cho `declared-by-owner-process` hoặc `no-reclaimer`)
   * ⇒ nút **không thể** gửi một danh tính cụt. Hai mặt, **hai mức phơi nhiễm khác nhau** — và phải
   * nói đúng từng mặt thay vì gộp cho câu chuyện gọn hơn.
   */
  identityTruncated: ba<{ fields: string }>(
    (p) =>
      ` · ⚠ DANH TÍNH ĐÃ BỊ CẮT khi lên sổ chung (ô: ${p.fields}) — chuỗi trên đây KHÔNG phải tên` +
      ` đầy đủ, ĐỪNG dùng nó làm tham số cho vram.preempt/vram.retryDeferred`,
    (p) =>
      ` · ⚠ IDENTITY WAS TRUNCATED when published to the shared ledger (fields: ${p.fields}) — the` +
      ` string above is NOT the full name, do NOT use it as an argument to vram.preempt/vram.retryDeferred`,
    (p) =>
      ` · ⚠ 发布到共享账本时身份被截断（字段：${p.fields}）——上面的字符串不是完整名称，` +
      `请勿将其用作 vram.preempt/vram.retryDeferred 的参数`,
  ),

  /**
   * ★★★ Pha 7 Task 5 (B) — **VẾ THỨ BA: KHÔNG BIẾT.** Hàng do một tiến trình **chưa biết cột
   * `identityTruncated`** ghi ⇒ ta **không có bằng chứng** tên này đủ hay cụt.
   * ⚠ Tách khỏi câu trên vì hai câu trả lời khác nhau: *"đã cắt"* là một **sự thật**, *"không
   *   biết"* là **sự vắng mặt của một sự thật**. Gộp chúng là bịa theo một trong hai chiều.
   */
  identityUnknown: ba<Record<string, never>>(
    () =>
      ` · ⚠ KHÔNG BIẾT danh tính này có bị cắt không (hàng do một tiến trình bản CŨ ghi) — hãy coi` +
      ` nó là KHÔNG ĐÁNG TIN cho tới khi mọi tiến trình lên bản mới`,
    () =>
      ` · ⚠ UNKNOWN whether this identity was truncated (row written by an OLD process) — treat it` +
      ` as UNTRUSTED until every process is upgraded`,
    () => ` · ⚠ 未知该身份是否被截断（该行由旧版本进程写入）——在所有进程升级前请视为不可信`,
  ),

  // ── NGOÀI SỔ ───────────────────────────────────────────────────────────────────────────────
  unattributed: ba<{
    bytes: string;
    caveat: string;
    lowerBound: string;
    wired: string;
    known: string;
    excludes: string;
  }>(
    (p) =>
      `Ngoài sổ (không quy trách nhiệm được): ${p.bytes} · caveat=${p.caveat} · ` +
      `holderListIsLowerBound=${p.lowerBound} (danh sách hộ trên là CẬN DƯỚI: mới nối ` +
      `${p.wired}/${p.known} điểm cấp phát) · ` +
      `excludesBaselineBytes=${p.excludes} (mọi byte trong NỀN đã bị trừ ⇒ số 0 KHÔNG nghĩa là card đã giải thích hết).`,
    (p) =>
      `Off-ledger (not attributable): ${p.bytes} · caveat=${p.caveat} · ` +
      `holderListIsLowerBound=${p.lowerBound} (the holder list above is a LOWER BOUND: only ` +
      `${p.wired}/${p.known} allocation sites are wired) · ` +
      `excludesBaselineBytes=${p.excludes} (every byte inside the BASELINE was already subtracted ⇒ a 0 here does NOT ` +
      `mean the card is fully explained). Never answer "the GPU is free" from this line alone.`,
    (p) =>
      `账本之外（无法归因）：${p.bytes} · caveat=${p.caveat} · ` +
      `holderListIsLowerBound=${p.lowerBound}（上面的占用者清单是下界：仅接入 ` +
      `${p.wired}/${p.known} 个分配点）· ` +
      `excludesBaselineBytes=${p.excludes}（基线内的每个字节都已扣除 ⇒ 这里为 0 并不代表显卡已被完全解释）。` +
      `切勿仅凭此行回答“显卡是空的”。`,
  ),
  unledgeredEstimateUsable: ba<{ bytes: string; kind: string; usable: string; unknownCount: string }>(
    (p) =>
      `Ước lượng chạy ngoài sổ: ${p.bytes} (estimateKind=${p.kind}, ` +
      `estimateUsable=${p.usable}, unknownCount=${p.unknownCount}).`,
    (p) =>
      `Off-ledger run estimate: ${p.bytes} (estimateKind=${p.kind}, ` +
      `estimateUsable=${p.usable}, unknownCount=${p.unknownCount}).`,
    (p) =>
      `账本外运行估算：${p.bytes}（estimateKind=${p.kind}，` +
      `estimateUsable=${p.usable}，unknownCount=${p.unknownCount}）。`,
  ),
  unledgeredEstimateUnusable: ba<{ bytes: string; kind: string; usable: string; unknownCount: string }>(
    (p) =>
      `Ước lượng chạy ngoài sổ: ${p.bytes} (estimateKind=${p.kind}, ` +
      `estimateUsable=${p.usable}, unknownCount=${p.unknownCount})` +
      ` ⇒ KHÔNG ĐÁNG TIN, đừng dùng để tính.`,
    (p) =>
      `Off-ledger run estimate: ${p.bytes} (estimateKind=${p.kind}, ` +
      `estimateUsable=${p.usable}, unknownCount=${p.unknownCount})` +
      ` ⇒ NOT TRUSTWORTHY, do not compute with it; report off-ledger usage as unknown.`,
    (p) =>
      `账本外运行估算：${p.bytes}（estimateKind=${p.kind}，` +
      `estimateUsable=${p.usable}，unknownCount=${p.unknownCount}）` +
      ` ⇒ 不可信，请勿用于计算；把账本外占用如实报告为未知。`,
  ),
  /** ★ I-1 — bản sinh đôi `beginFailuresWithReason` có hành động; bản này trước đó không. */
  beginFailuresNoReason: ba<{ count: string }>(
    (p) =>
      `Lượt cấp phát ngoài sổ (hàm beginVramAllocation) đã hỏng ${p.count} lượt, và KHÔNG lý do nào được ghi lại ` +
      `— số khác 0 ở đây nghĩa là có đường cấp phát đang hỏng mà không ai chẩn đoán được từ bản tóm tắt này.`,
    (p) =>
      `Off-ledger allocation attempts (function beginVramAllocation) have failed ${p.count} time(s), ` +
      `and NO reason was recorded — a non-zero count here means an allocation path is failing that this summary ` +
      `cannot diagnose; send the operator to the VRAM event log rather than guessing.`,
    (p) =>
      `账本外分配尝试（函数 beginVramAllocation）已失败 ${p.count} 次，且没有记录任何原因` +
      `——此处非零意味着有分配路径正在失败，而本摘要无法诊断；请让操作员去查 VRAM 事件日志，不要猜测。`,
  ),
  beginFailuresWithReason: ba<{ count: string; reason: string }>(
    (p) => `Lượt cấp phát ngoài sổ (hàm beginVramAllocation) đã hỏng ${p.count} lượt · lý do gần nhất: ${p.reason}`,
    (p) =>
      `Off-ledger allocation attempts (function beginVramAllocation) have failed ${p.count} time(s) · ` +
      `latest reason: ${p.reason} — clear that reason before you advise another load`,
    (p) =>
      `账本外分配尝试（函数 beginVramAllocation）已失败 ${p.count} 次 · ` +
      `最近原因：${p.reason}——在建议再次加载之前，请先解决该原因`,
  ),

  // ── NHỊP ───────────────────────────────────────────────────────────────────────────────────
  /**
   * ★ I-1 (review) — **KHOÁ NGUY HIỂM NHẤT LẠI LÀ KHOÁ IM NHẤT.** Bản trước chỉ dịch ĐỊNH DANH.
   * `stale` ở đây dùng **đúng `TICK_STALE_AFTER_MS`** mà `applyEnforcement()` dùng
   * (`vramEnforcement.ts:122`) ⇒ `stale=true` nghĩa là **mọi quyết định cấp/TỪ CHỐI đang chạy trên
   * dữ liệu quá hạn**, chứ không phải "một con số hơi cũ". Khoá anh em `tickAbsent` có hành động,
   * khoá này thì không — đúng chỗ cần nói nhất lại im.
   */
  tickPresent: ba<{ ageMs: string; staleAfterMs: string; stale: string; fails: string }>(
    (p) =>
      `Nhịp quyết định: tuổi ${p.ageMs} ms (ngưỡng ${p.staleAfterMs} ms, stale=${p.stale}) · ` +
      `hỏng liên tiếp=${p.fails}. Nếu stale=true thì phép cưỡng chế đang quyết trên dữ liệu quá hạn: ` +
      `nêu mọi con số dưới đây kèm chữ "quá hạn", đừng nói như một sự thật hiện thời.`,
    (p) =>
      `Decision tick: age ${p.ageMs} ms (threshold ${p.staleAfterMs} ms, stale=${p.stale}) · ` +
      `consecutive failures=${p.fails}. If stale is true, enforcement is deciding on expired data: ` +
      `label every number below as stale and do not state it as the present truth.`,
    (p) =>
      `决策节拍：年龄 ${p.ageMs} ms（阈值 ${p.staleAfterMs} ms，stale=${p.stale}）· ` +
      `连续失败=${p.fails}。若 stale 为真，说明强制判定正基于过期数据：` +
      `请把下面每个数字都标注为“已过期”，不要当作当前事实陈述。`,
  ),
  tickAbsent: ba<{ meaning: string }>(
    (p) => `Nhịp quyết định: ${p.meaning} — CHƯA CÓ NHỊP NÀO (cấu trúc, không tự lành).`,
    (p) =>
      `Decision tick: ${p.meaning} — NO TICK HAS EVER RUN (structural, it does not heal by itself; ` +
      `someone has to wire and start the tick before any of these numbers move).`,
    (p) =>
      `决策节拍：${p.meaning}——从未跑过任何节拍（这是结构性问题，不会自愈；` +
      `必须有人接入并启动节拍，这些数字才会变化）。`,
  ),

  // ── HOÃN ───────────────────────────────────────────────────────────────────────────────────
  deferScope: ba<{ scope: string; observedFrom: string; durableTrace: string }>(
    (p) => `Trạng thái hoãn — phạm vi ${p.scope}, quan sát từ ${p.observedFrom}; vết BỀN xuyên tiến trình: ${p.durableTrace}.`,
    (p) =>
      `Deferral state — scope ${p.scope}, observed from ${p.observedFrom}; ` +
      `DURABLE cross-process trace: ${p.durableTrace}.`,
    (p) => `延迟状态——范围 ${p.scope}，观察自 ${p.observedFrom}；跨进程持久痕迹：${p.durableTrace}。`,
  ),
  mechNoWait: ba<KhongTham>(
    () => "KHÔNG CÓ CƠ CHẾ CHỜ (suy giảm tại chỗ, ngân sách 0)",
    () => "NO WAIT MECHANISM (it degrades in place, zero budget — retrying will not buy time)",
    () => "没有等待机制（就地降级，预算为 0——重试也换不来时间）",
  ),
  mechWaitRetry: ba<{ budgetMs: string }>(
    (p) => `có chờ + thử lại (đáy ${p.budgetMs} ms)`,
    (p) => `waits and retries (floor ${p.budgetMs} ms)`,
    (p) => `有等待并重试（下限 ${p.budgetMs} ms）`,
  ),
  /**
   * ★ I-1 — khoá anh em `statusExceeded` có hành động; khoá này trước đó chỉ dịch định danh.
   *
   * ★★★ Pha 7 Task 2 — **BỐN Ô CỦA MỘT CHUỖI HOÃN ĐANG SỐNG NAY ĐI CÙNG NÓ.**
   * `status.owner` / `firstRefusedAt` / `chainBudgetMs` / `lastRefusalMessage` có **0 người đọc**
   * trước bản này. `owner` là ô nặng nhất: với **5/6 hộ**, `retryReach.owner` **không tồn tại**
   * (nhánh `unreachable` cố ý không mang danh tính), nên `status.owner` là chuỗi **DUY NHẤT** trên
   * cả mặt đọc nói được *"chuỗi hoãn này là của ai"* — thiếu nó, Agent tả một sự cố mà không gọi
   * được tên thủ phạm. `chainBudgetMs` cũng **không** thay được bằng `budgetMs` của dòng hộ: một
   * cái là ngân sách **CHỐT LÚC BỊ TỪ CHỐI** (điều khiển hạn chót đang chạy), cái kia là **đáy cấu
   * hình HIỆN TẠI** — M-7 đã tách hai ô đúng vì lý do đó.
   */
  statusDeferring: ba<{
    attempts: string;
    nextRetryAt: string;
    owner: string;
    firstRefusedAt: string;
    chainBudgetMs: string;
    lastRefusal: string;
  }>(
    (p) =>
      `ĐANG HOÃN (${p.attempts} lượt, hạn kế ${p.nextRetryAt}) — chờ tới hạn đó, đừng đề nghị nạp thêm gì lúc này` +
      ` · chuỗi của owner="${p.owner}", bị từ chối lần đầu lúc ${p.firstRefusedAt}, ` +
      `ngân sách CHỐT LÚC BỊ TỪ CHỐI=${p.chainBudgetMs} ms (không phải đáy cấu hình hiện tại)` +
      ` · lý do từ chối gần nhất: ${p.lastRefusal}`,
    (p) =>
      `DEFERRING (${p.attempts} attempt(s), next deadline ${p.nextRetryAt}) — ` +
      `wait for that deadline; do not advise loading anything else in the meantime` +
      ` · chain owner="${p.owner}", first refused at ${p.firstRefusedAt}, ` +
      `budget FROZEN AT REFUSAL TIME=${p.chainBudgetMs} ms (not the currently configured floor)` +
      ` · latest refusal reason: ${p.lastRefusal}`,
    (p) =>
      `正在延迟（已 ${p.attempts} 次，下次期限 ${p.nextRetryAt}）——请等到该期限，在此期间不要建议再加载任何东西` +
      ` · 该链的 owner="${p.owner}"，首次被拒时间 ${p.firstRefusedAt}，` +
      `拒绝时冻结的预算=${p.chainBudgetMs} ms（不是当前配置的下限）` +
      ` · 最近一次拒绝原因：${p.lastRefusal}`,
  ),
  /** ★★★ Pha 7 Task 2 — cùng bốn ô với `statusDeferring` (xem khối ở khoá ấy). */
  statusExceeded: ba<{
    attempts: string;
    owner: string;
    firstRefusedAt: string;
    chainBudgetMs: string;
    lastRefusal: string;
  }>(
    (p) =>
      `ĐÃ QUÁ ĐÁY HOÃN (${p.attempts} lượt)` +
      ` · chuỗi của owner="${p.owner}", bị từ chối lần đầu lúc ${p.firstRefusedAt}, ` +
      `ngân sách CHỐT LÚC BỊ TỪ CHỐI=${p.chainBudgetMs} ms` +
      ` · lý do từ chối gần nhất: ${p.lastRefusal}`,
    (p) =>
      `PAST THE DEFERRAL FLOOR (${p.attempts} attempt(s)) — more waiting will not help, free VRAM instead` +
      ` · chain owner="${p.owner}", first refused at ${p.firstRefusedAt}, ` +
      `budget FROZEN AT REFUSAL TIME=${p.chainBudgetMs} ms` +
      ` · latest refusal reason: ${p.lastRefusal}`,
    (p) =>
      `已超出延迟下限（已 ${p.attempts} 次）——继续等待没有用，请改为释放显存` +
      ` · 该链的 owner="${p.owner}"，首次被拒时间 ${p.firstRefusedAt}，` +
      `拒绝时冻结的预算=${p.chainBudgetMs} ms` +
      ` · 最近一次拒绝原因：${p.lastRefusal}`,
  ),
  statusNoChain: ba<KhongTham>(
    () => "không có chuỗi hoãn nào TRONG TIẾN TRÌNH NÀY",
    () => "no deferral chain IN THIS PROCESS",
    () => "本进程内没有任何延迟链",
  ),
  statusUnobservable: ba<{ meaning: string }>(
    (p) => `KHÔNG QUAN SÁT ĐƯỢC Ở ĐÂY (${p.meaning})`,
    (p) => `NOT OBSERVABLE FROM HERE (${p.meaning}) — answer "unknown", never "not deferring"`,
    (p) => `在这里无法观察（${p.meaning}）——请回答“未知”，绝不能说“没有在延迟”`,
  ),
  /**
   * ★★★ Pha 5 Task 5 (N12) — **THAM SỐ LÀ `owner` (DANH TÍNH), KHÔNG CÒN LÀ `ownerPattern` (MẪU).**
   * Câu cũ đưa cho Agent một **mẫu** (`gguf-embed-ctx:<modelId>`) ngay trong câu bảo *"gọi được"* —
   * tức mời nó truyền một mẫu vào chỗ đòi một danh tính. Nay câu này mang **đúng chuỗi** mà
   * `vram.retryDeferred` nhận (`retryReach.owner`).
   */
  retryReachable: ba<{ owner: string }>(
    (p) => `vram.retryDeferred VỚI TỚI — gọi với owner="${p.owner}"`,
    (p) =>
      `vram.retryDeferred CAN reach it — call it with owner="${p.owner}", ` +
      `or ask the operator to press Retry deferred on the VRAM panel`,
    (p) => `vram.retryDeferred 可以触达——请以 owner="${p.owner}" 调用，或让操作员在 VRAM 面板点击“重试延迟项”`,
  ),
  retryUnknown: ba<{ why: string }>(
    (p) => `không rõ lệnh có với tới không (${p.why})`,
    (p) => `unclear whether the command reaches it (${p.why}) — verify before you promise anything`,
    (p) => `不确定命令能否触达（${p.why}）——在做出任何承诺之前请先核实`,
  ),
  retryUnreachable: ba<{ why: string }>(
    (p) => `vram.retryDeferred KHÔNG với tới (${p.why}) — đừng tốn một lượt gọi`,
    (p) =>
      `vram.retryDeferred does NOT reach it (${p.why}) — do not spend a call; ` +
      `this host can only be retried in the process that runs it`,
    (p) => `vram.retryDeferred 触达不到（${p.why}）——不要浪费一次调用；该宿主只能在运行它的进程里重试`,
  ),
  deferHostLine: ba<{
    host: string;
    ownerPattern: string;
    mechanism: string;
    hostedHere: string;
    status: string;
    reach: string;
  }>(
    (p) =>
      `Hộ nền "${p.host}" (${p.ownerPattern}): ${p.mechanism} · chủ trì ở đây=${p.hostedHere} · ` +
      `${p.status} · ${p.reach}.`,
    (p) =>
      `Background host "${p.host}" (${p.ownerPattern}): ${p.mechanism} · hosted here=${p.hostedHere} · ` +
      `${p.status} · ${p.reach}.`,
    (p) =>
      `后台宿主 "${p.host}"（${p.ownerPattern}）：${p.mechanism} · 本进程托管=${p.hostedHere} · ` +
      `${p.status} · ${p.reach}。`,
  ),
  hostedHereUnknown: ba<KhongTham>(
    () => "KHÔNG XÁC ĐỊNH ĐƯỢC",
    () => "CANNOT BE DETERMINED",
    () => "无法确定",
  ),

  // ── Ô BỊ CHẶN ──────────────────────────────────────────────────────────────────────────────
  nonFiniteNone: ba<KhongTham>(
    () => "nonFiniteFields: không ô số nào bị chặn.",
    () => "nonFiniteFields: no numeric cell was blocked.",
    () => "nonFiniteFields：没有任何数字单元被拦截。",
  ),
  nonFiniteSome: ba<{ count: number; fields: string }>(
    (p) => `nonFiniteFields: ${p.count} ô BỊ CHẶN (fail-closed HỢP LỆ, không phải dữ liệu thiếu): ${p.fields}`,
    (p) =>
      `nonFiniteFields: ${p.count} cell(s) BLOCKED (a VALID fail-closed, not missing data — ` +
      `report the block, do not substitute a zero): ${p.fields}`,
    (p) => `nonFiniteFields：${p.count} 个单元被拦截（这是合法的 fail-closed，不是数据缺失——请如实报告拦截，不要用 0 顶替）：${p.fields}`,
  ),

  // ── BA LỆNH KHÔNG PHẢI TOOL ────────────────────────────────────────────────────────────────
  commandsNotTools: ba<KhongTham>(
    () =>
      "⚠ Ba lệnh vram.preempt / vram.releaseStale / vram.retryDeferred KHÔNG được đăng ký làm tool " +
      "(chúng phá huỷ được, nên không treo sau một bộ phân loại ý định). Agent ĐỌC ở đây rồi ĐỀ NGHỊ " +
      "người vận hành bấm nút tương ứng trong panel VRAM của màn AI Brain; tuyệt đối không khai là đã tự chạy.",
    () =>
      "⚠ The three commands vram.preempt / vram.releaseStale / vram.retryDeferred are NOT registered as tools " +
      "(they are destructive, so they are not hung behind an intent classifier). Read here, then TELL THE OPERATOR " +
      "to press the matching button in the VRAM panel of the AI Brain screen; never claim you ran them yourself.",
    () =>
      "⚠ vram.preempt / vram.releaseStale / vram.retryDeferred 这三条命令未注册为工具" +
      "（它们具有破坏性，不能挂在意图分类器之后）。请在此读取后，建议操作员到 AI Brain 页面的 VRAM 面板点击相应按钮；" +
      "绝不可声称自己已经执行。",
  ),

  // ── PHỤ TRỢ (ngoài `tomTat`, nhưng cùng một bề mặt câu chữ) ────────────────────────────────
  unknownNumber: ba<KhongTham>(
    () => "KHÔNG BIẾT",
    () => "UNKNOWN",
    () => "未知",
  ),
  truncatedField: ba<{ keep: number; total: number }>(
    (p) => `…[đã cắt, còn ${p.keep}/${p.total} ký tự — ảnh chụp data.state giữ nguyên văn]`,
    (p) => `…[truncated, kept ${p.keep}/${p.total} chars — the data.state snapshot keeps the value verbatim]`,
    (p) => `…[已截断，保留 ${p.keep}/${p.total} 个字符——data.state 快照保留原文]`,
  ),
  /**
   * ★★★ Pha 5 Task 5 (N11) — **KHÁC NGHĨA VỚI `truncatedField`, KHÔNG PHẢI MỘT BẢN SAO CỦA NÓ.**
   * `truncatedField` hứa *"data.state còn nguyên văn"* — đúng cho một ô **DANH TÍNH/thô**. Ô
   * **HIỂN THỊ** thì mặt đọc đã cắt **TẠI NGUỒN**, nên bản đầy đủ **không còn ở đâu trong payload**;
   * dùng lại câu kia ở đây là chỉ người đọc đi tìm một thứ không tồn tại.
   */
  truncatedFieldAtSource: ba<{ keep: number; total: number }>(
    (p) =>
      `…[đã cắt TẠI NGUỒN, còn ${p.keep}/${p.total} ký tự — bản đầy đủ KHÔNG có ở data.state; ` +
      `xem log của tiến trình nếu cần nguyên văn]`,
    (p) =>
      `…[truncated AT THE SOURCE, kept ${p.keep}/${p.total} chars — the full value is NOT in ` +
      `data.state either; read the process log if you need it verbatim]`,
    (p) =>
      `…[已在源头截断，保留 ${p.keep}/${p.total} 个字符——完整内容也不在 data.state 中；` +
      `如需原文请查看进程日志]`,
  ),
  summaryTruncated: ba<{ dropped: number; total: number; cap: number }>(
    (p) =>
      `⚠ BẢN TÓM TẮT ĐÃ BỊ CẮT: bỏ ${p.dropped}/${p.total} dòng vì vượt trần ${p.cap} ký tự ngữ cảnh. ` +
      `Ảnh chụp ĐẦY ĐỦ nằm ở data.state — đọc nó trước khi kết luận.`,
    (p) =>
      `⚠ SUMMARY TRUNCATED: dropped ${p.dropped}/${p.total} lines over the ${p.cap}-character context cap. ` +
      `The FULL snapshot is in data.state — read it before you conclude anything.`,
    (p) =>
      `⚠ 摘要已被截断：因超出 ${p.cap} 字符的上下文上限，丢弃了 ${p.dropped}/${p.total} 行。` +
      `完整快照在 data.state 中——请先读取再下结论。`,
  ),
  title: ba<KhongTham>(
    () => "Trạng thái bộ điều phối VRAM",
    () => "VRAM broker state",
    () => "VRAM 调度器状态",
  ),
  deny: ba<KhongTham>(
    () => 'Bạn không có quyền xem trạng thái bộ điều phối VRAM ("machine_control"). Liên hệ quản trị viên.',
    () => 'You do not have permission to view VRAM broker state ("machine_control"). Contact an administrator.',
    () => "您无权查看 VRAM 调度器状态（machine_control）。请联系管理员。",
  ),
} as const;

export type VramPhraseKey = keyof typeof CAU;

/** Danh sách khoá — **suy ra từ chính bảng**, nên nó KHÔNG phải một vế đối chiếu độc lập. */
export const VRAM_PHRASE_KEYS = Object.keys(CAU) as VramPhraseKey[];
