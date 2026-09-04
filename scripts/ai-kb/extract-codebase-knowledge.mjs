// W1.2-fix — load repo-root .env BEFORE reading process.env, so GGUF_EMBED_MODEL /
// GGUF_MODELS_DIR etc. are honored even when this script is run from a bare shell.
// dotenv (a project dependency) does NOT overwrite keys already in process.env.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "knowledge");
const TARGET_DIRS = ["server", "client", "shared", "drizzle"];
const DOC_DIRS = ["docs", "apidocs"];
// ★★★ VIỆC 1 (`docs/superpowers/specs/2026-09-04-ai-local-danh-gia-hien-trang-va-lo-trinh.md` §7.2,
// B2) — thêm đuôi cho "mã dự án KHÁC" người dùng lập trình thật (C# tool máy, PLC ST/SCL, robot).
// Đo tác động trên CHÍNH repo này (`avi-aoi-management`, TypeScript thuần): 0 tệp .cs/.py/.java/
// .cpp/.st/.scl dưới server/client/shared/drizzle ⇒ 0 chunk đổi — kết luận suy trực tiếp từ
// `Set.has` trong `walkFiles` bên dưới, KHÔNG chạy `npm run kb:extract` thật (script ghi đè
// `knowledge/*` — cấm chạm khi đang dirty bởi phiên khác, xem `git status`). Giá trị của đợt thêm
// này nằm ở việc CHẠY LẠI script (repo-agnostic, `ROOT = process.cwd()`) TRONG một repo C#/PLC
// khác (vd `machine-simulator`), không phải trong repo này — script vẫn không có bộ trích
// `extractRouters`/`extractServices`/`extractTypes`/`extractSchemaTables` riêng cho các ngôn ngữ
// này (đều là regex TS/tRPC/drizzle-specific, xem các hàm cùng tên) nên một lượt chạy trên repo C#
// hôm nay chỉ ra `patterns.json` gần như toàn 0 — router/service/type inventory KHÔNG áp dụng cho
// C#/PLC, chỉ `sourceFiles`/import-graph/kb:chunk (chunk theo tệp, ngôn ngữ-trung lập) hoạt động.
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sql", ".cs", ".py", ".java", ".cpp", ".st", ".scl"]);
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

// W1.3 — denoise the corpus. Dev-report / audit noise (i18n audits, system/module
// audits, deliverable & upgrade reports, frontend audits) pollutes RAG retrieval and
// crowds out USER_GUIDE / HUONG_DAN / API reference / feature guides. Exclude these
// at catalog-build time so they are never chunked/embedded. NOTE: this does NOT delete
// any file from disk — it only keeps them out of the knowledge corpus.
const DOC_DENOISE_RE =
  /I18N_AUDIT|_AUDIT_REPORT|SYSTEM_AUDIT|MODULE_AUDIT|_DELIVERABLE|_UPGRADE_REPORT|FRONTEND_AUDIT/i;
