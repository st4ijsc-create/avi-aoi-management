/**
 * P3 / doc 12 §8 — OT Onboarding Wizard (client-only).
 *
 * An end-to-end stepper that walks an engineer from "no device" to "live sample":
 *   1. Protocol        — pick the OT protocol (drives the adapter driver).
 *   2. Adapter         — create (or reuse) a device adapter connection definition.
 *   3. Tag / metric    — define ONE tag to read (the metric that should appear live).
 *   4. Test connection — READ-ONLY connectivity probe (reuses deviceAdapter.testConnection).
 *   5. Enable          — flip the adapter's isEnabled flag so the poller starts.
 *   6. Confirm live    — listen on telemetry:sample for this machine/adapter and
 *                        confirm a real sample arrives (NO fabricated values).
 *
 * HONESTY: every backend-dependent step shows its real result. If no endpoint /
 * device is reachable, the test step says so plainly and the live step keeps
 * waiting rather than inventing a value. This component ONLY reuses existing
 * mutations (deviceAdapter.create / update / testConnection, tags.create); it
 * never writes a value to a device.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { getSharedSocket } from "@/lib/socketManager";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Check, ChevronRight, Loader2, Plug, Tag as TagIcon, Wifi, WifiOff,
  AlertTriangle, Activity, PartyPopper, Power,
} from "lucide-react";
import { toast } from "sonner";

/** Wire shape received on telemetry:sample (mirrors server TelemetryBroadcastSample). */
interface TelemetrySample {
  machineId: number | null;
  deviceId: string | null;
  protocol: string;
  metric: string;
  numValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
  unit: string | null;
  quality: string;
  ts: string;
}

const PROTOCOLS = ["opcua", "modbus", "s7", "mitsubishi-mc", "ethernet-ip", "stub"] as const;
const DATA_TYPES = ["bool", "int", "float", "string", "json"] as const;
type Protocol = (typeof PROTOCOLS)[number];
type DataType = (typeof DATA_TYPES)[number];

interface WizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when an adapter is created/enabled so the parent monitor can refresh. */
  onChanged?: () => void;
}

const STEPS = [
  { key: "protocol", icon: Plug },
  { key: "adapter", icon: Plug },
  { key: "tag", icon: TagIcon },
  { key: "test", icon: Activity },
  { key: "enable", icon: Power },
  { key: "confirm", icon: PartyPopper },
] as const;

