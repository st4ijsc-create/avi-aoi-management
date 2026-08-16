/**
 * Doc 07 §③ — MES/MOM Master Data management (Supplier | Material | Customer |
 * Skill | Tool). Tabbed admin page; each tab is a list + create/edit dialog
 * backed by the `masterData` tRPC router.
 *
 * SAFETY: pure master-data CRUD. NEVER writes a value to a machine.
 * RBAC: module 'masterdata'. Create/edit/delete actions are hidden unless the
 * user holds the matching grant; the whole page requires canView.
 */
import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader, PageContainer, StatusBadge, ConfirmDeleteDialog, EntityPicker, UserSelect, EmptyState, StatChip, StatChipRow, ImportExportBar } from "@/components/patterns";
import type { EntityOption, MasterDataColumn, ImportResultSummary } from "@/components/patterns";
import { DataTable } from "@/components/DataTable";
import type { DataTableColumn } from "@/components/DataTable";
import { Database, Plus, Pencil, Trash2, AlertTriangle, Check, X as XIcon, UserPlus, Copy } from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";

type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "bool" | "select" | "email" | "entity";
  required?: boolean;
  options?: { value: string; label: string }[]; // for type "select"
  // doc 42 C4 — type "entity": combobox tìm-kiếm cho quan hệ mã (class/uom/material/
  // warehouse). Không nhập được mã không tồn tại; giá trị lệch hiện badge "Không tồn tại".
  entityOptions?: EntityOption[];
  entityLoading?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// doc 42 C4 — map danh sách {code,name} → option cho EntityPicker (value = mã).
function codeNameOptions(rows: readonly any[] | undefined): EntityOption[] {
  return (rows ?? [])
    .filter((r) => r?.code)
    .map((r) => ({ value: r.code as string, label: r.name ?? r.code, sublabel: r.code as string }));
}

const MASTER_DATA_TABS = [
  "suppliers", "materials", "materialClasses", "customers", "skills",
  "certifications", "tools", "uom", "calendar", "inventory",
] as const;

// ── doc 42 Đợt 4A #3 — nhãn tiếng Việt cho enum NCC (form + bảng + phê duyệt) ──
const SUPPLIER_TYPE_LABELS: Record<string, string> = {
  component: "masterDataEnum.supplier_type.component", raw_material: "masterDataEnum.supplier_type.raw_material", service: "masterDataEnum.supplier_type.service",
  equipment: "masterDataEnum.supplier_type.equipment", subcontractor: "masterDataEnum.supplier_type.subcontractor", other: "masterDataEnum.supplier_type.other",
};
const APPROVAL_LABELS: Record<string, string> = {
  pending: "masterDataEnum.approval.pending", approved: "masterDataEnum.approval.approved", conditional: "masterDataEnum.approval.conditional",
  rejected: "masterDataEnum.approval.rejected", suspended: "masterDataEnum.approval.suspended",
};
const APPROVAL_TONE: Record<string, "success" | "warning" | "error" | "default"> = {
  pending: "warning", approved: "success", conditional: "warning",
  rejected: "error", suspended: "error",
};
// Nhãn phải dịch LÚC RENDER, không lúc dựng hằng số module — hằng số chạy một lần
// trước khi i18n sẵn sàng và không đổi khi người dùng chuyển ngôn ngữ.
const SUPPLIER_TYPE_OPTIONS = Object.entries(SUPPLIER_TYPE_LABELS).map(([value, labelKey]) => ({ value, labelKey }));
const APPROVAL_OPTIONS = Object.entries(APPROVAL_LABELS).map(([value, labelKey]) => ({ value, labelKey }));

// ── doc 42 Đợt 4A #1 — đặc tả cột import/export (header tiếng Việt + ví dụ) ────
const SUPPLIER_IO_COLUMNS: MasterDataColumn[] = [
  { field: "code", header: "Mã nhà cung cấp", required: true, example: "AUDIT4_SUP01" },
  { field: "name", header: "Tên nhà cung cấp", required: true, example: "Công ty ABC" },
  { field: "type", header: "Loại", example: "component" },
  { field: "contactName", header: "Người liên hệ", example: "Nguyễn Văn A" },
  { field: "contactEmail", header: "Email", example: "a@abc.com" },
  { field: "contactPhone", header: "Điện thoại", example: "0900000000" },
  { field: "address", header: "Địa chỉ", example: "Hà Nội, Việt Nam" },
  { field: "country", header: "Quốc gia", example: "VN" },
  { field: "rating", header: "Đánh giá", type: "number", example: 4.5 },
  { field: "approvalStatus", header: "Phê duyệt", example: "pending" },
  { field: "isActive", header: "Kích hoạt", type: "boolean", example: true },
  { field: "notes", header: "Ghi chú", example: "" },
];
const MATERIAL_IO_COLUMNS: MasterDataColumn[] = [
  { field: "code", header: "Mã vật tư", required: true, example: "AUDIT4_MAT01" },
  { field: "name", header: "Tên vật tư", required: true, example: "Tụ 100nF 0402" },
  { field: "materialClass", header: "Nhóm vật tư", example: "CAP" },
  { field: "mpn", header: "Mã NSX (MPN)", example: "CL05B104KO5NNNC" },
  { field: "manufacturer", header: "Nhà sản xuất", example: "Samsung" },
  { field: "packageType", header: "Kiểu đóng gói", example: "0402" },
  { field: "msl", header: "MSL", example: "1" },
  { field: "unit", header: "Đơn vị", example: "pcs" },
  { field: "rohs", header: "RoHS", type: "boolean", example: true },
  { field: "isActive", header: "Kích hoạt", type: "boolean", example: true },
  { field: "notes", header: "Ghi chú", example: "" },
];
const MATERIAL_CLASS_IO_COLUMNS: MasterDataColumn[] = [
  { field: "code", header: "Mã nhóm", required: true, example: "CAP" },
  { field: "name", header: "Tên nhóm", required: true, example: "Tụ điện" },
  { field: "parentCode", header: "Nhóm cha", example: "" },
  { field: "description", header: "Mô tả", example: "" },
  { field: "isActive", header: "Kích hoạt", type: "boolean", example: true },
];
const CUSTOMER_IO_COLUMNS: MasterDataColumn[] = [
  { field: "code", header: "Mã khách hàng", required: true, example: "AUDIT4_CUST01" },
  { field: "name", header: "Tên khách hàng", required: true, example: "Khách hàng XYZ" },
  { field: "contactName", header: "Người liên hệ", example: "Trần Thị B" },
  { field: "contactEmail", header: "Email", example: "b@xyz.com" },
  { field: "contactPhone", header: "Điện thoại", example: "0911111111" },
  { field: "address", header: "Địa chỉ", example: "TP. Hồ Chí Minh" },
  { field: "country", header: "Quốc gia", example: "VN" },
  { field: "isActive", header: "Kích hoạt", type: "boolean", example: true },
  { field: "notes", header: "Ghi chú", example: "" },
];

/** Chuyển kết quả server {inserted,updated,failed,errors} → tổng kết cho ImportExportBar. */
function toImportSummary(res: { inserted: number; updated: number; failed: number; errors: Array<{ row: number; message: string }> }): ImportResultSummary {
  return { inserted: res.inserted + res.updated, failed: res.failed, errors: res.errors };
}

