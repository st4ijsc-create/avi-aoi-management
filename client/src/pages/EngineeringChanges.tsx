/**
 * Engineering Changes (ECN / ECO) — doc 35 Wave W4-D + doc 40 Wave 4b (ENG-F9 polish).
 *
 * The system had no GENERAL engineering-change workflow. This page is the ECN
 * queue: list changes with status, DRAFT a new change (title / type / target /
 * reason / effectivity / impact), and advance the maker-checker lifecycle
 * (submit → review → approve / reject → implement → close). Decision buttons are
 * gated on the permission hook; the SERVER additionally enforces role + SoD
 * (requester ≠ reviewer ≠ approver), so the client gate is a UX hint only.
 *
 * Doc 81 Đợt 2 Task 4 — bố cục P3 danh sách–chi tiết (doc 81 §1.2 dòng ECN, FE2 §3):
 *  - MAIN = danh sách ECN (`DataTable` phân trang) trong card mang `data-layout-main`. Thanh công cụ
 *    DUY NHẤT trong MAIN (`data-layout-toolbar`, ≤56 px) chứa `FilterBar` đồng bộ URL (?status=&type=)
 *    và chip lọc `?filter=pending` (deep-link Hub, Đợt 1 Task 2) — không còn banner nào trước MAIN.
 *  - Header một hàng (`PageHeaderCompact`): h1 + chip "Quy trình ECN" (câu mô tả cũ, trong popover) +
 *    nút "Thay đổi mới" (và công cụ admin).
 *  - Chi tiết: flyout `?flyout=ecn&flyoutId=<id>` (FlyoutHost — F5/back giữ đúng lớp) với `DetailSheet`
 *    5 tab Tổng quan / Đối tượng / Duyệt / Nhiệm vụ / Lịch sử.
 *  - Tạo ECN: flyout `?flyout=ecn-new` (dữ liệu chưa lưu ⇒ hỏi trước khi đóng).
 *  - Ký duyệt / từ chối: `TransitionDialog` (sheet phải) cấu hình đúng hợp đồng HIỆN TẠI (Ruling R-2-g):
 *    phê duyệt có bước xác nhận, ý kiến TUỲ CHỌN; từ chối BẮT BUỘC lý do; submit/review/implement/close
 *    gọi thẳng như cũ. ECN chưa từng có mật khẩu/OTP ⇒ không thêm. Mọi lượt gọi mang `expectedStatus`
 *    (ECN-03). Maker-checker client (`checkSegregation`) khai đúng luật của `ecnService`: review tách
 *    khỏi người yêu cầu, approve tách khỏi người yêu cầu VÀ người xem xét.
 *  - Công cụ admin "Bổ sung componentCode từ BOM": từ card dưới danh sách chuyển sang flyout
 *    `?flyout=ecn-backfill` (cùng thủ tục, cùng dry-run → áp dụng).
 *
 * ENG-F9 polish (doc 40 Wave 4b): reject reason is required; detail shows impact,
 * actors and a lifecycle timeline built from the row's own stamped timestamps;
 * lifecycle action labels are i18n'd (ecn.action.*).
 *
 * TASK 3 — componentCode backfill surface: an ADMIN-only panel that triggers the
 * EXISTING `measurementPoint.backfillComponentCodesFromBom` procedure (doc 31
 * MP1/PM6, server/services/componentLinkBackfill.ts) for a chosen product —
 * dry-run preview then apply — and shows the matched/updated/skipped counts.
 * The backfill is NOT reimplemented here; only surfaced.
 *
 * RBAC: view/create gated on `machine_control`; decisions on `machine_control`
 * canEdit; backfill on admin. SAFETY: no machine write — pure metadata/workflow.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { FilterBar, useUrlFilters, type FilterDef } from "@/components/FilterBar";
import {
  PageContainer, StatusBadge, type BadgeVariant,
  PageHeaderCompact, NoticeChip, FlyoutHost, useFlyout, useCloseOwnLayer, DetailSheet,
  TransitionDialog, checkSegregation, LAYOUT_TOOLBAR,
} from "@/components/patterns";
import type { FlyoutDefinition } from "@/components/patterns/FlyoutHost";
import type { SegregationResult, SegregationRole, TransitionAction } from "@/components/patterns/ApprovalQueue";
import { GitPullRequestArrow, AlertTriangle, Wrench, Plus } from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError, mapTrpcError } from "@/lib/trpcErrors";

const CHANGE_TYPES = ["product", "bom", "recipe", "program", "process", "document"] as const;
type ChangeType = (typeof CHANGE_TYPES)[number];

const ECN_STATUSES = ["draft", "submitted", "in_review", "approved", "rejected", "implemented", "closed"] as const;

type EcnImpactSummary = {
  affectedProducts?: Array<number | string>;
  affectedPrograms?: Array<number | string>;
  affectedLines?: Array<number | string>;
  notes?: string;
  [k: string]: unknown;
};

type Ecn = {
  id: number;
  ecnKey: string;
  title: string;
  changeType: string;
  productModelId: number | null;
  targetDescription: string | null;
  reason: string | null;
  impactSummary: EcnImpactSummary | null;
  status: string;
  effectivityDate: string | Date | null;
  decisionComment: string | null;
  note: string | null;
  requestedBy: number | null;
  reviewedBy: number | null;
  approvedBy: number | null;
  implementedBy: number | null;
  closedBy: number | null;
  submittedAt: string | Date | null;
  reviewedAt: string | Date | null;
  approvedAt: string | Date | null;
  implementedAt: string | Date | null;
  closedAt: string | Date | null;
  createdAt: string | Date | null;
};

type EcnItem = {
  id: number;
  entityType: string;
  entityRef: number | null;
  entityCode: string | null;
  action: string;
  description: string | null;
  note?: string | null;
};

type Product = { id: number; code?: string | null; name?: string | null };
type UserNameFn = (id: number | null | undefined) => string;

// ECN status → solid shadcn <Badge> variant (unified onto <StatusBadge>).
function ecnStatusVariant(s: string): BadgeVariant {
  if (s === "approved" || s === "implemented") return "secondary";
  if (s === "rejected") return "destructive";
  if (s === "closed") return "outline";
  return "default"; // draft / submitted / in_review
}

function fmtDate(v: string | Date | null | undefined): string {
  if (v == null) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : "—";
}

function fmtDateTime(v: string | Date | null | undefined): string {
  if (v == null) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
}

/** Which lifecycle actions are offered for a given current status. */
function actionsFor(status: string): Array<{ action: string; labelKey: string; fallback: string; variant?: "destructive" }> {
  switch (status) {
    case "draft": return [{ action: "submit", labelKey: "ecn.action.submit", fallback: "Gửi duyệt" }];
    case "submitted": return [{ action: "review", labelKey: "ecn.action.review", fallback: "Bắt đầu xem xét" }, { action: "reject", labelKey: "ecn.action.reject", fallback: "Từ chối", variant: "destructive" }];
    case "in_review": return [{ action: "approve", labelKey: "ecn.action.approve", fallback: "Phê duyệt" }, { action: "reject", labelKey: "ecn.action.reject", fallback: "Từ chối", variant: "destructive" }];
    case "approved": return [{ action: "implement", labelKey: "ecn.action.implement", fallback: "Đánh dấu triển khai" }, { action: "close", labelKey: "ecn.action.close", fallback: "Đóng" }];
    case "rejected": return [{ action: "close", labelKey: "ecn.action.close", fallback: "Đóng" }];
    case "implemented": return [{ action: "close", labelKey: "ecn.action.close", fallback: "Đóng" }];
    default: return [];
  }
}

