/**
 * socketXetLaiQuyen.boNho.test.ts — F5 fix round 2 (M-2) + fix round 1 (C1): lượt QUÉT xoá ĐÚNG bộ nhớ phân công và không gì khác; "all" /
 * tải trọng hỏng xoá ĐÚNG ba bộ nhớ PHẠM VI; không lượt nào xoá toàn cục bộ nhớ danh tính (authSessionCache) hay bộ nhớ STOP suy giảm.
 * Thuần: io giả không socket nào (không cổng mạng, không DB); năm mô-đun bộ nhớ là spy.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const GOI = vi.hoisted(() => [] as string[]);
vi.mock("./accessControl", () => ({
  invalidateAssignmentCache: (id: number) => void GOI.push(`assign:${id}`),
  clearAssignmentCache: () => void GOI.push("assign:*"),
  getUserAssignmentCodes: async () => ({ corporateCodes: [], factoryCodes: [], isAdmin: false }),
}));
vi.mock("../services/authSessionCache", () => ({
  invalidateAuthUser: async (id: number) => void GOI.push(`auth:${id}`),
  clearAuthSessionCache: async () => void GOI.push("auth:*"),
}));
vi.mock("../services/robot/robotStopAuthMemo", () => ({
  invalidateStopAuthForUser: (id: number) => void GOI.push(`stop:${id}`),
  clearAllStopAuthMemo: () => void GOI.push("stop:*"),
}));
vi.mock("../services/aiAgentPhamVi", () => ({
  xoaCachePhamViChu: (id?: number) => void GOI.push(id === undefined ? "ai:*" : `ai:${id}`),
}));
vi.mock("../routes/_congAnh", () => ({
  xoaNhoDemPhamViAnhCuaNguoi: (id: number) => void GOI.push(`anh:${id}`),
  xoaNhoDemPhamViAnh: () => void GOI.push("anh:*"),
}));

import * as xl from "./socketXetLaiQuyen";

const ioGia = {
  of: () => ({ sockets: new Map(), adapter: { rooms: new Map() } }),
  local: { in: () => ({ disconnectSockets: () => undefined }) },
};

beforeEach(() => {
  GOI.length = 0;
  xl.__datLaiChoTest();
  xl.__datCauHinhChoTest({ cuaSoAllMs: 0, treAllToiDaMs: 0 });
  xl.ganIoXetLaiQuyen(ioGia as never);
});

describe("F5 — bộ nhớ nào bị xoá ở mỗi đường", () => {
  it("(M-2) lượt QUÉT (chặt và sự cố) xoá ĐÚNG bộ nhớ phân công, không gì khác", async () => {
    await xl.yeuCauQuet("luoi", "chat");
    await xl.yeuCauQuet("luoi", "su_co");
    expect(GOI).toEqual(["assign:*", "assign:*"]);
  });

  it("(C1) \"all\" và tải trọng hỏng xoá ĐÚNG ba bộ nhớ phạm vi; KHÔNG auth:* / stop:*", async () => {
    xl.nhanThongBaoPhamVi('{"all":1}');
    await new Promise((r) => setTimeout(r, 20));
    expect([...GOI].sort()).toEqual(["ai:*", "anh:*", "assign:*"]);
    GOI.length = 0;
    xl.nhanThongBaoPhamVi("{khong json");
    await new Promise((r) => setTimeout(r, 20));
    expect([...GOI].sort()).toEqual(["ai:*", "anh:*", "assign:*"]);
  });

  it("{\"u\"} / {\"s\"} xoá CẢ NĂM bộ nhớ của ĐÚNG người ấy (không xoá toàn cục)", async () => {
    xl.nhanThongBaoPhamVi(JSON.stringify({ u: [7] }));
    await xl.__choXongChoTest();
    expect([...GOI].sort()).toEqual(["ai:7", "anh:7", "assign:7", "auth:7", "stop:7"]);
    GOI.length = 0;
    xl.nhanThongBaoPhamVi(JSON.stringify({ s: 9, u: [8] }));
    await xl.__choXongChoTest();
    expect([...GOI].sort()).toEqual(["ai:8", "anh:8", "assign:8", "auth:8", "stop:8"]);
  });
});
