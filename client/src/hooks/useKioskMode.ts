/**
 * Phase 5 WS5.1 — Kiosk mode for shop-floor tablets (Andon / MES boards).
 *
 * Activate by adding `?kiosk=1` to the URL. Adds a `kiosk-mode` class to <html>
 * (CSS in index.css hides the sidebar/header chrome and zeroes content padding)
 * and best-effort requests fullscreen on the first user gesture.
 */
import { useEffect } from "react";

export function useKioskMode(): void {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kiosk = params.get("kiosk") === "1" || params.get("kiosk") === "true";
    if (!kiosk) return;

    document.documentElement.classList.add("kiosk-mode");
    const goFullscreen = () => {
      document.documentElement.requestFullscreen?.().catch(() => {});
      window.removeEventListener("pointerdown", goFullscreen);
    };
    window.addEventListener("pointerdown", goFullscreen, { once: true });

    return () => {
      document.documentElement.classList.remove("kiosk-mode");
      window.removeEventListener("pointerdown", goFullscreen);
    };
  }, []);
}
