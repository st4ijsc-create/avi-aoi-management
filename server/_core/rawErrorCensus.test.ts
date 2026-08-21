/**
 * F3 — ĐIỀU TRA DÂN SỐ `throw new Error(...)` NGOÀI `server/routers/**`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO MÓN NỢ NÀY PHÌNH TỚI BỐN CHỮ SỐ MÀ KHÔNG AI THẤY
 * ══════════════════════════════════════════════════════════════════════════════════
 * `appErrorCoverage.test.ts` có hai ngân sách rất tốt — nhưng cả hai chỉ quét
 * `server/routers/**`. Mọi thứ ở `server/db/**`, `server/services/**`,
 * `server/_core/**` nằm NGOÀI tầm nhìn của chúng.
 *
 * Đo ngày 2026-08-21: **1035 chỗ** `throw new Error(` ngoài routers
 * (`server/services` 629 · `server/db` 355 · `server/_core` 31), trong đó **~400 chỗ**
 * là CÙNG MỘT khái niệm "DB không sẵn sàng".
 *
 * ── VÌ SAO CHÚNG TỚI ĐƯỢC NGƯỜI DÙNG ─────────────────────────────────────────────
 * tRPC v11: `message = opts.message ?? cause?.message ?? code`. `errorFormatter` chỉ
 * gắn `appCode` cho lỗi dựng bằng `appError()`. Lỗi thô vì thế rơi tới nhánh CUỐI của
 * `mapTrpcError` phía client — nơi nó **`return message`** nguyên văn. Người dùng
 * vi/en/zh đều đọc đúng chuỗi tiếng Anh đó.
 *
 * ── VÌ SAO MỤC F3 TRONG BACKLOG NÓI SAI CHỖ ──────────────────────────────────────
 * F3 khai *"64 chỗ / 13 file, nặng nhất `machineAuthService` 17 · `_core/trpc` 12"*.
 * Đo lại 2026-08-21: cả hai file đó **0 chỗ ném thô** — chúng đã dùng `appError` (17
 * và 14 lời gọi, khớp đúng con số F3 nói là "chưa di trú"). Nợ THẬT nằm ở
 * `server/db/**` + `server/services/**`, và lớn gấp 16 lần.
 * ⇒ Bài học lặp lại: **con số trong tài liệu là lời khai, không phải phép đo.**
 *
 * ⚠ KHÔNG BAO GIỜ nâng ngân sách để test xanh. Nâng nó nghĩa là vừa thêm một câu
 *   tiếng Anh mà người dùng Việt/Trung sẽ đọc nguyên văn.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Ngân sách CHỈ ĐƯỢC GIẢM.
 * 1035 → 711 (lô 1): 324 chỗ họ "DB không sẵn sàng" trong `server/db/**`.
 * 711 →  629 (lô 2): 82 chỗ còn lại ở `server/services/**` + `server/_core/**` + `templateDb`.
 * 629 →  601 (lô 3): 28 chỗ họ "X not found" mà thực thể ĐÃ CÓ trong từ điển
 *   `errors.entity.*` (137 khoá, đủ vi/en/zh) → `appError("NOT_FOUND", "ENTITY_NOT_FOUND",
 *   { entity })`. 64 chỗ "not found" còn lại cần ĐẶT TÊN thực thể mới — làm riêng,
 *   để không vừa di trú vừa bịa từ vựng.
 * 601 →  547 (lô 4): 54 chỗ "not found" còn lại, ánh xạ theo (FILE, CÂU) đích danh +
 *   12 khoá thực thể MỚI (đủ vi/en/zh). 10 chỗ giữ nguyên vì là lỗi HỆ THỐNG TỆP.
 * Cả hai lô đổi sang `DbUnavailableError` — lớp tự mang `appCode: "DB_UNAVAILABLE"`
 * (mã đã có sẵn, đã đủ ba bản dịch), nên client dịch được mà formatter không đổi dòng nào.
 */
const ALLOWED_RAW_THROWS_OUTSIDE_ROUTERS = 547;

