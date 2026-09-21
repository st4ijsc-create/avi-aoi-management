/**
 * gonLoiKhongNuotTin.test.ts — **CẮT CHỨNG CỨ THỪA, KHÔNG CẮT TIN.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT ĐƯỢC GHIM — ĐO TRÊN ĐĨA
 * ════════════════════════════════════════════════════════════════════════════
 * 2026-09-21, ngay sau khi vá xong nguồn log spam thứ nhất (`OfflineMonitor`), log lỗi vẫn
 * phình **20 MB trong 8 phút** — nhưng lần này chỉ vì **15** dòng `[TelemetryBus] insert
 * failed`, tức **~1,3 MB mỗi dòng**.
 *
 * Lý do: `ot_telemetry` được ghi bằng INSERT **hàng loạt**, nên thông điệp lỗi của drizzle
 * (`Failed query: insert into "ot_telemetry" (…) values (default, $1, …), (default, $N, …), …`)
 * lặp hàng nghìn bộ giá trị **giống hệt nhau**, và chỗ ghi log in nguyên `err.message`.
 *
 * ★ Hai nguồn, một bài học: **log nhiễu không phải lúc nào cũng là NHIỀU DÒNG — nó có thể là
 *   MỘT dòng quá dài.** Đếm dòng sẽ bỏ sót hẳn ca này.
 *
 * ⚠ Ranh giới phải giữ: dòng log **vẫn còn**, vẫn nêu **bảng nào** và **lỗi gì**. Thứ bị cắt là
 *   hàng nghìn `(default, $N, …)` — nhân bản, không phải thông tin. Ba ca dưới canh đúng ranh
 *   giới ấy, để lần sau ai đó "dọn log" không dọn luôn nguyên nhân.
 */
import { describe, expect, it } from "vitest";

import { GON_LOI_TOI_DA, gonLoi } from "./telemetryBus";

/** Dựng lại đúng hình dạng thông điệp drizzle đã sinh ra 1,3 MB. */
function loiChenHangLoat(soBo: number): Error {
  const bo = Array.from({ length: soBo }, () => "(default, $N, $N, $N, $N, $N, $N, $N, $N, $N, $N, $N, default)");
  return new Error(
    `Failed query: insert into "ot_telemetry" ("id", "ts", "machineId", "deviceId", "protocol", ` +
      `"metric", "numValue", "textValue", "boolValue", "unit", "quality", "meta", "ingestedAt") values ${bo.join(", ")}`,
  );
}

describe("★★★ gonLoi — log nhiễu có thể là MỘT dòng quá dài", () => {
  it("★★★ một lỗi chèn hàng loạt KHÔNG còn kéo theo cả câu SQL", () => {
    const that = loiChenHangLoat(5_000);
    expect(that.message.length).toBeGreaterThan(300_000); // tái hiện đúng quy mô đã đo
    const ra = gonLoi(that);
    expect(ra.length).toBeLessThan(500);
  });

  it("★★★ ĐỐI CHỨNG — vẫn nêu BẢNG NÀO và LỖI GÌ, không nuốt tin", () => {
    // Nếu ca trên xanh vì `gonLoi` trả chuỗi rỗng thì nó xanh một cách vô nghĩa.
    const ra = gonLoi(loiChenHangLoat(5_000));
    expect(ra).toContain("Failed query");
    expect(ra).toContain("ot_telemetry");
  });

  it("★★★ và NÓI RA rằng mình đã cắt, kèm số ký tự — im lặng cắt là giấu", () => {
    const ra = gonLoi(loiChenHangLoat(5_000));
    expect(ra).toMatch(/cắt \d+ ký tự/);
  });

  it("★★★ lỗi NGẮN đi qua NGUYÊN VẸN — không đụng ca thường", () => {
    for (const m of ["ECONNREFUSED", "connect ETIMEDOUT 10.0.0.5:5432", "duplicate key value violates unique constraint"]) {
      expect(gonLoi(new Error(m))).toBe(m);
    }
  });

  it("★ biên: đúng ngưỡng thì KHÔNG cắt, hơn một ký tự thì cắt", () => {
    const vua = "x".repeat(GON_LOI_TOI_DA);
    expect(gonLoi(new Error(vua))).toBe(vua);
    expect(gonLoi(new Error(`${vua}y`))).not.toBe(`${vua}y`);
  });

  it("★ thứ KHÔNG phải Error vẫn ra chuỗi, không ra `undefined`", () => {
    // Bản cũ dùng `(err as Error)?.message || err` nên in ra cả object — không đọc được.
    expect(gonLoi("chuỗi trần")).toBe("chuỗi trần");
    expect(gonLoi(null)).toBe("null");
  });
});
