/**
 * ★★★ 2026-08-23 · LÔ 3 — LƯỚI RENDER CHO **NHÃN TIN CẬY KHỐI MÃ** (`KhoiMaCoNhan`).
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (glob vitest client; đuôi khác bị bỏ qua IM LẶNG).
 *
 * Cùng khuôn `theDuyetDiff.unit.test.ts`: dựng CÂY THẬT bằng `renderToStaticMarkup` và hỏi những
 * câu chỉ cây thật trả lời được — một lưới quét văn bản mã nguồn sẽ xanh chỉ vì chuỗi nhãn CÓ trong
 * tệp, kể cả khi nhánh render không bao giờ chạy. Các ca ở đây canh thẳng hai đột biến:
 *   (d) gỡ băng nhãn tầng 1        → §1 đỏ;
 *   (e) chip hiện cả khi `khong-du-can-cu` → §3 đỏ (ca 0-chip đứng CẠNH ca dương cùng khối —
 *       chống tự thoả: phải chứng minh bộ chip render ĐƯỢC rồi mới được khẳng định nó im lặng).
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));

/** `t` giả TRA THẬT `vi.json` — gõ sai khoá ⇒ `‹THIẾU:…›` ⇒ ca ĐỎ (không phải lưới giả). */
function tThat(key: string, a?: unknown, b?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : b) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tThat, i18n: { language: "vi", changeLanguage: () => {} } }),
}));

/** React SSR thoát `&<>"` — mọi phép so chuỗi với HTML phải đi qua đây. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const { KhoiMaCoNhan, layMaVaNhanFence, taoBoKhoiMaCoNhan } = await import("./KhoiMaCoNhan");

/** Nút hast của một khối fence — đúng hình dạng Streamdown truyền cho component `pre` (passNode). */
function nutPre(ma: string, nhanFence: string | null) {
  return {
    type: "element",
    tagName: "pre",
    children: [
      {
        type: "element",
        tagName: "code",
        properties: { className: nhanFence ? [`language-${nhanFence}`] : [] },
        children: [{ type: "text", value: ma }],
      },
    ],
  };
}

function ve(ma: string, nhanFence: string | null, neo: unknown = null, luc: string | null = null): string {
  return renderToStaticMarkup(
    createElement(
      KhoiMaCoNhan as never,
      { node: nutPre(ma, nhanFence), neo, luc } as never,
      createElement("pre", {}, createElement("code", {}, ma)),
    ),
  );
}

/** Tệp trên đĩa (CRLF) CHƯA có guard — cùng oracle với `soKhoiMa.unit.test.ts`. */
const TEP = [
  "public class Calculator",
  "{",
  "    public int Divide(int a, int b)",
  "    {",
  "        return a / b;",
  "    }",
  "}",
].join("\r\n");
const NEO = { duongDan: "src/Calculator.cs", noiDung: TEP, biCat: false };

const KHOI_4_DONG = "public int Divide(int a, int b)\n{\n    return a / b;\n}\n";
const KHOI_CO_GUARD =
  'public int Divide(int a, int b)\n{\n    if (b == 0) throw new DivideByZeroException("b = 0");\n    return a / b;\n}\n';
/** Trích ĐÚNG tệp và ≥ 3 dòng chuẩn (sàn của phép so) — khối đủ căn cứ để ra `khop`. */
const KHOI_TRICH_DUNG =
  "public class Calculator\n{\n    public int Divide(int a, int b)\n    {\n        return a / b;\n    }\n}\n";
const KHOI_3_DONG = "public class Calculator\npublic int Divide(int a, int b)\nreturn a / b;\n";

const CAU_NGUON_GOC = VI.repoWs.khoi.modelSinh as string;

describe("§1 TẦNG 1 — băng nhãn nguồn gốc theo ngưỡng dòng", () => {
  it("★★★ (đột biến d) khối ≥ 4 dòng ⇒ BĂNG NHÃN có thật trong HTML, đúng câu vi.json", () => {
    const html = ve(KHOI_4_DONG, "csharp");
    expect(html).toContain("data-nhan-model-sinh");
    expect(html).toContain(esc(CAU_NGUON_GOC));
    expect(html).not.toContain("‹THIẾU:");
  });

  it("★ ca ÂM chống nhiễu: khối < 4 dòng ⇒ KHÔNG băng nhãn — chỉ viền nhạt + tooltip cùng câu", () => {
    const html = ve(KHOI_3_DONG, "csharp");
    expect(html).not.toContain("data-nhan-model-sinh");
    // Tooltip = CÙNG câu, một khoá dịch — nằm trong thuộc tính `title` của hộp bọc.
    expect(html).toContain(`title="${esc(CAU_NGUON_GOC)}"`);
    expect(html).toContain("border-dashed");
  });

  it("khối ≥ 4 dòng KHÔNG mang tooltip (băng nhãn đã nói rồi — không nói hai lần)", () => {
    expect(ve(KHOI_4_DONG, "csharp")).not.toContain(`title="${esc(CAU_NGUON_GOC)}"`);
  });

  it("`pre` không chứa `code` (không phải khối fence) ⇒ pass-through, không hộp nhãn nào", () => {
    const html = renderToStaticMarkup(
      createElement(KhoiMaCoNhan as never, { node: { type: "element", tagName: "pre", children: [] } } as never, "x"),
    );
    expect(html).not.toContain("data-khoi-ma-model");
  });
});

