/**
 * Control Plane — SCOPED API-KEY management (Admin / Integration).
 *
 * Lists the keys that authenticate the Unified Machine API (/api/v1): prefix +
 * granted scopes + last-used + status. Lets an admin MINT a key (name + scope
 * multiselect + optional expiry) — the PLAINTEXT key is shown ONCE with a copy
 * button + warning and can never be retrieved again — edit scopes/expiry, revoke
 * (disable) and delete. RBAC-gated on `admin_system` (view/create/edit/delete).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer, StatusBadge, EmptyState } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KeyRound, Plus, Copy, AlertTriangle, Ban, Trash2, Pencil, ShieldCheck, Globe } from "lucide-react";
import { toast } from "sonner";

type TenantScopeMode = "factory" | "global";

type ApiKeyRow = {
  id: number;
  name: string;
  description?: string | null;
  keyPrefix?: string | null;
  scopes: string[];
  isActive: boolean;
  expiresAt?: string | Date | null;
  lastUsedAt?: string | Date | null;
  // mig 0325 — phạm vi DỮ LIỆU (khác `scopes` = phạm vi HÀNH ĐỘNG). `null` = CHƯA KHAI.
  dataScopeMode?: TenantScopeMode | null;
  corporateCode?: string | null;
  factoryCode?: string | null;
};

/** Ba lựa chọn hiện trên giao diện — đúng ba trạng thái của CSDL, không nhiều không ít. */
const SCOPE_CHOICES = [
  {
    value: "" as const,
    labelKey: "apiKeys.scopeUndeclared",
    labelDefault: "Chưa khai — khoá KHÔNG đọc được số liệu (bi:read / export:read bị từ chối)",
  },
  {
    value: "factory" as const,
    labelKey: "apiKeys.scopeFactory",
    labelDefault: "Một nhà máy — khoá chỉ thấy dữ liệu của nhà máy được chọn",
  },
  {
    value: "global" as const,
    labelKey: "apiKeys.scopeGlobal",
    labelDefault: "Toàn cục (tường minh) — khoá thấy dữ liệu MỌI nhà máy",
  },
];

