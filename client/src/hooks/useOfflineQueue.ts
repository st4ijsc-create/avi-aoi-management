/**
 * Doc 10 / U16 — React hook over the offline action queue (offlineQueue.ts).
 *
 * Gives a component a store-and-forward submit: enqueue an action; if online it flushes
 * immediately, otherwise it persists and auto-flushes when the browser fires 'online'.
 * The queue LOGIC is unit-tested in offlineQueue.unit.test.ts; this hook is the thin
 * React/DOM wrapper (online events + state).
 *
 * Usage (e.g. in QuickIssueReport / MachineQuickScan):
 *   const { online, pending, submit } = useOfflineQueue<IssuePayload>({
 *     storageKey: "offlineQueue:issues",
 *     handler: async (a) => { await submitIssue.mutateAsync(a.payload); },
 *   });
 *   // submit(payload, { dedupeKey: serial }) — sent now if online, else queued + retried.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OfflineQueue,
  flushQueue,
  localStorageQueueStorage,
  type QueuedAction,
} from "@/lib/offlineQueue";

export interface UseOfflineQueueOptions<P> {
  /** Replays a queued action against the server. Throw to keep it queued for retry. */
  handler: (action: QueuedAction<P>) => Promise<void>;
  /** Distinct localStorage slot per action kind (default "offlineQueue:v1"). */
  storageKey?: string;
  /** A logical kind label stored on each action (default "action"). */
  kind?: string;
  maxAttempts?: number;
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useOfflineQueue<P = unknown>(opts: UseOfflineQueueOptions<P>) {
  const { handler, storageKey = "offlineQueue:v1", kind = "action", maxAttempts = 5 } = opts;

  const queue = useMemo(
    () => new OfflineQueue(localStorageQueueStorage(storageKey), { maxAttempts }),
    [storageKey, maxAttempts],
  );
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const [online, setOnline] = useState<boolean>(isOnline());
  const [pending, setPending] = useState<number>(() => queue.size());

  const flush = useCallback(async () => {
    if (!isOnline()) return;
    await flushQueue(queue, (a) => handlerRef.current(a as QueuedAction<P>));
    setPending(queue.size());
  }, [queue]);

  useEffect(() => {
    const goOnline = () => { setOnline(true); void flush(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Attempt a flush on mount in case items were left from a previous session.
    void flush();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flush]);

  /** Queue (and, if online, immediately send) an action. */
  const submit = useCallback(
    (payload: P, o: { dedupeKey?: string } = {}) => {
      queue.enqueue(kind, payload, o);
      setPending(queue.size());
      if (isOnline()) void flush();
    },
    [queue, kind, flush],
  );

  return { online, pending, submit, flush, queue };
}

export default useOfflineQueue;
