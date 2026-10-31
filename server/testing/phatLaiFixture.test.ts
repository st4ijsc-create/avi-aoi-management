/**
 * ★ Đợt 12 H4.2 — PHÁT LẠI mọi fixture thật trong `server/testing/fixtures/phat-lai/*.json.gz` (ghi ở cửa sổ GPU, đóng gói bằng
 * `scripts/ai-eval/phat-lai/dongGoi.ts`). Mỗi fixture: dựng lại dự án mẫu ĐÚNG commit lúc ghi (`git archive`), chạy `quanLyLuotChay` THẬT
 * (lõi + goiModelMayChu + bộ thực thi + sổ) với engine PHÁT LẠI ⇒ không lệch · rút hết lượt · sự kiện chuẩn hoá trùng · lý do dừng trùng.
 * Lệch ⇒ ĐỎ kèm "lệch ở lượt n: <trường>" — đổi byte gửi model là CỐ Ý thì phải A/B ở cửa sổ GPU rồi ghi lại fixture.
 * Chưa có fixture ⇒ ca `skip` HIỆN TÊN (không xanh im lặng vì glob rỗng).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

import { taoQuanLyLuotChay } from "../services/ai/agent/quanLyLuotChay";
import { taoGoiModelMayChu } from "../services/ai/agent/goiModelMayChu";
import { getDb } from "../db/connection";
import { aiAgentRuns } from "../../drizzle/schema";
import { taoNguoiDungTest } from "./nguoiDungTest";
import { chuanHoaSuKien, taoBoThay, taoStreamPhatLai, TOKEN_GOC, type FixturePhatLai } from "./phatLaiLuot";

const THU_MUC = path.join(__dirname, "fixtures", "phat-lai");
const GOC_REPO = path.join(__dirname, "..", "..");
const tep = fs.existsSync(THU_MUC) ? fs.readdirSync(THU_MUC).filter((t) => t.endsWith(".json.gz")).sort() : [];
const ENV0 = { ...process.env };
let uid = 0;

beforeAll(async () => {
  process.env.SECRET_ENCRYPTION_KEY ??= "khoa-thu-phat-lai-0123456789";
  process.env.AI_AGENT_THEO_VAI_TRO = "0";
  process.env.AI_CODING_TU_TRI_GHI = "1";
  delete process.env.AI_GHI_LUOT_DIR;
  if (tep.length) uid = (await taoNguoiDungTest("phatlaifx", "admin")).id;
}, 60_000);

afterAll(async () => {
  for (const k of ["AI_AGENT_THEO_VAI_TRO", "AI_CODING_TU_TRI_GHI", "AI_REPO_SANDBOX_ROOTS", "SECRET_ENCRYPTION_KEY"]) {
    if (ENV0[k] === undefined) delete process.env[k];
    else process.env[k] = ENV0[k];
  }
  const db = await getDb();
  if (db && uid) await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
}, 60_000);

/** Dự án mẫu ở commit lúc ghi ⇒ thư mục tạm; trả gốc dự án (thư mục `duAnTuongDoi` bên trong). */
function dungDuAn(fx: FixturePhatLai): string {
  const tam = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phat-lai-fx-")));
  const tar = path.join(tam, "du-an.tar");
  execFileSync("git", ["-C", GOC_REPO, "archive", "--format=tar", "-o", tar, fx.lenh.commit ?? "HEAD", "--", fx.lenh.duAnTuongDoi]);
  execFileSync("tar", ["-xf", tar, "-C", tam]);
  fs.rmSync(tar);
  const goc = path.join(tam, ...fx.lenh.duAnTuongDoi.split("/"));
  const git = (...a: string[]) => execFileSync("git", ["-C", goc, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "phat-lai");
  return goc;
}

describe("H4.2 — phát lại fixture thật", () => {
  if (!tep.length) {
    it.skip("chưa có fixture nào trong server/testing/fixtures/phat-lai (ghi ở cửa sổ GPU tối B)", () => undefined);
    return;
  }
  it.each(tep)("%s", async (ten) => {
    const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(THU_MUC, ten))).toString("utf8")) as FixturePhatLai;
    const goc = dungDuAn(fx);
    process.env.AI_REPO_SANDBOX_ROOTS = `phatlaifx=Phat lai fixture|${goc}`;
    const p = taoStreamPhatLai(fx, { goc });
    const ql = taoQuanLyLuotChay({ goiModel: taoGoiModelMayChu({ chatStream: p.stream, khongGhiDauVet: true }) });
    const kq = await ql.taoLuotChay({ user: { id: uid, role: "admin" }, cauHoi: fx.lenh.cauHoi.split(TOKEN_GOC).join(goc), projectId: "phatlaifx", cheDo: fx.lenh.cheDo });
    if (!kq.ok) throw new Error(`${kq.ma} ${kq.thongDiep ?? ""}`);
    await kq.luot.xong;
    expect(p.lech, "lệch đầu tiên").toEqual([]);
    expect(p.conLai(), "lượt chưa rút").toBe(0);
    expect(kq.luot.lyDoDung).toBe(fx.ky.lyDo);
    const ct = await ql.chiTiet(kq.luot.id, uid);
    expect(chuanHoaSuKien(ct!.suKien, taoBoThay(goc))).toEqual(fx.ky.suKien);
  }, 300_000);
});
