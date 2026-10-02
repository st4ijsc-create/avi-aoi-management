/**
 * Doc 81 Đợt 2 Task 3 — <FlyoutHost> + useFlyout(): MỘT stack sheet bên phải cho mỗi trang.
 *
 * Thay các Dialog tạo/sửa/duyệt giữa màn (32 Dialog trong 14 màn Engineering) bằng sheet phải
 * trên `ui/sheet` (Radix Dialog): bẫy focus, Esc đóng TỪNG lớp (chỉ lớp trên cùng nhận Esc), trả
 * focus về phần tử đã mở khi lớp đóng (lớp dựng từ F5: về lớp dưới, hoặc h1/`<main>` của trang).
 *
 * ── URL LÀ NGUỒN SỰ THẬT (Review Focus 4) ─────────────────────────────────────────────────────
 *   `?flyout=detail&flyoutId=42&flyout=edit&flyoutId=42` — mỗi lớp một cặp, theo thứ tự đáy→đỉnh.
 *   Các tham số khác (`?tab=`, `?filter=pending`…) được GIỮ NGUYÊN. F5 dựng lại đủ stack.
 *
 * ── SỔ SÁCH LỊCH SỬ THEO DẤU (Ruling R-2-h, fix round 2) ──────────────────────────────────────
 *   Mỗi mục lịch sử DO HOST TẠO (pushState) mang dấu trong `history.state`:
 *     `{ flyoutHost: <id của host>, depth, stackSig, chain }`
 *   - `stackSig` = `<path>?<flyout params>` của chính mục đó; `chain[j]` = stackSig của mục ở độ sâu
 *     j bên dưới (chain[0] = mục GỐC — mục của trang hoặc mục F5, KHÔNG mang dấu); `depth = chain.length`.
 *   - Mọi thao tác (close, closeAll, open trên stack, Back khi còn dữ liệu, gỡ đăng ký) tính đích
 *     bằng `goTo(T)` CHỈ từ dấu của mục HIỆN TẠI và stack đích T: lùi qua các mục mang dấu cho tới
 *     mục đầu tiên có stack là TIỀN TỐ của T (không bao giờ lùi qua mục khác path), rồi: bằng T ⇒
 *     xong; là tiền tố và thao tác mở ⇒ push phần còn lại; còn lại ⇒ replace (giữ dấu nếu mục có dấu).
 *     Mục KHÔNG có dấu (của trang, hoặc F5) không bao giờ bị lùi qua — chỉ bị replace.
 *   - Không còn bộ đếm hay cờ `viaPush` theo lớp.
 *   - Mọi kỳ vọng do host đặt (đích sẽ tới, việc làm sau khi lùi, focus trả về) được TIÊU THỤ ở lần
 *     đổi location kế tiếp, hoặc tự xoá sau `EXPECT_TTL_MS` — không ref nào kẹt được. Chỉ coi một
 *     lần đổi location là "của host" khi stackSig tới KHỚP đích đã đặt.
 *
 * ── DỮ LIỆU CHƯA LƯU ────────────────────────────────────────────────────────────────────────
 *   `useFlyoutLayer().setDirty(true)`. Gỡ một lớp dirty — close(), Esc, open() lớp khác, Back của
 *   trình duyệt, hay định nghĩa của lớp bị GỠ ĐĂNG KÝ — đều hỏi "Bỏ thay đổi chưa lưu?". Back: host
 *   giữ instance của form, PUSH lại đúng URL vừa rời (mục mới mang dấu nối tiếp mục vừa tới), rồi hỏi;
 *   Bỏ ⇒ lùi đúng mục đó. Gỡ đăng ký: URL không đổi, không push gì; Giữ ⇒ lớp vẫn dựng bằng định
 *   nghĩa đã lưu; Bỏ ⇒ goTo(tiền tố còn đăng ký). Rời HẲN trang (đổi route) thì không chặn được ở đây.
 *
 * ── DEEP LINK TỚI KHOÁ CHƯA ĐĂNG KÝ ──────────────────────────────────────────────────────────
 *   Chỉ URL LÚC NẠP TRANG được ân hạn `unknownKeyGraceMs` (định nghĩa đến muộn vì quyền/dữ liệu):
 *   khoá được giữ trong URL và mở ngay khi đăng ký. Ân hạn bị HUỶ bởi bất kỳ lần đổi location nào
 *   hay open()/push(). Hết/huỷ ân hạn ⇒ dọn mọi lớp TỪ khoá lạ đầu tiên trở lên (không để lớp con mồ
 *   côi cha).
 *
 * Lớp là phần tử `[data-flyout-key]` (role=dialog, data-slot=sheet-content) — thiết bị đo Task 1
 * chấm "dialog → sheet" bằng `kinds`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { UnsavedChangesConfirm } from "./UnsavedChangesConfirm";

export const FLYOUT_PARAM = "flyout" as const;
export const FLYOUT_ID_PARAM = "flyoutId" as const;

export interface FlyoutEntry {
  key: string;
  id: string | null;
}

export interface FlyoutLayerApi {
  key: string;
  id: string | null;
  /** 0 = lớp đáy. */
  depth: number;
  /** Đóng lớp trên cùng (hỏi nếu còn dữ liệu chưa lưu). */
  close: () => void;
  /** Báo form của lớp này còn/hết dữ liệu chưa lưu. */
  setDirty: (dirty: boolean) => void;
}

