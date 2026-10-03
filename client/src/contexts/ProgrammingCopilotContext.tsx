/**
 * doc 41 (2026-07-11) — PROGRAMMING COPILOT context.
 *
 * Turns the Programming Copilot into a persistent EXTENSION (the "Claude-in-VS-Code" model)
 * instead of a standalone destination. Each programming surface (Engineering Workspace / IR Editor
 * / POU Studio) PUBLISHES a binding via useCopilotBinding(...) and renders the Copilot INSIDE its own
 * layout (doc 81 Đợt 2 Task 13/14, R-2-b: inspector phải, lõi dùng chung `ProgrammingCopilotCore`). The top-bar AI
 * button (`ShellAiButton`) reads the binding to switch into Copilot mode and toggles `open` (= the Copilot tab).
 * The former app-root fixed dock (`ProgrammingCopilotDock`) was removed in Task 14.
 *
 * Open/closed state is persisted (localStorage) so the panel feels persistent across navigation.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";
import type { CopilotKind } from "@/components/programming/ProgrammingCopilotPanel";

export interface CopilotDiagnostic {
  message: string;
  severity?: "error" | "warn" | "info";
  /** optional origin tag, e.g. "lint" / "build" / "validate" */
  source?: string;
}

export interface CopilotBinding {
  /** Prefill the program kind from the host (project.kind / device type). */
  kind?: CopilotKind;
  /** Prefill the RAG vendor scope from the host (machine vendor). */
  vendor?: string;
  /** Host editor buffer (text editors) OR the transpiled preview (structured) — advisory context. */
  code?: string;
  /** Latest host diagnostics (build / lint / validate) → inline "explain / fix" actions. */
  diagnostics?: CopilotDiagnostic[];
  /** Present ONLY for text editors: insert generated code back into the host buffer. */
  onApply?: (code: string) => void;
  /**
   * G2-D — REPLACE the host buffer with an exact string (byte-for-byte). Separate from
   * `onApply` on purpose: hosts are free to give `onApply` their own semantics (Engineering
   * Workspace APPENDS), whereas per-hunk apply needs "the buffer is now EXACTLY this" or the
   * hunk coordinates stop meaning anything. A host that omits it keeps today's behaviour and
   * simply gets no per-hunk surface.
   */
  onApplyText?: (text: string) => void;
  /** Short host name shown in the header (e.g. "IR Editor"). */
  surfaceLabel?: string;
  /**
   * doc 81 Đợt 2 Task 15 — CHẾ ĐỘ SCRATCH của IDE (trang `/programming-copilot` cũ): chưa mở dự án nào ⇒ không có
   * buffer chủ (không `onApply`, không "Đồng bộ từ editor"); kết quả chỉ để xem/sao chép như trang cũ.
   */
  scratch?: boolean;
}

interface ProgrammingCopilotContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  openDock: () => void;
  closeDock: () => void;
  binding: CopilotBinding | null;
  setBinding: (b: CopilotBinding | null) => void;
  clearBinding: () => void;
}

const Ctx = createContext<ProgrammingCopilotContextValue | null>(null);
const STORAGE_KEY = "progCopilotDock.open";

export function ProgrammingCopilotProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [binding, setBindingState] = useState<CopilotBinding | null>(null);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);
  const openDock = useCallback(() => setOpen(true), [setOpen]);
  const closeDock = useCallback(() => setOpen(false), [setOpen]);
  const setBinding = useCallback((b: CopilotBinding | null) => setBindingState(b), []);
  const clearBinding = useCallback(() => setBindingState(null), []);

  const value = useMemo<ProgrammingCopilotContextValue>(
    () => ({ open, setOpen, openDock, closeDock, binding, setBinding, clearBinding }),
    [open, setOpen, openDock, closeDock, binding, setBinding, clearBinding],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProgrammingCopilot(): ProgrammingCopilotContextValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useProgrammingCopilot must be used within a ProgrammingCopilotProvider");
  return c;
}

/**
 * Publish this surface's binding (top-bar AI button + the host's in-layout Copilot); auto-clears on unmount. Pass a factory + deps
 * (like useMemo) so the binding — including its onApply closure — is rebuilt only when the
 * relevant editor state changes, avoiding render loops.
 */
export function useCopilotBinding(factory: () => CopilotBinding | null, deps: DependencyList) {
  const { setBinding, clearBinding } = useProgrammingCopilot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memo = useMemo(factory, deps);
  useEffect(() => {
    setBinding(memo);
    return () => clearBinding();
  }, [memo, setBinding, clearBinding]);
}
