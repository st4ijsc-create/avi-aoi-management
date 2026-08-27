# AOI Khối A — Pha 0: vá nợ CÓ SẴN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vá toàn bộ nợ đã đo được trên đường kết quả inspection — mâu thuẫn công thức NTF ở ~15 nơi, đường ingest thứ hai đi vòng qua mọi hàng rào, và hai màn hình vẽ dữ liệu bịa — TRƯỚC khi thêm cây 4 cấp, để mọi lệch số sau này không bị quy oan cho đợt nâng cấp.

**Architecture:** Không thêm bảng, không đổi schema. Ba nhóm thay đổi độc lập: (1) mọi nơi tính yield chuyển sang dùng chung helper `server/utils/kpi.ts` thay vì công thức viết tay; (2) `aoiPackage.commit` thôi tự `INSERT` và đi qua `createProductInspection` như mọi đường khác; (3) hai component UI thôi vẽ dữ liệu bịa khi không có dữ liệu thật. Bao quanh cả ba là một **script đo baseline** chạy trước và sau, để "đã sửa đúng" là con số chứ không phải lời khai.

**Tech Stack:** TypeScript, Node, Drizzle ORM, PostgreSQL + TimescaleDB, tRPC, Express, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-aoi-5-cap-xuong-song-design.md` (đặc biệt §4.2b, §12.2, §12.3, §12.4, §12.5, §10 Pha 0)

## Global Constraints

- **Nguồn sự thật duy nhất cho yield:** `server/utils/kpi.ts`. `finalYield({ok, ntf, total})` = `((ok+ntf)/total)*100`, `finalYieldPassCondSql(col)` = `col IN ('OK','NTF')`, `FINAL_YIELD_PASS_RESULTS = ["OK","NTF"]`, `fpyFromFirstInspections({firstPass, firstTotal})`. **Cấm viết lại công thức yield bằng tay ở bất kỳ file nào.**
- **Quy ước nghiệp vụ:** NTF = PASS trong final yield (decision #4). NTF **không** phải first-pass trong FPY.
- **Không đổi schema trong Pha 0.** Không `CREATE TABLE`, không `ALTER TABLE`. Pha 0 chỉ sửa mã.
- **Không xoá dữ liệu sản xuất.** Thao tác dọn DB dev (Task 14) là một lần, chạy tay, ngoài migration. Migration không bao giờ được chứa lệnh xoá dữ liệu lịch sử.
- **Chạy test:** `npx vitest run <đường/dẫn/file.test.ts>`. Toàn bộ: `npm test`. Kiểm kiểu: `npm run check` và `npm run check:tests`.
- **Glob vitest** (`vitest.config.ts:31-37`): `server/**/*.test.ts`, `server/**/*.spec.ts`, `shared/**/*.test.ts`, `client/src/**/*.unit.test.ts`, `scripts/**/*.test.ts`. **File test đặt ngoài bốn glob này sẽ KHÔNG BAO GIỜ CHẠY và lưới sẽ xanh giả.** Test cho code trong `client/src` phải đặt tên `*.unit.test.ts`.
- **DB test:** `vitest.setup.ts` ép `DATABASE_URL` sang DB test cách ly. Cấp phát một lần bằng `node scripts/setup-test-db.mjs`.
- **DDL trên DB test phải chạy bằng owner `aoi`**, không phải `avi_app` — `avi_app` trả `42501` và cổng vẫn xanh, dễ đọc nhầm thành "đã bắt được".
- **Mỗi task kết thúc bằng một commit.** Không gộp nhiều task vào một commit — pha này cố ý tách bạch để khi số đổi thì truy được nguyên nhân.
- **Nhánh hiện tại:** `feat/hmi-dep`. Không commit lên `main`.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `scripts/measure-yield-baseline.mjs` | **TẠO** — đo yield qua mọi đường, chỉ đọc, chạy được nhiều lần, xuất JSON so sánh được | 1 |
| `server/functions/cachedStatistics.ts` | **SỬA** — tách phép tính ra hàm thuần, dùng `finalYield` | 2 |
| `server/functions/cachedStatistics.unit.test.ts` | **TẠO** — lưới cho hàm thuần vừa tách | 2 |
| `server/services/scheduledReportService.ts` | **SỬA** — dòng TỔNG dùng cùng công thức với dòng chi tiết | 3 |
| `server/services/scheduledReportService.tongCong.test.ts` | **TẠO** — chốt bất biến "tổng = cộng các dòng" | 3 |
| `server/routers/stationAnalysisRouter.ts` | **SỬA** — 2 truy vấn SELECT thêm cột ntf, dùng `finalYieldPassCondSql` | 4 |
| `server/routers/stationAnalysis.yield.test.ts` | **TẠO** | 4 |
| `server/routers/alertRouters.ts` | **SỬA** — ngưỡng cảnh báo tính trên công thức chuẩn | 5 |
| `server/routers/alertRouters.yield.test.ts` | **TẠO** | 5 |
| 9 file còn lại (§12.2) | **SỬA** — chuyển sang helper | 6 |
| `server/utils/kpiCongThucCensus.test.ts` | **TẠO** — cổng điều tra dân số: cấm công thức yield viết tay tái xuất hiện | 6 |
| `server/services/liveStatsRollupService.ts` | **SỬA** — một định nghĩa NTF duy nhất | 7 |
| `server/db/mvYieldParity.db.test.ts` | **TẠO** — so MV ↔ truy vấn sống trên cùng dữ liệu | 8 |
| `server/routers/aoiPackageRouter.ts` | **SỬA** — commit đi qua `createProductInspection` + `authenticateMachine` | 9, 10 |
| `server/routers/aoiPackageIngestHopNhat.test.ts` | **TẠO** | 9 |
| `server/routers/aoiPackageXacThuc.test.ts` | **TẠO** | 10 |
| `client/src/pages/ProductionDashboard.tsx` | **SỬA** — bỏ `PcbThumbnail` khỏi nhánh thiếu ảnh | 11 |
| `client/src/components/AnhChuaCo.tsx` | **TẠO** — ô trống tự khai, dùng lại được | 11 |
| `client/src/pages/History.tsx` | **SỬA** — gỡ heatmap bịa theo giờ | 12 |
| `shared/productColumnSpec.ts` | **TẠO** — một nguồn sự thật cho spec cột sản phẩm | 13 |
| `server/routers/productRouters.ts` | **SỬA** — dùng spec dùng chung | 13 |
| `client/src/pages/ProductModels.tsx` | **SỬA** — dùng spec dùng chung | 13 |
| `shared/productColumnSpec.test.ts` | **TẠO** — cổng canh hai bên không lệch | 13 |
| `scripts/don-db-dev.mjs` | **TẠO** — đếm-rồi-xoá, có ngưỡng chặn | 14 |

---

### Task 1: Dụng cụ đo baseline — làm TRƯỚC mọi thay đổi

Không có task này thì "đo trước/sau" là lời khai. Script chạy **trước** khi sửa gì (ghi `before.json`) và chạy lại sau Task 7 (ghi `after.json`).

⚠ **Chạy trên DB dev còn nguyên 22.996 bo.** Task 14 (dọn DB) cố ý xếp CUỐI vì xoá dữ liệu trước là mất luôn corpus để đo.

**Files:**
- Create: `scripts/measure-yield-baseline.mjs`

**Interfaces:**
- Produces: file JSON `{ generatedAt, source, metrics: { <tên đường đo>: { total, ok, ng, ntf, yieldRate } } }` — Task 6 và Task 8 đọc lại để so.

- [ ] **Step 1: Viết script đo (chỉ đọc, không ghi gì)**

```javascript
// scripts/measure-yield-baseline.mjs
// CHỈ ĐỌC. Không có INSERT/UPDATE/DELETE/DDL.
// Chạy: node scripts/measure-yield-baseline.mjs docs/superpowers/plans/baseline-before.json
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { ssl: 'prefer', max: 1 });
const metrics = {};

// Đếm thô — mẫu số chung cho mọi công thức bên dưới
const [tho] = await sql`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE "overallResult" = 'OK')::int  AS ok,
         count(*) FILTER (WHERE "overallResult" = 'NG')::int  AS ng,
         count(*) FILTER (WHERE "overallResult" = 'NTF')::int AS ntf
  FROM product_inspections`;

// Công thức CHUẨN — (OK+NTF)/total
metrics.chuan_finalYield = {
  ...tho,
  yieldRate: tho.total ? +(((tho.ok + tho.ntf) / tho.total) * 100).toFixed(4) : 0,
};

// Công thức SAI đang tồn tại ở ~15 nơi — OK/total
metrics.sai_okTrenTotal = {
  ...tho,
  yieldRate: tho.total ? +((tho.ok / tho.total) * 100).toFixed(4) : 0,
};

// Chênh lệch tuyệt đối — đây là con số Pha 0 phải làm biến mất
metrics.chenhLech = {
  diemPhanTram: +(metrics.chuan_finalYield.yieldRate - metrics.sai_okTrenTotal.yieldRate).toFixed(4),
  soBoBiTinhNhamThanhHONG: tho.ntf,
};

// Theo máy — để thấy máy nào lệch nhiều nhất
metrics.theoMay = await sql`
  SELECT "machineId",
         count(*)::int AS total,
         count(*) FILTER (WHERE "overallResult" = 'NTF')::int AS ntf,
         round((count(*) FILTER (WHERE "overallResult" IN ('OK','NTF')) * 100.0)
               / NULLIF(count(*), 0), 4) AS yield_chuan,
         round((count(*) FILTER (WHERE "overallResult" = 'OK') * 100.0)
               / NULLIF(count(*), 0), 4) AS yield_sai
  FROM product_inspections GROUP BY 1 ORDER BY 1`;

