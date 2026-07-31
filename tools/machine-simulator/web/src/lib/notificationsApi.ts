/**
 * 🔴 Task C-8 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-8-brief.md) — the typed
 * EngineApi client for Đợt C's alarm-notification surface, sibling to `lib/configApi.ts` and
 * `lib/machineSettingsApi.ts` (same `BASE_URL` resolution, same `request<T>` wrapper shape, same
 * query-invalidation convention) rather than a parallel dialect.
 *
 * Wire shapes mirror `St4i.EngineApi.Endpoints.NotificationDtos` / `Alarms.NotificationConfig` EXACTLY.
 * Every response goes through `ApiJson.Options` (`JsonSerializerDefaults.Web` + `JsonStringEnumConverter`),
 * so enums are their C# member names on the wire: `"Webhook"`, `"StartTls"`, `"Critical"`, `"Point"`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 THE FOUR WAYS THIS API SILENTLY DESTROYS A CREDENTIAL, AND WHERE EACH IS HANDLED
 * ─────────────────────────────────────────────────────────────────────────
 * C-7's report §11.2 enumerates these. They are properties of the endpoint contract, not bugs, and each
 * one is defeated in exactly one place so a future edit has one thing to not break:
 *
 * 1. **The webhook PUT requires its URL on every save**, including one that only changes a label, because
 *    reading the stored URL back would decrypt a bearer capability inside an HTTP handler. There is
 *    deliberately NO client-side workaround here — {@link WebhookSaveInput.url} is a REQUIRED string, so a
 *    caller that forgets it fails to compile rather than at runtime. The form carries it; see
 *    `routes/Notifications.tsx`.
 * 2. **Secret tri-state: absent = keep, `""` = clear, value = replace.** Modelled as
 *    `string | null | undefined` with {@link secretField} as the ONE place the mapping is written:
 *    `undefined` → omit the key entirely, `null` → send `""`, a string → send it. A form that always sent
 *    `""` would wipe the credential on every save, which is why no caller builds this object by hand.
 * 3. **Omitting `authHeaderName` DELETES the stored auth token** — PUT is full replacement, and a token
 *    that names no header can never be sent. So `authHeaderName` is a REQUIRED `string | null` on
 *    {@link WebhookSaveInput}: `null` is an explicit "clear it (and the token with it)", and there is no
 *    way to express "I forgot". The rule generalises — **only the secret fields keep-on-absent; every
 *    non-secret field must be re-sent unless you are deliberately clearing it** — so every non-secret
 *    field on every save input below is required too.
 * 4. **A save that commits the row but fails the credential answers 500, not 200.** C-7's I-1: a committed
 *    webhook row with a signing secret that did not commit posts UNSIGNED from then on.
 *    {@link NotificationApiError.serverMessage} carries the server's own sentence for that, and callers
 *    surface it verbatim rather than inventing "save failed".
 *
 * Statuses this surface produces that a caller must tell apart: **409** = the per-channel instance cap
 * (delete one first — not a validation error on the form), **429** = the send-test rate limiter (with
 * `Retry-After`), **503** = the configuration store never opened (nothing can be saved until the engine is
 * repaired and restarted), **500** = the store is open but the write did not commit.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query"

const BASE_URL =
  (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:5199" : "")

// ─────────────────────────────────────────────────────────────────────────
// Wire types — 1:1 with NotificationDtos.cs / NotificationConfig.cs
// ─────────────────────────────────────────────────────────────────────────

/** `NotificationChannel`. The four channels Đợt C built. */
export type NotificationChannelKind = "Webhook" | "Smtp" | "LocalAnnunciation" | "Relay"

/** `AlarmPriority`, declared MOST-SEVERE-FIRST in C#. Only `Critical` and `High` actually occur in this
 * build, which is why the form says so rather than offering four equal-looking options. */
export type NotificationPriority = "Critical" | "High" | "Medium" | "Low"

/** `SmtpTlsMode`. 🔴 There is deliberately no implicit-TLS/SMTPS/port-465 member: `System.Net.Mail`
 * implements only STARTTLS and provably cannot honour one. See `SmtpNotificationChannel`'s class doc. */
export type SmtpTlsMode = "None" | "StartTls"

/** `RelayTargetKind`. 🔴 `Command` is what makes the relay route Admin-tier — see {@link RelaySaveInput}. */
export type RelayTargetKind = "Point" | "Command"

