// W1.2-fix — load repo-root .env BEFORE reading process.env (KB_CHUNK_MAX_CHARS, etc.).
// dotenv (a project dependency) does NOT overwrite already-set process.env keys.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();
const KNOWLEDGE_DIR = path.join(ROOT, "knowledge");
const OUT_FILE = path.join(KNOWLEDGE_DIR, "chunks.jsonl");
const MAX_CHARS = Number(process.env.KB_CHUNK_MAX_CHARS ?? 1800);

function readJson(fileName, fallback = []) {
  const file = path.join(KNOWLEDGE_DIR, fileName);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function chunkText(text, maxChars) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n/g);
  const chunks = [];
  let current = "";

  for (const p of paragraphs) {
    if (!p.trim()) continue;
    if ((current + "\n\n" + p).length <= maxChars) {
      current = current ? `${current}\n\n${p}` : p;
      continue;
    }

    if (current) {
      chunks.push(current.trim());
      current = "";
    }

    if (p.length <= maxChars) {
      current = p;
      continue;
    }

    // Long paragraph fallback: split by sentence-like boundaries.
    const sentences = p.split(/(?<=[.!?])\s+/);
    let sentencePack = "";
    for (const s of sentences) {
      if ((sentencePack + " " + s).trim().length <= maxChars) {
        sentencePack = sentencePack ? `${sentencePack} ${s}` : s;
      } else {
        if (sentencePack) chunks.push(sentencePack.trim());
        sentencePack = s;
      }
    }
    if (sentencePack) current = sentencePack;
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

function collectMarkdownFiles(baseDir, out = []) {
  if (!fs.existsSync(baseDir)) return out;
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    const full = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      collectMarkdownFiles(full, out);
      continue;
    }
    if (entry.name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

function keywordsFromText(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

// Stable, content-addressed chunk id: depends only on (sourceType, sourcePath,
// partIndex) — NOT on traversal order. Adding/removing a file no longer shifts
// the ids of other chunks, which is the precondition for hash-based incremental
// re-embedding (C1a).
function makeChunkId(sourceType, sourcePath, partIndex) {
  return `${sourceType}:${sourcePath}#${partIndex}`;
}

// Hash of the EXACT string that generate-embeddings/embed-incremental feed to
// the embedder (`title\ntext`). Same content -> same hash -> embedding reused;
// any change to title or text -> hash changes -> re-embed.
function hashChunk(title, text) {
  return crypto.createHash("sha256").update(`${title}\n${text}`, "utf8").digest("hex");
}

function makeChunk(sourceType, sourcePath, partIndex, title, text) {
  return {
    id: makeChunkId(sourceType, sourcePath, partIndex),
    sourceType,
    sourcePath,
    title,
    text,
    keywords: keywordsFromText(text),
    hash: hashChunk(title, text),
  };
}

function run() {
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });

  const routers = readJson("routers-catalog.json");
  const services = readJson("services-catalog.json");
  const types = readJson("types-dictionary.json");
  const patterns = readJson("patterns.json", {});
  const docsCatalog = readJson("docs-catalog.json");
  // W1.1 — system self-description catalogs (route/page/role map, nav, tables, modules).
  const routesCatalog = readJson("routes-catalog.json");
  const navCatalog = readJson("nav-catalog.json");
  const schemaTables = readJson("schema-tables.json");
  const modulesCatalog = readJson("modules-catalog.json");

  const chunks = [];

  for (const router of routers) {
    const text = [
      `Router file: ${router.file}`,
      `Router names: ${(router.routerNames ?? []).join(", ") || "N/A"}`,
      `Procedure calls: ${router.procedureCalls ?? 0}`,
      `protectedProcedure usages: ${router.protectedUses ?? 0}`,
      `publicProcedure usages: ${router.publicUses ?? 0}`,
    ].join("\n");

    chunks.push(makeChunk("router", router.file, 0, "Router Summary", text));
  }

  for (const service of services) {
    const text = [
      `Service file: ${service.file}`,
      `Exported functions: ${(service.exportedFunctions ?? []).join(", ") || "N/A"}`,
      `Exported classes: ${(service.exportedClasses ?? []).join(", ") || "N/A"}`,
      `Local imports: ${(service.localImports ?? []).join(", ") || "N/A"}`,
    ].join("\n");

    chunks.push(makeChunk("service", service.file, 0, "Service Summary", text));
  }

  for (const t of types) {
    const text = [
      `Type source file: ${t.file}`,
      `Interfaces: ${(t.interfaces ?? []).join(", ") || "N/A"}`,
      `Aliases: ${(t.aliases ?? []).join(", ") || "N/A"}`,
      `Zod schemas: ${(t.zodSchemas ?? []).join(", ") || "N/A"}`,
    ].join("\n");

    chunks.push(makeChunk("type", t.file, 0, "Type Summary", text));
  }

  const patternText = [
    `Total source files: ${patterns.totalSourceFiles ?? 0}`,
    `Total router files: ${patterns.totalRouterFiles ?? 0}`,
    `Total service files: ${patterns.totalServiceFiles ?? 0}`,
    `protectedProcedure count: ${patterns.protectedProcedureCount ?? 0}`,
    `publicProcedure count: ${patterns.publicProcedureCount ?? 0}`,
    `zod.object count: ${patterns.zodObjectCount ?? 0}`,
  ].join("\n");

  chunks.push(makeChunk("pattern", "knowledge/patterns.json", 0, "Code Patterns", patternText));

  // ─── W1.1 — system self-description chunks ──────────────────────────────────
  // New sourceTypes flow through the SAME stable-id + hash convention as everything
  // else, so incremental embed picks them up. Keep each chunk < MAX_CHARS.

  // ROUTES (sourceType "route") — one chunk per ~12 routes; maps URL path → page
  // component → required role/permission → short purpose. Lets the AI answer
  // "what screen does X, where is it, which role can use it".
  {
    const lines = routesCatalog.map((r) => {
      const access = r.requiredRole?.length
        ? `role=${r.requiredRole.join("/")}`
        : r.requiredPermission
        ? `permission=${r.requiredPermission}`
        : r.guarded
        ? "guarded (license/nav-gated)"
        : "open";
      const extra = r.redirectTo ? ` → redirects to ${r.redirectTo}` : "";
      const purpose = r.purpose ? ` — ${r.purpose}` : "";
      return `${r.path}  ->  page ${r.component} [${access}]${extra}${purpose}`;
    });
    const GROUP = 12;
    for (let i = 0; i < lines.length; i += GROUP) {
      const part = i / GROUP;
      const text = [
        `Application route → page → access map (URL paths handled by client/src/App.tsx).`,
        `Each line: <route path> -> page <Component> [access], optional purpose.`,
        "",
        ...lines.slice(i, i + GROUP),
      ].join("\n");
      chunks.push(makeChunk("route", "client/src/App.tsx", part, `Routes (part ${part + 1})`, text));
    }
  }

  // NAV (sourceType "nav") — one chunk per sidebar group: where each feature lives
  // in the menu + role/permission visibility.
  for (let i = 0; i < navCatalog.length; i += 1) {
    const g = navCatalog[i];
    const head = [
      `Sidebar navigation group: ${g.label} (id=${g.id})`,
      g.requiredRole ? `Group requiredRole: ${g.requiredRole}` : null,
      g.permissionCategory ? `Group permissionCategory: ${g.permissionCategory}` : null,
      `Items (label → route [visibility]):`,
    ].filter(Boolean);
    const items = (g.items ?? []).map((it) => {
      const vis = it.requiredRole
        ? `role=${it.requiredRole}`
        : it.requiredPermission
        ? `permission=${it.requiredPermission}`
        : "all roles";
      return `- ${it.label ?? it.href} → ${it.href} [${vis}]`;
    });
    const text = [...head, ...items].join("\n");
    chunks.push(makeChunk("nav", "client/src/lib/navigation.tsx", i, `Nav: ${g.label}`, text));
  }

  // SCHEMA TABLES (sourceType "schema_table") — group tables by schema file/domain;
  // one chunk per domain listing table name + columns(type) + FKs. Lets the AI answer
  // "what table stores X".
  {
    const byFile = new Map();
    for (const t of schemaTables) {
      if (!byFile.has(t.file)) byFile.set(t.file, []);
      byFile.get(t.file).push(t);
    }
    let partIdx = 0;
    for (const [file, tables] of byFile) {
      const domain = file.split("/").pop().replace(/\.ts$/, "");
      // Each table -> a compact block; pack blocks into chunks under MAX_CHARS.
      const blocks = tables.map((t) => {
        const cols = t.columns.map((c) => `${c.field}:${c.type}`).join(", ");
        const fk = t.fks?.length ? `\n  FKs: ${t.fks.join(", ")}` : "";
        return `TABLE ${t.table} (${domain} domain, ${file})\n  Columns: ${cols}${fk}`;
      });
      let buf = [];
      let bufLen = 0;
      const flush = () => {
        if (!buf.length) return;
        const text =
          `Database tables in the ${domain} domain (drizzle schema ${file}).\n\n` + buf.join("\n\n");
        chunks.push(makeChunk("schema_table", file, partIdx, `Tables: ${domain} domain`, text));
        partIdx += 1;
        buf = [];
        bufLen = 0;
      };
      for (const b of blocks) {
        if (bufLen + b.length > MAX_CHARS && buf.length) flush();
        buf.push(b);
        bufLen += b.length + 2;
      }
      flush();
    }
  }

  // MODULES/PERMISSIONS (sourceType "module") — one chunk per feature module: what it
  // gates (routes, permission categories, feature codes), default on/off (license).
  for (let i = 0; i < modulesCatalog.length; i += 1) {
    const mod = modulesCatalog[i];
    const text = [
      `Feature module: ${mod.name} (code ${mod.code})`,
      `Description: ${mod.description}`,
      `Licensing: ${mod.isCore ? "CORE — always enabled (no license needed)" : "OPTIONAL — requires the license to include this module code"}`,
      mod.navGroupId ? `Sidebar nav group: ${mod.navGroupId}` : null,
      `Permission categories: ${(mod.permissionCategories ?? []).join(", ") || "N/A"}`,
      `Routes gated by this module: ${(mod.routes ?? []).join(", ") || "N/A"}`,
      `Feature capabilities (codes): ${(mod.featureCodes ?? []).join(", ") || "N/A"}`,
    ]
      .filter(Boolean)
      .join("\n");
    chunks.push(makeChunk("module", "shared/module-registry.ts", i, `Module: ${mod.name}`, text));
  }

  const markdownFiles = collectMarkdownFiles(path.join(ROOT, "docs"))
    .concat(collectMarkdownFiles(path.join(ROOT, "apidocs")));

  const docSet = new Set(docsCatalog.map((d) => d.file));
  for (const absoluteFile of markdownFiles) {
    const relFile = path.relative(ROOT, absoluteFile).split(path.sep).join("/");
    if (!docSet.has(relFile)) continue;

    const fullText = fs.readFileSync(absoluteFile, "utf8");
    const title = (fullText.match(/^#\s+(.+)$/m) || [null, path.basename(absoluteFile)])?.[1] ?? path.basename(absoluteFile);

    const pieces = chunkText(fullText, MAX_CHARS);
    pieces.forEach((text, partIndex) => {
      chunks.push(makeChunk("doc", relFile, partIndex, `${title} (part ${partIndex + 1})`, text));
    });
  }

  // Domain-specific AOI knowledge files (always included, no catalog filter).
  // These describe defect types, thresholds, workflow, troubleshooting, reports.
  const domainFiles = collectMarkdownFiles(path.join(ROOT, "knowledge", "domain"));
  for (const absoluteFile of domainFiles) {
    const relFile = path.relative(ROOT, absoluteFile).split(path.sep).join("/");
    const fullText = fs.readFileSync(absoluteFile, "utf8");
    const title = (fullText.match(/^#\s+(.+)$/m) || [null, path.basename(absoluteFile)])?.[1] ?? path.basename(absoluteFile);

    const pieces = chunkText(fullText, MAX_CHARS);
    pieces.forEach((text, partIndex) => {
      chunks.push(makeChunk("domain", relFile, partIndex, `${title} (part ${partIndex + 1})`, text));
    });
  }

  // Feature documentation (knowledge/features/**/*.md). Authored Vietnamese
  // 10-section guides per UI feature. Always included, no catalog filter.
  const featureFiles = collectMarkdownFiles(path.join(ROOT, "knowledge", "features"));
  for (const absoluteFile of featureFiles) {
    const relFile = path.relative(ROOT, absoluteFile).split(path.sep).join("/");
    if (path.basename(absoluteFile).startsWith("_")) continue; // skip _TEMPLATE.md
    const fullText = fs.readFileSync(absoluteFile, "utf8");
    const title = (fullText.match(/^#\s+(.+)$/m) || [null, path.basename(absoluteFile)])?.[1] ?? path.basename(absoluteFile);

    const pieces = chunkText(fullText, MAX_CHARS);
    pieces.forEach((text, partIndex) => {
      chunks.push(makeChunk("feature", relFile, partIndex, `${title} (part ${partIndex + 1})`, text));
    });
  }

  // ─── doc69 G2-7 — OPERATIONAL CARDS (sourceType "operational") ────────────────
  // knowledge/operational/*.md is generated by scripts/ai-kb/build-operational-cards.mjs
  // (run BEFORE this script, as part of the kb:* chain) from the route/nav/RBAC/router
  // catalogs — one "how to operate this screen" card per feature. Always included, no
  // catalog filter (mirrors the feature/domain blocks above).
  //
  // Every card starts with a YAML front-matter block (route/permission/role/...). We
  // parse it here and prefix a compact "Route: ... | Permission: ... | Role: ..." meta
  // line to EVERY chunk part (not just part 0) — the ask->do grounding
  // (server/services/aiOperationalGrounding.ts) recovers the card's route from the
  // TOP-CITED chunk's sourcePath via the JSON index (knowledge/operational-cards.json,
  // O(1), no markdown parsing on the answer hot path); the meta line here is a
  // human/LLM-readable belt-and-braces copy so the route/permission are visible in the
  // retrieved context regardless of which part gets cited. A malformed/missing front
  // matter never throws — it just falls back to "N/A" so one bad card can't break the
  // whole chunk build.
  const operationalFiles = collectMarkdownFiles(path.join(ROOT, "knowledge", "operational"));
  for (const absoluteFile of operationalFiles) {
    const relFile = path.relative(ROOT, absoluteFile).split(path.sep).join("/");
    const fullText = fs.readFileSync(absoluteFile, "utf8");

    const fmMatch = fullText.match(/^---\n([\s\S]*?)\n---\n?/);
    let meta = {};
    let body = fullText;
    if (fmMatch) {
      try {
        meta = parseYaml(fmMatch[1]) ?? {};
      } catch {
        meta = {};
      }
      body = fullText.slice(fmMatch[0].length);
    }

    const title =
      (typeof meta.screenVi === "string" && meta.screenVi) ||
      (body.match(/^#\s+(.+)$/m) || [null, path.basename(absoluteFile)])[1] ||
      path.basename(absoluteFile);
    const roleText = Array.isArray(meta.role) && meta.role.length > 0 ? meta.role.join("/") : "any";
    const metaLine = `Route: ${meta.route ?? "N/A"} | Permission: ${meta.permission ?? "none"} | Role: ${roleText}`;

    const pieces = chunkText(body, Math.max(200, MAX_CHARS - metaLine.length - 2));
    pieces.forEach((text, partIndex) => {
      const withMeta = `${metaLine}\n\n${text}`;
      chunks.push(makeChunk("operational", relFile, partIndex, `${title} (part ${partIndex + 1})`, withMeta));
    });
  }

  // Guard: stable ids must be unique. A collision would make the retrieval
  // id->chunk map and incremental reuse-by-id ambiguous.
  const seenIds = new Set();
  for (const c of chunks) {
    if (seenIds.has(c.id)) {
      throw new Error(`[kb] Duplicate chunk id detected: ${c.id}. IDs must be unique.`);
    }
    seenIds.add(c.id);
  }

  const lines = chunks.map((c) => JSON.stringify(c)).join("\n") + "\n";
  fs.writeFileSync(OUT_FILE, lines, "utf8");

  const stats = {
    generatedAt: new Date().toISOString(),
    maxChunkChars: MAX_CHARS,
    totalChunks: chunks.length,
    byType: chunks.reduce((acc, c) => {
      acc[c.sourceType] = (acc[c.sourceType] ?? 0) + 1;
      return acc;
    }, {}),
  };

  fs.writeFileSync(path.join(KNOWLEDGE_DIR, "chunks-stats.json"), JSON.stringify(stats, null, 2));

  console.log("[kb] Built knowledge chunks");
  console.log(`[kb] Total chunks: ${stats.totalChunks}`);
}

run();
