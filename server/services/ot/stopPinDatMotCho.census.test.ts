/**
 * ★ SCADA R1b-2b-1 Task 2 (điều kiện 1b, preflight C1) — CENSUS "AI ĐẶT ĐƯỢC GHIM STOP?".
 *
 * Luật mới: ghim STOP trên địa chỉ coil / bit (coil Modbus, holding bool, bit-device SLMP / MC) phải thuộc tập bool hợp lệ — kiểm LÚC ĐẶT, trong
 * `stopPin.datStopPin` (KHÔNG ở `validateStopValue`: ghim cũ không được "biến mất" lúc dispatch). Luật đó chỉ có nghĩa khi `datStopPin` là ĐƯỜNG
 * DUY NHẤT đặt một `stop_value` khác NULL. Census này canh điều đó (văn bản, không DB):
 *   (A) hai importer CLI (`scripts/mappings-import.mjs`, `scripts/lib/stopPinCli.mjs`) và importer server (`mappingAsCode.ts`) CHỈ gỡ / giữ ghim:
 *       mọi `stop_value =` là `= NULL`, không INSERT nào mang cột `stop_value`, `mappingAsCode.ts` không gán `stopValue:`;
 *   (B) trong `server/**` (tệp sản xuất, trừ bộ dựng test `__*.ts` / `*.testkit.ts`): KHÔNG câu SQL nào đặt `stop_value` khác NULL / INSERT cột
 *       `stop_value`, và lượt `.set({ stopValue: … })` khác NULL DUY NHẤT nằm trong `stopPin.ts`, SAU kiểm `lopDiaChiBit`.
 * Người thêm đường đặt ghim thứ hai ⇒ ĐỎ ⇒ phải đưa luật địa chỉ coil / bit vào đường đó rồi cập nhật census.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const rel = (p: string) => relative(GOC, p).split(sep).join("/");
const doc = (r: string) => readFileSync(join(GOC, r), "utf8");

function moiTep(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) moiTep(p, ra);
    else if (/\.(ts|tsx|mjs|js)$/.test(ten) && !/\.test\.tsx?$/.test(ten) && !ten.endsWith(".d.ts") && !/\.testkit\.ts$/.test(ten) && !ten.startsWith("__")) ra.push(p);
  }
  return ra;
}

/** Vị trí đặt `stop_value` khác NULL trong một văn bản (SQL thô). */
function datStopValueKhacNull(vanBan: string): string[] {
  const ra: string[] = [];
  for (const m of vanBan.matchAll(/stop_value\s*=\s*(?!NULL\b)(?!=)[^\s,]+/gi)) ra.push(m[0]);
  for (const m of vanBan.matchAll(/INSERT\s+INTO\s+"?device_tags"?\s*\(([^)]*)\)/gi)) if (/\bstop_value\b/i.test(m[1])) ra.push(m[0].slice(0, 60));
  return ra;
}

/** Lượt `.set({ … stopValue: X … })` với X không phải `null` (drizzle). */
function setStopValueKhacNull(vanBan: string): string[] {
  const ra: string[] = [];
  for (const m of vanBan.matchAll(/\.set\(\{([^}]*)\}/g)) {
    const g = m[1].match(/\bstopValue\s*:\s*([^,}]+)/);
    if (g && !/^null\b/.test(g[1].trim())) ra.push(g[0]);
  }
  return ra;
}

describe("census — datStopPin là đường DUY NHẤT đặt ghim STOP khác NULL (điều kiện 1b)", () => {
  it("bộ quét tự kiểm (đột biến trên văn bản tổng hợp)", () => {
    expect(datStopValueKhacNull("UPDATE device_tags SET stop_value = NULL WHERE id = 1")).toEqual([]);
    expect(datStopValueKhacNull("UPDATE device_tags SET stop_value = ${tx.json(v)} WHERE id = 1")).toHaveLength(1);
    expect(datStopValueKhacNull('INSERT INTO device_tags ("adapterId", stop_value) VALUES (1, 2)')).toHaveLength(1);
    expect(datStopValueKhacNull('INSERT INTO device_tags ("adapterId", "tagKey") VALUES (1, 2)')).toEqual([]);
    expect(datStopValueKhacNull("WHERE stop_value IS NOT NULL")).toEqual([]);
    expect(setStopValueKhacNull(".set({ stopValue: null, stopPinnedBy: null })")).toEqual([]);
    expect(setStopValueKhacNull(".set({ stopValue: sau as X, stopPinnedBy: p })")).toHaveLength(1);
  });

  it("(A) mappings-import.mjs / stopPinCli.mjs / mappingAsCode.ts chỉ GỠ hoặc GIỮ ghim — không đặt", () => {
    for (const r of ["scripts/mappings-import.mjs", "scripts/lib/stopPinCli.mjs"]) {
      const v = doc(r);
      expect(v, r).toMatch(/stop_value/); // tệp thật sự chạm ghim (không phải census rỗng)
      expect(datStopValueKhacNull(v), r).toEqual([]);
    }
    const mac = doc("server/services/ot/mappingAsCode.ts");
    expect(mac).toMatch(/GO_STOP_PIN_PATCH/);
    expect(mac).not.toMatch(/\bstopValue\s*:/);
    expect(setStopValueKhacNull(mac)).toEqual([]);
  });

  it("(B) server/**: không SQL đặt stop_value khác NULL; .set({ stopValue: X≠null }) DUY NHẤT ở stopPin.ts, sau kiểm lopDiaChiBit", () => {
    const sqlKhacNull: string[] = [];
    const setKhacNull: string[] = [];
    for (const p of moiTep(join(GOC, "server"))) {
      const v = readFileSync(p, "utf8");
      for (const x of datStopValueKhacNull(v)) sqlKhacNull.push(`${rel(p)}: ${x}`);
      for (const x of setStopValueKhacNull(v)) setKhacNull.push(rel(p));
    }
    expect(sqlKhacNull).toEqual([]);
    expect(setKhacNull).toEqual(["server/services/ot/stopPin.ts"]);
    const sp = doc("server/services/ot/stopPin.ts");
    const kiem = sp.indexOf("lopDiaChiBit(adapter.protocol, tag.address, tag.dataType)");
    const ghi = sp.indexOf(".set({ stopValue: sau");
    expect(kiem).toBeGreaterThan(-1);
    expect(ghi).toBeGreaterThan(kiem);
  });
});
