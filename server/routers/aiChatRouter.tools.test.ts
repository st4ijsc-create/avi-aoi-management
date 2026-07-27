/**
 * doc69 W0-5 item 3 — the `/ai-chat` tool-count footer (aiChatRouter.tools) used to
 * be sourced from `aiChatAssistant.getAvailableTools()`, a hard-coded list of the 6
 * tools known to the deprecated no-RAG `processChat` backend (dead since P1/doc 11).
 * The REAL assistant runs on the `aiLocalTools` registry (server/services/aiLocalTools/
 * toolRegistry.ts `listTools()`) — read/write/client tools across F6/F7/P2/programming
 * groups, ~67 entries — so the footer was silently advertising ~1/10th of the actual
 * tool surface.
 *
 * This proves the router's `tools` query returns the REAL registry (count/names match
 * `listTools()` 1:1).
 *
 * doc69 B2 (Wave 5) — `aiChatAssistant.ts` (processChat + getAvailableTools) has now
 * been DELETED entirely (no live caller), so the old "stale 6-tool set" regression
 * guard against `getAvailableTools()` no longer applies — there is nothing left to
 * regress back to. Dropped those two assertions; kept the one that still matters
 * (the footer is sourced from the real registry).
 *
 * The chat-answer pipeline (`answerQuestion` / RAG / GGUF) is irrelevant to the
 * tools-footer query — mocked out so importing the router stays cheap/deterministic
 * (no DB, no local-KB embedding index) in this test.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../services/aiLocalKnowledgeService", () => ({
  answerQuestion: vi.fn(async () => ({ answer: "", sources: [], toolsUsed: [] })),
}));

const mockGetDb = vi.fn(async () => null as any);
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => mockGetDb(...a) }));

import { aiChatRouter } from "./aiChatRouter";
import { listTools } from "../services/aiLocalTools";

const ctxFor = (id: number, role: string) => ({ user: { id, role } }) as never;

describe("aiChatRouter.tools — sourced from the real tool registry (doc69 W0-5 item 3)", () => {
  it("returns every tool in listTools() (name+description), not a subset", async () => {
    const caller = aiChatRouter.createCaller(ctxFor(1, "operator"));
    const result = await caller.tools();

    const real = listTools();
    expect(result).toHaveLength(real.length);
    expect(result.map((t: any) => t.name).sort()).toEqual(real.map((t) => t.name).sort());
    for (const r of result) {
      expect(typeof r.name).toBe("string");
      expect(typeof r.description).toBe("string");
    }
  });

  it("the real registry is strictly larger than the old deprecated 6-tool footer (regression guard)", async () => {
    const caller = aiChatRouter.createCaller(ctxFor(2, "operator"));
    const result = await caller.tools();

    // The deprecated processChat backend only ever knew about 6 hard-coded tools
    // (aiChatAssistant.ts, deleted doc69 B2). Pin that number directly so a
    // regression back to a tiny hard-coded list would still be caught.
    expect(result.length).toBeGreaterThan(6);
  });
});