/**
 * Maker-checker theo ĐÚNG luật của `ecnService.transitionEcn` (server vẫn là cổng thật):
 * review — người yêu cầu không tự xem xét; approve — không phải người yêu cầu (ApprovalQueue luôn
 * thêm) và không phải người đã xem xét. submit/reject/implement/close: server không tách vai.
 */
const ECN_SEGREGATION: Partial<Record<string, readonly SegregationRole[]>> = {
  review: ["author"],
  approve: ["reviewer"],
};

function transitionActionOf(action: string, label: string): TransitionAction {
  const kind = action === "approve" ? "approve" : action === "reject" ? "reject" : "advance";
  return { key: action, label, kind, segregateFrom: ECN_SEGREGATION[action] };
}

function ecnSegregation(ecn: Ecn, action: TransitionAction, currentUserId: number | null | undefined): SegregationResult {
  return checkSegregation(action, { currentUserId, authorId: ecn.requestedBy, reviewerId: ecn.reviewedBy });
}

/** Nút hành động vòng đời của một ECN — dùng chung cho hàng danh sách và đầu chi tiết. */
function EcnActionButtons({
  ecn, currentUserId, pending, onAction,
}: {
  ecn: Ecn;
  currentUserId: number | null | undefined;
  pending: boolean;
  onAction: (ecn: Ecn, action: string) => void;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const sodText = (r: SegregationResult): string | null => {
    if (r.allowed) return null;
    if (r.reason === "author") return t("layoutKit.approval.sodAuthor", "You created this item — someone else must decide (maker-checker).");
    if (r.reason === "reviewer") return t("layoutKit.approval.sodReviewer", "You reviewed this item — the approver must be someone else.");
    return t("layoutKit.approval.userUnknown", "The current user is not known yet — decisions are disabled.");
  };
  return (
    <>
      {actionsFor(ecn.status).map((a) => {
        const label = t(a.labelKey, a.fallback);
        const seg = ecnSegregation(ecn, transitionActionOf(a.action, label), currentUserId);
        const msg = sodText(seg);
        const descId = `${baseId}-${a.action}`;
        return (
          <span key={a.action} className="inline-flex">
            <Button
              size="sm"
              variant={a.variant === "destructive" ? "destructive" : "outline"}
              disabled={pending || !seg.allowed}
              aria-describedby={msg ? descId : undefined}
              title={msg ?? undefined}
              onClick={() => onAction(ecn, a.action)}
            >
              {label}
            </Button>
            {msg && <span id={descId} className="sr-only">{msg}</span>}
          </span>
        );
      })}
    </>
  );
}

export default function EngineeringChanges() {
  const { t } = useTranslation();
  const { hasPermission, isAdmin } = usePermissions();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  // doc 54 Đ2 — ECN is an engineering task: gate on machine_control (engineer has it)
  // instead of masterdata. Server (ecnRouter MOD_ENGINEERING + roleProcedure incl.
  // engineer) already allows it; SoD (requester≠approver) is enforced server-side.
  const canView = isAdmin || hasPermission("machine_control", "canView");
  const canCreate = isAdmin || hasPermission("machine_control", "canCreate");
  const canDecide = isAdmin || hasPermission("machine_control", "canEdit");

  const utils = trpc.useUtils();
  const listQ = trpc.ecn.list.useQuery({ limit: 200 }, { enabled: canView });
  const productsQ = trpc.productModel.list.useQuery({ limit: 100 }); // productModel.list cap = max(100)
  const products = (productsQ.data ?? []) as Product[];

  // Actor id → display name. user.list is admin-only, so only admins get names;
  // everyone else sees an honest "Người dùng #id" fallback (no crash, no leak of PII).
  const usersQ = (trpc as any).user?.list?.useQuery?.(undefined, { enabled: isAdmin });
  const userName = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of ((usersQ?.data ?? []) as Array<{ id: number; name?: string | null; username?: string | null }>)) {
      map.set(u.id, u.name || u.username || `#${u.id}`);
    }
    return (id: number | null | undefined): string => {
      if (id == null) return "—";
      return map.get(id) ?? t("ecn.userFallback", "Người dùng #{{id}}", { id });
    };
  }, [usersQ?.data, t]);

  // Cả router `ecn` (list + getById + getItems): chi tiết mở bằng getById (F5 tới ECN ngoài 200 hàng
  // đầu) cũng phải thấy trạng thái mới sau một quyết định.
  const invalidate = () => { void utils.ecn.invalidate(); };

  // ── Reject / approve confirmation (TransitionDialog — sheet phải) ──────
  const [rejectTarget, setRejectTarget] = useState<Ecn | null>(null);
  // doc 80 Task 8 (ECN-05) — approve is a maker-checker DECISION exactly like reject — it must not
  // fire on a bare button click. Comment is optional here (mandatory only for reject).
  const [approveTarget, setApproveTarget] = useState<Ecn | null>(null);

  // Lỗi: đường gọi thẳng báo qua `onError` của từng lượt; đường sheet trả promise bị reject để
  // TransitionDialog GIỮ sheet mở + giữ chữ và tự báo lỗi đúng MỘT lần.
  const transitionM = trpc.ecn.transition.useMutation({
    onSuccess: () => { toast.success(t("ecn.updated", "Đã cập nhật thay đổi kỹ thuật")); invalidate(); },
  });

  const doTransition = (ecn: Ecn, action: string) => {
    if (action === "reject") {
      setRejectTarget(ecn);
      return;
    }
    // doc 80 Task 8 (ECN-05) — approve is a maker-checker decision: open a
    // confirmation sheet (comment optional) instead of firing on one click.
    if (action === "approve") {
      setApproveTarget(ecn);
      return;
    }
    // doc 80 Task 8 (ECN-03) — every transition carries the status this row is
    // CURRENTLY showing on screen; the server CAS-updates `WHERE status =
    // expectedStatus` and returns CONFLICT if someone else moved it first.
    transitionM.mutate({ id: ecn.id, action: action as any, expectedStatus: ecn.status as any }, { onError: (e) => { toastTrpcError(e); } });
  };

  // Lý do BẮT BUỘC do TransitionDialog giữ (kind "reject" ⇒ nút khoá tới khi có chữ sau trim; `comment` đã trim).
  const confirmReject = (comment: string | undefined): Promise<void> | void => {
    const target = rejectTarget;
    if (!target || !comment) return;
    return new Promise<void>((resolve, reject) => {
      transitionM.mutate(
        { id: target.id, action: "reject", comment, expectedStatus: target.status as any },
        { onSuccess: () => resolve(), onError: (e) => reject(e) },
      );
    });
  };

  const confirmApprove = (comment: string | undefined): Promise<void> | void => {
    const target = approveTarget;
    if (!target) return;
    return new Promise<void>((resolve, reject) => {
      transitionM.mutate(
        { id: target.id, action: "approve", expectedStatus: target.status as any, ...(comment ? { comment } : {}) },
        { onSuccess: () => resolve(), onError: (e) => reject(e) },
      );
    });
  };

  // ── URL-synced status / type filter ────────────────────────────────────
  const filterDefs: FilterDef[] = useMemo(() => [
    {
      key: "status", type: "select", label: t("ecn.col.status", "Trạng thái"),
      placeholder: t("ecn.filter.allStatuses", "Mọi trạng thái"),
      options: ECN_STATUSES.map((s) => ({ value: s, label: t(`ecn.status.${s}`, s) })),
    },
    {
      key: "type", type: "select", label: t("ecn.col.type", "Loại"),
      placeholder: t("ecn.filter.allTypes", "Mọi loại"),
      options: CHANGE_TYPES.map((ct) => ({ value: ct, label: t(`ecn.type.${ct}`, ct) })),
    },
  ], [t]);
  const { values: filterValues } = useUrlFilters(filterDefs);

  // Doc 80 Đợt 1 Task 2 (HUB-03) — deep-link `?filter=pending` từ Engineering Hub
  // (trước bản vá: BỊ BỎ QUA — trang chỉ đọc `status`/`type` qua FilterBar). "Chờ
  // duyệt" = submitted | in_review (khớp `oversight.pendingSummary` nhánh `ecn`).
  // Tách khỏi FilterBar vì đây là OR của HAI trạng thái, không phải một giá trị.
  const search = useSearch();
  const filterPending = new URLSearchParams(search).get("filter") === "pending";

  const allRows = (listQ.data ?? []) as Ecn[];
  const rows = useMemo(() => allRows.filter((r) =>
    (!filterValues.status || r.status === filterValues.status) &&
    (!filterValues.type || r.changeType === filterValues.type) &&
    (!filterPending || r.status === "submitted" || r.status === "in_review")
  ), [allRows, filterValues.status, filterValues.type, filterPending]);

  if (!canView) {
    return (
      <DashboardLayout title={t("ecn.title", "Thay đổi kỹ thuật")} navItems={navItems} currentPath="/engineering-changes">
        <div className="p-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("ecn.noPermission", "Bạn không có quyền xem thay đổi kỹ thuật.")}
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  const listLoaded = !listQ.isLoading;
  const actionsPending = transitionM.isPending;

  // ── Flyouts (một stack sheet phải; URL `?flyout=&flyoutId=` là nguồn sự thật) ──
  const flyouts: Record<string, FlyoutDefinition> = {
    ecn: {
      size: "lg",
      description: t("ecn.detail.flyoutTitle", "Chi tiết thay đổi kỹ thuật"),
      title: (id) => allRows.find((r) => String(r.id) === id)?.ecnKey ?? t("ecn.detail.flyoutTitle", "Chi tiết thay đổi kỹ thuật"),
      render: (layer) => (
        <EcnDetail
          id={layer.id}
          rows={allRows}
          listLoaded={listLoaded}
          userName={userName}
          products={products}
          actions={(ecn) => canDecide
            ? <EcnActionButtons ecn={ecn} currentUserId={currentUserId} pending={actionsPending} onAction={doTransition} />
            : null}
        />
      ),
    },
  };
  if (canCreate) {
    flyouts["ecn-new"] = {
      title: t("ecn.newTitle", "Thay đổi kỹ thuật mới"),
      description: t("ecn.subtitle", "Quy trình yêu cầu thay đổi ECN / ECO — phân tích tác động, phê duyệt maker-checker và ngày hiệu lực."),
      render: () => <EcnCreateForm products={products} onCreated={invalidate} />,
    };
  }
  if (isAdmin) {
    flyouts["ecn-backfill"] = {
      title: t("ecn.backfill.title", "Bổ sung componentCode từ BOM"),
      description: t("ecn.backfill.help", "Điền componentCode còn trống của điểm đo từ BOM sản phẩm (khớp refDesignator). Không phá hủy — liên kết sẵn có không bị ghi đè. Xem trước bằng dry-run trước khi áp dụng."),
      render: () => <ComponentCodeBackfillPanel products={products} />,
    };
  }

  return (
    <DashboardLayout title={t("ecn.title", "Thay đổi kỹ thuật")} navItems={navItems} currentPath="/engineering-changes">
      <FlyoutHost flyouts={flyouts}>
        {/* doc 81 Đợt 2 Task 2 — PageContainer: không đệm kép với <main> của shell. */}
        <PageContainer className="space-y-3">
          <EcnHeader canCreate={canCreate} isAdmin={isAdmin} />
          <EcnList
            rows={rows}
            hasAny={allRows.length > 0}
            loading={listQ.isLoading}
            filterDefs={filterDefs}
            filterPending={filterPending}
            canDecide={canDecide}
            currentUserId={currentUserId}
            actionsPending={actionsPending}
            onAction={doTransition}
          />
        </PageContainer>

        {/* ── Reject: lý do BẮT BUỘC (hành vi cũ — ECN-05) ─────────────── */}
        {rejectTarget && (
          <TransitionDialog open={rejectTarget != null}
            onOpenChange={(o) => { if (!o) setRejectTarget(null); }}
            action={transitionActionOf("reject", t("ecn.action.reject", "Từ chối"))}
            subject={rejectTarget.ecnKey}
            description={t("ecn.rejectPrompt", "Nêu rõ lý do từ chối {{key}}. Lý do được ghi vào nhật ký quyết định.", { key: rejectTarget.ecnKey })}
            segregation={ecnSegregation(rejectTarget, transitionActionOf("reject", ""), currentUserId)}
            pending={actionsPending}
            onConfirm={confirmReject}
          />
        )}

        {/* ── Approve confirmation (doc 80 Task 8, ECN-05) — ý kiến TUỲ CHỌN ── */}
        {approveTarget && (
          <TransitionDialog open={approveTarget != null}
            onOpenChange={(o) => { if (!o) setApproveTarget(null); }}
            action={transitionActionOf("approve", t("ecn.action.approve", "Phê duyệt"))}
            subject={approveTarget.ecnKey}
            description={t("ecn.approvePrompt", "Xác nhận phê duyệt {{key}}. Có thể thêm ý kiến (không bắt buộc) — ý kiến được ghi vào nhật ký quyết định.", { key: approveTarget.ecnKey })}
            segregation={ecnSegregation(approveTarget, transitionActionOf("approve", ""), currentUserId)}
            reasonRequired={false}
            pending={actionsPending}
            onConfirm={confirmApprove}
          />
        )}
      </FlyoutHost>
    </DashboardLayout>
  );
}

/** Header một hàng: h1 + chip mô tả + hành động (ngoài MAIN). */
function EcnHeader({ canCreate, isAdmin }: { canCreate: boolean; isAdmin: boolean }) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  return (
    <PageHeaderCompact
      icon={<GitPullRequestArrow />}
      title={t("ecn.title", "Thay đổi kỹ thuật")}
      chips={
        <NoticeChip kind="hint" label={t("ecn.aboutChip", "Quy trình ECN")}>
          {t("ecn.subtitle", "Quy trình yêu cầu thay đổi ECN / ECO — phân tích tác động, phê duyệt maker-checker và ngày hiệu lực.")}
        </NoticeChip>
      }
      actions={
        <>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => flyout.open("ecn-backfill")}>
              <Wrench className="mr-1 h-4 w-4" aria-hidden="true" />{t("ecn.backfill.title", "Bổ sung componentCode từ BOM")}
            </Button>
          )}
          {canCreate && (
            <Button size="sm" onClick={() => flyout.open("ecn-new")}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />{t("ecn.new", "Thay đổi mới")}
            </Button>
          )}
        </>
      }
    />
  );
}

