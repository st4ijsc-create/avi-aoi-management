import * as React from "react"
import { motion } from "framer-motion"
import type { VariantProps } from "class-variance-authority"
import { Copy, Eye, EyeOff, Loader2, Network, Radar, Save, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import {
  EngineApiError,
  useSetSiteLink,
  useSite,
  useSiteDiscover,
  useSiteIdentity,
  type BridgeState,
  type DiscoveredSite,
} from "@/lib/api"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/FormField"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Switch } from "@/components/ui/switch"

/**
 * GĐ3 EC-4 (`.superpowers/sdd/2026-07-27-giaidoan3-ecosystem-connect-blueprint/task-4-brief.md`) — the
 * web page over EC-3's `/v1/site*` endpoints (`SiteEndpoints.cs`): this device's own identity
 * fingerprint + certificate (to register at a SYNAPSE Site), an Engineer-gated Site-link form (host/
 * port + paste the Site's trust PEM + enable) driving `PUT /v1/site`, and a live northbound
 * bridge-status badge from the same polled `GET /v1/site`. Same "reads are Operator, one control is
 * Engineer+-gated" shape `AssetRegistry.tsx` (P2-2) established — that screen and `Settings.tsx`'s own
 * connection-form idiom (host/url + toggle + save) are this page's two templates.
 *
 * GĐ3 sub-2 SD-2 (`.superpowers/sdd/2026-07-27-giaidoan3-mdns-join-wizard-blueprint/task-2-brief.md`)
 * adds `DiscoverSitesField` below: a "Discover Sites" scan (SD-1's `GET /v1/site/discover`) INSIDE the
 * same Engineer-gated Site-link form, right above the Host field. Picking a result only ever sets the
 * form's `host`/`port` state — the trust PEM + enable stay the manual, pinned path unchanged; same
 * "click a button, read the mutation's own pending/data/error" idiom `Settings.tsx`'s "Check connection"
 * (`useProbeSettings`) already established for a bounded, read-only, click-triggered network check.
 */

type TFunc = ReturnType<typeof useT>
type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

/** Rank order for the Engineer+ gate below — same hierarchy `AssetRegistry.tsx`'s own local
 * `ROLE_RANK`/`meetsMinRole` already encode (duplicated per-file in this codebase rather than shared,
 * same as `Sidebar.tsx`'s own copy). */
const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }

function meetsMinRole(minRole: string, userRole: string | undefined): boolean {
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
}

/** Client-side Engineer+ gate for the Site-link SAVE control only — the server's own `Policies.Engineer`
 * on `PUT /v1/site` is the real enforcement (`SiteEndpoints.cs`). A non-Engineer sees a read-only
 * summary of host/port/enabled instead (rendered by the caller), never this component's children. */
function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const { user } = useAuth()
  if (!meetsMinRole(role, user?.role)) return null
  return <>{children}</>
}

const KNOWN_BRIDGE_STATES = new Set<string>(["Disabled", "Connecting", "Connected", "Degraded", "Down"])

/** 1:1 with the five `StatusBadge` tones (`ui/status-badge.tsx`) — `Connecting` reuses `info`, the same
 * "in progress" tone `EcosystemConnect.tsx`'s own `STATUS_BADGE` map uses for its analogous `testing`
 * state; `Degraded` reads as `warn` (amber/orange), `Down` as `danger` (red), matching the blueprint's
 * own grey/amber/green/orange/red ramp as closely as the shared 5-tone palette allows. */
const BRIDGE_STATUS_BADGE: Record<BridgeState, BadgeStatus> = {
  Disabled: "neutral",
  Connecting: "info",
  Connected: "ok",
  Degraded: "warn",
  Down: "danger",
}

/** Known-value lookup with a verbatim fallback for anything outside the five names above — same idiom
 * `AssetRegistry.tsx`'s `deviceClassLabel`/`driverKindLabel` use for a wire value the client has no
 * i18n entry for yet. */
function bridgeStateLabel(t: TFunc, value: string): string {
  return KNOWN_BRIDGE_STATES.has(value) ? t(`site.status.${value}`) : value
}

function bridgeStateTone(value: string): BadgeStatus {
  return KNOWN_BRIDGE_STATES.has(value) ? BRIDGE_STATUS_BADGE[value as BridgeState] : "neutral"
}

