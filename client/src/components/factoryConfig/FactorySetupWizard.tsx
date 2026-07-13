/**
 * doc 47/48 — Factory-config overhaul (Đợt 3) · STANDALONE "Factory Setup Wizard".
 *
 * Trình hướng dẫn dựng nhà máy TỪ TRÊN XUỐNG trong MỘT hộp thoại, thay cho việc
 * đi lại giữa 5 tab CRUD rời rạc:
 *   (1) Nhà máy (tạo mới HOẶC chọn có sẵn)
 *   (2) Xưởng   (nhiều dòng, dưới nhà máy vừa chọn)
 *   (3) Dây chuyền (mỗi dòng chọn xưởng cha)
 *   (4) Trạm       (mỗi dòng chọn dây chuyền cha)
 *   (5) Máy        (mỗi dòng chọn trạm cha)
 *   (6) Xem lại + Tạo
 *
 * TRUNG THỰC: chỉ gọi các mutation create THẬT (factory/workshop/line/station/
 * machine.create) theo đúng thứ tự cha-trước-con, dùng id trả về để nối con.
 * Mỗi thực thể hiển thị trạng thái thật (đang tạo / thành công / lỗi / bị chặn) —
 * KHÔNG bịa thành công. Lỗi dịch qua mapTrpcError (không lộ SQL). "Tạo lại" chỉ
 * thử lại các mục lỗi/bị chặn, bỏ qua mục đã tạo (không dựng trùng).
 *
 * Bỏ-qua-phần-còn-lại ở bất kỳ cấp nào (nhà máy chỉ có xưởng vẫn hợp lệ). Trạng
 * thái giữ nguyên khi hộp thoại còn mở (resumable trong phiên).
 *
 * i18n: dùng t("key","default vi") — CHỈ default inline, KHÔNG sửa file JSON.
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";
import { MACHINE_TYPES, type MachineType } from "@/constants/machineTypes";
import { machineTypeLabel } from "@/lib/machineTypeLabel";

import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import {
  Building2, Warehouse, GitBranch, Cpu, Cog, ListChecks,
  Plus, Trash2, ArrowLeft, ArrowRight, CheckCircle2, XCircle,
  Loader2, MinusCircle, CircleDashed, Rocket, RotateCcw, Info,
} from "lucide-react";

// ── Public API ────────────────────────────────────────────────────────────────
export interface FactorySetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Gọi sau khi chạy tạo xong (kể cả tạo một phần) để hub refetch danh sách. */
  onComplete?: () => void;
}

// ── Row models (client-only, dùng lid để nối cha-con trước khi có id thật) ──────
interface WorkshopRow { lid: string; code: string; name: string; description: string }
interface LineRow { lid: string; parentLid: string; code: string; name: string; description: string }
interface StationRow { lid: string; parentLid: string; code: string; name: string; description: string; orderIndex: string }
interface MachineRow {
  lid: string; parentLid: string; code: string; name: string;
  machineType: MachineType; model: string; manufacturer: string; description: string;
}

type RunState = "idle" | "creating" | "success" | "error" | "blocked";
interface RunResult { state: RunState; message?: string; realId?: number }

const STEPS = ["factory", "workshops", "lines", "stations", "machines", "review"] as const;
type StepKey = (typeof STEPS)[number];
const REVIEW_INDEX = STEPS.length - 1;

const emptyToUndef = (s: string): string | undefined => {
  const v = s.trim();
  return v.length > 0 ? v : undefined;
};

