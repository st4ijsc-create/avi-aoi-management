/**
 * Edition tRPC router — SYNAPSE §4 / ADR-007 (doc 33 F1). READ-ONLY.
 *
 * Exposes the resolved deployment profile (edition + infra) and the edition catalogue so
 * the client can render an honest edition badge / upgrade path. No mutations: the edition
 * is decided by deployment env + license, not by an API call.
 */
import { router, protectedProcedure } from "../_core/trpc";
import { resolveDeploymentProfile } from "../_core/deploymentProfile";
import { getEdition, listEditions } from "@shared/editions";

export const editionRouter = router({
  /** Current deployment profile + the active edition descriptor. */
  current: protectedProcedure.query(() => {
    const profile = resolveDeploymentProfile();
    return {
      profile,
      edition: getEdition(profile.edition),
    };
  }),

  /** Full edition catalogue in upgrade order (machine → line → site). */
  list: protectedProcedure.query(() => {
    return { editions: listEditions() };
  }),
});
