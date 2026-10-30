/**
 * Đợt 11.3-A — LỆNH KHOÁ CỨNG: một nguồn (`shared/agentCore/lenhKhoaCung`) cho vành đai thứ hai của `phanQuyetLenh` và cho biểu tượng khoá ở thẻ duyệt.
 * Ghim: (1) SIÊU TẬP của danh sách cấm cũ (census) — không nới một mục; (2) MỌI mục argv bị `phanQuyetLenh` từ chối THẬT, kể cả các biến thể (đường dẫn, .exe, HOA/thường,
 * `git -C x push`); (3) không mục trắng hợp lệ nào khớp khoá cứng (vành đai chỉ THÊM từ chối); (4) mục `mo-ta` không bao giờ dùng để so khớp argv.
 * Đột biến: xoá một mục khỏi hằng ⇒ đỏ; đổi một khuôn ⇒ đỏ; bỏ nhánh `git` rộng ⇒ đỏ.
 */
import { describe, expect, it } from "vitest";
import { LENH_KHOA_CUNG, tenChuongTrinh, timLenhKhoaCung } from "../../../shared/agentCore/lenhKhoaCung";
import { DANH_SACH_TRANG, MA_TU_CHOI_LENH, phanQuyetLenh } from "./repoCommandSandbox";

/** Danh sách cấm CŨ (census `repoCommand.census.test.ts` trước Đợt 11.3-A) + git restore/switch/stash — PHẢI vẫn nằm trong hằng. */
const CAM_CU_TIEU_LENH = ["checkout", "reset", "clean", "rm", "revert", "push", "commit", "publish"];
const CAM_CU_GIT_PHU = ["restore", "switch", "stash"];

const argvMau = (m: (typeof LENH_KHOA_CUNG)[number]) => [...m.khuon, ...(m.khuon[0] === "git" ? [] : [])];

describe("lenhKhoaCung — siêu tập của danh sách cấm cũ", () => {
  it("mọi tiểu lệnh/lệnh cũ đều có trong hằng", () => {
    const tatCa = new Set(LENH_KHOA_CUNG.flatMap((m) => m.khuon));
    for (const k of [...CAM_CU_TIEU_LENH, ...CAM_CU_GIT_PHU]) expect(tatCa.has(k), k).toBe(true);
  });
  it("id duy nhất; mục argv có khuôn, mục mô tả khuôn rỗng", () => {
    const ids = LENH_KHOA_CUNG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of LENH_KHOA_CUNG) {
      if (m.loai === "argv") expect(m.khuon.length, m.id).toBeGreaterThan(0);
      else expect(m.khuon, m.id).toEqual([]);
    }
  });
});

describe("lenhKhoaCung — vành đai máy chủ", () => {
  it("MỌI mục argv bị phanQuyetLenh từ chối THẬT với CMD_NOT_ALLOWED 'KHOÁ CỨNG'", () => {
    for (const m of LENH_KHOA_CUNG.filter((x) => x.loai === "argv")) {
      const r = phanQuyetLenh(argvMau(m));
      expect(r.ok, m.id).toBe(false);
      if (!r.ok) {
        expect(r.ma, m.id).toBe(MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
        expect(r.chiTiet, m.id).toContain("KHOÁ CỨNG");
      }
    }
  });
  it("biến thể: đường dẫn đầy đủ, .exe, HOA/thường, cờ chen trước tiểu lệnh git, thêm đối số", () => {
    for (const a of [
      ["/usr/bin/git", "push"],
      ["C:\\Program Files\\Git\\bin\\git.exe", "push", "origin", "main"],
      ["GIT", "PUSH"],
      ["git", "-C", "x", "push"],
      ["git", "-c", "a=b", "reset", "--hard"],
      ["RM", "-rf", "x"],
      ["npm.cmd", "publish"],
      ["dotnet", "nuget", "push", "x.nupkg"],
      ["NPM", "run", "BUILD"],
    ]) {
      const r = phanQuyetLenh(a);
      expect(r.ok, a.join(" ")).toBe(false);
      if (!r.ok) expect(r.chiTiet, a.join(" ")).toContain("KHOÁ CỨNG");
    }
  });
  it("so khớp KHÔNG phân biệt HOA/thường và chuẩn hoá tên chương trình (đo thẳng timLenhKhoaCung — phanQuyetLenh vốn đã từ chối các biến thể này vì ngoài danh sách trắng)", () => {
    expect(timLenhKhoaCung(["GIT", "PUSH"])?.id).toBe("git-push");
    expect(timLenhKhoaCung(["C:\\Git\\Git.EXE", "Reset", "--hard"])?.id).toBe("git-reset");
    expect(timLenhKhoaCung(["C:/Git/git.exe", "reset"])?.id).toBe("git-reset");
    expect(timLenhKhoaCung(["Npm.CMD", "PUBLISH"])?.id).toBe("npm-publish");
    expect(timLenhKhoaCung(["NPM", "run", "BUILD"])?.id).toBe("npm-run-build");
  });
  it("không nhầm: lệnh chỉ ĐỌC của git hoặc lệnh khác không bị coi là khoá cứng", () => {
    for (const a of [["git", "status"], ["git", "diff"], ["git", "log"], ["npm", "run", "check"], ["dotnet", "test"], ["echo", "push"]]) {
      expect(timLenhKhoaCung(a), a.join(" ")).toBeNull();
    }
  });
  it("(vành đai chỉ THÊM từ chối) không mục DANH_SACH_TRANG nào khớp khoá cứng", () => {
    for (const mt of DANH_SACH_TRANG) {
      const argv = mt.khuon.map((k) => (k === null ? "x" : k));
      expect(timLenhKhoaCung(argv), mt.nhan).toBeNull();
    }
  });
  it("tenChuongTrinh chuẩn hoá", () => {
    expect(tenChuongTrinh("C:\\a\\Git.EXE")).toBe("git");
    expect(tenChuongTrinh("/x/y/npm.cmd")).toBe("npm");
    expect(tenChuongTrinh(5 as never)).toBe("");
  });
});
