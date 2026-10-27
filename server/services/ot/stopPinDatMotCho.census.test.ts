/**
 * ★ SCADA R1b-2b-1 Task 2 (điều kiện 1b, preflight C1) — CENSUS "AI ĐẶT ĐƯỢC GHIM STOP?".
 *
 * Luật mới: ghim STOP trên địa chỉ coil / bit (coil Modbus, holding bool, bit-device SLMP / MC / S7) phải thuộc tập bool hợp lệ — kiểm LÚC ĐẶT, trong
 * `stopPin.datStopPin` (KHÔNG ở `validateStopValue`: ghim cũ không được "biến mất" lúc dispatch). Luật đó chỉ có nghĩa khi `datStopPin` là ĐƯỜNG
 * DUY NHẤT đặt một `stop_value` khác NULL. Census này canh điều đó (văn bản, không DB):
 *   (A) hai importer CLI (`scripts/mappings-import.mjs`, `scripts/lib/stopPinCli.mjs`) và importer server (`mappingAsCode.ts`) CHỈ gỡ / giữ ghim:
 *       mọi `stop_value =` là `= NULL`, không INSERT nào mang cột `stop_value`, `mappingAsCode.ts` không gán `stopValue:`;
 *   (B) trong `server/**` và `scripts/**` (tệp sản xuất, trừ test / `__*.ts` / `*.testkit.ts`): KHÔNG câu SQL nào đặt `stop_value` khác NULL /
 *       INSERT cột `stop_value`, KHÔNG `.set(…)` / `.values(…)` drizzle nào mang `stopValue` khác null — trừ `stopPin.ts` (SAU kiểm `lopDiaChiBit`)
 *       và danh sách cho phép `CHO_PHEP` (mỗi mục một lý do).
 * Người thêm đường đặt ghim thứ hai ⇒ ĐỎ ⇒ phải đưa luật địa chỉ coil / bit vào đường đó rồi cập nhật census.
 *
 * GIỚI HẠN của bộ quét (văn bản, heuristic — fix round 1 M2):
 *   • drizzle: bắt `.set({…})` / `.values({…})` / `.values([{…}])` với object literal, và `.set(X)` / `.values(X)` / `.values([X])` /
 *     `.set({ ...X })` khi X là một `const|let|var X = { … }` (object literal) trong CÙNG tệp, hoặc có `X.stopValue = …` trong cùng tệp.
 *     KHÔNG bắt: object dựng ở tệp KHÁC rồi import, khoá tính toán (`[k]: v`), object lồng ngoặc nhọn TRƯỚC `stopValue` (regex dừng ở `}` đầu
 *     tiên), Object.assign, builder động, `sql` thô dựng tên cột động.
 *   • SQL thô: bắt `stop_value = <khác NULL>` và `INSERT INTO device_tags (… stop_value …)`.
 *   • Giá trị null viết khác (`undefined`, biến chứa null) bị tính là "khác null" ⇒ báo DƯ (người sửa xem tay), không bỏ sót.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const rel = (p: string) => relative(GOC, p).split(sep).join("/");
const doc = (r: string) => readFileSync(join(GOC, r), "utf8");

/** Tệp được phép đặt `stop_value` khác NULL ngoài `stopPin.ts` — mỗi mục MỘT lý do. */
const CHO_PHEP: Record<string, string> = {
  "scripts/apply-migration-0362.mjs":
    "thăm dò sau migration 0362 (dòng ~146): ghi `false` lên MỘT hàng trong transaction rồi khôi phục giá trị cũ — kiểm cột ghi được, không để lại ghim",
  "scripts/scada-r1b-bench.ts":
    "bench OpenPLC R1b (tag `dung` holding:… kiểu int, ghim '0'; `--r1b2b1` ô B1b: tag `icoil` coil:… kiểu int, ghim '1' — điều kiện 1c, thuộc tập 8 giá trị) — dữ liệu bench trên adapter bench do chính script tạo và xoá; không phải đường sản phẩm",
};

function moiTep(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) moiTep(p, ra);
    else if (/\.(ts|tsx|mjs|js)$/.test(ten) && !/\.test\.(ts|tsx|mjs|js)$/.test(ten) && !ten.endsWith(".d.ts") && !/\.testkit\.ts$/.test(ten) && !ten.startsWith("__")) ra.push(p);
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

/** `stopValue: X` với X không phải `null` trong thân một object literal. */
function coStopValueKhacNull(than: string): string | null {
  const g = than.match(/\bstopValue\s*:\s*([^,}\n]+)/);
  return g && !/^null\b/.test(g[1].trim()) ? g[0] : null;
}