export interface FlyoutDefinition {
  title: ReactNode | ((id: string | null) => ReactNode);
  description?: ReactNode | ((id: string | null) => ReactNode);
  render: (ctx: FlyoutLayerApi) => ReactNode;
  /** sm 420 · md 560 (mặc định) · lg 720 px. */
  size?: "sm" | "md" | "lg";
}

export interface FlyoutOpenOptions {
  id?: string | number | null;
}

export interface FlyoutApi {
  stack: readonly FlyoutEntry[];
  open: (key: string, opts?: FlyoutOpenOptions) => void;
  push: (key: string, opts?: FlyoutOpenOptions) => void;
  close: () => void;
  closeAll: () => void;
  isOpen: (key: string) => boolean;
}

/** Đọc stack từ chuỗi search (có hoặc không có "?"). */
export function parseFlyoutStack(search: string): FlyoutEntry[] {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const keys = p.getAll(FLYOUT_PARAM);
  const ids = p.getAll(FLYOUT_ID_PARAM);
  return keys
    .map((key, i) => ({ key, id: ids[i] ? ids[i] : null }))
    .filter((e) => e.key !== "");
}

/** Dựng lại chuỗi search: giữ mọi tham số khác, thay toàn bộ cặp flyout/flyoutId. */
export function buildFlyoutSearch(search: string, stack: readonly FlyoutEntry[]): string {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  p.delete(FLYOUT_PARAM);
  p.delete(FLYOUT_ID_PARAM);
  for (const e of stack) {
    p.append(FLYOUT_PARAM, e.key);
    p.append(FLYOUT_ID_PARAM, e.id ?? "");
  }
  return p.toString();
}

function normId(id: FlyoutOpenOptions["id"]): string | null {
  if (id === undefined || id === null || id === "") return null;
  return String(id);
}

const sameEntry = (a: FlyoutEntry, b: FlyoutEntry) => a.key === b.key && a.id === b.id;

function commonPrefix(a: readonly FlyoutEntry[], b: readonly FlyoutEntry[]): number {
  let i = 0;
  while (i < a.length && i < b.length && sameEntry(a[i], b[i])) i++;
  return i;
}

function sameStack(a: readonly FlyoutEntry[], b: readonly FlyoutEntry[]): boolean {
  return a.length === b.length && commonPrefix(a, b) === a.length;
}
function isPrefixStack(a: readonly FlyoutEntry[], b: readonly FlyoutEntry[]): boolean {
  return a.length <= b.length && commonPrefix(a, b) === a.length;
}

/** Chữ ký một mục lịch sử: path + chỉ các cặp flyout (tham số khác không tính). */
export function flyoutStackSig(path: string, stack: readonly FlyoutEntry[]): string {
  return `${path}?${buildFlyoutSearch("", stack)}`;
}
function parseSig(sig: string): { path: string; stack: FlyoutEntry[] } {
  const i = sig.indexOf("?");
  return i < 0 ? { path: sig, stack: [] } : { path: sig.slice(0, i), stack: parseFlyoutStack(sig.slice(i + 1)) };
}

