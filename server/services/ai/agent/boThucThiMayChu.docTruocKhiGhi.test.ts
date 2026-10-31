/**
 * Đợt 12 · H1.4 — KHÔNG ghi đè tệp chưa đọc / đã đổi từ lúc đọc (cờ `docTruocKhiGhi`, mặc định TẮT). Đường THẬT: repo git tạm + CSDL `_test`
 * + `executeDecision`/`confirmAction` thật (khuôn `boThucThiMayChu.test.ts`); khẳng định về BYTE trên đĩa.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { kiemThamSo, type CheDoAgent, type SuKienAgent } from "@shared/agentCore";
import { docTruocKhiGhiBat, taoBoThucThiMayChu } from "./boThucThiMayChu";
import { congCheckpointThat } from "./quanLyLuotChay";
import { thuTucBac, thuTucDuyet } from "./thuTucLuotChay";
import { _xoaBusDuyet } from "./busDuyetAgent";
import { _xoaSoBamHITL } from "../../aiLocalTools/writeHandlers/applyDiff";
import { xoaSoNganSach } from "../../aiLocalTools/repoSandbox";
import { getDb } from "../../../db/connection";
import { aiAgentRuns, aiPendingActions } from "../../../../drizzle/schema";
import { taoHangLuotChay } from "../../../db/aiAgentRuns";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { createLocalUser } from "../../../db/auth";

let REPO = "";
let KHO = "";
let KHOA_CU: string | undefined;
let uid = 0;
const NGUOI = () => ({ id: uid, role: "admin", name: "Ky su h14" });
const git = (...a: string[]) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
const doc = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
function ghiCommit(rel: string, nd: string): void {
  const abs = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, nd);
  git("add", "--", rel);
  git("commit", "-q", "-m", `add ${rel}`);
}

const taoBo = (docTruoc: boolean) =>
  taoBoThucThiMayChu({
    execCtx: { user: NGUOI(), lang: "vi", projectRoot: REPO },
    gocDuAn: REPO,
    user: NGUOI(),
    coQuyenThucThi: true,
    checkpoint: congCheckpointThat(uid),
    phuThuoc: { nhipKiemMs: 50 },
    ...(docTruoc ? { docTruocKhiGhi: true } : {}),
  });

let dem = 0;
/** `quyet`: người duyệt hay bác thẻ ghi. */
async function chay(bo: ReturnType<typeof taoBo>, ten: string, tho: unknown, quyet: "duyet" | "bac" = "duyet", cheDo: CheDoAgent = "sua") {
  const kt = kiemThamSo(ten, tho);
  if (!kt.ok) throw new Error(kt.loiChoModel);
  const runId = randomUUID();
  await taoHangLuotChay({ id: runId, userId: uid, projectId: "h14", cheDo, cauHoi: "luoi" });
  return bo.chay(
    { id: `call_${++dem}`, ten, thamSo: kt.thamSo },
    {
      cheDo,
      runId,
      luot: 1,
      signal: new AbortController().signal,
      phat: (e: SuKienAgent) => {
        if (e.loai !== "can-duyet") return;
        const y = { actionId: String(e.deXuat.pendingActionId), lang: "vi" as const };
        void (quyet === "duyet" ? thuTucDuyet(NGUOI(), y) : thuTucBac(NGUOI(), { ...y, lyDo: "khong" }));
      },
    },
  );
}
const sua = (p: string, tu: string, den: string) => ({ path: p, edits: [{ old_string: tu, new_string: den }] });

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "h14-")));
  KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "h14-kho-")));
  process.env.AI_CHECKPOINT_DIR = KHO;
  KHOA_CU = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = "luoi-checkpoint-khoa-thu-0123456789abcdef";
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  ghiCommit("package.json", '{"name":"h14","version":"1.0.0","type":"module"}\n');
  const bcrypt = await import("bcryptjs");
  uid = (await createLocalUser({ username: `h14-${Date.now()}`, passwordHash: await bcrypt.hash("Mk-h14-agent!1", 10), name: "Ky su h14", role: "admin" })).id;
  xoaSoNganSach();
  _xoaSoBamHITL();
  _xoaBusDuyet();
}, 60_000);

