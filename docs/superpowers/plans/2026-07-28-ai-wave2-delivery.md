# Wave 2 — "Giao được hàng" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa **ba đường giao hàng đứt** khiến AI đã có sẵn không tới được tay người dùng — không thêm AI mới.

**Architecture:** Đường A đưa 150 đề xuất ngưỡng đang tồn đọng về đúng màn điểm đo (badge + duyệt tại chỗ + batch), tận dụng `threshold_approvals.pointDefId` và cơ chế chọn-nhiều-điểm đã có. Đường B nối hàm `searchCorpus()` **đã tồn tại nhưng 0 caller** vào `retrieveKnowledge()`, rồi mở ingest cho nhiều file + kéo-thả + ảnh qua VLM. Đường C bật ghost-text ở cả 4 màn soạn code, đưa ô tra sổ-tay về nơi viết code, và ghim model tường minh.

**Tech Stack:** TypeScript · tRPC · Drizzle (postgres-js) · pgvector · React 19 + TanStack Query · CodeMirror 6 · Vitest · GGUF local (Qwen3 chat + Qwen3-VL vision)

**Spec:** `docs/superpowers/specs/2026-07-28-ai-wave2-delivery-design.md` (commit `01353831`, đính chính `195177c9`)

## Global Constraints

- Nhánh `feat/hmi-dep`. Mỗi task commit riêng, **chỉ stage file của task đó** — TUYỆT ĐỐI không `git add -A` (cây làm việc có thay đổi simulator/twin/knowledge chưa commit của người dùng). **Không push** (controller push ở chốt cuối).
- TDD: test đỏ trước → chạy thấy đỏ → cài đặt tối thiểu → chạy thấy xanh. **Không bao giờ làm yếu assertion để test qua.**
- `npx tsc --noEmit` sạch cho file đã chạm (`NODE_OPTIONS=--max-old-space-size=8192`). Lỗi `client/src/pages/SessionManagement.tsx(194,64)` là **có sẵn từ trước, không phải của bạn**.
- **KHÔNG chạy model thật, KHÔNG khởi động server, KHÔNG chạy migration.** Unit test với mock. Controller đo live sau mỗi đường.
- **Mọi lời gọi model mới PHẢI ghim `modelId` tường minh.** Bài học Wave 1: `getOrLoadModel(undefined)` từng trả về model NHÚNG và sinh ra rác `"result result result"` được trình bày như câu trả lời.
- Env đọc theo khuôn: `const raw = Number(process.env.X); return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT;` — **không** `Number(process.env.X || DEFAULT)` (chuỗi `"0"` là truthy, đã gây lỗi thật).
- Bắt lỗi thiếu bảng/cột dùng cause-walker `isMissingTable`/`isMissingColumn` trong `server/_core/dbErrors.ts` (drizzle bọc mã lỗi pg trong `err.cause`) — **không** so `err.code` trần.
- Chuỗi hiển thị qua `t(...)` mặc định tiếng Việt; thêm khoá vào cả `client/src/i18n/locales/{vi,en,zh}.json`.
- **TUYỆT ĐỐI không nới chuỗi an toàn**: không đụng `DPC_DEPLOY_ENABLED`, không bỏ SoD (`decidedBy ≠ requestedBy`), không bỏ 4-mắt/OTP/cổng-mô-phỏng, không gỡ 7 write-tool ngưỡng/điểm-đo khỏi denylist tự-trị (`server/services/ai/autonomyPolicy.ts:105-138`).
- **Suy giảm phải TRUNG THỰC**: thiếu bảng/model/cấu hình ⇒ nói rõ lý do; **không** trả kết quả rỗng trông như thành công.
- ⚠ **CÓ HAI FILE TRÙNG TÊN `kbVectorStore.ts`.** Wave 2 dùng `server/services/kbVectorStore.ts` (không có `/kb/`) — đó là file đọc/ghi `kb_studio_chunks`. File `server/services/kb/kbVectorStore.ts` đọc bảng **`kb_chunks`** khác, **không dùng ở wave này**.

---

## Cấu trúc file

| File | Trách nhiệm | Task |
|---|---|---|
| `server/routers/thresholdApprovalRouter.ts` (sửa) | Thêm `countPendingByProduct` | 1 |
| `client/src/pages/ProductModels.tsx` (sửa) | Badge trên hàng điểm đo + nút batch | 1, 3 |
| `client/src/components/productModels/PointDetailsForm.tsx` (sửa) | Khối đề xuất + duyệt tại chỗ | 2 |
| `client/src/components/productModels/PendingSuggestionCard.tsx` (**mới**) | Hiển thị + duyệt/từ chối 1 đề xuất | 2 |
| `client/src/components/productModels/BatchSuggestDialog.tsx` (**mới**) | Xem trước + gửi đề xuất hàng loạt | 3 |
| `server/services/aiLocalKnowledgeService.ts` (sửa) | Trộn nguồn Studio vào `retrieveKnowledge` | 4 |
| `client/src/pages/kbStudio/SourceTab.tsx` (sửa) | Nhiều file + kéo-thả | 5 |
| `server/services/kbDocParser.ts` (sửa) | Thêm `"image"` vào `KbSourceType` | 6 |
| `server/services/kbImageDescriber.ts` (**mới**) | Ảnh → mô tả VLM → văn bản | 6 |
| `client/src/components/engineering/CodeEditor.tsx` (dùng lại) + 3 màn (sửa) | Bật ghost-text | 7 |
| `server/services/programming/aiProgrammingCopilot.ts` (sửa) | Ghim model cho `completeInline` | 7 |

---

# ĐƯỜNG A — Đưa 150 đề xuất về đúng màn hình

## Task 1: Đếm đề xuất chờ + badge trên danh sách điểm đo

**Files:**
- Modify: `server/routers/thresholdApprovalRouter.ts` (thêm procedure cạnh `list` ở `:304`)
- Modify: `client/src/pages/ProductModels.tsx` (danh sách điểm đo)
- Test: `server/routers/thresholdApprovalCount.test.ts` (**mới**)

**Interfaces:**
- Produces: `trpc.thresholdApproval.countPendingByProduct({ productModelId: number })` → `{ byPoint: Record<number, number>; total: number }`. Task 2 và 3 dùng lại.

- [ ] **Step 1: Viết test đỏ**

Tạo `server/routers/thresholdApprovalCount.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: Array<{ pointDefId: number; status: string; productModelId: number }> = [];
const fakeDb = {
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(
    rows.filter(r => r.status === "requested").map(r => ({ pointDefId: r.pointDefId, cnt: 1 })),
  ) }) }) }),
};
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));

import { countPendingByPoint } from "../services/thresholdApprovalCount";

beforeEach(() => { rows.length = 0; vi.clearAllMocks(); });

describe("countPendingByPoint", () => {
  it("gom đúng số đề xuất 'requested' theo pointDefId", async () => {
    rows.push(
      { pointDefId: 7, status: "requested", productModelId: 1 },
      { pointDefId: 7, status: "requested", productModelId: 1 },
      { pointDefId: 9, status: "requested", productModelId: 1 },
    );
    const r = await countPendingByPoint(1);
    expect(r.byPoint[7]).toBe(2);
    expect(r.byPoint[9]).toBe(1);
    expect(r.total).toBe(3);
  });

  it("không có đề xuất ⇒ rỗng, total 0, KHÔNG ném", async () => {
    const r = await countPendingByPoint(1);
    expect(r.byPoint).toEqual({});
    expect(r.total).toBe(0);
  });

  it("DB không sẵn sàng ⇒ rỗng, KHÔNG ném (màn điểm đo phải chạy bình thường)", async () => {
    const { getDb } = await import("../db/connection");
    (getDb as any).mockResolvedValueOnce(null);
    await expect(countPendingByPoint(1)).resolves.toEqual({ byPoint: {}, total: 0 });
  });

  it("bảng chưa migrate (42P01 bọc trong err.cause) ⇒ rỗng, KHÔNG ném", async () => {
    const inner: any = new Error('relation "threshold_approvals" does not exist');
    inner.code = "42P01";
    const wrapped: any = new Error("DrizzleQueryError");
    wrapped.cause = inner;
    const { getDb } = await import("../db/connection");
    (getDb as any).mockResolvedValueOnce({
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.reject(wrapped) }) }) }),
    });
    await expect(countPendingByPoint(1)).resolves.toEqual({ byPoint: {}, total: 0 });
  });
});
```

