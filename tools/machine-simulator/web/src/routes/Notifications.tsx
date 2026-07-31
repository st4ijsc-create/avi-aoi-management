import * as React from "react"
import { motion } from "framer-motion"
import { BellRing, Loader2, Save, Send, Siren, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import {
  NotificationApiError,
  useDeleteNotificationChannel,
  useNotificationChannels,
  useNotificationStatus,
  useSaveLocalAnnunciation,
  useSaveRelay,
  useSaveSmtp,
  useSaveWebhook,
  useSendNotificationTest,
  type NotificationChannelKind,
  type NotificationChannelSummary,
  type NotificationPriority,
  type NotificationTestOutcome,
  type RelayTargetKind,
  type SecretUpdate,
  type SmtpTlsMode,
} from "@/lib/notificationsApi"
import { fadeSlideUp } from "@/theme/motion"
import { BeaconState } from "@/components/BeaconState"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/FormField"
import { Input } from "@/components/ui/input"
import { Select, SelectItem, SelectPopup, SelectPortal, SelectPositioner, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Switch } from "@/components/ui/switch"

/**
 * 🔴 Task C-8 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-8-brief.md) — the screen
 * Đợt C's four notification channels never had. Before this, a webhook, an SMTP relay, the local
 * annunciator's threshold and a beacon could only be configured by hand-editing a SQLite file next to the
 * exe; C-7 gave them eleven routes and this gives them an operator.
 *
 * **Engineer+, whole-page.** `GET /v1/notifications/channels` and `/status` are `Policies.Engineer`
 * because they carry the whole notification configuration — SMTP usernames, **every alarm recipient's
 * e-mail address**, webhook endpoints, and the machine and point a relay may energise. The operator-tier
 * slice of this lives on `/alarms` instead, over C-8's own narrower
 * `GET /v1/notifications/annunciator` — see `AlarmCenter.tsx`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 THE CREDENTIAL TRAPS, AND WHAT THIS FORM DOES ABOUT EACH
 * ─────────────────────────────────────────────────────────────────────────
 * C-7 handed C-8 four ways to silently destroy a stored credential. They are properties of the endpoint
 * contract and are deliberately NOT "fixed" here — each is made visible instead:
 *
 * 1. **The webhook URL is required on every save**, including one that only changes a label, because the
 *    endpoint cannot re-read the stored URL without decrypting a bearer capability inside a request
 *    handler. So the URL field is always empty on load and always mandatory, and the **current
 *    `endpoint` + `urlFingerprint` + `label` are printed directly beside it** so an operator can confirm
 *    they are re-entering the same destination. The Save button is disabled with a stated reason until it
 *    is filled.
 * 2. **Secret tri-state (absent = keep, `""` = clear, value = replace).** Every secret field is a
 *    {@link SecretInput}: an explicit three-way KEEP / REPLACE / CLEAR chooser, never a text box that
 *    looks empty. A password box that renders empty and posts its contents is exactly how "I only changed
 *    the label" wipes a credential — the chooser makes "keep" the default and makes "clear" a thing the
 *    operator had to pick, and the field states in words what will happen on save.
 * 3. **Omitting `authHeaderName` deletes the stored auth token.** The webhook form always re-sends it
 *    (`notificationsApi` types it as a required `string | null`), and the field's hint says out loud that
 *    emptying it also deletes the token — because the API's behaviour is not guessable from the label.
 * 4. **A command relay is Admin-tier by configuration.** §"the relay" below.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 THE RELAY, AND WHY THIS SCREEN DOES NOT FLATTEN THE ROLE DIFFERENCE
 * ─────────────────────────────────────────────────────────────────────────
 * `PUT`/`DELETE /v1/notifications/relay` is **Admin**; the other nine routes are Engineer. That is not a
 * stylistic inconsistency to be smoothed over — saving a relay row with `targetKind = Command` makes this
 * engine perform, automatically and for as long as the row exists, an action a human needs Admin for. So
 * the relay card follows Đợt B's command flow (`MachineControlPanel.tsx`) exactly: the configuration
 * renders for every Engineer, and the **actuator is swapped for a sentence** — not disabled, not hidden —
 * that says Admin is required and why. Hiding it would tell an Engineer the beacon does not exist;
 * disabling it would tell them it is broken.
 */

type TFunc = ReturnType<typeof useT>

/** Rank order for the gates below — the same hierarchy `Connectors.tsx`/`Site.tsx`/`AlarmCenter.tsx` each
 * declare locally (duplicated per-file in this codebase rather than shared). */
const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }

function meetsMinRole(minRole: string, userRole: string | undefined): boolean {
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
}

/** 🔴 Only `Critical` and `High` actually occur in this build, and the threshold field says so rather than
 * offering four options that look equally reachable. The other two are accepted by the API and are listed
 * so a configuration written by a future build still round-trips through this form. */
const PRIORITIES: NotificationPriority[] = ["Critical", "High", "Medium", "Low"]

/** 🔴 Two modes, and there is deliberately no implicit-TLS/SMTPS/port-465 option: `System.Net.Mail`
 * implements only STARTTLS and provably cannot honour one, so offering it would let an operator save a
 * configuration this product must silently ignore. Stated on the field, not just omitted from it. */
const TLS_MODES: SmtpTlsMode[] = ["None", "StartTls"]

const TARGET_KINDS: RelayTargetKind[] = ["Point", "Command"]

function findChannel(
  channels: NotificationChannelSummary[] | undefined,
  kind: NotificationChannelKind,
): NotificationChannelSummary | undefined {
  return channels?.find((c) => c.channel === kind)
}

function serverMessage(error: unknown, fallback: string): string {
  return error instanceof NotificationApiError && error.serverMessage ? error.serverMessage : fallback
}

