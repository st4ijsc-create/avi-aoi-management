// @vitest-environment jsdom
// SCADA 1b — hook `useTagSong`: một cửa đọc giá trị sống. Kho thật + socket giả; chỉ mock tRPC (dự phòng hỏi vòng khi kênh bị tắt).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { KhoScadaLive, type SocketLive } from "@/lib/scadaLive";

const srv = vi.hoisted(() => ({ hoi: undefined as unknown, opts: undefined as Record<string, unknown> | undefined, goi: 0 }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    scadaDiag: {
      tagCuaAdapter: {
        useQuery: (_i: unknown, o: Record<string, unknown>) => {
          srv.opts = o;
          srv.goi += 1;
          return { data: o.enabled ? srv.hoi : undefined };
        },
      },
    },
  },
}));
vi.mock("@/lib/socketManager", () => ({ getSharedSocket: () => ({}), releaseSharedSocket: () => undefined }));

import { useAdapterSong, useTagSong } from "./useTagSong";

class SocketGia implements SocketLive {
  connected = false;
  ra: { ev: string; payload: any }[] = [];
  private h = new Map<string, Set<(...a: any[]) => void>>();
  emit(ev: string, payload: unknown) {
    this.ra.push({ ev, payload });
  }
  on(ev: string, fn: (...a: any[]) => void) {
    (this.h.get(ev) ?? this.h.set(ev, new Set()).get(ev)!).add(fn);
  }
  off(ev: string, fn: (...a: any[]) => void) {
    this.h.get(ev)?.delete(fn);
  }
  phat(ev: string, p?: unknown) {
    for (const f of [...(this.h.get(ev) ?? [])]) f(p);
  }
}

let sk: SocketGia;
let kho: KhoScadaLive;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(2_000_000);
  sk = new SocketGia();
  kho = new KhoScadaLive({ layKetNoi: () => sk });
  srv.hoi = undefined;
  srv.opts = undefined;
});
afterEach(() => {
  cleanup();
  kho.huy();
  vi.useRealTimers();
});

const noiVaSnapshot = (values: any[], staleAfterMs: Record<string, number> = { "7:torque": 15_000 }) => {
  sk.connected = true;
  sk.phat("connect");
  act(() => {
    vi.advanceTimersByTime(60);
  });
  act(() => {
    sk.phat("scada:snapshot", { subId: "ui-0", seq: 0, serverTs: Date.now(), values, staleAfterMs, denied: [] });
  });
};

describe("useTagSong", () => {
  it("★ đăng ký khi mount (gộp 50 ms) và nhận giá trị đẩy: nguon 'day', không hỏi vòng", () => {
    const { result } = renderHook(() => useTagSong(7, "torque", { kho }));
    expect(result.current).toMatchObject({ coMau: false, cu: true, nguon: "day" }); // chưa có mẫu ⇒ cũ, KHÔNG bịa 0
    noiVaSnapshot([[7, "torque", 1.21, "good", Date.now(), 1000, false, null]]);
    expect(sk.ra.filter((r) => r.ev === "scada:subscribe")[0].payload.tags).toEqual([{ adapterId: 7, tagKey: "torque" }]);
    expect(result.current).toMatchObject({ v: 1.21, q: "good", cu: false, tuoiMs: 1000, nguon: "day" });
    expect(srv.opts?.enabled).toBe(false);
  });

  it("★ không có tick ⇒ chuyển sang CŨ khi đồng hồ chạy (hook render lại), giá trị không đổi", () => {
    const { result } = renderHook(() => useTagSong(7, "torque", { kho }));
    noiVaSnapshot([[7, "torque", 1.21, "good", Date.now(), 0, false, null]]);
    expect(result.current.cu).toBe(false);
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(result.current).toMatchObject({ cu: true, v: 1.21 });
  });

  it("★ máy chủ tắt kênh (DISABLED) ⇒ nguon 'hoi', hỏi vòng 5 s, giá trị từ tagCuaAdapter, cũ theo stale của máy chủ", () => {
    srv.hoi = [{ tagKey: "torque", v: 2.5, q: "uncertain", ageMs: 3000, stale: false, reason: null }];
    const { result, rerender } = renderHook(() => useTagSong(7, "torque", { kho }));
    noiVaSnapshot([]);
    act(() => {
      sk.phat("scada:error", { code: "DISABLED" });
    });
    expect(srv.opts).toMatchObject({ enabled: true, refetchInterval: 5000 });
    expect(result.current).toMatchObject({ nguon: "hoi", v: 2.5, q: "uncertain", cu: false, tuoiMs: 3000 });
    srv.hoi = [{ tagKey: "torque", v: 2.5, q: "good", ageMs: null, stale: true, reason: null }];
    rerender(); // vòng hỏi kế tiếp trả dữ liệu mới
    expect(result.current).toMatchObject({ nguon: "hoi", cu: true, coMau: false, tuoiMs: null });
  });

  it("id null ⇒ không đăng ký, trả 'không có' (cũ)", () => {
    const { result } = renderHook(() => useTagSong(null, null, { kho }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(sk.ra).toHaveLength(0);
    expect(result.current).toMatchObject({ coMau: false, cu: true, v: null });
  });

  it("unmount ⇒ huỷ đăng ký (unsubscribe khi không còn ai)", () => {
    const { unmount } = renderHook(() => useTagSong(7, "torque", { kho }));
    sk.connected = true;
    sk.phat("connect");
    act(() => {
      vi.advanceTimersByTime(60);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(sk.ra.some((r) => r.ev === "scada:unsubscribe")).toBe(true);
  });
});

describe("useAdapterSong", () => {
  it("★ trangThai null (không rõ) giữ null; có tick ⇒ trạng thái thật", () => {
    renderHook(() => useTagSong(7, "torque", { kho }));
    const { result } = renderHook(() => useAdapterSong(7, { kho }));
    expect(result.current).toMatchObject({ trangThai: null, coTick: false });
    noiVaSnapshot([[7, "torque", 1, "good", Date.now(), 0, false, null]]);
    act(() => {
      sk.phat("scada:tick", { subId: "ui-0", seq: 1, serverTs: Date.now(), adapters: [{ adapterId: 7, trangThai: null, tuoiMauMoiNhatMs: null }] });
    });
    expect(result.current).toMatchObject({ trangThai: null, coTick: true });
    act(() => {
      sk.phat("scada:tick", { subId: "ui-0", seq: 2, serverTs: Date.now(), adapters: [{ adapterId: 7, trangThai: "connected", tuoiMauMoiNhatMs: 400 }] });
    });
    expect(result.current).toMatchObject({ trangThai: "connected", tuoiMauMoiNhatMs: 400 });
  });
});
