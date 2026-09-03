# Khối C — nguồn sự thật của giới hạn: kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng BG-96 (fake-UTC) và BG-97 (v2 chấm theo limit sống) rồi dựng đường DẠY GIỚI HẠN (spec dùng chung + router đọc cây + tab UI) để spec-gate BG-92 lần đầu chấm trên dữ liệu thật; chốt bằng BG-98 (cổng máy-tự-mâu-thuẫn).

**Architecture:** Không migration nào — mọi bảng cần thiết đã tồn tại (mig 0338/0340/0347, `measurement_point_versions` 0276/0282). Pha 1 đổi quy ước ghi thời gian về UTC thật (sửa helper, không sửa call site). Pha 2 giải giới hạn-tại-neo **trước** khi dựng cổng để `taoCongSpecCayV2` giữ thuần. Pha 3 gom 18 cột giới hạn về `shared/pointLimitSpec.ts` rồi mở router đọc + tab UI. Toàn bộ chấm điểm tái dùng `resolveLimitsAtInstant`/`evaluatePointResult` (thuần, đã có).

**Tech Stack:** TypeScript · drizzle + postgres-js · tRPC v11 · vitest (`*.db.test.ts` cần Postgres test, client `*.unit.test.ts`) · React 19 + shadcn/ui + i18next.

**Spec:** `docs/superpowers/specs/2026-09-03-aoi-khoi-c-nguon-su-that-gioi-han-design.md`

## Global Constraints

- **KHÔNG migration, KHÔNG đổi schema** — kế hoạch này không cần; nếu một task phát hiện cần, DỪNG và ghi ruling.
- **KHÔNG đổi hợp đồng máy** (`machineDataContractV2`, `machineTemplateContract`) — máy không cập nhật được.
- Một commit mỗi task, `git add` **theo tên file** (worktree dùng chung nhiều phiên — không `git add -A`).
- Không commit lên `main`; nhánh làm việc `feat/hmi-dep`, remote `fresh`.
- Chuỗi hiển thị client qua `t()` với khoá đủ **vi/en/zh** (cổng `viStringCoverage` cấm chuỗi Việt trần mới; `appErrorParamsCoverage` cấm `field` thiếu khoá).
- Sau MỖI task: `npm run check` sạch. Trước commit cuối: `npm run check:tests` sạch.
- Backtick trong lệnh shell bị nuốt — mọi nội dung có backtick đi qua Write/Edit, không `node -e`/heredoc.
- Test DB: vitest.setup tự trỏ `DATABASE_URL` sang DB `_test`; mọi số đo DB kèm `current_database()` (luật Đ-28).

---

## PHA 1 — BG-96: quy ước UTC thật

### Task 1: Bỏ dịch fake-UTC ở mọi đường ghi + dedup, lưới bất biến header↔cây

**Files:**
- Modify: `server/routers/machineApiRouters.ts:1119-1121` (dedup), `:1543-1558` (v1 ghi), `:1583-1590` (serverReceivedAt), `:3715-3722` (v2 trực tiếp)
- Modify: `server/routers/aoiPackageRouter.ts:1334-1339` (+ `:1363-1364` createdAt/updatedAt)
- Modify: `server/routers/machineApiProvenance.test.ts:275-285` (đang ghim hành vi fake-UTC)
- Test: tạo `server/routers/thoiGianMotHeQuyChieu.db.test.ts`

**Interfaces:** Produces: bất biến "mọi cột thời gian họ inspection là UTC thật" — Task 5 (neo instant) và Task 3 (census) dựa vào.

- [ ] **Bước 1: Viết lưới bất biến (ĐỎ trên mã hiện tại).** Trong `thoiGianMotHeQuyChieu.db.test.ts`: gọi `submitInspectionTreeV2` (qua `machineApiRouter.createCaller` như `walCayV2PhatLai.db.test.ts` đang làm) với payload v2 có `completedAt: "2026-09-03T02:00:00.000Z"` và capture mang `startedAt: "2026-09-03T01:59:00.000Z"`; đọc lại hàng `product_inspections` + `inspection_captures` cùng bo:

```ts
// Bất biến BG-96: header và cây CÙNG hệ quy chiếu — lệch đúng 60s như máy khai,
// KHÔNG lệch 60s + offset múi giờ. Trên mã fake-UTC: lệch 60s + 7h ⇒ ĐỎ.
const header = await dbi.select().from(productInspections).where(eq(productInspections.id, inspectionId));
const cap = await dbi.select().from(inspectionCaptures).where(eq(inspectionCaptures.inspectionId, inspectionId));
expect(header[0].inspectionTime.getTime() - cap[0].startedAt!.getTime()).toBe(60_000);
// Và header phải là ĐÚNG instant máy khai (UTC thật):
expect(header[0].inspectionTime.toISOString()).toBe("2026-09-03T02:00:00.000Z");
```

- [ ] **Bước 2: Chạy để xác nhận ĐỎ.** `npx vitest run server/routers/thoiGianMotHeQuyChieu.db.test.ts` — kỳ vọng lệch `25_260_000` (60s + 7h) trên máy UTC+7. Chép nguyên văn dòng đỏ.

- [ ] **Bước 3: Bỏ dịch ở 4 điểm ghi + 1 dedup.** Mẫu (áp cả 5 chỗ):

