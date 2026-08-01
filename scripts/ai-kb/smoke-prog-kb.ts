/**
 * Doc 34 P1 — end-to-end smoke test for the programming KB retrieval service.
 * Enables PROG_KB_ENABLED, runs a few vi/en queries (incl. an error-code lookup
 * and a vendor-filtered query), prints top citations {vendor, docTitle, page, score}.
 * Run: npx tsx scripts/ai-kb/smoke-prog-kb.ts
 */
import "dotenv/config";
process.env.PROG_KB_ENABLED = "true";

import { searchProgrammingKb, getProgrammingKbStatus } from "../../server/services/aiProgrammingKnowledgeService";

const QUERIES: { q: string; vendor?: string; note: string }[] = [
  { q: "How do I perform a linear move (movel) and control the gripper in URScript?", note: "UR / URScript" },
  { q: "MELSERVO servo alarm error code list and meaning", vendor: "mitsubishi", note: "Mitsubishi error codes (vendor filter)" },
  { q: "Zmotion RTBasic absolute axis move command MOVEABS syntax", note: "Zmotion RTBasic" },
  { q: "Omron NJ NX structured text instruction reference for timers", note: "Omron W502" },
  { q: "Lệnh lập trình KAREL để di chuyển robot Fanuc tới một vị trí", vendor: "fanuc", note: "Fanuc KAREL (vi query + vendor filter)" },
];

async function main() {
  console.log("=== PROG KB STATUS ===");
  console.log(JSON.stringify(getProgrammingKbStatus(), null, 2));

  for (const { q, vendor, note } of QUERIES) {
    console.log(`\n=== [${note}] ${vendor ? `(vendor=${vendor}) ` : ""}${q}`);
    try {
      const r = await searchProgrammingKb({ query: q, vendor, topK: 3 });
      console.log(`semanticUsed=${r.semanticUsed} citations=${r.citations.length}`);
      r.citations.forEach((c, i) => {
        console.log(`  [${i + 1}] ${c.vendor} · ${c.docTitle} · p.${c.page ?? "?"} · score=${(c.score ?? 0).toFixed(3)}`);
      });
      const top = r.chunks?.[0];
      if (top) console.log(`  top snippet: ${(top.text || "").replace(/\s+/g, " ").slice(0, 160)}…`);
    } catch (e) {
      console.error(`  ERROR: ${(e as Error)?.message ?? e}`);
    }
  }
  console.log("\n=== SMOKE DONE ===");
  process.exit(0);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