/** Dấu trong `history.state` của mục do host tạo. */
export interface FlyoutHistoryMarker {
  flyoutHost: string;
  depth: number;
  stackSig: string;
  chain: string[];
}

function readMarker(hostId: string): FlyoutHistoryMarker | null {
  if (typeof window === "undefined") return null;
  const st = window.history.state as Partial<FlyoutHistoryMarker> | null;
  if (!st || typeof st !== "object" || st.flyoutHost !== hostId) return null;
  if (!Array.isArray(st.chain) || st.chain.length !== st.depth || typeof st.stackSig !== "string") return null;
  return st as FlyoutHistoryMarker;
}

/** Kỳ vọng sống tối đa bao lâu nếu location không đổi như dự tính (ms). */
export const EXPECT_TTL_MS = 1500;

interface LayerState extends FlyoutEntry {
  uid: number;
  /** Phần tử đang có focus lúc mở lớp — nhận lại focus khi lớp đóng. */
  returnFocus: HTMLElement | null;
  /** Định nghĩa đã dùng khi dựng lớp (để "Giữ" một lớp dirty khi khoá bị gỡ đăng ký). */
  def: FlyoutDefinition | null;
  /** Người dùng chọn GIỮ lớp này dù khoá đã bị gỡ đăng ký. */
  kept: boolean;
}

interface Expectation {
  /** stackSig mà lần đổi location kế tiếp phải tới thì mới coi là của host. */
  sig: string;
  /** Chạy sau khi tới đúng đích (vd bước "land" sau khi lùi lịch sử). */
  after?: () => void;
  /** Focus trả về cho lớp MỚI xuất hiện ở lần đổi này. */
  returnFocus?: HTMLElement | null;
  timer: number;
}

type Pending =
  | { kind: "close" }
  | { kind: "closeAll" }
  | { kind: "open"; next: FlyoutEntry[] }
  | { kind: "external"; targetSig: string }
  | { kind: "unregister"; target: FlyoutEntry[] };

const FlyoutContext = createContext<FlyoutApi | null>(null);
const FlyoutLayerContext = createContext<FlyoutLayerApi | null>(null);

export function useFlyout(): FlyoutApi {
  const ctx = useContext(FlyoutContext);
  if (!ctx) throw new Error("useFlyout() must be used inside <FlyoutHost>");
  return ctx;
}

export function useFlyoutLayer(): FlyoutLayerApi {
  const ctx = useContext(FlyoutLayerContext);
  if (!ctx) throw new Error("useFlyoutLayer() must be used inside a FlyoutHost layer");
  return ctx;
}

const SIZE_CLASS: Record<NonNullable<FlyoutDefinition["size"]>, string> = {
  sm: "sm:max-w-[420px]",
  md: "sm:max-w-[560px]",
  lg: "sm:max-w-[720px]",
};

export interface FlyoutHostProps {
  flyouts: Record<string, FlyoutDefinition>;
  children: ReactNode;
  /** Ân hạn cho khoá chưa đăng ký trong URL LÚC NẠP TRANG (ms). Mặc định 5000. */
  unknownKeyGraceMs?: number;
}

