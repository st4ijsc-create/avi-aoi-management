/**
 * ★★★ doc 79 · VÒNG TỰ ĐỘNG — CENSUS CHO **BỘ ĐIỀU KHIỂN Ở CLIENT**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO MỘT LƯỚI ĐỌC MÃ NGUỒN, KHÔNG PHẢI MỘT LƯỚI RENDER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Thứ file này canh **không phải hành vi của một component** mà là **hình dạng của đường đi**: có
 * đúng MỘT chỗ gọi xác nhận ghi hay không; cầu chì có được NỐI DÂY hay chỉ nằm im trong
 * `@shared/aiCodingLoop`; và mọi lý do dừng có câu chữ ở CẢ BA locale hay không. Ba câu hỏi ấy trả
 * lời được bằng cách đọc mã + đọc ba tệp dịch, và trả lời như thế thì **không thể xanh vì lý do
 * sai** (một lưới render có thể xanh nhờ một mock).
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • vòng tự bấm duyệt (thêm một lời gọi `confirmM.mutateAsync` thứ hai)   ⇒ §1 ĐỎ
 *   • bộ điều khiển bỏ qua `quyetDinhTiep` (tự viết điều kiện dừng tại chỗ) ⇒ §2 ĐỎ
 *   • bỏ tín hiệu "đề xuất lặp lại" (`deXuatLapLai`)                        ⇒ §2 ĐỎ
 *   • client tự đoán trần thay vì hỏi server (`cauHinhVong`)                ⇒ §2 ĐỎ
 *   • một lý do dừng KHÔNG có câu chữ ⇒ vòng dừng trong im lặng             ⇒ §3 ĐỎ
 *   • nhãn lượt/trần mất chỗ nội suy `{{luot}}`/`{{tran}}`                   ⇒ §3 ĐỎ
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LyDoDungVong } from "@shared/aiCodingLoop";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRANG = join(HERE, "AICodingWorkspace.tsx");
const LOCALES = resolve(HERE, "..", "i18n", "locales");
const NGUON = readFileSync(TRANG, "utf8");

/** Bỏ comment khối + comment dòng để phép ĐẾM không tính một lời gọi nằm trong chú thích. */
function boComment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const MA = boComment(NGUON);

