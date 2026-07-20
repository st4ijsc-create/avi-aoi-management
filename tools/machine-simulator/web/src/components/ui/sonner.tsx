import type { CSSProperties } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useTheme } from "@/theme/ThemeToggle"

/** Themed `sonner` mount point — one instance lives in `App.tsx`. Colors route through this app's own
 * CSS custom properties (not sonner's defaults) via its documented `--normal-*`/`--success-*`/
 * `--error-*` override hooks, so a toast reads as part of the white/navy system in both themes rather
 * than sonner's stock look. */
function Toaster({ ...props }: ToasterProps) {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={theme}
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
          toast: "!rounded-none !border !shadow-none",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
