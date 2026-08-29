# Extension VSCode cho AI Local — ĐỢT B (chế độ SERVER trọn vẹn: duyệt & ghi)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép người dùng **duyệt và ghi thật** ở **chế độ SERVER** ngay trong VSCode: nhận
`pending_action` từ luồng SSE → xem **diff native của VSCode** → bấm Duyệt → server thực thi qua
`aiCopilot.confirmAction`. Kèm vá **lỗ nói dối `executed`** đã có sẵn trong máy chủ.

**Architecture:** Chế độ SERVER **dùng lại nguyên** cửa duyệt server-enforced đang chạy: byte do
**SERVER** ghi vào hộp cát của nó, extension chỉ hiển thị và gọi `confirmAction`. Extension
**tuyệt đối không** ghi đĩa ở Đợt B (đường ghi cục bộ là việc của Đợt C). Mọi logic quyết định
nằm ở module THUẦN dưới `src/loi/`; lớp `src/mang/` chỉ I/O; `src/ui/` chỉ hiển thị.

**Tech Stack:** TypeScript · esbuild · VSCode Extension API (TextDocumentContentProvider +
`vscode.diff`) · tRPC qua HTTP + superjson · vitest · Drizzle migration (Postgres enum).

**Spec:** `docs/superpowers/specs/2026-08-28-vscode-extension-ai-local-design.md` (§6.2, §6.6, §7, §10)

**Nền đã có (Đợt A, `1fd6fa8..57aed35a`):** đăng nhập + cookie · SSE reader · bảng chat webview ·
ngữ cảnh + che bí mật · ô chọn dự án LOCAL/SERVER · 99 lưới xanh · census chỉ-đọc.

## Hợp đồng máy chủ — ĐÃ ĐO trên mã thật, dùng nguyên, KHÔNG đoán lại

Đợt A dính **bốn lần** lớp lỗi "client đọc sai thứ server gửi". Các hình dạng dưới đây đã được
kiểm trực tiếp trên mã máy chủ trước khi viết kế hoạch này:

| Thứ | Hình dạng THẬT | Nguồn |
|---|---|---|
| Sự kiện SSE | `{type:"pending_action", toolName, pendingAction: {...}}` — payload **LỒNG** dưới `pendingAction`, **không phẳng** | `server/routes/aiLocalKnowledgeApi.ts:582-585` |
| `PendingActionDTO` | `{actionId, token, tool, args, summary, preview, requiredPermission?, expiresAt}` | `server/services/aiCopilotActions.ts:120-134` |
| `args` của `apply_diff` | `{path, original, modified}` — **toàn văn**, mỗi trường ≤ 2 MB | `server/services/aiLocalTools/writeHandlers/applyDiff.ts:266-272` |
| Hash | `preview.changes[].sha256Before` / `sha256After` | `applyDiff.ts:500-506` |
| Duyệt | `aiCopilot.confirmAction({actionId, token, lang?, selectedHunkIds?})` | `server/routers/aiCopilotRouter.ts:43-48` |
| Huỷ | `aiCopilot.cancelAction({actionId})` | `aiCopilotRouter.ts:59-60` |
| TTL đề xuất | **5 phút** | `aiCopilotActions.ts:75` |

⚠ `selectedHunkIds` **chỉ nhận SỐ**. Có lưới census của máy chủ bắt ĐỎ nếu ai thêm ô mang nội
dung (`modified`/`original`/`content`) vào schema đó — đó là lỗ mà HITL sinh ra để đóng. Đợt B
**không** gửi `selectedHunkIds` (duyệt cả tệp); duyệt theo khối để Đợt sau.

## Global Constraints

- **Extension KHÔNG ghi đĩa ở Đợt B.** Không `fs.write*`, không `applyEdit`, không `WorkspaceEdit`.
  Census `vscode-extension/src/loi/census.unit.test.ts` phải **giữ nguyên** khẳng định 0 lần.
