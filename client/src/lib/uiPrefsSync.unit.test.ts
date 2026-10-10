/**
 * doc 81 Đợt 4 Task D1 — logic đồng bộ localStorage ⇄ server (không React, không mạng). Server giả = một object trong bộ
 * nhớ dùng CHÍNH `checkUiPrefsPatch` của server để từ chối (oracle độc lập: phép gộp là `Object.assign`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  __resetUiPrefsSyncForTests,
  createUiPrefsSync,
  flushUiPrefs,
  localKeyForServer,
  markUiPrefDirty,
  serverKeyForLocal,
  startUiPrefsSync,
  UI_PREFS_APPLIED_EVENT,
  type UiPrefsTransport,
} from "./uiPrefsSync";
import { checkUiPrefsPatch } from "@shared/uiPrefs";
import { showLabsKey } from "./showLabsKey";
import { userLayoutKey } from "@/components/patterns/layoutKitHooks";

afterEach(() => __resetUiPrefsSyncForTests()); // fix 1 #6 — không rò khoá chờ / bản đang chạy giữa các test

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
  const state = { prefs: { ...initial } as Record<string, unknown>, sets: [] as Array<Record<string, unknown>>, down: false, sessionUser: UID as number };
  const transport: UiPrefsTransport = {
    get: vi.fn(async () => {
      if (state.down) throw new TypeError("Failed to fetch");
      return { prefs: { ...state.prefs }, available: true, userId: state.sessionUser };
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      if (state.down) throw new TypeError("Failed to fetch");
      const c = checkUiPrefsPatch(patch, UID);
      if (!c.ok) throw Object.assign(new Error("BAD_REQUEST"), { data: { code: "BAD_REQUEST" } });
      state.sets.push(patch);
      Object.assign(state.prefs, c.value);
      return { prefs: state.prefs, userId: state.sessionUser };
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

  it("server không tới được ⇒ không ném, kho giữ nguyên; lượt THỬ LẠI có lịch (fix 1 #4) áp server và đẩy khoá đang chờ", async () => {
    vi.useFakeTimers();
    try {
      const { state, transport } = fakeServer({ [B]: false });
      state.down = true;
      const kho = new MemStorage();
      kho.setItem(LABS, "1");
      const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, retryDelaysMs: [100, 200] });
      await expect(s.start()).resolves.toBeUndefined();
      expect(s.synced).toBe(false);
      expect(kho.getItem(LABS)).toBe("1");
      kho.setItem(B, "1");
      s.markDirty(B);
      await s.flush(); // đang có lịch thử lại ⇒ KHÔNG hỏi dồn
      expect(transport.get).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100); // thử lại lần 1 — vẫn hỏng
      expect(transport.get).toHaveBeenCalledTimes(2);
      state.down = false;
      await vi.advanceTimersByTimeAsync(200); // thử lại lần 2 — được, KHÔNG cần người dùng ghi gì
      expect(transport.get).toHaveBeenCalledTimes(3);
      expect(s.synced).toBe(true);
      expect(state.prefs).toEqual({ [B]: true, showLabs: true }); // khoá vừa đổi thắng server; khoá chỉ-cục-bộ đẩy lên
      expect(kho.getItem(B)).toBe("1");
    } finally {
      vi.useRealTimers();
    }
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

  it("stop() ⇒ đẩy nốt lượt đang chờ MỘT lần (fix 1 #3), sau đó không gửi gì nữa", async () => {
    const { state, transport } = fakeServer();
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 10 });
    await s.start();
    kho.setItem(LABS, "1");
    s.markDirty(LABS);
    await s.stop();
    expect(state.sets).toEqual([{ showLabs: true }]);
    kho.setItem(B, "1");
    s.markDirty(B);
    await vi.advanceTimersByTimeAsync(50);
    expect(transport.set).toHaveBeenCalledTimes(1);
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

// fix 1 #6 — HAI ca liền nhau, CỐ Ý phụ thuộc thứ tự: ca 1 để lại một khoá trong hàng đợi khoá-trước-khi-có-người-dùng;
// ca 2 chứng minh `__resetUiPrefsSyncForTests()` (afterEach) đã xoá nó — nếu rò, khoá Labs "1" cũ thắng server và bị đẩy.
describe("uiPrefsSync — cô lập giữa các test (fix 1 #6)", () => {
  it("ca 1: ghi khi chưa có bản đồng bộ ⇒ khoá nằm trong hàng đợi", () => {
    markUiPrefDirty(LABS);
  });
  it("ca 2: bản đồng bộ mới KHÔNG nhận khoá rò từ ca trước", async () => {
    const { state, transport } = fakeServer({ showLabs: false });
    const g = globalThis as { localStorage?: unknown };
    const prev = g.localStorage;
    const kho = new MemStorage();
    kho.setItem(LABS, "1");
    g.localStorage = kho;
    try {
      const s = startUiPrefsSync(UID, transport, 1);
      await s.start();
      expect(kho.getItem(LABS)).toBe("0"); // server thắng — không có khoá "vừa đổi" nào
      expect(state.sets).toEqual([]);
    } finally {
      g.localStorage = prev;
    }
  });
});

describe("uiPrefsSync — fix round 1", () => {
  it("#7 khoá Labs của bộ đồng bộ = showLabsKey() = userLayoutKey(nav-labs, id, show) — MỘT định nghĩa", () => {
    for (const u of [1, 7, 123456, "42"]) {
      expect(localKeyForServer("showLabs", u)).toBe(showLabsKey(u));
      expect(showLabsKey(u)).toBe(userLayoutKey("nav-labs", u, "show"));
      expect(serverKeyForLocal(showLabsKey(u)!, u)).toBe("showLabs");
    }
  });

  it("★ #1 phiên là NGƯỜI KHÁC (get trả userId khác) ⇒ không áp, không đẩy, kể cả các lần ghi sau", async () => {
    const { state, transport } = fakeServer({ showLabs: true });
    state.sessionUser = 8; // tab cũ tưởng là 7, cookie là 8
    const kho = new MemStorage();
    kho.setItem(LABS, "0");
    kho.setItem(H, JSON.stringify({ left: { px: 250, pct: 18 } })); // chỉ máy này có — KHÔNG được đẩy vào hàng của 8
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 1 });
    await s.start();
    expect(kho.getItem(LABS)).toBe("0");
    kho.setItem(LABS, "1");
    s.markDirty(LABS);
    await s.flush();
    expect(transport.set).not.toHaveBeenCalled();
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(s.halted).toBe("mismatch");
  });

  it("★ #1 server từ chối CONFLICT (phiên đổi người SAU lượt đầu) ⇒ ngừng, không gửi lại", async () => {
    const { transport } = fakeServer();
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 1 });
    await s.start();
    (transport.set as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw Object.assign(new Error("CONFLICT"), { data: { code: "CONFLICT" } });
    });
    kho.setItem(LABS, "1");
    s.markDirty(LABS);
    await s.flush();
    kho.setItem(B, "1");
    s.markDirty(B);
    await s.flush();
    expect(transport.set).toHaveBeenCalledTimes(1);
    expect(s.halted).toBe("mismatch");
  });

  it("★ #2 lượt đẩy NỐI TIẾP: không bao giờ hai lượt bay cùng lúc; giá trị CUỐI thắng ở server", async () => {
    const { state, transport } = fakeServer();
    let dangBay = 0;
    let toiDa = 0;
    let luot = 0;
    const set = transport.set;
    transport.set = async (p) => {
      dangBay++;
      toiDa = Math.max(toiDa, dangBay);
      // lượt ĐẦU chậm hơn lượt sau: không nối tiếp thì lượt cũ tới sau và đè giá trị mới
      await new Promise((r) => setTimeout(r, luot++ === 0 ? 40 : 5));
      try {
        return await set(p);
      } finally {
        dangBay--;
      }
    };
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 1 });
    await s.start();
    const ps: Promise<void>[] = [];
    for (const px of [241, 252, 263]) {
      kho.setItem(H, JSON.stringify({ left: { px, pct: 18 } }));
      s.markDirty(H);
      ps.push(s.flush());
      await new Promise((r) => setTimeout(r, 2));
    }
    await Promise.all(ps);
    expect(toiDa).toBe(1);
    expect(state.prefs[H]).toEqual({ left: { px: 263, pct: 18 } });
  });

  it("★ #3 stop() đẩy NỐT lượt đang chờ debounce (thay vì bỏ); flushUiPrefs() đẩy bản đang chạy", async () => {
    const { state, transport } = fakeServer();
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 60_000 });
    await s.start();
    kho.setItem(LABS, "1");
    s.markDirty(LABS);
    await s.stop();
    expect(state.prefs.showLabs).toBe(true);

    const g = globalThis as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = kho;
    try {
      const a = startUiPrefsSync(UID, transport, 60_000);
      await a.start();
      kho.setItem(B, "1");
      markUiPrefDirty(B);
      await flushUiPrefs();
      expect(state.prefs[B]).toBe(true);
    } finally {
      g.localStorage = prev;
    }
  });

  it("#3 stop() có HẠN GIỜ: server treo ⇒ stop vẫn trả về sau stopFlushTimeoutMs", async () => {
    const { transport } = fakeServer();
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 60_000, stopFlushTimeoutMs: 30 });
    await s.start();
    transport.set = () => new Promise(() => {}); // treo mãi
    kho.setItem(LABS, "1");
    s.markDirty(LABS);
    const t0 = Date.now();
    await s.stop();
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("★ #4 DB chưa áp 0365 (available:false) ⇒ ngừng HẲN: các lần ghi sau không hỏi lại, không gửi", async () => {
    const transport: UiPrefsTransport = { get: vi.fn(async () => ({ prefs: {}, available: false, userId: UID })), set: vi.fn() };
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 1, retryDelaysMs: [] });
    await s.start();
    for (let i = 0; i < 5; i++) {
      kho.setItem(LABS, i % 2 ? "1" : "0");
      s.markDirty(LABS);
      await s.flush();
    }
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(transport.set).not.toHaveBeenCalled();
    expect(s.halted).toBe("unavailable");
  });

  it("★ #4 ghi bị PRECONDITION_FAILED (DB mất cột giữa chừng) ⇒ ngừng HẲN", async () => {
    const { transport } = fakeServer();
    const kho = new MemStorage();
    const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 1 });
    await s.start();
    transport.set = vi.fn(async () => {
      throw Object.assign(new Error("PRECONDITION_FAILED"), { data: { code: "PRECONDITION_FAILED" } });
    });
    for (let i = 0; i < 3; i++) {
      kho.setItem(LABS, i % 2 ? "1" : "0");
      s.markDirty(LABS);
      await s.flush();
    }
    expect(transport.set).toHaveBeenCalledTimes(1);
    expect(s.halted).toBe("unavailable");
  });

  it("#4 hết lịch thử lại ⇒ lần ghi chỉ kích MỘT lượt hỏi mỗi khoảng ≥ phần tử cuối (không hỏi dồn)", async () => {
    vi.useFakeTimers();
    try {
      const { state, transport } = fakeServer();
      state.down = true;
      const kho = new MemStorage();
      const s = createUiPrefsSync({ userId: UID, transport, storage: kho, events: null, debounceMs: 1, retryDelaysMs: [50] });
      await s.start();
      await vi.advanceTimersByTimeAsync(50); // thử lại duy nhất — hỏng ⇒ hết lịch, cửa sổ 50 ms
      expect(transport.get).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 5; i++) {
        kho.setItem(LABS, "1");
        s.markDirty(LABS);
        await vi.advanceTimersByTimeAsync(2);
      }
      expect(transport.get).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60);
      kho.setItem(LABS, "0");
      s.markDirty(LABS);
      await vi.advanceTimersByTimeAsync(2);
      expect(transport.get).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