/** MAIN — danh sách ECN: một thanh công cụ (bộ lọc) + DataTable phân trang. */
function EcnList({
  rows, hasAny, loading, filterDefs, filterPending, canDecide, currentUserId, actionsPending, onAction,
}: {
  rows: Ecn[];
  hasAny: boolean;
  loading: boolean;
  filterDefs: FilterDef[];
  filterPending: boolean;
  canDecide: boolean;
  currentUserId: number | null;
  actionsPending: boolean;
  onAction: (ecn: Ecn, action: string) => void;
}) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  const [location, setLocation] = useLocation();
  // Nút trong ô thao tác không được lan click/Enter lên hàng (hàng mở chi tiết).
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const columns: DataTableColumn<Ecn>[] = [
    { id: "key", header: t("ecn.col.key", "ECN"), cell: (r) => <span className="font-mono text-xs">{r.ecnKey}</span>, alwaysVisible: true },
    { id: "title", header: t("ecn.col.title", "Tiêu đề"), cell: (r) => <span className="block max-w-[24rem] truncate">{r.title}</span> },
    { id: "type", header: t("ecn.col.type", "Loại"), cell: (r) => t(`ecn.type.${r.changeType}`, r.changeType) },
    { id: "effectivity", header: t("ecn.col.effectivity", "Hiệu lực"), cell: (r) => fmtDate(r.effectivityDate) },
    { id: "status", header: t("ecn.col.status", "Trạng thái"), cell: (r) => <StatusBadge status={r.status} variant={ecnStatusVariant(r.status)} label={t(`ecn.status.${r.status}`, r.status)} /> },
    {
      id: "actions", header: t("ecn.col.actions", "Thao tác"), align: "right",
      cell: (r) => (
        <div className="flex flex-wrap justify-end gap-1" onClick={stop} onKeyDown={stop}>
          {canDecide
            ? <EcnActionButtons ecn={r} currentUserId={currentUserId} pending={actionsPending} onAction={onAction} />
            : <span className="text-xs text-muted-foreground">—</span>}
        </div>
      ),
    },
  ];

  const emptyText = loading
    ? t("common.loading", "Đang tải…")
    : hasAny
      ? t("ecn.emptyFiltered", "Không có thay đổi nào khớp bộ lọc.")
      : t("ecn.empty", "Chưa có thay đổi kỹ thuật nào.");

  return (
    <Card
      data-layout-main="ecn-list"
      aria-label={t("ecn.listLabel", "Danh sách ECN")}
      className="gap-2 rounded-none border-0 bg-transparent py-0 shadow-none"
    >
      {/* Thanh công cụ DUY NHẤT của MAIN (≤56 px): FilterBar thu gọn + chip lọc chờ duyệt. */}
      <div {...{ [LAYOUT_TOOLBAR]: "" }} className="flex min-h-11 flex-wrap items-center gap-2">
        <FilterBar
          filters={filterDefs}
          className="flex-nowrap items-center gap-2 rounded-none border-0 bg-transparent p-0 [&>svg]:mb-0 [&_label]:sr-only"
        />
        {/* Doc 80 Đợt 1 Task 2 (HUB-03) — deep-link `?filter=pending` từ Hub. */}
        {filterPending && (
          <div
            className="inline-flex h-8 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 pl-3 pr-1 text-xs text-muted-foreground"
            title={t("ecn.filteringPending", "Đang lọc: chỉ hiện ECN chờ duyệt (đang gửi / đang xem xét)")}
          >
            <span>{t("ecn.filterPendingChip", "Chỉ ECN chờ duyệt")}</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setLocation(location)}>
              {t("ecn.showAll", "Xem tất cả")}
            </Button>
          </div>
        )}
      </div>
      <DataTable<Ecn>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => flyout.open("ecn", { id: r.id })}
        pageSize={20}
        emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>}
        className="space-y-2"
      />
    </Card>
  );
}

