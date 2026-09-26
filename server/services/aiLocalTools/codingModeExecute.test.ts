/**
 * ★★★ doc 79 · TRỤC 1 — CỔNG RA ĐẦU–CUỐI (không Playwright, không LLM): một câu hỏi lập trình đi
 * qua `tryExecuteCodingTool` PHẢI gọi `read_file` và trả về NỘI DUNG THẬT của tệp — KHÔNG phải một
 * chunk RAG. Đây là bản sao tất định của phép đo Playwright đã ĐỎ hôm nay (doc 79 §0).
 *
 * ⚠ Dùng execCtx `admin` — `accessControl.checkPermission` short-circuit `true` cho admin (không phụ
 * thuộc hàng quyền được seed), nên ca này đo ĐÚNG đường tool, không đo trạng thái RBAC của môi trường.
 */
import { describe, it, expect } from "vitest";
import "./index"; // đăng ký toàn bộ tool
import { tryExecuteCodingTool } from "./index";

const ADMIN = { user: { id: 1, role: "admin", name: "T" }, lang: "vi" as const };

describe("★★★ codingMode: đọc mã trả NỘI DUNG THẬT (không phải RAG)", () => {
  it("★★★ 'đọc server/services/aiLocalTools/toolRegistry.ts …' ⇒ read_file + nội dung tệp THẬT", async () => {
    const r = await tryExecuteCodingTool(
      "đọc server/services/aiLocalTools/toolRegistry.ts và cho biết export gì",
      undefined,
      ADMIN,
    );
    expect(r.decision.tool, `phải chọn read_file, nhận: ${JSON.stringify(r.decision)}`).toBe("read_file");
    expect(r.result, "read_file phải chạy tới nơi").not.toBeNull();
    expect(r.result!.note, `bị chặn oan: ${r.result!.textSummary}`).toBeUndefined();
    // Nội dung THẬT của toolRegistry.ts — thứ này KHÔNG có trong bất kỳ chunk RAG nào.
    expect(r.result!.textSummary).toContain("export function registerTool");
  });

  it("★★ đường thoát hộp cát (có đuôi tệp) ⇒ read_file trả note PATH_REJECTED, KHÔNG rò nội dung", async () => {
    const r = await tryExecuteCodingTool("đọc ../../../etc/passwd.ts", undefined, ADMIN);
    expect(r.decision.tool).toBe("read_file");
    expect(r.result).not.toBeNull();
    expect(r.result!.note, "đường thoát hộp cát phải bị TỪ CHỐI có mã").toBe("PATH_REJECTED");
    expect((r.result!.data as { content: string | null }).content, "KHÔNG rò nội dung").toBeNull();
  });

  it("★★ đường thoát KHÔNG đuôi tệp ⇒ định tuyến list_files và vẫn bị hộp cát TỪ CHỐI (không rò)", async () => {
    const r = await tryExecuteCodingTool("đọc ../../../etc/passwd", undefined, ADMIN);
    // Không đuôi tệp ⇒ coi là THƯ MỤC ⇒ list_files; hộp cát vẫn chặn "..".
    expect(r.decision.tool).toBe("list_files");
    expect(r.result).not.toBeNull();
    expect(r.result!.note, "đường thoát hộp cát phải bị TỪ CHỐI").toBe("PATH_REJECTED");
  });
});