- **Đúng MỘT nơi gọi `confirmAction`** trong toàn extension — census mới cưỡng chế (Task 5).
- **Chế độ LOCAL không được chạm đường duyệt này.** Thẻ duyệt chỉ hiện khi dự án đang chọn là
  SERVER; nhãn nguồn `SERVER · <tên dự án>` phải có mặt trên **tiêu đề diff** lẫn **thẻ duyệt**.
- **KHÔNG ghi vào `sandbox-projects/`** — đề thi. Nghiệm thu dùng dự án `csharp` **đã đăng ký**
  trên máy chủ (`AI_REPO_SANDBOX_ROOTS`), và sau khi thử phải **HOÀN NGUYÊN** thay đổi.
- **KHÔNG sửa `.env`.**
- **Commit SURGICAL** — có tiến trình khác commit song song trên cùng nhánh; `git add` từng đường
  dẫn, không bao giờ `git add -A`/`.`; `knowledge/*.json` là của họ.
- Module dưới `src/loi/` và `src/ui/htmlBang.ts` **không import `vscode`**.
- Tên hàm/biến tiếng Việt không dấu; chuỗi hiển thị tiếng Việt; bình luận giải thích VÌ SAO.
- Mọi lệnh npm phải có `--prefix vscode-extension`.
- **Mồi thử không được khớp khuôn khoá thật của nhà cung cấp** — GitHub Push Protection sẽ chặn
  cả lượt push (đã xảy ra ở Đợt A với `sk_live_` + 24 ký tự chữ-số).

---

### Task 1: Đọc `pending_action` từ luồng SSE (THUẦN)

**Files:**
- Create: `vscode-extension/src/loi/deXuatGhi.ts`
- Test: `vscode-extension/src/loi/deXuatGhi.unit.test.ts`

**Interfaces:**
- Consumes: sự kiện SSE thô `Record<string, unknown>` từ `docLuongSse` (Đợt A)
- Produces:
  - `interface DeXuatGhi { actionId: string; token: string; tool: string; path: string; original: string; modified: string; summary: string; hetHan: string }`
  - `docDeXuatGhi(sk: Record<string, unknown>): DeXuatGhi | null`

- [ ] **Step 1: Viết lưới (ĐỎ trước)**

```ts
/**
 * LƯỚI đọc đề xuất ghi từ khung SSE. Bất biến sống còn: payload LỒNG dưới `pendingAction`.
 * Đợt A đã dính BỐN lần lớp lỗi "client đọc sai thứ server gửi"; ca đầu tiên dưới đây dùng ĐÚNG
 * hình dạng đo được trên `aiLocalKnowledgeApi.ts:582-585`, không phải hình dạng tự bịa.
 */
import { describe, it, expect } from "vitest";
import { docDeXuatGhi } from "./deXuatGhi";

const KHUNG_THAT = {
  type: "pending_action",
  toolName: "apply_diff",
  pendingAction: {
    actionId: "act_1", token: "act_1", tool: "apply_diff",
    args: { path: "src/Calculator.cs", original: "cu\n", modified: "moi\n" },
    summary: "Sửa Calculator.cs", expiresAt: "2026-08-29T10:00:00.000Z",
    preview: { changes: [] },
  },
};

describe("docDeXuatGhi", () => {
  it("★★★ đọc ĐÚNG hình dạng LỒNG của máy chủ", () => {
    const d = docDeXuatGhi(KHUNG_THAT as never);
    expect(d).not.toBeNull();
    expect(d!.actionId).toBe("act_1");
    expect(d!.path).toBe("src/Calculator.cs");
    expect(d!.original).toBe("cu\n");
    expect(d!.modified).toBe("moi\n");
  });

  it("★★★ payload PHẲNG (hình dạng tự bịa) ⇒ null, KHÔNG đoán bừa", () => {
    expect(docDeXuatGhi({ type: "pending_action", actionId: "x", token: "y" } as never)).toBeNull();
  });

  it("★★★ tool KHÔNG phải apply_diff ⇒ null (Đợt B chỉ xử lý sửa tệp)", () => {
    const k = { ...KHUNG_THAT, pendingAction: { ...KHUNG_THAT.pendingAction, tool: "run_command" } };
    expect(docDeXuatGhi(k as never)).toBeNull();
  });

  it("★★ thiếu original/modified ⇒ null (không dựng diff từ dữ liệu khuyết)", () => {
    const k = { ...KHUNG_THAT, pendingAction: { ...KHUNG_THAT.pendingAction, args: { path: "a" } } };
    expect(docDeXuatGhi(k as never)).toBeNull();
  });

  it("★★ khung loại khác ⇒ null", () => {
    expect(docDeXuatGhi({ type: "token", token: "x" } as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ.** `npx vitest run vscode-extension/src/loi/deXuatGhi.unit.test.ts`

- [ ] **Step 3: Cài đặt**

```ts
/**
 * Đọc đề xuất GHI từ một khung SSE.
 *
 * ⚠ Payload LỒNG dưới `pendingAction` (`aiLocalKnowledgeApi.ts:582-585`) — đọc phẳng sẽ luôn ra
 * `undefined` và thẻ duyệt sẽ KHÔNG BAO GIỜ hiện, im lặng. Đợt A đã dính lớp lỗi này bốn lần.
 * Trả `null` thay vì đoán: một đề xuất đọc sai còn tệ hơn không đọc được, vì nó dẫn tới ghi nhầm.
 */
