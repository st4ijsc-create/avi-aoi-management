/**
 * ★★★ Pha 5 Task 1 (review, **I-3**) — **LƯỚI THEO ĐƯỜNG THOÁT, KHÔNG THEO TÊN TOOL.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: PHÉP THỬ M3 ĐÃ **TRƯỢT**, VÀ KHÔNG CẦN ĐỘT BIẾN ĐỂ CHỨNG MINH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lưới vòng trước (`readProjectFile.hardlink.test.ts`) được nặn theo **TÊN TOOL** — nó chỉ chạm
 * `read_project_file`. Điểm đọc file **THỨ HAI** (`writeHandlers/programmingFile.ts` →
 * `readCurrentIfFile` → `fs.readFileSync`) **đã có sẵn trong mã sản xuất**, và lưới ấy **xanh 8/8
 * trong khi nó rò**. Người review đo được `preview.changes[1].oldValue` mang nguyên văn nội dung
 * một file ngoài workspace. Đó là bằng chứng M3 **mạnh hơn** một đột biến tổng hợp: không phải giả
 * thiết, là **hiện trạng**.
 *
 * ⇒ Bất biến ở đây được phát biểu theo **BYTE RỜI KHỎI NHÓM TOOL**, không theo tên hàm:
 *
 *     **KHÔNG một byte nào của một inode có `nlink > 1` được xuất hiện trong BẤT KỲ đầu ra nào
 *     của BẤT KỲ tool nào nhận tham số `path`.**
 *
 * ⚠⚠ Danh sách tool lấy từ **`listTools()` của `toolRegistry`** — một **nguồn ĐỘC LẬP** với file
 * này. Bài học *"cả hai vế suy ra từ CÙNG MỘT BẢNG"* (N14): nếu tôi chép tay danh sách tool thì
 * một tool MỚI đọc file sẽ **vô hình** với lưới. Ở đây một tool mới có ô `path` **tự động rơi vào
 * lưới**, kể cả khi người viết nó chưa từng đọc file này.
 *
 * ⚠ Lưới phủ **mọi bề mặt** của tool, không chỉ `handler`: `preview()` là một đường ĐỌC và nó chạy
 * **TRƯỚC** HITL — chính chỗ C-1 rò.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

import "./index"; // đăng ký TOÀN BỘ tool (side-effect) — nguồn của `listTools()`
import { listTools, type Tool } from "./toolRegistry";

/** Canary: một chuỗi không thể xuất hiện tình cờ. */
const CANARY = "N13-CANARY-9f3a7c21";
const BI_MAT = `SECRET_TOKEN=${CANARY}\nAWS_KEY=zzz\n`;

const CTX = { user: { id: 7, role: "supervisor", name: "T" }, lang: "vi" as const };
const AUTH = { userId: 7, role: "supervisor" };

let ws = "";
let ngoai = "";
let hardlinkOk = false;
let hardlinkErr: string | null = null;

beforeAll(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "n13-canary-ws-"));
  ngoai = fs.mkdtempSync(path.join(os.tmpdir(), "n13-canary-out-"));
  process.env.PROG_WORKSPACE_DIR = ws;
  const secret = path.join(ngoai, "prod.env");
  fs.writeFileSync(secret, BI_MAT);
  try {
    fs.linkSync(secret, path.join(ws, "looks-fine.st"));
    hardlinkOk = true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    hardlinkErr = `${err.code}: ${err.message}`;
  }
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
});

/** Tool nào nhận một ô `path`? Hỏi **schema thật** của tool, không chép tay danh sách. */
function nhanThamSoPath(t: Tool<any, any>): boolean {
  const shape = (t.parameters as unknown as { shape?: Record<string, unknown> })?.shape;
  return !!shape && Object.hasOwn(shape, "path");
}

