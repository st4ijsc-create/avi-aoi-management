/**
 * doc 81 Đợt 3b Task 2 (b) — chủ dự án 2026-10-06: "sửa chip đầu trang 640–1023 px (gộp vào "+N", chip nghiêm trọng vẫn
 * ghim)". Header một hàng của `PageHeaderCompact` cắt tràn vùng chip (`overflow-hidden`). Đo trên trình duyệt (instance
 * _test, 2026-10-09, `.playwright-mcp/do-bo-cuc/dot3b-task2/chips-truoc.json`): ở 768 px VÀ 1024 px nhiều màn bị cắt chip;
 * 1366/1600 không màn nào.
 *
 * Cách sửa = THEO ĐO (không theo mốc cố định), ba mức, chỉ leo khi mức trước VẪN tràn:
 *   0 — như cũ (một hàng).
 *   1 — GỘP: ngữ cảnh này = true ⇒ dùng cơ chế "+N" SẴN CÓ: `StatusChipStrip` chỉ hiện chip GHIM (R-2-p; tông "+N" = tệ
 *       nhất của phần giấu — như cũ), `NoticeStack` chỉ hiện notice GHIM (final wave I1 — vd HITL, cờ triển khai) và notice
 *       LỖI, phần còn lại vào "+N" mang tông TỆ NHẤT của phần giấu (final wave I1).
 *   2 — XUỐNG DÒNG (như dưới 640 px — Đợt 3 Task 0): khi phần KHÔNG gộp được (chip ghim, chip tự viết của trang, hành
 *       động) vẫn không vừa một hàng ⇒ header xuống dòng thay vì CẮT. Không gì bị cắt ở mức nào.
 * Ở 1366/1600 không tràn ⇒ mức 0 ⇒ hợp đồng một hàng ≤48 px và số đo của thiết bị đo không đổi. Ngoài header (vd top bar
 * shell — nơi chip/thanh giấy phép R-2-i sống) ngữ cảnh mặc định `false` ⇒ không đổi gì.
 *
 * Fix round 1 (R-3b-b (1)) — KHI NÀO đo lại:
 *   - LEO mức (chỉ lên, tối đa 2) mỗi khi thấy tràn: sau mỗi lần dựng, khi header HẸP lại (ResizeObserver), khi nội dung chip
 *     đổi mà trang không dựng lại (MutationObserver trên header: chip tự tải nhãn, số đổi…).
 *   - VỀ mức 0 rồi leo lại CHỈ khi header RỘNG ra hoặc CHỮ KÝ NỘI DUNG đổi (`contentSignature` — rẻ, theo dữ liệu chứ không
 *     theo danh tính phần tử JSX) ⇒ lượt dựng lại do thăm dò 5 s (Safety, Fleet) với dữ liệu y nguyên KHÔNG đụng tới header.
 *   - Popover "+N" (hay popover chip bất kỳ trong header) đang MỞ, hoặc tiêu điểm đang ở trong header ⇒ HOÃN việc về mức 0
 *     (không tháo "+N" đang mở, không làm rơi tiêu điểm); làm khi popover đóng / tiêu điểm rời header.
 */
import * as React from "react";

export const HeaderChipFoldContext = React.createContext<boolean>(false);

/** Dải chip đang nằm trong vùng chip của header đang ở mức GỘP (≥1) ⇒ gộp vào "+N". */
export function useHeaderChipFold(): boolean {
  return React.useContext(HeaderChipFoldContext);
}

export type HeaderFitLevel = 0 | 1 | 2;

/** Phần tử (hay một dải chip/notice bên trong) đang tràn ngang ⇒ có thứ bị cắt. */
export function headerOverflows(header: HTMLElement): boolean {
  const els: HTMLElement[] = [header];
  const chips = header.querySelector<HTMLElement>("[data-header-chips]");
  if (chips) els.push(chips, ...Array.from(chips.querySelectorAll<HTMLElement>("[data-status-chip-strip],[data-notice-stack]")));
  return els.some((el) => el.scrollWidth > el.clientWidth + 1);
}

/**
 * Chữ ký nội dung RẺ của các slot header: loại phần tử + prop nguyên thuỷ + `items` (id/kind/state/value/pinned/tone/nhãn) +
 * con, đệ quy có giới hạn. Không gọi component, không đọc DOM. Cùng dữ liệu ⇒ cùng chuỗi dù phần tử JSX là đối tượng mới.
 */
