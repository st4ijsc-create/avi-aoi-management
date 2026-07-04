/**
 * U1 (doc 26) — <EngineeringProvider> / useEngineering(): store nhẹ giữ ĐỐI TƯỢNG
 * đang chọn gần nhất trong module "Kỹ thuật & Điều khiển" (project / thiết bị /
 * workflow). Đây là FALLBACK cho deep-link query param: khi mở một trang golden-thread
 * mà URL không mang ?projectId / ?ref / ?machineId, trang sẽ tự chọn lại theo giá trị
 * gần nhất người dùng đang làm việc — thay vì mở ra trống.
 *
 * Deep-link query VẪN là nguồn chính (xem lib/engineeringDeepLink.ts). Store này chỉ đỡ
 * cho các điều hướng trơn (menu, breadcrumb) không kèm param.
 *
 * Theo đúng pattern SiteContext: có default INERT nên useEngineering() an toàn khi không
 * có provider (không throw); selection được PERSIST vào localStorage để sống qua reload.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export interface EngineeringSelection {
  /** programming project đang mở (Engineering / IR / POU). */
  projectId: number | null;
  /** thiết bị đang thao tác. */
  machineId: number | null;
  /** orchestration workflow ref đang mở (→ Cell Twin / RF). */
  workflowRef: string | null;
}

export interface EngineeringContextValue {
  lastSelected: EngineeringSelection;
  setLastProjectId: (id: number | null) => void;
  setLastMachineId: (id: number | null) => void;
  setLastWorkflowRef: (ref: string | null) => void;
}

const EMPTY: EngineeringSelection = { projectId: null, machineId: null, workflowRef: null };

/** Inert default → useEngineering() an toàn khi chưa mount provider. */
const DEFAULT_VALUE: EngineeringContextValue = {
  lastSelected: EMPTY,
  setLastProjectId: () => {},
  setLastMachineId: () => {},
  setLastWorkflowRef: () => {},
};

const EngineeringContext = createContext<EngineeringContextValue>(DEFAULT_VALUE);

const STORAGE_KEY = "engineering-last-selected";

function readStored(): EngineeringSelection {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<EngineeringSelection>;
    return {
      projectId: typeof p.projectId === "number" ? p.projectId : null,
      machineId: typeof p.machineId === "number" ? p.machineId : null,
      workflowRef: typeof p.workflowRef === "string" ? p.workflowRef : null,
    };
  } catch {
    return EMPTY;
  }
}

export function EngineeringProvider({ children }: { children: React.ReactNode }) {
  const [lastSelected, setLastSelected] = useState<EngineeringSelection>(() => readStored());

  const persist = useCallback((next: EngineeringSelection) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — chỉ giữ trong bộ nhớ */
    }
  }, []);

  const setLastProjectId = useCallback((id: number | null) => {
    setLastSelected((prev) => {
      if (prev.projectId === id) return prev;
      const next = { ...prev, projectId: id };
      persist(next);
      return next;
    });
  }, [persist]);

  const setLastMachineId = useCallback((id: number | null) => {
    setLastSelected((prev) => {
      if (prev.machineId === id) return prev;
      const next = { ...prev, machineId: id };
      persist(next);
      return next;
    });
  }, [persist]);

  const setLastWorkflowRef = useCallback((ref: string | null) => {
    setLastSelected((prev) => {
      if (prev.workflowRef === ref) return prev;
      const next = { ...prev, workflowRef: ref };
      persist(next);
      return next;
    });
  }, [persist]);

  const value = useMemo<EngineeringContextValue>(
    () => ({ lastSelected, setLastProjectId, setLastMachineId, setLastWorkflowRef }),
    [lastSelected, setLastProjectId, setLastMachineId, setLastWorkflowRef],
  );

  return <EngineeringContext.Provider value={value}>{children}</EngineeringContext.Provider>;
}

/** Truy cập selection gần nhất. An toàn khi không có provider (trả về inert default). */
export function useEngineering(): EngineeringContextValue {
  return useContext(EngineeringContext);
}

export default EngineeringContext;
