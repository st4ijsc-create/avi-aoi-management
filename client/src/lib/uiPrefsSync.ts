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
 *   4. server không tới được / DB chưa áp 0365 ⇒ im lặng (không toast — gọi qua client tRPC trần, ngoài cache của
 *      react-query nên lưới toast toàn cục của main.tsx không thấy), ứng dụng chạy tiếp trên localStorage; khoá chưa đẩy
 *      được giữ lại cho lần ghi sau.
 *
 * Ánh xạ khoá: `showLabs` ⇄ `layoutKit:nav-labs:u<id>:show` ("1"/"0"); khoá bố cục giống hệt hai bên (giá trị: hpx/vpx là
 * JSON, bottomCollapsed "1"/"0"). Danh sách trắng + giới hạn: `shared/uiPrefs.ts` (cùng hàm server dùng để từ chối).
 * Module KHÔNG import React/tRPC — kiểm được bằng hai kho tách biệt + một server thật (`userUiPrefs.dot4.db.test.ts`).
 */
import {
  SHOW_LABS_LAYOUT_ID,
  SHOW_LABS_PART,
  UI_PREF_SHOW_LABS,
  isValidUiPrefValue,
  uiPrefKeyKind,
} from "@shared/uiPrefs";

/** Phát trên window sau khi giá trị server được ghi vào localStorage; detail = string[] khoá cục bộ đã đổi. */
export const UI_PREFS_APPLIED_EVENT = "ui-prefs-applied";

export interface UiPrefsTransport {
  get(): Promise<{ prefs: Record<string, unknown>; available?: boolean }>;
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
}

export interface UiPrefsSync {
  /** Lượt hỏi đầu + áp server + đẩy khoá chỉ-cục-bộ. Không bao giờ ném. */
  start(): Promise<void>;
  markDirty(localKey: string): void;
  /** Đẩy ngay các khoá đang chờ (không chờ debounce). Không bao giờ ném. */
  flush(): Promise<void>;
  stop(): void;
  readonly synced: boolean;
}

const showLabsLocalKey = (userId: number | string) => `layoutKit:${SHOW_LABS_LAYOUT_ID}:u${userId}:${SHOW_LABS_PART}`;

/** Khoá server của một khoá cục bộ của `userId`; null = không đồng bộ. */
export function serverKeyForLocal(localKey: string, userId: number | string): string | null {
  if (localKey === showLabsLocalKey(userId)) return UI_PREF_SHOW_LABS;
  const k = uiPrefKeyKind(localKey);
  return k && k.kind === "layout" && k.userId === String(userId) ? localKey : null;
}

export function localKeyForServer(serverKey: string, userId: number | string): string | null {
  if (serverKey === UI_PREF_SHOW_LABS) return showLabsLocalKey(userId);
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

export function createUiPrefsSync(opts: UiPrefsSyncOptions): UiPrefsSync {
  const { userId, transport, debounceMs = 800 } = opts;
  const storage: UiPrefsStorage | null = opts.storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  const events = opts.events === undefined ? (typeof window !== "undefined" ? window : null) : opts.events;
  const dirty = new Set<string>();
  let synced = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let starting: Promise<void> | null = null;

  const read = (k: string): string | null => {
    try {
      return storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };

  async function initialSync(): Promise<void> {
    let res: Awaited<ReturnType<UiPrefsTransport["get"]>>;
    try {
      res = await transport.get();
    } catch {
      return; // server không tới được ⇒ chạy trên localStorage; thử lại ở lần ghi sau
    }
    if (stopped) return;
    if (res.available === false) return; // DB chưa áp 0365
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
    if (changed.length && events) events.dispatchEvent(new CustomEvent(UI_PREFS_APPLIED_EVENT, { detail: changed }));
    if (dirty.size) await pushDirty();
  }

  async function pushDirty(): Promise<void> {
    if (stopped || dirty.size === 0) return;
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
      await transport.set(patch);
    } catch (e) {
      // Lỗi mạng ⇒ giữ để đẩy lần sau; server TỪ CHỐI (BAD_REQUEST) ⇒ bỏ (gửi lại vẫn bị từ chối — không lặp).
      const err = e as { data?: { code?: string }; code?: string } | null;
      const code = err?.data?.code ?? err?.code;
      if (code !== "BAD_REQUEST") for (const lk of keys) dirty.add(lk);
    }
  }

  const sync: UiPrefsSync = {
    get synced() {
      return synced;
    },
    start() {
      if (!starting) starting = initialSync();
      return starting;
    },
    markDirty(localKey: string) {
      if (stopped || !serverKeyForLocal(localKey, userId)) return;
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
      if (!synced) {
        // Lượt hỏi đầu chưa xong / đã hỏng (mất mạng) ⇒ thử lại lượt hỏi đầu (nó tự đẩy khoá đang chờ).
        if (starting) await starting;
        if (!synced && !stopped) {
          starting = initialSync();
          await starting;
        }
        return;
      }
      await pushDirty();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
  return sync;
}

// ── Bản dùng chung của ứng dụng (một người dùng đăng nhập tại một thời điểm) ────────────────────────────────────────
let active: UiPrefsSync | null = null;
/** Khoá đổi trước khi có bản đồng bộ (auth đang tải) — giao cho bản kế tiếp. */
const pendingBeforeStart = new Set<string>();

/** Bắt đầu đồng bộ cho `userId` (thay bản cũ). Trả bản đồng bộ; `stop()` khi người dùng đổi / đăng xuất. */
export function startUiPrefsSync(userId: number | string, transport: UiPrefsTransport, debounceMs?: number): UiPrefsSync {
  active?.stop();
  const s = createUiPrefsSync({ userId, transport, debounceMs });
  active = s;
  for (const k of pendingBeforeStart) s.markDirty(k);
  pendingBeforeStart.clear();
  void s.start();
  const stop = s.stop;
  s.stop = () => {
    stop();
    if (active === s) active = null;
  };
  return s;
}

/** Hook vừa ghi `localKey` vào localStorage ⇒ đẩy lên server (gom + debounce). Khoá không thuộc danh sách trắng ⇒ bỏ qua. */
export function markUiPrefDirty(localKey: string | null | undefined): void {
  if (!localKey) return;
  if (active) active.markDirty(localKey);
  else if (uiPrefKeyKind(localKey) || localKey.endsWith(`:${SHOW_LABS_PART}`)) pendingBeforeStart.add(localKey);
}