/** drizzle `.set(…)` / `.values(…)` mang `stopValue` khác null — object literal tại chỗ, hoặc biến dựng trong CÙNG tệp (xem GIỚI HẠN). */
function ghiStopValueDrizzle(vanBan: string): string[] {
  const ra: string[] = [];
  for (const m of vanBan.matchAll(/\.(?:set|values)\(\s*\[?\s*\{([^}]*)\}/g)) {
    const x = coStopValueKhacNull(m[1]);
    if (x) ra.push(x);
  }
  const bien = new Set<string>();
  for (const m of vanBan.matchAll(/\.(?:set|values)\(\s*\[?\s*([A-Za-z_$][\w$]*)\s*[\])]/g)) bien.add(m[1]);
  for (const m of vanBan.matchAll(/\.(?:set|values)\(\s*\[?\s*\{[^}]*?\.\.\.([A-Za-z_$][\w$]*)/g)) bien.add(m[1]);
  for (const b of bien) {
    for (const m of vanBan.matchAll(new RegExp(`(?:const|let|var)\\s+${b}\\b[^=]*=\\s*\\{([^}]*)\\}`, "g"))) {
      const x = coStopValueKhacNull(m[1]);
      if (x) ra.push(`${b}: ${x}`);
    }
    for (const m of vanBan.matchAll(new RegExp(`\\b${b}\\.stopValue\\s*=(?!=)\\s*([^;\\n]+)`, "g"))) {
      if (!/^null\b/.test(m[1].trim())) ra.push(`${b}.stopValue = ${m[1].trim()}`);
    }
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
    expect(ghiStopValueDrizzle(".set({ stopValue: null, stopPinnedBy: null })")).toEqual([]);
    expect(ghiStopValueDrizzle(".set({ stopValue: sau as X, stopPinnedBy: p })")).toHaveLength(1);
    // fix round 1 (M2) — insert drizzle, mảng, biến dựng trong cùng tệp, spread, gán thuộc tính
    expect(ghiStopValueDrizzle("db.insert(deviceTags).values({ adapterId: 1, stopValue: 1 })")).toHaveLength(1);
    expect(ghiStopValueDrizzle("db.insert(deviceTags).values([{ adapterId: 1, stopValue: true }])")).toHaveLength(1);
    expect(ghiStopValueDrizzle("const patch = { stopValue: v, x: 1 };\ndb.update(deviceTags).set(patch)")).toHaveLength(1);
    expect(ghiStopValueDrizzle("const r = { stopValue: 2 };\ndb.insert(deviceTags).values([r])")).toHaveLength(1);
    expect(ghiStopValueDrizzle("const p = { a: 1 };\ndb.update(deviceTags).set({ ...p, b: 2 });\np.stopValue = 3;")).toHaveLength(1);
    expect(ghiStopValueDrizzle("const patch = { stopValue: null };\ndb.update(deviceTags).set(patch)")).toEqual([]);
    expect(ghiStopValueDrizzle("const set = cond ? { ...record, ...GO_STOP_PIN_PATCH } : record;\ndb.update(deviceTags).set(set)")).toEqual([]);
  });

  it("(A) mappings-import.mjs / stopPinCli.mjs / mappingAsCode.ts chỉ GỠ hoặc GIỮ ghim — không đặt", () => {
    for (const r of ["scripts/mappings-import.mjs", "scripts/lib/stopPinCli.mjs"]) {
      const v = doc(r);
      expect(v, r).toMatch(/stop_value/); // tệp thật sự chạm ghim (không phải census rỗng)
      expect(datStopValueKhacNull(v), r).toEqual([]);
      expect(ghiStopValueDrizzle(v), r).toEqual([]);
    }
    const mac = doc("server/services/ot/mappingAsCode.ts");
    expect(mac).toMatch(/GO_STOP_PIN_PATCH/);
    expect(mac).not.toMatch(/\bstopValue\s*:/);
    expect(ghiStopValueDrizzle(mac)).toEqual([]);
  });

  it("(B) server/** + scripts/**: không SQL / drizzle đặt stop_value khác NULL ngoài stopPin.ts (sau kiểm lopDiaChiBit) và CHO_PHEP", () => {
    const sqlKhacNull: string[] = [];
    const drizzleKhacNull = new Set<string>();
    const thayChoPhep = new Set<string>();
    for (const p of [...moiTep(join(GOC, "server")), ...moiTep(join(GOC, "scripts"))]) {
      const r = rel(p);
      const v = readFileSync(p, "utf8");
      const sqlHit = datStopValueKhacNull(v);
      const drHit = ghiStopValueDrizzle(v);
      if (sqlHit.length === 0 && drHit.length === 0) continue;
      if (CHO_PHEP[r]) {
        thayChoPhep.add(r);
        continue;
      }
      for (const x of sqlHit) sqlKhacNull.push(`${r}: ${x}`);
      if (drHit.length) drizzleKhacNull.add(`${r}: ${drHit.join(" | ")}`);
    }
    expect(sqlKhacNull).toEqual([]);
    expect([...drizzleKhacNull].map((x) => x.split(":")[0])).toEqual(["server/services/ot/stopPin.ts"]);
    // danh sách cho phép KHÔNG thừa: mỗi mục phải thật sự còn ghi stop_value (mục hết hiệu lực ⇒ xoá khỏi CHO_PHEP)
    expect([...thayChoPhep].sort()).toEqual(Object.keys(CHO_PHEP).sort());
    const sp = doc("server/services/ot/stopPin.ts");
    const kiem = sp.indexOf("lopDiaChiBit(adapter.protocol, tag.address, tag.dataType)");
    const ghi = sp.indexOf(".set({ stopValue: sau");
    expect(kiem).toBeGreaterThan(-1);
    expect(ghi).toBeGreaterThan(kiem);
  });
});