- [ ] **Step 2: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/routers/thresholdApprovalCount.test.ts`
Kỳ vọng: FAIL — không tìm thấy `../services/thresholdApprovalCount`.

- [ ] **Step 3: Cài đặt hàm đếm**

Tạo `server/services/thresholdApprovalCount.ts`:

```ts
/**
 * Wave 2 đường A — đếm đề xuất ngưỡng ĐANG CHỜ theo từng điểm đo của một sản phẩm.
 *
 * Vì sao cần: đo trên DB ngày 2026-07-28 có 150 dòng threshold_approvals, TẤT CẢ
 * status='requested', 0 quyết định — vì chúng chỉ hiện ở /threshold-approvals, một
 * trang KHÁC với /products nơi kỹ sư thực sự chỉnh điểm đo. Hàm này cấp dữ liệu để
 * gắn badge ngay tại chỗ làm việc.
 *
 * MỘT truy vấn gộp cho cả sản phẩm (không N+1). Fail-safe tuyệt đối: mọi lỗi ⇒ rỗng,
 * vì đây là tính năng PHỤ — không bao giờ được chặn màn hình chính.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { thresholdApprovals, measurementPointDefs } from "../../drizzle/schema";
import { isMissingTable } from "../_core/dbErrors";

export interface PendingByPointResult {
  byPoint: Record<number, number>;
  total: number;
}

const EMPTY: PendingByPointResult = { byPoint: {}, total: 0 };

export async function countPendingByPoint(productModelId: number): Promise<PendingByPointResult> {
  const db = await getDb();
  if (!db) return EMPTY;
  try {
    const rows = (await db
      .select({
        pointDefId: thresholdApprovals.pointDefId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(thresholdApprovals)
      .innerJoin(measurementPointDefs, eq(measurementPointDefs.id, thresholdApprovals.pointDefId))
      .where(and(
        eq(measurementPointDefs.productModelId, productModelId),
        eq(thresholdApprovals.status, "requested"),
      ))
      .groupBy(thresholdApprovals.pointDefId)) as Array<{ pointDefId: number; cnt: number }>;

    const byPoint: Record<number, number> = {};
    let total = 0;
    for (const r of rows ?? []) {
      const n = Number(r.cnt) || 0;
      byPoint[r.pointDefId] = (byPoint[r.pointDefId] ?? 0) + n;
      total += n;
    }
    return { byPoint, total };
  } catch (err) {
    if (!isMissingTable(err)) {
      console.warn("[thresholdApprovalCount] đếm thất bại — ẩn badge, màn điểm đo vẫn chạy:", (err as any)?.message ?? err);
    }
    return EMPTY;
  }
}
```

- [ ] **Step 4: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/routers/thresholdApprovalCount.test.ts`
Kỳ vọng: PASS 4/4.

- [ ] **Step 5: Thêm procedure vào router**

Trong `server/routers/thresholdApprovalRouter.ts`, thêm cạnh `list` (`:304`), dùng đúng `protectedProcedure` mà `list` đang dùng:

```ts
  /** Wave 2 đường A — số đề xuất ĐANG CHỜ theo từng điểm đo, để gắn badge ngay trên /products. */
  countPendingByProduct: protectedProcedure
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { countPendingByPoint } = await import("../services/thresholdApprovalCount");
      return countPendingByPoint(input.productModelId);
    }),
```

- [ ] **Step 6: Gắn badge vào danh sách điểm đo**

Trong `client/src/pages/ProductModels.tsx`:
- Gọi `trpc.thresholdApproval.countPendingByProduct.useQuery({ productModelId }, { enabled: productModelId != null })`.
- Trên mỗi hàng điểm đo, nếu `data?.byPoint[point.id] > 0` thì hiện badge nhỏ, nhãn qua `t("productModels.pendingSuggestions", "{{n}} đề xuất AI")`.
- Badge chỉ là **chỉ báo** — bấm vào mở form chi tiết điểm đó (Task 2 render khối duyệt trong form).
- Query lỗi/rỗng ⇒ **không hiện gì**, danh sách hoạt động bình thường.
- Thêm khoá i18n vào cả `vi/en/zh`.

- [ ] **Step 7: Typecheck + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add server/services/thresholdApprovalCount.ts server/routers/thresholdApprovalCount.test.ts server/routers/thresholdApprovalRouter.ts client/src/pages/ProductModels.tsx client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/w2-A1): đếm đề xuất ngưỡng chờ theo điểm đo + badge trên /products (150 đề xuất đang vô hình)"
```

---

## Task 2: Xem + duyệt đề xuất ngay trong form điểm đo (giữ SoD)

**Files:**
- Create: `client/src/components/productModels/PendingSuggestionCard.tsx`
- Modify: `client/src/components/productModels/PointDetailsForm.tsx` (cạnh `AIThresholdSuggestButton` ở `:402`)
- Test: `client/src/components/productModels/pendingSuggestion.logic.test.ts` (**mới**)

**Interfaces:**
- Consumes: `trpc.thresholdApproval.list` (đã có, `:304`), `trpc.thresholdApproval.approve` / `.reject` (đã có, `qualityProcedure` ở `:184`/`:247`), `countPendingByProduct` (Task 1).
- Produces: `canDecide(approval, currentUserId): { allowed: boolean; reason?: "own-request" | "unknown-user" }` — hàm thuần, Task 3 dùng lại cho batch.

- [ ] **Step 1: Viết test đỏ cho luật SoD (hàm thuần)**

Tạo `client/src/components/productModels/pendingSuggestion.logic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canDecide } from "./pendingSuggestionLogic";

describe("canDecide — Segregation of Duties", () => {
  it("người KHÁC người đề xuất ⇒ được quyết định", () => {
    expect(canDecide({ requestedBy: 7 }, 9)).toEqual({ allowed: true });
  });

  it("CHÍNH người đề xuất ⇒ KHÔNG được, nêu lý do rõ ràng", () => {
    expect(canDecide({ requestedBy: 7 }, 7)).toEqual({ allowed: false, reason: "own-request" });
  });

  it("đề xuất do auto-tune tạo (requestedBy khác user hiện tại) ⇒ được quyết định", () => {
    expect(canDecide({ requestedBy: 1 }, 42)).toEqual({ allowed: true });
  });

  it("không biết user hiện tại ⇒ KHÔNG được, lý do phải là 'unknown-user' KHÔNG phải 'own-request'", () => {
    expect(canDecide({ requestedBy: 7 }, undefined)).toEqual({ allowed: false, reason: "unknown-user" });
  });
});
```

