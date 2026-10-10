/**
 * doc 81 Đợt 4 Task D1 — logic đồng bộ localStorage ⇄ server (không React, không mạng). Server giả = một object trong bộ
 * nhớ dùng CHÍNH `checkUiPrefsPatch` của server để từ chối (oracle độc lập: phép gộp là `Object.assign`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createUiPrefsSync,
  localKeyForServer,
  markUiPrefDirty,
  serverKeyForLocal,
  startUiPrefsSync,
  UI_PREFS_APPLIED_EVENT,
  type UiPrefsTransport,
} from "./uiPrefsSync";
import { checkUiPrefsPatch } from "@shared/uiPrefs";

class MemStorage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

const UID = 7;
const LABS = `layoutKit:nav-labs:u${UID}:show`;
const H = `layoutKit:ide:u${UID}:hpx`;
const B = `layoutKit:ide:u${UID}:bottomCollapsed`;

function fakeServer(initial: Record<string, unknown> = {}) {
  const state = { prefs: { ...initial } as Record<string, unknown>, sets: [] as Array<Record<string, unknown>>, down: false };
  const transport: UiPrefsTransport = {
    get: vi.fn(async () => {
      if (state.down) throw new TypeError("Failed to fetch");
      return { prefs: { ...state.prefs }, available: true };
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      if (state.down) throw new TypeError("Failed to fetch");
      const c = checkUiPrefsPatch(patch, UID);
      if (!c.ok) throw Object.assign(new Error("BAD_REQUEST"), { data: { code: "BAD_REQUEST" } });
      state.sets.push(patch);
      Object.assign(state.prefs, c.value);
      return { prefs: state.prefs };
    }),
  };
  return { state, transport };
}

describe("uiPrefsSync — ánh xạ khoá", () => {
  it("showLabs ⇄ khoá Labs cục bộ; khoá bố cục giống hệt; khoá người khác / lạ ⇒ null", () => {
    expect(serverKeyForLocal(LABS, UID)).toBe("showLabs");
    expect(localKeyForServer("showLabs", UID)).toBe(LABS);
    expect(serverKeyForLocal(H, UID)).toBe(H);
    expect(serverKeyForLocal(`layoutKit:ide:u8:hpx`, UID)).toBeNull();
    expect(serverKeyForLocal(`layoutKit:nav-labs:u8:show`, UID)).toBeNull();
    expect(serverKeyForLocal(`layoutKit:ide:u${UID}:split`, UID)).toBeNull();
    expect(serverKeyForLocal("theme", UID)).toBeNull();
  });
});

describe("uiPrefsSync — lượt đầu", () => {
  it("server THẮNG cho khoá server có; báo các khoá đã đổi; khoá chỉ-cục-bộ đẩy lên MỘT lần", async () => {
    const { state, transport } = fakeServer({ showLabs: true, [B]: true });
    const kho = new MemStorage();
    kho.setItem(LABS, "0"); // bản đệm cũ
    kho.setItem(H, JSON.stringify({ left: { px: 250, pct: 18 } })); // chỉ máy này có
    kho.setItem(`layoutKit:ide:u8:hpx`, JSON.stringify({ left: { px: 250, pct: 18 } })); // người khác
    kho.setItem("unrelated", "x");
    const ev = new EventTarget();
    const bao: string[][] = [];
    ev.addEventListener(UI_PREFS_APPLIED_EVENT, (e) => bao.push((e as CustomEvent<string[]>).detail));
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: ev });
    await s.start();
    expect(kho.getItem(LABS)).toBe("1");
    expect(kho.getItem(B)).toBe("1");
    expect(bao).toEqual([[LABS, B]]);
    expect(state.sets).toEqual([{ [H]: { left: { px: 250, pct: 18 } } }]);
    await s.start(); // gọi lại = cùng lượt, không hỏi/đẩy lần nữa
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(state.sets).toHaveLength(1);
  });

  it("server đã khớp ⇒ không ghi, không báo", async () => {
    const { transport } = fakeServer({ showLabs: true });
    const kho = new MemStorage();
    kho.setItem(LABS, "1");
    const ev = new EventTarget();
    const f = vi.fn();
    ev.addEventListener(UI_PREFS_APPLIED_EVENT, f);
    await createUiPrefsSync({ userId: UID, transport, storage: kho, events: ev }).start();
    expect(f).not.toHaveBeenCalled();
    expect(transport.set).not.toHaveBeenCalled();
  });

  it("★ khoá người dùng vừa đổi TRƯỚC khi lượt hỏi đầu về ⇒ KHÔNG bị giá trị server cũ ghi đè; được đẩy lên", async () => {
    const { state, transport } = fakeServer({ showLabs: false });
    let mo!: () => void;
    const cho = new Promise<void>((r) => (mo = r));
    const get = transport.get;
    transport.get = async () => {
      await cho;
      return get();
    };
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 1 });
    const p = s.start();
    kho.setItem(LABS, "1"); // người dùng bật Labs trong lúc chờ
    s.markDirty(LABS);
    mo();
    await p;
    expect(kho.getItem(LABS)).toBe("1");
    expect(state.prefs.showLabs).toBe(true);
  });

  it("server không tới được ⇒ không ném, kho giữ nguyên; lần ghi sau thử lại lượt đầu và đẩy", async () => {
    const { state, transport } = fakeServer({ [B]: false });
    state.down = true;
    const kho = new MemStorage();
    kho.setItem(LABS, "1");
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null });
    await expect(s.start()).resolves.toBeUndefined();
    expect(s.synced).toBe(false);
    expect(kho.getItem(LABS)).toBe("1");
    state.down = false;
    kho.setItem(B, "1");
    s.markDirty(B);
    await s.flush();
    expect(s.synced).toBe(true);
    expect(state.prefs).toEqual({ [B]: true, showLabs: true }); // khoá vừa đổi thắng server; khoá chỉ-cục-bộ đẩy lên
    expect(kho.getItem(B)).toBe("1");
  });

  it("DB chưa áp 0365 (available:false) ⇒ không đụng kho, không đẩy", async () => {
    const transport: UiPrefsTransport = { get: vi.fn(async () => ({ prefs: {}, available: false })), set: vi.fn() };
    const kho = new MemStorage();
    kho.setItem(LABS, "1");
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null });
    await s.start();
    expect(transport.set).not.toHaveBeenCalled();
    expect(kho.getItem(LABS)).toBe("1");
  });
});

describe("uiPrefsSync — ghi sau lượt đầu", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("★ kéo separator bắn 30 lần ⇒ MỘT lượt gửi, giá trị CUỐI (debounce)", async () => {
    const { state, transport } = fakeServer();
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 800 });
    await s.start();
    for (let px = 240; px < 270; px++) {
      kho.setItem(H, JSON.stringify({ left: { px, pct: 18 } }));
      s.markDirty(H);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(state.sets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(state.sets).toEqual([{ [H]: { left: { px: 269, pct: 18 } } }]);
  });

  it("mất mạng lúc gửi ⇒ giữ khoá, gửi lại ở lần ghi sau; server TỪ CHỐI ⇒ bỏ (không lặp)", async () => {
    const { state, transport } = fakeServer();
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 10 });
    await s.start();
    state.down = true;
    kho.setItem(LABS, "1");
    s.markDirty(LABS);
    await vi.advanceTimersByTimeAsync(20);
    expect(state.sets).toHaveLength(0);
    state.down = false;
    kho.setItem(B, "0");
    s.markDirty(B);
    await vi.advanceTimersByTimeAsync(20);
    expect(state.sets).toEqual([{ showLabs: true, [B]: false }]);
    // Server từ chối (giả: khoá hợp lệ phía client nhưng server cũ không biết) ⇒ bỏ, không gửi lại.
    (transport.set as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw Object.assign(new Error("BAD_REQUEST"), { data: { code: "BAD_REQUEST" } });
    });
    kho.setItem(LABS, "0");
    s.markDirty(LABS);
    await vi.advanceTimersByTimeAsync(20);
    kho.setItem(B, "1");
    s.markDirty(B);
    await vi.advanceTimersByTimeAsync(20);
    expect(state.sets.at(-1)).toEqual({ [B]: true });
  });

  it("giá trị cục bộ hỏng (JSON sai / ngoài giới hạn) ⇒ không gửi; khoá người khác ⇒ bỏ qua", async () => {
    const { transport } = fakeServer();
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 10 });
    await s.start();
    kho.setItem(H, "{oops");
    s.markDirty(H);
    kho.setItem(B, "maybe");
    s.markDirty(B);
    kho.setItem(`layoutKit:ide:u${UID}:vpx`, JSON.stringify({ bottom: { px: 99999, pct: 20 } })); // JSON đúng, ngoài giới hạn
    s.markDirty(`layoutKit:ide:u${UID}:vpx`);
    s.markDirty(`layoutKit:ide:u8:hpx`);
    await vi.advanceTimersByTimeAsync(20);
    expect(transport.set).not.toHaveBeenCalled();
  });

  it("stop() ⇒ không gửi gì nữa", async () => {
    const { transport } = fakeServer();
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 10 });
    await s.start();
    kho.setItem(LABS, "1");
    s.markDirty(LABS);
    s.stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(transport.set).not.toHaveBeenCalled();
  });
});

describe("uiPrefsSync — bản dùng chung (startUiPrefsSync / markUiPrefDirty)", () => {
  it("khoá đổi TRƯỚC khi có người dùng (auth đang tải) được giao cho bản đồng bộ đầu tiên của đúng người đó", async () => {
    const { state, transport } = fakeServer({ showLabs: false });
    const g = globalThis as { localStorage?: unknown };
    const prev = g.localStorage;
    const kho = new MemStorage();
    g.localStorage = kho;
    try {
      kho.setItem(LABS, "1");
      markUiPrefDirty(LABS);
      const s = startUiPrefsSync(UID, transport, 1);
      await s.start();
      expect(kho.getItem(LABS)).toBe("1");
      expect(state.prefs.showLabs).toBe(true);
      s.stop();
      // Sau stop: không bản nào hoạt động ⇒ ghi chỉ xếp hàng, không gửi.
      markUiPrefDirty(LABS);
      expect(transport.set).toHaveBeenCalledTimes(1);
    } finally {
      g.localStorage = prev;
    }
  });
});