/** Flyout tạo ECN — form cũ (Dialog) chuyển sang sheet phải; dữ liệu chưa lưu ⇒ hỏi trước khi đóng. */
function EcnCreateForm({ products, onCreated }: { products: Product[]; onCreated: () => void }) {
  const { t } = useTranslation();
  // final wave M-1 — đóng CHÍNH lớp của mình sau khi lưu (không đóng nhầm lớp người dùng mở trong lúc chờ server).
  const { layer, done } = useCloseOwnLayer();
  const fid = useId();
  const [title, setTitle] = useState("");
  const [changeType, setChangeType] = useState<ChangeType>("product");
  const [productModelId, setProductModelId] = useState<string>("");
  const [targetDescription, setTargetDescription] = useState("");
  const [reason, setReason] = useState("");
  const [impactNotes, setImpactNotes] = useState("");
  const [effectivityDate, setEffectivityDate] = useState("");

  const dirty = title !== "" || productModelId !== "" || targetDescription !== "" || reason !== "" || impactNotes !== "" || effectivityDate !== "" || changeType !== "product";
  // Báo FlyoutHost còn dữ liệu chưa lưu (Esc/Back/đóng ⇒ hỏi trước khi bỏ).
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const createM = trpc.ecn.create.useMutation({
    onSuccess: () => {
      toast.success(t("ecn.created", "Đã tạo thay đổi kỹ thuật"));
      onCreated();
      done();
    },
    onError: (e) => toastTrpcError(e),
  });

  const submitCreate = () => {
    if (!title.trim()) { toast.error(t("ecn.titleRequired", "Bắt buộc nhập tiêu đề")); return; }
    createM.mutate({
      title: title.trim(),
      changeType,
      productModelId: productModelId ? Number(productModelId) : undefined,
      targetDescription: targetDescription.trim() || undefined,
      reason: reason.trim() || undefined,
      impactSummary: impactNotes.trim() ? { notes: impactNotes.trim() } : undefined,
      effectivityDate: effectivityDate || undefined,
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`${fid}-title`}>{t("ecn.field.title", "Tiêu đề")}</Label>
        <Input id={`${fid}-title`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("ecn.field.titlePlaceholder", "VD: Cập nhật dung sai R12 trên model A")} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${fid}-type`}>{t("ecn.field.type", "Loại thay đổi")}</Label>
          <Select value={changeType} onValueChange={(v) => setChangeType(v as ChangeType)}>
            <SelectTrigger id={`${fid}-type`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANGE_TYPES.map((ct) => (
                <SelectItem key={ct} value={ct}>{t(`ecn.type.${ct}`, ct)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fid}-eff`}>{t("ecn.field.effectivity", "Ngày hiệu lực")}</Label>
          <Input id={`${fid}-eff`} type="date" value={effectivityDate} onChange={(e) => setEffectivityDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${fid}-product`}>{t("ecn.field.product", "Sản phẩm đích (tùy chọn)")}</Label>
        <Select value={productModelId || "none"} onValueChange={(v) => setProductModelId(v === "none" ? "" : v)}>
          <SelectTrigger id={`${fid}-product`}><SelectValue placeholder={t("ecn.noProduct", "Không / không riêng sản phẩm")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("ecn.noProduct", "Không / không riêng sản phẩm")}</SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>{p.code || p.name || `#${p.id}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${fid}-target`}>{t("ecn.field.target", "Mô tả đối tượng (tùy chọn)")}</Label>
        <Input id={`${fid}-target`} value={targetDescription} onChange={(e) => setTargetDescription(e.target.value)} placeholder={t("ecn.field.targetPlaceholder", "VD: BOM v3 dòng R12 / recipe SMT-01")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${fid}-reason`}>{t("ecn.field.reason", "Lý do")}</Label>
        <Textarea id={`${fid}-reason`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${fid}-impact`}>{t("ecn.field.impact", "Ghi chú phân tích tác động")}</Label>
        <Textarea id={`${fid}-impact`} rows={2} value={impactNotes} onChange={(e) => setImpactNotes(e.target.value)} placeholder={t("ecn.field.impactPlaceholder", "Sản phẩm / chương trình / dây chuyền ảnh hưởng, rủi ro, phương án khôi phục…")} />
      </div>
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Hủy")}</Button>
        <Button onClick={submitCreate} disabled={createM.isPending}>{t("common.create", "Tạo")}</Button>
      </div>
    </div>
  );
}

/** Nhãn mục nhỏ trong chi tiết. */
function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</div>;
}

