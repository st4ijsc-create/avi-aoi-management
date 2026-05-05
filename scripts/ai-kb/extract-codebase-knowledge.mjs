import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "knowledge");
const TARGET_DIRS = ["server", "client", "shared", "drizzle"];
const DOC_DIRS = ["docs", "apidocs"];
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sql"]);
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-secure",
  ".git",
  "uploads",
  "android",
  "_deploy",
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function walkFiles(baseDir, out = []) {
  if (!fs.existsSync(baseDir)) return out;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walkFiles(full, out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (SOURCE_EXT.has(ext)) out.push(full);
  }
  return out;
}

function walkMarkdown(baseDir, out = []) {
  if (!fs.existsSync(baseDir)) return out;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walkMarkdown(full, out);
      continue;
    }
    if (entry.name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function extractRouters(filePath, content) {
  if (!filePath.includes("/routers/")) return null;

  const exportRouterRe = /export\s+const\s+([A-Za-z0-9_]+Router)\s*=\s*/g;
  const routerNames = [];
  let m;
  while ((m = exportRouterRe.exec(content)) !== null) {
    routerNames.push(m[1]);
  }

  const procedureCalls = (content.match(/\.(query|mutation|subscription)\s*\(/g) || []).length;
  const protectedUses = (content.match(/protectedProcedure/g) || []).length;
  const publicUses = (content.match(/publicProcedure/g) || []).length;

  return {
    file: filePath,
    routerNames: uniq(routerNames),
    procedureCalls,
    protectedUses,
    publicUses,
  };
}

function extractServices(filePath, content) {
  if (!filePath.includes("/services/")) return null;

  const fnRe = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  const constFnRe = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g;
  const classRe = /export\s+class\s+([A-Za-z0-9_]+)/g;

  const exportedFunctions = [];
  const exportedClasses = [];

  let m;
  while ((m = fnRe.exec(content)) !== null) exportedFunctions.push(m[1]);
  while ((m = constFnRe.exec(content)) !== null) exportedFunctions.push(m[1]);
  while ((m = classRe.exec(content)) !== null) exportedClasses.push(m[1]);

  const imports = [];
  const importRe = /from\s+["'](\.{1,2}\/[^"']+)["']/g;
  while ((m = importRe.exec(content)) !== null) imports.push(m[1]);

  return {
    file: filePath,
    exportedFunctions: uniq(exportedFunctions),
    exportedClasses: uniq(exportedClasses),
    localImports: uniq(imports),
  };
}

function extractTypes(filePath, content) {
  const interfaces = [];
  const aliases = [];
  const zodSchemas = [];

  let m;
  const ifRe = /export\s+interface\s+([A-Za-z0-9_]+)/g;
  const typeRe = /export\s+type\s+([A-Za-z0-9_]+)\s*=/g;
  const zodRe = /const\s+([A-Za-z0-9_]+)\s*=\s*z\.object\s*\(/g;

  while ((m = ifRe.exec(content)) !== null) interfaces.push(m[1]);
  while ((m = typeRe.exec(content)) !== null) aliases.push(m[1]);
  while ((m = zodRe.exec(content)) !== null) zodSchemas.push(m[1]);

  if (!interfaces.length && !aliases.length && !zodSchemas.length) return null;

  return {
    file: filePath,
    interfaces: uniq(interfaces),
    aliases: uniq(aliases),
    zodSchemas: uniq(zodSchemas),
  };
}

function extractImports(filePath, content) {
  const edges = [];
  const importRe = /from\s+["'](\.{1,2}\/[^"']+)["']/g;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    edges.push({
      from: filePath,
      to: m[1],
    });
  }
  return edges;
}

function run() {
  ensureDir(OUT_DIR);

  const sourceFiles = TARGET_DIRS.flatMap((d) => walkFiles(path.join(ROOT, d)));
  const docsFiles = DOC_DIRS.flatMap((d) => walkMarkdown(path.join(ROOT, d)));

  const routers = [];
  const services = [];
  const types = [];
  const graphEdges = [];

  let protectedProcedureCount = 0;
  let publicProcedureCount = 0;
  let zodObjectCount = 0;

  for (const file of sourceFiles) {
    const relativeFile = rel(file);
    const content = readText(file);

    protectedProcedureCount += (content.match(/protectedProcedure/g) || []).length;
    publicProcedureCount += (content.match(/publicProcedure/g) || []).length;
    zodObjectCount += (content.match(/z\.object\s*\(/g) || []).length;

    const routerData = extractRouters(relativeFile, content);
    if (routerData) routers.push(routerData);

    const serviceData = extractServices(relativeFile, content);
    if (serviceData) services.push(serviceData);

    const typeData = extractTypes(relativeFile, content);
    if (typeData) types.push(typeData);

    graphEdges.push(...extractImports(relativeFile, content));
  }

  const docsCatalog = docsFiles.map((file) => {
    const relativeFile = rel(file);
    const content = readText(file);
    const title = (content.match(/^#\s+(.+)$/m) || [null, path.basename(file)])?.[1] ?? path.basename(file);
    return {
      file: relativeFile,
      title,
      length: content.length,
      headings: (content.match(/^##\s+.+$/gm) || []).length,
    };
  });

  const patterns = {
    protectedProcedureCount,
    publicProcedureCount,
    zodObjectCount,
    totalSourceFiles: sourceFiles.length,
    totalRouterFiles: routers.length,
    totalServiceFiles: services.length,
    totalDocsFiles: docsCatalog.length,
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    patterns,
    outputs: [
      "knowledge/routers-catalog.json",
      "knowledge/services-catalog.json",
      "knowledge/types-dictionary.json",
      "knowledge/code-graph.json",
      "knowledge/docs-catalog.json",
      "knowledge/patterns.json",
    ],
  };

  fs.writeFileSync(path.join(OUT_DIR, "routers-catalog.json"), JSON.stringify(routers, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "services-catalog.json"), JSON.stringify(services, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "types-dictionary.json"), JSON.stringify(types, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "code-graph.json"), JSON.stringify(graphEdges, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "docs-catalog.json"), JSON.stringify(docsCatalog, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "patterns.json"), JSON.stringify(patterns, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "phase1-summary.json"), JSON.stringify(summary, null, 2));

  console.log("[kb] Extracted knowledge artifacts");
  console.log(`[kb] Source files: ${sourceFiles.length}`);
  console.log(`[kb] Router files: ${routers.length}`);
  console.log(`[kb] Service files: ${services.length}`);
  console.log(`[kb] Docs files: ${docsCatalog.length}`);
}

run();
