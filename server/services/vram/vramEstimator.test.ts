import { describe, it, expect, beforeEach } from "vitest";
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
});