export interface WebhookChannelSummary {
  /** Host (and port) only — never the path, never the query. The URL itself is a bearer capability and no
   * read of this API returns it. */
  endpoint: string
  /** What lets an operator confirm they are re-entering the SAME destination without ever being handed it. */
  urlFingerprint: string
  label?: string | null
  /** `false` means this channel cannot post anywhere — a stored URL that could not be decrypted. */
  hasUrl: boolean
  /** `false` means the POST is sent UNSIGNED. Legitimate for Slack/Teams; a real gap for an MES. */
  hasSigningSecret: boolean
  authHeaderName?: string | null
  /** `authHeaderName` set with this `false` is a webhook that cannot post at all. */
  hasAuthToken: boolean
}

export interface SmtpChannelSummary {
  host: string
  port: number
  tls: SmtpTlsMode
  fromAddress: string
  recipients: string[]
  /** Deliberately not a secret: an operator diagnosing an authentication failure needs to see which
   * account is configured, and a username alone authorises nobody. */
  username?: string | null
  hasPassword: boolean
}

export interface RelayChannelSummary {
  machineCode: string
  targetKind: RelayTargetKind
  targetName: string
  onValueJson?: string | null
  offValueJson?: string | null
}

export interface NotificationChannelSummary {
  channel: NotificationChannelKind
  instance: string
  enabled: boolean
  minPriority: NotificationPriority
  updatedAtUtc: string
  webhook?: WebhookChannelSummary | null
  smtp?: SmtpChannelSummary | null
  relay?: RelayChannelSummary | null
}

/** 🔴 `NotificationConfigStoreHealthDto`. Returned beside EVERY read and every save because
 * `ListAsync` is never-throws: a read that FAILED returns exactly what "nothing is configured" returns.
 * Two facts that are indistinguishable in the data must be shown together. */
export interface NotificationConfigStoreHealth {
  /** `false` = the store could not be OPENED at startup, so no channel exists in this process at all. */
  available: boolean
  directory?: string | null
  readFailures: number
  writeFailures: number
  lastFailureOperation?: string | null
  /** The exception TYPE NAME only — never its message, which is provider-controlled text. */
  lastFailureType?: string | null
  lastFailureUtc?: string | null
  /** The sentence that says what a zero somewhere else might actually mean. Longer than a label on
   * purpose, and rendered in full rather than abbreviated. */
  detail: string
}

export interface NotificationChannelsResponse {
  channels: NotificationChannelSummary[]
  configStore: NotificationConfigStoreHealth
}

export interface NotificationSaveResult {
  saved?: NotificationChannelSummary | null
  configStore: NotificationConfigStoreHealth
}

// ── Counters. Every field is documented in units of (notification, instance) pairs on the C# side. ──

export interface AlarmNotifierStats {
  observed: number
  enqueued: number
  dropped: number
  channels: number
}

export interface AlarmNotifierChannelStats {
  channel: string
  queued: number
  delivered: number
  failed: number
  dropped: number
  depth: number
  capacity: number
}

export interface WebhookChannelStats {
  considered: number
  eligible: number
  delivered: number
  failed: number
  /** 🔴 A loss: these reached nobody, and there is no delivery queue behind any channel in this build. */
  lost: number
  retried: number
  suppressed: number
}

export interface SmtpChannelStats {
  considered: number
  eligible: number
  delivered: number
  /** 🔴 THE only signal in this product that ONE recipient has silently stopped receiving alarms. */
  partiallyDelivered: number
  failed: number
  lost: number
  retried: number
  suppressed: number
}

export interface SmtpStatus {
  stats: SmtpChannelStats
  /** Non-null whenever {@link SmtpChannelStats.partiallyDelivered} is non-zero. Its own sentence, because
   * one number among eight is exactly how this gets missed. */
  partialDelivery?: string | null
}

export interface LocalAnnunciationStats {
  considered: number
  eligible: number
  published: number
  /** 🔴 See {@link LocalAnnunciationStatus.unheardMeaning}: the short reading of this counter is FALSE. */
  unheard: number
  lost: number
  suppressed: number
}

