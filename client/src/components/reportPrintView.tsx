/**
 * Off-screen "print view" chart capture (doc 32 §6.5).
 *
 * Root cause of the export gaps (§6.4 #1/#2): `ReportExportButton` only
 * screenshotted charts that were mounted in the *currently open tab*, so every
 * other chart exported empty. This helper decouples capture from the live tab:
 * given a list of chart render-thunks (+ their prefetched data), it mounts ALL
 * of them off-screen at a fixed print width, waits for recharts to lay out, runs
 * html2canvas on each, returns the PNGs keyed by id, then unmounts.
 *
 * R4-B builds one `PrintChartSpec` per chart it wants in the report (from data
 * it has already prefetched) and passes them all here — no tab needs to be open.
 */
import { Fragment, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import { resolvePrintColors } from "../lib/resolveOklchColors";

/** Fixed off-screen mount width (px). Wide enough for dense recharts layouts. */
export const PRINT_VIEW_WIDTH = 1100;
/** Default mounted height per chart (px). */
export const PRINT_CHART_HEIGHT = 320;

export interface PrintChartSpec {
  /** Unique key — the returned record is keyed by this. */
  key: string;
  /** Render thunk producing the chart node (e.g. a recharts tree). */
  render: () => ReactNode;
  /** Mounted height in px (default {@link PRINT_CHART_HEIGHT}). */
  height?: number;
  /** Optional fixed width in px (defaults to the container width). */
  width?: number;
}

export interface CapturePrintChartsOptions {
  /** Off-screen mount width in px (default {@link PRINT_VIEW_WIDTH}). */
  width?: number;
  /** Delay (ms) to let recharts/ResizeObserver settle before capture. Default 180. */
  settleMs?: number;
  /** html2canvas scale (default 2). */
  scale?: number;
  /** Capture background (default "#ffffff"). */
  backgroundColor?: string;
}

export interface NormalizedCaptureOptions {
  width: number;
  settleMs: number;
  scale: number;
  backgroundColor: string;
}

/** Resolve capture options against defaults (pure — unit-testable). */
export function normalizeCaptureOptions(o: CapturePrintChartsOptions = {}): NormalizedCaptureOptions {
  return {
    width: o.width ?? PRINT_VIEW_WIDTH,
    settleMs: o.settleMs ?? 180,
    scale: o.scale ?? 2,
    backgroundColor: o.backgroundColor ?? "#ffffff",
  };
}

/** Wait for layout: two animation frames (if available) + a settle delay. */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
    raf(() => raf(() => setTimeout(resolve, ms)));
  });
}

/** CSS.escape fallback for building the wrapper selector. */
function escapeAttr(value: string): string {
  const g = globalThis as { CSS?: { escape?: (s: string) => string } };
  if (g.CSS && typeof g.CSS.escape === "function") return g.CSS.escape(value);
  return value.replace(/["\\\]]/g, "\\$&");
}

/** Off-screen list of all charts to capture. */
function PrintChartList({ charts }: { charts: PrintChartSpec[] }) {
  return createElement(
    Fragment,
    null,
    charts.map((c) =>
      createElement(
        "div",
        {
          key: c.key,
          "data-chart-key": c.key,
          style: {
            width: c.width != null ? `${c.width}px` : "100%",
            height: `${c.height ?? PRINT_CHART_HEIGHT}px`,
            background: "#ffffff",
            padding: "12px",
            boxSizing: "border-box",
            overflow: "hidden",
          } as const,
        },
        c.render(),
      ),
    ),
  );
}

/**
 * Mount every chart off-screen, capture each as a PNG data URL, unmount.
 *
 * @returns a record `{ [spec.key]: pngDataUrl }`. Charts that fail to render or
 *          capture are silently omitted (the caller renders the data table
 *          alongside, so numbers are never lost).
 *
 * NOTE: real rasterisation needs a browser (recharts SVG layout + html2canvas).
 * In jsdom the orchestration runs but produces no real pixels.
 */
export async function capturePrintCharts(
  charts: PrintChartSpec[],
  options: CapturePrintChartsOptions = {},
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  if (!charts.length) return results;

  const opt = normalizeCaptureOptions(options);

  const host = document.createElement("div");
  host.setAttribute("data-report-print-view", "");
  host.classList.add("light"); // light theme context for token resolution
  host.style.cssText =
    `position:fixed;left:-100000px;top:0;width:${opt.width}px;` +
    `background:${opt.backgroundColor};z-index:-1;pointer-events:none;`;
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(createElement(PrintChartList, { charts }));
    await settle(opt.settleMs);

    for (const spec of charts) {
      const wrapper = host.querySelector<HTMLElement>(`[data-chart-key="${escapeAttr(spec.key)}"]`);
      if (!wrapper) continue;
      try {
        const canvas = await html2canvas(wrapper, {
          scale: opt.scale,
          backgroundColor: opt.backgroundColor,
          logging: false,
          useCORS: true,
          windowWidth: opt.width,
          onclone: (_doc: Document, el: HTMLElement) => resolvePrintColors(el.ownerDocument),
        });
        results[spec.key] = canvas.toDataURL("image/png");
      } catch {
        /* skip a chart that fails to capture — data table still carries numbers */
      }
    }
  } finally {
    try {
      root.unmount();
    } catch {
      /* ignore unmount races */
    }
    if (host.parentNode) host.parentNode.removeChild(host);
  }

  return results;
}
