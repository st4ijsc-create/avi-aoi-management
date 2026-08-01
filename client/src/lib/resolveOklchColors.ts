/**
 * Print / export colour resolution for html2canvas.
 *
 * html2canvas 1.x ships its own CSS parser that cannot understand modern colour
 * syntaxes used by the design tokens in `client/src/index.css`:
 *   - `oklch(...)`            → the raw token values (`--foreground: oklch(...)`).
 *   - `hsl(var(--token))`     → INVALID CSS, because the tokens hold `oklch(...)`
 *                               not HSL triplets, so `hsl(oklch(...))` is dropped
 *                               (StationAnalysis.tsx axis labels render wrong).
 *
 * Two entry points:
 *   - `resolveOklchColors(doc)`  — theme-faithful: resolves `oklch()` and
 *     `hsl(var(--token))` to the *current theme's* computed rgb. Used by the
 *     "screenshot what's on screen" callers (ResizableDashboard, pdfExport).
 *   - `resolvePrintColors(doc)`  — forces a light **print palette** on the clone
 *     (dark-mode cards must not render dark-on-white), white background, and maps
 *     every colour token to a print-safe hex. Used by the report export engine.
 */

/** Color properties that may carry token/oklch values in inline styles. */
const COLOR_PROPS = [
  "color", "background-color", "border-color",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "outline-color", "text-decoration-color", "fill", "stroke",
  "caret-color", "column-rule-color",
] as const;
void COLOR_PROPS; // retained for reference / potential targeted passes

const OKLCH_RE = /oklch\([^)]+\)/gi;

/** `hsl(var(--token))` or `hsl(var(--token) / 0.5)` — invalid because tokens are oklch. */
const HSL_VAR_RE = /hsl\(\s*var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)\s*(?:\/\s*([0-9.]+%?)\s*)?\)/gi;

/** Bare `var(--token)` (optionally with a fallback) used as a colour value. */
const VAR_RE = /var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)/gi;

/** Match raw oklch values in CSS variable definitions (e.g. `--primary: .55 .14 185`). */
const RAW_OKLCH_VAR_RE = /--([\w-]+)\s*:\s*([\d.]+\s+[\d.]+\s+[\d.]+(?:\s*\/\s*[\d.]+)?)\s*([;}])/g;

/**
 * Light, print-safe palette. Every colour token in `index.css` is mapped to a
 * high-contrast light value so a dark-mode page still exports as dark-ink-on-
 * white. Keyed by token name WITHOUT the leading `--`, lower-case.
 */
export const PRINT_PALETTE: Readonly<Record<string, string>> = {
  background: "#ffffff",
  foreground: "#0f172a",
  card: "#ffffff",
  "card-foreground": "#0f172a",
  popover: "#ffffff",
  "popover-foreground": "#0f172a",
  primary: "#0e7490",
  "primary-foreground": "#ffffff",
  secondary: "#f1f5f9",
  "secondary-foreground": "#0f172a",
  muted: "#f1f5f9",
  "muted-foreground": "#475569",
  accent: "#e2e8f0",
  "accent-foreground": "#0f172a",
  destructive: "#dc2626",
  "destructive-foreground": "#ffffff",
  success: "#16a34a",
  warning: "#d97706",
  border: "#e2e8f0",
  input: "#e2e8f0",
  ring: "#0e7490",
  "chart-1": "#0e7490",
  "chart-2": "#16a34a",
  "chart-3": "#d97706",
  "chart-4": "#7c3aed",
  "chart-5": "#dc2626",
  sidebar: "#f8fafc",
  "sidebar-foreground": "#0f172a",
  "sidebar-primary": "#0e7490",
  "sidebar-primary-foreground": "#ffffff",
  "sidebar-accent": "#e2e8f0",
  "sidebar-accent-foreground": "#0f172a",
  "sidebar-border": "#e2e8f0",
  "sidebar-ring": "#0e7490",
};

/** #rrggbb + alpha → `rgba(r, g, b, a)` (falls back to the hex when alpha≈1). */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Pure string transform — rewrite every token/oklch colour in a CSS text
 * fragment to a concrete colour using `palette` for tokens and `resolveOklch`
 * for `oklch()` calls. Non-colour tokens (`--radius`, …) are left untouched.
 *
 * Exported for unit testing (deterministic, no DOM/browser needed when the
 * `resolveOklch` argument is stubbed).
 */
