import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (switchable) {
      const stored = localStorage.getItem("theme");
      return (stored as Theme) || defaultTheme;
    }
    return defaultTheme;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
      root.classList.remove("light");
    }

    if (switchable) {
      localStorage.setItem("theme", theme);
    }
  }, [theme, switchable]);

  const toggleTheme = switchable
    ? () => {
        setTheme(prev => (prev === "light" ? "dark" : "light"));
      }
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

/**
 * doc 81 Đợt 3 Task 0 (D4) — theme THẬT của app cho thư viện tự vẽ theme (React Flow `colorMode`). Không ném khi thiếu
 * provider (canvas render trong test/khung riêng): đọc lớp của `<html>` — ThemeProvider đặt đúng một trong `dark`/`light`.
 * Lý do: React Flow mặc định `colorMode="light"` ⇒ wrapper mang lớp `light` ⇒ token `.light` (index.css) bị khai lại bên
 * trong canvas khi app đang tối (nút điều khiển/minimap trắng, bảng thêm phần tử của POU trắng với nhãn sáng).
 */
export function useResolvedTheme(): Theme {
  const context = useContext(ThemeContext);
  if (context) return context.theme;
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) return "dark";
  return "light";
}
