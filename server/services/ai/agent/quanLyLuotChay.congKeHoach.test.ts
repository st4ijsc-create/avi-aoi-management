/**
 * ★★★ Đợt 11.3-C · UX-D02 — CỔNG DUYỆT KẾ HOẠCH đầu–cuối phía server: model giả ⇒ lõi THẬT ⇒ bộ thực thi THẬT ⇒ sổ `ai_agent_runs`
 * (mig 0444) THẬT ⇒ thủ tục duyệt THẬT. Cờ: `phuThuoc.congKeHoach.bat` (mặc định đọc AI_AGENT_CONG_KE_HOACH=1).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import type { GoiModel, ManhModel, SuKienAgent, WireToolCall } from "@shared/agentCore";
import { taoQuanLyLuotChay } from "./quanLyLuotChay";
import { taoChoDuyetKeHoach } from "./choDuyetKeHoach";
import { thuTucDuyet } from "./thuTucLuotChay";
import { thuTucDuyetKeHoach, thuTucKeHoachDangCho } from "./thuTucKeHoach";
import { docKeHoach } from "../../../db/aiAgentKeHoach";
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
let uid2 = 0;
const DU_AN = "t113c";
const NGUOI = () => ({ id: uid, role: "admin", name: "Ky su kh" });
const NGUOI2 = () => ({ id: uid2, role: "admin", name: "Ky su kh2" });
const tc = (id: string, name: string, args: Record<string, unknown>): WireToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const todo = (id: string, ...nd: string[]) => tc(id, "todo_write", { todos: nd.map((content, i) => ({ content, status: i === 0 ? "in_progress" : "pending" })) });
const ghi = (id: string, p: string) => tc(id, "write_file", { path: p, content: "hello\n" });
const BAT = { bat: true } as const;

interface Buoc {
  chu?: string;
  tool?: WireToolCall[];
}
function modelKichBan(kb: Buoc[]): GoiModel {
  let i = 0;
  return async function* (): AsyncGenerator<ManhModel> {
    const b = kb[Math.min(i++, kb.length - 1)]!;
    if (b.chu) yield { loai: "chu", noiDung: b.chu };
    yield { loai: "xong", toolCalls: b.tool ?? [], usage: { vao: 100, ra: 20 } };
  };
}

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t113c-")));
  KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t113c-kho-")));
  process.env.AI_CHECKPOINT_DIR = KHO;
  KHOA_CU = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = "luoi-checkpoint-khoa-thu-0123456789abcdef";
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=T113C|${REPO}`;
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
  const hash = await bcrypt.hash("Mk-kh-agent!1", 10);
  uid = (await createLocalUser({ username: `t113c-${Date.now()}`, passwordHash: hash, name: "Ky su kh", role: "admin" })).id;
  uid2 = (await createLocalUser({ username: `t113c2-${Date.now()}`, passwordHash: hash, name: "Ky su kh2", role: "admin" })).id;
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

/** Chờ tới khi sự kiện thoả `kt` xuất hiện (nghe từ đầu). */
function choSuKien(ql: ReturnType<typeof taoQuanLyLuotChay>, runId: string, userId: number, kt: (e: SuKienAgent) => boolean, ms = 15_000): Promise<SuKienAgent> {
  return new Promise((ok, loi) => {
    const t = setTimeout(() => loi(new Error("het gio cho su kien")), ms);
    const huy = ql.nghe(runId, userId, 0, (m) => {
      if (kt(m.suKien)) {
        clearTimeout(t);
        queueMicrotask(() => huy?.());
        ok(m.suKien);
      }
    });
  });
}
const khoiTao = async (ql: ReturnType<typeof taoQuanLyLuotChay>, cheDo: "sua" | "tu-dong" = "sua") => {
  const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "lam", projectId: DU_AN, cheDo });
  if (!kq.ok) throw new Error(kq.ma);
  return kq.luot;
};
const coFile = (rel: string) => fs.existsSync(path.join(REPO, rel));
const hang = async (id: string) => (await (await getDb())!.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, id)))[0]!;

describe("cờ (mặc định TẮT)", () => {
  it("★★★ cổng TẮT ⇒ không sự kiện cổng, không cột keHoach*, ghi đi thẳng vào thẻ duyệt như cũ", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [ghi("w", "a.txt")] }, { chu: "xong" }]), congKeHoach: { bat: false } });
    const luot = await khoiTao(ql);
    const the = await choSuKien(ql, luot.id, uid, (e) => e.loai === "can-duyet");
    expect(the.loai).toBe("can-duyet");
    ql.huy(luot.id, uid);
    await luot.xong;
    const h = await hang(luot.id);
    expect(h.keHoachBam).toBeNull();
    expect(h.keHoachTrangThai).toBeNull();
    expect(coFile("a.txt")).toBe(false);
  }, 60_000);
});