- [ ] **Step 2: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run client/src/components/productModels/pendingSuggestion.logic.test.ts`
Kỳ vọng: FAIL — không tìm thấy `./pendingSuggestionLogic`.

- [ ] **Step 3: Cài đặt hàm thuần**

Tạo `client/src/components/productModels/pendingSuggestionLogic.ts`:

```ts
/**
 * Wave 2 đường A — luật Phân tách trách nhiệm (SoD) phía client.
 *
 * QUAN TRỌNG: đây CHỈ là lớp hiển thị. Máy chủ vẫn là nơi thực thi thật
 * (thresholdApprovalRouter kiểm decidedBy ≠ requestedBy). Hàm này tồn tại để
 * KHOÁ nút và NÓI RÕ LÝ DO thay vì để người dùng bấm rồi nhận lỗi khó hiểu.
 * Fail-closed: không xác định được user ⇒ không cho quyết định.
 */
export interface DecideGateInput {
  requestedBy: number;
}

export interface DecideGateResult {
  allowed: boolean;
  reason?: "own-request" | "unknown-user";
}

export function canDecide(approval: DecideGateInput, currentUserId: number | undefined): DecideGateResult {
  // Fail-closed, nhưng LÝ DO PHẢI TRUNG THỰC: không biết user KHÁC với tự-duyệt.
  // Nói sai lý do chính là cái bệnh mà cả Wave 2 sinh ra để chữa.
  if (currentUserId == null) return { allowed: false, reason: "unknown-user" };
  if (approval.requestedBy === currentUserId) return { allowed: false, reason: "own-request" };
  return { allowed: true };
}
```

- [ ] **Step 4: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run client/src/components/productModels/pendingSuggestion.logic.test.ts`
Kỳ vọng: PASS 4/4.

- [ ] **Step 5: Dựng `PendingSuggestionCard`**

Tạo `client/src/components/productModels/PendingSuggestionCard.tsx`. Yêu cầu bắt buộc:
- Props: `{ pointDefId: number; currentUserId?: number; onDecided?: () => void }`.
- Lấy dữ liệu: `trpc.thresholdApproval.list.useQuery({ status: "requested", pointDefId })` (dùng đúng bộ lọc mà `list` đã hỗ trợ; nếu `list` chưa nhận `pointDefId` thì lọc phía client trên kết quả của sản phẩm hiện tại — **không** đổi hợp đồng `list`).
- Với mỗi đề xuất hiện: **giá trị hiện tại → giá trị đề xuất** (`currentLsl/Usl/Nominal` → `proposedLsl/Usl/Nominal`), và **bằng chứng đã có sẵn** trong cột `suggestion` (jsonb): số mẫu, Cpk, `proposedBy` (`"ai_autotune"` ⇒ nhãn "Tự động dò"), ảnh NG nếu có.
- Nút **Duyệt** / **Từ chối** gọi `trpc.thresholdApproval.approve` / `.reject` (mutation **đã có**, không tạo đường ghi mới).
- Khi `canDecide(...).allowed === false`: nút **khoá** + hiện câu giải thích **đúng theo `reason`**, hai câu KHÁC NHAU, **không ẩn im lặng**:
  - `"own-request"` ⇒ `t("productModels.ownRequestBlocked", "Bạn là người tạo đề xuất này — cần người khác duyệt.")`
  - `"unknown-user"` ⇒ `t("productModels.unknownUserBlocked", "Chưa xác định được tài khoản của bạn — hãy đăng nhập lại để duyệt.")`
- Sau khi quyết định: gọi `onDecided()` để cha invalidate cả `list` lẫn `countPendingByProduct`.
- Không có đề xuất ⇒ **không render gì** (không chiếm chỗ trong form).

Khung cho phần cổng SoD (phần dễ làm sai nhất — phải KHOÁ kèm lý do, không được ẩn im lặng):

```tsx
const gate = canDecide({ requestedBy: approval.requestedBy }, currentUserId);

<Button
  disabled={!gate.allowed || decideM.isPending}
  onClick={() => decideM.mutate({ id: approval.id })}
>
  {t("productModels.approveSuggestion", "Duyệt")}
</Button>

{!gate.allowed && (
  <p className="text-sm text-muted-foreground">
    {gate.reason === "unknown-user"
      ? t("productModels.unknownUserBlocked", "Chưa xác định được tài khoản của bạn — hãy đăng nhập lại để duyệt.")
      : t("productModels.ownRequestBlocked", "Bạn là người tạo đề xuất này — cần người khác duyệt.")}
  </p>
)}
```

- [ ] **Step 6: Nhúng vào form điểm đo**

Trong `client/src/components/productModels/PointDetailsForm.tsx`, đặt `<PendingSuggestionCard />` ngay trên/dưới `AIThresholdSuggestButton` (`:402`) — cùng khu vực, để người dùng thấy "đề xuất đang chờ" và "xin đề xuất mới" cạnh nhau. Truyền `currentUserId` từ `useAuth()`.

- [ ] **Step 7: Typecheck + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add client/src/components/productModels/PendingSuggestionCard.tsx client/src/components/productModels/pendingSuggestionLogic.ts client/src/components/productModels/pendingSuggestion.logic.test.ts client/src/components/productModels/PointDetailsForm.tsx client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/w2-A2): xem + duyệt đề xuất ngưỡng ngay trong form điểm đo, giữ nguyên SoD"
```

---

## Task 3: Đề xuất + duyệt hàng loạt

**Files:**
- Create: `client/src/components/productModels/BatchSuggestDialog.tsx`
- Modify: `client/src/pages/ProductModels.tsx` (nút batch cạnh `handleBatchDelete`/`handleBatchExport`)
- Test: `client/src/components/productModels/batchSuggest.logic.test.ts` (**mới**)

**Interfaces:**
- Consumes: `trpc.aiThresholdAdvisor.recommendForPoint` (đã có, `aiThresholdAdvisorRouter.ts:37`); `trpc.thresholdApproval.request` (đã có, `:136`); `selectedPointIds: Set<number>` (`ProductModels.tsx:468`); `countPendingByProduct` (Task 1, để invalidate).
- Produces: `partitionBatch(results)` — hàm thuần chia kết quả thành `ready` / `insufficient`.

**Phạm vi task này chỉ là ĐỀ XUẤT hàng loạt, KHÔNG phải duyệt hàng loạt.** Duyệt hàng loạt **đã tồn tại** ở `/threshold-approvals` (`trpc.thresholdApproval.batchApprove`, `:207`) — không nhân bản nó sang màn sản phẩm. Duyệt từng điểm tại chỗ đã có ở Task 2. Đây là YAGNI có chủ đích, ghi rõ để người thi công không tự ý thêm.

**Ghi chú chi phí (đã kiểm chứng):** `aiThresholdAdvisor` **KHÔNG gọi model nào** — nó là thống kê thuần (percentile cắt tỉa P0.135/P99.865 ≈ ±3σ + co Bayes, `server/utils/thresholdSuggestion.ts:6-7,147-161`). Vì vậy chạy cho N điểm **không tranh VRAM**, không cần xếp hàng.

- [ ] **Step 1: Viết test đỏ**

Tạo `client/src/components/productModels/batchSuggest.logic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { partitionBatch } from "./batchSuggestLogic";