// MV: so số của materialized view với truy vấn sống trên cùng cửa sổ
metrics.mvHourlyYieldCache = await sql`
  SELECT count(*)::int AS so_dong,
         round(avg("yieldRate")::numeric, 4) AS yield_tb
  FROM hourly_yield_cache`.catch((e) => ({ ERROR: e.message }));

const ketQua = JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: (process.env.DATABASE_URL || '').replace(/:[^:@]*@/, ':***@'),
  metrics,
}, null, 2);

// Script TỰ ghi file, KHÔNG dựa vào `>` của shell.
// Lý do: PowerShell (shell chính của môi trường này) ghi `>` kèm BOM UTF-8, và
// BOM làm `JSON.parse(readFileSync(...))` ném lỗi. `require()` thì nuốt được BOM,
// nên lỗi ẩn mình cho tới khi ai đó đọc bằng cách tự nhiên hơn. writeFileSync cho
// ra byte giống nhau trên mọi shell.
const duongDanRa = process.argv[2];
if (duongDanRa) {
  writeFileSync(duongDanRa, ketQua, { encoding: 'utf8' });
  console.error(`đã ghi ${duongDanRa}`);
} else {
  console.log(ketQua);
}

await sql.end();
```

Thêm vào phần import đầu file:

```javascript
import { writeFileSync } from 'node:fs';
```

- [ ] **Step 2: Chạy và ghi baseline TRƯỚC khi sửa**

Run: `node scripts/measure-yield-baseline.mjs docs/superpowers/plans/baseline-before.json`
Expected: `metrics.chenhLech.soBoBiTinhNhamThanhHONG` phải bằng **244** (khớp §3.7). Nếu khác 244, DỪNG và báo — nghĩa là đang trỏ nhầm DB.

Rồi kiểm chứng file đọc lại được bằng cách **tự nhiên nhất**, không chỉ bằng `require()`:

Run: `node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync('docs/superpowers/plans/baseline-before.json','utf8'));console.log('đọc OK:',o.metrics.chenhLech.soBoBiTinhNhamThanhHONG)"`
Expected: in `đọc OK: 244`. Nếu ném `Unexpected token '﻿'` thì file dính BOM — **sửa cách GHI, đừng sửa cách ĐỌC**.

- [ ] **Step 3: Kiểm chứng script thật sự chỉ đọc**

Run: `grep -niE "\b(INSERT +INTO|UPDATE +[a-z_\"]+ +SET|DELETE +FROM|DROP +(TABLE|VIEW|INDEX)|ALTER +TABLE|TRUNCATE)\b" scripts/measure-yield-baseline.mjs`
Expected: **không có kết quả nào**. Nếu có, sửa cho tới khi sạch.

⚠ Bắt theo **cú pháp SQL**, không bắt theo TỪ. Phiên bản đầu của bước này dùng `grep -nEi "insert|update|delete|..."` và nó tố chính dòng chú thích *"CHỈ ĐỌC. Không có INSERT/UPDATE/DELETE/DDL"* ở đầu file — thước đo bắt đúng câu khai báo rằng không có gì để bắt. Bất kỳ cổng nào đếm theo từ khoá trần đều mang lỗi này.

- [ ] **Step 4: Commit**

```bash
git add scripts/measure-yield-baseline.mjs docs/superpowers/plans/baseline-before.json
git commit -m "chore(kpi): dụng cụ đo yield baseline trước khi vá nợ NTF"
```

---

### Task 2: `cachedStatistics` — công thức sai nằm trong tầng cache, 0 test

Nghiêm trọng nhất trong 15 chỗ: nó phục vụ thẳng dashboard máy, cache TTL 5 phút, và **cùng file dòng 511 lại tính đúng**.

**Files:**
- Modify: `server/functions/cachedStatistics.ts:210-238` (và `:511` để đối chiếu, không sửa)
- Create: `server/functions/cachedStatistics.unit.test.ts`

**Interfaces:**
- Produces: `export function tinhThongKeMay(inspections: Array<{ overallResult: string; inspectionTime: Date | string }>): { total: number; okCount: number; ngCount: number; ntfCount: number; yieldRate: string; trend: Array<{ date: string; total: number; ok: number; ng: number; ntf: number; yieldRate: string }> }` — hàm THUẦN, không chạm DB/cache. Task 6 census sẽ kiểm nó dùng `finalYield`.

- [ ] **Step 1: Viết test đỏ**

```typescript
// server/functions/cachedStatistics.unit.test.ts
import { describe, it, expect } from "vitest";
import { tinhThongKeMay } from "./cachedStatistics";

const bo = (overallResult: string, ngay: string) => ({
  overallResult,
  inspectionTime: new Date(`${ngay}T08:00:00Z`),
});

describe("tinhThongKeMay — NTF phải tính là PASS (decision #4)", () => {
  it("NTF vào vế pass: 8 OK + 2 NTF trên 10 bo ⇒ yield 100.00", () => {
    const r = tinhThongKeMay([
      ...Array.from({ length: 8 }, () => bo("OK", "2026-08-01")),
      ...Array.from({ length: 2 }, () => bo("NTF", "2026-08-01")),
    ]);
    expect(r.total).toBe(10);
    expect(r.ntfCount).toBe(2);
    expect(r.yieldRate).toBe("100.00");
  });

  it("ca giết đột biến mạnh nhất: TOÀN BỘ là NTF ⇒ yield 100.00, không phải 0.00", () => {
    const r = tinhThongKeMay(Array.from({ length: 5 }, () => bo("NTF", "2026-08-01")));
    expect(r.yieldRate).toBe("100.00");
  });

  it("NG vẫn là fail: 6 OK + 1 NTF + 3 NG ⇒ yield 70.00", () => {
    const r = tinhThongKeMay([
      ...Array.from({ length: 6 }, () => bo("OK", "2026-08-01")),
      bo("NTF", "2026-08-01"),
      ...Array.from({ length: 3 }, () => bo("NG", "2026-08-01")),
    ]);
    expect(r.yieldRate).toBe("70.00");
  });

  it("trend theo ngày dùng CÙNG công thức với tổng", () => {
    const r = tinhThongKeMay([
      bo("OK", "2026-08-01"), bo("NTF", "2026-08-01"),
      bo("NG", "2026-08-02"), bo("OK", "2026-08-02"),
    ]);
    expect(r.trend).toHaveLength(2);
    expect(r.trend[0]).toMatchObject({ date: "2026-08-01", yieldRate: "100.00" });
    expect(r.trend[1]).toMatchObject({ date: "2026-08-02", yieldRate: "50.00" });
  });

  it("tập rỗng ⇒ 0.00, không chia cho 0", () => {
    expect(tinhThongKeMay([]).yieldRate).toBe("0.00");
  });
});
```

- [ ] **Step 2: Chạy để xác nhận nó ĐỎ**

Run: `npx vitest run server/functions/cachedStatistics.unit.test.ts`
Expected: FAIL — `tinhThongKeMay is not a function` (chưa export).

- [ ] **Step 3: Tách hàm thuần và dùng `finalYield`**

Thêm vào `server/functions/cachedStatistics.ts` (đặt ngay trên `getCachedMachineStats`):

```typescript
import { finalYield } from "../utils/kpi";

/**
 * Phép tính thống kê máy, tách THUẦN khỏi cache/DB để đo được.
 * NTF = PASS (decision #4) — dùng finalYield, KHÔNG viết lại công thức.
 */
export function tinhThongKeMay(
  inspections: Array<{ overallResult: string; inspectionTime: Date | string }>,
) {
  const total = inspections.length;
  const okCount = inspections.filter((i) => i.overallResult === "OK").length;
  const ngCount = inspections.filter((i) => i.overallResult === "NG").length;
  const ntfCount = inspections.filter((i) => i.overallResult === "NTF").length;
  const yieldRate = finalYield({ ok: okCount, ntf: ntfCount, total }).toFixed(2);

  const byDate = inspections.reduce((acc, insp) => {
    const date = new Date(insp.inspectionTime).toISOString().split("T")[0];
    if (!acc[date]) acc[date] = { total: 0, ok: 0, ng: 0, ntf: 0 };
    acc[date].total++;
    if (insp.overallResult === "OK") acc[date].ok++;
    if (insp.overallResult === "NG") acc[date].ng++;
    if (insp.overallResult === "NTF") acc[date].ntf++;
    return acc;
  }, {} as Record<string, { total: number; ok: number; ng: number; ntf: number }>);

  const trend = Object.entries(byDate)
    .map(([date, s]) => ({
      date,
      total: s.total,
      ok: s.ok,
      ng: s.ng,
      ntf: s.ntf,
      yieldRate: finalYield({ ok: s.ok, ntf: s.ntf, total: s.total }).toFixed(2),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { total, okCount, ngCount, ntfCount, yieldRate, trend };
}
```

Rồi thay thân `getCachedMachineStats` (dòng 209-238 cũ) bằng:

```typescript
      const inspections = result.data;
      const { total, okCount, ngCount, ntfCount, yieldRate, trend } = tinhThongKeMay(inspections);
```

- [ ] **Step 4: Chạy lại — phải XANH**

Run: `npx vitest run server/functions/cachedStatistics.unit.test.ts`
Expected: PASS, 5/5 ca.

- [ ] **Step 5: Đột biến — chứng minh lưới ĐỎ được**

Sửa tạm `finalYield({ ok: okCount, ntf: ntfCount, total })` thành `finalYield({ ok: okCount, ntf: 0, total })`.
Run: `npx vitest run server/functions/cachedStatistics.unit.test.ts`
Expected: **FAIL ít nhất 3 ca**. Nếu XANH thì lưới vô dụng — dừng và sửa lưới.
Hoàn tác đột biến, chạy lại, xác nhận PASS.

- [ ] **Step 6: Kiểm kiểu + commit**

