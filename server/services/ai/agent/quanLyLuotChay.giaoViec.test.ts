/**
 * ★★★ Đợt 11.8 · T6 — GIAO VIỆC CHO AGENT CON, đầu–cuối phía server: model giả ⇒ lõi THẬT ⇒ bộ thực thi THẬT ⇒ sổ cha–con THẬT
 * (`ai_agent_runs` mig 0441) ⇒ tin-lần-đầu THẬT (`ai_agent_def_trust`) ⇒ cửa duyệt THẬT (M4).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Công tắc giả lỗi ghi sổ CON (chỉ hàng có `con`); mặc định gọi hàm thật. */
const gia = vi.hoisted(() => ({ soConLoi: false }));
vi.mock("../../../db/aiAgentRuns", async (goc) => {
  const that = await goc<typeof import("../../../db/aiAgentRuns")>();
  return { ...that, taoHangLuotChay: (h: Parameters<typeof that.taoHangLuotChay>[0]) => (gia.soConLoi && h.con ? Promise.resolve(false) : that.taoHangLuotChay(h)) };
});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { capNhatHangLuotChay, taoHangLuotChay } from "../../../db/aiAgentRuns";

import { bamNoiDung, type GoiModel, type ManhModel, type SuKienAgent, type TinNhan, type WireToolCall } from "@shared/agentCore";
import { choPhepGiaoViec, giaoViecBat, taoQuanLyLuotChay } from "./quanLyLuotChay";
import { taoBoThucThiMayChu } from "./boThucThiMayChu";
import { congCheckpointThat } from "./quanLyLuotChay";
import { confirmAction } from "../../aiCopilotActions";
import { thuTucDuyet } from "./thuTucLuotChay";
import { _xoaSoBamHITL } from "../../aiLocalTools/writeHandlers/applyDiff";
import { xoaSoNganSach } from "../../aiLocalTools/repoSandbox";
import { getDb } from "../../../db/connection";
import { aiAgentDefTrust, aiAgentRuns, aiPendingActions } from "../../../../drizzle/schema";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { createLocalUser } from "../../../db/auth";
import { xacNhanTinCay } from "../../../db/aiAgentDefTrust";

let REPO = "";
let KHO = "";
let KHOA_CU: string | undefined;
let uid = 0;
let uid2 = 0;
const DU_AN = "t118gv";
const NGUOI = () => ({ id: uid, role: "admin", name: "Ky su gv" });
const doc = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const git = (...a: string[]) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });

const tc = (id: string, name: string, args: Record<string, unknown>): WireToolCall => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

interface Buoc {
  chu?: string;
  tool?: WireToolCall[];
  treo?: boolean;
}
/** MỘT kịch bản tuần tự dùng chung cho cha và con (con dùng chính goiModel của cha). */
function modelKichBan(kb: Buoc[], theoDoi?: { congCu: string[][]; tinNhan: TinNhan[][] }): GoiModel {
  let i = 0;
  return async function* (vao): AsyncGenerator<ManhModel> {
    theoDoi?.congCu.push(vao.congCu.map((t) => t.function.name));
    theoDoi?.tinNhan.push(vao.tinNhan);
    const b = kb[Math.min(i++, kb.length - 1)]!;
    if (b.treo) await new Promise<void>((r) => vao.signal.addEventListener("abort", () => r(), { once: true }));
    if (b.chu) yield { loai: "chu", noiDung: b.chu };
    yield { loai: "xong", toolCalls: b.tool ?? [], usage: { vao: 100, ra: 20 } };
  };
}