// ─────────────────────────────────────────────────────────────────────────
// 🔴 The secret tri-state, as a control
// ─────────────────────────────────────────────────────────────────────────

type SecretMode = "keep" | "replace" | "clear"

/** 🔴 The ONE place the UI's three modes become the API's three states. `keep` contributes no key at all
 * (the stored credential is untouched), `clear` contributes `""` (delete it), `replace` contributes the
 * typed value. See `notificationsApi`'s `secretField`, which performs the other half. */
function toSecretUpdate(mode: SecretMode, value: string): SecretUpdate {
  if (mode === "keep") return undefined
  if (mode === "clear") return null
  return value
}

/**
 * 🔴 A stored credential, as a control that cannot destroy it by accident.
 *
 * The obvious design — a password box that renders empty and posts whatever it contains — is precisely
 * how a save that only changed a label wipes a signing secret: the box looked empty because the value was
 * never returned (it never can be), and posting "" means DELETE. So there is no box until the operator
 * picks REPLACE, `keep` is the default, and the field states in a sentence what will happen on save.
 */
function SecretInput({
  id,
  label,
  labelEn,
  hint,
  hasStored,
  mode,
  onModeChange,
  value,
  onValueChange,
  t,
}: {
  id: string
  label: string
  labelEn: string
  hint?: string
  hasStored: boolean
  mode: SecretMode
  onModeChange: (mode: SecretMode) => void
  value: string
  onValueChange: (value: string) => void
  t: TFunc
}) {
  const modes: SecretMode[] = hasStored ? ["keep", "replace", "clear"] : ["keep", "replace"]

  const effect =
    mode === "keep"
      ? hasStored
        ? t("notifications.secret.effectKeep")
        : t("notifications.secret.effectKeepNone")
      : mode === "clear"
        ? t("notifications.secret.effectClear")
        : t("notifications.secret.effectReplace")

  return (
    <FormField label={label} labelEn={labelEn} hint={hint}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={hasStored ? "ok" : "neutral"}>
            {hasStored ? t("notifications.secret.stored") : t("notifications.secret.notStored")}
          </StatusBadge>
          <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
            {modes.map((m) => (
              <Button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                size="xs"
                variant={mode === m ? "default" : "outline"}
                data-testid={`${id}-mode-${m}`}
                onClick={() => onModeChange(m)}
              >
                {t(`notifications.secret.mode.${m}`)}
              </Button>
            ))}
          </div>
        </div>

        {mode === "replace" ? (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            className="font-mono"
            value={value}
            aria-label={label}
            onChange={(e) => onValueChange(e.target.value)}
          />
        ) : null}

        <span
          className={mode === "clear" ? "text-[11px] text-danger-text" : "text-[11px] text-text-muted"}
          data-testid={`${id}-effect`}
        >
          {effect}
        </span>
      </div>
    </FormField>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 🔴 The send-test result — four fields, and `doesNotProve` gets the same weight as `proves`
// ─────────────────────────────────────────────────────────────────────────

/**
 * 🔴 `NotificationTestOutcome` has four fields because a bare boolean is what a UI renders, and "a
 * statement only survives contact with a UI if it is a field". This renders all four. In particular
 * **`doesNotProve` is never collapsed, never a tooltip, and never smaller than `proves`** — it is where
 * the API says that a green e-mail test does NOT prove the stored password works (`SmtpClient` proceeds
 * unauthenticated after any failed *or absent* AUTH and exposes no AUTH result), and that a green test on
 * a DISABLED channel does not mean alarms are being delivered.
 *
 * The three sentences are the engine's own English text, shown verbatim under translated headings rather
 * than re-worded here: they are `Attention`-class server prose (C-7 §11.2 note 7), and a UI paraphrase of
 * "this did not prove your password works" is exactly the kind of softening this batch exists to prevent.
 */
function TestOutcomePanel({ outcome, t }: { outcome: NotificationTestOutcome; t: TFunc }) {
  return (
    <div
      data-testid="notification-test-outcome"
      role="status"
      className="flex flex-col gap-2 border border-border-strong bg-surface-muted p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={outcome.ok ? "ok" : "danger"}>
          {outcome.ok ? t("notifications.test.accepted") : t("notifications.test.failed")}
        </StatusBadge>
        <span className="text-xs text-text-body">{outcome.detail}</span>
      </div>

      {outcome.proves ? (
        <div className="flex flex-col gap-0.5">
          <span className="hmi-micro">{t("notifications.test.proves")}</span>
          <p className="text-xs text-text-body">{outcome.proves}</p>
        </div>
      ) : null}

      {outcome.doesNotProve ? (
        <div className="flex flex-col gap-0.5 border-l-2 border-warn pl-2">
          <span className="hmi-micro text-warn-text">{t("notifications.test.doesNotProve")}</span>
          <p className="text-xs text-text-body">{outcome.doesNotProve}</p>
        </div>
      ) : null}
    </div>
  )
}

/** The Test button + its result, shared by the two channels that have one. Local annunciation and the
 * relay deliberately have none — the API refuses them with a 400 that states the reason, and this screen
 * prints that reason instead of a button (see their cards). */
function SendTestControl({ channel, t }: { channel: NotificationChannelKind; t: TFunc }) {
  const test = useSendNotificationTest()
  const [outcome, setOutcome] = React.useState<NotificationTestOutcome | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  function handleTest() {
    setError(null)
    test.mutate(
      { channel },
      {
        onSuccess: (result) => setOutcome(result),
        // 🔴 A 429 is the rate limiter, not a broken channel, and the server's sentence says how long to
        // wait. Rendering it as "the test failed" would send an operator to debug a working webhook.
        onError: (err) => {
          setOutcome(null)
          setError(serverMessage(err, t("notifications.test.errorGeneric")))
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`notification-test-${channel}`}
          onClick={handleTest}
          disabled={test.isPending}
        >
          {test.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-3.5" aria-hidden="true" />
          )}
          {t("notifications.test.send")}
        </Button>
        <span className="text-[11px] text-text-muted">{t("notifications.test.rateLimited")}</span>
      </div>

      {error ? (
        <p className="text-xs text-danger-text" role="alert">
          {error}
        </p>
      ) : null}

      {outcome ? <TestOutcomePanel outcome={outcome} t={t} /> : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Shared card chrome
// ─────────────────────────────────────────────────────────────────────────

function ChannelHeader({
  enabled,
  configured,
  t,
}: {
  enabled: boolean
  configured: boolean
  t: TFunc
}) {
  if (!configured) return <StatusBadge status="neutral">{t("notifications.state.notConfigured")}</StatusBadge>
  return (
    <StatusBadge status={enabled ? "ok" : "warn"}>
      {enabled ? t("notifications.state.enabled") : t("notifications.state.disabled")}
    </StatusBadge>
  )
}

function PriorityField({
  id,
  value,
  onChange,
  t,
  gloss,
}: {
  id: string
  value: NotificationPriority
  onChange: (value: NotificationPriority) => void
  t: TFunc
  gloss: TFunc
}) {
  return (
    <FormField
      label={t("notifications.field.minPriority")}
      labelEn={gloss("notifications.field.minPriority")}
      hint={t("notifications.field.minPriorityHint")}
    >
      <Select value={value} onValueChange={(next) => next && onChange(next as NotificationPriority)}>
        <SelectTrigger aria-label={t("notifications.field.minPriority")} id={id} className="h-8 w-56 text-xs">
          <SelectValue>{t(`alarms.priority.${value}`)}</SelectValue>
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner>
            <SelectPopup>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`alarms.priority.${p}`)}
                </SelectItem>
              ))}
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </FormField>
  )
}

function EnabledField({
  id,
  checked,
  onChange,
  t,
}: {
  id: string
  checked: boolean
  onChange: (next: boolean) => void
  t: TFunc
}) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-sm font-medium text-text-body">{t("notifications.field.enabled")}</span>
        <span className="text-[11px] text-text-muted">{t("notifications.field.enabledHint")}</span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function DeleteChannelButton({
  channel,
  disabled,
  t,
}: {
  channel: NotificationChannelKind
  disabled?: boolean
  t: TFunc
}) {
  const remove = useDeleteNotificationChannel()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || remove.isPending}
      data-testid={`notification-delete-${channel}`}
      onClick={() =>
        remove.mutate(
          { channel },
          {
            onSuccess: () => toast.success(t("toast.notificationChannelRemoved")),
            onError: (err) => toast.error(serverMessage(err, t("toast.notificationChannelRemoveFailed"))),
          },
        )
      }
    >
      <Trash2 className="size-3.5" aria-hidden="true" />
      {t("notifications.action.remove")}
    </Button>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Webhook
// ─────────────────────────────────────────────────────────────────────────

function WebhookCard({ current, t, gloss }: { current?: NotificationChannelSummary; t: TFunc; gloss: TFunc }) {
  const save = useSaveWebhook()
  const summary = current?.webhook

  const [enabled, setEnabled] = React.useState(false)
  const [minPriority, setMinPriority] = React.useState<NotificationPriority>("High")
  const [url, setUrl] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [authHeaderName, setAuthHeaderName] = React.useState("")
  const [signingMode, setSigningMode] = React.useState<SecretMode>("keep")
  const [signingValue, setSigningValue] = React.useState("")
  const [tokenMode, setTokenMode] = React.useState<SecretMode>("keep")
  const [tokenValue, setTokenValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  // 🔴 The URL is deliberately NOT seeded from the server — it cannot be, and pretending otherwise is the
  // trap. Every other field is, because PUT is full replacement and a field this form did not re-send is
  // a field this form cleared.
  React.useEffect(() => {
    if (loaded || !current) return
    setEnabled(current.enabled)
    setMinPriority(current.minPriority)
    setLabel(summary?.label ?? "")
    setAuthHeaderName(summary?.authHeaderName ?? "")
    setLoaded(true)
  }, [current, loaded, summary])

  function handleSave() {
    setError(null)
    save.mutate(
      {
        enabled,
        minPriority,
        url: url.trim(),
        label: label.trim() === "" ? null : label.trim(),
        // 🔴 Always sent. Leaving it out clears the header name AND deletes the stored token with it.
        authHeaderName: authHeaderName.trim() === "" ? null : authHeaderName.trim(),
        signingSecret: toSecretUpdate(signingMode, signingValue),
        authToken: toSecretUpdate(tokenMode, tokenValue),
      },
      {
        onSuccess: () => {
          toast.success(t("toast.notificationSaved"))
          setUrl("")
          setSigningMode("keep")
          setSigningValue("")
          setTokenMode("keep")
          setTokenValue("")
        },
        onError: (err) => setError(serverMessage(err, t("notifications.error.saveFailed"))),
      },
    )
  }

  return (
    <Sheet
      title={t("notifications.webhook.title")}
      titleEn={gloss("notifications.webhook.title")}
      headerRight={<ChannelHeader enabled={enabled} configured={!!current} t={t} />}
      bodyClassName="flex flex-col gap-3"
      data-testid="notification-card-webhook"
    >
      <p className="text-sm text-text-muted">{t("notifications.webhook.description")}</p>

      {summary ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border border-border bg-surface-subtle p-2.5 text-xs">
          <dt className="text-text-muted">{t("notifications.webhook.currentEndpoint")}</dt>
          <dd className="font-mono break-all text-text-body" data-testid="webhook-current-endpoint">
            {summary.endpoint}
          </dd>
          <dt className="text-text-muted">{t("notifications.webhook.currentFingerprint")}</dt>
          <dd className="font-mono break-all text-text-body" data-testid="webhook-current-fingerprint">
            {summary.urlFingerprint}
          </dd>
          <dt className="text-text-muted">{t("notifications.webhook.currentLabel")}</dt>
          <dd className="text-text-body">{summary.label ?? "—"}</dd>
          <dt className="text-text-muted">{t("notifications.webhook.signingState")}</dt>
          <dd className="text-text-body">
            {summary.hasSigningSecret
              ? t("notifications.webhook.signed")
              : t("notifications.webhook.unsigned")}
          </dd>
        </dl>
      ) : null}

      {/* 🔴 The one combination an operator most needs surfaced: a header name with no token is a webhook
          that cannot post at all. */}
      {summary && summary.authHeaderName && !summary.hasAuthToken ? (
        <p className="border-l-2 border-danger pl-2 text-xs text-danger-text" role="alert">
          {t("notifications.webhook.headerWithoutToken")}
        </p>
      ) : null}
      {summary && !summary.hasUrl ? (
        <p className="border-l-2 border-danger pl-2 text-xs text-danger-text" role="alert">
          {t("notifications.webhook.noUrl")}
        </p>
      ) : null}

      <EnabledField id="webhook-enabled" checked={enabled} onChange={setEnabled} t={t} />
      <PriorityField id="webhook-priority" value={minPriority} onChange={setMinPriority} t={t} gloss={gloss} />

      <FormField
        label={t("notifications.webhook.url")}
        labelEn={gloss("notifications.webhook.url")}
        htmlFor="webhook-url"
        hint={t("notifications.webhook.urlHint")}
      >
        <Input
          id="webhook-url"
          className="font-mono"
          placeholder="https://hooks.slack.com/services/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </FormField>

      <FormField
        label={t("notifications.webhook.label")}
        labelEn={gloss("notifications.webhook.label")}
        htmlFor="webhook-label"
        hint={t("notifications.webhook.labelHint")}
      >
        <Input id="webhook-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </FormField>

      <FormField
        label={t("notifications.webhook.authHeaderName")}
        labelEn={gloss("notifications.webhook.authHeaderName")}
        htmlFor="webhook-auth-header"
        hint={t("notifications.webhook.authHeaderNameHint")}
      >
        <Input
          id="webhook-auth-header"
          className="font-mono"
          placeholder="X-Api-Key"
          value={authHeaderName}
          onChange={(e) => setAuthHeaderName(e.target.value)}
        />
      </FormField>

      <SecretInput
        id="webhook-signing-secret"
        label={t("notifications.webhook.signingSecret")}
        labelEn={gloss("notifications.webhook.signingSecret")}
        hint={t("notifications.webhook.signingSecretHint")}
        hasStored={summary?.hasSigningSecret ?? false}
        mode={signingMode}
        onModeChange={setSigningMode}
        value={signingValue}
        onValueChange={setSigningValue}
        t={t}
      />

      <SecretInput
        id="webhook-auth-token"
        label={t("notifications.webhook.authToken")}
        labelEn={gloss("notifications.webhook.authToken")}
        hint={t("notifications.webhook.authTokenHint")}
        hasStored={summary?.hasAuthToken ?? false}
        mode={tokenMode}
        onModeChange={setTokenMode}
        value={tokenValue}
        onValueChange={setTokenValue}
        t={t}
      />

      {error ? (
        <p className="text-xs text-danger-text" role="alert" data-testid="webhook-error">
          {error}
        </p>
      ) : null}

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          data-testid="webhook-save"
          onClick={handleSave}
          disabled={save.isPending || url.trim() === ""}
        >
          {save.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          {t("notifications.action.save")}
        </Button>
        {current ? <DeleteChannelButton channel="Webhook" t={t} /> : null}
        {url.trim() === "" ? (
          <span className="text-[11px] text-warn-text" data-testid="webhook-url-required">
            {t("notifications.webhook.urlRequiredToSave")}
          </span>
        ) : null}
      </div>

      {current ? <SendTestControl channel="Webhook" t={t} /> : null}
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// SMTP
// ─────────────────────────────────────────────────────────────────────────

function SmtpCard({ current, t, gloss }: { current?: NotificationChannelSummary; t: TFunc; gloss: TFunc }) {
  const save = useSaveSmtp()
  const summary = current?.smtp

  const [enabled, setEnabled] = React.useState(false)
  const [minPriority, setMinPriority] = React.useState<NotificationPriority>("High")
  const [host, setHost] = React.useState("")
  const [port, setPort] = React.useState("25")
  const [tls, setTls] = React.useState<SmtpTlsMode>("StartTls")
  const [fromAddress, setFromAddress] = React.useState("")
  const [recipients, setRecipients] = React.useState("")
  const [username, setUsername] = React.useState("")
  const [passwordMode, setPasswordMode] = React.useState<SecretMode>("keep")
  const [passwordValue, setPasswordValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    if (loaded || !current) return
    setEnabled(current.enabled)
    setMinPriority(current.minPriority)
    setHost(summary?.host ?? "")
    setPort(String(summary?.port ?? 25))
    setTls(summary?.tls ?? "StartTls")
    setFromAddress(summary?.fromAddress ?? "")
    setRecipients((summary?.recipients ?? []).join(", "))
    setUsername(summary?.username ?? "")
    setLoaded(true)
  }, [current, loaded, summary])

  const parsedRecipients = recipients
    .split(/[,;\n]/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0)

  function handleSave() {
    setError(null)
    save.mutate(
      {
        enabled,
        minPriority,
        host: host.trim(),
        port: Number.parseInt(port, 10),
        tls,
        fromAddress: fromAddress.trim(),
        recipients: parsedRecipients,
        username: username.trim() === "" ? null : username.trim(),
        password: toSecretUpdate(passwordMode, passwordValue),
      },
      {
        onSuccess: () => {
          toast.success(t("toast.notificationSaved"))
          setPasswordMode("keep")
          setPasswordValue("")
        },
        onError: (err) => setError(serverMessage(err, t("notifications.error.saveFailed"))),
      },
    )
  }

  return (
    <Sheet
      title={t("notifications.smtp.title")}
      titleEn={gloss("notifications.smtp.title")}
      headerRight={<ChannelHeader enabled={enabled} configured={!!current} t={t} />}
      bodyClassName="flex flex-col gap-3"
      data-testid="notification-card-smtp"
    >
      <p className="text-sm text-text-muted">{t("notifications.smtp.description")}</p>

      <EnabledField id="smtp-enabled" checked={enabled} onChange={setEnabled} t={t} />
      <PriorityField id="smtp-priority" value={minPriority} onChange={setMinPriority} t={t} gloss={gloss} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <FormField label={t("notifications.smtp.host")} labelEn={gloss("notifications.smtp.host")} htmlFor="smtp-host">
          <Input id="smtp-host" className="font-mono" value={host} onChange={(e) => setHost(e.target.value)} />
        </FormField>
        <FormField
          label={t("notifications.smtp.port")}
          labelEn={gloss("notifications.smtp.port")}
          htmlFor="smtp-port"
          hint={t("notifications.smtp.portHint")}
        >
          <Input
            id="smtp-port"
            className="font-numeric w-28"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </FormField>
      </div>

      <FormField
        label={t("notifications.smtp.tls")}
        labelEn={gloss("notifications.smtp.tls")}
        hint={t("notifications.smtp.tlsHint")}
      >
        <Select value={tls} onValueChange={(next) => next && setTls(next as SmtpTlsMode)}>
          <SelectTrigger aria-label={t("notifications.smtp.tls")} id="smtp-tls" className="h-8 w-56 text-xs">
            <SelectValue>{t(`notifications.smtp.tlsMode.${tls}`)}</SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectPositioner>
              <SelectPopup>
                {TLS_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`notifications.smtp.tlsMode.${mode}`)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </SelectPositioner>
          </SelectPortal>
        </Select>
      </FormField>

      <FormField
        label={t("notifications.smtp.fromAddress")}
        labelEn={gloss("notifications.smtp.fromAddress")}
        htmlFor="smtp-from"
      >
        <Input id="smtp-from" className="font-mono" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} />
      </FormField>

      <FormField
        label={t("notifications.smtp.recipients")}
        labelEn={gloss("notifications.smtp.recipients")}
        htmlFor="smtp-recipients"
        hint={t("notifications.smtp.recipientsHint")}
      >
        <Input
          id="smtp-recipients"
          className="font-mono"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
        />
      </FormField>

      <FormField
        label={t("notifications.smtp.username")}
        labelEn={gloss("notifications.smtp.username")}
        htmlFor="smtp-username"
        hint={t("notifications.smtp.usernameHint")}
      >
        <Input id="smtp-username" className="font-mono" value={username} onChange={(e) => setUsername(e.target.value)} />
      </FormField>

      <SecretInput
        id="smtp-password"
        label={t("notifications.smtp.password")}
        labelEn={gloss("notifications.smtp.password")}
        hint={t("notifications.smtp.passwordHint")}
        hasStored={summary?.hasPassword ?? false}
        mode={passwordMode}
        onModeChange={setPasswordMode}
        value={passwordValue}
        onValueChange={setPasswordValue}
        t={t}
      />

      {error ? (
        <p className="text-xs text-danger-text" role="alert" data-testid="smtp-error">
          {error}
        </p>
      ) : null}

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" data-testid="smtp-save" onClick={handleSave} disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          {t("notifications.action.save")}
        </Button>
        {current ? <DeleteChannelButton channel="Smtp" t={t} /> : null}
      </div>

      {current ? <SendTestControl channel="Smtp" t={t} /> : null}
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Local annunciation
// ─────────────────────────────────────────────────────────────────────────

function LocalAnnunciationCard({
  current,
  t,
  gloss,
}: {
  current?: NotificationChannelSummary
  t: TFunc
  gloss: TFunc
}) {
  const save = useSaveLocalAnnunciation()
  const [enabled, setEnabled] = React.useState(false)
  const [minPriority, setMinPriority] = React.useState<NotificationPriority>("High")
  const [error, setError] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    if (loaded || !current) return
    setEnabled(current.enabled)
    setMinPriority(current.minPriority)
    setLoaded(true)
  }, [current, loaded])

  function handleSave() {
    setError(null)
    save.mutate(
      { enabled, minPriority },
      {
        onSuccess: () => toast.success(t("toast.notificationSaved")),
        onError: (err) => setError(serverMessage(err, t("notifications.error.saveFailed"))),
      },
    )
  }

  return (
    <Sheet
      title={t("notifications.local.title")}
      titleEn={gloss("notifications.local.title")}
      headerRight={<ChannelHeader enabled={enabled} configured={!!current} t={t} />}
      bodyClassName="flex flex-col gap-3"
      data-testid="notification-card-local"
    >
      <p className="text-sm text-text-muted">{t("notifications.local.description")}</p>

      <EnabledField id="local-enabled" checked={enabled} onChange={setEnabled} t={t} />
      <PriorityField id="local-priority" value={minPriority} onChange={setMinPriority} t={t} gloss={gloss} />

      {/* 🔴 Everything about HOW an annunciation presents — which tone, how loud, whether the browser is
          holding it muted — is a property of the SCREEN, not of this engine. Said here so the absence of
          those fields reads as a decision rather than an unfinished form. */}
      <p className="text-xs text-text-muted">{t("notifications.local.screenOwned")}</p>

      {/* 🔴 There is no send test, and the reason is stated rather than the button silently missing. */}
      <p className="border-l-2 border-border-strong pl-2 text-xs text-text-muted" data-testid="local-no-test">
        {t("notifications.local.noSendTest")}
      </p>

      {error ? (
        <p className="text-xs text-danger-text" role="alert">
          {error}
        </p>
      ) : null}

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" data-testid="local-save" onClick={handleSave} disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          {t("notifications.action.save")}
        </Button>
        {current ? <DeleteChannelButton channel="LocalAnnunciation" t={t} /> : null}
      </div>
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 Relay — the Admin-tier one
// ─────────────────────────────────────────────────────────────────────────

function RelayCard({ current, t, gloss }: { current?: NotificationChannelSummary; t: TFunc; gloss: TFunc }) {
  const save = useSaveRelay()
  const { user } = useAuth()
  const summary = current?.relay

  // 🔴 Admin, not Engineer, and this is the whole point of the card. See the file header.
  const canWriteRelay = meetsMinRole("Admin", user?.role)

  const [enabled, setEnabled] = React.useState(false)
  const [minPriority, setMinPriority] = React.useState<NotificationPriority>("Critical")
  const [machineCode, setMachineCode] = React.useState("")
  const [targetKind, setTargetKind] = React.useState<RelayTargetKind>("Point")
  const [targetName, setTargetName] = React.useState("")
  const [onValue, setOnValue] = React.useState("")
  const [offValue, setOffValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    if (loaded || !current) return
    setEnabled(current.enabled)
    setMinPriority(current.minPriority)
    setMachineCode(summary?.machineCode ?? "")
    setTargetKind(summary?.targetKind ?? "Point")
    setTargetName(summary?.targetName ?? "")
    setOnValue(summary?.onValueJson ?? "")
    setOffValue(summary?.offValueJson ?? "")
    setLoaded(true)
  }, [current, loaded, summary])

  function handleSave() {
    setError(null)
    save.mutate(
      {
        enabled,
        minPriority,
        machineCode: machineCode.trim(),
        targetKind,
        targetName: targetName.trim(),
        onValueJson: onValue.trim(),
        offValueJson: offValue.trim(),
      },
      {
        onSuccess: () => toast.success(t("toast.notificationSaved")),
        onError: (err) => setError(serverMessage(err, t("notifications.error.saveFailed"))),
      },
    )
  }

  return (
    <Sheet
      title={t("notifications.relay.title")}
      titleEn={gloss("notifications.relay.title")}
      headerRight={
        <div className="flex items-center gap-2">
          <StatusBadge status="info">{t("notifications.relay.adminTier")}</StatusBadge>
          <ChannelHeader enabled={enabled} configured={!!current} t={t} />
        </div>
      }
      bodyClassName="flex flex-col gap-3"
      data-testid="notification-card-relay"
    >
      <p className="text-sm text-text-muted">{t("notifications.relay.description")}</p>

      {/* 🔴 The safety statement, first and unmissable. It is not a footnote: anyone who needs a light or
          a horn that works while HALT is engaged has to hardwire it, and this product cannot. */}
      <p className="border-l-2 border-danger pl-2 text-xs text-danger-text" data-testid="relay-not-safety">
        {t("notifications.relay.notSafetyDevice")}
      </p>

      <EnabledField id="relay-enabled" checked={enabled} onChange={setEnabled} t={t} />
      <PriorityField id="relay-priority" value={minPriority} onChange={setMinPriority} t={t} gloss={gloss} />

      <FormField
        label={t("notifications.relay.machineCode")}
        labelEn={gloss("notifications.relay.machineCode")}
        htmlFor="relay-machine"
        hint={t("notifications.relay.machineCodeHint")}
      >
        <Input id="relay-machine" className="font-mono" value={machineCode} onChange={(e) => setMachineCode(e.target.value)} />
      </FormField>

      <FormField
        label={t("notifications.relay.targetKind")}
        labelEn={gloss("notifications.relay.targetKind")}
        hint={t("notifications.relay.targetKindHint")}
      >
        <Select value={targetKind} onValueChange={(next) => next && setTargetKind(next as RelayTargetKind)}>
          <SelectTrigger aria-label={t("notifications.relay.targetKind")} id="relay-target-kind" className="h-8 w-56 text-xs">
            <SelectValue>{t(`notifications.relay.kind.${targetKind}`)}</SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectPositioner>
              <SelectPopup>
                {TARGET_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`notifications.relay.kind.${kind}`)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </SelectPositioner>
          </SelectPortal>
        </Select>
      </FormField>

      {/* 🔴 A Command target can ASSERT the annunciator and structurally CANNOT RELEASE it — a latching
          beacon needs a Point. Said at the moment the operator picks it, not in a manual. */}
      {targetKind === "Command" ? (
        <p className="border-l-2 border-warn pl-2 text-xs text-warn-text" role="alert" data-testid="relay-command-warning">
          {t("notifications.relay.commandCannotRelease")}
        </p>
      ) : null}

      <FormField
        label={t("notifications.relay.targetName")}
        labelEn={gloss("notifications.relay.targetName")}
        htmlFor="relay-target-name"
        hint={t("notifications.relay.targetNameHint")}
      >
        <Input id="relay-target-name" className="font-mono" value={targetName} onChange={(e) => setTargetName(e.target.value)} />
      </FormField>

      {targetKind === "Point" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t("notifications.relay.onValue")}
            labelEn={gloss("notifications.relay.onValue")}
            htmlFor="relay-on-value"
            hint={t("notifications.relay.valueHint")}
          >
            <Input id="relay-on-value" className="font-mono" placeholder="1" value={onValue} onChange={(e) => setOnValue(e.target.value)} />
          </FormField>
          <FormField
            label={t("notifications.relay.offValue")}
            labelEn={gloss("notifications.relay.offValue")}
            htmlFor="relay-off-value"
            hint={t("notifications.relay.offValueHint")}
          >
            <Input id="relay-off-value" className="font-mono" placeholder="0" value={offValue} onChange={(e) => setOffValue(e.target.value)} />
          </FormField>
        </div>
      ) : null}

      {/* 🔴 No send test, deliberately, and the reason is on the screen. */}
      <p className="border-l-2 border-border-strong pl-2 text-xs text-text-muted" data-testid="relay-no-test">
        {t("notifications.relay.noSendTest")}
      </p>

      {error ? (
        <p className="text-xs text-danger-text" role="alert" data-testid="relay-error">
          {error}
        </p>
      ) : null}

      <Separator />

      {/* 🔴🔴 The role difference, rendered the way Đợt B's command flow renders it: the actuator is
          SWAPPED for a sentence that names the role and says why. Not hidden (which would tell an
          Engineer the beacon does not exist) and not merely disabled (which would tell them it is
          broken). The server's Admin policy on the route is the real enforcement — this is the UX half. */}
      {canWriteRelay ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" data-testid="relay-save" onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-3.5" aria-hidden="true" />
            )}
            {t("notifications.action.save")}
          </Button>
          {current ? <DeleteChannelButton channel="Relay" t={t} /> : null}
        </div>
      ) : (
        <p className="text-xs text-text-muted" data-testid="relay-admin-required">
          {t("notifications.relay.adminRequired")}
        </p>
      )}
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Health / counters
// ─────────────────────────────────────────────────────────────────────────

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 border border-border bg-surface-subtle px-2.5 py-1.5">
      <span className="hmi-micro">{label}</span>
      <span className="font-numeric text-sm text-text-strong">{value}</span>
    </div>
  )
}

