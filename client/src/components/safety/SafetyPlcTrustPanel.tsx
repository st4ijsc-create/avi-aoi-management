/**
 * doc 81 Đợt 8 task N fix 1 (owner decision I1, item 5) — MAKER-CHECKER approval of REAL safety-PLC configs, on the
 * existing Safety page (side panel, under the safety SOURCE panel).
 *
 * A real (modbus / opcua) config's e-stop / guard trips bypass the recipients' notification opt-outs only while a SECOND
 * person (an admin who did not edit it since the last approval) approved the server digest of its exact content. Any edit
 * clears the approval; unknown provenance (legacy rows, out-of-band changes) needs two different admins (R-8-a).
 *
 * The server decides who may decide (`mayDecide`, `blockedBy` — admin role, separation of duties); this screen only shows
 * it. Approve / reject send the digest the person was SHOWN (`expectedDigest`): a change in between ⇒ CONFLICT, reload.
 * The endpoint / tag map are returned to admins only (what they approve).
 * Final wave (doc 81 Đợt 8): F2 — the review also shows the TARGET the digest covers (robot / station / line / factory /
 * scope / corporate code / enabled); N-R7 — Reject is offered on `mayReject` (the first approver may reject); F3 — when
 * the server says the trust state is unavailable (migration 0368 missing / unreadable) a notice replaces every decision.
 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../../server/routers";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type TrustRow = inferRouterOutputs<AppRouter>["safety"]["plcTrustList"][number];

const STATE_CLS: Record<TrustRow["state"], string> = {
  sim: "border-muted-foreground/40 text-muted-foreground",
  approved: "border-emerald-600/60 text-emerald-700 dark:text-emerald-400",
  pending: "border-amber-500/60 text-amber-700 dark:text-amber-400",
  awaiting_second: "border-sky-600/60 text-sky-700 dark:text-sky-400",
  rejected: "border-destructive/60 text-destructive",
};

export function SafetyPlcTrustPanel({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const titleId = useId();
  const utils = trpc.useUtils();
  const listQ = trpc.safety.plcTrustList.useQuery(undefined, { enabled, refetchInterval: 15_000 });
  const [open, setOpen] = useState<{ id: number; mode: "approve" | "reject"; digest: string } | null>(null);
  const [reason, setReason] = useState("");

  const done = () => {
    setOpen(null);
    setReason("");
    void utils.safety.plcTrustList.invalidate();
  };
  const onError = (e: unknown) => {
    toast.error(mapTrpcError(e));
    void utils.safety.plcTrustList.invalidate();
  };
  const approveM = trpc.safety.approveSafetyPlcConfig.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.complete
          ? t("safety.plcTrust.approvedToast", "Approved — this PLC's real trips are now trusted")
          : t("safety.plcTrust.firstToast", "First approval recorded — a different admin must approve too"),
      );
      done();
    },
    onError,
  });
  const rejectM = trpc.safety.rejectSafetyPlcConfig.useMutation({
    onSuccess: () => {
      toast.success(t("safety.plcTrust.rejectedToast", "Rejected — this PLC's trips stay normal notices"));
      done();
    },
    onError,
  });

  const stateLabel = (s: TrustRow["state"]) => {
    switch (s) {
      case "sim": return t("safety.plcTrust.state.sim", "SIM — never trusted");
      case "approved": return t("safety.plcTrust.state.approved", "Approved — trusted");
      case "pending": return t("safety.plcTrust.state.pending", "Not approved — normal notices");
      case "awaiting_second": return t("safety.plcTrust.state.awaitingSecond", "First approval given — awaiting a second admin");
      case "rejected": return t("safety.plcTrust.state.rejected", "Rejected — normal notices");
    }
  };
  const blockedText = (b: TrustRow["blockedBy"]) => {
    switch (b) {
      case "self": return t("safety.plcTrust.blocked.self", "You changed this config since its last approval — another admin must decide.");
      case "first_approver": return t("safety.plcTrust.blocked.firstApprover", "You gave the first approval — a different admin must give the second (you may still reject it).");
      // the section-level notice explains these two; no per-row repetition
      default: return null;
    }
  };
  const idOrDash = (v: number | string | null | undefined) => (v == null || v === "" ? "—" : String(v));

  if (!enabled) return null;
  if (listQ.isError) {
    return (
      <div data-testid="safety-plc-trust" className="rounded-md border border-destructive/40 px-3 py-2 text-xs text-muted-foreground">
        {t("safety.plcTrust.error", "Could not read the safety-PLC approvals — treat every config as NOT trusted.")}
      </div>
    );
  }
  const rows = listQ.data ?? [];
  if (rows.length === 0) return null;
  const unavailable = rows.find((r) => r.trustUnavailable)?.trustUnavailable ?? null;

  return (
    <section data-testid="safety-plc-trust" aria-labelledby={titleId} className="space-y-2 rounded-md border px-3 py-2 text-xs">
      <h3 id={titleId} className="font-semibold text-foreground">
        {t("safety.plcTrust.title", "Safety-PLC trust (maker-checker)")}
      </h3>
      <p className="text-muted-foreground">
        {t(
          "safety.plcTrust.rule",
          "A REAL safety-PLC config's e-stop / guard trips bypass notification opt-outs only after a second admin approved its exact content (digest). Any edit clears the approval; unknown provenance needs two different admins.",
        )}
      </p>
      {unavailable && (
        <div role="alert" data-testid="safety-plc-trust-unavailable" className="rounded border border-destructive/40 px-2 py-1 text-destructive">
          {unavailable === "migration_missing"
            ? t("safety.plcTrust.unavailable.migrationMissing", "Approvals are unavailable: database migration 0368 is not applied. Every real safety-PLC config is NOT trusted (normal notices) and cannot be created, edited or approved until an administrator applies it.")
            : t("safety.plcTrust.unavailable.unreadable", "The approval state cannot be read right now — every real safety-PLC config is treated as NOT trusted; no decision is possible until it can be read.")}
        </div>
      )}
      <ul className="space-y-2">
        {rows.map((r) => {
          const isOpen = open?.id === r.id;
          const blocked = blockedText(r.blockedBy);
          return (
            <li key={r.id} data-testid={`safety-plc-trust-row-${r.id}`} data-state={r.state} className="space-y-1 rounded border px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono">{r.code}</span>
                <Badge variant="outline" className="text-[10px]">{r.backend}</Badge>
                <Badge variant="outline" className={`text-[10px] ${STATE_CLS[r.state]}`} data-testid="safety-plc-trust-state">
                  {stateLabel(r.state)}
                </Badge>
                {r.state !== "sim" && (
                  <span className="font-mono text-[10px] text-muted-foreground" title={r.digest}>
                    {t("safety.plcTrust.digest", "digest")} {r.digest.slice(0, 12)}…
                  </span>
                )}
              </div>
              {r.needsTwoApprovals && r.state !== "approved" && (
                <div className="text-muted-foreground">{t("safety.plcTrust.needsTwo", "Unknown provenance — needs approvals from two different admins.")}</div>
              )}
              {blocked && <div className="text-muted-foreground" data-testid="safety-plc-trust-blocked">{blocked}</div>}
              {(r.mayDecide || r.mayReject) && r.state !== "sim" && !isOpen && (
                <div className="flex gap-2">
                  {r.mayDecide && (
                    <Button size="sm" variant="outline" onClick={() => setOpen({ id: r.id, mode: "approve", digest: r.digest })}>
                      {t("safety.plcTrust.approve", "Approve…")}
                    </Button>
                  )}
                  {r.mayReject && (
                    <Button size="sm" variant="outline" onClick={() => setOpen({ id: r.id, mode: "reject", digest: r.digest })}>
                      {t("safety.plcTrust.reject", "Reject…")}
                    </Button>
                  )}
                </div>
              )}
              {isOpen && open && (
                <div role="group" aria-label={t("safety.plcTrust.reviewAria", "Review before deciding")} className="space-y-1 rounded bg-muted/40 p-2">
                  <div>{t("safety.plcTrust.reviewDigest", "You are deciding on this exact content (server digest):")}</div>
                  <code className="block break-all font-mono text-[10px]" data-testid="safety-plc-trust-full-digest">{open.digest}</code>
                  <div data-testid="safety-plc-trust-target" className="break-all">
                    {t("safety.plcTrust.target.label", "Target (events are attributed here)")}:{" "}
                    <span className="font-mono">
                      {t("safety.plcTrust.target.robot", "robot")} {idOrDash(r.robotId)} · {t("safety.plcTrust.target.station", "station")} {idOrDash(r.stationId)} ·{" "}
                      {t("safety.plcTrust.target.line", "line")} {idOrDash(r.lineId)} · {t("safety.plcTrust.target.factory", "factory")} {idOrDash(r.factoryId)} ·{" "}
                      {t("safety.plcTrust.target.scope", "scope")} {idOrDash(r.scope)} · {t("safety.plcTrust.target.corporate", "corporate")} {idOrDash(r.corporateCode)} ·{" "}
                      {r.enabled ? t("safety.plcTrust.target.enabled", "enabled") : t("safety.plcTrust.target.disabled", "disabled")}
                    </span>
                  </div>
                  {r.endpoint && (
                    <div className="break-all">
                      {t("safety.plcTrust.endpoint", "Endpoint")}: <span className="font-mono">{r.endpoint}</span>
                    </div>
                  )}
                  {r.tags && (
                    <ul className="font-mono text-[10px]">
                      {r.tags.filter((g) => g.address).map((g) => (
                        <li key={g.flag}>{g.flag}: {g.address} ({g.dataType}, {g.activeWhen})</li>
                      ))}
                    </ul>
                  )}
                  {open.mode === "reject" && (
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t("safety.plcTrust.reasonPlaceholder", "Why is this config rejected? (required)")}
                      aria-label={t("safety.plcTrust.reasonAria", "Rejection reason")}
                      className="min-h-[60px] text-xs"
                    />
                  )}
                  <div className="flex gap-2">
                    {open.mode === "approve" ? (
                      <Button size="sm" disabled={approveM.isPending} onClick={() => approveM.mutate({ id: r.id, expectedDigest: open.digest })}>
                        {t("safety.plcTrust.confirmApprove", "Confirm approval")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={rejectM.isPending || reason.trim().length < 3}
                        onClick={() => rejectM.mutate({ id: r.id, expectedDigest: open.digest, reason: reason.trim() })}
                      >
                        {t("safety.plcTrust.confirmReject", "Confirm rejection")}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => { setOpen(null); setReason(""); }}>
                      {t("common.cancel", "Cancel")}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