describe("§2 TẦNG 2 — chip đối chiếu, CHẮC MỚI NÓI", () => {
  it('★★★ khối có guard KHÔNG tồn tại trên đĩa ⇒ chip `khac` + đúng câu "đừng tin" (kèm mốc-nhận)', () => {
    const html = ve(KHOI_CO_GUARD, "csharp", NEO, "10:02:03");
    expect(html).toContain('data-chip-khoi-ma="khac"');
    expect(html).toContain(esc(tThat("repoWs.khoi.khacDia", { luc: "10:02:03" })));
    expect(html).toContain("10:02:03");
  });

  it("khối trích đúng tệp (≥ 3 dòng chuẩn) ⇒ chip `khop` màu trầm", () => {
    const html = ve(KHOI_TRICH_DUNG, "csharp", NEO, "10:02:03");
    expect(html).toContain('data-chip-khoi-ma="khop"');
    expect(html).toContain(esc(tThat("repoWs.khoi.khopDia", { luc: "10:02:03" })));
    expect(html).not.toContain('data-chip-khoi-ma="khac"');
  });

  it("★ khối dưới SÀN dòng chuẩn (2 dòng nghĩa) ⇒ im lặng, KỂ CẢ khi trích đúng — khớp giả rẻ", () => {
    // `KHOI_4_DONG` có 4 dòng THÔ (đủ băng nhãn) nhưng chỉ 2 dòng CHUẨN sau khi bỏ ngoặc — phép so
    // không được nói gì. Chính ca này từng viết SAI kỳ vọng (`khop`) và bị lưới bác — giữ lại làm mốc.
    const html = ve(KHOI_4_DONG, "csharp", NEO, "10:02:03");
    expect(html).not.toContain("data-chip-khoi-ma");
    expect(html).toContain("data-nhan-model-sinh");
  });

  it("chip `khac` mang lớp CẢNH BÁO, chip `khop` thì không (nhãn khác nhau phải NHÌN khác nhau)", () => {
    expect(ve(KHOI_CO_GUARD, "csharp", NEO, "x")).toContain("amber");
    expect(ve(KHOI_TRICH_DUNG, "csharp", NEO, "x")).not.toContain("amber");
  });
});

describe("§3 `khong-du-can-cu` ⇒ IM LẶNG TUYỆT ĐỐI (0 chip) — cạnh ca dương chống tự thoả", () => {
  it("★★★ (đột biến e) CÙNG khối từng ra chip ở §2, neo bị CẮT ⇒ 0 chip nào trong HTML", () => {
    // §2 vừa chứng minh bộ chip render ĐƯỢC với đúng khối này ⇒ ca 0-chip dưới đây đỏ được.
    const html = ve(KHOI_TRICH_DUNG, "csharp", { ...NEO, biCat: true }, "10:02:03");
    expect(html).not.toContain("data-chip-khoi-ma");
    // Băng nhãn tầng 1 vẫn còn — tầng 2 im lặng không được kéo tầng 1 im theo.
    expect(html).toContain("data-nhan-model-sinh");
  });

  it("khối lạ hoàn toàn (0 dòng chung) ⇒ 0 chip", () => {
    const html = ve("def divide(a, b):\n    result = a / b\n    return result\n    # py\n", "cs", NEO, "x");
    expect(html).not.toContain("data-chip-khoi-ma");
  });

  it("không neo ⇒ 0 chip; fence lệch đuôi tệp (python↔.cs) ⇒ 0 chip; fence không nhãn ⇒ 0 chip", () => {
    // Dùng đúng khối đã ra chip `khop` ở §2 — các ca âm này đỏ được nếu CỔNG NGÔN NGỮ/neo bị gỡ.
    expect(ve(KHOI_TRICH_DUNG, "csharp", null, "x")).not.toContain("data-chip-khoi-ma");
    expect(ve(KHOI_TRICH_DUNG, "python", NEO, "x")).not.toContain("data-chip-khoi-ma");
    expect(ve(KHOI_TRICH_DUNG, null, NEO, "x")).not.toContain("data-chip-khoi-ma");
  });
});

