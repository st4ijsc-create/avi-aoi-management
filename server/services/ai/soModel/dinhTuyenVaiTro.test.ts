import { afterEach, describe, expect, it } from "vitest";
import { VAI_TRO_GOC } from "../../../../shared/aiRoles";
import { resolveTaskModel, type ResolvableTask } from "../modelResolver";
import { ANH_RONG, type AnhSoModel, type GanTrongAnh } from "./anhSoModel";
import { dinhTuyenVaiTro } from "./dinhTuyenVaiTro";

const ENV: NodeJS.ProcessEnv = {
  GGUF_DEFAULT_MODEL: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
  GGUF_CODE_MODEL: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
  GGUF_FAST_MODEL: "Qwen3-4B-Instruct-2507-UD-Q4_K_XL",
  GGUF_FIM_MODEL: "qwen2.5-coder-1.5b-q8_0.gguf",
  LLAMA_SERVER_MODEL: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
};

function anh(gan: Partial<GanTrongAnh>[], profiles: AnhSoModel["profile"] = new Map()): AnhSoModel {
  return {
    taiLuc: 1,
    vaiTro: new Map(VAI_TRO_GOC.map((v) => [v.id, { envKey: v.envKey, taskKind: v.taskKind }])),
    profile: profiles,
    gan: gan.map((g) => ({
      roleId: "code.plc", scopeKind: "global", scopeId: null, profileId: null, envKey: null, fallback: [], mode: "active", ...g,
    })) as GanTrongAnh[],
  };
}

const P = (o: Partial<{ artifactFile: string; slotClass: "nang" | "nho" | "sidecar"; artifactStatus: string }>) => ({
  artifactFile: "DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf", slotClass: "nho" as const, artifactStatus: "available",
  license: "deepseek", enabled: true, ...o,
});

