/**
 * ★★★ doc 78 · PHA C — **LƯỚI ĐIỀU TRA DÂN SỐ + NGHIỆM THU SỐNG CHO `apply_diff`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỐN BẤT BIẾN ĐƯỢC PHÁT BIỂU Ở ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. HITL — `apply_diff` KHÔNG BAO GIỜ tự chạm đĩa; một quyết định gọi nó chỉ ra `pendingAction`.
 *   2. TỆP BẨN — một tệp có thay đổi CHƯA COMMIT bị TỪ CHỐI ghi, và đĩa KHÔNG đổi một byte nào.
 *   3. BĂM CHỐNG TOCTOU — băm được so ở CẢ propose LẪN execute; tệp đổi giữa hai lượt ⇒ TỪ CHỐI.
 *   4. HỘP CÁT — mọi đường thoát (.., .env, đuôi cấm, tuyệt đối) bị chặn; một diff HỢP LỆ trên tệp
 *      SẠCH VẪN ghi được và nội dung đĩa ĐÚNG.
 *
 * ⚠⚠ Lưới chạy trên một **repo git THẬT dựng tạm** (`git init` + commit), vì hàng rào "tệp bẩn"
 * hỏi `git status` THẬT. Một lưới giả `git` bằng mock sẽ chứng minh đúng cái mock, không đúng hệ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐỘT BIẾN TỐI THIỂU (đã chạy, ăn — xem báo cáo):
 *   • gỡ hàng rào tệp bẩn (bỏ nhánh `FILE_DIRTY`)          ⇒ §B ĐỎ
 *   • gỡ kiểm-lại-tại-execute (execute không gọi `phanQuyet`) ⇒ §D (TOCTOU) ĐỎ
 *   • gỡ so băm (bỏ nhánh `BASE_MISMATCH`)                 ⇒ §C ĐỎ
 *   • tự chạm đĩa không qua confirm (execute trong decision) ⇒ §A-HITL ĐỎ
 *   • CHỐNG VÁ QUÁ TAY: một diff hợp lệ trên tệp SẠCH VẪN ghi ⇒ §E dương phải XANH
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// HITL: `executeDecision` nhập TĨNH `proposeAction`. Thay bằng bản giả để đo đường đi mà không dựng
// DB — điểm dispatch THẬT, không phải bản sao.
const proposeActionMock = vi.fn();
vi.mock("../aiCopilotActions", () => ({
  proposeAction: (...a: unknown[]) => proposeActionMock(...a),
}));

import "./index"; // đăng ký TOÀN BỘ tool (side-effect)
import { executeDecision } from "./index";
import { listTools, type Tool } from "./toolRegistry";
import { xoaSoNganSach, gocHopCat, TRAN_BYTE_MOI_PHIEN } from "./repoSandbox";
import { trangThaiGitCuaTep } from "./repoGitStatus";

const CTX = { user: { id: 7, role: "engineer", name: "T" }, lang: "vi" as const };

let REPO = "";
function git(...args: string[]): string {
  return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" });
}
function bam(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function ghiCommit(rel: string, noiDung: string): void {
  const abs = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, noiDung);
  git("add", "--", rel);
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", `add ${rel}`);
}
function docDia(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}
function tool(): Tool<any, any> {
  return listTools().find((t) => t.name === "apply_diff")!;
}

beforeAll(() => {
  // realpath để khớp với `confineTargetUnder` (nó realpath cả gốc lẫn target).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pha-c-"));
  REPO = fs.realpathSync(tmp);
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // Baseline tệp SẠCH cho các ca độc lập (mỗi ca một tệp ⇒ không giẫm chân nhau).
  ghiCommit("src/live.ts", "export const A = 1;\nexport const B = 2;\n");
  ghiCommit("src/dirty.ts", "export const X = 1;\n");
  ghiCommit("src/toctou.ts", "export const T = 1;\n");
  ghiCommit("src/stale.ts", "export const S = 1;\n");
  ghiCommit("src/budget.ts", "export const G = 0;\n");
});

afterAll(() => {
  delete process.env.AI_REPO_SANDBOX_ROOT;
  try {
    fs.rmSync(REPO, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

beforeEach(() => {
  proposeActionMock.mockReset();
  xoaSoNganSach();
  process.env.AI_REPO_SANDBOX_ROOT = REPO;
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — CẦU CHÌ: apply_diff là WRITE TOOL không handler, đứng sau ai_repo_read/canEdit", () => {
  it("★★★ hình dạng tool đúng bất biến HITL", () => {
    const t = tool();
    expect(t, "apply_diff phải nằm trong sổ đăng ký").toBeTruthy();
    expect(t.kind, "kind:'write' là cách DUY NHẤT bắt buộc có người bấm duyệt").toBe("write");
    expect(typeof t.preview).toBe("function");
    expect(typeof t.execute).toBe("function");
    expect(typeof t.summarize).toBe("function");
    expect(t.requiredPermission).toEqual({ module: "ai_repo_read", action: "canEdit" });
    // Vắng `handler`: đổi kind sang "read" để "cho nhanh" ⇒ không có gì chạy được (không lén ghi).
    expect(typeof t.handler, "read-handler = một đường ghi KHÔNG qua HITL").toBe("undefined");
  });

  it("★ gốc hộp cát đang trỏ vào repo tạm (điều kiện cho mọi ca sau)", () => {
    expect(gocHopCat()).toBe(REPO);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§A — HITL: một quyết định gọi apply_diff ⇒ ĐỀ XUẤT, KHÔNG ghi (gỡ HITL ⇒ ĐỎ)", () => {
  it("★★★ executeDecision đi qua proposeAction, trả pendingAction, KHÔNG ra result, KHÔNG chạm đĩa", async () => {
    proposeActionMock.mockResolvedValue({ ok: true, pendingAction: { id: "gia-lap", tool: "apply_diff" } });
    const truoc = docDia("src/live.ts");
    const ra = await executeDecision(
      { tool: "apply_diff", args: { path: "src/live.ts", original: truoc, modified: truoc + "// x\n" } },
      CTX,
    );
    expect(proposeActionMock, "phải đi qua đường ĐỀ XUẤT").toHaveBeenCalledTimes(1);
    expect(ra.pendingAction).toEqual({ id: "gia-lap", tool: "apply_diff" });
    expect(ra.result, "write tool KHÔNG trả kết quả ngay — đó là định nghĩa HITL").toBeNull();
    expect(docDia("src/live.ts"), "đĩa KHÔNG được đổi khi mới chỉ ĐỀ XUẤT").toBe(truoc);
    expect(proposeActionMock.mock.calls[0]![0]).toMatchObject({ name: "apply_diff", kind: "write" });
  });

  it("★★ KHÔNG có ngữ cảnh phiên ⇒ TỪ CHỐI, không chạy lén", async () => {
    const ra = await executeDecision({ tool: "apply_diff", args: { path: "src/live.ts", original: "", modified: "x" } }, undefined);
    expect(ra.error).toBe("WRITE_TOOL_REQUIRES_CONTEXT");
    expect(proposeActionMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§B — HÀNG RÀO TỆP BẨN: tệp có thay đổi chưa commit ⇒ TỪ CHỐI, đĩa NGUYÊN VẸN", () => {
  it("★★★ tệp bẩn ⇒ execute trả FILE_DIRTY, ok:false, và KHÔNG ghi một byte", async () => {
    // Làm bẩn src/dirty.ts (sửa chưa commit).
    const goc = docDia("src/dirty.ts");
    fs.writeFileSync(path.join(REPO, "src/dirty.ts"), goc + "// sua tay chua commit\n");
    const truoc = docDia("src/dirty.ts");

    const r = await tool().execute!({ path: "src/dirty.ts", original: truoc, modified: truoc + "export const Y = 2;\n" } as never, CTX as never);
    expect(r.note, `phải TỪ CHỐI vì bẩn — nhận: ${r.textSummary}`).toBe("FILE_DIRTY");
    expect((r.data as { ok: boolean }).ok).toBe(false);
    expect(docDia("src/dirty.ts"), "tệp bẩn phải NGUYÊN VẸN — không ghi đè").toBe(truoc);
    // dọn để ca khác không bị nhiễu
    git("checkout", "--", "src/dirty.ts");
  });

  it("★★★ tệp CHƯA TRACK (??) cũng bị coi là 'chưa commit' ⇒ TỪ CHỐI", async () => {
    const abs = path.join(REPO, "src/untracked.ts");
    fs.writeFileSync(abs, "export const U = 1;\n");
    const noiDung = "export const U = 1;\n";
    const st = await trangThaiGitCuaTep("src/untracked.ts");
    expect(st.ok && st.sach, "một tệp chưa track PHẢI hiện là KHÔNG sạch (??)").toBe(false);
    const r = await tool().execute!({ path: "src/untracked.ts", original: noiDung, modified: noiDung + "// them\n" } as never, CTX as never);
    expect(r.note).toBe("FILE_DIRTY");
    fs.rmSync(abs, { force: true });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§C — SO BĂM: nội dung đĩa ≠ original ⇒ BASE_MISMATCH (gỡ so băm ⇒ ĐỎ)", () => {
  it("★★★ original SAI (tác nhân nhìn phiên bản cũ) ⇒ TỪ CHỐI, đĩa NGUYÊN VẸN", async () => {
    const truoc = docDia("src/stale.ts");
    const originalSai = "export const S = 999;\n"; // KHÔNG khớp đĩa
    const r = await tool().execute!({ path: "src/stale.ts", original: originalSai, modified: "export const S = 2;\n" } as never, CTX as never);
    expect(r.note, `phải TỪ CHỐI vì băm lệch — nhận: ${r.textSummary}`).toBe("BASE_MISMATCH");
    expect(docDia("src/stale.ts"), "tệp phải NGUYÊN VẸN").toBe(truoc);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§D — TOCTOU: kiểm LẠI tại execute (tệp đổi giữa propose và confirm)", () => {
  it("★★★ preview XANH → tệp bị sửa tay → execute TỪ CHỐI, đĩa KHÔNG bị bản diff cũ đè lên", async () => {
    const goc = docDia("src/toctou.ts");
    const modified = goc + "export const NEW = 1;\n";

    // 1. propose: preview thấy tệp SẠCH, dựng diff/băm.
    const pv = await tool().preview!({ path: "src/toctou.ts", original: goc, modified } as never, CTX as never);
    expect(pv.changes.length, "preview trên tệp sạch phải có diff thật").toBeGreaterThan(0);
    const bamBefore = pv.changes.find((c) => c.field === "sha256Before")?.newValue;
    expect(bamBefore, "preview phải khai băm TRƯỚC").toBe(bam(goc));

    // 2. GIỮA propose và confirm: kẻ khác sửa tay tệp (uncommitted).
    fs.writeFileSync(path.join(REPO, "src/toctou.ts"), goc + "// ai do vua sua\n");
    const truocKhiGhi = docDia("src/toctou.ts");

    // 3. confirm: execute với ĐÚNG args đã propose (original=goc). Phải TỪ CHỐI (bẩn ⇒ FILE_DIRTY;
    //    nếu ai đó commit thay vì sửa tay thì băm lệch ⇒ BASE_MISMATCH). Cả hai đều là TỪ CHỐI.
    const r = await tool().execute!({ path: "src/toctou.ts", original: goc, modified } as never, CTX as never);
    expect(["FILE_DIRTY", "BASE_MISMATCH"]).toContain(r.note);
    expect((r.data as { ok: boolean }).ok).toBe(false);
    expect(docDia("src/toctou.ts"), "bản diff CŨ KHÔNG được đè lên tệp đã đổi dưới chân").toBe(truocKhiGhi);
    git("checkout", "--", "src/toctou.ts");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§E — CHỐNG VÁ QUÁ TAY: một diff HỢP LỆ trên tệp SẠCH VẪN ghi được, nội dung ĐÚNG", () => {
  it("★★★ SỬA một tệp sạch ⇒ execute ghi, ok:true, note vắng, và đĩa ĐÚNG bằng modified", async () => {
    const goc = docDia("src/live.ts");
    const modified = "export const A = 111;\nexport const B = 2;\nexport const C = 3;\n";
    const r = await tool().execute!({ path: "src/live.ts", original: goc, modified } as never, CTX as never);
    expect(r.note, `lượt ghi hợp lệ KHÔNG mang note — nhận: ${r.note} / ${r.textSummary}`).toBeUndefined();
    const d = r.data as { ok: boolean; bytes: number; created: boolean; sha256After: string };
    expect(d.ok).toBe(true);
    expect(d.created).toBe(false);
    expect(d.sha256After).toBe(bam(modified));
    expect(docDia("src/live.ts"), "NGHIỆM THU SỐNG: đọc lại đĩa phải ĐÚNG bằng modified").toBe(modified);
    git("checkout", "--", "src/live.ts");
  });

  it("★★★ TẠO tệp MỚI (original RỖNG, tệp chưa tồn tại) ⇒ ghi được, created:true", async () => {
    const rel = "src/created.ts";
    const noiDung = "export const NEW_FILE = 42;\n";
    const r = await tool().execute!({ path: rel, original: "", modified: noiDung } as never, CTX as never);
    expect(r.note, `tạo mới hợp lệ phải XANH — nhận: ${r.textSummary}`).toBeUndefined();
    expect((r.data as { created: boolean }).created).toBe(true);
    expect(docDia(rel)).toBe(noiDung);
    fs.rmSync(path.join(REPO, rel), { force: true });
  });

  it("★★ TẠO mới nhưng original KHÔNG rỗng (tệp đã có nội dung khác) ⇒ BASE_MISMATCH", async () => {
    // live.ts đã tồn tại với nội dung khác "" ⇒ original="" không khớp ⇒ từ chối.
    const r = await tool().execute!({ path: "src/live.ts", original: "", modified: "x\n" } as never, CTX as never);
    expect(r.note).toBe("BASE_MISMATCH");
  });

  it("★ NO_CHANGE khi original === modified", async () => {
    const goc = docDia("src/live.ts");
    const r = await tool().execute!({ path: "src/live.ts", original: goc, modified: goc } as never, CTX as never);
    expect(r.note).toBe("NO_CHANGE");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§F — HỘP CÁT: mọi đường thoát bị chặn TRƯỚC khi chạm đĩa hoặc git", () => {
  const xau: Array<[string, string, string]> = [
    ["đường `..`", "../ngoai.ts", "PATH_REJECTED"],
    ["tuyệt đối", process.platform === "win32" ? "C:/Windows/x.ts" : "/etc/x.ts", "PATH_REJECTED"],
    ["ổ đĩa ở GIỮA", "src/C:/x.ts", "PATH_REJECTED"],
    ["tệp bí mật .env", ".env", "DENIED_SECRET"],
    ["tệp bí mật .env.bak", ".env.bak-2026", "DENIED_SECRET"],
    ["khoá riêng .pem", "server/khoa.pem", "DENIED_SECRET"],
    ["thư mục cấm", "node_modules/x/index.ts", "DENIED_DIR"],
    ["đuôi ngoài danh sách trắng", "src/anh.png", "DENIED_EXT"],
  ];
  for (const [ten, p, ma] of xau) {
    it(`★★★ ${ten} (${p}) ⇒ ${ma}, và KHÔNG ghi gì`, async () => {
      const r = await tool().execute!({ path: p, original: "a", modified: "b" } as never, CTX as never);
      expect(r.note, `"${p}" phải bị chặn bằng ${ma}`).toBe(ma);
      expect((r.data as { ok: boolean }).ok).toBe(false);
    });
  }

  it("★ thiếu original/modified ⇒ MISSING_REQUIRED_ARG (không ném, không ghi)", async () => {
    const r = await tool().execute!({ path: "src/live.ts" } as never, CTX as never);
    expect(r.note).toBe("MISSING_REQUIRED_ARG");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§G — NGÂN SÁCH: byte GHI tính vào cùng sổ; hết ngân sách ⇒ CHẶN trước khi ghi", () => {
  it("★★★ khi ngân sách đã cạn, một lượt ghi hợp lệ vẫn bị chặn BUDGET_EXCEEDED, đĩa nguyên vẹn", async () => {
    const { tieuNganSach } = await import("./repoSandbox");
    // Cạn sổ của phiên user 7 (cùng khoá `u:7` mà apply_diff dùng).
    tieuNganSach("u:7", TRAN_BYTE_MOI_PHIEN + 1);
    const goc = docDia("src/budget.ts");
    const truoc = goc;
    const r = await tool().execute!({ path: "src/budget.ts", original: goc, modified: goc + "// x\n" } as never, CTX as never);
    expect(r.note).toBe("BUDGET_EXCEEDED");
    expect(docDia("src/budget.ts"), "hết ngân sách ⇒ CHƯA ghi").toBe(truoc);
  });

  it("★★ CHỐNG VÁ QUÁ TAY — ngân sách còn thì lượt ghi vẫn qua, và byte GHI bị TRỪ", async () => {
    const { nganSachConLai } = await import("./repoSandbox");
    const goc = docDia("src/budget.ts");
    const modified = goc + "export const H = 1;\n";
    const truoc = nganSachConLai("u:7").conLai;
    const r = await tool().execute!({ path: "src/budget.ts", original: goc, modified } as never, CTX as never);
    expect(r.note, `phải ghi được — nhận: ${r.textSummary}`).toBeUndefined();
    const sau = nganSachConLai("u:7").conLai;
    expect(truoc - sau, "byte GHI phải bị trừ vào ngân sách").toBe(Buffer.byteLength(modified, "utf8"));
    git("checkout", "--", "src/budget.ts");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§H — WORM: preview mang băm TRƯỚC/SAU + đường dẫn (thứ audit_logs sẽ ghi)", () => {
  it("★★★ preview.changes có path, sha256Before, sha256After — đủ cho một bản ghi WORM", async () => {
    const goc = docDia("src/live.ts");
    const modified = goc + "// worm\n";
    const pv = await tool().preview!({ path: "src/live.ts", original: goc, modified } as never, CTX as never);
    const truong = Object.fromEntries(pv.changes.map((c) => [c.field, c.newValue]));
    expect(truong.path).toBe("src/live.ts");
    expect(truong.sha256Before).toBe(bam(goc));
    expect(truong.sha256After).toBe(bam(modified));
    // ⚠ Đây là bề mặt mà `aiCopilotActions` ghi vào audit_logs ở CẢ propose LẪN execute
    //   (changes = previewBefore.changes) ⇒ userId (audit ctx) + tệp + băm trước/sau đều có mặt.
  });
});