/** Gọi MỌI bề mặt của một tool với đường dẫn hard link, gom mọi thứ nó trả ra. */
async function moiDauRa(t: Tool<any, any>, p: string): Promise<string> {
  const args = { path: p, content: "x", __authCtx: AUTH };
  const ra: unknown[] = [];
  for (const [ten, f] of [
    ["handler", t.handler],
    ["preview", t.preview],
    ["summarize", t.summarize],
  ] as const) {
    if (typeof f !== "function") continue;
    try {
      ra.push({ [ten]: await (f as (a: unknown, c: unknown) => unknown)(args, CTX) });
    } catch (e) {
      ra.push({ [ten]: `THREW ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return JSON.stringify(ra);
}

describe("★★★ I-3 — KHÔNG byte nào của một inode nlink>1 rời khỏi nhóm tool, qua BẤT KỲ cửa nào", () => {
  it("★ MÔI TRƯỜNG — hard link phải dựng được, nếu không thì lưới này KHÔNG chứng minh gì", () => {
    expect(hardlinkOk, `không dựng được hard link ⇒ lưới vô nghĩa. Lý do: ${hardlinkErr}`).toBe(true);
    // ⚠ M-3 (review): KHÔNG khoá `nlink === 2` — đó là khoá theo **chữ ký của cảnh dựng**.
    // Luật muốn nói *"nó PHẢI LÀ nhiều hơn một liên kết"*.
    expect(fs.statSync(path.join(ws, "looks-fine.st")).nlink).toBeGreaterThan(1);
    expect(fs.readFileSync(path.join(ws, "looks-fine.st"), "utf8")).toContain(CANARY);
  });

  it("★★★ MỌI tool nhận `path` (lấy từ toolRegistry — NGUỒN ĐỘC LẬP) đều KHÔNG để canary lọt", async () => {
    const tools = listTools().filter(nhanThamSoPath);
    expect(tools.length, "phải có ít nhất một tool nhận `path`, nếu không lưới đang quét hư không").toBeGreaterThan(0);

    const ro: string[] = [];
    for (const t of tools) {
      const out = await moiDauRa(t, "looks-fine.st");
      if (out.includes(CANARY) || out.includes("SECRET_TOKEN") || out.includes("AWS_KEY")) {
        ro.push(`${t.name} → ${out.slice(0, 400)}`);
      }
    }
    expect(
      ro,
      "một tool đã chở nội dung của file NGOÀI workspace ra ngoài qua hard link. Sửa TOOL để nó đi " +
        "qua `confineTarget`/`readConfined`, KHÔNG nới lưới:\n" + ro.join("\n"),
    ).toEqual([]);
  });

  it("★★ BẢN KIỂM ĐẾM — đúng những tool đã biết nhận `path`; một tool MỚI phải được nhìn thấy một lần", () => {
    const ten = listTools().filter(nhanThamSoPath).map((t) => t.name).sort();
    expect(
      ten,
      "một tool MỚI nhận `path` là một CỬA MỚI ra đĩa. Đọc lưới này, chứng minh nó đi qua cửa " +
        "chung, rồi mới thêm tên vào đây.",
    ).toEqual(["read_project_file", "write_project_file"]);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — file thường trong workspace VẪN đi qua được cả hai cửa", async () => {
    /**
     * ⚠⚠ Không có ca này thì một bản vá **chặn hết mọi file** cũng xanh — đúng lớp lỗi đã để
     * `215/215` xanh suốt thời gian một tool chết.
     */
    fs.writeFileSync(path.join(ws, "ok.st"), "PLAIN-OK-123");

    const doc = listTools().find((t) => t.name === "read_project_file")!;
    const r = await doc.handler!({ path: "ok.st", __authCtx: AUTH } as never);
    expect(r.note, "file thường phải đọc được").toBeUndefined();
    expect((r.data as { content: string | null }).content).toBe("PLAIN-OK-123");

    const ghi = listTools().find((t) => t.name === "write_project_file")!;
    const pv = await ghi.preview!({ path: "ok.st", content: "NEW" } as never, CTX as never);
    expect(pv.changes.length, "preview của file thường phải có diff thật").toBeGreaterThan(0);
    const old = pv.changes.find((c) => c.field === "content")?.oldValue;
    expect(old, "preview PHẢI đọc được nội dung cũ của một file hợp lệ").toBe("PLAIN-OK-123");
  });

  it("★★★ C-2 — `execute()` trên hard link KHÔNG đổi một byte nào của file đích, và KHÔNG khai thành công", async () => {
    /**
     * ⚠⚠ Lớp *"làm hỏng rồi BÁO CÁO THÀNH CÔNG"*. Ca khoá **cả hai** vế: đĩa **nguyên vẹn** và
     * lời khai **trung thực**. Một bản vá chặn-nhưng-đã-cắt-file sẽ đỏ ở vế thứ nhất.
     */
    const ngoaiFile = path.join(ngoai, "prod.env");
    const truoc = fs.readFileSync(ngoaiFile, "utf8");

    const ghi = listTools().find((t) => t.name === "write_project_file")!;
    const res = await ghi.execute!({ path: "looks-fine.st", content: "PWNED\n" } as never, CTX as never);

    expect(fs.readFileSync(ngoaiFile, "utf8"), "file NGOÀI workspace phải NGUYÊN VẸN từng byte").toBe(truoc);
    expect(truoc).toContain(CANARY);
    expect((res.data as { ok: boolean }).ok, "không được khai thành công cho một lượt bị chặn").toBe(false);
    expect(res.note).toBe("PATH_REJECTED");
    expect(res.textSummary).toMatch(/liên kết cứng|hard link/i);
  });

  it("★★★ C-1 — `preview()` trên hard link: changes RỖNG, và canary không có ở BẤT KỲ ô nào", async () => {
    const ghi = listTools().find((t) => t.name === "write_project_file")!;
    const pv = await ghi.preview!({ path: "looks-fine.st", content: "x" } as never, CTX as never);

    expect(pv.changes, "changes phải RỖNG — không có gì để so sánh khi cửa từ chối").toEqual([]);
    expect(JSON.stringify(pv)).not.toContain(CANARY);
    expect(JSON.stringify(pv)).not.toContain("SECRET_TOKEN");
    expect(pv.warnings.join(" ")).toMatch(/liên kết cứng|hard link/i);
  });
});