describe("partitionBatch", () => {
  it("tách điểm đủ dữ liệu và điểm thiếu mẫu", () => {
    const r = partitionBatch([
      { pointDefId: 1, ok: true, sampleCount: 500, proposedLsl: 1, proposedUsl: 2 },
      { pointDefId: 2, ok: false, sampleCount: 12, reason: "insufficient-samples" },
      { pointDefId: 3, ok: true, sampleCount: 800, proposedLsl: 3, proposedUsl: 4 },
    ]);
    expect(r.ready.map(x => x.pointDefId)).toEqual([1, 3]);
    expect(r.insufficient.map(x => x.pointDefId)).toEqual([2]);
  });

  it("KHÔNG bịa số cho điểm thiếu mẫu — giữ nguyên lý do", () => {
    const r = partitionBatch([{ pointDefId: 9, ok: false, sampleCount: 3, reason: "insufficient-samples" }]);
    expect(r.ready).toEqual([]);
    expect(r.insufficient[0]).toMatchObject({ pointDefId: 9, reason: "insufficient-samples" });
    expect(r.insufficient[0]).not.toHaveProperty("proposedLsl");
  });

  it("danh sách rỗng ⇒ hai nhóm rỗng, không ném", () => {
    expect(partitionBatch([])).toEqual({ ready: [], insufficient: [] });
  });
});
```

- [ ] **Step 2: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run client/src/components/productModels/batchSuggest.logic.test.ts`
Kỳ vọng: FAIL — không tìm thấy `./batchSuggestLogic`.

- [ ] **Step 3: Cài đặt hàm thuần**

Tạo `client/src/components/productModels/batchSuggestLogic.ts`:

```ts
/**
 * Wave 2 đường A — chia kết quả đề xuất hàng loạt thành "gửi được" và "thiếu dữ liệu".
 *
 * Nguyên tắc: điểm không đủ mẫu (ngưỡng mặc định 300, aiThresholdAdvisor.ts:37-40)
 * PHẢI hiện lý do trung thực, TUYỆT ĐỐI không bịa giá trị đề xuất cho nó.
 */
export interface BatchSuggestItem {
  pointDefId: number;
  ok: boolean;
  sampleCount: number;
  reason?: string;
  proposedLsl?: number;
  proposedUsl?: number;
  proposedNominal?: number;
}

export interface BatchPartition {
  ready: BatchSuggestItem[];
  insufficient: BatchSuggestItem[];
}

export function partitionBatch(items: BatchSuggestItem[]): BatchPartition {
  const ready: BatchSuggestItem[] = [];
  const insufficient: BatchSuggestItem[] = [];
  for (const it of items ?? []) {
    if (it.ok) ready.push(it);
    else insufficient.push(it);
  }
  return { ready, insufficient };
}
```

- [ ] **Step 4: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run client/src/components/productModels/batchSuggest.logic.test.ts`
Kỳ vọng: PASS 3/3.

- [ ] **Step 5: Dựng `BatchSuggestDialog`**

Tạo `client/src/components/productModels/BatchSuggestDialog.tsx`. Yêu cầu bắt buộc:
- Props: `{ open: boolean; pointDefIds: number[]; currentUserId?: number; onClose: () => void }`.
- Khi mở: gọi `trpc.aiThresholdAdvisor.recommendForPoint` cho **từng** `pointDefId` (thống kê thuần, không phải model — chạy tuần tự là đủ, không cần hàng đợi), gom vào `partitionBatch`.
- Hiện **hai nhóm rõ ràng**:
  - "Gửi được (N)": bảng có checkbox **từng dòng** — hiện tại → đề xuất, số mẫu. Mặc định **tích sẵn**, người dùng bỏ tích được.
  - "Chưa đủ dữ liệu (M)": liệt kê điểm + số mẫu + câu `t("productModels.insufficientSamples", "Chưa đủ mẫu để đề xuất — cần tối thiểu {{min}} mẫu.")`. **Không** cho gửi.
- Nút "Gửi N đề xuất": gọi `trpc.thresholdApproval.request` cho từng dòng đã tích. Hiện tiến độ và **tổng kết trung thực**: gửi thành công bao nhiêu, lỗi bao nhiêu (kèm lý do), **không** báo "thành công" khi có dòng lỗi.
- Kết thúc: invalidate `list` + `countPendingByProduct`.

- [ ] **Step 6: Nối nút vào thanh batch có sẵn**

Trong `client/src/pages/ProductModels.tsx`, ở chỗ đang có `handleBatchDelete` (`:2297`) / `handleBatchExport` (`:2308`), thêm nút "AI đề xuất cho N điểm" mở `BatchSuggestDialog` với `Array.from(selectedPointIds)`. Nút **ẩn/khoá** khi `selectedPointIds.size === 0`.

- [ ] **Step 7: Typecheck + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add client/src/components/productModels/BatchSuggestDialog.tsx client/src/components/productModels/batchSuggestLogic.ts client/src/components/productModels/batchSuggest.logic.test.ts client/src/pages/ProductModels.tsx client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/w2-A3): đề xuất ngưỡng hàng loạt cho N điểm đã chọn (thống kê thuần, xem trước từng dòng)"
```

> **CHỐT ĐƯỜNG A — controller đo live trước khi sang đường B.** Không chuyển tiếp khi chưa thấy badge thật trên `/products` với 150 dòng có sẵn trong DB.

---

# ĐƯỜNG B — Nối kho Studio vào trợ lý + nạp nhiều file + ảnh

## Task 4: Trộn kho Studio vào `retrieveKnowledge` + vá lời nói dối UI

**Files:**
- Modify: `server/services/aiLocalKnowledgeService.ts` (`retrieveKnowledge` ở `:1576`, `KbCitation` ở `:70`)
- Modify: `client/src/i18n/locales/{vi,en,zh}.json` (khoá `kbStudio.modelBuilder.comingSoonDesc`)
- Test: `server/services/aiLocalKnowledge.studioMerge.test.ts` (**mới**)

**Interfaces:**
- Consumes: `searchCorpus(corpus, queryEmbedding, k)` từ **`server/services/kbVectorStore.ts:180`** (⚠ KHÔNG phải `server/services/kb/kbVectorStore.ts`); `listCorpora()` từ `server/services/kbStudioService.ts:89`.
- Produces: `KbCitation.origin?: "system" | "studio"` — **tuỳ chọn, thuần bổ sung**.

- [ ] **Step 1: Kiểm mọi consumer của `KbCitation` TRƯỚC khi đổi kiểu**

Chạy và đọc kết quả:
```bash
grep -rn "KbCitation\|citations\[" server/ client/ --include=*.ts --include=*.tsx | grep -v "\.test\." | head -30
```
Ghi vào báo cáo: mọi nơi đọc `citations`. Trường mới **phải tuỳ chọn** để tất cả các chỗ đó chạy nguyên vẹn khi nó vắng mặt. Nếu thấy chỗ nào dùng `Object.keys`/so khớp kiểu chặt, nêu rõ trong báo cáo.

- [ ] **Step 2: Viết test đỏ**