/**
 * Flyout chi tiết ECN (`?flyout=ecn&flyoutId=<id>`) — 5 tab. Đọc hàng từ danh sách; ECN không nằm
 * trong 200 hàng đầu (deep-link/F5) thì đọc `ecn.getById`.
 */
function EcnDetail({
  id, rows, listLoaded, userName, products, actions,
}: {
  id: string | null;
  rows: Ecn[];
  listLoaded: boolean;
  userName: UserNameFn;
  products: Product[];
  actions: (ecn: Ecn) => ReactNode;
}) {
  const { t } = useTranslation();
  const numId = Number(id);
  const validId = Number.isInteger(numId) && numId > 0;
  const fromList = rows.find((r) => r.id === numId) ?? null;
  const byIdQ = trpc.ecn.getById.useQuery({ id: numId }, { enabled: validId && listLoaded && !fromList });
  const ecn = fromList ?? ((byIdQ.data as Ecn | undefined) ?? null);
  const itemsQ = trpc.ecn.getItems.useQuery({ ecnId: numId }, { enabled: ecn != null });

  if (!ecn) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {!listLoaded || byIdQ.isLoading
          ? t("common.loading", "Đang tải…")
          : t("ecn.detail.notFound", "Không tìm thấy ECN #{{id}}.", { id: id ?? "" })}
      </p>
    );
  }

  const productLabel = ecn.productModelId != null
    ? (products.find((p) => p.id === ecn.productModelId)?.code
        ?? products.find((p) => p.id === ecn.productModelId)?.name
        ?? `#${ecn.productModelId}`)
    : null;

  const impact = ecn.impactSummary ?? null;
  const impactList = (arr?: Array<number | string>) => (arr && arr.length ? arr.join(", ") : null);
  const items = (itemsQ.data ?? []) as EcnItem[];

  // Timeline steps in lifecycle order — only rendered when the stamp exists.
  const steps: Array<{ key: string; label: string; at: string | Date | null; who?: number | null }> = [
    { key: "created", label: t("ecn.timeline.created", "Tạo (bản nháp)"), at: ecn.createdAt, who: ecn.requestedBy },
    { key: "submitted", label: t("ecn.timeline.submitted", "Gửi duyệt"), at: ecn.submittedAt },
    { key: "reviewed", label: t("ecn.timeline.reviewed", "Xem xét"), at: ecn.reviewedAt, who: ecn.reviewedBy },
    { key: "approved", label: t("ecn.timeline.approved", "Phê duyệt"), at: ecn.approvedAt, who: ecn.approvedBy },
    { key: "implemented", label: t("ecn.timeline.implemented", "Triển khai"), at: ecn.implementedAt, who: ecn.implementedBy },
    { key: "closed", label: t("ecn.timeline.closed", "Đóng"), at: ecn.closedAt, who: ecn.closedBy },
  ].filter((s) => s.at != null);

  const decision = ecn.decisionComment ? (
    <div>
      <SectionLabel>{t("ecn.detail.decisionComment", "Ghi chú quyết định")}</SectionLabel>
      <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{ecn.decisionComment}</p>
    </div>
  ) : null;

  const overview = (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>{t("ecn.col.type", "Loại")}: <b className="text-foreground">{t(`ecn.type.${ecn.changeType}`, ecn.changeType)}</b></span>
        <span>{t("ecn.col.effectivity", "Hiệu lực")}: <b className="text-foreground">{fmtDate(ecn.effectivityDate)}</b></span>
        {productLabel && <span>{t("ecn.field.product", "Sản phẩm đích")}: <b className="text-foreground">{productLabel}</b></span>}
      </div>
      {ecn.reason && (
        <div>
          <SectionLabel>{t("ecn.field.reason", "Lý do")}</SectionLabel>
          <p className="whitespace-pre-wrap">{ecn.reason}</p>
        </div>
      )}
      <div>
        <SectionLabel>{t("ecn.detail.impact", "Phân tích tác động")}</SectionLabel>
        {impact && (impact.notes || impactList(impact.affectedProducts) || impactList(impact.affectedPrograms) || impactList(impact.affectedLines)) ? (
          <div className="space-y-1 rounded-md border bg-muted/30 p-3">
            {impactList(impact.affectedProducts) && <div>{t("ecn.detail.affectedProducts", "Sản phẩm ảnh hưởng")}: <b>{impactList(impact.affectedProducts)}</b></div>}
            {impactList(impact.affectedPrograms) && <div>{t("ecn.detail.affectedPrograms", "Chương trình ảnh hưởng")}: <b>{impactList(impact.affectedPrograms)}</b></div>}
            {impactList(impact.affectedLines) && <div>{t("ecn.detail.affectedLines", "Dây chuyền ảnh hưởng")}: <b>{impactList(impact.affectedLines)}</b></div>}
            {impact.notes && <p className="whitespace-pre-wrap text-muted-foreground">{impact.notes}</p>}
          </div>
        ) : (
          <p className="text-muted-foreground">{t("ecn.detail.noImpact", "Chưa ghi nhận phân tích tác động.")}</p>
        )}
      </div>
      {decision}
    </div>
  );

  const objects = (
    <div className="space-y-5 text-sm">
      <div>
        <SectionLabel>{t("ecn.detail.target", "Đối tượng đích")}</SectionLabel>
        {productLabel || ecn.targetDescription ? (
          <div className="space-y-1">
            {productLabel && <div>{t("ecn.field.product", "Sản phẩm đích")}: <b>{productLabel}</b></div>}
            {ecn.targetDescription && <p className="whitespace-pre-wrap">{ecn.targetDescription}</p>}
          </div>
        ) : (
          <p className="text-muted-foreground">{t("ecn.detail.noTarget", "Chưa ghi đối tượng đích.")}</p>
        )}
      </div>
      <div>
        <SectionLabel>{t("ecn.detail.items", "Đối tượng chi tiết")}</SectionLabel>
        {itemsQ.isLoading ? (
          <p className="text-muted-foreground">{t("common.loading", "Đang tải…")}</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">{t("ecn.detail.noItems", "Chưa có đối tượng chi tiết nào.")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ecn.item.entity", "Đối tượng")}</TableHead>
                <TableHead>{t("ecn.item.action", "Thao tác")}</TableHead>
                <TableHead>{t("ecn.item.description", "Mô tả")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    <span className="text-muted-foreground">{t(`ecn.type.${it.entityType}`, it.entityType)}</span>{" "}
                    <span className="font-mono text-xs">{it.entityCode ?? (it.entityRef != null ? `#${it.entityRef}` : "—")}</span>
                  </TableCell>
                  <TableCell>{t(`ecn.itemAction.${it.action}`, it.action)}</TableCell>
                  <TableCell className="whitespace-pre-wrap">{it.description ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );

  const approval = (
    <div className="space-y-5 text-sm">
      <p className="text-muted-foreground">{t("ecn.detail.approvalHelp", "Người yêu cầu không được tự xem xét hay phê duyệt; người đã xem xét không được đồng thời phê duyệt.")}</p>
      <div>
        <SectionLabel>{t("ecn.detail.actors", "Người liên quan")}</SectionLabel>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          <span>{t("ecn.detail.requestedBy", "Người yêu cầu")}: <b>{userName(ecn.requestedBy)}</b></span>
          <span>{t("ecn.detail.reviewedBy", "Người xem xét")}: <b>{userName(ecn.reviewedBy)}</b></span>
          <span>{t("ecn.detail.approvedBy", "Người duyệt")}: <b>{userName(ecn.approvedBy)}</b></span>
        </div>
      </div>
      {decision}
    </div>
  );

  const tasks = (
    <div className="space-y-5 text-sm">
      <p className="text-muted-foreground">{t("ecn.detail.tasksHelp", "Sau khi phê duyệt: đánh dấu triển khai khi thay đổi đã được áp dụng, rồi đóng ECN.")}</p>
      <div className="grid grid-cols-1 gap-y-1 sm:grid-cols-2">
        <span>{t("ecn.col.effectivity", "Hiệu lực")}: <b>{fmtDate(ecn.effectivityDate)}</b></span>
        <span>{t("ecn.timeline.implemented", "Triển khai")}: <b>{ecn.implementedAt ? `${fmtDateTime(ecn.implementedAt)} · ${userName(ecn.implementedBy)}` : t("ecn.detail.notYet", "Chưa")}</b></span>
        <span>{t("ecn.timeline.closed", "Đóng")}: <b>{ecn.closedAt ? `${fmtDateTime(ecn.closedAt)} · ${userName(ecn.closedBy)}` : t("ecn.detail.notYet", "Chưa")}</b></span>
      </div>
    </div>
  );

  const history = steps.length === 0 ? (
    <p className="text-sm text-muted-foreground">{t("ecn.detail.noTimeline", "Chưa có mốc thời gian.")}</p>
  ) : (
    <ol className="space-y-2 border-l pl-4 text-sm">
      {steps.map((s) => (
        <li key={s.key} className="relative">
          <span className="absolute -left-[1.35rem] top-1 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">{s.label}</span>
            <span className="text-xs text-muted-foreground">{fmtDateTime(s.at)}</span>
          </div>
          {s.who != null && (
            <div className="text-xs text-muted-foreground">{userName(s.who)}</div>
          )}
        </li>
      ))}
    </ol>
  );

  return (
    <DetailSheet
      headingAs="h3"
      title={ecn.title}
      subtitle={`${ecn.ecnKey} · ${t(`ecn.type.${ecn.changeType}`, ecn.changeType)}`}
      status={<StatusBadge status={ecn.status} variant={ecnStatusVariant(ecn.status)} label={t(`ecn.status.${ecn.status}`, ecn.status)} />}
      actions={actions(ecn)}
      tabs={[
        { value: "overview", label: t("ecn.tab.overview", "Tổng quan"), content: overview },
        { value: "objects", label: t("ecn.tab.objects", "Đối tượng"), content: objects },
        { value: "approval", label: t("ecn.tab.approval", "Duyệt"), content: approval },
        { value: "tasks", label: t("ecn.tab.tasks", "Nhiệm vụ"), content: tasks },
        { value: "history", label: t("ecn.tab.history", "Lịch sử"), content: history },
      ]}
    />
  );
}

/**
 * TASK 3 surface — triggers the EXISTING backfill procedure
 * `trpc.measurementPoint.backfillComponentCodesFromBom` (adminProcedure). Not a
 * reimplementation: this only calls it (dry-run preview → apply) and shows the
 * counts it returns. Doc 81 Đợt 2 Task 4: nội dung nằm trong flyout `ecn-backfill`
 * (tiêu đề ở đầu sheet), không còn là card dưới danh sách.
 */
function ComponentCodeBackfillPanel({ products }: { products: Product[] }) {
  const { t } = useTranslation();
  const pid = useId();
  const [productId, setProductId] = useState<string>("");
  const [result, setResult] = useState<null | { matched: number; updated: number; skippedAlreadyLinked: number; unmatched: any[]; bomDefinitionId: number | null; dryRun: boolean }>(null);

  // Access defensively so this compiles even if the proc path shifts.
  const mpApi = (trpc as any).measurementPoint;
  const backfillM = mpApi?.backfillComponentCodesFromBom?.useMutation?.({
    onSuccess: (r: any) => {
      setResult(r);
      const counts = { matched: r?.matched ?? 0, updated: r?.updated ?? 0 };
      toast.success(r?.dryRun
        ? t("ecn.backfill.doneDryRun", "Xem trước (dry-run) — khớp {{matched}}, sẽ cập nhật {{updated}}", counts)
        : t("ecn.backfill.done", "Đã bổ sung — khớp {{matched}}, đã cập nhật {{updated}}", counts));
    },
    onError: (e: any) => toast.error(mapTrpcError(e)),
  });

  const run = (dryRun: boolean) => {
    if (!productId) { toast.error(t("ecn.backfill.pickProduct", "Hãy chọn một sản phẩm trước")); return; }
    if (!backfillM) { toast.error(t("ecn.backfill.unavailable", "Chức năng bổ sung hiện không khả dụng")); return; }
    setResult(null);
    backfillM.mutate({ productModelId: Number(productId), dryRun });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={pid}>{t("ecn.backfill.product", "Sản phẩm")}</Label>
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger id={pid}><SelectValue placeholder={t("ecn.backfill.selectProduct", "Chọn sản phẩm…")} /></SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>{p.code || p.name || `#${p.id}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={backfillM?.isPending} onClick={() => run(true)}>
          {t("ecn.backfill.dryRun", "Xem trước (dry-run)")}
        </Button>
        <Button disabled={backfillM?.isPending} onClick={() => run(false)}>
          {t("ecn.backfill.apply", "Áp dụng bổ sung")}
        </Button>
      </div>
      {result && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex flex-wrap gap-4">
            <span>{t("ecn.backfill.bom", "BOM")}: <b>{result.bomDefinitionId ?? "—"}</b></span>
            <span>{t("ecn.backfill.matched", "Khớp")}: <b>{result.matched}</b></span>
            <span>{t("ecn.backfill.updated", "Đã cập nhật")}: <b>{result.updated}</b></span>
            <span>{t("ecn.backfill.skipped", "Đã liên kết")}: <b>{result.skippedAlreadyLinked}</b></span>
            <span>{t("ecn.backfill.unmatched", "Chưa khớp")}: <b>{result.unmatched?.length ?? 0}</b></span>
            {result.dryRun && <span className="text-amber-600">{t("ecn.backfill.dryRunTag", "(dry-run — chưa ghi gì)")}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
