/**
 * ★★★ 2026-09-04 — LƯỚI CHO **LOẠI TRỪ THƯ MỤC** của `grep_repo` (`loaiTru`).
 *
 * Tham số này CHỈ được phép THU HẸP. Ba ranh giới, và ranh giới §3 là thứ quan trọng nhất: một
 * tham số "lọc" mà nới được phạm vi là một lỗ hộp cát, nên lưới phải chứng minh nó KHÔNG nới nổi.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • bỏ bộ lọc (quét cả thư mục bị loại)              ⇒ §1 ĐỎ
 *   • so tiền tố KHÔNG theo ranh giới đoạn             ⇒ §2 ĐỎ (client/src nuốt client/srcX)
 *   • dùng `loaiTru` để MỞ ra ngoài gốc/hộp cát        ⇒ §3 ĐỎ
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../aiCopilotActions", () => ({ proposeAction: vi.fn() }));
// RBAC thật hỏi DB — trong lưới thì mock (cùng khuôn `repoSandbox.census.test.ts`); phép đo ở đây là
// bộ LỌC loại-trừ, không phải cổng quyền (cổng ấy đã có lưới riêng).
const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

import "./index";
import { listTools, type Tool } from "./toolRegistry";
import { xoaSoNganSach } from "./repoSandbox";

const CTX = { user: { id: 7, role: "engineer", name: "T" }, lang: "vi" as const };
const AUTH = { userId: 7, role: "engineer" };
let GOC = "";
function tool(): Tool<any, any> {
  return listTools().find((t) => t.name === "grep_repo")!;
}

beforeAll(() => {
  GOC = mkdtempSync(path.join(tmpdir(), "loaitru-"));
  for (const d of ["client/src", "client/srcX", "server/routers", "docs"]) {
    mkdirSync(path.join(GOC, d), { recursive: true });
  }
  const noiDung = "export const MOC_TIM = 1;\n";
  writeFileSync(path.join(GOC, "client/src/a.ts"), noiDung);
  writeFileSync(path.join(GOC, "client/srcX/b.ts"), noiDung);
  writeFileSync(path.join(GOC, "server/routers/c.ts"), noiDung);
  writeFileSync(path.join(GOC, "docs/d.md"), noiDung);
  process.env.AI_REPO_SANDBOX_ROOT = GOC;
});
afterAll(() => {
  delete process.env.AI_REPO_SANDBOX_ROOT;
  try { rmSync(GOC, { recursive: true, force: true }); } catch { /* best-effort */ }
});
beforeEach(() => { xoaSoNganSach(); checkPermissionMock.mockReset(); checkPermissionMock.mockResolvedValue(true); process.env.AI_REPO_SANDBOX_ROOT = GOC; });

const tep = (r: any): string[] => [...new Set((r.data?.matches ?? []).map((m: any) => m.path as string))].sort();

describe("§1 THU HẸP — thư mục bị loại KHÔNG được quét", () => {
  it("★★★ không loại ⇒ đủ 4 tệp; loại `client` ⇒ mất đúng hai tệp dưới client", async () => {
    const het = await tool().handler!({ pattern: "MOC_TIM", __authCtx: AUTH } as never, CTX as never);
    expect(tep(het)).toEqual(["client/src/a.ts", "client/srcX/b.ts", "docs/d.md", "server/routers/c.ts"]);

    const bot = await tool().handler!({ pattern: "MOC_TIM", loaiTru: ["client"], __authCtx: AUTH } as never, CTX as never);
    expect(tep(bot)).toEqual(["docs/d.md", "server/routers/c.ts"]);
  });

  it("★★ nhiều mục cùng lúc ⇒ loại hết; mục lạ ⇒ không loại gì (im lặng, không ném)", async () => {
    const hai = await tool().handler!({ pattern: "MOC_TIM", loaiTru: ["client", "docs"], __authCtx: AUTH } as never, CTX as never);
    expect(tep(hai)).toEqual(["server/routers/c.ts"]);
    const la = await tool().handler!({ pattern: "MOC_TIM", loaiTru: ["khong-ton-tai"], __authCtx: AUTH } as never, CTX as never);
    expect(tep(la).length).toBe(4);
  });
});

describe("§2 RANH GIỚI ĐOẠN — `client/src` KHÔNG được nuốt `client/srcX`", () => {
  it("★★★ loại `client/src` ⇒ `client/srcX/b.ts` VẪN còn", async () => {
    const r = await tool().handler!({ pattern: "MOC_TIM", loaiTru: ["client/src"], __authCtx: AUTH } as never, CTX as never);
    expect(tep(r)).toEqual(["client/srcX/b.ts", "docs/d.md", "server/routers/c.ts"]);
  });

  it("★ dấu `\` và `/` thừa được chuẩn hoá về cùng một nghĩa", async () => {
    const BS = String.fromCharCode(92); // một dấu chéo ngược — viết bằng mã để không lệ thuộc lớp escape
    for (const dang of ["/client/src/", `client${BS}src`, "client//src"]) {
      const r = await tool().handler!({ pattern: "MOC_TIM", loaiTru: [dang], __authCtx: AUTH } as never, CTX as never);
      expect(tep(r), dang).toEqual(["client/srcX/b.ts", "docs/d.md", "server/routers/c.ts"]);
    }
  });
});

describe("§3 CHỐNG NỚI — `loaiTru` KHÔNG mở thêm được một tệp nào", () => {
  it("★★★ đường thoát (`..`, tuyệt đối) chỉ khiến phép so KHÔNG khớp — tập kết quả không LỚN hơn", async () => {
    const goc = tep(await tool().handler!({ pattern: "MOC_TIM", __authCtx: AUTH } as never, CTX as never));
    for (const doc of ["../../etc", "C:\Windows", "/etc/passwd", ".."]) {
      const r = await tool().handler!({ pattern: "MOC_TIM", loaiTru: [doc], __authCtx: AUTH } as never, CTX as never);
      const ra = tep(r);
      expect(ra.length, doc).toBeLessThanOrEqual(goc.length);
      expect(ra.every((x) => goc.includes(x)), doc).toBe(true);
    }
  });
});
