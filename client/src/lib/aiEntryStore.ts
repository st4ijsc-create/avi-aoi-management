/**
 * Doc 81 Đợt 2 Task 2 — MỘT lối vào AI mỗi ngữ cảnh.
 *
 * Bong bóng chat (`AILocalChatBubble`) và dock Copilot (`ProgrammingCopilotDock`) gắn ở GỐC `App.tsx`,
 * NGOÀI shell; nút AI nằm TRONG top bar của shell. Store nhỏ này nối hai phía:
 *   · `headerEntries` — số nút AI top bar đang mount. >0 ⇒ bong bóng bỏ nút nổi (che MAIN) và mở thành
 *     sheet phải dưới top bar; dock bỏ tab dọc nổi. =0 (trang không có shell) ⇒ giữ lối vào cũ.
 *   · `chatOpen` — sheet chat đang mở (nút top bar và bong bóng dùng CHUNG một trạng thái).
 * `useSyncExternalStore` ⇒ không cần Provider (bong bóng nằm ngoài cây shell).
 */
import { useSyncExternalStore } from "react";

export interface AiEntryState {
  headerEntries: number;
  chatOpen: boolean;
}

let state: AiEntryState = { headerEntries: 0, chatOpen: false };
const listeners = new Set<() => void>();

function emit(next: AiEntryState): void {
  state = next;
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getAiEntryState(): AiEntryState {
  return state;
}

/** Nút AI top bar gọi khi mount; trả hàm huỷ đăng ký. */
export function registerAiHeaderEntry(): () => void {
  emit({ ...state, headerEntries: state.headerEntries + 1 });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    emit({ ...state, headerEntries: Math.max(0, state.headerEntries - 1) });
  };
}

export function setAiChatOpen(open: boolean): void {
  if (state.chatOpen === open) return;
  emit({ ...state, chatOpen: open });
}

export function toggleAiChat(): void {
  emit({ ...state, chatOpen: !state.chatOpen });
}

export function useAiEntry(): AiEntryState {
  return useSyncExternalStore(subscribe, getAiEntryState, getAiEntryState);
}

/** CHỈ cho test. */
export function resetAiEntryForTest(): void {
  emit({ headerEntries: 0, chatOpen: false });
}