```ts
// TRƯỚC (machineApiRouters.ts:1557-1558):
const rawInspTime = input.inspectionTime ? new Date(input.inspectionTime) : new Date();
const localInspTime = new Date(rawInspTime.getTime() - rawInspTime.getTimezoneOffset() * 60000);
// SAU: bỏ hẳn dòng dịch; đổi mọi chỗ dùng `localInspTime` → `rawInspTime`
// (đường v1: :1710; v2: :3741; outbox :2367; ZIP: dùng thẳng `rawInspTime`,
// createdAt/updatedAt :1363-1364 cũng nhận rawInspTime).
```

  Dedup `:1119-1121`: `const local = ...` → dùng thẳng `new Date(input.inspectionTime)`. `serverReceivedAt` `:1588-1590`: bỏ `localServerReceivedAt`, ghi `serverReceivedAt` thô.
  **Thay khối chú thích doc 51 P1 CASE #3** (`:1543-1556` và bản sao ở `:3720-3721`, `aoiPackageRouter.ts` quanh `:1334`) bằng chú thích mới: cutover 2026-09-03 theo spec Khối C QĐ-1 — dữ liệu test đã được chủ dự án cho phép làm lại, `FACTORY_DB_STORAGE_TZ` giữ mặc định UTC.

- [ ] **Bước 4: Sửa lưới đang ghim fake-UTC.** `machineApiProvenance.test.ts:281-284`: `expectedLocalRecv` → `serverNow` thô (`expect((row.serverReceivedAt as Date).toISOString()).toBe(serverNow.toISOString())`). Soát cả file test này tìm phép dịch tương tự (grep `getTimezoneOffset` trong file).

- [ ] **Bước 5: Chạy lưới liên quan.** `npx vitest run server/routers/thoiGianMotHeQuyChieu.db.test.ts server/routers/machineApiProvenance.test.ts server/db/walCayV2PhatLai.db.test.ts server/routers/aoiPackageIngestHopNhat.test.ts` — tất cả XANH. Nếu lưới khác đỏ vì từng ghim fake-UTC: sửa lưới (hành vi mới là đúng theo spec), ghi vào báo cáo từng file đã sửa.

- [ ] **Bước 6: Commit** (`git add` đúng các file trên).

**Ba mệnh đề:** header = đúng instant máy khai (ISO khớp từng ký tự) · header↔cây lệch đúng 60s · dedup v1 vẫn bắt trùng (lưới `walCayV2PhatLai`/dedup hiện có xanh).

### Task 2: Ba ổ đọc fake-UTC → giờ-tường-nhà-máy → UTC thật

**Files:**
- Modify: `server/_core/index.ts:87-99` (`parseLocalDate`) · `server/routes/externalInspectionApi.ts:58-71` (`parseDateParam`) · `server/routers/stationAnalysisRouter.ts:31-37` (`toFakeUtc` + ~10 cặp call site trong CÙNG file)
- Test: tạo `server/utils/docGioTuongNhaMay.test.ts`

**Interfaces:** Consumes: `wallClockToUtc(input, tz)` — `server/utils/factoryTime.ts:138` (nhận `{year,month,day,hour?,minute?,second?}`); `getFactoryTimezone()`.

- [ ] **Bước 1: Viết helper dùng chung + lưới (ĐỎ vì chưa có).** Tạo hàm trong `server/utils/factoryTime.ts`:

```ts
/**
 * BG-96 (spec Khối C QĐ-1) — đọc một chuỗi ngày/giờ NGƯỜI DÙNG gõ (giờ tường
 * nhà máy) thành instant UTC THẬT, thay cho phép dịch fake-UTC cũ
 * (`d.getTime() - d.getTimezoneOffset()*60000` — phụ thuộc TZ của PROCESS, không
 * phải của nhà máy). Chuỗi có 'Z'/offset rõ ràng đi thẳng `new Date` (người gọi
 * đã nói rõ hệ quy chiếu).
 */
export function docGioTuongNhaMay(dateStr: string, endOfDay = false): Date | undefined {
  const s = String(dateStr).trim();
  if (s === "") return undefined;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) { const d = new Date(s); return isNaN(d.getTime()) ? undefined : d; }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(s);
  if (!m) { const d = new Date(s); return isNaN(d.getTime()) ? undefined : d; }
  const coGio = m[4] !== undefined;
  const utc = wallClockToUtc({
    year: +m[1], month: +m[2], day: +m[3],
    hour: coGio ? +m[4] : endOfDay ? 23 : 0,
    minute: coGio ? +m[5] : endOfDay ? 59 : 0,
    second: coGio ? +(m[6] ?? 0) : endOfDay ? 59 : 0,
  }, getFactoryTimezone());
  const ms = coGio ? +(m[7]?.padEnd(3, "0") ?? 0) : endOfDay ? 999 : 0;
  return new Date(utc.getTime() + ms);
}
```

  Lưới (`docGioTuongNhaMay.test.ts`, ghim `FACTORY_TIMEZONE=Asia/Ho_Chi_Minh` qua `vi.stubEnv`): `"2026-09-03"` → `2026-09-02T17:00:00.000Z` · `"2026-09-03"` endOfDay → `2026-09-03T16:59:59.999Z` · `"2026-09-03T08:30:00"` → `2026-09-03T01:30:00.000Z` · `"2026-09-03T08:30:00Z"` → giữ nguyên · `""`/`"rác"` → `undefined` · **đối chứng**: cùng ngày, kết quả === `resolveFactoryDateWindow("2026-09-03","2026-09-03").start` (`server/utils/kpi.ts:112`).

- [ ] **Bước 2: Chạy ĐỎ rồi cài, chạy XANH.**