describe("dinhTuyenVaiTro (Đợt 7.0)", () => {
  it("ảnh rỗng + code.plc ⇒ model của GGUF_CODE_MODEL", () => {
    const kq = dinhTuyenVaiTro({ vaiTro: "code.plc" }, ANH_RONG, ENV);
    expect(kq).toMatchObject({ vaiTro: "code.plc", model: "Qwen3.6-35B-A3B-UD-Q4_K_XL", nguon: "mac-dinh-env", lyDo: { tang: 1 } });
  });

  it("gán project → profile nhỏ available ⇒ dùng profile, phạm vi project, tầng 2", () => {
    const a = anh([{ scopeKind: "project", scopeId: "plc-a", profileId: "ds" }, { envKey: "GGUF_CODE_MODEL" }], new Map([["ds", P({})]]));
    const kq = dinhTuyenVaiTro({ vaiTro: "code.plc", phamVi: { projectId: "plc-a" } }, a, ENV);
    expect(kq).toMatchObject({ model: "DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M", nguon: "gan-profile", phamVi: "project", lyDo: { tang: 2 } });
    // dự án khác ⇒ gán global theo-env
    expect(dinhTuyenVaiTro({ vaiTro: "code.plc", phamVi: { projectId: "khac" } }, a, ENV)).toMatchObject({ nguon: "gan-env", phamVi: "global" });
  });

  it("(7.1) profile khe nặng mà server không giữ + hoán đổi bật (mặc định) ⇒ dùng profile, ghi can-doi-khe", () => {
    const a = anh([{ profileId: "ds" }], new Map([["ds", P({ slotClass: "nang" })]]));
    const kq = dinhTuyenVaiTro({ vaiTro: "code.plc" }, a, ENV);
    expect(kq).toMatchObject({ nguon: "gan-profile", model: "DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M" });
    expect(kq.lyDo.bangChung).toContain("can-doi-khe");
  });

  it("profile khe nặng mà server không giữ + AI_KHE_NANG_HOAN_DOI=false ⇒ dự phòng về env, ghi khe-nang-chua-hoan-doi", () => {
    const a = anh([{ profileId: "ds" }], new Map([["ds", P({ slotClass: "nang" })]]));
    const kq = dinhTuyenVaiTro({ vaiTro: "code.plc" }, a, { ...ENV, AI_KHE_NANG_HOAN_DOI: "false" });
    expect(kq.nguon).toBe("du-phong");
    expect(kq.model).toBe("Qwen3.6-35B-A3B-UD-Q4_K_XL");
    expect(kq.lyDo.bangChung).toContain("khe-nang-chua-hoan-doi");
    // server đang giữ đúng artifact đó ⇒ dùng được
    const kq2 = dinhTuyenVaiTro({ vaiTro: "code.plc" }, a, { ...ENV, LLAMA_SERVER_MODEL: "DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf" });
    expect(kq2).toMatchObject({ nguon: "gan-profile", model: "DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M" });
  });

  it("artifact missing + fallback hợp lệ ⇒ fallback", () => {
    const a = anh(
      [{ profileId: "ds", fallback: ["coder"] }],
      new Map([["ds", P({ artifactStatus: "missing" })], ["coder", P({ artifactFile: "Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf" })]]),
    );
    const kq = dinhTuyenVaiTro({ vaiTro: "code.plc" }, a, ENV);
    expect(kq).toMatchObject({ nguon: "du-phong", model: "Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL" });
    expect(kq.lyDo.bangChung).toContain("artifact-missing");
  });

  it("gán chế độ thu bị bỏ qua", () => {
    const a = anh([{ profileId: "ds", mode: "thu" }], new Map([["ds", P({})]]));
    expect(dinhTuyenVaiTro({ vaiTro: "code.plc" }, a, ENV).nguon).toBe("mac-dinh-env");
  });

  it("tín hiệu đuôi .st không khai vai trò ⇒ code.plc, tầng 3; vai trò xấu coi như không khai", () => {
    expect(dinhTuyenVaiTro({ tinHieu: { duoiTep: ".st" } }, ANH_RONG, ENV)).toMatchObject({ vaiTro: "code.plc", lyDo: { tang: 3 } });
    expect(dinhTuyenVaiTro({ vaiTro: "../x" }, ANH_RONG, ENV)).toMatchObject({ vaiTro: "chat", lyDo: { tang: 5 } });
    expect(dinhTuyenVaiTro({ vaiTro: "khong.co" }, ANH_RONG, ENV, "code.software").vaiTro).toBe("code.software");
  });

  describe("BẤT BIẾN tương đương: ảnh seed (gán global theo-env) ≡ resolveTaskModel", () => {
    const giu = { ...process.env };
    afterEach(() => {
      process.env = { ...giu };
    });
    const SEED = anh(VAI_TRO_GOC.map((v) => ({ roleId: v.id, envKey: v.envKey })));
    const TANG: Record<string, ResolvableTask | null> = { chat: "default", code: "code", fast: "fast", fim: "fim", embed: null, vision: null };
    const BO_ENV: NodeJS.ProcessEnv[] = [
      ENV,
      { GGUF_DEFAULT_MODEL: "a.gguf" },
      { GGUF_DEFAULT_MODEL: "a", GGUF_FAST_MODEL: "f" },
      { GGUF_CODE_MODEL: "dir/c.gguf", GGUF_FIM_MODEL: "x.GGUF" },
      {},
    ];
    it.each(BO_ENV.map((e, i) => [i, e]))("bộ env #%i", (_i, e) => {
      for (const k of ["GGUF_DEFAULT_MODEL", "GGUF_CODE_MODEL", "GGUF_FAST_MODEL", "GGUF_FIM_MODEL", "GGUF_THINKING_MODEL"]) delete process.env[k];
      Object.assign(process.env, e);
      for (const v of VAI_TRO_GOC) {
        const t = TANG[v.taskKind];
        if (!t) continue;
        expect(dinhTuyenVaiTro({ vaiTro: v.id }, SEED, process.env).model, v.id).toBe(resolveTaskModel(t));
        expect(dinhTuyenVaiTro({ vaiTro: v.id }, ANH_RONG, process.env).model, `${v.id} ảnh rỗng`).toBe(resolveTaskModel(t));
      }
    });
  });
});
