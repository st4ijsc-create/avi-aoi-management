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

describe("★★★ kiem-dinh test round — x38 (quét định kỳ) / x14 (biên trần hàng đợi)", () => {
  it("(x38) quét ĐỊNH KỲ: mỗi chu kỳ một lượt quét (≥ 2 lượt sau 2 chu kỳ); stop() gỡ hẹn giờ (không lượt nào nữa)", async () => {
    vi.useFakeTimers();
    try {
      xl.__datCauHinhChoTest({ chuKyQuetMs: 1_000 });
      const kenh = await xl.batDauNgheSocketPhamVi({
        listenClient: () => ({ listen: async (_c: string, _fn: (p: string) => void, onlisten?: () => void) => (onlisten?.(), { unlisten: async () => undefined }) }),
        notifyClient: () => ({ notify: async () => undefined }),
        pingMs: 3_600_000,
        alert: () => undefined,
      });
      const truoc = xl.thongKeXetLaiQuyen().quet;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(xl.thongKeXetLaiQuyen().quet).toBe(truoc + 1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(xl.thongKeXetLaiQuyen().quet).toBe(truoc + 2);
      expect(GOI.filter((g) => g === "assign:*").length, "mỗi lượt định kỳ là một lượt quét thật (xoá bộ nhớ phân công)").toBe(2);
      await kenh.stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(xl.thongKeXetLaiQuyen().quet, "stop() gỡ hẹn giờ quét").toBe(truoc + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("(x14) trần hàng đợi: ĐÚNG bằng trần ⇒ KHÔNG tràn (xử lý bình thường); trần + 1 ⇒ tràn ⇒ bỏ hàng đợi + QUÉT", async () => {
    xl.__datCauHinhChoTest({ cuaSoAllMs: 0, treAllToiDaMs: 0, tranHang: 10 });
    for (let i = 1; i <= 10; i++) xl.nhanThongBaoPhamVi(JSON.stringify({ u: [100 + i] }));
    await xl.__choXongChoTest();
    expect(xl.thongKeXetLaiQuyen()).toMatchObject({ tranHang: 0, nguoiXuLy: 10, quet: 0 });
    xl.__datLaiChoTest();
    for (let i = 1; i <= 11; i++) xl.nhanThongBaoPhamVi(JSON.stringify({ u: [200 + i] }));
    await xl.__choXongChoTest();
    expect(xl.thongKeXetLaiQuyen().tranHang).toBe(1);
    expect(xl.thongKeXetLaiQuyen().quet).toBeGreaterThanOrEqual(1);
    expect(xl.thongKeXetLaiQuyen().nguoiXuLy, "hàng đợi bị bỏ khi tràn").toBe(0);
  });
});