- [ ] **Bước 3: Thay ruột 3 helper cũ.** `parseLocalDate(s, endOfDay)` → `return docGioTuongNhaMay(s, endOfDay) ?? new Date(NaN);` (call site `_core/index.ts` kiểm `isNaN` sẵn — soát 7 điểm gọi liệt kê ở báo cáo khảo sát: `:2271, 2382, 2733, 3617, 3763, 3990, 4184`). `parseDateParam` → giữ chữ ký, ruột gọi `docGioTuongNhaMay`, trả `undefined` như cũ. `toFakeUtc(d: Date)` nhận `Date` (đã parse từ input client): thay bằng nhận input GỐC — đo call site: nếu tất cả dạng `toFakeUtc(new Date(input.startDate))` thì đổi thành `docGioTuongNhaMay(input.startDate)`; nếu có chỗ truyền Date tính toán, giữ hàm nhận Date và đổi ruột thành `wallClockToUtc(wallClockInZone-của-process...)` — **đo trước khi sửa, ghi vào báo cáo**.

- [ ] **Bước 4:** `npx vitest run server/routers/stationAnalysisRouter` (+ mọi test của 3 module — glob theo tên file) + `npm run check`. XANH.
- [ ] **Bước 5: Commit.**

**Hai mệnh đề:** cùng một ngày người dùng chọn, 3 module trả cùng cửa sổ với `resolveFactoryDateWindow` · không call site nào còn gọi thẳng công thức `getTimezoneOffset`.

### Task 3: Census cấm fake-UTC tái sinh + dọn dữ liệu test + gỡ ràng buộc

**Files:**
- Test: tạo `server/utils/fakeUtcCensus.test.ts`
- Create: `scripts/don-du-lieu-lech-tz.mjs`
- Modify: `docs/superpowers/plans/2026-09-03-aoi-khoi-b-cay-day.md:340` (gỡ ràng buộc "không so thời gian header↔cây")

- [ ] **Bước 1: Census.** Quét `server/**/*.ts` (trừ `*.test.ts`) tìm mẫu `getTimezoneOffset\(\)\s*\*\s*60000` — kỳ vọng **0** (sau Task 1+2). Fuse chống-vacuity: tự quét một chuỗi mồi chứa mẫu ⇒ phải bắt được. Chạy ĐỎ trên cây chưa vá không cần (Task 1+2 đã vá) — thay bằng **đột biến**: thêm tạm 1 dòng chứa mẫu vào một file server ⇒ census ĐỎ ⇒ hoàn tác, chép nguyên văn.
- [ ] **Bước 2: Script dọn.** `don-du-lieu-lech-tz.mjs` (chạy tay, KHÔNG tự động): in `current_database()` + đếm `product_inspections`, rồi (cờ `--xoa` mới thật sự chạy) `DELETE` họ kết quả: `measurement_results` → `inspection_captures` → `inspection_positions` → `inspection_surfaces` → `inspection_idempotency_keys` → `product_inspections` (đúng thứ tự FK; **KHÔNG** đụng `product_surfaces/positions/captures`, `measurement_point_defs`, `machine_template_versions`, `inspection_packages`). Chạy trên dev DB, dán số trước/sau vào báo cáo. (Được phép: chủ dự án xác nhận dữ liệu test 2026-08.)
- [ ] **Bước 3:** Gỡ dòng ràng buộc BG-96 trong plan Khối B (thay bằng "ĐÃ ĐÓNG 2026-09-03, xem plan Khối C Task 1-3"). Commit.

**Mệnh đề:** census xanh + đột biến đỏ · dev DB 0 hàng lệch · `npm run check` sạch.

---

## PHA 2 — BG-97: v2 chấm theo giới hạn tại NEO

### Task 4: Batch loader lịch sử giới hạn (xuất khỏi chỗ private)

**Files:**
- Create: `server/db/pointLimitSnapshots.ts` · Test: `server/db/pointLimitSnapshots.db.test.ts`
- Modify: `server/routers/machineApiRouters.ts:1184-1237` (`loadPointLimitSnapshots` thành wrapper)

**Interfaces:** Produces: `traLichSuGioiHanBatch(pointDefIds: readonly number[]): Promise<Map<number, PointLimitSnapshot[]>>` — Task 5 dùng. Consumes: `PointLimitSnapshot` từ `server/services/pointResultEvaluator.ts:468`.

- [ ] **Bước 1: Lưới ĐỎ.** Trong `pointLimitSnapshots.db.test.ts`: seed 1 point-def, sửa nó 2 lần qua `db.updateMeasurementPointDef` (tự ghi `measurement_point_versions`), gọi `traLichSuGioiHanBatch([id, 999999])` ⇒ map có `id → 2 snapshot` (tăng dần `changedAt`, có `productPointsConfigVersion` khi cột 0282 tồn tại) và `999999 → []`.
- [ ] **Bước 2: Cài.** Chuyển nguyên logic `:1190-1234` sang hàm mới, đổi `WHERE pointDefId = $1` → `inArray(measurementPointVersions.pointDefId, ids)`, group theo `pointDefId`; giữ nguyên probe cột 0282 + fail-soft `[]` cho id lỗi (bản đồ thiếu khoá = `[]`). `loadPointLimitSnapshots(id, cache)` cũ thành wrapper gọi batch 1 phần tử (v1 không đổi hành vi — cache giữ nguyên).
- [ ] **Bước 3:** Chạy XANH + `npx vitest run server/routers/machineApiProvenance.test.ts` (v1 không hồi quy). **Đột biến:** trong batch bỏ `orderBy changedAt` ⇒ lưới thứ tự ĐỎ. Hoàn tác, chép nguyên văn.
- [ ] **Bước 4: Commit.**

### Task 5: Giải giới-hạn-tại-neo cho v2 + nối 3 đường + bộ đếm basis

**Files:**
- Modify: `server/services/specGateCayV2.ts` (thêm hàm thuần + 2 counter) · `server/routers/machineApiRouters.ts` (`submitInspectionTreeV2:3660-3713`, `ensureInspectionWalWired:1072-1086`) · `server/services/inspection/inspectionStoreForward.ts:395-399,966` · `server/routers/aoiPackageRouter.ts:1273-1277`
- Test: `server/services/giaiGioiHanTaiNeo.test.ts` (thuần) + thêm ca vào `server/db/walCayV2PhatLai.db.test.ts`

