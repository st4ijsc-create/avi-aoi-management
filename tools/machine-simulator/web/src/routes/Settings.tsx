import * as React from "react"
import { motion } from "framer-motion"
import { CircleCheck, CircleX, KeyRound, Loader2, Save, Wifi } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useLanguage, useT } from "@/i18n"
import {
  useMode,
  useOnboardingPasteKey,
  useProbeSettings,
  useSettings,
  useSetMode,
  useUpdateSettings,
  type TransportMode,
} from "@/lib/api"
import { listCredentials, recordCredential, type CredentialRecord } from "@/lib/credentials"
import { cn } from "@/lib/utils"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectItem, SelectPopup, SelectPortal, SelectPositioner, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Switch } from "@/components/ui/switch"
import { FormField } from "@/components/FormField"

const MODE_VALUES: TransportMode[] = ["Live", "Demo", "Auto"]

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatSavedAt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFormatter.format(d)
}

// ─────────────────────────────────────────────────────────────────────────
// Mode selector — same segmented-control pattern as TopBar's transport-mode switch, built locally so
// this screen doesn't reach into Task 4's shell component; both read/write the same `/v1/mode`.
// ─────────────────────────────────────────────────────────────────────────
function ModeSelector() {
  const t = useT()
  const { data, isPending } = useMode()
  const setMode = useSetMode()
  const current = (setMode.isPending ? setMode.variables : undefined) ?? data?.mode ?? "Demo"

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={t("settings.mode.radioGroupAria")} className="grid grid-cols-3 gap-2">
        {MODE_VALUES.map((value) => {
          const selected = current === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={isPending}
              onClick={() => setMode.mutate(value)}
              className={cn(
                "flex flex-col items-start gap-0.5 border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600/50",
                // `bg-navy-600/10`/`text-primary-text` (not `bg-navy-50`/`text-navy-700`) — see
                // Scenario.tsx's `PresetCard` for why: the raw navy-50/700 scale has no dark override
                // and axe measured 1.23:1 on a dark card.
                selected ? "border-navy-600 bg-navy-600/10" : "border-border-strong hover:bg-surface-subtle"
              )}
            >
              <span
                className={cn(
                  "font-heading text-sm font-semibold tracking-wide uppercase",
                  selected ? "text-primary-text" : "text-text-strong"
                )}
              >
                {value}
              </span>
              {/* `text-primary-text` (not `text-text-muted`) when selected — axe measured 4.4:1 for
                  `text-text-muted` on the `bg-navy-600/10` tint (fails AA 4.5:1 by a hair); the value
                  span above already uses `text-primary-text` on this same selected background for
                  the identical reason (see this button's className comment). */}
              <span className={cn("text-[11px]", selected ? "text-primary-text" : "text-text-muted")}>
                {t(`settings.mode.${value.toLowerCase()}.hint`)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────

export default function Settings() {
  const t = useT()
  const gloss = useGloss()
  const { setLanguage: setUiLanguage } = useLanguage()
  const settingsQuery = useSettings()
  const updateSettings = useUpdateSettings()
  const probe = useProbeSettings()
  const pasteKeyMutation = useOnboardingPasteKey()

  const [initialized, setInitialized] = React.useState(false)
  const [serverUrl, setServerUrl] = React.useState("")
  const [verifyTls, setVerifyTls] = React.useState(true)
  const [language, setLanguage] = React.useState("vi")
  const [machineCode, setMachineCode] = React.useState("")

  const [pasteCode, setPasteCode] = React.useState("")
  const [pasteKey, setPasteKey] = React.useState("")
  const [pasteMessage, setPasteMessage] = React.useState<{ text: string; ok: boolean } | null>(null)
  const [credentials, setCredentials] = React.useState<CredentialRecord[]>(() => listCredentials())

  React.useEffect(() => {
    if (!initialized && settingsQuery.data) {
      setServerUrl(settingsQuery.data.serverUrl)
      setVerifyTls(settingsQuery.data.verifyTls)
      setLanguage(settingsQuery.data.language)
      setMachineCode(settingsQuery.data.machineCode)
      setInitialized(true)
    }
  }, [initialized, settingsQuery.data])

  const dirty =
    initialized && settingsQuery.data
      ? serverUrl !== settingsQuery.data.serverUrl ||
        verifyTls !== settingsQuery.data.verifyTls ||
        language !== settingsQuery.data.language ||
        machineCode !== settingsQuery.data.machineCode
      : false

  // The dropdown flips the live UI language immediately (see `handleLanguageChange`) — this mutation
  // additionally persists the choice server-side (`SettingsDto.language`), same "Save" gate as every
  // other field on this screen.
  const handleSave = () => {
    updateSettings.mutate(
      { serverUrl: serverUrl.trim(), verifyTls, language, machineCode: machineCode.trim() },
      {
        onSuccess: (data) => {
          setServerUrl(data.serverUrl)
          setVerifyTls(data.verifyTls)
          setLanguage(data.language)
          setMachineCode(data.machineCode)
          toast.success(t("toast.settingsSaved"))
        },
        onError: () => toast.error(t("toast.settingsSaveFailed")),
      }
    )
  }

  const handleLanguageChange = (value: string) => {
    setLanguage(value)
    if (value === "vi" || value === "en") setUiLanguage(value)
  }

  const handleProbe = () => {
    const url = serverUrl.trim()
    if (!url) return
    probe.mutate(url)
  }

  const handlePasteKey = () => {
    if (!pasteCode.trim() || !pasteKey.trim()) {
      setPasteMessage({ text: t("settings.auth.needBoth"), ok: false })
      return
    }
    pasteKeyMutation.mutate(
      { machineCode: pasteCode.trim(), mkKey: pasteKey.trim() },
      {
        onSuccess: (data) => {
          const ok = data.step !== "Idle"
          setPasteMessage({ text: data.message, ok })
          if (ok && data.machineCode) {
            setCredentials(recordCredential(data.machineCode))
            setPasteCode("")
            setPasteKey("")
            toast.success(t("toast.onboardingKeyStored", { code: data.machineCode }))
          }
        },
        onError: (err) =>
          setPasteMessage({ text: err instanceof Error ? err.message : t("settings.auth.unknownError"), ok: false }),
      }
    )
  }

  if (settingsQuery.isPending) return <SettingsSkeleton />

  const LANGUAGE_ITEMS = [
    { value: "vi", label: t("settings.language.vi") },
    { value: "en", label: t("settings.language.en") },
  ]

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex shrink-0 flex-col gap-1">
        <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
          {t("settings.title")}
        </h1>
        <p className="hmi-micro mt-1">{gloss("settings.title")}</p>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("settings.subtitle")}</p>
      </div>

      {/* The shell's own `<main>` carries `overflow-y-auto` (Shell.tsx) — without `h-full min-h-0` on
          this route root plus an internal `hmi-scroll` wrapper around the grid, a viewport shorter than
          the 4-Sheet grid's content scrolls the whole page instead of just this panel (spec §8). Same
          H3c fix as `Scenario.tsx`; the save bar below stays outside this wrapper so it's always
          reachable without scrolling past it. */}
      <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Sheet title={t("settings.connection.title")} titleEn={gloss("settings.connection.title")} bodyClassName="flex flex-col gap-4">
          <FormField label="Server URL" labelEn="SERVER URL" htmlFor="settings-server-url">
            <Input
              id="settings-server-url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:5000"
              className="font-mono"
            />
          </FormField>

          <label htmlFor="settings-verify-tls" className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-sm font-medium text-text-body">{t("settings.connection.verifyTlsLabel")}</span>
              <span className="text-[11px] text-text-muted">{t("settings.connection.verifyTlsHint")}</span>
            </span>
            <Switch id="settings-verify-tls" checked={verifyTls} onCheckedChange={setVerifyTls} />
          </label>

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={handleProbe} disabled={probe.isPending || !serverUrl.trim()}>
              {probe.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Wifi className="size-3.5" aria-hidden="true" />}
              {probe.isPending ? t("settings.connection.checking") : t("settings.connection.check")}
            </Button>

            {probe.data ? (
              probe.data.reachable ? (
                <StatusBadge status="ok">
                  {t("settings.connection.reachable", { status: probe.data.status, count: probe.data.paths.length })}
                </StatusBadge>
              ) : (
                <StatusBadge status="danger">{t("settings.connection.unreachable")}</StatusBadge>
              )
            ) : probe.isError ? (
              <StatusBadge status="danger">{t("settings.connection.requestFailed")}</StatusBadge>
            ) : null}
          </div>
        </Sheet>

        <Sheet title={t("settings.mode.title")} titleEn={gloss("settings.mode.title")} bodyClassName="flex flex-col gap-4">
          <p className="text-sm text-text-muted">{t("settings.mode.appliesImmediately")}</p>
          <ModeSelector />
        </Sheet>

        <Sheet title={t("settings.auth.title")} titleEn={gloss("settings.auth.title")} bodyClassName="flex flex-col gap-4">
          <FormField
            label={t("settings.auth.machineCodeLabel")}
            labelEn={gloss("settings.auth.machineCodeLabel")}
            htmlFor="settings-machine-code"
            hint={t("settings.auth.machineCodeHint")}
          >
            <Input
              id="settings-machine-code"
              value={machineCode}
              onChange={(e) => setMachineCode(e.target.value)}
              placeholder={t("settings.auth.machineCodePlaceholder")}
              className="font-numeric"
            />
          </FormField>

          <Separator />

          <div className="flex flex-col gap-2">
            <FormField label={t("settings.auth.pasteCodeLabel")} labelEn={gloss("settings.auth.pasteCodeLabel")} htmlFor="settings-paste-code">
              <Input
                id="settings-paste-code"
                value={pasteCode}
                onChange={(e) => setPasteCode(e.target.value)}
                placeholder={t("settings.auth.pasteCodePlaceholder")}
                className="font-numeric"
              />
            </FormField>
            <FormField label={t("settings.auth.pasteKeyLabel")} labelEn={gloss("settings.auth.pasteKeyLabel")} htmlFor="settings-paste-key">
              <Input id="settings-paste-key" value={pasteKey} onChange={(e) => setPasteKey(e.target.value)} placeholder="mk_…" className="font-mono" />
            </FormField>
            <Button type="button" onClick={handlePasteKey} disabled={pasteKeyMutation.isPending} className="w-fit">
              {pasteKeyMutation.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <KeyRound className="size-3.5" aria-hidden="true" />}
              {pasteKeyMutation.isPending ? t("settings.auth.savingKey") : t("settings.auth.saveKey")}
            </Button>
            {pasteMessage ? (
              <p className={cn("flex items-center gap-1.5 text-xs", pasteMessage.ok ? "text-ok-text" : "text-danger-text")} role="status">
                {pasteMessage.ok ? <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" /> : <CircleX className="size-3.5 shrink-0" aria-hidden="true" />}
                {pasteMessage.text}
              </p>
            ) : null}
          </div>

          <Separator />

          <div className="flex flex-col gap-1.5">
            <span className="hmi-micro">{t("settings.auth.savedTitle")}</span>
            {credentials.length === 0 ? (
              <p className="text-xs text-text-muted">{t("settings.auth.noneSaved")}</p>
            ) : (
              <ul className="flex flex-col">
                {credentials.map((cred) => (
                  <li
                    key={cred.code}
                    className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 text-xs last:border-0"
                  >
                    <span className="font-numeric font-medium text-text-strong">{cred.code}</span>
                    <span className="font-numeric text-text-muted">{formatSavedAt(cred.savedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-text-muted">{t("settings.auth.caveat")}</p>
          </div>
        </Sheet>

        <Sheet title={t("settings.language.title")} titleEn={gloss("settings.language.title")} bodyClassName="flex flex-col gap-4">
          <FormField label={t("settings.language.label")} labelEn={gloss("settings.language.label")} htmlFor="settings-language">
            <Select items={LANGUAGE_ITEMS} value={language} onValueChange={(value) => value && handleLanguageChange(value)}>
              <SelectTrigger id="settings-language">
                <SelectValue placeholder={t("settings.language.placeholder")} />
              </SelectTrigger>
              <SelectPortal>
                <SelectPositioner>
                  <SelectPopup>
                    {LANGUAGE_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </SelectPositioner>
              </SelectPortal>
            </Select>
          </FormField>
        </Sheet>
      </div>
      </div>

      {/* Plain in-flow bar, not `sticky` — a `position: sticky` last child inside a `flex-1` page
          container floats down to the true bottom of the (viewport-tall) flex box and overlaps the
          grid's last row whenever the form's own content is shorter than the viewport, since sticky
          has no natural resting point above that until content actually overflows. Now sits BELOW the
          `hmi-scroll` wrapper (not a scrolling descendant of it) so it stays reachable without having
          to scroll the grid all the way down — same reasoning, new host: previously this doc comment
          was about a `flex-1` page div, now it's about the `hmi-scroll` panel's sibling position. */}
      <div className="flex shrink-0 items-center gap-3 self-start border border-border-strong bg-surface-card px-4 py-3">
        <Button type="button" onClick={handleSave} disabled={!dirty || updateSettings.isPending}>
          {updateSettings.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
          {updateSettings.isPending ? t("settings.saving") : t("settings.save")}
        </Button>
        <span className="text-xs text-text-muted">{dirty ? t("settings.dirty") : t("settings.clean")}</span>
      </div>
    </motion.div>
  )
}