export function transformPrintColors(
  css: string,
  palette: Readonly<Record<string, string>>,
  resolveOklch: (oklch: string) => string,
): string {
  // 1. oklch() → rgb (also converts `--token: oklch(...)` definitions).
  let out = css.replace(OKLCH_RE, (m) => resolveOklch(m) || m);
  // 2. hsl(var(--token)) / hsl(var(--token) / a) → palette hex / rgba.
  out = out.replace(HSL_VAR_RE, (m, name: string, alpha: string | undefined) => {
    const hex = palette[name.toLowerCase()];
    if (!hex) return m;
    if (alpha != null) {
      const a = alpha.trim().endsWith("%") ? parseFloat(alpha) / 100 : parseFloat(alpha);
      return hexToRgba(hex, a);
    }
    return hex;
  });
  // 3. bare var(--token) used as a colour → palette hex (leave unknown tokens).
  out = out.replace(VAR_RE, (m, name: string) => {
    const hex = palette[name.toLowerCase()];
    return hex ?? m;
  });
  return out;
}

/** Build `:root/.light/.dark { --token: hex; … }` override CSS for the clone. */
function buildOverrideCss(palette: Readonly<Record<string, string>>): string {
  const decls = Object.entries(palette)
    .map(([k, v]) => `--${k}: ${v};`)
    .join("");
  return `:root,.light,.dark{${decls}color-scheme:light;}html,body{background:#ffffff !important;}`;
}

/** Hidden probe on the MAIN document → let the browser compute colours. */
function makeResolver() {
  const probe = window.document.createElement("span");
  probe.style.cssText = "position:fixed;left:-9999px;visibility:hidden;";
  window.document.body.appendChild(probe);
  /** Convert an `oklch(...)` (or any colour) string → computed rgb/rgba. */
  const resolve = (value: string): string => {
    probe.style.setProperty("color", "");
    probe.style.setProperty("color", value);
    return window.getComputedStyle(probe).color;
  };
  /** Resolve the current-theme colour of a `var(--token)` reference. */
  const resolveVar = (token: string): string => {
    probe.style.setProperty("color", "");
    probe.style.setProperty("color", `var(--${token})`);
    return window.getComputedStyle(probe).color;
  };
  const dispose = () => {
    if (probe.parentNode) probe.parentNode.removeChild(probe);
  };
  return { resolve, resolveVar, dispose };
}

/**
 * Theme-faithful resolver (backwards-compatible entry point).
 *
 * Walks all `<style>` blocks, accessible stylesheet rules and inline styles in a
 * (cloned) document and rewrites:
 *   - `oklch(...)`        → the current-theme computed rgb.
 *   - raw oklch var defs  → rgb.
 *   - `hsl(var(--token))` → the current-theme computed rgb of the token (fixes
 *                           the invalid `hsl(oklch())` that renders wrong).
 * Does NOT force a light palette — use `resolvePrintColors` for exports.
 */
