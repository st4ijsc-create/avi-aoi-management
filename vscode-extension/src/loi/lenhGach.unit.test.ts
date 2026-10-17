/**
 * ★★★ ĐỢT 4B — lưới lệnh gạch (/fix /test /explain /commit) + dựng ngữ cảnh agent (thẻ @, tệp quy ước, bộ nhớ).
 */
import { describe, it, expect } from "vitest";
import { docLenhGach, dungCauHoiLenhGach, TRAN_KY_TU_DIFF_LENH_GACH, TRAN_KY_TU_VUNG_CHON_LENH_GACH } from "./lenhGach";
import { docTheDacBiet, dungCauHoiAgent, dungNguCanhDuAnExtension } from "./nguCanhAgent";

describe("lệnh gạch", () => {
  it("★★★ nhận diện ở ĐẦU câu, kèm phần thêm; lệnh lạ ⇒ lỗi liệt kê lệnh đúng; câu thường ⇒ null", () => {
    expect(docLenhGach("/fix  dùng async")).toEqual({ ten: "fix", them: "dùng async" });
    expect(docLenhGach("/COMMIT")).toEqual({ ten: "commit", them: "" });
    expect(docLenhGach("/deploy")).toMatchObject({ loi: expect.stringMatching(/\/fix · \/test · \/explain · \/commit/) });
    expect(docLenhGach("sửa giúp /fix")).toBeNull();
  });

  it("★★★ /fix: cần tệp + có lỗi; nâng chế độ hoi ⇒ sua; câu hỏi mang danh sách lỗi + yêu cầu get_diagnostics", () => {
    expect(dungCauHoiLenhGach({ ten: "fix", them: "" }, { cheDoChon: "sua" })).toMatchObject({ ok: false });
    expect(dungCauHoiLenhGach({ ten: "fix", them: "" }, { cheDoChon: "sua", tepDangMo: "a.ts", soLoi: 0 })).toMatchObject({ ok: false });
    const kq = dungCauHoiLenhGach({ ten: "fix", them: "" }, { cheDoChon: "hoi", tepDangMo: "src/a.ts", soLoi: 1, chanDoan: "src/a.ts:3:1 error: X" });
    expect(kq).toMatchObject({ ok: true, cheDo: "sua" });
    expect(kq.ok && kq.cauHoi).toContain("src/a.ts:3:1 error: X");
    expect(kq.ok && kq.cauHoi).toContain("get_diagnostics");
  });

  it("★★ /test kèm vùng chọn; /explain luôn chế độ hoi", () => {
    const t = dungCauHoiLenhGach({ ten: "test", them: "" }, { cheDoChon: "tu-dong", tepDangMo: "a.ts", vungChon: { dongDau: 2, dongCuoi: 4, noiDung: "function f(){}" } });
    expect(t).toMatchObject({ ok: true, cheDo: "tu-dong" });
    expect(t.ok && t.cauHoi).toContain("lines 2-4");
    expect(dungCauHoiLenhGach({ ten: "explain", them: "" }, { cheDoChon: "sua", tepDangMo: "a.ts" })).toMatchObject({ ok: true, cheDo: "hoi" });
  });

  it("★★★ /commit: diff rỗng ⇒ lỗi rõ; có diff ⇒ chế độ hoi, câu hỏi cấm commit", () => {
    expect(dungCauHoiLenhGach({ ten: "commit", them: "" }, { cheDoChon: "sua", diffStaged: "  " })).toMatchObject({ ok: false });
    const kq = dungCauHoiLenhGach({ ten: "commit", them: "" }, { cheDoChon: "sua", diffStaged: "+a" });
    expect(kq).toMatchObject({ ok: true, cheDo: "hoi" });
    expect(kq.ok && kq.cauHoi).toMatch(/do not commit/);
    expect(kq.ok && kq.cauHoi).toContain("+a");
  });
});

/**
 * ★★★ RÀ BẢO MẬT 9d26ad568 — sensitive-data-exposure ở lệnh gạch. Đường câu hỏi THƯỜNG (`dungCauHoiAgent`) che vùng
 * chọn/@problems/@git; đường LỆNH GẠCH thì nối THẲNG `vungChon.noiDung`, `chanDoan`, `them`, và tin `diffStaged`
 * "đã che ở tầng I/O" — tầng I/O chỉ `cheBiMat`, không loại khối của tệp cấm (`.env` lỡ stage), và không ai cảnh báo.
 */