/**
 * Họ "DB không sẵn sàng": `407 → 83 → 1 → **0**` — nay là BẤT BIẾN, không phải ngân sách.
 *
 * Chỗ cuối cùng (`configDriftService.ts:297`,
 * `Adapter ${adapterId} not found (or database unavailable)`) từng được ghi là ngoại lệ
 * cố ý. Lô 3 xử nó theo hướng ĐÚNG HƠN: nó vốn là lỗi *"không tìm thấy adapter"* — chỉ
 * NHẮC khả năng DB sập như lý do phụ — nên nay là
 * `appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" })`.
 * ⇒ Ngoại lệ biến mất vì nguyên nhân được gọi đúng tên, không phải vì ai đó nới trần.
 */
const ALLOWED_DB_UNAVAILABLE_RAW = 0;

const HO_DB = /Database not (available|connected|initialized)|DB not available|database unavailable|DB unavailable|db unavailable/i;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "routers") continue; // đã có cổng riêng ở appErrorCoverage.test.ts
      out.push(...walkTs(full));
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function dem(): { total: number; hoDb: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;
  let hoDb = 0;
  for (const file of walkTs(SERVER)) {
    const src = readFileSync(file, "utf8");
    const hits = src.match(/throw new Error\(/g) ?? [];
    if (!hits.length) continue;
    for (const m of src.matchAll(/throw new Error\((["'`])([^"'`]*)\1\)/g)) {
      if (HO_DB.test(m[2])) hoDb++;
    }
    byFile.push([file.replace(SERVER, ""), hits.length]);
    total += hits.length;
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, hoDb, byFile };
}

describe("F3 — `throw new Error(...)` ngoài server/routers (cổng cũ mù với vùng này)", () => {
  it("cầu chì: phép quét phải THẤY file, không thì nó đang canh tập rỗng", () => {
    expect(walkTs(SERVER).length).toBeGreaterThan(100);
  });

  it(`còn tối đa ${ALLOWED_RAW_THROWS_OUTSIDE_ROUTERS} chỗ ném thô`, () => {
    const { total, byFile } = dem();
    if (total > ALLOWED_RAW_THROWS_OUTSIDE_ROUTERS) {
      console.error("[F3] nợ ném-thô phình ở:", byFile.slice(0, 12));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_RAW_THROWS_OUTSIDE_ROUTERS);
  });

  it("ngân sách phải bám SÁT số thật — số dư che mất nợ mới", () => {
    expect(ALLOWED_RAW_THROWS_OUTSIDE_ROUTERS).toBe(dem().total);
  });

  it(`họ "DB không sẵn sàng" còn tối đa ${ALLOWED_DB_UNAVAILABLE_RAW} chỗ ném THÔ`, () => {
    // Tách riêng để hai con số không bù trừ: ai đó di trú bớt chỗ khác rồi thêm một
    // "Database not available" mới thì tổng vẫn đạt, nhưng ca này ĐỎ.
    const { hoDb } = dem();
    expect(hoDb).toBeLessThanOrEqual(ALLOWED_DB_UNAVAILABLE_RAW);
  });

  it("★★★ `server/db/**` KHÔNG còn chỗ nào ném thô họ 'DB không sẵn sàng'", () => {
    // Vùng đã di trú xong — bất biến, không phải ngân sách. Thêm một chỗ ở đây là
    // quay lại đúng lớp lỗi vừa đóng.
    const con: string[] = [];
    for (const file of walkTs(join(SERVER, "db"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/throw new Error\((["'`])([^"'`]*)\1\)/g)) {
        if (HO_DB.test(m[2])) con.push(`${file.replace(SERVER, "")}: ${m[2]}`);
      }
    }
    expect(con).toEqual([]);
  });

  it("★★★ TOÀN BỘ server ngoài routers: 0 chỗ ném thô họ 'DB không sẵn sàng'", () => {
    // Bất biến, không phải ngân sách. Ca này in ĐÍCH DANH file+câu khi đỏ — một con số
    // trần không nói chỗ nào thì người sửa phải đi mò, và cổng khó chịu là cổng bị tắt.
    const con: string[] = [];
    for (const file of walkTs(SERVER)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/throw new Error\((["'`])([^"'`]*)\1\)/g)) {
        if (HO_DB.test(m[2])) con.push(`${file.replace(SERVER, "").split("\\").join("/")}: ${m[2]}`);
      }
    }
    expect(con).toEqual([]);
  });
});
