/**
 * ★ Đợt 11.0 — công tắc `AI_AGENT_GIU_NGHI` ở HOST (quanLyLuotChay ⇒ lõi agent THẬT): mặc định BẬT (đo cửa sổ GPU #2, dieu-phoi
 * duyệt 2026-10-30) ⇒ suy luận lượt trước nằm trong lịch sử gửi model ở lượt sau (`reasoning_content`); `0`/`false`/`off`/`no`
 * ⇒ TẮT ⇒ lịch sử như cũ từng byte (không có trường). Model GIẢ phát mảnh `nghi` rồi gọi read_file; lượt 2 đọc tin nhận được.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

import type { GoiModel, ManhModel, TinNhan } from "@shared/agentCore";
import { taoQuanLyLuotChay } from "./quanLyLuotChay";
import { getDb } from "../../../db/connection";
import { aiAgentRuns } from "../../../../drizzle/schema";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";

const DU_AN = "giunghi";
const NGHI = "Cần đọc src/a.ts trước khi trả lời.";
let REPO = "";
let uid = 0;
const ENV_CU = process.env.AI_AGENT_GIU_NGHI;

/** Lượt 1: mảnh suy luận + read_file; lượt 2: trả lời. Ghi lại tin nhắn mỗi lượt nhận. */
function modelCoNghi(nhan: TinNhan[][]): GoiModel {
  let i = 0;
  return async function* (vao): AsyncGenerator<ManhModel> {
    nhan.push(vao.tinNhan.map((m) => ({ ...m })));
    if (i++ === 0) {
      yield { loai: "nghi", noiDung: NGHI };
      yield {
        loai: "xong",
        toolCalls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/a.ts" }) } }],
        usage: { vao: 100, ra: 20, nghi: 10 },
      };
      return;
    }
    yield { loai: "chu", noiDung: "Hàm cong trả a + b." };
    yield { loai: "xong", toolCalls: [], usage: { vao: 120, ra: 10, nghi: 0 } };
  };
}

async function chayHai(): Promise<TinNhan[][]> {
  const nhan: TinNhan[][] = [];
  const ql = taoQuanLyLuotChay({ goiModel: modelCoNghi(nhan) });
  const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin", name: "Ky su giu nghi" }, cauHoi: "hàm cong làm gì?", projectId: DU_AN, cheDo: "hoi" });
  expect(kq.ok).toBe(true);
  if (kq.ok) await kq.luot.xong;
  expect(nhan.length).toBe(2);
  return nhan;
}
const assistantLuot1 = (nhan: TinNhan[][]) => nhan[1]!.find((m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0);

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "giu-nghi-")));
  const git = (...a: string[]) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  fs.mkdirSync(path.join(REPO, "src"));
  fs.writeFileSync(path.join(REPO, "src/a.ts"), "export const cong = (a: number, b: number) => a + b;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=Giu nghi|${REPO}`;
  uid = (await taoNguoiDungTest("giunghi", "admin")).id;
}, 60_000);

afterEach(() => {
  if (ENV_CU === undefined) delete process.env.AI_AGENT_GIU_NGHI;
  else process.env.AI_AGENT_GIU_NGHI = ENV_CU;
});

afterAll(async () => {
  delete process.env.AI_REPO_SANDBOX_ROOTS;
  const db = await getDb();
  if (db && uid) await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
  try {
    fs.rmSync(REPO, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}, 60_000);

describe("AI_AGENT_GIU_NGHI ở host — mặc định BẬT, tắt khẩn bằng 0/false/off/no", () => {
  it("★★★ VẮNG ⇒ BẬT: lượt 2 nhận assistant lượt 1 mang reasoning_content = suy luận đã phát", async () => {
    delete process.env.AI_AGENT_GIU_NGHI;
    const a = assistantLuot1(await chayHai());
    expect(a).toBeDefined();
    expect(a!.reasoning_content).toBe(NGHI);
  }, 60_000);

  it.each(["0", "false", " OFF ", "no"])("★★★ AI_AGENT_GIU_NGHI=%j ⇒ TẮT: assistant lượt 1 KHÔNG có trường reasoning_content", async (v) => {
    process.env.AI_AGENT_GIU_NGHI = v;
    const a = assistantLuot1(await chayHai());
    expect(a).toBeDefined();
    expect(a).not.toHaveProperty("reasoning_content");
  }, 60_000);

  it("★★ giá trị khác (\"1\", \"yes\") ⇒ vẫn BẬT", async () => {
    for (const v of ["1", "yes"]) {
      process.env.AI_AGENT_GIU_NGHI = v;
      expect(assistantLuot1(await chayHai())!.reasoning_content).toBe(NGHI);
    }
  }, 60_000);
});