const giao = (agent: string, task: string) => tc("g1", "delegate", { agent, task });
const BAT = { bat: true } as const;

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t118-gv-")));
  KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t118-gv-kho-")));
  process.env.AI_CHECKPOINT_DIR = KHO;
  KHOA_CU = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = "luoi-checkpoint-khoa-thu-0123456789abcdef";
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=T118 GV|${REPO}`;
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  fs.mkdirSync(path.join(REPO, "src"), { recursive: true });
  fs.writeFileSync(path.join(REPO, "src", "b.ts"), "export const B = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash("Mk-gv-agent!1", 10);
  uid = (await createLocalUser({ username: `t118-gv-${Date.now()}`, passwordHash: hash, name: "Ky su gv", role: "admin" })).id;
  uid2 = (await createLocalUser({ username: `t118-gv2-${Date.now()}`, passwordHash: hash, name: "Ky su gv2", role: "admin" })).id;
  xoaSoNganSach();
  _xoaSoBamHITL();
}, 60_000);

afterAll(async () => {
  delete process.env.AI_CHECKPOINT_DIR;
  if (KHOA_CU === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
  else process.env.SECRET_ENCRYPTION_KEY = KHOA_CU;
  delete process.env.AI_REPO_SANDBOX_ROOTS;
  const db = await getDb();
  if (db) {
    const ids = [uid, uid2].filter((x) => x > 0);
    for (const u of ids) {
      await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, u));
      await db.delete(aiAgentDefTrust).where(eq(aiAgentDefTrust.userId, u));
      await db.delete(aiPendingActions).where(eq(aiPendingActions.userId, u));
      await db.delete(userSecrets).where(eq(userSecrets.userId, u));
    }
    if (ids.length) await db.delete(users).where(inArray(users.id, ids));
  }
  for (const d of [REPO, KHO]) {
    try {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}, 60_000);

async function hangSo(userId: number) {
  const db = await getDb();
  return db!.select().from(aiAgentRuns).where(eq(aiAgentRuns.userId, userId));
}
async function xoaSo(userId: number) {
  const db = await getDb();
  await db!.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, userId));
}

describe("công tắc AI_AGENT_GIAO_VIEC (mặc định TẮT)", () => {
  it("giaoViecBat chỉ đọc đúng '1'", () => {
    expect(giaoViecBat({} as NodeJS.ProcessEnv)).toBe(false);
    expect(giaoViecBat({ AI_AGENT_GIAO_VIEC: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(giaoViecBat({ AI_AGENT_GIAO_VIEC: "true" } as NodeJS.ProcessEnv)).toBe(false);
    expect(giaoViecBat({ AI_AGENT_GIAO_VIEC: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
  it("★★★ TẮT: model KHÔNG thấy tool delegate; model bịa delegate ⇒ bị từ chối, 0 hàng sổ con", async () => {
    await xoaSo(uid);
    const theo = { congCu: [] as string[][], tinNhan: [] as TinNhan[][] };
    const ql = taoQuanLyLuotChay({
      goiModel: modelKichBan([{ tool: [giao("kham-pha", "t")] }, { chu: "xong" }], theo),
      giaoViec: { bat: false },
    });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "x", projectId: DU_AN, cheDo: "sua" });
    if (!kq.ok) throw new Error(kq.ma);
    await kq.luot.xong;
    expect(theo.congCu[0]).not.toContain("delegate");
    const t = theo.tinNhan[1]!.find((m) => m.role === "tool" && m.name === "delegate");
    expect(t?.content).toMatch(/not available/i);
    expect((await hangSo(uid)).filter((h) => h.parentRunId !== null)).toEqual([]);
  }, 60_000);
});

describe("đầu–cuối: cha → con (agent dựng sẵn)", () => {
  it("★★★ BẬT: con đọc tệp, sổ cha–con đủ cột, token cộng cha, cha chỉ nhận tóm tắt UNTRUSTED", async () => {
    await xoaSo(uid);
    const theo = { congCu: [] as string[][], tinNhan: [] as TinNhan[][] };
    const ql = taoQuanLyLuotChay({
      goiModel: modelKichBan(
        [
          { tool: [giao("kham-pha", "Find B")] }, // cha t0
          { tool: [tc("r1", "read_file", { path: "src/b.ts" })] }, // con t0
          { chu: "B equals 1" }, // con t1
          { chu: "Con noi B bang 1." }, // cha t1
        ],
        theo,
      ),
      giaoViec: BAT,
    });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "tim B", projectId: DU_AN, cheDo: "sua" });
    if (!kq.ok) throw new Error(kq.ma);
    const ev: SuKienAgent[] = [];
    const ketThucKhiConXong: Array<number | null> = [];
    const lyDoKhiConXong: Array<string | null> = [];
    ql.nghe(kq.luot.id, uid, 0, (m) => {
      ev.push(m.suKien);
      if (m.suKien.loai === "su-kien-con" && m.suKien.suKien.loai === "xong") {
        ketThucKhiConXong.push(kq.luot.ketThuc);
        lyDoKhiConXong.push(kq.luot.lyDoDung);
      }
    });
    await kq.luot.xong;
    expect(kq.luot.trangThai).toBe("xong");
    // `xong` của CON không kết thúc lượt cha (chưa đóng, chưa có lý do)
    expect(ketThucKhiConXong).toEqual([null]);
    expect(lyDoKhiConXong).toEqual([null]);
    expect(theo.congCu[0]).toContain("delegate");
    // sổ
    const hang = await hangSo(uid);
    const cha = hang.find((h) => h.id === kq.luot.id)!;
    const con = hang.find((h) => h.parentRunId === kq.luot.id)!;
    expect(cha.parentRunId).toBeNull();
    expect(cha.depth).toBe(0);
    expect(con).toMatchObject({ depth: 1, agentName: "kham-pha", agentSource: "dungSan", cheDo: "hoi", userId: uid, trangThai: "xong", lyDoDung: "hoan-thanh" });
    expect(con.tomTat).toBe("B equals 1");
    // token: cha 2 lượt × 20 + con 2 lượt × 20
    expect(kq.luot.token.ra).toBe(80);
    // cha chỉ thấy tóm tắt có nhãn UNTRUSTED, không thấy quan sát đọc tệp của con
    const t = theo.tinNhan[3]!.find((m) => m.role === "tool" && m.name === "delegate")!;
    expect(t.content).toMatch(/^\[UNTRUSTED sub-agent result/);
    expect(t.content).toContain("B equals 1");
    expect(JSON.stringify(theo.tinNhan[3])).not.toContain("export const B");
    // sự kiện con bọc; chỉ một `xong` ở mức cha
    expect(ev.filter((e) => e.loai === "xong").length).toBe(1);
    expect(ev.some((e) => e.loai === "con-bat-dau" && e.runIdCon === con.id)).toBe(true);
    expect(ev.some((e) => e.loai === "su-kien-con" && e.runIdCon === con.id)).toBe(true);
  }, 60_000);

  it("con của người khác không đọc được qua docHang: sổ con thuộc đúng chủ", async () => {
    const hang = await hangSo(uid);
    expect(hang.filter((h) => h.parentRunId !== null).every((h) => h.userId === uid)).toBe(true);
    expect(await hangSo(uid2)).toEqual([]);
  });
});

describe("tin-lần-đầu theo băm (định nghĩa từ repo)", () => {
  const dinhNghia = (them = "") =>
    `---\nname: x-duyet\ndescription: Doc B\ntools: [read_file]\napproval: hoi\n${them}---\nYou read files.\n`;

  it("★★★ chưa xác nhận ⇒ KHÔNG bắt đầu con, KHÔNG hàng sổ con; xác nhận đúng băm ⇒ chạy; đổi nội dung ⇒ lại bị chặn", async () => {
    await xoaSo(uid);
    fs.mkdirSync(path.join(REPO, ".thoca", "agents"), { recursive: true });
    fs.writeFileSync(path.join(REPO, ".thoca", "agents", "x-duyet.md"), dinhNghia());

    // 1) chưa tin
    const theo1 = { congCu: [] as string[][], tinNhan: [] as TinNhan[][] };
    const ql1 = taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [giao("x-duyet", "doc")] }, { chu: "xong" }], theo1), giaoViec: BAT });
    const a = await ql1.taoLuotChay({ user: NGUOI(), cauHoi: "q", projectId: DU_AN, cheDo: "sua" });
    if (!a.ok) throw new Error(a.ma);
    await a.luot.xong;
    expect(theo1.tinNhan[1]!.find((m) => m.role === "tool" && m.name === "delegate")!.content).toMatch(/DINH_NGHIA_CHUA_TIN/);
    expect((await hangSo(uid)).filter((h) => h.parentRunId !== null)).toEqual([]);

    // 2) người KHÁC xác nhận ⇒ vẫn chưa tin với uid
    await xacNhanTinCay(uid2, DU_AN, "x-duyet", bamNoiDung(dinhNghia()));
    const b = await taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [giao("x-duyet", "doc")] }, { chu: "xong" }], { congCu: [], tinNhan: [] }), giaoViec: BAT }).taoLuotChay({ user: NGUOI(), cauHoi: "q", projectId: DU_AN, cheDo: "sua" });
    if (!b.ok) throw new Error(b.ma);
    await b.luot.xong;
    expect((await hangSo(uid)).filter((h) => h.parentRunId !== null)).toEqual([]);

    // 3) chính uid xác nhận đúng băm ⇒ chạy, nguồn tuRepo
    expect(await xacNhanTinCay(uid, DU_AN, "x-duyet", bamNoiDung(dinhNghia()))).toBe(true);
    const ql3 = taoQuanLyLuotChay({
      goiModel: modelKichBan([{ tool: [giao("x-duyet", "doc")] }, { tool: [tc("r", "read_file", { path: "src/b.ts" })] }, { chu: "da doc" }, { chu: "hoan tat" }]),
      giaoViec: BAT,
    });
    const c = await ql3.taoLuotChay({ user: NGUOI(), cauHoi: "q", projectId: DU_AN, cheDo: "sua" });
    if (!c.ok) throw new Error(c.ma);
    await c.luot.xong;
    const con = (await hangSo(uid)).find((h) => h.parentRunId === c.luot.id)!;
    expect(con).toMatchObject({ agentName: "x-duyet", agentSource: "tuRepo", cheDo: "hoi" });

    // 4) tệp đổi sau khi tin ⇒ băm lệch ⇒ chặn lại (KHÔNG đệm)
    fs.writeFileSync(path.join(REPO, ".thoca", "agents", "x-duyet.md"), dinhNghia("max_turns: 2\n"));
    await xoaSo(uid);
    const theo4 = { congCu: [] as string[][], tinNhan: [] as TinNhan[][] };
    const d = await taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [giao("x-duyet", "doc")] }, { chu: "xong" }], theo4), giaoViec: BAT }).taoLuotChay({ user: NGUOI(), cauHoi: "q", projectId: DU_AN, cheDo: "sua" });
    if (!d.ok) throw new Error(d.ma);
    await d.luot.xong;
    expect(theo4.tinNhan[1]!.find((m) => m.role === "tool" && m.name === "delegate")!.content).toMatch(/DINH_NGHIA_CHUA_TIN/);
    expect((await hangSo(uid)).filter((h) => h.parentRunId !== null)).toEqual([]);
  }, 90_000);
});

describe("sổ kiểm toán cha–con", () => {
  it("★★★ KHÔNG ghi được hàng sổ của con ⇒ con KHÔNG chạy (SO_CON_LOI), cha vẫn kết thúc bình thường", async () => {
    await xoaSo(uid);
    gia.soConLoi = true;
    try {
      const theo = { congCu: [] as string[][], tinNhan: [] as TinNhan[][] };
      const ev: SuKienAgent[] = [];
      const ql = taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [giao("kham-pha", "t")] }, { chu: "xong" }], theo), giaoViec: BAT });
      const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "q", projectId: DU_AN, cheDo: "sua" });
      if (!kq.ok) throw new Error(kq.ma);
      ql.nghe(kq.luot.id, uid, 0, (m) => ev.push(m.suKien));
      await kq.luot.xong;
      expect(kq.luot.trangThai).toBe("xong");
      expect(theo.tinNhan[1]!.find((m) => m.role === "tool" && m.name === "delegate")!.content).toMatch(/SO_CON_LOI/);
      expect(ev.some((e) => e.loai === "con-bat-dau" || e.loai === "su-kien-con")).toBe(false);
      expect(theo.congCu.length).toBe(2); // chỉ model của cha được gọi, không có lượt model nào của con
    } finally {
      gia.soConLoi = false;
    }
  }, 60_000);
});

describe("model của con", () => {
  it("định nghĩa đã tin cậy nhưng xin model khác 'auto' ⇒ MODEL_CON_CHUA_HO_TRO, không hàng sổ con", async () => {
    await xoaSo(uid);
    const dn = ["---", "name: m-khac", "description: d", "tools: [read_file]", "model: vai-tro:code.software", "---", "body", ""].join("\n");
    fs.mkdirSync(path.join(REPO, ".thoca", "agents"), { recursive: true });
    fs.writeFileSync(path.join(REPO, ".thoca", "agents", "m-khac.md"), dn);
    await xacNhanTinCay(uid, DU_AN, "m-khac", bamNoiDung(dn));
    const theo = { congCu: [] as string[][], tinNhan: [] as TinNhan[][] };
    const kq = await taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [giao("m-khac", "t")] }, { chu: "xong" }], theo), giaoViec: BAT }).taoLuotChay({
      user: NGUOI(),
      cauHoi: "q",
      projectId: DU_AN,
      cheDo: "sua",
    });
    if (!kq.ok) throw new Error(kq.ma);
    await kq.luot.xong;
    expect(theo.tinNhan[1]!.find((m) => m.role === "tool" && m.name === "delegate")!.content).toMatch(/MODEL_CON_CHUA_HO_TRO/);
    expect((await hangSo(uid)).filter((h) => h.parentRunId !== null)).toEqual([]);
  }, 60_000);
});

describe("M4/S7 — thẻ duyệt của agent con đi qua cổng CHUNG của confirmAction", () => {
  it("★★★ con ghi tệp ⇒ thẻ GẮN lượt con (cột agentRunId) và cần NGƯỜI; duyệt ⇒ tệp đổi", async () => {
    await xoaSo(uid);
    const ql = taoQuanLyLuotChay({
      goiModel: modelKichBan([
        { tool: [giao("viet-test", "tao tep")] },
        { tool: [tc("w1", "write_file", { path: "src/moi.test.ts", content: "export const T = 1;\n" })] },
        { chu: "da tao" },
        { chu: "xong" },
      ]),
      giaoViec: BAT,
      phuThuocBoThucThi: { nhipKiemMs: 50 },
    });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "viet test", projectId: DU_AN, cheDo: "sua" });
    if (!kq.ok) throw new Error(kq.ma);
    let khiCho = "";
    let gan: string | null | undefined;
    ql.nghe(kq.luot.id, uid, 0, (m) => {
      const e = m.suKien;
      if (e.loai === "su-kien-con" && e.suKien.loai === "can-duyet") {
        const id = String(e.suKien.deXuat.pendingActionId);
        khiCho = kq.luot.trangThai;
        void (async () => {
          const db = await getDb();
          const [h] = await db!.select({ r: aiPendingActions.agentRunId }).from(aiPendingActions).where(eq(aiPendingActions.id, id));
          gan = h?.r;
          await thuTucDuyet(NGUOI(), { actionId: id, lang: "vi" });
        })();
      }
    });
    await kq.luot.xong;
    expect(khiCho).toBe("cho-duyet");
    const con = (await hangSo(uid)).find((h) => h.parentRunId === kq.luot.id)!;
    expect(gan).toBe(con.id);
    expect(doc("src/moi.test.ts")).toBe("export const T = 1;\n");
  }, 60_000);

  it("★★★ huỷ cha trong lúc con chờ duyệt ⇒ thẻ bị đóng; MỞ LẠI thẻ (đua) rồi duyệt qua BẤT KỲ đường nào ⇒ AGENT_RUN_NOT_ACTIVE, tệp KHÔNG ghi", async () => {
    await xoaSo(uid);
    const ql = taoQuanLyLuotChay({
      goiModel: modelKichBan([
        { tool: [giao("viet-test", "tao tep")] },
        { tool: [tc("w2", "write_file", { path: "src/khong-duoc.ts", content: "export const X = 1;\n" })] },
        { chu: "x" },
      ]),
      giaoViec: BAT,
      phuThuocBoThucThi: { nhipKiemMs: 50 },
    });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "viet", projectId: DU_AN, cheDo: "sua" });
    if (!kq.ok) throw new Error(kq.ma);
    let actionId = "";
    ql.nghe(kq.luot.id, uid, 0, (m) => {
      const e = m.suKien;
      if (e.loai === "su-kien-con" && e.suKien.loai === "can-duyet") actionId = String(e.suKien.deXuat.pendingActionId);
    });
    for (let i = 0; i < 100 && actionId === ""; i++) await new Promise((r) => setTimeout(r, 50));
    expect(actionId).not.toBe("");
    ql.huy(kq.luot.id, uid);
    await kq.luot.xong;
    expect(kq.luot.trangThai).toBe("huy");
    const db = await getDb();
    const trangThai = async () => String((await db!.select({ s: aiPendingActions.status }).from(aiPendingActions).where(eq(aiPendingActions.id, actionId)))[0]?.s);
    expect(await trangThai()).toBe("cancelled"); // đã bị đóng khi cha kết thúc
    // mở lại thẻ như một cuộc đua (thẻ còn 'proposed' sau khi lượt chết) — cổng CHUNG phải chặn
    await db!.update(aiPendingActions).set({ status: "proposed" }).where(eq(aiPendingActions.id, actionId));
    const r1 = await thuTucDuyet(NGUOI(), { actionId, lang: "vi" });
    expect(r1.ok).toBe(false);
    expect(r1.message ?? "").toMatch(/AGENT_RUN_NOT_ACTIVE/);
    const r2 = await confirmAction(actionId, actionId, { id: uid, role: "admin", name: "x" }, "vi"); // đường hộp thư (aiCopilot.confirmAction)
    expect(r2.ok).toBe(false);
    expect(r2.message ?? "").toMatch(/AGENT_RUN_NOT_ACTIVE/);
    expect(await trangThai()).toBe("proposed");
    expect(fs.existsSync(path.join(REPO, "src", "khong-duoc.ts"))).toBe(false);
    const con = (await hangSo(uid)).find((h) => h.parentRunId === kq.luot.id);
    expect(con?.trangThai).toBe("huy");
  }, 60_000);

  it("★★★ 'khởi động lại' (bộ quản lý MỚI, bộ nhớ rỗng): thẻ con của cha đã huỷ vẫn bị từ chối", async () => {
    await xoaSo(uid);
    const qlCu = taoQuanLyLuotChay({
      goiModel: modelKichBan([{ tool: [giao("viet-test", "t")] }, { tool: [tc("w3", "write_file", { path: "src/sau-restart.ts", content: "x\n" })] }, { chu: "x" }]),
      giaoViec: BAT,
      phuThuocBoThucThi: { nhipKiemMs: 50 },
    });
    const kq = await qlCu.taoLuotChay({ user: NGUOI(), cauHoi: "v", projectId: DU_AN, cheDo: "sua" });
    if (!kq.ok) throw new Error(kq.ma);
    let actionId = "";
    qlCu.nghe(kq.luot.id, uid, 0, (m) => {
      const e = m.suKien;
      if (e.loai === "su-kien-con" && e.suKien.loai === "can-duyet") actionId = String(e.suKien.deXuat.pendingActionId);
    });
    for (let i = 0; i < 100 && actionId === ""; i++) await new Promise((r) => setTimeout(r, 50));
    qlCu.huy(kq.luot.id, uid);
    await kq.luot.xong;
    const db = await getDb();
    await db!.update(aiPendingActions).set({ status: "proposed" }).where(eq(aiPendingActions.id, actionId));
    taoQuanLyLuotChay({ giaoViec: BAT }); // bộ quản lý mới: không giữ gì trong bộ nhớ
    const r = await confirmAction(actionId, actionId, { id: uid, role: "admin", name: "x" }, "vi");
    expect(r.message ?? "").toMatch(/AGENT_RUN_NOT_ACTIVE/);
    expect(fs.existsSync(path.join(REPO, "src", "sau-restart.ts"))).toBe(false);
  }, 60_000);
});

describe("M1 — cha dùng model ngoài thì KHÔNG phơi delegate", () => {
  it("choPhepGiaoViec: ngoai: (mọi kiểu hoa-thường/khoảng trắng) ⇒ false dù cờ bật; cục bộ/auto ⇒ theo cờ", () => {
    for (const m of ["ngoai:openai:gpt", " NGOAI:x:y", "Ngoai:a:b"]) expect(choPhepGiaoViec({ bat: true, chonModel: m }), m).toBe(false);
    for (const m of [undefined, "auto", "vai-tro:code.software", "ho-so:qwen"]) expect(choPhepGiaoViec({ bat: true, chonModel: m }), String(m)).toBe(true);
    expect(choPhepGiaoViec({ bat: false, chonModel: "auto" })).toBe(false);
    expect(choPhepGiaoViec({ chonModel: "auto" }, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(choPhepGiaoViec({ chonModel: "auto" }, { AI_AGENT_GIAO_VIEC: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("N2 — sự kiện của con KHÔNG đổi trạng thái cha", () => {
  it("con gọi 3 công cụ: soLuot của cha chỉ đếm lượt CỦA CHA; sổ con ghi đúng số lượt của con", async () => {
    await xoaSo(uid);
    const ql = taoQuanLyLuotChay({
      goiModel: modelKichBan([
        { tool: [giao("kham-pha", "tim")] }, // cha lượt 1
        { tool: [tc("r1", "read_file", { path: "src/b.ts" })] }, // con 1
        { tool: [tc("r2", "list_dir", { path: "src" })] }, // con 2
        { tool: [tc("r3", "grep", { pattern: "B" })] }, // con 3
        { chu: "xong con" }, // con 4
        { chu: "xong cha" }, // cha lượt 2
      ]),
      giaoViec: BAT,
    });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "q", projectId: DU_AN, cheDo: "sua" });
    if (!kq.ok) throw new Error(kq.ma);
    await kq.luot.xong;
    expect(kq.luot.soLuot).toBe(1); // cha chỉ có 1 lượt gọi-tool (delegate); con có 3
    const hang = await hangSo(uid);
    expect(hang.find((h) => h.parentRunId === kq.luot.id)!.soLuot).toBe(4);
  }, 60_000);
});

describe("S5 — delegate KHÔNG BAO GIỜ tới bộ thực thi", () => {
  it("bộ thực thi nhận delegate (kể cả khi cờ phơi bật) ⇒ CONG_CU_BI_AN, không chạm gì", async () => {
    const nguoi = { id: 1, role: "admin", name: "x" };
    for (const coGiaoViec of [true, false]) {
      const bo = taoBoThucThiMayChu({
        execCtx: { user: nguoi, lang: "vi", projectRoot: REPO },
        gocDuAn: REPO,
        projectId: DU_AN,
        user: nguoi,
        coQuyenThucThi: false,
        checkpoint: null,
        coGiaoViec,
        phuThuoc: { executeDecision: (async () => ({ error: "khong" })) as never, kiemKillSwitch: async () => false },
      });
      const r = await bo.chay(
        { id: "d", ten: "delegate", thamSo: { agent: "kham-pha", task: "t" } },
        { cheDo: "sua", runId: "r", luot: 1, signal: new AbortController().signal, phat: () => undefined },
      );
      expect(r).toMatchObject({ ok: false, ma: "CONG_CU_BI_AN" });
    }
  });
});

describe("S7 — lượt đề xuất đi vào CHÍNH câu INSERT thẻ", () => {
  const nguoi = { id: 1, role: "admin", name: "x" };
  const dung = (executeDecision: unknown) =>
    taoBoThucThiMayChu({
      execCtx: { user: nguoi, lang: "vi", projectRoot: REPO },
      gocDuAn: REPO,
      projectId: DU_AN,
      user: nguoi,
      coQuyenThucThi: false,
      checkpoint: { chupTruocGhi: async () => ({ id: "cp" }), chotSauGhi: async () => undefined },
      phuThuoc: { executeDecision: executeDecision as never, kiemKillSwitch: async () => false },
    });
  const ctx = (runId: string) => ({ cheDo: "sua" as const, runId, luot: 1, signal: new AbortController().signal, phat: () => undefined });

  it("★★★ executeDecision nhận execCtx.agentRunId = runId của lượt (cha hay con)", async () => {
    const thay: Array<string | undefined> = [];
    const bo = dung(async (_d: unknown, c: { agentRunId?: string }) => {
      thay.push(c.agentRunId);
      return { error: "dung o day" };
    });
    const run = "11111111-1111-4111-8111-111111111111";
    await bo.chay({ id: "w", ten: "write_file", thamSo: { path: "src/x.ts", content: "x\n" } }, ctx(run));
    await bo.chay({ id: "r", ten: "run_command", thamSo: { command: "node --version" } }, ctx("22222222-2222-4222-8222-222222222222"));
    expect(thay).toEqual([run, "22222222-2222-4222-8222-222222222222"]);
  });
  it("★★★ runId không phải UUID ⇒ TỪ CHỐI trước khi đề xuất (executeDecision không được gọi)", async () => {
    let goi = 0;
    const bo = dung(async () => {
      goi++;
      return { error: "x" };
    });
    const r = await bo.chay({ id: "w", ten: "write_file", thamSo: { path: "src/x.ts", content: "x\n" } }, ctx("khong-phai-uuid"));
    expect(r).toMatchObject({ ok: false, ma: "LOI_DE_XUAT" });
    expect(goi).toBe(0);
  });
});

describe("M4 — đua: con tạo thẻ SAU khi cha đã kết thúc", () => {
  it("★★★ cha 'huy' + con còn thức tạo thẻ thật ⇒ thẻ mang agentRunId của con và KHÔNG duyệt được (AGENT_RUN_NOT_ACTIVE), tệp không ghi", async () => {
    await xoaSo(uid);
    const cha = randomUUID();
    const con = randomUUID();
    expect(await taoHangLuotChay({ id: cha, userId: uid, projectId: DU_AN, cheDo: "sua", cauHoi: "cha" })).toBe(true);
    expect(await taoHangLuotChay({ id: con, userId: uid, projectId: DU_AN, cheDo: "sua", cauHoi: "con", con: { parentRunId: cha, depth: 1, agentName: "viet-test", agentSource: "dungSan" } })).toBe(true);
    await capNhatHangLuotChay(uid, cha, { trangThai: "huy", lyDoDung: "huy" }); // cha đã kết thúc; con "ngủ muộn" vẫn dang-chay

    const nguoi = { id: uid, role: "admin", name: "x" };
    const bo = taoBoThucThiMayChu({
      execCtx: { user: nguoi, lang: "vi", projectRoot: REPO },
      gocDuAn: REPO,
      projectId: DU_AN,
      user: nguoi,
      coQuyenThucThi: true,
      checkpoint: congCheckpointThat(uid),
      phuThuoc: { nhipKiemMs: 50 },
    });
    const ac = new AbortController();
    let actionId = "";
    const chay = bo.chay(
      { id: "w", ten: "write_file", thamSo: { path: "src/dua.ts", content: "export const D = 1;\n" } },
      {
        cheDo: "sua",
        runId: con,
        luot: 1,
        signal: ac.signal,
        phat: (e) => {
          if (e.loai === "can-duyet") actionId = String(e.deXuat.pendingActionId);
        },
      },
    );
    for (let i = 0; i < 100 && actionId === ""; i++) await new Promise((r) => setTimeout(r, 50));
    expect(actionId).not.toBe("");
    const db = await getDb();
    const [h] = await db!.select({ r: aiPendingActions.agentRunId }).from(aiPendingActions).where(eq(aiPendingActions.id, actionId));
    expect(h!.r).toBe(con);
    const r = await confirmAction(actionId, actionId, nguoi, "vi");
    expect(r.ok).toBe(false);
    expect(r.message ?? "").toMatch(/AGENT_RUN_NOT_ACTIVE/);
    ac.abort();
    await chay;
    expect(fs.existsSync(path.join(REPO, "src", "dua.ts"))).toBe(false);
  }, 60_000);
});
