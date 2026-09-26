/**
 * doc69 G2-4 review fix (W1-4) — /v1 status codes for quota/license enforcement.
 *
 * Before this fix, `QuotaExceededError`/`LicenseGateError` thrown by `aiGateway.planInference`
 * (both opt-in, default OFF) fell through `openaiGateway.ts`'s generic catch-all and returned a
 * misleading HTTP 500 ("server_error") — indistinguishable from a real engine crash and giving
 * IDE/API callers nothing to act on. This proves they now map to a proper, client-actionable
 * OpenAI-compat 429 / 403, mirroring the existing `SafetyBlockedError` → 400 branch already
 * covered by openaiGatewaySafety.test.ts.
 *
 * `../services/aiGatewayQuota` and `../_core/moduleGate` are mocked so this file can force each
 * outcome deterministically without a real DB/license setup — the REAL `aiGateway.planInference`
 * wiring is exercised end-to-end (same mocking level as aiGatewayQuotaWiring.test.ts /
 * aiGatewayLicenseGate.test.ts).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(async () => ({
    text: "hi",
    tokensPrompt: 1,
    tokensGenerated: 1,
    modelId: "x",
    totalTimeMs: 1,
    tokensPerSecond: 1,
  })),
  generateText: vi.fn(),
  generateFim: vi.fn(async () => ({
    text: "hi",
    tokensPrompt: 1,
    tokensGenerated: 1,
    modelId: "x",
    totalTimeMs: 1,
    tokensPerSecond: 1,
  })),
  generateEmbedding: vi.fn(async () => ({ embedding: [0.1], dimensions: 1, modelId: "embed" })),
  generateEmbeddings: vi.fn(async () => ({ embeddings: [[0.1]], dimensions: 1, modelId: "embed" })),
  chatCompletionStream: async function* () {},
  generateTextStream: async function* () {},
}));

const checkQuotaMock = vi.fn();
vi.mock("../services/aiGatewayQuota", () => ({
  checkQuota: (...a: unknown[]) => checkQuotaMock(...a),
}));

const isModuleLicensedMock = vi.fn();
vi.mock("../_core/moduleGate", () => ({
  isModuleLicensed: (...a: unknown[]) => isModuleLicensedMock(...a),
}));

const getDbMock = vi.fn();
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

import { registerOpenAiGateway } from "./openaiGateway";

async function serve(app: express.Express): Promise<{ url: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const API_KEY = "ENFORCE-TEST-KEY";
const AUTH = { Authorization: `Bearer ${API_KEY}` };

let enabled: { url: string; server: Server };
const ENV_KEYS = ["OPENAI_GATEWAY_ENABLED", "OPENAI_GATEWAY_API_KEY", "OPENAI_GATEWAY_PATH"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OPENAI_GATEWAY_ENABLED = "true";
  process.env.OPENAI_GATEWAY_API_KEY = API_KEY;
  delete process.env.OPENAI_GATEWAY_PATH; // default /v1
  const app = express();
  expect(registerOpenAiGateway(app)).toBe(true);
  enabled = await serve(app);
});

afterAll(async () => {
  await new Promise<void>((resolve) => enabled.server.close(() => resolve()));
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockResolvedValue(null); // metering drops silently — not under test here
});

afterEach(() => {
  delete process.env.AI_QUOTA_ENFORCE;
  delete process.env.AI_GATEWAY_LICENSE_GATE_ENABLED;
});

describe("POST /v1/chat/completions — quota/license enforcement status codes (review fix W1-4)", () => {
  it("QuotaExceededError → HTTP 429 with a client-actionable OpenAI-compat error body (not a generic 500)", async () => {
    process.env.AI_QUOTA_ENFORCE = "true";
    checkQuotaMock.mockResolvedValue({ allowed: false, usedTokens: 999, budgetTokens: 500, source: "user" });

    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.type).toBe("insufficient_quota");
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.used_tokens).toBe(999);
    expect(body.error.budget_tokens).toBe(500);
    expect(typeof body.error.message).toBe("string");
  });

  it("LicenseGateError → HTTP 403 with a client-actionable OpenAI-compat error body (not a generic 500)", async () => {
    process.env.AI_GATEWAY_LICENSE_GATE_ENABLED = "true";
    isModuleLicensedMock.mockResolvedValue(false);

    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.type).toBe("permission_error");
    expect(body.error.code).toBe("ai_module_not_licensed");
    expect(typeof body.error.message).toBe("string");
  });

  it("both flags off (default): neither check is consulted and the call succeeds normally (200)", async () => {
    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    expect(checkQuotaMock).not.toHaveBeenCalled();
    expect(isModuleLicensedMock).not.toHaveBeenCalled();
  });
});

describe("POST /v1/completions (FIM) — quota/license enforcement status codes (review fix W1-4)", () => {
  it("QuotaExceededError → HTTP 429", async () => {
    process.env.AI_QUOTA_ENFORCE = "true";
    checkQuotaMock.mockResolvedValue({ allowed: false, usedTokens: 999, budgetTokens: 500, source: "user" });

    const res = await fetch(`${enabled.url}/v1/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "def foo():\n  " }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.type).toBe("insufficient_quota");
    expect(body.error.code).toBe("quota_exceeded");
  });

  it("LicenseGateError → HTTP 403", async () => {
    process.env.AI_GATEWAY_LICENSE_GATE_ENABLED = "true";
    isModuleLicensedMock.mockResolvedValue(false);

    const res = await fetch(`${enabled.url}/v1/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "def foo():\n  " }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.type).toBe("permission_error");
    expect(body.error.code).toBe("ai_module_not_licensed");
  });
});
