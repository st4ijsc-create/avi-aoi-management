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
import { confineTarget, readConfined, writeConfined } from "./readToolsProgramming";

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
    /**
     * ★ 2026-08-18 (doc 78 PHA A) — **BA CÁI TÊN MỚI, VÀ CHÚNG ĐƯỢC THÊM SAU KHI ĐỌC LƯỚI NÀY.**
     *
     * `read_file`/`list_files`/`grep_repo` (`repoReadTools.ts`) nhận `path` **cố ý**: đặt tên ô là
     * `path` chính là cách chúng RƠI VÀO lưới này. Đặt tên khác (`file`, `duongDan`) để tránh lưới
     * là một lượt lách, và lách một lưới an ninh của chính mình là hình dạng tệ nhất trong repo này.
     *
     * ⚠ Ba tool ấy dùng gốc hộp cát KHÁC (`repoSandbox.gocHopCat()` = thư mục repo, không phải
     * `PROG_WORKSPACE_DIR`), nên `looks-fine.st` không tồn tại với chúng và ca canary ở trên xanh
     * vì **hai lý do độc lập**: đuôi `.st` ngoài danh sách TRẮNG **và** tệp không có ở gốc repo.
     * Ca canary RIÊNG cho hộp cát repo — với hard link/symlink dựng NGAY TRONG repo — nằm ở
     * `repoSandbox.census.test.ts`; lưới này KHÔNG chứng minh gì về gốc ấy.
     */
    const ten = listTools().filter(nhanThamSoPath).map((t) => t.name).sort();
    /**
     * ★ 2026-08-19 (doc 78 PHA C) — `apply_diff` nhận `path` **cố ý** (đặt tên khác để né lưới là
     * một lượt lách). Nó ghi vào gốc hộp cát repo (`repoSandbox.gocHopCat()`), không phải
     * `PROG_WORKSPACE_DIR`, nên `looks-fine.st` (hard link, đuôi `.st` ngoài danh sách TRẮNG) không
     * tồn tại với nó VÀ bị `duoiDuocPhep` chặn ⇒ ca canary ở trên xanh vì hai lý do độc lập. Hàng rào
     * "tệp bẩn"/băm/TOCTOU riêng của apply_diff nằm ở `applyDiff.census.test.ts`.
     */
    expect(
      ten,
      "một tool MỚI nhận `path` là một CỬA MỚI ra đĩa. Đọc lưới này, chứng minh nó đi qua cửa " +
        "chung, rồi mới thêm tên vào đây.",
    ).toEqual(["apply_diff", "grep_repo", "list_files", "read_file", "read_project_file", "write_project_file"]);
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

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ TẦNG fd (review vòng 2, **X4**) — **HÀNG RÀO KHÔNG AI CANH SẼ BIẾN MẤT LẶNG LẼ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÒNG TRƯỚC TÔI TỪ CHỐI VIẾT BỘ CA NÀY, và lý lẽ ấy SAI hai lần:
 *   1. Tôi khai *"cuộc đua không dựng lại được tất định"*. **Sai.** Không cần đua thật: gọi
 *      `confineTarget()` trên một file thường, **thay file bằng hard link ĐỒNG BỘ**, rồi gọi cửa.
 *      Hai lượt **tuần tự**, không `setTimeout`, không flake — đúng cửa sổ TOCTOU mà tầng fd sinh
 *      ra để bịt.
 *   2. Tôi khai *"ai gỡ nó cũng không thấy ca nào đỏ"* rồi coi đó là **lý do không canh**. Đó
 *      **chính là lý do PHẢI canh**. Người review đo được: gỡ riêng tầng fd ⇒ `{ok:true,bytes:14}`
 *      và **file ngoài workspace ĐÃ ĐỔI** — tức **C-2 quay lại NGUYÊN VẸN** mà 23/23 vẫn xanh.
 *
 * ⚠ Bộ ca này gọi **thẳng cửa** (`confineTarget`/`readConfined`/`writeConfined`) chứ không qua tool:
 * cửa sổ cần dựng nằm **GIỮA** hai lượt gọi ấy, nên không bề mặt tool nào chạm tới được.
 */
