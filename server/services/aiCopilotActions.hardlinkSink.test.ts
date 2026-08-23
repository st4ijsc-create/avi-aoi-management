/**
 * ★★★ Pha 5 Task 1 (review, **C-1**) — **BA SINK CỦA `preview()` PHẢI SẠCH, ĐO TẠI CHÍNH SINK.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO ĐO Ở ĐÂY CHỨ KHÔNG CHỈ Ở `preview()`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lưới `workspaceConfinement.canary.test.ts` khẳng định **đối tượng `preview` trả ra** không mang
 * bí mật. Nhưng lời buộc tội của review là về **nơi bí mật ĐI TỚI**: `proposeAction()` chạy
 * `tool.preview()` ở **phase PROPOSE** — **TRƯỚC** mọi lượt xác nhận của con người — rồi rót kết quả
 * vào **BA đích không cần ai duyệt**:
 *
 *   1. `previewJson` → **ghi vào DB** `ai_pending_actions` (`aiCopilotActions.ts:284`)
 *   2. `changes: preview.changes` → **ghi vào SỔ AUDIT** (`:309`)
 *   3. `pendingAction.preview` → **trả thẳng về Agent/UI** (`:390`)
 *
 * Hai đích đầu **LƯU LẠI** — một lượt rò ở đó không biến mất khi phiên kết thúc. ⇒ Ca này chặn
 * **chính cái payload được persist**, không chặn một đối tượng trung gian.
 *
 * ⚠⚠ **ĐỐI CHỨNG DƯƠNG BẮT BUỘC**: nếu `proposeAction` chỉ đơn giản **hỏng** thì mọi sink cũng sạch,
 * và ca này sẽ xanh **vì lý do sai** — đúng lớp lỗi đã để `215/215` xanh khi một tool đã chết. Ca
 * `★★★ ĐỐI CHỨNG DƯƠNG` khoá việc đường ống **vẫn chở nội dung thật** của một file hợp lệ.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Row = Record<string, any>;
/** Mọi hàng ĐÃ GHI vào `ai_pending_actions` trong lượt chạy. */
const inserted: Row[] = [];

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...preds: Array<(r: Row) => boolean>) => (r: Row) => preds.every((p) => p(r)),
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({
    insert: (_t: unknown) => ({
      values: async (vals: Row) => {
        inserted.push({ ...vals });
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({
      set: () => ({
        // Thenable + `.returning()` — xem `aiCopilotActions.test.ts`. Kho rỗng ⇒ 0 hàng ở cả hai lối.
        where: () => ({
          then: (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) =>
            Promise.resolve({ rowCount: 0 }).then(ok, ng),
          returning: async () => [] as Array<{ id: string }>,
        }),
      }),
    }),
  })),
}));

vi.mock("../../drizzle/schema", () => ({
  aiPendingActions: {
    id: { __name: "id" },
    status: { __name: "status" },
    userId: { __name: "userId" },
    expiresAt: { __name: "expiresAt" },
  },
}));

const checkPermission = vi.fn();
vi.mock("../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermission(...a),
}));

/** Mọi lượt ghi SỔ AUDIT trong lượt chạy. */
const auditCalls: unknown[][] = [];
vi.mock("./auditTrailService", () => ({
  AUDIT_ACTIONS: {
    AI_ACTION_PROPOSED: "ai_action_proposed",
    AI_ACTION_CONFIRMED: "ai_action_confirmed",
    AI_ACTION_EXECUTED: "ai_action_executed",
    AI_ACTION_DENIED: "ai_action_denied",
    AI_ACTION_CANCELLED: "ai_action_cancelled",
  },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: async (...a: unknown[]) => {
    auditCalls.push(a);
    return { id: 1 };
  },
  logUpdate: async () => {},
}));

vi.mock("./aiAgentRealtime", () => ({ publishAiAgentEvent: vi.fn() }));

import { getTool } from "./aiLocalTools/toolRegistry";
import "./aiLocalTools/writeHandlers/programmingFile"; // registers write_project_file
import { proposeAction } from "./aiCopilotActions";

const CANARY = "SINK-CANARY-4d81be07";
const BI_MAT = `SECRET_TOKEN=${CANARY}\nAWS_KEY=zzz\n`;
const ADMIN = { id: 1, role: "admin", name: "Admin" } as const;
const ctx = { user: ADMIN, lang: "vi" as const };

let ws = "";
let ngoai = "";
let hardlinkOk = false;
let hardlinkErr: string | null = null;