describe("cờ môi trường AI_AGENT_CONG_KE_HOACH", () => {
  /** Ghi mà CHƯA có kế hoạch: cổng bật ⇒ PLAN_REQUIRED (không thẻ); cổng tắt ⇒ đi thẳng tới thẻ duyệt như cũ. */
  const thu = async (v: string | undefined): Promise<"PLAN_REQUIRED" | "THE"> => {
    const cu = process.env.AI_AGENT_CONG_KE_HOACH;
    if (v === undefined) delete process.env.AI_AGENT_CONG_KE_HOACH;
    else process.env.AI_AGENT_CONG_KE_HOACH = v;
    try {
      const ql = taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [ghi("w", "env.txt")] }, { chu: "xong" }]) });
      const luot = await khoiTao(ql);
      const e = await choSuKien(ql, luot.id, uid, (x) => x.loai === "can-duyet" || (x.loai === "ket-qua-tool" && x.id === "w"));
      ql.huy(luot.id, uid);
      await luot.xong;
      return e.loai === "ket-qua-tool" && e.ma === "PLAN_REQUIRED" ? "PLAN_REQUIRED" : "THE";
    } finally {
      if (cu === undefined) delete process.env.AI_AGENT_CONG_KE_HOACH;
      else process.env.AI_AGENT_CONG_KE_HOACH = cu;
    }
  };
  it("★★★ không đặt / khác đúng \"1\" ⇒ TẮT; \"1\" ⇒ BẬT", async () => {
    expect(await thu(undefined)).toBe("THE");
    expect(await thu("0")).toBe("THE");
    expect(await thu("true")).toBe("THE");
    expect(await thu("1")).toBe("PLAN_REQUIRED");
  }, 90_000);
});

