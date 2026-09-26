import { describe, it, expect } from "vitest";
import { resolveSourceTabState } from "./kbStudioSourceState";

describe("resolveSourceTabState — final-fix round (Important-2)", () => {
  it("data chưa về + KHÔNG lỗi ⇒ 'loading', KHÔNG bịa allowedTypes", () => {
    const result = resolveSourceTabState({ isError: false, data: undefined });
    expect(result.kind).toBe("loading");
    // Không có props nào để đọc `allowedTypes` giả từ nhánh "loading" — chứng minh không còn
    // đường nào cho danh sách gõ tay ["pdf","docx","md","txt"] lọt vào.
    expect((result as any).props).toBeUndefined();
  });

  it("statusQuery lỗi ⇒ 'error' kèm lý do thật, KHÔNG lặng lẽ hiện danh sách đoán", () => {
    const result = resolveSourceTabState({
      isError: true,
      data: undefined,
      error: new Error("FORBIDDEN: 2FA step-up expired"),
    });
    expect(result).toEqual({ kind: "error", message: "FORBIDDEN: 2FA step-up expired" });
  });

  it("statusQuery lỗi nhưng error không phải Error instance ⇒ vẫn 'error', message undefined (không bịa lý do)", () => {
    const result = resolveSourceTabState({ isError: true, data: undefined, error: "plain string" });
    expect(result).toEqual({ kind: "error", message: undefined });
  });

  it("data đã về ⇒ 'ready' với allowedTypes THẬT từ server (8 loại, gồm ảnh) — KHÔNG phải fallback 4 loại gõ tay", () => {
    const serverAllowedTypes = ["pdf", "docx", "md", "txt", "png", "jpg", "jpeg", "webp"];
    const result = resolveSourceTabState({
      isError: false,
      data: { enabled: true, webIngestEnabled: false, maxUploadBytes: 20 * 1024 * 1024, allowedTypes: serverAllowedTypes },
    });
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.props.allowedTypes).toEqual(serverAllowedTypes);
      expect(result.props.allowedTypes).toContain("png");
      expect(result.props.enabled).toBe(true);
      expect(result.props.maxUploadBytes).toBe(20 * 1024 * 1024);
    }
  });

  it("isError THẮNG data cũ (react-query có thể giữ data thành công trước đó cạnh lỗi mới) — không để lộ danh sách CŨ như thể còn hợp lệ", () => {
    const result = resolveSourceTabState({
      isError: true,
      data: { enabled: true, webIngestEnabled: false, maxUploadBytes: 1, allowedTypes: ["pdf"] },
      error: new Error("network down"),
    });
    expect(result.kind).toBe("error");
  });
});
