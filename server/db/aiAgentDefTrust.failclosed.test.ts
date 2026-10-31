/** Đợt 11.8 · T6 — kho tin cậy FAIL-CLOSED: CSDL ném/vắng ⇒ KHÔNG BAO GIỜ "tin". */
import { describe, expect, it, vi } from "vitest";

const trang = vi.hoisted(() => ({ db: "nem" as "nem" | "vang" }));
vi.mock("./connection", () => ({
  getDb: async () => {
    if (trang.db === "vang") return null;
    const nem = () => {
      throw new Error("db down");
    };
    return { select: nem, insert: nem, delete: nem };
  },
}));

import { daTinCay, danhSachTinCay, goTinCay, xacNhanTinCay } from "./aiAgentDefTrust";

const BAM = "a".repeat(64);

describe("aiAgentDefTrust fail-closed", () => {
  it("DB ném ⇒ daTinCay=false, xacNhan=false, go=0, danhSach rỗng — không ném", async () => {
    trang.db = "nem";
    expect(await daTinCay(1, "repo", "doc-ma", BAM)).toBe(false);
    expect(await xacNhanTinCay(1, "repo", "doc-ma", BAM)).toBe(false);
    expect(await goTinCay(1, "repo", "doc-ma")).toBe(0);
    expect((await danhSachTinCay(1, "repo")).size).toBe(0);
  });
  it("DB vắng ⇒ như trên", async () => {
    trang.db = "vang";
    expect(await daTinCay(1, "repo", "doc-ma", BAM)).toBe(false);
    expect(await xacNhanTinCay(1, "repo", "doc-ma", BAM)).toBe(false);
  });
});
