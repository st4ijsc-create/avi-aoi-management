/**
 * ★ Đợt 10.4b L3b — lượt CỤC BỘ `tu-dong` trong phiên ĐÃ có lượt model ngoài (`coLuotNgoai`) ⇒ HẠ tự trị từ đầu: ghi phải qua người duyệt
 * (`can-duyet`, tệp chưa đổi), sự kiện `ha-tu-tri{lyDo:"phien-co-luot-ngoai"}` ngay sau `bat-dau`. Không đọc được cờ ⇒ hạ (fail-closed).
 * Phiên sạch / không phiên / chế độ khác ⇒ như cũ. Hai lớp (lõi `haTuTriDau` + bộ thực thi `haTuTri`) ghim bằng census nguồn.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

vi.hoisted(() => {
  process.env.SECRET_ENCRYPTION_KEY ??= "khoa-thu-ha-tu-tri-0123456789";
});

import type { GoiModel, ManhModel, SuKienAgent } from "@shared/agentCore";
import { taoQuanLyLuotChay } from "./quanLyLuotChay";
import { getDb } from "../../../db/connection";
import { aiAgentRuns } from "../../../../drizzle/schema";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";

const DU_AN = "hatutri";
const SID = "22222222-3333-4444-8555-666666666666";
let REPO = "";
let uid = 0;
const ENV0 = { ...process.env };

/** Lượt 1: ghi src/b.ts; lượt 2: trả lời. */
const modelGhi = (): GoiModel => {
  let i = 0;
  return async function* (): AsyncGenerator<ManhModel> {
    if (i++ === 0) {
      yield {
        loai: "xong",
        toolCalls: [{ id: "w1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "src/b.ts", content: "export const B = 1;\n" }) } }],
      };
      return;
    }
    yield { loai: "chu", noiDung: "xong" };
    yield { loai: "xong", toolCalls: [] };
  };
};

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ha-tu-tri-")));
  const git = (...a: string[]) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.mkdirSync(path.join(REPO, "src"));
  fs.writeFileSync(path.join(REPO, "src/a.ts"), "export const A = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=Ha tu tri|${REPO}`;
  process.env.AI_CODING_TU_TRI_GHI = "1";
  process.env.AI_AGENT_THEO_VAI_TRO = "0";
  uid = (await taoNguoiDungTest("hatutri", "admin")).id;
}, 60_000);

afterAll(async () => {
  for (const k of ["AI_REPO_SANDBOX_ROOTS", "AI_CODING_TU_TRI_GHI", "AI_AGENT_THEO_VAI_TRO"]) {
    if (ENV0[k] === undefined) delete process.env[k];
    else process.env[k] = ENV0[k];
  }
  const db = await getDb();
  if (db && uid) await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
}, 60_000);

/** Chạy một lượt; gặp `can-duyet` ⇒ huỷ (không duyệt) để lượt kết thúc. Trả sự kiện + số lần hỏi cờ phiên + tệp b.ts có không. */
async function chay(o: { cheDo?: string; sessionId?: string; co?: boolean | null | "nem" }) {
  try {
    fs.rmSync(path.join(REPO, "src/b.ts"), { force: true });
  } catch {
    /* sạch */
  }
  let hoi = 0;
  const ql = taoQuanLyLuotChay({
    goiModel: modelGhi(),
    phienCoLuotNgoai: async () => {
      hoi++;
      if (o.co === "nem") throw new Error("db");
      return o.co === undefined ? false : o.co;
    },
  });
  const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin" }, cauHoi: "tạo b.ts", projectId: DU_AN, cheDo: o.cheDo ?? "tu-dong", ...(o.sessionId ? { sessionId: o.sessionId } : {}) });
  if (!kq.ok) throw new Error(kq.ma);
  const sk: SuKienAgent[] = [];
  ql.nghe(kq.luot.id, uid, 0, (m) => {
    sk.push(m.suKien);
    if (m.suKien.loai === "can-duyet") setImmediate(() => ql.huy(kq.luot.id, uid));
  });
  await kq.luot.xong;
  return { sk, hoi, coB: fs.existsSync(path.join(REPO, "src/b.ts")) };
}

describe("L3b — hạ tự trị khi phiên có lượt model ngoài", () => {
  it("★★★ phiên coLuotNgoai ⇒ ghi qua người duyệt (can-duyet, b.ts CHƯA ghi); ha-tu-tri phien-co-luot-ngoai ngay sau bat-dau", async () => {
    const r = await chay({ sessionId: SID, co: true });
    expect(r.hoi).toBe(1);
    expect(r.coB).toBe(false);
    expect(r.sk.some((e) => e.loai === "can-duyet")).toBe(true);
    const i = r.sk.findIndex((e) => e.loai === "bat-dau");
    expect(r.sk[i + 1]).toEqual({ loai: "ha-tu-tri", lyDo: "phien-co-luot-ngoai", nguon: "phien", mau: [] });
  }, 60_000);

  it("không đọc được cờ phiên (null / ném) ⇒ vẫn HẠ (fail-closed)", async () => {
    for (const co of [null, "nem"] as const) {
      const r = await chay({ sessionId: SID, co });
      expect(r.coB, String(co)).toBe(false);
      expect(r.sk.some((e) => e.loai === "ha-tu-tri")).toBe(true);
    }
  }, 60_000);

  it("phiên sạch ⇒ tu-dong như cũ: ghi tự động, không can-duyet, không ha-tu-tri", async () => {
    const r = await chay({ sessionId: SID, co: false });
    expect(r.coB).toBe(true);
    expect(r.sk.some((e) => e.loai === "can-duyet" || e.loai === "ha-tu-tri")).toBe(false);
  }, 60_000);

  it("không phiên / chế độ sua ⇒ KHÔNG hỏi cờ phiên", async () => {
    expect((await chay({ co: true })).hoi).toBe(0);
    expect((await chay({ sessionId: SID, co: true, cheDo: "sua" })).hoi).toBe(0);
  }, 60_000);

  it("census — HAI lớp: lõi nhận haTuTriDau VÀ bộ thực thi nhận haTuTri, cùng từ cờ phiên", () => {
    const s = fs.readFileSync(path.join(__dirname, "quanLyLuotChay.ts"), "utf8");
    // (Đợt 12 H5.4) MỘT cờ chung = cờ phiên (L3b) ∨ nhiễm thừa hưởng từ lượt nguồn (vá tiếp tục): cấp cho CẢ HAI lớp
    expect(s).toMatch(/const haTuTriDauChung = haTuTriPhien \|\| /);
    expect(s).toMatch(/\.\.\.\(haTuTriDauChung \? \{ haTuTriDau: true \} : \{\}\)/);
    expect(s).toMatch(/\.\.\.\(haTuTriDauChung \? \{ haTuTri: true \} : \{\}\)/);
    const b = fs.readFileSync(path.join(__dirname, "boThucThiMayChu.ts"), "utf8");
    expect(b).toMatch(/cauHinh\.haTuTri !== true/);
  });
});
