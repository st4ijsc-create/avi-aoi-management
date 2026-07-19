import { RefreshCw } from "lucide-react"
import type { VariantProps } from "class-variance-authority"

import { useSyncConfig } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

/** Raw `ConfigSyncResult.DriftState` token → badge tone. `"synced" | "none" | "error"` in this build
 * (`DemoTransport`/`LiveTransport`) but treated as an open vocabulary — an unrecognized token still
 * renders (as `info`, "something happened, no verdict on whether it's good") rather than crashing. */
function driftTone(driftState: string | null): BadgeStatus {
  if (driftState === "error") return "danger"
  if (driftState === "synced") return "ok"
  if (driftState === "none") return "neutral"
  return "info"
}

interface ConfigSyncPanelProps {
  code: string
  driftState: string
  className?: string
}

/** "Sync recipe" — fires `POST /v1/machines/{code}/sync-config` and shows what came back. Available on
 * every device class (Automation/IoT/AOI all pull recipe/mapping config the same way). */
export function ConfigSyncPanel({ code, driftState, className }: ConfigSyncPanelProps) {
  const syncConfig = useSyncConfig(code)
  const result = syncConfig.data

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-text-strong">Recipe / config sync</h3>
            <p className="text-sm text-text-muted">
              Pull the latest recipe and mapping config for this machine from the server, and report
              whether anything changed.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle px-3 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                Current state
              </span>
              <span className="font-numeric text-sm text-text-body">{driftState}</span>
            </div>
            <Button size="sm" onClick={() => syncConfig.mutate()} disabled={syncConfig.isPending}>
              <RefreshCw className={cn("size-3.5", syncConfig.isPending && "animate-spin")} aria-hidden="true" />
              {syncConfig.isPending ? "Syncing…" : "Sync recipe"}
            </Button>
          </div>

          {syncConfig.isError ? (
            <p role="alert" className="text-sm text-danger-text">
              Sync failed: {syncConfig.error instanceof Error ? syncConfig.error.message : "unknown error"}
            </p>
          ) : null}

          {result ? (
            <div className="flex flex-col gap-2.5 rounded-lg border border-border p-3" role="status">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-muted">Last sync result</span>
                <StatusBadge status={driftTone(result.driftState)}>{result.driftState ?? "—"}</StatusBadge>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-muted">Changed</dt>
                  <dd className="font-numeric font-medium text-text-strong">{result.changed ? "Yes" : "No"}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-muted">Version</dt>
                  <dd className="font-numeric font-medium text-text-strong">{result.version ?? "—"}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-muted">Applied</dt>
                  <dd className="font-numeric font-medium text-text-strong">{result.applied ? "Yes" : "No"}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
