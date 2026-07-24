import * as React from "react"
import { motion } from "framer-motion"
import { KeyRound, Loader2, RefreshCw, Save, Settings as SettingsIcon, Wifi, WifiOff } from "lucide-react"
import { useLocation } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { type EcosystemConnectionState, useUpdateSettings } from "@/lib/api"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
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
// §4: state colors carry ONLY machine-state meaning).
const STATUS_BADGE: Record<EcosystemConnectionState["status"], BadgeStatus> = {
  idle: "neutral",
  testing: "info",
  connected: "ok",
  failed: "danger",
}

export interface EcosystemConnectPanelProps {
  ecosystem: EcosystemConnectionState
  className?: string
}

/**
 * WS2-T2 (docs/PRODUCTION_UI_DESIGN.md §2.4) — the first-run "connect to ecosystem" experience Live
 * mode's fleet-dependent screens (Dashboard/Machines) show instead of an empty/meaningless local
 * fleet grid whenever this deployment hasn't reached a real ST4I server yet. Reuses the SAME server
 * URL field + `PUT /v1/settings` + probe (`ResilienceProbe`) Settings' own connection card already
 * exposes — this is a second, task-focused entry point onto that exact same state, not a parallel
 * config surface. `ecosystem` is computed once by the caller (`useEcosystemConnection()`) and passed
 * down rather than re-subscribed here, so the gating decision and this panel's own live status
 * readout always agree.
 */
export function EcosystemConnectPanel({ ecosystem, className }: EcosystemConnectPanelProps) {
  const t = useT()
  const gloss = useGloss()
  const [, navigate] = useLocation()
  const updateSettings = useUpdateSettings()

  const [urlDraft, setUrlDraft] = React.useState(ecosystem.serverUrl)
  const [touched, setTouched] = React.useState(false)

  // Tracks the saved value until the operator starts editing — same "seed once, then let the user's
  // own typing win" idiom `Settings.tsx`'s `initialized` flag uses, simplified here since this panel
  // fully unmounts (rather than persisting stale local state) the instant `needsConnect` flips false.
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
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className={className ?? "min-h-0 flex-1"}>
      <Sheet
        title={t("ecosystemConnect.title")}
        titleEn={gloss("ecosystemConnect.title")}
        headerRight={
          <StatusBadge status={STATUS_BADGE[ecosystem.status]} pulse={ecosystem.status === "testing"}>
            {t(`ecosystemConnect.status.${ecosystem.status}`)}
          </StatusBadge>
        }
        className="mx-auto flex h-full w-full max-w-xl flex-col"
        bodyClassName="hmi-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
      >
        <div className="flex items-start gap-3 border border-border-strong bg-surface-muted px-3 py-2.5">
          {ecosystem.status === "failed" ? (
            <WifiOff className="mt-0.5 size-4 shrink-0 text-danger-text" aria-hidden="true" />
          ) : (
            <Wifi className="mt-0.5 size-4 shrink-0 text-info-text" aria-hidden="true" />
          )}
          <p className="text-sm text-text-body">{t("ecosystemConnect.description")}</p>
        </div>

        <FormField
          label={t("settings.connection.serverUrlLabel")}
          labelEn={gloss("settings.connection.serverUrlLabel")}
          htmlFor="ecosystem-connect-server-url"
          hint={
            ecosystem.status === "idle"
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
      </Sheet>
    </motion.div>
  )
}
