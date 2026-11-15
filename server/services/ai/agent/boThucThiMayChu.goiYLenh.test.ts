/**
 * HA-4 (lệnh) qua cổng thật: `phanQuyetLenhTuDong` (từ chối thật của sandbox) ⇒ `cauTuChoiLenhTuDong(ma, chiTiet, lenh)` ⇒ câu cho model có GỢI Ý dạng được phép.
 * THUẦN: không CSDL, không tiến trình; chỉ env AI_CODING_AUTOLOOP (khôi phục sau mỗi ca).
 * ĐỘT BIẾN PHẢI BẮT: không truyền lệnh vào lời từ chối · gợi ý thay mất danh sách chung · gợi ý lọt vào AUTOLOOP_TAT · lệnh được phép bị gắn gợi ý.
 */
import path from "node:path";
import { kiemThamSo } from "@shared/agentCore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cauTuChoiLenhTuDong, goiYLenhBat, phanQuyetLenhTuDong, taoBoThucThiMayChu } from "./boThucThiMayChu";

const goc = path.resolve(process.cwd());
let cu: string | undefined;
beforeEach(() => {
  cu = process.env.AI_CODING_AUTOLOOP;
  process.env.AI_CODING_AUTOLOOP = "1";
  vi.stubEnv("AI_AGENT_GOI_Y_LENH", "1"); // cờ BẬT cho các ca dưới (mặc định TẮT: xem describe "cờ AI_AGENT_GOI_Y_LENH")
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (cu === undefined) delete process.env.AI_CODING_AUTOLOOP;
  else process.env.AI_CODING_AUTOLOOP = cu;
});

/** đúng như điểm gọi thật: từ chối thật ⇒ câu cho model */
function loiChoModel(lenh: string): string {
  const pq = phanQuyetLenhTuDong(lenh, goc, () => false);
  if (pq.ok || pq.ma === "REPO_CHINH_CHUA_CHECKPOINT") throw new Error(`lệnh phải bị từ chối với LENH_CAN_DUYET_TAY: ${lenh}`);
  return cauTuChoiLenhTuDong(pq.ma, pq.chiTiet, lenh);
}