// ── Presentational helpers (no hooks — safe module-level components) ────────────
function Field({
  label, required, className, children,
}: { label: string; required?: boolean; className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}

function RowShell({
  index, onRemove, removeLabel, children,
}: { index: number; onRemove: () => void; removeLabel: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">#{index + 1}</span>
        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      {children}
    </div>
  );
}

const STEP_ICON: Record<StepKey, React.ComponentType<{ className?: string }>> = {
  factory: Building2,
  workshops: Warehouse,
  lines: GitBranch,
  stations: Cpu,
  machines: Cog,
  review: ListChecks,
};

const RUN_ICON: Record<RunState, React.JSX.Element> = {
  idle: <CircleDashed className="h-4 w-4 text-muted-foreground/50" />,
  creating: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  success: <CheckCircle2 className="h-4 w-4 text-success" />,
  error: <XCircle className="h-4 w-4 text-destructive" />,
  blocked: <MinusCircle className="h-4 w-4 text-warning" />,
};

// ── Component ───────────────────────────────────────────────────────────────────
export function FactorySetupWizard({ open, onOpenChange, onComplete }: FactorySetupWizardProps): React.JSX.Element {
  const { t } = useTranslation();

  const [step, setStep] = useState(0);

  // Factory step
  const [factoryMode, setFactoryMode] = useState<"create" | "existing">("create");
  const [existingFactoryId, setExistingFactoryId] = useState<number | null>(null);
  const [factoryForm, setFactoryForm] = useState({ code: "", name: "", description: "", address: "" });

  // Child levels
  const [workshops, setWorkshops] = useState<WorkshopRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);

  // Run state
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState<Record<string, RunResult>>({});

  const lidRef = useRef(0);
  const nextLid = () => String(++lidRef.current);

  const existingFactoriesQ = trpc.factory.list.useQuery(undefined, { enabled: open });
  const existingFactories = (existingFactoriesQ.data ?? []) as { id: number; code: string; name: string }[];

  const utils = trpc.useUtils();
  const factoryCreate = trpc.factory.create.useMutation();
  const workshopCreate = trpc.workshop.create.useMutation();
  const lineCreate = trpc.line.create.useMutation();
  const stationCreate = trpc.station.create.useMutation();
  const machineCreate = trpc.machine.create.useMutation();

  // ── Editing invalidates a prior run's results (so it can be re-run cleanly) ──
  const clearRunIfDone = () => {
    if (done || Object.keys(results).length > 0) {
      setDone(false);
      setResults({});
    }
  };

  // ── Mutators (cascade-remove children so parentLid never dangles) ──────────
  const addWorkshop = () => { clearRunIfDone(); setWorkshops((p) => [...p, { lid: nextLid(), code: "", name: "", description: "" }]); };
  const updateWorkshop = (lid: string, patch: Partial<WorkshopRow>) => { clearRunIfDone(); setWorkshops((p) => p.map((w) => (w.lid === lid ? { ...w, ...patch } : w))); };
  const removeWorkshop = (lid: string) => {
    clearRunIfDone();
    const lineLids = lines.filter((l) => l.parentLid === lid).map((l) => l.lid);
    const stationLids = stations.filter((s) => lineLids.includes(s.parentLid)).map((s) => s.lid);
    setMachines((p) => p.filter((m) => !stationLids.includes(m.parentLid)));
    setStations((p) => p.filter((s) => !lineLids.includes(s.parentLid)));
    setLines((p) => p.filter((l) => l.parentLid !== lid));
    setWorkshops((p) => p.filter((w) => w.lid !== lid));
  };

  const addLine = () => {
    const parent = workshops[workshops.length - 1];
    if (!parent) return;
    clearRunIfDone();
    setLines((p) => [...p, { lid: nextLid(), parentLid: parent.lid, code: "", name: "", description: "" }]);
  };
  const updateLine = (lid: string, patch: Partial<LineRow>) => { clearRunIfDone(); setLines((p) => p.map((l) => (l.lid === lid ? { ...l, ...patch } : l))); };
  const removeLine = (lid: string) => {
    clearRunIfDone();
    const stationLids = stations.filter((s) => s.parentLid === lid).map((s) => s.lid);
    setMachines((p) => p.filter((m) => !stationLids.includes(m.parentLid)));
    setStations((p) => p.filter((s) => s.parentLid !== lid));
    setLines((p) => p.filter((l) => l.lid !== lid));
  };

  const addStation = () => {
    const parent = lines[lines.length - 1];
    if (!parent) return;
    clearRunIfDone();
    const siblings = stations.filter((s) => s.parentLid === parent.lid).length;
    setStations((p) => [...p, { lid: nextLid(), parentLid: parent.lid, code: "", name: "", description: "", orderIndex: String(siblings) }]);
  };
  const updateStation = (lid: string, patch: Partial<StationRow>) => { clearRunIfDone(); setStations((p) => p.map((s) => (s.lid === lid ? { ...s, ...patch } : s))); };
  const removeStation = (lid: string) => {
    clearRunIfDone();
    setMachines((p) => p.filter((m) => m.parentLid !== lid));
    setStations((p) => p.filter((s) => s.lid !== lid));
  };

  const addMachine = () => {
    const parent = stations[stations.length - 1];
    if (!parent) return;
    clearRunIfDone();
    setMachines((p) => [...p, {
      lid: nextLid(), parentLid: parent.lid, code: "", name: "",
      machineType: "AVI", model: "", manufacturer: "", description: "",
    }]);
  };
  const updateMachine = (lid: string, patch: Partial<MachineRow>) => { clearRunIfDone(); setMachines((p) => p.map((m) => (m.lid === lid ? { ...m, ...patch } : m))); };
  const removeMachine = (lid: string) => { clearRunIfDone(); setMachines((p) => p.filter((m) => m.lid !== lid)); };

  // ── Validity ───────────────────────────────────────────────────────────────
  const factoryValid = factoryMode === "existing"
    ? existingFactoryId != null
    : factoryForm.code.trim() !== "" && factoryForm.name.trim() !== "";
  const rowValid = (r: { code: string; name: string }) => r.code.trim() !== "" && r.name.trim() !== "";
  const machineValid = (m: MachineRow) => rowValid(m) && !!m.machineType;

  const allRowsValid =
    workshops.every(rowValid) && lines.every(rowValid) &&
    stations.every(rowValid) && machines.every(machineValid);
  const totalChildren = workshops.length + lines.length + stations.length + machines.length;
  const nothingToCreate = factoryMode === "existing" && totalChildren === 0;
  const canCreate = factoryValid && allRowsValid && !nothingToCreate && !running;

  // ── Parent option labels ─────────────────────────────────────────────────────
  const labelOf = (code: string, name: string) =>
    `${code.trim() || t("factorySetup.noCode", "(chưa có mã)")} — ${name.trim() || t("factorySetup.noName", "(chưa có tên)")}`;
  const workshopOptions = workshops.map((w) => ({ lid: w.lid, label: labelOf(w.code, w.name) }));
  const lineOptions = lines.map((l) => ({ lid: l.lid, label: labelOf(l.code, l.name) }));
  const stationOptions = stations.map((s) => ({ lid: s.lid, label: labelOf(s.code, s.name) }));

  // ── Plan (for review + progress) ─────────────────────────────────────────────
  interface PlanItem { key: string; depth: number; icon: React.ComponentType<{ className?: string }>; label: string }
  const factoryLabel = factoryMode === "existing"
    ? (existingFactories.find((f) => f.id === existingFactoryId)
        ? labelOf(existingFactories.find((f) => f.id === existingFactoryId)!.code, existingFactories.find((f) => f.id === existingFactoryId)!.name)
        : t("factorySetup.review.pickFactory", "Chưa chọn nhà máy"))
    : labelOf(factoryForm.code, factoryForm.name);
  const plan: PlanItem[] = useMemo(() => {
    const items: PlanItem[] = [];
    items.push({ key: "factory", depth: 0, icon: Building2, label: factoryLabel });
    for (const w of workshops) {
      items.push({ key: `workshop:${w.lid}`, depth: 1, icon: Warehouse, label: labelOf(w.code, w.name) });
      for (const l of lines.filter((x) => x.parentLid === w.lid)) {
        items.push({ key: `line:${l.lid}`, depth: 2, icon: GitBranch, label: labelOf(l.code, l.name) });
        for (const s of stations.filter((x) => x.parentLid === l.lid)) {
          items.push({ key: `station:${s.lid}`, depth: 3, icon: Cpu, label: labelOf(s.code, s.name) });
          for (const m of machines.filter((x) => x.parentLid === s.lid)) {
            items.push({ key: `machine:${m.lid}`, depth: 4, icon: Cog, label: `${labelOf(m.code, m.name)} · ${machineTypeLabel(t, m.machineType)}` });
          }
        }
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryLabel, workshops, lines, stations, machines]);

  // ── Create run (parent-before-child, honest per-entity status) ───────────────
  const runCreate = async () => {
    setRunning(true);
    setDone(false);

    // Seed from prior results so a re-run only fills the gaps (idempotent-ish).
    const res: Record<string, RunResult> = { ...results };
    const commit = (key: string, r: RunResult) => { res[key] = r; setResults({ ...res }); };
    const already = (key: string) => res[key]?.state === "success" && typeof res[key]?.realId === "number";

    // 1) Factory
    let factoryId: number | null = null;
    if (factoryMode === "existing") {
      factoryId = existingFactoryId;
      commit("factory", { state: "success", realId: factoryId ?? undefined, message: t("factorySetup.run.existingFactory", "Dùng nhà máy có sẵn") });
    } else if (already("factory")) {
      factoryId = res.factory.realId ?? null;
    } else {
      commit("factory", { state: "creating" });
      try {
        const r = await factoryCreate.mutateAsync({
          code: factoryForm.code.trim(),
          name: factoryForm.name.trim(),
          description: emptyToUndef(factoryForm.description),
          address: emptyToUndef(factoryForm.address),
        });
        factoryId = r.id;
        commit("factory", { state: "success", realId: r.id });
      } catch (e) {
        commit("factory", { state: "error", message: mapTrpcError(e) });
      }
    }

    const blockedMsg = t("factorySetup.run.parentFailed", "Bị chặn: cha chưa được tạo");
    const wsId: Record<string, number> = {};
    for (const w of workshops) {
      const key = `workshop:${w.lid}`;
      if (already(key)) { wsId[w.lid] = res[key].realId!; continue; }
      if (factoryId == null) { commit(key, { state: "blocked", message: blockedMsg }); continue; }
      commit(key, { state: "creating" });
      try {
        const r = await workshopCreate.mutateAsync({ factoryId, code: w.code.trim(), name: w.name.trim(), description: emptyToUndef(w.description) });
        wsId[w.lid] = r.id;
        commit(key, { state: "success", realId: r.id });
      } catch (e) { commit(key, { state: "error", message: mapTrpcError(e) }); }
    }

    const lnId: Record<string, number> = {};
    for (const l of lines) {
      const key = `line:${l.lid}`;
      if (already(key)) { lnId[l.lid] = res[key].realId!; continue; }
      const parentId = wsId[l.parentLid];
      if (parentId == null) { commit(key, { state: "blocked", message: blockedMsg }); continue; }
      commit(key, { state: "creating" });
      try {
        const r = await lineCreate.mutateAsync({ workshopId: parentId, code: l.code.trim(), name: l.name.trim(), description: emptyToUndef(l.description) });
        lnId[l.lid] = r.id;
        commit(key, { state: "success", realId: r.id });
      } catch (e) { commit(key, { state: "error", message: mapTrpcError(e) }); }
    }

    const stId: Record<string, number> = {};
    for (const s of stations) {
      const key = `station:${s.lid}`;
      if (already(key)) { stId[s.lid] = res[key].realId!; continue; }
      const parentId = lnId[s.parentLid];
      if (parentId == null) { commit(key, { state: "blocked", message: blockedMsg }); continue; }
      commit(key, { state: "creating" });
      const orderIndex = Number.isFinite(parseInt(s.orderIndex, 10)) ? parseInt(s.orderIndex, 10) : undefined;
      try {
        const r = await stationCreate.mutateAsync({ lineId: parentId, code: s.code.trim(), name: s.name.trim(), description: emptyToUndef(s.description), orderIndex });
        stId[s.lid] = r.id;
        commit(key, { state: "success", realId: r.id });
      } catch (e) { commit(key, { state: "error", message: mapTrpcError(e) }); }
    }

    for (const m of machines) {
      const key = `machine:${m.lid}`;
      if (already(key)) continue;
      const parentId = stId[m.parentLid];
      if (parentId == null) { commit(key, { state: "blocked", message: blockedMsg }); continue; }
      commit(key, { state: "creating" });
      try {
        const r = await machineCreate.mutateAsync({
          stationId: parentId, code: m.code.trim(), name: m.name.trim(), machineType: m.machineType,
          model: emptyToUndef(m.model), manufacturer: emptyToUndef(m.manufacturer), description: emptyToUndef(m.description),
        });
        commit(key, { state: "success", realId: r.id });
      } catch (e) { commit(key, { state: "error", message: mapTrpcError(e) }); }
    }

    // Refresh every hierarchy list so the hub/tree reflect what was created.
    utils.factory.list.invalidate();
    utils.workshop.list.invalidate();
    utils.line.list.invalidate();
    utils.station.list.invalidate();
    utils.machine.list.invalidate();

    setRunning(false);
    setDone(true);
    onComplete?.();
  };

  const resetAll = () => {
    setStep(0);
    setFactoryMode("create");
    setExistingFactoryId(null);
    setFactoryForm({ code: "", name: "", description: "", address: "" });
    setWorkshops([]); setLines([]); setStations([]); setMachines([]);
    setResults({}); setDone(false); setRunning(false);
    lidRef.current = 0;
  };

  const runValues = Object.values(results);
  const successCount = runValues.filter((r) => r.state === "success").length;
  const failedCount = runValues.filter((r) => r.state === "error" || r.state === "blocked").length;

  // ── Navigation ───────────────────────────────────────────────────────────────
  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(i, REVIEW_INDEX));
    if (clamped > 0 && !factoryValid) return; // can't leave factory step until valid
    setStep(clamped);
  };

  // ── Level section header (add button + count) ───────────────────────────────
  const LevelHeader = ({
    icon: Icon, title, subtitle, count, addLabel, onAdd, addDisabled, disabledHint,
  }: {
    icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string;
    count: number; addLabel: string; onAdd: () => void; addDisabled?: boolean; disabledHint?: string;
  }): React.JSX.Element => (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{title}</span>
            <Badge variant="outline" className="tabular-nums">{count}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" variant="outline" onClick={onAdd} disabled={addDisabled}>
          <Plus className="mr-1 h-4 w-4" />{addLabel}
        </Button>
        {addDisabled && disabledHint ? (
          <span className="text-[11px] text-warning">{disabledHint}</span>
        ) : null}
      </div>
    </div>
  );

  const emptyHint = (msg: string): React.JSX.Element => (
    <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
      {msg}
    </div>
  );

  // ── Step bodies ──────────────────────────────────────────────────────────────
  const renderFactory = (): React.JSX.Element => (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          variant={factoryMode === "create" ? "default" : "outline"}
          size="sm"
          onClick={() => { setFactoryMode("create"); clearRunIfDone(); }}
        >
          {t("factorySetup.factory.modeCreate", "Tạo nhà máy mới")}
        </Button>
        <Button
          variant={factoryMode === "existing" ? "default" : "outline"}
          size="sm"
          onClick={() => { setFactoryMode("existing"); clearRunIfDone(); }}
        >
          {t("factorySetup.factory.modeExisting", "Chọn nhà máy có sẵn")}
        </Button>
      </div>

      {factoryMode === "create" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t("factorySetup.fields.code", "Mã")} required>
            <Input value={factoryForm.code} placeholder="FAC-01"
              onChange={(e) => { clearRunIfDone(); setFactoryForm((f) => ({ ...f, code: e.target.value })); }} />
          </Field>
          <Field label={t("factorySetup.fields.name", "Tên")} required>
            <Input value={factoryForm.name} placeholder={t("factorySetup.factory.namePlaceholder", "Nhà máy chính")}
              onChange={(e) => { clearRunIfDone(); setFactoryForm((f) => ({ ...f, name: e.target.value })); }} />
          </Field>
          <Field label={t("factorySetup.fields.address", "Địa chỉ")}>
            <Input value={factoryForm.address}
              onChange={(e) => { clearRunIfDone(); setFactoryForm((f) => ({ ...f, address: e.target.value })); }} />
          </Field>
          <Field label={t("factorySetup.fields.description", "Mô tả")}>
            <Input value={factoryForm.description}
              onChange={(e) => { clearRunIfDone(); setFactoryForm((f) => ({ ...f, description: e.target.value })); }} />
          </Field>
        </div>
      ) : (
        <div className="space-y-2">
          <Field label={t("factorySetup.factory.pickLabel", "Nhà máy")} required>
            <Select
              value={existingFactoryId != null ? String(existingFactoryId) : undefined}
              onValueChange={(v) => { clearRunIfDone(); setExistingFactoryId(Number(v)); }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("factorySetup.factory.pickPlaceholder", "Chọn nhà máy…")} />
              </SelectTrigger>
              <SelectContent>
                {existingFactories.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>{labelOf(f.code, f.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {existingFactoriesQ.isLoading ? (
            <p className="text-xs text-muted-foreground">{t("common.loading", "Đang tải…")}</p>
          ) : existingFactories.length === 0 ? (
            <p className="text-xs text-warning">{t("factorySetup.factory.noneExisting", "Chưa có nhà máy nào — hãy tạo mới.")}</p>
          ) : null}
        </div>
      )}
    </div>
  );

  const renderWorkshops = (): React.JSX.Element => (
    <div className="space-y-3">
      <LevelHeader
        icon={Warehouse}
        title={t("factorySetup.steps.workshops", "Xưởng")}
        subtitle={t("factorySetup.workshops.subtitle", "Thêm một hoặc nhiều xưởng dưới nhà máy.")}
        count={workshops.length}
        addLabel={t("factorySetup.workshops.add", "Thêm xưởng")}
        onAdd={addWorkshop}
      />
      {workshops.length === 0
        ? emptyHint(t("factorySetup.workshops.empty", "Chưa có xưởng nào. Bấm “Thêm xưởng”, hoặc bỏ qua để chỉ tạo nhà máy."))
        : workshops.map((w, i) => (
          <RowShell key={w.lid} index={i} onRemove={() => removeWorkshop(w.lid)} removeLabel={t("factorySetup.remove", "Xoá")}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label={t("factorySetup.fields.code", "Mã")} required>
                <Input value={w.code} placeholder="WS-01" onChange={(e) => updateWorkshop(w.lid, { code: e.target.value })} />
              </Field>
              <Field label={t("factorySetup.fields.name", "Tên")} required>
                <Input value={w.name} onChange={(e) => updateWorkshop(w.lid, { name: e.target.value })} />
              </Field>
              <Field label={t("factorySetup.fields.description", "Mô tả")} className="md:col-span-2">
                <Input value={w.description} onChange={(e) => updateWorkshop(w.lid, { description: e.target.value })} />
              </Field>
            </div>
          </RowShell>
        ))}
    </div>
  );

  const renderLines = (): React.JSX.Element => (
    <div className="space-y-3">
      <LevelHeader
        icon={GitBranch}
        title={t("factorySetup.steps.lines", "Dây chuyền")}
        subtitle={t("factorySetup.lines.subtitle", "Mỗi dây chuyền thuộc một xưởng.")}
        count={lines.length}
        addLabel={t("factorySetup.lines.add", "Thêm dây chuyền")}
        onAdd={addLine}
        addDisabled={workshops.length === 0}
        disabledHint={t("factorySetup.lines.needWorkshop", "Cần có xưởng trước")}
      />
      {workshops.length === 0
        ? emptyHint(t("factorySetup.lines.needWorkshopBody", "Hãy thêm ít nhất một xưởng ở bước trước."))
        : lines.length === 0
          ? emptyHint(t("factorySetup.lines.empty", "Chưa có dây chuyền nào."))
          : lines.map((l, i) => (
            <RowShell key={l.lid} index={i} onRemove={() => removeLine(l.lid)} removeLabel={t("factorySetup.remove", "Xoá")}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={t("factorySetup.parent.workshop", "Xưởng")} required className="md:col-span-2">
                  <Select value={l.parentLid} onValueChange={(v) => updateLine(l.lid, { parentLid: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {workshopOptions.map((o) => <SelectItem key={o.lid} value={o.lid}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("factorySetup.fields.code", "Mã")} required>
                  <Input value={l.code} placeholder="LINE-01" onChange={(e) => updateLine(l.lid, { code: e.target.value })} />
                </Field>
                <Field label={t("factorySetup.fields.name", "Tên")} required>
                  <Input value={l.name} onChange={(e) => updateLine(l.lid, { name: e.target.value })} />
                </Field>
                <Field label={t("factorySetup.fields.description", "Mô tả")} className="md:col-span-2">
                  <Input value={l.description} onChange={(e) => updateLine(l.lid, { description: e.target.value })} />
                </Field>
              </div>
            </RowShell>
          ))}
    </div>
  );

  const renderStations = (): React.JSX.Element => (
    <div className="space-y-3">
      <LevelHeader
        icon={Cpu}
        title={t("factorySetup.steps.stations", "Trạm")}
        subtitle={t("factorySetup.stations.subtitle", "Mỗi trạm thuộc một dây chuyền.")}
        count={stations.length}
        addLabel={t("factorySetup.stations.add", "Thêm trạm")}
        onAdd={addStation}
        addDisabled={lines.length === 0}
        disabledHint={t("factorySetup.stations.needLine", "Cần có dây chuyền trước")}
      />
      {lines.length === 0
        ? emptyHint(t("factorySetup.stations.needLineBody", "Hãy thêm ít nhất một dây chuyền ở bước trước."))
        : stations.length === 0
          ? emptyHint(t("factorySetup.stations.empty", "Chưa có trạm nào."))
          : stations.map((s, i) => (
            <RowShell key={s.lid} index={i} onRemove={() => removeStation(s.lid)} removeLabel={t("factorySetup.remove", "Xoá")}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={t("factorySetup.parent.line", "Dây chuyền")} required className="md:col-span-2">
                  <Select value={s.parentLid} onValueChange={(v) => updateStation(s.lid, { parentLid: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {lineOptions.map((o) => <SelectItem key={o.lid} value={o.lid}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("factorySetup.fields.code", "Mã")} required>
                  <Input value={s.code} placeholder="ST-01" onChange={(e) => updateStation(s.lid, { code: e.target.value })} />
                </Field>
                <Field label={t("factorySetup.fields.name", "Tên")} required>
                  <Input value={s.name} onChange={(e) => updateStation(s.lid, { name: e.target.value })} />
                </Field>
                <Field label={t("factorySetup.fields.orderIndex", "Thứ tự")}>
                  <Input type="number" value={s.orderIndex} onChange={(e) => updateStation(s.lid, { orderIndex: e.target.value })} />
                </Field>
                <Field label={t("factorySetup.fields.description", "Mô tả")}>
                  <Input value={s.description} onChange={(e) => updateStation(s.lid, { description: e.target.value })} />
                </Field>
              </div>
            </RowShell>
          ))}
    </div>
  );

  const renderMachines = (): React.JSX.Element => (
    <div className="space-y-3">
      <LevelHeader
        icon={Cog}
        title={t("factorySetup.steps.machines", "Máy")}
        subtitle={t("factorySetup.machines.subtitle", "Mỗi máy thuộc một trạm.")}
        count={machines.length}
        addLabel={t("factorySetup.machines.add", "Thêm máy")}
        onAdd={addMachine}
        addDisabled={stations.length === 0}
        disabledHint={t("factorySetup.machines.needStation", "Cần có trạm trước")}
      />
      {stations.length === 0
        ? emptyHint(t("factorySetup.machines.needStationBody", "Hãy thêm ít nhất một trạm ở bước trước."))
        : machines.length === 0
          ? emptyHint(t("factorySetup.machines.empty", "Chưa có máy nào."))
          : machines.map((m, i) => (
            <RowShell key={m.lid} index={i} onRemove={() => removeMachine(m.lid)} removeLabel={t("factorySetup.remove", "Xoá")}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={t("factorySetup.parent.station", "Trạm")} required>
                  <Select value={m.parentLid} onValueChange={(v) => updateMachine(m.lid, { parentLid: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {stationOptions.map((o) => <SelectItem key={o.lid} value={o.lid}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("factorySetup.fields.machineType", "Loại máy")} required>
                  <Select value={m.machineType} onValueChange={(v) => updateMachine(m.lid, { machineType: v as MachineType })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MACHINE_TYPES.map((mt) => <SelectItem key={mt} value={mt}>{machineTypeLabel(t, mt)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("factorySetup.fields.code", "Mã")} required>
                  <Input value={m.code} placeholder="AOI-01" onChange={(e) => updateMachine(m.lid, { code: e.target.value })} />
                </Field>
                <Field label={t("factorySetup.fields.name", "Tên")} required>
                  <Input value={m.name} onChange={(e) => updateMachine(m.lid, { name: e.target.value })} />
                </Field>
                <Field label={t("factorySetup.fields.model", "Model")}>
                  <Input value={m.model} onChange={(e) => updateMachine(m.lid, { model: e.target.value })} />
                </Field>
                <Field label={t("factorySetup.fields.manufacturer", "Hãng sản xuất")}>
                  <Input value={m.manufacturer} onChange={(e) => updateMachine(m.lid, { manufacturer: e.target.value })} />
                </Field>
                <Field label={t("factorySetup.fields.description", "Mô tả")} className="md:col-span-2">
                  <Textarea rows={2} value={m.description} onChange={(e) => updateMachine(m.lid, { description: e.target.value })} />
                </Field>
              </div>
            </RowShell>
          ))}
    </div>
  );

  const renderReview = (): React.JSX.Element => (
    <div className="space-y-4">
      {nothingToCreate ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t("factorySetup.review.nothing", "Bạn đã chọn nhà máy có sẵn nhưng chưa thêm mục con nào — không có gì để tạo.")}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{t("factorySetup.review.factories", "Nhà máy")}: {factoryMode === "existing" ? 0 : 1}</Badge>
          <Badge variant="outline">{t("factorySetup.steps.workshops", "Xưởng")}: {workshops.length}</Badge>
          <Badge variant="outline">{t("factorySetup.steps.lines", "Dây chuyền")}: {lines.length}</Badge>
          <Badge variant="outline">{t("factorySetup.steps.stations", "Trạm")}: {stations.length}</Badge>
          <Badge variant="outline">{t("factorySetup.steps.machines", "Máy")}: {machines.length}</Badge>
        </div>
      )}

      {!allRowsValid ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("factorySetup.review.invalid", "Một số dòng còn thiếu mã hoặc tên. Hãy quay lại và điền đủ trước khi tạo.")}
        </div>
      ) : null}

      {done ? (
        <div className={cn(
          "flex items-start gap-2 rounded-lg border p-3 text-sm",
          failedCount === 0 ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning",
        )}>
          {failedCount === 0 ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
          {t("factorySetup.review.result", "Đã tạo {{ok}} mục, {{fail}} lỗi/bị chặn.")
            .replace("{{ok}}", String(successCount)).replace("{{fail}}", String(failedCount))}
        </div>
      ) : null}

      <div className="max-h-[42vh] space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
        {plan.map((item) => {
          const r = results[item.key];
          const state: RunState = r?.state ?? "idle";
          const Icon = item.icon;
          return (
            <div key={item.key} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm" style={{ paddingLeft: `${item.depth * 18 + 4}px` }}>
              <span className="shrink-0">{RUN_ICON[state]}</span>
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {r?.message ? (
                <span className={cn("shrink-0 truncate text-xs", state === "error" ? "text-destructive" : "text-muted-foreground")} title={r.message}>
                  {r.message}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderBody = (): React.JSX.Element | null => {
    switch (STEPS[step]) {
      case "factory": return renderFactory();
      case "workshops": return renderWorkshops();
      case "lines": return renderLines();
      case "stations": return renderStations();
      case "machines": return renderMachines();
      case "review": return renderReview();
      default: return null;
    }
  };

  const stepCount: Record<StepKey, number> = {
    factory: factoryValid ? 1 : 0,
    workshops: workshops.length,
    lines: lines.length,
    stations: stations.length,
    machines: machines.length,
    review: plan.length,
  };

  const allSuccess = done && failedCount === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b p-5 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            {t("factorySetup.title", "Trình dựng nhà máy")}
          </DialogTitle>
          <DialogDescription>
            {t("factorySetup.subtitle", "Dựng nhà máy từ trên xuống: Nhà máy → Xưởng → Dây chuyền → Trạm → Máy. Có thể bỏ qua phần còn lại ở bất kỳ bước nào.")}
          </DialogDescription>

          {/* Stepper */}
          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {STEPS.map((s, i) => {
              const Icon = STEP_ICON[s];
              const disabled = i > 0 && !factoryValid;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={disabled}
                  onClick={() => goTo(i)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border p-2 text-center text-[11px] transition-colors",
                    i === step ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                    disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  <div className="flex items-center gap-1">
                    <Icon className="h-3.5 w-3.5" />
                    <span className="tabular-nums">{stepCount[s]}</span>
                  </div>
                  <span className="leading-tight">{t(`factorySetup.steps.${s}`, s)}</span>
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="max-h-[56vh] overflow-y-auto p-5">
          {renderBody()}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between gap-2 border-t p-4">
          <Button variant="outline" onClick={() => goTo(step - 1)} disabled={step === 0 || running}>
            <ArrowLeft className="mr-1 h-4 w-4" />{t("common.back", "Quay lại")}
          </Button>

          <div className="flex items-center gap-2">
            {step > 0 && step < REVIEW_INDEX ? (
              <Button variant="ghost" onClick={() => goTo(REVIEW_INDEX)} disabled={running}>
                {t("factorySetup.skipRemaining", "Bỏ qua phần còn lại")}
              </Button>
            ) : null}

            {step < REVIEW_INDEX ? (
              <Button onClick={() => goTo(step + 1)} disabled={step === 0 && !factoryValid}>
                {t("common.next", "Tiếp")}<ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : allSuccess ? (
              <>
                <Button variant="outline" onClick={resetAll}>
                  <RotateCcw className="mr-1 h-4 w-4" />{t("factorySetup.startOver", "Dựng nhà máy khác")}
                </Button>
                <Button onClick={() => onOpenChange(false)}>
                  {t("common.close", "Đóng")}
                </Button>
              </>
            ) : done && failedCount > 0 ? (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
                  {t("common.close", "Đóng")}
                </Button>
                <Button onClick={runCreate} disabled={running || !allRowsValid}>
                  {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
                  {t("factorySetup.retryFailed", "Thử lại mục lỗi")}
                </Button>
              </>
            ) : (
              <Button onClick={runCreate} disabled={!canCreate}>
                {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Rocket className="mr-1 h-4 w-4" />}
                {t("factorySetup.createAll", "Tạo tất cả")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default FactorySetupWizard;