describe("cổng BẬT — đầu–cuối", () => {
  it("★★★ chưa có kế hoạch ⇒ PLAN_REQUIRED, KHÔNG thẻ duyệt, không tệp", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [ghi("w", "b.txt")] }, { chu: "xong" }]), congKeHoach: BAT });
    const luot = await khoiTao(ql);
    const ev: SuKienAgent[] = [];
    ql.nghe(luot.id, uid, 0, (m) => ev.push(m.suKien));
    await luot.xong;
    expect(ev.find((e) => e.loai === "ket-qua-tool" && e.id === "w")).toMatchObject({ ok: false, ma: "PLAN_REQUIRED" });
    expect(ev.some((e) => e.loai === "can-duyet")).toBe(false);
    expect(coFile("b.txt")).toBe(false);
  }, 60_000);

  it("★★★ kế hoạch ⇒ chờ (sổ 'cho', lượt 'cho-duyet') ⇒ người khác không duyệt được, băm sai ⇒ CONFLICT ⇒ chủ duyệt ⇒ chạy tiếp tới THẺ (tệp CHƯA có) ⇒ duyệt thẻ ⇒ tệp có", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [todo("t", "tao a", "tao b"), ghi("w", "c.txt")] }, { chu: "xong" }]), congKeHoach: BAT });
    const luot = await khoiTao(ql);
    const cho = (await choSuKien(ql, luot.id, uid, (e) => e.loai === "ke-hoach-cho-duyet")) as Extract<SuKienAgent, { loai: "ke-hoach-cho-duyet" }>;
    expect(cho.viec.map((v) => v.noiDung)).toEqual(["tao a", "tao b"]);

    const dang = await thuTucKeHoachDangCho(NGUOI(), luot.id);
    expect(dang).toMatchObject({ ok: true, trangThai: "cho", bam: cho.bam });
    // trạng thái lượt được host ghi SAU sự kiện (luuNgay bất đồng bộ) ⇒ chờ tới khi thấy, không đọc ngay
    let tt = "";
    for (let i = 0; i < 100 && tt !== "cho-duyet"; i++) {
      tt = (await hang(luot.id)).trangThai;
      if (tt !== "cho-duyet") await new Promise((r) => setTimeout(r, 50));
    }
    expect(tt).toBe("cho-duyet");

    // người khác: không thấy, không duyệt được
    expect(await thuTucKeHoachDangCho(NGUOI2(), luot.id)).toMatchObject({ ok: false, note: "NOT_FOUND" });
    expect(await thuTucDuyetKeHoach(NGUOI2(), { runId: luot.id, bam: cho.bam, quyetDinh: "duyet" })).toMatchObject({ ok: false, note: "NOT_FOUND" });
    // băm sai
    expect(await thuTucDuyetKeHoach(NGUOI(), { runId: luot.id, bam: "0".repeat(64), quyetDinh: "duyet" })).toMatchObject({ ok: false, note: "CONFLICT" });
    expect((await docKeHoach(uid, luot.id))?.trangThai).toBe("cho");
    expect(coFile("c.txt")).toBe(false);

    // chủ duyệt kế hoạch
    const r = await thuTucDuyetKeHoach(NGUOI(), { runId: luot.id, bam: cho.bam, quyetDinh: "duyet" });
    expect(r).toMatchObject({ ok: true, trangThai: "duyet" });
    const da = (await choSuKien(ql, luot.id, uid, (e) => e.loai === "ke-hoach-da-duyet")) as Extract<SuKienAgent, { loai: "ke-hoach-da-duyet" }>;
    expect(da.bam).toBe(cho.bam);
    const sau = await hang(luot.id);
    expect(sau).toMatchObject({ keHoachTrangThai: "duyet", keHoachDuyetBoi: uid, keHoachBam: cho.bam });
    expect(sau.keHoachDuyetLuc).toBeInstanceOf(Date);
    // duyệt lần hai ⇒ DA_QUYET (chỉ MỘT quyết định)
    expect(await thuTucDuyetKeHoach(NGUOI(), { runId: luot.id, bam: cho.bam, quyetDinh: "bac" })).toMatchObject({ ok: false, note: "DA_QUYET" });

    // ★★★ duyệt KẾ HOẠCH không duyệt THẺ: tệp CHƯA có, thẻ đang chờ
    const the = (await choSuKien(ql, luot.id, uid, (e) => e.loai === "can-duyet")) as Extract<SuKienAgent, { loai: "can-duyet" }>;
    expect(coFile("c.txt")).toBe(false);
    const ok = await thuTucDuyet(NGUOI(), { actionId: String(the.deXuat.pendingActionId), lang: "vi" });
    expect(ok.ok).toBe(true);
    await luot.xong;
    expect(coFile("c.txt")).toBe(true);
    expect(luot.trangThai).toBe("xong");
  }, 90_000);

  it("★★★ BÁC ⇒ lượt kết thúc huy, tệp KHÔNG có, sổ 'bac'", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [todo("t", "x"), ghi("w", "d.txt")] }, { chu: "xong" }]), congKeHoach: BAT });
    const luot = await khoiTao(ql);
    const cho = (await choSuKien(ql, luot.id, uid, (e) => e.loai === "ke-hoach-cho-duyet")) as Extract<SuKienAgent, { loai: "ke-hoach-cho-duyet" }>;
    expect(await thuTucDuyetKeHoach(NGUOI(), { runId: luot.id, bam: cho.bam, quyetDinh: "bac" })).toMatchObject({ ok: true, trangThai: "bac" });
    await luot.xong;
    expect(luot.lyDoDung).toBe("huy");
    expect(coFile("d.txt")).toBe(false);
    expect((await hang(luot.id)).keHoachTrangThai).toBe("bac");
  }, 60_000);

  it("huỷ lượt GIỮA lúc chờ ⇒ lượt kết thúc, sổ kế hoạch không còn 'cho'", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [todo("t", "x"), ghi("w", "e.txt")] }, { chu: "xong" }]), congKeHoach: BAT });
    const luot = await khoiTao(ql);
    await choSuKien(ql, luot.id, uid, (e) => e.loai === "ke-hoach-cho-duyet");
    ql.huy(luot.id, uid);
    await luot.xong;
    expect(coFile("e.txt")).toBe(false);
    expect((await hang(luot.id)).keHoachTrangThai).toBe("bac");
  }, 60_000);

  it("HẾT GIỜ chờ ⇒ lượt kết thúc het-gio, sổ 'het-gio'", async () => {
    const ql = taoQuanLyLuotChay({
      goiModel: modelKichBan([{ tool: [todo("t", "x"), ghi("w", "f.txt")] }, { chu: "xong" }]),
      congKeHoach: { bat: true, choDuyet: (y) => taoChoDuyetKeHoach(y, { tranMs: 300, nhipMs: 50 }) },
    });
    const luot = await khoiTao(ql);
    await luot.xong;
    expect(luot.lyDoDung).toBe("het-gio");
    expect(coFile("f.txt")).toBe(false);
    expect((await hang(luot.id)).keHoachTrangThai).toBe("het-gio");
  }, 60_000);

  it("tu-dong cũng chịu cổng", async () => {
    const cu = process.env.AI_CODING_TU_TRI_GHI;
    process.env.AI_CODING_TU_TRI_GHI = "1";
    try {
      const ql = taoQuanLyLuotChay({ goiModel: modelKichBan([{ tool: [todo("t", "x"), ghi("w", "g.txt")] }, { chu: "xong" }]), congKeHoach: BAT });
      const luot = await khoiTao(ql, "tu-dong");
      await choSuKien(ql, luot.id, uid, (e) => e.loai === "ke-hoach-cho-duyet");
      expect(coFile("g.txt")).toBe(false);
      ql.huy(luot.id, uid);
      await luot.xong;
      expect(coFile("g.txt")).toBe(false);
    } finally {
      if (cu === undefined) delete process.env.AI_CODING_TU_TRI_GHI;
      else process.env.AI_CODING_TU_TRI_GHI = cu;
    }
  }, 60_000);
});
