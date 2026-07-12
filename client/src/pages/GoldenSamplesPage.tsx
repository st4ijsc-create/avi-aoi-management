/**
 * W7-C (doc 27 §9 Đợt 7.4 — gaps V8 + V11) — Golden-sample management page.
 *
 * Full lifecycle UI for golden_sample_references: list per product (active +
 * history + status badges), capture-from-upload dialog, approve / reject /
 * retire actions (RBAC quality — server enforces qualityProcedure + SoD:
 * capturer ≠ approver), per-golden align-before-diff toggle (V7), and a
 * test-diff dialog that runs the real normalize→align→diff chain (V15+V7)
 * against an uploaded candidate.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useIsReadOnly } from "@/components/PermissionGate";
import {
  Star, Upload, CheckCircle2, XCircle, Archive, Loader2, RefreshCw, ImageIcon,
  SplitSquareVertical, Search,
} from "lucide-react";
import { format } from "date-fns";

type GoldenRow = {
  id: number;
  productCode: string | null;
  recipeCode: string | null;
  stationCode: string | null;
  roiKey: string | null;
  version: number;
  active: boolean;
  status: string;
  approvedBy: number | null;
  approvedAt: string | Date | null;
  approvalNote: string | null;
  alignBeforeDiff: boolean;
  sourceInspectionId: number | null;
  sourceMeasurementId: number | null;
  width: number;
  height: number;
  notes: string | null;
  createdBy: number | null;
  createdAt: string | Date;
  thumbnailDataUrl: string | null;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function GoldenSamplesPage() {
  const { t } = useTranslation();
  const readOnly = useIsReadOnly();
  const search = useSearch();

  // Filters
  const [productFilter, setProductFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Capture dialog
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capProduct, setCapProduct] = useState("");
  const [capRecipe, setCapRecipe] = useState("");
  const [capStation, setCapStation] = useState("");
  const [capRoi, setCapRoi] = useState("");
  const [capNotes, setCapNotes] = useState("");
  const [capFile, setCapFile] = useState<File | null>(null);

  // UX8 (doc 31) — deep-link support: /golden-samples?product=CODE prefilters the
  // list + prefills the capture dialog; &capture=1 auto-opens it. This is what the
  // product page's "Chụp golden" button links to (product scope prefilled).
  useEffect(() => {
    const params = new URLSearchParams(search);
    const product = params.get("product");
    if (!product) return;
    setProductFilter(product);
    if (params.get("capture") === "1") {
      setCapProduct(product);
      setCaptureOpen(true);
    }
  }, [search]);

  // Approve / reject / retire dialogs
  const [actionRow, setActionRow] = useState<GoldenRow | null>(null);
  const [actionKind, setActionKind] = useState<"approve" | "reject" | "retire" | null>(null);
  const [actionNote, setActionNote] = useState("");

  // Preview + test-diff dialogs
  const [previewRow, setPreviewRow] = useState<GoldenRow | null>(null);
  const [diffRow, setDiffRow] = useState<GoldenRow | null>(null);
  const [diffFile, setDiffFile] = useState<File | null>(null);
  const [diffResult, setDiffResult] = useState<{
    heatmapPngBase64: string; diffScore: number; diffRatio: number;
    normalized: boolean; aligned: boolean;
    alignment: { confidence: number; reason?: string; dx: number; dy: number } | null;
    golden: { version: number; matchedLevel: string };
  } | null>(null);

  const listQuery = trpc.goldenSample.listManaged.useQuery({
    productCode: productFilter.trim() || undefined,
    status: statusFilter === "all" ? undefined : (statusFilter as "draft" | "approved" | "retired"),
    withThumbnails: true,
    limit: 100,
  });
  const rows = (listQuery.data ?? []) as GoldenRow[];

  // Group by product for readability.
  const grouped = useMemo(() => {
    const map = new Map<string, GoldenRow[]>();
    for (const r of rows) {
      const k = r.productCode ?? "—";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries());
  }, [rows]);

  const onMutated = () => {
    listQuery.refetch();
  };

  const captureMutation = trpc.goldenSample.captureFromUpload.useMutation({
    onSuccess: (r) => {
      toast.success(t("goldenSamples.captured", "Đã lưu golden nháp v{{version}} — chờ người khác phê duyệt", { version: r.version }));
      setCaptureOpen(false);
      setCapFile(null); setCapNotes("");
      onMutated();
    },
    onError: (e) => toast.error(t("common.error", "Lỗi") + ": " + e.message),
  });

  const approveMutation = trpc.goldenSample.approve.useMutation({
    onSuccess: () => { toast.success(t("goldenSamples.approved", "Đã phê duyệt — golden này giờ là ACTIVE")); closeAction(); onMutated(); },
    onError: (e) => toast.error(t("common.error", "Lỗi") + ": " + e.message),
  });
  const rejectMutation = trpc.goldenSample.reject.useMutation({
    onSuccess: () => { toast.success(t("goldenSamples.rejected", "Đã từ chối bản nháp")); closeAction(); onMutated(); },
    onError: (e) => toast.error(t("common.error", "Lỗi") + ": " + e.message),
  });
  const retireMutation = trpc.goldenSample.retire.useMutation({
    onSuccess: () => { toast.success(t("goldenSamples.retired", "Đã thu hồi golden khỏi sản xuất")); closeAction(); onMutated(); },
    onError: (e) => toast.error(t("common.error", "Lỗi") + ": " + e.message),
  });
  const alignMutation = trpc.goldenSample.setAlignBeforeDiff.useMutation({
    onSuccess: () => onMutated(),
    onError: (e) => toast.error(t("common.error", "Lỗi") + ": " + e.message),
  });
  const diffMutation = trpc.goldenSample.diffWithUpload.useMutation({
    onSuccess: (r) => {
      if (!r.found) {
        toast.error(t("goldenSamples.noApprovedGolden", "Không có golden đã duyệt cho khóa này"));
        return;
      }
      setDiffResult(r as NonNullable<typeof diffResult> & { found: true });
    },
    onError: (e) => toast.error(t("common.error", "Lỗi") + ": " + e.message),
  });

  const closeAction = () => { setActionRow(null); setActionKind(null); setActionNote(""); };

  const handleCapture = async () => {
    if (!capProduct.trim() || !capFile) {
      toast.error(t("goldenSamples.captureMissing", "Cần mã sản phẩm và một ảnh"));
      return;
    }
    const b64 = await fileToBase64(capFile);
    captureMutation.mutate({
      productCode: capProduct.trim(),
      recipeCode: capRecipe.trim() || undefined,
      stationCode: capStation.trim() || undefined,
      roiKey: capRoi.trim() || undefined,
      imageBase64: b64,
      notes: capNotes.trim() || undefined,
    });
  };

  const handleAction = () => {
    if (!actionRow || !actionKind) return;
    const args = { id: actionRow.id, note: actionNote.trim() || undefined };
    if (actionKind === "approve") approveMutation.mutate(args);
    else if (actionKind === "reject") rejectMutation.mutate(args);
    else retireMutation.mutate(args);
  };

  const handleTestDiff = async () => {
    if (!diffRow || !diffFile) return;
    const b64 = await fileToBase64(diffFile);
    diffMutation.mutate({
      productCode: diffRow.productCode ?? "",
      recipeCode: diffRow.recipeCode ?? undefined,
      stationCode: diffRow.stationCode ?? undefined,
      roiKey: diffRow.roiKey ?? undefined,
      candidateBase64: b64,
    });
  };

  const statusBadge = (r: GoldenRow) => {
    if (r.status === "approved") {
      return (
        <span className="flex items-center gap-1 flex-wrap">
          <Badge className="bg-success/20 text-success border-success/30 text-[10px]">
            {t("goldenSamples.status.approved", "Đã duyệt")}
          </Badge>
          {r.active && (
            <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">ACTIVE</Badge>
          )}
        </span>
      );
    }
    if (r.status === "draft") {
      return <Badge className="bg-warning/20 text-warning border-warning/30 text-[10px]">{t("goldenSamples.status.draft", "Nháp — chờ duyệt")}</Badge>;
    }
    return <Badge variant="secondary" className="text-[10px]">{t("goldenSamples.status.retired", "Đã thu hồi")}</Badge>;
  };

  const keyLabel = (r: GoldenRow) =>
    [r.recipeCode && `recipe:${r.recipeCode}`, r.stationCode && `station:${r.stationCode}`, r.roiKey && `ROI:${r.roiKey}`]
      .filter(Boolean).join(" · ") || t("goldenSamples.productLevel", "Cấp sản phẩm");

  const anyActionPending = approveMutation.isPending || rejectMutation.isPending || retireMutation.isPending;

  return (
    <DashboardLayout title="SYNAPSE" navItems={navItems} currentPath="/golden-samples">
      <PageContainer>
        <PageHeader
          title={t("goldenSamples.title", "Golden samples (mẫu chuẩn)")}
          description={t("goldenSamples.description", "Chụp → phê duyệt (người chụp ≠ người duyệt) → chuẩn hóa ánh sáng → căn chỉnh sub-pixel → diff. Chỉ golden đã duyệt được dùng trong sản xuất.")}
          actions={
            !readOnly ? (
              <Button className="gap-2" onClick={() => setCaptureOpen(true)}>
                <Upload className="h-4 w-4" />
                {t("goldenSamples.captureFromUpload", "Chụp từ ảnh tải lên")}
              </Button>
            ) : undefined
          }
        />

        {/* Filters */}
        <Card className="glass-card">
          <CardContent className="pt-6 flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("goldenSamples.filterProduct", "Mã sản phẩm")}</label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  className="pl-8 w-56"
                  placeholder={t("goldenSamples.filterProductPh", "VD: PCB-A01")}
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("goldenSamples.filterStatus", "Trạng thái")}</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all", "Tất cả")}</SelectItem>
                  <SelectItem value="draft">{t("goldenSamples.status.draft", "Nháp — chờ duyệt")}</SelectItem>
                  <SelectItem value="approved">{t("goldenSamples.status.approved", "Đã duyệt")}</SelectItem>
                  <SelectItem value="retired">{t("goldenSamples.status.retired", "Đã thu hồi")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => listQuery.refetch()}>
              <RefreshCw className="h-4 w-4" />
              {t("common.refresh", "Làm mới")}
            </Button>
          </CardContent>
        </Card>

        {/* Grouped list */}
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : grouped.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="py-16 text-center text-muted-foreground">
              <Star className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>{t("goldenSamples.empty", "Chưa có golden nào. Chụp golden đầu tiên từ ảnh tải lên hoặc từ một điểm đo OK trong chi tiết kiểm tra.")}</p>
            </CardContent>
          </Card>
        ) : (
          grouped.map(([product, productRows]) => (
            <Card key={product} className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Star className="h-5 w-5 text-warning" />
                  {product}
                  <Badge variant="secondary">{productRows.length}</Badge>
                </CardTitle>
                <CardDescription>
                  {t("goldenSamples.groupDesc", "Active + lịch sử phiên bản theo khóa (recipe / station / ROI)")}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("goldenSamples.col.image", "Ảnh")}</TableHead>
                      <TableHead>{t("goldenSamples.col.key", "Khóa")}</TableHead>
                      <TableHead>{t("goldenSamples.col.version", "Phiên bản")}</TableHead>
                      <TableHead>{t("goldenSamples.col.status", "Trạng thái")}</TableHead>
                      <TableHead>{t("goldenSamples.col.align", "Căn chỉnh trước diff")}</TableHead>
                      <TableHead>{t("goldenSamples.col.provenance", "Nguồn")}</TableHead>
                      <TableHead className="text-right">{t("goldenSamples.col.actions", "Hành động")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productRows.map((r) => (
                      <TableRow key={r.id} className={r.active ? "bg-success/5" : undefined}>
                        <TableCell>
                          {r.thumbnailDataUrl ? (
                            <img
                              src={r.thumbnailDataUrl}
                              alt={`golden v${r.version}`}
                              className="h-12 w-12 object-contain rounded border border-border bg-secondary/40 cursor-zoom-in"
                              onClick={() => setPreviewRow(r)}
                            />
                          ) : (
                            <ImageIcon className="h-8 w-8 text-muted-foreground opacity-50" />
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{keyLabel(r)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">v{r.version}</Badge>
                          <span className="block text-[10px] text-muted-foreground mt-0.5">
                            {format(new Date(r.createdAt), "dd/MM/yyyy HH:mm")}
                          </span>
                        </TableCell>
                        <TableCell>
                          {statusBadge(r)}
                          {r.approvalNote && (
                            <span className="block text-[10px] text-muted-foreground mt-0.5 max-w-40 truncate" title={r.approvalNote}>
                              {r.approvalNote}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={r.alignBeforeDiff}
                            disabled={readOnly || alignMutation.isPending}
                            onCheckedChange={(v) => alignMutation.mutate({ id: r.id, enabled: v })}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.sourceInspectionId
                            ? t("goldenSamples.fromInspection", "Kiểm tra #{{id}}", { id: r.sourceInspectionId })
                            : t("goldenSamples.fromUpload", "Tải lên")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            {!readOnly && r.status === "draft" && (
                              <>
                                <Button
                                  size="sm" variant="outline"
                                  className="gap-1 border-success text-success hover:bg-success/10"
                                  onClick={() => { setActionRow(r); setActionKind("approve"); }}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {t("goldenSamples.approve", "Phê duyệt")}
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  className="gap-1 border-destructive text-destructive hover:bg-destructive/10"
                                  onClick={() => { setActionRow(r); setActionKind("reject"); }}
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  {t("goldenSamples.reject", "Từ chối")}
                                </Button>
                              </>
                            )}
                            {!readOnly && r.status === "approved" && (
                              <Button
                                size="sm" variant="ghost" className="gap-1 text-muted-foreground"
                                onClick={() => { setActionRow(r); setActionKind("retire"); }}
                              >
                                <Archive className="h-3.5 w-3.5" />
                                {t("goldenSamples.retire", "Thu hồi")}
                              </Button>
                            )}
                            {r.status === "approved" && r.active && (
                              <Button
                                size="sm" variant="ghost" className="gap-1"
                                onClick={() => { setDiffRow(r); setDiffFile(null); setDiffResult(null); }}
                              >
                                <SplitSquareVertical className="h-3.5 w-3.5" />
                                {t("goldenSamples.testDiff", "Thử diff")}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))
        )}
      </PageContainer>

      {/* Capture-from-upload dialog */}
      <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {t("goldenSamples.captureFromUpload", "Chụp từ ảnh tải lên")}
            </DialogTitle>
            <DialogDescription>
              {t("goldenSamples.captureDesc", "Ảnh sẽ được lưu ở trạng thái NHÁP — một người khác (không phải bạn) phải phê duyệt trước khi nó được dùng để diff trong sản xuất.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("goldenSamples.product", "Mã sản phẩm")} *</label>
              <Input value={capProduct} onChange={(e) => setCapProduct(e.target.value)} placeholder="PCB-A01" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Recipe</label>
                <Input value={capRecipe} onChange={(e) => setCapRecipe(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Station</label>
                <Input value={capStation} onChange={(e) => setCapStation(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">ROI</label>
                <Input value={capRoi} onChange={(e) => setCapRoi(e.target.value)} placeholder="MP001" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("goldenSamples.image", "Ảnh golden")} *</label>
              <Input type="file" accept="image/*" onChange={(e) => setCapFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("goldenSamples.notes", "Ghi chú")}</label>
              <Textarea rows={2} value={capNotes} onChange={(e) => setCapNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCaptureOpen(false)}>{t("common.cancel", "Hủy")}</Button>
            <Button onClick={handleCapture} disabled={captureMutation.isPending} className="gap-2">
              {captureMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("goldenSamples.saveDraft", "Lưu bản nháp")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve / reject / retire dialog */}
      <Dialog open={!!actionRow && !!actionKind} onOpenChange={(open) => { if (!open) closeAction(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionKind === "approve" && t("goldenSamples.approveTitle", "Phê duyệt golden")}
              {actionKind === "reject" && t("goldenSamples.rejectTitle", "Từ chối bản nháp")}
              {actionKind === "retire" && t("goldenSamples.retireTitle", "Thu hồi golden")}
            </DialogTitle>
            <DialogDescription>
              {actionKind === "approve"
                ? t("goldenSamples.approveDesc", "Golden này sẽ trở thành ACTIVE cho khóa của nó và được dùng trong diff sản xuất. Người chụp không thể tự duyệt (SoD).")
                : actionKind === "reject"
                  ? t("goldenSamples.rejectDesc", "Bản nháp sẽ bị loại và không bao giờ được kích hoạt.")
                  : t("goldenSamples.retireDesc", "Golden sẽ bị gỡ khỏi sản xuất; lịch sử được giữ lại.")}
              {actionRow && ` — ${actionRow.productCode ?? ""} v${actionRow.version}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 py-2">
            <label className="text-sm font-medium">{t("goldenSamples.actionNote", "Ghi chú (tùy chọn)")}</label>
            <Textarea rows={2} value={actionNote} onChange={(e) => setActionNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAction}>{t("common.cancel", "Hủy")}</Button>
            <Button
              onClick={handleAction}
              disabled={anyActionPending}
              variant={actionKind === "approve" ? "default" : "destructive"}
              className="gap-2"
            >
              {anyActionPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {actionKind === "approve" && t("goldenSamples.approve", "Phê duyệt")}
              {actionKind === "reject" && t("goldenSamples.reject", "Từ chối")}
              {actionKind === "retire" && t("goldenSamples.retire", "Thu hồi")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!previewRow} onOpenChange={(open) => { if (!open) setPreviewRow(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {previewRow?.productCode} · v{previewRow?.version} ({previewRow?.width}×{previewRow?.height})
            </DialogTitle>
          </DialogHeader>
          {previewRow?.thumbnailDataUrl && (
            <div className="flex justify-center">
              <img src={previewRow.thumbnailDataUrl} alt="golden preview" className="max-w-full max-h-[60vh] object-contain rounded-lg" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Test-diff dialog (real normalize→align→diff chain) */}
      <Dialog open={!!diffRow} onOpenChange={(open) => { if (!open) { setDiffRow(null); setDiffResult(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SplitSquareVertical className="h-5 w-5" />
              {t("goldenSamples.testDiffTitle", "Thử diff với golden")}
            </DialogTitle>
            <DialogDescription>
              {t("goldenSamples.testDiffDesc", "Tải một ảnh ứng viên — hệ thống chuẩn hóa ánh sáng, căn chỉnh sub-pixel (nếu bật) rồi diff với golden đang ACTIVE.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input type="file" accept="image/*" onChange={(e) => { setDiffFile(e.target.files?.[0] ?? null); setDiffResult(null); }} />
            <Button onClick={handleTestDiff} disabled={!diffFile || diffMutation.isPending} className="gap-2">
              {diffMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("goldenSamples.runDiff", "Chạy diff")}
            </Button>
            {diffResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <Badge variant="outline">
                    {t("goldenSamples.diffScore", "Điểm khác biệt")}: {diffResult.diffScore}%
                  </Badge>
                  <Badge variant={diffResult.aligned ? "default" : "secondary"}>
                    {diffResult.aligned
                      ? t("goldenSamples.alignedConf", "Căn chỉnh OK ({{c}}%)", { c: Math.round((diffResult.alignment?.confidence ?? 0) * 100) })
                      : t("goldenSamples.notAligned", "Không căn chỉnh")}
                  </Badge>
                  <Badge variant="secondary">
                    {diffResult.normalized
                      ? t("goldenSamples.normalizedOn", "Đã chuẩn hóa ánh sáng")
                      : t("goldenSamples.normalizedOff", "Không chuẩn hóa")}
                  </Badge>
                </div>
                {!diffResult.aligned && diffResult.alignment?.reason && (
                  <p className="text-xs text-muted-foreground">{diffResult.alignment.reason}</p>
                )}
                <img
                  src={`data:image/png;base64,${diffResult.heatmapPngBase64}`}
                  alt="diff heatmap"
                  className="max-w-full max-h-[45vh] object-contain rounded-lg border border-border mx-auto"
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