**Interfaces:**
- Produces (specGateCayV2.ts, THUẦN — không DB):

```ts
export interface KetQuaGiaiNeo {
  gioiHan: ReadonlyMap<string, PointLimitSource>;
  /** đếm được: điểm chấm theo snapshot-tại-neo / theo live (không sửa từ sau neo) */
  theoInstant: number; theoLive: number;
}
/** Neo = lần đầu payload chạm server. `lichSu.get(id)` thiếu/[]  ⇒ live (chứng minh
 * được: không có snapshot changedAt >= neo nghĩa là điểm KHÔNG bị sửa sau neo,
 * nên live CHÍNH LÀ giới hạn tại neo — khác v1-stale, không phải phỏng đoán). */
export function giaiGioiHanTaiNeo(
  tra: Pick<KetQuaTraPointDef, "banDo" | "gioiHan">,
  lichSu: ReadonlyMap<number, PointLimitSnapshot[]>,
  neo: Date,
): KetQuaGiaiNeo;
```

- `ThongKeSpecGate` (specGateCayV2.ts:96) thêm 2 trường `theoInstant: number; theoLive: number` (mặc định 0; gán sau khi giải neo — cổng vẫn thuần).
- `submitInspectionTreeV2` opts (machineApiRouters.ts:3665) thêm `serverReceivedAt?: Date`.
- `ProcessFn` (inspectionStoreForward.ts:395) → `(payload: BufferedSubmission, meta?: { enqueuedAt?: Date }) => Promise<{ inspectionId: number }>`; call site `:966` → `processFn(entry.payload, { enqueuedAt: new Date(entry.enqueuedAt) })`.

- [ ] **Bước 1: Lưới thuần ĐỎ** (`giaiGioiHanTaiNeo.test.ts`): điểm có snapshot `changedAt > neo` mang limit cũ ⇒ map trả limit CŨ, `theoInstant=1` · điểm không sửa sau neo ⇒ limit live, `theoLive=1` · khoá không có trong `banDo` không xuất hiện.
- [ ] **Bước 2: Cài** bằng `resolveLimitsAtInstant` (pointResultEvaluator.ts:509): basis `snapshot` ⇒ dùng `limits` đó; `missing` ⇒ dùng `tra.gioiHan.get(khoa)` (live). XANH.
- [ ] **Bước 3: Nối 3 đường.** Trong `submitInspectionTreeV2` sau `:3710`:

```ts
const neo = opts.serverReceivedAt ?? new Date();
let traChoConga: { gioiHan: ReadonlyMap<string, PointLimitSource> } = traBanDay;
let neoCounters = { theoInstant: 0, theoLive: 0 };
if (envTrue(process.env.SPEC_GATE_SNAPSHOT_ENABLED) && traBanDay.banDo.size > 0) {
  const lichSu = await traLichSuGioiHanBatch([...new Set(traBanDay.banDo.values())]);
  const giai = giaiGioiHanTaiNeo(traBanDay, lichSu, neo);
  traChoConga = giai; neoCounters = giai;
}
const congSpec = congSpecTuBanDay(traChoConga);
// … sau khi ghi xong: congSpec.thongKe.theoInstant = neoCounters.theoInstant; …
```

  WAL wiring `:1075` → `submitInspectionTreeV2(payload…, { serverReceivedAt: meta?.enqueuedAt })`. Cửa ZIP (`aoiPackageRouter.ts:1273`): cùng khối, `neo = pkg.createdAt` (cột `inspection_packages.createdAt`, defaultNow lúc gói được tạo — đo lại tên biến `pkg` tại chỗ). Trả `theoInstant/theoLive` trong object `specGate` của response (`:3677-3680`) và bản tương ứng phía ZIP (`:1689`).
- [ ] **Bước 4: Lưới tích hợp ĐỎ→XANH** (thêm vào `walCayV2PhatLai.db.test.ts`): (a) bật `SPEC_GATE_SNAPSHOT_ENABLED` qua `vi.stubEnv`; (b) dạy limit `upperLimit=10` cho 1 component; (c) đưa payload v2 (value=12, máy khai OK) vào WAL; (d) **siết** limit thành 5 qua `db.updateMeasurementPointDef`; (e) phát lại ⇒ component bị chấm theo limit **lúc enqueue** (=10): vi phạm `12>10` chứ KHÔNG phải `12>5` — assert chuỗi remark chứa `> max 10`; `theoInstant ≥ 1`. **Đối chứng chống hồi quy:** cờ TẮT ⇒ hành vi hôm nay (chấm theo 5).
- [ ] **Bước 5: Commit.**

**Ba mệnh đề:** bo WAL chấm theo limit thời-điểm-đến, đo bằng remark · cờ tắt ⇒ không đổi hành vi · v1 không đổi (provenance test xanh).

### Task 6: Hợp nhất merge variant-patch (v1) + khai rõ v2-BASE

**Files:**
- Modify: `server/db/product.ts` (xuất helper) · `server/routers/machineApiRouters.ts:2046-2057` · `server/services/specGateCayV2.ts` (chú thích đầu file)
- Test: `server/db/apDungVariantPatch.test.ts`

- [ ] **Bước 1: Lưới ĐỎ:** patch chứa `{upperLimit:"9", id:999, deletedAt:"x"}` áp lên base ⇒ chỉ `upperLimit` ăn, `id`/`deletedAt` giữ nguyên base.
- [ ] **Bước 2:** Xuất từ `product.ts` (cạnh `VARIANT_PATCH_PROTECTED_KEYS:3761`):

