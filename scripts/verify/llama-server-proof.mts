/**
 * doc 48 R5 — persistent llama-server WIRING proof.
 *
 * Stands up a tiny OpenAI-compatible mock server, points the engine at it, and
 * proves generateText / generateJSON route to the server + parse the response,
 * that routing is model-scoped (a different model stays in-process), and that
 * STRICT mode throws (honest-degrade) when the server is down. The REAL GPU
 * generation is the operator's runtime; this proves the HTTP path is correct.
 *
 * Run: npx tsx scripts/verify/llama-server-proof.mts
 */
import "dotenv/config";
import http from "node:http";

const MODEL = "Qwen3-Deep-Test";
let pass = true;
function check(name: string, cond: boolean) {
  if (!cond) pass = false;
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${name}`);
}

// ── tiny OpenAI-compatible mock ────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const reqJson = JSON.parse(body || "{}");
      const wantsJson = !!reqJson.json_schema || reqJson.response_format?.type === "json_object";
      const content = wantsJson ? JSON.stringify({ summary: "mock-json-ok", score: 7 }) : "MOCK-SERVER-TEXT-OK";
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content } }],
          usage: { prompt_tokens: 11, completion_tokens: 22 },
        }),
      );
    });
    return;
  }
  res.writeHead(404).end();
});

async function listen(): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as any).port;
}

async function main() {
  const port = await listen();
  process.env.GGUF_DEFAULT_MODEL = `${MODEL}.gguf`;
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = `http://127.0.0.1:${port}`;
  process.env.LLAMA_SERVER_MODEL = MODEL;

  const eng = await import("../../server/services/aiGgufEngine");
  const srv = await import("../../server/services/aiLlamaServerClient");

  console.log("=== routing decisions ===");
  check("routes deep model to server", srv.shouldUseServerForText(MODEL) === true);
  check("undefined modelId (→deep) routes to server", srv.shouldUseServerForText(undefined) === true);
  check("a DIFFERENT model stays in-process", srv.shouldUseServerForText("Some-Code-Model") === false);
  check("health probe sees the server", (await srv.llamaServerHealthy()) === true);

  console.log("\n=== generateText via server ===");
  const t = await eng.generateText({ prompt: "hi", maxTokens: 32 } as any, MODEL);
  check("text came from mock server", t.text === "MOCK-SERVER-TEXT-OK");
  check("token usage mapped", t.tokensPrompt === 11 && t.tokensGenerated === 22);
  check("modelId echoed", t.modelId === MODEL);

  console.log("\n=== generateJSON via server (schema-constrained) ===");
  const schema = { type: "object", properties: { summary: { type: "string" }, score: { type: "number" } }, required: ["summary"] };
  const j = await eng.generateJSON<{ summary: string; score: number }>(schema, { prompt: "summarize", maxTokens: 64 } as any, MODEL);
  check("json parsed from server", j.data?.summary === "mock-json-ok" && j.data?.score === 7);

  console.log("\n=== STRICT mode: server down → THROWS (honest-degrade, no silent in-process) ===");
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:1"; // dead
  process.env.LLAMA_SERVER_STRICT = "true";
  let threw = false;
  try {
    await eng.generateText({ prompt: "x", maxTokens: 8 } as any, MODEL);
  } catch {
    threw = true;
  }
  check("STRICT + server down → generateText throws", threw);

  console.log("\n=== disabled → not routed (in-process path owns it) ===");
  delete process.env.LLAMA_SERVER_ENABLED;
  check("flag OFF → shouldUseServerForText false", srv.shouldUseServerForText(MODEL) === false);

  console.log(`\nRESULT: ${pass ? "PASS ✓ — llama-server routing/parse/strict/scope all correct" : "FAIL ✗"}`);
  server.close();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("proof error:", e);
  server.close();
  process.exit(2);
});