```bash
npm run check && npm run check:tests
git add server/functions/cachedStatistics.ts server/functions/cachedStatistics.unit.test.ts
git commit -m "fix(kpi): cachedStatistics tính NTF là PASS — tách hàm thuần, dùng finalYield"
```

---

### Task 3: `scheduledReportService` — các dòng không cộng lại bằng dòng tổng

Sai **trong một hàm**: dòng corporate dùng `(ok+ntf)/total` (`:388`), dòng TỔNG dùng `ok/total` (`:398`).

**Files:**
- Modify: `server/services/scheduledReportService.ts:387-399`
- Create: `server/services/scheduledReportService.tongCong.test.ts`

**Interfaces:**
- Consumes: `finalYield` từ `server/utils/kpi.ts`
- Produces: `export function tinhDongTong(rows: Array<{ total: number; ok: number; ntf: number }>): { total: number; ok: number; ntf: number; yieldRate: number }`

- [ ] **Step 1: Viết test đỏ — chốt BẤT BIẾN, không chốt con số cụ thể**

```typescript
// server/services/scheduledReportService.tongCong.test.ts
import { describe, it, expect } from "vitest";
import { tinhDongTong } from "./scheduledReportService";
import { finalYield } from "../utils/kpi";

describe("tinhDongTong — dòng TỔNG phải cùng công thức với các dòng chi tiết", () => {
  const rows = [
    { total: 100, ok: 90, ntf: 5 },
    { total: 200, ok: 150, ntf: 40 },
    { total: 50, ok: 10, ntf: 0 },
  ];

  it("tổng số cộng đúng", () => {
    const t = tinhDongTong(rows);
    expect(t.total).toBe(350);
    expect(t.ok).toBe(250);
    expect(t.ntf).toBe(45);
  });

  it("BẤT BIẾN: yield của dòng tổng == finalYield trên tổng đã cộng", () => {
    const t = tinhDongTong(rows);
    expect(t.yieldRate).toBeCloseTo(finalYield({ ok: 250, ntf: 45, total: 350 }), 6);
  });

  it("BẤT BIẾN: khi mọi dòng chi tiết cùng yield thì dòng tổng cũng bằng đúng yield đó", () => {
    const dong = [
      { total: 100, ok: 80, ntf: 10 },
      { total: 200, ok: 160, ntf: 20 },
    ];
    const t = tinhDongTong(dong);
    expect(t.yieldRate).toBeCloseTo(90, 6);
  });

  it("NTF không bị rơi khỏi dòng tổng: 0 OK + 30 NTF trên 30 ⇒ 100", () => {
    expect(tinhDongTong([{ total: 30, ok: 0, ntf: 30 }]).yieldRate).toBeCloseTo(100, 6);
  });

  it("không có dòng nào ⇒ 0, không NaN", () => {
    const t = tinhDongTong([]);
    expect(t.yieldRate).toBe(0);
    expect(Number.isNaN(t.yieldRate)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận ĐỎ**

Run: `npx vitest run server/services/scheduledReportService.tongCong.test.ts`
Expected: FAIL — `tinhDongTong is not a function`.

- [ ] **Step 3: Viết hàm và thay chỗ dùng**

Thêm vào `server/services/scheduledReportService.ts`:

```typescript
import { finalYield } from "../utils/kpi";

/** Dòng TỔNG của báo cáo — CÙNG công thức với các dòng chi tiết (decision #4). */
export function tinhDongTong(rows: Array<{ total: number; ok: number; ntf: number }>) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const ok = rows.reduce((s, r) => s + r.ok, 0);
  const ntf = rows.reduce((s, r) => s + r.ntf, 0);
  return { total, ok, ntf, yieldRate: finalYield({ ok, ntf, total }) };
}
```

Thay đoạn tính dòng tổng ở `:397-399` bằng lời gọi `tinhDongTong(...)` trên chính mảng dòng chi tiết đã dựng ở `:387-395`.

- [ ] **Step 4: Chạy lại — XANH**

Run: `npx vitest run server/services/scheduledReportService.tongCong.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Đột biến**

Đổi `finalYield({ ok, ntf, total })` thành `finalYield({ ok, ntf: 0, total })`.
Expected: FAIL ≥ 3 ca. Hoàn tác, xác nhận PASS lại.

- [ ] **Step 6: Commit**

```bash
npm run check && npm run check:tests
git add server/services/scheduledReportService.ts server/services/scheduledReportService.tongCong.test.ts
git commit -m "fix(kpi): dòng TỔNG báo cáo định kỳ cộng đúng bằng các dòng chi tiết"
```

---

### Task 4: `stationAnalysisRouter` — yield sai làm lệch cả biểu đồ kiểm soát

`:583` (`getYieldControlChart`) nguy hiểm gấp đôi: chuỗi số này là đầu vào tính mean/UCL/LCL/Cpk (`:588-600`). Hai truy vấn **không SELECT cột ntf** (`:210-213`, `:566-569`) nên phải sửa cả truy vấn.

**Files:**
- Modify: `server/routers/stationAnalysisRouter.ts:210-227` và `:566-583`
- Create: `server/routers/stationAnalysis.yield.test.ts`

**Interfaces:**
- Produces: `export function tinhYieldTheoBucket(rows: Array<{ bucket: string; total: number; ok: number; ntf: number }>): Array<{ bucket: string; total: number; yieldRate: number }>`

- [ ] **Step 1: Viết test đỏ**

```typescript
// server/routers/stationAnalysis.yield.test.ts
import { describe, it, expect } from "vitest";
import { tinhYieldTheoBucket } from "./stationAnalysisRouter";

describe("tinhYieldTheoBucket — đầu vào của biểu đồ kiểm soát", () => {
  it("NTF là PASS: bucket 10 bo, 7 OK + 3 NTF ⇒ 100", () => {
    const r = tinhYieldTheoBucket([{ bucket: "2026-08-01T08", total: 10, ok: 7, ntf: 3 }]);
    expect(r[0].yieldRate).toBeCloseTo(100, 6);
  });

  it("giữ nguyên thứ tự bucket — chuỗi thời gian không được xáo", () => {
    const r = tinhYieldTheoBucket([
      { bucket: "2026-08-01T08", total: 10, ok: 9, ntf: 0 },
      { bucket: "2026-08-01T09", total: 10, ok: 5, ntf: 5 },
      { bucket: "2026-08-01T10", total: 10, ok: 4, ntf: 0 },
    ]);
    expect(r.map((x) => x.bucket)).toEqual(["2026-08-01T08", "2026-08-01T09", "2026-08-01T10"]);
    expect(r.map((x) => Math.round(x.yieldRate))).toEqual([90, 100, 40]);
  });

  it("bucket rỗng ⇒ 0, không NaN (NaN sẽ phá mean/UCL/LCL)", () => {
    const r = tinhYieldTheoBucket([{ bucket: "x", total: 0, ok: 0, ntf: 0 }]);
    expect(r[0].yieldRate).toBe(0);
    expect(Number.isNaN(r[0].yieldRate)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy — ĐỎ**

Run: `npx vitest run server/routers/stationAnalysis.yield.test.ts`
Expected: FAIL — `tinhYieldTheoBucket is not a function`.

- [ ] **Step 3: Thêm hàm, sửa hai truy vấn**

Thêm vào `server/routers/stationAnalysisRouter.ts`:

```typescript
import { finalYield } from "../utils/kpi";

/** Chuỗi yield theo bucket — đầu vào của biểu đồ kiểm soát. NTF = PASS. */
export function tinhYieldTheoBucket(
  rows: Array<{ bucket: string; total: number; ok: number; ntf: number }>,
) {
  return rows.map((r) => ({
    bucket: r.bucket,
    total: r.total,
    yieldRate: finalYield({ ok: r.ok, ntf: r.ntf, total: r.total }),
  }));
}
```

Trong cả hai truy vấn (`:210-213` và `:566-569`), thêm cột đếm NTF vào `SELECT`:

```typescript
ntf: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NTF')`,
```

rồi thay chỗ tính `ok/total` (`:227` và `:583`) bằng `tinhYieldTheoBucket(rows)`.

- [ ] **Step 4: Chạy lại — XANH**

Run: `npx vitest run server/routers/stationAnalysis.yield.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Đột biến**

Bỏ `ntf: r.ntf` → `ntf: 0`. Expected: FAIL ≥ 2 ca. Hoàn tác.

- [ ] **Step 6: Commit**

```bash
npm run check && npm run check:tests
git add server/routers/stationAnalysisRouter.ts server/routers/stationAnalysis.yield.test.ts
git commit -m "fix(kpi): biểu đồ kiểm soát yield tính NTF là PASS (sửa cả truy vấn thiếu cột ntf)"
```

---

### Task 5: `alertRouters` — ngưỡng cảnh báo đánh giá trên công thức sai

**Files:**
- Modify: `server/routers/alertRouters.ts:71-80`
- Create: `server/routers/alertRouters.yield.test.ts`

**Interfaces:**
- Produces: `export function vuotNguongYield(stat: { total: number; ok: number; ntf: number }, nguong: number): { yieldRate: number; vuot: boolean }`

- [ ] **Step 1: Viết test đỏ**

