/**
 * doc 81 Đợt 4 Task D1 — đồng bộ sở thích giao diện (localStorage ⇄ `user_settings.uiPrefs`, mig 0365).
 *
 * localStorage VẪN là bộ nhớ đệm tức thời: lượt vẽ đầu đọc nó (không chờ mạng), mọi hook ghi nó như trước. Module này:
 *   1. lúc biết người dùng (đăng nhập / tải trang): hỏi server MỘT lần; với mỗi khoá server CÓ ⇒ ghi đè localStorage
 *      (server THẮNG — máy mới nhận sở thích của tài khoản) rồi phát `UI_PREFS_APPLIED_EVENT` (detail = các khoá cục bộ
 *      đã đổi) để hook đang mở đọc lại; khoá CHỈ có ở máy này ⇒ đẩy lên MỘT lần;
 *   2. sau đó: hook ghi localStorage rồi gọi `markUiPrefDirty(khoá)` ⇒ gom, đẩy sau `debounceMs` (kéo separator bắn
 *      hàng chục lần/giây — chỉ giá trị cuối được gửi);
 *   3. khoá người dùng vừa đổi TRƯỚC khi lượt hỏi đầu về ⇒ KHÔNG bị giá trị server cũ ghi đè (được đẩy lên);
 *   4. server không tới được ⇒ im lặng (không toast — gọi qua client tRPC trần, ngoài cache của react-query nên lưới toast
 *      toàn cục của main.tsx không thấy), ứng dụng chạy tiếp trên localStorage; khoá chưa đẩy được giữ lại.
 *
 * Fix round 1 (review D minor 1–4, 6, 7):
 *   • #1 GẮN PHIÊN: server trả `userId` của PHIÊN (cookie) và nhận `expectedUserId`; khác người dùng mà bản này phục vụ (tab
 *     cũ sau khi tab khác đăng nhập người khác) ⇒ KHÔNG áp, KHÔNG đẩy, bản này tự khoá vĩnh viễn (`mismatch`);
 *   • #2 NỐI TIẾP: mỗi lượt đẩy chờ lượt trước xong (một lượt bay một lúc), đọc giá trị LÚC GỬI ⇒ giá trị mới nhất thắng,
 *     không lượt cũ nào tới sau đè lượt mới;
 *   • #3 `stop()` (đổi người dùng) và `flushUiPrefs()` (gọi TRƯỚC đăng xuất) đẩy nốt lượt đang chờ debounce — cố gắng,
 *     có hạn giờ;
 *   • #4 lượt hỏi đầu hỏng ⇒ thử lại theo `retryDelaysMs` (lùi dần, có hạn); server nói KHÔNG CÓ tính năng (DB chưa áp
 *     0365: `available:false` hoặc PRECONDITION_FAILED) ⇒ ngừng HẲN cho phiên này (không hỏi, không ghi — không 42703 lặp).
 *
 * Ánh xạ khoá: `showLabs` ⇄ `showLabsKey(id)` ("1"/"0", lib/showLabsKey.ts — MỘT định nghĩa với useShowLabs); khoá bố cục
 * giống hệt hai bên (giá trị: hpx/vpx là JSON, bottomCollapsed "1"/"0"). Danh sách trắng + giới hạn: `shared/uiPrefs.ts`
 * (cùng hàm server dùng để từ chối). Module không dùng React/tRPC — kiểm được bằng hai kho tách biệt + một server thật
 * (`userUiPrefsHaiTrinhDuyet.dot4.db.test.ts`).
 */
import { SHOW_LABS_PART, UI_PREF_SHOW_LABS, isValidUiPrefValue, uiPrefKeyKind } from "@shared/uiPrefs";
import { showLabsKey } from "./showLabsKey";

/** Phát trên window sau khi giá trị server được ghi vào localStorage; detail = string[] khoá cục bộ đã đổi. */
export const UI_PREFS_APPLIED_EVENT = "ui-prefs-applied";

export interface UiPrefsTransport {
  /** `userId` = người dùng của PHIÊN phía server (fix 1 #1). */
  get(): Promise<{ prefs: Record<string, unknown>; available?: boolean; userId?: number | string }>;
  set(patch: Record<string, unknown>): Promise<unknown>;
}

