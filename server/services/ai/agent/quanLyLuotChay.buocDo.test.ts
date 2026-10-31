/**
 * Đợt 12 · H0.2 — `buoc-do` phía server: (1) đầu–cuối: model giả ⇒ lõi THẬT ⇒ sổ `ai_agent_runs` THẬT + luồng nghe (đúng thứ SSE phát) thấy
 * MỖI lượt model một `buoc-do`; (2) sổ cắt `suKienDeLuu` KHÔNG làm rơi `buoc-do` (trần riêng `TRAN_BUOC_DO_LUU`); (3) client bỏ qua kiểu lạ.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import type { GoiModel, ManhModel, SuKienAgent } from "@shared/agentCore";
import { khoiTraLoiTuSuKien } from "@shared/phanHoiAgent";
import { TRAN_BUOC_DO_LUU, TRAN_SU_KIEN_LUU, suKienDeLuu, taoQuanLyLuotChay, type MucDem } from "./quanLyLuotChay";
import { xoaSoNganSach } from "../../aiLocalTools/repoSandbox";
import { getDb } from "../../../db/connection";
import { aiAgentRuns, aiPendingActions } from "../../../../drizzle/schema";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { createLocalUser } from "../../../db/auth";

let REPO = "";
let KHO = "";
let KHOA_CU: string | undefined;
let uid = 0;
const DU_AN = "t12h02";

const modelKichBan = (soLuot: number): GoiModel => {
  let i = 0;
  return async function* (): AsyncGenerator<ManhModel> {
    const k = i++;
    const cuoi = k >= soLuot - 1;
    yield {
      loai: "xong",
      toolCalls: cuoi ? [] : [{ id: `r${k}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/b.ts" }) } }],
      usage: { vao: 100 + k, ra: 5, cacheN: 60, promptN: 40 + k },
    } as ManhModel;
  };
};

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t12h02-")));
  KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t12h02-kho-")));
  process.env.AI_CHECKPOINT_DIR = KHO;
  KHOA_CU = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = "luoi-checkpoint-khoa-thu-0123456789abcdef";
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=T12H02|${REPO}`;
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
  const hash = await bcrypt.hash("Mk-h02-agent!1", 10);
  uid = (await createLocalUser({ username: `t12h02-${Date.now()}`, passwordHash: hash, name: "Ky su h02", role: "admin" })).id;
  xoaSoNganSach();
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

describe("đầu–cuối", () => {
  it("★★★ mỗi lượt model một buoc-do, tới được người nghe (đường SSE) VÀ nằm trong sổ ai_agent_runs", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan(3) });
    const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin", name: "x" }, cauHoi: "doc", projectId: DU_AN, cheDo: "hoi" });
    if (!kq.ok) throw new Error(kq.ma);
    await kq.luot.xong;
    const nghe: SuKienAgent[] = [];
    ql.nghe(kq.luot.id, uid, 0, (m) => nghe.push(m.suKien))?.();
    const bd = nghe.flatMap((e) => (e.loai === "buoc-do" ? [e] : []));
    expect(bd.map((e) => [e.luot, e.vaoThat, e.cacheN, e.promptN])).toEqual([
      [1, 100, 60, 40],
      [2, 101, 60, 41],
      [3, 102, 60, 42],
    ]);
    const hang = (await (await getDb())!.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, kq.luot.id)))[0]!;
    const sổ = (hang.suKien as Array<{ suKien: SuKienAgent }>).filter((m) => m.suKien.loai === "buoc-do");
    expect(sổ.length).toBe(3);
  }, 60_000);

  it("client/phản hồi bỏ qua kiểu lạ: buoc-do giữa hai đoạn chữ KHÔNG cắt khối trả lời", () => {
    const ds = [
      { loai: "chu", noiDung: "a" },
      { loai: "buoc-do", luot: 1, bamHeThong: "00000000", soTin: 2, tokenUoc: 1, nen: null, nhacDaChen: [] },
      { loai: "chu", noiDung: "b" },
    ] as SuKienAgent[];
    expect(khoiTraLoiTuSuKien(ds)).toEqual(["ab"]);
  });
});

describe("H1.1 công tắc AI_AGENT_NEN_MOC nối tới lõi", () => {
  /** SỐ LẦN nén ghi trong buoc-do của một lượt đọc tệp ~9000 ký tự 20 lần, ngân sách 40000 token. */
  const chayNen = async (moc: string | undefined): Promise<number> => {
    for (let k = 0; k < 20; k++) fs.writeFileSync(path.join(REPO, "src", `lon${k}.ts`), `${k}`.repeat(9000));
    const cu = process.env.AI_AGENT_NEN_MOC;
    if (moc === undefined) delete process.env.AI_AGENT_NEN_MOC;
    else process.env.AI_AGENT_NEN_MOC = moc;
    try {
      let i = 0;
      const goiModel: GoiModel = async function* (): AsyncGenerator<ManhModel> {
        const k = i++;
        yield {
          loai: "xong",
          toolCalls: k >= 19 ? [] : [{ id: `n${k}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `src/lon${k}.ts` }) } }],
          usage: { vao: 1, ra: 5 },
        } as ManhModel;
      };
      const ql = taoQuanLyLuotChay({ goiModel, gioiHan: { nganSachNguCanhToken: 40_000, soLuotToiDa: 30 } });
      const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin", name: "x" }, cauHoi: "doc", projectId: DU_AN, cheDo: "hoi" });
      if (!kq.ok) throw new Error(kq.ma);
      await kq.luot.xong;
      const nghe: SuKienAgent[] = [];
      ql.nghe(kq.luot.id, uid, 0, (m) => nghe.push(m.suKien))?.();
      const lanNen = nghe.filter((e) => e.loai === "buoc-do" && e.nen).length;
      expect(lanNen).toBeGreaterThan(0);
      return lanNen;
    } finally {
      if (cu === undefined) delete process.env.AI_AGENT_NEN_MOC;
      else process.env.AI_AGENT_NEN_MOC = cu;
    }
  };
  it("★ đặt AI_AGENT_NEN_MOC=0.5 ⇒ nén sâu hơn hẳn mặc định (vắng ⇒ như cũ); giá trị rác ⇒ như cũ", async () => {
    const macDinh = await chayNen(undefined);
    const sau = await chayNen("0.5");
    const rac = await chayNen("abc");
    expect(sau).toBeLessThan(macDinh); // nén sâu hơn ⇒ ít lần nén hơn
    expect(rac).toBe(macDinh);
  }, 60_000);
});

describe("H1.4 công tắc AI_AGENT_DOC_TRUOC_KHI_GHI nối tới bộ thực thi", () => {
  const ghiTepChuaDoc = async (bat: boolean): Promise<{ thePhat: boolean; tuChoi: boolean }> => {
    const cu = process.env.AI_AGENT_DOC_TRUOC_KHI_GHI;
    if (bat) process.env.AI_AGENT_DOC_TRUOC_KHI_GHI = "1";
    else delete process.env.AI_AGENT_DOC_TRUOC_KHI_GHI;
    try {
      let i = 0;
      const goiModel: GoiModel = async function* (): AsyncGenerator<ManhModel> {
        const k = i++;
        yield {
          loai: "xong",
          toolCalls: k === 0 ? [{ id: "w0", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "src/b.ts", content: "export const B = 2;\n" }) } }] : [],
          usage: { vao: 1, ra: 5 },
        } as ManhModel;
      };
      const ql = taoQuanLyLuotChay({ goiModel });
      const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin", name: "x" }, cauHoi: "ghi", projectId: DU_AN, cheDo: "sua" });
      if (!kq.ok) throw new Error(kq.ma);
      const nghe: SuKienAgent[] = [];
      const huy = ql.nghe(kq.luot.id, uid, 0, (m) => nghe.push(m.suKien));
      await new Promise((r) => setTimeout(r, 1500));
      huy?.();
      ql.huy(kq.luot.id, uid);
      await kq.luot.xong;
      return {
        thePhat: nghe.some((e) => e.loai === "can-duyet"),
        tuChoi: nghe.some((e) => e.loai === "ket-qua-tool" && e.ok === false && /read_file/.test(String(e.tomTat ?? ""))),
      };
    } finally {
      if (cu === undefined) delete process.env.AI_AGENT_DOC_TRUOC_KHI_GHI;
      else process.env.AI_AGENT_DOC_TRUOC_KHI_GHI = cu;
    }
  };
  it("★ vắng cờ ⇒ ghi tệp chưa đọc đi tới thẻ duyệt như cũ; AI_AGENT_DOC_TRUOC_KHI_GHI=1 ⇒ bị từ chối, KHÔNG có thẻ", async () => {
    const tat = await ghiTepChuaDoc(false);
    expect(tat).toEqual({ thePhat: true, tuChoi: false });
    const bat = await ghiTepChuaDoc(true);
    expect(bat).toEqual({ thePhat: false, tuChoi: true });
  }, 90_000);
});

describe("H1.5 công tắc AI_AGENT_TOOL_TIMEOUT nối tới bộ thực thi", () => {
  it("★ AI_AGENT_TOOL_TIMEOUT=1 ⇒ search_docs treo bị cắt TOOL_TIMEOUT theo hạn mặc định (30 s)", async () => {
    const cu = process.env.AI_AGENT_TOOL_TIMEOUT;
    process.env.AI_AGENT_TOOL_TIMEOUT = "1";
    try {
      let i = 0;
      const goiModel: GoiModel = async function* (): AsyncGenerator<ManhModel> {
        const k = i++;
        yield {
          loai: "xong",
          toolCalls: k === 0 ? [{ id: "s0", type: "function", function: { name: "search_docs", arguments: JSON.stringify({ query: "x" }) } }] : [],
          usage: { vao: 1, ra: 5 },
        } as ManhModel;
      };
      const ql = taoQuanLyLuotChay({ goiModel, phuThuocBoThucThi: { timTaiLieu: () => new Promise(() => undefined) } });
      const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin", name: "x" }, cauHoi: "tim", projectId: DU_AN, cheDo: "hoi" });
      if (!kq.ok) throw new Error(kq.ma);
      await kq.luot.xong;
      const nghe: SuKienAgent[] = [];
      ql.nghe(kq.luot.id, uid, 0, (m) => nghe.push(m.suKien))?.();
      const kqTool = nghe.find((e) => e.loai === "ket-qua-tool" && e.ten === "search_docs");
      expect(kqTool).toMatchObject({ ok: false, ma: "TOOL_TIMEOUT" });
    } finally {
      if (cu === undefined) delete process.env.AI_AGENT_TOOL_TIMEOUT;
      else process.env.AI_AGENT_TOOL_TIMEOUT = cu;
    }
  }, 90_000);
});

describe("suKienDeLuu giữ buoc-do khi sổ quá trần", () => {
  const mucBuoc = (seq: number): MucDem => ({
    seq,
    suKien: { loai: "buoc-do", luot: seq, bamHeThong: "00000000", soTin: 1, tokenUoc: 1, nen: null, nhacDaChen: [] },
  });
  const mucNhieu = (seq: number): MucDem => ({ seq, suKien: { loai: "goi-tool", id: `g${seq}`, ten: "read_file", thamSo: {} } as unknown as SuKienAgent });
  const dem = (soBuoc: number, tong: number): MucDem[] => {
    const ra: MucDem[] = [];
    // buoc-do rải đều NGOÀI vùng đầu/đuôi giữ nguyên
    const dau = Math.floor(TRAN_SU_KIEN_LUU / 4);
    for (let i = 0; i < tong; i++) ra.push(i >= dau + 10 && i < dau + 10 + soBuoc ? mucBuoc(i) : mucNhieu(i));
    return ra;
  };
  it("sổ quá trần: mọi buoc-do ở GIỮA vẫn còn, đúng thứ tự seq", () => {
    const ra = suKienDeLuu(dem(50, TRAN_SU_KIEN_LUU + 1000));
    const bd = ra.filter((m) => m.suKien.loai === "buoc-do");
    expect(bd.length).toBe(50);
    expect(bd.map((m) => m.seq)).toEqual([...bd.map((m) => m.seq)].sort((a, b) => a - b));
    expect(ra.length).toBe(TRAN_SU_KIEN_LUU + 50);
  });
  it("vượt trần riêng ⇒ giữ MỚI nhất, đúng TRAN_BUOC_DO_LUU", () => {
    const ra = suKienDeLuu(dem(TRAN_BUOC_DO_LUU + 100, TRAN_SU_KIEN_LUU + 1500));
    const bd = ra.filter((m) => m.suKien.loai === "buoc-do");
    expect(bd.length).toBe(TRAN_BUOC_DO_LUU);
    const tatCa = dem(TRAN_BUOC_DO_LUU + 100, TRAN_SU_KIEN_LUU + 1500).filter((m) => m.suKien.loai === "buoc-do");
    expect(bd.at(-1)!.seq).toBe(tatCa.at(-1)!.seq);
    expect(bd[0]!.seq).toBe(tatCa[100]!.seq);
  });
  it("★ buoc-do đã nằm trong phần giữ nguyên (đuôi) được TÍNH vào trần riêng", () => {
    const d = dem(450, TRAN_SU_KIEN_LUU + 1500);
    for (let i = d.length - 100; i < d.length; i++) d[i] = mucBuoc(d[i]!.seq);
    const ra = suKienDeLuu(d);
    expect(ra.filter((m) => m.suKien.loai === "buoc-do").length).toBe(TRAN_BUOC_DO_LUU);
  });
  it("sổ dưới trần: nguyên vẹn, không đổi", () => {
    const d = dem(5, 100);
    expect(suKienDeLuu(d).length).toBe(100);
  });
});
