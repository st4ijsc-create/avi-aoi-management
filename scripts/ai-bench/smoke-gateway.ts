/**
 * Doc 34 P3 — OpenAI-gateway live smoke. Mounts ONLY the gateway router on a bare Express
 * app (no full app boot), then exercises /v1/models, /v1/chat/completions, /v1/completions
 * (FIM), /v1/embeddings with the bearer key — proving the keystone serves VS Code + Continue.
 * Loads the big chat model FIRST (load-order VRAM fix) before the small embed.
 * Run: npx tsx scripts/ai-bench/smoke-gateway.ts
 */
import "dotenv/config";
const PORT = 8099;
const KEY = "smoke-key-123";
process.env.OPENAI_GATEWAY_ENABLED = "true";
process.env.OPENAI_GATEWAY_API_KEY = KEY;
process.env.OPENAI_GATEWAY_PATH = "/v1";
process.env.GGUF_CODE_CTX = process.env.GGUF_CODE_CTX || "8192";

import express from "express";
import { registerOpenAiGateway } from "../../server/routes/openaiGateway";

const base = `http://127.0.0.1:${PORT}/v1`;
const H = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };

async function main() {
  const app = express();
  const mounted = registerOpenAiGateway(app);
  console.log(`registerOpenAiGateway → ${mounted}`);
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));
  let pass = 0, fail = 0;
  const check = (name: string, ok: boolean, extra = "") => { console.log(`  ${ok ? "✅" : "❌"} ${name} ${extra}`); ok ? pass++ : fail++; };

  try {
    // 0) auth: missing token → 401
    const noAuth = await fetch(`${base}/models`).then((r) => r.status);
    check("401 without bearer", noAuth === 401, `(got ${noAuth})`);

    // 1) /v1/models
    const models = await fetch(`${base}/models`, { headers: H }).then((r) => r.json());
    check("/v1/models lists logical models", Array.isArray(models?.data) && models.data.length > 0, `(${models?.data?.map((m: any) => m.id).join(",")})`);

    // 2) /v1/chat/completions (loads 30B FIRST — good order)
    const chat = await fetch(`${base}/chat/completions`, {
      method: "POST", headers: H,
      body: JSON.stringify({ model: "code", messages: [{ role: "user", content: "Reply with exactly: PONG" }], max_tokens: 8, temperature: 0 }),
    }).then((r) => r.json());
    const chatText = chat?.choices?.[0]?.message?.content ?? "";
    check("/v1/chat/completions returns choices", !!chatText, `("${String(chatText).slice(0, 40)}")`);

    // 3) /v1/completions FIM (prompt + suffix)
    const comp = await fetch(`${base}/completions`, {
      method: "POST", headers: H,
      body: JSON.stringify({ model: "fim", prompt: "FUNCTION_BLOCK Add\nVAR_INPUT a,b : INT; END_VAR\n", suffix: "\nEND_FUNCTION_BLOCK", max_tokens: 24, temperature: 0 }),
    }).then((r) => r.json());
    check("/v1/completions (FIM) returns text", typeof comp?.choices?.[0]?.text === "string", `("${String(comp?.choices?.[0]?.text ?? "").replace(/\n/g, " ").slice(0, 40)}")`);

    // 4) /v1/embeddings (small — loads embed after 30B, fits)
    const emb = await fetch(`${base}/embeddings`, {
      method: "POST", headers: H,
      body: JSON.stringify({ model: "embed", input: "structured text moving average" }),
    }).then((r) => r.json());
    const dim = emb?.data?.[0]?.embedding?.length ?? 0;
    check("/v1/embeddings returns vector", dim > 0, `(dim=${dim})`);
  } catch (e) {
    console.error("  ERROR", (e as Error)?.message ?? e); fail++;
  } finally {
    server.close();
  }
  console.log(`\n=== GATEWAY SMOKE: ${pass} pass / ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