/** Phần của `Storage` mà module dùng (test truyền kho trong bộ nhớ). */
export type UiPrefsStorage = Pick<Storage, "getItem" | "setItem" | "key" | "length">;

export interface UiPrefsSyncOptions {
  userId: number | string;
  transport: UiPrefsTransport;
  storage?: UiPrefsStorage;
  debounceMs?: number;
  /** Nơi phát `UI_PREFS_APPLIED_EVENT` (mặc định window; test truyền EventTarget riêng). */
  events?: EventTarget | null;
  /** Lùi dần giữa các lần thử lại lượt hỏi đầu (fix 1 #4). Hết danh sách ⇒ chỉ thử lại khi người dùng ghi, cách nhau ≥ phần tử cuối. */
  retryDelaysMs?: number[];
  /** Hạn giờ của lượt đẩy nốt khi `stop()` (fix 1 #3). */
  stopFlushTimeoutMs?: number;
}

export interface UiPrefsSync {
  /** Lượt hỏi đầu + áp server + đẩy khoá chỉ-cục-bộ. Không bao giờ ném. */
  start(): Promise<void>;
  markDirty(localKey: string): void;
  /** Đẩy ngay các khoá đang chờ (không chờ debounce). Không bao giờ ném. */
  flush(): Promise<void>;
  /** Dừng; đẩy nốt khoá đang chờ (cố gắng, có hạn giờ). Không bao giờ ném. */
  stop(): Promise<void>;
  readonly synced: boolean;
  /** Đã ngừng hẳn cho phiên này: `"mismatch"` (phiên là người khác) | `"unavailable"` (DB chưa áp 0365) | null. */
  readonly halted: "mismatch" | "unavailable" | null;
}

export const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const DEFAULT_STOP_FLUSH_MS = 1_500;

/** Khoá server của một khoá cục bộ của `userId`; null = không đồng bộ. */
export function serverKeyForLocal(localKey: string, userId: number | string): string | null {
  if (localKey === showLabsKey(userId)) return UI_PREF_SHOW_LABS;
  const k = uiPrefKeyKind(localKey);
  return k && k.kind === "layout" && k.userId === String(userId) ? localKey : null;
}

export function localKeyForServer(serverKey: string, userId: number | string): string | null {
  if (serverKey === UI_PREF_SHOW_LABS) return showLabsKey(userId);
  const k = uiPrefKeyKind(serverKey);
  return k && k.kind === "layout" && k.userId === String(userId) ? serverKey : null;
}

const isBoolKey = (serverKey: string) => {
  const k = uiPrefKeyKind(serverKey);
  return k != null && (k.kind === "showLabs" || k.part === "bottomCollapsed");
};

function encodeLocal(serverKey: string, value: unknown): string {
  return isBoolKey(serverKey) ? (value ? "1" : "0") : JSON.stringify(value);
}

