/**
 * Đợt 0.3 — cổng ưu tiên NỐI VÀO ĐƯỜNG THẬT của `aiLlamaServerClient` (không chỉ module cổng).
 *
 * Phép đo ở đây là THỨ TỰ `fetch` thật sự rời tiến trình tới llama-server (`global.fetch` giả):
 *   • lượt `nen` đến TRƯỚC nhưng lượt tương tác đến SAU vẫn được gửi trước (một slot);
 *   • stream giữ slot tới khi luồng xong / bị `return()` sớm;
 *   • người dùng huỷ khi đang chờ ⇒ không một `fetch` nào được gửi cho lượt đó;
 *   • FIM: chỉ qua cổng khi dùng CHUNG server với đường chữ;
 *   • cờ tắt ⇒ mọi lượt gửi ngay (hành vi cũ).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function moiNap() {
  vi.resetModules();
  const client = await import("./aiLlamaServerClient");
  const cong = await import("./ai/hangDoiUuTienLlm");
  return { client, cong };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LLAMA_SERVER_STRICT;
  delete process.env.LLAMA_SERVER_API_KEY;
  delete process.env.LLM_PRIORITY_GATE_ENABLED;
  delete process.env.LLM_PRIORITY_GATE_CONCURRENCY;
  delete process.env.LLAMA_SERVER_PARALLEL;
  delete process.env.LLAMA_FIM_SERVER_URL;
  process.env.LLAMA_SERVER_SLOTS = "1";
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct.gguf";
  process.env.LLAMA_SERVER_MODEL = "qwen3-30b-a3b-instruct.gguf";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

/** `fetch` giả: mỗi lượt treo tới khi test gọi `xong(i)`; ghi lại nhãn (nội dung user) theo thứ tự gửi. */
function fetchTreo() {
  const daGui: string[] = [];
  const choXong: Array<() => void> = [];
  const fn = vi.fn(async (url: string, init: { body: string }) => {
    const than = JSON.parse(init.body);
    const nhan = String(than.messages?.at(-1)?.content ?? than.input_prefix ?? url).split("\n")[0];
    daGui.push(nhan);
    await new Promise<void>((r) => choXong.push(r));
    if (url.endsWith("/infill")) {
      return { ok: true, status: 200, json: async () => ({ content: "x", tokens_predicted: 1 }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: `tl:${nhan}` }, finish_reason: "stop" }], usage: {} }),
    };
  });
  return { fn, daGui, xongLuot: (i: number) => choXong[i]?.() };
}

