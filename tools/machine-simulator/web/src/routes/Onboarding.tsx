import * as React from "react"
import { motion } from "framer-motion"
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  Globe,
  KeyRound,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useLanguage, useT } from "@/i18n"
import {
  useFleetIsRunning,
  useOnboardingClaim,
  useOnboardingEnroll,
  useOnboardingPasteKey,
  useOnboardingPoll,
  useOnboardingRegister,
  useSettings,
  useStartFleet,
  type OnboardingResult,
} from "@/lib/api"
import { recordCredential } from "@/lib/credentials"
import { DEFAULT_MACHINE_TYPE, MACHINE_TYPE_GROUPS } from "@/lib/machineTypes"
import { cn } from "@/lib/utils"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBadge } from "@/components/ui/status-badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FormField } from "@/components/FormField"
import { OnboardingLog, type LogEntry, type LogTone } from "@/components/OnboardingLog"
import { StepIndicator, type Step } from "@/components/StepIndicator"

function useOnboardingSteps(): Step[] {
  const t = useT()
  const gloss = useGloss()
  return [
    { id: "register", label: t("onboarding.steps.register"), labelEn: gloss("onboarding.steps.register") },
    { id: "poll", label: t("onboarding.steps.poll"), labelEn: gloss("onboarding.steps.poll") },
    { id: "claim", label: t("onboarding.steps.claim"), labelEn: gloss("onboarding.steps.claim") },
    { id: "done", label: t("onboarding.steps.done"), labelEn: gloss("onboarding.steps.done") },
  ]
}

function maskKey(key: string): string {
  if (key.length <= 12) return key
  return `${key.slice(0, 7)}${"•".repeat(12)}${key.slice(-4)}`
}

/** Turns an `OnboardingResult` into a log line + whether it counts as forward progress. `step ===
 * "Idle"` is the server's own uniform failure sentinel across every onboarding endpoint (see
 * `OnboardingService` — a bad request, a live-server exception, and a validation miss all resolve to
 * `"Idle"` with an explanatory `message`), so it doubles as "stay put and show the message" here. */
function resultTone(result: OnboardingResult): LogTone {
  return result.step === "Idle" ? "danger" : "ok"
}

