import type { CSSProperties } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useTheme } from "@/theme/ThemeToggle"

/** Themed `sonner` mount point — one instance lives in `App.tsx`. Colors route through this app's own
 * CSS custom properties (not sonner's defaults) via its documented `--normal-*`/`--success-*`/
 * `--error-*` override hooks, so a toast reads as part of the white/navy system in both themes rather
 * than sonner's stock look. */
function Toaster({ ...props }: ToasterProps) {
  const { theme } = useTheme()
  // sonner only understands its own "light"/"dark"/"system" — Console is this app's one dark
  // ground, Glass/Warmth both light; colors are already fully overridden below via this app's own
  // CSS custom properties regardless, so this only steers sonner's OWN built-in icon tinting.
  const sonnerTheme = theme === "console" ? "dark" : "light"

  return (
    <Sonner
      theme={sonnerTheme}
      className="toaster group"
      position="bottom-right"
      richColors={false}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--popover)",
          "--success-text": "var(--ok-text)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--danger-text)",
          "--error-border": "var(--border)",
        } as CSSProperties
      }
      toastOptions={{
        unstyled: false,
        classNames: {
          // WS1-T2 — was a flat `!shadow-none`; toasts are transient overlay chrome, same family
          // as dialogs/popovers, so they pick up the same per-theme `--elevation` (soft lift on
          // Glass, cyan-ring+deep-shadow on Console, contact shadow on Warmth) instead of reading
          // as pasted-on flat rectangles.
          toast: "!rounded-[var(--radius-card)] !border !shadow-[var(--elevation)]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