```typescript
// server/routers/alertRouters.yield.test.ts
import { describe, it, expect } from "vitest";
import { vuotNguongYield } from "./alertRouters";

describe("vuotNguongYield — cảnh báo phải dùng công thức chuẩn", () => {
  it("KHÔNG báo động giả: 85 OK + 10 NTF / 100, ngưỡng 90 ⇒ yield 95, KHÔNG vượt", () => {
    const r = vuotNguongYield({ total: 100, ok: 85, ntf: 10 }, 90);
    expect(r.yieldRate).toBeCloseTo(95, 6);
    expect(r.vuot).toBe(false);
  });

  it("VẪN báo khi thật sự thấp: 70 OK + 5 NTF / 100, ngưỡng 90 ⇒ yield 75, VƯỢT", () => {
    const r = vuotNguongYield({ total: 100, ok: 70, ntf: 5 }, 90);
    expect(r.vuot).toBe(true);
  });

  it("biên: yield đúng bằng ngưỡng ⇒ KHÔNG vượt", () => {
    expect(vuotNguongYield({ total: 100, ok: 90, ntf: 0 }, 90).vuot).toBe(false);
  });

  it("không có bo nào ⇒ không bắn cảnh báo (tránh báo động lúc dừng máy)", () => {
    expect(vuotNguongYield({ total: 0, ok: 0, ntf: 0 }, 90).vuot).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy — ĐỎ**

Run: `npx vitest run server/routers/alertRouters.yield.test.ts`
Expected: FAIL — `vuotNguongYield is not a function`.

- [ ] **Step 3: Viết hàm và dùng nó ở `:75-76`**

```typescript
import { finalYield } from "../utils/kpi";

/** Đánh giá ngưỡng yield. NTF = PASS. total=0 ⇒ không bắn (máy dừng ≠ máy hỏng). */
export function vuotNguongYield(
  stat: { total: number; ok: number; ntf: number },
  nguong: number,
) {
  const yieldRate = finalYield({ ok: stat.ok, ntf: stat.ntf, total: stat.total });
  return { yieldRate, vuot: stat.total > 0 && yieldRate < nguong };
}
```

- [ ] **Step 4: XANH**

Run: `npx vitest run server/routers/alertRouters.yield.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Đột biến**

Bỏ điều kiện `stat.total > 0`. Expected: FAIL ca thứ 4. Hoàn tác.

- [ ] **Step 6: Commit**

```bash
npm run check && npm run check:tests
git add server/routers/alertRouters.ts server/routers/alertRouters.yield.test.ts
git commit -m "fix(kpi): ngưỡng cảnh báo yield dùng công thức chuẩn, không báo động giả vì NTF"
```

---

### Task 6: Chín chỗ còn lại + cổng điều tra dân số chặn tái phát

Vá xong 4 chỗ nặng, còn 9 chỗ. Quan trọng hơn: dựng **cổng điều tra dân số** để công thức viết tay không quay lại. Không có cổng này thì lần sau ai đó lại viết `ok/total` và không ai biết.

**Files:**
- Modify: `server/routers/annotationRouters.ts:197,244` · `server/routers/productionSessionRouter.ts:75` · `server/services/dataComparisonService.ts:241,266` · `server/services/aiReportGenerator.ts:558` · `server/services/pdfTemplateService.ts:452` · `server/routers/federationRouter.ts:241` · `server/services/federation/unsSubscriber.ts:134` · `server/services/mqttBulletinService.ts:270`
- Create: `server/utils/kpiCongThucCensus.test.ts`

**Interfaces:**
- Consumes: `finalYield` từ `server/utils/kpi.ts` ở cả 9 file.

- [ ] **Step 1: Viết cổng điều tra dân số (nó phải ĐỎ ngay, vì 9 chỗ chưa sửa)**

```typescript
// server/utils/kpiCongThucCensus.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Cổng điều tra dân số: cấm công thức yield VIẾT TAY tái xuất hiện.
 * Nguồn sự thật duy nhất là server/utils/kpi.ts.
 *
 * ⚠ Cổng này đếm theo HÌNH DẠNG mã, nên nó có thể dôi. Khi nó đỏ, ĐỌC ĐÚNG DÒNG
 * bị tố trước khi kết luận — dự án đã từng đỏ vì thước dôi chứ không vì có nợ.
 */
const MIEN_TRU = new Set([
  "server/utils/kpi.ts",            // chính là nguồn sự thật
  "server/utils/kpiCongThucCensus.test.ts",
  "server/utils/kpi.test.ts",
]);

// Hình dạng bị cấm: chia okCount/ok cho total rồi nhân 100
const HINH_DANG_CAM = /\(\s*\(?\s*(ok|okCount|okQuantity)\s*\/\s*(total|totalCount|totalQuantity)\s*\)?\s*\*\s*100/i;

/** Duyệt đệ quy, trả đường dẫn dùng dấu `/` để so khớp MIEN_TRU trên mọi HĐH. */
function quetFileTs(goc: string): string[] {
  const ra: string[] = [];
  for (const muc of readdirSync(goc, { withFileTypes: true })) {
    const duong = join(goc, muc.name).replace(/\\/g, "/");
    if (muc.isDirectory()) {
      if (muc.name === "node_modules" || muc.name === "dist") continue;
      ra.push(...quetFileTs(duong));
    } else if (muc.name.endsWith(".ts")) {
      ra.push(duong);
    }
  }
  return ra;
}

describe("điều tra dân số công thức yield", () => {
  it("KHÔNG file nào trong server/ viết lại công thức (ok/total)*100", () => {
    const viPham: string[] = [];
    for (const f of quetFileTs("server")) {
      if (MIEN_TRU.has(f)) continue;
      const noiDung = readFileSync(f, "utf8").split("\n");
      noiDung.forEach((dong, i) => {
        if (HINH_DANG_CAM.test(dong)) viPham.push(`${f}:${i + 1}  ${dong.trim()}`);
      });
    }
    expect(viPham, `Dùng finalYield() từ server/utils/kpi.ts:\n${viPham.join("\n")}`).toEqual([]);
  });

  it("cổng này thật sự quét được file — chống glob rỗng khai xanh giả", () => {
    const soFile = quetFileTs("server").length;
    expect(soFile).toBeGreaterThan(300);
  });
});
```

- [ ] **Step 2: Chạy — phải ĐỎ và liệt kê đúng 9 chỗ chưa sửa**

Run: `npx vitest run server/utils/kpiCongThucCensus.test.ts`
Expected: FAIL, thông báo liệt kê các dòng vi phạm.
**Đọc từng dòng bị tố và mở đúng file kiểm chứng trước khi sửa** — nếu thước dôi (tố nhầm chỗ không phải yield), sửa regex chứ đừng sửa mã.

- [ ] **Step 3: Sửa 9 chỗ, mỗi chỗ thay bằng `finalYield`**

Khuôn chung cho mọi chỗ — đảm bảo có sẵn biến đếm NTF; nếu truy vấn chưa SELECT nó thì thêm vào trước:

```typescript
import { finalYield } from "../utils/kpi";  // chỉnh độ sâu đường dẫn theo từng file

// TRƯỚC:  const yieldRate = total > 0 ? (ok / total) * 100 : 0;
// SAU:
const yieldRate = finalYield({ ok, ntf, total });
```

- [ ] **Step 4: Chạy lại cổng — XANH**

Run: `npx vitest run server/utils/kpiCongThucCensus.test.ts`
Expected: PASS, 2/2. Nếu còn vi phạm, sửa tiếp cho tới hết.

- [ ] **Step 5: Đột biến — chứng minh cổng bắt được kẻ tái phạm**

Thêm tạm vào một file bất kỳ trong `server/` (ví dụ cuối `server/routers/alertRouters.ts`):
```typescript
const thuNghiem = (ok / total) * 100;
```
Run: `npx vitest run server/utils/kpiCongThucCensus.test.ts`
Expected: **FAIL**, và thông báo chỉ đúng file:dòng vừa thêm. Nếu XANH thì cổng vô dụng. Xoá dòng thử, chạy lại, PASS.

- [ ] **Step 6: Chạy lại baseline và SO SỐ**

Run: `node scripts/measure-yield-baseline.mjs docs/superpowers/plans/baseline-after.json`
Run: `node -e "const a=require('./docs/superpowers/plans/baseline-before.json'),b=require('./docs/superpowers/plans/baseline-after.json');console.log('chênh trước:',a.metrics.chenhLech.diemPhanTram,'| chênh sau:',b.metrics.chenhLech.diemPhanTram)"`
Expected: baseline là phép đo DB nên hai số **giống nhau** — nó đo dữ liệu, không đo mã. Con số phải báo cáo là: **244 bo trước đây bị ~15 đường tính nhầm thành hỏng, nay được tính đúng là đạt.**

- [ ] **Step 7: Commit**

```bash
npm run check && npm run check:tests
git add server/ docs/superpowers/plans/baseline-after.json
git commit -m "fix(kpi): vá 9 chỗ còn lại + cổng điều tra dân số cấm công thức yield viết tay"
```

---

### Task 7: Một định nghĩa NTF duy nhất

`liveStatsRollupService.ts:170` dùng `overallResult='NTF' HOẶC ntfConfirmedAt IS NOT NULL`; mọi nơi khác chỉ dùng `overallResult`. Hôm nay hai định nghĩa trùng nhau **chỉ vì** `ntfConfirmedAt` = 0/244 (§3.7 Đ-4) — may mắn, không phải thiết kế.

**Files:**
- Modify: `server/services/liveStatsRollupService.ts:165-175`
- Create: (không) — bổ sung ca vào `server/services/liveStatsRollupService.test.ts` đã có

**Interfaces:**
- Consumes: không đổi chữ ký công khai.

- [ ] **Step 1: Thêm ca test đỏ vào file test đã có**

```typescript
// thêm vào server/services/liveStatsRollupService.test.ts
it("BẤT BIẾN: NTF chỉ do overallResult quyết định — ntfConfirmedAt KHÔNG tự làm bo thành NTF", () => {
  const rows = [
    { overallResult: "NG", ntfConfirmedAt: new Date("2026-08-01") }, // người đánh dấu nhưng chưa đổi kết quả
    { overallResult: "NTF", ntfConfirmedAt: null },
    { overallResult: "OK", ntfConfirmedAt: null },
  ];
  const d = phanLoaiKetQua(rows);
  expect(d.ntf).toBe(1);   // chỉ hàng overallResult='NTF'
  expect(d.ng).toBe(1);    // hàng NG vẫn là NG
  expect(d.ok).toBe(1);
});
```

