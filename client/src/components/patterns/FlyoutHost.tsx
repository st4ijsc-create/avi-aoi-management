/**
 * Doc 81 Đợt 2 Task 3 — <FlyoutHost> + useFlyout(): MỘT stack sheet bên phải cho mỗi trang.
 *
 * Thay các Dialog tạo/sửa/duyệt giữa màn (32 Dialog trong 14 màn Engineering) bằng sheet phải
 * trên `ui/sheet` (Radix Dialog): bẫy focus, Esc đóng TỪNG lớp (chỉ lớp trên cùng nhận Esc), trả
 * focus về phần tử đã mở khi lớp đóng.
 *
 * ── URL LÀ NGUỒN SỰ THẬT (Review Focus 4) ─────────────────────────────────────────────────────
 *   `?flyout=detail&flyoutId=42&flyout=edit&flyoutId=42` — mỗi lớp một cặp, theo thứ tự đáy→đỉnh.
 *   Các tham số khác (`?tab=`, `?filter=pending`…) được GIỮ NGUYÊN.
 *   - open(key, {id}): stack rỗng ⇒ PUSH một mục lịch sử (back đóng nó); đang có lớp ⇒ REPLACE
 *     (bấm hàng khác trong danh sách không chất đống lịch sử).
 *   - push(key, {id}): thêm lớp, PUSH lịch sử.
 *   - close(): đóng lớp trên cùng. Lớp do chính phiên này push ⇒ `history.back()` (để back sau đó
 *     không mở lại nó); lớp dựng từ URL lúc F5 ⇒ REPLACE.
 *   - F5 dựng lại đủ stack từ URL; khoá không có trong `flyouts` bị bỏ và URL được dọn.
 *
 * ── DỮ LIỆU CHƯA LƯU ────────────────────────────────────────────────────────────────────────
 *   Nội dung lớp gọi `useFlyoutLayer().setDirty(true)`. Khi một lớp dirty sắp bị gỡ — bằng close(),
 *   Esc, open() lớp khác, hay NÚT BACK của trình duyệt — host hỏi "Bỏ thay đổi chưa lưu?". Với
 *   back: host giữ nguyên instance của form (dữ liệu không mất), đẩy URL cũ trở lại rồi hỏi; chọn
 *   "Bỏ thay đổi" thì lùi lại đúng một mục. Giới hạn: rời HẲN trang (đổi route) thì host bị gỡ
 *   cùng trang — không chặn được ở đây.
 *
 * Lớp đầu tiên là phần tử `[data-flyout-key]` (role=dialog, data-slot=sheet-content) — thiết bị
 * đo Task 1 chấm "dialog → sheet" bằng `kinds`.
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

interface LayerState extends FlyoutEntry {
  uid: number;
  /** Lớp này có một mục lịch sử riêng do phiên này push (back đóng nó). */
  viaPush: boolean;
  /** Phần tử đang có focus lúc mở lớp — nhận lại focus khi lớp đóng. */
  returnFocus: HTMLElement | null;
}

type Pending = { kind: "close" } | { kind: "closeAll" } | { kind: "open"; next: FlyoutEntry[] } | { kind: "external" };

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
}

