import * as React from "react"
import { motion } from "framer-motion"
import { CircleCheck, CircleX, Globe, KeyRound, Loader2, Save, Server, ShieldCheck, Wifi } from "lucide-react"

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
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectItem, SelectPopup, SelectPortal, SelectPositioner, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { StatusBadge } from "@/components/ui/status-badge"
import { Switch } from "@/components/ui/switch"
import { FormField } from "@/components/FormField"

const MODE_OPTIONS: { value: TransportMode; label: string; hint: string }[] = [
  { value: "Live", label: "Live", hint: "Gọi thẳng ST4I server thật." },
  { value: "Demo", label: "Demo", hint: "Tự mô phỏng, không cần server." },
  { value: "Auto", label: "Auto", hint: "Ưu tiên Live, tự rơi về Demo khi mất kết nối." },
]

const LANGUAGE_ITEMS = [
  { value: "vi", label: "Tiếng Việt" },
  { value: "en", label: "English" },
]

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
  const { data, isPending } = useMode()
  const setMode = useSetMode()
  const current = (setMode.isPending ? setMode.variables : undefined) ?? data?.mode ?? "Demo"

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Chế độ vận hành" className="grid grid-cols-3 gap-2">
        {MODE_OPTIONS.map((option) => {
          const selected = current === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={isPending}
              onClick={() => setMode.mutate(option.value)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600/50",
                selected ? "border-navy-600 bg-navy-50" : "border-border hover:bg-surface-subtle"
              )}
            >
              <span className={cn("text-sm font-semibold", selected ? "text-navy-700" : "text-text-strong")}>
                {option.label}
              </span>
              <span className="text-[11px] text-text-muted">{option.hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────

export default function Settings() {
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

  const handleSave = () => {
    updateSettings.mutate(
      { serverUrl: serverUrl.trim(), verifyTls, language, machineCode: machineCode.trim() },
      {
        onSuccess: (data) => {
          setServerUrl(data.serverUrl)
          setVerifyTls(data.verifyTls)
          setLanguage(data.language)
          setMachineCode(data.machineCode)
        },
      }
    )
  }

  const handleProbe = () => {
    const url = serverUrl.trim()
    if (!url) return
    probe.mutate(url)
  }

  const handlePasteKey = () => {
    if (!pasteCode.trim() || !pasteKey.trim()) {
      setPasteMessage({ text: "Cần nhập cả mã máy và khóa mk_.", ok: false })
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
          }
        },
        onError: (err) =>
          setPasteMessage({ text: err instanceof Error ? err.message : "Lỗi không xác định", ok: false }),
      }
    )
  }

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text-strong">Settings</h1>
        <p className="text-sm text-text-muted">Kết nối, chế độ vận hành, xác thực máy và ngôn ngữ — wired tới /v1/settings và /v1/mode.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Server className="size-4 text-navy-600" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-text-strong">Kết nối máy chủ</h2>
            </div>

            <FormField label="Server URL" htmlFor="settings-server-url">
              <Input
                id="settings-server-url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:5000"
              />
            </FormField>

            <label htmlFor="settings-verify-tls" className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-sm font-medium text-text-body">Xác thực TLS (Verify TLS)</span>
                <span className="text-[11px] text-text-muted">Từ chối chứng chỉ HTTPS không hợp lệ.</span>
              </span>
              <Switch id="settings-verify-tls" checked={verifyTls} onCheckedChange={setVerifyTls} />
            </label>

            <Separator />

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={handleProbe} disabled={probe.isPending || !serverUrl.trim()}>
                {probe.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Wifi className="size-3.5" aria-hidden="true" />}
                {probe.isPending ? "Đang kiểm tra…" : "Kiểm tra kết nối"}
              </Button>

              {probe.data ? (
                probe.data.reachable ? (
                  <StatusBadge status="ok">
                    Reachable · HTTP {probe.data.status} · {probe.data.paths.length} path
                  </StatusBadge>
                ) : (
                  <StatusBadge status="danger">Không thể kết nối</StatusBadge>
                )
              ) : probe.isError ? (
                <StatusBadge status="danger">Yêu cầu kiểm tra thất bại</StatusBadge>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-navy-600" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-text-strong">Chế độ vận hành</h2>
            </div>
            <p className="text-sm text-text-muted">Áp dụng ngay lập tức — không cần bấm Lưu.</p>
            <ModeSelector />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-navy-600" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-text-strong">Xác thực máy</h2>
            </div>

            <FormField
              label="Mã máy đang dùng để xác thực"
              htmlFor="settings-machine-code"
              hint="Khóa mk_ đã lưu cho mã này sẽ được dùng khi Live/Auto kết nối server thật."
            >
              <Input
                id="settings-machine-code"
                value={machineCode}
                onChange={(e) => setMachineCode(e.target.value)}
                placeholder="vd: ENGINE-API-01"
              />
            </FormField>

            <Separator />

            <div className="flex flex-col gap-2">
              <FormField label="Mã máy" htmlFor="settings-paste-code">
                <Input id="settings-paste-code" value={pasteCode} onChange={(e) => setPasteCode(e.target.value)} placeholder="vd: SIM-0002" />
              </FormField>
              <FormField label="Khóa mk_" htmlFor="settings-paste-key">
                <Input id="settings-paste-key" value={pasteKey} onChange={(e) => setPasteKey(e.target.value)} placeholder="mk_…" />
              </FormField>
              <Button type="button" onClick={handlePasteKey} disabled={pasteKeyMutation.isPending} className="w-fit">
                {pasteKeyMutation.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <KeyRound className="size-3.5" aria-hidden="true" />}
                {pasteKeyMutation.isPending ? "Đang lưu…" : "Lưu khóa"}
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
              <span className="text-xs font-medium text-text-body">Đã lưu trên trình duyệt này</span>
              {credentials.length === 0 ? (
                <p className="text-xs text-text-muted">Chưa có khóa nào được ghi nhận trong phiên này.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {credentials.map((cred) => (
                    <li
                      key={cred.code}
                      className="flex items-center justify-between gap-2 rounded-md bg-surface-subtle px-2.5 py-1.5 text-xs"
                    >
                      <span className="font-numeric font-medium text-text-strong">{cred.code}</span>
                      <span className="text-text-muted">{formatSavedAt(cred.savedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-text-muted">
                Danh sách này chỉ ghi nhận trên trình duyệt — không phải danh sách đầy đủ trên máy chủ engine.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Globe className="size-4 text-navy-600" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-text-strong">Ngôn ngữ</h2>
            </div>
            <FormField label="Ngôn ngữ giao diện" htmlFor="settings-language">
              <Select items={LANGUAGE_ITEMS} value={language} onValueChange={(value) => value && setLanguage(value)}>
                <SelectTrigger id="settings-language">
                  <SelectValue placeholder="Chọn ngôn ngữ" />
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
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-6 flex items-center gap-3 self-start rounded-lg border border-border bg-surface-card px-4 py-3 shadow-md">
        <Button type="button" onClick={handleSave} disabled={!dirty || updateSettings.isPending}>
          {updateSettings.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
          {updateSettings.isPending ? "Đang lưu…" : "Lưu thay đổi"}
        </Button>
        <span className="text-xs text-text-muted">{dirty ? "Có thay đổi chưa lưu." : "Đã lưu."}</span>
      </div>
    </motion.div>
  )
}
