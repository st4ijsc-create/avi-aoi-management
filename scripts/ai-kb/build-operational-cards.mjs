// doc69 G2-7 (Wave E4) — Operational-card generator.
//
// Reads the EXISTING route/nav/RBAC/router catalogs (knowledge/routes-catalog.json,
// knowledge/nav-catalog.json, knowledge/modules-catalog.json,
// knowledge/routers-catalog.json — all produced by kb:extract) plus the i18n locale
// files (client/src/i18n/locales/{vi,en}.json, for resolving nav label translation
// keys to display text) and emits ONE structured "how to operate this screen" card
// per user-facing feature/screen to knowledge/operational/<slug>.md, plus a small
// runtime index (knowledge/operational-cards.json) that the answer path
// (server/services/aiOperationalGrounding.ts) uses to attach a 1-tap "open screen"
// navigate action to how-to answers (doc69 G2-7 item 2).
//
// This is a BUILD-TIME step (part of the kb:* chain, run BEFORE kb:chunk so the new
// knowledge/operational/*.md files exist for the chunker to ingest). It does NOT
// call the embedder/LLM — deterministic, pure JSON/text transforms only. Re-running
// it always produces byte-identical output for the same input catalogs (no
// Date.now()/Math.random(), no filesystem-order dependence — the candidate route
// list is read from the JSON catalog array and re-sorted explicitly).
//
// RBAC resolution mirrors the REAL client-side gate (client/src/components/
// RouteGuard.tsx): when a route renders `<RouteGuard navHref="X">`, access is
// resolved via `hasAccessToItem(X, ...)` — i.e. by X's entry in the nav catalog —
// NOT by any requireRole/requirePermission prop on that RouteGuard call (most
// nav-linked routes don't repeat one). Only routes WITHOUT a nav match fall back to
// their own requireRole[]/requirePermission props.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";

const ROOT = process.cwd();
const KNOWLEDGE_DIR = path.join(ROOT, "knowledge");
const OUT_DIR = path.join(KNOWLEDGE_DIR, "operational");
const INDEX_FILE = path.join(KNOWLEDGE_DIR, "operational-cards.json");
const STATS_FILE = path.join(KNOWLEDGE_DIR, "operational-cards-stats.json");

// Routes that are not really "features to operate" (auth/bootstrap screens) —
// excluded even though some carry a guard, so the corpus stays about actual
// production/quality/admin FEATURES per the task brief.
const EXCLUDE_PATHS = new Set(["/login", "/setup", "/setup-admin"]);

