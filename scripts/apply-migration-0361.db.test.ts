/**
 * doc 81 Đợt 1C Task 4 fix round 1 (#1) — CHẠY LẠI `apply-migration-0361.mjs` KHÔNG được đụng dữ liệu thật.
 *
 * Lỗi đã đo ở bản đầu: phép dò quyền (b) `INSERT … ON CONFLICT DO NOTHING` cặp (hai máy id thấp nhất)
 * rồi `DELETE` VÔ ĐIỀU KIỆN ⇒ chạy lại trên một DB đã có đúng cặp đó trong allowlist sẽ XOÁ một mục
 * allowlist thật, không audit; và trong lúc chạy cặp dò "sống" (autocommit) với mọi kết nối khác.
 *
 * Ca này chạy CHÍNH script (tiến trình con, `--test-only`, cả DATABASE_URL lẫn TEST_DATABASE_URL trỏ
 * `_test` ⇒ không đường nào tới DB dev) sau khi cài sẵn đúng cặp dò làm mục allowlist thật, rồi đo
 * bằng SELECT thô: mục ấy còn nguyên (cùng `addedBy`, `createdAt`). Ca thứ hai: không có cặp sẵn ⇒ sau
 * khi chạy cũng không còn hàng dò nào.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const SCRIPT = path.resolve(__dirname, "apply-migration-0361.mjs");
const DAU_ADDED_BY = 987_654_321; // dấu nhận diện hàng "thật" cài sẵn

let sql: ReturnType<typeof postgres>;
let g = 0;
let d = 0;
let coSan = false; // cặp đã có TRƯỚC test (không phải của test) ⇒ không xoá khi dọn

function chayScript(): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT, "--test-only"], {
    env: { ...process.env, DATABASE_URL: DB_URL, TEST_DATABASE_URL: DB_URL },
    encoding: "utf8",
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("apply-migration-0361 — chạy lại không phá allowlist thật (DB _test)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const may = await sql<{ id: number }[]>`SELECT id FROM machines ORDER BY id LIMIT 2`;
    expect(may.length).toBe(2);
    [g, d] = [may[0].id, may[1].id];
    coSan = (await sql`SELECT 1 FROM gateway_device_allowlist WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d}`).length > 0;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    if (!coSan) await sql`DELETE FROM gateway_device_allowlist WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d} AND "addedBy" = ${DAU_ADDED_BY}`;
    await sql.end({ timeout: 5 });
  });

  it("★ cặp dò TRÙNG một mục allowlist thật ⇒ chạy lại script, mục ấy CÒN NGUYÊN (addedBy, createdAt)", async () => {
    if (!coSan) {
      await sql`INSERT INTO gateway_device_allowlist ("gatewayMachineId", "deviceMachineId", "addedBy") VALUES (${g}, ${d}, ${DAU_ADDED_BY})`;
    }
    const truoc = await sql`SELECT "addedBy", "createdAt" FROM gateway_device_allowlist WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d}`;
    expect(truoc.length).toBe(1);
    const r = chayScript();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("applied + verified");
    const sau = await sql`SELECT "addedBy", "createdAt" FROM gateway_device_allowlist WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d}`;
    expect(sau).toEqual(truoc);
  }, 180_000);

  it("không có cặp sẵn ⇒ chạy script xong KHÔNG còn hàng dò nào (dò trong giao dịch hoàn tác)", async () => {
    if (coSan) return; // DB có sẵn cặp thật — ca này không dựng được mà không xoá nó
    await sql`DELETE FROM gateway_device_allowlist WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d} AND "addedBy" = ${DAU_ADDED_BY}`;
    const r = chayScript();
    expect(r.code, r.out).toBe(0);
    expect((await sql`SELECT 1 FROM gateway_device_allowlist WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d}`).length).toBe(0);
  }, 180_000);
});
