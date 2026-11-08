import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { coAiAgentHieuLuc, datCoTuongMinh, docCoTuongMinh, docEnvLoc, khoaDuocNap, napEnvTuTep } from "./napEnv";

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
    expect(Object.keys(nap).sort()).toEqual(["AI_SAMPLING_PROFILE", "GGUF_DEFAULT_MODEL", "LLAMA_SERVER_ENABLED", "LLAMA_SERVER_MODEL", "LLAMA_SERVER_URL"]);
    expect(nap.LLAMA_SERVER_URL).toBe("http://127.0.0.1:8091"); // bỏ nháy
    expect(nap.LLAMA_SERVER_MODEL).toBe("qwen.gguf"); // bỏ chú thích cuối dòng
    for (const k of ["AI_AGENT_NEN_MOC", "AI_AGENT_THEO_VAI_TRO", "DATABASE_URL", "LLAMA_SERVER_API_KEY", "JWT_SECRET", "SESSION_SECRET", "OPENAI_API_KEY", "AI_REPO_SANDBOX_ROOTS", "AI_GHI_LUOT_DIR", "FOE_ENABLED", "GGUF_API_TOKEN"]) {
      expect(nap[k], k).toBeUndefined();
      expect(boQua).toContain(k);
    }
  });
  it("khoaDuocNap: tiền tố hợp lệ nhưng tên có API_KEY/SECRET/TOKEN vẫn bị loại", () => {
    expect(khoaDuocNap("LLAMA_SERVER_API_KEY")).toBe(false);
    expect(khoaDuocNap("AI_AGENT_SECRET_X")).toBe(false);
    expect(khoaDuocNap("AI_AGENT_GIU_NGHI")).toBe(false); // cờ hành vi: chỉ khai tường minh (--co), không nạp ngầm
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

describe("AI_AGENT_* — KHÔNG nạp ngầm từ tệp env; chỉ khai tường minh (dieu-phoi 2026-11-09)", () => {
  const ENV = `AI_AGENT_HOUSEKEEPING_ENABLED=true
AI_AGENT_HOUSEKEEPING_INTERVAL_MS=60000
AI_AGENT_NEN_MOC=0.5
AI_AGENT_CONG_KE_HOACH=1
AI_AGENT_THEO_VAI_TRO=0
AI_AGENT_SECRET_X=bi-mat
LLAMA_SERVER_URL=http://127.0.0.1:8091
`;
  it("★ chỉ hai cờ vận hành (không đổi hành vi model) được nạp; NEN_MOC / CONG_KE_HOACH / THEO_VAI_TRO bị bỏ và được báo tên", () => {
    const tep = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "env-")), "e.env");
    fs.writeFileSync(tep, ENV);
    const env: NodeJS.ProcessEnv = {};
    const kq = napEnvTuTep(tep, env);
    expect(kq.daNap).toEqual(["AI_AGENT_HOUSEKEEPING_ENABLED", "AI_AGENT_HOUSEKEEPING_INTERVAL_MS", "LLAMA_SERVER_URL"]);
    expect(env.AI_AGENT_NEN_MOC).toBeUndefined();
    expect(env.AI_AGENT_CONG_KE_HOACH).toBeUndefined();
    expect(env.AI_AGENT_THEO_VAI_TRO).toBeUndefined();
    expect(kq.boQuaCoAgent).toEqual(["AI_AGENT_CONG_KE_HOACH", "AI_AGENT_NEN_MOC", "AI_AGENT_THEO_VAI_TRO"]); // tên chứa SECRET không được liệt kê
    fs.rmSync(path.dirname(tep), { recursive: true, force: true });
  });
  it("khoaDuocNap: AI_AGENT_CONG_KE_HOACH và mọi AI_AGENT_* hành vi bị loại; HOUSEKEEPING được", () => {
    for (const k of ["AI_AGENT_CONG_KE_HOACH", "AI_AGENT_NEN_MOC", "AI_AGENT_GIAO_VIEC", "AI_AGENT_NGHI", "AI_AGENT_MAX_TOKENS_MOT_LUOT"]) expect(khoaDuocNap(k), k).toBe(false);
    for (const k of ["AI_AGENT_HOUSEKEEPING_ENABLED", "AI_AGENT_HOUSEKEEPING_INTERVAL_MS"]) expect(khoaDuocNap(k), k).toBe(true);
  });
  it("★ docCoTuongMinh: hợp lệ; sai tên / bí mật / giá trị rỗng / khoảng trắng bị báo", () => {
    expect(docCoTuongMinh("AI_AGENT_NEN_MOC=0.5, AI_AGENT_CONG_KE_HOACH=1")).toEqual({ co: { AI_AGENT_NEN_MOC: "0.5", AI_AGENT_CONG_KE_HOACH: "1" }, loi: [] });
    const r = docCoTuongMinh("DATABASE_URL=x,AI_AGENT_API_KEY=k,AI_AGENT_X=,AI_AGENT_Y=a b,ai_agent_z=1,AI_AGENT_OK=1");
    expect(r.co).toEqual({ AI_AGENT_OK: "1" });
    expect(r.loi).toHaveLength(5);
    expect(docCoTuongMinh(undefined)).toEqual({ co: {}, loi: [] });
  });
  it("datCoTuongMinh GHI ĐÈ (người chạy khai thì thắng); coAiAgentHieuLuc chỉ liệt kê AI_AGENT_* không bí mật, đã sắp xếp", () => {
    const env: NodeJS.ProcessEnv = { AI_AGENT_NEN_MOC: "0.3", AI_AGENT_B: "1", AI_AGENT_PASSWORD_X: "p", LLAMA_SERVER_URL: "u" };
    expect(datCoTuongMinh({ AI_AGENT_NEN_MOC: "0.5", AI_AGENT_A: "1" }, env)).toEqual(["AI_AGENT_A", "AI_AGENT_NEN_MOC"]);
    expect(env.AI_AGENT_NEN_MOC).toBe("0.5");
    expect(coAiAgentHieuLuc(env)).toEqual({ AI_AGENT_A: "1", AI_AGENT_B: "1", AI_AGENT_NEN_MOC: "0.5" });
    expect(Object.keys(coAiAgentHieuLuc(env))).toEqual(["AI_AGENT_A", "AI_AGENT_B", "AI_AGENT_NEN_MOC"]);
  });
});