export interface LocalAnnunciationStatus {
  /** `null` when the local-annunciation CHANNEL is not running (the configuration store never opened).
   * The gauges beside it are still real — they come from the hub, which is registered unconditionally. */
  stats?: LocalAnnunciationStats | null
  listeners: number
  maxListeners: number
  /** Each one is a page that was NOT annunciated. */
  rejectedListeners: number
  hubPublished: number
  hubFannedOut: number
  hubOverflowed: number
  /** 🔴 The long form of {@link LocalAnnunciationStats.unheard}, carried in the payload rather than left
   * to a screen to invent, because the short form ("alarms nobody was told about") is false. Rendered
   * verbatim — never abbreviated back into the label it replaced. */
  unheardMeaning: string
}

export interface RelayChannelStats {
  considered: number
  eligible: number
  asserted: number
  released: number
  refused: number
  failed: number
  lost: number
  suppressed: number
}

/** 🔴 One relay annunciator, as an operator may see it.
 *
 * `commanded` is deliberately ABSENT from the wire shape — C-6's carried constraint is that a screen must
 * render `energised` and never `commanded`, and leaving it out of the payload makes that mistake
 * unavailable rather than merely discouraged. Do not add it here either. */
export interface RelayInstanceState {
  instance: string
  latchedAlarms: number
  /** 🔴 `true` = believed ON, `false` = believed OFF, `null` = **UNKNOWN**. Never render `null` as "off" —
   * render {@link annunciatorState}, which is the rendering. */
  energised?: boolean | null
  lastAttemptUtc?: string | null
  /** 🔴 The sentence a screen shows. It distinguishes the three states a boolean cannot: ON with nothing
   * latched (this product asked for the beacon to go OUT and was refused — it is still lit), and UNKNOWN
   * (this product does not know what the beacon is doing, which is NOT the same as off). */
  annunciatorState: string
}

export interface RelayStatus {
  stats: RelayChannelStats
  instances: RelayInstanceState[]
}

/** `GET /v1/notifications/status` (**Engineer** — it carries every alarm recipient's e-mail address). */
export interface NotificationStatus {
  configStore: NotificationConfigStoreHealth
  notifier?: AlarmNotifierStats | null
  queues: AlarmNotifierChannelStats[]
  webhook?: WebhookChannelStats | null
  smtp?: SmtpStatus | null
  localAnnunciation?: LocalAnnunciationStatus | null
  relay?: RelayStatus | null
  /** 🔴 Full sentences naming real, current conditions. Empty is the normal state and means exactly that —
   * so an empty list renders as "nothing needs attention", never as a blank panel. */
  attention: string[]
}

/** 🔴 `GET /v1/notifications/annunciator` (**Operator**) — Task C-8's new narrower route. NOT a role change
 * on `/status`, which stays Engineer because it carries recipient addresses. */
export interface AnnunciatorStatus {
  /** `false` = the store never opened, or has failed a read since. Either way an empty {@link relays} list
   * means "this product cannot tell" rather than "nothing is configured". */
  configurationReadable: boolean
  configurationDetail: string
  localAnnunciationRunning: boolean
  listeners: number
  maxListeners: number
  rejectedListeners: number
  relays: RelayInstanceState[]
  attention: string[]
}

/** 🔴 `NotificationTestOutcome`. Four fields, because a bare boolean is what a UI renders and a statement
 * only survives contact with a UI if it is a field. A screen that shows {@link ok} alone has visibly
 * dropped something — see {@link doesNotProve}. */
