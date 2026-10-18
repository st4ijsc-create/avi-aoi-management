/**
 * ★★★ Đợt 1 · T2 (2026-10-14) — **LƯỚI CHO `delete_file` / `rename_file`: HAI TOOL GHI MỚI CỦA AGENT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẤT BIẾN PHÁT BIỂU Ở ĐÂY (spec `2026-10-14-ai-local-dot1-loi-agent-design.md` §2 + §4)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. HITL — cả hai là `kind:"write"`, KHÔNG `handler`; một quyết định gọi chúng chỉ ra `pendingAction`.
 *   2. HÀNG RÀO — đúng bốn lớp của `apply_diff.phanQuyet` cho MỌI đường (rename: CẢ nguồn LẪN đích):
 *      chính sách đường (.. / tuyệt đối / .env / thư mục cấm / đuôi) → hộp cát (junction, hard link,
 *      thư mục) → băm → git (bẩn / chưa track / bị ignore ⇒ TỪ CHỐI, trừ sổ băm HITL).
 *   3. PREVIEW KHÔNG CHẠM ĐĨA; EXECUTE chạy LẠI mọi hàng rào (TOCTOU) rồi mới qua cửa đĩa.
 *   4. KẾT QUẢ mang băm (`bamTruoc`/`bamSau`/`thayDoi`) đủ cho checkpoint — KHÔNG mang nội dung.
 *   5. CỬA ĐĨA (`xoaConfined`/`doiTenConfined`) tự kiểm lại trên fd: tráo tệp sau khi qua cửa ⇒ từ chối.
 *
 * ⚠ Repo git THẬT dựng tạm — hàng rào bẩn hỏi `git status` thật (cùng lý do `applyDiff.census.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const proposeActionMock = vi.fn();
vi.mock("../aiCopilotActions", () => ({
  proposeAction: (...a: unknown[]) => proposeActionMock(...a),
}));

import "./index"; // đăng ký TOÀN BỘ tool (side-effect)
import { executeDecision } from "./index";
import { listTools, type Tool } from "./toolRegistry";
import { xoaSoNganSach, nganSachConLai, gocHopCat } from "./repoSandbox";
import { _xoaSoBamHITL } from "./writeHandlers/applyDiff";
import { confineTargetUnder, doiTenConfined, xoaConfined } from "./readToolsProgramming";
import { chonDuocTheoTrigger } from "./intentClassifier";
import { phanLoaiTuTri } from "../ai/autonomyPolicy";

const CTX = { user: { id: 7, role: "engineer", name: "T" }, lang: "vi" as const };

let REPO = "";
let NGOAI = "";
let KHONG_GIT = "";
let junctionOk = false;
let junctionErr: string | null = null;
let hardlinkOk = false;
let hardlinkErr: string | null = null;
const BI_MAT = "export const NGOAI_CANARY = 'XDT-CANARY-51c0';\n";

function git(...args: string[]): string {
  return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" });
}
function bam(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function ghiCommit(rel: string, noiDung: string | Buffer): void {
  const abs = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, noiDung);
  git("add", "--", rel);
  git("commit", "-q", "-m", `add ${rel}`);
}
function co(rel: string, goc = REPO): boolean {
  return fs.existsSync(path.join(goc, rel));
}
function doc(rel: string, goc = REPO): string {
  return fs.readFileSync(path.join(goc, rel), "utf8");
}
function tool(ten: string): Tool<any, any> {
  return listTools().find((t) => t.name === ten)!;
}
const xoa = () => tool("delete_file");
const doiTen = () => tool("rename_file");
const apDung = () => tool("apply_diff");

beforeAll(() => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xoa-doi-ten-")));
  NGOAI = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xoa-doi-ten-ngoai-")));
  KHONG_GIT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xoa-doi-ten-khong-git-")));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // ⚠ Windows core.autocrlf=true làm băm lệch vì kiểu xuống dòng, không vì nội dung.
  git("config", "core.autocrlf", "false");
  ghiCommit(".gitignore", "*.local.ts\n");
  for (const rel of [
    "src/xoa-sach.ts",
    "src/xoa-ban.ts",
    "src/xoa-toctou.ts",
    "src/xoa-preview.ts",
    "src/doi-nguon.ts",
    "src/doi-ban.ts",
    "src/doi-preview.ts",
    "src/doi-dich-co-san.ts",
    "src/doi-dich-bi-xoa.ts",
    "src/doi-so.ts",
    "src/doi-ngan-sach.ts",
  ]) {
    ghiCommit(rel, `export const X = ${JSON.stringify(rel)};\n`);
  }
  fs.mkdirSync(path.join(REPO, "src", "thu-muc.ts"), { recursive: true });
  fs.writeFileSync(path.join(REPO, "src", "thu-muc.ts", "ben-trong.ts"), "x\n");
  git("add", "--", "src/thu-muc.ts/ben-trong.ts");
  git("commit", "-q", "-m", "thu muc");

  fs.writeFileSync(path.join(NGOAI, "outside.ts"), BI_MAT); // đích JUNCTION — nlink phải = 1
  fs.writeFileSync(path.join(NGOAI, "outside-hl.ts"), BI_MAT); // đích HARD LINK
  try {
    fs.symlinkSync(NGOAI, path.join(REPO, "alias-ngoai"), "junction");
    junctionOk = true;
  } catch (e) {
    junctionErr = `${(e as NodeJS.ErrnoException).code}: ${(e as Error).message}`;
  }
  try {
    fs.linkSync(path.join(NGOAI, "outside-hl.ts"), path.join(REPO, "src", "lien-ket-cung.ts"));
    git("add", "--", "src/lien-ket-cung.ts");
    git("commit", "-q", "-m", "hl");
    hardlinkOk = true;
  } catch (e) {
    hardlinkErr = `${(e as NodeJS.ErrnoException).code}: ${(e as Error).message}`;
  }
  fs.writeFileSync(path.join(KHONG_GIT, "co-san.ts"), "export const NGUOI_VIET = 1;\n");
});

afterAll(() => {
  delete process.env.AI_REPO_SANDBOX_ROOT;
  for (const d of [REPO, NGOAI, KHONG_GIT]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

beforeEach(() => {
  proposeActionMock.mockReset();
  xoaSoNganSach();
  _xoaSoBamHITL();
  process.env.AI_REPO_SANDBOX_ROOT = REPO;
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — CẦU CHÌ: hình dạng tool + môi trường", () => {
  for (const ten of ["delete_file", "rename_file"]) {
    it(`★★★ ${ten}: write tool không handler, ai_repo_read/canEdit, CHỈ cho agent (không trigger)`, () => {
      const t = tool(ten);
      expect(t, `${ten} phải nằm trong sổ đăng ký`).toBeTruthy();
      expect(t.kind).toBe("write");
      expect(typeof t.handler, "read-handler = một đường ghi KHÔNG qua HITL").toBe("undefined");
      expect(typeof t.preview).toBe("function");
      expect(typeof t.execute).toBe("function");
      expect(typeof t.summarize).toBe("function");
      expect(t.requiredPermission).toEqual({ module: "ai_repo_read", action: "canEdit" });
      expect(t.triggers, "đường cũ (bộ chọn theo trigger) KHÔNG được với tới tool agent").toEqual([]);
      expect(t.chiChoAgent).toBe(true);
      expect(chonDuocTheoTrigger(t)).toBe(false);
      // Tự trị: KHÔNG BAO GIỜ "đã duyệt an toàn" (hôm nay CHUA_PHAN_LOAI ⇒ cấm lúc chạy; đích: INELIGIBLE).
      expect(phanLoaiTuTri(ten)).not.toBe("REVIEWED_SAFE");
    });
  }

  it("★ MÔI TRƯỜNG — junction + hard link dựng được (không thì các ca thoát hộp cát xanh vì NOT_FOUND)", () => {
    expect(gocHopCat()).toBe(REPO);
    expect(junctionOk, `junction: ${junctionErr}`).toBe(true);
    expect(hardlinkOk, `hard link: ${hardlinkErr}`).toBe(true);
    expect(fs.readFileSync(path.join(REPO, "alias-ngoai", "outside.ts"), "utf8")).toBe(BI_MAT);
    expect(fs.statSync(path.join(NGOAI, "outside.ts")).nlink, "đích junction phải nlink=1 (không xanh nhờ HARD_LINK)").toBe(1);
    expect(fs.statSync(path.join(REPO, "src", "lien-ket-cung.ts")).nlink).toBeGreaterThan(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§A — HITL: quyết định gọi tool ⇒ ĐỀ XUẤT, đĩa KHÔNG đổi", () => {
  it("★★★ delete_file qua executeDecision ⇒ proposeAction, không result, tệp CÒN NGUYÊN", async () => {
    proposeActionMock.mockResolvedValue({ ok: true, pendingAction: { id: "gia", tool: "delete_file" } });
    const truoc = doc("src/xoa-sach.ts");
    const ra = await executeDecision({ tool: "delete_file", args: { path: "src/xoa-sach.ts" } }, CTX);
    expect(proposeActionMock).toHaveBeenCalledTimes(1);
    expect(ra.result).toBeNull();
    expect(ra.pendingAction).toEqual({ id: "gia", tool: "delete_file" });
    expect(doc("src/xoa-sach.ts")).toBe(truoc);
  });

  it("★★★ rename_file qua executeDecision ⇒ proposeAction, nguồn còn, đích chưa có", async () => {
    proposeActionMock.mockResolvedValue({ ok: true, pendingAction: { id: "gia2", tool: "rename_file" } });
    await executeDecision({ tool: "rename_file", args: { from: "src/doi-nguon.ts", to: "src/da-doi.ts" } }, CTX);
    expect(proposeActionMock).toHaveBeenCalledTimes(1);
    expect(co("src/doi-nguon.ts")).toBe(true);
    expect(co("src/da-doi.ts")).toBe(false);
  });

  it("★★ không ngữ cảnh phiên ⇒ WRITE_TOOL_REQUIRES_CONTEXT", async () => {
    const ra = await executeDecision({ tool: "delete_file", args: { path: "src/xoa-sach.ts" } }, undefined);
    expect(ra.error).toBe("WRITE_TOOL_REQUIRES_CONTEXT");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§B — delete_file: MỌI hàng rào từ chối, đĩa NGUYÊN VẸN", () => {
  const xau: Array<[string, string, string]> = [
    ["đường `..`", "../ngoai.ts", "PATH_REJECTED"],
    ["tuyệt đối", process.platform === "win32" ? "C:/Windows/x.ts" : "/etc/x.ts", "PATH_REJECTED"],
    ["ổ đĩa ở GIỮA", "src/C:/x.ts", "PATH_REJECTED"],
    ["bí mật .env", ".env", "DENIED_SECRET"],
    ["bí mật .env.bak", ".env.bak-cu", "DENIED_SECRET"],
    ["thư mục cấm", "node_modules/x/index.ts", "DENIED_DIR"],
    ["đuôi ngoài danh sách trắng", "src/anh.png", "DENIED_EXT"],
    ["thư mục (dù tên có đuôi .ts)", "src/thu-muc.ts", "NOT_A_FILE"],
    ["không tồn tại", "src/khong-co.ts", "NOT_FOUND"],
  ];
  for (const [ten, p, ma] of xau) {
    it(`★★★ ${ten} (${p}) ⇒ ${ma}`, async () => {
      const r = await xoa().execute!({ path: p } as never, CTX as never);
      expect(r.note, `${p}: ${r.textSummary}`).toBe(ma);
      expect((r.data as { ok: boolean }).ok).toBe(false);
    });
  }
  it("★★★ thư mục KHÔNG bị xoá (nội dung trong nó còn nguyên)", async () => {
    await xoa().execute!({ path: "src/thu-muc.ts" } as never, CTX as never);
    expect(co("src/thu-muc.ts/ben-trong.ts")).toBe(true);
  });

  it("★★★ JUNCTION trỏ ra ngoài ⇒ PATH_REJECTED, tệp ngoài NGUYÊN VẸN", async () => {
    const r = await xoa().execute!({ path: "alias-ngoai/outside.ts" } as never, CTX as never);
    expect(r.note).toBe("PATH_REJECTED");
    expect(fs.readFileSync(path.join(NGOAI, "outside.ts"), "utf8")).toBe(BI_MAT);
  });

  it("★★★ HARD LINK (inode dùng chung với tệp ngoài) ⇒ PATH_REJECTED, cả hai tên còn", async () => {
    const r = await xoa().execute!({ path: "src/lien-ket-cung.ts" } as never, CTX as never);
    expect(r.note).toBe("PATH_REJECTED");
    expect(co("src/lien-ket-cung.ts")).toBe(true);
    expect(fs.readFileSync(path.join(NGOAI, "outside-hl.ts"), "utf8")).toBe(BI_MAT);
  });

  it("★★★ tệp có thay đổi CHƯA COMMIT ⇒ FILE_DIRTY, tệp còn nguyên", async () => {
    const ban = doc("src/xoa-ban.ts") + "// sua tay chua commit\n";
    fs.writeFileSync(path.join(REPO, "src/xoa-ban.ts"), ban);
    const r = await xoa().execute!({ path: "src/xoa-ban.ts" } as never, CTX as never);
    expect(r.note).toBe("FILE_DIRTY");
    expect(doc("src/xoa-ban.ts")).toBe(ban);
    git("checkout", "--", "src/xoa-ban.ts");
  });

  it("★★★ tệp CHƯA TRACK (??) ⇒ FILE_DIRTY (toàn bộ tệp là công việc chưa commit)", async () => {
    fs.writeFileSync(path.join(REPO, "src/chua-track.ts"), "export const U = 1;\n");
    const r = await xoa().execute!({ path: "src/chua-track.ts" } as never, CTX as never);
    expect(r.note).toBe("FILE_DIRTY");
    expect(co("src/chua-track.ts")).toBe(true);
    fs.rmSync(path.join(REPO, "src/chua-track.ts"));
  });

  it("★★★ tệp bị .gitignore (git KHÔNG khôi phục được) ⇒ FILE_DIRTY — `git status` trần sẽ nói 'sạch'", async () => {
    fs.writeFileSync(path.join(REPO, "src/cau-hinh.local.ts"), "export const MAY_CUA_TOI = 1;\n");
    const r = await xoa().execute!({ path: "src/cau-hinh.local.ts" } as never, CTX as never);
    expect(r.note, r.textSummary).toBe("FILE_DIRTY");
    expect(co("src/cau-hinh.local.ts")).toBe(true);
    fs.rmSync(path.join(REPO, "src/cau-hinh.local.ts"));
  });

  it("★★★ gốc KHÔNG có git + tệp người viết ⇒ GIT_STATUS_FAILED (không chứng minh được gì)", async () => {
    const r = await xoa().execute!({ path: "co-san.ts" } as never, { ...CTX, projectRoot: KHONG_GIT } as never);
    expect(r.note).toBe("GIT_STATUS_FAILED");
    expect(co("co-san.ts", KHONG_GIT)).toBe(true);
  });

  it("★ thiếu path ⇒ MISSING_REQUIRED_ARG (không ném)", async () => {
    const r = await xoa().execute!({} as never, CTX as never);
    expect(r.note).toBe("MISSING_REQUIRED_ARG");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§C — delete_file: preview KHÔNG ghi, execute xoá đúng, TOCTOU kiểm lại", () => {
  it("★★★ preview khai nội dung SẼ MẤT + băm, và tệp VẪN CÒN", async () => {
    const noiDung = doc("src/xoa-preview.ts");
    const pv = await xoa().preview!({ path: "src/xoa-preview.ts" } as never, CTX as never);
    const truong = Object.fromEntries(pv.changes.map((c) => [c.field, c]));
    expect(truong.path!.oldValue).toBe("src/xoa-preview.ts");
    expect(truong.path!.newValue).toBeNull();
    expect(truong.sha256Before!.newValue).toBe(bam(noiDung));
    expect(String(truong.content!.oldValue)).toContain("xoa-preview");
    expect(truong.content!.newValue).toBeNull();
    expect(pv.warnings.join("\n")).toMatch(/XOÁ|xoá/);
    expect(co("src/xoa-preview.ts"), "preview KHÔNG được chạm đĩa").toBe(true);
  });

  it("★★★ preview của tệp bị chặn chỉ KHAI từ chối, không có `changes`", async () => {
    const pv = await xoa().preview!({ path: ".env" } as never, CTX as never);
    expect(pv.changes).toEqual([]);
    expect(pv.warnings.join(" ")).toContain(".env");
  });

  it("★★★ execute tệp SẠCH ⇒ xoá, kết quả mang băm (KHÔNG mang nội dung), git khôi phục được", async () => {
    const noiDung = doc("src/xoa-sach.ts");
    const r = await xoa().execute!({ path: "src/xoa-sach.ts" } as never, CTX as never);
    expect(r.note, r.textSummary).toBeUndefined();
    expect(co("src/xoa-sach.ts")).toBe(false);
    const d = r.data as Record<string, unknown>;
    expect(d.ok).toBe(true);
    expect(d.loai).toBe("xoa");
    expect(d.bamTruoc).toBe(bam(noiDung));
    expect(d.bamSau).toBeNull();
    expect(d.thayDoi).toEqual([{ duong: "src/xoa-sach.ts", loai: "xoa", bamSau: null }]);
    expect(JSON.stringify(r), "nội dung trước KHÔNG được ra model").not.toContain("xoa-sach.ts\";");
    git("checkout", "--", "src/xoa-sach.ts");
    expect(doc("src/xoa-sach.ts")).toBe(noiDung);
  });

  it("★★★ TOCTOU — preview xanh → người sửa tay → execute TỪ CHỐI, tệp còn bản người sửa", async () => {
    const pv = await xoa().preview!({ path: "src/xoa-toctou.ts" } as never, CTX as never);
    expect(pv.changes.length).toBeGreaterThan(0);
    const ban = doc("src/xoa-toctou.ts") + "// vua sua\n";
    fs.writeFileSync(path.join(REPO, "src/xoa-toctou.ts"), ban);
    const r = await xoa().execute!({ path: "src/xoa-toctou.ts" } as never, CTX as never);
    expect(r.note).toBe("FILE_DIRTY");
    expect(doc("src/xoa-toctou.ts")).toBe(ban);
    git("checkout", "--", "src/xoa-toctou.ts");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§D — SỔ BĂM HITL: chỉ tệp mà TOÀN BỘ nội dung là sản phẩm AI mới được miễn", () => {
  it("★★★ AI tạo (apply_diff) → AI xoá được (sổ khớp) → AI TẠO LẠI được (vắng mặt là sản phẩm HITL)", async () => {
    const rel = "src/ai-tao.ts";
    const r1 = await apDung().execute!({ path: rel, original: "", modified: "export const AI = 1;\n" } as never, CTX as never);
    expect(r1.note, r1.textSummary).toBeUndefined();
    const r2 = await xoa().execute!({ path: rel } as never, CTX as never);
    expect(r2.note, `tệp chưa track nhưng 100% do HITL ⇒ phải xoá được: ${r2.textSummary}`).toBeUndefined();
    expect(co(rel)).toBe(false);
    const r3 = await apDung().execute!({ path: rel, original: "", modified: "export const AI = 2;\n" } as never, CTX as never);
    expect(r3.note, r3.textSummary).toBeUndefined();
    fs.rmSync(path.join(REPO, rel));
  });

  it("★★★ AI tạo → NGƯỜI sửa → AI xoá ⇒ FILE_DIRTY (một byte người chen là đóng miễn trừ)", async () => {
    const rel = "src/ai-tao-nguoi-sua.ts";
    await apDung().execute!({ path: rel, original: "", modified: "export const AI = 1;\n" } as never, CTX as never);
    fs.writeFileSync(path.join(REPO, rel), "export const AI = 1;\n// cua nguoi\n");
    const r = await xoa().execute!({ path: rel } as never, CTX as never);
    expect(r.note).toBe("FILE_DIRTY");
    expect(co(rel)).toBe(true);
    fs.rmSync(path.join(REPO, rel));
  });

  it("★★★ gốc KHÔNG git: tệp AI vừa tạo xoá được; tệp NGƯỜI viết thì không (§B)", async () => {
    const ctx = { ...CTX, projectRoot: KHONG_GIT };
    const r1 = await apDung().execute!({ path: "ai.ts", original: "", modified: "export const A = 1;\n" } as never, ctx as never);
    expect(r1.note, r1.textSummary).toBeUndefined();
    const r2 = await xoa().execute!({ path: "ai.ts" } as never, ctx as never);
    expect(r2.note, r2.textSummary).toBeUndefined();
    expect(co("ai.ts", KHONG_GIT)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§E — rename_file: hàng rào cho CẢ nguồn LẪN đích", () => {
  const xauNguon: Array<[string, string, string]> = [
    ["nguồn `..`", "../x.ts", "PATH_REJECTED"],
    ["nguồn .env", ".env", "DENIED_SECRET"],
    ["nguồn thư mục cấm", "node_modules/a.ts", "DENIED_DIR"],
    ["nguồn đuôi cấm", "src/a.png", "DENIED_EXT"],
    ["nguồn là thư mục", "src/thu-muc.ts", "NOT_A_FILE"],
    ["nguồn không tồn tại", "src/khong-co.ts", "NOT_FOUND"],
    ["nguồn qua junction", "alias-ngoai/outside.ts", "PATH_REJECTED"],
    ["nguồn hard link", "src/lien-ket-cung.ts", "PATH_REJECTED"],
  ];
  for (const [ten, from, ma] of xauNguon) {
    it(`★★★ ${ten} (${from}) ⇒ ${ma}, đích KHÔNG được tạo`, async () => {
      const r = await doiTen().execute!({ from, to: "src/dich-moi.ts" } as never, CTX as never);
      expect(r.note, r.textSummary).toBe(ma);
      expect(co("src/dich-moi.ts")).toBe(false);
    });
  }

  const xauDich: Array<[string, string, string]> = [
    ["đích `..`", "../x.ts", "PATH_REJECTED"],
    ["đích tuyệt đối", process.platform === "win32" ? "C:/x.ts" : "/x.ts", "PATH_REJECTED"],
    ["đích .env", ".env.local", "DENIED_SECRET"],
    ["đích thư mục cấm", "dist/a.ts", "DENIED_DIR"],
    ["đích đuôi cấm", "src/a.exe", "DENIED_EXT"],
    ["đích đã tồn tại", "src/doi-dich-co-san.ts", "DEST_EXISTS"],
    ["đích trùng nguồn", "src/doi-nguon.ts", "DEST_EXISTS"],
    ["đích là thư mục có sẵn", "src/thu-muc.ts", "NOT_A_FILE"],
    ["đích qua junction ra ngoài", "alias-ngoai/moi.ts", "PATH_REJECTED"],
  ];
  for (const [ten, to, ma] of xauDich) {
    it(`★★★ ${ten} (${to}) ⇒ ${ma}, nguồn NGUYÊN VẸN`, async () => {
      const truoc = doc("src/doi-nguon.ts");
      const r = await doiTen().execute!({ from: "src/doi-nguon.ts", to } as never, CTX as never);
      expect(r.note, r.textSummary).toBe(ma);
      expect(doc("src/doi-nguon.ts")).toBe(truoc);
    });
  }
  it("★★★ đích qua junction: KHÔNG một tệp nào được tạo ngoài gốc", async () => {
    await doiTen().execute!({ from: "src/doi-nguon.ts", to: "alias-ngoai/moi.ts" } as never, CTX as never);
    expect(fs.existsSync(path.join(NGOAI, "moi.ts"))).toBe(false);
    expect(doc("src/doi-dich-co-san.ts")).toContain("doi-dich-co-san");
  });

  it("★★★ nguồn BẨN ⇒ FILE_DIRTY", async () => {
    const ban = doc("src/doi-ban.ts") + "// tay\n";
    fs.writeFileSync(path.join(REPO, "src/doi-ban.ts"), ban);
    const r = await doiTen().execute!({ from: "src/doi-ban.ts", to: "src/doi-ban-2.ts" } as never, CTX as never);
    expect(r.note).toBe("FILE_DIRTY");
    expect(doc("src/doi-ban.ts")).toBe(ban);
    expect(co("src/doi-ban-2.ts")).toBe(false);
    git("checkout", "--", "src/doi-ban.ts");
  });

  it("★★★ đích là tệp đã track mà NGƯỜI vừa xoá chưa commit (' D') ⇒ FILE_DIRTY", async () => {
    fs.rmSync(path.join(REPO, "src/doi-dich-bi-xoa.ts"));
    const r = await doiTen().execute!({ from: "src/doi-nguon.ts", to: "src/doi-dich-bi-xoa.ts" } as never, CTX as never);
    expect(r.note, r.textSummary).toBe("FILE_DIRTY");
    expect(co("src/doi-nguon.ts")).toBe(true);
    git("checkout", "--", "src/doi-dich-bi-xoa.ts");
  });

  it("★ thiếu from/to ⇒ MISSING_REQUIRED_ARG", async () => {
    const r = await doiTen().execute!({ from: "src/doi-nguon.ts" } as never, CTX as never);
    expect(r.note).toBe("MISSING_REQUIRED_ARG");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§F — rename_file: preview KHÔNG ghi, execute dời ĐÚNG byte, sổ băm + ngân sách", () => {
  it("★★★ preview khai từ→tới + băm, đĩa KHÔNG đổi", async () => {
    const pv = await doiTen().preview!({ from: "src/doi-preview.ts", to: "src/moi/doi-preview.ts" } as never, CTX as never);
    const truong = Object.fromEntries(pv.changes.map((c) => [c.field, c]));
    expect(truong.path!.oldValue).toBe("src/doi-preview.ts");
    expect(truong.path!.newValue).toBe("src/moi/doi-preview.ts");
    expect(truong.sha256Before!.newValue).toBe(bam(doc("src/doi-preview.ts")));
    expect(co("src/doi-preview.ts")).toBe(true);
    expect(co("src/moi")).toBe(false);
  });

  it("★★★ execute: nguồn biến mất, đích ĐÚNG từng byte (CRLF + UTF-8 + byte lạ), thư mục đích được tạo", async () => {
    const raw = Buffer.concat([Buffer.from("// dòng một\r\nconst x = 'ă';\r\n", "utf8"), Buffer.from([0xff, 0x0a])]);
    ghiCommit("src/byte-that.ts", raw);
    const r = await doiTen().execute!({ from: "src/byte-that.ts", to: "src/sau/sau-nua/byte-that.ts" } as never, CTX as never);
    expect(r.note, r.textSummary).toBeUndefined();
    expect(co("src/byte-that.ts")).toBe(false);
    expect(fs.readFileSync(path.join(REPO, "src/sau/sau-nua/byte-that.ts")).equals(raw), "byte phải nguyên vẹn").toBe(true);
    const d = r.data as Record<string, unknown>;
    expect(d.ok).toBe(true);
    expect(d.loai).toBe("doi-ten");
    expect(d.path).toBe("src/sau/sau-nua/byte-that.ts");
    expect(d.tuDuong).toBe("src/byte-that.ts");
    const b = bam(raw.toString("utf8"));
    expect(d.bamTruoc).toBe(b);
    expect(d.bamSau).toBe(b);
    expect(d.thayDoi).toEqual([{ duong: "src/sau/sau-nua/byte-that.ts", loai: "doi-ten", tuDuong: "src/byte-that.ts", bamSau: b }]);
  });

  it("★★★ sau rename, apply_diff trên ĐÍCH (chưa track) đi được nhờ sổ HITL; người chen ⇒ FILE_DIRTY", async () => {
    const goc = doc("src/doi-so.ts");
    const r = await doiTen().execute!({ from: "src/doi-so.ts", to: "src/doi-so-moi.ts" } as never, CTX as never);
    expect(r.note, r.textSummary).toBeUndefined();
    const r2 = await apDung().execute!({ path: "src/doi-so-moi.ts", original: goc, modified: goc + "// ai\n" } as never, CTX as never);
    expect(r2.note, r2.textSummary).toBeUndefined();
    // …và đổi tên NGƯỢC lại về nguồn cũ (' D' là sản phẩm HITL) cũng đi được — đường hoàn tác.
    const r3 = await doiTen().execute!({ from: "src/doi-so-moi.ts", to: "src/doi-so.ts" } as never, CTX as never);
    expect(r3.note, r3.textSummary).toBeUndefined();
    expect(doc("src/doi-so.ts")).toBe(goc + "// ai\n");
    git("checkout", "--", "src/doi-so.ts");
  });

  it("★★ byte GHI ở đích bị trừ vào ngân sách; hết ngân sách ⇒ BUDGET_EXCEEDED, không dời", async () => {
    const goc = doc("src/doi-ngan-sach.ts");
    const { tieuNganSach, TRAN_BYTE_MOI_PHIEN } = await import("./repoSandbox");
    tieuNganSach("u:7", TRAN_BYTE_MOI_PHIEN + 1);
    const r = await doiTen().execute!({ from: "src/doi-ngan-sach.ts", to: "src/ns-2.ts" } as never, CTX as never);
    expect(r.note).toBe("BUDGET_EXCEEDED");
    expect(co("src/doi-ngan-sach.ts")).toBe(true);
    xoaSoNganSach();
    const truoc = nganSachConLai("u:7").conLai;
    const r2 = await doiTen().execute!({ from: "src/doi-ngan-sach.ts", to: "src/ns-2.ts" } as never, CTX as never);
    expect(r2.note, r2.textSummary).toBeUndefined();
    expect(truoc - nganSachConLai("u:7").conLai).toBe(Buffer.byteLength(goc, "utf8"));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§G — CỬA ĐĨA tự kiểm lại trên fd (tráo SAU khi qua `confineTargetUnder`)", () => {
  it("★★★ xoaConfined: nội dung đổi sau phán quyết ⇒ CHANGED, tệp còn", () => {
    const rel = "src/cua-xoa.ts";
    fs.writeFileSync(path.join(REPO, rel), "a\n");
    const c = confineTargetUnder(REPO, rel);
    expect(c.ok).toBe(true);
    fs.writeFileSync(path.join(REPO, rel), "b\n");
    const r = xoaConfined((c as { target: never }).target, bam("a\n"));
    expect(r).toEqual({ ok: false, kind: "CHANGED" });
    expect(co(rel)).toBe(true);
    fs.rmSync(path.join(REPO, rel));
  });

  it("★★★ xoaConfined: tệp bị tráo thành HARD LINK ra ngoài sau phán quyết ⇒ từ chối, cả hai còn", () => {
    const rel = "src/cua-tra-hl.ts";
    fs.writeFileSync(path.join(REPO, rel), BI_MAT);
    const c = confineTargetUnder(REPO, rel);
    expect(c.ok).toBe(true);
    fs.rmSync(path.join(REPO, rel));
    fs.linkSync(path.join(NGOAI, "outside.ts"), path.join(REPO, rel));
    try {
      const r = xoaConfined((c as { target: never }).target, bam(BI_MAT));
      expect(r.ok).toBe(false);
      expect(co(rel)).toBe(true);
      expect(fs.readFileSync(path.join(NGOAI, "outside.ts"), "utf8")).toBe(BI_MAT);
    } finally {
      fs.rmSync(path.join(REPO, rel));
    }
  });

  it("★★★ doiTenConfined: đích bị ai đó TẠO sau phán quyết ⇒ DEST_EXISTS, không ghi đè", () => {
    fs.writeFileSync(path.join(REPO, "src/cua-nguon.ts"), "n\n");
    const n = confineTargetUnder(REPO, "src/cua-nguon.ts");
    const d = confineTargetUnder(REPO, "src/cua-dich.ts");
    expect(n.ok && d.ok).toBe(true);
    fs.writeFileSync(path.join(REPO, "src/cua-dich.ts"), "cua-nguoi\n");
    const r = doiTenConfined((n as { target: never }).target, (d as { target: never }).target, bam("n\n"));
    expect(r).toEqual({ ok: false, kind: "DEST_EXISTS" });
    expect(doc("src/cua-dich.ts")).toBe("cua-nguoi\n");
    expect(co("src/cua-nguon.ts")).toBe(true);
    fs.rmSync(path.join(REPO, "src/cua-nguon.ts"));
    fs.rmSync(path.join(REPO, "src/cua-dich.ts"));
  });

  /**
   * ★★★ CA THEN CHỐT của phép xoá theo TÊN: thư mục CHA bị tráo thành junction ra ngoài SAU phán
   * quyết, và tệp ngoài có ĐÚNG nội dung đã băm (nlink=1) ⇒ fd, băm, nlink đều "đúng". Chỉ phép kiểm
   * realpath-của-cha ngay trước `unlink` cứu được tệp ngoài (đột biến gỡ nó ⇒ ĐỎ ở đây).
   */
  for (const [ten, chay] of [
    ["xoaConfined", (t: never, b: string) => xoaConfined(t, b)],
    ["doiTenConfined (nguồn)", (t: never, b: string) => {
      const d = confineTargetUnder(REPO, "src/cua-junction-dich.ts");
      return doiTenConfined(t, (d as { target: never }).target, b);
    }],
  ] as const) {
    it(`★★★ ${ten}: cha bị tráo thành JUNCTION ra ngoài sau phán quyết ⇒ từ chối, tệp NGOÀI còn nguyên`, () => {
      const NOI_DUNG = "export const GIONG_HET = 1;\n";
      const ngoaiCha = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xdt-cha-ngoai-")));
      fs.writeFileSync(path.join(ngoaiCha, "x.ts"), NOI_DUNG);
      fs.mkdirSync(path.join(REPO, "src", "cha-bi-trao"), { recursive: true });
      fs.writeFileSync(path.join(REPO, "src", "cha-bi-trao", "x.ts"), NOI_DUNG);
      const c = confineTargetUnder(REPO, "src/cha-bi-trao/x.ts");
      expect(c.ok).toBe(true);
      fs.rmSync(path.join(REPO, "src", "cha-bi-trao"), { recursive: true, force: true });
      fs.symlinkSync(ngoaiCha, path.join(REPO, "src", "cha-bi-trao"), "junction");
      try {
        const r = chay((c as { target: never }).target, bam(NOI_DUNG));
        expect(r.ok, JSON.stringify(r)).toBe(false);
        expect(fs.readFileSync(path.join(ngoaiCha, "x.ts"), "utf8"), "tệp NGOÀI gốc bị xoá qua junction").toBe(NOI_DUNG);
        expect(co("src/cua-junction-dich.ts")).toBe(false);
      } finally {
        fs.rmSync(path.join(REPO, "src", "cha-bi-trao"), { force: true, recursive: false });
        fs.rmSync(ngoaiCha, { recursive: true, force: true });
      }
    });
  }

  it("★★ preview đổi tên vào đích ĐÃ CÓ: chỉ KHAI từ chối (DEST_EXISTS ở tầng phán quyết, không đợi cửa đĩa)", async () => {
    const pv = await doiTen().preview!({ from: "src/doi-nguon.ts", to: "src/doi-dich-co-san.ts" } as never, CTX as never);
    expect(pv.changes).toEqual([]);
    expect(pv.warnings.join(" ")).toMatch(/ĐÃ TỒN TẠI/);
  });

  it("★★ cửa nhận đích CHƯA chứng minh (đối tượng tự dựng) ⇒ từ chối, không chạm đĩa", () => {
    const gia = { relPath: "src/xoa-sach.ts", exists: true } as never;
    expect(xoaConfined(gia, "x").ok).toBe(false);
    expect(co("src/xoa-sach.ts")).toBe(true);
  });
});