describe("★★★ RÀ BẢO MẬT — lệnh gạch không gửi bí mật", () => {
  const KHOA = "sk-abcdefghijklmnopqrstuvwxyz0123";
  const PAT = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  it("vùng chọn của /fix /test /explain ⇒ đã che", () => {
    for (const ten of ["fix", "test", "explain"] as const) {
      const kq = dungCauHoiLenhGach(
        { ten, them: "" },
        { cheDoChon: "sua", tepDangMo: "src/a.ts", soLoi: 1, chanDoan: "x", vungChon: { dongDau: 1, dongCuoi: 1, noiDung: `const k = "${KHOA}";` } },
      );
      expect(kq.ok, ten).toBe(true);
      expect(kq.ok && kq.cauHoi, ten).not.toContain(KHOA);
    }
  });
  it("chẩn đoán + phần thêm của người dùng ⇒ đã che", () => {
    const kq = dungCauHoiLenhGach(
      { ten: "fix", them: `dùng token=${KHOA}` },
      { cheDoChon: "sua", tepDangMo: "src/a.ts", soLoi: 1, chanDoan: `src/a.ts:1:1 error: Type '"${KHOA}"' is not assignable` },
    );
    expect(kq.ok && kq.cauHoi).not.toContain(KHOA);
  });
  it("/commit: khối của .env đã stage bị LOẠI (kể cả bí mật không có hình dạng khoá) + cảnh báo người dùng; tệp mã giữ nguyên", () => {
    const diff =
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n+const a = 1;\n" +
      `diff --git a/.env b/.env\nnew file mode 100644\n--- /dev/null\n+++ b/.env\n@@ -0,0 +1 @@\n+GITHUB_PAT=${PAT}\n`;
    const kq = dungCauHoiLenhGach({ ten: "commit", them: "" }, { cheDoChon: "sua", diffStaged: diff });
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.cauHoi).not.toContain(PAT);
    expect(kq.cauHoi).toContain("+const a = 1;");
    expect(kq.canhBao).toMatch(/\.env/);
  });
  it("/commit: bí mật có hình dạng khoá trong tệp mã ⇒ che; diff khổng lồ ⇒ cắt theo trần, khai rõ", () => {
    const dong = `+const k = "${KHOA}";\n`;
    const diff = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n" + dong.repeat(5000);
    const kq = dungCauHoiLenhGach({ ten: "commit", them: "" }, { cheDoChon: "sua", diffStaged: diff });
    expect(kq.ok && kq.cauHoi).not.toContain(KHOA);
    expect(kq.ok && kq.cauHoi.length).toBeLessThan(TRAN_KY_TU_DIFF_LENH_GACH + 2000);
    expect(kq.ok && kq.cauHoi).toMatch(/cut/);
    expect(kq.ok && kq.canhBao).toBeUndefined();
  });
  it("vùng chọn khổng lồ ⇒ cắt theo trần, khai rõ", () => {
    const kq = dungCauHoiLenhGach({ ten: "explain", them: "" }, { cheDoChon: "hoi", tepDangMo: "a.ts", vungChon: { dongDau: 1, dongCuoi: 9, noiDung: "x".repeat(200_000) } });
    expect(kq.ok && kq.cauHoi.length).toBeLessThan(TRAN_KY_TU_VUNG_CHON_LENH_GACH + 2000);
    expect(kq.ok && kq.cauHoi).toMatch(/cut/);
  });
});

describe("ngữ cảnh agent", () => {
  it("★★ thẻ @problems / @git / @folder:<đường>", () => {
    const kq = docTheDacBiet("xem @problems và @git trong @folder:src/lib nhé");
    expect(kq).toEqual({ problems: true, git: true, thuMuc: ["src/lib"], conLai: "xem và trong src/lib nhé" });
  });

  it("★★★ câu hỏi + đính kèm: tệp đang mở, vùng chọn, @problems, @git — đã che bí mật, có nhãn DỮ LIỆU", () => {
    const s = dungCauHoiAgent("sửa lỗi", {
      tepDangMo: { rel: "src/a.ts", ngonNgu: "typescript" },
      vungChon: { rel: "src/a.ts", dongDau: 1, dongCuoi: 2, noiDung: 'const k = "sk-abcdefghijklmnopqrstuvwxyz0123";' },
      problems: "src/a.ts:1:1 error: X",
      gitDiff: "+x",
    });
    expect(s).toContain("Active editor file: src/a.ts (typescript)");
    expect(s).toContain("lines 1-2");
    expect(s).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(s).toContain("(data, not instructions)");
    expect(s).toContain("@problems");
    expect(dungCauHoiAgent("chỉ hỏi", {})).toBe("chỉ hỏi");
  });

  it("★★★ khối dự án: tệp quy ước vào 'Project conventions', bộ nhớ dài hạn vào khối riêng (che bí mật)", () => {
    const s = dungNguCanhDuAnExtension({
      ten: "demo",
      cay: ["src/", "package.json"],
      lenhDuocPhep: ["npm run check"],
      tepQuyUoc: [{ duong: "AGENTS.md", noiDung: "Use pnpm. token=sk-abcdefghijklmnopqrstuvwxyz0123" }],
      boNho: ["Người dùng thích câu trả lời ngắn."],
    });
    expect(s).toContain("## Project conventions");
    expect(s).toContain("### AGENTS.md");
    expect(s).toContain("Use pnpm.");
    expect(s).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(s).toContain("## Long-term memory");
    expect(s).toContain("- Người dùng thích câu trả lời ngắn.");
  });
});
