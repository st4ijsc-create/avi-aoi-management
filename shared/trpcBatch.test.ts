import { describe, it, expect } from "vitest";
import { TRPC_MAX_BATCH_SIZE, demThuTucTrongBatch } from "./trpcBatch";

describe("demThuTucTrongBatch", () => {
  it("đếm theo dấu phẩy, bỏ gạch đầu, giải mã %2C, path rỗng = 0", () => {
    expect(demThuTucTrongBatch("a")).toBe(1);
    expect(demThuTucTrongBatch("/a,b,c")).toBe(3);
    expect(demThuTucTrongBatch("a%2Cb%2Cc%2Cd")).toBe(4);
    expect(demThuTucTrongBatch("")).toBe(0);
    expect(demThuTucTrongBatch("/")).toBe(0);
  });
  it("path hỏng (%E0%A4%A) không ném, vẫn đếm thô", () => {
    expect(demThuTucTrongBatch("a,b%E0%A4%A,c")).toBe(3);
  });
  it("trần ≥ 20 (yêu cầu tối thiểu) và ≥ max đo thật 18", () => {
    expect(TRPC_MAX_BATCH_SIZE).toBeGreaterThanOrEqual(20);
    expect(TRPC_MAX_BATCH_SIZE).toBeGreaterThanOrEqual(18);
  });
});