export interface NotificationTestOutcome {
  /** Whether the test message was ACCEPTED by the destination. Never more than that. */
  ok: boolean
  detail: string
  /** On success, exactly what a green result establishes. `null` on failure, where `detail` is the whole
   * answer. */
  proves?: string | null
  /** 🔴 On success, the honest limit — including that a green SMTP test does NOT prove the stored password
   * works, and whether the channel is currently DISABLED. Rendered with the same weight as `proves`. */
  doesNotProve?: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// 🔴 Request shapes. See this file's header for why every non-secret field is REQUIRED.
// ─────────────────────────────────────────────────────────────────────────

/**
 * 🔴 A secret field's three states, as one type. `undefined` = leave the stored credential exactly as it
 * is; `null` = DELETE it; a string = replace it. Never build the wire value by hand — use
 * {@link secretField}, which is the only place the mapping to `absent`/`""`/value is written.
 */
export type SecretUpdate = string | null | undefined

/** 🔴 The tri-state, in one function. Spread the result into the request body:
 * `{ ...secretField("password", password) }`. `undefined` contributes NO KEY (keep), `null` contributes
 * `""` (clear), a string contributes itself (replace).
 *
 * The `""`-means-clear convention is why this cannot be `value ?? undefined`: a form that always sent the
 * empty string for an untouched password field would wipe the credential on every save. */
export function secretField(name: string, value: SecretUpdate): Record<string, string> {
  if (value === undefined) return {}
  return { [name]: value === null ? "" : value }
}

export interface WebhookSaveInput {
  enabled: boolean
  minPriority: NotificationPriority
  /** 🔴 REQUIRED on every save, including one that only changes a label. The endpoint deliberately cannot
   * re-use the stored URL — doing so would decrypt a bearer capability inside a request handler. Confirm
   * you are re-entering the same destination with {@link WebhookChannelSummary.urlFingerprint}. */
  url: string
  /** Required (`null` clears) — PUT is full replacement, so an omitted label is a cleared label. */
  label: string | null
  /** 🔴 Required (`null` clears). Clearing it also DELETES the stored auth token, because a token that
   * names no header can never be sent. This is the one field whose omission destroys a credential it says
   * nothing about, which is why it cannot be optional here. */
  authHeaderName: string | null
  signingSecret?: SecretUpdate
  authToken?: SecretUpdate
  instance?: string
}

export interface SmtpSaveInput {
  enabled: boolean
  minPriority: NotificationPriority
  host: string
  port: number
  tls: SmtpTlsMode
  fromAddress: string
  recipients: string[]
  /** Required (`null` clears). Not a secret — see {@link SmtpChannelSummary.username}. */
  username: string | null
  password?: SecretUpdate
  instance?: string
}

export interface LocalAnnunciationSaveInput {
  enabled: boolean
  minPriority: NotificationPriority
  instance?: string
}

/**
 * 🔴🔴 **ADMIN.** `PUT /v1/notifications/relay` is the one configuration in this product that GRANTS
 * AUTHORITY: with {@link targetKind} = `"Command"` it makes the engine perform, automatically and for as
 * long as the row exists, an action a human needs Admin for (`MachineWriteGate.RoleFor`). The gate is on
 * the ROUTE — the whole route, PUT and DELETE — not on the `Command` case inside a handler, so a UI that
 * shows an Engineer a relay form is showing them a form whose every save will 403.
 */
export interface RelaySaveInput {
  enabled: boolean
  minPriority: NotificationPriority
  machineCode: string
  targetKind: RelayTargetKind
  targetName: string
  /** Required for a `Point` target, refused for a `Command` one. There is deliberately no default: a
   * default would be this product choosing what to write to a coil it cannot prove is a lamp rather than a
   * conveyor, and `true` is simply wrong for a Modbus holding register that wants `1`. */
  onValueJson?: string | null
  /** A separate value rather than a derived inverse — the register map's declared range is the authority
   * on what "off" is and this product must not infer it. */
  offValueJson?: string | null
  instance?: string
}

// ─────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────

/**
 * 🔴 Carries the server's OWN sentence. Every 400/409/429/500/503 on this surface has a hand-written
 * message that names the actual problem and what to do — "a webhook URL is required on every save … check
 * `urlFingerprint`", "delete one first", "try again in 3.2s", "the signing secret did NOT commit, so this
 * webhook would post UNSIGNED". Replacing any of those with a generic "save failed" is how an operator
 * ends up with a channel that looks configured and posts unsigned.
 */
export class NotificationApiError extends Error {
  readonly status: number
  readonly serverMessage?: string

  constructor(status: number, serverMessage?: string) {
    super(serverMessage ?? `Notification request failed with ${status}`)
    this.name = "NotificationApiError"
    this.status = status
    this.serverMessage = serverMessage
  }

  /** The per-channel instance cap (`MaxInstancesPerChannel` = 8). C-7's note #5: render this as "delete
   * one first", never as a validation error on the field the operator was last editing. */
  get isAtInstanceCap(): boolean {
    return this.status === 409
  }

  /** The send-test rate limiter — one test per 5s, globally. Not a failure of the channel. */
  get isRateLimited(): boolean {
    return this.status === 429
  }

  /** The configuration store never opened. NOTHING can be saved until the engine host is repaired and
   * restarted, so a retry button is the wrong affordance. */
  get isStoreUnavailable(): boolean {
    return this.status === 503
  }

