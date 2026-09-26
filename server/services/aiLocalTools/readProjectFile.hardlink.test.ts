/**
 * ★★★ Pha 5 Task 1 (N13) — **`read_project_file` PHẢI TỪ CHỐI NTFS HARD LINK.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: MỘT LỖ **ĐÃ ĐO ĐƯỢC**, KHÔNG PHẢI SUY ĐOÁN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lượt nghiệm thu sống Pha 4 (2026-08-06) dựng `fs.linkSync(<file NGOÀI workspace>, <trong
 * workspace>)` — **thành công, không cần đặc quyền nào** — rồi gọi `read_project_file` từ đầu
 * đường Agent và **đọc thật được 57 byte**: `DATABASE_URL=postgres://aoi:SUPERSECRET@…`.
 *
 * ⚠ CƠ CHẾ (đây là điểm dễ vá sai): junction **THƯ MỤC** bị chặn đúng vì nó **ĐỔI `realpath`**.
 * Hard link **KHÔNG đổi `realpath`** — cùng inode, đường dẫn tự phân giải về **chính nó**, vẫn
 * nằm dưới workspace ⇒ `realpathStillContained()` trả `true` một cách **hoàn toàn đúng đắn**.
 * ⇒ Không phép kiểm **ĐƯỜNG DẪN** nào bắt được lớp này. Phải hỏi một câu khác: **số liên kết cứng
 * của inode** (`Stats.nlink`). Ca `★★★ CƠ CHẾ` dưới đây **đo lại chính điều đó**, để người sau
 * không "đơn giản hoá" phép chặn mới về một phép so đường dẫn nữa.
 *
 * **Quyết định của chủ dự án (đã chốt):** TỪ CHỐI `nlink > 1`. Đây là tool ĐỌC MÃ NGUỒN — file
 * nguồn hầu như không bao giờ có hard link ⇒ chặn nhầm rất hiếm, và chặn nhầm thì hỏng theo
 * chiều **AN TOÀN**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ MỌI CA ĐI QUA `tryExecuteTool()` THẬT (đường Agent), KHÔNG gọi thẳng `handler()`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bài học đã trả giá: bộ ca cũ **tự tiêm `__authCtx`** vào `handler()` nên nó **xanh 215/215 suốt
 * thời gian tool CHẾT trên đường thật**. Ở đây bộ phân loại bị thay bằng một seam trả đúng hình
 * dạng `classifyToolIntent()` trả — tức mô phỏng **người sản xuất args không tin được** — và mọi
 * mắt xích sau nó (`getTool`, `argsWithAuthCtx`, `tool.parameters`, RBAC gate, `fs`) là hàng THẬT.
 *
 * ⚠⚠ **ĐỐI CHỨNG DƯƠNG LÀ BẮT BUỘC** (`★★★ ĐỐI CHỨNG DƯƠNG`): nếu chỉ có ca "bị chặn" thì một bản
 * vá **chặn hết mọi file** cũng xanh. Ca ấy khoá **một giá trị cụ thể** (nội dung + số byte), nên
 * đột biến `nlink >= 1` làm nó ĐỎ.
 *
 * ⚠ `symlink FILE` **không dựng được trên máy này** (`EPERM`, Windows đòi
 * `SeCreateSymbolicLinkPrivilege`/Developer Mode) — xem ca `★ MÔI TRƯỜNG`, nó **khai to** điều đó
 * thay vì im lặng bỏ qua. Hai biến thể **dựng được** (junction thư mục + hard link) đều có ca.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── RBAC: cho qua, để thứ đang được kiểm là RANH GIỚI FILE, không phải cổng quyền ──
const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

/**
 * Seam **NGƯỜI SẢN XUẤT ARGS** — đứng đúng chỗ `classifyToolIntent`/`classifyToolIntentLLM` đứng.
 * ⚠ KHÔNG giả `toolRegistry`, KHÔNG giả tool, KHÔNG giả `fs`. `reason: "LLM_MATCH"` mô phỏng đúng
 * lượt đã đo ở Pha 4 (bộ phân loại LLM sinh args ⇒ `safeParse` ⇒ handler CHẠY).
 */