function readJson(fileName, fallback) {
  const file = path.join(KNOWLEDGE_DIR, fileName);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readLocale(fileName) {
  const file = path.join(ROOT, "client", "src", "i18n", "locales", fileName);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** Resolve a dotted i18n key ("nav.dashboardMain") against a locale dict. Returns null on a miss. */
function resolveLabel(dict, key) {
  if (!key || typeof key !== "string") return null;
  let cur = dict;
  for (const part of key.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : null;
}

/** "ProductionOrders" -> "Production Orders"; "AIGgufModelsPage" -> "AI Gguf Models
 * Page" (the acronym-boundary pass runs first so a leading all-caps run like "AI"
 * doesn't get glued to the next word); "(inline)" / falsy -> null. */
function humanizeComponentName(name) {
  if (!name || name === "(inline)") return null;
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/** "/production-orders" -> "production-orders"; "/" -> "home". Deterministic, ASCII-only. */
function slugify(routePath) {
  if (routePath === "/") return "home";
  return routePath
    .replace(/^\//, "")
    .replace(/[/:]/g, "-")
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase();
}

/** lower-case, strip non-alnum, strip ONE trailing "s" (crude singular fold) so
 * "ProductionOrders" / "production-orders" / "productionOrder" all normalize to
 * the same key. Used for EXACT-equality router matching (see findRouterMatch) —
 * intentionally strict so a generic shared word (e.g. "production") can't cause
 * a false-positive match against an unrelated router. */
function normalizeMatchKey(s) {
  return String(s ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .replace(/s$/, "");
}

/**
 * Best-effort match from a route to the tRPC router file most likely to back it.
 * Requires an EXACT match (after normalizeMatchKey) between a candidate key
 * derived from the route (full path, each path segment, or the page component
 * name) and a router's exported const name (from routers-catalog.json) minus its
 * "Router" suffix. Exact-equality (not substring/token overlap) so two routers
 * that merely share a common word (e.g. "productionDashboardRouter" vs the
 * "/production-orders" route) do NOT falsely match. Returns null — never a
 * guess — when nothing lines up exactly.
 */
function findRouterMatch(routers, routePath, component) {
  const segments = routePath.split("/").filter(Boolean);
  const candidateKeys = new Set(
    [routePath.replace(/^\//, ""), ...segments, component]
      .filter(Boolean)
      .map(normalizeMatchKey)
      .filter((k) => k.length > 2),
  );
  if (candidateKeys.size === 0) return null;

  for (const r of routers) {
    for (const name of r.routerNames ?? []) {
      const baseKey = normalizeMatchKey(name.replace(/Router$/, ""));
      if (baseKey.length > 2 && candidateKeys.has(baseKey)) {
        return { file: r.file, routerName: name, procedureCalls: r.procedureCalls ?? 0 };
      }
    }
  }
  return null;
}

// The lazy-import trailing comment App.tsx harvests as `route.purpose` is SOMETIMES
// a genuine one-line feature description ("flagship Quality Cockpit...") and
// SOMETIMES a mechanical build-optimization note left over from an eager→lazy
// code-split pass ("doc64 S5-OPT: eager→lazy") that says nothing about the
// feature. Filter the latter out so it never leaks into a card's "Mục đích".
const PURPOSE_NOISE_RE = /eager\s*[→\->]*\s*lazy|S5-OPT/i;

function renderCardBody({ route, fm, router }) {
  const purposeText = route.purpose && !PURPOSE_NOISE_RE.test(route.purpose) ? route.purpose : null;
  const lines = [];
  lines.push(`# ${fm.screenVi} — Cách vận hành`);
  lines.push("");
  lines.push(`## Mục đích`);
  lines.push(purposeText ?? `Màn hình \`${route.path}\` (${fm.screenEn}).`);
  lines.push("");
  lines.push(`## Vị trí truy cập`);
  if (fm.inSidebar) {
    lines.push(`- Menu: ${fm.navGroupVi ?? "?"} › ${fm.screenVi}`);
  } else {
    lines.push(`- Không có trong menu sidebar — truy cập trực tiếp qua URL.`);
  }
  lines.push(`- URL: \`${route.path}\``);
  lines.push(`- English: ${fm.navGroupEn ? `${fm.navGroupEn} › ` : ""}${fm.screenEn}`);
  lines.push("");
  lines.push(`## Quyền yêu cầu`);
  if (fm.permission) lines.push(`- Permission: \`${fm.permission}\``);
  if (fm.role.length > 0) lines.push(`- Vai trò bắt buộc: ${fm.role.join(", ")}`);
  if (!fm.permission && fm.role.length === 0) {
    lines.push(`- Không giới hạn quyền cụ thể (mọi người dùng đã đăng nhập).`);
  }
  if (fm.module) lines.push(`- Module: \`${fm.module}\` (${fm.license === "CORE" ? "CORE — luôn bật" : "OPTIONAL — cần license"}).`);
  lines.push("");
  if (router) {
    lines.push(`## Endpoint liên quan`);
    lines.push(
      `- Router tRPC: \`${router.routerName}\` (${router.file}, ~${router.procedureCalls} thủ tục query/mutation).`,
    );
    lines.push("");
  }
  return lines.join("\n");
}

function run() {
  const routes = readJson("routes-catalog.json", []);
  const nav = readJson("nav-catalog.json", []);
  const modules = readJson("modules-catalog.json", []);
  const routers = readJson("routers-catalog.json", []);
  const vi = readLocale("vi.json");
  const en = readLocale("en.json");

  // href -> { group, item } — first group wins if an href is (unexpectedly) reused.
  const navByHref = new Map();
  for (const g of nav) {
    for (const item of g.items ?? []) {
      if (!navByHref.has(item.href)) navByHref.set(item.href, { group: g, item });
    }
  }

  // route.path -> owning module (first match wins).
  const moduleByRoute = new Map();
  for (const mod of modules) {
    for (const r of mod.routes ?? []) {
      if (!moduleByRoute.has(r)) moduleByRoute.set(r, mod);
    }
  }

  const navHrefSet = new Set(navByHref.keys());
  const candidates = routes
    .filter((r) => {
      if (typeof r.path !== "string" || r.path.includes(":")) return false; // no dynamic-param routes
      if (r.redirectTo) return false;
      if (EXCLUDE_PATHS.has(r.path)) return false;
      const inNav = navHrefSet.has(r.path) || (r.navHref && navHrefSet.has(r.navHref));
      const hasRbacGate = (r.requiredRole && r.requiredRole.length > 0) || !!r.requiredPermission;
      return inNav || hasRbacGate;
    })
    // Explicit sort (independent of routes-catalog.json's own ordering / any
    // filesystem walk order) so the card set is 100% deterministic.
    .sort((a, b) => a.path.localeCompare(b.path));

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const indexEntries = [];
  const seenSlugs = new Set();

  for (const route of candidates) {
    // Mirrors RouteGuard.tsx: navHref (when present, defaulting to the route's
    // own path) resolves access via ITS nav-catalog entry — not any requireRole/
    // requirePermission repeated on that particular <RouteGuard>.
    const navMatch = navByHref.get(route.path) ?? (route.navHref ? navByHref.get(route.navHref) : undefined);

    let permission = null;
    let role = [];
    if (navMatch) {
      permission = navMatch.item.requiredPermission ?? null;
      role = navMatch.item.requiredRole ? [navMatch.item.requiredRole] : [];
    } else {
      permission = route.requiredPermission ?? null;
      role = route.requiredRole ?? [];
    }

    const screenVi =
      (navMatch && resolveLabel(vi, navMatch.item.label)) ??
      humanizeComponentName(route.component) ??
      route.path;
    const screenEn =
      (navMatch && resolveLabel(en, navMatch.item.label)) ??
      humanizeComponentName(route.component) ??
      route.path;
    const navGroupVi = navMatch ? (resolveLabel(vi, navMatch.group.label) ?? navMatch.group.label) : null;
    const navGroupEn = navMatch ? (resolveLabel(en, navMatch.group.label) ?? navMatch.group.label) : null;

    const mod = moduleByRoute.get(route.path) ?? null;
    const router = findRouterMatch(routers, route.path, route.component);

    const slug = slugify(route.path);
    if (seenSlugs.has(slug)) continue; // determinism guard — never overwrite a card
    seenSlugs.add(slug);

    // Fixed key order (deterministic YAML/JSON regardless of input object shapes).
    const fm = {
      route: route.path,
      permission,
      role,
      screenVi,
      screenEn,
      inSidebar: !!navMatch,
      navGroupVi,
      navGroupEn,
      module: mod ? mod.code : null,
      license: mod ? (mod.isCore ? "CORE" : "OPTIONAL") : null,
    };

    const body = renderCardBody({ route, fm, router });
    const fileText = `---\n${stringifyYaml(fm).trimEnd()}\n---\n\n${body}\n`;
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.md`), fileText, "utf8");

    indexEntries.push({ slug, sourcePath: `knowledge/operational/${slug}.md`, ...fm });
  }

  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexEntries, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    STATS_FILE,
    JSON.stringify(
      {
        totalRoutesScanned: routes.length,
        totalCandidateRoutes: candidates.length,
        totalCardsWritten: indexEntries.length,
        cardsWithPermission: indexEntries.filter((c) => c.permission).length,
        cardsInSidebar: indexEntries.filter((c) => c.inSidebar).length,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log("[kb] Built operational cards");
  console.log(`[kb] Candidate routes: ${candidates.length} / ${routes.length} total`);
  console.log(`[kb] Cards written: ${indexEntries.length} -> ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`[kb] Index: ${path.relative(ROOT, INDEX_FILE)}`);
}

run();