function isNoiseDoc(relativeFile) {
  return DOC_DENOISE_RE.test(relativeFile);
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

// ─── W1.1 — system self-description extractors ────────────────────────────────
// These let the assistant answer "what screen does X, where is it, which role can
// use it, what table stores it" by deriving knowledge from the source-of-truth
// (App.tsx route table, navigation.tsx sidebar, drizzle pgTable defs, module-registry).

/**
 * W1.1 ROUTES — parse client/src/App.tsx <Route> entries.
 * Captures: path, page component name, and a best-effort required role/permission
 * inferred from surrounding RouteGuard props (requireRole / requiredPermission /
 * navHref). Lazy-import comments after `=> import("./pages/X")` often carry a short
 * purpose note, which we harvest as a description.
 */
function extractRoutes(appTsxContent) {
  // Map component name -> short purpose note from lazy-import trailing comments, e.g.
  //   const Foo = React.lazy(() => import("./pages/Foo")); // some purpose
  const purposeByComponent = new Map();
  const lazyRe =
    /const\s+([A-Za-z0-9_]+)\s*=\s*React\.lazy\(\s*\(\)\s*=>\s*import\(["'][^"']+["']\)\s*\)\s*;?\s*(?:\/\/\s*(.+))?/g;
  let lm;
  while ((lm = lazyRe.exec(appTsxContent)) !== null) {
    if (lm[2]) purposeByComponent.set(lm[1], lm[2].trim());
  }

  const routes = [];
  // Two route shapes:
  //   <Route path="/x" component={Comp} />
  //   <Route path="/x"> ...<Comp/>... possibly wrapped in <RouteGuard .../> </Route>
  const routeRe = /<Route\s+path=(?:"([^"]+)"|\{([^}]+)\})([^>]*?)(\/>|>([\s\S]*?)<\/Route>)/g;
  let m;
  while ((m = routeRe.exec(appTsxContent)) !== null) {
    const routePath = m[1] ?? m[2];
    if (!routePath || routePath.startsWith("{")) continue; // skip the catch-all <Route component=.../>
    const selfClosingAttrs = m[3] || "";
    const isSelfClosing = m[4] === "/>";
    const inner = isSelfClosing ? "" : m[5] || "";
    const block = selfClosingAttrs + inner;

    // Component: `component={Comp}` OR the first <Comp .../> / <Comp> in the body
    // (skipping known wrappers).
    let component = null;
    const compAttr = selfClosingAttrs.match(/component=\{([A-Za-z0-9_]+)\}/);
    if (compAttr) {
      component = compAttr[1];
    } else {
      const WRAPPERS = new Set(["RouteGuard", "AIPageWrapper", "Suspense", "Redirect", "ErrorBoundary"]);
      const tagRe = /<([A-Z][A-Za-z0-9_]+)[\s/>]/g;
      let tm;
      while ((tm = tagRe.exec(inner)) !== null) {
        if (!WRAPPERS.has(tm[1])) {
          component = tm[1];
          break;
        }
      }
    }

    // Access: RouteGuard requireRole={[...]} / requirePermission="x" / navHref="x"
    // doc69 G2-7 fix: RouteGuard.tsx's real prop is `requirePermission` (not
    // `requiredPermission` — that name never appears anywhere in App.tsx). The old
    // regex here never matched, so routes-catalog.json's requiredPermission was
    // always null even for the 40+ routes that DO declare it (e.g. /war-room
    // requirePermission="machine_status"). Fixed so operational-card generation
    // (doc69 G2-7) — and every existing "route" KB chunk — gets the real value.
    const roleM = block.match(/requireRole=\{\[([^\]]*)\]\}/);
    const requiredRole = roleM
      ? roleM[1].split(",").map((s) => s.replace(/['"\s]/g, "")).filter(Boolean)
      : [];
    const permM = block.match(/requirePermission=["']([^"']+)["']/);
    const requiredPermission = permM ? permM[1] : null;
    const navHrefM = block.match(/navHref=["']([^"']+)["']/);
    const guarded = /<RouteGuard/.test(block);
    const redirect = /<Redirect\s+to=["']([^"']+)["']/.exec(block);

    routes.push({
      path: routePath,
      component: component ?? "(inline)",
      guarded,
      requiredRole,
      requiredPermission,
      navHref: navHrefM ? navHrefM[1] : null,
      redirectTo: redirect ? redirect[1] : null,
      purpose: component ? purposeByComponent.get(component) ?? null : null,
    });
  }
  return routes;
}

/**
 * W1.1 NAV — parse client/src/lib/navigation.tsx sidebar groups + items.
 * Captures group id/label/requiredRole/permissionCategory and each item's
 * href/label/requiredRole/requiredPermission/permissionCategory, so the assistant
 * can tell users where a feature lives in the menu.
 */
function extractNav(navContent) {
  const groups = [];
  // Each group object literal: { id: "x", label: "...", ... items: [ ... ] }
  // Split on group boundaries by locating `id:` followed eventually by `items: [`.
  const groupRe = /\{\s*id:\s*["']([^"']+)["']([\s\S]*?)items:\s*\[([\s\S]*?)\],?\s*\},/g;
  let gm;
  while ((gm = groupRe.exec(navContent)) !== null) {
    const id = gm[1];
    const groupHead = gm[2];
    const itemsBlock = gm[3];

    const labelM = groupHead.match(/label:\s*["']([^"']+)["']/);
    const grpRoleM = groupHead.match(/requiredRole:\s*['"]([^'"]+)['"]/);
    const grpCatM = groupHead.match(/permissionCategory:\s*["']([^"']+)["']/);

    const items = [];
    const itemRe = /\{([\s\S]*?)\}/g;
    let im;
    while ((im = itemRe.exec(itemsBlock)) !== null) {
      const body = im[1];
      const hrefM = body.match(/href:\s*["']([^"']+)["']/);
      if (!hrefM) continue; // not a nav item (e.g. icon JSX fragment)
      const ilabelM = body.match(/label:\s*["']([^"']+)["']/);
      const ipermM = body.match(/requiredPermission:\s*["']([^"']+)["']/);
      const iroleM = body.match(/requiredRole:\s*['"]([^'"]+)['"]/);
      const icatM = body.match(/permissionCategory:\s*["']([^"']+)["']/);
      items.push({
        href: hrefM[1],
        label: ilabelM ? ilabelM[1] : null,
        requiredRole: iroleM ? iroleM[1] : null,
        requiredPermission: ipermM ? ipermM[1] : null,
        permissionCategory: icatM ? icatM[1] : null,
      });
    }

    groups.push({
      id,
      label: labelM ? labelM[1] : id,
      requiredRole: grpRoleM ? grpRoleM[1] : null,
      permissionCategory: grpCatM ? grpCatM[1] : null,
      items,
    });
  }
  return groups;
}

/**
 * W1.1 TABLES — extract drizzle pgTable("name", { ...columns }) blocks from a
 * schema file. Best-effort: column name + rough type + notable FK references.
 */
function extractSchemaTables(filePath, content) {
  if (!filePath.includes("drizzle/schema/")) return [];
  const tables = [];
  // Match: export const xxx = pgTable("table_name", { ... up to the matching closer.
  // We grab the object body non-greedily up to "}," or "}, (table)" which drizzle uses.
  const tableRe = /pgTable\(\s*["']([^"']+)["']\s*,\s*\{([\s\S]*?)\}\s*(?:,\s*\([^)]*\)\s*=>|\)\s*;|,?\s*\)\s*;)/g;
  let m;
  while ((m = tableRe.exec(content)) !== null) {
    const tableName = m[1];
    const body = m[2];

    const columns = [];
    const fks = [];
    // column: `name: type("col"...)` — capture JS field name + drizzle builder type.
    const colRe = /([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_]+)\s*\(/g;
    let cm;
    while ((cm = colRe.exec(body)) !== null) {
      const field = cm[1];
      const builder = cm[2];
      // Skip non-column builders that can appear inside the body.
      if (["index", "uniqueIndex", "primaryKey", "foreignKey", "unique"].includes(builder)) continue;
      columns.push({ field, type: builder });
    }
    // FK references: `.references(() => otherTable.col)`
    const fkRe = /\.references\(\s*\(\)\s*=>\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g;
    let fm;
    while ((fm = fkRe.exec(body)) !== null) {
      fks.push(`${fm[1]}.${fm[2]}`);
    }

    if (columns.length) {
      tables.push({ table: tableName, file: filePath, columns, fks: uniq(fks) });
    }
  }
  return tables;
}

/**
 * W1.1 MODULES/PERMISSIONS — extract feature modules from shared/module-registry.ts.
 * Captures each module's code/name/description/isCore/routes/permissionCategories and
 * its feature codes (the capabilities it gates), so the assistant can answer which
 * module/role gates a screen.
 */
function extractModules(content) {
  const modules = [];
  // Each module object literal inside SYSTEM_MODULES begins with `code: "..."`.
  const modRe = /\{\s*code:\s*["'](MOD_[A-Z_]+|CORE_[A-Z_]+)["']([\s\S]*?)navGroupId:\s*([^,}]+)/g;
  let m;
  while ((m = modRe.exec(content)) !== null) {
    const code = m[1];
    const body = m[2];
    const nameM = body.match(/name:\s*["']([^"']+)["']/);
    const descM = body.match(/description:\s*["']([^"']+)["']/);
    const coreM = body.match(/isCore:\s*(true|false)/);
    const navGroupRaw = (m[3] || "").trim().replace(/["',]/g, "");

    // routes: [...]
    const routesM = body.match(/routes:\s*\[([\s\S]*?)\]/);
    const routes = routesM
      ? uniq((routesM[1].match(/["']([^"']+)["']/g) || []).map((s) => s.replace(/["']/g, "")))
      : [];
    // permissionCategories: [...]
    const catsM = body.match(/permissionCategories:\s*\[([\s\S]*?)\]/);
    const permissionCategories = catsM
      ? uniq((catsM[1].match(/["']([^"']+)["']/g) || []).map((s) => s.replace(/["']/g, "")))
      : [];
    // feature codes: `code: "FEATURE_X"` inside the features array.
    const featureCodes = uniq(
      (body.match(/code:\s*["']([A-Z0-9_]+)["']/g) || [])
        .map((s) => s.replace(/code:\s*["']|["']/g, ""))
        .filter((c) => c !== code),
    );

    modules.push({
      code,
      name: nameM ? nameM[1] : code,
      description: descM ? descM[1] : "",
      isCore: coreM ? coreM[1] === "true" : false,
      navGroupId: navGroupRaw && navGroupRaw !== "undefined" ? navGroupRaw : null,
      routes,
      permissionCategories,
      featureCodes,
    });
  }
  return modules;
}

function run() {
  ensureDir(OUT_DIR);

  const sourceFiles = TARGET_DIRS.flatMap((d) => walkFiles(path.join(ROOT, d)));
  const docsFiles = DOC_DIRS.flatMap((d) => walkMarkdown(path.join(ROOT, d)));

  const routers = [];
  const services = [];
  const types = [];
  const graphEdges = [];
  const schemaTables = []; // W1.1

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

    // W1.1 — drizzle pgTable inventory (schema files live under drizzle/).
    schemaTables.push(...extractSchemaTables(relativeFile, content));

    graphEdges.push(...extractImports(relativeFile, content));
  }

  // W1.1 — system self-description from the route table, sidebar, and module registry.
  const appTsxPath = path.join(ROOT, "client", "src", "App.tsx");
  const navPath = path.join(ROOT, "client", "src", "lib", "navigation.tsx");
  const moduleRegistryPath = path.join(ROOT, "shared", "module-registry.ts");
  const routes = fs.existsSync(appTsxPath) ? extractRoutes(readText(appTsxPath)) : [];
  const nav = fs.existsSync(navPath) ? extractNav(readText(navPath)) : [];
  const modules = fs.existsSync(moduleRegistryPath) ? extractModules(readText(moduleRegistryPath)) : [];

  // W1.3 — drop dev-report/audit noise from the doc catalog before chunking.
  const docsCatalog = docsFiles
    .map((file) => rel(file))
    .filter((relativeFile) => !isNoiseDoc(relativeFile))
    .map((relativeFile) => {
      const content = readText(path.join(ROOT, relativeFile));
      const title = (content.match(/^#\s+(.+)$/m) || [null, path.basename(relativeFile)])?.[1] ?? path.basename(relativeFile);
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
    // W1.1
    totalRoutes: routes.length,
    totalNavGroups: nav.length,
    totalSchemaTables: schemaTables.length,
    totalModules: modules.length,
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
      // W1.1 — system self-description catalogs.
      "knowledge/routes-catalog.json",
      "knowledge/nav-catalog.json",
      "knowledge/schema-tables.json",
      "knowledge/modules-catalog.json",
    ],
  };

  fs.writeFileSync(path.join(OUT_DIR, "routers-catalog.json"), JSON.stringify(routers, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "services-catalog.json"), JSON.stringify(services, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "types-dictionary.json"), JSON.stringify(types, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "code-graph.json"), JSON.stringify(graphEdges, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "docs-catalog.json"), JSON.stringify(docsCatalog, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "patterns.json"), JSON.stringify(patterns, null, 2));
  // W1.1 — new system self-description catalogs consumed by build-knowledge-chunks.mjs.
  fs.writeFileSync(path.join(OUT_DIR, "routes-catalog.json"), JSON.stringify(routes, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "nav-catalog.json"), JSON.stringify(nav, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "schema-tables.json"), JSON.stringify(schemaTables, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "modules-catalog.json"), JSON.stringify(modules, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "phase1-summary.json"), JSON.stringify(summary, null, 2));

  console.log("[kb] Extracted knowledge artifacts");
  console.log(`[kb] Source files: ${sourceFiles.length}`);
  console.log(`[kb] Router files: ${routers.length}`);
  console.log(`[kb] Service files: ${services.length}`);
  console.log(`[kb] Docs files: ${docsCatalog.length}`);
  // W1.1
  console.log(`[kb] Routes: ${routes.length}, Nav groups: ${nav.length}, Schema tables: ${schemaTables.length}, Modules: ${modules.length}`);
}

run();