```ts
/** Doc 55 Item 3 — MỘT bản merge patch variant (lọc khoá bảo vệ). Trước 2026-09-03
 * đường ingest v1 shallow-merge THÔ (machineApiRouters.ts) còn mergeEffectivePoints
 * lọc — hai bản đã trôi khỏi nhau; nay cùng gọi hàm này. */
export function apDungVariantPatch<T extends object>(base: T, patchJson: unknown): T {
  const safe: Record<string, unknown> = {};
  if (patchJson && typeof patchJson === "object") {
    for (const [k, v] of Object.entries(patchJson as Record<string, unknown>)) {
      if (!VARIANT_PATCH_PROTECTED_KEYS.has(k)) safe[k] = v;
    }
  }
  return { ...base, ...safe };
}
```

  Dùng trong `mergeEffectivePoints:3785-3793` và thay khối inline `machineApiRouters.ts:2050-2056`.
- [ ] **Bước 3:** Chú thích đầu `specGateCayV2.ts` thêm đoạn: *"v2 chấm theo BASE variant — hợp đồng v2 không mang `variantCode` nên không phân giải được variant; KHÔNG đếm per-bo được (không biết bo thuộc variant nào mà không thêm truy vấn) — lệch spec QĐ-2.6 phần 'đếm', khai tại đây và trong báo cáo."*
- [ ] **Bước 4:** XANH + v1 gate tests + commit.

---

## PHA 3 — Khối C: dạy giới hạn

### Task 7: `shared/pointLimitSpec.ts` — MỘT nguồn 18 cột + census

**Files:**
- Create: `shared/pointLimitSpec.ts` · Test: `shared/pointLimitSpec.test.ts` + `server/contracts/pointLimitSpecCensus.test.ts`
- Modify: `server/db/cayDay.ts:832-876` (SELECT suy từ spec)

**Interfaces:** Produces:

```ts
export interface MucGioiHan { field: string; nhom: "1d" | "3d" | "gdt" | "criteria"; i18nKey: string; }
export const POINT_LIMIT_SPEC: readonly MucGioiHan[]; // đúng 18 field của PointLimitSource:
// lowerLimit, upperLimit, unit, heightMin, heightMax, areaMin, areaMax, volumeMin, volumeMax,
// coplanarityMax, warpageMax, voidPctMax, offsetXMax, offsetYMax, tiltMax, thicknessMin, thicknessMax, criteria
export const LIMIT_FIELDS: readonly string[]; // = POINT_LIMIT_SPEC.map(m => m.field)
// + các field CỬA DUYỆT thêm (không nằm trong PointLimitSource nhưng là "limits" nghiệp vụ):
export const APPROVAL_LIMIT_FIELDS: readonly string[]; // LIMIT_FIELDS + nominalValue, toleranceMode, tolPlus, tolMinus
```

- [ ] **Bước 1: Lưới ĐỎ:** (a) so `LIMIT_FIELDS` với danh sách khoá của một `PointLimitSource` mẫu đầy đủ (compile-time: `satisfies Record<(typeof LIMIT_FIELDS)[number], unknown>` trên object mẫu; runtime: 18 phần tử, không trùng); (b) census: mọi `field` phải là cột thật của `measurementPointDefs` (import từ `drizzle/schema/product`, kiểm `field in measurementPointDefs`).
- [ ] **Bước 2: Cài spec.** i18nKey dạng `pointLimits.<field>`.
- [ ] **Bước 3: Refactor SELECT `cayDay.ts:842-859`** thành build-từ-spec:

```ts
const gioiHanProjection = Object.fromEntries(
  POINT_LIMIT_SPEC.map((m) => [m.field, measurementPointDefs[m.field as keyof typeof measurementPointDefs]]),
);
```

  (giữ 3 cột khoá `pointDefId/captureExtId/componentExtId` khai tay). Chạy `npx vitest run server/db/cayDay*` + `server/services/specGateCayV2*` — XANH, hành vi không đổi.
- [ ] **Bước 4: Đột biến:** bỏ `thicknessMax` khỏi spec ⇒ lưới (a) ĐỎ kiểu compile hoặc runtime. Hoàn tác, chép nguyên văn. Commit.

### Task 8: `touchesLimits` suy từ spec + `setLimitsBatch`

**Files:**
- Modify: `server/routers/productRouters.ts:1315-1322` + thêm mutation sau `update` · `server/db/product.ts` (hàm batch)
- Test: `server/routers/measurementPointLimits.db.test.ts`

**Interfaces:** Produces: `measurementPoint.setLimitsBatch({ items: [{id, ...limits}], changeReason? })` → `{ updated: number; pointsConfigVersion: number }` — Task 11 (UI batch) gọi.

- [ ] **Bước 1: Lưới ĐỎ 1 (lỗ 3D):** sản phẩm live + enforced, `update` chỉ đổi `heightMax` ⇒ hiện ĐI THẲNG (bug). Lưới kỳ vọng `FORBIDDEN`/hàng đợi duyệt ⇒ ĐỎ trên mã hiện tại. Chép nguyên văn.
- [ ] **Bước 2:** `touchesLimits = APPROVAL_LIMIT_FIELDS.some((f) => (rest as Record<string, unknown>)[f] !== undefined);` (import từ `shared/pointLimitSpec`). Lưới 1 XANH; lưới đối chứng: đổi `name` không qua cửa duyệt.
- [ ] **Bước 3: Lưới ĐỎ 2 (batch):** `setLimitsBatch` 3 điểm cùng sản phẩm ⇒ cả 3 có limit mới, `pointsConfigVersion` tăng ĐÚNG 1, `measurement_point_versions` +3 hàng.
- [ ] **Bước 4: Cài.** DB (`product.ts`): `updateMeasurementPointLimitsBatch(items, changedBy)` — MỘT transaction: từng hàng `SELECT ... FOR UPDATE` + INSERT `measurement_point_versions` (mirror `updateMeasurementPointDef:1906-1988`, cùng cột) + UPDATE chỉ các field thuộc `APPROVAL_LIMIT_FIELDS`; cuối cùng bump `pointsConfigVersion` MỘT lần. Router: `requirePermission("settings_measurement_points","canEdit")`, mọi `id` phải cùng `productModelId` (khác ⇒ `BAD_REQUEST`), gọi `assertThresholdEditAllowed(items[0].id)` MỘT lần cho sản phẩm; input zod: `items` 1..200 phần tử, mỗi phần tử `{id: z.number().int().positive()}` + các field limit `z.string().optional()` (chuỗi — numeric drizzle, cùng kiểu `update`).
- [ ] **Bước 5:** XANH + đột biến: bỏ bump version ⇒ lưới ĐỎ. Commit.