- [ ] **Step 2: Chạy — ĐỎ**

Run: `npx vitest run server/services/liveStatsRollupService.test.ts`
Expected: FAIL — `phanLoaiKetQua is not a function`, hoặc `d.ntf` bằng 2 thay vì 1.

- [ ] **Step 3: Tách hàm phân loại và bỏ nhánh `ntfConfirmedAt`**

```typescript
// server/services/liveStatsRollupService.ts
/**
 * Phân loại kết quả bo. MỘT định nghĩa NTF duy nhất: overallResult.
 *
 * Trước đây hàm này còn coi `ntfConfirmedAt IS NOT NULL` là NTF — định nghĩa
 * thứ hai, khác mọi nơi khác trong repo. Nó vô hại tới hôm nay chỉ vì đo được
 * ntfConfirmedAt = 0/244 (spec §3.7 Đ-4). Ngay khi có người dùng nút xác nhận
 * NTF, daily_statistics sẽ lệch với toàn hệ thống — và daily_statistics là
 * nguồn của alertRouters, productionSessionRouter, oeeService, aiSmartAlertRouter.
 * updateProductInspectionNTF (server/db/inspection.ts:575-581) đặt CẢ HAI cột,
 * nên bỏ nhánh này không mất thông tin nào.
 */
export function phanLoaiKetQua(
  rows: Array<{ overallResult: string | null }>,
): { ok: number; ng: number; ntf: number } {
  let ok = 0, ng = 0, ntf = 0;
  for (const r of rows) {
    if (r.overallResult === "NTF") ntf++;
    else if (r.overallResult === "NG") ng++;
    else if (r.overallResult === "OK") ok++;
  }
  return { ok, ng, ntf };
}
```

Thay đoạn `:165-175` bằng lời gọi `phanLoaiKetQua(rows)`.

- [ ] **Step 4: XANH — và các ca CŨ vẫn phải xanh**

Run: `npx vitest run server/services/liveStatsRollupService.test.ts`
Expected: PASS toàn bộ. **Nếu ca cũ ở `:29` (chứng minh `ntfConfirmedAt` đẩy NG→NTF) đỏ**, đó là ca chốt hành vi mà ta cố ý đổi — cập nhật nó và ghi lý do vào commit message, KHÔNG xoá lặng lẽ.

- [ ] **Step 5: Đột biến**

Thêm lại nhánh `|| r.ntfConfirmedAt != null` vào điều kiện NTF. Expected: FAIL ca mới. Hoàn tác.

- [ ] **Step 6: Commit**

```bash
npm run check && npm run check:tests
git add server/services/liveStatsRollupService.ts server/services/liveStatsRollupService.test.ts
git commit -m "fix(kpi): một định nghĩa NTF duy nhất — bỏ nhánh ntfConfirmedAt ở live stats"
```

---

### Task 8: Lưới cho thân SQL của MV — hôm nay không phép đo nào chạy qua

`0174:57-60` và `hourly_yield_cagg` chưa từng được đo. Test hiện có (`cachedStatistics.mv.test.ts`) **mock `execute`** nên không chạm SQL thật.

**Files:**
- Create: `server/db/mvYieldParity.db.test.ts`

**Interfaces:**
- Consumes: DB test thật (không mock). Cần `node scripts/setup-test-db.mjs` đã chạy.

- [ ] **Step 1: Viết test đỏ — so MV với truy vấn sống trên CÙNG dữ liệu**

```typescript
// server/db/mvYieldParity.db.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./connection";
import { sql } from "drizzle-orm";

const MAY_TEST = 999001;   // id máy chỉ dùng cho test này

describe("MV hourly_yield_cache phải khớp truy vấn sống", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");
    await db.execute(sql`DELETE FROM product_inspections WHERE "machineId" = ${MAY_TEST}`);
    // 6 OK + 3 NTF + 1 NG, cùng một giờ ⇒ yield chuẩn = 90
    await db.execute(sql`
      INSERT INTO product_inspections ("machineId","serialNumber","overallResult","originalResult","inspectionTime")
      SELECT ${MAY_TEST}, 'MVPAR-' || g, r, CASE WHEN r='NTF' THEN 'NG' ELSE r END,
             TIMESTAMP '2026-08-01 08:30:00'
      FROM (VALUES ('OK',1),('OK',2),('OK',3),('OK',4),('OK',5),('OK',6),
                   ('NTF',7),('NTF',8),('NTF',9),('NG',10)) AS t(r,g)`);
    await db.execute(sql`REFRESH MATERIALIZED VIEW hourly_yield_cache`);
  });

  afterAll(async () => {
    const db = await getDb();
    if (db) await db.execute(sql`DELETE FROM product_inspections WHERE "machineId" = ${MAY_TEST}`);
  });

  it("MV cho đúng 90 — NTF nằm ở vế PASS", async () => {
    const db = await getDb();
    const r: any = await db!.execute(sql`
      SELECT "yieldRate"::float AS y FROM hourly_yield_cache WHERE "machineId" = ${MAY_TEST}`);
    const rows = (r.rows ?? r) as Array<{ y: number }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].y).toBeCloseTo(90, 4);
  });

  it("MV == truy vấn sống trên cùng dữ liệu", async () => {
    const db = await getDb();
    const song: any = await db!.execute(sql`
      SELECT round((count(*) FILTER (WHERE "overallResult" IN ('OK','NTF')) * 100.0)
                   / NULLIF(count(*),0), 4)::float AS y
      FROM product_inspections WHERE "machineId" = ${MAY_TEST}`);
    const mv: any = await db!.execute(sql`
      SELECT "yieldRate"::float AS y FROM hourly_yield_cache WHERE "machineId" = ${MAY_TEST}`);
    const ySong = ((song.rows ?? song) as any[])[0].y;
    const yMv = ((mv.rows ?? mv) as any[])[0].y;
    expect(yMv).toBeCloseTo(ySong, 4);
  });
});
```

- [ ] **Step 2: Chuẩn bị DB test rồi chạy**

Run: `node scripts/setup-test-db.mjs`
Run: `npx vitest run server/db/mvYieldParity.db.test.ts`
Expected: PASS 2/2. **Nếu ĐỎ ở ca thứ nhất** thì thân SQL của MV đang tính sai — đó chính là thứ lưới này sinh ra để tìm; báo cáo con số thật trước khi sửa.

- [ ] **Step 3: Đột biến — chứng minh lưới ĐỎ được**

Sửa tạm mệnh đề trong test thành `IN ('OK')` ở ca thứ hai.
Expected: **FAIL** (90 vs 60). Hoàn tác.

- [ ] **Step 4: Commit**

```bash
git add server/db/mvYieldParity.db.test.ts
git commit -m "test(kpi): lưới so MV hourly_yield_cache với truy vấn sống trên cùng dữ liệu"
```

---

### Task 9: Hợp nhất đường ZIP vào `createProductInspection` — CHẶN

Đây là task quan trọng nhất Pha 0. `aoiPackageRouter.ts:724` tự `tx.insert(productInspections)`, bỏ qua idempotency, khoá tự nhiên 0272, và `recordMachineActivity`. Thuận lợi: `inspection_packages` = **0 dòng** (§3.7 Đ-3) nên không có dữ liệu nào bị phá.

**Files:**
- Modify: `server/routers/aoiPackageRouter.ts:690-730`
- Create: `server/routers/aoiPackageIngestHopNhat.test.ts`

**Interfaces:**
- Consumes: `createProductInspection(data: InsertProductInspection, outcome?: CreateInspectionOutcome)` từ `server/db/inspection.ts:143`. Khoá idempotency truyền qua **`data.idempotencyKey`** (`inspection.ts:150`), không phải tham số riêng. Hàm tự mở transaction, tự claim khoá trước rồi mới ghi header, và trả về `{ id, duplicate }` — `duplicate: true` nghĩa là lượt trước đã ghi rồi, **không phải lỗi**.

- [ ] **Step 1: Viết test đỏ**

```typescript
// server/routers/aoiPackageIngestHopNhat.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FILE = "server/routers/aoiPackageRouter.ts";

describe("đường ZIP phải đi qua createProductInspection, không tự INSERT", () => {
  const src = readFileSync(FILE, "utf8");

  it("KHÔNG còn insert(productInspections) trực tiếp trong router gói ảnh", () => {
    const viPham = src.split("\n")
      .map((d, i) => ({ d: d.trim(), n: i + 1 }))
      .filter(({ d }) => /\.insert\(\s*productInspections\s*\)/.test(d));
    expect(viPham, `còn INSERT thẳng tại:\n${viPham.map(v => `${FILE}:${v.n}`).join("\n")}`).toEqual([]);
  });

  it("CÓ gọi createProductInspection", () => {
    expect(src).toMatch(/createProductInspection\s*\(/);
  });

  it("CÓ truyền idempotencyKey — đường ZIP trước đây không có khái niệm này", () => {
    expect(src).toMatch(/idempotencyKey/);
  });

  it("cổng này đọc đúng file, không phải chuỗi rỗng", () => {
    expect(src.length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 3: Chạy — ĐỎ ở 3 ca đầu**

Run: `npx vitest run server/routers/aoiPackageIngestHopNhat.test.ts`
Expected: FAIL 3/4 (ca thứ 4 xanh).

- [ ] **Step 4: Thay INSERT thẳng bằng lời gọi hàm chuẩn**

```typescript
import { createProductInspection } from "../db/inspection";

