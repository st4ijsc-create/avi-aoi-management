import { describe, it, expect } from "vitest";
import { classifyRepoPath } from "./repoContextService";

describe("classifyRepoPath", () => {
  it("chấp nhận đường dẫn hợp lệ trong repo", () => {
    expect(classifyRepoPath("server/services/aiSpecialistAgentService.ts")).toBeNull();
    expect(classifyRepoPath("client/src/pages/AIHome.tsx")).toBeNull();
    expect(classifyRepoPath("drizzle/schema/ai.ts")).toBeNull();
  });

  it("từ chối đường dẫn tuyệt đối", () => {
    expect(classifyRepoPath("/etc/passwd")).toBe("ABSOLUTE");
    expect(classifyRepoPath("D:\\SOURCES\\secret.ts")).toBe("ABSOLUTE");
  });

  it("từ chối traversal và NUL", () => {
    expect(classifyRepoPath("../../../etc/passwd")).toBe("TRAVERSAL");
    expect(classifyRepoPath("server/../../outside.ts")).toBe("TRAVERSAL");
    expect(classifyRepoPath("server/a\u0000b.ts")).toBe("NUL");
  });

  it("chặn file bí mật", () => {
    expect(classifyRepoPath(".env")).toBe("DENIED_SECRET");
    expect(classifyRepoPath(".env.production")).toBe("DENIED_SECRET");
    expect(classifyRepoPath("certs/server.pem")).toBe("DENIED_SECRET");
    expect(classifyRepoPath("certs/server.key")).toBe("DENIED_SECRET");
    expect(classifyRepoPath("keys/id_rsa")).toBe("DENIED_SECRET");
  });

  it("chặn thư mục cấm", () => {
    expect(classifyRepoPath("node_modules/foo/index.js")).toBe("DENIED_DIR");
    expect(classifyRepoPath(".git/config")).toBe("DENIED_DIR");
    expect(classifyRepoPath("dist/index.js")).toBe("DENIED_DIR");
    expect(classifyRepoPath("uploads/x.json")).toBe("DENIED_DIR");
    expect(classifyRepoPath("knowledge/embeddings.jsonl")).toBe("DENIED_DIR");
  });

  it("chặn đuôi file ngoài danh sách cho phép", () => {
    expect(classifyRepoPath("assets/logo.png")).toBe("DENIED_EXT");
    expect(classifyRepoPath("bin/tool.exe")).toBe("DENIED_EXT");
  });

  it("chuẩn hoá dấu gạch ngược của Windows trước khi phân loại", () => {
    expect(classifyRepoPath("server\\services\\aiSafety.ts")).toBeNull();
    expect(classifyRepoPath("node_modules\\pkg\\a.js")).toBe("DENIED_DIR");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gatherRepoContext } from "./repoContextService";

vi.mock("../aiLocalKnowledgeService", () => ({
  retrieveKnowledge: vi.fn(),
}));
import { retrieveKnowledge } from "../aiLocalKnowledgeService";

describe("gatherRepoContext", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-"));
    fs.mkdirSync(path.join(root, "server", "services"), { recursive: true });
    fs.mkdirSync(path.join(root, "knowledge"), { recursive: true });
    fs.writeFileSync(path.join(root, "server/services/a.ts"), "export const A = 1;\n");
    fs.writeFileSync(path.join(root, "server/services/b.ts"), "export const B = 2;\n");
    fs.writeFileSync(path.join(root, ".env"), "DB_PASSWORD=supersecret\n");
    (retrieveKnowledge as any).mockResolvedValue({
      question: "q", intent: "howto", language: "vi", entities: [], confidence: 0.9,
      citations: [{ sourcePath: "server/services/b.ts", score: 0.81 }],
      contexts: ["nội dung liên quan"],
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("đọc nội dung THẬT của file được nêu", async () => {
    const r = await gatherRepoContext({ files: ["server/services/a.ts"], repoRoot: root, includeRag: false });
    expect(r.files).toHaveLength(1);
    expect(r.files[0].path).toBe("server/services/a.ts");
    expect(r.files[0].content).toContain("export const A = 1;");
    expect(r.files[0].truncated).toBe(false);
    expect(r.totalBytes).toBeGreaterThan(0);
  });

  it("KHÔNG đọc file bí mật, đưa vào skipped", async () => {
    const r = await gatherRepoContext({ files: [".env"], repoRoot: root, includeRag: false });
    expect(r.files).toHaveLength(0);
    expect(r.skipped).toEqual([{ path: ".env", reason: "DENIED_SECRET" }]);
    expect(JSON.stringify(r)).not.toContain("supersecret");
  });

  it("cắt file vượt maxFileBytes và đánh dấu truncated", async () => {
    fs.writeFileSync(path.join(root, "server/services/big.ts"), "x".repeat(5000));
    const r = await gatherRepoContext({
      files: ["server/services/big.ts"], repoRoot: root, includeRag: false, maxFileBytes: 100,
    });
    expect(r.files[0].truncated).toBe(true);
    expect(r.files[0].content.length).toBeLessThanOrEqual(100);
    expect(r.files[0].bytes).toBe(5000);
  });

  it("dừng nạp khi vượt maxTotalBytes, phần còn lại là BUDGET_EXCEEDED", async () => {
    const r = await gatherRepoContext({
      files: ["server/services/a.ts", "server/services/b.ts"],
      repoRoot: root, includeRag: false, maxTotalBytes: 10,
    });
    expect(r.files).toHaveLength(1);
    expect(r.skipped).toEqual([{ path: "server/services/b.ts", reason: "BUDGET_EXCEEDED" }]);
  });

  it("file không tồn tại ⇒ NOT_FOUND, không ném", async () => {
    const r = await gatherRepoContext({ files: ["server/services/nope.ts"], repoRoot: root, includeRag: false });
    expect(r.skipped).toEqual([{ path: "server/services/nope.ts", reason: "NOT_FOUND" }]);
  });

  it("code-graph.json thiếu ⇒ dependencies rỗng, không ném", async () => {
    const r = await gatherRepoContext({
      files: ["server/services/a.ts"], repoRoot: root, includeRag: false, includeDependencies: true,
    });
    expect(r.dependencies).toEqual([]);
  });

  it("đọc file phụ thuộc từ code-graph.json khi có", async () => {
    fs.writeFileSync(
      path.join(root, "knowledge/code-graph.json"),
      JSON.stringify([{ from: "server/services/a.ts", to: "server/services/b.ts" }]),
    );
    const r = await gatherRepoContext({
      files: ["server/services/a.ts"], repoRoot: root, includeRag: false, includeDependencies: true,
    });
    expect(r.dependencies).toEqual(["server/services/b.ts"]);
  });

  it("retrieveKnowledge ném ⇒ ragSnippets rỗng, không ném", async () => {
    (retrieveKnowledge as any).mockRejectedValue(new Error("kb down"));
    const r = await gatherRepoContext({ objective: "sửa lỗi X", repoRoot: root, includeRag: true });
    expect(r.ragSnippets).toEqual([]);
  });

  it("lấy mảnh RAG khi bật", async () => {
    const r = await gatherRepoContext({ objective: "sửa lỗi X", repoRoot: root, includeRag: true });
    expect(r.ragSnippets.length).toBeGreaterThan(0);
    expect(r.ragSnippets[0].text).toBe("nội dung liên quan");
  });
});
