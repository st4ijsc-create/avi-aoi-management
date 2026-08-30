# Extension VSCode cho AI Local — ĐỢT D (tác nhân đa bước ở client)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ở **chế độ LOCAL**, cho AI **tự đọc mã trong workspace** rồi mới đề xuất sửa: vòng lặp
đa bước ở client với tool cục bộ (`doc_tep` · `liet_ke` · `grep`), `@`-mention để chỉ tệp, và nút
**Dừng** cắt được thật.

**Architecture:** Vòng lặp chạy **ở client**, không ở máy chủ (máy chủ không thấy mã của dev, và
vòng tool phía nó có trần 20 giây — spec §3). Mỗi lượt: gửi câu hỏi → model trả lời → nếu có khối
`avi-tool` yêu cầu đọc thì **extension đọc cục bộ** → nối kết quả vào lượt kế → lặp tới trần.
Đề xuất **ghi** vẫn đi nguyên đường Đợt C: `docDeXuatCucBo` → thẻ duyệt → diff → `apBanVa`.

**Tech Stack:** TypeScript · esbuild · VSCode `workspace.fs`/`findFiles` · `AbortSignal` ·
`shared/aiCodingLoop` (trần vòng dùng chung) · vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-vscode-extension-ai-local-design.md` (§5.3, §5.4, §10)

**Nền:** Đợt A `78a753c8` · Đợt B `0cbd1dd5` · Đợt C `55d85632` — **268 lưới**, migration tới
`0343`, census giữ **đúng MỘT** điểm ghi đĩa.

## Hợp đồng ĐÃ ĐO trên mã thật (dùng nguyên, KHÔNG đoán lại)

| Thứ | Sự thật đo được | Nguồn |
|---|---|---|
| Trần vòng lặp | `TRAN_VONG_MAC_DINH=3`, `TRAN_VONG_TOI_DA=5`, `kepTranVong()` kẹp về `[1..5]` | `shared/aiCodingLoop.ts:51-64` |
| Hàng rào gửi | `duocPhepGuiNoiDung` + `cheBiMat` (che `sk-`/`AKIA`/JWT/chuỗi kết nối/PEM) | `src/loi/nguCanh.ts` |
| Huỷ luồng | `moDongSse({tinHieu})` đã nối `AbortSignal`; huỷ ⇒ ném `AbortError` (đo ở Đợt A) | `src/mang/dongSse.ts` |
| Parser khối | `docDeXuatCucBo` đọc hàng rào ` ```avi-tool `, đã vá `null` + CRLF; **bỏ qua** tool lạ | `src/loi/deXuatCucBo.ts:52-60` |
| Điểm ghi | **đúng MỘT** `applyEdit`/`WorkspaceEdit` tại `ui/apBanVa.ts`, census đếm số lần | `src/loi/census.unit.test.ts` |

## Global Constraints

- ★★★ **KHÔNG được thêm điểm ghi đĩa thứ hai.** Census phải giữ nguyên `toBe(1)` tại
  `ui/apBanVa.ts`. Tool của đợt này **CHỈ ĐỌC**. Nếu census đỏ vì bạn, bạn đã đi sai đường.
- ★★★ **Mọi byte rời máy dev phải qua hàng rào gửi.** Kết quả `doc_tep`/`grep` được gửi lên máy
  chủ ⇒ phải đi qua `duocPhepGuiNoiDung` (chặn `.env*`/khoá riêng) **và** `cheBiMat`. Đây là mặt
  rò lớn nhất của đợt: Đợt A từng để lọt tệp khoá riêng và chuỗi kết nối.
- **KHÔNG ghi vào `sandbox-projects/`** (đề thi) · **KHÔNG sửa `.env`** · **KHÔNG chạy migration**.
- `src/loi/` và `src/ui/htmlBang.ts` **không import `vscode`**.
- **Commit SURGICAL** — tiến trình khác commit song song trên cùng nhánh.
- Tên hàm/biến tiếng Việt không dấu; chuỗi hiển thị tiếng Việt; bình luận giải thích VÌ SAO.
- **Mồi thử không được khớp khuôn khoá thật** (Push Protection đã chặn một lượt push ở Đợt A).
- ★★★ **Vá xong phải kiểm NHÁNH KIA** của chính chỗ vừa vá — khuôn rút ra từ Đợt C, nơi bản vá
  lần năm đẻ ra lỗi lần sáu vì chỉ cài luật ở một phía.

