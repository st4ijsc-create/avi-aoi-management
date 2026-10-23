/**
 * Toast storm gate — at most `max` individual toasts per sliding `windowMs`; the rest are counted so the caller can
 * show ONE summary toast instead. Nothing is dropped from the notification list: the gate only decides whether an
 * alert ALSO gets its own toast.
 *
 * Measured 2026-10-23 on :3000: 220–343 critical toasts per page load ⇒ 2,745 toast DOM nodes, 460 running animations,
 * main thread 100 % for > 60 s, 3D at 10–19 fps with 818 ms frames.
 */
export type ToastGateDecision = { show: true } | { show: false; heldBack: number };

export function createToastStormGate(opts: { max?: number; windowMs?: number } = {}) {
  const max = opts.max ?? 3;
  const windowMs = opts.windowMs ?? 10_000;
  let shownAt: number[] = [];
  let heldBack = 0;
  return {
    admit(now: number): ToastGateDecision {
      shownAt = shownAt.filter((t) => now - t < windowMs);
      if (shownAt.length === 0) heldBack = 0;
      if (shownAt.length < max) {
        shownAt.push(now);
        return { show: true };
      }
      heldBack += 1;
      return { show: false, heldBack };
    },
  };
}
