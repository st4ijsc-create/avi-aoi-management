// doc 81 Đợt 3b Task 2 fix 1 (R-3b-b (3)) — dọn hàng mẫu / user đo HỎNG phải làm lần đo TRƯỢT (pass=false) và được IN ra,
// không im lặng để hàng rò tới lần chạy sau. Kiểm hàm cổng thuần `cleanupFailures` + `runPass` mà main() dùng.
import { describe, expect, it } from "vitest";
// @ts-expect-error — mô-đun .mjs không có khai báo kiểu (engineeringLayout.mjs có shebang ⇒ cổng tách ra runGate.mjs)
import { cleanupFailures, cleanupFailureLines, runPass } from "./runGate.mjs";
import * as fs from "node:fs";
import * as path from "node:path";

const okMeta = () => ({
  outboundViolations: [],
  data: { drift: {}, errors: [] },
  selfTest: { pass: true, mutationPass: true },
  fixturesRemoved: { engineering_changes: 10, engineering_change_items: 0 },
  probeUserRemoved: { deleted: 1, deactivated: 0 },
});

describe("cổng dọn của thiết bị đo", () => {
  it("dọn xong ⇒ không lỗi dọn, pass=true", () => {
    const meta = okMeta();
    expect(cleanupFailures(meta)).toEqual([]);
    expect(runPass({ errors: [], meta, args: {} })).toBe(true);
  });

  it("xoá hàng mẫu hỏng ⇒ có lỗi dọn (có chữ để in) và pass=false", () => {
    const meta = { ...okMeta(), fixturesRemoved: { error: "connection refused" } };
    const f = cleanupFailures(meta);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/hàng mẫu/);
    expect(f[0]).toMatch(/connection refused/);
    expect(runPass({ errors: [], meta, args: {} })).toBe(false);
  });

  it("xoá user đo hỏng ⇒ pass=false (cùng lớp lỗi)", () => {
    const meta = { ...okMeta(), probeUserRemoved: { error: "deadlock" } };
    expect(cleanupFailures(meta)[0]).toMatch(/user đo/);
    expect(runPass({ errors: [], meta, args: {} })).toBe(false);
  });

  it("cổng cũ giữ nguyên: lỗi trang / kết nối lạ / trôi / tự kiểm trượt ⇒ pass=false", () => {
    expect(runPass({ errors: ["x"], meta: okMeta(), args: {} })).toBe(false);
    expect(runPass({ errors: [], meta: { ...okMeta(), outboundViolations: [{}] }, args: {} })).toBe(false);
    expect(runPass({ errors: [], meta: { ...okMeta(), data: { drift: { t: [1, 2] }, errors: [] } }, args: {} })).toBe(false);
    expect(runPass({ errors: [], meta: { ...okMeta(), selfTest: { pass: false } }, args: {} })).toBe(false);
    expect(runPass({ errors: [], meta: { ...okMeta(), selfTest: { pass: true, mutationPass: false } }, args: { mutation: true } })).toBe(false);
    expect(runPass({ errors: [], meta: { ...okMeta(), selfTest: undefined }, args: { "no-selftest": true } })).toBe(true);
  });
});

// doc 81 Đợt 3b final wave (minor 4): nhánh LỖI (catch) và nhánh TÍN HIỆU (Ctrl-C …) trước đây không in lỗi dọn ⇒ hàng mẫu rò
// sau một lần đo hỏng là im lặng (chỉ lần sau `staleRemoved` mới thấy). Nay MỌI nhánh in cùng dòng `✗ DỌN HỎNG`.
describe("dòng in lỗi dọn — mọi nhánh thoát", () => {
  it("cleanupFailureLines: dọn sạch ⇒ rỗng; hỏng ⇒ một dòng ✗ DỌN HỎNG gồm mọi lỗi", () => {
    expect(cleanupFailureLines(okMeta())).toEqual([]);
    const lines = cleanupFailureLines({ ...okMeta(), fixturesRemoved: { error: "boom" }, probeUserRemoved: { error: "dead" } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^✗ DỌN HỎNG/);
    expect(lines[0]).toMatch(/boom/);
    expect(lines[0]).toMatch(/dead/);
  });

  it("engineeringLayout.mjs: nhánh thường, nhánh catch VÀ bộ xử lý tín hiệu đều in cleanupFailureLines sau khi dọn", () => {
    const src = fs.readFileSync(path.join(__dirname, "engineeringLayout.mjs"), "utf8");
    const sig = src.slice(src.indexOf('for (const sig of ["SIGINT"'), src.indexOf("try {", src.indexOf('for (const sig of ["SIGINT"')));
    expect(sig).toMatch(/await cleanup\(\);[\s\S]*cleanupFailureLines\(meta\)/);
    const katch = src.slice(src.lastIndexOf("} catch (e) {"), src.lastIndexOf("} catch (e) {") + 400);
    expect(katch).toMatch(/await cleanup\(\);[\s\S]*cleanupFailureLines\(meta\)/);
    expect(src.match(/cleanupFailureLines\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
