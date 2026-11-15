/**
 * HA-4 (lệnh) qua cổng thật: `phanQuyetLenhTuDong` (từ chối thật của sandbox) ⇒ `cauTuChoiLenhTuDong(ma, chiTiet, lenh)` ⇒ câu cho model có GỢI Ý dạng được phép.
 * THUẦN: không CSDL, không tiến trình; chỉ env AI_CODING_AUTOLOOP (khôi phục sau mỗi ca).
 * ĐỘT BIẾN PHẢI BẮT: không truyền lệnh vào lời từ chối · gợi ý thay mất danh sách chung · gợi ý lọt vào AUTOLOOP_TAT · lệnh được phép bị gắn gợi ý.
 */
import path from "node:path";
import { kiemThamSo } from "@shared/agentCore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cauTuChoiLenhTuDong, phanQuyetLenhTuDong, taoBoThucThiMayChu } from "./boThucThiMayChu";

const goc = path.resolve(process.cwd());
let cu: string | undefined;
beforeEach(() => {
  cu = process.env.AI_CODING_AUTOLOOP;
  process.env.AI_CODING_AUTOLOOP = "1";
});
afterEach(() => {
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

describe("điểm gọi thật: bộ thực thi tu-dong truyền `args.command` vào lời từ chối (bản GIẢ, không CSDL)", () => {
  afterEach(() => vi.unstubAllEnvs());
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