export default function MasterDataManagement() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("masterdata", "canView");
  const search = useSearch();
  const [, setLocation] = useLocation();
  // doc 36 W2 — deep-linkable tabs from the app menu (was uncontrolled defaultValue).
  const initialTab = (() => {
    const q = new URLSearchParams(search).get("tab");
    return q && (MASTER_DATA_TABS as readonly string[]).includes(q) ? q : "suppliers";
  })();
  const [tab, setTab] = useState(initialTab);
  const handleTabChange = (v: string) => {
    setTab(v);
    setLocation(`/master-data?tab=${v}`, { replace: true });
  };
  // React to ?tab= changes while already mounted (e.g. sidebar deep-links).
  // Only switch to a KNOWN tab; ignore unknown/invalid params so the page never blanks.
  useEffect(() => {
    const q = new URLSearchParams(search).get("tab");
    if (q && (MASTER_DATA_TABS as readonly string[]).includes(q) && q !== tab) {
      setTab(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (!canView) {
    return (
      <DashboardLayout title={t("masterData.title")} navItems={navItems} currentPath="/master-data">
        <PageContainer>
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("masterData.noPermission")}
            </CardContent>
          </Card>
        </PageContainer>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("masterData.title")} navItems={navItems} currentPath="/master-data">
      <PageContainer>
        <PageHeader
          icon={<Database className="h-6 w-6" />}
          title={t("masterData.title")}
          description={t("masterData.subtitle")}
          badge={<ViewOnlyBadge module="masterdata" />}
          actions={<Badge variant="outline">MES/MOM</Badge>}
        />
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="suppliers">{t("masterData.tabs.suppliers")}</TabsTrigger>
            <TabsTrigger value="materials">{t("masterData.tabs.materials")}</TabsTrigger>
            <TabsTrigger value="materialClasses">{t("masterData.tabs.materialClasses")}</TabsTrigger>
            <TabsTrigger value="customers">{t("masterData.tabs.customers")}</TabsTrigger>
            <TabsTrigger value="skills">{t("masterData.tabs.skills")}</TabsTrigger>
            <TabsTrigger value="certifications">{t("masterData.tabs.certifications")}</TabsTrigger>
            <TabsTrigger value="tools">{t("masterData.tabs.tools")}</TabsTrigger>
            <TabsTrigger value="uom">{t("masterData.tabs.uom")}</TabsTrigger>
            <TabsTrigger value="calendar">{t("masterData.tabs.calendar")}</TabsTrigger>
            <TabsTrigger value="inventory">{t("masterData.tabs.inventory")}</TabsTrigger>
          </TabsList>
          <TabsContent value="suppliers"><SuppliersPanel /></TabsContent>
          <TabsContent value="materials"><MaterialsPanel /></TabsContent>
          <TabsContent value="materialClasses"><MaterialClassesPanel /></TabsContent>
          <TabsContent value="customers"><CustomersPanel /></TabsContent>
          <TabsContent value="skills"><SkillsPanel /></TabsContent>
          <TabsContent value="certifications"><CertificationsPanel /></TabsContent>
          <TabsContent value="tools"><ToolsPanel /></TabsContent>
          <TabsContent value="uom"><UomPanel /></TabsContent>
          <TabsContent value="calendar"><CalendarPanel /></TabsContent>
          <TabsContent value="inventory"><InventoryPanel /></TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}

// ─── Reusable create/edit dialog ────────────────────────────────────────────
function EntityDialog({
  title, fields, initial, onSubmit, trigger, isEdit, open: openProp, onOpenChange,
}: {
  title: string;
  fields: Field[];
  initial?: Record<string, any>;
  onSubmit: (values: Record<string, any>) => Promise<void> | void;
  trigger?: React.ReactNode;
  /** Edit mode: the "code" field is locked (backend ignores code on update). */
  isEdit?: boolean;
  /** Controlled open (doc 42 Đợt 2) — cho phép mở dialog tạo từ CTA empty-state. */
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [vals, setVals] = useState<Record<string, any>>(initial ?? {});

  // Nạp lại giá trị ban đầu mỗi lần dialog mở (kể cả khi mở qua controlled prop).
  useEffect(() => {
    if (open) setVals(initial ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isLocked = (f: Field) => !!isEdit && f.key === "code";

  const submit = async () => {
    // Only send the keys declared in `fields` (never the whole DB row);
    // normalise null/"" → undefined and coerce numbers before mutating.
    const payload: Record<string, any> = {};
    for (const f of fields) {
      if (isLocked(f)) continue;
      let val = vals[f.key];
      if (val === null || val === "") val = undefined;
      if (val !== undefined && f.type === "number") val = Number(val);
      if (f.required && (val === undefined || (f.type === "number" && Number.isNaN(val)))) {
        toast.error(t("masterData.fieldRequired", { field: f.label }));
        return;
      }
      if (f.type === "email" && val !== undefined && !EMAIL_RE.test(String(val))) {
        toast.error(t("masterData.invalidEmail", { defaultValue: `${f.label}: email không hợp lệ` }));
        return;
      }
      if (val !== undefined) payload[f.key] = val;
    }
    try {
      await onSubmit(payload);
      setOpen(false);
    } catch (e: any) {
      toastTrpcError(e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setVals(initial ?? {}); }}>
      {trigger != null && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          {fields.map((f) => (
            <div key={f.key} className="grid gap-1">
              <Label>{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
              {f.type === "bool" ? (
                <Switch
                  checked={!!vals[f.key]}
                  onCheckedChange={(c) => setVals((v) => ({ ...v, [f.key]: c }))}
                />
              ) : f.type === "select" ? (
                <Select
                  value={vals[f.key] ?? "__none__"}
                  onValueChange={(val) =>
                    setVals((v) => ({ ...v, [f.key]: val === "__none__" ? undefined : val }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="--" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">--</SelectItem>
                    {(f.options ?? []).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === "entity" ? (
                <EntityPicker
                  options={f.entityOptions ?? []}
                  loading={f.entityLoading}
                  value={vals[f.key] ?? null}
                  onChange={(val) =>
                    setVals((v) => ({ ...v, [f.key]: val === null ? undefined : val }))
                  }
                  disabled={isLocked(f)}
                  placeholder={t("masterData.selectPlaceholder", { defaultValue: "-- Chọn --" })}
                  searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
                  emptyText={t("masterData.empty")}
                />
              ) : (
                <Input
                  type={f.type === "number" ? "number" : f.type === "email" ? "email" : "text"}
                  disabled={isLocked(f)}
                  value={vals[f.key] ?? ""}
                  onChange={(e) => setVals((v) => ({
                    ...v,
                    [f.key]: f.type === "number"
                      ? (e.target.value === "" ? undefined : Number(e.target.value))
                      : e.target.value,
                  }))}
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("masterData.cancel")}</Button>
          <Button onClick={submit}>{t("masterData.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      status={active ? "active" : "inactive"}
      tone={active ? "success" : "default"}
      label={active ? t("masterData.active") : t("masterData.inactive")}
    />
  );
}

// Doc 42 Đợt 1 — nút xoá kèm xác nhận thống nhất (thay nút thùng-rác 1-click).
// Không tự toast: mutation onError:(e)=>toastTrpcError(e) đã lo phần thông báo.
function DeleteButton({
  label, onConfirm, referenceCount, referenceLabel,
}: {
  label: string;
  onConfirm: () => Promise<void>;
  referenceCount?: number;
  referenceLabel?: string;
}) {
  return (
    <ConfirmDeleteDialog
      trigger={<Button size="sm" variant="ghost"><Trash2 className="h-4 w-4" /></Button>}
      itemLabel={label}
      referenceCount={referenceCount}
      referenceLabel={referenceLabel}
      onConfirm={onConfirm}
    />
  );
}

// ─── doc 42 Đợt 4C J1 — mass-actions + nhân bản (bulk + clone) ────────────────
/** Toast tổng kết cho mass-action {deleted|updated, failed}. */
function bulkResultToast(
  res: { deleted?: number; updated?: number; failed: number },
  t: ReturnType<typeof useTranslation>["t"],
) {
  const ok = res.deleted ?? res.updated ?? 0;
  if (res.failed > 0) {
    toast.warning(t("masterData.bulkPartial", { defaultValue: "Hoàn tất {{ok}}, lỗi {{failed}}", ok, failed: res.failed }));
  } else {
    toast.success(t("masterData.bulkDone", { defaultValue: "Đã xử lý {{ok}} mục", ok }));
  }
}

/** Thanh hành động hàng loạt — chỉ hiện khi có dòng được chọn. Xoá / Bật / Tắt / Bỏ chọn. */
function BulkActionBar({
  count, entityLabel, canDelete, canEdit, onDelete, onSetActive, onClear,
}: {
  count: number;
  entityLabel: string;
  canDelete: boolean;
  canEdit: boolean;
  onDelete: () => Promise<void>;
  onSetActive: (active: boolean) => Promise<void>;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">
        {t("masterData.bulkSelected", { defaultValue: "Đã chọn {{count}}", count })}
      </span>
      <div className="flex-1" />
      {canEdit && (
        <>
          <Button size="sm" variant="outline" onClick={() => onSetActive(true)}>
            <Check className="mr-1 h-4 w-4" /> {t("masterData.bulkActivate", { defaultValue: "Bật hoạt động" })}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onSetActive(false)}>
            <XIcon className="mr-1 h-4 w-4" /> {t("masterData.bulkDeactivate", { defaultValue: "Tắt hoạt động" })}
          </Button>
        </>
      )}
      {canDelete && (
        <ConfirmDeleteDialog
          trigger={<Button size="sm" variant="destructive"><Trash2 className="mr-1 h-4 w-4" /> {t("masterData.bulkDelete", { defaultValue: "Xoá đã chọn" })}</Button>}
          itemLabel={`${count} ${entityLabel}`}
          onConfirm={onDelete}
        />
      )}
      <Button size="sm" variant="ghost" onClick={onClear}>
        {t("masterData.bulkClear", { defaultValue: "Bỏ chọn" })}
      </Button>
    </div>
  );
}

/** Nút "Nhân bản" 1 dòng (icon Copy) — gọi onClone để mở dialog tạo prefill. */
function CloneButton({ onClone }: { onClone: () => void }) {
  const { t } = useTranslation();
  const label = t("masterData.clone", { defaultValue: "Nhân bản" });
  return (
    <Button size="sm" variant="ghost" onClick={onClone} title={label} aria-label={label}>
      <Copy className="h-4 w-4" />
    </Button>
  );
}

/** State + handler cho luồng nhân bản: prefill mã "<code>_COPY" từ bản ghi nguồn. */
function useClone() {
  const [cloneInitial, setCloneInitial] = useState<Record<string, any> | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const startClone = (r: any) => {
    setCloneInitial({ ...r, code: `${r.code ?? ""}_COPY` });
    setCloneOpen(true);
  };
  return { cloneInitial, cloneOpen, setCloneOpen, startClone };
}

// ─── doc 42 Đợt 2 — helper format + primitive dựng cột/bảng ──────────────────
/** Số → định dạng vi-VN (1.234,5). Trả "-" khi rỗng. */
function fmtNum(v: any): string {
  if (v == null || v === "") return "-";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isNaN(n) ? String(v) : n.toLocaleString("vi-VN");
}
/** Ngày → dd/MM/yyyy (không lệch múi giờ với chuỗi date-only). Trả "-" khi rỗng. */
function fmtDate(v: any): string {
  if (v == null || v === "") return "-";
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("vi-VN");
}
/** Giờ:phút (0-23,0-59) → "HH:mm". doc 42 T9 — hiển thị khung giờ ca. */
function fmtHM(h: any, m: any): string {
  const hh = String(Number(h ?? 0)).padStart(2, "0");
  const mm = String(Number(m ?? 0)).padStart(2, "0");
  return `${hh}:${mm}`;
}

// ── doc 42 Đợt 4B H1 — trạng thái hiệu lực chứng chỉ (cảnh báo hết hạn) ────────
const CERT_EXPIRY_SOON_MS = 30 * 24 * 60 * 60 * 1000; // ≤30 ngày = sắp hết hạn
/** none (không hạn) | ok | soon (≤30 ngày) | expired (đã quá hạn). */
function certExpiryStatus(expiresAt: any): "none" | "ok" | "soon" | "expired" {
  if (expiresAt == null || expiresAt === "") return "none";
  const d = new Date(String(expiresAt));
  if (Number.isNaN(d.getTime())) return "none";
  const ms = d.getTime() - Date.now();
  if (ms < 0) return "expired";
  if (ms <= CERT_EXPIRY_SOON_MS) return "soon";
  return "ok";
}
/** Ngày hết hạn + badge cảnh báo: đỏ khi đã hết hạn, hổ phách khi ≤30 ngày. */
function ExpiryBadge({ expiresAt }: { expiresAt: any }) {
  const { t } = useTranslation();
  const status = certExpiryStatus(expiresAt);
  if (status === "none") return <span className="text-muted-foreground">-</span>;
  const label = fmtDate(expiresAt);
  if (status === "expired") {
    return <StatusBadge status="expired" tone="error" label={`${label} · ${t("masterData.certExpired", { defaultValue: "Hết hạn" })}`} />;
  }
  if (status === "soon") {
    return <StatusBadge status="soon" tone="warning" label={`${label} · ${t("masterData.certExpiringSoon", { defaultValue: "Sắp hết hạn" })}`} />;
  }
  return <span>{label}</span>;
}

/** KPI 1 dòng: tổng bản ghi + (tuỳ chọn) số đang hoạt động. */
function ListStats({ rows, hasActive = true }: { rows: any[]; hasActive?: boolean }) {
  const { t } = useTranslation();
  const active = hasActive ? rows.filter((r) => r?.isActive).length : 0;
  return (
    <StatChipRow>
      <StatChip label={t("masterData.total", "Tổng")} value={fmtNum(rows.length)} />
      {hasActive && (
        <StatChip label={t("masterData.active")} value={fmtNum(active)} tone="success" />
      )}
    </StatChipRow>
  );
}

/** Empty-state có CTA "Thêm …" mở dialog tạo (chỉ khi có quyền). */
function EmptyCreate({
  title, description, canCreate, ctaLabel, onCreate,
}: {
  title: string;
  description: string;
  canCreate: boolean;
  ctaLabel: string;
  onCreate: () => void;
}) {
  return (
    <EmptyState
      variant="no-data"
      title={title}
      description={description}
      actionLabel={canCreate ? ctaLabel : undefined}
      onAction={canCreate ? onCreate : undefined}
    />
  );
}

// ─── Suppliers ──────────────────────────────────────────────────────────────
function SuppliersPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.suppliers.list.useQuery({});
  const usage = trpc.masterData.suppliers.usageCounts.useQuery(undefined, { enabled: canDelete });
  const utils = trpc.useUtils();
  const refresh = () => { utils.masterData.suppliers.list.invalidate(); utils.masterData.suppliers.usageCounts.invalidate(); };
  const create = trpc.masterData.suppliers.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.suppliers.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.suppliers.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });
  // doc 42 Đợt 4A #1 — nhập hàng loạt NCC (upsert theo code). onImport chỉ hiện khi canCreate.
  const importMut = trpc.masterData.suppliers.importRows.useMutation();
  const handleImport = async (rows: Array<Record<string, unknown>>): Promise<ImportResultSummary> => {
    const res = await importMut.mutateAsync({ rows });
    refresh();
    return toImportSummary(res);
  };
  // doc 42 Đợt 4C J1 — mass-actions (xoá / bật-tắt hàng loạt) + nhân bản.
  const bulkDel = trpc.masterData.suppliers.bulkDelete.useMutation();
  const bulkActive = trpc.masterData.suppliers.bulkSetActive.useMutation();
  const [selectedIds, setSelectedIds] = useState<Array<string | number>>([]);
  const { cloneInitial, cloneOpen, setCloneOpen, startClone } = useClone();
  const handleBulkDelete = async () => {
    try {
      const res = await bulkDel.mutateAsync({ ids: selectedIds.map(Number) });
      bulkResultToast(res, t); setSelectedIds([]); refresh();
    } catch (e) { toastTrpcError(e); throw e; } // rethrow → ConfirmDeleteDialog giữ mở khi lỗi
  };
  const handleBulkSetActive = async (isActive: boolean) => {
    try {
      const res = await bulkActive.mutateAsync({ ids: selectedIds.map(Number), isActive });
      bulkResultToast(res, t); setSelectedIds([]); refresh();
    } catch (e) { toastTrpcError(e); }
  };
  const [createOpen, setCreateOpen] = useState(false);

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "type", label: t("masterData.type"), type: "select", options: SUPPLIER_TYPE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })) },
    { key: "contactName", label: t("masterData.contact") },
    { key: "contactEmail", label: t("masterData.email"), type: "email" },
    { key: "contactPhone", label: t("masterData.phone", { defaultValue: "Điện thoại" }) },
    { key: "address", label: t("masterData.address", { defaultValue: "Địa chỉ" }) },
    { key: "country", label: t("masterData.country") },
    { key: "rating", label: t("masterData.rating"), type: "number" },
    { key: "approvalStatus", label: t("masterData.approval"), type: "select", options: APPROVAL_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })) },
    { key: "corporateCode", label: t("masterData.corporateCode", { defaultValue: "Mã tập đoàn" }) },
    { key: "factoryCode", label: t("masterData.factoryCode") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
    { key: "notes", label: t("masterData.notes") },
  ];

  const rows = (list.data ?? []) as any[];
  // doc 42 Đợt 4A #3 — đổi Phê duyệt ngay trong bảng (gate canEdit; admin luôn qua).
  const setApproval = async (r: any, val: string) => {
    try { await update.mutateAsync({ id: r.id, approvalStatus: val } as any); }
    catch (e) { toastTrpcError(e); }
  };
  const columns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), cell: (r) => <span className="font-mono">{r.code}</span>, sortValue: (r) => r.code, filterValue: (r) => r.code ?? "" },
    { id: "name", header: t("masterData.name"), cell: (r) => r.name, sortValue: (r) => r.name, filterValue: (r) => r.name ?? "" },
    { id: "type", header: t("masterData.type"), cell: (r) => (SUPPLIER_TYPE_LABELS[r.type] ? t(SUPPLIER_TYPE_LABELS[r.type]) : r.type ?? "-"), sortValue: (r) => r.type, filterValue: (r) => (SUPPLIER_TYPE_LABELS[r.type] ? t(SUPPLIER_TYPE_LABELS[r.type]) : r.type ?? "") },
    {
      id: "approval", header: t("masterData.approval"), sortValue: (r) => r.approvalStatus,
      cell: (r) => canEdit ? (
        <Select value={r.approvalStatus ?? "pending"} onValueChange={(val) => setApproval(r, val)}>
          <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {APPROVAL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <StatusBadge status={String(r.approvalStatus ?? "")} tone={APPROVAL_TONE[r.approvalStatus] ?? "default"} label={APPROVAL_LABELS[r.approvalStatus] ? t(APPROVAL_LABELS[r.approvalStatus]) : r.approvalStatus} />
      ),
    },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "128px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canCreate && <CloneButton onClone={() => startClone(r)} />}
          {canEdit && (
            <EntityDialog
              title={t("masterData.editSupplier")} isEdit fields={fields} initial={r}
              onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.tabs.suppliers")} ${r.code}`}
              referenceCount={usage.data?.[r.code]}
              referenceLabel={t("masterData.tabs.materials")}
              onConfirm={async () => { await del.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newSupplier")} fields={fields} initial={{ isActive: true }}
          open={createOpen} onOpenChange={setCreateOpen}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
        />
      )}
      {canCreate && cloneInitial && (
        <EntityDialog
          title={t("masterData.cloneSupplier", { defaultValue: "Nhân bản nhà cung cấp" })}
          fields={fields} initial={cloneInitial}
          open={cloneOpen} onOpenChange={setCloneOpen}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
        />
      )}
      {!list.isLoading && <ListStats rows={rows} />}
      <BulkActionBar
        count={selectedIds.length} entityLabel={t("masterData.tabs.suppliers")}
        canDelete={canDelete} canEdit={canEdit}
        onDelete={handleBulkDelete} onSetActive={handleBulkSetActive} onClear={() => setSelectedIds([])}
      />
      <DataTable
        columns={columns} data={rows} getRowId={(r) => r.id}
        selectable={canDelete || canEdit} selectedIds={selectedIds} onSelectionChange={setSelectedIds}
        loading={list.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
        initialSort={{ columnId: "code", dir: "asc" }}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {canCreate && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newSupplier")}</Button>
            )}
            <ImportExportBar columns={SUPPLIER_IO_COLUMNS} data={rows} entityLabel={t("masterData.tabs.suppliers")} onImport={canCreate ? handleImport : undefined} />
          </div>
        }
        emptyState={<EmptyCreate title={t("masterData.newSupplier")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newSupplier")} onCreate={() => setCreateOpen(true)} />}
      />
    </CardContent></Card>
  );
}

// ─── Materials ──────────────────────────────────────────────────────────────
function MaterialsPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.materials.list.useQuery({});
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.materials.list.invalidate();
  const create = trpc.masterData.materials.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.materials.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.materials.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });
  // doc 42 Đợt 4A #1 — nhập hàng loạt vật tư (upsert theo code + validate ref).
  const importMut = trpc.masterData.materials.importRows.useMutation();
  const handleImport = async (rows: Array<Record<string, unknown>>): Promise<ImportResultSummary> => {
    const res = await importMut.mutateAsync({ rows });
    refresh();
    return toImportSummary(res);
  };
  // doc 42 Đợt 4C J1 — mass-actions + nhân bản.
  const bulkDel = trpc.masterData.materials.bulkDelete.useMutation();
  const bulkActive = trpc.masterData.materials.bulkSetActive.useMutation();
  const [selectedIds, setSelectedIds] = useState<Array<string | number>>([]);
  const { cloneInitial, cloneOpen, setCloneOpen, startClone } = useClone();
  const handleBulkDelete = async () => {
    try {
      const res = await bulkDel.mutateAsync({ ids: selectedIds.map(Number) });
      bulkResultToast(res, t); setSelectedIds([]); refresh();
    } catch (e) { toastTrpcError(e); throw e; } // rethrow → ConfirmDeleteDialog giữ mở khi lỗi
  };
  const handleBulkSetActive = async (isActive: boolean) => {
    try {
      const res = await bulkActive.mutateAsync({ ids: selectedIds.map(Number), isActive });
      bulkResultToast(res, t); setSelectedIds([]); refresh();
    } catch (e) { toastTrpcError(e); }
  };
  // doc 42 C4 — quan hệ material↔class↔uom: picker tìm-kiếm thay ô text tự do.
  const classList = trpc.masterData.materials.listClasses.useQuery();
  const uomList = trpc.masterData.uom.list.useQuery({});
  const classOptions = codeNameOptions(classList.data);
  const uomOptions = codeNameOptions(uomList.data);

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "materialClass", label: t("masterData.materialClass"), type: "entity", entityOptions: classOptions, entityLoading: classList.isLoading },
    { key: "mpn", label: t("masterData.mpn") },
    { key: "manufacturer", label: t("masterData.manufacturer") },
    { key: "packageType", label: t("masterData.packageType") },
    { key: "msl", label: t("masterData.msl") },
    { key: "unit", label: t("masterData.unit"), type: "entity", entityOptions: uomOptions, entityLoading: uomList.isLoading },
    { key: "rohs", label: t("masterData.rohs"), type: "bool" },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];

  const [createOpen, setCreateOpen] = useState(false);
  const rows = (list.data ?? []) as any[];
  const columns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), cell: (r) => <span className="font-mono">{r.code}</span>, sortValue: (r) => r.code, filterValue: (r) => r.code ?? "" },
    { id: "name", header: t("masterData.name"), cell: (r) => r.name, sortValue: (r) => r.name, filterValue: (r) => r.name ?? "" },
    { id: "mpn", header: t("masterData.mpn"), cell: (r) => r.mpn ?? "-", sortValue: (r) => r.mpn, filterValue: (r) => r.mpn ?? "" },
    { id: "packageType", header: t("masterData.packageType"), cell: (r) => r.packageType ?? "-", sortValue: (r) => r.packageType, filterValue: (r) => r.packageType ?? "" },
    {
      id: "rohs", header: "RoHS", align: "center", sortValue: (r) => (r.rohs ? 1 : 0),
      cell: (r) => r.rohs
        ? <Check className="h-4 w-4 text-success" aria-label={t("masterData.active")} />
        : <XIcon className="h-4 w-4 text-muted-foreground" aria-label={t("masterData.inactive")} />,
    },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "128px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canCreate && <CloneButton onClone={() => startClone(r)} />}
          {canEdit && (
            <EntityDialog
              title={t("masterData.editMaterial")} isEdit fields={fields} initial={r}
              onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.tabs.materials")} ${r.code}`}
              onConfirm={async () => { await del.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newMaterial")} fields={fields} initial={{ isActive: true, rohs: true, unit: "pcs" }}
          open={createOpen} onOpenChange={setCreateOpen}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
        />
      )}
      {canCreate && cloneInitial && (
        <EntityDialog
          title={t("masterData.cloneMaterial", { defaultValue: "Nhân bản vật tư" })}
          fields={fields} initial={cloneInitial}
          open={cloneOpen} onOpenChange={setCloneOpen}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
        />
      )}
      {!list.isLoading && <ListStats rows={rows} />}
      <BulkActionBar
        count={selectedIds.length} entityLabel={t("masterData.tabs.materials")}
        canDelete={canDelete} canEdit={canEdit}
        onDelete={handleBulkDelete} onSetActive={handleBulkSetActive} onClear={() => setSelectedIds([])}
      />
      <DataTable
        columns={columns} data={rows} getRowId={(r) => r.id}
        selectable={canDelete || canEdit} selectedIds={selectedIds} onSelectionChange={setSelectedIds}
        loading={list.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
        initialSort={{ columnId: "code", dir: "asc" }}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {canCreate && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newMaterial")}</Button>
            )}
            <ImportExportBar columns={MATERIAL_IO_COLUMNS} data={rows} entityLabel={t("masterData.tabs.materials")} onImport={canCreate ? handleImport : undefined} />
          </div>
        }
        emptyState={<EmptyCreate title={t("masterData.newMaterial")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newMaterial")} onCreate={() => setCreateOpen(true)} />}
      />
    </CardContent></Card>
  );
}

// ─── Material classes (Nhóm vật tư) ─────────────────────────────────────────
function MaterialClassesPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.materials.listClasses.useQuery();
  const usage = trpc.masterData.materials.classUsageCounts.useQuery(undefined, { enabled: canDelete });
  const utils = trpc.useUtils();
  const refresh = () => { utils.masterData.materials.listClasses.invalidate(); utils.masterData.materials.classUsageCounts.invalidate(); };
  const create = trpc.masterData.materials.createClass.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.materials.updateClass.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.materials.deleteClass.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });
  // doc 42 Đợt 4A #1 — nhập hàng loạt nhóm vật tư (upsert theo code).
  const importMut = trpc.masterData.materials.importClasses.useMutation();
  const handleImport = async (rows: Array<Record<string, unknown>>): Promise<ImportResultSummary> => {
    const res = await importMut.mutateAsync({ rows });
    refresh();
    return toImportSummary(res);
  };
  // doc 42 C4 — nhóm cha chọn từ nhóm vật tư hiện có (tự tham chiếu), không gõ mã rác.
  const classOptions = codeNameOptions(list.data);

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "parentCode", label: t("masterData.parentCode"), type: "entity", entityOptions: classOptions, entityLoading: list.isLoading },
    { key: "description", label: t("masterData.description") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];

  const [createOpen, setCreateOpen] = useState(false);
  const rows = (list.data ?? []) as any[];
  const columns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), cell: (r) => <span className="font-mono">{r.code}</span>, sortValue: (r) => r.code, filterValue: (r) => r.code ?? "" },
    { id: "name", header: t("masterData.name"), cell: (r) => r.name, sortValue: (r) => r.name, filterValue: (r) => r.name ?? "" },
    { id: "parentCode", header: t("masterData.parentCode"), cell: (r) => r.parentCode ?? "-", sortValue: (r) => r.parentCode, filterValue: (r) => r.parentCode ?? "" },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canEdit && (
            <EntityDialog
              title={t("masterData.editMaterialClass")} isEdit fields={fields} initial={r}
              onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.tabs.materialClasses")} ${r.code}`}
              referenceCount={usage.data?.[r.code]}
              referenceLabel={t("masterData.tabs.materials")}
              onConfirm={async () => { await del.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newMaterialClass")} fields={fields} initial={{ isActive: true }}
          open={createOpen} onOpenChange={setCreateOpen}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
        />
      )}
      {!list.isLoading && <ListStats rows={rows} />}
      <DataTable
        columns={columns} data={rows} getRowId={(r) => r.id}
        loading={list.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
        initialSort={{ columnId: "code", dir: "asc" }}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {canCreate && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newMaterialClass")}</Button>
            )}
            <ImportExportBar columns={MATERIAL_CLASS_IO_COLUMNS} data={rows} entityLabel={t("masterData.tabs.materialClasses")} onImport={canCreate ? handleImport : undefined} />
          </div>
        }
        emptyState={<EmptyCreate title={t("masterData.newMaterialClass")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newMaterialClass")} onCreate={() => setCreateOpen(true)} />}
      />
    </CardContent></Card>
  );
}

