/**
 * Đợt 11.8 · T6 — kho tin cậy định nghĩa agent trên CSDL THẬT (`_test`), HAI tài khoản: tin cậy của A không áp cho B.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb } from "./connection";
import { aiAgentDefTrust } from "../../drizzle/schema";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { daTinCay, danhSachTinCay, goTinCay, xacNhanTinCay } from "./aiAgentDefTrust";

const TAG = `adt_${Date.now()}`;
const BAM1 = "a".repeat(64);
const BAM2 = "b".repeat(64);
let idA = 0;
let idB = 0;
let coDb = false;

async function mkUser(tag: string): Promise<number> {
  const u = await taoNguoiDungTest(tag, "engineer", { tienTo: "adt", ten: `tin cay ${tag}`, ts: TAG });
  return u.id;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) return;
  coDb = true;
  idA = await mkUser("a");
  idB = await mkUser("b");
});

afterAll(async () => {
  const db = await getDb();
  if (!db || !coDb) return;
  await db.delete(aiAgentDefTrust).where(inArray(aiAgentDefTrust.userId, [idA, idB]));
});

describe("aiAgentDefTrust — phạm vi CHỦ (hai tài khoản)", () => {
  it("A xác nhận ⇒ A tin, B KHÔNG tin; băm khác / dự án khác / tên khác ⇒ không tin", async () => {
    if (!coDb) return;
    expect(await xacNhanTinCay(idA, "repo", "doc-ma", BAM1)).toBe(true);
    expect(await daTinCay(idA, "repo", "doc-ma", BAM1)).toBe(true);
    expect(await daTinCay(idB, "repo", "doc-ma", BAM1)).toBe(false);
    expect(await daTinCay(idA, "repo", "doc-ma", BAM2)).toBe(false);
    expect(await daTinCay(idA, "khac", "doc-ma", BAM1)).toBe(false);
    expect(await daTinCay(idA, "repo", "khac-ten", BAM1)).toBe(false);
  });
  it("xác nhận lặp là idempotent; danh sách chỉ của người gọi", async () => {
    if (!coDb) return;
    expect(await xacNhanTinCay(idA, "repo", "doc-ma", BAM1)).toBe(true);
    await xacNhanTinCay(idA, "repo", "doc-ma", BAM2);
    const a = await danhSachTinCay(idA, "repo");
    expect([...(a.get("doc-ma") ?? [])].sort()).toEqual([BAM1, BAM2]);
    expect((await danhSachTinCay(idB, "repo")).size).toBe(0);
  });
  it("gỡ tin cậy của B không đụng của A; gỡ của A xoá mọi băm của A", async () => {
    if (!coDb) return;
    await xacNhanTinCay(idB, "repo", "doc-ma", BAM1);
    expect(await goTinCay(idB, "repo", "doc-ma")).toBe(1);
    expect(await daTinCay(idA, "repo", "doc-ma", BAM1)).toBe(true);
    expect(await goTinCay(idA, "repo", "doc-ma")).toBe(2);
    expect(await daTinCay(idA, "repo", "doc-ma", BAM1)).toBe(false);
  });
  it("tham số méo ⇒ fail-closed (false/0), không ném", async () => {
    expect(await daTinCay(0, "repo", "doc-ma", BAM1)).toBe(false);
    expect(await daTinCay(1, "D:/x", "doc-ma", BAM1)).toBe(false);
    expect(await daTinCay(1, "repo", "Doc Ma", BAM1)).toBe(false);
    expect(await daTinCay(1, "repo", "doc-ma", "zz")).toBe(false);
    expect(await xacNhanTinCay(1, "repo", "doc-ma", "A".repeat(64))).toBe(false);
    expect(await goTinCay(-1, "repo", "doc-ma")).toBe(0);
  });
});