export function resolveOklchColors(doc: Document) {
  const { resolve, resolveVar, dispose } = makeResolver();
  const rewriteHslVar = (text: string): string =>
    text.replace(HSL_VAR_RE, (m, name: string, alpha: string | undefined) => {
      const rgb = resolveVar(name);
      if (!rgb) return m;
      if (alpha == null) return rgb;
      // Splice alpha into the computed rgb(...) → rgba(...).
      const nums = rgb.match(/[\d.]+/g);
      if (!nums || nums.length < 3) return rgb;
      const a = alpha.trim().endsWith("%") ? parseFloat(alpha) / 100 : parseFloat(alpha);
      return `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${a})`;
    });

  try {
    // 1. <style> blocks.
    doc.querySelectorAll("style").forEach((styleEl) => {
      let css = styleEl.textContent || "";
      if (/oklch|hsl\(\s*var\(|:root|\.dark/i.test(css)) {
        const original = css;
        css = css.replace(OKLCH_RE, (m) => resolve(m));
        css = css.replace(RAW_OKLCH_VAR_RE, (_m, varName, oklchValue, terminator) => {
          return `--${varName}: ${resolve(`oklch(${oklchValue})`)}${terminator}`;
        });
        css = rewriteHslVar(css);
        if (css !== original) styleEl.textContent = css;
      }
    });

    // 2. Accessible CSSStyleSheet rules (covers <link> sheets when same-origin).
    try {
      for (const sheet of Array.from(doc.styleSheets)) {
        try {
          const rules = sheet.cssRules;
          for (let i = 0; i < rules.length; i++) {
            let ruleText = rules[i].cssText;
            if (/oklch|hsl\(\s*var\(|:root|\.dark/i.test(ruleText)) {
              ruleText = ruleText.replace(OKLCH_RE, (m) => resolve(m));
              ruleText = ruleText.replace(RAW_OKLCH_VAR_RE, (_m, v, ok, term) => `--${v}: ${resolve(`oklch(${ok})`)}${term}`);
              ruleText = rewriteHslVar(ruleText);
              if (ruleText !== rules[i].cssText) {
                sheet.deleteRule(i);
                sheet.insertRule(ruleText, i);
              }
            }
          }
        } catch { /* CORS-blocked sheet — skip */ }
      }
    } catch { /* styleSheets not accessible — skip */ }

    // 3. Inline styles + SVG fill/stroke attributes.
    doc.querySelectorAll("*").forEach((el) => {
      const htmlEl = el as HTMLElement;
      const inline = htmlEl.getAttribute("style") || "";
      if (/oklch|hsl\(\s*var\(/i.test(inline)) {
        htmlEl.setAttribute("style", rewriteHslVar(inline.replace(OKLCH_RE, (m) => resolve(m))));
      }
      for (const attr of ["fill", "stroke"] as const) {
        const v = el.getAttribute(attr);
        if (v && /oklch|hsl\(\s*var\(/i.test(v)) {
          el.setAttribute(attr, rewriteHslVar(v.replace(OKLCH_RE, (m) => resolve(m))));
        }
      }
    });
  } finally {
    dispose();
  }
}

export interface ResolvePrintColorsOptions {
  /** Override the default light print palette. */
  palette?: Readonly<Record<string, string>>;
}

/**
 * Print-palette resolver for report exports.
 *
 * Forces a light theme + white background on the cloned document and rewrites
 * every colour token (`oklch()`, `hsl(var(--token))`, bare `var(--token)`) to a
 * high-contrast print-safe hex so dark-mode dashboards export legibly. Meant to
 * be called from an html2canvas `onclone` hook with `el.ownerDocument`.
 */
export function resolvePrintColors(doc: Document, opts: ResolvePrintColorsOptions = {}) {
  const palette = opts.palette ?? PRINT_PALETTE;
  const { resolve, dispose } = makeResolver();
  const transform = (css: string) => transformPrintColors(css, palette, resolve);
  const hasColorTokens = (t: string) => /oklch|var\(\s*--|hsl\(/i.test(t);

  try {
    // Force light theme context on the clone.
    const root = doc.documentElement;
    if (root) {
      root.classList.remove("dark");
      root.classList.add("light");
      root.style.background = "#ffffff";
      root.style.setProperty("color-scheme", "light");
    }
    if (doc.body) doc.body.style.background = "#ffffff";

    // Inject a high-specificity override so any missed bare var() still resolves
    // to a light token (belt-and-braces for CORS-blocked / computed styles).
    const override = doc.createElement("style");
    override.setAttribute("data-print-palette", "");
    override.textContent = buildOverrideCss(palette);
    (doc.head ?? doc.documentElement)?.appendChild(override);

    // <style> blocks.
    doc.querySelectorAll("style").forEach((styleEl) => {
      if (styleEl.getAttribute("data-print-palette") != null) return; // skip our own
      const css = styleEl.textContent || "";
      if (hasColorTokens(css)) {
        const next = transform(css);
        if (next !== css) styleEl.textContent = next;
      }
    });

    // Accessible stylesheet rules.
    try {
      for (const sheet of Array.from(doc.styleSheets)) {
        try {
          const rules = sheet.cssRules;
          for (let i = 0; i < rules.length; i++) {
            const t = rules[i].cssText;
            if (hasColorTokens(t)) {
              const nt = transform(t);
              if (nt !== t) {
                sheet.deleteRule(i);
                sheet.insertRule(nt, i);
              }
            }
          }
        } catch { /* CORS-blocked sheet — skip */ }
      }
    } catch { /* styleSheets not accessible — skip */ }

    // Inline styles + SVG fill/stroke attributes (recharts colours live here).
    doc.querySelectorAll("*").forEach((el) => {
      const htmlEl = el as HTMLElement;
      const inline = htmlEl.getAttribute("style");
      if (inline && hasColorTokens(inline)) {
        const ns = transform(inline);
        if (ns !== inline) htmlEl.setAttribute("style", ns);
      }
      for (const attr of ["fill", "stroke"] as const) {
        const v = el.getAttribute(attr);
        if (v && hasColorTokens(v)) {
          const nv = transform(v);
          if (nv !== v) el.setAttribute(attr, nv);
        }
      }
    });
  } finally {
    dispose();
  }
}
