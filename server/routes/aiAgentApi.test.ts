/**
 * ★★★ Đợt 1 · T4 — TUYẾN SSE `/api/ai/agent/runs` đo trên HTTP THẬT (express + node:http + fetch), bộ quản lý THẬT, CSDL
 * `_test` THẬT; giả: xác thực (`thuXacThucRest` — chọn người theo header thử) và model (kịch bản).
 *
 * Bất biến chính: client BỎ ĐI không huỷ lượt chạy (khác `/api/ai/local-kb/stream`) — nối lại được bằng `?tu=<seq>`;
 * chỉ `…/huy` mới huỷ.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

vi.mock("./_xacThucRest", async (goc) => {
  const that = await goc<typeof import("./_xacThucRest")>();
  return {
    ...that,
    thuXacThucRest: async (req: { headers?: Record<string, unknown> }) => {
      await new Promise((r) => setTimeout(r, 2));
      const id = Number(req.headers?.["x-thu-nguoi"] ?? 0);
      if (!id) return { ok: false, ma: 401, lyDo: "AUTH_REQUIRED" };
      return { ok: true, user: { id, role: "admin", name: "Thu" } };
    },
  };
});

import type { GoiModel, ManhModel } from "@shared/agentCore";
import { registerAiAgentRoutes, khungSse } from "./aiAgentApi";
import { taoQuanLyLuotChay, type QuanLyLuotChay } from "../services/ai/agent/quanLyLuotChay";
import { getDb } from "../db/connection";
import { aiAgentRuns } from "../../drizzle/schema";
import { users, userSecrets } from "../../drizzle/schema/auth";
import { createLocalUser } from "../db/auth";

let REPO = "";
let uid = 0;
let uid2 = 0;
const DU_AN = "t4route";

/** Model chờ một "nút" từ lưới rồi mới trả lời — để đo nối lại giữa chừng. */
let thaModel: (() => void) | null = null;
const modelChoNut: GoiModel = async function* (vao): AsyncGenerator<ManhModel> {
  yield { loai: "chu", noiDung: "bắt đầu " };
  await new Promise<void>((r) => {
    thaModel = r;
    vao.signal.addEventListener("abort", () => r(), { once: true });
  });
  if (vao.signal.aborted) return;
  yield { loai: "chu", noiDung: "xong rồi" };
  yield { loai: "xong", toolCalls: [] };
};

/**
 * Thả model ĐÚNG lượt đang chờ. ⚠ Bản cũ `setTimeout(() => thaModel?.(), 30)` ĐUA: chạy gộp (tải nặng) model chưa tới
 * điểm chờ sau 30 ms ⇒ `thaModel` còn là hàm thả CŨ của ca trước (đã dùng) ⇒ lệnh thả rơi mất, model chờ mãi ⇒ ca
 * "lượt đã rời bộ nhớ" quá giờ 30 s (đo 2026-10-17, chỉ khi chạy gộp). Nay: xoá con trỏ trước mỗi lượt, CHỜ tới khi model
 * của lượt này đăng ký hàm thả rồi mới thả (và tiêu thụ nó).
 */
async function thaModelKhiSan(): Promise<void> {
  const han = Date.now() + 20_000;
  while (!thaModel) {
    if (Date.now() > han) throw new Error("model không tới điểm chờ trong 20 s");
    await new Promise((r) => setTimeout(r, 5));
  }
  const f = thaModel;
  thaModel = null;
  f();
}

let ql: QuanLyLuotChay;
let srv: http.Server;
let base = "";

async function docSse(res: Response, dung?: (n: number) => boolean): Promise<Array<{ seq: number; suKien: { loai: string } }>> {
  const ra: Array<{ seq: number; suKien: { loai: string } }> = [];
  const reader = res.body!.getReader();
  const td = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += td.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const khung = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = khung.split("\n").find((d) => d.startsWith("data: "));
      if (data) ra.push(JSON.parse(data.slice(6)));
    }
    if (dung?.(ra.length)) {
      await reader.cancel();
      break;
    }
  }
  return ra;
}