---

### Task 1: Tách bộ đọc hàng rào dùng chung + parser yêu cầu ĐỌC (THUẦN)

**Files:** Create `src/loi/khoiAviTool.ts` + test · Create `src/loi/yeuCauDoc.ts` + test ·
Modify `src/loi/deXuatCucBo.ts` (dùng lại bộ tách, **không đổi hành vi**)

**Vì sao tách:** `deXuatCucBo.ts` đã mang ba bài học đắt (bỏ qua `null` là JSON hợp lệ · nhận
CRLF · không đoán khi thiếu trường). Chép regex hàng rào sang tệp thứ hai là **dựng lại bản sao
thứ hai của một vị từ an toàn** — đúng cái bẫy `daBiTuChoiGhi` đã cảnh báo, và bản lỏng hơn bao
giờ cũng là bản đang chạy.

**Produces:**
```ts
// khoiAviTool.ts — MỘT nơi duy nhất biết cú pháp hàng rào
export function tachKhoiAviTool(vanBan: string): Array<{ tool: string; args: Record<string, unknown> }>;
// yeuCauDoc.ts
export type YeuCauDoc =
  | { loai: "doc_tep"; path: string }
  | { loai: "liet_ke"; path: string }
  | { loai: "grep"; mau: string; path?: string };
export function docYeuCauDoc(vanBan: string): YeuCauDoc[];
```

- [ ] **Step 1:** viết lưới cho `tachKhoiAviTool` — phải phủ lại **đúng các ca đã trả giá**:
      `null`/số/chuỗi/mảng là JSON hợp lệ ⇒ bỏ qua, **KHÔNG ném** · CRLF đọc được như LF · nhiều
      khối · khối hỏng không làm mất khối hợp lệ sau nó · hàng rào không đóng ⇒ bỏ qua.
- [ ] **Step 2:** chạy → ĐỎ. **Step 3:** cài `khoiAviTool.ts`.
- [ ] **Step 4:** **sửa `deXuatCucBo.ts` dùng bộ tách chung** — chạy lại **toàn bộ 11 ca cũ của
      nó**, tất cả phải CÒN XANH. Nếu một ca cũ đỏ ⇒ DỪNG và báo, **đừng sửa ca cũ cho hợp mã mới**.
- [ ] **Step 5:** lưới + cài `yeuCauDoc.ts`. Ca bắt buộc: đọc đủ ba loại · thiếu trường ⇒ bỏ qua ·
      `mau` rỗng ⇒ bỏ qua · tool ghi (`de_xuat_sua*`) ⇒ **không** lọt vào đây (hai parser không
      giẫm chân nhau).
- [ ] **Step 6:** ĐỘT BIẾN — bỏ phép chặn `null` trong bộ tách chung ⇒ ca `null` phải ĐỎ **ở CẢ
      HAI** tệp lưới (chứng minh cả hai parser thật sự dùng chung một bộ tách).
- [ ] **Step 7:** commit.

---

### Task 2: Ba tool ĐỌC cục bộ (I/O, có hàng rào gửi)

**Files:** Create `src/mang/toolCucBo.ts` (hoặc `src/ui/` nếu cần `vscode`) + test cho phần thuần

**Produces:** `chayToolCucBo(y: YeuCauDoc, thuMucWorkspace: string[]): Promise<{ ok: true; ketQua: string } | { ok: false; lyDo: string }>`

Ba tool, **CHỈ ĐỌC**:
- `doc_tep` — đọc tệp trong workspace. **Trần byte** (mặc định 64 KB); vượt ⇒ cắt và **KHAI là đã
  cắt** (im lặng cắt là đưa model một sự thật một nửa).
- `liet_ke` — liệt kê tệp trong một thư mục (dùng `workspace.findFiles`), **trần số mục**, khai
  khi bị cắt.
- `grep` — tìm chuỗi trong workspace; **trần số kết quả**; mỗi kết quả có đường dẫn + số dòng.

**Hàng rào bắt buộc (đây là mặt rò của đợt):**
1. Đường dẫn phải **trong workspace** — dùng lại vị từ đã có, **không viết bản thứ hai**.
2. **Bỏ tệp bị cấm gửi** (`duocPhepGuiNoiDung`) khỏi mọi kết quả — cả `doc_tep`, `liet_ke`, `grep`.
   ⚠ `grep` nguy hiểm nhất: nó có thể **trích một dòng từ `.env`** dù không đọc cả tệp.
