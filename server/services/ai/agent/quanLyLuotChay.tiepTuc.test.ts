/**
 * Đợt 12 · H5.4 — LƯU LỊCH SỬ + TIẾP TỤC LƯỢT đầu–cuối: model giả ⇒ lõi THẬT ⇒ bộ thực thi THẬT ⇒ `ai_agent_runs` + `ai_agent_run_lich_su` THẬT (mig 0450).
 * Cờ: `phuThuoc.tiepTuc.bat` (mặc định đọc AI_AGENT_TIEP_TUC=1, TẮT).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { CAU_TIEP_TUC, KET_CUC_KHONG_RO, type GoiModel, type ManhModel, type TinNhan, type WireToolCall } from "@shared/agentCore";
import { taoQuanLyLuotChay, type QuanLyLuotChay } from "./quanLyLuotChay";
import { thuTucTiepTucLuot } from "./thuTucTiepTuc";
import { _xoaSoBamHITL } from "../../aiLocalTools/writeHandlers/applyDiff";
import { xoaSoNganSach } from "../../aiLocalTools/repoSandbox";
import { getDb } from "../../../db/connection";
import { aiAgentRunLichSu, aiAgentRuns, aiPendingActions } from "../../../../drizzle/schema";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { createLocalUser } from "../../../db/auth";
import { capNhatHangLuotChay, taoHangLuotChay } from "../../../db/aiAgentRuns";
import { luuLichSu } from "../../../db/aiAgentLichSu";
import { randomUUID } from "node:crypto";

let REPO = "";
let KHO = "";
let KHOA_CU: string | undefined;
let uA = 0;
let uB = 0;
const DU_AN = "t12h54";
const NA = () => ({ id: uA, role: "admin", name: "A h54" });
const NB = () => ({ id: uB, role: "admin", name: "B h54" });
const tc = (id: string, name: string, args: Record<string, unknown>): WireToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const KHOA_GIA = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";

type BuocFn = (tinNhan: TinNhan[]) => { chu?: string; tool?: WireToolCall[]; treo?: boolean };
function modelHam(kb: BuocFn[], vao: TinNhan[][] = []): GoiModel {
  let i = 0;
  return async function* (v): AsyncGenerator<ManhModel> {
    vao.push(structuredClone(v.tinNhan));
    const b = kb[Math.min(i++, kb.length - 1)]!(v.tinNhan);
    if (b.treo) await new Promise<void>((r) => v.signal.addEventListener("abort", () => r(), { once: true }));
    if (b.chu) yield { loai: "chu", noiDung: b.chu };
    yield { loai: "xong", toolCalls: b.tool ?? [], usage: { vao: 100, ra: 20 } };
  };
}

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t12h54-")));
  KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t12h54-kho-")));
  process.env.AI_CHECKPOINT_DIR = KHO;
  KHOA_CU = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = "luoi-checkpoint-khoa-thu-0123456789abcdef";
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=T12H54|${REPO}`;
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
  const hash = await bcrypt.hash("Mk-h54-agent!1", 10);
  uA = (await createLocalUser({ username: `t12h54a-${Date.now()}`, passwordHash: hash, name: "A h54", role: "admin" })).id;
  uB = (await createLocalUser({ username: `t12h54b-${Date.now()}`, passwordHash: hash, name: "B h54", role: "admin" })).id;
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
    const ids = [uA, uB].filter((x) => x > 0);
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

async function banLuu(runId: string) {
  return (await (await getDb())!.select().from(aiAgentRunLichSu).where(eq(aiAgentRunLichSu.runId, runId)))[0] ?? null;
}
async function trangThai(runId: string) {
  return (await (await getDb())!.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)))[0]?.trangThai;
}
const choDen = async (kt: () => Promise<boolean>, ms = 15_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await kt()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("het gio cho dieu kien");
};

/** Chạy một lượt, đợi tool treo (search_docs) tới khi ĐÃ chụp (a), rồi HUỶ ⇒ lượt 'huy' với bản lưu "tool dở". */
async function chayRoiHuy(ql: QuanLyLuotChay, user: ReturnType<typeof NA>, cauHoi: string) {
  const kq = await ql.taoLuotChay({ user, cauHoi, projectId: DU_AN, cheDo: "hoi" });
  if (!kq.ok) throw new Error(kq.ma);
  await choDen(async () => (await banLuu(kq.luot.id)) !== null);
  expect(ql.huy(kq.luot.id, user.id)).toBe(true);
  await kq.luot.xong;
  return kq.luot;
}
const taoQl = (kb: BuocFn[], o: { bat?: boolean; vao?: TinNhan[][] } = {}) =>
  taoQuanLyLuotChay({
    goiModel: modelHam(kb, o.vao),
    tiepTuc: { bat: o.bat ?? true },
    phuThuocBoThucThi: { timTaiLieu: () => new Promise(() => undefined) }, // search_docs treo ⇒ lượt kẹt ở "tool dở"
  });
