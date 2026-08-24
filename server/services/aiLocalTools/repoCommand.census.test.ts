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
import os from "node:os";
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
// ★ 2026-08-20 (D) — chính sách "mục ghi đĩa có đòi bit thứ hai không" là HÀM THUẦN, cố ý tách khỏi
//   `checkPermission` để đo được cả hai chiều cờ mà không phải mock module / không phải chạm CSDL.
import { QUYEN_GHI_THEM, canDoiBitGhiThem, congGhiDiaBat } from "./writeHandlers/repoCommand";

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

  /**
   * ★★★ 2026-08-20 — **BẤT BIẾN CHƯA TỪNG ĐƯỢC PHÁT BIỂU Ở ĐÂU: "MẤY MỤC GHI VÀO CÂY LÀM VIỆC".**
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * VÌ SAO BA CA DƯỚI ĐÂY TỒN TẠI
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Trước lượt này, câu *"không mục nào ghi vào cây làm việc"* xuất hiện ở **bảy** docblock (kể cả
   * migration 0331 và dòng catalog quyền mà quản trị viên đọc lúc cấp bit) và **không lưới nào phát
   * biểu nó**. Nó SAI từ 2026-08-19 — `dotnet format <đường-dẫn>` ghi đè mọi `.cs` dưới đường được
   * trỏ — và vì không ai đo, cả bảy chỗ cùng mục trong im lặng suốt một ngày.
   *
   * ⇒ Ghim **dân số**, không ghim lời khai: nếu mục thứ hai có `ghiDia` xuất hiện (hoặc mục hiện tại
   *   biến mất), ca này ĐỎ và người thêm buộc phải đọc khối lý lẽ ở `MucDanhSachTrang.ghiDia` —
   *   nơi nói rõ mục `ghiDia` đi vòng CẢ BỐN hàng rào của `apply_diff`.
   *
   * ⚠ **HAI ô, KHÔNG PHẢI MỘT.** `dotnet build`/`dotnet test` sinh `bin/`+`obj/`; `npm run check`
   *   ghi `node_modules/typescript/tsbuildinfo` (`"incremental": true`). Đó là SẢN PHẨM DỰNG, không
   *   phải mã nguồn của người viết — gộp chung một cờ thì hoặc nó kêu oan cho `build` (người ta học
   *   cách bỏ qua cảnh báo), hoặc nó bào chữa cho `format` (*"lệnh nào chả ghi đĩa"*). Hai hậu quả
   *   NGƯỢC nhau ⇒ hai ô, hai dân số KHÁC nhau: **1/9** và **5/9**.
   */
  it("★★★ MỌI mục khai ĐỦ `ghiDia` + `sinhSanPhamDung` (thiếu một ô ⇒ tsc đỏ; khai sai kiểu ⇒ ca này đỏ)", () => {
    for (const m of DANH_SACH_TRANG) {
      expect(typeof m.ghiDia, `${m.nhan}: \`ghiDia\` phải là boolean, không được vắng`).toBe("boolean");
      expect(typeof m.sinhSanPhamDung, `${m.nhan}: \`sinhSanPhamDung\` phải là boolean`).toBe("boolean");
    }
  });

  it("★★★ ĐÚNG **1/9** mục GHI ĐÈ MÃ NGUỒN, và nó là `dotnet format` — dân số này đổi ⇒ ĐỎ", () => {
    const ghi = DANH_SACH_TRANG.filter((m) => m.ghiDia).map((m) => m.nhan);
    expect(
      ghi,
      "Danh sách các lệnh GHI ĐÈ TỆP MÃ NGUỒN vừa đổi. Một mục `ghiDia` đi vòng CẢ BỐN hàng rào của " +
        "`apply_diff` (không hỏi tệp bẩn · không băm chống TOCTOU · không diff để xem trước · không " +
        "hộp cát TỪNG TỆP) và nó đứng sau `ai_repo_exec/canCreate` chứ KHÔNG phải `ai_repo_read/canEdit`. " +
        "Trước khi sửa con số này: đọc khối `ghiDia` ở `MucDanhSachTrang`, thêm cảnh báo cho mục mới ở " +
        "`xemTruoc`, cập nhật dòng catalog `ai_repo_exec` (chữ quản trị viên đọc lúc cấp bit), và kiểm " +
        "lại `NHAN_KIEM_CHUNG` của vòng tự động có loại nó ra không.",
    ).toEqual(["dotnet format <đường-dẫn>"]);
    expect(DANH_SACH_TRANG.filter((m) => m.ghiDia).length, "đúng MỘT trên chín").toBe(1);
  });

  it("★★ `sinhSanPhamDung` là một trục KHÁC — 5/9, và KHÔNG mục nào bị gộp nhầm sang `ghiDia`", () => {
    const dung = DANH_SACH_TRANG.filter((m) => m.sinhSanPhamDung).map((m) => m.nhan);
    expect(
      dung,
      "SẢN PHẨM DỰNG (bin/ obj/ tsbuildinfo) KHÁC mã nguồn do người viết. `npm run check` có " +
        '`"incremental": true` ⇒ nó CÓ ghi tsbuildinfo; khai `false` là nói dối một cách tiện lợi.',
    ).toEqual([
      "npm run check",
      "npm run check:tests",
      "dotnet build <đường-dẫn>",
      "dotnet test <đường-dẫn>",
      "dotnet format <đường-dẫn>",
    ]);
    // ⚠ Vế NGƯỢC: "sinh sản phẩm dựng" KHÔNG được kéo theo "ghi đè mã nguồn". Nếu ai đó "đơn giản
    //   hoá" hai ô thành một, ca này đỏ.
    for (const m of DANH_SACH_TRANG) {
      if (m.sinhSanPhamDung && m.nhan !== "dotnet format <đường-dẫn>") {
        expect(m.ghiDia, `${m.nhan}: sinh bin/obj/tsbuildinfo KHÔNG phải là ghi đè mã nguồn`).toBe(false);
      }
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
    /**
     * ★ CẬP NHẬT CÓ LỜI KHAI (2026-08-24): args dotnet KHÔNG còn là hằng — chúng đổi theo
     * `DOTNET_CHO_PHEP_RESTORE` (quyết định chủ dự án: máy có internet kéo NuGet bình thường).
     * Ca này ghim CHẾ ĐỘ MẶC ĐỊNH (vắng cờ ⇒ offline ⇒ `--no-restore`) nên phải XOÁ biến tường
     * minh — một máy dev lỡ bật cờ trong env không được làm lưới chống-hồi-quy-offline xanh giả.
     * Lưới A/B đủ ba chiều của cờ nằm ở khối "§A2 — công tắc restore" ngay dưới.
     */
    const coTruoc = process.env.DOTNET_CHO_PHEP_RESTORE;
    delete process.env.DOTNET_CHO_PHEP_RESTORE;
    try {
      // dotnet phân giải qua PATH ("dotnet"); node --test qua process.execPath.
      check(["dotnet", "build", "sandbox-projects/csharp-demo/CalculatorDemo.sln"], "dotnet", ["build", "sandbox-projects/csharp-demo/CalculatorDemo.sln", "--no-restore"]);
      check(["dotnet", "test", "sandbox-projects/csharp-demo"], "dotnet", ["test", "sandbox-projects/csharp-demo", "--no-restore"]);
      check(["dotnet", "format", "sandbox-projects/csharp-demo/src"], "dotnet", ["format", "sandbox-projects/csharp-demo/src"]);
      check(["node", "--test", "sandbox-projects/react-pg-demo/test/validate.test.mjs"], process.execPath, ["--test", "sandbox-projects/react-pg-demo/test/validate.test.mjs"]);
    } finally {
      if (coTruoc === undefined) delete process.env.DOTNET_CHO_PHEP_RESTORE;
      else process.env.DOTNET_CHO_PHEP_RESTORE = coTruoc;
    }
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
/**
 * ★★★ §A2 — CÔNG TẮC RESTORE THEO TRIỂN KHAI (2026-08-24, quyết định chủ dự án — cùng khuôn
 * `AUTH_2FA_BAT_BUOC`): *"các bên sử dụng hệ sinh thái có internet thì vẫn phải kéo về bình
 * thường được"*. Lưới A/B HAI CHIỀU + giá trị lạ, đo trên CẢ argv phân giải LẪN lời khai `moTa`:
 *   • VẮNG cờ  ⇒ args CÓ `--no-restore` (chống hồi quy offline — đột biến lật mặc định kiểu
 *     `!== "0"` làm ca này ĐỎ ngay);
 *   • `"1"`    ⇒ args KHÔNG có `--no-restore` (restore ngầm được phép);
 *   • giá trị LẠ (`"true"`/`"0"`/`"2"`) ⇒ như VẮNG — chỉ đúng chuỗi `"1"` mở van mạng.
 * ⚠ `moTa` đo CÙNG chiều với args: hai thứ này lệch nhau là thẻ duyệt nói dối về lệnh sắp chạy
 *   (bài học `TENANT_RLS_ENABLED`: đọc cờ tại thời điểm gọi, không đóng băng lúc nạp module).
 */
describe("§A2 — công tắc DOTNET_CHO_PHEP_RESTORE: vắng/lạ = offline, đúng '1' mới bỏ --no-restore", () => {
  const DUONG = "sandbox-projects/csharp-demo";

  function voiCo<T>(co: string | undefined, than: () => T): T {
    const truoc = process.env.DOTNET_CHO_PHEP_RESTORE;
    if (co === undefined) delete process.env.DOTNET_CHO_PHEP_RESTORE;
    else process.env.DOTNET_CHO_PHEP_RESTORE = co;
    try {
      return than();
    } finally {
      if (truoc === undefined) delete process.env.DOTNET_CHO_PHEP_RESTORE;
      else process.env.DOTNET_CHO_PHEP_RESTORE = truoc;
    }
  }

  function argsCua(argv: string[]): readonly string[] {
    const r = phanQuyetLenh(argv);
    expect(r.ok, `${argv.join(" ")} phải hợp lệ ở mọi chế độ cờ`).toBe(true);
    return r.ok ? r.spec.args : [];
  }

  it("★★★ VẮNG cờ ⇒ CẢ build LẪN test giữ `--no-restore` (mặc định an toàn offline)", () => {
    voiCo(undefined, () => {
      expect(argsCua(["dotnet", "build", DUONG])).toEqual(["build", DUONG, "--no-restore"]);
      expect(argsCua(["dotnet", "test", DUONG])).toEqual(["test", DUONG, "--no-restore"]);
    });
  });

  it("★★★ cờ = '1' ⇒ `--no-restore` BIẾN MẤT khỏi argv phân giải — restore ngầm kéo NuGet bình thường", () => {
    voiCo("1", () => {
      expect(argsCua(["dotnet", "build", DUONG])).toEqual(["build", DUONG]);
      expect(argsCua(["dotnet", "test", DUONG])).toEqual(["test", DUONG]);
    });
  });

  it("★★★ giá trị LẠ ('true'/'0'/'2') ⇒ NHƯ VẮNG — van mạng chỉ mở bằng đúng chuỗi '1'", () => {
    for (const la of ["true", "0", "2", "yes", " 1"]) {
      voiCo(la, () => {
        expect(argsCua(["dotnet", "build", DUONG]), `giá trị "${la}" không được mở restore`).toEqual([
          "build",
          DUONG,
          "--no-restore",
        ]);
      });
    }
  });

  it("★★ `moTa` của HAI mục dotnet khai đúng theo cờ — thẻ duyệt không được tả một lệnh khác lệnh sắp chạy", () => {
    const muc = (nhan: string) => DANH_SACH_TRANG.find((m) => m.nhan === nhan)!;
    for (const nhan of ["dotnet build <đường-dẫn>", "dotnet test <đường-dẫn>"]) {
      voiCo(undefined, () => {
        expect(muc(nhan).moTa, `${nhan} (cờ VẮNG)`).toContain("--no-restore");
        expect(muc(nhan).moTa, `${nhan} (cờ VẮNG)`).not.toContain("DOTNET_CHO_PHEP_RESTORE=1");
      });
      voiCo("1", () => {
        expect(muc(nhan).moTa, `${nhan} (cờ BẬT)`).toContain("DOTNET_CHO_PHEP_RESTORE=1");
        expect(muc(nhan).moTa, `${nhan} (cờ BẬT)`).not.toContain("--no-restore");
      });
    }
    // `dotnet format` KHÔNG đổi theo cờ — nó chưa bao giờ mang `--no-restore`.
    voiCo("1", () => {
      expect(argsCua(["dotnet", "format", DUONG])).toEqual(["format", DUONG]);
    });
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

  it("★★ mục 5 — biến PROXY chuỗi công cụ ĐƯỢC truyền qua (hoa lẫn thường)", () => {
    // Đột biến "quên thêm nhóm proxy vào BIEN_MOI_TRUONG_CHO_PHEP" ⇒ ba dòng dưới ĐỎ.
    const ra = moiTruongDaLoc({
      HTTP_PROXY: "http://proxy.cty:8080",
      https_proxy: "http://proxy.cty:8080",
      NO_PROXY: "localhost,127.0.0.1",
    });
    expect(ra.HTTP_PROXY).toBe("http://proxy.cty:8080");
    expect(ra.https_proxy, "so khớp không phân biệt hoa/thường ⇒ https_proxy viết thường vẫn qua").toBe("http://proxy.cty:8080");
    expect(ra.NO_PROXY).toBe("localhost,127.0.0.1");
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §K — THẺ DUYỆT PHẢI **NÓI RA** VIỆC GHI ĐĨA (2026-08-20)
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ LỖ ĐƯỢC VÁ Ở ĐÂY, NÓI THẲNG: trước lượt này thẻ duyệt của `run_command` có **ĐÚNG BỐN** cảnh
 * báo — thư mục chạy · hạn giờ giết cây · môi trường đã lọc · đầu ra bị cắt — và **không dòng nào**
 * nói rằng lệnh sắp bấm sẽ **ghi đè tệp mã nguồn**. Người bấm "Duyệt" cho `dotnet format` đang duyệt
 * một thay đổi họ **chưa từng nhìn thấy**: không diff, không danh sách tệp, không cả một chữ "ghi".
 *
 * ⚠⚠ **CA ÂM LÀ PHẦN QUAN TRỌNG HƠN.** Một bản vá "cứ cảnh báo hết cho chắc" cũng làm ca dương
 * xanh — và nó phá đúng thứ cảnh báo tồn tại để làm: sau vài lần thấy chữ đỏ trên `git status`,
 * người ta bấm qua mà không đọc. Vòng dưới đây đi **CẢ CHÍN** mục lấy từ bảng SỐNG và đòi cảnh báo
 * xuất hiện **khi và chỉ khi** `ghiDia` — nên một cảnh báo thừa cũng ĐỎ.
 *
 * ⚠ Đo bằng **hàm thuần** (`preview` không chạm CSDL, không mock module nào): bài học 2026-08-19 —
 *   một lưới mock-module xanh khi chạy riêng, ĐỎ trong suite. Kiểm được bằng hàm thuần thì đừng mock.
 */
describe("§K — CẢNH BÁO GHI ĐĨA trên thẻ duyệt: có ĐÚNG ở mục ghiDia, và KHÔNG ở tám mục kia", () => {
  /** Dựng chuỗi lệnh hợp lệ cho MỘT mục, lấy khuôn từ bảng SỐNG (ô tự do ⇒ một đường trong hộp cát). */
  const DUONG_MAU = "sandbox-projects/csharp-demo";
  function lenhCuaMuc(m: (typeof DANH_SACH_TRANG)[number]): string {
    return m.khuon.map((k) => k ?? DUONG_MAU).join(" ");
  }

  it("★★★ ∀ 9 mục: cảnh báo GHI ĐÈ là warnings[0] ⇔ `ghiDia` (thừa cũng ĐỎ, thiếu cũng ĐỎ)", async () => {
    const t = toolChayLenh()[0]!;
    const xau: string[] = [];
    for (const m of DANH_SACH_TRANG) {
      const pv = await t.preview!({ command: lenhCuaMuc(m) }, CTX);
      const coCanhBao = pv.warnings.some((s) => s.includes("GHI ĐÈ TỆP MÃ NGUỒN"));
      if (m.ghiDia && !coCanhBao) {
        xau.push(`${m.nhan}: ghiDia=true nhưng thẻ duyệt KHÔNG nói gì về việc ghi đè — người dùng bấm mù`);
      }
      if (!m.ghiDia && coCanhBao) {
        xau.push(`${m.nhan}: ghiDia=false mà vẫn cảnh báo ghi đè — cảnh báo thừa dạy người ta bấm qua`);
      }
      if (m.ghiDia && coCanhBao) {
        expect(pv.warnings[0], `${m.nhan}: cảnh báo ghi đè phải đứng ĐẦU, không nằm dưới bốn câu thủ tục`).toContain(
          "GHI ĐÈ TỆP MÃ NGUỒN",
        );
      }
    }
    expect(xau.join("\n")).toBe("");
  });

  it("★★★ câu cảnh báo nêu ĐÍCH DANH ba hàng rào KHÔNG áp dụng (tệp bẩn · băm TOCTOU · diff)", async () => {
    const t = toolChayLenh()[0]!;
    const pv = await t.preview!({ command: `dotnet format ${DUONG_MAU}` }, CTX);
    const c = pv.warnings[0] ?? "";
    expect(c, "phải nói rõ hàng rào TỆP BẨN không áp dụng").toContain("chưa commit");
    expect(c, "phải nói rõ băm chống TOCTOU không áp dụng").toContain("TOCTOU");
    expect(c, "phải nói rõ KHÔNG có diff để xem trước").toContain("diff");
    expect(c, "phải nêu đường bị ảnh hưởng, không nói chung chung").toContain(DUONG_MAU);
  });

  it("★★ đủ BA locale — một cảnh báo chỉ có tiếng Việt là một cảnh báo vô hình với 2/3 người dùng", async () => {
    const t = toolChayLenh()[0]!;
    const bo: Array<[string, string]> = [
      ["vi", "GHI ĐÈ TỆP MÃ NGUỒN"],
      ["en", "OVERWRITES SOURCE FILES"],
      ["zh", "覆盖源代码文件"],
    ];
    for (const [lang, moc] of bo) {
      const pv = await t.preview!({ command: `dotnet format ${DUONG_MAU}` }, { ...CTX, lang: lang as any });
      expect(pv.warnings[0], `locale ${lang}`).toContain(moc);
    }
  });

  it("★★ ô audit `ghiDia` đi vào previewJson + sổ audit bằng MÃ máy đọc được (không ghim ngôn ngữ vào dữ liệu)", async () => {
    const t = toolChayLenh()[0]!;
    const co = await t.preview!({ command: `dotnet format ${DUONG_MAU}` }, CTX);
    const khong = await t.preview!({ command: "git status" }, CTX);
    expect(co.changes.find((c) => c.field === "ghiDia")?.newValue).toBe("ghi_de_ma_nguon");
    expect(khong.changes.find((c) => c.field === "ghiDia")?.newValue).toBe("chi_hoi_kiem_tra");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §L — LỜI KHAI RA NGOÀI: DÒNG CATALOG QUYỀN + CÂU TỪ CHỐI (2026-08-20)
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ VÌ SAO MỘT LƯỚI ĐI ĐO **CHỮ**: dòng catalog `ai_repo_exec` là thứ quản trị viên đọc **đúng
 * lúc quyết định cấp bit**. Nó từng khai *"…danh sách TRẮNG tại thư mục repo (canCreate): npm run
 * check · npm run check:tests · npx vitest run <đường> · git status · git diff"* — **5 lệnh, toàn
 * chỉ-đọc** — trong khi bit thật cấp **9**, gồm một lệnh **ghi đè mã nguồn**. Trong bảy chỗ lệch,
 * đây là chỗ có hậu quả trực tiếp nhất: một người cấp bit vì tin lời khai ấy đang cấp một thứ khác
 * hẳn với thứ họ đọc.
 *
 * ⇒ Ca dưới suy danh sách từ `DANH_SACH_TRANG` **SỐNG** rồi đòi dòng catalog chứa TỪNG `nhan`. Thêm
 *   một mục vào bảng mà quên sửa catalog ⇒ ĐỎ ngay, không cần ai nhớ.
 */
describe("§L — dòng catalog quyền `ai_repo_exec` khai ĐÚNG bảng SỐNG", () => {
  /** Rút chuỗi `description` của mục catalog `ai_repo_exec` bằng AST (không so chuỗi cả file). */
  function moTaCatalog(): string {
    const file = path.resolve(GOC_SERVER, "routers", "permissionsRouter.ts");
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let ra: string | null = null;
    const doc = (o: ts.ObjectLiteralExpression): string | null => {
      let ten: string | null = null;
      let mo: string | null = null;
      for (const p of o.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
        if (!ts.isStringLiteralLike(p.initializer)) continue;
        if (p.name.text === "moduleName") ten = p.initializer.text;
        if (p.name.text === "description") mo = p.initializer.text;
      }
      return ten === "ai_repo_exec" ? mo : null;
    };
    const di = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) {
        const m = doc(n);
        if (m !== null) ra = m;
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    expect(ra, "không tìm thấy mục catalog `ai_repo_exec` có `description` — phép đo đã hỏng, không phải hệ").not.toBeNull();
    return ra!;
  }

  it("★★★ catalog nêu ĐỦ CẢ CHÍN lệnh — suy từ bảng SỐNG, không chép tay", () => {
    const mo = moTaCatalog();
    const thieu = DANH_SACH_TRANG.filter((m) => !mo.includes(m.nhan)).map((m) => m.nhan);
    expect(
      thieu.join(" · "),
      "Dòng catalog `ai_repo_exec` khai THIẾU lệnh. Đây là chữ quản trị viên đọc ĐÚNG LÚC quyết định " +
        "cấp bit — khai thiếu ở đây là để họ cấp một quyền khác với quyền họ tưởng.",
    ).toBe("");
    expect(mo, "phải khai đúng SỐ LƯỢNG của bảng sống").toContain(`trong ${DANH_SACH_TRANG.length} lệnh`);
  });

  it("★★★ catalog NÊU ĐÍCH DANH lệnh ghi đè và nói rõ nó GHI ĐÈ (không chỉ liệt kê tên)", () => {
    const mo = moTaCatalog();
    for (const m of DANH_SACH_TRANG.filter((x) => x.ghiDia)) {
      expect(mo, `catalog phải nêu đích danh "${m.nhan}"`).toContain(m.nhan);
    }
    expect(mo, "phải có chữ GHI ĐÈ TỆP MÃ NGUỒN — liệt kê tên lệnh thôi thì không ai đoán ra").toContain(
      "GHI ĐÈ TỆP MÃ NGUỒN",
    );
    expect(
      mo,
      "phải nói ra hệ quả RBAC: bit này cho ghi đè mã nguồn kể cả khi ai_repo_read/canEdit đã bị thu",
    ).toContain("ai_repo_read/canEdit");
  });

  /**
   * ★★ Câu TỪ CHỐI hiện ra màn hình từng nói *"Năm lệnh được phép"* / *"The five allowed commands"* /
   * *"允许的五条命令"* rồi **in ra bảng CHÍN dòng ngay bên dưới** — tự mâu thuẫn trong một câu, ở cả
   * ba ngôn ngữ. Nay số lượng đọc từ `DANH_SACH_TRANG.length`, nên ca này đo **cả ba locale** rằng
   * con số khớp bảng sống và không còn chữ "năm" viết cứng.
   */
  it("★★★ câu từ chối CMD_NOT_ALLOWED khai đúng SỐ LƯỢNG ở cả ba locale, và không còn 'năm' viết cứng", async () => {
    const t = toolChayLenh()[0]!;
    const n = DANH_SACH_TRANG.length;
    const bo: Array<[string, string, RegExp]> = [
      ["vi", `${n} lệnh được phép`, /Năm lệnh được phép/],
      ["en", `The ${n} allowed commands`, /The five allowed commands/],
      ["zh", `允许的 ${n} 条命令`, /允许的五条命令/],
    ];
    for (const [lang, phaiCo, camCo] of bo) {
      const ra = await t.execute!({ command: "npm run build" }, { ...CTX, lang: lang as any });
      const s = String(ra.textSummary ?? "");
      expect(ra.note, `locale ${lang}: phải là một lượt TỪ CHỐI`).toBe("CMD_NOT_ALLOWED");
      expect(s, `locale ${lang}`).toContain(phaiCo);
      expect(camCo.test(s), `locale ${lang}: còn chữ "năm" viết cứng trong khi bảng có ${n} mục`).toBe(false);
      /**
       * ★★★ ĐẢO CHIỀU CÓ GHI LÝ DO (2026-08-23 · UX B3) — bản trước đòi CẢ BẢNG chín dòng nằm trong
       * `textSummary`. Buổi trải nghiệm người-dùng-thật đo được đó chính là "bức tường ~2.300 ký tự
       * mỗi lần gõ sai". Bất biến THẬT của ca này ("con số và nội dung không được lệch nhau") giữ
       * nguyên — chỉ đổi KÊNH: bảng đầy đủ nay là `data.danhSachChoPhep` (máy-đọc-được, client gấp
       * sau nút "Xem cả danh sách"), còn văn xuôi chỉ mang câu ngắn + gợi ý gần đúng.
       */
      const bang = (ra.data as { danhSachChoPhep?: string[] }).danhSachChoPhep ?? [];
      expect(bang.length, `locale ${lang}: bảng đầy đủ phải theo lượt từ chối trong data`).toBe(n);
      for (const m of DANH_SACH_TRANG) {
        expect(bang.some((d) => d.includes(m.nhan)), `locale ${lang}: bảng data thiếu "${m.nhan}"`).toBe(true);
      }
      // Văn xuôi KHÔNG được phình trở lại thành bức tường — trần có SỐ, đo được, hai chiều với ca cũ.
      expect(s.length, `locale ${lang}: câu từ chối lại phình thành bức tường`).toBeLessThan(700);
    }
  });
});

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // §M — (D) CỔNG BỔ SUNG CHO MỤC `ghiDia`: CHÍNH SÁCH ĐO ĐƯỢC, MẶC ĐỊNH TẮT
  // ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§M — (D) CỔNG BỔ SUNG cho mục ghi đĩa: đòi THÊM ai_repo_read/canEdit sau một cờ MẶC ĐỊNH TẮT", () => {
  /**
   * ⚠⚠ Ba ca dưới đo **CHÍNH SÁCH** bằng hàm thuần + đo **CHỖ CƯỠNG CHẾ** bằng AST. Cố ý KHÔNG mock
   * `_core/accessControl`: bài học 2026-08-19 (một lưới mock-module xanh khi chạy riêng, ĐỎ trong
   * suite) và bài học "đừng kéo CSDL dùng chung vào một lưới vốn không cần nó".
   *
   * ⚠ Ca "mặc định TẮT" là ca quan trọng nhất về mặt an toàn hồi quy: nó chứng minh bản vá (D)
   *   **không đổi một byte hành vi** cho tài khoản đang chạy khi chưa ai bật cờ.
   */
  it("★★★ (D) MẶC ĐỊNH TẮT — không mục nào đòi bit thứ hai khi cờ vắng (0 hồi quy)", () => {
    const cu = process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT;
    delete process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT;
    try {
      for (const m of DANH_SACH_TRANG) {
        expect(canDoiBitGhiThem(m), `${m.nhan}: cờ TẮT mà vẫn đòi bit thứ hai ⇒ hồi quy cho người đang dùng`).toBe(false);
      }
      expect(congGhiDiaBat()).toBe(false);
      // "0" tường minh cũng phải là TẮT — không được coi mọi giá trị khác rỗng là BẬT.
      process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT = "0";
      expect(congGhiDiaBat()).toBe(false);
    } finally {
      if (cu === undefined) delete process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT;
      else process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT = cu;
    }
  });

  it("★★★ (D) cờ BẬT ⇒ ĐÚNG mục `ghiDia` đòi thêm bit, tám mục kia KHÔNG đổi", () => {
    const cu = process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT;
    process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT = "1";
    try {
      const doi = DANH_SACH_TRANG.filter((m) => canDoiBitGhiThem(m)).map((m) => m.nhan);
      expect(doi, "cờ BẬT chỉ được siết đúng mục ghi đè mã nguồn — siết cả bảng là phá luồng đang chạy").toEqual([
        "dotnet format <đường-dẫn>",
      ]);
      expect(QUYEN_GHI_THEM).toEqual({ module: "ai_repo_read", action: "canEdit" });
    } finally {
      if (cu === undefined) delete process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT;
      else process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT = cu;
    }
  });

  it("★★ (D) cờ BẬT ⇒ thẻ duyệt NÓI TRƯỚC rằng lượt chạy còn đòi bit thứ hai (đỡ một lượt bấm hụt)", async () => {
    const cu = process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT;
    const t = toolChayLenh()[0]!;
    try {
      process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT = "1";
      const bat = await t.preview!({ command: "dotnet format sandbox-projects/csharp-demo" }, CTX);
      expect(bat.warnings.some((s) => s.includes("ai_repo_read/canEdit"))).toBe(true);
      // ⚠ Cảnh báo GHI ĐÈ vẫn phải đứng ĐẦU — cờ (D) không được đẩy nó xuống.
      expect(bat.warnings[0]).toContain("GHI ĐÈ TỆP MÃ NGUỒN");

      delete process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT;
      const tat = await t.preview!({ command: "dotnet format sandbox-projects/csharp-demo" }, CTX);
      expect(
        tat.warnings.some((s) => s.includes("ai_repo_read/canEdit")),
        "cờ TẮT mà thẻ duyệt vẫn doạ một quyền không được đòi ⇒ lời khai SAI theo chiều ngược lại",
      ).toBe(false);
    } finally {
      if (cu === undefined) delete process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT;
      else process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT = cu;
    }
  });

  it("★★★ (D) cưỡng chế nằm ở HARD GATE `execute`, KHÔNG ở `preview` (preview chạy trước HITL)", () => {
    const dg = diemGoi("checkPermission").filter((d) => d.file === "services/aiLocalTools/writeHandlers/repoCommand.ts");
    expect(
      dg.map((d) => d.trongHam),
      "`preview()` chạy TRƯỚC cổng HITL và kết quả của nó đi tới ba đích không cần ai xác nhận. Một " +
        "cổng quyền đặt ở đó vừa vô dụng (args thật đến từ hàng `ai_pending_actions`) vừa kéo CSDL " +
        "vào đường xem trước. Cưỡng chế phải ở `execute`.",
    ).toEqual(["execute"]);
  });

});

// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ §K — **npm/npx ĐI NGƯỢC LÊN CÂY THƯ MỤC, HỘP CÁT CHỈ GIAM `cwd`.**
 * Bắt được ở NGHIỆM THU LIVE 2026-08-23, không lưới nào phát biểu: hỏi *"chạy test của dự án này"*
 * trong dự án C# ⇒ tác nhân chạy `npm run check:tests`, thẻ duyệt khai đúng thư mục
 * `sandbox-projects/csharp-demo`, mà đầu ra là **lỗi TypeScript của REPO CHÍNH**. Đo lại bằng
 * `npm prefix` trong đúng thư mục ấy: trả về `D:\SOURCES\avi-aoi-management`.
 * ⇒ Không phải lỗ THỰC THI (khuôn vẫn khớp chính xác), mà là lời nói dối về **việc lệnh tác động
 *   lên cái gì** — và người duyệt bấm 'y' dựa trên nó.
 */
describe("§K — lệnh Node đòi `package.json` Ở ĐÚNG GỐC", () => {
  const gocCoNode = fs.mkdtempSync(path.join(os.tmpdir(), "goc-node-"));
  const gocChaCoNode = fs.mkdtempSync(path.join(os.tmpdir(), "cha-node-"));
  const gocConKhongNode = path.join(gocChaCoNode, "du-an-csharp");

  beforeAll(() => {
    fs.writeFileSync(path.join(gocCoNode, "package.json"), '{"name":"co-that"}');
    // ★ Hình dạng THẬT của `sandbox-projects/csharp-demo`: gốc KHÔNG có package.json, thư mục CHA CÓ.
    fs.writeFileSync(path.join(gocChaCoNode, "package.json"), '{"name":"repo-chinh"}');
    fs.mkdirSync(gocConKhongNode, { recursive: true });
  });
  afterAll(() => {
    for (const d of [gocCoNode, gocChaCoNode]) fs.rmSync(d, { recursive: true, force: true });
  });

  it("★★ dân số: đúng BA mục thoát cwd, và chúng đúng là ba mục npm/npx", () => {
    const thoat = DANH_SACH_TRANG.filter((m) => m.thoatCwdTheoCayThuMuc).map((m) => m.nhan);
    expect(
      thoat,
      "Thêm một lệnh `npm`/`npx`/`yarn`/`pnpm` vào bảng mà quên khai ô này ⇒ nó chạy trên dự án CHA " +
        "trong khi thẻ duyệt khai thư mục CON. Đọc khối `thoatCwdTheoCayThuMuc` trước khi sửa số này.",
    ).toEqual(["npm run check", "npm run check:tests", "npx vitest run <đường-dẫn>"]);
    // Mọi mục đều PHẢI khai — thiếu ô là `undefined`, tức lọt qua cổng theo chiều KHÔNG an toàn.
    for (const m of DANH_SACH_TRANG) expect(typeof m.thoatCwdTheoCayThuMuc, m.nhan).toBe("boolean");
  });

  it("★★★ gốc KHÔNG có package.json (mà CHA thì có) ⇒ TỪ CHỐI cả ba lệnh Node", () => {
    for (const argv of [
      ["npm", "run", "check"],
      ["npm", "run", "check:tests"],
      ["npx", "vitest", "run", "src"],
    ]) {
      const r = phanQuyetLenh(argv, gocConKhongNode);
      expect(r.ok, `${JSON.stringify(argv)} phải bị từ chối`).toBe(false);
      if (!r.ok) expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_GOC_THIEU_PACKAGE_JSON);
    }
  });

  it("★★★ CHỐNG TỰ THOẢ: cùng gốc ấy, lệnh KHÔNG thoát cwd vẫn ĐƯỢC chạy", () => {
    // Không có ca này thì một đột biến "từ chối tất cả ở gốc lạ" cũng xanh, và cổng mất hết ý nghĩa.
    const r = phanQuyetLenh(["git", "status"], gocConKhongNode);
    expect(r.ok, "git KHÔNG đi ngược cây thư mục để tìm dự án ⇒ không có lý do từ chối").toBe(true);
  });

  /**
   * ★★★ Cùng họ "lệnh tự đi ngược lên cây thư mục", nhưng hậu quả KHÁC: `git status` không chạy sai
   * dự án — nó báo cáo ĐÚNG repo mẹ, và đó mới là vấn đề. Đo 2026-08-23 trong
   * `sandbox-projects/csharp-demo`: `git status --porcelain` trả **171 dòng** đường dẫn của repo
   * chính; thêm `-- .` thì còn **0**. Một phiên mở dự án C# không được nhìn thấy cây tệp repo mẹ.
   */
  it("★★★ `git status`/`git diff` PHẢI giới hạn phạm vi vào cây con của cwd", () => {
    for (const argv of [["git", "status"], ["git", "diff"]]) {
      const r = phanQuyetLenh(argv, gocConKhongNode);
      expect(r.ok, `${JSON.stringify(argv)} phải hợp lệ`).toBe(true);
      if (!r.ok) continue;
      expect(
        r.spec.args,
        "thiếu `-- .` ⇒ git đi ngược lên `.git` gần nhất và bê về TOÀN BỘ repo mẹ, tức rò tên tệp " +
          "của một dự án mà phiên này không được phép nhìn",
      ).toEqual(expect.arrayContaining(["--", "."]));
    }
  });

  it("★★ CHIỀU DƯƠNG: gốc CÓ package.json ⇒ lệnh Node chạy được như cũ", () => {
    /**
     * ⚠ `npx vitest run <đường>` bị bỏ ra khỏi ca này **có chủ ý, và đo rồi mới bỏ**: `phanGiai` của
     *   nó gọi `duongDanVitest(goc)` để tìm `node_modules/vitest/vitest.mjs` **dưới đúng gốc ấy**.
     *   Thư mục tạm không có `node_modules` ⇒ nó đỏ vì `CMD_RESOLVE_ERROR` (hỏng CÀI ĐẶT), một trục
     *   hoàn toàn khác với trục `package.json` mà §K này canh. Để nó ở đây là trộn hai nguyên nhân
     *   vào một mệnh đề — nhìn thì "xanh/đỏ" vẫn đúng, nhưng nó sẽ đỏ vì lý do SAI.
     * ⚠ Chiều ÂM của `npx vitest` vẫn được canh ở ca trên: chốt `package.json` chạy TRƯỚC
     *   `phanQuyetOTuDo` lẫn `phanGiai`, nên nó phát biểu được mà không chạm hai trục kia.
     */
    for (const argv of [
      ["npm", "run", "check"],
      ["npm", "run", "check:tests"],
    ]) {
      const r = phanQuyetLenh(argv, gocCoNode);
      expect(r.ok, `${JSON.stringify(argv)} là hợp lệ, KHÔNG được vá quá tay`).toBe(true);
    }
  });
});
