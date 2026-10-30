/** Đợt 11.8 · M4/S7 — cổng lượt agent FAIL-CLOSED: CSDL ném/vắng ⇒ "không còn sống" (KHÔNG BAO GIỜ cho qua vì lỗi). */
import { describe, expect, it, vi } from "vitest";

const trang = vi.hoisted(() => ({ db: "nem" as "nem" | "vang" }));
vi.mock("./connection", () => ({
  getDb: async () => {
    if (trang.db === "vang") return null;
    return {
      execute: () => {
        throw new Error("db down");
      },
    };
  },
}));

import { dongTheCuaCay, luotConSong } from "./aiAgentTheDuyet";

const RUN = "11111111-1111-4111-8111-111111111111";

describe("aiAgentTheDuyet fail-closed", () => {
  it("DB ném ⇒ luotConSong=false, dongThe=0 — không ném", async () => {
    trang.db = "nem";
    expect(await luotConSong(RUN, 1)).toBe(false);
    expect(await dongTheCuaCay(RUN)).toBe(0);
  });
  it("DB vắng ⇒ như trên", async () => {
    trang.db = "vang";
    expect(await luotConSong(RUN, 1)).toBe(false);
  });
  it("tham số méo ⇒ false/0", async () => {
    expect(await luotConSong("khong-phai-uuid", 1)).toBe(false);
    expect(await luotConSong(RUN, 0)).toBe(false);
    expect(await dongTheCuaCay("x")).toBe(0);
  });
});
