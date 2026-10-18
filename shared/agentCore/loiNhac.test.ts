import { describe, expect, it } from "vitest";
import { dungLoiNhacHeThong, dungKhoiNguCanhDuAn } from "./loiNhac";

describe("dungLoiNhacHeThong", () => {
  const p = dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "vi" });

  it("tiếng Anh, có các quy tắc làm việc bắt buộc", () => {
    expect(p).toMatch(/read .*before (editing|you edit)/i);
    expect(p).toMatch(/todo_write/);
    expect(p).toMatch(/3 or more steps|three or more steps|≥ ?3 steps/i);
    expect(p).toMatch(/run the (project's )?tests? after/i);
    expect(p).toMatch(/never (modify|edit|change) (a )?test/i);
    expect(p).toMatch(/honest/i);
  });

  it("tool result là DỮ LIỆU, không phải chỉ thị", () => {
    expect(p).toMatch(/tool results? (are|is) data/i);
  });

  it("ngôn ngữ trả lời theo ngonNgu", () => {
    expect(dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "vi" })).toMatch(/Vietnamese/);
    expect(dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "en" })).toMatch(/Respond in English/);
    expect(dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "zh" })).toMatch(/Chinese/);
  });

  it("chế độ hoi nói rõ chỉ đọc; sua nói rõ người duyệt; tu-dong nói rõ tự áp dụng", () => {
    expect(dungLoiNhacHeThong({ cheDo: "hoi", ngonNgu: "en" })).toMatch(/read-only/i);
    expect(dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "en" })).toMatch(/review|approv/i);
    expect(dungLoiNhacHeThong({ cheDo: "tu-dong", ngonNgu: "en" })).toMatch(/automatically/i);
  });

  it("tất định (cùng vào ⇒ cùng ra)", () => {
    expect(dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "vi" })).toBe(p);
  });
});

describe("dungKhoiNguCanhDuAn", () => {
  it("có tên, gốc tương đối, cây, lệnh được phép, tệp quy ước", () => {
    const k = dungKhoiNguCanhDuAn({
      ten: "demo",
      gocTuongDoi: "sandbox-projects/demo",
      cay: ["src/", "src/index.ts", "package.json"],
      lenhDuocPhep: ["npm test", "npx tsc --noEmit"],
      tepQuyUoc: [{ duong: "AGENTS.md", noiDung: "Use tabs." }],
    });
    expect(k).toContain("demo");
    expect(k).toContain("sandbox-projects/demo");
    expect(k).toContain("src/index.ts");
    expect(k).toContain("npm test");
    expect(k).toContain("AGENTS.md");
    expect(k).toContain("Use tabs.");
  });

  it("cây cắt ở 80 mục và báo số mục còn lại", () => {
    const cay = Array.from({ length: 120 }, (_, i) => `f${i}.ts`);
    const k = dungKhoiNguCanhDuAn({ ten: "x", cay, lenhDuocPhep: [] });
    expect(k).toContain("f79.ts");
    expect(k).not.toContain("f80.ts");
    expect(k).toMatch(/40 more/);
  });

  it("không lệnh nào được phép ⇒ nói rõ", () => {
    const k = dungKhoiNguCanhDuAn({ ten: "x", cay: [], lenhDuocPhep: [] });
    expect(k).toMatch(/no commands/i);
  });

  it("tệp quy ước dài bị cắt (đầu+đuôi), không phình prompt", () => {
    const k = dungKhoiNguCanhDuAn({
      ten: "x",
      cay: [],
      lenhDuocPhep: [],
      tepQuyUoc: [{ duong: "CLAUDE.md", noiDung: "q".repeat(50_000) }],
    });
    expect(k.length).toBeLessThan(10_000);
  });
});