### Task 9: `cayDayRouter` — 4 procedure đọc

**Files:**
- Create: `server/routers/cayDayRouter.ts` · Test: `server/routers/cayDayRouter.db.test.ts`
- Modify: `server/db/cayDay.ts` (3 hàm đọc mới) · `server/routers.ts:407-410` (mount `cayDay: cayDayRouter`)

**Interfaces:** Produces (Task 10/11 gọi):
- `cayDay.listMachinesForProduct({productModelId}) → { machineId, machineCode, machineName, banDayHienHanh: { version, checksum, pushedAt } | null }[]`
- `cayDay.getTree({productModelId, machineId}) → { surfaces: [{id, surfaceName, positions: [{id, positionId, name, captures: [{id, captureExtId, captureName, soComponent}]}]}] }`
- `cayDay.listComponents({captureRowId}) → { id, componentExtId, name, roiX, roiY, roiWidth, roiHeight, updatedAt, coGioiHan: boolean, gioiHan: Record<string, string|null> }[]` (`gioiHan` chỉ các field trong `POINT_LIMIT_SPEC`; `coGioiHan` = ít nhất một field khác NULL — trừ `unit`, cùng ngữ nghĩa `evaluatePointResult` "có gì để chấm")
- `cayDay.thongKeGioiHan({productModelId, machineId}) → { tongComponent, daDay, chuaCoGioiHan }`

- [ ] **Bước 1: Lưới ĐỎ.** Seed bằng chính đường thật: gọi `machineApi.submitMachineTemplate` (`machineApiRouters.ts:5533`) với mẫu 2/4/8/16 (tái dùng fixture của `cayDayChieuMay.db.test.ts`); rồi: `listMachinesForProduct` trả 1 máy + version hiện hành · `getTree` trả 2/4/8, mỗi capture `soComponent=2` · `listComponents` 2 hàng `coGioiHan:false` · `thongKeGioiHan` = `{16, 0, 16}` · sau khi dạy limit 1 điểm (qua `measurementPoint.update`) ⇒ `{16, 1, 15}`. **Phạm vi tenant:** caller thuộc tenant khác ⇒ `FORBIDDEN`/rỗng theo mẫu `productRouters.ts:402` (`db.sanPhamTrongPhamVi` — đo tên thật trước khi viết).
- [ ] **Bước 2: Cài.** DB đọc trong `cayDay.ts` (join như `traPointDefCapComponent:812-876`, lọc máy qua `productCaptures.machineId`, `deletedAt IS NULL`); version hiện hành từ `machine_template_versions` theo `uq_mtv_hien_hanh` (`supersededAt IS NULL`). Router `protectedProcedure`. `coGioiHan` tính từ `POINT_LIMIT_SPEC` (không chép tay danh sách).
- [ ] **Bước 3:** XANH + `npm run check` + commit.

### Task 10: Tab "Cây dạy" — đọc (tree + bảng component + badge version)

**Files:**
- Create: `client/src/components/products/teach/TeachTreeTab.tsx`, `ComponentLimitsTable.tsx`
- Modify: `client/src/pages/ProductModels.tsx:221` (`PRODUCT_DETAIL_TABS` += `"teach"`), `:2846-3310` (thêm `<TabsContent value="teach">`), `:2678+` (TabsTrigger mới)
- Modify: `client/src/i18n/locales/vi.json`, `en.json`, `zh.json` (nhánh khoá `teachTree.*`, `pointLimits.*`)

**Interfaces:** Consumes: 4 procedure Task 9 qua `trpc.cayDay.*.useQuery`. Produces: `ComponentLimitsTable` nhận prop `onEdit(row)` / `onBatchEdit(rows)` — Task 11 nối dialog.

- [ ] **Bước 1:** `TeachTreeTab({ productModelId })`: Select máy (từ `listMachinesForProduct`; rỗng ⇒ empty-state trung thực `t("teachTree.chuaCoMay", "Chưa máy nào dạy sản phẩm này")` — KHÔNG bịa dữ liệu); badge `t("teachTree.banDay", "Bản dạy v{{version}}")` + `pushedAt` định dạng `date-fns`; breadcrumb surface→position→capture (danh sách lồng, mẫu Accordion/DataTable như `ComponentLibrary.tsx`); chọn capture ⇒ render `ComponentLimitsTable`.
- [ ] **Bước 2:** `ComponentLimitsTable({ captureRowId, onEdit, onBatchEdit })`: `DataTable` cột componentExtId/name/ROI/badge trạng thái — `coGioiHan ? t("teachTree.daDay","Đã dạy") : t("teachTree.chuaCoGioiHan","Chưa có giới hạn")` (variant destructive cho chưa) + checkbox chọn nhiều; thanh đầu bảng hiện `thongKeGioiHan` (`daDay`/`tongComponent`).
- [ ] **Bước 3:** Khoá i18n đủ 3 locale (thêm CÙNG commit — `npm run i18n:check` xanh); `viStringCoverage.unit.test.ts` + `npm run check` xanh.
- [ ] **Bước 4:** Lưới unit: `client/src/components/products/teach/teachTreeTab.unit.test.ts` — render với mock trpc (mẫu mock của test unit client hiện có): máy rỗng ⇒ empty-state; có cây ⇒ đếm đúng số hàng component. Commit.

