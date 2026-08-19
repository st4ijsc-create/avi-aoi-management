/**
 * ★★★ doc 78 · PHA B — **LƯỚI ĐIỀU TRA DÂN SỐ CHO HỘP CÁT LỆNH.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẤT BIẾN ĐƯỢC PHÁT BIỂU Ở ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *     **Không tiến trình nào sinh ra từ tool này trừ khi argv của nó khớp CẤU TRÚC một mục trong
 *     danh sách TRẮNG; mọi lượt chạy có hạn giờ giết được CẢ CÂY; và không một bí mật nào của máy
 *     chủ đi vào môi trường của tiến trình con.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO HAI LỚP ĐƯỢC ĐO **RIÊNG** — ĐÂY LÀ CHỖ DỄ TỰ LỪA NHẤT CỦA PHA NÀY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `npm run check; rm -rf /` bị chặn ở **CẢ HAI** lớp (ký tự `;` ở lớp 1, sai cấu trúc argv ở lớp
 * 2). Nếu lưới chỉ đo qua bề mặt ngoài (`tool.execute({command: "..."})`) thì:
 *   • gỡ lớp 2 ⇒ lớp 1 vẫn chặn ⇒ **lưới XANH với một danh sách trắng khớp-tiền-tố**;
 *   • gỡ lớp 1 ⇒ lớp 2 vẫn chặn ⇒ **lưới XANH với mọi ký tự shell được nhận**.
 * Tức một lưới "đo từ ngoài" **không chứng minh được lớp nào đang làm việc**, đúng lớp lỗi
 * *"xanh nhờ nhánh sai"* mà pha A đã dính (junction và hard link dùng chung inode).
 * ⇒ §B đo `tachArgv` một mình, §C đo `phanQuyetLenh` một mình **trên argv đã tách** (tức đã đi
 *   vòng qua lớp 1). Mỗi đột biến vì thế đỏ được ĐỘC LẬP.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ §F CHẠY THẬT, VÀ NÓ CÓ **ĐỐI CHỨNG ÂM**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ca "hạn giờ giết được cây" sẽ XANH **kể cả khi phép giết cây không tồn tại**, nếu tiến trình
 * cháu tình cờ chết theo cha (nó không chết theo cha trên Windows, nhưng một lưới không được xanh
 * vì niềm tin ấy). Vì thế §F có một **ĐỐI CHỨNG ÂM** chạy đúng kịch bản với một phép giết YẾU
 * (`child.kill()` — đúng một PID) và đòi tiến trình cháu **CÒN SỐNG**. Không có đối chứng ấy thì
 * ca dương không phát biểu gì.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { spawn } from "node:child_process";

// ── HITL: `executeDecision` nhập TĨNH `proposeAction`. Thay bằng bản giả để đo đường đi mà không
//    phải dựng DB. Đây là **điểm dispatch THẬT**, không phải một bản sao của nó.
const proposeActionMock = vi.fn();
vi.mock("../aiCopilotActions", () => ({
  proposeAction: (...a: unknown[]) => proposeActionMock(...a),
}));

import "./index"; // đăng ký TOÀN BỘ tool (side-effect)
import { executeDecision } from "./index";
import { listTools, type Tool } from "./toolRegistry";
import {
  AN_HAN_SAU_GIET_MS,
  BIEN_MOI_TRUONG_CHO_PHEP,
  BoDemDauRa,
  DANH_SACH_TRANG,
  HAN_GIO_TOI_DA_MS,
  MA_TU_CHOI_LENH,
  TRAN_DAU_RA_CUOI,
  TRAN_DAU_RA_DAU,
  chayLenhTrongHopCat,
  gietCayTienTrinh,
  hanGioThucTe,
  moiTruongDaLoc,
  phanQuyetLenh,
  tachArgv,
} from "./repoCommandSandbox";
import { xoaSoNganSach } from "./repoSandbox";

const GOC_REPO = path.resolve(process.cwd());
const BIT = "ai_repo_exec";
const CTX = { user: { id: 7, role: "engineer", name: "T" }, lang: "vi" as const };

/** Tập tool suy từ **SỔ ĐĂNG KÝ SỐNG**, không chép tay — một tool mới gắn bit này tự rơi vào lưới. */
function toolChayLenh(): Tool<any, any>[] {
  return listTools().filter((t) => t.requiredPermission?.module === BIT);
}