export interface DeXuatGhi {
  actionId: string; token: string; tool: string;
  path: string; original: string; modified: string;
  summary: string; hetHan: string;
}

export function docDeXuatGhi(sk: Record<string, unknown>): DeXuatGhi | null {
  if (sk?.type !== "pending_action") return null;
  const pa = sk.pendingAction as Record<string, unknown> | undefined;
  if (!pa || typeof pa !== "object") return null;
  if (pa.tool !== "apply_diff") return null; // Đợt B chỉ xử lý sửa tệp
  const args = pa.args as Record<string, unknown> | undefined;
  const lay = (o: Record<string, unknown> | undefined, k: string): string | null =>
    o && typeof o[k] === "string" ? (o[k] as string) : null;
  const actionId = lay(pa, "actionId"), token = lay(pa, "token");
  const path = lay(args, "path"), original = lay(args, "original"), modified = lay(args, "modified");
  if (!actionId || !token || !path || original === null || modified === null) return null;
  return {
    actionId, token, tool: "apply_diff", path, original, modified,
    summary: lay(pa, "summary") ?? "", hetHan: lay(pa, "expiresAt") ?? "",
  };
}
```

- [ ] **Step 4: Chạy, xác nhận XANH (5 ca).**

- [ ] **Step 5: Đột biến.** Đổi `sk.pendingAction` thành `sk` (đọc phẳng) → ca đầu phải ĐỎ. Ghi
      output. Hoàn nguyên.

- [ ] **Step 6: Commit** — `git add` đúng 2 tệp.

---

### Task 2: Tóm tắt thay đổi cho thẻ duyệt (THUẦN)

**Files:**
- Create: `vscode-extension/src/loi/tomTatDiff.ts`
- Test: `vscode-extension/src/loi/tomTatDiff.unit.test.ts`

**Interfaces:**
- Consumes: `original`/`modified` từ `DeXuatGhi` (Task 1)
- Produces: `tomTatDiff(original: string, modified: string): { them: number; bot: number; doiDong: boolean }`

Người duyệt cần biết **quy mô** trước khi mở diff. Không dựng thư viện diff — chỉ đếm dòng thêm/
bớt bằng so sánh tập hợp dòng, đủ cho một con số định hướng.

- [ ] **Step 1: Viết lưới (ĐỎ trước)**

```ts
import { describe, it, expect } from "vitest";
import { tomTatDiff } from "./tomTatDiff";