function StatusPanel({ t, gloss }: { t: TFunc; gloss: TFunc }) {
  const { data, isPending, isError } = useNotificationStatus()

  if (isPending) {
    return (
      <Sheet title={t("notifications.status.title")} titleEn={gloss("notifications.status.title")} bodyClassName="flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </Sheet>
    )
  }

  if (isError || !data) {
    return (
      <Sheet title={t("notifications.status.title")} titleEn={gloss("notifications.status.title")}>
        <p className="text-sm text-danger-text" role="alert">
          {t("notifications.status.error")}
        </p>
      </Sheet>
    )
  }

  return (
    <Sheet
      title={t("notifications.status.title")}
      titleEn={gloss("notifications.status.title")}
      bodyClassName="flex flex-col gap-3"
      data-testid="notification-status"
    >
      {/* 🔴 Attention first. Every entry is a real, current condition an operator must not have to hunt
          for — a partial e-mail delivery (the ONLY signal that one recipient silently stopped receiving
          alarms), a beacon believed lit with nothing latched, a store that failed a read. Empty is the
          normal state and is SAID, not left as a blank space that could also mean "not loaded". */}
      <div className="flex flex-col gap-1.5" data-testid="notification-attention">
        <span className="hmi-micro">{t("notifications.status.attention")}</span>
        {data.attention.length === 0 ? (
          <p className="text-xs text-text-muted">{t("notifications.status.attentionNone")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.attention.map((item) => (
              <li key={item} className="border-l-2 border-warn pl-2 text-xs text-text-body" role="alert">
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Separator />

      {/* 🔴 The configuration store's own health, beside the counters rather than on a page of its own: a
          FAILED read returns exactly what "nothing is configured" returns, so a zero anywhere below can
          mean either. The two facts are indistinguishable in the data and must be shown together. */}
      <div className="flex flex-col gap-1" data-testid="notification-store-health">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hmi-micro">{t("notifications.status.configStore")}</span>
          <StatusBadge
            status={!data.configStore.available ? "danger" : data.configStore.readFailures > 0 ? "warn" : "ok"}
          >
            {!data.configStore.available
              ? t("notifications.status.storeUnavailable")
              : data.configStore.readFailures > 0
                ? t("notifications.status.storeDegraded")
                : t("notifications.status.storeOk")}
          </StatusBadge>
        </div>
        <p className="text-xs text-text-muted">{data.configStore.detail}</p>
      </div>

      {data.smtp ? (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <span className="hmi-micro">{t("notifications.status.smtp")}</span>
            {/* 🔴 PartiallyDelivered is the only signal anywhere in this product that ONE recipient has
                silently stopped receiving alarms. It is hoisted to its own alert line, above the counter
                grid, so it can never be one number among eight. */}
            {data.smtp.partialDelivery ? (
              <p className="border-l-2 border-danger pl-2 text-xs text-danger-text" role="alert" data-testid="smtp-partial-delivery">
                {data.smtp.partialDelivery}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Counter label={t("notifications.counter.delivered")} value={data.smtp.stats.delivered} />
              <Counter label={t("notifications.counter.partiallyDelivered")} value={data.smtp.stats.partiallyDelivered} />
              <Counter label={t("notifications.counter.failed")} value={data.smtp.stats.failed} />
              <Counter label={t("notifications.counter.lost")} value={data.smtp.stats.lost} />
            </div>
          </div>
        </>
      ) : null}

      {data.webhook ? (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <span className="hmi-micro">{t("notifications.status.webhook")}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Counter label={t("notifications.counter.delivered")} value={data.webhook.delivered} />
              <Counter label={t("notifications.counter.retried")} value={data.webhook.retried} />
              <Counter label={t("notifications.counter.failed")} value={data.webhook.failed} />
              <Counter label={t("notifications.counter.lost")} value={data.webhook.lost} />
            </div>
          </div>
        </>
      ) : null}

      {data.localAnnunciation ? (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <span className="hmi-micro">{t("notifications.status.local")}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Counter label={t("notifications.counter.listeners")} value={data.localAnnunciation.listeners} />
              <Counter label={t("notifications.counter.maxListeners")} value={data.localAnnunciation.maxListeners} />
              <Counter label={t("notifications.counter.rejectedListeners")} value={data.localAnnunciation.rejectedListeners} />
              <Counter label={t("notifications.counter.unheard")} value={data.localAnnunciation.stats?.unheard ?? 0} />
            </div>
            {/* 🔴 `Unheard` does NOT mean "alarms nobody was told about" — a review corrected that once
                already and a three-word label is exactly what would undo it. The engine ships the full
                meaning in the payload precisely so a screen cannot invent a shorter one; it is rendered
                verbatim, beside the counter, not behind a tooltip. */}
            <p className="border-l-2 border-info pl-2 text-[11px] text-text-muted" data-testid="unheard-meaning">
              {data.localAnnunciation.unheardMeaning}
            </p>
          </div>
        </>
      ) : null}

      {data.relay ? (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <span className="hmi-micro">{t("notifications.status.relay")}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Counter label={t("notifications.counter.asserted")} value={data.relay.stats.asserted} />
              <Counter label={t("notifications.counter.released")} value={data.relay.stats.released} />
              <Counter label={t("notifications.counter.refused")} value={data.relay.stats.refused} />
              <Counter label={t("notifications.counter.lost")} value={data.relay.stats.lost} />
            </div>
            {data.relay.instances.length === 0 ? (
              <p className="text-xs text-text-muted">{t("notifications.status.noRelayInstances")}</p>
            ) : (
              data.relay.instances.map((instance) => <BeaconState key={instance.instance} state={instance} />)
            )}
          </div>
        </>
      ) : null}
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 🔴 Honest limitations — every one verified against the source file named beside it
// ─────────────────────────────────────────────────────────────────────────

function LimitationsPanel({ t, gloss }: { t: TFunc; gloss: TFunc }) {
  const keys = [
    "noSms",
    "noDesktopToast",
    "noImplicitTls",
    "smtpAuthUnprovable",
    "relayNotSafety",
    "relayNoTest",
    "noDeliveryGuarantee",
    "networkNeeded",
    "hmiNotAnnunciated",
  ]
  return (
    <Sheet
      title={t("notifications.limits.title")}
      titleEn={gloss("notifications.limits.title")}
      bodyClassName="flex flex-col gap-2"
      data-testid="notification-limitations"
    >
      <p className="text-sm text-text-muted">{t("notifications.limits.description")}</p>
      <ul className="flex flex-col gap-1.5">
        {keys.map((key) => (
          <li key={key} className="border-l-2 border-border-strong pl-2 text-xs text-text-body">
            {t(`notifications.limits.${key}`)}
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────

function NotificationsScreen() {
  const t = useT()
  const gloss = useGloss()
  const { data, isPending, isError, error } = useNotificationChannels()

  const channels = data?.channels

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <BellRing className="size-5 text-primary-text" aria-hidden="true" />
          <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
            {t("notifications.title")}
          </h1>
        </div>
        <p className="hmi-micro mt-1">{gloss("notifications.title")}</p>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("notifications.description")}</p>
      </div>

      <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 pb-4">
          {/* 🔴 A store that could not be OPENED is not "nothing is configured": no channel exists in the
              process at all, nothing will be sent to anybody, and no save can succeed until the engine
              host is repaired and restarted. It is the first thing on the page when it happens. */}
          {data && !data.configStore.available ? (
            <p
              className="border-l-2 border-danger bg-danger/5 p-3 text-sm text-danger-text"
              role="alert"
              data-testid="notification-store-unavailable"
            >
              {data.configStore.detail}
            </p>
          ) : null}

          {isError ? (
            <p className="border border-border p-3 text-sm text-danger-text" role="alert">
              {serverMessage(error, t("notifications.error.loadFailed"))}
            </p>
          ) : null}

          {isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <>
              <StatusPanel t={t} gloss={gloss} />

              <div className="grid gap-6 xl:grid-cols-2">
                <WebhookCard current={findChannel(channels, "Webhook")} t={t} gloss={gloss} />
                <SmtpCard current={findChannel(channels, "Smtp")} t={t} gloss={gloss} />
                <LocalAnnunciationCard current={findChannel(channels, "LocalAnnunciation")} t={t} gloss={gloss} />
                <RelayCard current={findChannel(channels, "Relay")} t={t} gloss={gloss} />
              </div>

              <LimitationsPanel t={t} gloss={gloss} />
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/** 🔴 Whole-page Engineer+ gate. `Users.tsx`/`Audit.tsx` use exact-role equality because those screens are
 * Admin-only and Admin is the top of the hierarchy; this one is Engineer-or-above, so it goes through
 * `meetsMinRole` — an Admin must see this screen too, and an exact-role check would lock them out of the
 * very screen whose relay card only they can save. */
export default function Notifications() {
  const t = useT()
  const gloss = useGloss()
  const { user } = useAuth()

  if (!meetsMinRole("Engineer", user?.role)) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-md flex-col gap-2 border border-border bg-surface-card p-5 text-center">
          <Siren className="mx-auto size-6 text-warn-text" aria-hidden="true" />
          <h1 className="font-heading text-lg font-semibold text-text-strong">{t("notifications.denied.title")}</h1>
          <p className="hmi-micro">{gloss("notifications.denied.title")}</p>
          <p className="text-sm text-text-muted">{t("notifications.denied.description")}</p>
        </div>
      </div>
    )
  }

  return <NotificationsScreen />
}

