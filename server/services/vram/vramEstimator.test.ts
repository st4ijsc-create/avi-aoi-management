import { describe, it, expect, beforeEach, vi } from "vitest";
import { estimateBytesFor, recordActual, __resetEstimatorForTests } from "./vramEstimator";

const MIB = 1024 * 1024;

describe("vramEstimator — tự học, thôi phụ thuộc hằng số", () => {
  beforeEach(() => __resetEstimatorForTests());

  it("chưa biết gì thì lùi về kích thước file, nguồn = file-size", async () => {
    const r = await estimateBytesFor("gguf:A", { fileBytes: 400 * MIB });
    expect(r.bytes).toBe(400 * MIB);
    expect(r.source).toBe("file-size");
  });

  it("không có file thì dùng hằng số cấu hình, nguồn = config-default", async () => {
    const r = await estimateBytesFor("sidecar:vision", { configDefaultBytes: 8192 * MIB });
    expect(r.bytes).toBe(8192 * MIB);
    expect(r.source).toBe("config-default");
  });

  it("SAU một lượt đo thật thì DÙNG SỐ THẬT, nguồn = learned", async () => {
    recordActual("gguf:A", 19_077 * MIB);
    const r = await estimateBytesFor("gguf:A", { fileBytes: 400 * MIB });
    expect(r.bytes).toBe(19_077 * MIB);
    expect(r.source).toBe("learned");
  });

  it("số thật MỚI thắng số thật CŨ", async () => {
    recordActual("gguf:A", 19_077 * MIB);
    recordActual("gguf:A", 19_071 * MIB);
    expect((await estimateBytesFor("gguf:A", {})).bytes).toBe(19_071 * MIB);
  });

  // Review round 1 (🟠 nâng từ Minor): nhánh KHÔNG có fileBytes lẫn configDefaultBytes
  // trước đây tự nhận nguồn "config-default" dù KHÔNG hề dùng hằng số nào — Task 7 đọc
  // estimateSource để trả lời "chỗ nào còn dựa hằng số" sẽ bị CHỈ SAI ĐỊA CHỈ. Phải có
  // nguồn RIÊNG cho "không có căn cứ gì" — và phải console.warn TO hơn config-default,
  // vì "xin chỗ mà không biết bao nhiêu" nghiêm trọng hơn "dùng hằng số cũ".
  it("KHÔNG có fileBytes lẫn configDefaultBytes ⇒ nguồn PHẢI là 'unknown', KHÔNG được tự nhận vơ 'config-default'", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await estimateBytesFor("gguf:mu-mit", {});
    expect(r.bytes).toBe(0);
    expect(r.source).toBe("unknown");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  // Review round 1 (🟡 Minor): vramBroker.ts:16 leaseBytes() CỐ Ý dùng `??` (không `||`)
  // vì actualBytes=0 là SỐ THẬT hợp lệ, không phải "chưa biết". recordActual() phải theo
  // đúng nguyên tắc đó — 0 là số liệu THẬT (vd. một owner đo được không chiếm VRAM riêng),
  // KHÔNG được coi bằng "chưa từng đo" và bị guard `bytes > 0` nuốt mất.
  it("recordActual(owner, 0) VẪN được ghi nhận — 0 là số liệu THẬT (nhất quán với vramBroker.leaseBytes dùng ??)", async () => {
    recordActual("gguf:zero", 0);
    const r = await estimateBytesFor("gguf:zero", { fileBytes: 999 * MIB });
    expect(r.bytes).toBe(0);
    expect(r.source).toBe("learned");
  });
});
