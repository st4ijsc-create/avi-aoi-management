/**
 * doc 81 Đợt 3c fix 1 — `shared/factoryTime.ts` chạy trong TRÌNH DUYỆT (bộ chọn ca) ⇒ phải thuần: không import, không
 * `process`. Và client không được import RUNTIME từ `server/utils/factoryTime` (chỉ `@shared/factoryTime`). Server re-export
 * CÙNG hàm (một bản cài đặt).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as shared from "./factoryTime";
import * as server from "../server/utils/factoryTime";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("shared/factoryTime — thuần, dùng chung, một bản cài đặt", () => {
  it("tệp shared không có import nào và không đụng `process`", () => {
    const src = read("shared/factoryTime.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/\bprocess\b/);
  });

  it("server RE-EXPORT đúng hàm của shared (isValidTimeZone là CÙNG một hàm)", () => {
    expect(server.isValidTimeZone).toBe(shared.isValidTimeZone);
    const at = new Date(Date.UTC(2026, 9, 6, 3, 0, 0));
    expect(server.wallClockInZone(at, "Asia/Ho_Chi_Minh")).toEqual(shared.wallClockInZone(at, "Asia/Ho_Chi_Minh"));
    expect(shared.wallClockInZone(at, "Asia/Ho_Chi_Minh")).toMatchObject({ hour: 10, minute: 0, day: 6, month: 10, year: 2026 });
  });

  it("ProductionShifts.tsx lấy giờ nhà máy từ @shared, KHÔNG import runtime từ server/utils/factoryTime", () => {
    const src = read("client/src/pages/ProductionShifts.tsx");
    expect(src).toMatch(/from\s+["']@shared\/factoryTime["']/);
    expect(src).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s+["'][./]*server\/utils\/factoryTime["']/m);
  });
});
