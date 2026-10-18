/**
 * ★★ Đợt 1 · T2 (2026-10-14) — LƯỚI CHO `find_files`: glob TÊN tệp trên cây ĐỌC ĐƯỢC của hộp cát.
 *
 * Bất biến:
 *   • chỉ liệt kê thứ `duyetTepDocDuoc` đã cho qua (thư mục cấm, tệp bí mật, đuôi ngoài danh sách
 *     trắng, junction ra ngoài đều VẮNG) — tham số `pattern` chỉ THU HẸP, không nới được gì;
 *   • `*` không vượt `/`, `**` vượt, `?` đúng một ký tự; mẫu không có `/` so với TÊN tệp ở mọi nấc;
 *   • trần 200 kết quả, bản cắt luôn được KHAI; RBAC như read_file; gốc dự án qua `__projectRoot`;
 *   • tool CHỈ cho agent: bộ chọn trigger cũ không với tới.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));
const proposeActionMock = vi.fn();
vi.mock("../aiCopilotActions", () => ({
  proposeAction: (...a: unknown[]) => proposeActionMock(...a),
}));

import "./index";
import { executeDecision } from "./index";
import { getTool, listTools, type Tool } from "./toolRegistry";
import { xoaSoNganSach } from "./repoSandbox";
import {
  AGENT_SERVER_TOOL_NAMES,
  CODING_LOOP_TOOL_NAMES,
  CODING_TOOL_NAMES,
  chonDuocTheoTrigger,
  classifyToolIntent,
} from "./intentClassifier";
import { globThanhRegex } from "./repoReadTools";

const AUTH = { userId: 7, role: "engineer" };
const CTX = { user: { id: 7, role: "engineer", name: "T" }, lang: "vi" as const };

let HOP = "";
let NGOAI = "";
let HOP2 = "";

function tao(goc: string, rel: string, noiDung = "x\n"): void {
  const abs = path.join(goc, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, noiDung);
}
function tool(): Tool<any, any> {
  return listTools().find((t) => t.name === "find_files")!;
}
async function tim(pattern: unknown, them: Record<string, unknown> = {}) {
  return tool().handler!({ pattern, __authCtx: AUTH, ...them } as never);
}
function duong(r: { data: unknown }): string[] {
  return (r.data as { files: string[] }).files;
}

beforeAll(() => {
  HOP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "find-files-")));
  NGOAI = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "find-files-ngoai-")));
  HOP2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "find-files-du-an-2-")));
  tao(HOP, "a.ts");
  tao(HOP, "b1.ts");
  tao(HOP, "b22.ts");
  tao(HOP, "README.md");
  tao(HOP, "src/a.ts");
  tao(HOP, "src/a.test.ts");
  tao(HOP, "src/sau/c.ts");
  tao(HOP, "src/sau/Hoa.TS");
  tao(HOP, "src/anh.png");
  tao(HOP, ".env");
  tao(HOP, ".env.local.ts");
  tao(HOP, "node_modules/goi/index.ts");
  tao(HOP, "dist/out.ts");
  tao(NGOAI, "bi-mat.ts", "NGOAI\n");
  fs.symlinkSync(NGOAI, path.join(HOP, "alias-ngoai"), "junction");
  for (let i = 0; i < 230; i++) tao(HOP, `nhieu/f${String(i).padStart(3, "0")}.js`);
  tao(HOP2, "chi-du-an-2.ts");
});

afterAll(() => {
  delete process.env.AI_REPO_SANDBOX_ROOT;
  for (const d of [HOP, NGOAI, HOP2]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

beforeEach(() => {
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  xoaSoNganSach();
  process.env.AI_REPO_SANDBOX_ROOT = HOP;
});

describe("§0 — hình dạng", () => {
  it("★★★ read tool, ai_repo_read/canView, khai __authCtx + __projectRoot, CHỈ cho agent", () => {
    const t = tool();
    expect(t).toBeTruthy();
    expect(t.kind ?? "read").toBe("read");
    expect(t.requiredPermission).toEqual({ module: "ai_repo_read", action: "canView" });
    const shape = (t.parameters as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape).sort()).toEqual(["__authCtx", "__projectRoot", "pattern"]);
    expect(t.triggers).toEqual([]);
    expect(t.chiChoAgent).toBe(true);
    expect(chonDuocTheoTrigger(t)).toBe(false);
  });

  it("★★★ danh sách RIÊNG cho agent: mọi tên có trong registry; ba tool mới KHÔNG lọt vào danh sách của bộ chọn cũ", () => {
    for (const ten of AGENT_SERVER_TOOL_NAMES) expect(getTool(ten), ten).toBeTruthy();
    for (const moi of ["find_files", "delete_file", "rename_file"]) {
      expect(AGENT_SERVER_TOOL_NAMES as readonly string[]).toContain(moi);
      expect(CODING_TOOL_NAMES as readonly string[]).not.toContain(moi);
      expect(CODING_LOOP_TOOL_NAMES as readonly string[]).not.toContain(moi);
      expect(getTool(moi)!.chiChoAgent, moi).toBe(true);
    }
  });

  it("★★ đường cũ KHÔNG đổi: câu 'tìm file *.ts' không bao giờ ra find_files", () => {
    for (const q of ["tìm file *.ts", "find files *.ts", "liệt kê file src/**/*.ts"]) {
      expect(classifyToolIntent(q).tool).not.toBe("find_files");
    }
  });
});