Tạo `server/services/aiLocalKnowledge.studioMerge.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const searchCorpusMock = vi.fn();
const listCorporaMock = vi.fn();
vi.mock("./kbVectorStore", () => ({ searchCorpus: (...a: any[]) => searchCorpusMock(...a) }));
vi.mock("./kbStudioService", () => ({ listCorpora: (...a: any[]) => listCorporaMock(...a) }));

import { gatherStudioHits } from "./aiLocalKnowledgeStudio";

beforeEach(() => { vi.clearAllMocks(); });

describe("gatherStudioHits", () => {
  it("duyệt mọi corpus và gộp kết quả, cắt theo topK", async () => {
    listCorporaMock.mockResolvedValue({ corpora: [{ name: "a" }, { name: "b" }] });
    searchCorpusMock
      .mockResolvedValueOnce([{ id: 1, text: "A1", sourceRef: "a.pdf", score: 0.9 }])
      .mockResolvedValueOnce([{ id: 2, text: "B1", sourceRef: "b.pdf", score: 0.95 }]);
    const hits = await gatherStudioHits([0.1, 0.2], 1);
    expect(searchCorpusMock).toHaveBeenCalledTimes(2);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("B1"); // điểm cao hơn thắng
  });

  it("KHÔNG có corpus nào ⇒ rỗng, không gọi searchCorpus", async () => {
    listCorporaMock.mockResolvedValue({ corpora: [] });
    expect(await gatherStudioHits([0.1], 5)).toEqual([]);
    expect(searchCorpusMock).not.toHaveBeenCalled();
  });

  it("listCorpora ném ⇒ rỗng, KHÔNG ném ra ngoài (trợ lý phải vẫn trả lời)", async () => {
    listCorporaMock.mockRejectedValue(new Error("db down"));
    await expect(gatherStudioHits([0.1], 5)).resolves.toEqual([]);
  });

  it("một corpus ném ⇒ vẫn lấy được kết quả của corpus còn lại", async () => {
    listCorporaMock.mockResolvedValue({ corpora: [{ name: "a" }, { name: "b" }] });
    searchCorpusMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([{ id: 2, text: "B1", sourceRef: "b.pdf", score: 0.5 }]);
    const hits = await gatherStudioHits([0.1], 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("B1");
  });

  it("embedding rỗng ⇒ rỗng, không gọi searchCorpus (tránh nhúng lần hai)", async () => {
    listCorporaMock.mockResolvedValue({ corpora: [{ name: "a" }] });
    expect(await gatherStudioHits([], 5)).toEqual([]);
    expect(searchCorpusMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiLocalKnowledge.studioMerge.test.ts`
Kỳ vọng: FAIL — không tìm thấy `./aiLocalKnowledgeStudio`.

- [ ] **Step 4: Cài đặt hàm gộp**

Tạo `server/services/aiLocalKnowledgeStudio.ts`:

```ts
/**
 * Wave 2 đường B — cầu nối kho Training Studio vào truy hồi của trợ lý.
 *
 * BỐI CẢNH: `searchCorpus()` (server/services/kbVectorStore.ts:180) ĐÃ TỒN TẠI, đã có
 * 2 tầng (pgvector HNSW + brute-force) và đã fail-safe — nhưng KHÔNG CÓ CALLER SẢN XUẤT
 * NÀO. Tài liệu người dùng nạp vào Studio vì thế không bao giờ tới được trợ lý, trong khi
 * UI lại nói ngược lại. Hàm này là chỗ nối duy nhất.
 *
 * HAI CHI TIẾT QUAN TRỌNG:
 *  1. searchCorpus nhận EMBEDDING ĐÃ TÍNH SẴN — dùng lại qVec mà retrieveKnowledge đã
 *     tính, KHÔNG nhúng lần hai (tốn thời gian + có thể lệch không gian vector).
 *  2. searchCorpus lọc theo MỘT corpus — duyệt listCorpora() rồi gộp.
 *
 * FAIL-SAFE TUYỆT ĐỐI: mọi lỗi ⇒ [] . Trợ lý phải trả lời được bằng corpus file ngay cả
 * khi toàn bộ nhánh Studio hỏng.
 */
export interface StudioHit {
  id: number;
  text: string;
  sourceRef: string;
  score: number;
  corpus: string;
}

export async function gatherStudioHits(queryEmbedding: number[], topK: number): Promise<StudioHit[]> {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return [];
  try {
    const { listCorpora } = await import("./kbStudioService");
    const { searchCorpus } = await import("./kbVectorStore");
    const listed = await listCorpora();
    const names = (listed?.corpora ?? []).map((c: any) => c?.name).filter((n: any): n is string => typeof n === "string" && n.length > 0);
    if (names.length === 0) return [];

    const all: StudioHit[] = [];
    for (const name of names) {
      try {
        const hits = await searchCorpus(name, queryEmbedding, topK);
        for (const h of hits ?? []) {
          all.push({
            id: Number((h as any).id),
            text: String((h as any).text ?? ""),
            sourceRef: String((h as any).sourceRef ?? ""),
            score: Number((h as any).score ?? 0),
            corpus: name,
          });
        }
      } catch {
        // Một corpus hỏng không được làm mất kết quả của corpus khác.
      }
    }
    all.sort((a, b) => b.score - a.score);
    return all.slice(0, Math.max(1, topK));
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiLocalKnowledge.studioMerge.test.ts`
Kỳ vọng: PASS 5/5.

- [ ] **Step 6: Nối vào `retrieveKnowledge` + gắn nhãn nguồn**

Trong `server/services/aiLocalKnowledgeService.ts`:
- Thêm trường **tuỳ chọn** vào `KbCitation` (`:70`):
  ```ts
    /** Wave 2 — nguồn của trích dẫn. Vắng mặt = "system" (giữ nguyên hành vi cũ cho mọi consumer). */
    origin?: "system" | "studio";
  ```
- Trong `retrieveKnowledge` (`:1576`), **sau** khi đã có `qVec` (biến sẵn có từ `embedQuestion`), gọi `gatherStudioHits(qVec, topK)` và trộn kết quả vào `citations`/`contexts` đang trả về. Trích dẫn từ Studio đặt `origin: "studio"`, `sourcePath` = `sourceRef`, `sourceType` = `"studio"`.
- **Điều kiện**: chỉ gọi khi `qVec` khác null (tức guard `computeEmbedModelMatches` sẵn có đã cho phép dùng vector). Nếu `qVec` null ⇒ **bỏ qua nhánh Studio** (không có cách so khớp hợp lệ).
- Bọc toàn bộ trong try/catch: lỗi ⇒ giữ nguyên kết quả corpus file.

Khung mã cho phần trộn (đặt sau khi `qVec` đã có, trước khi dựng kết quả trả về). Tên biến `qVec`/`citations`/`contexts` phải khớp đúng biến thật trong hàm — đọc mã trước khi dán:

```ts
  // Wave 2 đường B — bổ sung nguồn "tài liệu người dùng nạp" (kho Training Studio).
  // Kho này ĐÃ có searchCorpus() nhưng chưa từng có caller ⇒ tài liệu nạp vào không bao
  // giờ tới được trợ lý. Bổ sung, KHÔNG thay thế: mọi lỗi ⇒ giữ nguyên kết quả corpus file.
  if (qVec) {
    try {
      const { gatherStudioHits } = await import("./aiLocalKnowledgeStudio");
      const studioHits = await gatherStudioHits(qVec, topK);
      for (const h of studioHits) {
        citations.push({
          id: `studio:${h.corpus}:${h.id}`,
          sourcePath: h.sourceRef,
          title: h.sourceRef,
          sourceType: "studio",
          score: h.score,
          origin: "studio",
        });
        contexts.push(h.text);
      }
    } catch {
      // Nhánh Studio hỏng KHÔNG được làm hỏng trợ lý đang chạy.
    }
  }
```

Sau khi chèn, kiểm lại thứ tự/độ dài: nếu hàm đang cắt `citations`/`contexts` theo `topK` ở bước sau thì để nguyên cơ chế đó; nếu không, sắp xếp theo `score` giảm dần rồi cắt `topK` để nguồn Studio không đẩy hết nguồn hệ thống ra ngoài.

- [ ] **Step 7: Hiển thị nhãn nguồn ở UI trợ lý**

Ở nơi render citation của trợ lý, hiện nhãn phân biệt: `origin === "studio"` ⇒ `t("ai.citation.studio", "Tài liệu bạn nạp")`, còn lại ⇒ `t("ai.citation.system", "Kho hệ thống")`. Thêm khoá vào cả 3 locale.

