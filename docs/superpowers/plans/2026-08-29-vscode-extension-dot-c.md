# Extension VSCode cho AI Local — ĐỢT C (chế độ LOCAL ghi được + Cmd+K)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ở **chế độ LOCAL**, cho phép AI đề xuất sửa tệp **trên máy của lập trình viên**, xem
**diff native**, bấm duyệt, rồi **extension tự ghi** vào workspace — kèm chặn xung đột và sổ kiểm
toán trung thực. Cộng **Cmd+K** (sửa đoạn đang chọn).

**Architecture:** Đây là đợt ĐẦU TIÊN extension chạm đĩa. Máy chủ **không với tới tệp** nên
**không cưỡng chế được** — nơi cưỡng chế chuyển vào extension (spec §4.1). Bù bằng ba thứ đo
được: **MỘT điểm ghi duy nhất** (census), **vị từ chặn cục bộ**, và **kiểm toán ghi TRƯỚC chốt
SAU**. Mọi logic quyết định nằm ở module THUẦN dưới `src/loi/`.

**Tech Stack:** TypeScript · esbuild · VSCode `WorkspaceEdit`/`TextDocumentContentProvider` ·
`node:crypto` (sha256) · tRPC + superjson · Drizzle migration.

**Spec:** `docs/superpowers/specs/2026-08-28-vscode-extension-ai-local-design.md` (§4.1, §5.3, §6, §10)

**Nền:** Đợt A (`78a753c8`) + Đợt B (`0cbd1dd5`) — 128 lưới, cửa duyệt SERVER chạy thật, census
quét **tập vào bundle**, migration tới `0342`.

## Hợp đồng ĐÃ ĐO trên mã thật (dùng nguyên, KHÔNG đoán lại)

Đợt A/B dính **bốn lần** lớp lỗi "client đọc sai thứ server gửi". Các dữ kiện dưới đây đã kiểm
trực tiếp trước khi viết kế hoạch này:

| Thứ | Sự thật đo được | Nguồn |
|---|---|---|
| Enum trạng thái | `proposed·confirmed·executed·denied·expired·cancelled·bi_tu_choi_ghi·ap_mot_phan` | `drizzle/schema/enums.ts:180-188` |
| Migration kế tiếp | **`0343`** | `drizzle/*.sql` max = 0342 |
| Hằng audit | `AUDIT_ACTIONS` ở `server/services/auditTrailService.ts:181-195` (`AI_ACTION_PROPOSED/CONFIRMED/EXECUTED/DENIED/CANCELLED`) | đọc trực tiếp |
| `proposeAction` | **đòi một `Tool` thật** (`assertExecutable`, `tool.requiredPermission`) ⇒ đường kiểm toán client **KHÔNG dùng lại được**, phải có thủ tục riêng | `aiCopilotActions.ts:262-270` |
| DDL | `DATABASE_URL` dùng `avi_app` ⇒ `ALTER TYPE` trả **42501**; owner là `aoi`/`aoi` (ghi trong `docker-compose.yml`) | đo lúc chạy 0341 |

## Global Constraints

- **CHỈ ĐÚNG MỘT nơi ghi đĩa** trong toàn extension. Census hiện khẳng định **0 lần**
  `fs.writeFile`/`writeFileSync`/`appendFile`/`applyEdit`/`WorkspaceEdit`; Task 6 **SỬA** nó
  thành "đúng MỘT lần tại `<đường dẫn>`" — **KHÔNG được xoá ca nào**. Docblock census đã dặn sẵn.
- **KHÔNG ghi vào `sandbox-projects/`** (đề thi) · **KHÔNG sửa `.env`**.
- Module dưới `src/loi/` và `src/ui/htmlBang.ts` **không import `vscode`**.
- **Commit SURGICAL** — tiến trình khác có thể commit song song; `git add` từng đường dẫn.
- Tên hàm/biến tiếng Việt không dấu; chuỗi hiển thị tiếng Việt; bình luận giải thích VÌ SAO.
- **Mồi thử không được khớp khuôn khoá thật** (GitHub Push Protection đã chặn cả lượt push ở Đợt A).
- Mọi lệnh npm có `--prefix vscode-extension`. `npm run check` chạy RIÊNG.

