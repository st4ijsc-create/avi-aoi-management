/**
 * C3a — AiCopilotContext
 *
 * Lightweight React context that lets individual pages publish the entity the
 * user is currently looking at (machine / product model / lot). The global
 * AILocalChatBubble reads this selection and sends it (together with the current
 * route and UI language) as an OPTIONAL `context` field in the ask/stream
 * payload, so the backend can pre-fill read-tool arguments (e.g. "máy này sao
 * rồi?" → use the selected machineCode) and lightly boost route-related KB.
 *
 * Design notes:
 *  - Only a small, whitelisted "selection" is stored. Codes (strings) are
 *    preferred over numeric ids because the tools accept machineCode/orderCode.
 *  - Pages register their selection via useSetCopilotContext() inside a
 *    useEffect; the registration is purely additive — pages that don't
 *    integrate simply leave the selection empty (backward-compatible).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface CopilotSelection {
  selectedMachineId?: number;
  selectedMachineCode?: string;
  selectedProductModelId?: number;
  selectedProductCode?: string;
  selectedLot?: string;
}

/**
 * GĐ3a Mục 5 — prefill channel. The chat bubble publishes a {route, values}
 * directive (from a `client_action` of kind prefill_form); pages that opt-in
 * subscribe via useCopilotPrefill() and apply matching values to their form.
 */
export interface CopilotPrefill {
  route: string;
  values: Record<string, unknown>;
  /** Monotonic id so a repeated prefill for the same route still fires. */
  nonce: number;
}

interface AiCopilotContextValue {
  selection: CopilotSelection;
  setSelection: (next: CopilotSelection) => void;
  clearSelection: () => void;
  /** Latest prefill directive (null until one is published). */
  prefill: CopilotPrefill | null;
  /** Publish a prefill directive (called by the chat bubble). */
  publishPrefill: (route: string, values: Record<string, unknown>) => void;
}

const AiCopilotContext = createContext<AiCopilotContextValue | null>(null);

export function AiCopilotProvider({ children }: { children: ReactNode }) {
  const [selection, setSelectionState] = useState<CopilotSelection>({});

  const setSelection = useCallback((next: CopilotSelection) => {
    // Replace with only the defined fields so stale values don't linger.
    const cleaned: CopilotSelection = {};
    if (next.selectedMachineId != null) cleaned.selectedMachineId = next.selectedMachineId;
    if (next.selectedMachineCode) cleaned.selectedMachineCode = next.selectedMachineCode;
    if (next.selectedProductModelId != null) cleaned.selectedProductModelId = next.selectedProductModelId;
    if (next.selectedProductCode) cleaned.selectedProductCode = next.selectedProductCode;
    if (next.selectedLot) cleaned.selectedLot = next.selectedLot;
    setSelectionState((prev) => {
      // Avoid pointless re-renders when nothing changed.
      const same =
        prev.selectedMachineId === cleaned.selectedMachineId &&
        prev.selectedMachineCode === cleaned.selectedMachineCode &&
        prev.selectedProductModelId === cleaned.selectedProductModelId &&
        prev.selectedProductCode === cleaned.selectedProductCode &&
        prev.selectedLot === cleaned.selectedLot;
      return same ? prev : cleaned;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectionState({}), []);

  const [prefill, setPrefill] = useState<CopilotPrefill | null>(null);
  const nonceRef = useRef(0);
  const publishPrefill = useCallback((route: string, values: Record<string, unknown>) => {
    nonceRef.current += 1;
    setPrefill({ route, values, nonce: nonceRef.current });
  }, []);

  const value = useMemo(
    () => ({ selection, setSelection, clearSelection, prefill, publishPrefill }),
    [selection, setSelection, clearSelection, prefill, publishPrefill],
  );

  return <AiCopilotContext.Provider value={value}>{children}</AiCopilotContext.Provider>;
}

/**
 * Read the current copilot selection + setter. Returns a no-op fallback when
 * used outside the provider so it never throws (keeps pages decoupled/safe).
 */
export function useAiCopilotContext(): AiCopilotContextValue {
  const ctx = useContext(AiCopilotContext);
  if (ctx) return ctx;
  return {
    selection: {},
    setSelection: () => {},
    clearSelection: () => {},
    prefill: null,
    publishPrefill: () => {},
  };
}

/**
 * GĐ3a Mục 5 — page hook: subscribe to copilot prefill directives for a given
 * route. The callback fires whenever a new prefill targeting `route` arrives.
 *
 * Example:
 *   useCopilotPrefill("/products", (values) => form.reset(values));
 */
export function useCopilotPrefill(
  route: string,
  onPrefill: (values: Record<string, unknown>) => void,
): void {
  const { prefill } = useAiCopilotContext();
  const cbRef = useRef(onPrefill);
  cbRef.current = onPrefill;
  const lastNonce = useRef(0);
  useEffect(() => {
    if (prefill && prefill.route === route && prefill.nonce !== lastNonce.current) {
      lastNonce.current = prefill.nonce;
      cbRef.current(prefill.values);
    }
  }, [prefill, route]);
}

/**
 * Convenience hook for pages: register the entity the user is viewing.
 * Call inside a useEffect with the relevant dependencies; pass `null`/empty to
 * clear. Stable identity is handled by the provider.
 *
 * Example:
 *   const setCopilot = useSetCopilotContext();
 *   useEffect(() => {
 *     setCopilot({ selectedMachineId: id, selectedMachineCode: code });
 *   }, [id, code, setCopilot]);
 */
export function useSetCopilotContext(): (next: CopilotSelection) => void {
  const { setSelection, clearSelection } = useAiCopilotContext();
  const ref = useRef({ setSelection, clearSelection });
  ref.current = { setSelection, clearSelection };
  return useCallback((next: CopilotSelection) => {
    const hasAny =
      next.selectedMachineId != null ||
      next.selectedMachineCode ||
      next.selectedProductModelId != null ||
      next.selectedProductCode ||
      next.selectedLot;
    if (hasAny) ref.current.setSelection(next);
    else ref.current.clearSelection();
  }, []);
}