/** Giá trị server của chuỗi cục bộ; undefined = không có / không hợp lệ (không gửi). */
function decodeLocal(serverKey: string, raw: string | null): unknown {
  if (raw == null) return undefined;
  let v: unknown;
  if (isBoolKey(serverKey)) {
    if (raw !== "1" && raw !== "0") return undefined;
    v = raw === "1";
  } else {
    try {
      v = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return isValidUiPrefValue(serverKey, v) ? v : undefined;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameUser = (a: unknown, b: number | string) => a == null || String(a) === String(b);
const errCode = (e: unknown) => {
  const err = e as { data?: { code?: string }; code?: string } | null;
  return err?.data?.code ?? err?.code;
};
/** Chờ `p` tối đa `ms`; không bao giờ ném. */
const withTimeout = (p: Promise<unknown>, ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    p.then(
      () => (clearTimeout(t), resolve()),
      () => (clearTimeout(t), resolve()),
    );
  });

export function createUiPrefsSync(opts: UiPrefsSyncOptions): UiPrefsSync {
  const { userId, transport, debounceMs = 800 } = opts;
  const retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const stopFlushMs = opts.stopFlushTimeoutMs ?? DEFAULT_STOP_FLUSH_MS;
  const storage: UiPrefsStorage | null = opts.storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  const events = opts.events === undefined ? (typeof window !== "undefined" ? window : null) : opts.events;
  const dirty = new Set<string>();
  let synced = false;
  let stopped = false;
  let halted: UiPrefsSync["halted"] = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryIdx = 0;
  let nextAttemptAt = 0;
  let starting: Promise<void> | null = null;
  /** Chuỗi lượt đẩy — một lượt bay một lúc (fix 1 #2). */
  let chain: Promise<void> = Promise.resolve();

  const read = (k: string): string | null => {
    try {
      return storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  const halt = (why: "mismatch" | "unavailable") => {
    halted = why;
    dirty.clear();
    if (timer) clearTimeout(timer);
    if (retryTimer) clearTimeout(retryTimer);
    timer = retryTimer = null;
  };

  function scheduleRetry(): void {
    if (stopped || halted) return;
    const last = retryDelays[retryDelays.length - 1] ?? 0;
    if (retryIdx >= retryDelays.length) {
      nextAttemptAt = Date.now() + last; // hết lượt tự thử: chỉ thử lại khi người dùng ghi, cách ≥ `last`
      return;
    }
    const delay = retryDelays[retryIdx++];
    nextAttemptAt = Date.now() + delay;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      starting = initialSync();
    }, delay);
  }

  async function initialSync(): Promise<void> {
    if (stopped || halted) return;
    let res: Awaited<ReturnType<UiPrefsTransport["get"]>>;
    try {
      res = await transport.get();
    } catch {
      scheduleRetry(); // server không tới được ⇒ chạy trên localStorage; thử lại có lùi dần
      return;
    }
    if (stopped || halted) return;
    if (res.available === false) return halt("unavailable"); // DB chưa áp 0365 — ngừng hẳn cho phiên này
    if (!sameUser(res.userId, userId)) return halt("mismatch"); // phiên là NGƯỜI KHÁC — không áp, không đẩy
    const server = res.prefs ?? {};
    const changed: string[] = [];
    for (const [sk, v] of Object.entries(server)) {
      const lk = localKeyForServer(sk, userId);
      if (!lk || !isValidUiPrefValue(sk, v) || dirty.has(lk)) continue; // khoá vừa đổi ở máy này thắng
      if (sameValue(decodeLocal(sk, read(lk)), v)) continue;
      try {
        storage?.setItem(lk, encodeLocal(sk, v));
        changed.push(lk);
      } catch {
        /* kho bị chặn */
      }
    }
    // Khoá chỉ có ở máy này ⇒ đẩy lên một lần.
    const n = storage?.length ?? 0;
    for (let i = 0; i < n; i++) {
      const lk = storage?.key(i);
      if (!lk) continue;
      const sk = serverKeyForLocal(lk, userId);
      if (sk && !(sk in server) && decodeLocal(sk, read(lk)) !== undefined) dirty.add(lk);
    }
    synced = true;
    retryIdx = 0;
    if (changed.length && events) events.dispatchEvent(new CustomEvent(UI_PREFS_APPLIED_EVENT, { detail: changed }));
    if (dirty.size) await pushDirty();
  }

  /** Một lượt gửi: đọc khoá đang chờ LÚC GỬI (giá trị mới nhất). */
  async function doPush(): Promise<void> {
    if (halted || dirty.size === 0) return;
    const keys = [...dirty];
    dirty.clear();
    const patch: Record<string, unknown> = {};
    for (const lk of keys) {
      const sk = serverKeyForLocal(lk, userId);
      if (!sk) continue;
      const v = decodeLocal(sk, read(lk));
      if (v !== undefined) patch[sk] = v;
    }
    if (Object.keys(patch).length === 0) return;
    try {
      const r = (await transport.set(patch)) as { userId?: number | string } | null | undefined;
      if (!sameUser(r?.userId, userId)) halt("mismatch");
    } catch (e) {
      const code = errCode(e);
      if (code === "CONFLICT") return halt("mismatch"); // server: phiên là người khác (expectedUserId)
      if (code === "PRECONDITION_FAILED") return halt("unavailable"); // DB chưa áp 0365
      // Lỗi mạng ⇒ giữ để đẩy lần sau; server TỪ CHỐI (BAD_REQUEST) ⇒ bỏ (gửi lại vẫn bị từ chối — không lặp).
      if (code !== "BAD_REQUEST") for (const lk of keys) dirty.add(lk);
    }
  }

  function pushDirty(): Promise<void> {
    chain = chain.then(doPush, doPush);
    return chain;
  }

  const sync: UiPrefsSync = {
    get synced() {
      return synced;
    },
    get halted() {
      return halted;
    },
    start() {
      if (!starting) starting = initialSync();
      return starting;
    },
    markDirty(localKey: string) {
      if (stopped || halted || !serverKeyForLocal(localKey, userId)) return;
      dirty.add(localKey);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void sync.flush();
      }, debounceMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (halted) return;
      if (!synced) {
        if (starting) await starting;
        if (synced) return; // lượt hỏi đầu vừa xong đã tự đẩy khoá đang chờ
        // Lượt hỏi đầu hỏng: KHÔNG hỏi dồn — lượt thử lại có lịch thì để nó làm; hết lịch thì cách ≥ phần tử cuối.
        if (stopped || retryTimer || Date.now() < nextAttemptAt) return;
        starting = initialSync();
        await starting;
        return;
      }
      await pushDirty();
    },
    async stop() {
      if (stopped) return;
      const pending = timer != null || dirty.size > 0;
      stopped = true;
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      timer = retryTimer = null;
      if (pending && synced && !halted) await withTimeout(pushDirty(), stopFlushMs);
    },
  };
  return sync;
}

// ── Bản dùng chung của ứng dụng (một người dùng đăng nhập tại một thời điểm) ────────────────────────────────────────
let active: UiPrefsSync | null = null;
/** Khoá đổi trước khi có bản đồng bộ (auth đang tải) — giao cho bản kế tiếp. */
const pendingBeforeStart = new Set<string>();

/** Bắt đầu đồng bộ cho `userId` (thay bản cũ — bản cũ đẩy nốt khoá đang chờ). `stop()` khi người dùng đổi / đăng xuất. */
export function startUiPrefsSync(userId: number | string, transport: UiPrefsTransport, debounceMs?: number): UiPrefsSync {
  void active?.stop();
  const s = createUiPrefsSync({ userId, transport, debounceMs });
  active = s;
  for (const k of pendingBeforeStart) s.markDirty(k);
  pendingBeforeStart.clear();
  void s.start();
  const stop = s.stop;
  s.stop = () => {
    if (active === s) active = null;
    return stop();
  };
  return s;
}

/** Hook vừa ghi `localKey` vào localStorage ⇒ đẩy lên server (gom + debounce). Khoá không thuộc danh sách trắng ⇒ bỏ qua. */
export function markUiPrefDirty(localKey: string | null | undefined): void {
  if (!localKey) return;
  if (active) active.markDirty(localKey);
  // final wave G1 — the Labs key suffix comes from the ONE definition (shared/uiPrefs SHOW_LABS_PART), not a literal.
  else if (uiPrefKeyKind(localKey) || localKey.endsWith(`:${SHOW_LABS_PART}`)) pendingBeforeStart.add(localKey);
}

/**
 * fix 1 #3 — đẩy NGAY khoá đang chờ debounce của bản đang chạy (gọi TRƯỚC đăng xuất: sau đó phiên đã mất, lượt đẩy sẽ bị
 * từ chối). Chờ tối đa `timeoutMs`; không bao giờ ném.
 */
export function flushUiPrefs(timeoutMs = DEFAULT_STOP_FLUSH_MS): Promise<void> {
  return active ? withTimeout(active.flush(), timeoutMs) : Promise.resolve();
}

/** Chỉ cho test: dừng bản đang chạy và xoá hàng đợi khoá-trước-khi-có-người-dùng (fix 1 #6 — không rò giữa các test). */
export function __resetUiPrefsSyncForTests(): void {
  const a = active;
  active = null;
  if (a) void a.stop();
  pendingBeforeStart.clear();
}
