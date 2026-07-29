import * as React from "react"
import { KeyRound, Loader2, RefreshCw, Save, Settings as SettingsIcon, Wifi, WifiOff } from "lucide-react"
import { useLocation } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { type EcosystemConnectionState, useUpdateSettings } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import type { VariantProps } from "class-variance-authority"
import { FormField } from "@/components/FormField"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

// I-11-style mapping (see `lib/api.ts`'s `TRANSPORT_MODE_TONE` doc comment) — ecosystem reachability
// is a CONFIGURATION fact, not a machine safety state, so this reads through the general-purpose
// `StatusBadge` ok/info/danger/neutral tones (same ones `Settings.tsx`'s own probe result already
// uses), never the `StatusLamp` run/warn/fault/idle ramp reserved for machine operating state (spec
// §4: state colors carry ONLY machine-state meaning). `"standalone"` reads `neutral` — SM-3 makes it a
// legitimate, non-alarming default, never a warning.
const STATUS_BADGE: Record<EcosystemConnectionState["status"], BadgeStatus> = {
  standalone: "neutral",
  testing: "info",
  connected: "ok",
  failed: "danger",
}

export interface EcosystemConnectPanelProps {
  ecosystem: EcosystemConnectionState
  className?: string
}

/**
 * SM-3 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-3-brief.md) — the
 * connect/diagnose FORM content, embedded inside `EcosystemStatusWidget`'s `CollapsibleSection` below
 * (that component owns the title/status-badge header now; this is just the body). Reuses the SAME
 * server URL field + `PUT /v1/settings` + probe (`ResilienceProbe`) Settings' own connection card
 * already exposes — this is a second, task-focused entry point onto that exact same state, not a
 * parallel config surface. `ecosystem` is computed once by the caller (`useEcosystemConnection()`) and
 * passed down rather than re-subscribed here, so the status badge and this panel's own live readout
 * always agree.
 *
 * Formerly WS2-T2's full-page "connect gate" that REPLACED Dashboard/Machines' entire content whenever
 * `needsConnect` was true — SM-3 removed that gate (a customer who never connects to any ecosystem is a
 * legitimate, complete product state, not a misconfiguration to nag about) and demoted this to a plain
 * embedded body with no opinion about its own container.
 */
export function EcosystemConnectPanel({ ecosystem, className }: EcosystemConnectPanelProps) {
  const t = useT()
  const [, navigate] = useLocation()
  const updateSettings = useUpdateSettings()

  const [urlDraft, setUrlDraft] = React.useState(ecosystem.serverUrl)
  const [touched, setTouched] = React.useState(false)

  // Tracks the saved value until the operator starts editing — same "seed once, then let the user's
  // own typing win" idiom `Settings.tsx`'s `initialized` flag uses.
  React.useEffect(() => {
    if (!touched) setUrlDraft(ecosystem.serverUrl)
  }, [ecosystem.serverUrl, touched])

  const trimmed = urlDraft.trim()
  const dirty = touched && trimmed !== ecosystem.serverUrl
  const saving = updateSettings.isPending

  const handlePrimaryAction = () => {
    if (!trimmed) return
    if (dirty) {
      updateSettings.mutate(
        { serverUrl: trimmed },
        {
          onSuccess: () => {
            setTouched(false)
            ecosystem.retry()
          },
        }
      )
    } else {
      ecosystem.retry()
    }
  }

  const primaryPending = dirty ? saving : ecosystem.isRetrying
  const primaryLabel = dirty
    ? saving
      ? t("ecosystemConnect.saving")
      : t("ecosystemConnect.saveAndTestBtn")
    : ecosystem.isRetrying
      ? t("ecosystemConnect.retrying")
      : t("ecosystemConnect.retryBtn")
  const PrimaryIcon = dirty ? Save : RefreshCw

  return (
    <div className={className ?? "flex flex-col gap-4"}>
      <div className="flex items-start gap-3 border border-border-strong bg-surface-muted px-3 py-2.5">
        {ecosystem.status === "failed" ? (
          <WifiOff className="mt-0.5 size-4 shrink-0 text-danger-text" aria-hidden="true" />
        ) : (
          <Wifi className="mt-0.5 size-4 shrink-0 text-info-text" aria-hidden="true" />
        )}
        <p className="text-sm text-text-body">
          {ecosystem.status === "failed" ? t("ecosystemConnect.descriptionFailed") : t("ecosystemConnect.description")}
        </p>
      </div>

      <FormField
        label={t("settings.connection.serverUrlLabel")}
        htmlFor="ecosystem-connect-server-url"
        hint={
          ecosystem.status === "standalone"
            ? t("ecosystemConnect.emptyUrlHint")
            : ecosystem.status === "failed"
              ? t("ecosystemConnect.failedHint")
              : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="ecosystem-connect-server-url"
            value={urlDraft}
            onChange={(e) => {
              setTouched(true)
              setUrlDraft(e.target.value)
            }}
            placeholder="http://localhost:5000"
            className="min-w-0 flex-1 font-mono"
          />
          <Button type="button" onClick={handlePrimaryAction} disabled={!trimmed || primaryPending}>
            {primaryPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <PrimaryIcon className="size-3.5" aria-hidden="true" />
            )}
            {primaryLabel}
          </Button>
        </div>
      </FormField>

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => navigate("/onboarding")}>
          <KeyRound className="size-3.5" aria-hidden="true" />
          {t("ecosystemConnect.registerCta")}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate("/settings")}>
          <SettingsIcon className="size-3.5" aria-hidden="true" />
          {t("ecosystemConnect.settingsCta")}
        </Button>
      </div>
    </div>
  )
}