3. **`cheBiMat` mọi nội dung trả về** trước khi nó rời hàm.

- [ ] **Step 1:** lưới ĐỎ trước cho phần thuần (lọc + cắt + che). Ca bắt buộc: `.env` bị loại khỏi
      `liet_ke` · `grep` **không trả dòng nào từ `.env`** · nội dung có `sk-…` bị che · vượt trần
      ⇒ có chữ "đã cắt" · tệp ngoài workspace ⇒ từ chối.
- [ ] **Step 2-4:** ĐỎ → cài → XANH.
- [ ] **Step 5:** ĐỘT BIẾN — bỏ `cheBiMat` ⇒ ca khoá phải ĐỎ; bỏ lọc `.env` ⇒ ca grep phải ĐỎ.
- [ ] **Step 6:** **census phải vẫn XANH** (ba tool này chỉ đọc). Commit.

---

### Task 3: Vòng lặp tác nhân ở client

**Files:** Create `src/loi/vongTacNhan.ts` (THUẦN — quyết định, không I/O) + test ·
Modify `src/ui/bangChat.ts` (nối vào)

**Produces (thuần, đo được):**
```ts
export type BuocVong =
  | { loai: "goi_model"; lichSu: LuotChat[] }
  | { loai: "chay_tool"; yeuCau: YeuCauDoc[] }
  | { loai: "dung"; lyDo: "het_tran" | "khong_con_tool" | "nguoi_dung_dung" | "loi" };
export function buocKeTiep(tt: { vong: number; tran: number; coYeuCauDoc: boolean; biHuy: boolean; coLoi: boolean }): BuocVong;
```

Tách phần **quyết định** khỏi phần **thực thi** để đo được vòng lặp mà không cần mạng.

- [ ] **Step 1:** lưới ĐỎ trước. Ca bắt buộc: hết trần ⇒ dừng với `het_tran` · không còn yêu cầu
      đọc ⇒ dừng `khong_con_tool` · bị huỷ ⇒ dừng **NGAY** kể cả khi còn tool và còn trần ·
      có lỗi ⇒ dừng `loi` · **thứ tự ưu tiên**: huỷ thắng mọi thứ khác.
- [ ] **Step 2-4:** ĐỎ → cài → XANH. Dùng `kepTranVong` từ `shared/aiCodingLoop`, **không tự đặt
      hằng số mới**.
- [ ] **Step 5: ĐỘT BIẾN** — cho `biHuy` thua `coYeuCauDoc` ⇒ ca "huỷ thắng" phải ĐỎ.
- [ ] **Step 6:** nối vào `bangChat.ts`: mỗi lượt gọi `docYeuCauDoc`; có yêu cầu ⇒ chạy
      `chayToolCucBo` → nối kết quả làm lượt kế → lặp. Hiện **số vòng đang chạy** cho người dùng
      (`vòng 2/3`) — người dùng phải thấy nó đang làm gì.
      ⚠ Đề xuất **ghi** vẫn đi đường Đợt C, **không** được xử lý trong vòng này.
- [ ] **Step 7:** cổng + commit.

---

### Task 4: Nút DỪNG cắt được thật

**Files:** Modify `src/ui/htmlBang.ts` (+ test), `src/ui/bangChat.ts`

Nút Dừng phải cắt **cả luồng SSE đang chạy lẫn vòng lặp**, và phải nói thật: đã dừng ở vòng mấy.

- [ ] **Step 1:** lưới cho khung HTML: có nút Dừng · chỉ hiện khi đang chạy.
- [ ] **Step 2:** nối `AbortController` sẵn có; bấm Dừng ⇒ `abort()` + đặt cờ `biHuy` cho vòng lặp.
- [ ] **Step 3:** ★ **`AbortError` KHÔNG được khai thành lỗi** — Đợt A đã trả giá đúng chỗ này
      (huỷ lượt hiện thành bong bóng "Lỗi" chữ tiếng Anh). Người dùng bấm Dừng thì phải thấy
      "đã dừng", không phải "lỗi".