describe("lời từ chối lệnh tu-dong có gợi ý dạng được phép", () => {
  it("★★★ pytest kèm -v: vẫn có danh sách chung + chi tiết mã + GỢI Ý dạng đúng", () => {
    const c = loiChoModel("python -m pytest py-doi-soat/tests/test_doi_soat.py -v");
    expect(c).toContain("needs manual approval");
    expect(c).toContain("CMD_NOT_ALLOWED");
    expect(c).toContain("Only test/build verification commands");
    expect(c).toContain("The only accepted form is exactly `python -m pytest <path>`");
    expect(c).toContain("The command was NOT run.");
  });
  it("★★★ glob `*` ở node --test (chết ở tachArgv, chi tiết không có lệnh) ⇒ vẫn có gợi ý thư mục nhờ truyền lệnh", () => {
    const c = loiChoModel("node --test js-loi-3-lop/test/*.test.mjs");
    expect(c).toContain("CMD_METACHAR");
    expect(c).toContain("`node --test <directory>`");
  });
  it("★★★ cat tệp dữ liệu ⇒ gợi ý read_file + tệp bị từ chối là chủ ý", () => {
    const c = loiChoModel("cat py-doi-soat/du_lieu/so_sach.csv");
    expect(c).toContain("read_file");
    expect(c).toContain("not readable by design");
  });
  it("★★★ python -c với nháy (CMD_METACHAR) ⇒ gợi ý không chạy mã tuỳ ý", () => {
    const c = loiChoModel("python -c \"print(open('a.csv').read())\"");
    expect(c).toContain("CMD_METACHAR");
    expect(c).toContain("Running arbitrary code or scripts");
  });
  it("★★★ mkdir -p ⇒ gợi ý write_file", () => {
    expect(loiChoModel("mkdir -p py-doi-soat/scripts")).toContain("create files with write_file");
  });
  it("★★★ lệnh không thuộc họ nào (git status) ⇒ câu y như cũ, KHÔNG thêm gợi ý", () => {
    const c = loiChoModel("git status");
    const cu_ = cauTuChoiLenhTuDong("LENH_CAN_DUYET_TAY", phanQuyetLenhTuDong("git status", goc, () => false).ok ? "" : (phanQuyetLenhTuDong("git status", goc, () => false) as { chiTiet: string }).chiTiet);
    expect(c).toBe(cu_);
    expect(c).not.toContain("read_file");
    expect(c).not.toContain("accepted form");
  });
  it("★★★ gợi ý KHÔNG đứng sau câu `The command was NOT run` làm mất thông báo; thứ tự: lý do → danh sách chung → NOT run → gợi ý", () => {
    const c = loiChoModel("python -m pytest tests -q");
    expect(c.indexOf("needs manual approval")).toBeLessThan(c.indexOf("Only test/build verification commands"));
    expect(c.indexOf("The command was NOT run.")).toBeLessThan(c.indexOf("The only accepted form"));
  });
  it("★★★ HỢP ĐỒNG ĐIỂM NỐI: phần câu do gợi ý thêm vào KHÔNG chép nguyên văn lệnh của model (token lạ trong đối số), cho cả họ cờ / đọc tệp / glob / mkdir; câu gốc không đổi và gợi ý đứng CUỐI", () => {
    const ca: Array<[string, string]> = [
      ["python -m pytest tests/x.py -v QQTOKENCO1", "QQTOKENCO1"],
      ["cat QQTOKENDOC2/a.csv", "QQTOKENDOC2"],
      ["node --test QQTOKENGLOB3/*.mjs", "QQTOKENGLOB3"],
      ["mkdir -p QQTOKENMK4", "QQTOKENMK4"],
    ];
    for (const [lenh, dauHieu] of ca) {
      const pq = phanQuyetLenhTuDong(lenh, goc, () => false);
      if (pq.ok || pq.ma === "REPO_CHINH_CHUA_CHECKPOINT") throw new Error(`phải bị từ chối: ${lenh}`);
      const goc_ = cauTuChoiLenhTuDong(pq.ma, pq.chiTiet);
      const day = cauTuChoiLenhTuDong(pq.ma, pq.chiTiet, lenh);
      expect(day.startsWith(goc_), lenh).toBe(true);
      const them = day.slice(goc_.length);
      expect(them.length, lenh).toBeGreaterThan(0);
      expect(them, lenh).not.toContain(dauHieu);
      expect(day.indexOf("Only test/build verification commands"), lenh).toBeLessThan(day.indexOf(them.trim()));
    }
  });
  it("★★ AUTOLOOP_TAT: KHÔNG gắn gợi ý lệnh (câu riêng, lệnh không được thử lại ở dạng khác)", () => {
    const c = cauTuChoiLenhTuDong("AUTOLOOP_TAT", "AI_CODING_AUTOLOOP", "python -m pytest tests -v");
    expect(c).toContain("Do not retry it");
    expect(c).not.toContain("accepted form");
  });
  it("★★ `dotnet restore` giữ nguyên gợi ý cũ và không bị gợi ý mới đè", () => {
    const c = loiChoModel("dotnet restore");
    expect(c).toMatch(/dotnet (build|test).*restore.*automatically/i);
  });
  it("★★ không truyền lệnh (gọi kiểu cũ 2 tham số) ⇒ vẫn chạy, không gợi ý, không ném", () => {
    const c = cauTuChoiLenhTuDong("LENH_CAN_DUYET_TAY", "CMD_NOT_ALLOWED: x");
    expect(c).toContain("needs manual approval");
    expect(c).not.toContain("accepted form");
  });
});

describe("cờ AI_AGENT_GOI_Y_LENH — MẶC ĐỊNH TẮT: lời từ chối giữ NGUYÊN TỪNG BYTE (phát lại fixture H4.2 không lệch)", () => {
  const LENH = ["python -m pytest py-kho-cache/tests/test_repo_cache_edge.py -v", "cat py-doi-soat/du_lieu/so_sach.csv", "node --test js-loi-3-lop/test/*.test.mjs", "mkdir -p a/b", "python -c print(1)"];
  const chiTietCua = (lenh: string) => {
    const pq = phanQuyetLenhTuDong(lenh, goc, () => false);
    if (pq.ok || pq.ma === "REPO_CHINH_CHUA_CHECKPOINT") throw new Error(`phải bị từ chối: ${lenh}`);
    return { ma: pq.ma, chiTiet: pq.chiTiet };
  };
  it("★★★ goiYLenhBat: chỉ đúng chuỗi `1` bật; vắng / 0 / true / rỗng / có khoảng trắng ⇒ TẮT", () => {
    expect(goiYLenhBat("1")).toBe(true);
    for (const v of [undefined, "", "0", "true", "TRUE", " 1", "1 ", "on", "yes"]) expect(goiYLenhBat(v), String(v)).toBe(false);
  });
  it("★★★ cờ vắng / 0 ⇒ câu từ chối BẰNG ĐÚNG câu không truyền lệnh (byte-identical với bản trước HA-4), cho mọi họ lệnh", () => {
    for (const giaTri of [undefined, "0", "true"]) {
      vi.unstubAllEnvs();
      if (giaTri !== undefined) vi.stubEnv("AI_AGENT_GOI_Y_LENH", giaTri);
      else delete process.env.AI_AGENT_GOI_Y_LENH;
      for (const lenh of LENH) {
        const { ma, chiTiet } = chiTietCua(lenh);
        expect(cauTuChoiLenhTuDong(ma, chiTiet, lenh), `${String(giaTri)} · ${lenh}`).toBe(cauTuChoiLenhTuDong(ma, chiTiet));
      }
    }
  });
  it("★★★ cờ `1` ⇒ câu có gợi ý (dài hơn câu không truyền lệnh), cùng các lệnh đó", () => {
    vi.stubEnv("AI_AGENT_GOI_Y_LENH", "1");
    for (const lenh of LENH) {
      const { ma, chiTiet } = chiTietCua(lenh);
      const day = cauTuChoiLenhTuDong(ma, chiTiet, lenh);
      expect(day.length, lenh).toBeGreaterThan(cauTuChoiLenhTuDong(ma, chiTiet).length);
    }
  });
  it("★★ cờ đọc TẠI CHỖ GỌI (đổi env giữa hai lần gọi ⇒ kết quả đổi theo)", () => {
    const { ma, chiTiet } = chiTietCua(LENH[0]!);
    vi.stubEnv("AI_AGENT_GOI_Y_LENH", "1");
    const bat = cauTuChoiLenhTuDong(ma, chiTiet, LENH[0]);
    vi.stubEnv("AI_AGENT_GOI_Y_LENH", "0");
    expect(cauTuChoiLenhTuDong(ma, chiTiet, LENH[0])).not.toBe(bat);
  });
});

