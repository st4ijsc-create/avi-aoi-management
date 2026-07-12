/**
 * doc 40 Wave 4d §13.3 — DensityProvider + useDensity (mật độ hiển thị).
 *
 * Context 'comfortable' | 'compact', lưu localStorage (khóa `ui.density`). Chế độ
 * `compact` giảm padding / chiều cao hàng / cỡ chữ để bảng & danh sách hiện nhiều
 * dữ liệu hơn trên một màn hình — phục vụ layout content-first.
 *
 * KHÔNG bắt buộc bọc toàn app ngay: có thể bọc cục bộ quanh một trang, hoặc dùng
 * mặc định (useDensity trả 'comfortable' + setter no-op khi ngoài Provider) rồi
 * chọn class qua helper `densityClass()` / `useDensityClasses()`.
 */
import * as React from "react";

export type Density = "comfortable" | "compact";

const STORAGE_KEY = "ui.density";

interface DensityContextValue {
  density: Density;
  setDensity: (d: Density) => void;
  toggle: () => void;
}

const DensityContext = React.createContext<DensityContextValue | null>(null);

function readStored(): Density {
  if (typeof window === "undefined") return "comfortable";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function DensityProvider({
  children,
  defaultDensity = "comfortable",
}: {
  children: React.ReactNode;
  defaultDensity?: Density;
}): React.JSX.Element {
  const [density, setDensityState] = React.useState<Density>(() => {
    const stored = readStored();
    return stored ?? defaultDensity;
  });

  const setDensity = React.useCallback((d: Density) => {
    setDensityState(d);
    try {
      window.localStorage.setItem(STORAGE_KEY, d);
    } catch {
      /* localStorage không khả dụng — vẫn giữ trong bộ nhớ phiên */
    }
  }, []);

  const toggle = React.useCallback(() => {
    setDensity(density === "compact" ? "comfortable" : "compact");
  }, [density, setDensity]);

  const value = React.useMemo(
    () => ({ density, setDensity, toggle }),
    [density, setDensity, toggle],
  );

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

/**
 * useDensity — an toàn khi dùng NGOÀI Provider: trả 'comfortable' + setter/toggle
 * no-op (để callsite không phải bọc Provider mới chạy được).
 */
export function useDensity(): DensityContextValue {
  const ctx = React.useContext(DensityContext);
  if (ctx) return ctx;
  return {
    density: "comfortable",
    setDensity: () => {},
    toggle: () => {},
  };
}

/** Bộ class helper cho một cỡ mật độ (không phụ thuộc Provider). */
export interface DensityClasses {
  /** padding ô bảng / hàng danh sách. */
  cellPadding: string;
  /** chiều cao hàng tối thiểu. */
  rowHeight: string;
  /** cỡ chữ nội dung. */
  text: string;
  /** padding trong card/section. */
  cardPadding: string;
  /** gap dọc giữa các khối. */
  gap: string;
}

const DENSITY_CLASSES: Record<Density, DensityClasses> = {
  comfortable: {
    cellPadding: "px-3 py-2.5",
    rowHeight: "h-11",
    text: "text-sm",
    cardPadding: "p-4",
    gap: "gap-4",
  },
  compact: {
    cellPadding: "px-2 py-1",
    rowHeight: "h-8",
    text: "text-xs",
    cardPadding: "p-2.5",
    gap: "gap-2",
  },
};

/** Lấy bộ class cho một density cụ thể (dùng trực tiếp, không cần hook). */
export function densityClass(d: Density): DensityClasses {
  return DENSITY_CLASSES[d];
}

/** Hook tiện lợi: trả density hiện tại + bộ class tương ứng. */
export function useDensityClasses(): { density: Density; classes: DensityClasses } {
  const { density } = useDensity();
  return { density, classes: DENSITY_CLASSES[density] };
}

export default DensityProvider;