describe("§1 — ngữ nghĩa glob", () => {
  it("★★★ mẫu KHÔNG có `/` so với TÊN tệp ở mọi nấc (không phân biệt hoa/thường)", async () => {
    const r = await tim("*.ts");
    expect(r.note, r.textSummary).toBeUndefined();
    expect(duong(r).sort()).toEqual(["a.ts", "b1.ts", "b22.ts", "src/a.test.ts", "src/a.ts", "src/sau/Hoa.TS", "src/sau/c.ts"]);
  });

  it("★★★ `?` đúng MỘT ký tự", async () => {
    expect(duong(await tim("b?.ts"))).toEqual(["b1.ts"]);
  });

  it("★★★ `*` KHÔNG vượt `/`; `**` vượt (kể cả 0 nấc)", async () => {
    expect(duong(await tim("src/*.ts")).sort()).toEqual(["src/a.test.ts", "src/a.ts"]);
    expect(duong(await tim("src/**/*.ts")).sort()).toEqual(["src/a.test.ts", "src/a.ts", "src/sau/Hoa.TS", "src/sau/c.ts"]);
    expect(duong(await tim("**/c.ts"))).toEqual(["src/sau/c.ts"]);
  });

  it("★★ ký tự regex trong mẫu là CHỮ (không phải regex)", async () => {
    expect(duong(await tim("a.test.ts"))).toEqual(["src/a.test.ts"]);
    expect(duong(await tim("a+test.ts"))).toEqual([]);
    expect(globThanhRegex("a.ts").test("abts")).toBe(false);
  });

  it("★ không khớp ⇒ NO_MATCH (khai phạm vi, không im lặng)", async () => {
    const r = await tim("*.khong-co");
    expect(r.note).toBe("NO_MATCH");
  });
});

describe("§2 — hộp cát: pattern chỉ THU HẸP", () => {
  it("★★★ .env*, node_modules, dist, đuôi ngoài danh sách trắng, junction ra ngoài đều VẮNG", async () => {
    const tatCa = duong(await tim("**"));
    expect(tatCa.some((p) => p.includes(".env"))).toBe(false);
    expect(tatCa.some((p) => p.startsWith("node_modules/") || p.startsWith("dist/"))).toBe(false);
    expect(tatCa.some((p) => p.endsWith(".png"))).toBe(false);
    expect(tatCa.some((p) => p.includes("alias-ngoai") || p.includes("bi-mat"))).toBe(false);
    expect(duong(await tim("**/bi-mat.ts"))).toEqual([]);
    expect(duong(await tim(".env*"))).toEqual([]);
  });

  it("★★★ mẫu tuyệt đối / `..` / ổ đĩa ⇒ INVALID_PATTERN (không quét gì)", async () => {
    for (const m of ["../*.ts", "/etc/*", "C:/Windows/*.ts", "src/../../*.ts"]) {
      const r = await tim(m);
      expect(r.note, m).toBe("INVALID_PATTERN");
    }
  });

  it("★ thiếu pattern ⇒ MISSING_REQUIRED_ARG", async () => {
    expect((await tim("")).note).toBe("MISSING_REQUIRED_ARG");
    expect((await tool().handler!({ __authCtx: AUTH } as never)).note).toBe("MISSING_REQUIRED_ARG");
  });
});

describe("§3 — trần + RBAC + gốc dự án", () => {
  it("★★★ trần 200 kết quả, bản cắt được KHAI", async () => {
    const r = await tim("nhieu/*.js");
    expect(duong(r).length).toBe(200);
    expect((r.data as { truncated: boolean }).truncated).toBe(true);
    expect(r.textSummary).toMatch(/BẢN CẮT/);
  });

  it("★★★ không quyền ⇒ PERMISSION_DENIED, không lộ tên tệp", async () => {
    checkPermissionMock.mockResolvedValue(false);
    const r = await tim("*.ts");
    expect(r.note).toBe("PERMISSION_DENIED");
    expect(JSON.stringify(r)).not.toContain("b1.ts");
  });

  it("★★★ thiếu __authCtx ⇒ PERMISSION_DENIED (fail-closed)", async () => {
    const r = await tool().handler!({ pattern: "*.ts" } as never);
    expect(r.note).toBe("PERMISSION_DENIED");
  });

  it("★★★ qua executeDecision: __projectRoot do SERVER tiêm từ ctx.projectRoot (args bịa bị xoá)", async () => {
    const ra = await executeDecision(
      { tool: "find_files", args: { pattern: "*.ts", __projectRoot: NGOAI } },
      { ...CTX, projectRoot: HOP2 } as never,
    );
    const files = (ra.result?.data as { files: string[] }).files;
    expect(files).toEqual(["chi-du-an-2.ts"]);
  });
});
