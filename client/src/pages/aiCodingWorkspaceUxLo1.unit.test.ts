/**
 * ★★★ 2026-08-23 · UX LÔ 1 — CENSUS **NỐI DÂY** cho các mục A1/A3/B1/B2/C2-i/D1/D2 trên trang
 * `/ai-coding-workspace`.
 *
 * Cùng lý do với `aiCodingWorkspaceVong.unit.test.ts`: thứ được canh là **hình dạng đường đi**
 * (câu server có TỚI chân thẻ không · phép lọc mốc có đứng ở CHỖ RENDER không · gợi ý có đi qua
 * bảng-một-chỗ không), và mệnh đề tĩnh thì đọc mã là phép đo đúng trục. Logic THUẦN của từng mục
 * đã có lưới riêng (`goiYDuAn` · `cayTepHienThi` · `aiCodingMoc` · `aiCodingTuChoi` ·
 * `confirmActionCardChan`); file này chỉ đo lời NỐI DÂY vào trang.
 *
 * ⚠ CRLF: chuẩn hoá ngay lúc đọc (bài học doc 79 — sửa ở thiết bị đo, không ở vật được đo).
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

function docLocale(lg: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(join(LOCALES, `${lg}.json`), "utf8")) as Record<string, unknown>;
  const ra: Record<string, unknown> = {};
  const di = (o: unknown, tien: string) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const khoa = tien ? `${tien}.${k}` : k;
      if (v && typeof v === "object") di(v, khoa);
      else ra[khoa] = v;
    }
  };
  di(raw, "");
  return ra;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 (A1) — câu kết cục của SERVER tới được chân thẻ duyệt", () => {
  it("★★★ trang truyền `message={ketCucThongDiep}` cho ConfirmActionCard (không truyền ⇒ chân thẻ nói dối 'không có quyền')", () => {
    expect(MA).toContain("message={ketCucThongDiep}");
    expect(MA).toContain("setKetCucThongDiep(cauDauKetCuc(out?.textSummary)");
  });

  it("★★★ transcript phân biệt LỆNH bị chặn với LƯỢT GHI bị từ chối (hai bản chất, hai câu)", () => {
    expect(MA).toContain("repoWs.chat.cmdRejected");
    expect(MA).toContain("repoWs.chat.writeRejected");
  });

  it("★★ mọi điểm mở thẻ mới đều XOÁ câu kết cục cũ (câu của lệnh trước không dán sang thẻ sau)", () => {
    // 1 khai báo + ≥4 lượt reset (handleSend · onPendingAction · chonPhien · phienMoi) + 1 lượt gán.
    expect((MA.match(/setKetCucThongDiep\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 (A3) — câu 'vòng TẮT' theo VAI: admin thấy tên cờ, người thường thấy 'liên hệ quản trị viên'", () => {
  it("★★★ VongTuDongCard nhận `laAdmin` và rẽ giữa stop.off / stop.offUser", () => {
    expect(MA).toContain('laAdmin={user?.role === "admin"}');
    expect(MA).toContain("repoWs.loop.stop.off");
    expect(MA).toContain("repoWs.loop.stop.offUser");
  });

  it("★★★ ba locale: bản offUser KHÔNG nêu tên biến môi trường; bản off (admin) thì CÓ", () => {
    for (const lg of ["vi", "en", "zh"]) {
      const d = docLocale(lg);
      expect(String(d["repoWs.loop.stop.offUser"] ?? ""), `${lg}: thiếu offUser`).not.toBe("");
      expect(String(d["repoWs.loop.stop.offUser"]), `${lg}: offUser không được bảo người thường sửa .env`).not.toContain(
        "AI_CODING_AUTOLOOP",
      );
      expect(String(d["repoWs.loop.stop.off"]), `${lg}: bản admin phải giữ tên cờ`).toContain("AI_CODING_AUTOLOOP");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 (B1) — gợi ý mở đầu đi qua BẢNG MỘT CHỖ `goiYTheoDuAn`, không còn ba nút viết cứng", () => {
  it("★★★ trang gọi goiYTheoDuAn(projectId) và lọc theo quyền chạy lệnh", () => {
    expect(MA).toContain("goiYTheoDuAn(projectId)");
    expect(MA).toContain("!g.canChayLenh || canExec");
    // Ba câu viết cứng cũ không còn nằm NGOÀI bảng (bảng giữ chúng cho dự án repo).
    expect(MA).not.toContain('handleSend(t("repoWs.suggest.read"');
  });

  it("★★ chín khoá gợi ý có đủ BA locale", () => {
    const khoa = ["read", "grep", "check", "csharpRead", "csharpTest", "csharpWhy", "reactRead", "reactTest", "reactWhy"];
    for (const lg of ["vi", "en", "zh"]) {
      const d = docLocale(lg);
      for (const k of khoa) {
        expect(String(d[`repoWs.suggest.${k}`] ?? ""), `${lg}: thiếu repoWs.suggest.${k}`).not.toBe("");
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 (B2) — kỳ vọng thời gian + tooltip ba huy hiệu", () => {
  it("★★★ cạnh spinner có dòng kỳ vọng THEO SỐ ĐO (8–20 giây), không phải một con số chép từ tài liệu", () => {
    expect(MA).toContain("repoWs.chat.thinkingEta");
    for (const lg of ["vi", "en", "zh"]) {
      const eta = String(docLocale(lg)["repoWs.chat.thinkingEta"] ?? "");
      expect(eta, `${lg}: thiếu thinkingEta`).not.toBe("");
      expect(eta, `${lg}: kỳ vọng phải theo số ĐO 8–20`).toContain("8–20");
      expect(eta, `${lg}: '3–5 phút' là con số chép, không phải số đo`).not.toMatch(/3\s*[–-]\s*5/);
    }
  });

  it("★★ ba huy hiệu ('đọc' · 'chạy lệnh' · 'Cục bộ') đều có TooltipContent với khoá badgeTip.*", () => {
    for (const k of ["badgeTip.read", "badgeTip.exec", "badgeTip.execOff", "badgeTip.local"]) {
      expect(MA, `thiếu repoWs.${k}`).toContain(`repoWs.${k}`);
      for (const lg of ["vi", "en", "zh"]) {
        expect(String(docLocale(lg)[`repoWs.${k}`] ?? ""), `${lg}: thiếu repoWs.${k}`).not.toBe("");
      }
    }
    expect(MA).toContain("<TooltipContent");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 (C2-i) — dòng kết luận sau lượt lệnh đi qua `ketLuanTest` (shared, chắc-mới-nói)", () => {
  it("★★★ nhập + GỌI ketLuanTest từ @shared/aiCodingLoop — không một regex 'Passed!' thứ hai nào trong trang", () => {
    expect(MA).toMatch(/import\s*\{[^}]*ketLuanTest[^}]*\}\s*from\s*"@shared\/aiCodingLoop"/s);
    expect((MA.match(/ketLuanTest\(/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(MA, "trang tự parse đầu ra test = bản sao thứ hai của bộ đọc").not.toMatch(/Failed:\s*\\d|match\(\/Passed/);
  });

  it("★★ hai khoá câu kết luận (xanh/đỏ) có đủ ba locale", () => {
    for (const lg of ["vi", "en", "zh"]) {
      const d = docLocale(lg);
      expect(String(d["repoWs.chat.klXanh"] ?? ""), lg).toContain("✅");
      expect(String(d["repoWs.chat.klDo"] ?? ""), lg).toContain("❌");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 (D1) — phép lọc mốc đứng ĐÚNG CHỖ RENDER, không chạm dữ liệu", () => {
  it("★★★ CẢ HAI điểm <Streamdown> (tĩnh + streaming) đều đi qua lamSachMocChoHienThi", () => {
    expect((MA.match(/<Streamdown[^>]*>\{lamSachMocChoHienThi\(/g) ?? []).length).toBe(2);
    // Không còn một điểm render markdown assistant nào NGOÀI phép lọc.
    expect((MA.match(/<Streamdown/g) ?? []).length).toBe(2);
  });

  it("★★★ phép lọc KHÔNG áp lên đường DỮ LIỆU: luuTranscript/handleSend không gọi nó", () => {
    const iLuu = MA.indexOf("const luuTranscript");
    const iSend = MA.indexOf("const handleSend");
    for (const [ten, i] of [["luuTranscript", iLuu], ["handleSend", iSend]] as const) {
      expect(i, ten).toBeGreaterThan(0);
      const than = MA.slice(i, MA.indexOf("}, [", i));
      expect(than, `${ten} không được lọc mốc — dữ liệu phải nguyên byte`).not.toContain("lamSachMocChoHienThi");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§7 (D2) — cây tệp lọc nhiễu ở TẦNG HIỂN THỊ + nhớ dự án theo NGƯỜI DÙNG", () => {
  it("★★★ FolderChildren chia tệp qua chiaTepHienThi + nút 'Hiện tệp khác (N)'", () => {
    expect(MA).toContain("chiaTepHienThi(");
    expect(MA).toContain("repoWs.tree.showOther");
    expect(MA).toContain("data-hien-tep-khac");
    for (const lg of ["vi", "en", "zh"]) {
      expect(String(docLocale(lg)["repoWs.tree.showOther"] ?? ""), lg).toContain("{{n}}");
    }
  });

  it("★★★ dự án được nhớ qua localStorage KHOÁ THEO userId (sessionStorage giữ làm liên tục cùng-tab)", () => {
    expect(MA).toContain(".u${user.id}");
    expect(MA).toContain("localStorage.setItem(khoaLuuTheoUser");
    expect(MA).toContain("localStorage.getItem(khoaLuuTheoUser");
    expect(MA, "vẫn chỉ lưu MỘT id danh sách trắng — không một đường dẫn nào").not.toMatch(/localStorage\.setItem\([^)]*goc/);
  });
});
