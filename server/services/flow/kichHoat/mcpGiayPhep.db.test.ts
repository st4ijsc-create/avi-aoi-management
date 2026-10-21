/**
 * Đợt 9 (M1) — giấy phép MOD_AI: người gọi MCP có vai ghi + hoạt động nhưng giấy phép KHÔNG gồm MOD_AI ⇒ không liệt kê, không chạy.
 * `isModuleLicensed` được GIẢ (cùng quyết định của `moduleGate` — một động cơ entitlement, xem server/_core/moduleGate.ts).
 */
import { vi } from "vitest";
const giayPhep = vi.hoisted(() => ({ coMod: true }));
vi.mock("../../../_core/moduleGate", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../../_core/moduleGate")>();
  return { ...goc, isModuleLicensed: async () => giayPhep.coMod };
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { goiToolLuongMcp, kiemNguoiGoiMcp, lietKeToolLuongMcp } from "./mcp";

const TT = `t9gp${Math.floor(Math.random() * 1e5)}`;
let uid = 0;

beforeAll(async () => {
  const db = (await getDb())!;
  const [u] = (await db.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${TT + "-u"}, ${TT + "_u"}, ${"gp"}, ${"password"}, ${"admin"}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
  uid = u.id;
});
afterAll(async () => {
  await (await getDb())?.execute(sql`DELETE FROM users WHERE id = ${uid}`);
});

describe("M1 — giấy phép MOD_AI", () => {
  it("có giấy phép ⇒ được phép; KHÔNG có MOD_AI ⇒ từ chối, danh sách rỗng, gọi tool ⇒ từ chối rõ", async () => {
    giayPhep.coMod = true;
    expect(await kiemNguoiGoiMcp({ userId: uid, role: "admin" })).toBeNull();
    giayPhep.coMod = false;
    expect(await kiemNguoiGoiMcp({ userId: uid, role: "admin" })).toMatch(/Giấy phép không gồm mô-đun AI/);
    expect(await lietKeToolLuongMcp({ userId: uid, role: "admin" })).toEqual([]);
    expect(await goiToolLuongMcp("bat-ky", {}, { userId: uid, role: "admin" })).toMatchObject({ loi: true, chu: expect.stringMatching(/Giấy phép/) });
    giayPhep.coMod = true;
  });

  it("vắng người gọi / id lạ ⇒ từ chối (đóng theo mặc định)", async () => {
    for (const ng of [null, undefined, { userId: 0, role: "admin" }, { userId: -1, role: "admin" }, { userId: 2_000_000_000, role: "admin" }]) {
      expect(await kiemNguoiGoiMcp(ng as never), JSON.stringify(ng)).toBeTruthy();
      expect(await lietKeToolLuongMcp(ng as never)).toEqual([]);
    }
  });
});
