/**
 * Final-fix round (Important-2) — KbStudioPage.tsx used to pass
 * `statusQuery.data?.allowedTypes ?? ["pdf", "docx", "md", "txt"]` straight into `<SourceTab>`.
 * That hand-typed fallback is EXACTLY the list a prior round claimed was deleted (Task 6, review
 * round 2 — see sourceTabLogic.ts's `formatAllowedTypesLabel` header) — it just moved one level
 * up. The server's REAL `allowedTypes` (kbIngestRouter.ts:105) is
 * `["pdf","docx","md","txt","png","jpg","jpeg","webp"]` — 4 image extensions the fallback omits.
 *
 * While `statusQuery` is loading — or PERMANENTLY, if it errors (it's `kbStudioProcedure`,
 * which requires a still-valid 2FA step-up; a lapsed session surfaces as a FORBIDDEN error, not
 * a fast resolve) — a user would see "pdf, docx, md, txt", NOT the "images are AI-described"
 * hint, and the file picker's `accept` attribute would filter out images entirely. Meanwhile
 * drag-and-drop still sends images and the server still accepts them: the UI claims a narrower
 * contract than the system actually honors.
 *
 * `resolveSourceTabState` is the pure decision this bug needed: NEVER fabricate an
 * `allowedTypes` list. Loading and error are their own explicit states — the caller (
 * KbStudioPage.tsx) renders honest UI for each instead of quietly falling back to a guess.
 */
import type { SourceTabProps } from "./SourceTab";
import { mapTrpcError } from "@/lib/trpcErrors";

export interface KbIngestStatusQuery {
  isError: boolean;
  /** react-query's `data` — undefined until the first successful resolve. */
  data:
    | {
        enabled: boolean;
        webIngestEnabled: boolean;
        maxUploadBytes: number;
        allowedTypes: readonly string[];
      }
    | undefined;
  /** Raw error object (react-query's `.error`) — only read when `isError` is true. */
  error?: unknown;
}

export type SourceTabRenderState =
  | { kind: "loading" }
  | { kind: "error"; message: string | undefined }
  | { kind: "ready"; props: SourceTabProps };

/**
 * Decide what the Source tab should render from the LIVE `trpc.kbIngest.status` query state —
 * never a client-guessed default. `isError` wins over a stale/absent `data` (react-query can
 * hand back a previous success's `data` alongside a NEW error on refetch-failure; this function
 * only sees the shape it's given, so callers should pass the CURRENT query snapshot, not a
 * cached one) so a real server error is never silently masked by a fallback list.
 */
export function resolveSourceTabState(status: KbIngestStatusQuery): SourceTabRenderState {
  if (status.isError) {
    return {
      kind: "error",
      message: status.error instanceof Error ? mapTrpcError(status.error) : undefined,
    };
  }
  if (!status.data) {
    return { kind: "loading" };
  }
  const { enabled, webIngestEnabled, maxUploadBytes, allowedTypes } = status.data;
  return { kind: "ready", props: { enabled, webIngestEnabled, maxUploadBytes, allowedTypes } };
}