### Task 11: Dialog dạy giới hạn (đơn + hàng loạt)

**Files:**
- Create: `client/src/components/products/teach/ComponentLimitsDialog.tsx`, `BatchTeachLimitsDialog.tsx` · Test: `client/src/components/products/teach/componentLimitsDialog.unit.test.ts`
- Modify: `TeachTreeTab.tsx` (nối onEdit/onBatchEdit), locales ×3

- [ ] **Bước 1:** `ComponentLimitsDialog`: form các field từ `POINT_LIMIT_SPEC` **nhóm theo `nhom`** (1d luôn mở; 3d/gdt collapse — đa số máy AOI chỉ dùng 1d), nhãn `t(muc.i18nKey)`; mẫu form + mutation: `ProductVariantsTab.tsx:223-263`; lưu qua `trpc.measurementPoint.update` với `expectedUpdatedAt` (optimistic lock — mẫu xử lý CONFLICT `ProductModels.tsx:2155-2177`); lỗi qua `toastTrpcError`.
- [ ] **Bước 2:** `BatchTeachLimitsDialog`: nhận `rows`, form MỘT bộ giá trị áp cho tất cả (chỉ field người dùng nhập mới gửi), gọi `trpc.measurementPoint.setLimitsBatch`; hiện cảnh báo số điểm sẽ đổi + `changeReason` bắt buộc ≥ 5 ký tự.
- [ ] **Bước 3:** Unit test: submit gửi ĐÚNG field đã nhập (không gửi field rỗng — gửi `undefined` chứ không `""`); CONFLICT hiện thoại xung đột. i18n đủ 3 locale. Commit.

### Task 12: Readiness đếm hàng cây + nghiệm thu ảnh

**Files:**
- Modify: `server/services/productReadinessService.ts` (nguồn `agg` — đo nơi dựng `numericPoints`/`numericWithLimits`, mở rộng đếm hàng `captureRowId IS NOT NULL` với "có limit" theo `POINT_LIMIT_SPEC`) · Test: readiness test hiện có (đo tên file bằng glob `productReadiness*`).

- [ ] **Bước 1: Lưới ĐỎ:** sản phẩm chỉ có cây dạy 16 component 0 limit ⇒ hạng mục `limits` phải **missing/0%**, KHÔNG phải `na`/100%. Trên mã hiện tại (chỉ đếm điểm phẳng DIMENSION) ⇒ ĐỎ. Chép nguyên văn.
- [ ] **Bước 2: Cài + XANH.** Dạy 8/16 ⇒ fraction 0.5.
- [ ] **Bước 3: Ảnh tự xem.** Build + chạy port 3000, đúc vé (`sdk.createSessionToken` + `ghiSoPhien`, cookie `app_session_id`, script ở GỐC repo, `process.exit(0)`), Playwright chụp `/products` tab Cây dạy (có máy + bảng component + badge); **tự mở ảnh xem bằng Read**, mô tả thấy gì vào báo cáo. Commit.

### Task 14: Tách shell — `ProductListPanel` + `ProductDialogsHost` (cơ học, không đổi hành vi)

**Files:**
- Create: `client/src/components/products/ProductListPanel.tsx` (từ `ProductModels.tsx:2426-2677` — Card cột trái: search/Select lifecycle/Select sort/chip filter/`ImportExportBar`/`DataTable<ProductModel>`) · `client/src/components/products/ProductDialogsHost.tsx` (từ `:3312-3546` — 14 dialog)
- Modify: `client/src/pages/ProductModels.tsx` (thay hai vùng bằng hai component, truyền props state/handler hiện có)

- [ ] **Bước 1: Đo TRƯỚC.** `(Get-Content client/src/pages/ProductModels.tsx | Measure-Object -Line).Lines` — ghi số. Chụp ảnh `/products` làm baseline (cùng cách Task 12).
- [ ] **Bước 2: Rút `ProductListPanel`.** CHỈ di chuyển JSX + nhận props (typed interface liệt kê đúng state/handler nó dùng — đọc từ vùng dòng, không thêm logic mới). KHÔNG đổi khoá i18n, KHÔNG đổi hành vi.
- [ ] **Bước 3: Rút `ProductDialogsHost`.** Cùng nguyên tắc: props là các cặp `open/onOpenChange` + handler hiện có.
- [ ] **Bước 4: Đo SAU.** `ProductModels.tsx` giảm ≥ 500 dòng; `npm run check` sạch; `viStringCoverage` + `i18n:check` xanh (di chuyển không tạo chuỗi mới); chụp lại ảnh `/products` — so bằng mắt với baseline, mô tả khác biệt (kỳ vọng: không).
- [ ] **Bước 5: Commit.**

---

## PHA 4 — BG-98 (tùy lực): cổng máy-tự-mâu-thuẫn

### Task 13: Đếm `value` ngoài giới-hạn-máy-khai mà máy kết OK

**Files:**
- Create: `server/services/mayTuMauThuan.ts` · Test: `server/services/mayTuMauThuan.test.ts`
- Modify: `server/services/ingestCayKetQua.ts` (gọi tại `dichComponent:189-214`, TÁCH KHỎI `cong.cham`) · `submitInspectionTreeV2` response (thêm `mayTuMauThuan` cạnh `specGate:3677`)