// Same native-`<textarea>` styling `PointForm.tsx`'s own `TEXTAREA_CLASS` uses (no shared `Textarea`
// primitive exists yet in `components/ui`) — `font-mono` added here since a PEM reads far more legibly
// in a monospace face than the prose default.
const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-[var(--radius)] border border-border-strong bg-surface-muted px-2.5 py-1.5 font-mono text-xs text-text-body transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]/40 disabled:cursor-not-allowed disabled:opacity-50"

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">{label}</dt>
      <dd className="text-sm text-text-body">{children}</dd>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Device identity card — read-only (Operator). `useSiteIdentity()` is one-shot: this device's own
// fingerprint/cert never change for the life of the process.
// ─────────────────────────────────────────────────────────────────────────

/** Copies `value` to the clipboard, surfacing a toast either way — same `navigator.clipboard.writeText`
 * + try/catch idiom `Onboarding.tsx`'s `handleCopy` (the mk_ key copy button) already established. */
function IdentityCopyButton({ value, label, successToast }: { value: string; label: string; successToast: string }) {
  const t = useT()
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(successToast)
    } catch {
      toast.error(t("site.identity.copyFailed"))
    }
  }
  return (
    <Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label={label} disabled={!value}>
      <Copy className="size-3.5" aria-hidden="true" />
    </Button>
  )
}

