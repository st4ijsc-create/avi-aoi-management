# Sprint 5 — A4: Mã lỗi máy-đọc-được + i18n toàn ứng dụng Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng Việt Nam thôi đọc câu lỗi tiếng Anh thô. Mọi `TRPCError` hướng-người-dùng mang một `code` ổn định + tham số, client dịch sang vi/en/zh, và một cổng đếm khiến router mới không thể thêm nợ.

**Architecture:** Cộng-thêm và tương thích ngược. `appError()` dựng `TRPCError` mang `{ appCode, params }` trên `cause`; `errorFormatter` nâng lên `shape.data` — đúng khuôn `mpConflict` đã có sẵn. Client `mapTrpcError` đọc `data.appCode` **trước**, thiếu khoá i18n thì rơi về message máy chủ y như hôm nay. Router chưa di trú vẫn chạy nguyên vẹn. Một hằng `ALLOWED_LEGACY_THROWS` giảm dần biến "phủ toàn bộ" thành đích kiểm chứng được.

**Tech Stack:** TypeScript · tRPC v11 · vitest · react-i18next

## Global Constraints

- **Spec nguồn:** `docs/superpowers/specs/2026-07-29-ai-sprint5-design.md` §4 (commit `bf2e0841`). Plan lệch spec ⇒ spec thắng, và **báo lại**.
- **Chạy SAU plan nhóm A + B1** (`docs/superpowers/plans/2026-07-29-ai-sprint5-group-a-b1.md`). Hai plan không đụng file nhau, nhưng thứ tự này đã chốt: nếu phải cắt thì cắt đuôi dài của A4, không cắt thứ người dùng đang đau.
- **Cộng-thêm, không phá vỡ.** Sau mỗi task, router chưa di trú phải hoạt động **y hệt** trước đó. Nếu một thay đổi buộc phải sửa router chưa nằm trong đợt — dừng, brief sai, báo lại.
- **Fallback là bắt buộc, không phải tuỳ chọn.** Thiếu khoá i18n ⇒ hiện message máy chủ. Không bao giờ hiện chuỗi mã trần (`ENTITY_NOT_FOUND`) cho người dùng.
- **Không đổi mã tRPC** (`NOT_FOUND`/`CONFLICT`/…) của bất kỳ chỗ nào đang có. Client và test khác đang dựa vào chúng.
- Chạy test: `npx vitest run <đường dẫn>`. Kiểm kiểu: `npm run check` (heap 8GB). i18n: `npm run i18n:check`.
- **Không chạy hai implementer song song**, kể cả khác file.
- Commit sau mỗi task. Prefix: `feat(ai/s5-A4-…)`, `refactor(ai/s5-A4-…)`.

## Số đo tại `6ad3e57d` (dùng để chia đợt, KHÔNG dùng làm tiêu chí nghiệm thu)

`server/routers/**/*.ts` trừ `.test.ts`: **1056** chỗ `new TRPCError` trong **117** file.

| Họ | Chỗ | File |
|---|---:|---:|
| `DB_UNAVAILABLE` | **210** | **57** |
| `ENTITY_NOT_FOUND` | ~328 | — |
| `INVALID_VALUE` | ~83 | — |
| `FEATURE_DISABLED` | ~62 | — |
| `OPERATION_FAILED` | ~23 | — |
| `FIELD_REQUIRED` | ~22 | — |
| `ENTITY_DUPLICATE` | ~14 | — |
| `SCOPE_MISMATCH` | ~12 | — |
| `PERMISSION_DENIED` | ~11 | — |
| đuôi dài bespoke | ~250–290 | — |

Tiêu chí nghiệm thu thật là hằng `ALLOWED_LEGACY_THROWS` ở Task 4, không phải bảng này.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `server/_core/appErrorCodes.ts` | **Tạo** — registry mã + kiểu tham số. Không import gì (client dùng lại được) | 1 |
| `server/_core/appError.ts` | **Tạo** — `appError()` dựng TRPCError mang `{appCode, params}` | 1 |
| `server/_core/appError.test.ts` | **Tạo** | 1 |
| `server/_core/trpc.ts` | **Sửa** `errorFormatter` — nâng `appCode`/`appParams` lên `shape.data` | 1 |
| `client/src/lib/errorCodes.ts` | **Tạo** — `appCode` → khoá i18n, nội suy tham số | 2 |
| `client/src/lib/trpcErrors.ts` | **Sửa** — đọc `data.appCode` trước | 2 |
| `client/src/lib/trpcErrors.unit.test.ts` | **Sửa** — thêm ca `appCode` + ca fallback | 2 |
| `client/src/i18n/locales/{vi,en,zh}.json` | **Sửa** — khối `errors.*` + `errors.entity.*` | 2, 3, 6 |
| `server/routers/kbIngestRouter.ts`, `kbStudioRouter.ts` | **Sửa** — 6 mã KB | 3 |
| `server/routers/appErrorCoverage.test.ts` | **Tạo** — cổng đếm `ALLOWED_LEGACY_THROWS` | 4 |
| 57 file router | **Sửa** — đợt `DB_UNAVAILABLE` | 5 |
| router có `not found` | **Sửa** — đợt `ENTITY_NOT_FOUND` + từ điển thực thể | 6 |
| router còn lại | **Sửa** — 7 họ còn lại | 7 |
| router còn lại | **Sửa** — đuôi dài, hạ cổng về 0 | 8 |

---

## Task 1: Hạ tầng máy chủ — `appError` + `errorFormatter`

**Files:**
- Create: `server/_core/appErrorCodes.ts`, `server/_core/appError.ts`
- Test: `server/_core/appError.test.ts`
- Modify: `server/_core/trpc.ts:11-26`

**Interfaces:**
- Produces:
  - `type AppErrorCode` — union chuỗi, khai trong `appErrorCodes.ts`
  - `type AppErrorParams = Record<string, string | number>`
  - `appError(trpcCode: TRPC_ERROR_CODE_KEY, appCode: AppErrorCode, params?: AppErrorParams, fallbackMessage?: string): TRPCError`
  - `shape.data.appCode: string | undefined` và `shape.data.appParams: AppErrorParams | undefined` trên mọi phản hồi lỗi tRPC

- [ ] **Step 1: Viết test đỏ** — tạo `server/_core/appError.test.ts`