- [ ] **Step 8: Vá câu chữ sai sự thật**

Sửa khoá i18n `kbStudio.modelBuilder.comingSoonDesc` ở cả `vi/en/zh`. Câu hiện tại khẳng định corpora "đã dùng cho câu trả lời RAG" — **sau Task này điều đó mới đúng**, nên viết lại cho khớp đúng trạng thái thật (corpora đã nạp giờ được trợ lý dùng làm nguồn trích dẫn; phần huấn luyện model riêng vẫn chưa có).

- [ ] **Step 9: Typecheck + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiLocalKnowledge.studioMerge.test.ts
git add server/services/aiLocalKnowledgeStudio.ts server/services/aiLocalKnowledge.studioMerge.test.ts server/services/aiLocalKnowledgeService.ts client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/w2-B1): nối kho Training Studio vào retrieveKnowledge (searchCorpus 0-caller) + nhãn nguồn + vá câu chữ sai sự thật"
```

---

## Task 5: Nạp nhiều file + kéo-thả

**Files:**
- Modify: `client/src/pages/kbStudio/SourceTab.tsx` (`:74`, `:132-154`)
- Test: `client/src/pages/kbStudio/sourceTab.logic.test.ts` (**mới**)

**Interfaces:**
- Consumes: `trpc.kbStudio.ingestDocumentJob` (đã có).
- Produces: `filesFromInput(list)` và `filesFromDrop(dt)` — hàm thuần chuẩn hoá danh sách file.

- [ ] **Step 1: Viết test đỏ**

Tạo `client/src/pages/kbStudio/sourceTab.logic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filesFromInput, filesFromDrop } from "./sourceTabLogic";

const f = (name: string) => ({ name }) as File;

describe("filesFromInput", () => {
  it("lấy TẤT CẢ file, không chỉ file đầu", () => {
    expect(filesFromInput([f("a.pdf"), f("b.docx"), f("c.md")] as any).map(x => x.name))
      .toEqual(["a.pdf", "b.docx", "c.md"]);
  });
  it("null/rỗng ⇒ mảng rỗng", () => {
    expect(filesFromInput(null as any)).toEqual([]);
    expect(filesFromInput([] as any)).toEqual([]);
  });
});