function DeviceIdentityCard() {
  const t = useT()
  const gloss = useGloss()
  const { data, isPending, isError } = useSiteIdentity()
  const [showPem, setShowPem] = React.useState(false)

  return (
    <Sheet title={t("site.identity.title")} titleEn={gloss("site.identity.title")} bodyClassName="flex flex-col gap-4">
      <p className="text-sm text-text-muted">{t("site.identity.description")}</p>

      {isError ? (
        <p className="text-sm text-danger-text">{t("site.identity.loadFailed")}</p>
      ) : isPending || !data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : (
        <>
          <FormField
            label={t("site.identity.fingerprintLabel")}
            labelEn={gloss("site.identity.fingerprintLabel")}
            htmlFor="site-device-fingerprint"
          >
            <div className="flex items-center gap-1.5">
              <Input id="site-device-fingerprint" readOnly value={data.deviceFingerprint} className="font-mono text-xs" />
              <IdentityCopyButton
                value={data.deviceFingerprint}
                label={t("site.identity.copyFingerprint")}
                successToast={t("toast.fingerprintCopied")}
              />
            </div>
          </FormField>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-body">{t("site.identity.pemLabel")}</span>
              <Button type="button" variant="outline" size="xs" onClick={() => setShowPem((v) => !v)}>
                {showPem ? (
                  <EyeOff className="size-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="size-3.5" aria-hidden="true" />
                )}
                {showPem ? t("site.identity.hidePem") : t("site.identity.showPem")}
              </Button>
            </div>
            {showPem ? (
              <div className="flex items-start gap-1.5">
                <pre className="hmi-scroll max-h-48 min-w-0 flex-1 overflow-auto rounded-[var(--radius)] border border-border-strong bg-surface-muted px-2.5 py-1.5 font-mono text-[11px] break-all whitespace-pre-wrap text-text-body">
                  {data.deviceCertPem}
                </pre>
                <IdentityCopyButton
                  value={data.deviceCertPem}
                  label={t("site.identity.copyPem")}
                  successToast={t("toast.certCopied")}
                />
              </div>
            ) : null}
          </div>

          <p className="text-[11px] text-text-muted">{t("site.identity.register")}</p>
        </>
      )}
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// GĐ3 sub-2 SD-2 — "Discover Sites": an Engineer-triggered mDNS LAN scan (`GET /v1/site/discover`) that
// lists candidate Sites so the operator can click one instead of hand-typing host/port. `onPick` is the
// SAME `setHost`/`setPort` state `SiteConnectionCard` already binds the Host/Port `Input`s to below —
// this component never touches `siteTrustPem`/`enabled` at all (discovery pre-fills host/port ONLY; the
// operator still pastes/pins the trust PEM and flips the switch themselves, unchanged from EC-4).
// ─────────────────────────────────────────────────────────────────────────

function DiscoverSitesField({ onPick, disabled }: { onPick: (site: DiscoveredSite) => void; disabled: boolean }) {
  const t = useT()
  const discover = useSiteDiscover()
  const results = discover.data ?? []

  return (
    <div className="flex flex-col gap-2 border border-border-strong bg-surface-muted/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-body">{t("site.discover.title")}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => discover.mutate()}
          disabled={disabled || discover.isPending}
        >
          {discover.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Radar className="size-3.5" aria-hidden="true" />
          )}
          {discover.isPending ? t("site.discover.scanning") : t("site.discover.button")}
        </Button>
      </div>

      {discover.isPending ? (
        <p className="text-xs text-text-muted">{t("site.discover.scanning")}</p>
      ) : discover.isError ? (
        <p className="text-xs text-danger-text" role="alert">
          {t("site.discover.error")}
        </p>
      ) : discover.isSuccess && results.length === 0 ? (
        <p className="text-xs text-text-muted">{t("site.discover.empty")}</p>
      ) : results.length > 0 ? (
        <>
          <span className="hmi-micro">{t("site.discover.resultsTitle")}</span>
          <ul className="flex flex-col gap-1">
            {results.map((site) => (
              <li key={site.instanceName}>
                <button
                  type="button"
                  aria-label={t("site.discover.pick", { instanceName: site.instanceName, host: site.host, port: site.port })}
                  onClick={() => onPick(site)}
                  className="flex w-full items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-surface-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]/40"
                >
                  <span className="font-medium text-text-strong">{site.instanceName}</span>
                  <span className="font-mono text-text-muted">
                    {site.host}:{site.port}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Site connection card — reads (host/port/enabled/bridge status) are Operator; the SAVE control
// (driving `PUT /v1/site`) is Engineer-gated. Doubles as the live bridge-status badge host (its own
// `useSite()` — same `["site"]` query TanStack Query already dedupes against `DeviceIdentityCard`'s and
// this card's own polling, not a second network hit).
// ─────────────────────────────────────────────────────────────────────────

function SiteConnectionCard() {
  const t = useT()
  const gloss = useGloss()
  const { user } = useAuth()
  const { data, isPending, isError } = useSite()
  const setSiteLink = useSetSiteLink()

  const canEdit = meetsMinRole("Engineer", user?.role)

  // Same "seed once from the server, then let the user's own typing win" idiom `Settings.tsx`'s
  // `initialized` flag uses — `useSite()` polls every 3s for the live badge, so re-running this
  // effect on every poll tick (instead of gating on `initialized`) would stomp mid-edit input.
  const [initialized, setInitialized] = React.useState(false)
  const [host, setHost] = React.useState("")
  const [port, setPort] = React.useState(8883)
  const [enabled, setEnabled] = React.useState(false)
  // Write-only on the wire (`SiteStatusDto` never echoes it back) — always starts blank regardless of
  // whether a link is already enabled; see `site.form.trustPemHint`.
  const [siteTrustPem, setSiteTrustPem] = React.useState("")
  const [formError, setFormError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!initialized && data) {
      setHost(data.host)
      setPort(data.port || 8883)
      setEnabled(data.enabled)
      setInitialized(true)
    }
  }, [initialized, data])

  const unsDisabled = data?.unsEnabled === false

  // SD-2 — picking a discovered Site sets ONLY the host/port state above; `siteTrustPem`/`enabled` are
  // untouched (the operator still pastes/pins the trust PEM and flips the switch themselves).
  function handleDiscoverPick(site: DiscoveredSite) {
    setHost(site.host)
    setPort(site.port)
    toast.success(t("toast.sitePrefilled", { instanceName: site.instanceName }))
  }

  function handleSave() {
    setFormError(null)
    setSiteLink.mutate(
      { enabled, host: host.trim(), port, siteTrustPem: siteTrustPem.trim() || undefined },
      {
        onSuccess: () => {
          setSiteTrustPem("")
          toast.success(t("toast.siteLinkSaved"))
        },
        onError: (err) => {
          let key = "site.errors.generic"
          if (err instanceof EngineApiError) {
            if (err.status === 400) key = "site.errors.badRequest"
            else if (err.status === 409) key = "site.errors.conflict"
            else if (err.status === 403) key = "site.errors.forbidden"
          }
          setFormError(t(key))
          toast.error(t("toast.siteLinkSaveFailed"))
        },
      }
    )
  }

  const badge = data ? (
    <StatusBadge status={bridgeStateTone(data.bridgeState)} pulse={data.bridgeState === "Connecting"}>
      {bridgeStateLabel(t, data.bridgeState)}
    </StatusBadge>
  ) : null

  return (
    <Sheet
      title={t("site.form.title")}
      titleEn={gloss("site.form.title")}
      headerRight={badge}
      bodyClassName="flex flex-col gap-4"
    >
      <p className="text-sm text-text-muted">{t("site.form.description")}</p>

      {isError ? (
        <p className="text-sm text-danger-text">{t("site.errors.loadFailed")}</p>
      ) : isPending || !data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          {data.lastError ? (
            <p className="text-xs text-danger-text">{t("site.status.lastError", { error: data.lastError })}</p>
          ) : null}
          {data.bridgeState === "Connected" && data.siteFingerprint ? (
            <p className="font-mono text-xs break-all text-ok-text">
              {t("site.status.siteVerified", { fingerprint: data.siteFingerprint })}
            </p>
          ) : null}

          {unsDisabled ? (
            <div className="flex items-start gap-2 border border-warn/30 bg-warn/10 px-3 py-2.5">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn-text" aria-hidden="true" />
              <p className="text-sm text-warn-text">{t("site.status.unsDisabled")}</p>
            </div>
          ) : null}

          <RequireRole role="Engineer">
            <>
              <DiscoverSitesField onPick={handleDiscoverPick} disabled={unsDisabled} />

              <FormField label={t("site.form.hostLabel")} labelEn={gloss("site.form.hostLabel")} htmlFor="site-host">
                <Input
                  id="site-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder={t("site.form.hostPlaceholder")}
                  className="font-mono"
                  disabled={unsDisabled}
                />
              </FormField>

              <FormField label={t("site.form.portLabel")} labelEn={gloss("site.form.portLabel")} htmlFor="site-port">
                <Input
                  id="site-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="font-numeric"
                  disabled={unsDisabled}
                />
              </FormField>

              <FormField
                label={t("site.form.trustPemLabel")}
                labelEn={gloss("site.form.trustPemLabel")}
                htmlFor="site-trust-pem"
                hint={t("site.form.trustPemHint")}
              >
                <textarea
                  id="site-trust-pem"
                  value={siteTrustPem}
                  onChange={(e) => setSiteTrustPem(e.target.value)}
                  placeholder={t("site.form.trustPemPlaceholder")}
                  rows={5}
                  className={TEXTAREA_CLASS}
                  disabled={unsDisabled}
                />
              </FormField>

              <label htmlFor="site-enabled" className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-text-body">{t("site.form.enabledLabel")}</span>
                <Switch id="site-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={unsDisabled} />
              </label>

              {formError ? (
                <p className="text-xs text-danger-text" role="alert">
                  {formError}
                </p>
              ) : null}
              <Button
                type="button"
                onClick={handleSave}
                disabled={unsDisabled || setSiteLink.isPending}
                className="w-fit"
              >
                {setSiteLink.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-3.5" aria-hidden="true" />
                )}
                {setSiteLink.isPending ? t("site.form.saving") : t("site.form.save")}
              </Button>
            </>
          </RequireRole>

          {!canEdit ? (
            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <DetailField label={t("site.form.readOnlyHost")}>{data.host || "—"}</DetailField>
                <DetailField label={t("site.form.readOnlyPort")}>{data.port || "—"}</DetailField>
                <DetailField label={t("site.form.enabledLabel")}>
                  {data.enabled ? t("site.form.readOnlyEnabled") : t("site.form.readOnlyDisabled")}
                </DetailField>
              </dl>
              <p className="text-xs text-text-muted">{t("site.form.readOnlyNote")}</p>
            </div>
          ) : null}
        </>
      )}
    </Sheet>
  )
}

function SiteScreen() {
  const t = useT()
  const gloss = useGloss()

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Network className="size-5 text-primary-text" aria-hidden="true" />
          <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
            {t("site.title")}
          </h1>
        </div>
        <p className="hmi-micro mt-1">{gloss("site.title")}</p>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("site.description")}</p>
      </div>

      <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DeviceIdentityCard />
          <SiteConnectionCard />
        </div>
      </div>
    </motion.div>
  )
}

export default function Site() {
  return <SiteScreen />
}
