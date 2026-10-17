/**
 * ★★★ ĐỢT 4B — lưới lệnh gạch (/fix /test /explain /commit) + dựng ngữ cảnh agent (thẻ @, tệp quy ước, bộ nhớ).
 */
import { describe, it, expect } from "vitest";
import { docLenhGach, dungCauHoiLenhGach } from "./lenhGach";
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
