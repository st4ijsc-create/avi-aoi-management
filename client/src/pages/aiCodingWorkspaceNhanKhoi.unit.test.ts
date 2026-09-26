/**
 * ★★★ 2026-08-23 · LÔ 3 — CENSUS **NỐI DÂY** nhãn tin cậy khối mã vào trang `/ai-coding-workspace`.
 *
 * Cùng lý do `aiCodingWorkspaceUxLo1.unit.test.ts`: logic THUẦN đã có lưới riêng (`soKhoiMa` ·
 * `khoiMaCoNhan` — render cây thật); file này chỉ đo LỜI NỐI DÂY: hai điểm `<Streamdown>` có nhận
 * bộ component nhãn không, neo có đi đúng đường (chỉ câu CÙNG LƯỢT), mốc-nhận có được đóng dấu ở
 * đúng chỗ nhận sự kiện không. Mệnh đề là hình-dạng-đường-đi ⇒ đọc mã là phép đo đúng trục.
 *
 * ⚠ CRLF: chuẩn hoá ngay lúc đọc (sửa ở thiết bị đo, không ở vật được đo).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = resolve(HERE, "..", "i18n", "locales");
const NGUON = readFileSync(join(HERE, "AICodingWorkspace.tsx"), "utf8").replace(/\r\n/g, "\n");

function boComment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const MA = boComment(NGUON);

function dem(s: string, kim: string): number {
  return s.split(kim).length - 1;
}

describe("§1 hai điểm <Streamdown> đều nhận bộ component nhãn — và neo đi ĐÚNG đường", () => {
  it("★★★ điểm TĨNH: câu cùng lượt nhận bộ CÓ neo, câu cũ nhận bộ KHÔNG neo (rẽ theo viTriNeo)", () => {
    expect(MA).toContain("components={i === viTriNeo ? boKhoiCoNeo : boKhoiKhongNeo}");
  });

  it("★★★ điểm STREAMING: luôn bộ CÓ neo (văn bản đang stream luôn cùng lượt với thẻ đang giữ)", () => {
    expect(MA).toMatch(/<Streamdown mode="streaming" components=\{boKhoiCoNeo\}>/);
  });

  it("★★ vẫn đúng hai điểm <Streamdown>, cả hai vẫn qua lamSachMocChoHienThi (không phá D1)", () => {
    expect(dem(MA, "<Streamdown")).toBe(2);
    expect((MA.match(/<Streamdown[^>]*>\{lamSachMocChoHienThi\(/g) ?? []).length).toBe(2);
  });

  it("★★ trang KHÔNG tự so khối — phép so chỉ sống trong component nhãn (một chỗ, có lưới riêng)", () => {
    expect(MA).not.toContain("soKhoiVoiTep");
  });
});

describe("§2 neo + mốc-nhận dựng ở đúng chỗ", () => {
  it("★★★ neo bóc từ thẻ tool ĐANG GIỮ qua bocTheDocTep (thẻ tổng {files} tự trượt vì không content)", () => {
    expect(MA).toContain("bocTheDocTep(streamTool.data");
    expect(MA).toContain("viTriCauTraLoiCungLuot(transcript)");
  });

  it("★★★ mốc-nhận đóng dấu NGAY trong onToolResult — cùng nhịp với setStreamTool", () => {
    expect(MA).toContain("onToolResult: (tr) => { setStreamTool(tr); setLucNhanTool(dinhDangLucNhan(new Date())); }");
  });

  it("★★ cả hai điểm AIToolResultCard đều nhận lucNhan (chip bằng chứng nói cùng mốc với chip đối chiếu)", () => {
    expect(dem(MA, "<AIToolResultCard")).toBe(2);
    expect(dem(MA, "lucNhan={lucNhanTool ?? undefined}")).toBe(2);
  });
});

describe("§3 bốn khoá nhãn có đủ BA locale (vi/en/zh)", () => {
  function docLocale(lg: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(LOCALES, `${lg}.json`), "utf8")) as Record<string, unknown>;
  }

  it("repoWs.khoi.{modelSinh,bangChung,khacDia,khopDia} — thiếu một là màn nói sai ngôn ngữ", () => {
    for (const lg of ["vi", "en", "zh"]) {
      const khoi = ((docLocale(lg) as any).repoWs ?? {}).khoi ?? {};
      for (const k of ["modelSinh", "bangChung", "khacDia", "khopDia"]) {
        expect(typeof khoi[k], `${lg}.json thiếu repoWs.khoi.${k}`).toBe("string");
      }
      // Hai câu mang mốc phải giữ placeholder {{luc}} ở CẢ ba locale (i18n:check PASS A cũng canh,
      // nhưng chỉ khi khoá có ở ≥1 locale — ghim ở đây cho chắc).
      expect(String(khoi.bangChung)).toContain("{{luc}}");
      expect(String(khoi.khacDia)).toContain("{{luc}}");
      expect(String(khoi.khopDia)).toContain("{{luc}}");
    }
  });
});
