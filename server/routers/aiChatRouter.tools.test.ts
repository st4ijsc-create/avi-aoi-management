/**
 * doc69 W0-5 item 3 — the `/ai-chat` tool-count footer (aiChatRouter.tools) used to
 * be sourced from `aiChatAssistant.getAvailableTools()`, a hard-coded list of the 6
 * tools known to the deprecated no-RAG `processChat` backend (dead since P1/doc 11).
 * The REAL assistant runs on the `aiLocalTools` registry (server/services/aiLocalTools/
 * toolRegistry.ts `listTools()`) — read/write/client tools across F6/F7/P2/programming
 * groups, ~67 entries — so the footer was silently advertising ~1/10th of the actual
 * tool surface.
 *
 * This proves the router's `tools` query now returns the REAL registry (count/names
 * match `listTools()` 1:1), and that this is strictly MORE than the stale 6-tool
 * `getAvailableTools()` set (so a regression back to the old source would be caught).
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
import { getAvailableTools } from "../services/aiChatAssistant";

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

  it("the real registry is strictly larger than the deprecated 6-tool hardcoded footer (regression guard)", async () => {
    const caller = aiChatRouter.createCaller(ctxFor(2, "operator"));
    const result = await caller.tools();

    const stale = getAvailableTools();
    expect(stale.length).toBe(6); // the OLD hard-coded set, pinned so a drift here is visible
    expect(result.length).toBeGreaterThan(stale.length);
    expect(result.length).toBeGreaterThan(6);
  });

  it("does NOT return the stale hard-coded tool names verbatim as the full set", async () => {
    const caller = aiChatRouter.createCaller(ctxFor(3, "operator"));
    const result = await caller.tools();
    const resultNames = new Set(result.map((t: any) => t.name));

    const stale = getAvailableTools();
    // Every stale name being present is fine (some tools may overlap by name), but the
    // stale list must NOT be the same closed set — the real registry has extra tools.
    const extra = [...resultNames].filter((n) => !stale.some((s) => s.name === n));
    expect(extra.length).toBeGreaterThan(0);
  });
});
