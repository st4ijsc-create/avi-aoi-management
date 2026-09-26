/**
 * Task V9 (in-UI training guidance, 2026-09-05) — lưới chống-trôi cho bảng "định dạng nhận
 * được"/"KHÔNG nhận" mới thêm vào SourceTab.tsx (xem sourceTabLogic.ts's
 * `KB_STUDIO_REJECTED_EXTENSIONS_FOR_GUIDANCE`).
 *
 * Vấn đề gốc mà lưới này phòng: server không phơi ra một endpoint "danh sách bị từ chối" nào —
 * chỉ có `allowedTypes` (danh sách ĐƯỢC nhận, đã có sẵn cơ chế chống-trôi từ Task 6 review round
 * 2 — SourceTab.tsx luôn nhận `allowedTypes` LIVE từ `trpc.kbIngest.status`, không bao giờ chép
 * tay). Phần "KHÔNG nhận" hiển thị trong bảng hướng dẫn buộc phải là hằng số chép tay
 * (`KB_STUDIO_REJECTED_EXTENSIONS_FOR_GUIDANCE`) vì không có nguồn sống nào để lấy — lưới này là
 * lớp phòng thủ THAY THẾ: import THẲNG `normalizeSourceType`/`KbUnsupportedTypeError` thật từ
 * `server/services/kbDocParser.ts` và đối chiếu cả hai chiều.
 *
 * An toàn tầng build: import này CHỈ chạy trong môi trường TEST (vitest gộp client+server vào
 * MỘT tiến trình node — xem vitest.config.ts's `include`), KHÔNG lọt vào bundle trình duyệt thật
 * (client build qua vite.config.ts hoàn toàn tách biệt, không đụng tệp này). `kbDocParser.ts`
 * không có import tĩnh nào ở đầu tệp (pdf-parse/mammoth/kbImageDescriber đều `await import(...)`
 * bên TRONG hàm) nên chỉ gọi `normalizeSourceType` (không gọi `parseDocument`) không kéo theo bất
 * kỳ dependency nặng nào — xác nhận bằng cách đọc mã, không phải suy đoán.
 */
import { describe, it, expect } from "vitest";
import { normalizeSourceType, KbUnsupportedTypeError } from "../../../../server/services/kbDocParser";
import { KB_STUDIO_REJECTED_EXTENSIONS_FOR_GUIDANCE, KNOWN_IMAGE_EXTENSIONS } from "./sourceTabLogic";

/**
 * Mirror THỦ CÔNG của `allowedTypes` thật (server/routers/kbIngestRouter.ts:123 — không import
 * được từ đây vì đó là một mảng `as const` bên trong một router object, không phải export riêng).
 * Chỉ dùng để lái lưới CHIỀU 1 dưới đây — nếu router đổi danh sách này mà quên cập nhật ở đây,
 * lưới KHÔNG bị hỏng theo hướng "báo xanh giả": các case CHIỀU 2/3 vẫn đối chiếu trực tiếp với
 * `normalizeSourceType` thật, độc lập với mirror này.
 */
const LIVE_ALLOWED_EXTENSIONS = ["pdf", "docx", "md", "txt", "png", "jpg", "jpeg", "webp"] as const;

describe("kbFormatGuidance — grid có răng, hai chiều với normalizeSourceType thật", () => {
  it("CHIỀU 1 — mọi định dạng server THỰC SỰ nhận không bị normalizeSourceType từ chối", () => {
    for (const ext of LIVE_ALLOWED_EXTENSIONS) {
      expect(() => normalizeSourceType(ext), `"${ext}" phải được chấp nhận`).not.toThrow();
    }
  });

  it("CHIỀU 2 — mọi định dạng bảng hướng dẫn nói 'KHÔNG nhận' thực sự bị KbUnsupportedTypeError", () => {
    expect(KB_STUDIO_REJECTED_EXTENSIONS_FOR_GUIDANCE.length).toBeGreaterThan(0);
    for (const ext of KB_STUDIO_REJECTED_EXTENSIONS_FOR_GUIDANCE) {
      expect(() => normalizeSourceType(ext), `"${ext}" phải bị từ chối`).toThrow(KbUnsupportedTypeError);
    }
  });

  it("CHIỀU 3 — hai danh sách không giao nhau (không định dạng nào vừa 'nhận' vừa 'KHÔNG nhận')", () => {
    const overlap = LIVE_ALLOWED_EXTENSIONS.filter((ext) =>
      KB_STUDIO_REJECTED_EXTENSIONS_FOR_GUIDANCE.includes(ext),
    );
    expect(overlap).toEqual([]);
  });

  it("video KHÔNG dùng được qua màn hình Source hôm nay — đuôi tệp video THẬT bị từ chối", () => {
    // kbDocParser.ts's case "video" là NHÃN NỘI BỘ do kbVideoTranscriber.ts truyền vào SAU khi
    // đã tự chép lời (pass-through, xem module doc của kbDocParser.ts) — kbStudioRouter.ts
    // KHÔNG có `ingestVideoJob` nào gọi tới nó, và không có UI nào trong client/ gọi
    // `kbIngest.ingestVideo` (đã grep xác nhận: 0 kết quả cho "ingestVideo"/"videoIngestEnabled"
    // trong client/). Người dùng không có cách nào đưa một tệp .mp4 thật qua màn hình này hôm
    // nay — nếu thử, đuôi tệp thật (không phải nhãn "video") sẽ bị từ chối, đúng như lưới dưới
    // đây xác nhận. Bảng hướng dẫn KHÔNG liệt kê video là "nhận được" vì lý do này.
    for (const ext of ["mp4", "mov", "wav", "mp3", "avi"]) {
      expect(() => normalizeSourceType(ext), `"${ext}" phải bị từ chối (video chưa nối vào UI)`).toThrow(
        KbUnsupportedTypeError,
      );
    }
  });

  it("bonus — KNOWN_IMAGE_EXTENSIONS (mirror chép tay có sẵn, sourceTabLogic.ts) khớp normalizeSourceType('image')", () => {
    // Mirror này đã tồn tại TRƯỚC task này (doc comment của nó tự nhận "kept in sync manually")
    // và chưa từng có lưới đối chiếu với server thật — đóng luôn gap cùng họ trong lúc đang có
    // sẵn cầu nối test↔server này, không phải phạm vi ngoài brief (cùng lớp lỗi "danh sách chép
    // tay trôi khỏi hành vi thật" B4 nhắm tới).
    for (const ext of KNOWN_IMAGE_EXTENSIONS) {
      expect(normalizeSourceType(ext)).toBe("image");
    }
  });
});
