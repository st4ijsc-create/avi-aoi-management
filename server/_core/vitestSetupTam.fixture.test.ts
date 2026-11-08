/**
 * Phụ kiện của `vitestSetupTam.test.ts` — CHỈ chạy trong tiến trình con mà lưới đó sinh (`AOI_VITEST_TAM_DO_THU=1`, %TEMP% trỏ về
 * thư mục rỗng): ghi vào thư mục tạm của setup rồi ĐỎ CỐ Ý, để đo thư mục tạm vẫn bị xoá khi tệp test đỏ. Lượt chạy thường: bỏ qua.
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

describe.skipIf(process.env.AOI_VITEST_TAM_DO_THU !== "1")("phụ kiện: tệp test ĐỎ vẫn để lại %TEMP% sạch", () => {
  it("ghi vào thư mục tạm của setup rồi ném", () => {
    writeFileSync(resolve(dirname(process.env.LLAMA_WATCHDOG_PAUSE_FILE!), "llama-watchdog.pause"), "{}");
    writeFileSync(resolve(process.env.ROBOT_MOTION_LOCK_PENDING_DIR!, "x.json"), "{}");
    throw new Error("đỏ cố ý (phụ kiện vitestSetupTam)");
  });
});