---

### Task 1: Đọc đề xuất sửa từ văn bản model (THUẦN)

**Files:** Create `vscode-extension/src/loi/deXuatCucBo.ts` · Test `…/deXuatCucBo.unit.test.ts`

**Produces:**
```ts
export type DeXuatCucBo =
  | { loai: "doan"; path: string; dongDau: number; dongCuoi: number; thayThe: string }
  | { loai: "toanVan"; path: string; modified: string };
export function docDeXuatCucBo(vanBan: string): DeXuatCucBo[];
```

Model phát khối rào ```` ```avi-tool ```` chứa JSON (spec §5.3). Task này chỉ đọc **đề xuất sửa**;
tool đọc/grep để Đợt D.

- [ ] **Step 1: Lưới ĐỎ trước** — `vscode-extension/src/loi/deXuatCucBo.unit.test.ts`:

```ts
/**
 * LƯỚI đọc đề xuất sửa CỤC BỘ. Ở chế độ LOCAL, máy chủ KHÔNG phát `pending_action` (codingMode
 * false) — đề xuất đến từ VĂN BẢN model, nên parser này là cửa duy nhất. Sai một nhịp ở đây là
 * ghi nhầm tệp trên máy lập trình viên ⇒ mọi ca biên đều phải trả `[]` chứ KHÔNG đoán.
 */
import { describe, it, expect } from "vitest";
import { docDeXuatCucBo } from "./deXuatCucBo";

const KHOI = (j: string) => "Giải thích...\n```avi-tool\n" + j + "\n```\nxong.";

