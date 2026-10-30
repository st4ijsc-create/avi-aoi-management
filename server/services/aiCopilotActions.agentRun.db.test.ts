/**
 * ★★★ Đợt 11.8 · M4/S7 — ĐIỂM CHẶN CHUNG `confirmAction`: thẻ do agent (kể cả agent CON) chỉ duyệt được khi lượt đề xuất VÀ mọi tổ tiên còn
 * sống, cùng chủ. Đo trên CSDL THẬT, bằng thẻ dựng tay (không phụ thuộc bộ nhớ tiến trình ⇒ "sau khởi động lại" cũng bị từ chối).
 * Thẻ sống dùng `expiresAt` quá khứ ⇒ đi tới nhánh "expired" (KHÔNG thực thi gì) — đủ để thấy cổng đã CHO QUA.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiAgentRuns, aiPendingActions } from "../../drizzle/schema";
import { users, userSecrets } from "../../drizzle/schema/auth";
import { createLocalUser } from "../db/auth";
import { confirmAction } from "./aiCopilotActions";
import { dongTheCuaCay, luotConSong } from "../db/aiAgentTheDuyet";

let uid = 0;
let uid2 = 0;
const ids: string[] = [];
const user = () => ({ id: uid, role: "admin", name: "gate" });

async function mkRun(userId: number, trangThai: string, cha: string | null = null): Promise<string> {
  const db = await getDb();
  const id = randomUUID();
  await db!.insert(aiAgentRuns).values({
    id,
    userId,
    projectId: "t118gate",
    cheDo: "sua",
    cauHoi: "q",
    trangThai,
    ...(cha ? { parentRunId: cha, depth: 1, agentName: "kham-pha", agentSource: "dungSan" } : {}),
  });
  ids.push(id);
  return id;
}
async function mkThe(opts: { userId?: number; runId?: string | null; hetHan?: boolean }): Promise<string> {
  const db = await getDb();
  const id = randomUUID();
  await db!.insert(aiPendingActions).values({
    id,
    tool: "probe_khong_ton_tai",
    argsJson: {},
    userId: opts.userId ?? uid,
    userRole: "admin",
    summary: "probe",
    idempotencyKey: `k-${id}`,
    expiresAt: new Date(Date.now() + (opts.hetHan ? -3_600_000 : 3_600_000)),
    ...(opts.runId ? { agentRunId: opts.runId } : {}),
  });
  return id;
}
async function trangThaiThe(id: string): Promise<string> {
  const db = await getDb();
  const [r] = await db!.select({ s: aiPendingActions.status }).from(aiPendingActions).where(eq(aiPendingActions.id, id));
  return String(r?.s);
}

beforeAll(async () => {
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash("Mk-gate!1", 10);
  uid = (await createLocalUser({ username: `t118-gate-${Date.now()}`, passwordHash: hash, name: "gate", role: "admin" })).id;
  uid2 = (await createLocalUser({ username: `t118-gate2-${Date.now()}`, passwordHash: hash, name: "gate2", role: "admin" })).id;
}, 60_000);

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  for (const u of [uid, uid2].filter((x) => x > 0)) {
    await db.delete(aiPendingActions).where(eq(aiPendingActions.userId, u));
    await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, u));
    await db.delete(userSecrets).where(eq(userSecrets.userId, u));
  }
  await db.delete(users).where(inArray(users.id, [uid, uid2].filter((x) => x > 0)));
}, 60_000);

const CHAN = /AGENT_RUN_NOT_ACTIVE/;

describe("confirmAction — cổng lượt agent (mọi đường duyệt đều qua đây)", () => {
  it("★★★ lượt sống (dang-chay | cho-duyet) ⇒ cổng CHO QUA (đi tiếp tới nhánh hết hạn, không thực thi)", async () => {
    for (const tt of ["dang-chay", "cho-duyet"]) {
      const run = await mkRun(uid, tt);
      const the = await mkThe({ runId: run, hetHan: true });
      const r = await confirmAction(the, the, user(), "vi");
      expect(r.message ?? "", tt).not.toMatch(CHAN);
      expect(r.status, tt).toBe("expired");
    }
  });
  it("★★★ lượt đã huỷ / xong / loi / gián đoạn ⇒ TỪ CHỐI, thẻ vẫn 'proposed'", async () => {
    for (const tt of ["huy", "xong", "loi", "gian-doan"]) {
      const run = await mkRun(uid, tt);
      const the = await mkThe({ runId: run });
      const r = await confirmAction(the, the, user(), "vi");
      expect(r.ok, tt).toBe(false);
      expect(r.message ?? "", tt).toMatch(CHAN);
      expect(await trangThaiThe(the), tt).toBe("proposed");
    }
  });
  it("★★★ CON còn sống nhưng CHA đã huỷ ⇒ từ chối; cha sống + con sống ⇒ cho qua; CHÁU với ông đã chết ⇒ từ chối", async () => {
    const chaChet = await mkRun(uid, "huy");
    const conSong = await mkRun(uid, "dang-chay", chaChet);
    const the1 = await mkThe({ runId: conSong });
    expect((await confirmAction(the1, the1, user(), "vi")).message ?? "").toMatch(CHAN);

    const chaSong = await mkRun(uid, "cho-duyet");
    const con2 = await mkRun(uid, "cho-duyet", chaSong);
    const the2 = await mkThe({ runId: con2, hetHan: true });
    expect((await confirmAction(the2, the2, user(), "vi")).status).toBe("expired");

    const ong = await mkRun(uid, "xong");
    const cha3 = await mkRun(uid, "dang-chay", ong);
    const chau = await mkRun(uid, "dang-chay", cha3);
    const the3 = await mkThe({ runId: chau });
    expect((await confirmAction(the3, the3, user(), "vi")).message ?? "").toMatch(CHAN);
  });
  it("★★★ KHÔNG còn hàng sổ của lượt (đã mất / giả) ⇒ từ chối (fail-closed)", async () => {
    const the = await mkThe({ runId: randomUUID() });
    const r = await confirmAction(the, the, user(), "vi");
    expect(r.ok).toBe(false);
    expect(r.message ?? "").toMatch(CHAN);
  });
  it("★★ lượt của NGƯỜI KHÁC gắn vào thẻ của mình ⇒ từ chối (khác chủ)", async () => {
    const runNguoiKhac = await mkRun(uid2, "dang-chay");
    const the = await mkThe({ runId: runNguoiKhac });
    expect((await confirmAction(the, the, user(), "vi")).message ?? "").toMatch(CHAN);
  });
  it("★ thẻ KHÔNG gắn lượt (luồng trợ lý cũ) ⇒ không đổi hành vi", async () => {
    const the = await mkThe({ runId: null, hetHan: true });
    const r = await confirmAction(the, the, user(), "vi");
    expect(r.message ?? "").not.toMatch(CHAN);
    expect(r.status).toBe("expired");
  });
});

describe("aiAgentTheDuyet — gắn thẻ, đóng thẻ của cả cây", () => {
  it("luotConSong: đúng với lượt sống cùng chủ; sai với chủ khác / không có / id méo", async () => {
    const run = await mkRun(uid, "dang-chay");
    expect(await luotConSong(run, uid)).toBe(true);
    expect(await luotConSong(run, uid2)).toBe(false);
    expect(await luotConSong(randomUUID(), uid)).toBe(false);
    expect(await luotConSong("khong-phai-uuid", uid)).toBe(false);
  });
  it("★★★ dongTheCuaCay: huỷ thẻ 'proposed' của gốc + con + cháu, KHÔNG đụng thẻ của cây khác", async () => {
    const goc = await mkRun(uid, "dang-chay");
    const con = await mkRun(uid, "dang-chay", goc);
    const chau = await mkRun(uid, "dang-chay", con);
    const khac = await mkRun(uid, "dang-chay");
    const tGoc = await mkThe({ runId: goc });
    const tCon = await mkThe({ runId: con });
    const tChau = await mkThe({ runId: chau });
    const tKhac = await mkThe({ runId: khac });
    expect(await dongTheCuaCay(goc)).toBe(3);
    for (const t of [tGoc, tCon, tChau]) expect(await trangThaiThe(t)).toBe("cancelled");
    expect(await trangThaiThe(tKhac)).toBe("proposed");
  });
});

describe("dongTheCuaCay — chỉ thẻ 'proposed'", () => {
  it("★★★ thẻ đã executed / confirmed / denied / cancelled của cây KHÔNG bị đổi trạng thái", async () => {
    const goc = await mkRun(uid, "dang-chay");
    const con = await mkRun(uid, "dang-chay", goc);
    const db = await getDb();
    const the: Record<string, string> = {};
    for (const st of ["executed", "confirmed", "denied", "cancelled", "proposed"]) {
      const id = await mkThe({ runId: st === "proposed" ? goc : con });
      await db!.update(aiPendingActions).set({ status: st as never }).where(eq(aiPendingActions.id, id));
      the[st] = id;
    }
    expect(await dongTheCuaCay(goc)).toBe(1);
    for (const st of ["executed", "confirmed", "denied", "cancelled"]) expect(await trangThaiThe(the[st]!), st).toBe(st);
    expect(await trangThaiThe(the.proposed!)).toBe("cancelled");
  });
});

describe("CENSUS — mọi INSERT thẻ do bộ thực thi agent tạo đều mang agentRunId (không UPDATE gắn sau)", () => {
  const doc = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");
  it("proposeAction: câu INSERT 'proposed' chứa agentRunId; không còn hàm/UPDATE gắn lượt sau khi chèn", () => {
    const nd = doc("aiCopilotActions.ts");
    const i = nd.indexOf('status: "proposed",');
    expect(i).toBeGreaterThan(0);
    const khoi = nd.slice(i, i + 700);
    expect(khoi).toMatch(/agentRunId/);
    expect(doc("../db/aiAgentTheDuyet.ts")).not.toMatch(/SET "agentRunId"/);
  });
  it("bộ thực thi agent: MỌI executeDecision của đường ghi truyền agentRunId; runId không phải UUID ⇒ từ chối TRƯỚC khi đề xuất", () => {
    const nd = doc("ai/agent/boThucThiMayChu.ts");
    expect(nd).toMatch(/executeDecision\(\{ tool, args \}, \{ \.\.\.execCtx, agentRunId: ctx\.runId \}\)/);
    const iUuid = nd.indexOf("RE_UUID_LUOT.test(ctx.runId)");
    const iDe = nd.indexOf("agentRunId: ctx.runId");
    expect(iUuid).toBeGreaterThan(0);
    expect(iUuid).toBeLessThan(iDe);
  });
  it("các file khác chèn ai_pending_actions là luồng KHÔNG phải agent lập trình (ghim danh sách; file mới ⇒ đỏ)", () => {
    const goc = path.resolve(__dirname, "..");
    const co: string[] = [];
    const duyet = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules") duyet(p);
        } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
          if (/insert\(aiPendingActions\)/.test(fs.readFileSync(p, "utf8"))) co.push(path.relative(goc, p).replace(/\\/g, "/"));
        }
      }
    };
    duyet(goc);
    expect(co.sort()).toEqual(
      [
        "services/aiCopilotActions.ts", // proposeAction (mang agentRunId) + batDauApDungOClient (áp ở client, không phải agent)
        "services/edge/edgeAuthorizeCentral.ts",
        "services/orchestration/foe/foeRunStore.ts",
        "services/programming/programmingService.ts",
        "services/robot/robotAutomationAction.ts",
        "services/scada/lenhHmi.ts",
      ].sort(),
    );
  });
});

describe("CENSUS — chỉ các file này đổi trạng thái ai_pending_actions", () => {
  it("file mới ghi trạng thái thẻ ⇒ ĐỎ: phải quyết định có đi qua cổng lượt agent hay không", () => {
    const goc = path.resolve(__dirname, "..");
    const co: string[] = [];
    const duyet = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules") continue;
          duyet(p);
        } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
          const nd = fs.readFileSync(p, "utf8");
          if (/\.update\(aiPendingActions\)/.test(nd) || /UPDATE\s+(public\.)?ai_pending_actions/i.test(nd)) co.push(path.relative(goc, p).replace(/\\/g, "/"));
        }
      }
    };
    duyet(goc);
    expect(co.sort()).toEqual(
      [
        "db/aiAgentTheDuyet.ts", // gắn thẻ vào lượt + đóng thẻ của cả cây (không thực thi gì)
        "services/aiCopilotActions.ts", // CỔNG CHUNG: có kiểm lượt agent
        "services/ot/commandDispatcher.ts", // lệnh OT (agent không có công cụ này)
        "services/programming/programmingService.ts", // lập trình thiết bị (agent không có công cụ này)
        "services/robot/robotCommandDispatcher.ts", // lệnh robot (agent không có công cụ này)
        "services/scada/lenhHmi.ts", // lệnh HMI (confirmAction từ chối hmi.* cứng)
      ].sort(),
    );
  });
});
