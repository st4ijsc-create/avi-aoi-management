/**
 * Doc 80 Đợt 1 Task 6 (XC-01) — tRPC link chọn GET/POST theo KÍCH THƯỚC input.
 *
 * Trước task: một `httpBatchLink` GET duy nhất ⇒ input nằm trong URL ⇒ HTTP 431 ở 30 block IR
 * (lint + preview cùng batch), 20 rung POU, XML PLCopen 12 KB. Test này dựng CLIENT tRPC THẬT
 * (links thật của app) trên một `fetch` giả ghi lại từng request, rồi đọc method/URL/body.
 */
import { describe, it, expect } from "vitest";
import { createTRPCClient } from "@trpc/client";
import superjson from "superjson";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  TRPC_POST_INPUT_THRESHOLD_BYTES,
  TRPC_MAX_GET_URL_LENGTH,
  serializedInputBytes,
  shouldSendAsPost,
  createAppTrpcLinks,
} from "./trpcLinks";

type Ghi = { method: string; url: string; body: string | undefined };

function taoClient() {
  const ghi: Ghi[] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    ghi.push({ method: String(init?.method ?? "GET"), url, body: init?.body as string | undefined });
    // Batch response: một phần tử cho mỗi procedure (path phân cách bởi dấu phẩy).
    const pathPart = new URL(url, "http://x").pathname.replace(/^\/api\/trpc\//, "");
    const n = decodeURIComponent(pathPart).split(",").length;
    const payload = Array.from({ length: n }, () => ({ result: { data: superjson.serialize({ ok: true }) } }));
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createTRPCClient<any>({
    links: createAppTrpcLinks({ url: "http://x/api/trpc", fetch: fakeFetch as typeof fetch }) as any,
  }) as any;
  return { client, ghi };
}

/** Flow IR hình dạng thật, n block — ~150 B/block serialized. */
function flowIr(n: number) {
  return {
    flow_id: "flow-lon",
    target_device_type: "universal-robots",
    version: 1,
    blocks: Array.from({ length: n }, (_, i) => ({
      id: `b${i}`,
      type: "move_joint",
      target: { joints: [0, -1.57, 1.57, 0, 1.57, 0] },
      speed_pct: 20,
    })),
  };
}

describe("serializedInputBytes / shouldSendAsPost — ngưỡng 2 KB trên input ĐÃ serialize", () => {
  it("đo byte UTF-8 của superjson.serialize(input), không phải số ký tự", () => {
    const s = "ệ".repeat(10); // 10 ký tự, 30 byte UTF-8
    const bytes = serializedInputBytes({ s });
    expect(bytes).toBe(new TextEncoder().encode(JSON.stringify(superjson.serialize({ s }))).length);
    expect(bytes).toBeGreaterThan(30);
  });

  it("undefined ⇒ 0 byte (query không input vẫn GET)", () => {
    expect(serializedInputBytes(undefined)).toBe(0);
  });

  it("ngưỡng = 2048 byte; query ≤ ngưỡng ⇒ GET, > ngưỡng ⇒ POST", () => {
    expect(TRPC_POST_INPUT_THRESHOLD_BYTES).toBe(2048);
    // tìm độ dài chuỗi cho đúng biên
    const envelope = serializedInputBytes({ s: "" });
    const atLimit = { s: "a".repeat(2048 - envelope) };
    const overLimit = { s: "a".repeat(2048 - envelope + 1) };
    expect(serializedInputBytes(atLimit)).toBe(2048);
    expect(serializedInputBytes(overLimit)).toBe(2049);
    expect(shouldSendAsPost({ type: "query", input: atLimit })).toBe(false);
    expect(shouldSendAsPost({ type: "query", input: overLimit })).toBe(true);
  });

  it("mutation/subscription KHÔNG bao giờ đi nhánh override (mutation vốn đã POST)", () => {
    const big = { s: "a".repeat(10_000) };
    expect(shouldSendAsPost({ type: "mutation", input: big })).toBe(false);
    expect(shouldSendAsPost({ type: "subscription", input: big })).toBe(false);
  });
});

describe("createAppTrpcLinks — request THẬT mà client phát ra", () => {
  it("query nhỏ ⇒ GET, input nằm trong URL (hành vi cũ giữ nguyên)", async () => {
    const { client, ghi } = taoClient();
    await client.ir.lint.query({ flow: flowIr(2) });
    expect(ghi).toHaveLength(1);
    expect(ghi[0].method).toBe("GET");
    expect(ghi[0].url).toContain("input=");
    expect(ghi[0].body).toBeUndefined();
  });

  it("IR 1000 block lint + preview CÙNG tick ⇒ MỘT POST, URL không mang input", async () => {
    const { client, ghi } = taoClient();
    const flow = flowIr(1000);
    await Promise.all([
      client.ir.lint.query({ flow }),
      client.ir.transpilePreview.query({ flow, target: "urscript" }),
    ]);
    expect(ghi).toHaveLength(1);
    expect(ghi[0].method).toBe("POST");
    expect(ghi[0].url).not.toContain("input=");
    expect(ghi[0].url.length).toBeLessThan(200);
    const body = JSON.parse(ghi[0].body!);
    expect(body["0"].json.flow.blocks).toHaveLength(1000);
    expect(body["1"].json.target).toBe("urscript");
  });

  it("PLCopen XML 2 MB ⇒ POST", async () => {
    const { client, ghi } = taoClient();
    const xml = "<project>" + "x".repeat(2 * 1024 * 1024) + "</project>";
    await client.programming.plcopenImport.query({ xml });
    expect(ghi).toHaveLength(1);
    expect(ghi[0].method).toBe("POST");
    expect(ghi[0].url).not.toContain("input=");
    expect(JSON.parse(ghi[0].body!)["0"].json.xml).toHaveLength(xml.length);
  });

  it("một tick trộn query nhỏ + query lớn ⇒ nhỏ đi GET, lớn đi POST", async () => {
    const { client, ghi } = taoClient();
    await Promise.all([
      client.ir.status.query(),
      client.ir.lint.query({ flow: flowIr(1000) }),
    ]);
    const methods = ghi.map((g) => g.method).sort();
    expect(methods).toEqual(["GET", "POST"]);
    const get = ghi.find((g) => g.method === "GET")!;
    expect(get.url).toContain("ir.status");
    expect(get.url).not.toContain("ir.lint");
  });

  it("nhiều query SÁT ngưỡng cùng tick ⇒ batch GET tự tách, không URL nào vượt trần", async () => {
    const { client, ghi } = taoClient();
    const envelope = serializedInputBytes({ s: "" });
    // ký tự '"' mã hoá URL thành %22 (3 ký tự) ⇒ 2 KB input thành ~6 KB URL
    const nearLimit = { s: '"'.repeat(Math.floor((2048 - envelope) / 2)) };
    expect(shouldSendAsPost({ type: "query", input: nearLimit })).toBe(false);
    await Promise.all([1, 2, 3, 4].map(() => client.programming.pouLint.query(nearLimit)));
    expect(ghi.every((g) => g.method === "GET")).toBe(true);
    expect(ghi.length).toBeGreaterThan(1);
    for (const g of ghi) {
      expect(new URL(g.url).pathname.length + new URL(g.url).search.length).toBeLessThanOrEqual(TRPC_MAX_GET_URL_LENGTH);
    }
  });

  it("mutation lớn vẫn POST như trước (không qua nhánh override)", async () => {
    const { client, ghi } = taoClient();
    await client.ir.saveFlow.mutate({ flow: flowIr(1000) });
    expect(ghi).toHaveLength(1);
    expect(ghi[0].method).toBe("POST");
  });
});

describe("main.tsx dùng links của app (không tự dựng httpBatchLink GET trần)", () => {
  it("client chính gọi createAppTrpcLinks", () => {
    const src = readFileSync(path.resolve(__dirname, "..", "main.tsx"), "utf8");
    expect(src).toMatch(/links:\s*createAppTrpcLinks\(/);
    expect(src).not.toMatch(/\bhttpBatchLink\(/);
  });
});