- [ ] **Bước 1: Lưới ĐỎ (thuần):** `demTuMauThuan(component)` — component thô mang `lowerLimit:"1"`, `upperLimit:"10"`, `value:12`, `result:"OK"` ⇒ mâu thuẫn; `value:12,result:"NG"` ⇒ không; thiếu limit máy khai ⇒ không; value không parse được ⇒ không. Dùng `tachTriDo` cho value (một bản tách, như cổng).
- [ ] **Bước 2: Cài.** Bộ đếm `{tong, mauThuan, mau: string[]}` (trần 20 mẫu như `SO_MAU_TRUOT`). **KHÔNG đổi verdict, KHÔNG ghi remark** — tín hiệu chất-lượng-pipeline-máy, trả trong response + log warn khi `mauThuan > 0`. Chú thích đầu file: *"HAI cổng, HAI nguồn: cổng bản-dạy chấm bằng giới hạn KỸ SƯ; cổng này chỉ so máy với CHÍNH máy — cấm gộp (spec QĐ-8)."*
- [ ] **Bước 3:** XANH + commit.

---

## Cổng ra

- [x] Lưới bất biến BG-96 xanh và ĐÃ TỪNG ĐỎ trên mã cũ (nguyên văn trong báo cáo); census fake-UTC xanh + đột biến đỏ. — Task 1-3 `aedd3096`→`2f37e9d2`; BG-99 siết bất biến `dff2e531`; census theo-dòng ghi nợ BG-100.
- [x] Kịch bản WAL "siết limit rồi phát lại" chấm theo limit CŨ, remark chứng minh; cờ tắt ⇒ hành vi cũ; v1 không đổi. — BG-97 `c98781db` + neo mốc-nhận-server `dff2e531`; review đo neo tất định (`ProcessFn` 1 điểm gọi, luôn `enqueuedAt`); WAL hỏng đĩa → BG-101.
- [x] Dạy giới hạn qua UI thật (hoặc caller tRPC) → đẩy lại mẫu kết quả thật ⇒ `specGate.dat + truot > 0` lần đầu trên đường v2 (trước đó `khongGioiHan` 100%) — dán số trước/sau kèm `current_database()`. — `343f8af9` `congRaKhoiC.db.test.ts`, `aoi_management_test`: TRƯỚC dat 0/truot 0/chuaDay 32/khongGioiHan 16 → SAU dạy 3: dat **2**/truot **1**/chuaDay 32/khongGioiHan 13; `mayTuMauThuan` {48,0} không đổi; versions 0→3; đột biến bỏ dạy ⇒ `expected 0 to be greater than 0`. BG-112: 32/48 lệch fixture. ✅ **Điều kiện đã gỡ (vòng sửa 9 vòng 2, `f7123e05`):** mệnh đề 3 nay đo **CẢ HAI** trạng thái cờ, mỗi nhánh `toEqual` **10 khoá** `specGate` + bất biến cộng-tổng + guard `lucDoTruocSiet`. Số đo, cùng bo cũ phát lại sau khi siết giới hạn: cờ **TẮT** ⇒ `{dat 1, truot 2, haCap 1}` remark **NG** (hạ oan một bo TỐT) · cờ **BẬT** ⇒ `{dat 2, truot 1, haCap 0}` remark OK. Hai đột biến (`haCap` 1→0, `chuaDay` 32→33) đều đỏ. Re-review vòng 2 chạy lại độc lập, khớp khít.
- [x] Sửa 3D trên sản phẩm live đi qua hàng đợi duyệt (lưới Task 8 bước 1). — `fc232773`: 4/4 điểm gọi có gate + version (review grep 14 `.update(measurementPointDefs)`, 0 lách). ⚠ "đi qua hàng đợi" = bị CHẶN (FORBIDDEN), không tự ghi hàng đợi — BG-111.
- [x] `npm run check` = 0 · `npm run check:tests` = 0 · `i18n:check` xanh · `viStringCoverage` xanh · các census hiện hành xanh. — Đo 2026-09-04 lúc không ai ghi: `check` 0 · `check:tests` **1** (`bangTerminal.unit.test.ts:73`, có sẵn `2cb1f771` phiên AI-coding, KHÔNG Khối C) · `i18n:check` 0 mới · `viStringCoverage` 8/8 · census §3 xanh sau BG-107 ×3 di trú. `rcaActionSuggester.test.ts` lỗi nạp = mock `aiLocalTools/toolRegistry`, Khối C không chạm.
- [x] Ảnh tab Cây dạy đã TỰ MỞ XEM. — Task 12 `b387507f`, 4 ảnh POST-FIX trong `.superpowers/sdd/.../anh/`; **coordinator tự Read cả 4** (2026-09-04): tab thứ 6 active, badge v1, cây 16, readiness 10/16 = tiến độ 6/16 (hai màn khớp), 5 cột đúng, nhãn BG-105, dialog đơn canvas 1 ô highlight (nền đen → BG-116), dialog batch giải thích + form trống + "bỏ trống = giữ nguyên". Lệch: 2 demo thay vì 1 như khai.
- [x] Cập nhật backlog toàn cảnh: đánh dấu BG-96/97/98 + Đ-19-phần-giới-hạn; ghi nợ mới nếu phát sinh. — `f86a323e` (BG-95..106, 4 đóng) · `8d7e9c6e`/`a7f8664a`/`581a3849` (BG-107/110) · `df10a8c7` (108/109) · `ef997a87` (111) · `c2fe2c78` (112) · `71346e52` (113) · `f434d8dd` (114) · `3ab189cd` (115) · `e4e61326` (Đ-19 + BG-92 ĐÓNG, §5 sửa).