describe("cờ TẮT ⇒ câu từ chối bằng CHUỖI NGUYÊN VĂN của main b64cfa984 (không so tương đối)", () => {
  /** [mã, chi tiết, câu NGUYÊN VĂN do hàm `cauTuChoiLenhTuDong` của b64cfa984 trả — trích từ git, KHÔNG sinh từ mã nhánh này] */
  const NGUYEN_VAN_MAIN: Array<[ "LENH_CAN_DUYET_TAY" | "AUTOLOOP_TAT", string, string ]> = [
  ["LENH_CAN_DUYET_TAY", "CMD_NOT_ALLOWED: git status", "Refused in automatic mode: this command needs manual approval (CMD_NOT_ALLOWED: git status). Only test/build verification commands (e.g. node --test <path>, npx vitest run <path>, dotnet build|test <path>, python -m pytest|unittest <path>, javac -d <out> <files|dir>, java -cp <out> <TestClass>, cmake -S . -B <build>, cmake --build <build>, ctest --test-dir <build>, go test|build|vet ./..., cargo test|build|check --offline) run without approval, and never commands that rewrite source files (dotnet format). The command was NOT run. Use a verification command, or tell the user to run this one in 'Edit' mode."],
  ["LENH_CAN_DUYET_TAY", "dotnet restore", "Refused in automatic mode: this command needs manual approval (dotnet restore). Note: dotnet build|test <path> restore NuGet packages automatically (offline, from this machine's package cache) — just run `dotnet test <project>`; a package not on this machine fails with NU1101 and needs the user to approve `dotnet restore` in 'Edit' mode. Do not create or edit obj/project.assets.json by hand. Only test/build verification commands (e.g. node --test <path>, npx vitest run <path>, dotnet build|test <path>, python -m pytest|unittest <path>, javac -d <out> <files|dir>, java -cp <out> <TestClass>, cmake -S . -B <build>, cmake --build <build>, ctest --test-dir <build>, go test|build|vet ./..., cargo test|build|check --offline) run without approval, and never commands that rewrite source files (dotnet format). The command was NOT run. Use a verification command, or tell the user to run this one in 'Edit' mode."],
  ["AUTOLOOP_TAT", "AI_CODING_AUTOLOOP", "Refused in automatic mode: running commands without approval is disabled on this server (AI_CODING_AUTOLOOP is off). The command was NOT run. Do not retry it; tell the user they can run it in 'Edit' mode (approval per command)."],
  ["LENH_CAN_DUYET_TAY", "CMD_METACHAR: ky tu \"*\" (U+002A)", "Refused in automatic mode: this command needs manual approval (CMD_METACHAR: ky tu \"*\" (U+002A)). Only test/build verification commands (e.g. node --test <path>, npx vitest run <path>, dotnet build|test <path>, python -m pytest|unittest <path>, javac -d <out> <files|dir>, java -cp <out> <TestClass>, cmake -S . -B <build>, cmake --build <build>, ctest --test-dir <build>, go test|build|vet ./..., cargo test|build|check --offline) run without approval, and never commands that rewrite source files (dotnet format). The command was NOT run. Use a verification command, or tell the user to run this one in 'Edit' mode."],
  ];
  const LENH = [undefined, "git status", "python -m pytest tests/x.py -v", "cat a/b.csv", "node --test a/*.mjs", "mkdir -p d", "python -c print(1)", "dotnet restore p.csproj", 42];
  it("★★★ cờ vắng / rỗng / 0 / true / on / ' 1' ⇒ ĐÚNG chuỗi của main, cho 4 tổ hợp (mã × chi tiết) × 9 lệnh", () => {
    let n = 0;
    for (const giaTri of [undefined, "", "0", "true", "on", " 1"]) {
      vi.unstubAllEnvs();
      if (giaTri !== undefined) vi.stubEnv("AI_AGENT_GOI_Y_LENH", giaTri);
      else delete process.env.AI_AGENT_GOI_Y_LENH;
      for (const [ma, chiTiet, nguyenVan] of NGUYEN_VAN_MAIN) {
        for (const lenh of LENH) {
          expect(cauTuChoiLenhTuDong(ma, chiTiet, lenh), `${String(giaTri)} · ${ma} · ${chiTiet} · ${String(lenh)}`).toBe(nguyenVan);
          n++;
        }
      }
    }
    expect(n).toBe(6 * 4 * 9);
  });
  it("★★★ chuỗi của main là chuỗi THẬT (có 'needs manual approval', danh sách chung, 'NOT run'), và dotnet restore giữ gợi ý cũ", () => {
    const [a, b, c] = NGUYEN_VAN_MAIN;
    expect(a![2]).toContain("this command needs manual approval (CMD_NOT_ALLOWED: git status)");
    expect(a![2]).toContain("Only test/build verification commands");
    expect(a![2]).toContain("The command was NOT run.");
    expect(b![2]).toContain("dotnet build|test <path> restore NuGet packages automatically");
    expect(c![2]).toContain("Do not retry it");
  });
  it("★★ cờ `1` ĐỔI chuỗi với lệnh có họ gợi ý (có tác dụng), nhưng vẫn BẮT ĐẦU bằng đúng chuỗi của main", () => {
    vi.stubEnv("AI_AGENT_GOI_Y_LENH", "1");
    const [a] = NGUYEN_VAN_MAIN;
    const day = cauTuChoiLenhTuDong(a![0], a![1], "python -m pytest tests/x.py -v");
    expect(day).not.toBe(a![2]);
    expect(day.startsWith(a![2])).toBe(true);
  });
});

