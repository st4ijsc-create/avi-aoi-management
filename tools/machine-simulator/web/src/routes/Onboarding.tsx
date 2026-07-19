import * as React from "react"
import { motion } from "framer-motion"
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlayCircle,
  RefreshCw,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { useT } from "@/i18n"
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
import { cn } from "@/lib/utils"
import { fadeSlideUp } from "@/theme/motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/ui/status-badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FormField } from "@/components/FormField"
import { OnboardingLog, type LogEntry, type LogTone } from "@/components/OnboardingLog"
import { StepIndicator, type Step } from "@/components/StepIndicator"

function useOnboardingSteps(): Step[] {
  const t = useT()
  return [
    { id: "register", label: t("onboarding.steps.register") },
    { id: "poll", label: t("onboarding.steps.poll") },
    { id: "claim", label: t("onboarding.steps.claim") },
    { id: "done", label: t("onboarding.steps.done") },
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
      className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-subtle p-0.5"
    >
      {[
        { value: true, label: "Demo" },
        { value: false, label: "Live" },
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
              "h-6 rounded-[6px] px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600/50",
              selected ? "bg-navy-600 text-white shadow-sm" : "text-text-muted hover:text-text-strong"
            )}
          >
            {option.label}
          </button>
        )
      })}
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
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">{t("onboarding.register.description")}</p>
        <DemoLiveToggle isDemo={isDemo} onChange={onIsDemo} disabled={pending} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t("onboarding.register.serialLabel")} htmlFor="onb-serial" className="sm:col-span-2">
          <Input
            id="onb-serial"
            value={serialNumber}
            onChange={(e) => onSerialNumber(e.target.value)}
            placeholder={t("onboarding.register.serialPlaceholder")}
            required
          />
        </FormField>
        <FormField label={t("onboarding.register.nameLabel")} htmlFor="onb-name">
          <Input
            id="onb-name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder={t("onboarding.register.namePlaceholder")}
          />
        </FormField>
        <FormField label={t("onboarding.register.typeLabel")} htmlFor="onb-type">
          <Input
            id="onb-type"
            value={machineType}
            onChange={(e) => onMachineType(e.target.value)}
            placeholder={t("onboarding.register.typePlaceholder")}
          />
        </FormField>
        {!isDemo ? (
          <FormField label="Server URL" htmlFor="onb-server" className="sm:col-span-2">
            <Input
              id="onb-server"
              value={serverUrl}
              onChange={(e) => onServerUrl(e.target.value)}
              placeholder="https://your-st4i-server"
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
  pending: boolean
  onPoll: () => void
  onBack: () => void
}

function PollStep({ serialNumber, pending, onPoll, onBack }: PollStepProps) {
  const t = useT()
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        {t("onboarding.poll.waitingPrefix")} <span className="font-numeric font-medium text-text-body">{serialNumber}</span>
        {t("onboarding.poll.waitingSuffix")}
      </p>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-subtle px-3 py-2.5">
        <Clock3 className="size-4 shrink-0 text-navy-600" aria-hidden="true" />
        <StatusBadge status="warn">{t("onboarding.poll.pending")}</StatusBadge>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onBack} disabled={pending}>
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t("onboarding.poll.back")}
        </Button>
        <Button onClick={onPoll} disabled={pending} className="w-fit">
          {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
          {pending ? t("onboarding.poll.checking") : t("onboarding.poll.check")}
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
  const tokenHint = isDemo ? t("onboarding.claim.claimTokenHintDemo") : undefined

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
            <FormField label={t("onboarding.claim.claimTokenLabel")} htmlFor="onb-claim-token" hint={tokenHint}>
              <Input
                id="onb-claim-token"
                value={claimToken}
                onChange={(e) => onClaimToken(e.target.value)}
                placeholder="mct_…"
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
            <FormField label={t("onboarding.claim.enrollTokenLabel")} htmlFor="onb-enroll-token" hint={tokenHint}>
              <Input
                id="onb-enroll-token"
                value={enrollToken}
                onChange={(e) => onEnrollToken(e.target.value)}
                placeholder="met_…"
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
  onReset,
}: DoneStepProps) {
  const t = useT()
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border border-ok/20 bg-ok/10 px-3 py-2.5">
        <CheckCircle2 className="size-5 shrink-0 text-ok-text" aria-hidden="true" />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-text-strong">{t("onboarding.done.savedFor", { code: machineCode })}</span>
          <span className="text-xs text-text-muted">{t("onboarding.done.savedHint")}</span>
        </div>
      </div>

      <FormField label={t("onboarding.done.machineCodeLabel")} htmlFor="onb-done-code">
        <Input id="onb-done-code" readOnly value={machineCode} className="font-numeric" />
      </FormField>

      <FormField label={t("onboarding.done.keyLabel")}>
        <div className="flex items-center gap-1.5">
          <Input readOnly value={revealed ? mkKey : maskKey(mkKey)} className="font-numeric" aria-label="mk_ key" />
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
        <Button onClick={onLoadFleet} disabled={loadPending}>
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
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-strong">{t("onboarding.pasteCard.title")}</h3>
          {savedFlash ? <StatusBadge status="ok">{t("onboarding.pasteCard.saved")}</StatusBadge> : null}
        </div>
        <p className="text-sm text-text-muted">{t("onboarding.pasteCard.description")}</p>
        <FormField label={t("onboarding.pasteCard.codeLabel")} htmlFor="onb-paste-code">
          <Input
            id="onb-paste-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("onboarding.pasteCard.codePlaceholder")}
          />
        </FormField>
        <FormField label={t("onboarding.pasteCard.keyLabel")} htmlFor="onb-paste-key">
          <Input id="onb-paste-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="mk_…" />
        </FormField>
        <Button onClick={handleSave} disabled={pasteKey.isPending} className="w-fit">
          {pasteKey.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <KeyRound className="size-3.5" aria-hidden="true" />}
          {pasteKey.isPending ? t("onboarding.pasteCard.saving") : t("onboarding.pasteCard.save")}
        </Button>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────

export default function Onboarding() {
  const t = useT()
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
  const [name, setName] = React.useState("Trạm vít demo")
  const [machineType, setMachineType] = React.useState("Automation")
  const [serverUrl, setServerUrl] = React.useState("")
  const [claimToken, setClaimToken] = React.useState("")
  const [enrollToken, setEnrollToken] = React.useState("")
  const [result, setResult] = React.useState<{ machineCode: string; mkKey: string } | null>(null)
  const [revealed, setRevealed] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [log, setLog] = React.useState<LogEntry[]>([])

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

  const handleLoadFleet = () => {
    if (!isRunning) startFleet.mutate()
    navigate("/")
  }

  const handleReset = () => {
    setStepIndex(0)
    setResult(null)
    setRevealed(false)
    setCopied(false)
    setClaimToken("")
    setEnrollToken("")
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

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text-strong">{t("onboarding.title")}</h1>
        <p className="text-sm text-text-muted">{t("onboarding.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="h-fit">
          <CardContent className="flex flex-col gap-6">
            <StepIndicator steps={STEPS} currentIndex={stepIndex} />

            {stepIndex === 0 ? (
              <RegisterStep
                serialNumber={serialNumber}
                onSerialNumber={setSerialNumber}
                name={name}
                onName={setName}
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
                onReset={handleReset}
              />
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-text-strong">{t("onboarding.log.title")}</h3>
              <OnboardingLog entries={log} />
            </CardContent>
          </Card>

          <PasteKeyCard onSaved={pushLog} />
        </div>
      </div>
    </motion.div>
  )
}
