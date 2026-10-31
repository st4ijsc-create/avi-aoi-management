/**
 * Đợt 12 · H5.1 — báo cáo CÓ CẤU TRÚC của agent con, đầu–cuối phía server: model giả ⇒ lõi THẬT ⇒ bộ thực thi THẬT ⇒ sổ cha–con THẬT
 * (`ai_agent_runs`) ⇒ thẻ duyệt THẬT (`ai_pending_actions`). Cờ: `phuThuoc.giaoViec.baoCao` (mặc định đọc AI_AGENT_CON_BAO_CAO=1, TẮT).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { GoiModel, ManhModel, SuKienAgent, TinNhan, WireToolCall } from "@shared/agentCore";
import { taoQuanLyLuotChay } from "./quanLyLuotChay";
import { _xoaSoBamHITL } from "../../aiLocalTools/writeHandlers/applyDiff";
import { xoaSoNganSach } from "../../aiLocalTools/repoSandbox";
import { getDb } from "../../../db/connection";
import { aiAgentRuns, aiPendingActions } from "../../../../drizzle/schema";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { createLocalUser } from "../../../db/auth";

let REPO = "";
let KHO = "";
let KHOA_CU: string | undefined;
let uid = 0;
const DU_AN = "t12h51";
const NGUOI = () => ({ id: uid, role: "admin", name: "Ky su h51" });
const tc = (id: string, name: string, args: Record<string, unknown>): WireToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const giao = tc("g1", "delegate", { agent: "kham-pha", task: "Find B" });
const BC = { status: "done", summary: "B is 1", findings: [{ note: "B equals 1", path: "src/b.ts", line: 1 }], files: ["src/b.ts"], evidence: [{ path: "src/b.ts", line: 1, quote: "export const B = 1;" }] };

interface Buoc {
  chu?: string;
  tool?: WireToolCall[];
  /** chạy trước khi trả lượt này (để thao tác DB giữa chừng) */
  truoc?: () => Promise<void>;
}
function modelKichBan(kb: Buoc[], tinNhan: TinNhan[][] = []): GoiModel {
  let i = 0;
  return async function* (vao): AsyncGenerator<ManhModel> {
    tinNhan.push(vao.tinNhan);
    const b = kb[Math.min(i++, kb.length - 1)]!;
    await b.truoc?.();
    if (b.chu) yield { loai: "chu", noiDung: b.chu };
    yield { loai: "xong", toolCalls: b.tool ?? [], usage: { vao: 100, ra: 20 } };
  };
}

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t12h51-")));
  KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t12h51-kho-")));
  process.env.AI_CHECKPOINT_DIR = KHO;
  KHOA_CU = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = "luoi-checkpoint-khoa-thu-0123456789abcdef";
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=T12H51|${REPO}`;
  const git = (...a: string[]) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  fs.mkdirSync(path.join(REPO, "src"), { recursive: true });
  fs.writeFileSync(path.join(REPO, "src", "b.ts"), "export const B = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const bcrypt = await import("bcryptjs");
  uid = (await createLocalUser({ username: `t12h51-${Date.now()}`, passwordHash: await bcrypt.hash("Mk-h51-agent!1", 10), name: "Ky su h51", role: "admin" })).id;
  xoaSoNganSach();
  _xoaSoBamHITL();
}, 60_000);

afterAll(async () => {
  delete process.env.AI_CHECKPOINT_DIR;
  if (KHOA_CU === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
  else process.env.SECRET_ENCRYPTION_KEY = KHOA_CU;
  delete process.env.AI_REPO_SANDBOX_ROOTS;
  const db = await getDb();
  if (db && uid > 0) {
    await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
    await db.delete(aiPendingActions).where(eq(aiPendingActions.userId, uid));
    await db.delete(userSecrets).where(eq(userSecrets.userId, uid));
    await db.delete(users).where(inArray(users.id, [uid]));
  }
  for (const d of [REPO, KHO]) {
    try {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}, 60_000);

async function hangSo() {
  return (await (await getDb())!.select().from(aiAgentRuns).where(eq(aiAgentRuns.userId, uid)));
}
async function chay(o: { baoCao?: boolean; env?: string; kb: Buoc[] }) {
  const cu = process.env.AI_AGENT_CON_BAO_CAO;
  if (o.env === undefined) delete process.env.AI_AGENT_CON_BAO_CAO;
  else process.env.AI_AGENT_CON_BAO_CAO = o.env;
  try {
    await (await getDb())!.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
    const tinNhan: TinNhan[][] = [];
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan(o.kb, tinNhan), giaoViec: { bat: true, ...(o.baoCao !== undefined ? { baoCao: o.baoCao } : {}) } });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "tim B", projectId: DU_AN, cheDo: "sua" });
    if (!kq.ok) throw new Error(kq.ma);
    const ev: SuKienAgent[] = [];
    ql.nghe(kq.luot.id, uid, 0, (m) => ev.push(m.suKien));
    await kq.luot.xong;
    const hang = await hangSo();
    return { kq, ev, tinNhan, cha: hang.find((h) => h.id === kq.luot.id)!, con: hang.find((h) => h.parentRunId === kq.luot.id) };
  } finally {
    if (cu === undefined) delete process.env.AI_AGENT_CON_BAO_CAO;
    else process.env.AI_AGENT_CON_BAO_CAO = cu;
  }
}
const toolDelegate = (t: TinNhan[][]) => t.at(-1)!.find((m) => m.role === "tool" && m.name === "delegate")!.content;

describe("H5.1 đầu–cuối", () => {
  it("★★★ BẬT: con đọc tệp THẬT rồi report ⇒ cha nhận khối có kiểm; sổ con = khối đó (không JSON thô); token cộng cha", async () => {
    const r = await chay({
      baoCao: true,
      kb: [{ tool: [giao] }, { tool: [tc("r1", "read_file", { path: "src/b.ts" })] }, { tool: [tc("p1", "report", BC)] }, { chu: "Cha tong ket" }],
    });
    expect(r.kq.luot.trangThai).toBe("xong");
    const t = toolDelegate(r.tinNhan);
    expect(t).toMatch(/^\[UNTRUSTED sub-agent result/);
    expect(t).toContain("Structured report — status: done");
    expect(t).not.toContain("[not touched by sub-agent]"); // read_file THẬT chạm src/b.ts
    expect(t).not.toContain('"status"');
    expect(r.con).toMatchObject({ trangThai: "xong", lyDoDung: "hoan-thanh", agentName: "kham-pha" });
    expect(r.con!.tomTat).toContain("Structured report — status: done");
    expect(r.con!.tomTat).not.toContain("{");
    const conXong = r.ev.find((e) => e.loai === "con-xong") as Extract<SuKienAgent, { loai: "con-xong" }>;
    expect(conXong.baoCao).toMatchObject({ status: "done", soKhongKiem: 0, theChoDuyet: 0 });
    expect(r.kq.luot.token.ra).toBe(80); // 4 lượt model × 20
  }, 90_000);

  it("★★★ TẮT (mặc định): con KHÔNG có report; hành vi cũ — chữ cuối, không trường baoCao", async () => {
    const r = await chay({ kb: [{ tool: [giao] }, { chu: "B bang 1" }, { chu: "Cha xong" }] });
    const t = toolDelegate(r.tinNhan);
    expect(t).toContain("B bang 1");
    expect(t).not.toMatch(/structured report/i); // cũng không có dòng "(no structured report ...)" của chế độ bật
    expect(r.con!.tomTat).toBe("B bang 1");
    const conXong = r.ev.find((e) => e.loai === "con-xong") as Extract<SuKienAgent, { loai: "con-xong" }>;
    expect(conXong).not.toHaveProperty("baoCao");
  }, 90_000);

  it("cờ môi trường AI_AGENT_CON_BAO_CAO: chỉ '1' bật (đọc khi KHÔNG tiêm baoCao)", async () => {
    const bat = await chay({ env: "1", kb: [{ tool: [giao] }, { tool: [tc("p1", "report", { status: "partial", summary: "s" })] }, { chu: "ok" }] });
    expect(toolDelegate(bat.tinNhan)).toContain("Structured report — status: partial");
    for (const v of ["0", "true", ""]) {
      const tat = await chay({ env: v, kb: [{ tool: [giao] }, { chu: "chu cuoi" }, { chu: "ok" }] });
      expect(toolDelegate(tat.tinNhan), v).not.toMatch(/structured report/i);
    }
  }, 120_000);

  it("★★★ con report khi còn thẻ duyệt CHỜ của chính nó ⇒ con kết thúc, thẻ bị ĐÓNG ('cancelled') qua đường đóng-cây, cha được báo", async () => {
    let idCon = "";
    let idThe = "";
    let trangThaiKhiChaTiep = "";
    const r = await chay({
      baoCao: true,
      kb: [
        { tool: [giao] },
        {
          // lượt đầu của CON: chèn thẻ 'proposed' gắn lượt con (mô phỏng thẻ còn chờ khi con gọi report), rồi gọi report
          truoc: async () => {
            const db = (await getDb())!;
            const [con] = await db.select().from(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
            const hangCon = (await db.select().from(aiAgentRuns).where(eq(aiAgentRuns.userId, uid))).find((h) => h.parentRunId !== null) ?? con!;
            idCon = hangCon.id;
            idThe = randomUUID();
            await db.insert(aiPendingActions).values({
              id: idThe,
              tool: "apply_diff",
              argsJson: { path: "src/b.ts" },
              userId: uid,
              userRole: "admin",
              summary: "h51 test",
              status: "proposed",
              idempotencyKey: `h51-${idThe}`,
              expiresAt: new Date(Date.now() + 3_600_000),
              agentRunId: idCon,
            });
          },
          tool: [tc("p1", "report", { status: "partial", summary: "proposed a change" })],
        },
        {
          // lượt kế của CHA — chạy NGAY sau khi con kết thúc, TRƯỚC khi lượt gốc kết thúc ⇒ phân biệt "đóng khi con xong" với "đóng khi gốc xong"
          truoc: async () => {
            trangThaiKhiChaTiep = String((await (await getDb())!.select().from(aiPendingActions).where(eq(aiPendingActions.id, idThe)))[0]?.status);
          },
          chu: "Cha xong",
        },
      ],
    });
    expect(trangThaiKhiChaTiep).toBe("cancelled");
    expect(idCon).not.toBe("");
    const the = (await (await getDb())!.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, idCon)))[0]!;
    expect(the.parentRunId).toBe(r.kq.luot.id);
    const hangThe = (await (await getDb())!.select().from(aiPendingActions).where(eq(aiPendingActions.id, idThe)))[0]!;
    expect(hangThe.status).toBe("cancelled");
    expect(r.con).toMatchObject({ trangThai: "xong", lyDoDung: "hoan-thanh" });
  }, 90_000);

  it("KHÔNG báo cáo ⇒ không đóng thẻ của con ở bước kết thúc con (hành vi cũ; thẻ chỉ bị đóng khi lượt GỐC kết thúc)", async () => {
    let idThe = "";
    let trangThaiKhiChaTiep = "";
    const r = await chay({
      baoCao: true,
      kb: [
        { tool: [giao] },
        {
          truoc: async () => {
            const db = (await getDb())!;
            const hangCon = (await db.select().from(aiAgentRuns).where(eq(aiAgentRuns.userId, uid))).find((h) => h.parentRunId !== null)!;
            idThe = randomUUID();
            await db.insert(aiPendingActions).values({
              id: idThe,
              tool: "apply_diff",
              argsJson: { path: "src/b.ts" },
              userId: uid,
              userRole: "admin",
              summary: "h51 test 2",
              status: "proposed",
              idempotencyKey: `h51-${idThe}`,
              expiresAt: new Date(Date.now() + 3_600_000),
              agentRunId: hangCon.id,
            });
          },
          chu: "xong khong report",
        },
        {
          truoc: async () => {
            trangThaiKhiChaTiep = String((await (await getDb())!.select().from(aiPendingActions).where(eq(aiPendingActions.id, idThe)))[0]?.status);
          },
          chu: "Cha xong",
        },
      ],
    });
    expect(trangThaiKhiChaTiep).toBe("proposed"); // không report ⇒ con kết thúc KHÔNG đóng thẻ (hành vi cũ)
    expect(toolDelegate(r.tinNhan)).toContain("no structured report");
    // lượt gốc đã kết thúc ⇒ dongTheCuaCay(gốc) đóng nốt (lớp thứ hai M4) — chỉ khẳng định thẻ không còn 'proposed' sau khi cả cây xong
    const hangThe = (await (await getDb())!.select().from(aiPendingActions).where(eq(aiPendingActions.id, idThe)))[0]!;
    expect(hangThe.status).toBe("cancelled");
  }, 90_000);
});
