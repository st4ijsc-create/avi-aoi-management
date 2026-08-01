// useOptionalTheme — đọc theme app một cách AN TOÀN (không ném lỗi nếu thiếu Provider,
// và không cần context bridge vào trong Canvas). Ưu tiên class trên <html> (ThemeContext
// đã set 'light'/'dark' ở documentElement), fallback prefers-color-scheme.

import { useEffect, useState } from "react";

function readTheme(): "light" | "dark" {
  if (typeof document !== "undefined") {
    const cls = document.documentElement.classList;
    if (cls.contains("dark")) return "dark";
    if (cls.contains("light")) return "light";
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
}

export function useOptionalTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => readTheme());

  useEffect(() => {
    const update = () => setTheme(readTheme());
    // Theo dõi đổi class trên <html> (ThemeToggle) + đổi hệ điều hành.
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", update);
    return () => {
      obs.disconnect();
      mq?.removeEventListener?.("change", update);
    };
  }, []);

  return theme;
}