const seam = vi.hoisted(() => ({ args: {} as Record<string, unknown> }));
vi.mock("./intentClassifier", async (importOriginal) => {
  const that = await importOriginal<typeof import("./intentClassifier")>();
  return {
    ...that,
    classifyToolIntent: () => ({ tool: "read_project_file", args: seam.args, reason: "LLM_MATCH" }),
    classifyToolIntentLLM: async () => ({ tool: "read_project_file", args: seam.args, reason: "LLM_MATCH" }),
  };
});

import { tryExecuteTool } from "./index";

/** Danh tính PHIÊN THẬT (máy chủ tự đọc) — nguồn hợp lệ duy nhất. */
const PHIEN = { user: { id: 7, role: "supervisor", name: "Tester" }, lang: "vi" as const };

/** Nội dung bí mật NGOÀI workspace — đúng 57 byte, khớp con số đã đo ở Pha 4. */
const BI_MAT = "DATABASE_URL=postgres://aoi:SUPERSECRET@127.0.0.1:5434/x\n";
/** Đối chứng DƯƠNG: một file nguồn BÌNH THƯỜNG trong workspace. */
const NGUON_BINH_THUONG = "PROGRAM main\n  run := TRUE;\nEND_PROGRAM\n";

let ws = "";
let ngoai = "";
let duongBiMat = "";

/** Ghi lại VÌ SAO một biến thể không dựng được — để không có mục nào bị bỏ qua im lặng. */
const dungDuoc: Record<string, { ok: boolean; loi: string | null; nlink: number | null }> = {};

function thu(ten: string, f: () => string | null): void {
  try {
    const p = f();
    dungDuoc[ten] = { ok: true, loi: null, nlink: p ? fs.statSync(p).nlink : null };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    dungDuoc[ten] = { ok: false, loi: `${err.code}: ${err.message}`, nlink: null };
  }
}

beforeAll(() => {
  // ⚠ Cùng ổ đĩa: hard link NTFS không vượt volume được. `os.tmpdir()` cho cả hai.
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "n13-ws-"));
  ngoai = fs.mkdtempSync(path.join(os.tmpdir(), "n13-ngoai-"));
  process.env.PROG_WORKSPACE_DIR = ws;

  duongBiMat = path.join(ngoai, "secret.env");
  fs.writeFileSync(duongBiMat, BI_MAT);
  fs.writeFileSync(path.join(ws, "main.st"), NGUON_BINH_THUONG);

  // (a) HARD LINK trong workspace trỏ tới file bí mật ngoài workspace — lỗ N13.
  thu("hardlink", () => {
    const p = path.join(ws, "innocent.st");
    fs.linkSync(duongBiMat, p);
    return p;
  });
  // (b) JUNCTION THƯ MỤC ra ngoài — phòng thủ ĐANG ĐÚNG, ca dưới canh không cho phá.
  thu("junction", () => {
    const p = path.join(ws, "jdir");
    fs.symlinkSync(ngoai, p, "junction");
    return null;
  });
  // (c) SYMLINK FILE — đã biết là EPERM trên máy này; ca `★ MÔI TRƯỜNG` khai to.
  thu("symlinkFile", () => {
    const p = path.join(ws, "sym.env");
    fs.symlinkSync(duongBiMat, p, "file");
    return p;
  });
});