// ─────────────────────────────────────────────────────────────────────────
// Demo/Live toggle — a small segmented control, same visual language as TopBar's transport-mode
// switch, but a different axis entirely: this flips OnboardingRegisterRequest.isDemo (whether THIS
// wizard fabricates its own register→approve→claim flow instantly, or calls a real ST4I server).
// ─────────────────────────────────────────────────────────────────────────
function DemoLiveToggle({
  isDemo,
  onChange,
  disabled,
}: {
  isDemo: boolean
  onChange: (isDemo: boolean) => void
  disabled?: boolean
}) {
  const t = useT()
  return (
    <div
      role="radiogroup"
      aria-label={t("onboarding.demoLiveToggle.aria")}
      className="flex items-center gap-0.5 border border-border-strong bg-surface-muted p-0.5"
    >
      {[
        { value: true, label: t("onboarding.demoLiveToggle.demo") },
        { value: false, label: t("onboarding.demoLiveToggle.live") },
      ].map((option) => {
        const selected = isDemo === option.value
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-6 px-2.5 text-xs font-semibold tracking-wide uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600/50",
              selected ? "bg-navy-700 text-white" : "text-text-muted hover:text-text-strong"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Persistent "which world am I in" strip — the segmented control above only shows on the Register
 * step, so once the wizard moves on to Poll/Claim/Done there was previously NO visible sign of
 * whether the flow was fabricating everything locally or genuinely calling `serverUrl`. Rendered
 * once, above `StepIndicator`, so it stays visible through the whole wizard. */
function ModeIndicator({ isDemo, serverUrl }: { isDemo: boolean; serverUrl: string }) {
  const t = useT()
  const trimmedServer = serverUrl.trim()
  const detail = isDemo
    ? t("onboarding.modeHint.demo")
    : trimmedServer
      ? t("onboarding.modeHint.live", { server: trimmedServer })
      : t("onboarding.modeHint.liveNoServer")

  return (
    <div
      className={cn(
        "flex items-center gap-2 border px-3 py-2 text-xs",
        // I-11: transport mode is a CONFIGURATION fact, not a machine state (spec §2) — Live used to
        // paint amber/warn and Demo calm blue/info, so the correct production configuration was the
        // one that visually read as a warning. Matches `TRANSPORT_MODE_TONE` (`lib/api.ts`): Demo is
        // the neutral default, Live/real-backend gets the (non-alarming) info tint.
        isDemo ? "border-border bg-surface-muted text-text-body" : "border-info/30 bg-info/10 text-info-text"
      )}
    >
      {isDemo ? (
        <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Globe className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="font-heading text-[13px] font-semibold tracking-wide uppercase">
        {isDemo ? t("onboarding.modeHint.demoLabel") : t("onboarding.modeHint.liveLabel")}
      </span>
      {/* Same tint color as the label, not `text-text-muted` — `StatusBadge`'s own doc comment notes
          plain muted-gray text isn't verified to hold AA 4.5:1 on a colored `/10` tint background,
          only the paired `-text` token is. */}
      <span className="min-w-0 truncate">{detail}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Step bodies
// ─────────────────────────────────────────────────────────────────────────

interface RegisterStepProps {
  serialNumber: string
  onSerialNumber: (v: string) => void
  name: string
  onName: (v: string) => void
  machineType: string
  onMachineType: (v: string) => void
  isDemo: boolean
  onIsDemo: (v: boolean) => void
  serverUrl: string
  onServerUrl: (v: string) => void
  pending: boolean
  onSubmit: () => void
}

function RegisterStep({
  serialNumber,
  onSerialNumber,
  name,
  onName,
  machineType,
  onMachineType,
  isDemo,
  onIsDemo,
  serverUrl,
  onServerUrl,
  pending,
  onSubmit,
}: RegisterStepProps) {
  const t = useT()
  const gloss = useGloss()
  // Flat {value,label} list (grouping is only for the popup's JSX below) — lets `<SelectValue>`
  // resolve the trigger's displayed text from the raw enum value without a separate lookup table.
  const machineTypeItems = React.useMemo(
    () =>
      MACHINE_TYPE_GROUPS.flatMap((group) =>
        group.types.map((type) => ({ value: type, label: t(`onboarding.register.machineTypes.${type}`) }))
      ),
    [t]
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">{t("onboarding.register.description")}</p>
        <DemoLiveToggle isDemo={isDemo} onChange={onIsDemo} disabled={pending} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label={t("onboarding.register.serialLabel")}
          labelEn={gloss("onboarding.register.serialLabel")}
          htmlFor="onb-serial"
          className="sm:col-span-2"
        >
          <Input
            id="onb-serial"
            value={serialNumber}
            onChange={(e) => onSerialNumber(e.target.value)}
            placeholder={t("onboarding.register.serialPlaceholder")}
            className="font-numeric"
            required
          />
        </FormField>
        <FormField label={t("onboarding.register.nameLabel")} labelEn={gloss("onboarding.register.nameLabel")} htmlFor="onb-name">
          <Input
            id="onb-name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder={t("onboarding.register.namePlaceholder")}
          />
        </FormField>
        <FormField label={t("onboarding.register.typeLabel")} labelEn={gloss("onboarding.register.typeLabel")} htmlFor="onb-type">
          {/* Dropdown, not free text — the real ST4I server rejects `POST /api/machine/register` with
              HTTP 400 unless machineType is EXACTLY one of its enum values (case-sensitive; see
              `@/lib/machineTypes`). Every option here IS one of those exact values, so whatever gets
              picked is always valid for Live — the value sent to register/claim/enroll is the item's
              `value` (e.g. "AOI"), never the translated label. */}
          <Select
            items={machineTypeItems}
            value={machineType}
            onValueChange={(value) => value && onMachineType(value)}
          >
            <SelectTrigger id="onb-type">
              <SelectValue placeholder={t("onboarding.register.typeSelectPlaceholder")} />
            </SelectTrigger>
            <SelectPortal>
              <SelectPositioner>
                <SelectPopup>
                  {MACHINE_TYPE_GROUPS.map((group) => (
                    <SelectGroup key={group.id}>
                      <SelectGroupLabel>{t(`onboarding.register.typeGroups.${group.id}`)}</SelectGroupLabel>
                      {group.types.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`onboarding.register.machineTypes.${type}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectPopup>
              </SelectPositioner>
            </SelectPortal>
          </Select>
        </FormField>
        {!isDemo ? (
          <FormField
            label={t("onboarding.register.serverUrlLabel")}
            labelEn={gloss("onboarding.register.serverUrlLabel")}
            htmlFor="onb-server"
            className="sm:col-span-2"
          >
            <Input
              id="onb-server"
              value={serverUrl}
              onChange={(e) => onServerUrl(e.target.value)}
              placeholder={t("onboarding.register.serverUrlPlaceholder")}
            />
          </FormField>
        ) : null}
      </div>

      <Button onClick={onSubmit} disabled={pending || !serialNumber.trim()} className="w-fit">
        {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <UserPlus className="size-3.5" aria-hidden="true" />}
        {pending ? t("onboarding.register.submitting") : t("onboarding.register.submit")}
      </Button>
    </div>
  )
}

interface PollStepProps {
  serialNumber: string
  isDemo: boolean
  pending: boolean
  onPoll: () => void
  onBack: () => void
}

/** The believable "register → wait → approve" moment (W1): a real pending state (spinner + the
 * `"Đang chờ duyệt trên hệ thống ST4I"` headline) that only ever advances on an explicit action —
 * never silently on its own. Demo and Live share that shape but diverge on what the action IS: Demo
 * exposes it honestly as "Duyệt máy (mô phỏng admin)" (the presenter IS the simulated admin, so the
 * button says so instead of pretending to poll a server that isn't there); Live is a genuine
 * `GET /api/machine/config` poll that can legitimately keep returning "still pending" until a real
 * admin approves in the SYNAPSE Admin Console — its own instruction callout tells the visitor to go
 * do that first. */
function PollStep({ serialNumber, isDemo, pending, onPoll, onBack }: PollStepProps) {
  const t = useT()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 border border-border-strong bg-surface-muted px-3 py-2.5">
        {pending ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-navy-600" aria-hidden="true" />
        ) : (
          <Clock3 className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden="true" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-text-strong">{t("onboarding.poll.pendingTitle")}</span>
            <StatusBadge status="warn" pulse={pending}>
              {t("onboarding.poll.pending")}
            </StatusBadge>
          </div>
          <p className="text-xs text-text-muted">
            {t("onboarding.poll.waitingPrefix")} <span className="font-numeric font-medium text-text-body">{serialNumber}</span>
            {isDemo ? t("onboarding.poll.waitingSuffixDemo") : t("onboarding.poll.waitingSuffixLive")}
          </p>
        </div>
      </div>

      {!isDemo ? (
        <div className="flex items-start gap-2 border border-info/30 bg-info/10 px-3 py-2.5 text-xs text-info-text">
          <Globe className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("onboarding.poll.liveInstruction")}</span>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onBack} disabled={pending}>
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t("onboarding.poll.back")}
        </Button>
        <Button onClick={onPoll} disabled={pending} className="w-fit">
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : isDemo ? (
            <ShieldCheck className="size-3.5" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          {isDemo
            ? pending
              ? t("onboarding.poll.approving")
              : t("onboarding.poll.approveBtn")
            : pending
              ? t("onboarding.poll.liveChecking")
              : t("onboarding.poll.liveCheckBtn")}
        </Button>
      </div>
    </div>
  )
}

interface ClaimEnrollStepProps {
  claimToken: string
  onClaimToken: (v: string) => void
  enrollToken: string
  onEnrollToken: (v: string) => void
  isDemo: boolean
  claimPending: boolean
  enrollPending: boolean
  onClaim: () => void
  onEnroll: () => void
  onBack: () => void
}

function ClaimEnrollStep({
  claimToken,
  onClaimToken,
  enrollToken,
  onEnrollToken,
  isDemo,
  claimPending,
  enrollPending,
  onClaim,
  onEnroll,
  onBack,
}: ClaimEnrollStepProps) {
  const t = useT()
  const gloss = useGloss()
  // Live's claim field gets its own, more specific hint (where to find the mct_ code) — Enroll has
  // no Live-specific guidance of its own (no REST proxy exists for it; see e2-report.md §3), so it
  // only ever shows the demo caveat.
  const claimHint = isDemo ? t("onboarding.claim.claimTokenHintDemo") : t("onboarding.claim.claimTokenHintLive")
  const enrollHint = isDemo ? t("onboarding.claim.claimTokenHintDemo") : undefined

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">{t("onboarding.claim.description")}</p>

      <Tabs defaultValue="claim">
        <TabsList>
          <TabsTrigger value="claim">{t("onboarding.claim.tabClaim")}</TabsTrigger>
          <TabsTrigger value="enroll">{t("onboarding.claim.tabEnroll")}</TabsTrigger>
        </TabsList>

        <TabsContent value="claim" className="pt-4">
          <div className="flex flex-col gap-3">
            <FormField
              label={t("onboarding.claim.claimTokenLabel")}
              labelEn={gloss("onboarding.claim.claimTokenLabel")}
              htmlFor="onb-claim-token"
              hint={claimHint}
            >
              <Input
                id="onb-claim-token"
                value={claimToken}
                onChange={(e) => onClaimToken(e.target.value)}
                placeholder="mct_…"
                className="font-mono"
              />
            </FormField>
            <Button onClick={onClaim} disabled={claimPending} className="w-fit">
              {claimPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <KeyRound className="size-3.5" aria-hidden="true" />}
              {claimPending ? t("onboarding.claim.claiming") : t("onboarding.claim.claimBtn")}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="enroll" className="pt-4">
          <div className="flex flex-col gap-3">
            <FormField
              label={t("onboarding.claim.enrollTokenLabel")}
              labelEn={gloss("onboarding.claim.enrollTokenLabel")}
              htmlFor="onb-enroll-token"
              hint={enrollHint}
            >
              <Input
                id="onb-enroll-token"
                value={enrollToken}
                onChange={(e) => onEnrollToken(e.target.value)}
                placeholder="met_…"
                className="font-mono"
              />
            </FormField>
            <Button onClick={onEnroll} disabled={enrollPending} className="w-fit">
              {enrollPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <KeyRound className="size-3.5" aria-hidden="true" />}
              {enrollPending ? t("onboarding.claim.enrolling") : t("onboarding.claim.enrollBtn")}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      <Button variant="outline" onClick={onBack} disabled={claimPending || enrollPending} className="w-fit">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {t("onboarding.claim.back")}
      </Button>
    </div>
  )
}

interface DoneStepProps {
  machineCode: string
  mkKey: string
  revealed: boolean
  onToggleReveal: () => void
  onCopy: () => void
  copied: boolean
  onLoadFleet: () => void
  loadPending: boolean
  onViewMachine: () => void
  onReset: () => void
}

function DoneStep({
  machineCode,
  mkKey,
  revealed,
  onToggleReveal,
  onCopy,
  copied,
  onLoadFleet,
  loadPending,
  onViewMachine,
  onReset,
}: DoneStepProps) {
  const t = useT()
  const gloss = useGloss()
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-col gap-4">
      {/* E2 made Claim/Enroll actually join the machine into the live simulated fleet (previously
          this screen's own "View fleet" CTA promised a payoff that didn't exist — functional-audit.md
          #2) — this banner now says so explicitly instead of only logging it in the activity feed. */}
      <div className="flex items-center gap-3 border border-ok/30 bg-ok/10 px-3 py-2.5">
        <CheckCircle2 className="size-5 shrink-0 text-ok-text" aria-hidden="true" />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-text-strong">{t("onboarding.done.savedFor", { code: machineCode })}</span>
          <span className="text-xs text-text-muted">{t("onboarding.done.savedHint")}</span>
          <span className="text-xs text-ok-text">{t("onboarding.done.joinedFleet", { code: machineCode })}</span>
        </div>
      </div>

      <FormField label={t("onboarding.done.machineCodeLabel")} labelEn={gloss("onboarding.done.machineCodeLabel")} htmlFor="onb-done-code">
        <Input id="onb-done-code" readOnly value={machineCode} className="font-numeric" />
      </FormField>

      <FormField label={t("onboarding.done.keyLabel")} labelEn={gloss("onboarding.done.keyLabel")}>
        <div className="flex items-center gap-1.5">
          <Input readOnly value={revealed ? mkKey : maskKey(mkKey)} className="font-mono" aria-label="mk_ key" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggleReveal}
            aria-label={revealed ? t("onboarding.done.hide") : t("onboarding.done.reveal")}
          >
            {revealed ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={onCopy} aria-label={t("onboarding.done.copy")}>
            <Copy className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        {copied ? <span className="text-[11px] text-ok-text">{t("onboarding.done.copied")}</span> : null}
      </FormField>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onViewMachine} disabled={loadPending}>
          {loadPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <ArrowUpRight className="size-3.5" aria-hidden="true" />}
          {t("onboarding.done.viewMachine")}
        </Button>
        <Button variant="outline" onClick={onLoadFleet} disabled={loadPending}>
          {loadPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <PlayCircle className="size-3.5" aria-hidden="true" />}
          {t("onboarding.done.viewFleet")}
        </Button>
        <Button variant="outline" onClick={onReset}>
          {t("onboarding.done.registerAnother")}
        </Button>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Paste mk_ card — independent of the stepper: for a key obtained elsewhere (another wizard run, a
// teammate's SDK output, etc.) that just needs storing against a machine code.
// ─────────────────────────────────────────────────────────────────────────
function PasteKeyCard({ onSaved }: { onSaved: (message: string, tone: LogTone) => void }) {
  const t = useT()
  const gloss = useGloss()
  const [code, setCode] = React.useState("")
  const [key, setKey] = React.useState("")
  const [savedFlash, setSavedFlash] = React.useState(false)
  const pasteKey = useOnboardingPasteKey()

  const handleSave = () => {
    if (!code.trim() || !key.trim()) {
      onSaved(t("onboarding.validation.needBoth"), "danger")
      return
    }
    pasteKey.mutate(
      { machineCode: code.trim(), mkKey: key.trim() },
      {
        onSuccess: (data) => {
          onSaved(data.message, resultTone(data))
          if (data.step !== "Idle" && data.machineCode) {
            recordCredential(data.machineCode)
            setCode("")
            setKey("")
            setSavedFlash(true)
            toast.success(t("toast.onboardingKeyStored", { code: data.machineCode }))
            window.setTimeout(() => setSavedFlash(false), 2500)
          }
        },
        onError: (err) =>
          onSaved(
            t("onboarding.errors.pasteFailed", { message: err instanceof Error ? err.message : t("onboarding.errors.unknown") }),
            "danger"
          ),
      }
    )
  }

  return (
    <Sheet
      title={t("onboarding.pasteCard.title")}
      titleEn={gloss("onboarding.pasteCard.title")}
      headerRight={savedFlash ? <StatusBadge status="ok">{t("onboarding.pasteCard.saved")}</StatusBadge> : null}
      bodyClassName="flex flex-col gap-3"
    >
      <p className="text-sm text-text-muted">{t("onboarding.pasteCard.description")}</p>
      <FormField label={t("onboarding.pasteCard.codeLabel")} labelEn={gloss("onboarding.pasteCard.codeLabel")} htmlFor="onb-paste-code">
        <Input
          id="onb-paste-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("onboarding.pasteCard.codePlaceholder")}
          className="font-numeric"
        />
      </FormField>
      <FormField label={t("onboarding.pasteCard.keyLabel")} labelEn={gloss("onboarding.pasteCard.keyLabel")} htmlFor="onb-paste-key">
        <Input id="onb-paste-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="mk_…" className="font-mono" />
      </FormField>
      <Button onClick={handleSave} disabled={pasteKey.isPending} className="w-fit">
        {pasteKey.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <KeyRound className="size-3.5" aria-hidden="true" />}
        {pasteKey.isPending ? t("onboarding.pasteCard.saving") : t("onboarding.pasteCard.save")}
      </Button>
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────

export default function Onboarding() {
  const t = useT()
  const gloss = useGloss()
  const { language } = useLanguage()
  const STEPS = useOnboardingSteps()
  const [, navigate] = useLocation()
  const settingsQuery = useSettings()
  const isRunning = useFleetIsRunning()
  const startFleet = useStartFleet()

  const register = useOnboardingRegister()
  const poll = useOnboardingPoll()
  const claim = useOnboardingClaim()
  const enroll = useOnboardingEnroll()

  const [stepIndex, setStepIndex] = React.useState(0)
  const [isDemo, setIsDemo] = React.useState(true)
  const [serialNumber, setSerialNumber] = React.useState("SIM-0001")
  const [name, setName] = React.useState(() => t("onboarding.register.defaultName"))
  const [nameTouched, setNameTouched] = React.useState(false)
  const [machineType, setMachineType] = React.useState(DEFAULT_MACHINE_TYPE)
  const [serverUrl, setServerUrl] = React.useState("")
  const [claimToken, setClaimToken] = React.useState("")
  const [enrollToken, setEnrollToken] = React.useState("")
  const [result, setResult] = React.useState<{ machineCode: string; mkKey: string } | null>(null)
  const [revealed, setRevealed] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [log, setLog] = React.useState<LogEntry[]>([])

  // Default machine name tracks the active UI language (W1 — was hardcoded Vietnamese regardless of
  // language, functional-audit.md #4) but only until the visitor actually edits it — `nameTouched`
  // keeps a later language switch from clobbering a name someone typed themselves.
  React.useEffect(() => {
    if (!nameTouched) setName(t("onboarding.register.defaultName"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  const handleNameChange = React.useCallback((v: string) => {
    setNameTouched(true)
    setName(v)
  }, [])

  // First switch to Live prefills the server URL from Settings, so the tester isn't typing it twice —
  // only if the field is still empty (don't clobber a value they already edited).
  React.useEffect(() => {
    if (!isDemo && !serverUrl && settingsQuery.data?.serverUrl) {
      setServerUrl(settingsQuery.data.serverUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, settingsQuery.data?.serverUrl])

  const pushLog = React.useCallback((message: string, tone: LogTone) => {
    setLog((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, time: new Date(), message, tone }])
  }, [])

  const handleRegister = () => {
    const serial = serialNumber.trim()
    if (!serial) {
      pushLog(t("onboarding.errors.serialRequired"), "danger")
      return
    }
    register.mutate(
      {
        serialNumber: serial,
        name: name.trim() || undefined,
        machineType: machineType.trim() || undefined,
        isDemo,
        serverUrl: isDemo ? undefined : serverUrl.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          pushLog(data.message, resultTone(data))
          if (data.step !== "Idle") setStepIndex(1)
        },
        onError: (err) =>
          pushLog(t("onboarding.errors.registerFailed", { message: err instanceof Error ? err.message : t("onboarding.errors.unknown") }), "danger"),
      }
    )
  }

  const handlePoll = () => {
    poll.mutate(
      { serialNumber: serialNumber.trim(), isDemo, serverUrl: isDemo ? undefined : serverUrl.trim() || undefined },
      {
        onSuccess: (data) => {
          pushLog(data.message, resultTone(data))
          if (data.isApproved || data.step === "Approved") setStepIndex(2)
        },
        onError: (err) =>
          pushLog(t("onboarding.errors.pollFailed", { message: err instanceof Error ? err.message : t("onboarding.errors.unknown") }), "danger"),
      }
    )
  }

  const handleClaim = () => {
    claim.mutate(
      {
        serialNumber: serialNumber.trim(),
        claimToken: claimToken.trim() || undefined,
        isDemo,
        serverUrl: isDemo ? undefined : serverUrl.trim() || undefined,
        // E2 added these to OnboardingClaimRequest — the fleet-join glue needs them to pick the
        // right simulator profile; without them the machine still joins the fleet, just as a
        // generic Automation profile (see e2-report.md §3).
        name: name.trim() || undefined,
        machineType: machineType.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          pushLog(data.message, resultTone(data))
          if (data.mkKey && data.machineCode) {
            recordCredential(data.machineCode)
            setResult({ machineCode: data.machineCode, mkKey: data.mkKey })
            setStepIndex(3)
            toast.success(t("toast.onboardingKeyStored", { code: data.machineCode }))
          }
        },
        onError: (err) =>
          pushLog(t("onboarding.errors.claimFailed", { message: err instanceof Error ? err.message : t("onboarding.errors.unknown") }), "danger"),
      }
    )
  }

  const handleEnroll = () => {
    enroll.mutate(
      {
        serialNumber: serialNumber.trim(),
        enrollToken: enrollToken.trim() || undefined,
        name: name.trim() || undefined,
        machineType: machineType.trim() || undefined,
        isDemo,
        serverUrl: isDemo ? undefined : serverUrl.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          pushLog(data.message, resultTone(data))
          if (data.mkKey && data.machineCode) {
            recordCredential(data.machineCode)
            setResult({ machineCode: data.machineCode, mkKey: data.mkKey })
            setStepIndex(3)
            toast.success(t("toast.onboardingKeyStored", { code: data.machineCode }))
          }
        },
        onError: (err) =>
          pushLog(t("onboarding.errors.enrollFailed", { message: err instanceof Error ? err.message : t("onboarding.errors.unknown") }), "danger"),
      }
    )
  }

  /** "Xem đội máy" — W2 built the real Machine List, so this now lands there (was `/`, the Dashboard,
   * back when `/machines` was still a placeholder — see Machines.tsx's own header comment history). */
  const handleLoadFleet = () => {
    if (!isRunning) startFleet.mutate()
    navigate("/machines")
  }

  /** "Xem máy vừa thêm" — jumps straight to the just-joined machine's own detail page (`/machines/
   * :code`) rather than the fleet-wide view, since that's the one place a visitor can immediately
   * confirm THIS specific machine (not just some tile in the grid) is real and cycling. Starts the
   * fleet too, same as `handleLoadFleet`, so there's something to see the moment it lands. */
  const handleViewMachine = () => {
    if (!isRunning) startFleet.mutate()
    if (result) navigate(`/machines/${encodeURIComponent(result.machineCode)}`)
  }

  // Completion-review #5: previously left serialNumber/name/machineType/nameTouched exactly as the
  // finished run left them — re-running "as is" re-submits the SAME serial, which RegisterMachine's
  // dup-check turns into an "already in the fleet" no-op join rather than a genuinely new machine.
  // Clearing serialNumber forces a fresh one to be typed (the submit button is already disabled on an
  // empty serial, so this can't be missed); clearing nameTouched (and restoring the localized default
  // name) means a language switch after this point re-localizes it instead of staying pinned to
  // whatever was typed for the PREVIOUS machine.
  const handleReset = () => {
    setStepIndex(0)
    setResult(null)
    setRevealed(false)
    setCopied(false)
    setClaimToken("")
    setEnrollToken("")
    setSerialNumber("")
    setName(t("onboarding.register.defaultName"))
    setNameTouched(false)
    setMachineType(DEFAULT_MACHINE_TYPE)
  }

  const handleCopy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.mkKey)
      setCopied(true)
      toast.success(t("toast.keyCopied"))
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      pushLog(t("onboarding.errors.copyFailed"), "danger")
    }
  }

  const currentStep = STEPS[stepIndex]

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex shrink-0 flex-col gap-1">
        <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
          {t("onboarding.title")}
        </h1>
        <p className="hmi-micro mt-1">{gloss("onboarding.title")}</p>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("onboarding.subtitle")}</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Current stage in the Sheet's own title — reads like a procedure sheet's running header
            ("what step am I on") rather than a generic panel label. ModeIndicator + StepIndicator stay
            pinned; only the step's own body scrolls internally when the form runs long (Live mode adds
            a server-URL field; the 24-value machine-type select can push short viewports). */}
        <Sheet
          className="min-h-0"
          title={currentStep.label}
          titleEn={currentStep.labelEn}
          bodyClassName="flex min-h-0 flex-1 flex-col gap-4 p-0"
        >
          <div className="flex shrink-0 flex-col gap-4 p-4 pb-0">
            <ModeIndicator isDemo={isDemo} serverUrl={serverUrl} />
            <StepIndicator steps={STEPS} currentIndex={stepIndex} />
          </div>
          <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto p-4 pt-0">
            {stepIndex === 0 ? (
              <RegisterStep
                serialNumber={serialNumber}
                onSerialNumber={setSerialNumber}
                name={name}
                onName={handleNameChange}
                machineType={machineType}
                onMachineType={setMachineType}
                isDemo={isDemo}
                onIsDemo={setIsDemo}
                serverUrl={serverUrl}
                onServerUrl={setServerUrl}
                pending={register.isPending}
                onSubmit={handleRegister}
              />
            ) : null}

            {stepIndex === 1 ? (
              <PollStep
                serialNumber={serialNumber}
                isDemo={isDemo}
                pending={poll.isPending}
                onPoll={handlePoll}
                onBack={() => setStepIndex(0)}
              />
            ) : null}

            {stepIndex === 2 ? (
              <ClaimEnrollStep
                claimToken={claimToken}
                onClaimToken={setClaimToken}
                enrollToken={enrollToken}
                onEnrollToken={setEnrollToken}
                isDemo={isDemo}
                claimPending={claim.isPending}
                enrollPending={enroll.isPending}
                onClaim={handleClaim}
                onEnroll={handleEnroll}
                onBack={() => setStepIndex(1)}
              />
            ) : null}

            {stepIndex === 3 && result ? (
              <DoneStep
                machineCode={result.machineCode}
                mkKey={result.mkKey}
                revealed={revealed}
                onToggleReveal={() => setRevealed((v) => !v)}
                onCopy={handleCopy}
                copied={copied}
                onLoadFleet={handleLoadFleet}
                loadPending={startFleet.isPending}
                onViewMachine={handleViewMachine}
                onReset={handleReset}
              />
            ) : null}
          </div>
        </Sheet>

        <div className="flex min-h-0 flex-col gap-4">
          <Sheet
            className="min-h-0 flex-1"
            title={t("onboarding.log.title")}
            titleEn={gloss("onboarding.log.title")}
            bodyClassName="flex flex-1 min-h-0 flex-col p-3"
          >
            <OnboardingLog entries={log} className="flex-1" />
          </Sheet>

          <PasteKeyCard onSaved={pushLog} />
        </div>
      </div>
    </motion.div>
  )
}
