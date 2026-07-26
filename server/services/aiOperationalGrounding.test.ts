/**
 * doc69 G2-7 (Wave E4) — "ask→do" 1-tap navigate resolver.
 *
 * Proves the answer path attaches a `navigate` client-action for a how-to answer
 * grounded in a KNOWN, whitelisted operational card — and does NOT for:
 *   - a route outside ALLOWED_CLIENT_ROUTES (unauthorized/unknown route)
 *   - a non-how-to intent (even with an otherwise-valid operational citation)
 *   - no operational citation at all (a plain doc/feature-grounded answer)
 *   - an operational citation whose sourcePath isn't in the card index (stale)
 *   - a missing/empty card index (fail-safe — never throws)
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  resolveOperationalNavigate,
  resetOperationalCardIndexCacheForTest,
  type OperationalCardMeta,
} from "./aiOperationalGrounding";
import { ALLOWED_CLIENT_ROUTES } from "./aiLocalTools/writeHandlers/client";

function card(overrides: Partial<OperationalCardMeta> = {}): OperationalCardMeta {
  return {
    slug: "production-orders",
    sourcePath: "knowledge/operational/production-orders.md",
    route: "/production-orders",
    permission: "production_orders",
    role: [],
    screenVi: "Đơn hàng sản xuất",
    screenEn: "Production Orders",
    inSidebar: true,
    navGroupVi: "Sản xuất",
    navGroupEn: "Production",
    module: "MOD_PRODUCTION",
    license: "OPTIONAL",
    ...overrides,
  };
}

function indexOf(...cards: OperationalCardMeta[]): Map<string, OperationalCardMeta> {
  return new Map(cards.map((c) => [c.sourcePath, c]));
}

afterEach(() => {
  resetOperationalCardIndexCacheForTest();
});

describe("resolveOperationalNavigate", () => {
  it("attaches a suggested navigate action for a how-to answer grounded in a KNOWN, whitelisted route", () => {
    // /production-orders is in ALLOWED_CLIENT_ROUTES (whitelist reused from the
    // explicit navigate tool) — sanity-check the fixture is actually meaningful.
    expect(ALLOWED_CLIENT_ROUTES).toContain("/production-orders");

    const c = card();
    const result = resolveOperationalNavigate(
      {
        intent: "how_to",
        language: "vi",
        citations: [
          { sourceType: "operational", sourcePath: c.sourcePath },
          { sourceType: "doc", sourcePath: "docs/other.md" },
        ],
      },
      { cardIndex: indexOf(c) },
    );

    expect(result).not.toBeNull();
    expect(result?.action).toBe("navigate");
    expect(result?.route).toBe("/production-orders");
    expect(result?.suggested).toBe(true);
    expect(typeof result?.message).toBe("string");
    expect(result?.message.length).toBeGreaterThan(0);
  });

  it("picks the first operational citation the index actually knows, even when it isn't citation #0", () => {
    const c = card({ sourcePath: "knowledge/operational/reports.md", route: "/reports" });
    const result = resolveOperationalNavigate(
      {
        intent: "how_to",
        language: "vi",
        citations: [
          { sourceType: "doc", sourcePath: "docs/unrelated.md" },
          { sourceType: "operational", sourcePath: c.sourcePath },
        ],
      },
      { cardIndex: indexOf(c) },
    );
    expect(result?.route).toBe("/reports");
  });

  it("does NOT attach a navigate action when the card's route is outside ALLOWED_CLIENT_ROUTES (unauthorized/unknown route)", () => {
    expect(ALLOWED_CLIENT_ROUTES).not.toContain("/totally-unknown-admin-only-route");
    const c = card({
      sourcePath: "knowledge/operational/unknown-route.md",
      route: "/totally-unknown-admin-only-route",
    });
    const result = resolveOperationalNavigate(
      {
        intent: "how_to",
        language: "vi",
        citations: [{ sourceType: "operational", sourcePath: c.sourcePath }],
      },
      { cardIndex: indexOf(c) },
    );
    expect(result).toBeNull();
  });

  it("does NOT attach a navigate action for a non-how-to answer (intent=technical), even with a valid citation", () => {
    const c = card();
    const result = resolveOperationalNavigate(
      {
        intent: "technical",
        language: "vi",
        citations: [{ sourceType: "operational", sourcePath: c.sourcePath }],
      },
      { cardIndex: indexOf(c) },
    );
    expect(result).toBeNull();
  });

  it("does NOT attach a navigate action for a general/definition/list/troubleshoot/architecture answer", () => {
    const c = card();
    for (const intent of ["general", "definition", "list", "troubleshoot", "architecture"] as const) {
      const result = resolveOperationalNavigate(
        {
          intent,
          language: "vi",
          citations: [{ sourceType: "operational", sourcePath: c.sourcePath }],
        },
        { cardIndex: indexOf(c) },
      );
      expect(result).toBeNull();
    }
  });

  it("does NOT attach a navigate action when there is no operational-sourceType citation", () => {
    const result = resolveOperationalNavigate(
      {
        intent: "how_to",
        language: "vi",
        citations: [
          { sourceType: "doc", sourcePath: "docs/howto.md" },
          { sourceType: "feature", sourcePath: "knowledge/features/howto-lot-management.md" },
        ],
      },
      { cardIndex: indexOf(card()) },
    );
    expect(result).toBeNull();
  });

  it("does NOT attach a navigate action when the operational citation's sourcePath isn't in the index (stale/unknown card)", () => {
    const result = resolveOperationalNavigate(
      {
        intent: "how_to",
        language: "vi",
        citations: [{ sourceType: "operational", sourcePath: "knowledge/operational/does-not-exist.md" }],
      },
      { cardIndex: indexOf(card()) }, // index only knows production-orders.md
    );
    expect(result).toBeNull();
  });

  it("is fail-safe when the card index is empty (e.g. generator never ran)", () => {
    const result = resolveOperationalNavigate(
      {
        intent: "how_to",
        language: "vi",
        citations: [{ sourceType: "operational", sourcePath: "knowledge/operational/production-orders.md" }],
      },
      { cardIndex: new Map() },
    );
    expect(result).toBeNull();
  });

  it("localizes the message by language (vi default, en, zh)", () => {
    const c = card({ sourcePath: "knowledge/operational/alerts.md", route: "/alerts" });
    const en = resolveOperationalNavigate(
      { intent: "how_to", language: "en", citations: [{ sourceType: "operational", sourcePath: c.sourcePath }] },
      { cardIndex: indexOf(c) },
    );
    expect(en?.message).toMatch(/open|Open/i);

    const zh = resolveOperationalNavigate(
      { intent: "how_to", language: "zh", citations: [{ sourceType: "operational", sourcePath: c.sourcePath }] },
      { cardIndex: indexOf(c) },
    );
    expect(zh?.message).toContain("打开");
  });
});