describe("filesFromDrop", () => {
  it("lấy file từ DataTransfer.files", () => {
    const dt = { files: [f("x.pdf"), f("y.png")] } as any;
    expect(filesFromDrop(dt).map(x => x.name)).toEqual(["x.pdf", "y.png"]);
  });
  it("DataTransfer không có file ⇒ rỗng, không ném", () => {
    expect(filesFromDrop({} as any)).toEqual([]);
    expect(filesFromDrop(null as any)).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run client/src/pages/kbStudio/sourceTab.logic.test.ts`
Kỳ vọng: FAIL — không tìm thấy `./sourceTabLogic`.

- [ ] **Step 3: Cài đặt hàm thuần**

Tạo `client/src/pages/kbStudio/sourceTabLogic.ts`:

```ts
/**
 * Wave 2 đường B — chuẩn hoá danh sách file cho ingest nhiều-file.
 *
 * Trước Wave 2: input KHÔNG có `multiple` và code chỉ đọc files[0]; ô "dropzone" có
 * viền nét đứt nhưng KHÔNG có onDrop — trông như vùng thả mà thả không có tác dụng.
 */
export function filesFromInput(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list as ArrayLike<File>);
}

export function filesFromDrop(dt: DataTransfer | null | undefined): File[] {
  if (!dt || !dt.files) return [];
  return Array.from(dt.files as ArrayLike<File>);
}
```

- [ ] **Step 4: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run client/src/pages/kbStudio/sourceTab.logic.test.ts`
Kỳ vọng: PASS 4/4.

- [ ] **Step 5: Sửa UI**

Trong `client/src/pages/kbStudio/SourceTab.tsx`:
- Thêm `multiple` vào `<input type="file">` (`:149-154`) và dùng `filesFromInput(e.target.files)` thay cho `e.target.files?.[0]`.
- Thêm **thật** `onDrop` / `onDragOver` / `onDragLeave` cho ô ở `:132-148` (hiện chỉ có `onClick`/`onKeyDown`), dùng `filesFromDrop(e.dataTransfer)`; `onDragOver` phải `e.preventDefault()` để trình duyệt cho phép thả.
- Đổi trạng thái từ `file: File | null` sang `files: File[]`; hiện danh sách file đã chọn, cho xoá từng file trước khi gửi.
- Gửi: lặp qua `files`, gọi `ingestDocumentJob` **cho từng file** ⇒ mỗi file một job độc lập. Hiện tiến độ từng file (chờ / đang chạy / xong / lỗi + lý do). **Một file lỗi không dừng các file còn lại.**
- Tổng kết trung thực: "Xong N/M, lỗi K" — **không** báo thành công khi có lỗi.
- Cập nhật câu chữ ô thả ở cả 3 locale (hiện là "Click to select a file" — nay đã thả được thật).

- [ ] **Step 6: Typecheck + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add client/src/pages/kbStudio/SourceTab.tsx client/src/pages/kbStudio/sourceTabLogic.ts client/src/pages/kbStudio/sourceTab.logic.test.ts client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/w2-B2): nạp nhiều file cùng lúc + kéo-thả THẬT (mỗi file một job độc lập)"
```

---

## Task 6: Nạp ảnh qua VLM

**Files:**
- Create: `server/services/kbImageDescriber.ts`
- Modify: `server/services/kbDocParser.ts` (`KbSourceType` ở `:36`, `normalizeSourceType` ở `:119-137`)
- Modify: `server/routers/kbIngestRouter.ts` (`allowedTypes` ở `:101`)
- Test: `server/services/kbImageDescriber.test.ts` (**mới**)

**Interfaces:**
- Consumes: `describeImage()` từ `server/services/aiProviderRouter.ts:391`; `isVisionSidecarAvailable()` từ `server/services/llamaVisionSidecar.ts:122`.
- Produces: `describeImageForKnowledge(buffer, hint?)` → `{ ok: true; text: string } | { ok: false; reason: string }`.

**Quyết định dựa trên đo đạc:** VLM Qwen3-VL + mmproj **có sẵn** (`.env:142-143`, boot log `gguf-vision: present`); OCR **chưa cấu hình** (`OCR_MODEL_DIR`/`PDFTOPPM_BIN` trống, `models/ocr` không tồn tại) ⇒ đường ảnh đi qua **VLM**, **không hứa OCR**.
⚠ `describeDefect()` (`aiVisionLanguage.ts:55`) là prompt **chuyên cho lỗi AOI** ("You are an expert AOI quality engineer… describe any defects") — **SAI mục đích** cho ảnh tài liệu. Dùng `describeImage()` của `aiProviderRouter` với prompt riêng cho kiến thức.

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/kbImageDescriber.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const describeImageMock = vi.fn();
const availableMock = vi.fn();
vi.mock("./aiProviderRouter", () => ({ describeImage: (...a: any[]) => describeImageMock(...a) }));
vi.mock("./llamaVisionSidecar", () => ({ isVisionSidecarAvailable: () => availableMock() }));

import { describeImageForKnowledge } from "./kbImageDescriber";

beforeEach(() => { vi.clearAllMocks(); availableMock.mockReturnValue(true); });

describe("describeImageForKnowledge", () => {
  it("VLM trả mô tả ⇒ ok + văn bản", async () => {
    describeImageMock.mockResolvedValue({ description: "Sơ đồ đấu dây PLC gồm 3 khối" });
    const r = await describeImageForKnowledge(Buffer.from("x"), "so-do.png");
    expect(r).toEqual({ ok: true, text: "Sơ đồ đấu dây PLC gồm 3 khối" });
  });

  it("VLM CHƯA sẵn sàng ⇒ từ chối TRUNG THỰC, KHÔNG gọi model", async () => {
    availableMock.mockReturnValue(false);
    const r = await describeImageForKnowledge(Buffer.from("x"));
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/thị giác|vision/i);
    expect(describeImageMock).not.toHaveBeenCalled();
  });

  it("VLM ném ⇒ ok:false kèm lý do, KHÔNG ném ra ngoài", async () => {
    describeImageMock.mockRejectedValue(new Error("model busy"));
    const r = await describeImageForKnowledge(Buffer.from("x"));
    expect(r.ok).toBe(false);
    expect((r as any).reason).toContain("model busy");
  });

  it("VLM trả mô tả RỖNG ⇒ ok:false (không lưu chunk rỗng giả vờ thành công)", async () => {
    describeImageMock.mockResolvedValue({ description: "   " });
    const r = await describeImageForKnowledge(Buffer.from("x"));
    expect(r.ok).toBe(false);
  });

  it("ghim model tường minh khi gọi VLM", async () => {
    describeImageMock.mockResolvedValue({ description: "ok" });
    await describeImageForKnowledge(Buffer.from("x"));
    const arg = describeImageMock.mock.calls[0][0];
    expect(arg.modelId ?? arg.model).toBeTruthy();
  });
});
```

- [ ] **Step 2: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/kbImageDescriber.test.ts`
Kỳ vọng: FAIL — không tìm thấy `./kbImageDescriber`.

- [ ] **Step 3: Cài đặt**

Tạo `server/services/kbImageDescriber.ts`:

```ts
/**
 * Wave 2 đường B — biến ẢNH thành văn bản cho kho kiến thức.
 *
 * VÌ SAO VLM CHỨ KHÔNG PHẢI OCR: đo trên máy này cho thấy Qwen3-VL + mmproj CÓ SẴN
 * (.env:142-143, boot log "gguf-vision: present"), còn OCR CHƯA cấu hình (OCR_MODEL_DIR
 * và PDFTOPPM_BIN trống, models/ocr không tồn tại). Nên ảnh được MÔ TẢ bằng VLM. Chữ
 * trong ảnh chỉ đọc được ở mức VLM mô tả — KHÔNG hứa OCR khi chưa có.
 *
 * VÌ SAO KHÔNG DÙNG describeDefect(): hàm đó (aiVisionLanguage.ts:55) mang prompt riêng
 * cho lỗi AOI ("expert AOI quality engineer… describe any defects") — sai mục đích với
 * ảnh tài liệu (sơ đồ, màn HMI, trang sổ tay).
 *
 * TRUNG THỰC: không mô tả được ⇒ ok:false kèm lý do. TUYỆT ĐỐI không lưu chunk rỗng
 * rồi báo thành công.
 */
import { resolveLogicalModel } from "./ai/modelResolver";

export type DescribeForKnowledgeResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

const KNOWLEDGE_IMAGE_PROMPT =
  "Mô tả nội dung kỹ thuật của hình ảnh này bằng tiếng Việt, đầy đủ và trung thực, " +
  "để dùng làm tài liệu tra cứu: các khối/thành phần nhìn thấy, nhãn và chữ đọc được, " +
  "quan hệ giữa các phần, và mọi thông số hiển thị. Nếu không đọc được phần nào, nói rõ.";

export async function describeImageForKnowledge(
  imageBuffer: Buffer,
  hint?: string,
): Promise<DescribeForKnowledgeResult> {
  try {
    const { isVisionSidecarAvailable } = await import("./llamaVisionSidecar");
    if (!isVisionSidecarAvailable()) {
      return { ok: false, reason: "Model thị giác chưa sẵn sàng — chưa thể nạp ảnh (vision model unavailable)." };
    }
    const { describeImage } = await import("./aiProviderRouter");
    // Ghim model tường minh (bài học Wave 1 — không để engine tự chọn "model nạp trước").
    const modelId = resolveLogicalModel("vision") ?? undefined;
    const res: any = await describeImage({
      imageBuffer,
      prompt: hint ? `${KNOWLEDGE_IMAGE_PROMPT}\n\nTên tệp: ${hint}` : KNOWLEDGE_IMAGE_PROMPT,
      modelId,
    } as any);
    const text = String(res?.description ?? "").trim();
    if (!text) return { ok: false, reason: "Model thị giác trả về mô tả rỗng." };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: `Mô tả ảnh thất bại: ${(err as any)?.message ?? String(err)}` };
  }
}
```

**Lưu ý khi cài đặt:** kiểm chữ ký thật của `describeImage` trong `server/services/aiProviderRouter.ts:391` (`DescribeImageRequest`) và khớp đúng tên trường; nếu nó không nhận `modelId`, hãy truyền model qua đúng trường mà nó hỗ trợ và **ghi rõ trong báo cáo**. Tương tự, kiểm `resolveLogicalModel` có khoá `"vision"` không (`server/services/ai/modelResolver.ts:220-240`); nếu không có, dùng đúng hàm phân giải model thị giác mà repo đã có và nêu trong báo cáo.

- [ ] **Step 4: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/kbImageDescriber.test.ts`
Kỳ vọng: PASS 5/5.

- [ ] **Step 5: Cho phép kiểu `image` + chống nhầm định dạng**

Trong `server/services/kbDocParser.ts`:
- Thêm `"image"` vào `KbSourceType` (`:36`). **Không cần migration** — cột `kb_studio_chunks.sourceType` là `varchar(20)`, không phải pg enum (`drizzle/schema/kbStudio.ts:116`).
- `normalizeSourceType` (`:119-137`) nhận thêm `png|jpg|jpeg|webp` → `"image"`.
- Đường phân tích ảnh: gọi `describeImageForKnowledge(buffer, filename)`; `ok:false` ⇒ ném `KbIngestValidationError` **kèm nguyên văn `reason`** để job ghi lý do thật (tab Jobs đã hiện `error`).
- **Chống nhầm định dạng**: thêm kiểm magic-byte tối thiểu (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WEBP `RIFF....WEBP`). Nếu đuôi nói là ảnh mà magic-byte không khớp ⇒ từ chối trung thực. Điều này cũng chặn mẹo đổi `photo.png` → `photo.txt` để lọt qua rồi lưu byte nhị phân thành chunk rác.

Trong `server/routers/kbIngestRouter.ts:101`: thêm các đuôi ảnh vào `allowedTypes` để `accept` của input phản ánh **đúng** thứ server thật sự nhận.

- [ ] **Step 6: Typecheck + chạy test liên quan + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/kbImageDescriber.test.ts server/services/kbDocParser.test.ts server/services/kbIngestService.test.ts
git add server/services/kbImageDescriber.ts server/services/kbImageDescriber.test.ts server/services/kbDocParser.ts server/routers/kbIngestRouter.ts
git commit -m "feat(ai/w2-B3): nạp ảnh qua VLM (mô tả kiến thức, không phải prompt lỗi AOI) + chặn nhầm định dạng bằng magic-byte"
```

> **CHỐT ĐƯỜNG B — controller đo live trước khi sang đường C.** Nạp một tài liệu + một ảnh, rồi hỏi trợ lý và xác nhận có trích dẫn nhãn "Tài liệu bạn nạp".

---

# ĐƯỜNG C — Inline đủ 4 màn + sổ tay đúng chỗ

## Task 7: Bật ghost-text 4 màn, đưa sổ tay về nơi viết code, ghim model

**Files:**
- Modify: `client/src/pages/IrEditor.tsx`, `client/src/pages/PouStudio.tsx`, `client/src/components/programming/ProgrammingCopilotPanel.tsx` (bật `inlineCopilot`)
- Modify: `client/src/pages/EngineeringWorkspace.tsx` (gắn `ManualHelp`)
- Modify: `server/services/programming/aiProgrammingCopilot.ts` (`completeInline` ở `:763-790`)
- Test: `server/services/aiProgrammingCopilot.pinning.test.ts` (**mới**)

**Interfaces:**
- Consumes: prop `inlineCopilot` của `CodeEditor` (`client/src/components/engineering/CodeEditor.tsx:53,218,241`); `ManualHelp` (`client/src/components/ManualHelp.tsx`).
- Produces: không có API mới.

- [ ] **Step 1: Viết test đỏ cho việc ghim model**

Tạo `server/services/aiProgrammingCopilot.pinning.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateFimMock = vi.fn();
vi.mock("../aiGgufEngine", () => ({
  generateFim: (...a: any[]) => generateFimMock(...a),
  isGgufAvailable: vi.fn(async () => true),
}));

import { completeInline } from "./aiProgrammingCopilot";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  generateFimMock.mockResolvedValue({ completion: "x" });
});