describe("docDeXuatCucBo", () => {
  it("★★★ đọc đề xuất sửa ĐOẠN", () => {
    const r = docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua_doan","args":{"path":"src/A.cs","dongDau":3,"dongCuoi":5,"thayThe":"X"}}'));
    expect(r).toEqual([{ loai: "doan", path: "src/A.cs", dongDau: 3, dongCuoi: 5, thayThe: "X" }]);
  });

  it("★★★ đọc đề xuất TOÀN VĂN", () => {
    const r = docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua","args":{"path":"src/A.cs","modified":"NOI DUNG MOI"}}'));
    expect(r).toEqual([{ loai: "toanVan", path: "src/A.cs", modified: "NOI DUNG MOI" }]);
  });

  it("★★★ JSON hỏng ⇒ [] , KHÔNG ném, KHÔNG đoán", () => {
    expect(docDeXuatCucBo(KHOI("{khong-phai-json}"))).toEqual([]);
  });

  it("★★★ thiếu trường bắt buộc ⇒ bỏ qua ĐỀ XUẤT ĐÓ", () => {
    expect(docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua_doan","args":{"path":"a"}}'))).toEqual([]);
    expect(docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua","args":{"modified":"x"}}'))).toEqual([]);
  });

  it("★★ dòng âm / dongCuoi < dongDau ⇒ bỏ qua", () => {
    expect(docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua_doan","args":{"path":"a","dongDau":0,"dongCuoi":2,"thayThe":""}}'))).toEqual([]);
    expect(docDeXuatCucBo(KHOI('{"tool":"de_xuat_sua_doan","args":{"path":"a","dongDau":5,"dongCuoi":2,"thayThe":""}}'))).toEqual([]);
  });

  it("★★ NHIỀU khối trong một lượt ⇒ đọc đủ, đúng thứ tự", () => {
    const v = KHOI('{"tool":"de_xuat_sua","args":{"path":"a","modified":"1"}}') +
              KHOI('{"tool":"de_xuat_sua","args":{"path":"b","modified":"2"}}');
    expect(docDeXuatCucBo(v).map((x) => x.path)).toEqual(["a", "b"]);
  });

  it("★★ tool KHÁC (đọc/grep — việc của Đợt D) ⇒ bỏ qua ở đợt này", () => {
    expect(docDeXuatCucBo(KHOI('{"tool":"doc_tep","args":{"path":"a"}}'))).toEqual([]);
  });

  it("★ văn bản không có khối nào ⇒ []", () => {
    expect(docDeXuatCucBo("chỉ là văn xuôi")).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy → ĐỎ.** `npx vitest run vscode-extension/src/loi/deXuatCucBo.unit.test.ts`
- [ ] **Step 3: Cài đặt** — tách khối bằng regex trên hàng rào ```` ```avi-tool ```` … ```` ``` ````,
      `JSON.parse` trong `try`, kiểm từng trường bằng `typeof`, số dòng phải là **số nguyên ≥ 1**
      và `dongCuoi >= dongDau`. Docblock nói rõ: **thà bỏ qua còn hơn đoán**, vì đoán sai ở đây là
      ghi nhầm tệp trên máy người dùng.
- [ ] **Step 4: Chạy → XANH (8 ca).**
- [ ] **Step 5: ĐỘT BIẾN** — bỏ kiểm `dongCuoi >= dongDau`, xác nhận ca biên ĐỎ, ghi output, hoàn nguyên.
- [ ] **Step 6: Commit** (2 tệp).

---

### Task 2: Ghép đề xuất thành nội dung mới (THUẦN)

**Files:** Create `vscode-extension/src/loi/ghepBanVa.ts` · Test `…/ghepBanVa.unit.test.ts`

**Consumes:** `DeXuatCucBo` (Task 1) · **Produces:**
```ts
export function ghepBanVa(goc: string, d: DeXuatCucBo): { ok: true; moi: string } | { ok: false; lyDo: string };
```

- [ ] **Step 1: Lưới ĐỎ trước** — ca bắt buộc:
  - thay đoạn giữa tệp đúng vị trí (1-based, bao gồm cả `dongCuoi`)
  - **GIỮ NGUYÊN CRLF** của tệp gốc (Windows) — tệp CRLF phải ra CRLF
  - `dongCuoi` vượt số dòng ⇒ `{ok:false}` (KHÔNG tự cắt bớt)
  - tệp không có newline cuối ⇒ không tự thêm
  - `loai:"toanVan"` ⇒ trả thẳng `modified`
  - thay bằng chuỗi rỗng (xoá dòng) ⇒ đúng
- [ ] **Step 2: Chạy → ĐỎ.**
- [ ] **Step 3: Cài đặt.** Phát hiện EOL của tệp gốc rồi ghép lại theo đúng EOL đó. Docblock: một
      bản vá làm cả tệp đổi EOL sẽ hiện thành "sửa toàn bộ tệp" trong git — người duyệt mất khả
      năng thấy thay đổi THẬT.
- [ ] **Step 4: XANH.** **Step 5: ĐỘT BIẾN** bỏ giữ CRLF ⇒ ca CRLF phải ĐỎ. **Step 6: Commit.**

---

### Task 3: Vị từ chặn ghi cục bộ (THUẦN) — hàng rào an toàn

**Files:** Create `vscode-extension/src/loi/chanGhi.ts` · Test `…/chanGhi.unit.test.ts`

**Produces:**
```ts
export function duocPhepGhi(duongTuyetDoi: string, thuMucWorkspace: string[]): { ok: true } | { ok: false; lyDo: string };
```

Đây là **nơi cưỡng chế** thay cho máy chủ (spec §4.1). Ba luật:
1. Đường dẫn phải nằm **trong** một thư mục workspace đang mở (so sánh sau khi chuẩn hoá, chặn
   `..` thoát ra ngoài).
2. **Cấm `.env*`** và tệp khoá riêng — **dùng lại `duocPhepGuiNoiDung`** của `nguCanh.ts`,
   **KHÔNG viết bản thứ hai** (bài học `daBiTuChoiGhi`: hai bản sao một vị từ an toàn sẽ trôi
   khỏi nhau, bản lỏng hơn là bản đang chạy).
3. Từ chối đường dẫn **không tuyệt đối**.

- [ ] **Step 1: Lưới ĐỎ trước** — ca bắt buộc: trong workspace ⇒ OK · ngoài workspace ⇒ chặn ·
      `..` thoát ra ⇒ chặn · `.env`/`.env.local` ⇒ chặn · `id_rsa_work`/`server.key` ⇒ chặn ·
      **tệp mã bình thường ⇒ CHO** (chặn nhầm là mất chức năng âm thầm) · đường tương đối ⇒ chặn ·
      **workspace rỗng ⇒ chặn tất** (không có workspace thì không có gì hợp lệ để ghi).
- [ ] **Step 2: ĐỎ.** **Step 3: Cài đặt** (import `duocPhepGuiNoiDung`). **Step 4: XANH.**
- [ ] **Step 5: ĐỘT BIẾN** — bỏ luật "trong workspace", xác nhận ca `..` ĐỎ. Hoàn nguyên.
- [ ] **Step 6: Commit.**

---

### Task 4: Chặn xung đột bằng băm (THUẦN + I/O tối thiểu)

**Files:** Create `vscode-extension/src/loi/bamTep.ts` · Test `…/bamTep.unit.test.ts`

**Produces:** `bamNoiDung(s: string): string` (sha256 hex, dùng `node:crypto`) ·
`khopBanGoc(bamDia: string, bamGoc: string): boolean`

Đúng vị từ máy chủ dùng (`applyDiff.ts:399-404`, `BASE_MISMATCH`). Lưới: cùng nội dung ⇒ khớp ·
khác một ký tự ⇒ không khớp · chuỗi rỗng có băm hợp lệ · **CRLF vs LF là KHÁC nhau** (không tự
chuẩn hoá — băm phải nói về BYTE THẬT trên đĩa).

- [ ] Lưới ĐỎ → cài đặt → XANH → commit.

---

### Task 5: Kiểm toán client ở MÁY CHỦ (migration + 2 thủ tục)

**Files:** Create `drizzle/0343_them_trang_thai_ap_o_client.sql` · Modify `drizzle/schema/enums.ts`,
`server/services/auditTrailService.ts`, `server/routers/aiCopilotRouter.ts`,
`server/services/aiCopilotActions.ts` · Test mới cạnh đó

Spec §6.5: **ghi TRƯỚC khi byte rơi, chốt SAU**. Sập giữa chừng ⇒ hàng đứng ở "đang áp" =
**"chưa rõ" TRUNG THỰC**, không phải lời nói dối.

- [ ] **Step 1: Migration `0343`** — thêm `dang_ap_client`, `da_ap_client`, `ap_client_that_bai`.
      ⚠ `ALTER TYPE … ADD VALUE IF NOT EXISTS`, **đứng RIÊNG**, và **chép nguyên khối cảnh báo
      triển-khai-trước** đã có ở `0341`/`0342` (nêu đích danh kiểu hỏng ghi-hai-lần).
- [ ] **Step 2: Hằng audit mới** trong `auditTrailService.ts` cạnh nhóm `AI_ACTION_*`:
      `AI_CLIENT_APPLY_STARTED`, `AI_CLIENT_APPLIED`, `AI_CLIENT_APPLY_FAILED`.
- [ ] **Step 3: Hai thủ tục tRPC** trong `aiCopilotRouter.ts` (`protectedProcedure` +
      `moduleGate("MOD_AI")` như các thủ tục cạnh nó):
      - `batDauApDungOClient({path, nhanWorkspace, sha256Truoc, sha256Sau, tomTat, soDongThem, soDongBot})`
        → tạo hàng `ai_pending_actions` status **`dang_ap_client`**, trả `{actionId, token}`.
      - `chotApDungOClient({actionId, token, thanhCong, sha256SauThat?, loi?})`
        → `da_ap_client` hoặc `ap_client_that_bai` + audit, kiểm **token + chủ sở hữu** như
        `confirmAction`.
      ⚠ **KHÔNG lưu toàn văn `modified`** — chỉ băm + tóm tắt + số dòng (spec §6.5: mã đã ở máy
      dev, máy chủ không cần bản sao).
- [ ] **Step 4: Lưới** — ĐỎ trước cho: chốt bằng token sai ⇒ từ chối · chốt hai lần ⇒ idempotent ·
      `thanhCong:false` ⇒ `ap_client_that_bai` · hàng mới tạo có status `dang_ap_client`.
- [ ] **Step 5:** chạy lưới liên quan + `npm run check` (RIÊNG). **Step 6: Commit.**

---

### Task 6: ĐIỂM GHI DUY NHẤT + census đổi từ "0 lần" sang "đúng MỘT lần"

**Files:** Create `vscode-extension/src/ui/apBanVa.ts` · Modify `…/src/ui/bangChat.ts`,
`…/src/mang/duyetGhi.ts` (thêm 2 lời gọi kiểm toán), `…/src/loi/census.unit.test.ts`

**Đây là task rủi ro nhất của cả dự án.** Thứ tự BẮT BUỘC trong `apBanVa()`:

1. `duocPhepGhi(...)` — sai ⇒ dừng, báo lý do.
2. Đọc tệp từ đĩa, `bamNoiDung` — so với băm gốc của đề xuất. **Lệch ⇒ DỪNG**, báo "tệp đã đổi
   kể từ lúc đề xuất" (KHÔNG ghi đè).
3. `batDauApDungOClient(...)` — **ghi kiểm toán TRƯỚC khi byte rơi**.
4. `WorkspaceEdit` + `save()`.
5. Đọc lại đĩa, băm lại, `chotApDungOClient({thanhCong, sha256SauThat})`.
6. Ném/lỗi ở bước 4 ⇒ `chotApDungOClient({thanhCong:false, loi})`.

- [ ] **Step 1: Cài `apBanVa.ts`** theo đúng thứ tự trên. Docblock ghi VÌ SAO từng bước, đặc biệt
      vì sao kiểm toán đi TRƯỚC.
- [ ] **Step 2: SỬA census** (`census.unit.test.ts`):
      - Bỏ `applyEdit` và `WorkspaceEdit` khỏi `CAM_TU`.
      - Thêm ca **đúng MỘT lần** cho mỗi từ đó, tại **`ui/apBanVa.ts`**, theo khuôn ca
        `confirmAction` hiện có: đếm **SỐ LẦN XUẤT HIỆN** trên **tập vào bundle**, `toBe(1)`,
        **không** `≤1` (0 nghĩa là đường ghi đã bị gỡ).
      - GIỮ NGUYÊN khẳng định "= 0" cho `fs.writeFile`/`writeFileSync`/`appendFile` — extension
        ghi qua `WorkspaceEdit`, **không** qua `fs`.
      - Giữ nguyên ca "TẬP QUÉT = TẬP VÀO BUNDLE" và ca `confirmAction`.
- [ ] **Step 3: ĐỘT BIẾN census (bắt buộc)** — thêm lời gọi `applyEdit` thứ hai ở `bangChat.ts`,
      xác nhận ĐỎ và **nêu đúng tên tệp thừa**; rồi bỏ hẳn lời gọi ở `apBanVa.ts`, xác nhận ĐỎ vì
      **số TỤT** (0 ≠ 1). Ghi output cả hai chiều. Hoàn nguyên.
- [ ] **Step 4: Nối vào `bangChat.ts`** — nhánh chế độ LOCAL: đọc đề xuất từ văn bản model →
      hiện thẻ duyệt + diff native (dùng lại `KhoDeXuat`) → nút duyệt gọi `apBanVa`.
      **Nhãn nguồn phải là `LOCAL · <workspace>`** và nút ghi rõ **"Ghi vào workspace"** —
      không được lẫn với `SERVER`.
- [ ] **Step 5:** `ext:check` · `ext:build` · trọn bộ lưới. **Step 6: Commit.**

---

### Task 7: Cmd+K — sửa đoạn đang chọn

**Files:** Modify `vscode-extension/package.json` (lệnh + keybinding), `…/src/extension.ts`,
`…/src/ui/bangChat.ts`

- [ ] **Step 1:** khai lệnh `aviAiLocal.suaDoanChon` + keybinding `ctrl+k ctrl+i` (hoặc phím chưa
      bị VSCode giữ — **kiểm trước, đừng đoán**; Đợt A đã học Ctrl+Tab không dùng được ở web).
- [ ] **Step 2:** lấy đoạn đang chọn + đường dẫn tương đối, hỏi người dùng câu lệnh sửa, dựng
      câu hỏi có **đánh dấu rõ vùng cần sửa** (dòng bắt đầu/kết thúc), gửi qua `handleSend` sẵn có.
      ⚠ **KHÔNG mở đường ghi mới**: Cmd+K chỉ **dựng câu hỏi**; kết quả vẫn đi qua đúng
      đề-xuất → diff → duyệt → `apBanVa` của Task 6. Ghi rõ điều này trong docblock.
- [ ] **Step 3:** không có đoạn chọn ⇒ gợi ý rành mạch, không im lặng.
- [ ] **Step 4:** `ext:check` · `ext:build` · lưới. **Step 5: Commit.**

---

### Task 8: Nghiệm thu LIVE + tài liệu kết quả

**Files:** Create `docs/superpowers/plans/2026-08-29-vscode-extension-dot-c-ket-qua.md`

Đích ghi: một **workspace tạm trong scratchpad** (KHÔNG phải `sandbox-projects/`).

- [ ] **Step 1:** ghi lại nội dung gốc + băm trước.
- [ ] **Step 2 — đường THÀNH CÔNG:** đề xuất → duyệt → **đọc lại tệp trên đĩa, chứng minh byte
      đổi THẬT**; và **hàng kiểm toán** chuyển `dang_ap_client` → `da_ap_client`.
- [ ] **Step 3 — đường XUNG ĐỘT:** tạo đề xuất, **sửa tệp trên đĩa trước khi duyệt**, rồi duyệt ⇒
      phải **BỊ CHẶN**, tệp **không đổi**, và **không** có hàng `dang_ap_client` nào bị bỏ lửng.
- [ ] **Step 4 — đường CHẶN:** thử ghi ra ngoài workspace và vào `.env` ⇒ phải bị từ chối.
- [ ] **Step 5 — TÊN TỆP TIẾNG VIỆT** (đóng nợ Đợt B): dùng tệp `Báo cáo #1.cs` để đóng **lỗ
      bằng-chứng URI của Task 3 Đợt B** — chứng minh diff mở đúng nội dung, không rỗng.
- [ ] **Step 6:** hoàn nguyên; xác nhận `git status` sạch ở mọi nơi ngoài scratchpad.
- [ ] **Step 7:** viết tệp kết quả với số đo THẬT + phần **chưa xác minh** ghi thẳng. **Commit.**

---

## Cổng ra Đợt C

- [ ] `npm run ext:check` 0 lỗi · `ext:build` OK · trọn bộ lưới extension xanh · `npm run check` không lỗi MỚI.
- [ ] **Census: đúng MỘT lần `applyEdit`/`WorkspaceEdit` tại `ui/apBanVa.ts`; 0 lần `fs.write*`.**
      Đột biến chứng minh **cả hai chiều** (thừa ⇒ đỏ, thiếu ⇒ đỏ).
- [ ] Live: byte đổi **thật** sau duyệt · **bị chặn** khi xung đột · **bị chặn** khi ra ngoài
      workspace/`.env` · hàng kiểm toán đi đúng `dang_ap_client` → `da_ap_client`.
- [ ] Nhãn `LOCAL · <workspace>` có trên tiêu đề diff và thẻ duyệt; không lẫn với `SERVER`.
- [ ] Migration `0343` chạy **trước** khi triển khai mã máy chủ.
- [ ] Nợ Đợt B đã đóng: tệp tên tiếng Việt mở diff đúng.

## Ngoài phạm vi Đợt C

Vòng tác nhân đa bước ở client + tool đọc/liệt kê/grep cục bộ + @-mention + nút Dừng (**Đợt D**) ·
duyệt theo khối (hunk) ở chế độ LOCAL · ghost-text · lưới vòng-thật cho `ap_mot_phan`.