  /** 403 — for the relay routes this means "you are not Admin", which the UI states rather than showing a
   * dead button. */
  get isForbidden(): boolean {
    return this.status === 403
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  })

  if (!res.ok) {
    let serverMessage: string | undefined
    try {
      const body = (await res.json()) as { error?: string }
      serverMessage = body?.error
    } catch {
      // Non-JSON body (a proxy page, a bare 500) — the status alone is what the caller gets.
    }
    throw new NotificationApiError(res.status, serverMessage)
  }

  return (await res.json()) as T
}

// ─────────────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_CHANNELS_KEY = ["notification-channels"] as const
export const NOTIFICATION_STATUS_KEY = ["notification-status"] as const
export const ANNUNCIATOR_STATUS_KEY = ["annunciator-status"] as const

/** 🔴 The path segment per channel. One route per channel rather than one parameterised route, so each
 * carries its own policy in its own endpoint metadata — which is what makes the relay's Admin gate a
 * routing fact the server's RBAC sweep can assert rather than an `if` inside a handler. */
const CHANNEL_PATH: Record<NotificationChannelKind, string> = {
  Webhook: "webhook",
  Smtp: "smtp",
  LocalAnnunciation: "local-annunciation",
  Relay: "relay",
}

const endpoints = {
  channels: () => request<NotificationChannelsResponse>("/v1/notifications/channels"),
  status: () => request<NotificationStatus>("/v1/notifications/status"),
  annunciator: () => request<AnnunciatorStatus>("/v1/notifications/annunciator"),

  saveWebhook: (input: WebhookSaveInput) =>
    request<NotificationSaveResult>("/v1/notifications/webhook", {
      method: "PUT",
      body: JSON.stringify({
        enabled: input.enabled,
        minPriority: input.minPriority,
        url: input.url,
        label: input.label ?? "",
        // 🔴 Always sent, never omitted — omitting it clears the header name AND deletes the token.
        authHeaderName: input.authHeaderName ?? "",
        ...secretField("signingSecret", input.signingSecret),
        ...secretField("authToken", input.authToken),
        ...(input.instance ? { instance: input.instance } : {}),
      }),
    }),

  saveSmtp: (input: SmtpSaveInput) =>
    request<NotificationSaveResult>("/v1/notifications/smtp", {
      method: "PUT",
      body: JSON.stringify({
        enabled: input.enabled,
        minPriority: input.minPriority,
        host: input.host,
        port: input.port,
        tls: input.tls,
        fromAddress: input.fromAddress,
        recipients: input.recipients,
        username: input.username ?? "",
        ...secretField("password", input.password),
        ...(input.instance ? { instance: input.instance } : {}),
      }),
    }),

  saveLocalAnnunciation: (input: LocalAnnunciationSaveInput) =>
    request<NotificationSaveResult>("/v1/notifications/local-annunciation", {
      method: "PUT",
      body: JSON.stringify({
        enabled: input.enabled,
        minPriority: input.minPriority,
        ...(input.instance ? { instance: input.instance } : {}),
      }),
    }),

  saveRelay: (input: RelaySaveInput) =>
    request<NotificationSaveResult>("/v1/notifications/relay", {
      method: "PUT",
      body: JSON.stringify({
        enabled: input.enabled,
        minPriority: input.minPriority,
        machineCode: input.machineCode,
        targetKind: input.targetKind,
        targetName: input.targetName,
        // A Command target must carry NEITHER value; the endpoint refuses both with a 400 that says why.
        onValueJson: input.targetKind === "Point" ? (input.onValueJson ?? "") : null,
        offValueJson: input.targetKind === "Point" ? (input.offValueJson ?? "") : null,
        ...(input.instance ? { instance: input.instance } : {}),
      }),
    }),

  remove: (channel: NotificationChannelKind, instance?: string) =>
    request<{ channel: NotificationChannelKind; instance: string; message: string }>(
      `/v1/notifications/${CHANNEL_PATH[channel]}${instance ? `?instance=${encodeURIComponent(instance)}` : ""}`,
      { method: "DELETE" },
    ),

  test: (channel: NotificationChannelKind, instance?: string) =>
    request<NotificationTestOutcome>("/v1/notifications/test", {
      method: "POST",
      body: JSON.stringify({ channel, ...(instance ? { instance } : {}) }),
    }),
}

