/**
 * ★ Đợt 12 H4.2 — HOST truyền `runId` của lượt chạy vào model mặc định ⇒ với AI_GHI_LUOT_DIR, bộ ghi tạo đúng `<runId>.jsonl` (một dòng
 * lượt mỗi lượt model). Engine GIẢ qua `vi.mock` (không :8091). ĐỘT BIẾN PHẢI BẮT: bỏ `runId: id` ở một trong hai điểm tạo model mặc định.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

vi.mock("../../aiGgufEngine", async (io) => ({
  ...(await io<typeof import("../../aiGgufEngine")>()),
  chatCompletionStream: async function* () {
    yield { type: "token", token: "Hàm cong trả a + b." };
    yield { type: "done", fullText: "Hàm cong trả a + b.", tokensPrompt: 14, tokensGenerated: 3, toolCalls: [] };
  },
}));

import { taoQuanLyLuotChay } from "./quanLyLuotChay";
import { getDb } from "../../../db/connection";
import { aiAgentRuns } from "../../../../drizzle/schema";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";

const DU_AN = "ghiluot";
let REPO = "";
let GHI = "";
let uid = 0;
const ENV = { dir: process.env.AI_GHI_LUOT_DIR, vt: process.env.AI_AGENT_THEO_VAI_TRO };

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ghi-luot-repo-")));
  GHI = fs.mkdtempSync(path.join(os.tmpdir(), "ghi-luot-ra-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(REPO, "a.ts"), "export const cong = (a: number, b: number) => a + b;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=Ghi luot|${REPO}`;
  process.env.AI_GHI_LUOT_DIR = GHI;
  uid = (await taoNguoiDungTest("ghiluot", "admin")).id;
}, 60_000);

afterAll(async () => {
  delete process.env.AI_REPO_SANDBOX_ROOTS;
  for (const [k, v] of [["AI_GHI_LUOT_DIR", ENV.dir], ["AI_AGENT_THEO_VAI_TRO", ENV.vt]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const db = await getDb();
  if (db && uid) await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
}, 60_000);

describe("H4.2 — host gắn runId cho bộ ghi", () => {
  it("cờ vai trò TẮT (model mặc định theo người dùng) ⇒ <runId>.jsonl có dòng đầu + lượt", async () => {
    process.env.AI_AGENT_THEO_VAI_TRO = "0";
    const kq = await taoQuanLyLuotChay({}).taoLuotChay({ user: { id: uid, role: "admin" }, cauHoi: "hàm cong làm gì?", projectId: DU_AN, cheDo: "hoi" });
    if (!kq.ok) throw new Error(`${kq.ma} ${kq.thongDiep ?? ""}`);
    await kq.luot.xong;
    const tep = path.join(GHI, `${kq.luot.id}.jsonl`);
    expect(fs.existsSync(tep)).toBe(true);
    const dong = fs.readFileSync(tep, "utf8").trim().split("\n").map((d) => JSON.parse(d) as { loai: string });
    expect(dong.map((d) => d.loai)).toEqual(["dau", "luot"]);
  }, 60_000);

  it("census — MỌI điểm tạo model mặc định trong quanLyLuotChay.ts truyền `runId: id` (cả nhánh theo vai trò)", () => {
    const s = fs.readFileSync(path.join(__dirname, "quanLyLuotChay.ts"), "utf8");
    const goi = [...s.matchAll(/taoGoiModelMayChu\(\{[^}]*\}/g)].map((m) => m[0]);
    expect(goi.length).toBe(2);
    for (const g of goi) expect(g, g).toMatch(/\brunId: id\b/);
  });
});
