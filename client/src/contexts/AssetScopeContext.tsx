/**
 * doc 64 IA-10 S0.1 — AssetScopeProvider: TRỤC PHẠM VI ISA-95 bền vững ở tầng vỏ.
 *
 * Nguồn sự thật cho phạm vi tài sản (Xưởng → Chuyền → Máy) SỐNG QUA ĐIỀU HƯỚNG:
 *   • persist localStorage (`asset-scope-axis.v1`) — đổi trang không mất scope;
 *   • URL param (useScope/ScopeFilterBar) vẫn THẮNG khi có (link chia sẻ được);
 *   • cascade-clear: đổi Xưởng → xoá Chuyền+Máy; đổi Chuyền → xoá Máy (không bao
 *     giờ giữ con mồ côi khác cha);
 *   • labels đi kèm id để chip/breadcrumb hiển thị TÊN vật lý, không phải số.
 *
 * BẤT BIẾN TRUNG THỰC (P2/doc63): trang CHƯA wire useScope() không được ngầm-toàn-cục
 * — `wiredCount` cho DashboardLayout biết trang hiện tại có đọc scope hay không, để
 * chip hiển thị "chưa lọc theo phạm vi" khi trục có selection mà trang không dùng.
 * Q2 (user 2026-07-19): default = TOÀN NHÀ MÁY (không auto theo assignment).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export interface AxisScope {
  factoryId?: number;
  lineId?: number;
  machineId?: number;
}
export interface AxisLabels {
  factory?: string;
  line?: string;
  machine?: string;
}

interface AssetScopeValue {
  axis: AxisScope;
  labels: AxisLabels;
  /** Patch axis (undefined xoá cấp đó). Tự cascade-clear con khi cha đổi. */
  setAxis: (patch: Partial<AxisScope>, labels?: Partial<AxisLabels>) => void;
  clearAxis: () => void;
  /** Số "trang đã wire" đang mount (0 = trang hiện tại chưa đọc scope). */
  wiredCount: number;
  /** Nội bộ — useScopeWired() đăng ký/huỷ. */
  _registerWired: () => () => void;
}

const DEFAULT_VALUE: AssetScopeValue = {
  axis: {},
  labels: {},
  setAxis: () => {},
  clearAxis: () => {},
  wiredCount: 0,
  _registerWired: () => () => {},
};

const AssetScopeContext = createContext<AssetScopeValue>(DEFAULT_VALUE);

const STORAGE_KEY = "asset-scope-axis.v1";

function readStored(): { axis: AxisScope; labels: AxisLabels } {
  if (typeof window === "undefined") return { axis: {}, labels: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { axis: {}, labels: {} };
    const j = JSON.parse(raw) as { axis?: AxisScope; labels?: AxisLabels };
    return { axis: j.axis ?? {}, labels: j.labels ?? {} };
  } catch {
    return { axis: {}, labels: {} };
  }
}

export function AssetScopeProvider({ children }: { children: React.ReactNode }) {
  const initial = useRef(readStored());
  const [axis, setAxisState] = useState<AxisScope>(initial.current.axis);
  const [labels, setLabels] = useState<AxisLabels>(initial.current.labels);
  const [wiredCount, setWiredCount] = useState(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ axis, labels }));
    } catch {
      /* storage unavailable — in-memory only */
    }
  }, [axis, labels]);

  const setAxis = useCallback((patch: Partial<AxisScope>, labelPatch?: Partial<AxisLabels>) => {
    setAxisState((prev) => {
      const next: AxisScope = { ...prev };
      const lab: AxisLabels = {};
      // Cascade: cha đổi → con xoá (không giữ con mồ côi).
      if ("factoryId" in patch) {
        if (patch.factoryId === undefined) delete next.factoryId; else next.factoryId = patch.factoryId;
        delete next.lineId; delete next.machineId;
        lab.line = undefined; lab.machine = undefined;
      }
      if ("lineId" in patch) {
        if (patch.lineId === undefined) delete next.lineId; else next.lineId = patch.lineId;
        delete next.machineId;
        lab.machine = undefined;
      }
      if ("machineId" in patch) {
        if (patch.machineId === undefined) delete next.machineId; else next.machineId = patch.machineId;
      }
      setLabels((prevLab) => {
        const merged = { ...prevLab, ...lab, ...(labelPatch ?? {}) };
        for (const k of ["factory", "line", "machine"] as const) {
          if (merged[k] === undefined) delete merged[k];
        }
        return merged;
      });
      return next;
    });
  }, []);

  const clearAxis = useCallback(() => {
    setAxisState({});
    setLabels({});
  }, []);

  const _registerWired = useCallback(() => {
    setWiredCount((n) => n + 1);
    return () => setWiredCount((n) => Math.max(0, n - 1));
  }, []);

  const value = useMemo<AssetScopeValue>(
    () => ({ axis, labels, setAxis, clearAxis, wiredCount, _registerWired }),
    [axis, labels, setAxis, clearAxis, wiredCount, _registerWired],
  );

  return <AssetScopeContext.Provider value={value}>{children}</AssetScopeContext.Provider>;
}

/** Đọc trục phạm vi. An toàn khi không có provider (giá trị trơ). */
export function useAssetScope(): AssetScopeValue {
  return useContext(AssetScopeContext);
}

/**
 * Trang ĐÃ wire scope gọi hook này (1 dòng) để tự khai báo với vỏ — chip chuyển
 * từ "chưa lọc theo phạm vi" sang "Phạm vi: <đường vật lý>".
 */
export function useScopeWired(): void {
  const { _registerWired } = useAssetScope();
  useEffect(() => _registerWired(), [_registerWired]);
}

export default AssetScopeContext;