// ─── Customers ──────────────────────────────────────────────────────────────
function CustomersPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.customers.list.useQuery({});
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.customers.list.invalidate();
  const create = trpc.masterData.customers.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.customers.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.customers.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });
  // doc 42 Đợt 4A #1 — nhập hàng loạt khách hàng (upsert theo code).
  const importMut = trpc.masterData.customers.importRows.useMutation();
  const handleImport = async (rows: Array<Record<string, unknown>>): Promise<ImportResultSummary> => {
    const res = await importMut.mutateAsync({ rows });
    refresh();
    return toImportSummary(res);
  };
  // doc 42 Đợt 4C J1 — mass-actions (xoá / bật-tắt hàng loạt).
  const bulkDel = trpc.masterData.customers.bulkDelete.useMutation();
  const bulkActive = trpc.masterData.customers.bulkSetActive.useMutation();
  const [selectedIds, setSelectedIds] = useState<Array<string | number>>([]);
  const handleBulkDelete = async () => {
    try {
      const res = await bulkDel.mutateAsync({ ids: selectedIds.map(Number) });
      bulkResultToast(res, t); setSelectedIds([]); refresh();
    } catch (e) { toastTrpcError(e); throw e; } // rethrow → ConfirmDeleteDialog giữ mở khi lỗi
  };
  const handleBulkSetActive = async (isActive: boolean) => {
    try {
      const res = await bulkActive.mutateAsync({ ids: selectedIds.map(Number), isActive });
      bulkResultToast(res, t); setSelectedIds([]); refresh();
    } catch (e) { toastTrpcError(e); }
  };

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "contactName", label: t("masterData.contact") },
    { key: "contactEmail", label: t("masterData.email"), type: "email" },
    { key: "contactPhone", label: t("masterData.phone", { defaultValue: "Điện thoại" }) },
    { key: "address", label: t("masterData.address", { defaultValue: "Địa chỉ" }) },
    { key: "country", label: t("masterData.country") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
    { key: "notes", label: t("masterData.notes") },
  ];

  const [createOpen, setCreateOpen] = useState(false);
  const rows = (list.data ?? []) as any[];
  const columns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), cell: (r) => <span className="font-mono">{r.code}</span>, sortValue: (r) => r.code, filterValue: (r) => r.code ?? "" },
    { id: "name", header: t("masterData.name"), cell: (r) => r.name, sortValue: (r) => r.name, filterValue: (r) => r.name ?? "" },
    { id: "country", header: t("masterData.country"), cell: (r) => r.country ?? "-", sortValue: (r) => r.country, filterValue: (r) => r.country ?? "" },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canEdit && (
            <EntityDialog
              title={t("masterData.editCustomer")} isEdit fields={fields} initial={r}
              onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.tabs.customers")} ${r.code}`}
              onConfirm={async () => { await del.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newCustomer")} fields={fields} initial={{ isActive: true }}
          open={createOpen} onOpenChange={setCreateOpen}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
        />
      )}
      {!list.isLoading && <ListStats rows={rows} />}
      <BulkActionBar
        count={selectedIds.length} entityLabel={t("masterData.tabs.customers")}
        canDelete={canDelete} canEdit={canEdit}
        onDelete={handleBulkDelete} onSetActive={handleBulkSetActive} onClear={() => setSelectedIds([])}
      />
      <DataTable
        columns={columns} data={rows} getRowId={(r) => r.id}
        selectable={canDelete || canEdit} selectedIds={selectedIds} onSelectionChange={setSelectedIds}
        loading={list.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
        initialSort={{ columnId: "code", dir: "asc" }}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {canCreate && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newCustomer")}</Button>
            )}
            <ImportExportBar columns={CUSTOMER_IO_COLUMNS} data={rows} entityLabel={t("masterData.tabs.customers")} onImport={canCreate ? handleImport : undefined} />
          </div>
        }
        emptyState={<EmptyCreate title={t("masterData.newCustomer")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newCustomer")} onCreate={() => setCreateOpen(true)} />}
      />
    </CardContent></Card>
  );
}

