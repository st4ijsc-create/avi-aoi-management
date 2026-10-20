/**
 * ★★ Đợt 7.0 — `resolveLogicalModel` nhận tên VAI TRÒ; tên logic cũ + passthrough tên tệp KHÔNG đổi.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeModelBasename, fastModelBasename, resolveLogicalModel } from "./modelResolver";
import { ANH_RONG, datAnhSoModel } from "./soModel/anhSoModel";

const KHOA = ["GGUF_DEFAULT_MODEL", "GGUF_CODE_MODEL", "GGUF_FAST_MODEL", "GGUF_FIM_MODEL", "GGUF_EMBED_MODEL", "GGUF_RERANKER_MODEL", "GGUF_VISION_MODEL", "LLAMA_SERVER_MODEL"];
const giu: Record<string, string | undefined> = {};

describe("resolveLogicalModel × vai trò", () => {
  beforeEach(() => {
    for (const k of KHOA) giu[k] = process.env[k];
    Object.assign(process.env, {
      GGUF_DEFAULT_MODEL: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
      GGUF_CODE_MODEL: "Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf",
      GGUF_FAST_MODEL: "Qwen3-4B-Instruct-2507-UD-Q4_K_XL",
      GGUF_RERANKER_MODEL: "bge-reranker-v2-m3-Q8_0",
      GGUF_VISION_MODEL: "Qwen3-VL-8B-Instruct-UD-Q4_K_XL",
    });
    datAnhSoModel(ANH_RONG);
  });
  afterEach(() => {
    for (const k of KHOA) {
      if (giu[k] === undefined) delete process.env[k];
      else process.env[k] = giu[k];
    }
    datAnhSoModel(ANH_RONG);
  });

  it("vai trò sinh chữ ⇒ model của khoá env tương ứng (ảnh rỗng)", () => {
    expect(resolveLogicalModel("code.plc")).toBe(codeModelBasename());
    expect(resolveLogicalModel("code.software")).toBe("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL");
    expect(resolveLogicalModel("extract")).toBe(fastModelBasename());
    expect(resolveLogicalModel("summarize")).toBe("Qwen3.6-35B-A3B-UD-Q4_K_XL");
    expect(resolveLogicalModel("Code.PLC")).toBe(codeModelBasename());
  });

  it("vai trò KHÔNG sinh chữ (rerank/vision) đi passthrough như trước — không nạp reranker làm model chat", () => {
    expect(resolveLogicalModel("rerank")).toBe("rerank");
    expect(resolveLogicalModel("vision")).toBe("vision");
  });

  it("tên logic cũ và passthrough tên tệp không đổi", () => {
    expect(resolveLogicalModel("code")).toBe("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL");
    expect(resolveLogicalModel("")).toBe("Qwen3.6-35B-A3B-UD-Q4_K_XL");
    expect(resolveLogicalModel("Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf")).toBe("Qwen3-4B-Instruct-2507-UD-Q4_K_XL");
    expect(resolveLogicalModel("qwen3")).toBe("qwen3"); // hình dạng vai trò nhưng không phải vai trò đã biết
    expect(resolveLogicalModel("sub/dir/model.gguf")).toBe("sub/dir/model");
  });
});