export function FlyoutHost({ flyouts, children }: FlyoutHostProps) {
  const [location, navigate] = useLocation();
  const search = useSearch();

  const flyoutsRef = useRef(flyouts);
  flyoutsRef.current = flyouts;
  const known = (e: FlyoutEntry) => Object.prototype.hasOwnProperty.call(flyoutsRef.current, e.key);

  const uidRef = useRef(0);
  const [layers, setLayers] = useState<LayerState[]>(() =>
    parseFlyoutStack(search)
      .filter(known)
      .map((e) => ({ ...e, uid: ++uidRef.current, viaPush: false, returnFocus: null })),
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

  const dirtyRef = useRef(new Map<number, boolean>());
  /** Lần đổi URL kế tiếp là do chính host (đã hỏi/không cần hỏi) — không chặn. */
  const allowRef = useRef(false);
  /** viaPush cho các lớp MỚI ở lần đổi URL kế tiếp. */
  const newViaPushRef = useRef(false);
  /** Phần tử có focus lúc gọi open/push — gán cho lớp MỚI ở lần đổi URL kế tiếp. */
  const newReturnFocusRef = useRef<HTMLElement | null>(null);
  const captureFocus = () => {
    const el = typeof document !== "undefined" ? document.activeElement : null;
    newReturnFocusRef.current = el instanceof HTMLElement && el !== document.body ? el : null;
  };
  const [pending, setPending] = useState<Pending | null>(null);

  const isDirty = (l: LayerState) => dirtyRef.current.get(l.uid) === true;

  const hrefFor = useCallback((stack: readonly FlyoutEntry[]) => {
    const qs = buildFlyoutSearch(searchRef.current, stack);
    return `${locationRef.current}${qs ? `?${qs}` : ""}`;
  }, []);

  const currentQs = () => new URLSearchParams(searchRef.current).toString();

  // ── URL → stack ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = parseFlyoutStack(search);
    const urlStack = raw.filter(known);
    if (urlStack.length !== raw.length) {
      navigate(hrefFor(urlStack), { replace: true });
      return;
    }
    const S = layersRef.current;
    const common = commonPrefix(S, urlStack);
    if (common === S.length && common === urlStack.length) {
      allowRef.current = false;
      return;
    }
    const removed = S.slice(common);
    const allow = allowRef.current;
    const viaPush = newViaPushRef.current;
    const returnFocus = newReturnFocusRef.current;
    allowRef.current = false;
    newViaPushRef.current = false;
    newReturnFocusRef.current = null;

    if (!allow && removed.some(isDirty)) {
      // Đổi URL từ BÊN NGOÀI (back/forward) sẽ gỡ một form còn dữ liệu: giữ instance, đẩy URL cũ
      // trở lại (một mục lịch sử mới đè lên mục đích), rồi hỏi.
      setLayers(S.map((l, i) => (i >= common ? { ...l, viaPush: true } : l)));
      allowRef.current = true;
      navigate(hrefFor(S));
      setPending({ kind: "external" });
      return;
    }
    for (const l of removed) dirtyRef.current.delete(l.uid);
    const added = urlStack.slice(common).map((e, i) => ({
      ...e,
      uid: ++uidRef.current,
      viaPush,
      returnFocus: i === 0 ? returnFocus : null,
    }));
    setLayers([...S.slice(0, common), ...added]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // ── thao tác ───────────────────────────────────────────────────────────────────────────────
  const performOpen = useCallback(
    (next: FlyoutEntry[]) => {
      if (buildFlyoutSearch(searchRef.current, next) === currentQs()) return;
      const S = layersRef.current;
      allowRef.current = true;
      captureFocus();
      if (S.length === 0) {
        newViaPushRef.current = true;
        navigate(hrefFor(next));
      } else {
        newViaPushRef.current = S[0].viaPush;
        navigate(hrefFor(next), { replace: true });
      }
    },
    [hrefFor, navigate],
  );

  const performClose = useCallback(() => {
    const S = layersRef.current;
    const top = S[S.length - 1];
    if (!top) return;
    allowRef.current = true;
    if (top.viaPush) window.history.back();
    else navigate(hrefFor(S.slice(0, -1)), { replace: true });
  }, [hrefFor, navigate]);

  const performCloseAll = useCallback(() => {
    const S = layersRef.current;
    if (S.length === 0) return;
    let k = 0;
    for (let i = S.length - 1; i >= 0 && S[i].viaPush; i--) k++;
    allowRef.current = true;
    if (k === S.length) window.history.go(-k);
    else navigate(hrefFor([]), { replace: true });
  }, [hrefFor, navigate]);

  const open = useCallback(
    (key: string, opts?: FlyoutOpenOptions) => {
      const next = [{ key, id: normId(opts?.id) }];
      const S = layersRef.current;
      if (S.slice(commonPrefix(S, next)).some(isDirty)) {
        setPending({ kind: "open", next });
        return;
      }
      performOpen(next);
    },
    [performOpen],
  );

  const push = useCallback(
    (key: string, opts?: FlyoutOpenOptions) => {
      const next = [...layersRef.current.map(({ key: k, id }) => ({ key: k, id })), { key, id: normId(opts?.id) }];
      allowRef.current = true;
      newViaPushRef.current = true;
      captureFocus();
      navigate(hrefFor(next));
    },
    [hrefFor, navigate],
  );

  const close = useCallback(() => {
    const S = layersRef.current;
    const top = S[S.length - 1];
    if (!top) return;
    if (isDirty(top)) {
      setPending({ kind: "close" });
      return;
    }
    performClose();
  }, [performClose]);

  const closeAll = useCallback(() => {
    if (layersRef.current.some(isDirty)) {
      setPending({ kind: "closeAll" });
      return;
    }
    performCloseAll();
  }, [performCloseAll]);

  const stack = useMemo(() => layers.map(({ key, id }) => ({ key, id })), [layers]);
  const api = useMemo<FlyoutApi>(
    () => ({ stack, open, push, close, closeAll, isOpen: (key) => stack.some((e) => e.key === key) }),
    [stack, open, push, close, closeAll],
  );

  const onDiscard = () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "close") performClose();
    else if (p.kind === "closeAll") performCloseAll();
    else if (p.kind === "open") performOpen(p.next);
    else {
      allowRef.current = true;
      window.history.back();
    }
  };

  return (
    <FlyoutContext.Provider value={api}>
      {children}
      {layers.map((l, i) => {
        const def = flyouts[l.key];
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
                aria-describedby={description ? undefined : undefined}
                onCloseAutoFocus={(e) => {
                  // Radix trả focus về DialogTrigger — ở đây không có trigger, nên tự trả về
                  // phần tử đã mở lớp (nếu nó còn trong tài liệu).
                  e.preventDefault();
                  if (l.returnFocus && l.returnFocus.isConnected) l.returnFocus.focus();
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
      <UnsavedChangesConfirm open={pending != null} onKeep={() => setPending(null)} onDiscard={onDiscard} />
    </FlyoutContext.Provider>
  );
}

export default FlyoutHost;