// ─── Skills ─────────────────────────────────────────────────────────────────
function SkillsPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.skills.list.useQuery({});
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.skills.list.invalidate();
  const create = trpc.masterData.skills.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.skills.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.skills.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "category", label: t("masterData.category") },
    { key: "description", label: t("masterData.description") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];

  const [createOpen, setCreateOpen] = useState(false);
  // doc 42 Đợt 4B H1 — chọn 1 kỹ năng → skill matrix "nhân sự có kỹ năng này".
  const [selectedSkill, setSelectedSkill] = useState<number | undefined>(undefined);
  const rows = (list.data ?? []) as any[];
  const selectedSkillObj = rows.find((r) => r.id === selectedSkill) ?? null;
  const columns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), cell: (r) => <span className="font-mono">{r.code}</span>, sortValue: (r) => r.code, filterValue: (r) => r.code ?? "" },
    { id: "name", header: t("masterData.name"), cell: (r) => r.name, sortValue: (r) => r.name, filterValue: (r) => r.name ?? "" },
    { id: "category", header: t("masterData.category"), cell: (r) => r.category ?? "-", sortValue: (r) => r.category, filterValue: (r) => r.category ?? "" },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <EntityDialog
              title={t("masterData.editSkill")} isEdit fields={fields} initial={r}
              onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.tabs.skills")} ${r.code}`}
              onConfirm={async () => { await del.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-3 pt-4">
        {canCreate && (
          <EntityDialog
            title={t("masterData.newSkill")} fields={fields} initial={{ isActive: true }}
            open={createOpen} onOpenChange={setCreateOpen}
            onSubmit={async (v) => { await create.mutateAsync(v as any); }}
          />
        )}
        {!list.isLoading && <ListStats rows={rows} />}
        <DataTable
          columns={columns} data={rows} getRowId={(r) => r.id}
          loading={list.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
          initialSort={{ columnId: "code", dir: "asc" }}
          onRowClick={(r) => setSelectedSkill(r.id)}
          toolbar={canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newSkill")}</Button>
          ) : undefined}
          emptyState={<EmptyCreate title={t("masterData.newSkill")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newSkill")} onCreate={() => setCreateOpen(true)} />}
        />
      </CardContent></Card>

      <SkillMatrixCard skill={selectedSkillObj} />
    </div>
  );
}

// ─── Skill matrix: nhân sự có kỹ năng (doc 42 Đợt 4B H1) ─────────────────────
/** Dialog gán nhân sự cho 1 kỹ năng: UserSelect + cấp độ + ngày hết hạn. */
function AssignPersonDialog({
  skillLabel, onAssign,
}: {
  skillLabel: string;
  onAssign: (v: { userId: number; level: string; expiresAt: string | null; notes?: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [level, setLevel] = useState<string>("trainee");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const levels = ["trainee", "qualified", "expert", "trainer"];
  const reset = () => { setUserId(null); setLevel("trainee"); setExpiresAt(""); setNotes(""); };

  const submit = async () => {
    if (userId == null) { toast.error(t("masterData.fieldRequired", { field: t("masterData.user") })); return; }
    try {
      await onAssign({
        userId,
        level,
        expiresAt: expiresAt ? new Date(`${expiresAt}T00:00:00`).toISOString() : null,
        notes: notes || undefined,
      });
      setOpen(false);
      reset();
    } catch (e: any) {
      toastTrpcError(e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><UserPlus className="mr-1 h-4 w-4" /> {t("masterData.assignPerson", { defaultValue: "Gán nhân sự" })}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("masterData.assignPersonTo", { defaultValue: "Gán nhân sự — {{skill}}", skill: skillLabel })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label>{t("masterData.user")}<span className="text-destructive"> *</span></Label>
            <UserSelect
              value={userId}
              onChange={(v) => setUserId(v == null ? null : Number(v))}
              placeholder={t("masterData.selectPlaceholder", { defaultValue: "-- Chọn --" })}
            />
          </div>
          <div className="grid gap-1">
            <Label>{t("masterData.level")}</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {levels.map((l) => <SelectItem key={l} value={l}>{t(`masterData.certLevels.${l}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{t("masterData.expiresAt")}</Label>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("masterData.notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("masterData.cancel")}</Button>
          <Button onClick={submit}>{t("masterData.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bảng "nhân sự có kỹ năng này" cho kỹ năng đang chọn (skill matrix + cảnh báo hết hạn). */
function SkillMatrixCard({ skill }: { skill: { id: number; code: string; name: string } | null }) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.userCertifications.list.useQuery(
    { skillId: skill?.id },
    { enabled: skill != null },
  );
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.userCertifications.list.invalidate();
  const assign = trpc.masterData.userCertifications.assign.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const revoke = trpc.masterData.userCertifications.revoke.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });

  const rows = (list.data ?? []) as any[];
  const skillLabel = skill ? `${skill.code} · ${skill.name}` : "";
  const personLabel = (r: any) => r.userName ?? r.userUsername ?? `#${r.userId}`;

  const columns: DataTableColumn<any>[] = [
    { id: "user", header: t("masterData.user"), cell: (r) => personLabel(r), sortValue: (r) => personLabel(r), filterValue: (r) => personLabel(r) },
    { id: "level", header: t("masterData.level"), cell: (r) => <Badge variant="secondary">{t(`masterData.certLevels.${r.level}`)}</Badge>, sortValue: (r) => r.level },
    { id: "expiresAt", header: t("masterData.expiresAt"), cell: (r) => <ExpiryBadge expiresAt={r.expiresAt} />, sortValue: (r) => (r.expiresAt ? String(r.expiresAt) : undefined) },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "64px",
      cell: (r) => canDelete ? (
        <div className="flex justify-end gap-1">
          <DeleteButton
            label={`${personLabel(r)} — ${skillLabel}`}
            onConfirm={async () => { await revoke.mutateAsync({ id: r.id }); }}
          />
        </div>
      ) : null,
    },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      <h3 className="text-sm font-semibold">
        {t("masterData.skillHolders", { defaultValue: "Nhân sự có kỹ năng này" })}
        {skill == null ? ` — ${t("masterData.selectSkill", { defaultValue: "Chọn một kỹ năng" })}` : ` — ${skillLabel}`}
      </h3>
      {skill != null && (
        <DataTable
          columns={columns} data={rows} getRowId={(r) => r.id}
          loading={list.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
          toolbar={canCreate ? (
            <AssignPersonDialog
              skillLabel={skillLabel}
              onAssign={async (v) => { await assign.mutateAsync({ skillId: skill.id, ...v } as any); }}
            />
          ) : undefined}
          emptyState={<EmptyState variant="no-data" title={t("masterData.skillHolders", { defaultValue: "Nhân sự có kỹ năng này" })} description={t("masterData.noSkillHolders", { defaultValue: "Chưa gán nhân sự nào cho kỹ năng này." })} />}
        />
      )}
    </CardContent></Card>
  );
}

// ─── User certifications (Chứng chỉ — user × skill) ─────────────────────────
function CertificationsPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.skills.listCertifications.useQuery({});
  // Pickers reuse existing lists; user.list is admin-only → fail-safe to [].
  const users = trpc.user.list.useQuery(undefined, { retry: false });
  const skillsList = trpc.masterData.skills.list.useQuery({});
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.skills.listCertifications.invalidate();
  const grant = trpc.masterData.skills.grantCertification.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.skills.updateCertification.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const revoke = trpc.masterData.skills.revokeCertification.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });

  const levels = ["trainee", "qualified", "expert", "trainer"];
  const userOpts = (users.data ?? []).map((u: any) => ({ value: String(u.id), label: u.name ? `${u.name} (${u.username ?? u.id})` : (u.username ?? String(u.id)) }));
  const skillOpts = (skillsList.data ?? []).map((s: any) => ({ value: String(s.id), label: `${s.code} — ${s.name}` }));
  const userName = (id: number) => { const u = (users.data ?? []).find((x: any) => x.id === id); return u ? (u.name ?? u.username ?? String(id)) : String(id); };
  const skillName = (id: number) => { const s = (skillsList.data ?? []).find((x: any) => x.id === id); return s ? `${s.code} — ${s.name}` : String(id); };

  const grantFields: Field[] = [
    { key: "userId", label: t("masterData.user"), type: "select", required: true, options: userOpts },
    { key: "skillId", label: t("masterData.skill"), type: "select", required: true, options: skillOpts },
    { key: "level", label: t("masterData.level"), type: "select", options: levels.map((l) => ({ value: l, label: t(`masterData.certLevels.${l}`) })) },
    { key: "expiresAt", label: t("masterData.expiresAt") },
    { key: "notes", label: t("masterData.notes") },
  ];
  // Edit: user/skill are the unique key → editable level/expiry/active/notes only.
  const editFields: Field[] = [
    { key: "level", label: t("masterData.level"), type: "select", options: levels.map((l) => ({ value: l, label: t(`masterData.certLevels.${l}`) })) },
    { key: "expiresAt", label: t("masterData.expiresAt") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
    { key: "notes", label: t("masterData.notes") },
  ];

  // userId/skillId from <select> arrive as strings; level expiresAt need normalising.
  const normGrant = (v: Record<string, any>) => ({
    userId: Number(v.userId),
    skillId: Number(v.skillId),
    ...(v.level ? { level: v.level } : {}),
    ...(v.expiresAt ? { expiresAt: new Date(v.expiresAt).toISOString() } : {}),
    ...(v.notes ? { notes: v.notes } : {}),
  });
  const normEdit = (v: Record<string, any>) => ({
    ...(v.level ? { level: v.level } : {}),
    ...(v.isActive !== undefined ? { isActive: !!v.isActive } : {}),
    expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null,
    ...(v.notes !== undefined ? { notes: v.notes } : {}),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const rows = (list.data ?? []) as any[];
  const columns: DataTableColumn<any>[] = [
    { id: "user", header: t("masterData.user"), cell: (r) => userName(r.userId), sortValue: (r) => userName(r.userId), filterValue: (r) => userName(r.userId) },
    { id: "skill", header: t("masterData.skill"), cell: (r) => skillName(r.skillId), sortValue: (r) => skillName(r.skillId), filterValue: (r) => skillName(r.skillId) },
    { id: "level", header: t("masterData.level"), cell: (r) => <Badge variant="secondary">{t(`masterData.certLevels.${r.level}`)}</Badge>, sortValue: (r) => r.level },
    { id: "expiresAt", header: t("masterData.expiresAt"), cell: (r) => fmtDate(r.expiresAt), sortValue: (r) => (r.expiresAt ? String(r.expiresAt) : undefined) },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canEdit && (
            <EntityDialog
              title={t("masterData.editCertification")} isEdit fields={editFields}
              initial={{ level: r.level, isActive: r.isActive, expiresAt: r.expiresAt ? String(r.expiresAt).slice(0, 10) : "", notes: r.notes ?? "" }}
              onSubmit={async (v) => { await update.mutateAsync({ ...normEdit(v), id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.tabs.certifications")} — ${skillName(r.skillId)}`}
              onConfirm={async () => { await revoke.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newCertification")} fields={grantFields} initial={{ level: "trainee" }}
          open={createOpen} onOpenChange={setCreateOpen}
          onSubmit={async (v) => { await grant.mutateAsync(normGrant(v) as any); }}
        />
      )}
      {!list.isLoading && <ListStats rows={rows} />}
      <DataTable
        columns={columns} data={rows} getRowId={(r) => r.id}
        loading={list.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
        toolbar={canCreate ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newCertification")}</Button>
        ) : undefined}
        emptyState={<EmptyCreate title={t("masterData.newCertification")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newCertification")} onCreate={() => setCreateOpen(true)} />}
      />
    </CardContent></Card>
  );
}

// ─── Tools ──────────────────────────────────────────────────────────────────
function ToolsPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.tools.list.useQuery({});
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.tools.list.invalidate();
  const create = trpc.masterData.tools.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.tools.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.tools.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });
  // doc 42 Đợt 4C J1 — nhân bản dụng cụ (prefill mã _COPY).
  const { cloneInitial, cloneOpen, setCloneOpen, startClone } = useClone();

  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "machineType", label: t("masterData.machineType") },
    { key: "lifeLimit", label: t("masterData.lifeLimit"), type: "number" },
    { key: "lifeUsed", label: t("masterData.lifeUsed"), type: "number" },
    { key: "location", label: t("masterData.location") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];

  const [createOpen, setCreateOpen] = useState(false);
  const rows = (list.data ?? []) as any[];
  const columns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), cell: (r) => <span className="font-mono">{r.code}</span>, sortValue: (r) => r.code, filterValue: (r) => r.code ?? "" },
    { id: "name", header: t("masterData.name"), cell: (r) => r.name, sortValue: (r) => r.name, filterValue: (r) => r.name ?? "" },
    { id: "type", header: t("masterData.type"), cell: (r) => r.type ?? "-", sortValue: (r) => r.type, filterValue: (r) => r.type ?? "" },
    { id: "status", header: t("masterData.status"), cell: (r) => <StatusBadge status={String(r.status ?? "")} />, sortValue: (r) => r.status },
    { id: "life", header: t("masterData.life"), align: "right", sortValue: (r) => (r.lifeUsed ?? 0), cell: (r) => r.lifeLimit != null ? `${fmtNum(r.lifeUsed)}/${fmtNum(r.lifeLimit)}` : fmtNum(r.lifeUsed ?? 0) },
    {
      id: "actions", header: "", align: "right", width: "128px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canCreate && <CloneButton onClone={() => startClone(r)} />}
          {canEdit && (
            <EntityDialog
              title={t("masterData.editTool")} isEdit fields={fields} initial={r}
              onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.tabs.tools")} ${r.code}`}
              onConfirm={async () => { await del.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <Card><CardContent className="space-y-3 pt-4">
      {canCreate && (
        <EntityDialog
          title={t("masterData.newTool")} fields={fields} initial={{ isActive: true, lifeUsed: 0 }}
          open={createOpen} onOpenChange={setCreateOpen}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
        />
      )}
      {canCreate && cloneInitial && (
        <EntityDialog
          title={t("masterData.cloneTool", { defaultValue: "Nhân bản dụng cụ" })}
          fields={fields} initial={cloneInitial}
          open={cloneOpen} onOpenChange={setCloneOpen}
          onSubmit={async (v) => { await create.mutateAsync(v as any); }}
        />
      )}
      {!list.isLoading && <ListStats rows={rows} />}
      <DataTable
        columns={columns} data={rows} getRowId={(r) => r.id}
        loading={list.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
        initialSort={{ columnId: "code", dir: "asc" }}
        toolbar={canCreate ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newTool")}</Button>
        ) : undefined}
        emptyState={<EmptyCreate title={t("masterData.newTool")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newTool")} onCreate={() => setCreateOpen(true)} />}
      />
    </CardContent></Card>
  );
}

// ─── Units of Measure (+ conversions) ────────────────────────────────────────
function UomPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.uom.list.useQuery({});
  const convList = trpc.masterData.uom.listConversions.useQuery();
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.uom.list.invalidate();
  const refreshConv = () => utils.masterData.uom.listConversions.invalidate();
  const create = trpc.masterData.uom.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.uom.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.uom.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });
  const createConv = trpc.masterData.uom.createConversion.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshConv(); } });
  const updateConv = trpc.masterData.uom.updateConversion.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshConv(); } });
  const delConv = trpc.masterData.uom.deleteConversion.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshConv(); }, onError: (e) => toastTrpcError(e) });

  const dimensions = ["length", "mass", "volume", "time", "temperature", "count", "percent", "other"];
  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "dimension", label: t("masterData.dimension"), type: "select", options: dimensions.map((d) => ({ value: d, label: t(`masterData.dimensions.${d}`) })) },
    { key: "isBase", label: t("masterData.isBase"), type: "bool" },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];
  // doc 42 C4 — quy đổi chọn đơn vị từ danh sách UoM hiện có, không gõ mã không tồn tại.
  const uomOptions = codeNameOptions(list.data);
  const convFields: Field[] = [
    { key: "fromUomCode", label: t("masterData.fromUom"), type: "entity", entityOptions: uomOptions, entityLoading: list.isLoading, required: true },
    { key: "toUomCode", label: t("masterData.toUom"), type: "entity", entityOptions: uomOptions, entityLoading: list.isLoading, required: true },
    { key: "factor", label: t("masterData.factor"), type: "number", required: true },
    { key: "offset", label: t("masterData.offset"), type: "number" },
    { key: "notes", label: t("masterData.notes") },
  ];
  // Edit conversion: from/to codes are the unique key → editable factor/offset/notes only.
  const convEditFields: Field[] = [
    { key: "factor", label: t("masterData.factor"), type: "number", required: true },
    { key: "offset", label: t("masterData.offset"), type: "number" },
    { key: "notes", label: t("masterData.notes") },
  ];

  const [createOpen, setCreateOpen] = useState(false);
  const [convOpen, setConvOpen] = useState(false);
  const rows = (list.data ?? []) as any[];
  const convRows = (convList.data ?? []) as any[];
  const columns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), cell: (r) => <span className="font-mono">{r.code}</span>, sortValue: (r) => r.code, filterValue: (r) => r.code ?? "" },
    { id: "name", header: t("masterData.name"), cell: (r) => r.name, sortValue: (r) => r.name, filterValue: (r) => r.name ?? "" },
    { id: "dimension", header: t("masterData.dimension"), cell: (r) => r.dimension ? t(`masterData.dimensions.${r.dimension}`) : "-", sortValue: (r) => r.dimension, filterValue: (r) => (r.dimension ? t(`masterData.dimensions.${r.dimension}`) : "") },
    {
      id: "isBase", header: t("masterData.isBase"), align: "center", sortValue: (r) => (r.isBase ? 1 : 0),
      cell: (r) => r.isBase
        ? <Check className="h-4 w-4 text-success" aria-label={t("masterData.isBase")} />
        : <span className="text-muted-foreground">-</span>,
    },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canEdit && (
            <EntityDialog
              title={t("masterData.editUom")} isEdit fields={fields} initial={r}
              onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.tabs.uom")} ${r.code}`}
              onConfirm={async () => { await del.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];
  const convColumns: DataTableColumn<any>[] = [
    { id: "from", header: t("masterData.fromUom"), cell: (r) => <span className="font-mono">{r.fromUomCode}</span>, sortValue: (r) => r.fromUomCode, filterValue: (r) => r.fromUomCode ?? "" },
    { id: "to", header: t("masterData.toUom"), cell: (r) => <span className="font-mono">{r.toUomCode}</span>, sortValue: (r) => r.toUomCode, filterValue: (r) => r.toUomCode ?? "" },
    { id: "factor", header: t("masterData.factor"), align: "right", cell: (r) => fmtNum(r.factor), sortValue: (r) => Number(r.factor) },
    { id: "offset", header: t("masterData.offset"), align: "right", cell: (r) => fmtNum(r.offset), sortValue: (r) => Number(r.offset) },
    {
      id: "actions", header: "", align: "right", width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canEdit && (
            <EntityDialog
              title={t("masterData.editConversion")} isEdit fields={convEditFields}
              initial={{ factor: Number(r.factor), offset: r.offset != null ? Number(r.offset) : undefined, notes: r.notes }}
              onSubmit={async (v) => { await updateConv.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.conversion", "quy đổi")} ${r.fromUomCode} → ${r.toUomCode}`}
              onConfirm={async () => { await delConv.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-3 pt-4">
        {canCreate && (
          <EntityDialog
            title={t("masterData.newUom")} fields={fields} initial={{ isActive: true, dimension: "count" }}
            open={createOpen} onOpenChange={setCreateOpen}
            onSubmit={async (v) => { await create.mutateAsync(v as any); }}
          />
        )}
        {!list.isLoading && <ListStats rows={rows} />}
        <DataTable
          columns={columns} data={rows} getRowId={(r) => r.id}
          loading={list.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
          initialSort={{ columnId: "code", dir: "asc" }}
          toolbar={canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newUom")}</Button>
          ) : undefined}
          emptyState={<EmptyCreate title={t("masterData.newUom")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newUom")} onCreate={() => setCreateOpen(true)} />}
        />
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-4">
        <h3 className="text-sm font-semibold">{t("masterData.conversions")}</h3>
        {canCreate && (
          <EntityDialog
            title={t("masterData.newConversion")} fields={convFields} initial={{ offset: 0 }}
            open={convOpen} onOpenChange={setConvOpen}
            onSubmit={async (v) => { await createConv.mutateAsync(v as any); }}
          />
        )}
        <DataTable
          columns={convColumns} data={convRows} getRowId={(r) => r.id}
          loading={convList.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
          toolbar={canCreate ? (
            <Button size="sm" variant="outline" onClick={() => setConvOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newConversion")}</Button>
          ) : undefined}
          emptyState={<EmptyCreate title={t("masterData.newConversion")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newConversion")} onCreate={() => setConvOpen(true)} />}
        />
      </CardContent></Card>
    </div>
  );
}

// ─── Plant / Shift Calendar (+ days) ─────────────────────────────────────────
function CalendarPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const list = trpc.masterData.calendar.list.useQuery({});
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const days = trpc.masterData.calendar.listDays.useQuery({ calendarId: selected! }, { enabled: selected != null });
  // doc 42 T9 — ca làm việc áp dụng cho từng NGÀY lịch (junction calendar_days ↔ shift_configs).
  const [selectedDay, setSelectedDay] = useState<number | undefined>(undefined);
  const [pickShift, setPickShift] = useState<number | null>(null);
  const shiftConfigsQ = trpc.masterData.calendar.listShiftConfigs.useQuery(undefined, { enabled: selectedDay != null });
  const dayShifts = trpc.masterData.calendar.listDayShifts.useQuery({ calendarDayId: selectedDay! }, { enabled: selectedDay != null });
  const utils = trpc.useUtils();
  const refresh = () => utils.masterData.calendar.list.invalidate();
  const refreshDays = () => utils.masterData.calendar.listDays.invalidate();
  const refreshDayShifts = () => utils.masterData.calendar.listDayShifts.invalidate();
  const create = trpc.masterData.calendar.create.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const update = trpc.masterData.calendar.update.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refresh(); } });
  const del = trpc.masterData.calendar.delete.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refresh(); }, onError: (e) => toastTrpcError(e) });
  const createDay = trpc.masterData.calendar.createDay.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshDays(); } });
  const updateDay = trpc.masterData.calendar.updateDay.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshDays(); } });
  const delDay = trpc.masterData.calendar.deleteDay.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshDays(); setSelectedDay(undefined); }, onError: (e) => toastTrpcError(e) });
  const assignShift = trpc.masterData.calendar.assignShift.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); setPickShift(null); refreshDayShifts(); }, onError: (e) => toastTrpcError(e) });
  const unassignShift = trpc.masterData.calendar.unassignShift.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshDayShifts(); }, onError: (e) => toastTrpcError(e) });
  // doc 42 Đợt 4C J1 — nhân bản lịch nhà máy (prefill mã _COPY, người dùng sửa rồi lưu).
  const { cloneInitial, cloneOpen, setCloneOpen, startClone } = useClone();

  const dayTypes = ["working", "holiday", "planned_downtime"];
  const fields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "factoryCode", label: t("masterData.factoryCode") },
    { key: "timezone", label: t("masterData.timezone") },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];
  const dayFields: Field[] = [
    { key: "date", label: t("masterData.date"), required: true },
    { key: "dayType", label: t("masterData.dayType"), type: "select", options: dayTypes.map((d) => ({ value: d, label: t(`masterData.dayTypes.${d}`) })) },
    { key: "notes", label: t("masterData.notes") },
  ];

  const [createOpen, setCreateOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const rows = (list.data ?? []) as any[];
  const dayRows = (days.data ?? []) as any[];
  const selectedCal = rows.find((r) => r.id === selected);
  const columns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), cell: (r) => <span className="font-mono">{r.code}</span>, sortValue: (r) => r.code, filterValue: (r) => r.code ?? "" },
    { id: "name", header: t("masterData.name"), cell: (r) => r.name, sortValue: (r) => r.name, filterValue: (r) => r.name ?? "" },
    { id: "factoryCode", header: t("masterData.factoryCode"), cell: (r) => r.factoryCode ?? "-", sortValue: (r) => r.factoryCode, filterValue: (r) => r.factoryCode ?? "" },
    { id: "timezone", header: t("masterData.timezone"), cell: (r) => r.timezone, sortValue: (r) => r.timezone },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "128px",
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {canCreate && <CloneButton onClone={() => startClone(r)} />}
          {canEdit && (
            <EntityDialog
              title={t("masterData.editCalendar")} isEdit fields={fields} initial={r}
              onSubmit={async (v) => { await update.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.tabs.calendar")} ${r.code}`}
              onConfirm={async () => { await del.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];
  const dayColumns: DataTableColumn<any>[] = [
    { id: "date", header: t("masterData.date"), cell: (r) => fmtDate(r.date), sortValue: (r) => String(r.date ?? ""), filterValue: (r) => fmtDate(r.date) },
    { id: "dayType", header: t("masterData.dayType"), cell: (r) => <Badge variant="secondary">{t(`masterData.dayTypes.${r.dayType}`)}</Badge>, sortValue: (r) => r.dayType, filterValue: (r) => (r.dayType ? t(`masterData.dayTypes.${r.dayType}`) : "") },
    { id: "notes", header: t("masterData.notes"), cell: (r) => r.notes ?? "-", filterValue: (r) => r.notes ?? "" },
    {
      id: "actions", header: "", align: "right", width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <EntityDialog
              title={t("masterData.editDay")} isEdit fields={dayFields} initial={r}
              onSubmit={async (v) => { await updateDay.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.date")} ${fmtDate(r.date)}`}
              onConfirm={async () => { await delDay.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  // doc 42 T9 — dữ liệu + cột cho panel "Ca làm việc áp dụng ngày này".
  const selectedDayRow = dayRows.find((r) => r.id === selectedDay);
  const shiftRows = (dayShifts.data ?? []) as any[];
  const assignedShiftIds = new Set(shiftRows.map((r) => r.shiftConfigId));
  // Lọc bỏ ca đã gán khỏi picker → không gán trùng (unique day+shift đã chặn ở DB).
  const shiftOptions: EntityOption[] = ((shiftConfigsQ.data ?? []) as any[])
    .filter((s) => !assignedShiftIds.has(s.id))
    .map((s) => ({
      value: s.id as number,
      label: s.name,
      sublabel: `${s.code} · ${fmtHM(s.startHour, s.startMinute)}–${fmtHM(s.endHour, s.endMinute)}`,
    }));
  const shiftColumns: DataTableColumn<any>[] = [
    { id: "shiftCode", header: t("masterData.shiftCode", { defaultValue: "Mã ca" }), cell: (r) => <span className="font-mono">{r.shiftCode ?? "-"}</span>, sortValue: (r) => r.shiftCode, filterValue: (r) => r.shiftCode ?? "" },
    { id: "shiftName", header: t("masterData.shiftName", { defaultValue: "Tên ca" }), cell: (r) => r.shiftName ?? "-", sortValue: (r) => r.shiftName, filterValue: (r) => r.shiftName ?? "" },
    { id: "hours", header: t("masterData.shiftHours", { defaultValue: "Giờ làm" }), cell: (r) => <span className="font-mono">{fmtHM(r.startHour, r.startMinute)}–{fmtHM(r.endHour, r.endMinute)}</span>, sortValue: (r) => r.startHour * 60 + r.startMinute },
    {
      id: "actions", header: "", align: "right", width: "64px",
      cell: (r) => canDelete ? (
        <div className="flex justify-end">
          <DeleteButton
            label={`${t("masterData.shift", { defaultValue: "Ca làm việc" })} ${r.shiftCode ?? ""}`}
            onConfirm={async () => { await unassignShift.mutateAsync({ id: r.id }); }}
          />
        </div>
      ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-3 pt-4">
        {canCreate && (
          <EntityDialog
            title={t("masterData.newCalendar")} fields={fields} initial={{ isActive: true, timezone: "Asia/Ho_Chi_Minh" }}
            open={createOpen} onOpenChange={setCreateOpen}
            onSubmit={async (v) => { await create.mutateAsync(v as any); }}
          />
        )}
        {canCreate && cloneInitial && (
          <EntityDialog
            title={t("masterData.cloneCalendar", { defaultValue: "Nhân bản lịch nhà máy" })}
            fields={fields} initial={cloneInitial}
            open={cloneOpen} onOpenChange={setCloneOpen}
            onSubmit={async (v) => { await create.mutateAsync(v as any); }}
          />
        )}
        {!list.isLoading && <ListStats rows={rows} />}
        <DataTable
          columns={columns} data={rows} getRowId={(r) => r.id}
          loading={list.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
          initialSort={{ columnId: "code", dir: "asc" }}
          onRowClick={(r) => { setSelected(r.id); setSelectedDay(undefined); }}
          toolbar={canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newCalendar")}</Button>
          ) : undefined}
          emptyState={<EmptyCreate title={t("masterData.newCalendar")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newCalendar")} onCreate={() => setCreateOpen(true)} />}
        />
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-4">
        <h3 className="text-sm font-semibold">
          {t("masterData.calendarDays")}
          {selected == null ? ` — ${t("masterData.selectCalendar")}` : ` — ${selectedCal?.name ?? selectedCal?.code ?? ""}`}
        </h3>
        {selected != null && (
          <>
            {canCreate && (
              <EntityDialog
                title={t("masterData.newDay")} fields={dayFields} initial={{ dayType: "working" }}
                open={dayOpen} onOpenChange={setDayOpen}
                onSubmit={async (v) => { await createDay.mutateAsync({ ...v, calendarId: selected } as any); }}
              />
            )}
            <DataTable
              columns={dayColumns} data={dayRows} getRowId={(r) => r.id}
              loading={days.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
              initialSort={{ columnId: "date", dir: "asc" }}
              onRowClick={(r) => setSelectedDay(r.id)}
              toolbar={canCreate ? (
                <Button size="sm" variant="outline" onClick={() => setDayOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newDay")}</Button>
              ) : undefined}
              emptyState={<EmptyCreate title={t("masterData.newDay")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newDay")} onCreate={() => setDayOpen(true)} />}
            />
          </>
        )}
      </CardContent></Card>

      {/* doc 42 T9 — ca làm việc áp dụng cho từng ngày lịch (chọn ngày ở bảng trên) */}
      <Card><CardContent className="space-y-3 pt-4">
        <h3 className="text-sm font-semibold">
          {t("masterData.dayShifts", { defaultValue: "Ca làm việc áp dụng ngày này" })}
          {selectedDay == null
            ? ` — ${t("masterData.selectDay", { defaultValue: "Chọn một ngày ở bảng trên" })}`
            : ` — ${fmtDate(selectedDayRow?.date)}`}
        </h3>
        {selectedDay != null && (
          <>
            {canEdit && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <Label>{t("masterData.shift", { defaultValue: "Ca làm việc" })}</Label>
                  <EntityPicker
                    options={shiftOptions}
                    loading={shiftConfigsQ.isLoading}
                    value={pickShift}
                    onChange={(val) => setPickShift(val === null ? null : Number(val))}
                    className="w-72"
                    placeholder={t("masterData.selectShift", { defaultValue: "-- Chọn ca để gán --" })}
                    searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
                    emptyText={t("masterData.empty")}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={pickShift == null}
                  onClick={() => { if (pickShift != null) assignShift.mutate({ calendarDayId: selectedDay, shiftConfigId: pickShift }); }}
                >
                  <Plus className="mr-1 h-4 w-4" /> {t("masterData.assignShift", { defaultValue: "Gán ca" })}
                </Button>
              </div>
            )}
            <DataTable
              columns={shiftColumns} data={shiftRows} getRowId={(r) => r.id}
              loading={dayShifts.isLoading}
              emptyState={<EmptyState variant="no-data" title={t("masterData.dayShifts", { defaultValue: "Ca làm việc áp dụng ngày này" })} description={t("masterData.noShiftsForDay", { defaultValue: "Chưa có ca nào cho ngày này" })} />}
            />
          </>
        )}
      </CardContent></Card>
    </div>
  );
}

// ─── Warehouse / Inventory ───────────────────────────────────────────────────
function InventoryPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("masterdata", "canCreate");
  const canEdit = hasPermission("masterdata", "canEdit");
  const canDelete = hasPermission("masterdata", "canDelete");
  const utils = trpc.useUtils();

  const warehouses = trpc.masterData.inventory.listWarehouses.useQuery({});
  const [selectedWh, setSelectedWh] = useState<number | undefined>(undefined);
  const locations = trpc.masterData.inventory.listLocations.useQuery({ warehouseId: selectedWh! }, { enabled: selectedWh != null });
  const balances = trpc.masterData.inventory.listBalances.useQuery({});
  // doc 42 C4 — tồn kho chọn mã vật liệu / kho / đơn vị từ danh sách có sẵn (không mã rác).
  const materialsList = trpc.masterData.materials.list.useQuery({});
  const uomList = trpc.masterData.uom.list.useQuery({});
  const materialOptions = codeNameOptions(materialsList.data);
  const warehouseOptions = codeNameOptions(warehouses.data);
  const uomOptions = codeNameOptions(uomList.data);

  const refreshWh = () => utils.masterData.inventory.listWarehouses.invalidate();
  const refreshLoc = () => utils.masterData.inventory.listLocations.invalidate();
  const refreshBal = () => utils.masterData.inventory.listBalances.invalidate();
  const createWh = trpc.masterData.inventory.createWarehouse.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshWh(); } });
  const updateWh = trpc.masterData.inventory.updateWarehouse.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshWh(); } });
  const delWh = trpc.masterData.inventory.deleteWarehouse.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshWh(); }, onError: (e) => toastTrpcError(e) });
  const createLoc = trpc.masterData.inventory.createLocation.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshLoc(); } });
  const updateLoc = trpc.masterData.inventory.updateLocation.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshLoc(); } });
  const delLoc = trpc.masterData.inventory.deleteLocation.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshLoc(); }, onError: (e) => toastTrpcError(e) });
  const upsertBal = trpc.masterData.inventory.upsertBalance.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshBal(); } });
  const updateBal = trpc.masterData.inventory.updateBalance.useMutation({ onSuccess: () => { toast.success(t("masterData.saved")); refreshBal(); } });
  const delBal = trpc.masterData.inventory.deleteBalance.useMutation({ onSuccess: () => { toast.success(t("masterData.deleted")); refreshBal(); }, onError: (e) => toastTrpcError(e) });

  const whTypes = ["raw", "wip", "fg", "spare", "other"];
  const locKinds = ["bin", "shelf", "zone"];
  const whFields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name"), required: true },
    { key: "factoryCode", label: t("masterData.factoryCode") },
    { key: "type", label: t("masterData.type"), type: "select", options: whTypes.map((d) => ({ value: d, label: t(`masterData.warehouseTypes.${d}`) })) },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];
  const locFields: Field[] = [
    { key: "code", label: t("masterData.code"), required: true },
    { key: "name", label: t("masterData.name") },
    { key: "kind", label: t("masterData.kind"), type: "select", options: locKinds.map((d) => ({ value: d, label: t(`masterData.locationKinds.${d}`) })) },
    { key: "isActive", label: t("masterData.active"), type: "bool" },
  ];
  const balFields: Field[] = [
    { key: "materialCode", label: t("masterData.materialCode"), type: "entity", entityOptions: materialOptions, entityLoading: materialsList.isLoading, required: true },
    { key: "warehouseCode", label: t("masterData.warehouseCode"), type: "entity", entityOptions: warehouseOptions, entityLoading: warehouses.isLoading, required: true },
    { key: "locationCode", label: t("masterData.locationCode") },
    { key: "lotCode", label: t("masterData.lotCode") },
    { key: "quantityOnHand", label: t("masterData.quantityOnHand"), type: "number", required: true },
    { key: "uomCode", label: t("masterData.unit"), type: "entity", entityOptions: uomOptions, entityLoading: uomList.isLoading },
  ];
  // Edit balance: material/warehouse are the unique-key anchors → quantity/uom/location/lot/notes only.
  const balEditFields: Field[] = [
    { key: "quantityOnHand", label: t("masterData.quantityOnHand"), type: "number", required: true },
    { key: "uomCode", label: t("masterData.unit"), type: "entity", entityOptions: uomOptions, entityLoading: uomList.isLoading },
    { key: "locationCode", label: t("masterData.locationCode") },
    { key: "lotCode", label: t("masterData.lotCode") },
  ];

  const [whOpen, setWhOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [balOpen, setBalOpen] = useState(false);
  const whRows = (warehouses.data ?? []) as any[];
  const locRows = (locations.data ?? []) as any[];
  const balRows = (balances.data ?? []) as any[];
  const selectedWhObj = whRows.find((r) => r.id === selectedWh);
  const whColumns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), cell: (r) => <span className="font-mono">{r.code}</span>, sortValue: (r) => r.code, filterValue: (r) => r.code ?? "" },
    { id: "name", header: t("masterData.name"), cell: (r) => r.name, sortValue: (r) => r.name, filterValue: (r) => r.name ?? "" },
    { id: "type", header: t("masterData.type"), cell: (r) => <Badge variant="secondary">{t(`masterData.warehouseTypes.${r.type}`)}</Badge>, sortValue: (r) => r.type, filterValue: (r) => (r.type ? t(`masterData.warehouseTypes.${r.type}`) : "") },
    { id: "factoryCode", header: t("masterData.factoryCode"), cell: (r) => r.factoryCode ?? "-", sortValue: (r) => r.factoryCode, filterValue: (r) => r.factoryCode ?? "" },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <EntityDialog
              title={t("masterData.editWarehouse")} isEdit fields={whFields} initial={r}
              onSubmit={async (v) => { await updateWh.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.warehouseCode")} ${r.code}`}
              onConfirm={async () => { await delWh.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];
  const locColumns: DataTableColumn<any>[] = [
    { id: "code", header: t("masterData.code"), cell: (r) => <span className="font-mono">{r.code}</span>, sortValue: (r) => r.code, filterValue: (r) => r.code ?? "" },
    { id: "name", header: t("masterData.name"), cell: (r) => r.name ?? "-", sortValue: (r) => r.name, filterValue: (r) => r.name ?? "" },
    { id: "kind", header: t("masterData.kind"), cell: (r) => t(`masterData.locationKinds.${r.kind}`), sortValue: (r) => r.kind, filterValue: (r) => (r.kind ? t(`masterData.locationKinds.${r.kind}`) : "") },
    { id: "active", header: t("masterData.active"), cell: (r) => <ActiveBadge active={r.isActive} />, sortValue: (r) => (r.isActive ? 1 : 0) },
    {
      id: "actions", header: "", align: "right", width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canEdit && (
            <EntityDialog
              title={t("masterData.editLocation")} isEdit fields={locFields} initial={r}
              onSubmit={async (v) => { await updateLoc.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.locationCode")} ${r.code}`}
              onConfirm={async () => { await delLoc.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];
  const balColumns: DataTableColumn<any>[] = [
    { id: "materialCode", header: t("masterData.materialCode"), cell: (r) => <span className="font-mono">{r.materialCode}</span>, sortValue: (r) => r.materialCode, filterValue: (r) => r.materialCode ?? "" },
    { id: "warehouseCode", header: t("masterData.warehouseCode"), cell: (r) => <span className="font-mono">{r.warehouseCode}</span>, sortValue: (r) => r.warehouseCode, filterValue: (r) => r.warehouseCode ?? "" },
    { id: "locationCode", header: t("masterData.locationCode"), cell: (r) => r.locationCode ?? "-", sortValue: (r) => r.locationCode, filterValue: (r) => r.locationCode ?? "" },
    { id: "lotCode", header: t("masterData.lotCode"), cell: (r) => r.lotCode ?? "-", sortValue: (r) => r.lotCode, filterValue: (r) => r.lotCode ?? "" },
    { id: "qty", header: t("masterData.quantityOnHand"), align: "right", cell: (r) => fmtNum(r.quantityOnHand), sortValue: (r) => Number(r.quantityOnHand) },
    { id: "uom", header: t("masterData.unit"), cell: (r) => r.uomCode, sortValue: (r) => r.uomCode },
    {
      id: "actions", header: "", align: "right", width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canEdit && (
            <EntityDialog
              title={t("masterData.editBalance")} isEdit fields={balEditFields}
              initial={{ quantityOnHand: Number(r.quantityOnHand), uomCode: r.uomCode, locationCode: r.locationCode, lotCode: r.lotCode }}
              onSubmit={async (v) => { await updateBal.mutateAsync({ ...v, id: r.id } as any); }}
              trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
            />
          )}
          {canDelete && (
            <DeleteButton
              label={`${t("masterData.inventoryBalances")} ${r.materialCode} @ ${r.warehouseCode}`}
              onConfirm={async () => { await delBal.mutateAsync({ id: r.id }); }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-3 pt-4">
        {canCreate && (
          <EntityDialog
            title={t("masterData.newWarehouse")} fields={whFields} initial={{ isActive: true, type: "other" }}
            open={whOpen} onOpenChange={setWhOpen}
            onSubmit={async (v) => { await createWh.mutateAsync(v as any); }}
          />
        )}
        {!warehouses.isLoading && <ListStats rows={whRows} />}
        <DataTable
          columns={whColumns} data={whRows} getRowId={(r) => r.id}
          loading={warehouses.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
          initialSort={{ columnId: "code", dir: "asc" }}
          onRowClick={(r) => setSelectedWh(r.id)}
          toolbar={canCreate ? (
            <Button size="sm" onClick={() => setWhOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newWarehouse")}</Button>
          ) : undefined}
          emptyState={<EmptyCreate title={t("masterData.newWarehouse")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newWarehouse")} onCreate={() => setWhOpen(true)} />}
        />
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-4">
        <h3 className="text-sm font-semibold">
          {t("masterData.storageLocations")}
          {selectedWh == null ? ` — ${t("masterData.selectWarehouse")}` : ` — ${selectedWhObj?.name ?? selectedWhObj?.code ?? ""}`}
        </h3>
        {selectedWh != null && (
          <>
            {canCreate && (
              <EntityDialog
                title={t("masterData.newLocation")} fields={locFields} initial={{ isActive: true, kind: "bin" }}
                open={locOpen} onOpenChange={setLocOpen}
                onSubmit={async (v) => { await createLoc.mutateAsync({ ...v, warehouseId: selectedWh } as any); }}
              />
            )}
            <DataTable
              columns={locColumns} data={locRows} getRowId={(r) => r.id}
              loading={locations.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
              initialSort={{ columnId: "code", dir: "asc" }}
              toolbar={canCreate ? (
                <Button size="sm" variant="outline" onClick={() => setLocOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newLocation")}</Button>
              ) : undefined}
              emptyState={<EmptyCreate title={t("masterData.newLocation")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newLocation")} onCreate={() => setLocOpen(true)} />}
            />
          </>
        )}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-4">
        <h3 className="text-sm font-semibold">{t("masterData.inventoryBalances")}</h3>
        {canCreate && (
          <EntityDialog
            title={t("masterData.newBalance")} fields={balFields} initial={{ uomCode: "pcs", quantityOnHand: 0 }}
            open={balOpen} onOpenChange={setBalOpen}
            onSubmit={async (v) => { await upsertBal.mutateAsync(v as any); }}
          />
        )}
        <DataTable
          columns={balColumns} data={balRows} getRowId={(r) => r.id}
          loading={balances.isLoading} searchable searchPlaceholder={t("masterData.searchPlaceholder", { defaultValue: "Tìm..." })}
          initialSort={{ columnId: "materialCode", dir: "asc" }}
          toolbar={canCreate ? (
            <Button size="sm" variant="outline" onClick={() => setBalOpen(true)}><Plus className="mr-1 h-4 w-4" /> {t("masterData.newBalance")}</Button>
          ) : undefined}
          emptyState={<EmptyCreate title={t("masterData.newBalance")} description={t("masterData.empty")} canCreate={canCreate} ctaLabel={t("masterData.newBalance")} onCreate={() => setBalOpen(true)} />}
        />
      </CardContent></Card>
    </div>
  );
}
