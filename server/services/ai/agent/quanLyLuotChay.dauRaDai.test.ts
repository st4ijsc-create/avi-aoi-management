/**
 * Đợt 12 · H5.3 — ĐẦU RA DÀI đầu–cuối: model giả ⇒ lõi THẬT ⇒ bộ thực thi THẬT (grep thật trên repo git tạm) ⇒ kho tệp THẬT (thư mục tmp riêng của lưới)
 * ⇒ `read_output` THẬT. Cờ: `phuThuoc.khoDauRaDai` (tiêm) hoặc AI_AGENT_DAU_RA_DAI=1 (MẶC ĐỊNH TẮT).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import type { GoiModel, ManhModel, SuKienAgent, TinNhan, WireToolCall } from "@shared/agentCore";
import { taoQuanLyLuotChay } from "./quanLyLuotChay";
import { taoKhoDauRaDai, type KhoDauRaDai } from "./khoDauRaDai";
import { _xoaSoBamHITL } from "../../aiLocalTools/writeHandlers/applyDiff";
import { xoaSoNganSach } from "../../aiLocalTools/repoSandbox";
import { getDb } from "../../../db/connection";
import { aiAgentRuns, aiPendingActions } from "../../../../drizzle/schema";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { createLocalUser } from "../../../db/auth";

let REPO = "";
let KHO = "";
let TMP_KHO = "";
let KHOA_CU: string | undefined;
let uid = 0;
const DU_AN = "t12h53";
const NGUOI = () => ({ id: uid, role: "admin", name: "Ky su h53" });
const tc = (id: string, name: string, args: Record<string, unknown>): WireToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const KHOA_GIA = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";

type BuocFn = (tinNhan: TinNhan[]) => { chu?: string; tool?: WireToolCall[] };
function modelHam(kb: BuocFn[], vao: Array<{ congCu: string[]; tinNhan: TinNhan[] }> = []): GoiModel {
  let i = 0;
  return async function* (v): AsyncGenerator<ManhModel> {
    vao.push({ congCu: v.congCu.map((t) => t.function.name), tinNhan: structuredClone(v.tinNhan) });
    const b = kb[Math.min(i++, kb.length - 1)]!(v.tinNhan);
    if (b.chu) yield { loai: "chu", noiDung: b.chu };
    yield { loai: "xong", toolCalls: b.tool ?? [], usage: { vao: 100, ra: 20 } };
  };
}
const refTuTinNhan = (t: TinNhan[]): string => /out-[0-9a-f]{8}/.exec(t.filter((m) => m.role === "tool").at(-1)?.content ?? "")?.[0] ?? "";
const noiDungKho = (k: KhoDauRaDai): string[] => {
  const d = k.thuMuc();
  if (!d || !fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith(".txt")).map((f) => fs.readFileSync(path.join(d, f), "utf8"));
};

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t12h53-")));
  KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t12h53-ckpt-")));
  TMP_KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t12h53-kho-")));
  process.env.AI_CHECKPOINT_DIR = KHO;
  KHOA_CU = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = "luoi-checkpoint-khoa-thu-0123456789abcdef";
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=T12H53|${REPO}`;
  const git = (...a: string[]) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  fs.mkdirSync(path.join(REPO, "src"), { recursive: true });
  const dong = Array.from({ length: 300 }, (_v, i) => `ghi nhan so ${i + 1}: ${i % 50 === 0 ? "ERROR nghiem trong" : "binh thuong"} ${"x".repeat(220)}`);
  dong.splice(7, 0, `ghi nhan token=${KHOA_GIA} bi lo`);
  fs.writeFileSync(path.join(REPO, "src", "log.txt"), dong.join("\n") + "\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const bcrypt = await import("bcryptjs");
  uid = (await createLocalUser({ username: `t12h53-${Date.now()}`, passwordHash: await bcrypt.hash("Mk-h53-agent!1", 10), name: "Ky su h53", role: "admin" })).id;
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
  for (const d of [REPO, KHO, TMP_KHO]) {
    try {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}, 60_000);

async function chay(kb: BuocFn[], o: { kho: KhoDauRaDai | null | undefined }) {
  const vao: Array<{ congCu: string[]; tinNhan: TinNhan[] }> = [];
  const ql = taoQuanLyLuotChay({ goiModel: modelHam(kb, vao), ...(o.kho !== undefined ? { khoDauRaDai: o.kho } : {}) });
  const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "tim loi", projectId: DU_AN, cheDo: "hoi" });
  if (!kq.ok) throw new Error(kq.ma);
  const ev: SuKienAgent[] = [];
  ql.nghe(kq.luot.id, uid, 0, (m) => ev.push(m.suKien));
  await kq.luot.xong;
  return { kq, vao, ev };
}
const grepLog = () => tc("g1", "grep", { pattern: "ghi nhan" });

describe("đầu–cuối", () => {
  it("★★★ BẬT: grep dài ⇒ model thấy đầu+đuôi + mã; read_output grep 'ERROR' trả đúng dòng; bí mật KHÔNG có trong tệp lẫn trong kết quả; xong lượt ⇒ kho sạch", async () => {
    const kho = taoKhoDauRaDai({ tmp: TMP_KHO, gocDuAn: REPO, khongNhip: true });
    let trongLuot: string[] = [];
    const r = await chay(
      [
        () => ({ tool: [grepLog()] }),
        (t) => ({ tool: [tc("o1", "read_output", { ref: refTuTinNhan(t), grep: "ERROR" })] }),
        (t) => {
          trongLuot = noiDungKho(kho); // chụp kho NGAY trước khi lượt kết thúc
          return { tool: [tc("o2", "read_output", { ref: refTuTinNhan(t.filter((m) => !(m.role === "tool" && m.name === "read_output"))), start_line: 5, end_line: 9 })] };
        },
        () => ({ chu: "xong" }),
      ],
      { kho },
    );
    expect(r.kq.luot.trangThai).toBe("xong");
    expect(r.vao[0]!.congCu).toContain("read_output");
    const tGrep = r.vao[1]!.tinNhan.find((m) => m.role === "tool" && m.name === "grep")!.content;
    expect(tGrep).toMatch(/\[full output saved as out-[0-9a-f]{8}; read it with read_output/);
    expect(tGrep).toContain("chars omitted");
    expect(tGrep).not.toContain(KHOA_GIA);
    const tDoc = r.vao[2]!.tinNhan.find((m) => m.role === "tool" && m.name === "read_output")!.content;
    expect(tDoc).toContain("matching lines");
    expect(tDoc).toContain("ERROR nghiem trong");
    expect(tDoc).not.toContain(KHOA_GIA);
    // kho chứa ĐÚNG một tệp, bản ĐẦY ĐỦ (dài hơn nhiều so với phần model thấy), KHÔNG bí mật, KHÔNG đường dẫn
    expect(trongLuot).toHaveLength(1);
    expect(trongLuot[0]!.length).toBeGreaterThan(tGrep.length);
    expect(trongLuot[0]).not.toContain(KHOA_GIA);
    expect(trongLuot[0]).toContain("src/log.txt:80:"); // grep tối đa 80 khớp: dòng cuối nằm trong bản ĐẦY ĐỦ
    expect(JSON.stringify(r.vao[1]!.tinNhan)).not.toContain(TMP_KHO);
    expect(JSON.stringify(r.vao[3]!.tinNhan)).not.toContain(TMP_KHO);
    // đọc theo dòng
    const tDong = r.vao[3]!.tinNhan.filter((m) => m.role === "tool" && m.name === "read_output").at(-1)!.content;
    expect(tDong).toContain("showing lines 5-9");
    // xong lượt ⇒ dọn
    expect(noiDungKho(kho)).toEqual([]);
    kho.dongKho();
  }, 90_000);

  it("★★★ TẮT (không kho): không read_output, không dòng ref, kết quả cắt như cũ", async () => {
    const r = await chay([() => ({ tool: [grepLog()] }), () => ({ chu: "xong" })], { kho: null });
    expect(r.vao[0]!.congCu).not.toContain("read_output");
    const t = r.vao[1]!.tinNhan.find((m) => m.role === "tool" && m.name === "grep")!.content;
    expect(t).toContain("chars omitted");
    expect(t).not.toContain("full output");
    expect(r.vao[0]!.tinNhan[0]!.content).not.toMatch(/read_output/);
  }, 90_000);

  it("★★★ CON: đầu ra dài của con được lưu theo runId CỦA CON, con đọc lại được, CHA không đọc được mã của con; tệp của con bị dọn NGAY khi con xong", async () => {
    const kho = taoKhoDauRaDai({ tmp: TMP_KHO, gocDuAn: REPO, khongNhip: true });
    let refCon = "";
    let conDoc = "";
    let chaDoc = "";
    let tepKhiConXong: string[] = ["chưa đo"];
    const vao: Array<{ congCu: string[]; tinNhan: TinNhan[] }> = [];
    const ql = taoQuanLyLuotChay({
      goiModel: modelHam(
        [
          () => ({ tool: [tc("g0", "delegate", { agent: "kham-pha", task: "tim loi" })] }), // cha
          () => ({ tool: [grepLog()] }), // con: grep dài
          (t) => {
            refCon = refTuTinNhan(t);
            return { tool: [tc("o1", "read_output", { ref: refCon, grep: "ERROR" })] }; // con đọc lại của chính mình
          },
          (t) => {
            conDoc = t.filter((m) => m.role === "tool").at(-1)?.content ?? "";
            return { chu: "con xong" };
          },
          // cha: con đã xong ⇒ kho của con phải sạch; cha thử đọc mã của con
          () => {
            tepKhiConXong = noiDungKho(kho);
            return { tool: [tc("o2", "read_output", { ref: refCon })] };
          },
          (t) => {
            chaDoc = t.filter((m) => m.role === "tool" && m.name === "read_output").at(-1)?.content ?? "";
            return { chu: "cha xong" };
          },
        ],
        vao,
      ),
      khoDauRaDai: kho,
      giaoViec: { bat: true },
    });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "tim loi", projectId: DU_AN, cheDo: "sua" });
    if (!kq.ok) throw new Error(kq.ma);
    await kq.luot.xong;
    expect(refCon).toMatch(/^out-[0-9a-f]{8}$/);
    expect(conDoc).toContain("ERROR nghiem trong"); // con đọc được của chính mình
    expect(tepKhiConXong).toEqual([]); // dọn ngay khi con xong (cha vẫn đang chạy)
    expect(chaDoc).toMatch(/No saved output with that ref/); // cha không đọc được mã của con (và tệp đã mất)
    expect(chaDoc).not.toContain("ERROR nghiem trong");
    kho.dongKho();
  }, 120_000);

  it("model bịa read_output khi TẮT ⇒ bị từ chối như tool lạ", async () => {
    const r = await chay([() => ({ tool: [tc("o", "read_output", { ref: "out-00000000" })] }), () => ({ chu: "xong" })], { kho: null });
    const t = r.vao[1]!.tinNhan.find((m) => m.role === "tool" && m.name === "read_output")!.content;
    expect(t).toMatch(/not available/i);
  }, 90_000);

  it("cờ môi trường AI_AGENT_DAU_RA_DAI: chỉ '1' bật (kho dùng chung của tiến trình)", async () => {
    const cu = process.env.AI_AGENT_DAU_RA_DAI;
    try {
      process.env.AI_AGENT_DAU_RA_DAI = "1";
      const bat = await chay([() => ({ chu: "xong" })], { kho: undefined });
      expect(bat.vao[0]!.congCu).toContain("read_output");
      for (const v of ["0", "true", ""]) {
        process.env.AI_AGENT_DAU_RA_DAI = v;
        const tat = await chay([() => ({ chu: "xong" })], { kho: undefined });
        expect(tat.vao[0]!.congCu, v).not.toContain("read_output");
      }
      delete process.env.AI_AGENT_DAU_RA_DAI;
      expect((await chay([() => ({ chu: "xong" })], { kho: undefined })).vao[0]!.congCu).not.toContain("read_output");
    } finally {
      if (cu === undefined) delete process.env.AI_AGENT_DAU_RA_DAI;
      else process.env.AI_AGENT_DAU_RA_DAI = cu;
    }
  }, 120_000);

  it("★★★ kho CHỒNG gốc dự án của lượt ⇒ lượt đó KHÔNG dùng kho (không read_output, không lưu)", async () => {
    const kho = taoKhoDauRaDai({ tmp: TMP_KHO, gocDuAn: REPO, khongNhip: true });
    // lượt chạy trên gốc dự án = chính thư mục chứa kho ⇒ phải bị loại
    const goc = process.env.AI_REPO_SANDBOX_ROOTS;
    fs.mkdirSync(path.join(TMP_KHO, "src"), { recursive: true });
    fs.writeFileSync(path.join(TMP_KHO, "src", "a.txt"), "x\n");
    process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=T12H53|${TMP_KHO}`;
    try {
      const r = await chay([() => ({ chu: "xong" })], { kho });
      expect(r.vao[0]!.congCu).not.toContain("read_output");
    } finally {
      process.env.AI_REPO_SANDBOX_ROOTS = goc;
      kho.dongKho();
    }
  }, 90_000);
});