afterAll(async () => {
  delete process.env.AI_CHECKPOINT_DIR;
  if (KHOA_CU === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
  else process.env.SECRET_ENCRYPTION_KEY = KHOA_CU;
  const db = await getDb();
  if (db && uid > 0) {
    await db.delete(aiPendingActions).where(eq(aiPendingActions.userId, uid));
    await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, uid));
    await db.delete(userSecrets).where(eq(userSecrets.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
  for (const d of [REPO, KHO]) {
    try {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}, 60_000);

describe("công tắc", () => {
  it("chỉ '1' bật", () => {
    expect(docTruocKhiGhiBat("1")).toBe(true);
    for (const v of [undefined, "", "0", "true", "on", "yes"]) expect(docTruocKhiGhiBat(v)).toBe(false);
  });
});

describe("★★★ cờ TẮT = hành vi cũ", () => {
  it("sửa / ghi đè tệp CHƯA đọc vẫn chạy", async () => {
    ghiCommit("src/tat.ts", "export const A = 1;\n");
    const bo = taoBo(false);
    const r = await chay(bo, "edit_file", sua("src/tat.ts", "A = 1", "A = 2"));
    expect(r.ok, r.choModel).toBe(true);
    expect(doc("src/tat.ts")).toContain("A = 2");
    const w = await chay(bo, "write_file", { path: "src/tat.ts", content: "export const A = 3;\n" });
    expect(w.ok, w.choModel).toBe(true);
    expect(doc("src/tat.ts")).toContain("A = 3");
  }, 60_000);
});

describe("★★★ cờ BẬT", () => {
  it("tệp có sẵn mà CHƯA đọc: edit_file và write_file bị từ chối CHUA_DOC_TEP, đĩa nguyên byte", async () => {
    ghiCommit("src/chua.ts", "export const B = 1;\n");
    const bo = taoBo(true);
    const e = await chay(bo, "edit_file", sua("src/chua.ts", "B = 1", "B = 2"));
    expect(e.ok).toBe(false);
    expect(e.ma).toBe("CHUA_DOC_TEP");
    expect(e.choModel).toContain("read_file");
    const w = await chay(bo, "write_file", { path: "src/chua.ts", content: "export const B = 9;\n" });
    expect(w.ma).toBe("CHUA_DOC_TEP");
    expect(doc("src/chua.ts")).toBe("export const B = 1;\n");
  }, 60_000);

  it("đọc rồi sửa ⇒ chạy; sửa tiếp KHÔNG cần đọc lại (bản do chính lượt này ghi được chấp nhận); ghi đè toàn bộ cũng vậy", async () => {
    ghiCommit("src/doc.ts", "export const C = 1;\n");
    const bo = taoBo(true);
    expect((await chay(bo, "read_file", { path: "src/doc.ts" })).ok).toBe(true);
    const a = await chay(bo, "edit_file", sua("src/doc.ts", "C = 1", "C = 2"));
    expect(a.ok, a.choModel).toBe(true);
    const b = await chay(bo, "edit_file", sua("src/doc.ts", "C = 2", "C = 3"));
    expect(b.ok, b.choModel).toBe(true);
    const c = await chay(bo, "write_file", { path: "src/doc.ts", content: "export const C = 4;\n" });
    expect(c.ok, c.choModel).toBe(true);
    expect(doc("src/doc.ts")).toBe("export const C = 4;\n");
  }, 90_000);

  it("★★★ tệp bị NGƯỜI sửa ngoài sau lúc đọc ⇒ TEP_DA_DOI, đĩa giữ bản của người; đọc lại ⇒ sửa được", async () => {
    ghiCommit("src/doi.ts", "export const D = 1;\n");
    const bo = taoBo(true);
    await chay(bo, "read_file", { path: "src/doi.ts" });
    // người sửa tay rồi COMMIT (tệp dơ chưa-commit đã bị hàng rào FILE_DIRTY cũ chặn — H1.4 là lớp riêng, bắt cả bản đã commit)
    ghiCommit("src/doi.ts", "export const D = 1;\n// sửa tay trong IDE\n");
    const r = await chay(bo, "edit_file", sua("src/doi.ts", "D = 1", "D = 2"));
    expect(r.ok).toBe(false);
    expect(r.ma).toBe("TEP_DA_DOI");
    expect(doc("src/doi.ts")).toContain("sửa tay trong IDE");
    expect(doc("src/doi.ts")).toContain("D = 1");
    await chay(bo, "read_file", { path: "src/doi.ts" });
    const ok = await chay(bo, "edit_file", sua("src/doi.ts", "D = 1", "D = 2"));
    expect(ok.ok, ok.choModel).toBe(true);
    expect(doc("src/doi.ts")).toContain("sửa tay trong IDE");
    expect(doc("src/doi.ts")).toContain("D = 2");
  }, 90_000);

  it("đọc tệp KHÁC không mở khoá tệp này; đường './src/x' và 'src/x' là cùng một tệp", async () => {
    ghiCommit("src/x.ts", "export const X = 1;\n");
    ghiCommit("src/y.ts", "export const Y = 1;\n");
    const bo = taoBo(true);
    await chay(bo, "read_file", { path: "src/y.ts" });
    expect((await chay(bo, "edit_file", sua("src/x.ts", "X = 1", "X = 2"))).ma).toBe("CHUA_DOC_TEP");
    await chay(bo, "read_file", { path: "./src/x.ts" });
    const ok = await chay(bo, "edit_file", sua("src/x.ts", "X = 1", "X = 2"));
    expect(ok.ok, ok.choModel).toBe(true);
  }, 90_000);

  it("tạo tệp MỚI không cần đọc; sửa tiếp tệp vừa tạo cũng không cần", async () => {
    const bo = taoBo(true);
    const t = await chay(bo, "write_file", { path: "src/moi.ts", content: "export const M = 1;\n" });
    expect(t.ok, t.choModel).toBe(true);
    const s = await chay(bo, "edit_file", sua("src/moi.ts", "M = 1", "M = 2"));
    expect(s.ok, s.choModel).toBe(true);
    expect(doc("src/moi.ts")).toContain("M = 2");
  }, 90_000);

  it("thẻ bị BÁC ⇒ đĩa không đổi và lần sửa kế vẫn chạy (không mắc kẹt)", async () => {
    ghiCommit("src/bac.ts", "export const Z = 1;\n");
    const bo = taoBo(true);
    await chay(bo, "read_file", { path: "src/bac.ts" });
    const r = await chay(bo, "edit_file", sua("src/bac.ts", "Z = 1", "Z = 2"), "bac");
    expect(r.ok).toBe(false);
    expect(doc("src/bac.ts")).toBe("export const Z = 1;\n");
    // bản bị BÁC không được tính là "đã chấp nhận": nếu về sau đĩa đổi đúng thành bản đó (người gõ tay), vẫn phải đọc lại
    ghiCommit("src/bac.ts", "export const Z = 2;\n");
    const doiTay = await chay(bo, "edit_file", sua("src/bac.ts", "Z = 2", "Z = 5"));
    expect(doiTay.ma).toBe("TEP_DA_DOI");
    ghiCommit("src/bac.ts", "export const Z = 1;\n");
    const lai = await chay(bo, "edit_file", sua("src/bac.ts", "Z = 1", "Z = 3"));
    expect(lai.ok, lai.choModel).toBe(true);
  }, 90_000);
});