// TRƯỚC (aoiPackageRouter.ts:724):
//   const [ins] = await tx.insert(productInspections).values({ ... }).returning();
//   linkedInspectionId = ins.id;
// SAU:
const { id, duplicate } = await createProductInspection({
  machineId: machine.id,
  serialNumber: metaData.serialNumber,
  productModel: metaData.productModel ?? null,
  overallResult: finalOverallResult,
  originalResult: finalOverallResult === "NTF" ? "NG" : finalOverallResult,
  inspectionTime: metaData.inspectionTime ? new Date(metaData.inspectionTime) : new Date(),
  factoryCode: metaData.factoryCode ?? null,
  lineCode: metaData.lineCode ?? null,
  // Khoá ổn định qua mọi lần retry của CÙNG một gói — packageId là unique
  // (drizzle/schema/inspection.ts:364). Đây chính là thứ đường ZIP chưa từng có.
  idempotencyKey: `aoi-pkg:${pkg.packageId}`,
});
linkedInspectionId = id;
createdInspection = !duplicate;
```

⚠ **`createProductInspection` tự mở transaction của nó.** Gọi nó **bên trong** `database.transaction` đang mở ở `:677` sẽ lồng transaction. Hai lối xử lý, chọn một và ghi lý do vào commit:
- **(a) khuyến nghị** — chuyển lời gọi này ra **trước** khối `database.transaction(...)`, lấy `linkedInspectionId` rồi mới vào transaction ghi `package_images` + `measurement_results`. Đúng khuôn `machineApiRouters` đang dùng.
- (b) nếu buộc phải giữ trong transaction, dùng biến thể nhận `tx` nếu `server/db/inspection.ts` có; **không tự chế bản sao thứ hai của logic claim khoá**.

Sau khi sửa, xác nhận **không còn** `productInspections` trong danh sách import của `aoiPackageRouter.ts` nếu không còn chỗ nào dùng.

- [ ] **Step 5: XANH**

Run: `npx vitest run server/routers/aoiPackageIngestHopNhat.test.ts`
Expected: PASS 4/4.

- [ ] **Step 6: Chạy các test gói ảnh có sẵn — không được vỡ**

Run: `npx vitest run server/test-aoi-package 2>/dev/null; npx vitest run --testNamePattern="aoi" server/`
Expected: không ca nào chuyển từ xanh sang đỏ. Nếu có, đọc và sửa.

- [ ] **Step 7: Commit**

```bash
npm run check && npm run check:tests
git add server/routers/aoiPackageRouter.ts server/routers/aoiPackageIngestHopNhat.test.ts
git commit -m "fix(ingest): đường ZIP thôi INSERT thẳng — đi qua createProductInspection, có idempotency"
```

---

### Task 10: Đường ZIP phải qua `authenticateMachine`

`aoiPackage.presign/commit` gọi thẳng `db.getMachineByCode()` ⇒ cờ `MACHINE_CODE_ONLY_ALLOWED=deny` mua được 0. Chỉ cần biết mã máy — thứ in trên nhãn dán — là ghi được inspection.

**Files:**
- Modify: `server/routers/aoiPackageRouter.ts:374, 491, 1479` và `server/_core/index.ts:4670-4684`
- Create: `server/routers/aoiPackageXacThuc.test.ts`

**Interfaces:**
- Consumes: `authenticateMachine({ apiKey, machineCode, headerKey, scope })` từ `server/services/machineAuthService.ts`, trả về object có `.machine`. Cờ chính sách: **`MACHINE_CODE_ONLY_ALLOWED`**, đọc qua `parseWeakAuthPolicy(...)` với mặc định **`"deny"`** (`machineAuthService.ts:167`; lý do ở `:154-158`). Scope dùng cho đường ghi: **`"ingest:write"`** — đúng scope `syncMeasurementPoints` đang dùng (`machineApiRouters.ts:3590`). `machineHeaderKey(ctx)` là helper đã có trong `machineApiRouters.ts`; nếu `aoiPackageRouter.ts` chưa import thì import từ đó hoặc chuyển helper sang chỗ dùng chung.

- [ ] **Step 1: Viết test đỏ**

```typescript
// server/routers/aoiPackageXacThuc.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FILE = "server/routers/aoiPackageRouter.ts";

