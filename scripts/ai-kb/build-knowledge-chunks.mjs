import fs from "node:fs";
import path from "node:path";

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

function makeChunk(id, sourceType, sourcePath, title, text) {
  return {
    id,
    sourceType,
    sourcePath,
    title,
    text,
    keywords: keywordsFromText(text),
  };
}

function run() {
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });

  const routers = readJson("routers-catalog.json");
  const services = readJson("services-catalog.json");
  const types = readJson("types-dictionary.json");
  const patterns = readJson("patterns.json", {});
  const docsCatalog = readJson("docs-catalog.json");

  const chunks = [];
  let id = 1;

  for (const router of routers) {
    const text = [
      `Router file: ${router.file}`,
      `Router names: ${(router.routerNames ?? []).join(", ") || "N/A"}`,
      `Procedure calls: ${router.procedureCalls ?? 0}`,
      `protectedProcedure usages: ${router.protectedUses ?? 0}`,
      `publicProcedure usages: ${router.publicUses ?? 0}`,
    ].join("\n");

    chunks.push(makeChunk(`router-${id++}`, "router", router.file, "Router Summary", text));
  }

  for (const service of services) {
    const text = [
      `Service file: ${service.file}`,
      `Exported functions: ${(service.exportedFunctions ?? []).join(", ") || "N/A"}`,
      `Exported classes: ${(service.exportedClasses ?? []).join(", ") || "N/A"}`,
      `Local imports: ${(service.localImports ?? []).join(", ") || "N/A"}`,
    ].join("\n");

    chunks.push(makeChunk(`service-${id++}`, "service", service.file, "Service Summary", text));
  }

  for (const t of types) {
    const text = [
      `Type source file: ${t.file}`,
      `Interfaces: ${(t.interfaces ?? []).join(", ") || "N/A"}`,
      `Aliases: ${(t.aliases ?? []).join(", ") || "N/A"}`,
      `Zod schemas: ${(t.zodSchemas ?? []).join(", ") || "N/A"}`,
    ].join("\n");

    chunks.push(makeChunk(`type-${id++}`, "type", t.file, "Type Summary", text));
  }

  const patternText = [
    `Total source files: ${patterns.totalSourceFiles ?? 0}`,
    `Total router files: ${patterns.totalRouterFiles ?? 0}`,
    `Total service files: ${patterns.totalServiceFiles ?? 0}`,
    `protectedProcedure count: ${patterns.protectedProcedureCount ?? 0}`,
    `publicProcedure count: ${patterns.publicProcedureCount ?? 0}`,
    `zod.object count: ${patterns.zodObjectCount ?? 0}`,
  ].join("\n");

  chunks.push(makeChunk(`pattern-${id++}`, "pattern", "knowledge/patterns.json", "Code Patterns", patternText));

  const markdownFiles = collectMarkdownFiles(path.join(ROOT, "docs"))
    .concat(collectMarkdownFiles(path.join(ROOT, "apidocs")));

  const docSet = new Set(docsCatalog.map((d) => d.file));
  for (const absoluteFile of markdownFiles) {
    const relFile = path.relative(ROOT, absoluteFile).split(path.sep).join("/");
    if (!docSet.has(relFile)) continue;

    const fullText = fs.readFileSync(absoluteFile, "utf8");
    const title = (fullText.match(/^#\s+(.+)$/m) || [null, path.basename(absoluteFile)])?.[1] ?? path.basename(absoluteFile);

    const pieces = chunkText(fullText, MAX_CHARS);
    let part = 1;
    for (const text of pieces) {
      chunks.push(makeChunk(`doc-${id++}`, "doc", relFile, `${title} (part ${part++})`, text));
    }
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
