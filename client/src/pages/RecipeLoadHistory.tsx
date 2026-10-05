/**
 * Doc 81 Đợt 3 Task 1 — "Lịch sử nạp" và "Ghi nhận nạp" dời từ Equipment Integration sang Recipes.
 *
 * - `LoadHistoryPanel`: phả hệ nạp recipe (`recipe_load_log`) theo MÃ (`equipmentIntegration.listCodeHistory`) hoặc
 *   theo MÁY (`equipmentIntegration.listLoadHistory`) — cùng thủ tục, cùng giới hạn 200 dòng, cùng cột, cùng nhãn thao
 *   tác như tab "Lịch sử nạp" cũ của Integration; bảng là `DataTable` dùng chung (phân trang). Mã = mã đang chọn ở danh
 *   sách bên trái (`?code=`), máy = bộ chọn máy trên header (`?machineId=`) — không thêm ô chọn thứ hai.
 * - `RecordLoadForm`: sheet "Ghi nhận nạp" CHUYỂN NGUYÊN từ Integration (R-2-n): MỘT phiên bản, MỘT máy, MỘT lượt
 *   `recordRecipeLoad` mỗi lần bấm; ô "Đồng thời ghi một dòng sổ recipe_deployments" (`deploy`) vẫn là MỘT ô đánh dấu
 *   trong cùng form như màn cũ (màn cũ không tách hai thao tác); cùng kiểm tra "Chọn một máy.", cùng payload
 *   `{ recipeId, machineId, deploy, notes }`, cùng danh sách máy (`machine.list`). Cổng chặt Đợt 1C của nhánh
 *   `deploy:true` nằm ở server, không đổi. Mới: lời từ chối của server (vd `recipeArchived`) hiện trong khối
 *   role=alert ngay trong sheet (ngoài toast như cũ), như drawer triển khai của Recipes.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge, useCloseOwnLayer } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { isFeatureDisabledError } from "@/lib/featureFlagError";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type LoadLogRow = RouterOutputs["equipmentIntegration"]["listLoadHistory"][number];
export type LoadMachine = RouterOutputs["machine"]["list"][number];
export type HistoryMode = "machine" | "code";
export type RecordLoadInput = { recipeId: number; machineId: number; deploy: boolean; notes?: string };
/** Phiên bản mà sheet ghi nhận nạp cần (một hàng `machineRecipe.recipes.listVersions`). */
export type RecordLoadVersion = { id: number; code: string; version: number; machineId?: number | null };

// ── Thao tác → tông màu (như bảng phả hệ cũ của Integration) ──────────────────────────────────────
const ACTION_TONE: Record<string, "success" | "warning" | "info" | "default" | "error"> = {
  create: "default",
  release: "success",
  archive: "warning",
  rollback: "info",
  load: "info",
};

export function LoadHistoryPanel({
  mode, onModeChange, code, machineId, machineLabel, canRead, rows, loading, error, onRetry,
}: {
  mode: HistoryMode;
  onModeChange: (m: HistoryMode) => void;
  /** Mã đang chọn (`?code=`), null khi chưa chọn. */
  code: string | null;
  /** Máy đang chọn ở header (`?machineId=`), null khi chưa chọn. */
  machineId: number | null;
  machineLabel: (id: number) => string;
  /** Quyền đọc của thủ tục cũ (machine_monitoring/canView) — thiếu thì không gọi server. */
  canRead: boolean;
  rows: LoadLogRow[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const columns: DataTableColumn<LoadLogRow>[] = [
    {
      id: "when",
      header: t("eqIntegration.col.when", "When"),
      cell: (r) => <span className="whitespace-nowrap text-xs text-muted-foreground">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</span>,
    },
    {
      id: "action",
      header: t("eqIntegration.col.action", "Action"),
      cell: (r) => <StatusBadge status={r.action} tone={ACTION_TONE[r.action] ?? "default"} label={t(`eqIntegration.action.${r.action}`, r.action)} />,
    },
    {
      id: "recipe",
      header: t("eqIntegration.col.recipe", "Code @ version"),
      cell: (r) => <span className="font-mono text-xs">{r.recipeCode}{r.recipeVersion != null ? ` @v${r.recipeVersion}` : ""}</span>,
    },
    {
      id: "machine",
      header: t("eqIntegration.col.machine", "Machine"),
      cell: (r) => <span className="text-xs">{r.machineId != null ? machineLabel(r.machineId) : "—"}</span>,
    },
    {
      id: "who",
      header: t("eqIntegration.col.who", "Performed by"),
      cell: (r) => <span className="text-xs">{r.performedBy != null ? `#${r.performedBy}` : "—"}</span>,
    },
    {
      id: "notes",
      header: t("eqIntegration.col.notes", "Notes"),
      cell: (r) => (
        <span className="block max-w-[20rem] truncate text-xs text-muted-foreground" title={r.notes ?? undefined}>
          {r.notes ?? "—"}
        </span>
      ),
    },
  ];

  let body: ReactNode;
  if (!canRead) {
    body = (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("recipes.loads.noPermission", "Xem lịch sử nạp cần quyền xem giám sát máy (machine_monitoring).")}
      </p>
    );
  } else if (mode === "code" && code == null) {
    body = (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("recipes.loads.pickCode", "Chọn một mã recipe ở danh sách bên trái để xem lịch sử nạp của mã đó trên mọi máy.")}
      </p>
    );
  } else if (mode === "machine" && machineId == null) {
    body = (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("recipes.loads.pickMachine", "Chọn một máy ở ô \"Chọn máy\" trên đầu trang để xem lịch sử nạp của máy đó.")}
      </p>
    );
  } else if (error) {
    body = (
      <div role="alert" className="flex items-center justify-center gap-2 py-3 text-sm text-destructive">
        <span>{t("recipes.loads.loadError", "Không đọc được lịch sử nạp.")}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-1 h-4 w-4" /> {t("recipes.retry")}
        </Button>
      </div>
    );
  } else {
    body = (
      <DataTable<LoadLogRow>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        loading={loading}
        pageSize={25}
        emptyState={<p className="py-6 text-center text-sm text-muted-foreground">{t("eqIntegration.historyEmpty", "No genealogy events.")}</p>}
        className="space-y-2"
      />
    );
  }

  return (
    <div data-load-history="" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Select value={mode} onValueChange={(v) => onModeChange(v as HistoryMode)}>
          <SelectTrigger className="h-8 w-32" aria-label={t("eqIntegration.historyMode", "Filter by")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="machine">{t("eqIntegration.byMachine", "Machine")}</SelectItem>
            <SelectItem value="code">{t("eqIntegration.byCode", "Recipe code")}</SelectItem>
          </SelectContent>
        </Select>
        {mode === "code" && code != null && <span className="font-mono font-medium">{code}</span>}
        {mode === "machine" && machineId != null && <span className="font-medium">{machineLabel(machineId)}</span>}
      </div>
      {body}
    </div>
  );
}

function SheetFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 border-t pt-3">{children}</div>;
}

// ── Sheet: ghi nhận nạp recipe (chuyển nguyên từ EquipmentIntegration) ────────────────────────────
export function RecordLoadForm({
  version, machines, pending, onSubmit,
}: {
  version: RecordLoadVersion;
  machines: LoadMachine[];
  pending: boolean;
  /** `done` đóng CHÍNH lớp sheet khi thành công; `fail` nhận lỗi của lượt gọi (toast do hook của trang). */
  onSubmit: (v: RecordLoadInput, done: () => void, fail: (e: unknown) => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done, mountedRef } = useCloseOwnLayer();
  const uid = useId();
  const initialMachine = version.machineId ?? null;
  const [machineId, setMachineId] = useState<number | null>(initialMachine);
  const [deploy, setDeploy] = useState(false);
  const [notes, setNotes] = useState("");
  // Lời từ chối của server (đã qua mapTrpcError) cho đúng máy của lượt gọi đó.
  const [loadError, setLoadError] = useState<{ machineId: number; text: string } | null>(null);

  const dirty = machineId !== initialMachine || deploy || notes !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!machineId) { toast.error(t("eqIntegration.machineRequired", "Select a machine.")); return; }
    setLoadError(null);
    const id = machineId;
    onSubmit(
      { recipeId: version.id, machineId: id, deploy, notes: notes.trim() || undefined },
      done,
      (e) => {
        // Cờ tắt: toast.info bình tĩnh như cũ (hook trang), không khối đỏ.
        if (mountedRef.current && !isFeatureDisabledError(e)) setLoadError({ machineId: id, text: mapTrpcError(e) });
      },
    );
  };

  const label = (id: number) => {
    const m = machines.find((x) => x.id === id);
    return m ? (m.name ?? m.code) : `#${id}`;
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-machine`}>{t("eqIntegration.machine", "Machine")}</Label>
        {/* U11 — Select DS; "__none__" là sentinel cho "chưa chọn máy". */}
        <Select value={machineId != null ? String(machineId) : "__none__"} onValueChange={(v) => { setMachineId(v === "__none__" ? null : Number(v)); setLoadError(null); }}>
          <SelectTrigger id={`${uid}-machine`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("eqIntegration.selectMachine", "Select a machine…")}</SelectItem>
            {machines.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.code} ({m.code})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={deploy} onCheckedChange={(v) => { setDeploy(Boolean(v)); setLoadError(null); }} />
        {t("eqIntegration.alsoDeploy", "Also write a recipe_deployments ledger row")}
      </label>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-notes`}>{t("eqIntegration.notes", "Notes")}</Label>
        <Input id={`${uid}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {t("recipes.integ.loadFailed", "Ghi nhận nạp lên {{machine}} không thực hiện được", { machine: label(loadError.machineId) })}
            </div>
            <div>{loadError.text}</div>
          </div>
        </div>
      )}
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><Send className="mr-1 h-4 w-4" />{t("eqIntegration.recordLoad", "Record load")}</Button>
      </SheetFooter>
    </div>
  );
}