export function contentSignature(node: React.ReactNode, depth = 0): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((x) => contentSignature(x as React.ReactNode, depth)).join("|");
  if (!React.isValidElement(node)) return "";
  const type = node.type as unknown;
  const name =
    typeof type === "string"
      ? type
      : ((type as { displayName?: string; name?: string } | null)?.displayName ?? (type as { name?: string } | null)?.name ?? "c");
  const props = (node.props ?? {}) as Record<string, unknown>;
  let s = name;
  for (const k of Object.keys(props).sort()) {
    const v = props[k];
    if (k === "children" || k === "items" || k === "className" || k === "style") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") s += `;${k}=${String(v)}`;
    else if (depth < 8 && React.isValidElement(v)) s += `;${k}=<${contentSignature(v as React.ReactNode, depth + 1)}>`;
  }
  if (Array.isArray(props.items)) {
    s += `[${(props.items as unknown[])
      .map((it) => {
        if (!it || typeof it !== "object") return "";
        const o = it as Record<string, unknown>;
        const label = depth < 8 ? contentSignature(o.label as React.ReactNode, depth + 1) : "";
        return [o.id, o.kind, o.state, o.value, o.pinned, o.tone, label].map((x) => (x == null ? "" : String(x))).join(":");
      })
      .join(",")}]`;
  }
  if (depth < 8 && props.children != null) s += `(${contentSignature(props.children as React.ReactNode, depth + 1)})`;
  return s;
}

/** Đang có popover mở từ header, hoặc tiêu điểm nằm trong header ⇒ chưa được tháo/dựng lại cụm chip. */
function headerBusy(el: HTMLElement): boolean {
  if (el.querySelector('[aria-expanded="true"]')) return true;
  const active = typeof document !== "undefined" ? document.activeElement : null;
  return !!active && active !== document.body && el.contains(active);
}

/**
 * Mức vừa của header (xem docblock đầu tệp: leo khi tràn; về 0 chỉ khi rộng ra / chữ ký nội dung đổi; hoãn khi popover mở).
 * Mỗi bước leo chạy trong layout effect hoặc callback observer ⇒ xong trước khi vẽ lượt kế (không nháy).
 */
export function useHeaderFitLevel(ref: React.RefObject<HTMLElement | null>, signature: string): HeaderFitLevel {
  const [level, setLevel] = React.useState<HeaderFitLevel>(0);
  const levelRef = React.useRef<HeaderFitLevel>(0);
  levelRef.current = level;
  const lastSig = React.useRef<string | null>(null);
  const lastWidth = React.useRef<number | null>(null);
  const pendingReset = React.useRef(false);

  const climb = React.useCallback(() => {
    const el = ref.current;
    if (el && levelRef.current < 2 && headerOverflows(el)) setLevel((l) => (l < 2 ? ((l + 1) as HeaderFitLevel) : l));
  }, [ref]);
  const reset = React.useCallback(() => {
    const el = ref.current;
    if (el && headerBusy(el)) {
      pendingReset.current = true;
      return;
    }
    pendingReset.current = false;
    if (levelRef.current !== 0) setLevel(0);
    else climb();
  }, [ref, climb]);

  // Chữ ký nội dung đổi ⇒ về 0 (hoãn nếu bận), rồi LEO khi tràn. final wave (minor 7): CHỈ khi chữ ký hoặc mức đổi — không
  // phải mỗi lượt dựng (IR/IDE dựng lại header mỗi phím gõ với dữ liệu y nguyên; trước: mỗi lượt một lần đọc scrollWidth = ép
  // layout). Bề rộng đổi ⇒ ResizeObserver; DOM header đổi mà chữ ký không đổi ⇒ MutationObserver (dưới).
  React.useLayoutEffect(() => {
    if (lastSig.current !== signature) {
      const first = lastSig.current === null;
      lastSig.current = signature;
      if (!first && level !== 0) {
        const el = ref.current;
        if (el && headerBusy(el)) pendingReset.current = true;
        else {
          setLevel(0);
          return;
        }
      }
    }
    climb();
  }, [signature, level, climb, ref]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const w = Math.round(entries[entries.length - 1]?.contentRect.width ?? 0);
            const prev = lastWidth.current;
            lastWidth.current = w;
            if (prev == null || w === prev) return;
            if (w > prev) reset();
            else climb();
          });
    ro?.observe(el);
    // Nội dung chip đổi mà trang không dựng lại (chip tự tải, số đổi) ⇒ kiểm tràn; popover đóng (aria-expanded) ⇒ làm việc
    // về 0 đã hoãn.
    const mo =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            if (pendingReset.current) reset();
            else climb();
          });
    mo?.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-expanded"] });
    const onFocusOut = () => {
      setTimeout(() => {
        if (pendingReset.current) reset();
      }, 0);
    };
    el.addEventListener("focusout", onFocusOut);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      el.removeEventListener("focusout", onFocusOut);
    };
  }, [ref, reset, climb]);
  return level;
}