describe("§4 bóc mã + nhãn fence từ nút hast (`layMaVaNhanFence`)", () => {
  it("đọc `language-*` từ className mảng LẪN chuỗi; nối text con cháu", () => {
    expect(layMaVaNhanFence(nutPre("a\nb", "csharp"))).toEqual({ ma: "a\nb", nhanFence: "csharp" });
    const nutChuoi = {
      children: [{ tagName: "code", properties: { className: "language-ts extra" }, children: [{ type: "text", value: "x" }] }],
    };
    expect(layMaVaNhanFence(nutChuoi)).toEqual({ ma: "x", nhanFence: "ts" });
    expect(layMaVaNhanFence(nutPre("x", null))).toEqual({ ma: "x", nhanFence: null });
  });

  it("không có `code` / node rỗng ⇒ null (caller pass-through)", () => {
    expect(layMaVaNhanFence({ children: [] })).toBeNull();
    expect(layMaVaNhanFence(null)).toBeNull();
  });
});

describe("§5 `taoBoKhoiMaCoNhan` — bộ component cho <Streamdown> chỉ ghi đè `pre`", () => {
  it("chỉ MỘT khoá `pre` (ghi đè `code` là phá Shiki/nút chép — xem docblock component)", () => {
    const bo = taoBoKhoiMaCoNhan(null, null);
    expect(Object.keys(bo)).toEqual(["pre"]);
  });

  it("pre của bộ CÓ neo render được chip qua bao đóng (không cần prop nào ngoài node/children)", () => {
    const bo = taoBoKhoiMaCoNhan(NEO, "10:02:03");
    const html = renderToStaticMarkup(
      createElement(bo.pre as never, { node: nutPre(KHOI_CO_GUARD, "csharp") } as never),
    );
    expect(html).toContain('data-chip-khoi-ma="khac"');
    expect(html).toContain("10:02:03");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★ 2026-10-14 · Đợt 0.5 — khối ĐẦU RA LỆNH (kết quả run_command do server chạy thật, client chèn vào
 * hội thoại) từng bị gắn nhãn "Mã do model viết — có thể khác tệp trên đĩa": SAI nguồn gốc, và đúng
 * loại nhãn tin cậy sai mà lô 3 sinh ra để tránh. Nay client bọc đầu ra bằng fence riêng
 * (`khoiDauRaLenh`) và component đọc nhãn fence ấy ⇒ nhãn "đầu ra lệnh", không chip đối chiếu tệp.
 */
const { khoiDauRaLenh, boNhanDauRaLenhChoModel, NHAN_FENCE_DAU_RA_LENH } = await import("./KhoiMaCoNhan");

describe("§6 khối ĐẦU RA LỆNH — nhãn đúng nguồn gốc", () => {
  const DAU_RA = "$ git status\nOn branch main\nnothing to commit, working tree clean\n";

  it("★★★ fence đầu ra lệnh ⇒ nhãn 'đầu ra lệnh', KHÔNG nhãn 'Mã do model viết'", () => {
    const html = ve(DAU_RA, NHAN_FENCE_DAU_RA_LENH);
    expect(html).toContain("data-khoi-dau-ra-lenh");
    expect(html).toContain(esc(VI.repoWs.khoi.dauRaLenh));
    expect(html).not.toContain(esc(VI.repoWs.khoi.modelSinh));
    expect(html).not.toContain("data-khoi-ma-model");
  });

  it("★★ khối nhỏ (dưới ngưỡng băng) vẫn mang ĐÚNG câu đầu ra lệnh ở tooltip", () => {
    const html = ve("ok\n", NHAN_FENCE_DAU_RA_LENH);
    expect(html).toContain(`title="${esc(VI.repoWs.khoi.dauRaLenh)}"`);
  });

  it("★★ đầu ra lệnh KHÔNG bị đối chiếu với tệp trên đĩa (không chip) kể cả khi có neo", () => {
    const html = ve(DAU_RA, NHAN_FENCE_DAU_RA_LENH, NEO, "10:02:03");
    expect(html).not.toContain("data-chip-khoi-ma");
  });

  it("★★ khối mã model thường vẫn giữ nhãn model sinh (không hồi quy)", () => {
    const html = ve(KHOI_4_DONG, "csharp");
    expect(html).toContain(esc(VI.repoWs.khoi.modelSinh));
    expect(html).not.toContain("data-khoi-dau-ra-lenh");
  });

  it("★★★ khoiDauRaLenh bọc bằng fence riêng; đầu ra CHỨA ``` vẫn không phá khối (fence dài hơn)", () => {
    expect(khoiDauRaLenh("a\nb")).toBe("```" + NHAN_FENCE_DAU_RA_LENH + "\na\nb\n```");
    const coFence = "x\n```\ny\n";
    const k = khoiDauRaLenh(coFence);
    expect(k.startsWith("````" + NHAN_FENCE_DAU_RA_LENH + "\n")).toBe(true);
    expect(k.endsWith("\n````")).toBe(true);
  });

  it("★★ gửi lịch sử cho model: bỏ nhãn fence riêng (model không học bắt chước nhãn tin cậy)", () => {
    const noiDung = "Kết quả:\n\n" + khoiDauRaLenh("$ npm test\nok");
    const ra = boNhanDauRaLenhChoModel(noiDung);
    expect(ra).not.toContain(NHAN_FENCE_DAU_RA_LENH);
    expect(ra).toContain("```\n$ npm test\nok\n```");
  });
});