describe("★★★ X4 — tầng fd bắt được lượt TRÁO GIỮA `confineTarget()` và lúc mở file", () => {
  const thuong = "swap-me.st";
  const abs = () => path.join(ws, thuong);

  /** Dựng lại cảnh: `swap-me.st` là file thường (nlink=1), đã qua cửa. */
  function canhSach() {
    try {
      fs.rmSync(abs(), { force: true });
    } catch {
      /* ignore */
    }
    fs.writeFileSync(abs(), "HARMLESS-ORIGINAL");
  }

  /** TRÁO đồng bộ: xoá file thường, thay bằng hard link tới bí mật ngoài workspace. */
  function traoThanhHardLink() {
    fs.rmSync(abs(), { force: true });
    fs.linkSync(path.join(ngoai, "prod.env"), abs());
  }

  it("★★★ ĐỌC — tráo sau khi qua cửa ⇒ `readConfined` TỪ CHỐI trên fd, không rò một byte", () => {
    canhSach();
    const c = confineTarget(thuong);
    expect(c.ok, "lúc này nó ĐANG là file thường ⇒ cửa phải cho qua").toBe(true);
    if (!c.ok) return;

    traoThanhHardLink(); // ⇐ cửa sổ TOCTOU, dựng ĐỒNG BỘ

    const rd = readConfined(c.target, 256 * 1024);
    expect(rd.ok, "fd trỏ vào một inode có nhiều liên kết cứng ⇒ phải TỪ CHỐI").toBe(false);
    if (rd.ok) return;
    expect(rd.kind).toBe("PATH_REJECTED");
    expect(rd.kind === "PATH_REJECTED" ? rd.reason : null).toBe("HARD_LINK");
    expect(JSON.stringify(rd)).not.toContain(CANARY);
    expect(JSON.stringify(rd)).not.toContain("SECRET_TOKEN");
  });

  it("★★★ GHI — tráo sau khi qua cửa ⇒ `writeConfined` TỪ CHỐI, file ngoài NGUYÊN VẸN từng byte", () => {
    canhSach();
    const c = confineTarget(thuong);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    traoThanhHardLink();
    const ngoaiFile = path.join(ngoai, "prod.env");
    const truoc = fs.readFileSync(ngoaiFile, "utf8");
    const mtimeTruoc = fs.statSync(ngoaiFile).mtimeMs;

    const wr = writeConfined(c.target, "PWNED-VIA-RACE");

    expect(wr.ok, "phải TỪ CHỐI, không được khai thành công").toBe(false);
    if (wr.ok) return;
    expect(wr.kind).toBe("PATH_REJECTED");
    expect(wr.kind === "PATH_REJECTED" ? wr.reason : null).toBe("HARD_LINK");
    // ⚠ Hai vế: nội dung NGUYÊN VẸN **và** `mtime` không đổi ⇒ phân biệt "chặn" với
    // "chặn SAU KHI đã cắt" (mở `O_RDWR|O_CREAT`, KHÔNG `O_TRUNC`, kiểm trước khi ftruncate).
    expect(fs.readFileSync(ngoaiFile, "utf8"), "file ngoài workspace phải NGUYÊN VẸN").toBe(truoc);
    expect(truoc).toContain(CANARY);
    expect(fs.statSync(ngoaiFile).mtimeMs, "mtime không đổi ⇒ chưa hề bị cắt/chạm").toBe(mtimeTruoc);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — KHÔNG tráo ⇒ cả hai cửa vẫn chạy bình thường", () => {
    /**
     * ⚠⚠ Không có ca này thì một bản vá "`readConfined`/`writeConfined` từ chối mọi thứ" cũng
     * xanh ở hai ca trên. Ca khoá **giá trị cụ thể** ở cả hai chiều.
     */
    canhSach();
    const c1 = confineTarget(thuong);
    expect(c1.ok).toBe(true);
    if (!c1.ok) return;
    const rd = readConfined(c1.target, 256 * 1024);
    expect(rd.ok).toBe(true);
    expect(rd.ok ? rd.content : null).toBe("HARMLESS-ORIGINAL");

    const c2 = confineTarget(thuong);
    expect(c2.ok).toBe(true);
    if (!c2.ok) return;
    const wr = writeConfined(c2.target, "REWRITTEN-OK");
    expect(wr.ok).toBe(true);
    expect(wr.ok ? wr.bytes : -1).toBe("REWRITTEN-OK".length);
    expect(fs.readFileSync(abs(), "utf8")).toBe("REWRITTEN-OK");
  });
});

/**
 * ★ (4b) — **RỦI RO NGƯỢC của I-2: cửa có chặn OAN không?**
 * Người review bổ sung phép đo này và nó đáng giữ: siết realpath-của-TARGET có thể vô tình chặn một
 * junction trỏ **VÀO TRONG** workspace — hoàn toàn hợp lệ. Một hàng rào kêu oan sẽ bị người sau tắt.
 */
describe("★ (4b) — junction trỏ VÀO TRONG workspace KHÔNG bị chặn oan", () => {
  it("★★ đọc được file qua junction nội bộ ⇒ cửa không siết quá tay", () => {
    const that = path.join(ws, "that-dir");
    fs.mkdirSync(that, { recursive: true });
    fs.writeFileSync(path.join(that, "inside.txt"), "INSIDE-OK-42");

    let dungDuocJunction = true;
    try {
      fs.symlinkSync(that, path.join(ws, "alias-dir"), "junction");
    } catch {
      dungDuocJunction = false;
    }
    if (!dungDuocJunction) return; // môi trường không dựng được ⇒ ca không áp dụng

    const c = confineTarget("alias-dir/inside.txt");
    expect(c.ok, "junction trỏ VÀO TRONG workspace là hợp lệ — không được chặn").toBe(true);
    if (!c.ok) return;
    const rd = readConfined(c.target, 4096);
    expect(rd.ok).toBe(true);
    expect(rd.ok ? rd.content : null).toBe("INSIDE-OK-42");
  });
});