```ts
/**
 * Sprint 5 §4.2 — lỗi máy chủ phải mang một MÃ ổn định để client dịch được.
 * Trước đây message là chuỗi tiếng Anh viết tay (81% số chỗ), dùng chung nhiều
 * caller nên không dịch nổi ở máy chủ.
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { appError, readAppErrorMeta } from "./appError";

describe("appError", () => {
  it("trả về TRPCError thật, giữ nguyên mã tRPC đã truyền", () => {
    const err = appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "product" }, "Product not found");
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("message = fallback truyền vào (log và API ngoài vẫn đọc được)", () => {
    const err = appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "product" }, "Product not found");
    expect(err.message).toBe("Product not found");
  });

  it("thiếu fallback ⇒ message là chính mã, KHÔNG rỗng", () => {
    const err = appError("BAD_REQUEST", "DB_UNAVAILABLE");
    expect(err.message).toBe("DB_UNAVAILABLE");
  });

  it("mang appCode + params đọc lại được", () => {
    const err = appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" });
    expect(readAppErrorMeta(err)).toEqual({ appCode: "ENTITY_NOT_FOUND", appParams: { entity: "machine" } });
  });

  it("không params ⇒ appParams undefined, không phải {} rỗng", () => {
    const err = appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE");
    expect(readAppErrorMeta(err)).toEqual({ appCode: "DB_UNAVAILABLE", appParams: undefined });
  });

  it("TRPCError thường (chưa di trú) ⇒ readAppErrorMeta trả null, không ném", () => {
    expect(readAppErrorMeta(new TRPCError({ code: "NOT_FOUND", message: "x" }))).toBeNull();
    expect(readAppErrorMeta(new Error("x"))).toBeNull();
    expect(readAppErrorMeta(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

Run: `npx vitest run server/_core/appError.test.ts`
Expected: FAIL — `Failed to resolve import "./appError"`

- [ ] **Step 3: Tạo registry** — `server/_core/appErrorCodes.ts`

```ts
/**
 * Sprint 5 §4 — registry MÃ LỖI máy-đọc-được.
 *
 * File này KHÔNG import gì để client dùng lại được kiểu mà không kéo theo tRPC
 * server. Thêm mã mới ⇒ thêm vào đây TRƯỚC, tsc sẽ bắt mọi chỗ gõ sai.
 *
 * Quy ước đặt tên: DANH_TỪ_TÌNH_HUỐNG, không nêu tên router (mã phải dùng lại
 * được ở nhiều router — đó chính là lý do có nó).
 */