describe("đường gói ảnh phải chịu cùng chính sách xác thực với mọi đường máy khác", () => {
  const src = readFileSync(FILE, "utf8");

  it("KHÔNG gọi thẳng getMachineByCode để phân giải danh tính máy", () => {
    const viPham = src.split("\n")
      .map((d, i) => ({ d: d.trim(), n: i + 1 }))
      .filter(({ d }) => /getMachineByCode\s*\(/.test(d));
    expect(viPham, `còn phân giải máy không qua cổng tại:\n${viPham.map(v => `${FILE}:${v.n}`).join("\n")}`).toEqual([]);
  });

  it("CÓ gọi authenticateMachine", () => {
    expect(src).toMatch(/authenticateMachine\s*\(/);
  });

  it("cổng đọc đúng file", () => {
    expect(src.length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 3: Chạy — ĐỎ**

Run: `npx vitest run server/routers/aoiPackageXacThuc.test.ts`
Expected: FAIL 2/3.

- [ ] **Step 4: Thay ba chỗ phân giải máy**

Ở `aoiPackageRouter.ts:374`, `:491`, `:1479`, thay `db.getMachineByCode(...)` bằng:

```typescript
const auth = await authenticateMachine({
  apiKey: input.apiKey,
  machineCode: input.machineCode,
  headerKey: machineHeaderKey(ctx),
  scope: "ingest:write",
});
const machine = auth.machine;
```

Và ở `server/_core/index.ts:4670-4684` (tuyến `PUT /api/aoi/upload/:packageId`), thay phép kiểm `x-machine-code` trần bằng cùng lời gọi.

- [ ] **Step 5: XANH**

Run: `npx vitest run server/routers/aoiPackageXacThuc.test.ts`
Expected: PASS 3/3.

- [ ] **Step 6: Nghiệm thu LIVE — cờ phải thật sự có tác dụng**

Đặt `MACHINE_CODE_ONLY_ALLOWED=deny` trong `.env`, khởi động server, gọi `POST /api/aoi/presign` **chỉ với `machineCode`, không có apiKey**.
Expected: **bị từ chối**. Trước Pha 0 lời gọi này thành công.
Ghi lại mã lỗi và thân phản hồi vào commit message. **Đây là bằng chứng cờ thôi vô nghĩa — không được bỏ qua bước này.**

- [ ] **Step 7: Commit**

```bash
npm run check && npm run check:tests
git add server/routers/aoiPackageRouter.ts server/_core/index.ts server/routers/aoiPackageXacThuc.test.ts
git commit -m "fix(security): đường gói ảnh đi qua authenticateMachine — cờ MACHINE_CODE_ONLY_ALLOWED thôi vô nghĩa"
```

---

### Task 11: `PcbThumbnail` — thôi vẽ bo mạch bịa khi thiếu ảnh

`ProductionDashboard.tsx:1258-1268`: ảnh thật không về ⇒ vẽ PCB giả vào đúng ô đó, cùng kích thước. Nếu để nguyên, khi dựng cây ở Pha 1 mà đường ảnh chưa nối, màn vẫn đầy thumbnail đẹp và không ai biết hỏng.

**Files:**
- Create: `client/src/components/AnhChuaCo.tsx`
- Create: `client/src/components/AnhChuaCo.unit.test.ts`
- Modify: `client/src/pages/ProductionDashboard.tsx:178-233` (xoá `PcbThumbnail`), `:1258-1268` (đổi nhánh)

**Interfaces:**
- Produces: `export function AnhChuaCo(props: { className?: string; nhan?: string }): JSX.Element` — ô trống tự khai, dùng lại được cho Pha 1.

- [ ] **Step 1: Viết test đỏ**

⚠ Tên file **phải** kết thúc `.unit.test.ts` — nếu không, glob vitest bỏ qua và lưới xanh giả (xem Global Constraints).

```typescript
// client/src/components/AnhChuaCo.unit.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("ProductionDashboard không được vẽ dữ liệu bịa thay ảnh thật", () => {
  it("PcbThumbnail đã bị gỡ khỏi trang", () => {
    const src = readFileSync("client/src/pages/ProductionDashboard.tsx", "utf8");
    expect(src).not.toMatch(/PcbThumbnail/);
  });

  it("không còn sinh hình bằng Math.sin/PRNG trong trang", () => {
    const src = readFileSync("client/src/pages/ProductionDashboard.tsx", "utf8");
    expect(src).not.toMatch(/Math\.sin\(\s*s\s*\)\s*\*\s*10000/);
  });

  it("có dùng AnhChuaCo cho nhánh thiếu ảnh", () => {
    const src = readFileSync("client/src/pages/ProductionDashboard.tsx", "utf8");
    expect(src).toMatch(/AnhChuaCo/);
  });

  it("cổng đọc đúng file", () => {
    expect(readFileSync("client/src/pages/ProductionDashboard.tsx", "utf8").length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 2: Chạy — ĐỎ 3/4**

Run: `npx vitest run client/src/components/AnhChuaCo.unit.test.ts`
Expected: FAIL 3 ca đầu.

- [ ] **Step 3: Viết component tự khai**

```tsx
// client/src/components/AnhChuaCo.tsx
import { ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Ô trống TỰ KHAI cho chỗ đáng lẽ có ảnh nhưng chưa có.
 *
 * Cố ý KHÔNG vẽ gì giống ảnh thật. Trước đây chỗ này là `PcbThumbnail` —
 * một tấm PCB sinh bằng PRNG, cùng kích thước, cùng bo góc, nên "chưa có ảnh"
 * và "đã có ảnh" trông y hệt nhau. Xem spec §12.3.
 */
export function AnhChuaCo({ className, nhan }: { className?: string; nhan?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 text-muted-foreground ${className ?? ""}`}
      data-testid="anh-chua-co"
    >
      <ImageOff className="h-4 w-4 opacity-60" aria-hidden />
      <span className="text-[10px] leading-none">{nhan ?? t("common.chuaCoAnh", "Chưa có ảnh")}</span>
    </div>
  );
}
```

- [ ] **Step 4: Gỡ `PcbThumbnail` và đổi nhánh**

Xoá toàn bộ `PcbThumbnail` (`ProductionDashboard.tsx:178-233`). Đổi `:1258-1268` thành:

```tsx
{row.latestProductImage ? (
  <img src={row.latestProductImage} alt="" className="h-12 w-12 rounded-md object-cover" />
) : (
  <AnhChuaCo className="h-12 w-12" />
)}
```

- [ ] **Step 5: XANH**

Run: `npx vitest run client/src/components/AnhChuaCo.unit.test.ts`
Expected: PASS 4/4.

- [ ] **Step 6: Nghiệm thu bằng MẮT — bắt buộc**

Khởi động app, mở Production Dashboard.
Chụp màn hình, **tự mở ảnh ra xem**, xác nhận: trạm không có ảnh hiện ô gạch đứt có chữ "Chưa có ảnh", **không** phải hình bo mạch.
Lưu ảnh vào `docs/superpowers/plans/nghiem-thu/task11-truoc.png` và `task11-sau.png`.
⚠ Không uỷ thác bước này cho agent tự nghiệm thu — dự án đã có bài học về việc đó.

- [ ] **Step 7: Commit**

```bash
npm run check
git add client/src/components/AnhChuaCo.tsx client/src/components/AnhChuaCo.unit.test.ts client/src/pages/ProductionDashboard.tsx docs/superpowers/plans/nghiem-thu/
git commit -m "fix(ui): thôi vẽ PCB bịa khi thiếu ảnh — ô trống tự khai thay PcbThumbnail"
```

---

### Task 12: Gỡ heatmap NG theo giờ — trục giờ 100% bịa

`History.tsx:2536-2560` bịa phân bố theo giờ bằng `Math.random()`, không `useMemo` nên số đổi mỗi lần render. Backend chỉ có dữ liệu theo NGÀY.

**Files:**
- Modify: `client/src/pages/History.tsx:2536-2560`
- Create: `client/src/pages/HistoryKhongBiaSo.unit.test.ts`

**Interfaces:**
- Không có API mới.

- [ ] **Step 1: Viết test đỏ**

```typescript
// client/src/pages/HistoryKhongBiaSo.unit.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = () => readFileSync("client/src/pages/History.tsx", "utf8");

describe("History.tsx không được sinh số hiển thị bằng Math.random", () => {
  it("không còn Math.random() nào trong file", () => {
    const viPham = src().split("\n")
      .map((d, i) => ({ d: d.trim(), n: i + 1 }))
      .filter(({ d }) => /Math\.random\s*\(/.test(d));
    expect(viPham, `còn bịa số tại:\n${viPham.map(v => `History.tsx:${v.n}`).join("\n")}`).toEqual([]);
  });

  it("không còn comment tự khai 'simulate'", () => {
    expect(src()).not.toMatch(/[Ss]imulate hourly distribution/);
  });

  it("cổng đọc đúng file", () => {
    expect(src().length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 2: Chạy — ĐỎ**

Run: `npx vitest run client/src/pages/HistoryKhongBiaSo.unit.test.ts`
Expected: FAIL 2/3.

- [ ] **Step 3: Thay thẻ heatmap bằng biểu đồ THEO NGÀY (dữ liệu thật đang có)**

Thay toàn bộ IIFE `:2536-2560` bằng biểu đồ cột theo ngày dùng thẳng `analysisStats.dateStats` — dữ liệu backend thật sự trả về. Đổi tiêu đề sang khoá i18n mô tả đúng chiều dữ liệu:

```tsx
<CardTitle>{t("history.ngTheoNgayTitle", "NG theo ngày")}</CardTitle>
<CardDescription>{t("history.ngTheoNgayDesc", "Số lượng NG theo từng ngày trong khoảng đã chọn")}</CardDescription>
```

Thêm ba khoá `history.ngTheoNgayTitle` / `ngTheoNgayDesc` vào **cả ba** locale `client/src/i18n/locales/{vi,en,zh}.json`. Xoá ba khoá heatmap cũ nếu không còn nơi dùng.

- [ ] **Step 4: XANH**

Run: `npx vitest run client/src/pages/HistoryKhongBiaSo.unit.test.ts`
Expected: PASS 3/3.

- [ ] **Step 5: Cổng i18n**

Run: `npm run i18n:check`
Expected: không báo khoá thiếu ở cả ba locale.

- [ ] **Step 6: Nghiệm thu bằng MẮT**

Mở trang History, chụp màn hình, **tự xem ảnh**. Tải lại trang 3 lần liên tiếp: con số trên biểu đồ phải **giống hệt nhau** (trước đây đổi mỗi lần render). Lưu `docs/superpowers/plans/nghiem-thu/task12-lan{1,2,3}.png`.

- [ ] **Step 7: Commit**

```bash
npm run check
git add client/src/pages/History.tsx client/src/pages/HistoryKhongBiaSo.unit.test.ts client/src/i18n/locales/ docs/superpowers/plans/nghiem-thu/
git commit -m "fix(ui): gỡ heatmap NG theo giờ bịa bằng Math.random, thay bằng NG theo ngày dữ liệu thật"
```

---

### Task 13: Một nguồn sự thật cho spec cột sản phẩm

`server/routers/productRouters.ts:361-377` là bản sao thứ hai của `client/src/pages/ProductModels.tsx:221-231`, thiếu `headerKey`. Khớp 10/10 hôm nay nhưng **không cổng nào canh**. `header` vừa là nhãn vừa là **khoá khớp cột file Excel người dùng tải lên** (`shared/masterDataIO.ts:26-37, 155-157`).

**Files:**
- Create: `shared/productColumnSpec.ts`
- Create: `shared/productColumnSpec.test.ts`
- Modify: `server/routers/productRouters.ts:361-377`, `client/src/pages/ProductModels.tsx:221-231`

**Interfaces:**
- Produces: `export const PRODUCT_COLUMN_SPEC: readonly MasterDataColumn[]` — dùng chung cả hai phía.

**Hiện trạng đã đọc** (không cần đọc lại, nhưng nên đối chiếu trước khi sửa):
- Server: `PRODUCT_IMPORT_COLUMNS` (`productRouters.ts:361-371`) — 10 cột, **không cột nào có `headerKey`**. Kèm `PRODUCT_EXPORT_COLUMNS` (`:374-378`) = import + `createdAt`/`updatedAt`.
- Client: `PRODUCT_IO_COLUMNS` (`ProductModels.tsx:221-232`) — 10 cột **có đủ `headerKey`**, `header` khớp server 10/10 nguyên văn.

- [ ] **Step 1: Viết test đỏ**

```typescript
// shared/productColumnSpec.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PRODUCT_COLUMN_SPEC } from "./productColumnSpec";

describe("spec cột sản phẩm — MỘT nguồn sự thật", () => {
  it("có đủ 10 cột nhập", () => {
    expect(PRODUCT_COLUMN_SPEC).toHaveLength(10);
  });

  it("header giữ NGUYÊN VĂN bản đang chạy — đổi một dấu cách là gãy import", () => {
    expect(PRODUCT_COLUMN_SPEC.map((c) => c.header)).toEqual([
      "Mã sản phẩm", "Tên sản phẩm", "Mô tả", "Nhóm", "Dòng sản phẩm",
      "Biến thể", "Phiên bản (Rev)", "Trạng thái vòng đời",
      "FPY mục tiêu (%)", "FPY tối thiểu (%)",
    ]);
  });

  it("cột XUẤT = cột nhập + createdAt/updatedAt", () => {
    expect(PRODUCT_EXPORT_COLUMN_SPEC.map((c) => c.field)).toEqual([
      ...PRODUCT_COLUMN_SPEC.map((c) => c.field), "createdAt", "updatedAt",
    ]);
  });

  it("mọi cột đều có headerKey — thiếu là bản sao chưa theo kịp", () => {
    const thieu = PRODUCT_COLUMN_SPEC.filter((c) => !c.headerKey).map((c) => c.field);
    expect(thieu, `cột thiếu headerKey: ${thieu.join(", ")}`).toEqual([]);
  });

  it("KHÔNG bên nào còn khai spec cột riêng", () => {
    const server = readFileSync("server/routers/productRouters.ts", "utf8");
    const client = readFileSync("client/src/pages/ProductModels.tsx", "utf8");
    expect(server).toMatch(/PRODUCT_COLUMN_SPEC/);
    expect(client).toMatch(/PRODUCT_COLUMN_SPEC/);
  });

  it("header KHÔNG được bọc t() — nó là khoá khớp file Excel, xem masterDataIO.ts:26-37", () => {
    const src = readFileSync("shared/productColumnSpec.ts", "utf8");
    expect(src).not.toMatch(/header:\s*t\(/);
  });
});
```

- [ ] **Step 3: Chạy — ĐỎ**

Run: `npx vitest run shared/productColumnSpec.test.ts`
Expected: FAIL — không import được `PRODUCT_COLUMN_SPEC`.

- [ ] **Step 4: Viết spec dùng chung**

```typescript
// shared/productColumnSpec.ts
import type { MasterDataColumn } from "./masterDataIO";

/**
 * MỘT nguồn sự thật cho spec cột sản phẩm.
 *
 * ⚠ `header` KHÔNG được bọc t(). Nó mang BA vai (masterDataIO.ts:26-37):
 * nhãn hiển thị, KHOÁ KHỚP cột file Excel người dùng tải lên, và hàng tiêu đề
 * file template xuất ra. Bọc t() vào đây làm mọi file Excel người dùng đang có
 * hết nhập được. Dịch bằng `headerKey` — ImportExportBar.tsx:267-268 dùng đúng.
 *
 * Trước đây spec này có HAI bản: productRouters.ts:361-377 và
 * ProductModels.tsx:221-231, khớp 10/10 nhưng không cổng nào canh. Xem spec §12.4.
 */
export const PRODUCT_COLUMN_SPEC: readonly MasterDataColumn[] = [
  { field: "code",            header: "Mã sản phẩm",         headerKey: "productModelsCol.code",            required: true, type: "string", example: "SP-001" },
  { field: "name",            header: "Tên sản phẩm",        headerKey: "productModelsCol.name",            required: true, type: "string", example: "Bảng mạch A" },
  { field: "description",     header: "Mô tả",               headerKey: "productModelsCol.description",     type: "string" },
  { field: "category",        header: "Nhóm",                headerKey: "productModelsCol.category",        type: "string", example: "PCBA" },
  { field: "productLine",     header: "Dòng sản phẩm",       headerKey: "productModelsCol.productLine",     type: "string" },
  { field: "variant",         header: "Biến thể",            headerKey: "productModelsCol.variant",         type: "string" },
  { field: "revision",        header: "Phiên bản (Rev)",     headerKey: "productModelsCol.revision",        type: "string", example: "A" },
  { field: "lifecycleStatus", header: "Trạng thái vòng đời", headerKey: "productModelsCol.lifecycleStatus", type: "string", example: "active" },
  { field: "targetYieldRate", header: "FPY mục tiêu (%)",    headerKey: "productModelsCol.targetYieldRate", type: "number", example: 98 },
  { field: "minYieldRate",    header: "FPY tối thiểu (%)",   headerKey: "productModelsCol.minYieldRate",    type: "number", example: 95 },
] as const;

/** Cột XUẤT = cột nhập + ngày tạo/cập nhật (chỉ đọc, không dùng khi nhập). */
export const PRODUCT_EXPORT_COLUMN_SPEC: readonly MasterDataColumn[] = [
  ...PRODUCT_COLUMN_SPEC,
  { field: "createdAt", header: "Ngày tạo",       headerKey: "productModelsCol.createdAt", type: "date" },
  { field: "updatedAt", header: "Ngày cập nhật",  headerKey: "productModelsCol.updatedAt", type: "date" },
] as const;
```

Rồi thay cả hai chỗ khai riêng:
- `server/routers/productRouters.ts:361-378` — xoá `PRODUCT_IMPORT_COLUMNS` và `PRODUCT_EXPORT_COLUMNS`, thay bằng `import { PRODUCT_COLUMN_SPEC, PRODUCT_EXPORT_COLUMN_SPEC } from "@shared/productColumnSpec"` và đổi mọi chỗ dùng.
- `client/src/pages/ProductModels.tsx:221-232` — xoá `PRODUCT_IO_COLUMNS`, dùng `PRODUCT_COLUMN_SPEC`.

Thêm 12 khoá `productModelsCol.*` vào cả ba locale `client/src/i18n/locales/{vi,en,zh}.json` nếu chưa có (10 khoá cũ có thể đã tồn tại; `createdAt`/`updatedAt` là mới).

- [ ] **Step 5: XANH**

Run: `npx vitest run shared/productColumnSpec.test.ts`
Expected: PASS 4/4.

- [ ] **Step 6: Nghiệm thu import THẬT — không chỉ test tĩnh**

Xuất file template sản phẩm từ UI, mở ra kiểm tên cột, rồi nhập lại chính file đó.
Expected: nhập thành công, đủ số dòng. Nếu gãy, `header` đã bị đổi ở đâu đó — sửa cho khớp nguyên văn bản cũ.
Lưu ảnh `docs/superpowers/plans/nghiem-thu/task13-import.png`.

- [ ] **Step 7: Commit**

```bash
npm run check && npm run check:tests
git add shared/productColumnSpec.ts shared/productColumnSpec.test.ts server/routers/productRouters.ts client/src/pages/ProductModels.tsx docs/superpowers/plans/nghiem-thu/
git commit -m "refactor(masterdata): một nguồn sự thật cho spec cột sản phẩm + cổng canh lệch"
```

---

### Task 14: Dọn DB dev — CUỐI CÙNG, sau khi đã đo xong

Cố ý xếp cuối: xoá dữ liệu trước là mất corpus 22.996 bo để đo Task 1/6/8.

⚠ **Chỉ chạy trên DB dev.** Script tự dừng nếu host không phải `127.0.0.1`/`localhost`.

**Files:**
- Create: `scripts/don-db-dev.mjs`

**Interfaces:**
- Nhận `--that-su-xoa` để thực thi; không có cờ đó thì **chỉ đếm**.

- [ ] **Step 1: Viết script đếm-rồi-xoá có ngưỡng chặn**

```javascript
// scripts/don-db-dev.mjs
// Dọn dữ liệu TEST trên DB DEV. Mặc định CHỈ ĐẾM.
// Đếm:  node scripts/don-db-dev.mjs
// Xoá:  node scripts/don-db-dev.mjs --that-su-xoa
import 'dotenv/config';
import postgres from 'postgres';

const THAT_SU_XOA = process.argv.includes('--that-su-xoa');
const url = process.env.DATABASE_URL || '';

// Chặn cứng: chỉ chạy trên máy cục bộ
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('DỪNG: DATABASE_URL không trỏ 127.0.0.1/localhost. Script này chỉ dành cho DB dev.');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'prefer', max: 1 });

const [truoc] = await sql`
  SELECT (SELECT count(*) FROM product_inspections)::int AS bo,
         (SELECT count(*) FROM measurement_results)::int AS diem_do,
         (SELECT count(*) FROM inspection_packages)::int AS goi,
         (SELECT count(*) FROM package_images)::int      AS anh`;
console.log('TRƯỚC:', truoc);

if (!THAT_SU_XOA) {
  console.log('Chế độ ĐẾM. Thêm --that-su-xoa để thực thi.');
  await sql.end();
  process.exit(0);
}

// Ngưỡng chặn: xoá nhiều bất thường ⇒ dừng, vì có thể đang trỏ nhầm DB
const TRAN = 100000;
if (truoc.bo > TRAN) {
  console.error(`DỪNG: ${truoc.bo} bo vượt trần ${TRAN}. Kiểm tra lại đang trỏ DB nào.`);
  await sql.end();
  process.exit(1);
}

await sql.begin(async (tx) => {
  await tx`DELETE FROM package_images`;
  await tx`DELETE FROM package_activity_logs`;
  await tx`DELETE FROM inspection_packages`;
  await tx`DELETE FROM measurement_results`;
  await tx`DELETE FROM inspection_idempotency_keys`;
  await tx`DELETE FROM product_inspections`;
});

const [sau] = await sql`
  SELECT (SELECT count(*) FROM product_inspections)::int AS bo,
         (SELECT count(*) FROM measurement_results)::int AS diem_do,
         (SELECT count(*) FROM inspection_packages)::int AS goi,
         (SELECT count(*) FROM package_images)::int      AS anh`;
console.log('SAU:', sau);
await sql.end();
```

- [ ] **Step 2: Chạy chế độ ĐẾM trước**

Run: `node scripts/don-db-dev.mjs`
Expected: in `TRƯỚC: { bo: 22996, diem_do: 157369, goi: 0, anh: 0 }`.
**Nếu con số khác đáng kể, DỪNG và báo** — có thể đang trỏ nhầm DB.

- [ ] **Step 3: Kiểm chứng chặn cứng thật sự chặn**

Run: `DATABASE_URL="postgres://u:p@db.production.example:5432/x" node scripts/don-db-dev.mjs --that-su-xoa`
Expected: thoát ngay với `DỪNG: DATABASE_URL không trỏ 127.0.0.1/localhost`, **không kết nối, không xoá**.
Nếu nó chạy tiếp thì chặn cứng vô dụng — sửa trước khi đi tiếp.

- [ ] **Step 4: Xin xác nhận rồi mới xoá**

Báo cáo con số ở Step 2 cho chủ dự án và **chờ đồng ý** trước khi chạy lệnh xoá.

- [ ] **Step 5: Xoá và báo cáo**

Run: `node scripts/don-db-dev.mjs --that-su-xoa`
Expected: in cả `TRƯỚC:` và `SAU:`, `SAU` phải bằng 0 ở cả bốn con số. Chép nguyên văn output vào báo cáo.

- [ ] **Step 6: Commit**

```bash
git add scripts/don-db-dev.mjs
git commit -m "chore(dev): script dọn DB dev có chặn cứng host và ngưỡng, mặc định chỉ đếm"
```

---

## Cổng ra Pha 0

Chỉ được sang Pha 1 khi cả sáu điều sau **đã chạy thật và có số**:

- [ ] `npm test` — báo tổng số ca, và so với lần chạy trước Pha 0. Ca nào chuyển xanh→đỏ phải giải thích được.
- [ ] `npm run check` và `npm run check:tests` — sạch.
- [ ] `npx vitest run server/utils/kpiCongThucCensus.test.ts` — xanh, và **đã chạy đột biến chứng minh nó đỏ được** (Task 6 Step 5).
- [ ] Báo cáo con số: **244 bo** trước đây bị ~15 đường tính nhầm thành hỏng, nay tính đúng là đạt.
- [ ] Nghiệm thu live Task 10 Step 6: gọi `presign` chỉ bằng `machineCode` **bị từ chối** (trước Pha 0 thì thành công) — kèm mã lỗi thật.
- [ ] Ba ảnh chụp màn hình Task 11/12/13 đã **tự mở ra xem**, không uỷ thác.

**Không được khai "xong" nếu thiếu bất kỳ mục nào.** Mục nào không làm được thì nói rõ mục đó và lý do.
