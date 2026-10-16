/**
 * ★★★ Đợt 1 · T4 — QUẢN LÝ LƯỢT CHẠY, vòng ĐẦU–CUỐI phía server: MODEL GIẢ (kịch bản tool call) ⇒ lõi agent THẬT ⇒
 * bộ thực thi THẬT ⇒ tệp THẬT đổi ⇒ checkpoint THẬT ⇒ sổ `ai_agent_runs` THẬT (CSDL `_test`, mig 0390) ⇒ hoàn tác THẬT.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import type { GoiModel, ManhModel, SuKienAgent, TinNhan, WireToolCall } from "@shared/agentCore";
import { taoQuanLyLuotChay, noiVaoDem, suKienTu, locLichSu, type MucSuKien } from "./quanLyLuotChay";
import { danhSachCheckpoint } from "./checkpointAgent";
import { thuTucChiTiet, thuTucDanhSach, thuTucDuyet, thuTucHoanTac } from "./thuTucLuotChay";
import { _xoaSoBamHITL } from "../../aiLocalTools/writeHandlers/applyDiff";
import { xoaSoNganSach } from "../../aiLocalTools/repoSandbox";
import { getDb } from "../../../db/connection";
import { danhDauGianDoanKhiBoot, docHangLuotChay, taoHangLuotChay } from "../../../db/aiAgentRuns";
import { luuPhien, moPhien } from "../../../db/aiCodingSessions";
import { aiAgentRuns, aiCodingSessions, aiPendingActions } from "../../../../drizzle/schema";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { createLocalUser } from "../../../db/auth";

let REPO = "";
let KHO = "";
let KHOA_CU: string | undefined;
let uid = 0;
let uidOp = 0;
const DU_AN = "t4e2e";

function git(...a: string[]): string {
  return execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
}
function ghiCommit(rel: string, noiDung: string): void {
  const abs = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, noiDung);
  git("add", "--", rel);
  git("commit", "-q", "-m", `add ${rel}`);
}
const doc = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const NGUOI = () => ({ id: uid, role: "admin", name: "Ky su e2e" });

const tc = (id: string, name: string, args: Record<string, unknown>): WireToolCall => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

/** Model GIẢ theo kịch bản: lượt i trả `kichBan[i]` (chữ + tool call). Ghi lại tin nhắn nhận được. */
function modelKichBan(kichBan: Array<{ chu?: string; toolCalls?: WireToolCall[] }>, nhan: TinNhan[][] = []): GoiModel {
  let i = 0;
  return async function* (vao): AsyncGenerator<ManhModel> {
    nhan.push(vao.tinNhan);
    const b = kichBan[Math.min(i++, kichBan.length - 1)]!;
    if (b.chu) yield { loai: "chu", noiDung: b.chu };
    yield { loai: "xong", toolCalls: b.toolCalls ?? [], usage: { vao: 1000, ra: 50, nghi: 10 } };
  };
}

