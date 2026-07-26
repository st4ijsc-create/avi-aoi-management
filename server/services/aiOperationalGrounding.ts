/**
 * aiOperationalGrounding — doc69 G2-7 (Wave E4), item 2: "ask→do" 1-tap navigate.
 *
 * Decides whether an assistant answer should carry a client `navigate` action so
 * the FE can render a 1-tap "Mở màn X" button under a how-to answer. Grounded
 * ONLY in the auto-generated operational-card index
 * (knowledge/operational-cards.json, produced by
 * scripts/ai-kb/build-operational-cards.mjs from the route/nav/RBAC/router
 * catalogs) — this module never guesses a route from free text.
 *
 * Fail-safe: returns null (no button, answer unchanged) unless ALL of:
 *   1. The classified intent is "how_to" (an operational "how do I do X" answer —
 *      NOT a live-data/tool answer, NOT a clarification, NOT off-topic/general).
 *   2. At least one retrieved citation is sourceType "operational" AND its
 *      sourcePath is a KNOWN card in the index (i.e. the answer was actually
 *      grounded in a generated operational card, not a coincidental keyword hit).
 *   3. That card's `route` passes the SAME ALLOWED_CLIENT_ROUTES whitelist the
 *      explicit `navigate` tool uses — reused VERBATIM via
 *      `navigateTool.buildClientAction` (server/services/aiLocalTools/
 *      writeHandlers/client.ts), not reimplemented. An unknown/unauthorized
 *      route (not on the whitelist) makes buildClientAction return null, so this
 *      resolver returns null too — no button, ever, for a non-whitelisted route.
 *
 * The returned directive is marked `suggested: true` (see ClientActionDirective)
 * so the FE renders a tappable button instead of auto-navigating away from the
 * answer — unlike the explicit-command navigate/prefill_form tools, the user
 * did not ask to leave the page they're reading.
 */
import fs from "node:fs";
import path from "node:path";
import { navigateTool } from "./aiLocalTools/writeHandlers/client";
import type { ClientActionDirective, ToolExecContext, ToolLang } from "./aiLocalTools/toolRegistry";
import type { KbCitation, KbIntent, KbLanguage } from "./aiLocalKnowledgeService";

/** Shape of one entry in knowledge/operational-cards.json (kept in sync with
 * the `fm` object build-operational-cards.mjs writes). */
export interface OperationalCardMeta {
  slug: string;
  sourcePath: string;
  route: string;
  permission: string | null;
  role: string[];
  screenVi: string;
  screenEn: string;
  inSidebar: boolean;
  navGroupVi: string | null;
  navGroupEn: string | null;
  module: string | null;
  license: "CORE" | "OPTIONAL" | null;
}

const INDEX_FILE = path.join(process.cwd(), "knowledge", "operational-cards.json");

let cachedBySourcePath: Map<string, OperationalCardMeta> | null = null;

function loadOperationalCardIndex(): Map<string, OperationalCardMeta> {
  if (cachedBySourcePath) return cachedBySourcePath;
  const map = new Map<string, OperationalCardMeta>();
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const raw = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as unknown;
      if (Array.isArray(raw)) {
        for (const card of raw as OperationalCardMeta[]) {
          if (card && typeof card.sourcePath === "string" && typeof card.route === "string") {
            map.set(card.sourcePath, card);
          }
        }
      }
    }
  } catch {
    // Fail-safe — an unreadable/corrupt index just means no operational grounding
    // (never blocks the normal answer path).
  }
  cachedBySourcePath = map;
  return map;
}

/** Test-only: force the next resolveOperationalNavigate() to re-read the index from disk. */
export function resetOperationalCardIndexCacheForTest(): void {
  cachedBySourcePath = null;
}

export interface OperationalGroundingInput {
  intent: KbIntent;
  language: KbLanguage;
  citations: Pick<KbCitation, "sourceType" | "sourcePath">[];
}

export interface ResolveOperationalNavigateOptions {
  /** Inject a card index directly (tests). Defaults to the on-disk
   * knowledge/operational-cards.json (cached after first read). */
  cardIndex?: Map<string, OperationalCardMeta>;
  /** The real request's execCtx when available — unused by navigateTool's logic
   * today, but threaded through for parity/future audit use rather than always
   * synthesizing one. */
  execCtx?: ToolExecContext;
}

function toToolLang(language: KbLanguage): ToolLang {
  return language === "zh" ? "zh" : language === "en" ? "en" : "vi";
}

/**
 * Returns a `navigate` ClientActionDirective (`suggested: true`) when `input` is
 * a how-to answer grounded in a KNOWN, whitelisted operational card's route.
 * Returns null otherwise — fail-safe: normal answer, no button.
 */
export function resolveOperationalNavigate(
  input: OperationalGroundingInput,
  opts: ResolveOperationalNavigateOptions = {},
): ClientActionDirective | null {
  if (input.intent !== "how_to") return null;

  const index = opts.cardIndex ?? loadOperationalCardIndex();
  if (index.size === 0) return null;

  // Citations are already score-sorted (best first) by retrieveKnowledge(); take
  // the first citation that is BOTH sourceType "operational" AND a card we
  // actually know about (guards against a stale/mismatched index).
  const hit = input.citations.find((c) => c.sourceType === "operational" && index.has(c.sourcePath));
  if (!hit) return null;

  const card = index.get(hit.sourcePath);
  if (!card || !card.route) return null;

  const ctx: ToolExecContext = opts.execCtx ?? {
    user: { id: 0, role: "system" },
    lang: toToolLang(input.language),
  };

  // Reuse the explicit-command tool's own route-whitelist check verbatim — this
  // is the ONLY place ALLOWED_CLIENT_ROUTES is enforced; an unknown/unauthorized
  // route makes buildClientAction return null.
  const directive = navigateTool.buildClientAction?.({ route: card.route }, ctx);
  if (!directive) return null;

  return { ...directive, suggested: true };
}
