import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANH_RONG, datAnhSoModel, type AnhSoModel } from "./anhSoModel";
import { laModelKheNangPhu, modelKheNangPhu, modelNhaKheNang } from "./tapKheNang";
import { laModelServerDangGiu } from "../../aiLlamaServerClient";

const P = (artifactFile: string, o: Partial<{ slotClass: "nang" | "nho"; artifactStatus: string; enabled: boolean }> = {}) => ({
  artifactFile, slotClass: "nang" as const, artifactStatus: "available", license: "apache-2.0", enabled: true, ...o,
});
const anh = (profiles: [string, ReturnType<typeof P>][]): AnhSoModel => ({ taiLuc: 1, vaiTro: new Map(), profile: new Map(profiles), gan: [] });

describe("tapKheNang (Đợt 7.1)", () => {
  const ENV = { LLAMA_SERVER_MODEL: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf" } as NodeJS.ProcessEnv;

  it("tập phụ: chỉ hồ sơ nang bật + available, bỏ model nhà, không trùng", () => {
    const a = anh([
      ["coder", P("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf")],
      ["coder2", P("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf")],
      ["nha", P("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf")],
      ["nho", P("Qwen3-4B.gguf", { slotClass: "nho" })],
      ["mat", P("Mat-30B.gguf", { artifactStatus: "missing" })],
      ["tat", P("Tat-30B.gguf", { enabled: false })],
    ]);
    expect(modelNhaKheNang(ENV)).toBe("Qwen3.6-35B-A3B-UD-Q4_K_XL");
    expect(modelKheNangPhu(a, modelNhaKheNang(ENV))).toEqual(["Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL"]);
    expect(laModelKheNangPhu("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf", a, ENV)).toBe(true);
    expect(laModelKheNangPhu("Qwen3-4B", a, ENV)).toBe(false);
    expect(laModelKheNangPhu("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL", a, { ...ENV, AI_KHE_NANG_HOAN_DOI: "false" })).toBe(false);
    expect(modelKheNangPhu(ANH_RONG, "x")).toEqual([]);
  });

  describe("laModelServerDangGiu × tập khe nặng (G1-D: một vị từ cho ĐƯỜNG ĐI và ĐƯỜNG CẤM)", () => {
    const giu = { ...process.env };
    beforeEach(() => {
      Object.assign(process.env, {
        LLAMA_SERVER_ENABLED: "true",
        LLAMA_SERVER_URL: "http://127.0.0.1:8091",
        LLAMA_SERVER_MODEL: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
      });
      delete process.env.AI_KHE_NANG_HOAN_DOI;
    });
    afterEach(() => {
      process.env = { ...giu };
      datAnhSoModel(ANH_RONG);
    });

    it("sổ rỗng ⇒ y như cũ: chỉ model server đang giữ", () => {
      datAnhSoModel(ANH_RONG);
      expect(laModelServerDangGiu("Qwen3.6-35B-A3B-UD-Q4_K_XL")).toBe(true);
      expect(laModelServerDangGiu("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL")).toBe(false);
    });

    it("hồ sơ khe nặng cho Coder ⇒ Coder là 'của server' (đi server, cấm nạp trong tiến trình); cờ tắt ⇒ không", () => {
      datAnhSoModel(anh([["coder", P("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf")]]));
      expect(laModelServerDangGiu("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL")).toBe(true);
      expect(laModelServerDangGiu("Qwen3-4B-Instruct-2507-UD-Q4_K_XL")).toBe(false);
      process.env.AI_KHE_NANG_HOAN_DOI = "false";
      expect(laModelServerDangGiu("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL")).toBe(false);
    });

    it("llama-server tắt ⇒ false dù có hồ sơ", () => {
      datAnhSoModel(anh([["coder", P("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf")]]));
      process.env.LLAMA_SERVER_ENABLED = "false";
      expect(laModelServerDangGiu("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL")).toBe(false);
    });
  });
});