afterAll(() => {
  for (const d of [ws, ngoai]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  delete process.env.PROG_WORKSPACE_DIR;
});

beforeEach(() => {
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  seam.args = {};
});

/** Gọi tool **TỪ ĐẦU ĐƯỜNG**: câu hỏi → bộ phân loại (seam) → `argsWithAuthCtx` → handler THẬT. */
async function doc(p: string, lang?: "vi" | "en" | "zh") {
  seam.args = lang ? { path: p, lang } : { path: p };
  const r = await tryExecuteTool("đọc file dùm tôi", undefined, PHIEN);
  expect(r.result, `tool phải chạy tới nơi cho: ${p}`).not.toBeNull();
  return r.result!;
}

describe("★★★ N13 — read_project_file: NTFS hard link KHÔNG được đọc", () => {
  it("★ MÔI TRƯỜNG — khai TO biến thể nào dựng được, biến thể nào không và VÌ SAO", () => {
    // Không có `expect` nào ở đây quyết định pass/fail ngoài hai điều KIỆN TIÊN QUYẾT dưới;
    // phần còn lại là BẰNG CHỨNG in ra để báo cáo trích nguyên văn.
    // eslint-disable-next-line no-console
    console.log("[N13] biến thể liên kết:", JSON.stringify(dungDuoc, null, 2));

    expect(
      dungDuoc.hardlink.ok,
      `KHÔNG dựng được hard link ⇒ ca chính dưới đây KHÔNG chứng minh gì. Lý do: ${dungDuoc.hardlink.loi}. ` +
        "Không được bỏ qua im lặng — sửa môi trường (cùng ổ đĩa, NTFS) rồi chạy lại.",
    ).toBe(true);
    /**
     * ⚠ M-3 (review): bản trước khoá `toBe(2)` — **khoá theo chữ ký của cảnh dựng**, không theo
     * luật. Người review dựng HAI hard link tới cùng inode ⇒ `nlink = 3` và một ca kiểu ấy đỏ vì
     * lý do **không liên quan tới sản phẩm**. Luật muốn nói *"nó PHẢI LÀ nhiều hơn một liên kết"*.
     */
    expect(dungDuoc.hardlink.nlink, "hard link phải làm nlink > 1, nếu không thì phép chặn vô nghĩa").toBeGreaterThan(1);
    expect(
      dungDuoc.junction.ok,
      `KHÔNG dựng được junction ⇒ không canh được phòng thủ ĐANG ĐÚNG. Lý do: ${dungDuoc.junction.loi}`,
    ).toBe(true);
    // symlink FILE: đã biết KHÔNG dựng được trên máy này — ghi lý do, không giả vờ đã kiểm.
    if (!dungDuoc.symlinkFile.ok) {
      expect(dungDuoc.symlinkFile.loi, "phải có lý do CỤ THỂ, không được rỗng").toMatch(/EPERM|EACCES|ENOSYS/);
    }
  });

  it("★★★ CƠ CHẾ — hard link KHÔNG đổi `realpath`, nên MỌI phép kiểm ĐƯỜNG DẪN đều thấy nó hợp lệ", () => {
    /**
     * ⚠⚠ Ca này tồn tại để chặn một bản vá SAI: "thì siết `realpathStillContained` chặt hơn".
     * Nó **đo** rằng `realpath` của hard link nằm **TRONG** workspace ⇒ không phép so đường dẫn nào
     * phân biệt được nó với một file thường. Phép chặn **bắt buộc** phải hỏi `Stats.nlink`.
     */
    const link = path.join(ws, "innocent.st");
    const realRoot = fs.realpathSync(ws);
    const realLink = fs.realpathSync(link);
    const rel = path.relative(realRoot, realLink);
    expect(rel.startsWith(".."), "realpath của hard link KHÔNG thoát khỏi workspace").toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);
    expect(rel).toBe("innocent.st");
    // …và nội dung của inode ấy ĐÚNG LÀ bí mật ngoài workspace.
    expect(fs.readFileSync(link, "utf8")).toBe(BI_MAT);
    expect(fs.statSync(link).nlink).toBeGreaterThan(1);
    expect(fs.statSync(link).size).toBe(57);
  });

  it("★★★ hard link tới file NGOÀI workspace ⇒ TỪ CHỐI, và 0 byte nội dung về tới Agent", async () => {
    const r = await doc("innocent.st");

    expect(r.note, "cùng mã từ chối đã có — không đẻ mã mới").toBe("PATH_REJECTED");
    const d = r.data as { path: string | null; bytes: number | null; content: string | null };
    expect(d.content, "0 byte nội dung").toBeNull();
    expect(d.bytes).toBeNull();
    expect(d.path).toBeNull();
    // Bằng chứng MẠNH nhất: bí mật không rò ra ở BẤT KỲ ô nào của kết quả (kể cả textSummary).
    expect(JSON.stringify(r)).not.toContain("SUPERSECRET");
    expect(JSON.stringify(r)).not.toContain("DATABASE_URL");
  });

  it("★★★ câu từ chối nói VÌ SAO (liên kết cứng), KHÁC hẳn câu 'thoát thư mục' — đủ ba ngôn ngữ", async () => {
    /**
     * ⚠ "bị chặn" mà không nói vì sao thì người vận hành sẽ đi sửa nhầm chỗ: câu ESCAPE
     * ("đường dẫn thoát khỏi thư mục làm việc") **SAI SỰ THẬT** ở đây — đường dẫn KHÔNG thoát.
     */
    const vi = await doc("innocent.st", "vi");
    expect(vi.textSummary).toMatch(/liên kết cứng|hard link/i);
    expect(vi.textSummary, "không được mượn câu ESCAPE — nó nói sai nguyên nhân").not.toMatch(/thoát khỏi thư mục làm việc/);

    const en = await doc("innocent.st", "en");
    expect(en.textSummary).toMatch(/hard link/i);
    expect(en.textSummary).not.toBe(vi.textSummary);

    const zh = await doc("innocent.st", "zh");
    expect(zh.textSummary).toMatch(/硬链接/);
    expect(zh.textSummary).not.toBe(en.textSummary);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — file nguồn BÌNH THƯỜNG trong workspace VẪN đọc được, đúng giá trị", async () => {
    /**
     * ⚠⚠ Nếu thiếu ca này thì một bản vá "từ chối MỌI file" cũng xanh — đúng lớp lỗi đã để
     * `215/215` xanh suốt thời gian một tool chết. Ca khoá **giá trị cụ thể**, không chỉ "không lỗi".
     */
    expect(fs.statSync(path.join(ws, "main.st")).nlink, "đối chứng dương phải là file nlink = 1").toBe(1);

    const r = await doc("main.st");

    expect(r.note, "file thường KHÔNG được bị chặn").toBeUndefined();
    const d = r.data as { path: string | null; bytes: number | null; content: string | null; truncated: boolean };
    expect(d.content).toBe(NGUON_BINH_THUONG);
    expect(d.bytes).toBe(Buffer.byteLength(NGUON_BINH_THUONG));
    expect(d.path).toBe("main.st");
    expect(d.truncated).toBe(false);
    expect(r.textSummary).toContain("run := TRUE;");
  });

  it("★★ ĐỐI CHỨNG DƯƠNG (lồng nhau) — file trong thư mục con vẫn đọc được", async () => {
    fs.mkdirSync(path.join(ws, "sub"), { recursive: true });
    fs.writeFileSync(path.join(ws, "sub", "b.txt"), "NESTED-OK");
    const r = await doc("sub/b.txt");
    expect(r.note).toBeUndefined();
    expect((r.data as { content: string | null }).content).toBe("NESTED-OK");
  });

  it("★★ PHÒNG THỦ ĐANG ĐÚNG — junction THƯ MỤC ra ngoài workspace VẪN bị chặn (không phá)", async () => {
    const r = await doc("jdir/secret.env");
    expect(r.note).toBe("PATH_REJECTED");
    const d = r.data as { bytes: number | null; content: string | null };
    expect(d.content).toBeNull();
    expect(d.bytes).toBeNull();
    expect(JSON.stringify(r)).not.toContain("SUPERSECRET");
  });

  it("★★ PHÒNG THỦ ĐANG ĐÚNG — `..` / tuyệt đối / drive-relative vẫn PATH_REJECTED, và NOT_FOUND vẫn NOT_FOUND", async () => {
    for (const p of ["../secret.env", "sub/../../secret.env", duongBiMat, "/etc/passwd", "C:\\Windows\\win.ini", "..\\..\\x"]) {
      const r = await doc(p);
      expect(r.note, `phải từ chối: ${p}`).toBe("PATH_REJECTED");
      expect((r.data as { content: string | null }).content).toBeNull();
    }
    const missing = await doc("khong-ton-tai.st");
    expect(missing.note, "phép chặn mới không được nuốt mã NOT_FOUND").toBe("NOT_FOUND");
  });
});