const treoTool: BuocFn = () => ({ tool: [tc("t1", "search_docs", { query: "x" })] });

describe("thủ tục: quyền", () => {
  it("★ người không có danh tính hợp lệ / không có ai_repo_read ⇒ PERMISSION_DENIED, KHÔNG đụng sổ", async () => {
    const ql = taoQl([() => ({ chu: "x" })]);
    expect(await thuTucTiepTucLuot({ id: 0, role: "admin" }, { runId: "00000000-0000-4000-8000-000000000000" }, ql)).toEqual({ ok: false, note: "PERMISSION_DENIED", runId: null });
    expect(await thuTucTiepTucLuot({ id: -5, role: "admin" }, { runId: "00000000-0000-4000-8000-000000000000" }, ql)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
  });
});

describe("cờ môi trường AI_AGENT_TIEP_TUC (không tiêm phuThuoc)", () => {
  const chayVoiEnv = async (v: string | undefined): Promise<boolean> => {
    const cu = process.env.AI_AGENT_TIEP_TUC;
    if (v === undefined) delete process.env.AI_AGENT_TIEP_TUC;
    else process.env.AI_AGENT_TIEP_TUC = v;
    try {
      const ql = taoQuanLyLuotChay({ goiModel: modelHam([treoTool]), phuThuocBoThucThi: { timTaiLieu: () => new Promise(() => undefined) } });
      const kq = await ql.taoLuotChay({ user: NA(), cauHoi: "cờ env", projectId: DU_AN, cheDo: "hoi" });
      if (!kq.ok) throw new Error(kq.ma);
      await new Promise((r) => setTimeout(r, 700));
      const co = (await banLuu(kq.luot.id)) !== null;
      ql.huy(kq.luot.id, uA);
      await kq.luot.xong;
      return co;
    } finally {
      if (cu === undefined) delete process.env.AI_AGENT_TIEP_TUC;
      else process.env.AI_AGENT_TIEP_TUC = cu;
    }
  };
  it("★ chỉ AI_AGENT_TIEP_TUC=1 bật lưu; vắng / 0 / true / rỗng ⇒ KHÔNG ghi", async () => {
    expect(await chayVoiEnv("1")).toBe(true);
    for (const v of [undefined, "0", "true", ""]) expect(await chayVoiEnv(v), String(v)).toBe(false);
  }, 120_000);
});

describe("đầu–cuối", () => {
  it("★★★ huỷ giữa tool ⇒ bản lưu có 'tool dở' ⇒ tiếp tục ⇒ lượt MỚI nhận lịch sử + 'outcome unknown', KHÔNG tool nào chạy lại", async () => {
    const vaoMoi: TinNhan[][] = [];
    const qlCu = taoQl([treoTool]);
    const cu = await chayRoiHuy(qlCu, NA(), "sửa giúp tôi");
    expect(await trangThai(cu.id)).toBe("huy");
    const ban = await banLuu(cu.id);
    expect(ban).toMatchObject({ userId: uA, daTiepTucBoi: null });
    const tin = ban!.tinNhan as TinNhan[];
    expect(tin[0]).toMatchObject({ role: "user", content: "sửa giúp tôi" });
    expect(tin.at(-1)).toMatchObject({ role: "assistant", tool_calls: [{ id: "t1" }] }); // (a): CHƯA có kết quả
    expect(tin.some((m) => m.role === "system")).toBe(false);

    const qlMoi = taoQl([() => ({ chu: "đã kiểm tra lại, tiếp tục xong" })], { vao: vaoMoi });
    const kq = await thuTucTiepTucLuot(NA(), { runId: cu.id }, qlMoi);
    expect(kq).toMatchObject({ ok: true, note: null });
    const moiId = kq.runId!;
    expect(moiId).not.toBe(cu.id);
    const luotMoi = qlMoi.layLuotChay(moiId, uA)!;
    await luotMoi.xong;
    expect(luotMoi.trangThai).toBe("xong");

    // model của lượt MỚI thấy: system (dựng lại) · câu hỏi gốc · assistant tool_calls · KẾT QUẢ "outcome unknown" · câu tiếp tục
    const h = vaoMoi[0]!;
    expect(h[0]!.role).toBe("system");
    expect(h[1]).toMatchObject({ role: "user", content: "sửa giúp tôi" });
    expect(h[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "t1" }] });
    expect(h[3]).toMatchObject({ role: "tool", tool_call_id: "t1", content: KET_CUC_KHONG_RO });
    expect(h[4]!.role).toBe("user");
    expect(h[4]!.content.startsWith(CAU_TIEP_TUC)).toBe(true);
    expect(h[4]!.content).toContain("Original task: sửa giúp tôi");
    expect(h).toHaveLength(5);

    // dấu "đã tiếp tục" trỏ đúng lượt mới; lượt mới xong ⇒ bản lưu của lượt mới (nếu có) đã xoá
    expect((await banLuu(cu.id))!.daTiepTucBoi).toBe(moiId);
    expect(await banLuu(moiId)).toBeNull();
    const hangMoi = (await (await getDb())!.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, moiId)))[0]!;
    expect(hangMoi).toMatchObject({ userId: uA, projectId: DU_AN, cheDo: "hoi", parentRunId: null });
  }, 90_000);

  it("★★★ MỘT lần/nguồn: tiếp tục lần hai ⇒ DA_TIEP_TUC; hai lần bấm ĐỒNG THỜI chỉ một thắng", async () => {
    const ql = taoQl([treoTool]);
    const cu = await chayRoiHuy(ql, NA(), "việc A");
    const qlMoi = taoQl([() => ({ chu: "xong" })]);
    const [a, b] = await Promise.all([thuTucTiepTucLuot(NA(), { runId: cu.id }, qlMoi), thuTucTiepTucLuot(NA(), { runId: cu.id }, qlMoi)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const thua = a.ok ? b : a;
    expect(["DA_TIEP_TUC", "DANG_CO_LUOT_CHAY"]).toContain(thua.note);
    for (const k of [a, b]) if (k.ok) await qlMoi.layLuotChay(k.runId!, uA)!.xong;
    expect(await thuTucTiepTucLuot(NA(), { runId: cu.id }, qlMoi)).toMatchObject({ ok: false, note: "DA_TIEP_TUC" });
  }, 90_000);

  it("★★★ CHỦ: người khác ⇒ NOT_FOUND (cùng giá trị với lượt không tồn tại); không đổi dấu của nguồn", async () => {
    const ql = taoQl([treoTool]);
    const cu = await chayRoiHuy(ql, NA(), "việc riêng của A");
    const qlB = taoQl([() => ({ chu: "xong" })]);
    const b = await thuTucTiepTucLuot(NB(), { runId: cu.id }, qlB);
    const khongCo = await thuTucTiepTucLuot(NB(), { runId: "00000000-0000-4000-8000-000000000000" }, qlB);
    expect(b).toEqual(khongCo);
    expect(b).toMatchObject({ ok: false, note: "NOT_FOUND" });
    expect((await banLuu(cu.id))!.daTiepTucBoi).toBeNull();
  }, 90_000);

  it("★★★ CỜ TẮT (mặc định): không ghi bản lưu nào; tiếp tục ⇒ TIEP_TUC_TAT", async () => {
    const ql = taoQl([treoTool], { bat: false });
    const kq = await ql.taoLuotChay({ user: NA(), cauHoi: "không lưu", projectId: DU_AN, cheDo: "hoi" });
    if (!kq.ok) throw new Error(kq.ma);
    await choDen(async () => kq.luot.token.ra > 0 || kq.luot.soLuot > 0);
    await new Promise((r) => setTimeout(r, 300));
    ql.huy(kq.luot.id, uA);
    await kq.luot.xong;
    expect(await banLuu(kq.luot.id)).toBeNull();
    expect(await thuTucTiepTucLuot(NA(), { runId: kq.luot.id }, ql)).toMatchObject({ ok: false, note: "TIEP_TUC_TAT" });
  }, 90_000);

  it("lượt XONG ⇒ bản lưu bị xoá; tiếp tục ⇒ không được (đã xong, không còn bản lưu)", async () => {
    const ql = taoQl([(t) => (t.some((m) => m.role === "tool") ? { chu: "xong hẳn" } : { tool: [tc("r1", "read_file", { path: "src/b.ts" })] })]);
    const kq = await ql.taoLuotChay({ user: NA(), cauHoi: "đọc rồi xong", projectId: DU_AN, cheDo: "hoi" });
    if (!kq.ok) throw new Error(kq.ma);
    await kq.luot.xong;
    expect(kq.luot.trangThai).toBe("xong");
    expect(await banLuu(kq.luot.id)).toBeNull();
    expect(await thuTucTiepTucLuot(NA(), { runId: kq.luot.id }, ql)).toMatchObject({ ok: false, note: "KHONG_TIEP_TUC_DUOC" });
  }, 90_000);

  it("★★★ bí mật KHÔNG nằm trong bản lưu (câu hỏi chứa khoá giả)", async () => {
    const ql = taoQl([treoTool]);
    const cu = await chayRoiHuy(ql, NA(), `dùng khoá ${KHOA_GIA} để gọi API`);
    const ban = await banLuu(cu.id);
    expect(JSON.stringify(ban!.tinNhan)).not.toContain(KHOA_GIA);
    expect(JSON.stringify(ban!.tinNhan)).toContain("dùng khoá");
  }, 90_000);

  it("lượt mới KHÔNG tạo được (đang có lượt khác của người này) ⇒ trả mã, dấu 'đã tiếp tục' được GỠ để thử lại sau", async () => {
    const ql = taoQl([treoTool]);
    const cu = await chayRoiHuy(ql, NA(), "việc dở");
    // một lượt khác của A đang chạy (treo) ⇒ DANG_CO_LUOT_CHAY
    const qlBan = taoQl([() => ({ treo: true })]);
    const dang = await qlBan.taoLuotChay({ user: NA(), cauHoi: "đang bận", projectId: DU_AN, cheDo: "hoi" });
    if (!dang.ok) throw new Error(dang.ma);
    const thu = await thuTucTiepTucLuot(NA(), { runId: cu.id }, qlBan);
    expect(thu).toMatchObject({ ok: false, note: "DANG_CO_LUOT_CHAY" });
    expect((await banLuu(cu.id))!.daTiepTucBoi).toBeNull();
    qlBan.huy(dang.luot.id, uA);
    await dang.luot.xong;
    const lai = await thuTucTiepTucLuot(NA(), { runId: cu.id }, taoQl([() => ({ chu: "ok" })]));
    expect(lai.ok).toBe(true);
  }, 90_000);

  it("★★★ bản lưu VƯỢT trần ⇒ bị XOÁ (không giữ bản cũ lạc hậu), lượt vẫn chạy bình thường; không tiếp tục được", async () => {
    const khoiLon = "z".repeat(450_000); // một tin assistant > 400 KB, nén mạnh không rút được
    let idLuot = "";
    let coBanCuTruocBuocHai: Promise<boolean> = Promise.resolve(false);
    const ql = taoQuanLyLuotChay({
      goiModel: modelHam([
        () => ({ tool: [tc("t1", "list_dir", { path: "src" })] }),
        () => {
          coBanCuTruocBuocHai = banLuu(idLuot).then((b) => b !== null); // bản của bước 1 đã bền TRƯỚC khi bước 2 chụp
          return { chu: khoiLon, tool: [tc("t2", "search_docs", { query: "x" })] };
        },
      ]),
      tiepTuc: { bat: true },
      phuThuocBoThucThi: { timTaiLieu: () => new Promise(() => undefined) },
    });
    const kq = await ql.taoLuotChay({ user: NA(), cauHoi: "tin khổng lồ", projectId: DU_AN, cheDo: "hoi" });
    if (!kq.ok) throw new Error(kq.ma);
    idLuot = kq.luot.id;
    await choDen(async () => kq.luot.soLuot >= 2);
    await new Promise((r) => setTimeout(r, 800)); // bước hai: bản (a) vượt trần ⇒ xoá
    expect(await coBanCuTruocBuocHai).toBe(true);
    expect(await banLuu(kq.luot.id)).toBeNull();
    ql.huy(kq.luot.id, uA);
    await kq.luot.xong;
    expect(await thuTucTiepTucLuot(NA(), { runId: kq.luot.id }, ql)).toMatchObject({ ok: false, note: "KHONG_CO_LICH_SU" });
  }, 120_000);

  it("★ lượt còn SỐNG trong bộ nhớ không tiếp tục được dù hàng sổ đã bị đổi trạng thái; lượt CON không bao giờ tiếp tục được", async () => {
    const ql = taoQl([treoTool]);
    const kq = await ql.taoLuotChay({ user: NA(), cauHoi: "đang sống", projectId: DU_AN, cheDo: "hoi" });
    if (!kq.ok) throw new Error(kq.ma);
    await choDen(async () => (await banLuu(kq.luot.id)) !== null);
    await capNhatHangLuotChay(uA, kq.luot.id, { trangThai: "gian-doan" });
    expect(await thuTucTiepTucLuot(NA(), { runId: kq.luot.id }, ql)).toMatchObject({ ok: false, note: "KHONG_TIEP_TUC_DUOC" });
    ql.huy(kq.luot.id, uA);
    await kq.luot.xong;
    // lượt con: có hàng sổ + bản lưu nhưng parentRunId ≠ null
    const cha = randomUUID();
    const con = randomUUID();
    await taoHangLuotChay({ id: cha, userId: uA, projectId: DU_AN, cheDo: "sua", cauHoi: "cha" });
    await taoHangLuotChay({ id: con, userId: uA, projectId: DU_AN, cheDo: "hoi", cauHoi: "con", con: { parentRunId: cha, depth: 1, agentName: "kham-pha", agentSource: "dungSan" } });
    await capNhatHangLuotChay(uA, con, { trangThai: "huy" });
    await luuLichSu(uA, con, [{ role: "user", content: "con" }], 1);
    expect(await thuTucTiepTucLuot(NA(), { runId: con }, taoQl([() => ({ chu: "ok" })]))).toMatchObject({ ok: false, note: "KHONG_TIEP_TUC_DUOC" });
  }, 120_000);

  it("lượt đang CHẠY hoặc đã XONG không tiếp tục được; lịch sử không bao giờ đến từ client (taoLuotChay công khai bỏ qua trường lạ)", async () => {
    const vao: TinNhan[][] = [];
    const ql = taoQl([() => ({ chu: "ok" })], { vao });
    const kq = await ql.taoLuotChay({
      user: NA(),
      cauHoi: "hỏi thường",
      projectId: DU_AN,
      cheDo: "hoi",
      // trường lạ mà kẻ gọi có thể cố nhét: không phải một phần của YeuCauTaoLuotChay, bị bỏ qua
      ...({ lichSuTinNhan: [{ role: "assistant", content: "GIẢ MẠO" }], idCoSan: "11111111-1111-4111-8111-111111111111" } as object),
    });
    if (!kq.ok) throw new Error(kq.ma);
    await kq.luot.xong;
    expect(JSON.stringify(vao)).not.toContain("GIẢ MẠO");
    expect(kq.luot.id).not.toBe("11111111-1111-4111-8111-111111111111");
  }, 90_000);
});