describe("aiLlamaServerClient × cổng ưu tiên", () => {
  it("một slot: lượt `nen` đến trước vẫn nhường lượt tương tác đến sau (thứ tự fetch thật)", async () => {
    const { client, cong } = await moiNap();
    const f = fetchTreo();
    vi.stubGlobal("fetch", f.fn);

    const p1 = client.serverGenerateText({ prompt: "dau-tien" });
    await tick();
    const pNen = cong.chayVoiUuTien("nen", () => client.serverGenerateText({ prompt: "cron-eval" }));
    await tick();
    const pTt = client.serverChatCompletion({ messages: [{ role: "user", content: "nguoi-dung" }] });
    await tick();
    expect(f.daGui).toEqual(["dau-tien"]); // một slot ⇒ chỉ MỘT lượt đã xuống server
    expect(cong.thongKeHangDoiLlm().dangCho).toEqual({ "tuong-tac": 1, agent: 0, nen: 1 });

    f.xongLuot(0);
    await p1;
    await tick();
    expect(f.daGui).toEqual(["dau-tien", "nguoi-dung"]);
    f.xongLuot(1);
    await pTt;
    await tick();
    f.xongLuot(2);
    await expect(pNen).resolves.toMatchObject({ text: "tl:cron-eval" });
    expect(f.daGui).toEqual(["dau-tien", "nguoi-dung", "cron-eval"]);
    expect(cong.thongKeHangDoiLlm().dangChay).toBe(0);
  });

  it("serverGenerateJSON cũng đi qua cổng", async () => {
    const { client } = await moiNap();
    const f = fetchTreo();
    vi.stubGlobal("fetch", f.fn);
    const p1 = client.serverGenerateText({ prompt: "a" });
    await tick();
    const pJson = client.serverGenerateJSON({ type: "object" }, { prompt: "b" });
    await tick();
    expect(f.daGui).toEqual(["a"]);
    f.xongLuot(0);
    await p1;
    await tick();
    expect(f.daGui).toEqual(["a", "b"]);
    f.xongLuot(1);
    await pJson.catch(() => undefined); // nội dung giả không phải JSON — ở đây chỉ đo THỨ TỰ gửi
  });

  it("huỷ khi đang chờ ⇒ rời hàng, KHÔNG gửi fetch cho lượt đó", async () => {
    const { client, cong } = await moiNap();
    const f = fetchTreo();
    vi.stubGlobal("fetch", f.fn);
    const p1 = client.serverGenerateText({ prompt: "dang-chay" });
    await tick();
    const ac = new AbortController();
    const p2 = client.serverGenerateText({ prompt: "bi-huy", signal: ac.signal });
    await tick();
    ac.abort();
    await expect(p2).rejects.toBeInstanceOf(cong.LoiHangDoiLlmBiHuy);
    f.xongLuot(0);
    await p1;
    await tick();
    expect(f.daGui).toEqual(["dang-chay"]);
  });

  it("stream giữ slot suốt vòng đời; return() sớm ⇒ nhả, lượt chờ đi tiếp", async () => {
    const { client, cong } = await moiNap();
    const enc = new TextEncoder();
    const suKien = (c: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: c } }] })}\n\n`;
    const daGui: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { body: string }) => {
        const than = JSON.parse(init.body);
        daGui.push(String(than.messages.at(-1).content));
        if (than.stream) {
          const mieng = [enc.encode(suKien("a")), enc.encode(suKien("b")), enc.encode(suKien("c"))];
          let i = 0;
          return {
            ok: true,
            status: 200,
            body: {
              getReader: () => ({
                read: async () => (i < mieng.length ? { done: false, value: mieng[i++] } : { done: true }),
                cancel: async () => undefined,
              }),
            },
          };
        }
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }], usage: {} }) };
      }),
    );

    const g = client.serverGenerateTextStream({ prompt: "luong" });
    const dau = await g.next();
    expect(dau.value).toMatchObject({ type: "token", token: "a" });
    expect(cong.thongKeHangDoiLlm().dangChay).toBe(1);

    const pSau = cong.chayVoiUuTien("nen", () => client.serverGenerateText({ prompt: "sau-luong" }));
    await tick();
    expect(daGui).toEqual(["luong"]); // stream còn giữ slot

    await g.return(undefined); // client bỏ đi
    await expect(pSau).resolves.toMatchObject({ text: "ok" });
    expect(daGui).toEqual(["luong", "sau-luong"]);
    expect(cong.thongKeHangDoiLlm().dangChay).toBe(0);
  });

  it("FIM dùng CHUNG server với đường chữ ⇒ qua cổng; FIM server RIÊNG ⇒ không", async () => {
    const { client } = await moiNap();
    const f = fetchTreo();
    vi.stubGlobal("fetch", f.fn);
    const p1 = client.serverGenerateText({ prompt: "chu" });
    await tick();
    const pFim = client.generateFimViaServer("fim-chung", "", {} as any);
    await tick();
    expect(f.daGui).toEqual(["chu"]);
    f.xongLuot(0);
    await p1;
    await tick();
    f.xongLuot(1);
    await pFim;

    process.env.LLAMA_FIM_SERVER_URL = "http://127.0.0.1:8092";
    const r = await moiNap();
    const f2 = fetchTreo();
    vi.stubGlobal("fetch", f2.fn);
    const q1 = r.client.serverGenerateText({ prompt: "chu" });
    await tick();
    const qFim = r.client.generateFimViaServer("fim-rieng", "", {} as any);
    await tick();
    expect(f2.daGui).toEqual(["chu", "fim-rieng"]); // server FIM riêng có slot riêng
    f2.xongLuot(0);
    f2.xongLuot(1);
    await Promise.all([q1, qFim]);
  });

  it("cờ tắt LLM_PRIORITY_GATE_ENABLED=false ⇒ mọi lượt gửi ngay (hành vi cũ)", async () => {
    process.env.LLM_PRIORITY_GATE_ENABLED = "false";
    const { client, cong } = await moiNap();
    const f = fetchTreo();
    vi.stubGlobal("fetch", f.fn);
    const ps = [
      client.serverGenerateText({ prompt: "mot" }),
      cong.chayVoiUuTien("nen", () => client.serverGenerateText({ prompt: "hai" })),
      client.serverChatCompletion({ messages: [{ role: "user", content: "ba" }] }),
    ];
    await tick();
    expect(f.daGui).toEqual(["mot", "hai", "ba"]);
    [0, 1, 2].forEach(f.xongLuot);
    await Promise.all(ps);
  });
});
