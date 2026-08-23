/**
 * ★★★ doc 79 (2026-08-20) — **LƯỚI ĐIỀU TRA DÂN SỐ + NGHIỆM THU SỐNG CHO `apply_diff_batch`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * SÁU BẤT BIẾN ĐƯỢC PHÁT BIỂU Ở ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. HITL — một quyết định gọi `apply_diff_batch` chỉ ra `pendingAction`; tool KHÔNG tự chạm đĩa.
 *   2. **MỖI TỆP MỘT BĂM NEO RIÊNG** — dùng CHUNG một `original` cho hai tệp ⇒ TỪ CHỐI CẢ LÔ.
 *      Đây là bất biến số một của mục này; §B đo nó trên đĩa thật.
 *   3. NGUYÊN TỬ Ở PHA PHÁN QUYẾT — một tệp đỏ (bẩn · băm lệch · hộp cát) ⇒ **0 byte** được ghi.
 *   4. HỘP CÁT chạy cho TỪNG mục, kể cả mục thứ N.
 *   5. TOCTOU — cả N băm được so LẠI ở `execute`; một tệp đổi giữa propose và confirm ⇒ từ chối lô.
 *   6. GHI TỪNG PHẦN KHÔNG BAO GIỜ IM LẶNG — hỏng ở pha ghi ⇒ `BATCH_PARTIAL` kèm danh sách chính
 *      xác tệp nào đã ghi, tệp nào chưa.
 *
 * ⚠⚠ Lưới chạy trên một **repo git THẬT dựng tạm** (`git init` + commit), vì hàng rào "tệp bẩn"
 * hỏi `git status` THẬT — cùng lý lẽ của `applyDiff.census.test.ts`. Một `git` giả bằng mock sẽ
 * chứng minh đúng cái mock.
 *
 * ⚠ §I là phần trả lời câu hỏi của brief về `??`: nó ĐO trạng thái porcelain thật cho cả hai ca
 *   (tệp chưa tồn tại · tệp tồn tại nhưng chưa track) thay vì suy luận.
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
import { xoaSoNganSach, gocHopCat, TRAN_BYTE_MOI_PHIEN } from "./repoSandbox";
import { trangThaiGitCuaTep } from "./repoGitStatus";
import { TRAN_TEP_MOI_LO } from "./writeHandlers/applyDiffBatch";

const CTX = { user: { id: 11, role: "engineer", name: "T" }, lang: "vi" as const };

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
function coTren(rel: string): boolean {
  return fs.existsSync(path.join(REPO, rel));
}
function tool(): Tool<any, any> {
  return listTools().find((t) => t.name === "apply_diff_batch")!;
}
/** Một mục lô hợp lệ dựng từ nội dung ĐANG có trên đĩa (đúng cách một tác nhân tử tế phải làm). */
function muc(rel: string, them: string) {
  const goc = docDia(rel);
  return { path: rel, original: goc, modified: goc + them };
}

const A = "src/a.ts";
const B = "src/b.ts";
const C = "src/c.ts";
const BAN = "src/ban.ts";
const KHOA = "src/khoa.ts";

beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lo-ghi-"));
  REPO = fs.realpathSync(tmp);
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  ghiCommit(A, "export const A = 1;\n");
  ghiCommit(B, "export const B = 2;\n");
  ghiCommit(C, "export const C = 3;\n");
  ghiCommit(BAN, "export const BAN = 4;\n");
  ghiCommit(KHOA, "export const KHOA = 5;\n");
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
  // Mọi ca bắt đầu từ một cây SẠCH — ca trước có thể đã ghi.
  git("checkout", "--", ".");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — CẦU CHÌ: hình dạng tool + trần lô", () => {
  it("★★★ là WRITE TOOL không handler, đứng sau ai_repo_read/canEdit", () => {
    const t = tool();
    expect(t, "apply_diff_batch phải nằm trong sổ đăng ký").toBeTruthy();
    expect(t.kind, "kind:'write' là cách DUY NHẤT bắt buộc có người bấm duyệt").toBe("write");
    expect(typeof t.preview).toBe("function");
    expect(typeof t.execute).toBe("function");
    expect(t.requiredPermission).toEqual({ module: "ai_repo_read", action: "canEdit" });
    expect(typeof t.handler, "read-handler = một đường ghi KHÔNG qua HITL").toBe("undefined");
  });

  it("★★ zod chặn lô RỖNG và lô VƯỢT TRẦN ngay ở lược đồ", () => {
    const t = tool();
    expect(t.parameters.safeParse({ files: [] }).success).toBe(false);
    const qua = Array.from({ length: TRAN_TEP_MOI_LO + 1 }, (_, i) => ({ path: `src/x${i}.ts`, original: "", modified: "y" }));
    expect(t.parameters.safeParse({ files: qua }).success).toBe(false);
    expect(t.parameters.safeParse({ files: [{ path: A, original: "", modified: "y" }] }).success).toBe(true);
  });

  it("★ gốc hộp cát đang trỏ vào repo tạm (điều kiện cho mọi ca sau)", () => {
    expect(gocHopCat()).toBe(REPO);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§A — HITL: một quyết định gọi apply_diff_batch ⇒ ĐỀ XUẤT, KHÔNG ghi", () => {
  it("★★★ executeDecision đi qua proposeAction, trả pendingAction, KHÔNG ra result, KHÔNG chạm đĩa", async () => {
    proposeActionMock.mockResolvedValue({ ok: true, pendingAction: { id: "gia-lap", tool: "apply_diff_batch" } });
    const truoc = [docDia(A), docDia(B)];
    const ra = await executeDecision(
      { tool: "apply_diff_batch", args: { files: [muc(A, "// x\n"), muc(B, "// y\n")] } },
      CTX,
    );
    expect(proposeActionMock, "phải đi qua đường ĐỀ XUẤT").toHaveBeenCalledTimes(1);
    expect(ra.pendingAction).toEqual({ id: "gia-lap", tool: "apply_diff_batch" });
    expect(ra.result, "write tool KHÔNG trả kết quả ngay — đó là định nghĩa HITL").toBeNull();
    expect([docDia(A), docDia(B)], "đĩa KHÔNG được đổi khi mới chỉ ĐỀ XUẤT").toEqual(truoc);
    expect(proposeActionMock.mock.calls[0]![0]).toMatchObject({ name: "apply_diff_batch", kind: "write" });
  });

  it("★★ KHÔNG có ngữ cảnh phiên ⇒ TỪ CHỐI, không chạy lén", async () => {
    const ra = await executeDecision(
      { tool: "apply_diff_batch", args: { files: [{ path: A, original: "", modified: "x" }] } },
      undefined,
    );
    expect(ra.error).toBe("WRITE_TOOL_REQUIRES_CONTEXT");
    expect(proposeActionMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§B — ★★★ BẤT BIẾN SỐ MỘT: MỖI TỆP MỘT BĂM RIÊNG (dùng chung một băm ⇒ ĐỎ)", () => {
  it("★★★ hai mục dùng CHUNG `original` của tệp A ⇒ mục B lệch băm ⇒ TỪ CHỐI CẢ LÔ, 0 byte ghi", async () => {
    const gocA = docDia(A);
    const gocB = docDia(B);
    const truoc = [gocA, gocB];
    // ĐÂY là hình dạng "một băm cho cả lô": cùng một `original` gán cho hai đường dẫn khác nhau.
    const r = await tool().execute!(
      {
        files: [
          { path: A, original: gocA, modified: gocA + "// x\n" },
          { path: B, original: gocA, modified: gocA + "// y\n" },
        ],
      } as never,
      CTX as never,
    );
    expect(r.note, `phải TỪ CHỐI cả lô — nhận: ${r.textSummary}`).toBe("BATCH_REJECTED");
    expect(String(r.textSummary), "phải chỉ ĐÍCH DANH mục nào lệch").toContain("BASE_MISMATCH");
    expect(String(r.textSummary)).toContain(B);
    expect((r.data as { ok: boolean; daGhi: unknown[] }).ok).toBe(false);
    expect((r.data as { daGhi: unknown[] }).daGhi, "0 tệp được ghi").toEqual([]);
    expect([docDia(A), docDia(B)], "tệp HỢP LỆ trong lô cũng KHÔNG được ghi").toEqual(truoc);
    expect(docDia(B)).toBe(gocB);
  });

  it("★★★ preview khai N băm RIÊNG BIỆT, mỗi tệp một cặp trước/sau (một cặp chung ⇒ ĐỎ)", async () => {
    const pv = await tool().preview!({ files: [muc(A, "// x\n"), muc(B, "// y\n")] } as never, CTX as never);
    const truoc = pv.changes.filter((c) => c.field.endsWith(".sha256Before")).map((c) => c.newValue);
    const sau = pv.changes.filter((c) => c.field.endsWith(".sha256After")).map((c) => c.newValue);
    expect(truoc.length, "hai tệp ⇒ HAI băm TRƯỚC").toBe(2);
    expect(sau.length).toBe(2);
    expect(truoc[0]).toBe(bam(docDia(A)));
    expect(truoc[1]).toBe(bam(docDia(B)));
    expect(new Set(truoc).size, "hai tệp khác nhau ⇒ hai băm KHÁC NHAU").toBe(2);
    expect(new Set(sau).size).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§C — NGUYÊN TỬ Ở PHA PHÁN QUYẾT: một tệp BẨN ⇒ cả lô bị từ chối, đĩa nguyên vẹn", () => {
  it("★★★ tệp thứ hai có thay đổi CHƯA COMMIT ⇒ BATCH_REJECTED, tệp thứ nhất KHÔNG bị ghi", async () => {
    const m1 = muc(A, "// x\n");
    fs.writeFileSync(path.join(REPO, BAN), docDia(BAN) + "// sua tay chua commit\n");
    const m2 = muc(BAN, "// y\n");
    const truocA = docDia(A);
    const truocBan = docDia(BAN);

    const r = await tool().execute!({ files: [m1, m2] } as never, CTX as never);
    expect(r.note).toBe("BATCH_REJECTED");
    expect(String(r.textSummary)).toContain("FILE_DIRTY");
    expect(docDia(A), "tệp SẠCH đứng TRƯỚC tệp bẩn cũng KHÔNG được ghi").toBe(truocA);
    expect(docDia(BAN)).toBe(truocBan);
    git("checkout", "--", BAN);
  });

  it("★★★ ĐỐI CHỨNG — cùng lô ấy với tệp SẠCH thì GHI ĐƯỢC (chống vá quá tay)", async () => {
    const m1 = muc(A, "// x1\n");
    const m2 = muc(BAN, "// y1\n");
    const r = await tool().execute!({ files: [m1, m2] } as never, CTX as never);
    expect(r.note, `lô hợp lệ KHÔNG mang note — nhận: ${r.note} / ${r.textSummary}`).toBeUndefined();
    expect(docDia(A)).toBe(m1.modified);
    expect(docDia(BAN)).toBe(m2.modified);
    const d = r.data as { ok: boolean; daGhi: Array<{ path: string; created: boolean }> };
    expect(d.ok).toBe(true);
    expect(d.daGhi.map((x) => x.path)).toEqual([A, BAN]);
    git("checkout", "--", A, BAN);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§D — HỘP CÁT chạy cho TỪNG mục, kể cả mục CUỐI", () => {
  const xau: Array<[string, string, string]> = [
    ["đường `..`", "../ngoai.ts", "PATH_REJECTED"],
    ["tuyệt đối", process.platform === "win32" ? "C:/Windows/x.ts" : "/etc/x.ts", "PATH_REJECTED"],
    ["ổ đĩa ở GIỮA", "src/C:/x.ts", "PATH_REJECTED"],
    ["tệp bí mật .env", ".env", "DENIED_SECRET"],
    ["khoá riêng .pem", "server/khoa.pem", "DENIED_SECRET"],
    ["thư mục cấm", "node_modules/x/index.ts", "DENIED_DIR"],
    ["đuôi ngoài danh sách trắng", "src/anh.png", "DENIED_EXT"],
  ];
  for (const [ten, p, ma] of xau) {
    it(`★★★ mục thứ HAI là "${p}" (${ten}) ⇒ BATCH_REJECTED kèm ${ma}, tệp thứ nhất KHÔNG bị ghi`, async () => {
      const m1 = muc(A, "// x\n");
      const truoc = docDia(A);
      const r = await tool().execute!(
        { files: [m1, { path: p, original: "a", modified: "b" }] } as never,
        CTX as never,
      );
      expect(r.note).toBe("BATCH_REJECTED");
      expect(String(r.textSummary), `"${p}" phải bị chặn bằng ${ma}`).toContain(ma);
      expect(docDia(A), "một mục xấu ở cuối lô KHÔNG được kéo theo một lượt ghi nào").toBe(truoc);
      expect((r.data as { daGhi: unknown[] }).daGhi).toEqual([]);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§E — CHỐNG VÁ QUÁ TAY: lô HỢP LỆ (kể cả có TẠO tệp mới) VẪN ghi, nội dung ĐÚNG", () => {
  it("★★★ ba mục: sửa · sửa · TẠO MỚI ⇒ ghi cả ba, đĩa đúng từng byte, `created` đúng", async () => {
    const rel = "src/tao-trong-lo.ts";
    const m1 = muc(A, "// lo1\n");
    const m2 = muc(B, "// lo2\n");
    const m3 = { path: rel, original: "", modified: "export const MOI = 9;\n" };

    const r = await tool().execute!({ files: [m1, m2, m3] } as never, CTX as never);
    expect(r.note, `lô hợp lệ phải XANH — nhận: ${r.textSummary}`).toBeUndefined();
    expect(docDia(A)).toBe(m1.modified);
    expect(docDia(B)).toBe(m2.modified);
    expect(docDia(rel), "NGHIỆM THU SỐNG: tệp MỚI phải có trên đĩa với đúng nội dung").toBe(m3.modified);

    const d = r.data as { ok: boolean; soTep: number; daGhi: Array<{ path: string; created: boolean; sha256After: string }> };
    expect(d.ok).toBe(true);
    expect(d.soTep).toBe(3);
    expect(d.daGhi.map((x) => x.created)).toEqual([false, false, true]);
    expect(d.daGhi[2]!.sha256After).toBe(bam(m3.modified));

    fs.rmSync(path.join(REPO, rel), { force: true });
    git("checkout", "--", A, B);
  });

  it("★★★ TẠO trong lô nhưng `original` KHÔNG rỗng (tệp đã có nội dung khác) ⇒ TỪ CHỐI CẢ LÔ", async () => {
    const truoc = docDia(A);
    const r = await tool().execute!(
      { files: [muc(B, "// z\n"), { path: A, original: "", modified: "ghi de\n" }] } as never,
      CTX as never,
    );
    expect(r.note).toBe("BATCH_REJECTED");
    expect(String(r.textSummary)).toContain("BASE_MISMATCH");
    expect(docDia(A), "một lượt 'tạo' trên tệp có sẵn KHÔNG được ghi đè").toBe(truoc);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§F — TRÙNG ĐƯỜNG DẪN trong một lô: mục sau đã CŨ ngay lúc sinh ra", () => {
  it("★★★ cùng một tệp hai lần ⇒ BATCH_DUPLICATE_PATH, 0 byte ghi", async () => {
    const goc = docDia(A);
    const truoc = goc;
    const r = await tool().execute!(
      {
        files: [
          { path: A, original: goc, modified: goc + "// p1\n" },
          { path: A, original: goc, modified: goc + "// p2\n" },
        ],
      } as never,
      CTX as never,
    );
    expect(r.note).toBe("BATCH_DUPLICATE_PATH");
    expect(docDia(A)).toBe(truoc);
  });

  it("★★★ trùng qua CHUẨN HOÁ đường dẫn (`src/a.ts` vs `./src/a.ts`) cũng bị bắt", async () => {
    const goc = docDia(A);
    const r = await tool().execute!(
      {
        files: [
          { path: A, original: goc, modified: goc + "// p1\n" },
          { path: `./${A}`, original: goc, modified: goc + "// p2\n" },
        ],
      } as never,
      CTX as never,
    );
    expect(r.note, "so chuỗi THÔ sẽ bỏ lọt ca này — phải so trên relPath đã chuẩn hoá").toBe("BATCH_DUPLICATE_PATH");
    expect(docDia(A)).toBe(goc);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§G — NGÂN SÁCH: lô là NGUYÊN TỬ về ngân sách (không đẻ trạng thái nửa vời do hết trần)", () => {
  it("★★★ tổng byte của lô > ngân sách còn lại ⇒ TỪ CHỐI TRƯỚC khi ghi tệp đầu tiên", async () => {
    const { tieuNganSach } = await import("./repoSandbox");
    const m1 = muc(A, "// ns1\n");
    const m2 = muc(B, "// ns2\n");
    const can = Buffer.byteLength(m1.modified, "utf8") + Buffer.byteLength(m2.modified, "utf8");
    // Để lại đúng chỗ cho MỘT tệp, thiếu chỗ cho cả lô — đây là ca sinh ra trạng thái nửa vời nếu
    // ta hỏi ngân sách theo từng tệp thay vì cho cả lô.
    tieuNganSach(`u:${CTX.user.id}`, TRAN_BYTE_MOI_PHIEN - (can - 1));
    const truoc = [docDia(A), docDia(B)];

    const r = await tool().execute!({ files: [m1, m2] } as never, CTX as never);
    expect(r.note).toBe("BUDGET_EXCEEDED");
    expect([docDia(A), docDia(B)], "hết ngân sách ⇒ CHƯA ghi tệp nào").toEqual(truoc);
  });

  it("★★ CHỐNG VÁ QUÁ TAY — ngân sách còn thì lô vẫn qua, và byte GHI bị TRỪ đúng tổng", async () => {
    const { nganSachConLai } = await import("./repoSandbox");
    const m1 = muc(A, "// ns3\n");
    const m2 = muc(B, "// ns4\n");
    const truoc = nganSachConLai(`u:${CTX.user.id}`).conLai;
    const r = await tool().execute!({ files: [m1, m2] } as never, CTX as never);
    expect(r.note, `phải ghi được — nhận: ${r.textSummary}`).toBeUndefined();
    const sau = nganSachConLai(`u:${CTX.user.id}`).conLai;
    expect(truoc - sau).toBe(
      Buffer.byteLength(m1.modified, "utf8") + Buffer.byteLength(m2.modified, "utf8"),
    );
    git("checkout", "--", A, B);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§H — TOCTOU: cả N băm được so LẠI ở execute (tệp đổi giữa propose và confirm)", () => {
  it("★★★ preview XANH → tệp THỨ HAI bị sửa tay → execute TỪ CHỐI CẢ LÔ, tệp thứ nhất nguyên vẹn", async () => {
    const m1 = muc(A, "// toc1\n");
    const m2 = muc(C, "// toc2\n");

    const pv = await tool().preview!({ files: [m1, m2] } as never, CTX as never);
    expect(pv.changes.length, "preview trên hai tệp sạch phải có diff thật").toBeGreaterThan(0);

    // GIỮA propose và confirm: kẻ khác sửa tay tệp thứ HAI.
    fs.writeFileSync(path.join(REPO, C), docDia(C) + "// ai do vua sua\n");
    const truocA = docDia(A);
    const truocC = docDia(C);

    const r = await tool().execute!({ files: [m1, m2] } as never, CTX as never);
    expect(r.note).toBe("BATCH_REJECTED");
    expect(String(r.textSummary)).toMatch(/FILE_DIRTY|BASE_MISMATCH/);
    expect(docDia(A), "bản diff CŨ của tệp 1 KHÔNG được ghi khi tệp 2 đã đổi dưới chân").toBe(truocA);
    expect(docDia(C)).toBe(truocC);
    git("checkout", "--", C);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§I — ★★ `git status --porcelain` cho TỆP CHƯA TỒN TẠI: ĐO, không suy luận", () => {
  /**
   * ⚠⚠ Brief nói *"`??` (chưa track) hiện đang bị coi là BẨN ⇒ sẽ chặn cả lượt TẠO hợp lệ"*.
   * Ca này ĐO và cho thấy tiền đề ấy **SAI**: một tệp chưa tồn tại cho porcelain **RỖNG**, không
   * phải `??`. `??` chỉ xuất hiện cho một tệp **ĐÃ có trên đĩa nhưng chưa track** — và đó KHÔNG
   * phải một lượt TẠO (tệp đã tồn tại), nó là một lượt GHI ĐÈ lên công việc chưa commit, đúng thứ
   * hàng rào sinh ra để chặn. Nên không có gì phải nới, và nới sẽ mở lại đúng sự cố 2026-08-18.
   */
  it("★★★ tệp CHƯA TỒN TẠI ⇒ porcelain RỖNG ⇒ `sach: true` (lượt TẠO đi qua được)", async () => {
    const rel = "src/hoan-toan-chua-co.ts";
    expect(coTren(rel)).toBe(false);
    const st = await trangThaiGitCuaTep(rel, REPO);
    expect(st.ok && st.trangThai, "porcelain của một tệp không tồn tại phải RỖNG").toBe("");
    expect(st.ok && st.sach).toBe(true);
  });

  it("★★★ tệp ĐÃ CÓ nhưng CHƯA TRACK ⇒ `??` ⇒ `sach: false` — và đó là lượt GHI ĐÈ, không phải TẠO", async () => {
    const rel = "src/co-nhung-chua-track.ts";
    fs.writeFileSync(path.join(REPO, rel), "export const U = 1;\n");
    try {
      const st = await trangThaiGitCuaTep(rel, REPO);
      expect(st.ok && st.trangThai).toMatch(/^\?\?/);
      expect(st.ok && st.sach).toBe(false);
      // Và lô từ chối nó — đúng chiều: nội dung ấy là công việc CHƯA COMMIT của ai đó.
      const r = await tool().execute!(
        { files: [muc(A, "// z\n"), { path: rel, original: "export const U = 1;\n", modified: "khac\n" }] } as never,
        CTX as never,
      );
      expect(r.note).toBe("BATCH_REJECTED");
      expect(String(r.textSummary)).toContain("FILE_DIRTY");
    } finally {
      fs.rmSync(path.join(REPO, rel), { force: true });
    }
  });

  it("★★★ NGHIỆM THU SỐNG: TẠO một tệp mới trong lô ⇒ hàng rào 'tệp bẩn' KHÔNG chặn nhầm", async () => {
    const rel = "src/tao-qua-hang-rao.ts";
    const r = await tool().execute!(
      { files: [muc(A, "// hr\n"), { path: rel, original: "", modified: "export const HR = 1;\n" }] } as never,
      CTX as never,
    );
    expect(r.note, `TẠO hợp lệ trong lô phải XANH — nhận: ${r.textSummary}`).toBeUndefined();
    expect(docDia(rel)).toBe("export const HR = 1;\n");
    fs.rmSync(path.join(REPO, rel), { force: true });
    git("checkout", "--", A);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§J — GHI TỪNG PHẦN KHÔNG BAO GIỜ IM LẶNG (`BATCH_PARTIAL`)", () => {
  /**
   * ⚠⚠ Ca này dựng một lượt hỏng **ở pha GHI** (không phải pha phán quyết) bằng thuộc tính CHỈ ĐỌC
   * của hệ tệp: `writeConfined` mở `O_RDWR|O_CREAT` nên một tệp chỉ-đọc làm `openSync` ném
   * `EPERM`/`EACCES` — đúng lớp hỏng thật (đầy đĩa, EACCES, tệp bị khoá) mà vòng PHÁN QUYẾT KHÔNG
   * thể thấy trước. Nó chứng minh mã trả `BATCH_PARTIAL` **kèm danh sách chính xác**, chứ không im
   * lặng.
   *
   * ⚠⚠ LƯU Ý CHO NGƯỜI SỬA FILE NÀY — **ĐỪNG viết cụm "pha" + MỘT CHỮ SỐ trong file test này.**
   * `server/services/vram/vramPha5Gate.test.ts` nhận diện "lưới tự khai thuộc một pha" bằng
   * `/\bPha\s+\d+/i` quét **NỘI DUNG** mọi `*.test.ts` trong cổng. Bản đầu của khối này gọi hai
   * pha của lô bằng SỐ THỨ TỰ, và điều đó làm con số bị ghim ở đó nhảy 126 → **127** — một ô ĐỎ
   * **không** phản ánh thay đổi nào của tập lưới bị canh, chỉ phản ánh hai chữ trong một câu văn.
   * Đo được: đổi cách gọi ⇒ xanh lại (và ca này ĐỎ hai lượt liền vì lượt sửa ĐẦU vẫn TRÍCH DẪN
   * nguyên văn cụm gây ra nó — một lời giải thích cũng là "nội dung"). Vì thế: gọi hai pha của lô
   * bằng TÊN (PHÁN QUYẾT / GHI), và đừng trích dẫn cụm ấy ở bất kỳ đâu trong file test.
   *
   * ⚠ Nếu nền tảng không cưỡng chế được thuộc tính chỉ-đọc (một số cấu hình chạy quyền cao), ca sẽ
   *   tự khai điều đó thay vì giả vờ xanh — xem nhánh `khongCuongCheDuoc`.
   */
  it("★★★ hỏng ở pha GHI ⇒ BATCH_PARTIAL kèm ĐÚNG danh sách đã ghi / chưa ghi", async () => {
    const m1 = muc(A, "// pp1\n");
    const m2 = muc(KHOA, "// pp2\n");
    const m3 = muc(B, "// pp3\n");
    const absKhoa = path.join(REPO, KHOA);

    fs.chmodSync(absKhoa, 0o444);
    let khongCuongCheDuoc = false;
    try {
      const fd = fs.openSync(absKhoa, fs.constants.O_RDWR);
      fs.closeSync(fd);
      khongCuongCheDuoc = true; // mở ghi được ⇒ nền tảng không cưỡng chế
    } catch {
      /* đúng như mong đợi: không mở ghi được */
    }

    try {
      if (khongCuongCheDuoc) {
        expect(
          khongCuongCheDuoc,
          "nền tảng KHÔNG cưỡng chế thuộc tính chỉ-đọc ⇒ ca này không dựng được lượt hỏng THẬT. " +
            "Khai ra thay vì để một ca tự-thoả nằm im trong lưới.",
        ).toBe(false);
        return;
      }
      const r = await tool().execute!({ files: [m1, m2, m3] } as never, CTX as never);
      expect(r.note, `nhận: ${r.textSummary}`).toBe("BATCH_PARTIAL");
      const d = r.data as { ok: boolean; daGhi: Array<{ path: string }>; chuaGhi: Array<{ path: string }> };
      expect(d.ok).toBe(false);
      expect(d.daGhi.map((x) => x.path), "tệp TRƯỚC chỗ hỏng ĐÃ trên đĩa — phải khai đúng").toEqual([A]);
      expect(d.chuaGhi.map((x) => x.path), "tệp tại và SAU chỗ hỏng chưa ghi").toEqual([KHOA, B]);
      expect(String(r.textSummary), "câu phải nói thẳng cây làm việc đang NỬA VỜI").toContain("NỬA VỜI");
      expect(String(r.textSummary)).toContain("git diff");
      // Nghiệm thu SỐNG: đúng một tệp đổi trên đĩa.
      expect(docDia(A)).toBe(m1.modified);
      expect(docDia(B), "tệp SAU chỗ hỏng phải nguyên vẹn").not.toBe(m3.modified);
    } finally {
      fs.chmodSync(absKhoa, 0o666);
      git("checkout", "--", ".");
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§K — WORM: preview mang đủ băm TRƯỚC/SAU CỦA TỪNG TỆP (thứ audit_logs sẽ ghi)", () => {
  it("★★★ mỗi tệp có bộ 4 trường path/sha256Before/sha256After/content, đánh số theo mục", async () => {
    const m1 = muc(A, "// worm1\n");
    const m2 = muc(B, "// worm2\n");
    const pv = await tool().preview!({ files: [m1, m2] } as never, CTX as never);
    const truong = pv.changes.map((c) => c.field);
    expect(truong).toEqual([
      "files[1].path", "files[1].sha256Before", "files[1].sha256After", "files[1].content",
      "files[2].path", "files[2].sha256Before", "files[2].sha256After", "files[2].content",
    ]);
    const map = Object.fromEntries(pv.changes.map((c) => [c.field, c.newValue]));
    expect(map["files[1].sha256Before"]).toBe(bam(docDia(A)));
    expect(map["files[2].sha256After"]).toBe(bam(m2.modified));
    expect(
      pv.warnings.join("\n"),
      "người duyệt phải đọc được rằng MỖI tệp có băm neo riêng, không phải một băm cho cả lô",
    ).toContain("MỖI TỆP MỘT BĂM NEO RIÊNG");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ §L (2026-08-24) — **GỐC KHÔNG CÓ GIT: miễn trừ HẸP cho lượt TẠO, fail-closed Y NGUYÊN cho
 * lượt SỬA.** Đây là lưới tool-level của "rào 2" đường tạo-khung-dự-án.
 *
 * Sự việc đo được: thư mục TRỐNG mới thêm qua Quản lý dự án không có `.git` ⇒ `git status` thoát
 * ≠0 ⇒ trước bản vá, MỌI lượt ghi (kể cả TẠO tệp chưa tồn tại) bị `GIT_STATUS_FAILED` — hàng rào
 * tệp-bẩn chặn một lượt không thể chạm tới thứ nó bảo vệ. Miễn trừ (`mienKiemGitChoLuotTao`) chỉ
 * mở cho hình dạng `git KHÔNG hỏi được + tệp CHƯA tồn tại`; hai ca "chống nới" ở dưới là mỏ neo
 * cho hai đột biến bắt buộc: (a) bỏ kiểm CHƯA-tồn-tại ⇒ ĐỎ; (b) nới luôn cho lượt SỬA ⇒ ĐỎ.
 */
describe("§L — gốc KHÔNG git: TẠO đi qua (kèm cảnh báo), SỬA vẫn GIT_STATUS_FAILED", () => {
  let KHONG_GIT = "";
  /** ctx trỏ gốc dự án vào thư mục không-git — đúng đường `ctx.projectRoot` của doc 79 TRỤC 2. */
  const ctxKhongGit = () => ({ ...CTX, projectRoot: KHONG_GIT }) as typeof CTX & { projectRoot: string };
  const TEP_CU = "src/co-san.cs";
  const ND_CU = "namespace X;\npublic class CoSan { }\n";

  beforeAll(() => {
    KHONG_GIT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lo-khong-git-")));
    fs.mkdirSync(path.join(KHONG_GIT, "src"), { recursive: true });
    fs.writeFileSync(path.join(KHONG_GIT, TEP_CU), ND_CU);
  });
  afterAll(() => {
    try {
      fs.rmSync(KHONG_GIT, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("★ ĐỐI CHỨNG HIỆU CHUẨN — gốc tạm THẬT SỰ không hỏi được git (mọi ca dưới đứng trên tiền đề này)", async () => {
    // Nếu máy chạy lưới có một `.git` ở TRÊN thư mục tạm, git sẽ đi ngược lên và trả lời được —
    // khi ấy ca này đỏ TO TIẾNG thay vì để các ca dưới đỏ vì một lý do khó hiểu.
    const st = await trangThaiGitCuaTep("src/bat-ky.cs", KHONG_GIT);
    expect(st.ok, "thư mục tạm phải nằm NGOÀI mọi repo git để phép đo có nghĩa").toBe(false);
    if (!st.ok) expect(st.ma).toBe("GIT_STATUS_FAILED");
  });

  it("★★★ vị từ THUẦN `mienKiemGitChoLuotTao`: đúng MỘT ô của bảng chân trị được mở", async () => {
    const { mienKiemGitChoLuotTao } = await import("./writeHandlers/applyDiff");
    expect(mienKiemGitChoLuotTao(false, false), "TẠO + git hỏng ⇒ miễn (ô DUY NHẤT mở)").toBe(true);
    expect(mienKiemGitChoLuotTao(true, false), "SỬA + git hỏng ⇒ KHÔNG miễn — ca then chốt chống nới").toBe(false);
    expect(mienKiemGitChoLuotTao(false, true), "git hỏi được ⇒ vị từ không có tiếng nói").toBe(false);
    expect(mienKiemGitChoLuotTao(true, true)).toBe(false);
  });

  it("★★★ lô TOÀN TẠO vào gốc không-git ⇒ GHI THẬT, đĩa đúng từng byte, preview MANG cảnh báo git init", async () => {
    const m1 = { path: "App.xaml", original: "", modified: "<Application />\n" };
    const m2 = { path: "src/App.xaml.cs", original: "", modified: "namespace X;\npublic class App { }\n" };

    const pv = await tool().preview!({ files: [m1, m2] } as never, ctxKhongGit() as never);
    const canhBao = pv.warnings.join("\n");
    expect(canhBao, "người duyệt PHẢI được báo là không có lưới hoàn tác").toContain("CHƯA có git");
    expect(canhBao).toContain("git init");

    const r = await tool().execute!({ files: [m1, m2] } as never, ctxKhongGit() as never);
    expect(r.note, `lô TẠO hợp lệ phải XANH trong gốc không-git — nhận: ${r.textSummary}`).toBeUndefined();
    expect(fs.readFileSync(path.join(KHONG_GIT, m1.path), "utf8")).toBe(m1.modified);
    expect(fs.readFileSync(path.join(KHONG_GIT, m2.path), "utf8")).toBe(m2.modified);
    fs.rmSync(path.join(KHONG_GIT, m1.path), { force: true });
    fs.rmSync(path.join(KHONG_GIT, m2.path), { force: true });
  });

  it("★★★ CHỐNG NỚI (ca then chốt) — SỬA tệp CÓ SẴN trong gốc không-git ⇒ TỪ CHỐI GIT_STATUS_FAILED, đĩa nguyên vẹn", async () => {
    const r = await tool().execute!(
      { files: [{ path: TEP_CU, original: ND_CU, modified: ND_CU + "// them\n" }] } as never,
      ctxKhongGit() as never,
    );
    expect(r.note).toBe("BATCH_REJECTED");
    expect(String(r.textSummary), "mã phải là GIT_STATUS_FAILED — không chứng minh được tệp sạch thì không ghi").toContain(
      "GIT_STATUS_FAILED",
    );
    expect(fs.readFileSync(path.join(KHONG_GIT, TEP_CU), "utf8"), "tệp có thật KHÔNG được đổi một byte").toBe(ND_CU);
  });

  it("★★★ lô TRỘN tạo + sửa trong gốc không-git ⇒ TỪ CHỐI CẢ LÔ, tệp TẠO cũng KHÔNG được ghi lẻ", async () => {
    const taoMoi = { path: "src/moi-tron.cs", original: "", modified: "class MoiTron { }\n" };
    const r = await tool().execute!(
      { files: [taoMoi, { path: TEP_CU, original: ND_CU, modified: ND_CU + "// x\n" }] } as never,
      ctxKhongGit() as never,
    );
    expect(r.note).toBe("BATCH_REJECTED");
    expect(fs.existsSync(path.join(KHONG_GIT, taoMoi.path)), "pha PHÁN QUYẾT đỏ ⇒ 0 byte, kể cả mục hợp lệ").toBe(false);
    expect(fs.readFileSync(path.join(KHONG_GIT, TEP_CU), "utf8")).toBe(ND_CU);
  });

  it("★★ CHỐNG VÁ QUÁ TAY — trong repo CÓ git, lượt TẠO không mang cảnh báo không-git nào", async () => {
    const pv = await tool().preview!(
      { files: [{ path: "src/tao-trong-git.ts", original: "", modified: "export const G = 1;\n" }] } as never,
      CTX as never,
    );
    expect(pv.warnings.join("\n"), "cảnh báo này chỉ dành cho gốc KHÔNG git").not.toContain("CHƯA có git");
  });
});