- [ ] **Step 4:** PHÉP ĐO: bấm Dừng giữa vòng 2 ⇒ **không** có lượt gọi model thứ ba, và **không**
      có tool nào chạy thêm. Ghi output thật.
- [ ] **Step 5:** commit.

---

### Task 5: `@`-mention chỉ tệp

**Files:** Modify `src/ui/htmlBang.ts` (+ test), `src/ui/bangChat.ts` · có thể thêm vị từ thuần

- [ ] **Step 1:** gõ `@` trong ô nhập ⇒ hiện danh sách tệp trong workspace (lọc theo chữ đang gõ).
- [ ] **Step 2:** ★ **chèn đường dẫn SẠCH, KHÔNG kèm `@`** — bài học đã trả giá ở
      `/ai-coding-workspace`: chèn `@src/…` làm model đọc hỏng MỌI lượt.
      **Đừng** lột `@` ở phía phân giải (đường dẫn `@types/…` là hợp lệ).
- [ ] **Step 3:** tệp được `@`-mention đi qua **đúng hàng rào gửi** như tool đọc (Task 2).
- [ ] **Step 4:** lưới cho vị từ lọc + ca "đường dẫn sạch". Commit.

---

### Task 6: Nghiệm thu LIVE + đo TỈ LỆ TUÂN THỦ GIAO THỨC

**Files:** Create `docs/superpowers/plans/2026-08-30-vscode-extension-dot-d-ket-qua.md`

★★★ Rủi ro số một của đợt này đã ghi trong spec §5.3: **model 30B có thể không tuân giao thức tự
chế**. Kế hoạch nói sẽ **đo bằng nghiệm thu live**, không tuyên bố suông. Đây là lúc trả nợ đó.

- [ ] **Step 1:** dựng workspace thử trong scratchpad (**không** đụng `sandbox-projects/`).
- [ ] **Step 2 — ĐO TUÂN THỦ:** chạy **ít nhất 10 lượt hỏi thật** buộc phải đọc tệp mới trả lời
      được. Đếm: bao nhiêu lượt model phát khối `avi-tool` **đúng cú pháp**; bao nhiêu lượt sai;
      bao nhiêu lượt bỏ qua giao thức và trả lời suông. **Ghi con số thật**, dù xấu.
- [ ] **Step 3:** đo vòng lặp: một câu hỏi cần **≥2 vòng** có chạy đủ không; trần có chặn đúng không.
- [ ] **Step 4:** đo hàng rào gửi trên dữ liệu thật: đặt một tệp `.env` và một khoá giả trong
      workspace thử, hỏi câu khiến model muốn grep cả repo ⇒ chứng minh **không byte bí mật nào
      rời máy** (đo trên nội dung THẬT được gửi, không đo ý định).
- [ ] **Step 5:** đo nút Dừng giữa chừng.
- [ ] **Step 6:** dọn sạch; `git status --short sandbox-projects/` phải RỖNG.
- [ ] **Step 7:** viết tệp kết quả với số đo thật + phần **chưa xác minh** ghi thẳng. Commit.

---

## Cổng ra Đợt D

- [ ] `ext:check` 0 lỗi · `ext:build` OK · trọn bộ lưới xanh (hiện 268 + ca mới).
- [ ] **Census KHÔNG đổi**: vẫn đúng MỘT `applyEdit`/`WorkspaceEdit` tại `ui/apBanVa.ts`, và
      `fs.*` vẫn = 0. Đợt này **không** mở đường ghi nào.
- [ ] Hàng rào gửi: chứng minh trên dữ liệu THẬT rằng `.env`/khoá riêng **không** lọt qua
      `doc_tep`/`liet_ke`/`grep`/`@`-mention.
- [ ] **Tỉ lệ tuân thủ giao thức đo được trên ≥10 lượt thật**, ghi con số dù xấu.
- [ ] Nút Dừng cắt thật; `AbortError` không bị khai thành lỗi.
- [ ] Vòng lặp hiện tiến độ cho người dùng; trần chặn đúng.

## Ngoài phạm vi Đợt D

Ghost-text (hoãn từ đầu) · tạo tệp mới (nợ Đợt C) · duyệt theo khối ở chế độ LOCAL · cầu tool
hai chiều server→client · chạy trong cửa sổ VSCode thật (**nợ Đợt C, phải do người dùng bấm F5**).