describe("điểm gọi thật: bộ thực thi tu-dong truyền `args.command` vào lời từ chối (bản GIẢ, không CSDL)", () => {
  function dung() {
    vi.stubEnv("AI_CODING_TU_TRI_GHI", "1");
    vi.stubEnv("AI_CODING_AUTOLOOP", "1");
    const executeDecision = vi.fn(async () => ({ error: "không được tới đây khi lệnh bị từ chối" }));
    const nguoi = { id: 1, role: "admin", name: "Ky su" };
    const bo = taoBoThucThiMayChu({
      execCtx: { user: nguoi, lang: "vi", projectRoot: goc },
      gocDuAn: goc,
      user: nguoi,
      coQuyenThucThi: true,
      checkpoint: null,
      phuThuoc: { executeDecision: executeDecision as never, kiemKillSwitch: async () => false, laGhiVaoRepoChinh: () => false },
    });
    const chay = (command: string) => {
      const kt = kiemThamSo("run_command", { command });
      if (!kt.ok) throw new Error(kt.loiChoModel);
      return bo.chay({ id: "c1", ten: "run_command", thamSo: kt.thamSo }, { cheDo: "tu-dong", runId: "11111111-1111-4111-8111-111111111111", luot: 1, signal: new AbortController().signal, phat: () => undefined });
    };
    return { chay, executeDecision };
  }
  it("★★★ `python -m pytest <đường> -v` ở tu-dong ⇒ LENH_CAN_DUYET_TAY, choModel có gợi ý dạng đúng; executeDecision KHÔNG được gọi", async () => {
    const { chay, executeDecision } = dung();
    const kq = await chay("python -m pytest tests/test_x.py -v");
    expect(kq.ok).toBe(false);
    expect(kq.ma).toBe("LENH_CAN_DUYET_TAY");
    expect(kq.choModel).toContain("The only accepted form is exactly `python -m pytest <path>`");
    expect(executeDecision).not.toHaveBeenCalled();
  });
  it("★★★ glob (chết ở tachArgv, chi tiết không có lệnh) ⇒ vẫn có gợi ý nhờ điểm gọi truyền lệnh", async () => {
    const { chay } = dung();
    const kq = await chay("node --test js-loi-3-lop/test/*.test.mjs");
    expect(kq.ma).toBe("LENH_CAN_DUYET_TAY");
    expect(kq.choModel).toContain("`node --test <directory>`");
  });
});