describe("tomTatDiff", () => {
  it("★★★ thêm dòng", () => {
    expect(tomTatDiff("a\nb\n", "a\nb\nc\n")).toEqual({ them: 1, bot: 0, doiDong: true });
  });
  it("★★★ bớt dòng", () => {
    expect(tomTatDiff("a\nb\nc\n", "a\nb\n")).toEqual({ them: 0, bot: 1, doiDong: true });
  });
  it("★★★ sửa một dòng = 1 thêm + 1 bớt", () => {
    expect(tomTatDiff("a\nb\n", "a\nB\n")).toEqual({ them: 1, bot: 1, doiDong: true });
  });
  it("★★ không đổi gì ⇒ 0/0 và doiDong=false", () => {
    expect(tomTatDiff("a\nb\n", "a\nb\n")).toEqual({ them: 0, bot: 0, doiDong: false });
  });
  it("★★ CRLF không bị tính là khác biệt giả", () => {
    expect(tomTatDiff("a\r\nb\r\n", "a\nb\n")).toEqual({ them: 0, bot: 0, doiDong: false });
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ.**

- [ ] **Step 3: Cài đặt**

```ts
/**
 * Đếm dòng thêm/bớt để thẻ duyệt nói được QUY MÔ trước khi người dùng mở diff.
 *
 * ⚠ Chuẩn hoá CRLF trước khi so: trên Windows một tệp lưu lại bằng editor khác dòng-kết-thúc sẽ
 * làm MỌI dòng trông như đã đổi — một con số sai kiểu đó khiến người duyệt mất niềm tin vào thẻ.
 * Đây là phép đếm ĐỊNH HƯỚNG (đa tập hợp), không phải thuật toán diff; diff thật do VSCode vẽ.
 */
export function tomTatDiff(original: string, modified: string): { them: number; bot: number; doiDong: boolean } {
  const tach = (s: string) => s.replace(/\r\n/g, "\n").split("\n");
  const dem = (ds: string[]) => { const m = new Map<string, number>(); for (const d of ds) m.set(d, (m.get(d) ?? 0) + 1); return m; };
  const a = dem(tach(original)), b = dem(tach(modified));
  let them = 0, bot = 0;
  for (const [d, n] of b) them += Math.max(0, n - (a.get(d) ?? 0));
  for (const [d, n] of a) bot += Math.max(0, n - (b.get(d) ?? 0));
  return { them, bot, doiDong: them > 0 || bot > 0 };
}
```

- [ ] **Step 4: Chạy, xác nhận XANH (5 ca).**
- [ ] **Step 5: Commit** — 2 tệp.

---

### Task 3: Diff native của VSCode + nhãn nguồn

**Files:**
- Create: `vscode-extension/src/ui/diffDeXuat.ts`
- Modify: `vscode-extension/src/extension.ts` (đăng ký content provider)

**Interfaces:**
- Consumes: `DeXuatGhi` (Task 1)
- Produces: `class KhoDeXuat` — cài `vscode.TextDocumentContentProvider` cho scheme
  `avi-ai-de-xuat`, với `datDeXuat(d: DeXuatGhi)` và `moDiff(d: DeXuatGhi, nhanNguon: string)`

Không dùng tệp tạm trên đĩa (Đợt B **không ghi đĩa**): hai phía của diff đều là **tài liệu ảo**
do provider phục vụ từ bộ nhớ.

- [ ] **Step 1: Cài `src/ui/diffDeXuat.ts`**

```ts
/**
 * Diff native của VSCode cho một đề xuất ghi ở CHẾ ĐỘ SERVER.
 *
 * ⚠ Cả hai phía đều là TÀI LIỆU ẢO trong bộ nhớ: Đợt B tuyệt đối không ghi đĩa, kể cả tệp tạm.
 * ⚠ Tiêu đề diff PHẢI mang nhãn nguồn. Hai chế độ ghi vào HAI NƠI khác nhau; một người tưởng
 *   đang sửa tệp trên máy mình mà thật ra động vào box AI là tai nạn không cứu được (spec §7).
 */
import * as vscode from "vscode";
import type { DeXuatGhi } from "../loi/deXuatGhi";

export const SCHEME = "avi-ai-de-xuat";

export class KhoDeXuat implements vscode.TextDocumentContentProvider {
  private noiDung = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.noiDung.get(uri.toString()) ?? "";
  }

  private uri(actionId: string, ben: "cu" | "moi", path: string): vscode.Uri {
    return vscode.Uri.parse(`${SCHEME}:${ben}/${actionId}/${path}`);
  }

  datDeXuat(d: DeXuatGhi): { cu: vscode.Uri; moi: vscode.Uri } {
    const cu = this.uri(d.actionId, "cu", d.path);
    const moi = this.uri(d.actionId, "moi", d.path);
    this.noiDung.set(cu.toString(), d.original);
    this.noiDung.set(moi.toString(), d.modified);
    this._onDidChange.fire(cu);
    this._onDidChange.fire(moi);
    return { cu, moi };
  }

  async moDiff(d: DeXuatGhi, nhanNguon: string): Promise<void> {
    const { cu, moi } = this.datDeXuat(d);
    await vscode.commands.executeCommand("vscode.diff", cu, moi, `${nhanNguon} — ${d.path} (đề xuất của AI)`);
  }

  quen(actionId: string): void {
    for (const k of [...this.noiDung.keys()]) if (k.includes(`/${actionId}/`)) this.noiDung.delete(k);
  }
}
```

- [ ] **Step 2: Đăng ký provider trong `extension.ts`**

Trong `activate`, thêm:

```ts
  const khoDeXuat = new KhoDeXuat();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, khoDeXuat),
  );
```

và truyền `khoDeXuat` vào `BangChat.moHoacHien(context, khoDeXuat)` (mở rộng chữ ký).

- [ ] **Step 3: `npm run ext:check` (0 lỗi) + `npm run ext:build`.**
- [ ] **Step 4: Commit** — 2 tệp.

---

### Task 4: Thẻ duyệt trong webview + gọi `confirmAction` (ĐÚNG MỘT NƠI)

**Files:**
- Create: `vscode-extension/src/mang/duyetGhi.ts`
- Modify: `vscode-extension/src/ui/htmlBang.ts` (+ lưới), `vscode-extension/src/ui/bangChat.ts`

**Interfaces:**
- Produces: `goiDuyet(serverUrl, cookie, actionId, token)` và `goiHuy(serverUrl, cookie, actionId)`
  — gọi tRPC **mutation** (POST `/api/trpc/<thu tuc>`, thân `{json: {...}}`, superjson)

- [ ] **Step 1: Cài `src/mang/duyetGhi.ts`**

```ts
/**
 * Gọi CỬA DUYỆT của máy chủ. Đây là ĐIỂM DUY NHẤT trong extension gọi `confirmAction` — có lưới
 * census (Task 5) cưỡng chế. Byte do MÁY CHỦ ghi vào hộp cát của nó; extension không chạm đĩa.
 *
 * ⚠ KHÔNG gửi `selectedHunkIds` ở Đợt B (duyệt cả tệp). Schema máy chủ chỉ nhận SỐ ở ô đó và có
 *   census riêng bắt đỏ nếu ai nhét nội dung vào — đừng mở lại lỗ mà HITL sinh ra để đóng.
 */
import { boBoiSuperjson } from "../loi/trpc";

async function goiMutation(serverUrl: string, cookie: string, ten: string, dauVao: unknown): Promise<unknown> {
  const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/api/trpc/${ten}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `app_session_id=${cookie}` },
    body: JSON.stringify({ json: dauVao }),
  });
  if (!res.ok) throw new Error(`tRPC ${ten} trả ${res.status}`);
  return boBoiSuperjson(await res.json());
}

export async function goiDuyet(serverUrl: string, cookie: string, actionId: string, token: string): Promise<unknown> {
  return goiMutation(serverUrl, cookie, "aiCopilot.confirmAction", { actionId, token, lang: "vi" });
}

export async function goiHuy(serverUrl: string, cookie: string, actionId: string): Promise<unknown> {
  return goiMutation(serverUrl, cookie, "aiCopilot.cancelAction", { actionId });
}
```

- [ ] **Step 2: Thẻ duyệt trong `htmlBang.ts`** — thêm vùng `<div id="the-duyet" hidden>` với:
      nhãn nguồn, đường dẫn tệp, tóm tắt `+N/-M`, hạn duyệt, và **ba nút**: `Xem diff` ·
      `Duyệt & ghi trên SERVER` · `Huỷ`. Chữ trên nút phải nói rõ **ghi ở đâu**.
      Thêm ca lưới: thẻ tồn tại · nút mang chữ "SERVER" · thẻ mặc định ẩn.

- [ ] **Step 3: Nối trong `bangChat.ts`** — trong `nhan` của `moDongSse`, gọi `docDeXuatGhi(sk)`;
      có đề xuất ⇒ lưu vào trạng thái + `postMessage` thẻ duyệt (kèm `tomTatDiff`). Xử lý ba tin
      nhắn từ webview: `xem_diff` → `khoDeXuat.moDiff(...)` · `duyet` → `goiDuyet(...)` ·
      `huy` → `goiHuy(...)`. Sau khi duyệt/huỷ: `khoDeXuat.quen(actionId)`, ẩn thẻ, báo kết quả.

- [ ] **Step 4: Chặn nhầm chế độ** — nếu dự án đang chọn là LOCAL mà nhận được `pending_action`
      (không nên xảy ra vì LOCAL gửi `codingMode:false`), **không hiện thẻ duyệt**, báo một dòng
      cảnh báo. Thêm ca lưới cho vị từ thuần quyết định điều này.

- [ ] **Step 5: `ext:check` + `ext:build` + trọn bộ lưới.**
- [ ] **Step 6: Commit** — 4 tệp.

---

### Task 5: Census — đúng MỘT nơi gọi `confirmAction`

**Files:**
- Modify: `vscode-extension/src/loi/census.unit.test.ts`

- [ ] **Step 1: Thêm khẳng định**

Giữ nguyên khẳng định cũ (0 lần `fs.writeFile`/`writeFileSync`/`appendFile`/`applyEdit`/
`WorkspaceEdit`) — Đợt B vẫn **không ghi đĩa**. Thêm:

```ts
  it("★★★ ĐÚNG MỘT nơi gọi confirmAction trong toàn extension", () => {
    // Cửa duyệt là bất biến an toàn của cả hệ: mỗi đường gọi mới là một đường ghi mới không ai
    // rà. Con số này phải là 1 — KHÔNG phải "≤1", vì 0 nghĩa là cửa duyệt đã bị gỡ mất.
    const noiGoi = moiTepTs().filter((t) => docTep(t).includes("aiCopilot.confirmAction"));
    expect(noiGoi.map((t) => t.replace(/\\/g, "/").split("/src/")[1])).toEqual(["mang/duyetGhi.ts"]);
  });
```

- [ ] **Step 2: Chạy — phải XANH.** Rồi **đột biến**: thêm tạm một dòng gọi
      `aiCopilot.confirmAction` ở `bangChat.ts`, chạy lại, xác nhận ca này ĐỎ và **nêu đúng tên
      tệp thừa**. Hoàn nguyên. Ghi output.
- [ ] **Step 3: Commit** — 1 tệp.

---

### Task 6: Vá lỗ nói dối `executed` ở MÁY CHỦ

**Files:**
- Create: `drizzle/migrations/XXXX_them_trang_thai_bi_tu_choi_ghi.sql` (số kế tiếp)
- Modify: `drizzle/schema/enums.ts`, `server/services/aiCopilotActions.ts`
- Test: `server/services/aiCopilotActions.tuChoiGhi.test.ts`

**Vấn đề (spec §6.6):** `confirmAction` đặt `status='executed'` **bất kể** `apply_diff` có từ chối
hay không (`aiCopilotActions.ts:885-888`). Chính vì thế mới phải đẻ ra `daBiTuChoiGhi()`
(`shared/aiCodingLoop.ts:335-361`) để web đoán lại sự thật. Cột `status` đang nói dối.

- [ ] **Step 1: Viết lưới ĐỎ trước** — dựng một lượt `confirmAction` mà tool trả về kết quả bị từ
      chối ghi, khẳng định `status` **không** phải `executed`. Lưới này phải ĐỎ trên mã hiện tại
      (đó là bằng chứng lỗi có thật).

- [ ] **Step 2: Migration** — `ALTER TYPE aipendingactionstatus ADD VALUE 'bi_tu_choi_ghi';`
      ⚠ Postgres không cho `ADD VALUE` trong transaction ở một số cấu hình ⇒ migration **đứng
      riêng**, không gộp với DDL khác. Cập nhật `drizzle/schema/enums.ts` cho khớp.

- [ ] **Step 3: Sửa `aiCopilotActions.ts`** — sau `tool.execute`, đặt `status` **theo kết quả
      thật**: byte thật sự rơi ⇒ `executed`; bị từ chối ghi (dùng vị từ `daBiTuChoiGhi` có sẵn,
      **không** viết bản thứ hai) ⇒ `bi_tu_choi_ghi`, kèm lý do vào `resultJson`.

- [ ] **Step 4: Chạy lưới — XANH.** Chạy thêm toàn bộ lưới đang có của `aiCopilotActions` để chắc
      không phá đường cũ.

- [ ] **Step 5: Rà nơi nào truy vấn theo `status='executed'`** (báo cáo/đếm/UI) —
      `grep -rn "'executed'" server/ client/`. Nếu có chỗ đếm "đã thực thi" thì nay nó **đúng
      hơn** trước; ghi lại danh sách đã rà vào báo cáo.

- [ ] **Step 6: Commit** — migration + enum + service + test.

---

### Task 7: Nghiệm thu LIVE + tài liệu kết quả

**Files:**
- Create: `docs/superpowers/plans/2026-08-29-vscode-extension-dot-b-ket-qua.md`

- [ ] **Step 1: Chuẩn bị** — dùng dự án SERVER `csharp` đã đăng ký. **Ghi lại nội dung gốc** của
      tệp sẽ bị sửa để hoàn nguyên sau.
- [ ] **Step 2: Đo đường THÀNH CÔNG** — qua chính mã extension: đăng nhập → chọn dự án SERVER →
      hỏi một câu buộc model đề xuất sửa tệp → xác nhận nhận được `pending_action` → gọi
      `goiDuyet` → **đọc lại tệp trên máy chủ** và chứng minh **byte đã đổi thật**.
- [ ] **Step 3: Đo đường HUỶ** — đề xuất mới → `goiHuy` → đọc lại tệp, chứng minh **không đổi**.
- [ ] **Step 4: Đo đường HẾT HẠN** — đề xuất → chờ quá TTL 5 phút → `goiDuyet` → phải bị từ chối
      rành mạch. (Nếu chờ 5 phút là quá lâu, ghi rõ là **chưa đo** thay vì suy đoán.)
- [ ] **Step 5: HOÀN NGUYÊN** mọi thay đổi đã ghi lên dự án SERVER.
- [ ] **Step 6: Viết tệp kết quả** với số đo thật + phần **chưa xác minh** ghi thẳng.
- [ ] **Step 7: Commit.**

---

## Cổng ra Đợt B

- [ ] `npm run ext:check` 0 lỗi; toàn bộ lưới extension xanh; lưới máy chủ liên quan xanh.
- [ ] Census: **0** lần ghi đĩa · **đúng 1** nơi gọi `confirmAction`.
- [ ] Nghiệm thu live: **byte trên máy chủ đổi thật sau khi Duyệt**, và **không đổi** sau khi Huỷ.
- [ ] Nhãn nguồn `SERVER · <dự án>` có mặt trên tiêu đề diff và thẻ duyệt.
- [ ] Lỗ `executed` đã vá, có lưới đỏ-trước-xanh-sau chứng minh hành vi cũ SAI.
- [ ] Mọi thay đổi thử nghiệm trên dự án SERVER đã **hoàn nguyên**.

## Ngoài phạm vi Đợt B

Đường ghi cục bộ (Đợt C) · Cmd+K · vòng tác nhân ở client (Đợt D) · duyệt theo khối (hunk) ·
`run_command` (chỉ `apply_diff`) · ghost-text.
