/**
 * ★ Đợt 12 H3.2b — host truyền ngân sách ngữ cảnh theo model vào lõi (đo qua `usage.ctxPhanTram` = vao / ngân sách). Người gọi tự đặt
 * `gioiHan.nganSachNguCanhToken` ⇒ thắng (không hỏi). Lượt model ngoài ⇒ không hỏi.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

import type { GoiModel, ManhModel, SuKienAgent } from "@shared/agentCore";
import { taoQuanLyLuotChay } from "./quanLyLuotChay";
import { getDb } from "../../../db/connection";
import { aiAgentRuns } from "../../../../drizzle/schema";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";

// (rà kiem-dinh n15) bộ hỏi THẬT bị thay bằng gián điệp: lưới tiêm goiModel mà KHÔNG tiêm nganSachNguCanh thì không được chạm nó
// (không GET /props :8091 thật). Trả 32 768 để nếu bị gọi thì ctxPhanTram lệch khỏi 25 % (thấy được).
const { hoiThat } = vi.hoisted(() => ({ hoiThat: vi.fn(async () => 32_768) }));
vi.mock("./nganSachNguCanh", () => ({ nganSachNguCanhCho: hoiThat, _datLaiCanhBaoNganSach: () => undefined }));

const DU_AN = "ngansach";
let uid = 0;
const ENV0 = { ...process.env };

const model: GoiModel = async function* (): AsyncGenerator<ManhModel> {
  yield { loai: "chu", noiDung: "ok" };
  yield { loai: "xong", toolCalls: [], usage: { vao: 16_384, ra: 1 } };
};

beforeAll(async () => {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ngan-sach-")));
  execFileSync("git", ["-C", r, "init", "-q"]);
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=Ngan sach|${r}`;
  process.env.AI_AGENT_THEO_VAI_TRO = "0";
  uid = (await taoNguoiDungTest("ngansach", "admin")).id;
}, 60_000);
afterAll(async () => {
  for (const k of ["AI_REPO_SANDBOX_ROOTS", "AI_AGENT_THEO_VAI_TRO"]) {
    if (ENV0[k] === undefined) delete process.env[k];
    else process.env[k] = ENV0[k];
  }
  const db = await getDb();
  if (db && uid) await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
}, 60_000);

async function ctxPhanTram(o: Parameters<typeof taoQuanLyLuotChay>[0]) {
  const ql = taoQuanLyLuotChay(o);
  const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin" }, cauHoi: "q", projectId: DU_AN, cheDo: "hoi" });
  if (!kq.ok) throw new Error(kq.ma);
  await kq.luot.xong;
  const sk: SuKienAgent[] = [];
  ql.nghe(kq.luot.id, uid, 0, (m) => sk.push(m.suKien));
  return (sk.find((e) => e.loai === "usage") as { ctxPhanTram?: number } | undefined)?.ctxPhanTram;
}

describe("H3.2b — ngân sách ngữ cảnh tới lõi", () => {
  it("ngân sách theo model 32 768 ⇒ 16 384 vào = 50 %; hỏi đúng một lần mỗi lượt", async () => {
    let hoi = 0;
    expect(await ctxPhanTram({ goiModel: model, nganSachNguCanh: async () => (hoi++, 32_768) })).toBe(50);
    expect(hoi).toBe(1);
  });
  it("người gọi đặt gioiHan.nganSachNguCanhToken ⇒ thắng, KHÔNG hỏi", async () => {
    let hoi = 0;
    expect(await ctxPhanTram({ goiModel: model, gioiHan: { nganSachNguCanhToken: 65_536 }, nganSachNguCanh: async () => (hoi++, 32_768) })).toBe(25);
    expect(hoi).toBe(0);
  });
  it("(rà kiem-dinh n15) tiêm goiModel mà KHÔNG tiêm nganSachNguCanh ⇒ không gọi bộ hỏi thật (lưới không chạm :8091), lõi dùng 65 536", async () => {
    hoiThat.mockClear();
    expect(await ctxPhanTram({ goiModel: model })).toBe(25);
    expect(hoiThat).not.toHaveBeenCalled();
  });
  it("hỏi ngân sách lỗi ⇒ lõi dùng mặc định 65 536 (= hôm nay)", async () => {
    expect(await ctxPhanTram({ goiModel: model, nganSachNguCanh: async () => Promise.reject(new Error("x")) })).toBe(25);
  });
});