// ─────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────

/** `GET /v1/notifications/channels` (Engineer). On-demand, not polled: a configuration only changes when
 * somebody on this screen changes it, and every mutation below invalidates this key. */
export function useNotificationChannels(): UseQueryResult<NotificationChannelsResponse> {
  return useQuery({
    queryKey: NOTIFICATION_CHANNELS_KEY,
    queryFn: endpoints.channels,
    retry: false,
  })
}

/** `GET /v1/notifications/status` (Engineer) — polled at 5s, the cadence `useHealth`/`useMode` use. These
 * are counters and gauges that move on their own (a delivery failure, a browser attaching, a beacon write
 * being refused), so unlike the configuration they must not wait for a manual refresh. */
export function useNotificationStatus(): UseQueryResult<NotificationStatus> {
  return useQuery({
    queryKey: NOTIFICATION_STATUS_KEY,
    queryFn: endpoints.status,
    refetchInterval: 5000,
    retry: false,
  })
}

/** 🔴 `GET /v1/notifications/annunciator` (**Operator**) — polled at 5s. This is the one notification read
 * an operator gets, and it exists so an operator screen can show the beacon's believed state without
 * being handed the recipient list that `useNotificationStatus` carries. */
export function useAnnunciatorStatus(): UseQueryResult<AnnunciatorStatus> {
  return useQuery({
    queryKey: ANNUNCIATOR_STATUS_KEY,
    queryFn: endpoints.annunciator,
    refetchInterval: 5000,
    retry: false,
  })
}

/** Every mutation invalidates BOTH the configuration and the status: a save changes what is configured
 * AND can change whether a channel exists to report counters at all. */
function useInvalidateNotifications() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: NOTIFICATION_CHANNELS_KEY })
    void queryClient.invalidateQueries({ queryKey: NOTIFICATION_STATUS_KEY })
    void queryClient.invalidateQueries({ queryKey: ANNUNCIATOR_STATUS_KEY })
  }
}

export function useSaveWebhook() {
  const invalidate = useInvalidateNotifications()
  return useMutation({ mutationFn: endpoints.saveWebhook, onSuccess: invalidate })
}

export function useSaveSmtp() {
  const invalidate = useInvalidateNotifications()
  return useMutation({ mutationFn: endpoints.saveSmtp, onSuccess: invalidate })
}

export function useSaveLocalAnnunciation() {
  const invalidate = useInvalidateNotifications()
  return useMutation({ mutationFn: endpoints.saveLocalAnnunciation, onSuccess: invalidate })
}

/** 🔴🔴 **ADMIN.** See {@link RelaySaveInput} — the server gates the whole route, so an Engineer calling
 * this gets a 403 and the UI must say so rather than presenting a save button that cannot work. */
export function useSaveRelay() {
  const invalidate = useInvalidateNotifications()
  return useMutation({ mutationFn: endpoints.saveRelay, onSuccess: invalidate })
}

/** `DELETE /v1/notifications/{channel}`. Engineer for three channels, **Admin for the relay** — an
 * Engineer who could delete the relay row could silently un-configure the plant's beacon and could not put
 * it back, since the save is Admin. `ON DELETE CASCADE` takes every stored secret with the row, so
 * removing a channel can never strand a credential. */
export function useDeleteNotificationChannel() {
  const invalidate = useInvalidateNotifications()
  return useMutation({
    mutationFn: ({ channel, instance }: { channel: NotificationChannelKind; instance?: string }) =>
      endpoints.remove(channel, instance),
    onSuccess: invalidate,
  })
}

/**
 * `POST /v1/notifications/test` (Engineer, **rate limited to one per 5s globally**).
 *
 * 🔴 Webhook and SMTP only. Local annunciation and the relay are refused with a **400 that states the
 * reason** rather than being silently unsupported, and that sentence is what the UI shows — a test would
 * respectively publish a fabricated alarm card and tone to every open page, and perform a real Admin-tier
 * machine write that could leave a beacon lit by a test.
 *
 * 🔴 It moves NO channel counter. A test is not a notification, so counting it would corrupt the
 * accounting invariant the four delivery counters hold.
 */
export function useSendNotificationTest() {
  return useMutation({
    mutationFn: ({ channel, instance }: { channel: NotificationChannelKind; instance?: string }) =>
      endpoints.test(channel, instance),
  })
}