const hdr = (u: number) => ({ "content-type": "application/json", "x-thu-nguoi": String(u) });

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t4-route-")));
  execFileSync("git", ["-C", REPO, "init", "-q"]);
  fs.writeFileSync(path.join(REPO, "a.ts"), "export const A = 1;\n");
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=T4 Route|${REPO}`;
  const bcrypt = await import("bcryptjs");
  // Cost 4 (tối thiểu hợp lệ): lưới không đo bcrypt; cost 10 tốn CPU đáng kể khi chạy gộp hàng trăm tệp song song
  // (đo 2026-10-17: "Hook timed out in 60000ms" chỉ khi chạy gộp, chạy riêng hook < 4 s).
  const hash = await bcrypt.hash("Mk-route-agent!1", 4);
  uid = (await createLocalUser({ username: `t4-route-${Date.now()}`, passwordHash: hash, name: "Thu", role: "admin" })).id;
  uid2 = (await createLocalUser({ username: `t4-route2-${Date.now()}`, passwordHash: hash, name: "Thu2", role: "admin" })).id;

  ql = taoQuanLyLuotChay({ goiModel: modelChoNut });
  const app = express();
  app.use(express.json());
  registerAiAgentRoutes(app, ql);
  srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  // ★ Hook nhẹ + KHÔNG treo: một ca đỏ/quá giờ giữa chừng (vd model chờ `thaModel` mãi) để lại luồng SSE MỞ ⇒ `srv.close()`
  //   chờ socket ấy tới hết hạn hook (60 s) và che mất lỗi thật. Thả model, huỷ mọi kết nối còn mở rồi mới đóng.
  thaModel?.();
  srv.closeAllConnections();
  await new Promise<void>((r) => srv.close(() => r()));
  delete process.env.AI_REPO_SANDBOX_ROOTS;
  const db = await getDb();
  if (db) {
    for (const u of [uid, uid2].filter((x) => x > 0)) {
      await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, u));
      await db.delete(userSecrets).where(eq(userSecrets.userId, u));
      await db.delete(users).where(eq(users.id, u));
    }
  }
  fs.rmSync(REPO, { recursive: true, force: true });
}, 60_000);

describe("POST /api/ai/agent/runs + nối lại + huỷ", () => {
  it("★★★ client bỏ đi KHÔNG huỷ; nối lại từ ?tu phát phần còn lại; lượt chạy hoàn thành", async () => {
    thaModel = null; // hàm thả của ca trước (nếu còn) KHÔNG được dùng cho lượt này
    const r1 = await fetch(`${base}/api/ai/agent/runs`, {
      method: "POST",
      headers: hdr(uid),
      body: JSON.stringify({ cauHoi: "chào", projectId: DU_AN, cheDo: "hoi" }),
    });
    expect(r1.status).toBe(200);
    expect(r1.headers.get("content-type")).toContain("text/event-stream");
    const runId = r1.headers.get("x-agent-run-id")!;
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    // đọc 2 khung (bat-dau + chu) rồi BỎ ĐI
    const dau = await docSse(r1, (n) => n >= 2);
    expect(dau.map((m) => m.suKien.loai)).toEqual(["bat-dau", "chu"]);
    expect(dau.map((m) => m.seq)).toEqual([1, 2]);
    await new Promise((r) => setTimeout(r, 50));
    const l = ql.layLuotChay(runId, uid)!;
    expect(l.ketThuc, "bỏ đi không được kết thúc lượt chạy").toBeNull();
    expect(l.boHuy.signal.aborted).toBe(false);

    // người khác không nối được
    const rKhac = await fetch(`${base}/api/ai/agent/runs/${runId}/events?tu=0`, { headers: hdr(uid2) });
    expect(rKhac.status).toBe(404);

    // nối lại từ seq 2 rồi thả model
    const r2 = await fetch(`${base}/api/ai/agent/runs/${runId}/events?tu=2`, { headers: hdr(uid) });
    expect(r2.status).toBe(200);
    void thaModelKhiSan();
    const sau = await docSse(r2);
    expect(sau[0]!.seq).toBe(3);
    expect(sau.map((m) => m.suKien.loai)).toEqual(["chu", "xong"]);
    expect(sau[sau.length - 1]!.suKien).toMatchObject({ loai: "xong", lyDo: "hoan-thanh" });
    await l.xong;
  }, 30_000);

  it("★★★ POST …/huy mới huỷ: luồng đang mở nhận `xong` lyDo 'huy' rồi đóng", async () => {
    const r1 = await fetch(`${base}/api/ai/agent/runs`, {
      method: "POST",
      headers: hdr(uid),
      body: JSON.stringify({ cauHoi: "việc dài", projectId: DU_AN, cheDo: "hoi" }),
    });
    const runId = r1.headers.get("x-agent-run-id")!;
    const p = docSse(r1);
    await new Promise((r) => setTimeout(r, 50));
    const khac = await fetch(`${base}/api/ai/agent/runs/${runId}/huy`, { method: "POST", headers: hdr(uid2), body: "{}" });
    expect(khac.status).toBe(404);
    const h = await fetch(`${base}/api/ai/agent/runs/${runId}/huy`, { method: "POST", headers: hdr(uid), body: "{}" });
    expect(h.status).toBe(200);
    const ds = await p;
    expect(ds[ds.length - 1]!.suKien).toMatchObject({ loai: "xong", lyDo: "huy" });
  }, 30_000);

  it("★★ lượt đã rời bộ nhớ ⇒ phát lại bản ĐÃ GỘP trong sổ rồi đóng", async () => {
    thaModel = null; // hàm thả của ca trước (nếu còn) KHÔNG được dùng cho lượt này
    const r1 = await fetch(`${base}/api/ai/agent/runs`, {
      method: "POST",
      headers: hdr(uid),
      body: JSON.stringify({ cauHoi: "ngắn", projectId: DU_AN, cheDo: "hoi" }),
    });
    const runId = r1.headers.get("x-agent-run-id")!;
    void thaModelKhiSan();
    await docSse(r1);
    await ql.layLuotChay(runId, uid)!.xong;

    // bộ quản lý MỚI (như sau restart) — chỉ còn sổ
    const app2 = express();
    registerAiAgentRoutes(app2, taoQuanLyLuotChay({ goiModel: modelChoNut }));
    const srv2 = http.createServer(app2);
    await new Promise<void>((r) => srv2.listen(0, "127.0.0.1", r));
    try {
      const b2 = `http://127.0.0.1:${(srv2.address() as AddressInfo).port}`;
      const r = await fetch(`${b2}/api/ai/agent/runs/${runId}/events?tu=0`, { headers: hdr(uid) });
      expect(r.status).toBe(200);
      const ds = await docSse(r);
      expect(ds[0]!.suKien.loai).toBe("bat-dau");
      expect(ds.find((m) => m.suKien.loai === "chu")!.suKien).toEqual({ loai: "chu", noiDung: "bắt đầu xong rồi" });
      expect(ds[ds.length - 1]!.suKien.loai).toBe("xong");
      const r404 = await fetch(`${b2}/api/ai/agent/runs/${runId}/events`, { headers: hdr(uid2) });
      expect(r404.status).toBe(404);
    } finally {
      await new Promise<void>((r) => srv2.close(() => r()));
    }
  }, 30_000);

  it("★★ lỗi đầu vào ⇒ JSON có mã (không mở SSE); chưa đăng nhập ⇒ 401", async () => {
    const r = await fetch(`${base}/api/ai/agent/runs`, {
      method: "POST",
      headers: hdr(uid),
      body: JSON.stringify({ cauHoi: "x", projectId: DU_AN, cheDo: "root" }),
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ success: false, code: "CHE_DO_SAI" });
    const k = await fetch(`${base}/api/ai/agent/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(k.status).toBe(401);
  });

  it("khungSse: id + data {seq, suKien}", () => {
    expect(khungSse({ seq: 7, suKien: { loai: "chu", noiDung: "a" } })).toBe('id: 7\ndata: {"seq":7,"suKien":{"loai":"chu","noiDung":"a"}}\n\n');
  });
});