function fmtDate(v?: string | Date | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function isExpired(v?: string | Date | null): boolean {
  if (!v) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

export default function ApiKeysPage() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("admin_system", "canView");
  const canCreate = hasPermission("admin_system", "canCreate");
  const canEdit = hasPermission("admin_system", "canEdit");
  const canDelete = hasPermission("admin_system", "canDelete");

  const utils = trpc.useUtils();
  const listQ = trpc.apiKey.list.useQuery(undefined, { enabled: canView });
  const scopesQ = trpc.apiKey.scopes.useQuery(undefined, { enabled: canView });
  const scopeVocab = scopesQ.data ?? [];
  // Danh sách nhà máy THẬT — ô phạm vi phải so khớp `factories.code`; gõ tay một mã sai sẽ tạo
  // ra một khoá hợp lệ về hình thức nhưng đọc ra 0 dòng, và không ai biết vì sao.
  const factoriesQ = trpc.factory.list.useQuery(undefined, { enabled: canView });
  const factoryOptions = (factoriesQ.data ?? []) as Array<{ code: string; name?: string | null; corporateCode?: string | null }>;

  const invalidate = () => void utils.apiKey.list.invalidate();

  // ── Create dialog ──
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  // ⚠ Mặc định là CHƯA KHAI (""), KHÔNG phải "global". Một mặc định "toàn cục cho tiện" ở ô
  //   này sẽ vô hiệu hoá toàn bộ 0325 ngay tại chỗ dễ bấm nhất.
  const [scopeMode, setScopeMode] = useState<"" | TenantScopeMode>("");
  const [scopeFactory, setScopeFactory] = useState("");
  const [scopeCorporate, setScopeCorporate] = useState("");

  const resetCreate = () => {
    setName(""); setDescription(""); setScopes([]); setExpiresAt("");
    setScopeMode(""); setScopeFactory(""); setScopeCorporate("");
  };

  /** Ba ô luôn gửi CÙNG NHAU, đã chuẩn hoá — server và CHECK của CSDL đòi đúng hình dạng này. */
  const tenantPayload = (mode: "" | TenantScopeMode, fac: string, corp: string) =>
    mode === "factory"
      ? { dataScopeMode: "factory" as const, factoryCode: fac || null, corporateCode: corp || null }
      : { dataScopeMode: (mode || null) as TenantScopeMode | null, factoryCode: null, corporateCode: null };

  /** 'factory' mà chưa chọn nhà máy = lời khai rỗng ⇒ chặn ngay ở nút bấm. */
  const tenantIncomplete = (mode: "" | TenantScopeMode, fac: string, corp: string) =>
    mode === "factory" && !fac && !corp;

  const createM = trpc.apiKey.create.useMutation({
    onSuccess: (r) => {
      setPlaintext(r.plaintextKey);
      setCreateOpen(false);
      resetCreate();
      invalidate();
      toast.success(t("apiKeys.toastCreated", "Đã tạo khoá API"));
    },
    onError: (e) => toastTrpcError(e),
  });

  // ── Edit dialog ──
  const [editRow, setEditRow] = useState<ApiKeyRow | null>(null);
  const [editScopes, setEditScopes] = useState<string[]>([]);
  const [editExpires, setEditExpires] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editScopeMode, setEditScopeMode] = useState<"" | TenantScopeMode>("");
  const [editScopeFactory, setEditScopeFactory] = useState("");
  const [editScopeCorporate, setEditScopeCorporate] = useState("");

  const openEdit = (row: ApiKeyRow) => {
    setEditRow(row);
    setEditScopes(row.scopes ?? []);
    setEditExpires(row.expiresAt ? new Date(row.expiresAt).toISOString().slice(0, 16) : "");
    setEditActive(row.isActive);
    setEditScopeMode(row.dataScopeMode ?? "");
    setEditScopeFactory(row.factoryCode ?? "");
    setEditScopeCorporate(row.corporateCode ?? "");
  };

  const updateM = trpc.apiKey.update.useMutation({
    onSuccess: () => { setEditRow(null); invalidate(); toast.success(t("apiKeys.toastUpdated", "Đã cập nhật khoá")); },
    onError: (e) => toastTrpcError(e),
  });

  const revokeM = trpc.apiKey.revoke.useMutation({
    onSuccess: () => { invalidate(); toast.success(t("apiKeys.toastRevoked", "Đã thu hồi khoá")); },
    onError: (e) => toastTrpcError(e),
  });

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const deleteM = trpc.apiKey.delete.useMutation({
    onSuccess: () => { setDeleteId(null); invalidate(); toast.success(t("apiKeys.toastDeleted", "Đã xoá khoá")); },
    onError: (e) => toastTrpcError(e),
  });

  const toggleScope = (list: string[], setList: (v: string[]) => void, scope: string) => {
    setList(list.includes(scope) ? list.filter((s) => s !== scope) : [...list, scope]);
  };

  const copyKey = async () => {
    if (!plaintext) return;
    try { await navigator.clipboard.writeText(plaintext); toast.success(t("apiKeys.copied", "Đã sao chép khoá")); }
    catch { toast.error(t("apiKeys.copyFail", "Không sao chép được — hãy chọn và copy thủ công")); }
  };

  const rows = (listQ.data ?? []) as ApiKeyRow[];

  const scopeBadges = useMemo(
    () => (s: string[]) => (s.length === 0 ? <span className="text-muted-foreground">—</span> : s.map((sc) => (
      <Badge key={sc} variant="outline" className="mr-1 mb-1 font-mono text-[10px]">{sc}</Badge>
    ))),
    [],
  );

  /**
   * Ô chọn PHẠM VI DỮ LIỆU — dùng chung cho hộp thoại Tạo và Sửa (một nguồn, không chép tay
   * hai lần rồi để hai bên lệch nhau).
   */
  const tenantScopeFields = (
    mode: "" | TenantScopeMode,
    setMode: (v: "" | TenantScopeMode) => void,
    fac: string,
    setFac: (v: string) => void,
    corp: string,
    setCorp: (v: string) => void,
  ) => (
    <div className="space-y-1.5">
      <Label className="text-xs flex items-center gap-1">
        <Globe className="h-3.5 w-3.5" /> {t("apiKeys.fieldDataScope", "Phạm vi DỮ LIỆU (khoá THẤY được gì) *")}
      </Label>
      <div className="space-y-1 rounded-md border p-2">
        {SCOPE_CHOICES.map((c) => (
          <label key={c.value || "none"} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
            <input
              type="radio"
              className="mt-1"
              checked={mode === c.value}
              onChange={() => setMode(c.value)}
            />
            <span className="text-[12px]">{t(c.labelKey, c.labelDefault)}</span>
          </label>
        ))}
        {mode === "factory" && (
          <div className="mt-2 space-y-2 border-t pt-2">
            <div className="space-y-1">
              <Label className="text-[11px]">{t("apiKeys.fieldFactoryCode", "Nhà máy")}</Label>
              <select
                className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                value={fac}
                onChange={(e) => {
                  setFac(e.target.value);
                  const picked = factoryOptions.find((f) => f.code === e.target.value);
                  if (picked?.corporateCode) setCorp(picked.corporateCode);
                }}
              >
                <option value="">{t("apiKeys.pickFactory", "— chọn nhà máy —")}</option>
                {factoryOptions.map((f) => (
                  <option key={f.code} value={f.code}>{f.code}{f.name ? ` — ${f.name}` : ""}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">{t("apiKeys.fieldCorporateCode", "Mã tập đoàn (tuỳ chọn — để trống nếu chỉ giới hạn theo nhà máy)")}</Label>
              <Input value={corp} onChange={(e) => setCorp(e.target.value)} placeholder="VD: SIM" />
            </div>
            {tenantIncomplete(mode, fac, corp) && (
              <p className="text-[11px] text-destructive">
                {t("apiKeys.scopeFactoryNeedsCode", "Chọn một nhà máy (hoặc nhập mã tập đoàn) — phạm vi 'một nhà máy' không được để trống cả hai.")}
              </p>
            )}
          </div>
        )}
        {mode === "" && (
          <p className="mt-1 text-[11px] text-warning">
            {t(
              "apiKeys.scopeUndeclaredWarn",
              "Khoá chưa khai phạm vi sẽ bị TỪ CHỐI (403) khi gọi /api/bi hoặc /api/export. Đây là mặc định an toàn, không phải lỗi.",
            )}
          </p>
        )}
      </div>
    </div>
  );

  /** Nhãn phạm vi dữ liệu trong bảng — trạng thái CHƯA KHAI phải NHÌN THẤY được, không im lặng. */
  const dataScopeCell = (r: ApiKeyRow) => {
    if (r.dataScopeMode === "global") {
      return <StatusBadge status="global" tone="info" label={t("apiKeys.scopeGlobalShort", "Toàn cục")} />;
    }
    if (r.dataScopeMode === "factory") {
      return (
        <span className="font-mono text-[11px]">{r.factoryCode ?? r.corporateCode}</span>
      );
    }
    return <StatusBadge status="undeclared" tone="warning" label={t("apiKeys.scopeUndeclaredShort", "Chưa khai")} />;
  };

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <p className="text-sm text-muted-foreground">{t("apiKeys.noPermission", "Bạn không có quyền quản lý khoá API.")}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Header — DS PageHeader (shared pattern) */}
        <PageHeader
          icon={<KeyRound className="h-6 w-6" />}
          title={
            <span className="flex items-center gap-2">
              {t("apiKeys.title", "Khoá API")}<ViewOnlyBadge module="admin_system" />
            </span>
          }
          description={t("apiKeys.subtitle", "Khoá truy cập có phạm vi (scope) cho Unified Machine API (/api/v1)")}
          actions={
            <Button onClick={() => setCreateOpen(true)} disabled={!canCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> {t("apiKeys.create", "Tạo khoá")}
            </Button>
          }
        />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("apiKeys.listTitle", "Danh sách khoá")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("apiKeys.colName", "Tên")}</TableHead>
                  <TableHead>{t("apiKeys.colPrefix", "Tiền tố")}</TableHead>
                  <TableHead>{t("apiKeys.colScopes", "Phạm vi")}</TableHead>
                  <TableHead>{t("apiKeys.colDataScope", "Phạm vi dữ liệu")}</TableHead>
                  <TableHead>{t("apiKeys.colStatus", "Trạng thái")}</TableHead>
                  <TableHead>{t("apiKeys.colExpires", "Hết hạn")}</TableHead>
                  <TableHead>{t("apiKeys.colLastUsed", "Dùng gần nhất")}</TableHead>
                  <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="p-0">
                      <EmptyState variant="no-data" icon={KeyRound} compact title={t("apiKeys.empty", "Chưa có khoá nào.")} />
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => {
                  const expired = isExpired(r.expiresAt);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}{r.description ? <div className="text-[11px] text-muted-foreground">{r.description}</div> : null}</TableCell>
                      <TableCell className="font-mono text-xs">{r.keyPrefix ?? "—"}…</TableCell>
                      <TableCell className="max-w-[260px]"><div className="flex flex-wrap">{scopeBadges(r.scopes)}</div></TableCell>
                      <TableCell>{dataScopeCell(r)}</TableCell>
                      <TableCell>
                        {!r.isActive ? (
                          <StatusBadge status="revoked" tone="warning" label={t("apiKeys.revoked", "Đã thu hồi")} />
                        ) : expired ? (
                          <StatusBadge status="expired" tone="error" label={t("apiKeys.expired", "Hết hạn")} />
                        ) : (
                          <StatusBadge status="active" tone="success" label={t("apiKeys.active", "Đang hoạt động")} />
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{fmtDate(r.expiresAt)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(r.lastUsedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canEdit} onClick={() => openEdit(r)} title={t("common.edit", "Sửa")}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {r.isActive && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-warning" disabled={!canEdit} onClick={() => revokeM.mutate({ id: r.id })} title={t("apiKeys.revoke", "Thu hồi")}>
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={!canDelete} onClick={() => setDeleteId(r.id)} title={t("common.delete", "Xoá")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageContainer>

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("apiKeys.create", "Tạo khoá")}</DialogTitle>
            <DialogDescription>{t("apiKeys.createDesc", "Khoá bí mật chỉ hiển thị MỘT LẦN sau khi tạo. Hãy lưu lại ngay.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("apiKeys.fieldName", "Tên *")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("apiKeys.namePlaceholder", "VD: Edge node line A")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("apiKeys.fieldDescription", "Mô tả")}</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> {t("apiKeys.fieldScopes", "Phạm vi (scope) *")}</Label>
              <div className="space-y-1 rounded-md border p-2">
                {scopeVocab.map((s) => (
                  <label key={s.scope} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                    <input type="checkbox" className="mt-1" checked={scopes.includes(s.scope)} onChange={() => toggleScope(scopes, setScopes, s.scope)} />
                    <span>
                      <span className="font-mono text-xs">{s.scope}</span>
                      <span className="block text-[11px] text-muted-foreground">{s.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {tenantScopeFields(scopeMode, setScopeMode, scopeFactory, setScopeFactory, scopeCorporate, setScopeCorporate)}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("apiKeys.fieldExpires", "Hết hạn (tuỳ chọn)")}</Label>
              <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel", "Huỷ")}</Button>
            <Button
              disabled={!name.trim() || scopes.length === 0 || tenantIncomplete(scopeMode, scopeFactory, scopeCorporate) || createM.isPending}
              onClick={() => createM.mutate({
                name: name.trim(),
                description: description || undefined,
                scopes,
                expiresAt: expiresAt || undefined,
                ...tenantPayload(scopeMode, scopeFactory, scopeCorporate),
              })}
            >
              {t("apiKeys.create", "Tạo khoá")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Show-once plaintext key ── */}
      <Dialog open={plaintext != null} onOpenChange={(o) => !o && setPlaintext(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-warning" /> {t("apiKeys.showOnceTitle", "Sao chép khoá ngay")}</DialogTitle>
            <DialogDescription>{t("apiKeys.showOnceDesc", "Đây là lần DUY NHẤT khoá này hiển thị. Sau khi đóng hộp thoại sẽ không thể lấy lại — chỉ có thể tạo khoá mới.")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            <code className="flex-1 break-all font-mono text-sm">{plaintext}</code>
            <Button size="icon" variant="outline" onClick={() => void copyKey()}><Copy className="h-4 w-4" /></Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setPlaintext(null)}>{t("apiKeys.savedIt", "Tôi đã lưu khoá")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={editRow != null} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("apiKeys.editTitle", "Sửa khoá")}: {editRow?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> {t("apiKeys.fieldScopes", "Phạm vi (scope) *")}</Label>
              <div className="space-y-1 rounded-md border p-2">
                {scopeVocab.map((s) => (
                  <label key={s.scope} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                    <input type="checkbox" className="mt-1" checked={editScopes.includes(s.scope)} onChange={() => toggleScope(editScopes, setEditScopes, s.scope)} />
                    <span>
                      <span className="font-mono text-xs">{s.scope}</span>
                      <span className="block text-[11px] text-muted-foreground">{s.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {tenantScopeFields(editScopeMode, setEditScopeMode, editScopeFactory, setEditScopeFactory, editScopeCorporate, setEditScopeCorporate)}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("apiKeys.fieldExpires", "Hết hạn (tuỳ chọn)")}</Label>
              <Input type="datetime-local" value={editExpires} onChange={(e) => setEditExpires(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <Label className="text-sm">{t("apiKeys.activeLabel", "Khoá đang hoạt động")}</Label>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>{t("common.cancel", "Huỷ")}</Button>
            <Button
              disabled={editScopes.length === 0 || tenantIncomplete(editScopeMode, editScopeFactory, editScopeCorporate) || updateM.isPending}
              onClick={() => editRow && updateM.mutate({
                id: editRow.id,
                scopes: editScopes,
                expiresAt: editExpires ? new Date(editExpires).toISOString() : null,
                isActive: editActive,
                ...tenantPayload(editScopeMode, editScopeFactory, editScopeCorporate),
              })}
            >
              {t("common.save", "Lưu")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("apiKeys.deleteTitle", "Xoá khoá API?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("apiKeys.deleteDesc", "Mọi client đang dùng khoá này sẽ mất quyền truy cập ngay lập tức. Không thể hoàn tác.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Huỷ")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteId && deleteM.mutate({ id: deleteId })}>
              {t("common.delete", "Xoá")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