beforeAll(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "sink-ws-"));
  ngoai = fs.mkdtempSync(path.join(os.tmpdir(), "sink-out-"));
  process.env.PROG_WORKSPACE_DIR = ws;
  const secret = path.join(ngoai, "prod.env");
  fs.writeFileSync(secret, BI_MAT);
  fs.writeFileSync(path.join(ws, "normal.st"), "PLAIN-CONTENT-777");
  try {
    fs.linkSync(secret, path.join(ws, "looks-fine.st"));
    hardlinkOk = true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    hardlinkErr = `${err.code}: ${err.message}`;
  }
});

afterAll(() => {
  for (const d of [ws, ngoai]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  delete process.env.PROG_WORKSPACE_DIR;
});

beforeEach(() => {
  inserted.length = 0;
  auditCalls.length = 0;
  checkPermission.mockReset();
  checkPermission.mockResolvedValue(true);
});

describe("★★★ C-1 — bí mật sau hard link KHÔNG tới được previewJson (DB) hay sổ AUDIT", () => {
  it("★ MÔI TRƯỜNG — hard link phải dựng được, nếu không ca dưới KHÔNG chứng minh gì", () => {
    expect(hardlinkOk, `không dựng được hard link. Lý do: ${hardlinkErr}`).toBe(true);
    expect(fs.statSync(path.join(ws, "looks-fine.st")).nlink).toBeGreaterThan(1);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — file thường: đường ống CHẠY THẬT và previewJson mang nội dung thật", async () => {
    /**
     * ⚠⚠ Không có ca này thì một `proposeAction` **hỏng toàn tập** cũng cho mọi sink "sạch".
     * Ca khoá: có **đúng một** hàng được ghi, và `previewJson` chứa **giá trị cụ thể** của file.
     */
    const tool = getTool("write_project_file")!;
    const res = await proposeAction(tool, { path: "normal.st", content: "NEW" }, ctx as never);

    expect(res.ok, "đường ống phải chạy tới nơi cho một file hợp lệ").toBe(true);
    expect(inserted.length, "phải có ĐÚNG một hàng ai_pending_actions").toBe(1);
    expect(JSON.stringify(inserted[0].previewJson)).toContain("PLAIN-CONTENT-777");
    expect(auditCalls.length, "phải có lượt ghi sổ audit").toBeGreaterThan(0);
  });

  it("★★★ hard link — previewJson ghi vào DB KHÔNG chứa một byte bí mật nào", async () => {
    const tool = getTool("write_project_file")!;
    await proposeAction(tool, { path: "looks-fine.st", content: "x" }, ctx as never);

    // Toàn bộ những gì được persist, không chỉ ô previewJson.
    const daGhi = JSON.stringify(inserted);
    expect(daGhi, "bí mật KHÔNG được nằm trong hàng ai_pending_actions").not.toContain(CANARY);
    expect(daGhi).not.toContain("SECRET_TOKEN");
    expect(daGhi).not.toContain("AWS_KEY");

    // …và `changes` (nguồn của cả previewJson lẫn dòng audit) phải RỖNG.
    const pj = inserted[0]?.previewJson as { changes?: unknown[]; warnings?: string[] } | undefined;
    expect(pj?.changes, "cửa từ chối ⇒ không có gì để so sánh").toEqual([]);
    expect((pj?.warnings ?? []).join(" "), "phải nói VÌ SAO").toMatch(/liên kết cứng|hard link/i);
  });

  it("★★★ hard link — dòng AUDIT KHÔNG chứa một byte bí mật nào", async () => {
    const tool = getTool("write_project_file")!;
    await proposeAction(tool, { path: "looks-fine.st", content: "x" }, ctx as never);

    expect(auditCalls.length, "vẫn phải ghi audit — chặn KHÔNG có nghĩa là im lặng").toBeGreaterThan(0);
    const daGhi = JSON.stringify(auditCalls);
    expect(daGhi, "bí mật KHÔNG được nằm trong sổ audit").not.toContain(CANARY);
    expect(daGhi).not.toContain("SECRET_TOKEN");
    expect(daGhi).not.toContain("AWS_KEY");
  });

  it("★★★ hard link — payload TRẢ VỀ Agent/UI cũng không mang bí mật", async () => {
    const tool = getTool("write_project_file")!;
    const res = await proposeAction(tool, { path: "looks-fine.st", content: "x" }, ctx as never);
    const all = JSON.stringify(res);
    expect(all).not.toContain(CANARY);
    expect(all).not.toContain("SECRET_TOKEN");
    expect(all).not.toContain("AWS_KEY");
  });
});