function dem(hay: string, kim: string): number {
  return hay.split(kim).length - 1;
}

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
const VI = docLocale("vi");
const EN = docLocale("en");
const ZH = docLocale("zh");

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — CẦU CHÌ: lưới đang đọc đúng tệp thật", () => {
  it("★ đọc được trang và trang có bộ điều khiển vòng", () => {
    expect(NGUON.length).toBeGreaterThan(2_000);
    expect(MA).toContain("chayLuotVong");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — BẤT BIẾN HITL: đúng MỘT cửa xác nhận, và nó là nút của NGƯỜI", () => {
  /**
   * ⚠⚠⚠ Đây là phát biểu client-side của ranh giới đã chốt với chủ dự án: *"vòng tự động vẫn giữ
   * bạn duyệt mỗi lần GHI"*. Một lời gọi `confirmM.mutateAsync` THỨ HAI ở bất kỳ đâu trong file
   * này là một đường mà vòng có thể tự bấm duyệt hộ người dùng.
   */
  it("★★★ ĐÚNG MỘT lời gọi `confirmM.mutateAsync(` trong cả tệp", () => {
    expect(dem(MA, "confirmM.mutateAsync("), "thêm một cửa xác nhận thứ hai = vòng tự bấm duyệt hộ người").toBe(1);
  });

  it("★★★ lời gọi ấy nằm trong `handleConfirm` — thứ CHỈ được nối vào `onConfirm` của thẻ duyệt", () => {
    const i = MA.indexOf("const handleConfirm");
    const j = MA.indexOf("const handleCancel");
    expect(i, "không tìm thấy handleConfirm").toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(MA.slice(i, j)).toContain("confirmM.mutateAsync(");
    // Và `handleConfirm` chỉ được tham chiếu ở khai báo + hai prop `onConfirm` (hai thẻ duyệt).
    expect(dem(MA, "handleConfirm")).toBe(3);
    expect(dem(MA, "onConfirm={handleConfirm}")).toBe(2);
  });

  it("★★★ bộ điều khiển vòng KHÔNG gọi handleConfirm/confirmM (nó chỉ CHẠY test và ĐỀ XUẤT)", () => {
    const i = MA.indexOf("const chayLuotVong");
    const j = MA.indexOf("const handleConfirm");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    const than = MA.slice(i, j);
    expect(than).not.toContain("confirmM");
    expect(than).not.toContain("handleConfirm");
  });

  it("★★★ cửa chạy tự động DUY NHẤT là `chayKiemChung`; client KHÔNG gọi thẳng một tool ghi nào", () => {
    expect(MA).toContain("repoWorkspace.chayKiemChung.useMutation");
    expect(dem(MA, "kiemChungM.mutateAsync(")).toBe(1);
    expect(MA, "apply_diff chỉ được ĐỌC để nhận dạng thẻ, không bao giờ được client tự phát").not.toContain("apply_diff\", args");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — CẦU CHÌ ĐƯỢC NỐI DÂY (không phải nằm im trong module chung)", () => {
  it("★★★ nhập + GỌI `quyetDinhTiep` — trần và không-tiến-bộ đi qua đúng vị từ đã có lưới", () => {
    expect(MA).toMatch(/import\s*\{[^}]*quyetDinhTiep[^}]*\}\s*from\s*"@shared\/aiCodingLoop"/s);
    expect(dem(MA, "quyetDinhTiep(")).toBeGreaterThanOrEqual(1);
  });

  it("★★★ tín hiệu THỨ BA (`deXuatLapLai`) được gọi khi một đề xuất mới tới", () => {
    expect(dem(MA, "deXuatLapLai(")).toBeGreaterThanOrEqual(1);
  });

  it("★★★ đầu ra test được CHUẨN HOÁ trước khi băm (không thì cầu chì 'đầu ra lặp' không bao giờ nổ)", () => {
    expect(MA).toContain("bamChuoi(chuanHoaDauRa(");
  });

  it("★★★ TRẦN đến từ SERVER (`cauHinhVong`), client KHÔNG tự ghim một con số", () => {
    expect(MA).toContain("repoWorkspace.cauHinhVong.useQuery");
    expect(MA).toContain("cfg.tran");
    // `tran: 0` ở `VONG_RONG` là giá trị RỖNG (chưa hỏi server), không phải một cái trần. Mọi con
    // số DƯƠNG viết cứng thì có — đó là một lời khai về cấu hình server mà client không được phép.
    expect(MA, "một con số trần viết cứng ở client là một lời khai có thể sai").not.toMatch(/tran:\s*[1-9]/);
  });

  it("★★★ lỗi thật được CẮT trước khi nhét vào prompt lượt sau (giữ đầu+cuối, có trần)", () => {
    expect(MA).toContain("catLoiChoPrompt(");
  });

  it("★★★ lượt sửa kế tiếp GHIM tệp bằng `codingEditPath` và KHÔNG gửi nội dung tệp", () => {
    expect(MA).toContain("codingEditPath");
    expect(MA, "client gửi nội dung = phá điểm neo băm chống TOCTOU").not.toMatch(/codingEditContent|original:\s*goc/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — IM LẶNG LÀ NÓI DỐI: mọi lý do dừng có câu chữ ở CẢ BA locale", () => {
  /**
   * ⚠ `Record<LyDoDungVong, string>` là phép VÉT CẠN theo KIỂU: thêm một lý do dừng mới mà quên
   * khai khoá i18n ⇒ `npm run check:tests` ĐỎ ngay, không cần ai nhớ cập nhật danh sách.
   */
  const KHOA: Record<LyDoDungVong, string> = {
    xanh: "repoWs.loop.stop.green",
    het_tran: "repoWs.loop.stop.cap",
    khong_tien_bo: "repoWs.loop.stop.stuck",
    nguoi_tu_choi: "repoWs.loop.stop.user",
    khong_co_lenh: "repoWs.loop.stop.noCmd",
    khong_quyen: "repoWs.loop.stop.perm",
    co_tat: "repoWs.loop.stop.off",
    loi: "repoWs.loop.stop.error",
  };

  for (const [lyDo, khoa] of Object.entries(KHOA)) {
    it(`★★★ lý do "${lyDo}" có câu chữ ở vi/en/zh, và được dùng trong trang`, () => {
      for (const [ten, doc] of [["vi", VI], ["en", EN], ["zh", ZH]] as const) {
        const v = doc[khoa];
        expect(typeof v === "string" && v.trim().length > 0, `${ten}.json thiếu "${khoa}"`).toBe(true);
      }
      expect(MA, `trang không hề dùng "${khoa}"`).toContain(khoa);
    });
  }

  /** Cờ TẮT là một lý do dừng THẬT — nó phải nói ra, không được biến mất im lặng. */
  it("★★★ cờ TẮT nói ra TÊN CỜ để người vận hành biết bật ở đâu", () => {
    expect(String(VI["repoWs.loop.stop.off"])).toContain("AI_CODING_AUTOLOOP");
    expect(String(EN["repoWs.loop.stop.off"])).toContain("AI_CODING_AUTOLOOP");
    expect(String(ZH["repoWs.loop.stop.off"])).toContain("AI_CODING_AUTOLOOP");
  });

  it("★★★ nhãn LƯỢT/TRẦN có đủ hai chỗ nội suy ở cả ba locale (người phải thấy 'lượt mấy / trần mấy')", () => {
    for (const [ten, doc] of [["vi", VI], ["en", EN], ["zh", ZH]] as const) {
      for (const khoa of ["repoWs.loop.title", "repoWs.loop.ranTurn"]) {
        const s = String(doc[khoa] ?? "");
        expect(s, `${ten}.${khoa} thiếu {{luot}}`).toContain("{{luot}}");
        expect(s, `${ten}.${khoa} thiếu {{tran}}`).toContain("{{tran}}");
      }
    }
  });

  it("★★ BA PHA đều có câu chữ ở cả ba locale (người phải đọc được vòng ĐANG LÀM GÌ)", () => {
    for (const doc of [VI, EN, ZH]) {
      for (const k of ["repoWs.loop.phase.run", "repoWs.loop.phase.propose", "repoWs.loop.phase.idle"]) {
        expect(typeof doc[k]).toBe("string");
      }
    }
  });

  it("★★★ thẻ vòng NHẮC LẠI bất biến HITL ở cả ba locale (người dùng phải biết ai đang cầm quyền ghi)", () => {
    for (const doc of [VI, EN, ZH]) {
      expect(String(doc["repoWs.loop.hitl"] ?? "").length).toBeGreaterThan(20);
    }
    expect(MA).toContain("repoWs.loop.hitl");
  });
});
