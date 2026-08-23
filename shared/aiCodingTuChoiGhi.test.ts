/**
 * ★★★ 2026-08-23 · MỤC 0.1 — **"VÒNG ĐỜI ĐÃ CHẠY XONG" ≠ "BYTE ĐÃ VÀO ĐĨA".**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * SỰ VIỆC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `confirmAction` trả `{ok:true, status:"executed"}` **kể cả khi** `execute()` TỪ CHỐI ghi (băm neo
 * lệch `BASE_MISMATCH`, tệp bẩn `FILE_DIRTY`). Phán quyết thật nằm ở `note` của `ToolResult`.
 * Trang web đọc `res.ok` ⇒ báo *"Đã ghi tệp."*, ghi *"Đã áp diff"* vào transcript, rồi **khởi động
 * vòng tự động trên một bản vá chưa hề vào đĩa**.
 *
 * §A đo VỊ TỪ THUẦN. §B đo rằng **cả hai** nơi tiêu thụ (CLI đã vá trước, WEB vá ở lượt này) đều
 * gọi CHÍNH vị từ ấy — chứ không phải mỗi nơi tự viết một biểu thức rồi trôi khỏi nhau.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { daBiTuChoiGhi, maTuChoiGhi } from "./aiCodingLoop";

describe("§A — vị từ THUẦN `daBiTuChoiGhi` / `maTuChoiGhi`", () => {
  it("★★★ `note` là mã từ chối ⇒ TỪ CHỐI, và mã ấy đọc lại được", () => {
    for (const ma of ["BASE_MISMATCH", "FILE_DIRTY", "PATH_REJECTED", "NOT_FOUND"]) {
      const r = { type: "action_result", textSummary: "…", note: ma };
      expect(daBiTuChoiGhi(r), `note=${ma} phải là TỪ CHỐI`).toBe(true);
      expect(maTuChoiGhi(r)).toBe(ma);
    }
  });

  it("★★★ lượt ghi THẬT SỰ thành công (không `note`) ⇒ KHÔNG phải từ chối", () => {
    const r = { type: "action_result", title: "Áp thay đổi", textSummary: "đã ghi 42 byte" };
    expect(daBiTuChoiGhi(r)).toBe(false);
    expect(maTuChoiGhi(r)).toBeNull();
  });

  /**
   * ⚠ Chiều mặc định phải ĐÚNG: đảo nó sẽ biến **mọi** lượt ghi thành công thành "bị từ chối" — đổi
   *   một lời khai sai lấy một lời khai sai khác. Bốn hình dạng "không có phán quyết" đều là `false`.
   */
  it("★★★ null · undefined · `note` rỗng · `note` không phải chuỗi ⇒ KHÔNG phải từ chối", () => {
    expect(daBiTuChoiGhi(null)).toBe(false);
    expect(daBiTuChoiGhi(undefined)).toBe(false);
    expect(daBiTuChoiGhi({ note: "" })).toBe(false);
    expect(daBiTuChoiGhi({ note: 0 })).toBe(false);
    expect(daBiTuChoiGhi({ note: {} })).toBe(false);
    expect(daBiTuChoiGhi("BASE_MISMATCH")).toBe(false); // chuỗi trần KHÔNG phải ToolResult
  });

  it("★★ không ném với đầu vào méo (một vị từ an toàn không được là nguồn lỗi mới)", () => {
    expect(() => daBiTuChoiGhi(123)).not.toThrow();
    expect(() => maTuChoiGhi([])).not.toThrow();
  });
});

describe("§B — MỘT bản vị từ, HAI nơi tiêu thụ (không hai bản sao)", () => {
  const doc = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
  const WEB = doc("client/src/pages/AICodingWorkspace.tsx");
  const CLI = doc("server/services/aiCodingCli/cli.ts");

  it("★★★ WEB gọi `daBiTuChoiGhi(res.result)` ở đường duyệt-và-ghi", () => {
    expect(WEB).toContain("daBiTuChoiGhi(res.result)");
    expect(WEB).toContain('from "@shared/aiCodingLoop"');
  });

  it("★★★ CLI dùng CHÍNH hàm ấy, KHÔNG còn biểu thức `note` viết tại chỗ", () => {
    expect(CLI).toContain("daBiTuChoiGhi(r)");
    expect(CLI, "biểu thức viết-tại-chỗ đã bị thay bằng lời gọi hàm chung").not.toContain(
      'typeof r.note === "string" && r.note !== ""',
    );
  });

  /**
   * ★★★ **HẬU QUẢ ĐẮT NHẤT của lỗi này là vòng tự động chạy tiếp trên một bản vá KHÔNG tồn tại.**
   * Đo trên MÃ: `chayLuotVong(` chỉ được gọi ở nhánh `else if (res.ok)` (đã loại `tuChoi`), tức nó
   * đứng SAU phép rẽ nhánh, không đứng trong nhánh từ chối.
   */
  it("★★★ WEB KHÔNG khởi động vòng tự động ở nhánh TỪ CHỐI", () => {
    const dau = WEB.indexOf("const tuChoi = daBiTuChoiGhi(res.result);");
    expect(dau).toBeGreaterThan(0);
    const cuoiNhanhTuChoi = WEB.indexOf("} else if (res.ok) {", dau);
    expect(cuoiNhanhTuChoi).toBeGreaterThan(dau);
    const nhanhTuChoi = WEB.slice(dau, cuoiNhanhTuChoi);
    expect(nhanhTuChoi, "vòng tự động KHÔNG được khởi động khi byte chưa vào đĩa").not.toContain("chayLuotVong(");
    // …và nhánh THÀNH CÔNG thì vẫn phải khởi động nó (không được vá bằng cách gỡ luôn tính năng).
    expect(WEB.slice(cuoiNhanhTuChoi)).toContain("void chayLuotVong(tepDaGhi)");
  });

  it("★★ WEB nói ra MÃ từ chối cho người dùng (không nuốt lý do)", () => {
    expect(WEB).toContain("maTuChoiGhi(res.result)");
    expect(WEB).toContain("repoWs.chat.writeRejected");
  });
});