export const APP_ERROR_CODES = [
  // ── 9 họ phổ quát (§4.1) ──────────────────────────────────────────────────
  "DB_UNAVAILABLE",
  "ENTITY_NOT_FOUND",     // params: { entity }
  "ENTITY_DUPLICATE",     // params: { entity, field? }
  "SCOPE_MISMATCH",       // params: { entity, parent }
  "FIELD_REQUIRED",       // params: { field }
  "INVALID_VALUE",        // params: { field, reason? }
  "FEATURE_DISABLED",     // params: { feature }
  "OPERATION_FAILED",     // params: { operation }
  "PERMISSION_DENIED",    // params: { action? }

  // ── Nạp tri thức (KB) — Task 3 ────────────────────────────────────────────
  "KB_FILE_TOO_LARGE",        // params: { limitMb }
  "KB_UNSUPPORTED_TYPE",      // params: { ext, supported }
  "KB_CONTENT_TYPE_MISMATCH", // params: { claimed, detected }
  "KB_PARSE_FAILED",          // params: { reason }
  "KB_NO_TEXT_EXTRACTED",     // params: { source }
  "KB_FETCH_FAILED",          // params: { url, reason }
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** Tham số nội suy vào câu i18n. Chỉ nhận nguyên thuỷ — không nhét object/lỗi
 *  vào đây, nó đi thẳng ra client và có thể lộ nội bộ. */
export type AppErrorParams = Record<string, string | number>;
```

- [ ] **Step 4: Tạo `appError`** — `server/_core/appError.ts`

```ts
/**
 * Sprint 5 §4.2 — dựng TRPCError mang mã máy-đọc-được.
 *
 * Cơ chế bám đúng khuôn `mpConflict` đã có ở trpc.ts:16-24 (doc 31 UX3): gắn
 * dữ liệu lên `cause`, để `errorFormatter` nâng lên `shape.data`. Không phát
 * minh đường truyền mới.
 *
 * `fallbackMessage` KHÔNG bị bỏ đi: log máy chủ, API `/v1` cho bên thứ ba, và
 * client chưa có khoá i18n đều đọc nó. Nó là lưới an toàn, không phải rác.
 */
import { TRPCError } from "@trpc/server";
import type { AppErrorCode, AppErrorParams } from "./appErrorCodes";

export type { AppErrorCode, AppErrorParams };

type TrpcCode = ConstructorParameters<typeof TRPCError>[0]["code"];

interface AppErrorCause {
  appCode: AppErrorCode;
  appParams?: AppErrorParams;
}

export function appError(
  trpcCode: TrpcCode,
  appCode: AppErrorCode,
  params?: AppErrorParams,
  fallbackMessage?: string,
): TRPCError {
  const cause: AppErrorCause = { appCode, ...(params ? { appParams: params } : {}) };
  return new TRPCError({
    code: trpcCode,
    // Không bao giờ để message rỗng: log rỗng là log vô dụng.
    message: fallbackMessage ?? appCode,
    cause,
  });
}

/** Đọc lại metadata từ một lỗi bất kỳ. Trả null cho lỗi chưa di trú — dùng
 *  trong errorFormatter và trong test, không ném với đầu vào lạ. */
export function readAppErrorMeta(err: unknown): { appCode: string; appParams?: AppErrorParams } | null {
  if (!err || typeof err !== "object") return null;
  const cause = (err as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return null;
  const appCode = (cause as { appCode?: unknown }).appCode;
  if (typeof appCode !== "string") return null;
  const appParams = (cause as { appParams?: unknown }).appParams;
  return {
    appCode,
    appParams: appParams && typeof appParams === "object" ? (appParams as AppErrorParams) : undefined,
  };
}
```

- [ ] **Step 5: Nâng lên `shape.data`** — sửa `server/_core/trpc.ts:11-26`

```ts
  errorFormatter({ shape, error }) {
    // Doc 31 UX3 — additive forward of an optimistic-lock CONFLICT payload.
    const mpConflict = (error.cause as { mpConflict?: unknown } | undefined)?.mpConflict;
    // Sprint 5 §4.2 — mã lỗi máy-đọc-được. Chỉ có mặt khi lỗi được dựng bằng
    // appError(); mọi lỗi khác giữ nguyên hình dạng phản hồi như trước.
    const appMeta = readAppErrorMeta(error);
    return {
      ...shape,
      data: {
        ...shape.data,
        stack: process.env.NODE_ENV === 'production' ? undefined : shape.data.stack,
        ...(mpConflict ? { conflict: mpConflict } : {}),
        ...(appMeta ? { appCode: appMeta.appCode, ...(appMeta.appParams ? { appParams: appMeta.appParams } : {}) } : {}),
      },
    };
  },
```

Thêm import ở đầu `trpc.ts`:
```ts
import { readAppErrorMeta } from "./appError";
```

⚠ Kiểm import vòng: `appError.ts` chỉ import từ `@trpc/server` và `./appErrorCodes` — không import `./trpc`. Không có vòng.

- [ ] **Step 6: Test hợp đồng đầu-cuối phía máy chủ** — thêm vào cuối `server/_core/appError.test.ts`

Bài học §6(2): trường mới chết im lặng vì chặng nối tay bỏ sót. Phải khẳng định nó **qua được** `errorFormatter`, không chỉ tồn tại trên `cause`.

```ts
import { initTRPC } from "@trpc/server";
import { readAppErrorMeta as _unusedGuard } from "./appError";

describe("errorFormatter — hợp đồng tới client", () => {
  // Dựng lại ĐÚNG errorFormatter đang dùng ở trpc.ts để test không phụ thuộc
  // vào việc khởi tạo cả context thật.
  const t = initTRPC.create({
    errorFormatter({ shape, error }) {
      const appMeta = readAppErrorMeta(error);
      return {
        ...shape,
        data: {
          ...shape.data,
          ...(appMeta ? { appCode: appMeta.appCode, ...(appMeta.appParams ? { appParams: appMeta.appParams } : {}) } : {}),
        },
      };
    },
  });

  const router = t.router({
    boom: t.procedure.query(() => {
      throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, "Machine not found");
    }),
    plain: t.procedure.query(() => {
      throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
    }),
  });

  it("appCode + appParams tới được shape.data", async () => {
    const caller = t.createCallerFactory(router)({});
    await expect(caller.boom()).rejects.toMatchObject({ code: "NOT_FOUND" });
    try {
      await caller.boom();
    } catch (e: any) {
      const shape = t._config.errorFormatter({ shape: { data: {} }, error: e } as any);
      expect(shape.data.appCode).toBe("ENTITY_NOT_FOUND");
      expect(shape.data.appParams).toEqual({ entity: "machine" });
    }
  });

  it("lỗi CHƯA di trú ⇒ không có appCode, hình dạng phản hồi không đổi", () => {
    const err = new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
    const shape = t._config.errorFormatter({ shape: { data: {} }, error: err } as any);
    expect(shape.data.appCode).toBeUndefined();
  });
});
```

- [ ] **Step 7: Chạy test + kiểm kiểu**

Run: `npx vitest run server/_core/appError.test.ts` rồi `npm run check`
Expected: PASS, không lỗi kiểu.

- [ ] **Step 8: Chạy một test router bất kỳ để chắc không vỡ gì**

Run: `npx vitest run server/routers/alarmKpiMissingTable.test.ts`
Expected: PASS — hình dạng lỗi của router chưa di trú không đổi.

- [ ] **Step 9: Commit**

```bash
git add server/_core/appErrorCodes.ts server/_core/appError.ts server/_core/appError.test.ts server/_core/trpc.ts
git commit -m "feat(ai/s5-A4): hạ tầng mã lỗi máy-đọc-được (appError + errorFormatter)

Bám khuôn mpConflict sẵn có: gắn {appCode, params} lên cause, errorFormatter
nâng lên shape.data. Cộng-thêm hoàn toàn — router chưa di trú giữ nguyên hình
dạng phản hồi. fallbackMessage vẫn là message thật cho log và API /v1."
```

---

## Task 2: Hạ tầng client — `mapTrpcError` đọc `appCode`

**Files:**
- Create: `client/src/lib/errorCodes.ts`
- Modify: `client/src/lib/trpcErrors.ts:127-149`
- Modify: `client/src/lib/trpcErrors.unit.test.ts`
- Modify: `client/src/i18n/locales/{vi,en,zh}.json` — khối `errors.*`

**Interfaces:**
- Consumes: `shape.data.appCode`, `shape.data.appParams` (Task 1)
- Produces: `translateAppError(appCode: string, params: Record<string, string|number> | undefined, fallback: string): string` — dùng trong `mapTrpcError`

- [ ] **Step 1: Viết test đỏ** — thêm vào `client/src/lib/trpcErrors.unit.test.ts`

```ts
describe("mapTrpcError — mã lỗi máy-đọc-được (Sprint 5 §4.3)", () => {
  function withAppCode(code: string, appCode: string, appParams?: any, message = "raw english") {
    const err: any = new Error(message);
    err.data = { code, appCode, appParams };
    return err;
  }

  it("có appCode + khoá i18n ⇒ dịch, KHÔNG hiện chuỗi tiếng Anh", () => {
    const out = mapTrpcError(withAppCode("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "product" }, "Product not found"));
    expect(out).not.toContain("Product not found");
    expect(out).toContain("sản phẩm");
  });

  it("appCode LẠ (client cũ, server mới) ⇒ rơi về message máy chủ, KHÔNG hiện mã trần", () => {
    const out = mapTrpcError(withAppCode("NOT_FOUND", "MÃ_CHƯA_TỪNG_CÓ", undefined, "Widget not found"));
    expect(out).toBe("Widget not found");
    expect(out).not.toContain("MÃ_CHƯA_TỪNG_CÓ");
  });

  it("KHÔNG có appCode (router chưa di trú) ⇒ hành vi y hệt trước đây", () => {
    const err: any = new Error("Product not found");
    err.data = { code: "NOT_FOUND" };
    expect(mapTrpcError(err)).toBe("Product not found");
  });

  it("appCode nhưng message có dấu hiệu leak SQL ⇒ vẫn dịch theo mã, không lộ SQL", () => {
    const out = mapTrpcError(withAppCode("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Failed query: SELECT * FROM users"));
    expect(out).not.toContain("SELECT");
  });

  it("thực thể chưa có trong từ điển ⇒ dùng nguyên văn khoá, không sập", () => {
    const out = mapTrpcError(withAppCode("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "flux_capacitor" }, "Flux capacitor not found"));
    expect(out).toContain("flux_capacitor");
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

Run: `npx vitest run client/src/lib/trpcErrors.unit.test.ts`
Expected: FAIL — 4/5 ca mới đỏ (ca "chưa di trú" đã xanh sẵn, đó là bằng chứng tương thích ngược).

- [ ] **Step 3: Thêm khối `errors.*` vào `vi.json`** (mức gốc, cạnh các khối lớn khác)

```json
  "errors": {
    "DB_UNAVAILABLE": "Không kết nối được cơ sở dữ liệu. Vui lòng thử lại sau ít phút.",
    "ENTITY_NOT_FOUND": "Không tìm thấy {{entity}}.",
    "ENTITY_DUPLICATE": "{{entity}} này đã tồn tại.",
    "SCOPE_MISMATCH": "{{entity}} không thuộc {{parent}} đang chọn.",
    "FIELD_REQUIRED": "Thiếu thông tin bắt buộc: {{field}}.",
    "INVALID_VALUE": "Giá trị không hợp lệ ở {{field}}.",
    "FEATURE_DISABLED": "Tính năng {{feature}} chưa được bật trên hệ thống này.",
    "OPERATION_FAILED": "Không thực hiện được: {{operation}}.",
    "PERMISSION_DENIED": "Bạn không có quyền thực hiện thao tác này.",
    "entity": {
      "product": "sản phẩm",
      "machine": "máy",
      "line": "chuyền",
      "factory": "nhà máy",
      "user": "người dùng",
      "workOrder": "lệnh sản xuất",
      "alert": "cảnh báo",
      "recipe": "công thức",
      "measurementPoint": "điểm đo",
      "productModel": "mã sản phẩm"
    }
  },
```

`en.json` và `zh.json`: dịch tương ứng, **giữ nguyên tên khoá và tên tham số**. Thêm thực thể mới ở Task 6 khi quét thấy.

- [ ] **Step 4: Tạo `client/src/lib/errorCodes.ts`**

```ts
/**
 * Sprint 5 §4.3 — dịch mã lỗi máy chủ sang câu người đọc.
 *
 * Quy tắc BẤT BIẾN: thiếu khoá i18n ⇒ trả `fallback` (message máy chủ), TUYỆT
 * ĐỐI không hiện mã trần cho người dùng. Nhờ vậy client cũ + server mới, hoặc
 * mã vừa thêm mà chưa kịp dịch, đều không bao giờ tệ hơn hôm nay.
 */
import i18n from "i18next";

/** Thực thể trong `params.entity` được dịch qua `errors.entity.*` trước khi nội
 *  suy, để "Không tìm thấy sản phẩm" chứ không phải "Không tìm thấy product". */
function localizeParams(params: Record<string, string | number> | undefined) {
  if (!params) return undefined;
  const out: Record<string, string | number> = { ...params };
  for (const key of ["entity", "parent"]) {
    const raw = out[key];
    if (typeof raw === "string") {
      // defaultValue = chính nó ⇒ thực thể chưa có trong từ điển hiện nguyên văn.
      out[key] = i18n.t(`errors.entity.${raw}`, { defaultValue: raw });
    }
  }
  return out;
}

export function translateAppError(
  appCode: string,
  params: Record<string, string | number> | undefined,
  fallback: string,
): string {
  const key = `errors.${appCode}`;
  // Sentinel: i18next trả về chính defaultValue khi khoá không tồn tại.
  const SENTINEL = " __missing__";
  const translated = i18n.t(key, { ...localizeParams(params), defaultValue: SENTINEL });
  if (typeof translated !== "string" || translated === SENTINEL) return fallback;
  return translated;
}
```

- [ ] **Step 5: Nối vào `mapTrpcError`** — `client/src/lib/trpcErrors.ts`

Thêm import:
```ts
import { translateAppError } from "./errorCodes";
```

Thêm helper cạnh `getErrorCode` (dòng 68-78):
```ts
/** Sprint 5 §4.3 — mã ứng dụng do appError() gắn, nếu router đã di trú. */
function getAppError(error: unknown): { appCode: string; appParams?: Record<string, string | number> } | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: { appCode?: unknown; appParams?: unknown } }).data;
  if (!data || typeof data.appCode !== "string") return null;
  return {
    appCode: data.appCode,
    appParams:
      data.appParams && typeof data.appParams === "object"
        ? (data.appParams as Record<string, string | number>)
        : undefined,
  };
}
```

Sửa `mapTrpcError` (dòng 127-142) — chèn **trước** `switch (code)`:
```ts
export function mapTrpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = getErrorCode(error);

  // Sprint 5 §4.3 — mã máy-đọc-được thắng mọi luật đoán-theo-chuỗi bên dưới.
  // Fallback KHÔNG dùng `message` thô: nếu message có dấu hiệu leak nội bộ thì
  // câu generic vẫn phải thắng, y như luật đã có từ doc 42.
  const appErr = getAppError(error);
  if (appErr) {
    const safeFallback = !message || looksLikeInternalLeak(message) ? GENERIC_ERROR : message;
    return translateAppError(appErr.appCode, appErr.appParams, safeFallback);
  }

  switch (code) {
```

Phần còn lại của hàm giữ **nguyên vẹn**.

- [ ] **Step 6: Chạy test + kiểm kiểu + i18n**

Run: `npx vitest run client/src/lib/trpcErrors.unit.test.ts` · `npm run check` · `npm run i18n:check`
Expected: PASS toàn bộ, kể cả các ca cũ (FORBIDDEN/zod/CONFLICT) — chúng không đi qua nhánh mới.

⚠ Nếu test dùng i18n cần khởi tạo: import file khởi tạo i18n của dự án trong test setup. **Không** stub `i18n.t` trả nguyên khoá — như vậy test sẽ xanh giả trong khi người dùng thật thấy `errors.ENTITY_NOT_FOUND`.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/errorCodes.ts client/src/lib/trpcErrors.ts client/src/lib/trpcErrors.unit.test.ts client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/s5-A4): client dịch mã lỗi máy chủ, thiếu khoá thì rơi về message cũ

9 mã họ + từ điển thực thể ở vi/en/zh. Router chưa di trú đi đúng đường cũ.
Mã lạ KHÔNG bao giờ hiện trần cho người dùng."
```

---

## Task 3: Luồng nạp tri thức (KB) — 6 mã, đóng đúng phàn nàn gốc của A4

**Files:**
- Modify: `server/routers/kbStudioRouter.ts:89`
- Modify: `server/routers/kbIngestRouter.ts:86-87`, và các chỗ bắt `KbUnsupportedTypeError` / `KbParseError` / `SsrfBlockedError` / `FetchError` / `KbIngestValidationError`
- Modify: `client/src/i18n/locales/{vi,en,zh}.json`
- Test: `server/routers/kbErrorCodes.test.ts` (tạo mới)

**Interfaces:**
- Consumes: `appError` (Task 1), `translateAppError` (Task 2)
- Produces: 6 mã KB đã khai sẵn trong registry Task 1 Step 3

- [ ] **Step 1: Đọc trước khi sửa**

Đọc `server/routers/kbIngestRouter.ts` và `server/routers/kbStudioRouter.ts` **toàn bộ**, liệt kê mọi chỗ `new TRPCError` phát sinh từ:
`decodeBase64Payload` · `KbUnsupportedTypeError` · `KbParseError` · `KbIngestValidationError` · `SsrfBlockedError` · `FetchError` · `WebIngestDisabledError`.

Ghi danh sách ra trước khi đổi dòng nào. Nếu số chỗ khác xa 6 mã — **báo lại**, đừng nhồi nhét mã cho vừa.

- [ ] **Step 2: Viết test đỏ** — tạo `server/routers/kbErrorCodes.test.ts`

```ts
/**
 * Sprint 5 §4 — câu từ chối nạp tài liệu phải mang MÃ để client dịch.
 * Trước đây: `Document exceeds 20971520 bytes` (byte thô, không phải "20 MB"),
 * `Unsupported document type: "pptx"`, `Failed to fetch` — toàn tiếng Anh,
 * trong khi kbImageDescriber cùng luồng lại tiếng Việt.
 */
import { describe, it, expect } from "vitest";
import { readAppErrorMeta } from "../_core/appError";

describe("mã lỗi luồng nạp tri thức", () => {
  it("quá dung lượng ⇒ KB_FILE_TOO_LARGE kèm giới hạn tính bằng MB, không phải byte thô", () => {
    const err = buildTooLargeError(20 * 1024 * 1024);
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_FILE_TOO_LARGE");
    expect(meta?.appParams).toEqual({ limitMb: 20 });
  });

  it("loại tệp không hỗ trợ ⇒ KB_UNSUPPORTED_TYPE kèm đuôi và danh sách hỗ trợ", () => {
    const err = buildUnsupportedTypeError("pptx", "pdf, docx, md, txt");
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_UNSUPPORTED_TYPE");
    expect(meta?.appParams).toMatchObject({ ext: "pptx" });
  });
});
```

⚠ `buildTooLargeError` / `buildUnsupportedTypeError` **chưa tồn tại**. Bước 3 sẽ export chúng từ một file dựng lỗi dùng chung để test được không cần dựng cả tRPC caller. Nếu bạn thấy dễ hơn khi test qua caller thật — làm vậy cũng được, miễn là assert đúng `appCode` + `appParams`.

- [ ] **Step 3: Tạo `server/routers/kbErrors.ts`** — nơi dựng 6 lỗi KB

```ts
/**
 * Sprint 5 §4 — dựng lỗi cho luồng nạp tri thức ở MỘT chỗ, vì cùng một tình
 * huống hiện đang được ném từ hai router (kbIngestRouter, kbStudioRouter) với
 * hai câu chữ khác nhau — chính là thứ khiến một màn hình có cả tiếng Anh lẫn
 * tiếng Việt.
 */
import { appError } from "../_core/appError";

export function buildTooLargeError(maxBytes: number) {
  const limitMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return appError("PAYLOAD_TOO_LARGE", "KB_FILE_TOO_LARGE", { limitMb },
    `Document exceeds ${maxBytes} bytes`);
}

export function buildUnsupportedTypeError(ext: string, supported: string) {
  return appError("BAD_REQUEST", "KB_UNSUPPORTED_TYPE", { ext, supported },
    `Unsupported document type: "${ext}". Supported: ${supported}.`);
}

export function buildContentTypeMismatchError(claimed: string, detected: string) {
  return appError("BAD_REQUEST", "KB_CONTENT_TYPE_MISMATCH", { claimed, detected },
    `File claims ${claimed} but its content is ${detected}`);
}

export function buildParseFailedError(reason: string) {
  return appError("BAD_REQUEST", "KB_PARSE_FAILED", { reason }, `Failed to parse document: ${reason}`);
}

export function buildNoTextError(source: string) {
  return appError("BAD_REQUEST", "KB_NO_TEXT_EXTRACTED", { source },
    `Document "${source}" produced no extractable text`);
}

export function buildFetchFailedError(url: string, reason: string) {
  return appError("BAD_REQUEST", "KB_FETCH_FAILED", { url, reason }, `Failed to fetch ${url}: ${reason}`);
}
```

- [ ] **Step 4: Nối vào hai router** — thay từng chỗ đã liệt kê ở Step 1

Ví dụ `kbStudioRouter.ts:89`:
```ts
    throw buildTooLargeError(MAX_UPLOAD_BYTES);
```

Với các chỗ bắt lớp lỗi domain, giữ nguyên `instanceof` đang có, chỉ đổi lỗi ném ra. **Không** đổi mã tRPC của bất kỳ chỗ nào.

- [ ] **Step 5: Thêm 6 khoá i18n** — `vi.json`, trong khối `errors` đã tạo ở Task 2

```json
    "KB_FILE_TOO_LARGE": "Tệp vượt quá giới hạn {{limitMb}} MB.",
    "KB_UNSUPPORTED_TYPE": "Không hỗ trợ định dạng \"{{ext}}\". Định dạng nhận được: {{supported}}.",
    "KB_CONTENT_TYPE_MISMATCH": "Nội dung tệp không khớp phần mở rộng: khai là {{claimed}} nhưng thực tế là {{detected}}.",
    "KB_PARSE_FAILED": "Không đọc được nội dung tệp: {{reason}}",
    "KB_NO_TEXT_EXTRACTED": "Tệp \"{{source}}\" không có chữ nào để nạp.",
    "KB_FETCH_FAILED": "Không tải được nội dung từ {{url}}: {{reason}}",
```

`en.json`, `zh.json`: dịch tương ứng, giữ nguyên tên tham số.

- [ ] **Step 6: Chạy test hiện có của KB — chúng có thể assert message cũ**

Run: `npx vitest run server/routers/kbErrorCodes.test.ts server/services/kbDocParser.test.ts server/services/kbIngestService.test.ts`
Expected: PASS.

⚠ Nếu một test cũ đỏ vì assert nguyên văn chuỗi tiếng Anh: `fallbackMessage` được thiết kế để **giữ nguyên chuỗi đó**. Nếu vẫn đỏ nghĩa là bạn đổi chữ — sửa lại cho khớp, **đừng** sửa test.

- [ ] **Step 7: Kiểm kiểu + i18n + commit**

```bash
npm run check && npm run i18n:check
git add server/routers/kbErrors.ts server/routers/kbErrorCodes.test.ts server/routers/kbIngestRouter.ts server/routers/kbStudioRouter.ts client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/s5-A4): 6 mã lỗi luồng nạp tri thức — hết '20971520 bytes'

Giới hạn hiện bằng MB thay vì byte thô. Một chỗ dựng lỗi dùng chung cho cả
kbIngestRouter lẫn kbStudioRouter — trước đây cùng tình huống ném hai câu khác
nhau, nên một màn hình có cả tiếng Anh lẫn tiếng Việt."
```

---

## Task 4: Cổng đếm — biến "phủ toàn bộ" thành đích kiểm chứng được

**Files:**
- Test: `server/routers/appErrorCoverage.test.ts` (tạo mới)

**Interfaces:**
- Produces: hằng `ALLOWED_LEGACY_THROWS` — Task 5-8 hạ dần, Task 8 hạ về 0

- [ ] **Step 1: Đo số hiện tại**

Run:
```bash
grep -rho "new TRPCError" server/routers --include=*.ts | wc -l
grep -rlo "new TRPCError" server/routers --include=*.ts | grep -v "\.test\.ts" | wc -l
```
Ghi lại hai số. Sau Task 3 số này đã giảm so với 1056 ban đầu.

- [ ] **Step 2: Viết cổng** — tạo `server/routers/appErrorCoverage.test.ts`

```ts
/**
 * Sprint 5 §4.4 — CỔNG CHẶN HỒI QUY.
 *
 * "Di trú toàn bộ router" chỉ là lời hứa nếu không có gì đo nó. Test này đếm số
 * chỗ còn ném `new TRPCError` trực tiếp (chưa qua appError) và so với một ngân
 * sách GIẢM DẦN. Mỗi đợt di trú hạ hằng số; test ĐỎ nếu số TĂNG ⇒ router mới
 * không thể lặng lẽ thêm nợ. Đợt cuối hạ về 0.
 *
 * ⚠ KHÔNG được nâng hằng số này để test xanh. Nếu bạn thấy mình sắp làm vậy:
 * bạn vừa thêm một câu lỗi không dịch được cho người dùng Việt Nam. Dùng
 * appError() thay vì new TRPCError().
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Hạ số này mỗi khi di trú xong một đợt. Không bao giờ nâng lên. */
const ALLOWED_LEGACY_THROWS = 0; // ← thay bằng số đo ở Step 1

const ROUTERS_DIR = dirname(fileURLToPath(import.meta.url));

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { out.push(...walkTsFiles(full)); continue; }
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function countLegacyThrows(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;
  for (const file of walkTsFiles(ROUTERS_DIR)) {
    const n = (readFileSync(file, "utf8").match(/new TRPCError\(/g) ?? []).length;
    if (n > 0) { byFile.push([file.replace(ROUTERS_DIR, ""), n]); total += n; }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

describe("phủ mã lỗi trong server/routers", () => {
  it(`còn tối đa ${ALLOWED_LEGACY_THROWS} chỗ ném TRPCError trực tiếp`, () => {
    const { total, byFile } = countLegacyThrows();
    if (total > ALLOWED_LEGACY_THROWS) {
      // In ra file nặng nhất để đợt sau biết bắt đầu từ đâu.
      console.error("[phủ mã lỗi] còn nợ ở:", byFile.slice(0, 15));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_LEGACY_THROWS);
  });

  it("ngân sách KHÔNG được nới rộng hơn thực tế — số dư thừa che mất nợ mới", () => {
    // Ngân sách phải bám SÁT số thật. Nếu nó cao hơn thực tế, ai đó thêm một
    // `new TRPCError` mới sẽ lọt qua cổng mà không ai biết — cổng hoá vô dụng.
    const { total } = countLegacyThrows();
    expect(ALLOWED_LEGACY_THROWS).toBe(total);
  });
});
```

- [ ] **Step 3: Đặt hằng bằng đúng số đo Step 1, chạy, xác nhận XANH**

Run: `npx vitest run server/routers/appErrorCoverage.test.ts`
Expected: PASS (bằng đúng, không dư).

- [ ] **Step 4: Chứng minh cổng thật sự chặn**

Tạm thêm một `new TRPCError({ code: "BAD_REQUEST", message: "thử" })` vào một router bất kỳ, chạy lại test.
Expected: **FAIL**. Xoá dòng vừa thêm, chạy lại: PASS.

Nếu nó không đỏ — cổng vô dụng, **dừng và báo lại**.

- [ ] **Step 5: Commit**

```bash
git add server/routers/appErrorCoverage.test.ts
git commit -m "test(ai/s5-A4): cổng đếm ALLOWED_LEGACY_THROWS — router mới không thể thêm nợ"
```

---

## Task 5: Đợt 1 — `DB_UNAVAILABLE` (210 chỗ / 57 file)

**Files:** 57 file trong `server/routers/` — sinh danh sách bằng lệnh ở Step 1.

**Interfaces:**
- Consumes: `appError` (Task 1), khoá `errors.DB_UNAVAILABLE` (Task 2), cổng (Task 4)

Đây là đợt **cơ học nhất**: một mã, không tham số, một chuỗi.

- [ ] **Step 1: Sinh danh sách công việc**

```bash
grep -rniE "message:\s*[\"'\`](database|db) (not available|not connected|unavailable)" server/routers --include=*.ts | grep -v "\.test\.ts" > /tmp/sweep1.txt
wc -l /tmp/sweep1.txt   # kỳ vọng ~210
cut -d: -f1 /tmp/sweep1.txt | sort -u | wc -l   # kỳ vọng ~57
```

File nặng nhất (làm trước để thấy ngay tác dụng): `annotationRouters.ts` (21) · `aiRouters.ts` (12) · `webhookRouter.ts` (10) · `backupRouter.ts` (10) · `aiQualityGateRouter.ts` (10) · `productionSessionRouter.ts` (9) · `ngRateThresholdRouter.ts` (9) · `trainingBatchCommentsRouter.ts` (8) · `thresholdApprovalRouter.ts` (8) · `aiSettingsRouter.ts` (8).

- [ ] **Step 2: Chia 6 lô, mỗi lô ~10 file**

Làm **tuần tự** (không song song — tranh chấp git index). Mỗi lô là một vòng Step 3→6 rồi commit.

- [ ] **Step 3: Với mỗi file trong lô — thay từng chỗ**

Trước:
```ts
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
```
Sau:
```ts
    if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
```

Thêm import vào đầu file nếu chưa có:
```ts
import { appError } from "../_core/appError";
```

**Giữ nguyên mã tRPC** của từng chỗ (có nơi là `INTERNAL_SERVER_ERROR`, có nơi khác) — đừng chuẩn hoá, đó là thay đổi hành vi không nằm trong phạm vi.

- [ ] **Step 4: Chạy test của các router trong lô**

Run: `npx vitest run server/routers/` (hoặc lọc theo tên file nếu bộ test quá lâu)
Expected: PASS. Test nào assert nguyên văn `"Database not available"` vẫn xanh nhờ `fallbackMessage`.

- [ ] **Step 5: Hạ hằng cổng**

Sửa `ALLOWED_LEGACY_THROWS` trong `server/routers/appErrorCoverage.test.ts` xuống đúng số đo mới:
```bash
grep -rho "new TRPCError" server/routers --include=*.ts | wc -l
```

- [ ] **Step 6: Chạy cổng + kiểm kiểu + commit lô**

```bash
npx vitest run server/routers/appErrorCoverage.test.ts && npm run check
git add <liệt kê ĐÍCH DANH các file của lô này>
# ⚠ TUYỆT ĐỐI KHÔNG `git add -A` hay `git add -u`. Cây làm việc có sẵn thay đổi CHƯA COMMIT
# từ công việc trước (sửa antipattern Drizzle `= ANY(array)` → `inArray()`), KHÔNG phải của
# plan này và KHÔNG được cuốn vào commit di trú:
#   server/db/product.ts · server/db/twin.ts · server/routers/digitalTwinRouter.ts
#   server/services/aiActiveLearning.ts · server/services/twin/twinReplay.ts
git commit -m "refactor(ai/s5-A4): DB_UNAVAILABLE lô N/6 — <danh sách file>

Hạ ALLOWED_LEGACY_THROWS <cũ> → <mới>."
```

- [ ] **Step 7: Sau lô cuối — khẳng định chuỗi thô đã hết**

Thêm vào `server/routers/appErrorCoverage.test.ts`:
```ts
  it("không còn chuỗi 'Database not available' thô nào trong router", () => {
    let hits = 0;
    for (const file of walkTsFiles(ROUTERS_DIR)) {
      const src = readFileSync(file, "utf8");
      hits += (src.match(/message:\s*["'`](?:Database|DB) (?:not available|not connected|unavailable)/gi) ?? []).length;
    }
    expect(hits).toBe(0);
  });
```

⚠ `appError(..., "Database not available")` truyền chuỗi ở **vị trí tham số thứ 4**, không phải `message:` — nên regex trên không bắt nhầm. Kiểm chứng bằng cách chạy test này ngay sau lô cuối.

Run: `npx vitest run server/routers/appErrorCoverage.test.ts`
Expected: PASS. Commit.

---

## Task 6: Đợt 2 — `ENTITY_NOT_FOUND` + từ điển thực thể (~328 chỗ)

**Files:** router có message dạng "… not found" / "không tìm thấy …" / "… không tồn tại"; `client/src/i18n/locales/{vi,en,zh}.json`

- [ ] **Step 1: Sinh danh sách + rút danh sách thực thể**

```bash
grep -rniE "message:\s*[\"'\`][^\"'\`]*(not found|không tìm thấy|không tồn tại|does not exist)" server/routers --include=*.ts | grep -v "\.test\.ts" > /tmp/sweep2.txt
wc -l /tmp/sweep2.txt
```

Đọc `/tmp/sweep2.txt`, rút ra **danh sách thực thể duy nhất** (product, machine, instrument, sampling plan, product view, measurement point, …). Đây là bước cần đọc, không cơ học được.

- [ ] **Step 2: Bổ sung `errors.entity.*` cho mọi thực thể vừa rút**

Thêm vào `vi.json`/`en.json`/`zh.json`. Đặt khoá theo **camelCase tiếng Anh** (`samplingPlan`, `productView`, `measurementPoint`) để mã nguồn dùng đúng một chuỗi ở mọi nơi.

Thực thể chưa dịch sẽ hiện nguyên văn khoá (đã có test ở Task 2 Step 1) — **không sập**, nhưng đừng để sót: quét lại danh sách sau khi xong.

- [ ] **Step 3: Chia lô ~10 file, thay từng chỗ**

Trước:
```ts
      throw new TRPCError({ code: "NOT_FOUND", message: "Measurement point not found" });
```
Sau:
```ts
      throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementPoint" }, "Measurement point not found");
```

Có tham chiếu id thì giữ trong `fallbackMessage`, **không** nhét id vào `params` — câu i18n không có chỗ cho nó và id không giúp người vận hành:
```ts
      throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "instrument" },
        `Instrument ID ${input.preferredInstrumentId} not found`);
```

⚠ Câu dạng **"X does not belong to Y"** KHÔNG thuộc đợt này — đó là `SCOPE_MISMATCH`, để đợt 3. Đừng gộp bừa.

- [ ] **Step 4: Mỗi lô — chạy test, hạ cổng, kiểm kiểu, commit**

Giống Task 5 Step 4-6.

- [ ] **Step 5: Sau lô cuối — kiểm i18n**

Run: `npm run i18n:check`
Expected: mọi khoá `errors.entity.*` có đủ ở vi/en/zh.

---

## Task 7: Đợt 3 — bảy họ còn lại (~227 chỗ)

**Files:** router còn lại

Bảng ánh xạ. Đọc từng chỗ rồi chọn — **đừng thay bằng regex hàng loạt**, các họ này chồng lấn nhau về câu chữ.

| Mẫu message | Mã | Params |
|---|---|---|
| `… already exists`, `Mã … đã tồn tại`, vi phạm unique | `ENTITY_DUPLICATE` | `{ entity, field? }` |
| `… does not belong to …`, `… mismatch` | `SCOPE_MISMATCH` | `{ entity, parent }` |
| `… is required`, `… bắt buộc`, `… is missing` | `FIELD_REQUIRED` | `{ field }` |
| `Invalid …`, `… không hợp lệ`, `… must be …` | `INVALID_VALUE` | `{ field, reason? }` |
| `… disabled`, `… not enabled`, `chưa bật`, `not configured` | `FEATURE_DISABLED` | `{ feature }` |
| `Failed to …`, `… thất bại`, `không thể …` | `OPERATION_FAILED` | `{ operation }` |
| `permission`, `not allowed`, `không có quyền`, `denied` | `PERMISSION_DENIED` | `{ action? }` |

- [ ] **Step 1: Sinh danh sách theo từng họ**

```bash
grep -rniE "message:\s*[\"'\`][^\"'\`]*(already exists|đã tồn tại)" server/routers --include=*.ts | grep -v "\.test\.ts" > /tmp/sweep3-duplicate.txt
grep -rniE "message:\s*[\"'\`][^\"'\`]*(does not belong|mismatch|không thuộc)" server/routers --include=*.ts | grep -v "\.test\.ts" > /tmp/sweep3-scope.txt
grep -rniE "message:\s*[\"'\`][^\"'\`]*(required|bắt buộc|is missing)" server/routers --include=*.ts | grep -v "\.test\.ts" > /tmp/sweep3-required.txt
grep -rniE "message:\s*[\"'\`][^\"'\`]*(invalid|không hợp lệ|must be)" server/routers --include=*.ts | grep -v "\.test\.ts" > /tmp/sweep3-invalid.txt
grep -rniE "message:\s*[\"'\`][^\"'\`]*(disabled|not enabled|chưa bật|not configured|unavailable)" server/routers --include=*.ts | grep -v "\.test\.ts" > /tmp/sweep3-disabled.txt
grep -rniE "message:\s*[\"'\`][^\"'\`]*(failed to|thất bại|không thể)" server/routers --include=*.ts | grep -v "\.test\.ts" > /tmp/sweep3-failed.txt
grep -rniE "message:\s*[\"'\`][^\"'\`]*(permission|not allowed|forbidden|không có quyền|denied)" server/routers --include=*.ts | grep -v "\.test\.ts" > /tmp/sweep3-perm.txt
wc -l /tmp/sweep3-*.txt
```

⚠ Một dòng có thể lọt vào **nhiều** danh sách (ví dụ `"Invalid product model — không tồn tại"`). Khi trùng: chọn theo **nguyên nhân thật**, không theo danh sách nào bắt được trước. Ghi chú lựa chọn vào commit message nếu không hiển nhiên.

- [ ] **Step 2: Làm lần lượt từng họ, mỗi họ chia lô ~10 file**

Ví dụ `FEATURE_DISABLED`:
```ts
      throw appError("PRECONDITION_FAILED", "FEATURE_DISABLED", { feature: "KB Studio" },
        "KB Studio is not enabled");
```

`OPERATION_FAILED` — **giữ nguyên nguyên nhân gốc trong fallback**, đừng nuốt:
```ts
      throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "tải ảnh lên" },
        `Failed to upload image: ${(err as Error)?.message ?? err}`);
```

- [ ] **Step 3: Mỗi lô — chạy test, hạ cổng, kiểm kiểu, commit**

- [ ] **Step 4: Sau họ cuối — kiểm i18n + kiểm kiểu toàn bộ**

Run: `npm run i18n:check && npm run check && npx vitest run server/routers/`

---

## Task 8: Đợt 4 — đuôi dài, hạ cổng về 0

**Files:** router còn lại

- [ ] **Step 1: Xem còn gì**

Run: `npx vitest run server/routers/appErrorCoverage.test.ts`
Test in ra 15 file nặng nhất qua `console.error`. Đó là danh sách công việc.

- [ ] **Step 2: Với mỗi file — quyết định từng chỗ**

Ba lựa chọn, theo thứ tự ưu tiên:
1. **Rơi vào một họ sẵn có** ⇒ dùng mã đó.
2. **Lỗi riêng mà người dùng cuối thật sự gặp** ⇒ thêm mã mới vào `APP_ERROR_CODES` + 3 khoá i18n.
3. **Lỗi nội bộ người dùng không bao giờ thấy** (lỗi lập trình, cấu hình sai lúc khởi động, đường dẫn không thể xảy ra) ⇒ vẫn dùng `appError` với `OPERATION_FAILED`, nhưng ghi rõ lý do trong comment. **Không** để `new TRPCError` trần — cổng sẽ chặn, và ngoại lệ ngầm là thứ khiến ngân sách không bao giờ về 0 được.

⚠ Đừng tạo mã mới cho từng câu. Nếu bạn sắp có >40 mã bespoke — dừng lại, gom nhóm, **báo lại**.

- [ ] **Step 3: Mỗi lô ~10 file — chạy test, hạ cổng, kiểm kiểu, commit**

- [ ] **Step 4: Hạ hằng về 0**

```ts
const ALLOWED_LEGACY_THROWS = 0;
```

Run: `npx vitest run server/routers/appErrorCoverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Nghiệm thu toàn bộ**

```bash
npm run check
npm run i18n:check
npx vitest run server/ client/src/lib/
```
Expected: xanh toàn bộ.

- [ ] **Step 6: Kiểm bằng mắt trên máy thật — một lần, ngắn**

Chạy ứng dụng, thử **3 ca** ở luồng KB (Task 3): tải tệp quá dung lượng · tải tệp `.pptx` · nạp URL không tồn tại. Khẳng định câu hiện ra là **tiếng Việt**, có số MB chứ không phải byte thô.

Đây là chỗ duy nhất trong plan cần mắt người: hai lần trước tính năng chết im lặng vì chặng nối tay bỏ sót mà test đơn vị vẫn xanh.

- [ ] **Step 7: Commit cuối**

```bash
git add <liệt kê ĐÍCH DANH các file đã sửa>
# ⚠ KHÔNG `git add -A` — xem cảnh báo ở Task 5 Step 6 về 5 file chưa commit của công việc trước.
git commit -m "refactor(ai/s5-A4): hạ ALLOWED_LEGACY_THROWS về 0 — mọi TRPCError trong router đã có mã

Người dùng Việt Nam thôi đọc câu lỗi tiếng Anh thô. Router mới thêm mà quên
appError() sẽ bị cổng đếm chặn ngay."
```

---

## Self-Review

**1. Spec coverage**

| Spec §4 | Task |
|---|---|
| §4.2 hạ tầng máy chủ `appError` + `errorFormatter` | 1 |
| §4.3 hạ tầng client + từ điển thực thể + fallback | 2 (từ điển mở rộng ở 6) |
| §4.4 cổng chặn hồi quy `ALLOWED_LEGACY_THROWS` | 4, hạ dần ở 5-8 |
| §4.5 bốn đợt quét | 5, 6, 7, 8 |
| §4.6 thứ tự trong sprint | Global Constraints |
| 6 mã KB (phàn nàn gốc của A4) | 3 |

**2. Placeholder scan** — không có TBD/TODO. Hai chỗ **cố ý** để trống có tính toán, không phải placeholder:
- Task 4 Step 2 `ALLOWED_LEGACY_THROWS = 0; // ← thay bằng số đo ở Step 1` — số này **phải** đo tại thời điểm chạy vì Task 3 đã làm nó đổi; ghi cứng một số bịa vào plan sẽ sai.
- Danh sách file từng lô ở Task 5-8 sinh bằng lệnh `grep` cụ thể, không liệt kê tay 117 dòng — lệnh cho ra danh sách chính xác tại thời điểm chạy, chống lệch so với plan.

**3. Type consistency** — `AppErrorCode` / `AppErrorParams` khai ở Task 1 Step 3, dùng ở Task 1 Step 4 và Task 3 Step 3. `appError(trpcCode, appCode, params?, fallbackMessage?)` giữ đúng thứ tự tham số ở mọi ví dụ (Task 1, 3, 5, 6, 7). `readAppErrorMeta` trả `{ appCode, appParams? } | null` — khớp giữa Task 1 Step 4, Step 5, Step 6 và Task 3 Step 2. Client `translateAppError(appCode, params, fallback)` khớp giữa Task 2 Step 4 và Step 5. Tên khoá i18n `errors.<CODE>` và `errors.entity.<name>` nhất quán từ Task 2 → 3 → 6.

**Điểm cần người review chú ý nhất:**
1. **Task 4 Step 4** — phải chứng minh cổng thật sự đỏ được. Cổng không chặn được gì là tệ hơn không có cổng, vì nó tạo cảm giác an toàn giả.
2. **Task 7 Step 1** — một dòng lọt nhiều danh sách. Chọn sai họ thì câu dịch ra sai nghĩa, mà test sẽ vẫn xanh.
3. **Task 8 Step 2 lựa chọn 3** — cám dỗ để lại `new TRPCError` cho "lỗi nội bộ". Chấp nhận một ngoại lệ là ngân sách không bao giờ về 0.