/** Model chặn tới khi bị huỷ. */
const modelCho: GoiModel = async function* (vao): AsyncGenerator<ManhModel> {
  yield { loai: "chu", noiDung: "đang làm…" };
  await new Promise<void>((r) => vao.signal.addEventListener("abort", () => r(), { once: true }));
};

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t4-e2e-")));
  KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t4-e2e-kho-")));
  process.env.AI_CHECKPOINT_DIR = KHO;
  // Manifest checkpoint KÝ HMAC (rà bảo mật a5f56d089): lưới không nạp .env ⇒ đặt bí mật server riêng cho lưới.
  KHOA_CU = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = "luoi-checkpoint-khoa-thu-0123456789abcdef";
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=T4 E2E|${REPO}`;
  // Chế độ tu-dong đòi công tắc "model ghi không người duyệt" của chủ dự án (quyết định 2026-10-17).
  process.env.AI_CODING_TU_TRI_GHI = "1";
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  ghiCommit("src/a.ts", "export function cong(a: number, b: number) {\n  return a - b;\n}\n");
  ghiCommit("src/b.ts", "export const B = 1;\n");

  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash("Mk-e2e-agent!1", 10);
  uid = (await createLocalUser({ username: `t4-e2e-${Date.now()}`, passwordHash: hash, name: "Ky su e2e", role: "admin" })).id;
  uidOp = (await createLocalUser({ username: `t4-e2e-op-${Date.now()}`, passwordHash: hash, name: "Van hanh", role: "operator" })).id;
  xoaSoNganSach();
  _xoaSoBamHITL();
}, 60_000);

afterAll(async () => {
  delete process.env.AI_CHECKPOINT_DIR;
  if (KHOA_CU === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
  else process.env.SECRET_ENCRYPTION_KEY = KHOA_CU;
  delete process.env.AI_REPO_SANDBOX_ROOTS;
  delete process.env.AI_CODING_TU_TRI_GHI;
  const db = await getDb();
  if (db) {
    for (const u of [uid, uidOp].filter((x) => x > 0)) {
      await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, u));
      await db.delete(aiCodingSessions).where(eq(aiCodingSessions.userId, u));
      await db.delete(aiPendingActions).where(eq(aiPendingActions.userId, u));
      await db.delete(userSecrets).where(eq(userSecrets.userId, u));
      await db.delete(users).where(eq(users.id, u));
    }
  }
  for (const d of [REPO, KHO]) {
    try {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}, 60_000);

describe("§1 — vòng đầu–cuối tu-dong: model giả gọi tool ⇒ tệp thật đổi ⇒ checkpoint ⇒ sổ ⇒ hoàn tác", () => {
  it("★★★ đọc → sửa → trả lời; sổ 'xong', checkpoint có, sự kiện phát lại được; hoàn tác trả đúng byte", async () => {
    const truoc = doc("src/a.ts");
    const nhan: TinNhan[][] = [];
    const ql = taoQuanLyLuotChay({
      goiModel: modelKichBan(
        [
          { toolCalls: [tc("c1", "read_file", { path: "src/a.ts" })] },
          { chu: "Sửa dấu.", toolCalls: [tc("c2", "edit_file", { path: "src/a.ts", edits: [{ old_string: "return a - b;", new_string: "return a + b;" }] })] },
          { chu: "Đã sửa `cong` cho đúng phép cộng." },
        ],
        nhan,
      ),
    });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "sửa hàm cong", projectId: DU_AN, cheDo: "tu-dong" });
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    const nghe: MucSuKien[] = [];
    ql.nghe(kq.luot.id, uid, 0, (m) => nghe.push(m));
    await kq.luot.xong;

    expect(doc("src/a.ts")).toContain("return a + b;");
    // ngữ cảnh dự án vào system prompt
    expect(nhan[0]![0]!.content).toContain("Project: T4 E2E");
    expect(nhan[0]![0]!.content).toContain("src/a.ts");
    expect(nhan[0]![0]!.content).toContain("node --test <đường-dẫn>");
    // kết quả read_file (đánh số dòng) vào lượt 2
    expect(nhan[1]!.some((m) => m.role === "tool" && m.content.includes("2\t  return a - b;"))).toBe(true);

    const loai = nghe.map((m) => m.suKien.loai);
    expect(loai[0]).toBe("bat-dau");
    expect(loai).toContain("checkpoint");
    expect(loai[loai.length - 1]).toBe("xong");
    expect(nghe.map((m) => m.seq)).toEqual(nghe.map((_, i) => i + 1));

    const cps = await danhSachCheckpoint(kq.luot.id);
    expect(cps.length).toBe(1);
    expect(kq.luot.checkpointIds).toEqual([cps[0]!.id]);

    const hang = await docHangLuotChay(uid, kq.luot.id);
    expect(hang?.trangThai).toBe("xong");
    expect(hang?.lyDoDung).toBe("hoan-thanh");
    expect(hang?.soLuot).toBe(2);
    expect(hang?.tokenVao).toBe(3000);
    expect(hang?.checkpointIds).toEqual([cps[0]!.id]);
    expect((hang?.suKien as MucSuKien[]).some((m) => m.suKien.loai === "xong")).toBe(true);

    // phát lại từ giữa (nối lại)
    const tu = nghe.find((m) => m.suKien.loai === "checkpoint")!.seq;
    const lai: MucSuKien[] = [];
    ql.nghe(kq.luot.id, uid, tu, (m) => lai.push(m));
    expect(lai.map((m) => m.seq)).toEqual(nghe.filter((m) => m.seq > tu).map((m) => m.seq));

    // người khác không thấy
    expect(ql.layLuotChay(kq.luot.id, uidOp)).toBeNull();
    expect(ql.nghe(kq.luot.id, uidOp, 0, () => {})).toBeNull();
    expect(await ql.chiTiet(kq.luot.id, uidOp)).toBeNull();

    // hoàn tác cả lượt chạy ⇒ đúng byte
    const ht = await ql.hoanTac({ runId: kq.luot.id, user: NGUOI(), lang: "vi" });
    expect(ht.ok).toBe(true);
    if (ht.ok) expect(ht.ketQua.khoiPhuc).toEqual(["src/a.ts"]);
    expect(doc("src/a.ts")).toBe(truoc);
  }, 60_000);
});

describe("§2 — chế độ sua đầu–cuối: can-duyet ⇒ người duyệt (aiAgent.duyet) ⇒ ghi ⇒ xong", () => {
  it("★★★ trạng thái cho-duyet trong lúc chờ, rồi xong; tệp đổi", async () => {
    const ql = taoQuanLyLuotChay({
      goiModel: modelKichBan([
        { toolCalls: [tc("d1", "write_file", { path: "src/moi.ts", content: "export const M = 1;\n" })] },
        { chu: "Đã tạo src/moi.ts." },
      ]),
      phuThuocBoThucThi: { nhipKiemMs: 50 },
    });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "tạo tệp", projectId: DU_AN, cheDo: "sua" });
    if (!kq.ok) throw new Error(kq.ma);
    let trangThaiKhiCho = "";
    ql.nghe(kq.luot.id, uid, 0, (m) => {
      const e = m.suKien;
      if (e.loai === "can-duyet") {
        trangThaiKhiCho = kq.luot.trangThai;
        void thuTucDuyet(NGUOI(), { actionId: String(e.deXuat.pendingActionId), lang: "vi" });
      }
    });
    await kq.luot.xong;
    expect(trangThaiKhiCho).toBe("cho-duyet");
    expect(kq.luot.trangThai).toBe("xong");
    expect(doc("src/moi.ts")).toBe("export const M = 1;\n");
  }, 60_000);
});

describe("§3 — một lượt/người, huỷ, quyền, đầu vào", () => {
  it("★★★ lượt thứ hai khi lượt đầu còn chạy ⇒ DANG_CO_LUOT_CHAY (409); huỷ ⇒ 'huy' trong sổ", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelCho });
    const a = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "việc dài", projectId: DU_AN, cheDo: "hoi" });
    if (!a.ok) throw new Error(a.ma);
    const b = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "việc khác", projectId: DU_AN, cheDo: "hoi" });
    expect(b).toMatchObject({ ok: false, ma: "DANG_CO_LUOT_CHAY", http: 409, runId: a.luot.id });
    expect(ql.huy(a.luot.id, uidOp), "người khác không huỷ được").toBe(false);
    expect(ql.huy(a.luot.id, uid)).toBe(true);
    await a.luot.xong;
    expect(a.luot.trangThai).toBe("huy");
    expect((await docHangLuotChay(uid, a.luot.id))?.trangThai).toBe("huy");
    // hết lượt cũ ⇒ tạo được lượt mới
    const c = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "lại", projectId: DU_AN, cheDo: "hoi" });
    expect(c.ok).toBe(true);
    if (c.ok) {
      ql.huy(c.luot.id, uid);
      await c.luot.xong;
    }
  }, 30_000);

  it("★★ client bỏ đi (gỡ người nghe) KHÔNG huỷ lượt chạy", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelCho });
    const a = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "x", projectId: DU_AN, cheDo: "hoi" });
    if (!a.ok) throw new Error(a.ma);
    const go = ql.nghe(a.luot.id, uid, 0, () => {});
    go?.();
    await new Promise((r) => setTimeout(r, 50));
    expect(a.luot.boHuy.signal.aborted).toBe(false);
    expect(a.luot.ketThuc).toBeNull();
    ql.huy(a.luot.id, uid);
    await a.luot.xong;
  });

  it("★★★ quyền THẬT: vai operator (không ai_repo_read) ⇒ THIEU_QUYEN 403", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelCho });
    const r = await ql.taoLuotChay({ user: { id: uidOp, role: "operator" }, cauHoi: "x", projectId: DU_AN, cheDo: "hoi" });
    expect(r).toMatchObject({ ok: false, ma: "THIEU_QUYEN", http: 403 });
  });

  it("★★ tu-dong mà thiếu ai_repo_exec ⇒ THIEU_QUYEN_THUC_THI", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelCho, kiemQuyen: async (_u, m) => m === "ai_repo_read" });
    const r = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "x", projectId: DU_AN, cheDo: "tu-dong" });
    expect(r).toMatchObject({ ok: false, ma: "THIEU_QUYEN_THUC_THI", http: 403 });
  });

  it("★★★ tu-dong mà công tắc AI_CODING_TU_TRI_GHI TẮT ⇒ TU_DONG_TAT 403, không tạo lượt chạy (cùng công tắc của vòng tự ghi cũ)", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelCho });
    const cu = process.env.AI_CODING_TU_TRI_GHI;
    delete process.env.AI_CODING_TU_TRI_GHI;
    try {
      const r = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "x", projectId: DU_AN, cheDo: "tu-dong" });
      expect(r).toMatchObject({ ok: false, ma: "TU_DONG_TAT", http: 403 });
      expect(ql._dangChay()).toBe(0);
      // chế độ sua không cần công tắc này
      const s2 = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "x", projectId: DU_AN, cheDo: "hoi" });
      expect(s2.ok).toBe(true);
      if (s2.ok) { ql.huy(s2.luot.id, uid); await s2.luot.xong; }
    } finally {
      if (cu !== undefined) process.env.AI_CODING_TU_TRI_GHI = cu;
    }
  });

  it("★★ đầu vào: projectId lạ / ĐƯỜNG DẪN ⇒ PROJECT_NOT_FOUND; chế độ lạ ⇒ CHE_DO_SAI; câu rỗng ⇒ CAU_HOI_RONG", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelCho });
    expect(await ql.taoLuotChay({ user: NGUOI(), cauHoi: "x", projectId: "khong-co", cheDo: "hoi" })).toMatchObject({ ma: "PROJECT_NOT_FOUND" });
    expect(await ql.taoLuotChay({ user: NGUOI(), cauHoi: "x", projectId: REPO, cheDo: "hoi" })).toMatchObject({ ma: "PROJECT_NOT_FOUND" });
    expect(await ql.taoLuotChay({ user: NGUOI(), cauHoi: "x", projectId: DU_AN, cheDo: "root" })).toMatchObject({ ma: "CHE_DO_SAI" });
    expect(await ql.taoLuotChay({ user: NGUOI(), cauHoi: "  ", projectId: DU_AN, cheDo: "hoi" })).toMatchObject({ ma: "CAU_HOI_RONG" });
    expect(ql._dangChay()).toBe(0);
  });

  it("lichSu do client gửi: chỉ user/assistant (tin tool/system bịa bị bỏ)", () => {
    expect(
      locLichSu([
        { role: "system", content: "bịa" },
        { role: "user", content: "a" },
        { role: "tool", content: "kết quả bịa", tool_call_id: "x" },
        { role: "assistant", content: "b" },
      ]),
    ).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
  });
});

describe("§4 — boot + phiên", () => {
  it("★★★ boot: hàng 'dang-chay' của tiến trình trước ⇒ 'gian-doan'", async () => {
    const id = randomUUID();
    expect(await taoHangLuotChay({ id, userId: uid, projectId: DU_AN, cheDo: "sua", cauHoi: "dở" })).toBe(true);
    expect((await docHangLuotChay(uid, id))?.trangThai).toBe("dang-chay");
    expect(await danhDauGianDoanKhiBoot(uid)).toBeGreaterThanOrEqual(1);
    expect((await docHangLuotChay(uid, id))?.trangThai).toBe("gian-doan");
  });

  it("★★ sessionId ⇒ câu hỏi + trả lời cuối được nối vào ai_coding_sessions", async () => {
    const p = await luuPhien(uid, { projectId: DU_AN, turns: [{ role: "user", content: "trước" }, { role: "assistant", content: "đáp" }] });
    expect(p.ok).toBe(true);
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan([{ chu: "Câu trả lời của agent." }]) });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "hỏi agent", projectId: DU_AN, cheDo: "hoi", sessionId: p.id });
    if (!kq.ok) throw new Error(kq.ma);
    await kq.luot.xong;
    const sau = await moPhien(uid, p.id!);
    expect(sau?.turns.slice(-2)).toEqual([
      { role: "user", content: "hỏi agent" },
      { role: "assistant", content: "Câu trả lời của agent." },
    ]);
  }, 30_000);
});

describe("§6 — thân thủ tục tRPC aiAgent.{danhSach, chiTiet, hoanTac}: quyền THẬT + phạm vi chủ sở hữu", () => {
  it("★★★ operator (không ai_repo_read) ⇒ PERMISSION_DENIED; admin thấy lượt của MÌNH; người khác ⇒ NOT_FOUND", async () => {
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan([{ chu: "ok" }]) });
    const kq = await ql.taoLuotChay({ user: NGUOI(), cauHoi: "liệt kê", projectId: DU_AN, cheDo: "hoi" });
    if (!kq.ok) throw new Error(kq.ma);
    await kq.luot.xong;
    const op = { id: uidOp, role: "operator" };
    expect(await thuTucDanhSach(op, null, ql)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(await thuTucChiTiet(op, kq.luot.id, ql)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(await thuTucHoanTac(op, { runId: kq.luot.id, lang: "vi" }, ql)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    const ds = await thuTucDanhSach(NGUOI(), DU_AN, ql);
    expect(ds.ok).toBe(true);
    expect(ds.runs.map((r) => r.id)).toContain(kq.luot.id);
    const ct = await thuTucChiTiet(NGUOI(), kq.luot.id, ql);
    expect(ct.ok).toBe(true);
    expect(ct.run?.suKien.map((m) => m.suKien.loai)).toEqual(["bat-dau", "chu", "usage", "xong"]);
    // admin KHÁC (đủ quyền) vẫn không thấy lượt của người khác — CÙNG mã với "không tồn tại"
    const admin2 = await createLocalUser({ username: `t4-e2e-a2-${Date.now()}`, passwordHash: "x", name: "A2", role: "admin" });
    try {
      expect(await thuTucChiTiet({ id: admin2.id, role: "admin" }, kq.luot.id, ql)).toMatchObject({ ok: false, note: "NOT_FOUND" });
      expect(await thuTucChiTiet({ id: admin2.id, role: "admin" }, randomUUID(), ql)).toMatchObject({ ok: false, note: "NOT_FOUND" });
      expect(await thuTucHoanTac({ id: admin2.id, role: "admin" }, { runId: kq.luot.id, lang: "vi" }, ql)).toMatchObject({ ok: false, note: "NOT_FOUND" });
    } finally {
      const db = await getDb();
      await db!.delete(userSecrets).where(eq(userSecrets.userId, admin2.id));
      await db!.delete(users).where(eq(users.id, admin2.id));
    }
  }, 30_000);
});

describe("§5 — bộ đệm sự kiện (thuần)", () => {
  it("★★ gộp delta chữ liền nhau; phát lại từ GIỮA mục gộp chỉ ra phần sau", () => {
    const dem: Parameters<typeof noiVaoDem>[0] = [];
    const ev: SuKienAgent[] = [
      { loai: "bat-dau", runId: "r", cheDo: "hoi" },
      { loai: "chu", noiDung: "Xin " },
      { loai: "chu", noiDung: "chào " },
      { loai: "chu", noiDung: "bạn" },
      { loai: "nghi", noiDung: "n" },
      { loai: "xong", lyDo: "hoan-thanh" },
    ];
    ev.forEach((e, i) => noiVaoDem(dem, { seq: i + 1, suKien: e }));
    expect(dem.length).toBe(4);
    expect(suKienTu(dem, 0).map((m) => m.suKien)).toEqual([ev[0], { loai: "chu", noiDung: "Xin chào bạn" }, ev[4], ev[5]]);
    expect(suKienTu(dem, 2)[0]).toEqual({ seq: 4, suKien: { loai: "chu", noiDung: "chào bạn" } });
    expect(suKienTu(dem, 3)[0]).toEqual({ seq: 4, suKien: { loai: "chu", noiDung: "bạn" } });
    expect(suKienTu(dem, 4).map((m) => m.seq)).toEqual([5, 6]);
  });
});
