/**
 * Bridge `ai:agents` phát THEO PHẠM VI NHÀ MÁY: socket của người nhà máy B không nhận nudge của người nhà máy A,
 * và payload trên dây không mang sessionId/ownerUserId. Chuỗi thật (bridge → aiAgentPhamVi.locTheoChu) — chỉ giả bộ phân giải phạm vi + đọc vai (`__datPhuThuocChoTest`).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

const PV: Record<number, number[] | null> = { 1: null, 10: [1], 11: [2], 12: [1, 2], 13: [], 14: [1] };
const VAI: Record<number, string> = { 1: "admin", 10: "engineer", 11: "engineer", 12: "engineer", 13: "engineer", 14: "operator" };


const nhan: string[] = [];
const payloads: unknown[] = [];
const mk = (nhanDien: string, user: { id: number; role: string } | undefined) => ({
  data: { user },
  emit: (_c: string, p: unknown) => {
    nhan.push(nhanDien);
    payloads.push(p);
  },
});
const SOCKETS = [
  mk("admin", { id: 1, role: "admin" }),
  mk("eng10-tab1", { id: 10, role: "engineer" }),
  mk("eng10-tab2", { id: 10, role: "engineer" }),
  mk("eng11", { id: 11, role: "engineer" }),
  mk("eng12-corp", { id: 12, role: "engineer" }),
  mk("eng13-chua-gan", { id: 13, role: "engineer" }),
  mk("an-danh", undefined),
];
const fakeIo = { in: () => ({ fetchSockets: async () => SOCKETS }) };
vi.mock("../_core/socket", () => ({ getIO: () => fakeIo }));

import { publishAiAgentEvent, installAiAgentSocketBridge, uninstallAiAgentSocketBridge } from "./aiAgentRealtime";
import { xoaCachePhamViChu, nguoiNhanThayChu, __datPhuThuocChoTest } from "./aiAgentPhamVi";

describe("bridge ai:agents — theo phạm vi nhà máy của người nhận", () => {
  const prev = process.env.AI_AGENTS_LIVE_ENABLED;
  // làm nóng import động (drizzle schema) MỘT lần — nếu không, sự kiện của ca này trôi sang ca sau
  beforeAll(async () => {
    __datPhuThuocChoTest({
      bay: () => Date.now(),
      async phanGiai(u) {
        if (!(u.userId in PV)) throw new Error("không phân giải được");
        return PV[u.userId];
      },
      async layVaiTro(ids) {
        return new Map(ids.filter((i) => i in VAI).map((i) => [i, VAI[i]] as [number, string]));
      },
    });
    await nguoiNhanThayChu({ id: 10, role: "engineer" }, 14);
  });
  beforeEach(() => {
    nhan.length = 0;
    payloads.length = 0;
    xoaCachePhamViChu();
    process.env.AI_AGENTS_LIVE_ENABLED = "true";
    uninstallAiAgentSocketBridge();
    installAiAgentSocketBridge();
  });
  afterEach(() => {
    uninstallAiAgentSocketBridge();
    process.env.AI_AGENTS_LIVE_ENABLED = prev;
  });
  // lần đầu import động schema/drizzle chậm ⇒ chờ tới khi bridge phát xong (admin luôn có mặt) rồi thêm một nhịp cho phần còn lại
  const doi = async () => {
    await vi.waitFor(() => expect(nhan.length).toBeGreaterThan(0), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 250));
  };

  it("★ sự kiện của chủ ở nhà máy 1: admin + engineer nhà máy 1 (mọi tab) + tập đoàn nhận; nhà máy 2 / chưa gán / ẩn danh KHÔNG", async () => {
    publishAiAgentEvent("advanced", "sess-xyz", 14);
    await doi();
    expect([...nhan].sort()).toEqual(["admin", "eng10-tab1", "eng10-tab2", "eng12-corp"]);
  });

  it("★ sự kiện của chủ ở nhà máy 2: engineer nhà máy 1 KHÔNG nhận", async () => {
    publishAiAgentEvent("advanced", "sess-xyz", 11);
    await doi();
    expect([...nhan].sort()).toEqual(["admin", "eng11", "eng12-corp"]);
  });

  it("★ payload trên dây chỉ có event + at — không sessionId, không ownerUserId", async () => {
    publishAiAgentEvent("confirmed", "sess-bi-mat", 14);
    await doi();
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) expect(Object.keys(p as object).sort()).toEqual(["at", "event"]);
  });

  it("★ sự kiện KHÔNG rõ chủ ⇒ chỉ admin nhận", async () => {
    publishAiAgentEvent("action_proposed");
    await doi();
    expect(nhan).toEqual(["admin"]);
  });

  it("★ chủ không phân giải được (id lạ) ⇒ chỉ admin nhận (fail-closed)", async () => {
    publishAiAgentEvent("advanced", "s", 999);
    await doi();
    expect(nhan).toEqual(["admin"]);
  });

  it("cờ AI_AGENTS_LIVE_ENABLED tắt ⇒ không ai nhận", async () => {
    process.env.AI_AGENTS_LIVE_ENABLED = "false";
    publishAiAgentEvent("advanced", "s", 14);
    await new Promise((r) => setTimeout(r, 300));
    expect(nhan).toEqual([]);
  });
});
