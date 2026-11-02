import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { docEnvLoc, khoaDuocNap, napEnvTuTep } from "./napEnv";

const MAU = [
  "# chú thích",
  "DATABASE_URL=postgres://aoi:matkhau@127.0.0.1:5434/aoi_management",
  "LLAMA_SERVER_ENABLED=true",
  'LLAMA_SERVER_URL="http://127.0.0.1:8091"',
  "LLAMA_SERVER_MODEL=qwen.gguf # ghi chú cuối dòng",
  "LLAMA_SERVER_API_KEY=bi-mat",
  "GGUF_DEFAULT_MODEL=a.gguf",
  "export AI_AGENT_THEO_VAI_TRO=1",
  "AI_AGENT_NEN_MOC=0.5",
  "AI_REPO_SANDBOX_ROOTS=repo=D:\\x",
  "AI_GHI_LUOT_DIR=D:\\tam",
  "JWT_SECRET=xyz",
  "SESSION_SECRET=zzz",
  "OPENAI_API_KEY=k",
  "AI_SAMPLING_PROFILE=code",
  "FOE_ENABLED=1",
  "GGUF_API_TOKEN=t",
].join("\n");

describe("napEnv — danh sách TRẮNG, không bí mật, không DATABASE_URL", () => {
  it("★ chỉ nạp khoá model/serving/harness; BỎ DATABASE_URL, khoá bí mật, sandbox roots, ghi-lượt, cờ ngoài danh sách", () => {
    const { nap, boQua } = docEnvLoc(MAU);
    expect(Object.keys(nap).sort()).toEqual(["AI_AGENT_NEN_MOC", "AI_AGENT_THEO_VAI_TRO", "AI_SAMPLING_PROFILE", "GGUF_DEFAULT_MODEL", "LLAMA_SERVER_ENABLED", "LLAMA_SERVER_MODEL", "LLAMA_SERVER_URL"]);
    expect(nap.LLAMA_SERVER_URL).toBe("http://127.0.0.1:8091"); // bỏ nháy
    expect(nap.LLAMA_SERVER_MODEL).toBe("qwen.gguf"); // bỏ chú thích cuối dòng
    for (const k of ["DATABASE_URL", "LLAMA_SERVER_API_KEY", "JWT_SECRET", "SESSION_SECRET", "OPENAI_API_KEY", "AI_REPO_SANDBOX_ROOTS", "AI_GHI_LUOT_DIR", "FOE_ENABLED", "GGUF_API_TOKEN"]) {
      expect(nap[k], k).toBeUndefined();
      expect(boQua).toContain(k);
    }
  });
  it("khoaDuocNap: tiền tố hợp lệ nhưng tên có API_KEY/SECRET/TOKEN vẫn bị loại", () => {
    expect(khoaDuocNap("LLAMA_SERVER_API_KEY")).toBe(false);
    expect(khoaDuocNap("AI_AGENT_SECRET_X")).toBe(false);
    expect(khoaDuocNap("AI_AGENT_GIU_NGHI")).toBe(true);
    expect(khoaDuocNap("PATH")).toBe(false);
  });
  it("★ KHÔNG ghi đè khoá đã có trong môi trường; chỉ trả tên (không giá trị)", () => {
    const tep = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "env-")), "e.env");
    fs.writeFileSync(tep, MAU);
    const env: NodeJS.ProcessEnv = { LLAMA_SERVER_URL: "http://khac:1" };
    const kq = napEnvTuTep(tep, env);
    expect(env.LLAMA_SERVER_URL).toBe("http://khac:1");
    expect(kq.daCo).toEqual(["LLAMA_SERVER_URL"]);
    expect(kq.daNap).toContain("LLAMA_SERVER_ENABLED");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(JSON.stringify(kq)).not.toContain("matkhau");
    fs.rmSync(path.dirname(tep), { recursive: true, force: true });
  });
});