export default function DeviceOnboardingWizard({ open, onOpenChange, onChanged }: WizardProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  const [step, setStep] = useState(0);

  // Step 1 — protocol
  const [protocol, setProtocol] = useState<Protocol>("stub");

  // Step 2 — adapter
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [machineId, setMachineId] = useState<string>("");
  const [adapterId, setAdapterId] = useState<number | null>(null);

  // Step 3 — tag
  const [tagKey, setTagKey] = useState("");
  const [address, setAddress] = useState("");
  const [dataType, setDataType] = useState<DataType>("float");
  const [unit, setUnit] = useState("");
  const [tagCreated, setTagCreated] = useState(false);

  // Step 4 — test
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; error?: string } | null>(null);

  // Step 6 — live confirm
  const [liveSample, setLiveSample] = useState<TelemetrySample | null>(null);

  const machinesQ = trpc.machineStatus.listWithStatus.useQuery(undefined, { enabled: open });

  const reset = () => {
    setStep(0); setProtocol("stub");
    setCode(""); setName(""); setEndpoint(""); setMachineId(""); setAdapterId(null);
    setTagKey(""); setAddress(""); setDataType("float"); setUnit(""); setTagCreated(false);
    setTestResult(null); setLiveSample(null);
  };

  useEffect(() => { if (!open) reset(); }, [open]);

  // ── Mutations (reuse existing) ──
  const createAdapter = trpc.deviceAdapter.create.useMutation({
    onSuccess: (a: any) => {
      setAdapterId(a.id);
      toast.success(t("wizard.adapterCreated", "Đã tạo adapter"));
      void utils.deviceAdapter.list.invalidate();
      onChanged?.();
      setStep(2);
    },
    onError: (e) => toast.error(e.message),
  });

  const createTag = trpc.deviceAdapter.tags.create.useMutation({
    onSuccess: () => {
      setTagCreated(true);
      toast.success(t("wizard.tagCreated", "Đã tạo tag"));
      setStep(3);
    },
    onError: (e) => toast.error(e.message),
  });

  const testConnection = trpc.deviceAdapter.testConnection.useMutation({
    onSuccess: (res) => setTestResult(res),
    onError: (e) => setTestResult({ ok: false, latencyMs: 0, error: e.message }),
  });

  const enableAdapter = trpc.deviceAdapter.update.useMutation({
    onSuccess: () => {
      toast.success(t("wizard.adapterEnabled", "Đã bật adapter — bắt đầu polling"));
      void utils.deviceAdapter.list.invalidate();
      onChanged?.();
      setStep(5);
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Step 6: live-sample listener (only while on confirm step) ──
  const adapterIdRef = useRef<number | null>(null);
  adapterIdRef.current = adapterId;
  useEffect(() => {
    if (!open || step !== 5) return;
    const socket = getSharedSocket();
    const wantMachineId = machineId ? Number(machineId) : null;
    const handler = (data: { samples?: TelemetrySample[] }) => {
      if (!data?.samples?.length) return;
      // Prefer a sample matching this machine + tag metric; else accept any if no machine bound.
      const match = data.samples.find((s) => {
        if (wantMachineId != null && s.machineId !== wantMachineId) return false;
        if (tagKey && s.metric !== tagKey) return false;
        return true;
      }) ?? (wantMachineId == null ? data.samples[0] : undefined);
      if (match) setLiveSample(match);
    };
    socket.on("telemetry:sample", handler);
    socket.emit("subscribe", wantMachineId != null ? { machineId: wantMachineId } : {});
    return () => {
      socket.off("telemetry:sample", handler);
      if (wantMachineId != null) socket.emit("unsubscribe", { machineId: wantMachineId });
    };
  }, [open, step, machineId, tagKey]);

  const machines = machinesQ.data ?? [];

  const canNextProtocol = !!protocol;
  const canCreateAdapter = code.trim().length > 0 && name.trim().length > 0 && endpoint.trim().length > 0;
  const canCreateTag = tagKey.trim().length > 0 && address.trim().length > 0;

  const submitAdapter = () => {
    createAdapter.mutate({
      code: code.trim(),
      name: name.trim(),
      protocol,
      endpoint: endpoint.trim(),
      pollIntervalMs: 5000,
      machineId: machineId ? Number(machineId) : null,
      isEnabled: false,
    });
  };

  const submitTag = () => {
    if (adapterId == null) return;
    createTag.mutate({
      adapterId,
      tagKey: tagKey.trim(),
      address: address.trim(),
      dataType,
      unit: unit.trim() || null,
      scale: null,
      offset: null,
      writable: false,
      isEnabled: true,
    });
  };

  const runTest = () => {
    setTestResult(null);
    testConnection.mutate({ protocol, endpoint: endpoint.trim() });
  };

  const doEnable = () => {
    if (adapterId == null) return;
    enableAdapter.mutate({ id: adapterId, isEnabled: true });
  };

  const sampleValue = useMemo(() => {
    if (!liveSample) return null;
    if (liveSample.numValue != null) return String(liveSample.numValue);
    if (liveSample.boolValue != null) return liveSample.boolValue ? "true" : "false";
    if (liveSample.textValue != null) return liveSample.textValue;
    return "—";
  }, [liveSample]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-rose-600" />
            {t("wizard.title", "Kết nối thiết bị OT mới")}
          </DialogTitle>
          <DialogDescription>
            {t("wizard.subtitle", "Chọn giao thức → adapter → tag → test → bật → xác nhận dữ liệu trực tiếp")}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper header */}
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const active = i === step;
            return (
              <div key={s.key} className="flex items-center">
                <div
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs whitespace-nowrap ${
                    active ? "bg-primary text-primary-foreground"
                    : done ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  {t(`wizard.step.${s.key}`, s.key)}
                </div>
                {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              </div>
            );
          })}
        </div>

        <div className="min-h-[260px] py-2">
          {/* STEP 1 — protocol */}
          {step === 0 && (
            <div className="space-y-3">
              <Label>{t("wizard.pickProtocol", "Giao thức")}</Label>
              <Select value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROTOCOLS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("wizard.protocolHint", "stub dùng để thử nghiệm không cần thiết bị thật. Các giao thức khác cần endpoint tới thiết bị/PLC.")}
              </p>
            </div>
          )}

          {/* STEP 2 — adapter */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("wizard.code", "Mã adapter")} *</Label>
                  <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="line-a-plc1" className="font-mono" />
                </div>
                <div>
                  <Label>{t("wizard.name", "Tên")} *</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>{t("wizard.endpoint", "Endpoint")} *</Label>
                <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="opc.tcp://… / tcp://host:port / stub://x" />
              </div>
              <div>
                <Label>{t("wizard.bindMachine", "Gắn với máy (tùy chọn)")}</Label>
                <Select value={machineId || "none"} onValueChange={(v) => setMachineId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("wizard.noMachine", "Không gắn")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("wizard.noMachine", "Không gắn")}</SelectItem>
                    {machines.map((m: any) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name} ({m.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("wizard.bindMachineHint", "Gắn máy giúp telemetry hiện đúng dòng máy ở màn hình giám sát.")}
                </p>
              </div>
            </div>
          )}

          {/* STEP 3 — tag */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("wizard.tagKey", "Tag (metric)")} *</Label>
                  <Input value={tagKey} onChange={(e) => setTagKey(e.target.value)} placeholder="temperature" />
                </div>
                <div>
                  <Label>{t("wizard.address", "Địa chỉ")} *</Label>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ns=2;s=Temp / DB1.DBD0" />
                </div>
                <div>
                  <Label>{t("wizard.dataType", "Kiểu")}</Label>
                  <Select value={dataType} onValueChange={(v) => setDataType(v as DataType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DATA_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("wizard.unit", "Đơn vị")}</Label>
                  <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="°C" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("wizard.tagHint", "Tag là điểm đọc mà bạn muốn thấy giá trị trực tiếp. metric = tag key trên kênh telemetry.")}
              </p>
            </div>
          )}

          {/* STEP 4 — test */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("wizard.testHint", "Kiểm tra kết nối CHỈ ĐỌC tới endpoint. Không ghi gì xuống thiết bị.")}
              </p>
              <Button onClick={runTest} disabled={testConnection.isPending}>
                {testConnection.isPending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("wizard.testing", "Đang kiểm tra…")}</>
                  : <><Activity className="mr-2 h-4 w-4" />{t("wizard.runTest", "Chạy test kết nối")}</>}
              </Button>
              {testResult && (
                testResult.ok ? (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                    <Wifi className="h-4 w-4 text-emerald-600" />
                    {t("wizard.testOk", "Kết nối OK")} — {testResult.latencyMs}ms
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      <div className="font-medium">{t("wizard.testFail", "Kết nối thất bại")}</div>
                      <div className="text-xs text-muted-foreground">{testResult.error ?? t("wizard.unknownError", "Lỗi không xác định")}</div>
                      <div className="mt-1 text-xs">{t("wizard.testFailNext", "Cần thiết bị/endpoint hợp lệ. Bạn vẫn có thể bật adapter để poll thử lại sau.")}</div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* STEP 5 — enable */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("wizard.enableHint", "Bật adapter để poller bắt đầu đọc tag theo chu kỳ và phát lên kênh telemetry.")}
              </p>
              <Button onClick={doEnable} disabled={enableAdapter.isPending || adapterId == null}>
                {enableAdapter.isPending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("wizard.enabling", "Đang bật…")}</>
                  : <><Power className="mr-2 h-4 w-4" />{t("wizard.enableAdapter", "Bật adapter")}</>}
              </Button>
            </div>
          )}

          {/* STEP 6 — confirm live */}
          {step === 5 && (
            <div className="space-y-4">
              {liveSample ? (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4">
                  <div className="flex items-center gap-2 font-medium text-emerald-700">
                    <PartyPopper className="h-5 w-5" />
                    {t("wizard.liveOk", "Đã nhận dữ liệu trực tiếp!")}
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-sm text-muted-foreground">{liveSample.metric}</span>
                    <span className="text-2xl font-bold tabular-nums">{sampleValue}</span>
                    {liveSample.unit && <span className="text-sm text-muted-foreground">{liveSample.unit}</span>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(liveSample.ts).toLocaleTimeString()} · {liveSample.protocol} · quality={liveSample.quality}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-4 text-sm">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <div>
                    <div className="font-medium">{t("wizard.waitingLive", "Đang chờ mẫu telemetry đầu tiên…")}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("wizard.waitingLiveHint", "Nếu test kết nối thất bại hoặc không có thiết bị thật, mẫu sẽ KHÔNG đến — đây là trạng thái trung thực, không tạo dữ liệu giả.")}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            {t("common.back", "Quay lại")}
          </Button>
          <div className="flex gap-2">
            {step === 0 && (
              <Button disabled={!canNextProtocol} onClick={() => setStep(1)}>{t("common.next", "Tiếp")}</Button>
            )}
            {step === 1 && (
              <Button disabled={!canCreateAdapter || createAdapter.isPending} onClick={submitAdapter}>
                {createAdapter.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("wizard.createAdapter", "Tạo adapter")}
              </Button>
            )}
            {step === 2 && (
              <Button disabled={!canCreateTag || createTag.isPending} onClick={submitTag}>
                {createTag.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("wizard.createTag", "Tạo tag")}
              </Button>
            )}
            {step === 3 && (
              <Button onClick={() => setStep(4)}>{t("common.next", "Tiếp")}</Button>
            )}
            {step === 5 && (
              <Button onClick={() => onOpenChange(false)}>{t("common.done", "Hoàn tất")}</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
