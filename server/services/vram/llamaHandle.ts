/**
 * Cầu nối tới thể hiện llama đang sống, tách riêng để đầu dò mock được trong test
 * mà không phải nạp cả aiGgufEngine (2.712 dòng).
 */
let handle: { getVramState?: () => Promise<{ used: number; total: number }> } | null = null;

export function setLlamaInstanceHandle(h: typeof handle): void { handle = h; }
export function getLlamaInstanceIfReady(): typeof handle { return handle; }