/** Lớp F5 không có phần tử mở: trả focus về lớp dưới, hoặc h1 / <main> của trang. */
function fallbackFocus(depth: number): void {
  if (typeof document === "undefined") return;
  const below = depth > 0 ? document.querySelector<HTMLElement>(`[data-flyout-depth="${depth - 1}"]`) : null;
  const target = below ?? document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("h1") ?? document.querySelector<HTMLElement>("main");
  if (!target) return;
  if (!target.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute("tabindex", "-1");
  target.focus();
}

let hostSeq = 0;

export function FlyoutHost({ flyouts, children, unknownKeyGraceMs = 5000 }: FlyoutHostProps) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [hostId] = useState(() => `fh${++hostSeq}-${Math.random().toString(36).slice(2, 8)}`);

  const flyoutsRef = useRef(flyouts);
  flyoutsRef.current = flyouts;
  const knownSig = Object.keys(flyouts).sort().join("|");
  const registered = (key: string) => Object.prototype.hasOwnProperty.call(flyoutsRef.current, key);

  const uidRef = useRef(0);
  /** Tiền tố dựng được của stack trong URL: dừng ở khoá lạ đầu tiên (trừ lớp người dùng đã "Giữ"). */
  const knownPrefixOf = (raw: FlyoutEntry[], S: readonly LayerState[]): FlyoutEntry[] => {
    const i = raw.findIndex((e, idx) => !registered(e.key) && !(S[idx]?.kept && sameEntry(S[idx], e)));
    return i < 0 ? raw : raw.slice(0, i);
  };

  const [layers, setLayers] = useState<LayerState[]>(() =>
    knownPrefixOf(parseFlyoutStack(search), []).map((e) => ({
      ...e,
      uid: ++uidRef.current,
      returnFocus: null,
      def: flyouts[e.key] ?? null,
      kept: false,
    })),
  );
  /**
   * Radix gắn `aria-hidden` cho mọi thứ ngoài dialog VỪA mount. Khi F5 dựng nhiều lớp CÙNG LÚC,
   * lớp đáy mount sau cùng một lượt sẽ giấu luôn lớp trên. Mount từng lớp một (mỗi lượt commit
   * thêm một lớp) — giống hệt thứ tự khi người dùng push tay.
   */
  const [mountedDepth, setMountedDepth] = useState(() => Math.min(layers.length, 1));
  useEffect(() => {
    if (mountedDepth < layers.length) setMountedDepth(mountedDepth + 1);
    else if (mountedDepth > layers.length) setMountedDepth(layers.length);
  }, [mountedDepth, layers.length]);

  const layersRef = useRef(layers);
  layersRef.current = layers;
  const searchRef = useRef(search);
  searchRef.current = search;
  const locationRef = useRef(location);
  locationRef.current = location;

  const hrefOf = (path: string, s: string) => `${path}${s ? `?${s}` : ""}`;
  const prevHrefRef = useRef(hrefOf(location, search));
  /** Ân hạn chỉ cho URL lúc nạp trang; huỷ bởi mọi lần đổi location và open()/push(). */
  const graceRef = useRef<{ active: boolean; timer: number | null }>({ active: true, timer: null });

  const dirtyRef = useRef(new Map<number, boolean>());
  const isDirty = (l: LayerState) => dirtyRef.current.get(l.uid) === true;

  const expectRef = useRef<Expectation | null>(null);
  const clearExpect = () => {
    const e = expectRef.current;
    if (e) window.clearTimeout(e.timer);
    expectRef.current = null;
  };
  const expect = (sig: string, extra: Omit<Expectation, "sig" | "timer"> = {}) => {
    clearExpect();
    const ex: Expectation = { sig, ...extra, timer: 0 };
    ex.timer = window.setTimeout(() => {
      if (expectRef.current === ex) expectRef.current = null;
    }, EXPECT_TTL_MS);
    expectRef.current = ex;
  };
  useEffect(
    () => () => {
      clearExpect();
      if (graceRef.current.timer != null) window.clearTimeout(graceRef.current.timer);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [pending, setPending] = useState<Pending | null>(null);

  const captureFocus = (): HTMLElement | null => {
    const el = typeof document !== "undefined" ? document.activeElement : null;
    return el instanceof HTMLElement && el !== document.body ? el : null;
  };

  const hrefFor = useCallback((stack: readonly FlyoutEntry[]) => {
    const qs = buildFlyoutSearch(searchRef.current, stack);
    return hrefOf(locationRef.current, qs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Chữ ký của mục HIỆN TẠI theo URL thật. */
  const currentSig = () => flyoutStackSig(locationRef.current, parseFlyoutStack(searchRef.current));

  /**
   * Đưa lịch sử tới stack đích T, chỉ dựa vào dấu của mục hiện tại (xem docblock).
   * `open`: được push phần còn thiếu khi mục tới là tiền tố của T.
   */
  const goTo = useCallback(
    (T: FlyoutEntry[], opts: { open: boolean; returnFocus?: HTMLElement | null }) => {
      const path = locationRef.current;
      const m = readMarker(hostId);
      const chain = m ? m.chain : [];
      const d = chain.length;
      const cur = currentSig();
      const sigAt = (j: number) => (j === d ? cur : chain[j]);
      let j = d;
      while (j >= 1) {
        const here = parseSig(sigAt(j));
        if (here.path === path && isPrefixStack(here.stack, T)) break;
        if (parseSig(sigAt(j - 1)).path !== path) break;
        j--;
      }
      const landedSig = sigAt(j);
      const land = () => {
        const L = parseSig(landedSig);
        const targetSig = flyoutStackSig(path, T);
        if (L.path === path && sameStack(L.stack, T)) return;
        const href = hrefFor(T);
        if (opts.open && L.path === path && isPrefixStack(L.stack, T)) {
          const nextChain = [...chain.slice(0, j), landedSig];
          expect(targetSig, { returnFocus: opts.returnFocus ?? null });
          navigate(href, { state: { flyoutHost: hostId, depth: nextChain.length, stackSig: targetSig, chain: nextChain } satisfies FlyoutHistoryMarker });
          return;
        }
        // Thay mục đang đứng: mục có dấu ⇒ giữ dấu (cập nhật stackSig); mục gốc ⇒ giữ state của trang.
        const state =
          j >= 1
            ? ({ flyoutHost: hostId, depth: j, stackSig: targetSig, chain: chain.slice(0, j) } satisfies FlyoutHistoryMarker)
            : (window.history.state as unknown);
        expect(targetSig, { returnFocus: opts.returnFocus ?? null });
        navigate(href, { replace: true, state });
      };
      const steps = d - j;
      if (steps === 0) {
        land();
        return;
      }
      expect(landedSig, { after: land });
      window.history.go(-steps);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostId, hrefFor, navigate],
  );

  const cancelGrace = () => {
    const g = graceRef.current;
    g.active = false;
    if (g.timer != null) {
      window.clearTimeout(g.timer);
      g.timer = null;
    }
  };

  /** Dọn khoá lạ: bỏ mọi lớp TỪ khoá lạ đầu tiên trở lên (replace, giữ dấu của mục). */
  const cleanUnknown = () => {
    const raw = parseFlyoutStack(searchRef.current);
    const keep = knownPrefixOf(raw, layersRef.current);
    if (keep.length === raw.length) return;
    const m = readMarker(hostId);
    const sig = flyoutStackSig(locationRef.current, keep);
    const state = m ? { ...m, stackSig: sig } : (window.history.state as unknown);
    expect(sig);
    navigate(hrefFor(keep), { replace: true, state });
  };

  // ── URL / đăng ký → stack ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const href = hrefOf(location, search);
    const locChanged = href !== prevHrefRef.current;
    const leftHref = prevHrefRef.current;
    prevHrefRef.current = href;

    // Kỳ vọng chỉ được tiêu thụ ở lần ĐỔI LOCATION kế tiếp (đổi đăng ký thì không).
    let exp: Expectation | null = null;
    if (locChanged) {
      exp = expectRef.current;
      clearExpect();
      if (graceRef.current.active) cancelGrace();
    }
    const raw = parseFlyoutStack(search);
    const sigNow = flyoutStackSig(location, raw);
    const byHost = exp != null && exp.sig === sigNow;

    const S = layersRef.current;
    const urlStack = knownPrefixOf(raw, S);
    const handleUnknown = () => {
      if (urlStack.length !== raw.length) {
        const g = graceRef.current;
        if (g.active) {
          if (g.timer == null) {
            g.timer = window.setTimeout(() => {
              g.timer = null;
              g.active = false;
              cleanUnknown();
            }, unknownKeyGraceMs);
          }
        } else {
          cleanUnknown();
        }
      } else if (graceRef.current.active && graceRef.current.timer != null) {
        cancelGrace();
      }
    };
    const common = commonPrefix(S, urlStack);
    if (common === S.length && common === urlStack.length) {
      handleUnknown();
      if (byHost) exp?.after?.();
      return;
    }
    const removed = S.slice(common);
    if (!byHost && removed.some(isDirty)) {
      if (locChanged) {
        // Back/forward từ BÊN NGOÀI sắp gỡ form còn dữ liệu: giữ instance, push lại đúng URL vừa rời
        // (mục mới mang dấu nối tiếp mục vừa tới), rồi hỏi.
        const m = readMarker(hostId);
        const nextChain = [...(m ? m.chain : []), sigNow];
        const qAt = leftHref.indexOf("?");
        const restoreSig = flyoutStackSig(qAt < 0 ? leftHref : leftHref.slice(0, qAt), parseFlyoutStack(qAt < 0 ? "" : leftHref.slice(qAt + 1)));
        expect(restoreSig);
        navigate(leftHref, { state: { flyoutHost: hostId, depth: nextChain.length, stackSig: restoreSig, chain: nextChain } satisfies FlyoutHistoryMarker });
        setPending({ kind: "external", targetSig: sigNow });
      } else {
        // Định nghĩa của lớp dirty bị gỡ đăng ký: URL KHÔNG đổi, không push gì — chỉ hỏi.
        setPending({ kind: "unregister", target: urlStack });
      }
      return;
    }
    // Không có lớp dirty nào bị gỡ ⇒ mới xử lý khoá lạ (ân hạn hoặc dọn). Khi đang hỏi (gỡ đăng ký
    // một lớp dirty) thì KHÔNG dọn URL — URL giữ nguyên cho tới khi người dùng chọn.
    handleUnknown();
    for (const l of removed) dirtyRef.current.delete(l.uid);
    const added = urlStack.slice(common).map((e, i) => ({
      ...e,
      uid: ++uidRef.current,
      returnFocus: i === 0 && byHost ? (exp?.returnFocus ?? null) : null,
      def: flyoutsRef.current[e.key] ?? null,
      kept: false,
    }));
    const nextLayers = [...S.slice(0, common), ...added];
    layersRef.current = nextLayers;
    setLayers(nextLayers);
    if (byHost) exp?.after?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, search, knownSig]);

  // ── thao tác ───────────────────────────────────────────────────────────────────────────────
  const performOpen = useCallback(
    (next: FlyoutEntry[]) => {
      const S = layersRef.current;
      const captured = captureFocus();
      // Mở từ BÊN TRONG một lớp sắp bị thay ⇒ khi lớp mới đóng, trả focus về phần tử đã mở stack cũ.
      const focus = captured && captured.closest("[data-flyout-key]") ? (S[0]?.returnFocus ?? null) : captured;
      goTo(next, { open: true, returnFocus: focus });
    },
    [goTo],
  );

  const open = useCallback(
    (key: string, opts?: FlyoutOpenOptions) => {
      cancelGrace();
      const next = [{ key, id: normId(opts?.id) }];
      const S = layersRef.current;
      if (S.slice(commonPrefix(S, next)).some(isDirty)) {
        setPending({ kind: "open", next });
        return;
      }
      performOpen(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [performOpen],
  );

  const push = useCallback(
    (key: string, opts?: FlyoutOpenOptions) => {
      cancelGrace();
      const next = [...layersRef.current.map(({ key: k, id }) => ({ key: k, id })), { key, id: normId(opts?.id) }];
      goTo(next, { open: true, returnFocus: captureFocus() });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [goTo],
  );

  const stackOf = (S: readonly LayerState[]) => S.map(({ key, id }) => ({ key, id }));
  const performClose = useCallback(() => {
    const S = layersRef.current;
    if (S.length === 0) return;
    goTo(stackOf(S.slice(0, -1)), { open: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo]);
  const performCloseAll = useCallback(() => {
    if (layersRef.current.length === 0) return;
    goTo([], { open: false });
  }, [goTo]);

  const close = useCallback(() => {
    const S = layersRef.current;
    const top = S[S.length - 1];
    if (!top) return;
    if (isDirty(top)) {
      setPending({ kind: "close" });
      return;
    }
    performClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performClose]);

  const closeAll = useCallback(() => {
    if (layersRef.current.some(isDirty)) {
      setPending({ kind: "closeAll" });
      return;
    }
    performCloseAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performCloseAll]);

  const stack = useMemo(() => layers.map(({ key, id }) => ({ key, id })), [layers]);
  const api = useMemo<FlyoutApi>(
    () => ({ stack, open, push, close, closeAll, isOpen: (key) => stack.some((e) => e.key === key) }),
    [stack, open, push, close, closeAll],
  );

  const onKeep = () => {
    const p = pending;
    setPending(null);
    if (p?.kind === "unregister") {
      // Giữ: lớp vẫn dựng bằng định nghĩa đã lưu; URL không đổi.
      const S = layersRef.current;
      const keepFrom = commonPrefix(S, p.target);
      const next = S.map((l, i) => (i >= keepFrom ? { ...l, kept: true } : l));
      layersRef.current = next;
      setLayers(next);
    }
  };

  const onDiscard = () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "close") performClose();
    else if (p.kind === "closeAll") performCloseAll();
    else if (p.kind === "open") performOpen(p.next);
    else if (p.kind === "unregister") {
      const S = layersRef.current;
      const from = commonPrefix(S, p.target);
      for (const l of S.slice(from)) dirtyRef.current.delete(l.uid);
      goTo(p.target, { open: false });
    } else {
      // Back bị chặn: mục hiện tại là mục host vừa push lại (mang dấu) ⇒ lùi đúng một mục về đích
      // người dùng đã chọn. Không có dấu (không thể xảy ra trừ khi trang tự ghi đè) ⇒ không lùi.
      const m = readMarker(hostId);
      for (const l of layersRef.current) dirtyRef.current.delete(l.uid);
      if (m && m.chain[m.depth - 1] === p.targetSig) {
        expect(p.targetSig);
        window.history.go(-1);
      }
    }
  };

  return (
    <FlyoutContext.Provider value={api}>
      {children}
      {layers.map((l, i) => {
        // Lớp còn trong stack mà khoá vừa bị gỡ đăng ký (đang hỏi, hoặc người dùng chọn Giữ) ⇒ dựng
        // bằng định nghĩa đã lưu để form không mất dữ liệu.
        const def = flyouts[l.key] ?? l.def;
        if (!def || i >= mountedDepth) return null;
        const isTop = i === layers.length - 1;
        const layerApi: FlyoutLayerApi = {
          key: l.key,
          id: l.id,
          depth: i,
          close,
          setDirty: (d) => {
            dirtyRef.current.set(l.uid, d);
          },
        };
        const title = typeof def.title === "function" ? def.title(l.id) : def.title;
        const description = typeof def.description === "function" ? def.description(l.id) : def.description;
        return (
          <FlyoutLayerContext.Provider key={l.uid} value={layerApi}>
            <Sheet
              open
              onOpenChange={(o) => {
                if (!o && isTop) close();
              }}
            >
              <SheetContent
                side="right"
                data-flyout-key={l.key}
                data-flyout-depth={i}
                onCloseAutoFocus={(e) => {
                  // Radix trả focus về DialogTrigger — ở đây không có trigger, nên tự trả về
                  // phần tử đã mở lớp (nếu nó còn trong tài liệu).
                  e.preventDefault();
                  if (l.returnFocus && l.returnFocus.isConnected) l.returnFocus.focus();
                  else fallbackFocus(i);
                }}
                className={cn("flex w-[92vw] flex-col gap-0 p-0", SIZE_CLASS[def.size ?? "md"])}
              >
                <SheetHeader className="border-b px-4 py-3 pr-10">
                  <SheetTitle className="text-base">{title}</SheetTitle>
                  {description ? <SheetDescription>{description}</SheetDescription> : null}
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">{def.render(layerApi)}</div>
              </SheetContent>
            </Sheet>
          </FlyoutLayerContext.Provider>
        );
      })}
      <UnsavedChangesConfirm open={pending != null} onKeep={onKeep} onDiscard={onDiscard} />
    </FlyoutContext.Provider>
  );
}

export default FlyoutHost;