export interface EcosystemStatusWidgetProps {
  ecosystem: EcosystemConnectionState
  className?: string
}

/**
 * SM-3 — where connection status now lives on Dashboard/Machines: a small, collapsed-by-default
 * disclosure (never rendered outside Live mode — Demo's fabricated fleet has nothing to connect to, and
 * this must stay pixel-identical to before in Demo, see `14-ecosystem-connect.spec.ts`) carrying a
 * status badge in its own header, so the connection state is always VISIBLE without consuming space,
 * and the connect/diagnose form (`EcosystemConnectPanel`) is always reachable one click away.
 *
 * Auto-expands (`forceOpenWhen`, not just `defaultOpen`) exactly when `status === "failed"` — a real,
 * diagnosable problem shouldn't require an extra click to even notice — while `"standalone"`/
 * `"connected"`/`"testing"` stay collapsed: unobtrusive, not a failure. This widget is a long-lived
 * instance (mode/settings polling re-renders it, never remounts it), and the FIRST render after mount
 * is almost always `"testing"` (the reachability probe is inherently async) — `defaultOpen` alone (read
 * once, at mount) would silently miss the far more common case of failing AFTER that first render.
 * `forceOpenWhen` is what actually catches that: see `CollapsibleSection`'s own remarks.
 */
export function EcosystemStatusWidget({ ecosystem, className }: EcosystemStatusWidgetProps) {
  const t = useT()
  const gloss = useGloss()

  if (!ecosystem.loaded || ecosystem.mode !== "Live") return null

  // `hasConnectionIssue` (not a re-derived `status === "failed"`) is the hook's own single source of
  // truth for "worth a caller's attention" — see its own doc comment in lib/api.ts.
  const isFailed = ecosystem.hasConnectionIssue

  return (
    <CollapsibleSection
      title={t("ecosystemConnect.title")}
      titleEn={gloss("ecosystemConnect.title")}
      icon={isFailed ? WifiOff : Wifi}
      defaultOpen={isFailed}
      forceOpenWhen={isFailed}
      badge={
        <StatusBadge status={STATUS_BADGE[ecosystem.status]} pulse={ecosystem.status === "testing"}>
          {t(`ecosystemConnect.status.${ecosystem.status}`)}
        </StatusBadge>
      }
      className={className}
    >
      <EcosystemConnectPanel ecosystem={ecosystem} />
    </CollapsibleSection>
  )
}