beforeEach(() => {
  proposeActionMock.mockReset();
  xoaSoNganSach();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — CẦU CHÌ: lưới đang quét vật thật", () => {
  it("★ sổ đăng ký SỐNG có ĐÚNG MỘT tool đứng sau `ai_repo_exec` (một tool MỚI phải được thấy một lần)", () => {
    const ten = toolChayLenh().map((t) => t.name).sort();
    expect(
      ten,
      "một tool MỚI gắn bit `ai_repo_exec` là một CỬA MỚI để sinh tiến trình trên máy chủ. Đọc lưới " +
        "này, chứng minh nó đi qua `tachArgv` + `phanQuyetLenh`, rồi mới thêm tên vào đây.",
    ).toEqual(["run_command"]);
  });

  it("★★★ nó là WRITE TOOL và **KHÔNG có `handler`** — hai vế của cùng một bất biến HITL", () => {
    const t = toolChayLenh()[0]!;
    expect(t.kind, "kind:'write' là cách DUY NHẤT trong kiến trúc này để bắt buộc có người bấm duyệt").toBe("write");
    expect(typeof t.preview).toBe("function");
    expect(typeof t.execute).toBe("function");
    expect(typeof t.summarize).toBe("function");
    expect(t.requiredPermission).toEqual({ module: "ai_repo_exec", action: "canCreate" });
    /**
     * ⚠ Vắng `handler` là một **cầu chì THỨ HAI** cho HITL: ai đổi `kind` sang `"read"` để "cho
     * nhanh" sẽ không có gì chạy được cả (`executeDecision` trả `READ_TOOL_MISSING_HANDLER`), thay
     * vì lặng lẽ chạy lệnh không cần duyệt.
     */
    expect(typeof t.handler, "read-handler tồn tại = có một đường chạy KHÔNG qua HITL").toBe("undefined");
  });

  it("★ bit RBAC của nó KHÁC bit đọc mã nguồn của pha A", () => {
    // ⚠ 2026-08-19 (doc 78 PHA C): lọc theo action `canView` — pha C (`apply_diff`) đứng sau CÙNG
    //   module `ai_repo_read` nhưng action `canEdit` (ghi tệp). Câu khẳng định ở đây là về ba tool
    //   ĐỌC của pha A, nên nó ghim theo action đọc, không theo cả module.
    const doc = listTools()
      .filter((t) => t.requiredPermission?.module === "ai_repo_read" && t.requiredPermission?.action === "canView")
      .map((t) => t.name)
      .sort();
    expect(doc, "pha A phải còn nguyên ba tool đọc").toEqual(["grep_repo", "list_files", "read_file"]);
    expect(doc).not.toContain("run_command");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§A — CẤU TRÚC của danh sách trắng (bất biến trên chính bảng, không phải trên hành vi)", () => {
  it("★ đúng CHÍN mục, và mỗi mục có hạn giờ dương ≤ trần hệ", () => {
    // ★ 2026-08-19 (doc 79 TRỤC 1 (D)) — BỐN mục MỚI cho vòng khép kín dự án thử: ba `dotnet` (build/
    //   test/format) cho C# và một `node --test` cho react/node. Mỗi mục vẫn là "subcommand cố định +
    //   một đường trong hộp cát"; xem khối lý lẽ ở `repoCommandSandbox.DANH_SACH_TRANG`.
    expect(DANH_SACH_TRANG.map((m) => m.nhan)).toEqual([
      "npm run check",
      "npm run check:tests",
      "npx vitest run <đường-dẫn>",
      "git status",
      "git diff",
      "dotnet build <đường-dẫn>",
      "dotnet test <đường-dẫn>",
      "dotnet format <đường-dẫn>",
      "node --test <đường-dẫn>",
    ]);
    for (const m of DANH_SACH_TRANG) {
      expect(m.hanGioMs, m.nhan).toBeGreaterThan(0);
      expect(m.hanGioMs, m.nhan).toBeLessThanOrEqual(HAN_GIO_TOI_DA_MS);
      expect(m.moTa.length, `${m.nhan} phải có mô tả cho người duyệt đọc`).toBeGreaterThan(20);
    }
  });

  it("★★★ MỌI ô TỰ DO đều có bộ phán quyết — một ô tự do không có người canh là một lỗ hộp cát", () => {
    for (const m of DANH_SACH_TRANG) {
      const soONull = m.khuon.filter((k) => k === null).length;
      expect(soONull, `${m.nhan}: nhiều nhất MỘT ô tự do (phép lấy ô dùng indexOf(null))`).toBeLessThanOrEqual(1);
      if (soONull === 1) {
        expect(
          typeof m.phanQuyetOTuDo,
          `${m.nhan} có ô TỰ DO nhưng KHÔNG khai bộ phán quyết ⇒ một byte do model viết đi thẳng vào argv`,
        ).toBe("function");
      }
    }
  });

  it("★★ KHÔNG mục nào HOÀN NGUYÊN/XOÁ mã HAY DỰNG LẠI SERVER ĐANG CHẠY — đọc bảng bằng chính bảng", () => {
    /**
     * ⚠ 2026-08-19 — bất biến ĐÚNG không phải "không có chữ build/test", mà là **"không lệnh nào hoàn
     * nguyên/xoá mã nguồn, cũng không lệnh nào dựng lại `dist/` của SERVER ĐANG PHỤC VỤ"**. `dotnet
     * build`/`dotnet test` dựng một app C# **RIÊNG** ở `sandbox-projects/` (không phá đồng hồ chẩn đoán
     * cổng 3000, không đụng `dist/index.js`) nên chúng ĐƯỢC PHÉP — đó chính là lý do (D) tồn tại. Cái
     * bị cấm tuyệt đối vẫn là: git hoàn nguyên/xoá, `rm`, và `npm run build` (dựng lại đúng server đang
     * chạy — xem khối "npm run build CỐ Ý KHÔNG CÓ" ở `repoCommandSandbox.ts`).
     */
    const camTuyetDoi = ["checkout", "reset", "restore", "clean", "rm", "revert", "push", "commit", "publish"];
    for (const m of DANH_SACH_TRANG) {
      for (const k of m.khuon) {
        if (k === null) continue;
        expect(camTuyetDoi, `"${k}" trong khuôn của ${m.nhan}`).not.toContain(k);
      }
    }
    // `npm run build` (dựng lại SERVER đang chạy) vẫn KHÔNG được có mặt dù `dotnet build` đã mở.
    expect(
      DANH_SACH_TRANG.some((m) => m.khuon.join(" ") === "npm run build"),
      "npm run build dựng lại chính server cổng 3000 ⇒ KHÔNG BAO GIỜ vào danh sách trắng",
    ).toBe(false);
  });

  it("★★ CHỐNG VÁ QUÁ TAY — bốn mục MỚI phân giải ra argv THẬT với ĐÚNG subcommand cố định", () => {
    const check = (lenh: string[], fileMatch: RegExp | string, argsDau: string[]) => {
      const r = phanQuyetLenh(lenh);
      expect(r.ok, `${lenh.join(" ")} PHẢI chạy được`).toBe(true);
      if (!r.ok) return;
      if (typeof fileMatch === "string") expect(r.spec.file).toBe(fileMatch);
      else expect(r.spec.file).toMatch(fileMatch);
      expect(r.spec.args.slice(0, argsDau.length)).toEqual(argsDau);
    };
    // dotnet phân giải qua PATH ("dotnet"); node --test qua process.execPath.
    check(["dotnet", "build", "sandbox-projects/csharp-demo/CalculatorDemo.sln"], "dotnet", ["build", "sandbox-projects/csharp-demo/CalculatorDemo.sln", "--no-restore"]);
    check(["dotnet", "test", "sandbox-projects/csharp-demo"], "dotnet", ["test", "sandbox-projects/csharp-demo", "--no-restore"]);
    check(["dotnet", "format", "sandbox-projects/csharp-demo/src"], "dotnet", ["format", "sandbox-projects/csharp-demo/src"]);
    check(["node", "--test", "sandbox-projects/react-pg-demo/test/validate.test.mjs"], process.execPath, ["--test", "sandbox-projects/react-pg-demo/test/validate.test.mjs"]);
  });

  it("★★★ `--` rồi lệnh tuỳ ý, và `node <script>` (KHÔNG --test) ⇒ CMD_NOT_ALLOWED", () => {
    for (const argv of [
      ["dotnet", "build", "--", "rm", "-rf", "/"],
      ["dotnet", "--", "rm", "-rf"],
      ["dotnet", "run", "sandbox-projects/csharp-demo"],
      ["dotnet", "nuget", "push", "x.nupkg"],
      ["node", "evil.mjs"],
      ["node", "sandbox-projects/react-pg-demo/src/server.mjs"],
      ["node", "-e", "process.exit(0)"],
      ["node", "--experimental-vm-modules", "x.mjs"],
    ]) {
      const r = phanQuyetLenh(argv);
      expect(r.ok, `${JSON.stringify(argv)} phải bị từ chối`).toBe(false);
      if (!r.ok) expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    }
  });

  it("★★★ đường NGOÀI hộp cát cho dotnet/node ⇒ CMD_ARG_PATH_REJECTED (không tiến trình nào)", () => {
    for (const argv of [
      ["dotnet", "build", "../../etc/passwd"],
      ["dotnet", "test", "/etc/passwd"],
      ["dotnet", "format", "C:/Windows/System32"],
      ["dotnet", "build", ".env"],
      ["node", "--test", "../../../secret.mjs"],
      ["node", "--test", "node_modules/x.test.mjs"],
      ["node", "--test", ".git/config"],
    ]) {
      const r = phanQuyetLenh(argv);
      expect(r.ok, `${JSON.stringify(argv)} phải bị từ chối`).toBe(false);
      if (!r.ok) expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§B — LỚP 1 MỘT MÌNH: `tachArgv` chặn theo DANH SÁCH TRẮNG KÝ TỰ", () => {
  const bẩn: Array<[string, string]> = [
    ["npm run check; rm -rf /", "dấu chấm phẩy"],
    ["npm run check && rm -rf /", "&&"],
    ["npm run check || rm -rf /", "||"],
    ["npm run check | tee out.txt", "ống dẫn"],
    ["npm run check > out.txt", "chuyển hướng ra"],
    ["npm run check < in.txt", "chuyển hướng vào"],
    ["npm run check &", "chạy nền"],
    ["npm run $(whoami)", "thay thế lệnh $( )"],
    ["npm run `whoami`", "thay thế lệnh dấu huyền"],
    ["npm run %USERNAME%", "biến cmd.exe"],
    ["npm run check\nrm -rf /", "xuống dòng"],
    ["npm run check\trm", "tab"],
    ['npm run "check"', "dấu nháy kép"],
    ["npm run 'check'", "dấu nháy đơn"],
    ["npm run check*", "ký tự đại diện"],
    ["npm run check\u0000", "NUL"],
  ];

  for (const [lenh, ten] of bẩn) {
    it(`★★★ ${ten} ⇒ CMD_METACHAR (và KHÔNG có tiến trình nào)`, () => {
      const r = tachArgv(lenh);
      expect(r.ok, `"${lenh}" phải bị chặn ở LỚP 1`).toBe(false);
      if (!r.ok) expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_METACHAR);
    });
  }

  it("★ đầu vào KHÔNG phải chuỗi / rỗng / quá dài ⇒ chặn", () => {
    for (const x of [null, undefined, 42, {}, [], "", "   "]) {
      expect(tachArgv(x as unknown).ok).toBe(false);
    }
    expect(tachArgv("a".repeat(1000)).ok).toBe(false);
  });

  it("★★ CHỐNG VÁ QUÁ TAY — năm lệnh hợp lệ vẫn TÁCH ĐƯỢC, kể cả `check:tests` và đường dẫn có dấu /", () => {
    expect(tachArgv("npm run check")).toEqual({ ok: true, argv: ["npm", "run", "check"] });
    expect(tachArgv("npm run check:tests")).toEqual({ ok: true, argv: ["npm", "run", "check:tests"] });
    expect(tachArgv("git status")).toEqual({ ok: true, argv: ["git", "status"] });
    expect(tachArgv("git diff")).toEqual({ ok: true, argv: ["git", "diff"] });
    expect(tachArgv("  npx   vitest   run   server/services/a-b.test.ts  ")).toEqual({
      ok: true,
      argv: ["npx", "vitest", "run", "server/services/a-b.test.ts"],
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§C — LỚP 2 MỘT MÌNH: `phanQuyetLenh` khớp CẤU TRÚC trên argv ĐÃ TÁCH", () => {
  /**
   * ⚠⚠ Mọi ca dưới đây **đi vòng qua lớp 1** (truyền thẳng mảng argv). Đó là điểm: chúng đo được
   * lớp 2 kể cả khi lớp 1 bị gỡ sạch. Một lưới chỉ gọi `tool.execute({command})` **không** làm được.
   */
  const ngoaiDanhSach: Array<[string[], string]> = [
    [["npm", "run", "check;", "rm", "-rf", "/"], "chuỗi nối đã lọt qua khe lớp 1"],
    [["npm", "run", "check", "&&", "rm", "-rf", "/"], "nối bằng && dưới dạng argv rời"],
    [["npm", "run", "check", "--", "extra"], "đuôi thừa sau một tiền tố HỢP LỆ"],
    [["npm", "run", "build"], "npm run build — CỐ Ý ngoài danh sách trắng ở lượt đầu"],
    [["npm", "run", "dev"], "script khác trong package.json"],
    [["npm", "install"], "npm install"],
    [["git", "checkout", "server/x.ts"], "★ ĐÚNG LỆNH ĐÃ XOÁ 123 DÒNG NGÀY 2026-08-18"],
    [["git", "checkout", "."], "git checkout ."],
    [["git", "reset", "--hard"], "git reset --hard"],
    [["git", "clean", "-fd"], "git clean"],
    [["git", "push"], "git push"],
    [["git", "commit", "-m", "x"], "git commit"],
    [["rm", "-rf", "/"], "rm"],
    [["npx", "vitest", "run"], "thiếu ĐƯỜNG DẪN ⇒ chạy cả bộ 12.777 ca"],
    [["npx", "vitest"], "npx vitest trần"],
    [["npx", "tsc"], "npx tsc — brief cấm gọi thẳng (hết heap 4 GB)"],
    [["node", "-e", "process.exit(0)"], "node -e"],
    [["NPM", "run", "check"], "khác HOA/thường ⇒ khác lệnh"],
    [["npm", "Run", "check"], "khác HOA/thường ở giữa"],
    [[], "argv rỗng"],
  ];

  for (const [argv, ten] of ngoaiDanhSach) {
    it(`★★★ ${ten} ⇒ CMD_NOT_ALLOWED`, () => {
      const r = phanQuyetLenh(argv);
      expect(r.ok, `${JSON.stringify(argv)} phải bị LỚP 2 từ chối`).toBe(false);
      if (!r.ok) expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    });
  }

  it("★★ CHỐNG VÁ QUÁ TAY — bốn lệnh không-đối-số vẫn ĐƯỢC PHÉP và phân giải ra argv THẬT", () => {
    for (const argv of [["npm", "run", "check"], ["npm", "run", "check:tests"], ["git", "status"], ["git", "diff"]]) {
      const r = phanQuyetLenh(argv);
      expect(r.ok, `${argv.join(" ")} PHẢI chạy được — một bản vá "chặn tất cả" cũng xanh nếu thiếu ca này`).toBe(true);
      if (r.ok) {
        expect(r.spec.file.length).toBeGreaterThan(0);
        expect(r.hanGioMs).toBeGreaterThan(0);
      }
    }
  });

  it("★★ `npm run …` phân giải qua `node <npm-cli.js>` — KHÔNG qua `npm.cmd`, KHÔNG qua shell", () => {
    const r = phanQuyetLenh(["npm", "run", "check"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.file, "tệp chạy phải là chính node đang chạy").toBe(process.execPath);
    expect(r.spec.args[0]).toMatch(/npm-cli\.js$/);
    expect(r.spec.args.slice(1)).toEqual(["run", "check"]);
    // ⚠ Node ≥20 TỪ CHỐI spawn `.cmd/.bat` khi không có shell (CVE-2024-27980) — nếu ai đó "sửa"
    //   chỗ này thành `npm`/`npm.cmd` thì hoặc lượt chạy chết ENOENT/EINVAL, hoặc phải bật shell.
    expect(r.spec.file.toLowerCase()).not.toMatch(/\.(cmd|bat)$/);
  });

  it("★★★ LƯỚI-CHO-LƯỚI: một bộ khớp TIỀN TỐ (thứ lớp 2 KHÔNG được là) sẽ NHẬN đúng lệnh tiêm", () => {
    /**
     * Đây là phép chứng minh rằng ca ở trên **không rỗng**: nó dựng chính cái vị từ sai mà brief
     * cảnh báo (`startsWith`) và đo rằng nó CHO QUA `npm run check; rm -rf /`, trong khi vị từ thật
     * TỪ CHỐI. Không có ca này thì "khớp cấu trúc" chỉ là một lời khai.
     */
    const khopTienTo = (lenh: string) =>
      ["npm run check", "npm run check:tests", "npx vitest run", "git status", "git diff"].some((p) => lenh.startsWith(p));
    const tiem = "npm run check; rm -rf /";
    expect(khopTienTo(tiem), "bộ khớp tiền tố CHO QUA lệnh tiêm — đó là lý do nó không được dùng").toBe(true);
    expect(phanQuyetLenh(tiem.split(" ")).ok, "vị từ THẬT phải TỪ CHỐI").toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§D — Ô TỰ DO của `npx vitest run` đi qua `phanQuyetDuongDan()` CỦA PHA A", () => {
  const xau = [
    "../../../etc/passwd",
    "..",
    "server/../../ngoai/x.test.ts",
    "/etc/passwd",
    "C:/Windows/System32/x.ts",
    "server/C:/x.ts",
    ".env",
    ".env.bak-2026",
    "server/id_rsa",
    "node_modules/vitest/x.ts",
    ".git/config",
    "dist/index.js",
    "client/dist/bundle.js",
    "knowledge/embeddings.jsonl",
  ];

  for (const p of xau) {
    it(`★★★ "${p}" ⇒ CMD_ARG_PATH_REJECTED (không tiến trình nào được sinh)`, () => {
      const r = phanQuyetLenh(["npx", "vitest", "run", p]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    });
  }

  it("★★ CHỐNG VÁ QUÁ TAY — đường dẫn HỢP LỆ (tệp VÀ thư mục) vẫn qua được", () => {
    for (const p of [
      "server/services/aiLocalTools/repoCommand.census.test.ts",
      "server/services/aiLocalTools",
      "shared",
      "server\\services\\aiLocalTools",
    ]) {
      const r = phanQuyetLenh(["npx", "vitest", "run", p]);
      expect(r.ok, `"${p}" PHẢI chạy được — chặn cả thư mục là giết đúng cách dùng chính`).toBe(true);
      if (r.ok) {
        expect(r.spec.file).toBe(process.execPath);
        expect(r.spec.args[0]).toMatch(/vitest\.mjs$/);
        expect(r.spec.args.slice(1)).toEqual(["run", p]);
      }
    }
  });

  it("★ đường dẫn TỰ DO đi vào argv **NGUYÊN VĂN**, không ghép chuỗi ở đâu", () => {
    const r = phanQuyetLenh(["npx", "vitest", "run", "server/x.test.ts"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.args).toEqual([r.spec.args[0], "run", "server/x.test.ts"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§E — HẠN GIỜ: kẹp hai đầu, người gọi HẠ được, KHÔNG NÂNG được", () => {
  it("★★★ yêu cầu LỚN hơn trần của mục ⇒ vẫn là trần của mục (gỡ phép kẹp ⇒ ĐỎ)", () => {
    expect(hanGioThucTe(20_000, 999_999_999)).toBe(20_000);
    expect(hanGioThucTe(20_000, HAN_GIO_TOI_DA_MS)).toBe(20_000);
    expect(hanGioThucTe(HAN_GIO_TOI_DA_MS * 10, undefined)).toBe(HAN_GIO_TOI_DA_MS);
  });

  it("★ yêu cầu NHỎ hơn ⇒ được tôn trọng; đầu vào méo ⇒ rơi về trần của mục", () => {
    expect(hanGioThucTe(240_000, 5_000)).toBe(5_000);
    expect(hanGioThucTe(240_000, Number.NaN)).toBe(240_000);
    expect(hanGioThucTe(240_000, Number.POSITIVE_INFINITY)).toBe(240_000);
    expect(hanGioThucTe(240_000, -1)).toBe(1_000); // kẹp về SÀN, không thành 0/âm
  });

  it("★ mọi mục danh sách trắng đều có hạn giờ HỮU HẠN (không mục nào 0/Infinity)", () => {
    for (const m of DANH_SACH_TRANG) {
      expect(Number.isFinite(m.hanGioMs), m.nhan).toBe(true);
      expect(hanGioThucTe(m.hanGioMs), m.nhan).toBeGreaterThan(0);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §F — CHẠY THẬT: hạn giờ, GIẾT CẢ CÂY, và ĐỐI CHỨNG ÂM
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Kịch bản: cha in PID của CHÁU rồi cả hai ngủ 10 phút. Cháu `stdio:"ignore"` ⇒ không giữ pipe cha.
 *
 * ★★★ **`detached: true` Ở CHÁU LÀ BẮT BUỘC, VÀ ĐÂY LÀ MỘT PHÉP ĐO CHỨ KHÔNG PHẢI MỘT LỰA CHỌN.**
 *
 * Bản đầu của lưới này dùng cháu **KHÔNG** detached. Kết quả đo trên đúng máy này (Windows 11,
 * Node 24.18):
 *
 *   | cháu           | phép giết                    | cháu còn sống sau 2 s |
 *   |----------------|------------------------------|-----------------------|
 *   | THƯỜNG         | `child.kill()` (một PID)     | **KHÔNG**             |
 *   | THƯỜNG         | `taskkill /F` (KHÔNG `/T`)   | **KHÔNG**             |
 *   | **detached**   | `child.kill()` (một PID)     | **CÒN**               |
 *   | **detached**   | `taskkill /F` (KHÔNG `/T`)   | **CÒN**               |
 *
 * Nghĩa là: với cháu thường, **cháu chết theo cha dù không ai giết cây** — nên ca dương *"hạn giờ
 * giết được cây"* sẽ XANH kể cả khi `gietCayTienTrinh()` bị xoá sạch. Nó xanh **nhờ một nhánh
 * khác**, đúng lớp lỗi đã đo ở pha A (junction + hard link dùng chung inode ⇒ ca xanh nhờ phép
 * kiểm `nlink`, không nhờ phép kiểm realpath).
 * ⇒ Kịch bản phải dựng một tiến trình cháu **thật sự sống sót qua cái chết của cha**. `detached`
 *   làm đúng việc ấy, và nó cũng chính là hình dạng NGUY HIỂM nhất ngoài đời (một tiến trình con
 *   tự tách ra thì chỉ `taskkill /T` / `kill(-pgid)` mới với tới).
 */
const KICH_BAN_CHA_CHAU =
  'const cp=require("child_process");' +
  'const g=cp.spawn(process.execPath,["-e","setTimeout(()=>{},600000)"],{stdio:"ignore",detached:true});' +
  "g.unref();" +
  'console.log("CHAU="+g.pid);' +
  "setTimeout(()=>{},600000);";

function conSong(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function choChet(pid: number, hanMs: number): Promise<boolean> {
  const het = Date.now() + hanMs;
  while (Date.now() < het) {
    if (!conSong(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !conSong(pid);
}

function docPidChau(dauRa: string): number {
  const m = /CHAU=(\d+)/.exec(dauRa);
  expect(m, `không đọc được PID cháu từ đầu ra: ${JSON.stringify(dauRa.slice(0, 400))}`).not.toBeNull();
  return Number(m![1]);
}

describe("§F — CHẠY THẬT: hạn giờ giết CẢ CÂY tiến trình", () => {
  const donDep: number[] = [];

  /**
   * ⚠⚠ **DỌN BẰNG ĐÚNG PHÉP GIẾT CÂY, KHÔNG BẰNG `process.kill`.** Đo được trong lượt chạy đột
   * biến M4b: một tiến trình cháu `detached` **sống sót qua cả `afterAll`** và còn lại trên máy
   * (`Get-CimInstance Win32_Process` bắt được pid 36372 sau khi lưới đã kết thúc). Một lưới để lại
   * rác tiến trình trên máy có 16 instance `node` chồng nhau là một lưới đang gây ra đúng vấn đề
   * mà nó được viết ra để canh.
   * ⇒ Dùng `gietCayTienTrinh()` (taskkill /T /F trên Windows) + `process.kill` làm lớp thứ hai.
   */
  afterAll(() => {
    for (const pid of donDep) {
      gietCayTienTrinh(pid);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* đã chết rồi thì thôi */
      }
    }
  });

  it("★★★ quá hạn ⇒ trả về ĐÚNG HẠN, khai `CMD_TIMEOUT`, và **TIẾN TRÌNH CHÁU CHẾT**", async () => {
    const kq = await chayLenhTrongHopCat(
      { file: process.execPath, args: ["-e", KICH_BAN_CHA_CHAU] },
      { hanGioMs: 2_500, goc: GOC_REPO },
    );
    expect(kq.hetGio, "phải khai là hết giờ").toBe(true);
    expect(kq.ma).toBe(MA_TU_CHOI_LENH.CMD_TIMEOUT);
    expect(kq.giet, "phải ĐÃ RA LỆNH giết cây").toBe("da-ra-lenh");
    // Không treo: 2,5 s hạn + ân hạn ⇒ phải xong sớm hơn nhiều so với 10 phút của kịch bản.
    expect(kq.msChay).toBeLessThan(2_500 + AN_HAN_SAU_GIET_MS + 5_000);

    const pidChau = docPidChau(kq.dauRa);
    donDep.push(pidChau);
    const chet = await choChet(pidChau, 8_000);
    expect(
      chet,
      `TIẾN TRÌNH CHÁU (pid ${pidChau}) VẪN SỐNG sau khi hạn giờ nổ. Hạn giờ chỉ giết được tiến ` +
        "trình CHA ⇒ `npm run build`/`npm run check` treo sẽ để lại tiến trình cháu chạy mãi.",
    ).toBe(true);
  }, 30_000);

  it("★★★ ĐỐI CHỨNG ÂM — cùng kịch bản, giết YẾU (một PID) ⇒ cháu **CÒN SỐNG** (nếu ca này đỏ thì ca trên vô nghĩa)", async () => {
    const pidChau = await new Promise<number>((giaiQuyet, tuChoi) => {
      const con = spawn(process.execPath, ["-e", KICH_BAN_CHA_CHAU], {
        cwd: GOC_REPO,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let ra = "";
      con.stdout.setEncoding("utf8");
      con.stdout.on("data", (c: string) => {
        ra += c;
        const m = /CHAU=(\d+)/.exec(ra);
        if (m) {
          // ⚠ Giết YẾU: đúng một PID, đúng thứ `child.kill()` làm — KHÔNG phải `gietCayTienTrinh`.
          con.kill();
          giaiQuyet(Number(m[1]));
        }
      });
      con.on("error", tuChoi);
      setTimeout(() => tuChoi(new Error("cha không in ra PID cháu")), 15_000);
    });
    donDep.push(pidChau);

    await new Promise((r) => setTimeout(r, 1_500));
    expect(
      conSong(pidChau),
      "cháu chết theo cha ngay cả khi KHÔNG giết cây ⇒ kịch bản này KHÔNG đo được phép giết cây, " +
        "và ca dương ở trên đang xanh vì lý do sai. Phải đổi kịch bản, KHÔNG được xoá ca này.",
    ).toBe(true);
    try {
      process.kill(pidChau, "SIGKILL");
    } catch {
      /* dọn */
    }
  }, 30_000);

  it("★★ CHỐNG VÁ QUÁ TAY — một lệnh THẬT trong danh sách trắng vẫn chạy xong và trả MÃ THOÁT THẬT", async () => {
    const pq = phanQuyetLenh(["git", "status"], GOC_REPO);
    expect(pq.ok).toBe(true);
    if (!pq.ok) return;
    const kq = await chayLenhTrongHopCat(pq.spec, { hanGioMs: pq.hanGioMs, goc: GOC_REPO });
    expect(kq.hetGio, "git status không được hết giờ").toBe(false);
    expect(kq.ma, "lượt chạy bình thường KHÔNG mang mã lỗi").toBeNull();
    expect(kq.maThoat, "git status trên một repo hợp lệ thoát 0").toBe(0);
    expect(kq.dauRa.length, "phải có đầu ra THẬT").toBeGreaterThan(0);
  }, 30_000);

  it("★ tệp chạy KHÔNG TỒN TẠI ⇒ `CMD_SPAWN_ERROR`, không ném, không treo", async () => {
    const kq = await chayLenhTrongHopCat(
      { file: path.join(GOC_REPO, "khong-he-ton-tai-2026.exe"), args: [] },
      { hanGioMs: 5_000, goc: GOC_REPO },
    );
    expect(kq.ma).toBe(MA_TU_CHOI_LENH.CMD_SPAWN_ERROR);
    expect(kq.ok).toBe(false);
  }, 20_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§G — MÔI TRƯỜNG: tiến trình con KHÔNG thừa kế bí mật của máy chủ", () => {
  const CANARY = "PHA-B-CANARY-3f9c21ad";
  const BIEN_BI_MAT = ["DATABASE_URL", "MASTER_API_KEY", "ANH_KY_SECRET", "SESSION_SECRET", "JWT_SECRET"];

  it("★★★ phép lọc BỎ mọi biến ứng dụng và GIỮ đúng biến hệ điều hành", () => {
    const nguon: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      DATABASE_URL: `postgres://u:${CANARY}@h/db`,
      MASTER_API_KEY: CANARY,
      ANH_KY_SECRET: CANARY,
      NODE_ENV: "production",
      AI_REPO_SANDBOX_ROOT: "/x",
      LANG: "vi_VN.UTF-8",
    };
    const ra = moiTruongDaLoc(nguon);
    for (const k of ["DATABASE_URL", "MASTER_API_KEY", "ANH_KY_SECRET", "NODE_ENV", "AI_REPO_SANDBOX_ROOT"]) {
      expect(ra[k], `"${k}" KHÔNG được đi vào môi trường con`).toBeUndefined();
    }
    expect(ra.PATH).toBe("/usr/bin");
    expect(ra.LANG).toBe("vi_VN.UTF-8");
    expect(ra.npm_config_offline, "npm phải bị tắt đường ra mạng").toBe("true");
    expect(JSON.stringify(ra), "KHÔNG một byte canary nào sống sót qua phép lọc").not.toContain(CANARY);
  });

  it("★★ so tên biến KHÔNG phân biệt HOA/thường (Windows để `Path`, POSIX để `PATH`)", () => {
    expect(moiTruongDaLoc({ Path: "C:\\x" }).Path).toBe("C:\\x");
    expect(moiTruongDaLoc({ SystemRoot: "C:\\Windows" }).SystemRoot).toBe("C:\\Windows");
  });

  it("★ danh sách trắng tên biến KHÔNG chứa một cái tên nào nghe như bí mật", () => {
    for (const ten of BIEN_MOI_TRUONG_CHO_PHEP) {
      expect(/SECRET|TOKEN|KEY|PASSWORD|DATABASE|API/i.test(ten), `"${ten}" không được nằm trong danh sách trắng`).toBe(false);
    }
    for (const bm of BIEN_BI_MAT) {
      expect(BIEN_MOI_TRUONG_CHO_PHEP.map((s) => s.toUpperCase())).not.toContain(bm);
    }
  });

  it("★★★ CHẠY THẬT — một tiến trình con IN CẢ `process.env` ra vẫn KHÔNG lộ canary", async () => {
    const cu = process.env.MASTER_API_KEY;
    process.env.MASTER_API_KEY = CANARY;
    try {
      const kq = await chayLenhTrongHopCat(
        { file: process.execPath, args: ["-e", "console.log(JSON.stringify(process.env))"] },
        { hanGioMs: 15_000, goc: GOC_REPO },
      );
      expect(kq.maThoat).toBe(0);
      expect(kq.dauRa.length, "tiến trình con PHẢI in ra thứ gì đó, nếu không ca này là chân lý rỗng").toBeGreaterThan(10);
      expect(kq.dauRa, "CANARY đã rời máy chủ qua môi trường tiến trình con").not.toContain(CANARY);
      expect(kq.dauRa, "MASTER_API_KEY không được có mặt dù với giá trị nào").not.toContain("MASTER_API_KEY");
    } finally {
      if (cu === undefined) delete process.env.MASTER_API_KEY;
      else process.env.MASTER_API_KEY = cu;
    }
  }, 30_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§H — TRẦN ĐẦU RA: giữ ĐẦU + CUỐI, và KHAI phần bỏ giữa", () => {
  it("★ đầu ra nhỏ ⇒ nguyên vẹn, không cắt, không khai nhầm", () => {
    const b = new BoDemDauRa(10, 10);
    b.them("abcde");
    expect(b.ket()).toEqual({ text: "abcde", boQua: 0 });
    expect(b.catBot).toBe(false);
    expect(b.byteThat).toBe(5);
  });

  it("★★ vừa đủ ĐẦU+CUỐI ⇒ ghép không TRÙNG LẶP và không MẤT byte", () => {
    const b = new BoDemDauRa(4, 4);
    b.them("0123456789".slice(0, 8)); // "01234567"
    const { text, boQua } = b.ket();
    expect(boQua).toBe(0);
    expect(text).toBe("01234567");
  });

  it("★★★ vượt trần ⇒ giữ ĐẦU và CUỐI, và số byte bỏ giữa được KHAI ĐÚNG", () => {
    const b = new BoDemDauRa(4, 4);
    b.them("A".repeat(4) + "M".repeat(20) + "Z".repeat(4));
    const { text, boQua } = b.ket();
    expect(b.byteThat).toBe(28);
    expect(b.catBot).toBe(true);
    expect(boQua).toBe(20);
    expect(text.startsWith("AAAA")).toBe(true);
    expect(text.endsWith("ZZZZ")).toBe(true);
    expect(text).toContain("ĐÃ CẮT 20 byte Ở GIỮA");
  });

  it("★★ CHẠY THẬT — một lệnh in RẤT nhiều vẫn bị chặn ở trần, và bộ nhớ không phình theo đầu ra", async () => {
    const kq = await chayLenhTrongHopCat(
      { file: process.execPath, args: ["-e", 'for(let i=0;i<40000;i++)console.log("DONG-"+i+"-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")'] },
      { hanGioMs: 60_000, goc: GOC_REPO },
    );
    expect(kq.maThoat).toBe(0);
    expect(kq.byteThat, "phải ĐO được tổng byte THẬT, không chỉ phần giữ lại").toBeGreaterThan(1_000_000);
    expect(kq.catBot).toBe(true);
    expect(kq.dauRa.length, "phần đem ra khỏi hộp cát phải ≤ trần + một dòng khai").toBeLessThan(TRAN_DAU_RA_DAU + TRAN_DAU_RA_CUOI + 200);
    expect(kq.dauRa).toContain("DONG-0-");
    expect(kq.dauRa).toContain("DONG-39999-");
    expect(kq.dauRa).toContain("Ở GIỮA");
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§I — HITL: `executeDecision` KHÔNG BAO GIỜ chạy tool này, nó chỉ ĐỀ XUẤT", () => {
  it("★★★ một quyết định gọi `run_command` ⇒ ra `pendingAction`, KHÔNG ra `result` (gỡ HITL ⇒ ĐỎ)", async () => {
    proposeActionMock.mockResolvedValue({ ok: true, pendingAction: { id: "gia-lap", tool: "run_command" } });
    const ra = await executeDecision({ tool: "run_command", args: { command: "npm run check" } }, CTX);
    expect(proposeActionMock, "phải đi qua đường ĐỀ XUẤT của aiCopilotActions").toHaveBeenCalledTimes(1);
    expect(ra.pendingAction).toEqual({ id: "gia-lap", tool: "run_command" });
    expect(ra.result, "một write tool KHÔNG được trả kết quả ngay — đó là định nghĩa của HITL").toBeNull();
    expect(ra.error).toBeUndefined();
    // Và tool THẬT được đưa cho proposeAction (không phải một tên chuỗi).
    expect(proposeActionMock.mock.calls[0]![0]).toMatchObject({ name: "run_command", kind: "write" });
  });

  it("★★ KHÔNG có ngữ cảnh phiên ⇒ TỪ CHỐI, không chạy lén", async () => {
    const ra = await executeDecision({ tool: "run_command", args: { command: "npm run check" } }, undefined);
    expect(ra.error).toBe("WRITE_TOOL_REQUIRES_CONTEXT");
    expect(proposeActionMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §J — AST: `preview()` KHÔNG CHẠY LỆNH, và bộ chạy có ĐÚNG MỘT người gọi trong mã sản phẩm
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Quét bằng **AST**, không so chuỗi: docstring của `writeHandlers/repoCommand.ts` nhắc tên
 * `chayLenhTrongHopCat` nhiều lần, nên `git grep` sẽ báo oan — và một lưới kêu oan sẽ bị tắt đi.
 * Cùng phương pháp `programmingFileIo.census.test.ts`.
 */
const GOC_SERVER = path.resolve(__dirname, "..", "..");

function moiFileSanXuat(dir: string, ra: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
      moiFileSanXuat(p, ra);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) {
      ra.push(p);
    }
  }
  return ra;
}

function hamBaoNgoai(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if ((ts.isFunctionExpression(p) || ts.isArrowFunction(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) {
      return p.parent.name.text;
    }
    if ((ts.isFunctionExpression(p) || ts.isArrowFunction(p)) && ts.isPropertyAssignment(p.parent) && ts.isIdentifier(p.parent.name)) {
      return p.parent.name.text;
    }
  }
  return "<top-level>";
}

function diemGoi(ten: string): Array<{ file: string; dong: number; trongHam: string }> {
  const ra: Array<{ file: string; dong: number; trongHam: string }> = [];
  for (const file of moiFileSanXuat(GOC_SERVER)) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes(ten)) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const rel = path.relative(GOC_SERVER, file).split(path.sep).join("/");
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        const goi = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
        if (goi === ten) {
          ra.push({ file: rel, dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, trongHam: hamBaoNgoai(n) });
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return ra;
}

describe("§J — BẢN KIỂM ĐẾM ĐIỂM GỌI: ai được sinh tiến trình, và ở đâu", () => {
  it("★★★ `chayLenhTrongHopCat` chỉ được gọi ở HAI chỗ đã biết, và người viết phải thấy mỗi chỗ một lần", () => {
    /**
     * ★ 2026-08-19 (doc 78 PHA C) — ĐIỂM GỌI THỨ HAI: `repoGitStatus.ts [trangThaiGitCuaTep]`.
     *
     * Pha C cần hàng rào "tệp bẩn": `git status --porcelain -- <tệp>`. Lệnh này **CỐ ĐỊNH** (chỉ ô
     * `<tệp>` biến thiên, đã qua `phanQuyetDuongDan`+`confineTargetUnder` của người gọi), nên nó KHÔNG
     * đi qua danh sách trắng của `run_command` (danh sách ấy dành cho lệnh do MODEL chọn). Nó là một
     * lệnh CHỈ HỎI (không đổi byte nào của cây làm việc), gói trong ĐÚNG MỘT hàm để §J chỉ mọc thêm
     * một dòng. `repoCommand.ts [execute]` vẫn là điểm gọi cho lệnh model-chọn — vẫn qua
     * `tachArgv`+`phanQuyetLenh` TRƯỚC.
     */
    const dg = diemGoi("chayLenhTrongHopCat");
    expect(
      dg.map((d) => `${d.file} [${d.trongHam}]`).sort(),
      "một điểm gọi MỚI là một đường sinh tiến trình mới. Lệnh model-chọn phải qua `tachArgv` + " +
        "`phanQuyetLenh` TRƯỚC; lệnh cố định (git-status của pha C) phải nằm gọn trong một hàm.",
    ).toEqual([
      "services/aiLocalTools/repoGitStatus.ts [trangThaiGitCuaTep]",
      "services/aiLocalTools/writeHandlers/repoCommand.ts [execute]",
    ]);
  });

  it("★★★ `preview()` (`xemTruoc`) KHÔNG gọi bộ chạy — bài học C-1 của `programmingFile.ts`", () => {
    const dg = diemGoi("chayLenhTrongHopCat");
    for (const d of dg) {
      expect(
        d.trongHam,
        "`preview()` chạy TRƯỚC cổng HITL và kết quả của nó đi tới BA đích không cần ai xác nhận " +
          "(trả về Agent · ai_pending_actions.previewJson · sổ audit). Một `preview` chạy lệnh biến " +
          "HITL thành trang trí.",
      ).not.toBe("xemTruoc");
    }
  });

  /**
   * ★ 2026-08-19 (doc 79 · VÒNG TỰ ĐỘNG) — NGƯỜI PHÁN QUYẾT THỨ BA: `aiCodingVerify.ts
   * [laLenhKiemChung]`.
   *
   * ⚠⚠ ĐỌC KỸ TRƯỚC KHI COI ĐÂY LÀ "NỚI LƯỚI". Hai điều PHÂN BIỆT nó với một đường vòng:
   *   1. Nó **SIẾT**, không nới: sau khi `tachArgv` + `phanQuyetLenh` nói ĐƯỢC, nó còn hỏi thêm
   *      *"lệnh này có thuộc TẬP CON kiểm chứng không"* và từ chối `dotnet format` (mục DUY NHẤT
   *      trong danh sách trắng có GHI ĐÈ tệp) cùng `git status`/`git diff`. Một lệnh qua được ba
   *      lớp ở đây vẫn phải đi qua ĐÚNG `execute` (lớp 4+5) để chạy.
   *   2. Nó **KHÔNG sinh tiến trình**: ca đầu của §J (danh sách điểm gọi `chayLenhTrongHopCat`)
   *      vẫn CHỈ có hai mục, và `aiCodingVerify.ts` không nằm trong đó. Đó mới là bất biến thật —
   *      hai ca dưới đây chỉ đếm ai được PHÁN QUYẾT.
   * ⇒ Một điểm gọi thứ TƯ vẫn phải làm ca này ĐỎ và phải tự chứng minh như trên.
   */
  it("★★ `phanQuyetLenh` được gọi ở `preview`, `execute`, và cổng SIẾT của vòng tự động", () => {
    const trongHam = diemGoi("phanQuyetLenh").map((d) => d.trongHam).sort();
    expect(trongHam).toEqual(["execute", "laLenhKiemChung", "xemTruoc"]);
  });

  it("★★ `tachArgv` cũng vậy — lớp 1 không được bỏ qua ở đường execute", () => {
    const trongHam = diemGoi("tachArgv").map((d) => d.trongHam).sort();
    expect(trongHam).toEqual(["execute", "laLenhKiemChung", "xemTruoc"]);
  });

  /**
   * ★★★ VẾ THỨ HAI của lời khai trên, phát biểu thành phép đo RIÊNG: cổng siết của vòng tự động
   * **KHÔNG** được là một cửa sinh tiến trình thứ ba. Nếu ai đó cho `aiCodingVerify.ts` gọi thẳng
   * bộ chạy, ca đầu của §J đỏ — ca này nói rõ VÌ SAO nó phải đỏ, ngay tại chỗ.
   */
  it("★★★ cổng siết của vòng tự động KHÔNG sinh tiến trình (nó chỉ TỪ CHỐI hoặc chuyển tiếp)", () => {
    const files = diemGoi("chayLenhTrongHopCat").map((d) => d.file);
    expect(files).not.toContain("services/aiCodingVerify.ts");
  });
});