describe("completeInline — ghim model tường minh", () => {
  it("truyền modelId tường minh cho generateFim (không để engine tự chọn)", async () => {
    await completeInline({ prefix: "MOVE ", suffix: "", language: "zmotion-basic" } as any);
    expect(generateFimMock).toHaveBeenCalled();
    const secondArg = generateFimMock.mock.calls[0][1];
    expect(secondArg).toBeTruthy();
    expect(typeof secondArg).toBe("string");
  });

  it("cờ TẮT ⇒ trả completion rỗng, KHÔNG gọi model (fail-safe cũ giữ nguyên)", async () => {
    process.env.AI_PROGRAMMING_COPILOT_ENABLED = "false";
    const r = await completeInline({ prefix: "a", suffix: "", language: "gcode" } as any);
    expect(r.completion).toBe("");
    expect(generateFimMock).not.toHaveBeenCalled();
  });

  it("generateFim ném ⇒ completion rỗng, KHÔNG ném ra ngoài (gõ phím không được vỡ)", async () => {
    generateFimMock.mockRejectedValue(new Error("boom"));
    const r = await completeInline({ prefix: "a", suffix: "", language: "gcode" } as any);
    expect(r.completion).toBe("");
  });
});
```

- [ ] **Step 2: Chạy test để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiProgrammingCopilot.pinning.test.ts`
Kỳ vọng: FAIL ở test đầu — `generateFim` hiện được gọi **không có** tham số thứ hai.

- [ ] **Step 3: Ghim model + dùng đúng tầng FIM**

Trong `server/services/programming/aiProgrammingCopilot.ts`, tại `completeInline` (`:763-790`):
- Phân giải model **tường minh** trước khi gọi: ưu tiên tầng `task:"fim"` của `aiModelRouter.route(...)` (`server/services/aiModelRouter.ts:369-374`) mà đường này hiện **bỏ qua hoàn toàn** — nghĩa là cờ `AI_CODE_ROUTER_ENABLED` không có tác dụng gì với ghost-text. Nếu router không trả model (cờ tắt), lùi về `fimModelBasename()` (`server/services/ai/modelResolver.ts:148-152`, chuỗi `GGUF_FIM_MODEL → GGUF_FAST_MODEL → GGUF_DEFAULT_MODEL`).
- Truyền model đó làm **tham số thứ hai** của `generateFim(...)`.
- **Giữ nguyên mọi fail-safe hiện có**: cờ tắt ⇒ `{completion:""}`; lỗi ⇒ `{completion:""}`; không bao giờ ném (gõ phím không được vỡ vì AI).

- [ ] **Step 4: Chạy test để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiProgrammingCopilot.pinning.test.ts`
Kỳ vọng: PASS 3/3.

- [ ] **Step 5: Bật ghost-text ở 3 màn còn lại**

`inlineCopilot` hiện chỉ bật ở `EngineeringWorkspace.tsx:1010`. Thêm prop `inlineCopilot` cho các `CodeEditor` ở:
- `client/src/pages/IrEditor.tsx`
- `client/src/pages/PouStudio.tsx`
- `client/src/components/programming/ProgrammingCopilotPanel.tsx` — **chỉ** editor nhập ngữ cảnh; editor hiển thị kết quả là chỉ-đọc, **không** bật.

Prop đã tồn tại (`CodeEditor.tsx:53,218,241`) nên đây là thay đổi nhỏ. Kiểm bằng mắt trong mã: không bật cho bất kỳ editor chỉ-đọc nào.

- [ ] **Step 6: Đưa ô tra sổ-tay về nơi viết code**

`ManualHelp` (tra 91.678 chunk sổ tay hãng qua `trpc.aiProgrammingKb.search`) hiện gắn ở `AndonBoard.tsx:782` và `DeviceAdapterManagement.tsx:362` — **không màn soạn code nào có**. Gắn thêm vào `EngineeringWorkspace.tsx` (khu vực bên cạnh editor/panel copilot), truyền ngôn ngữ/kind đang chọn làm bộ lọc nếu component hỗ trợ; nếu không hỗ trợ, truyền qua truy vấn mặc định và **ghi rõ giới hạn trong báo cáo**. **Không gỡ** hai chỗ dùng cũ.

- [ ] **Step 7: Typecheck + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add server/services/programming/aiProgrammingCopilot.ts server/services/aiProgrammingCopilot.pinning.test.ts client/src/pages/IrEditor.tsx client/src/pages/PouStudio.tsx client/src/components/programming/ProgrammingCopilotPanel.tsx client/src/pages/EngineeringWorkspace.tsx
git commit -m "feat(ai/w2-C): ghost-text đủ 4 màn soạn code + sổ tay tại chỗ viết code + ghim model cho completeInline"
```

---

## Nghiệm thu Wave 2 (controller làm, sau mỗi đường — KHÔNG dồn tới cuối)

Bài học Wave 1: *test xanh + review sạch KHÔNG chứng minh sản phẩm chạy*. Mỗi đường phải đo live ngay khi xong.

**Sau đường A:** rebuild + restart, đăng nhập, mở `/products` của sản phẩm có điểm đo → thấy **badge đề xuất** (DB hiện có 150 dòng `requested` thật). Mở form một điểm có badge → thấy khối đề xuất với giá trị hiện tại→đề xuất. Duyệt một cái → kiểm `threshold_approvals.status` đổi trong DB. Thử duyệt đề xuất do chính mình tạo → nút **khoá** kèm lý do.

**Sau đường B:** nạp **nhiều file cùng lúc** + **một ảnh** ở `/ai-training-studio` → mỗi file một job trong tab Jobs; ảnh cho ra chunk từ mô tả VLM, hoặc `failed` **có lý do** nếu VLM bận. Kiểm `kb_studio_chunks` có dòng. Hỏi trợ lý về nội dung vừa nạp → **trả lời có trích dẫn nhãn "Tài liệu bạn nạp"**.

**Sau đường C:** mở `/ir-editor` và `/pou-studio`, gõ code → **ghost-text hiện**. Kiểm `modelId` thật trong log/DB là model code/chat, **không phải embedder**.

**Kiểm chung cuối wave:** `npx tsc --noEmit` sạch; toàn bộ test Wave 2 xanh; không migration nào cần chạy (Wave 2 **không** thêm bảng).
