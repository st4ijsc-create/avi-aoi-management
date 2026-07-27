/**
 * Wave 1 — Ngữ cảnh repo CHỈ-ĐỌC cho 4 specialist agent.
 *
 * Vì sao có file này: aiSpecialistAgentService KHÔNG có `fs` — trường `files[]`
 * chỉ được nhét vào prompt dưới dạng TÊN file, nên agent tư vấn mù. Service này
 * nạp nội dung THẬT (có giới hạn), file phụ thuộc (code-graph.json) và mảnh RAG.
 *
 * AN TOÀN: chỉ-đọc, KHÔNG có bất kỳ đường ghi nào; KHÔNG đăng ký vào toolRegistry
 * nên LLM không thể tự gọi với tham số tuỳ ý — chỉ service gọi với danh sách file
 * do NGƯỜI DÙNG nhập. Bí mật bị chặn 2 lớp: theo tên file + redactSecretsOnly().
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecretsOnly } from "./aiSafety";

export type RepoReadRejectReason =
  | "ABSOLUTE" | "TRAVERSAL" | "NUL" | "ESCAPE"
  | "DENIED_SECRET" | "DENIED_DIR" | "DENIED_EXT"
  | "NOT_FOUND" | "NOT_A_FILE" | "BUDGET_EXCEEDED";

const DENIED_FILE_PATTERNS: RegExp[] = [
  /^\.env$/i, /^\.env\./i, /\.pem$/i, /\.key$/i,
  /\.p12$/i, /\.pfx$/i, /\.keystore$/i, /^id_rsa/i,
];

const DENIED_DIR_PREFIXES = [
  "node_modules/", ".git/", "dist/", "uploads/",
  "knowledge/embeddings", ".superpowers/", ".playwright-mcp/",
];

const ALLOWED_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".sql", ".md", ".css", ".yml", ".yaml",
]);

/** Chuẩn hoá `\` → `/` và bỏ `./` đầu chuỗi. */
export function normalizeRepoPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * Phân loại đường dẫn tương đối. Trả `null` nghĩa là HỢP LỆ để đọc.
 * Hàm thuần — không chạm đĩa (kiểm tra tồn tại là việc của gatherRepoContext).
 */
export function classifyRepoPath(input: string): RepoReadRejectReason | null {
  if (input.includes(String.fromCharCode(0))) return "NUL";
  const rel = normalizeRepoPath(input);
  if (!rel) return "NOT_FOUND";
  if (rel.startsWith("/") || /^[a-zA-Z]:\//.test(rel)) return "ABSOLUTE";
  if (rel.split("/").includes("..")) return "TRAVERSAL";

  const lower = rel.toLowerCase();
  for (const prefix of DENIED_DIR_PREFIXES) {
    if (lower.startsWith(prefix)) return "DENIED_DIR";
  }
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  for (const pattern of DENIED_FILE_PATTERNS) {
    if (pattern.test(base)) return "DENIED_SECRET";
  }
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return "DENIED_EXT";
  return null;
}

export interface RepoFileRead {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  redacted: boolean;
}

export interface RepoContextResult {
  files: RepoFileRead[];
  skipped: Array<{ path: string; reason: RepoReadRejectReason }>;
  dependencies: string[];
  ragSnippets: Array<{ sourcePath: string; text: string; score: number }>;
  totalBytes: number;
}

export interface GatherRepoContextInput {
  files?: string[];
  objective?: string;
  includeRag?: boolean;
  includeDependencies?: boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  ragTopK?: number;
  /** Test seam — mặc định process.cwd(). */
  repoRoot?: string;
  /** Test seam — mặc định <repoRoot>/knowledge/code-graph.json. */
  codeGraphPath?: string;
}

export const DEFAULT_MAX_FILE_BYTES = 65_536;
export const DEFAULT_MAX_TOTAL_BYTES = 262_144;

/** Đọc file phụ thuộc từ code-graph.json. Fail-safe: lỗi/thiếu ⇒ []. */
function readDependencies(codeGraphPath: string, files: string[]): string[] {
  try {
    if (!fs.existsSync(codeGraphPath)) return [];
    const raw = JSON.parse(fs.readFileSync(codeGraphPath, "utf8"));
    if (!Array.isArray(raw)) return [];
    const wanted = new Set(files.map(normalizeRepoPath));
    const out = new Set<string>();
    for (const edge of raw) {
      const from = typeof edge?.from === "string" ? normalizeRepoPath(edge.from) : null;
      const to = typeof edge?.to === "string" ? normalizeRepoPath(edge.to) : null;
      if (from && to && wanted.has(from)) out.add(to);
    }
    return [...out];
  } catch {
    return [];
  }
}

export async function gatherRepoContext(input: GatherRepoContextInput): Promise<RepoContextResult> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const wantRag = input.includeRag ?? Boolean(input.objective);
  const wantDeps = input.includeDependencies ?? Boolean(input.files?.length);

  const files: RepoFileRead[] = [];
  const skipped: Array<{ path: string; reason: RepoReadRejectReason }> = [];
  let totalBytes = 0;

  for (const raw of input.files ?? []) {
    const rel = normalizeRepoPath(raw);
    const reason = classifyRepoPath(raw);
    if (reason) {
      skipped.push({ path: raw, reason });
      continue;
    }
    if (totalBytes >= maxTotalBytes) {
      skipped.push({ path: rel, reason: "BUDGET_EXCEEDED" });
      continue;
    }
    try {
      const abs = path.resolve(repoRoot, rel);
      // Chốt chặn cuối: sau resolve vẫn phải nằm trong gốc repo.
      const rootResolved = path.resolve(repoRoot);
      if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
        skipped.push({ path: rel, reason: "ESCAPE" });
        continue;
      }
      const stat = fs.statSync(abs);
      if (!stat.isFile()) {
        skipped.push({ path: rel, reason: "NOT_A_FILE" });
        continue;
      }
      const original = fs.readFileSync(abs, "utf8");
      const budgetLeft = maxTotalBytes - totalBytes;
      const limit = Math.min(maxFileBytes, budgetLeft);
      const truncated = original.length > limit;
      const sliced = truncated ? original.slice(0, limit) : original;
      const red = redactSecretsOnly(sliced);
      files.push({
        path: rel,
        content: red.text,
        bytes: stat.size,
        truncated,
        redacted: red.text !== sliced,
      });
      totalBytes += sliced.length;
    } catch {
      skipped.push({ path: rel, reason: "NOT_FOUND" });
    }
  }

  const dependencies = wantDeps
    ? readDependencies(input.codeGraphPath ?? path.join(repoRoot, "knowledge", "code-graph.json"), input.files ?? [])
    : [];

  let ragSnippets: RepoContextResult["ragSnippets"] = [];
  if (wantRag && input.objective) {
    try {
      const { retrieveKnowledge } = await import("../aiLocalKnowledgeService");
      const kb = await retrieveKnowledge(input.objective, input.ragTopK ?? 5);
      ragSnippets = (kb.contexts ?? []).map((text, i) => ({
        sourcePath: (kb.citations?.[i] as any)?.sourcePath ?? "(unknown)",
        text,
        score: Number((kb.citations?.[i] as any)?.score ?? 0),
      }));
    } catch {
      ragSnippets = [];
    }
  }

  return { files, skipped, dependencies, ragSnippets, totalBytes };
}
