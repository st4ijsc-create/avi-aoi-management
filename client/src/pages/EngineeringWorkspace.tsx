/**
 * Doc 09 / Phase D1 — Device Programming & Control: UNIFIED ENGINEERING WORKSPACE.
 *
 * The IDE surface for authoring device PROGRAMS (Zmotion BASIC / G-code / native
 * IEC 61131-3 / robot job-lists / vendor engineering) in the platform, then
 * validate → build → simulate → (HITL sign-off) staged DEPLOY → rollback — all over
 * the programmingRouter (Phase D0).
 *
 * ADDITIVE + READ-OPEN: authoring + validate + build + simulate are always safe (no
 * device I/O). DEPLOY is gated server-side by DPC_DEPLOY_ENABLED + HITL sign-off; when
 * the flag is off the UI shows a banner and a deploy is recorded as 'simulated'.
 * RBAC reuses the control-plane modules: view = machine_monitoring, write = machine_control.
 *
 * D1 ships a dependency-free <CodeEditor>; a richer editor (Monaco) can drop in later
 * behind that component boundary. Real language adapters (Zmotion, ...) land in D2+.
 *
 * doc 81 Đợt 2 Task 13 — bố cục P1 "Workbench" (doc 81 §1.3, sơ đồ "IDE mục tiêu"; EngineeringShell, full-bleed):
 *  - Top bar MỘT hàng (PageHeaderCompact, h1): dự án/phiên bản · chip cờ "Triển khai thật" (4 trạng thái, không tên
 *    biến môi trường) · pipeline chips · trạng thái review · "Khi nào dùng" (popover + link IR/POU) · Lưu · Kiểm tra ·
 *    Build · Mô phỏng · Deploy… · Sổ tay.
 *  - TRÁI (activity bar + Explorer): Dự án / Phiên bản / Tags-IO / Deploy. MAIN (`data-layout-main`): tab editor
 *    nguồn (CodeMirror cao hết vùng) / Ladder-Teach / Δ so sánh / Tags. PHẢI: [Thuộc tính | Copilot] — Copilot là
 *    panel TRONG layout trên lõi dùng chung `ProgrammingCopilotCore` (không dock cố định, không body.paddingRight —
 *    R-2-b; dock đã gỡ ở Task 14); nút AI top bar mở/đưa focus vào panel (R-2-j). DƯỚI (gập ở lần đầu, mở theo ý định —
 *    R-2-l): Vấn đề / Build-Mô phỏng / Lịch sử deploy / Ma trận máy×version. Thanh trạng thái: Ln/Col · ngôn ngữ ·
 *    adapter · "Triển khai thật: ON/OFF" · số vấn đề · Copilot.
 *  - Deploy = wizard 4 bước (WizardDialog): Build · Đích & canary · Ký duyệt · Xem trước & xác nhận. deployPreview ở
 *    bước cuối TRƯỚC OTP; OTP = stepUp.guard của trang (R-2-q); mỗi lượt xác nhận gửi đúng đích/cổng/expectedProjectId
 *    như hai thẻ cũ (R-2-n, R-2-r). Bỏ card "Trợ lý Lập trình AI" (lối vào AI thứ 3). Tạo dự án / sửa biến / gắn thiết
 *    bị: sheet phải (thay dialog giữa màn). Rollback / xoá biến / bỏ thay đổi: giữ AlertDialog (xác nhận phá huỷ).
 */
import { useEffect, useMemo, useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { computeIsDirty } from "@/lib/engineeringBuffer";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link, useSearch } from "wouter";
import { useEngineering } from "@/contexts/EngineeringContext";
import { parseDeepLink, withParams } from "@/lib/engineeringDeepLink";
import DashboardLayout from "@/components/DashboardLayout";
import { useShellPageVariant } from "@/lib/shellPage";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeaderCompact, NoticeChip, FeatureStatusNoticeChip, WizardDialog, RollbackConfirm } from "@/components/patterns";
import { useUrlParam } from "@/components/patterns/useUrlParam";
import { EngineeringShell } from "@/components/engineering/shell";
import { CodeEditor } from "@/components/engineering/CodeEditor";
import { LadderEditor } from "@/components/engineering/LadderEditor";
import { TeachJogPanel } from "@/components/engineering/TeachJogPanel";
// Doc 69 · Wave 2 / C — page-cited vendor-manual lookup (doc 37 B1), now reaching the actual
// code-authoring surface (previously only on AndonBoard/DeviceAdapterManagement — no screen
// where an engineer TYPES a program had it).
import ManualHelp from "@/components/ManualHelp";
// Doc 34 · P3 — embed the in-app Programming Copilot (LLM codegen, validated by the substrate).
import { COPILOT_KINDS, type CopilotKind } from "@/components/programming/ProgrammingCopilotPanel";
import { ProgrammingCopilotCore } from "@/components/programming/ProgrammingCopilotCore";
import { useCopilotBinding, useProgrammingCopilot, type CopilotBinding } from "@/contexts/ProgrammingCopilotContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LineDiff } from "@/components/diff/LineDiff";
import {
  Code2, Plus, FolderGit2, FileCode, Play, Hammer, FlaskConical, Rocket,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, Variable, ShieldCheck,
  Radio, Trash2, Pencil, Wifi, WifiOff, RotateCcw, GitCompare, Info,
  Check, Circle, Sparkles, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useEngineeringStream } from "@/hooks/useEngineeringStream";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useActuationReadiness } from "@/hooks/useActuationReadiness";
import { useStepUpOtp } from "@/components/security/StepUpOtpDialog";
import { deployOutcome, newDeployAttemptKey } from "./engineeringDeployOutcome";
// doc 80 Đợt 1 Task 5 — duyệt phiên bản trong IDE (WS-01) + bản xem trước deploy trước OTP (F2).
import { VersionReviewPanel, ReviewStatusBadge } from "@/components/engineering/VersionReviewPanel";
import { DeployPreviewPanel, type DeployPreviewView } from "@/components/engineering/DeployPreviewPanel";
import { progDiagText } from "@/components/engineering/progDiagText";
import {
  deriveFeatureStatus,
  featureStatusLabel,
} from "@/components/common/FeatureStatusGate";
// doc 81 Đợt 2 Task 12 — state UI của trang nằm trong WorkspaceContext + reducer thuần (chuỗi reset
// đổi project/phiên bản/build ở MỘT chỗ, có test); trang chỉ đọc state và gửi hành động.
import {
  fieldSetters,
  KIND_LANGUAGE,
  KIND_LANGUAGES,
  KINDS,
  useWorkspace,
  WorkspaceProvider,
  type ActivityId,
  type BottomTabId,
  type DeployWizardMode,
  type Diagnostic,
  type EditorTabId,
  type Kind,
} from "@/components/engineering/workspace";

/**
 * U14 (doc 26 §3.2) → doc 81 Đợt 2 Task 13 — PIPELINE CHIPS luồng vàng (thay stepper sticky): Soạn · Kiểm tra · Build ·
 * Mô phỏng · Deploy. Chỉ HIỂN THỊ tiến độ (đọc từ state hiện có, không tự chạy gì); nằm trên top bar cùng hàng h1.
 */
type PipelineStep = { key: string; label: string; done: boolean; Icon: typeof CheckCircle2 };

function PipelineChips({ steps, t }: { steps: PipelineStep[]; t: TFunction }) {
  // Chip gọn (icon + dấu xong/chưa; nhãn trong title + sr-only) để top bar một hàng vừa 1366 px.
  return (
    <ol aria-label={t("engineering.gtNav", "Golden thread progress")} className="hidden shrink-0 items-center gap-0.5 xl:flex">
      {steps.map((s) => {
        const state = s.done ? t("engineering.ws.stepDone", "xong") : t("engineering.ws.stepTodo", "chưa");
        return (
          <li
            key={s.key}
            data-step={s.key}
            data-done={s.done ? "1" : "0"}
            title={`${s.label}: ${state}`}
            className={`inline-flex h-6 items-center gap-0.5 rounded-full border px-1.5 text-[11px] ${
              s.done ? "border-success/40 bg-success/10 text-success" : "text-muted-foreground"
            }`}
          >
            <s.Icon className="h-3 w-3" aria-hidden="true" />
            {s.done ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : <Circle className="h-2 w-2" aria-hidden="true" />}
            <span className="sr-only">{s.label} ({state})</span>
          </li>
        );
      })}
    </ol>
  );
}

function rid(prefix: string): string {
  // Non-crypto unique-ish id for idempotency/action keys (UI-side).
  return `${prefix}-${Date.now()}-${Math.floor(performance.now())}`;
}

function EngineeringWorkspaceView() {
  const { t } = useTranslation();
  const { state, dispatch } = useWorkspace();
  // Task 12b fix round 1 (review Minor 5) — lựa chọn HIỆN TẠI cho onSuccess về muộn: kết quả mà reducer
  // sẽ BỎ (lệch phiên bản/build) thì cũng không toast "Build OK / Có lỗi / Đã mô phỏng" — câu ấy nói về
  // một phiên bản/build khác cái đang hiện. onError KHÔNG lọc (lỗi thật luôn hiện).
  const luaChonRef = useRef(state);
  luaChonRef.current = state;
  const {
    projectId, artifactId, buildId, diagnostics, simResult, watching,
    code, language, editorMode, diffBaseId, diffCompareId,
    pendingNav, deleteSymTarget, rollbackTarget, demoCreating,
  } = state;
  const { search: projSearch, kindFilter: projKindFilter } = state.explorer;
  const {
    open: symOpen, id: symId, name: symName, addr: symAddr, type: symType,
    comment: symComment, watchable: symWatchable,
  } = state.sym;
  const { open: npOpen, code: npCode, name: npName, kind: npKind, deviceId: npDeviceId } = state.newProject;
  const { open: attachOpen, deviceId: attachDeviceId } = state.attach;
  const { stage: deployStage, signOff, approverId, reason: deployReason } = state.deploy;
  const {
    deviceIds: fleetDeviceIds, stage: fleetStage, signOff: fleetSignOff, canary: fleetCanary,
    promoteVerified: fleetPromoteVerified, autoRollback: fleetAutoRollback,
    approverId: fleetApproverId, reason: fleetReason,
  } = state.fleet;
  // Setter ổn định cho trường form thuần (không thuộc chuỗi reset) — tên giữ như useState cũ.
  const {
    setProjSearch, setProjKindFilter, setCode, setLanguage, setEditorMode, setDiffBaseId, setDiffCompareId,
    setNpOpen, setNpCode, setNpName, setNpKind, setNpDeviceId, setAttachOpen, setAttachDeviceId,
    setSymOpen, setSymName, setSymAddr, setSymType, setSymComment, setSymWatchable,
    setDeployStage, setSignOff, setApproverId, setDeployReason,
    setFleetStage, setFleetSignOff, setFleetCanary, setFleetPromoteVerified, setFleetAutoRollback,
    setFleetApproverId, setFleetReason,
  } = useMemo(() => fieldSetters(dispatch), [dispatch]);
  // doc 81 Đợt 2 Task 2 — màn workbench: rail trái mặc định thu gọn (nhớ theo người dùng).
  // doc 81 Đợt 2 Task 13 — đã chuyển sang EngineeringShell ⇒ "full-bleed": rail trái thu gọn, <main> không đệm.
  useShellPageVariant("full-bleed");
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const canView = hasPermission("machine_monitoring", "canView");
  const canCreate = hasPermission("machine_control", "canCreate");
  const canEdit = hasPermission("machine_control", "canEdit");
  const canDelete = hasPermission("machine_control", "canDelete");

  const utils = trpc.useUtils();
  const statusQ = trpc.programming.status.useQuery(undefined, { enabled: canView });
  // Doc 80 Task 1 (PLT-02/G-07/X-07) — live evidence 2026-09-25: while `statusQ` was still
  // loading, the old `?? false` default made the badge/banner assert "Triển khai: OFF" +
  // name the env var, as if that were a known fact, then flip to ON seconds later. A
  // pending/erroring query is UNKNOWN, not "off".
  const deployStatus = deriveFeatureStatus(statusQ, (d: { deployEnabled?: boolean }) => d.deployEnabled);
  const deployEnabled = deployStatus === "on";
  const streamingEnabled = statusQ.data?.streamingEnabled ?? false;
  // doc 40 ENG-F2 — khi bật, deploy production đi qua Approval Inbox (request→approve).
  const deployApprovalEnabled = statusQ.data?.deployApprovalEnabled ?? false;
  const adapters = statusQ.data?.adapters ?? [];
  // doc 80 Đợt 1 Task 5 (WS-01) — four-eyes-at-version: cờ TẮT ⇒ không một phần tử review nào.
  const versionReviewEnabled = statusQ.data?.versionReviewEnabled === true;
  // doc 40 ENG-F13 — pre-flight: cảnh báo TRƯỚC nếu user thiếu 2FA / quyền để deploy (actuation).
  const readiness = useActuationReadiness();

  // U4 (doc 26 §2.4) — lý do khoá nút ghi để KTV biết cần xin quyền hay bật cờ.
  const createReason = !canCreate
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;
  const editReason = !canEdit
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;

  const projectsQ = trpc.programming.listProjects.useQuery(undefined, { enabled: canView });
  // U2 (doc 26) — danh sách máy để gắn "thiết bị nguồn" cho project (mở khoá Online Monitor).
  const machinesQ = trpc.machine.list.useQuery(undefined, { enabled: canView });
  const machineLabel = (id: number | null | undefined) => {
    const m = machinesQ.data?.find((x) => x.id === id);
    return m ? `${m.name} · #${m.id}` : id != null ? `#${id}` : "";
  };
  const project = useMemo(
    () => projectsQ.data?.find((p) => p.id === projectId) ?? null,
    [projectsQ.data, projectId],
  );

  // U13 (doc 26 §2.2) — tìm/lọc client cho Project Explorer (tên/mã + loại thiết bị).
  const filteredProjects = useMemo(() => {
    const q = projSearch.trim().toLowerCase();
    return (projectsQ.data ?? []).filter((p) => {
      if (projKindFilter !== "all" && p.kind !== projKindFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q)
      );
    });
  }, [projectsQ.data, projSearch, projKindFilter]);

  // U1 (doc 26) — deep-link ?projectId= là nguồn chính; store lastSelected là fallback.
  // Áp dụng MỘT LẦN, chỉ khi list đã tải & project tồn tại (tránh chọn id "mồ côi").
  const search = useSearch();
  const deepLink = useMemo(() => parseDeepLink(search), [search]);
  // doc 81 Đợt 2 Task 15 — `?copilot=scratch` = CHẾ ĐỘ SCRATCH (trang /programming-copilot cũ, URL cũ chuyển hướng giữ
  // query): Copilot mở trong layout, KHÔNG tự mở dự án nhớ lần trước (chỉ `?projectId=` tường minh mới mở dự án).
  const [copilotParam, setCopilotParam] = useUrlParam("copilot");
  const scratchMode = copilotParam === "scratch";
  const { lastSelected, setLastProjectId } = useEngineering();
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const wanted = deepLink.projectId ?? (scratchMode ? null : lastSelected.projectId);
    if (wanted == null) { deepLinkApplied.current = true; return; }
    if (!projectsQ.data) return; // đợi list
    deepLinkApplied.current = true;
    if (projectsQ.data.some((p) => p.id === wanted)) dispatch({ type: "project/select", projectId: wanted });
  }, [deepLink.projectId, lastSelected.projectId, projectsQ.data]);

  const artifactsQ = trpc.programming.listArtifacts.useQuery(
    { projectId: projectId! },
    { enabled: canView && projectId != null },
  );
  const artifact = useMemo(
    () => artifactsQ.data?.find((a) => a.id === artifactId) ?? null,
    [artifactsQ.data, artifactId],
  );

  // ── W3-11: version diff (chọn 2 phiên bản) + rollback deployment ──
  // doc 80 WS-04 — rollbackTarget.attemptKey sinh MỚI mỗi lần MỞ hộp xác nhận (ổn định trong lượt đó).
  const diffBase = useMemo(() => artifactsQ.data?.find((a) => a.id === diffBaseId) ?? null, [artifactsQ.data, diffBaseId]);
  const diffCompare = useMemo(() => artifactsQ.data?.find((a) => a.id === diffCompareId) ?? null, [artifactsQ.data, diffCompareId]);

  // Editor buffer (loaded from the selected artifact; dirty until saved as a new version).
  useEffect(() => {
    if (artifact) {
      dispatch({ type: "buffer/loadArtifact", code: artifact.content ?? "", language: artifact.language });
    } else if (project) {
      // U9 — chưa chọn phiên bản: mặc định ngôn ngữ đúng theo loại dự án.
      dispatch({ type: "buffer/defaultLanguage", language: KIND_LANGUAGE[project.kind as Kind] ?? "text" });
    }
  }, [artifact?.id, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // U9 — tập token cho Select; kèm giá trị hiện tại nếu là token cũ ngoài tập (data legacy).
  const langOptions = useMemo(() => {
    const set = KIND_LANGUAGES[project?.kind as Kind] ?? ["text"];
    return language && !set.includes(language) ? [...set, language] : set;
  }, [project?.kind, language]);

  // Buffer khác bản đã lưu → chưa lưu. Validate/Build luôn chạy trên artifactId (bản đã lưu),
  // nên khi dirty phải chặn/ cảnh báo để không kiểm tra nhầm phiên bản cũ (doc 25 T3).
  const isDirty = computeIsDirty(code, artifact?.content);

  // Chọn phiên bản/dự án khác lúc dirty sẽ ghi đè buffer → xác nhận qua AlertDialog (DS).
  // Hành động điều hướng bị HOÃN vào pendingNav; chỉ chạy khi người dùng xác nhận bỏ thay đổi.
  const guardDirty = (action: () => void) => {
    if (isDirty) dispatch({ type: "nav/guard", run: action });
    else action();
  };
  // Xác nhận xóa một biến khỏi bảng tag (thay window.confirm bằng AlertDialog): state.deleteSymTarget.

  // Chặn Validate/Build khi còn chỉnh sửa chưa lưu (kết quả sẽ thuộc phiên bản cũ).
  const requireSaved = (): boolean => {
    if (isDirty) {
      toast.warning(t("engineering.saveBeforeCheck", "Lưu phiên bản trước khi kiểm tra/build"));
      return false;
    }
    return true;
  };

  const buildsQ = trpc.programming.listBuilds.useQuery(
    { artifactId: artifactId! },
    { enabled: canView && artifactId != null },
  );
  // doc 80 WS-05 — đổi phiên bản đang chọn HOẶC lưu phiên bản mới (createArtifact đặt
  // artifactId mới) ⇒ bỏ build/mô phỏng/chẩn đoán của phiên bản cũ, để Deploy/Fleet không đẩy
  // build của một phiên bản KHÁC phiên bản đang hiển thị. doc 81 Đợt 2 Task 12: hệ quả này nay là
  // hành động "artifact/select" của workspaceReducer (trước là useEffect theo [artifactId]).

  const deploymentsQ = trpc.programming.listDeployments.useQuery(
    { projectId: projectId! },
    { enabled: canView && projectId != null },
  );
  const symbolsQ = trpc.programming.listSymbols.useQuery(
    { projectId: projectId! },
    { enabled: canView && projectId != null },
  );
  // doc 40 W5 §11 — ma trận máy × version (máy nào đang chạy artifact/hash nào).
  const fleetMatrixQ = trpc.programming.fleetVersionMatrix.useQuery(
    { projectId: projectId! },
    { enabled: canView && projectId != null },
  );

  // ── Mutations ──
  const createProject = trpc.programming.createProject.useMutation({
    onSuccess: (row) => {
      toast.success(t("engineering.projectCreated", "Đã tạo project"));
      utils.programming.listProjects.invalidate();
      // doc 81 Đợt 2 Task 12b (R-2-r) — dự án MỚI mở SẠCH như bấm chọn (kể cả đường DEMO): không
      // giữ phiên bản/build/mô phỏng/chẩn đoán của dự án trước ⇒ Deploy/Fleet không thể đẩy build cũ.
      dispatch({ type: "project/select", projectId: row.id });
    },
    onError: (e) => toastTrpcError(e),
  });
  // U2 (doc 26) — gắn / đổi thiết bị nguồn cho project đang mở (set project.deviceId).
  const updateProject = trpc.programming.updateProject.useMutation({
    onSuccess: () => {
      toast.success(t("engineering.deviceAttached", "Đã cập nhật thiết bị nguồn"));
      utils.programming.listProjects.invalidate();
      dispatch({ type: "attach/set", patch: { open: false } });
    },
    onError: (e) => toastTrpcError(e),
  });
  const createArtifact = trpc.programming.createArtifact.useMutation({
    onSuccess: (row, vars) => {
      toast.success(t("engineering.versionSaved", "Đã lưu phiên bản v") + row.version);
      utils.programming.listArtifacts.invalidate();
      // Task 12b — gắn project lúc YÊU CẦU: đã chuyển project trong lúc lưu ⇒ không chọn phiên bản ấy.
      dispatch({ type: "artifact/created", projectId: vars.projectId, artifactId: row.id });
    },
    onError: (e) => toastTrpcError(e),
  });
  const validateM = trpc.programming.validateArtifact.useMutation({
    onSuccess: (r, vars) => {
      dispatch({ type: "diagnostics/set", artifactId: vars.artifactId, diagnostics: r.diagnostics as Diagnostic[] });
      utils.programming.listArtifacts.invalidate();
      if (vars.artifactId !== luaChonRef.current.artifactId) return; // kết quả bị bỏ ⇒ không toast
      r.ok ? toast.success(t("engineering.validOk", "Hợp lệ")) : toast.warning(t("engineering.validErr", "Có lỗi"));
    },
    onError: (e) => toastTrpcError(e),
  });
  // doc 80 Đợt 1 Task 5 (WS-01) — duyệt / từ chối (bắt buộc lý do) / yêu cầu duyệt phiên bản.
  const reviewM = trpc.programming.reviewArtifact.useMutation({
    onSuccess: (row) => {
      utils.programming.listArtifacts.invalidate();
      utils.programming.deployPreview.invalidate();
      if (row?.reviewStatus === "rejected") toast.warning(t("engineering.review.rejectedToast", "Đã từ chối phiên bản"));
      else toast.success(t("engineering.review.approvedToast", "Đã duyệt phiên bản"));
    },
    onError: (e) => toastTrpcError(e),
  });
  const requestReviewM = trpc.programming.requestVersionReview.useMutation({
    onSuccess: () => {
      utils.programming.listArtifacts.invalidate();
      toast.success(t("engineering.review.requestedToast", "Đã gửi yêu cầu duyệt"));
    },
    onError: (e) => toastTrpcError(e),
  });
  const buildM = trpc.programming.buildArtifact.useMutation({
    onSuccess: (b, vars) => {
      utils.programming.listBuilds.invalidate();
      // Task 12b — build của phiên bản đã RỜI (đổi phiên bản/project lúc đang build) ⇒ không chọn.
      const hienTai = vars.artifactId === luaChonRef.current.artifactId;
      dispatch({ type: "build/created", artifactId: vars.artifactId, buildId: b.id });
      if (!hienTai) return; // kết quả bị bỏ ⇒ không toast
      b.ok ? toast.success(t("engineering.buildOk", "Build OK")) : toast.error(t("engineering.buildFail", "Build lỗi"));
    },
    onError: (e) => toastTrpcError(e),
  });
  const simulateM = trpc.programming.simulateBuild.useMutation({
    onSuccess: (r, vars) => {
      dispatch({ type: "sim/set", buildId: vars.buildId, simResult: { ok: r.ok, warnings: r.warnings as string[], timeline: r.timeline as any[] } });
      utils.programming.deployPreview.invalidate();
      if (vars.buildId !== luaChonRef.current.buildId) return; // kết quả bị bỏ ⇒ không toast
      toast.success(t("engineering.simDone", "Đã mô phỏng"));
    },
    onError: (e) => toastTrpcError(e),
  });
  // doc 54 P3.2 — step-up 2FA (fresh OTP) for deploy actuation when ACTUATION_STEPUP_2FA is on.
  const stepUp = useStepUpOtp();
  // doc 40 (Minh ui-fix) + doc 80 WS-04 — báo toast THEO trạng thái THẬT (status) của hàng
  // server trả về, không chỉ theo cờ `simulated` / không luôn "thành công".
  const showDeployOutcome = (
    row: { status: string; error?: string | null; targetRolledBack?: boolean; detailJson?: unknown },
    kind: "deploy" | "request" | "rollback",
  ) => {
    const o = deployOutcome(row, kind);
    const msg = t(o.key, o.fallback);
    // doc 81 Đợt 1B Task 4 — lý do có mã (vd robot-tm chưa hỗ trợ tải chương trình) ⇒ câu dịch.
    const detailText = o.detailKey ? t(o.detailKey, o.detail ?? "") : o.detail;
    const text = detailText ? `${msg}: ${detailText}` : msg;
    if (o.level === "error") toast.error(text);
    else if (o.level === "warning") toast.warning(text);
    else if (o.level === "info") toast.info(text);
    else toast.success(text);
  };
  // doc 81 Đợt 2 Task 13 — lượt gửi từ wizard đã có kết quả ⇒ đóng wizard và MỞ panel dưới ở "Lịch sử deploy" (ý định
  // rõ của người dùng — R-2-l) để thấy hàng vừa ghi / kết quả rollout. Chỉ là UI; invalidate + toast giữ nguyên.
  const showDeployResultInPanel = () => {
    dispatch({ type: "wizard/close" });
    dispatch({ type: "ui/bottom", tab: "deploys", open: true });
  };
  const deployM = trpc.programming.deployBuild.useMutation({
    onSuccess: (d) => {
      utils.programming.listDeployments.invalidate();
      utils.programming.deployPreview.invalidate();
      showDeployOutcome(d, "deploy");
      showDeployResultInPanel();
    },
    onError: (e) => toastTrpcError(e),
  });
  // doc 40 ENG-F2 — gửi YÊU CẦU deploy production (request→approve). Không tự deploy: tạo
  // hàng chờ duyệt để người thứ hai ký ở Approval Inbox (đóng lỗ four-eyes hình thức).
  const requestDeployApprovalM = trpc.programming.requestDeployApproval.useMutation({
    onSuccess: (d) => {
      utils.programming.listDeployments.invalidate();
      showDeployOutcome(d, "request");
      showDeployResultInPanel();
    },
    onError: (e) => toastTrpcError(e),
  });
  // W3-11 — rollback: ghi một deployment MỚI về build của lần deploy thành công trước.
  const rollbackM = trpc.programming.rollbackDeployment.useMutation({
    onSuccess: (d) => {
      utils.programming.listDeployments.invalidate();
      dispatch({ type: "rollback/close" });
      // doc 80 WS-03/04 — chỉ báo "đã khôi phục" khi server thật sự đánh đích rolled_back.
      showDeployOutcome(d, "rollback");
    },
    onError: (e) => { dispatch({ type: "rollback/close" }); toastTrpcError(e); },
  });
  // doc 40 W5 §11 — triển khai đội máy (canary): tuần tự qua đúng deployBuild từng máy.
  const deployToFleetM = trpc.programming.deployToFleet.useMutation({
    onSuccess: (r) => {
      utils.programming.listDeployments.invalidate();
      utils.programming.fleetVersionMatrix.invalidate();
      if (r.halted && r.haltCode === "canary_not_real") {
        // doc 81 Đợt 1B Task 3 — canary chỉ giả lập không được promote sang máy ghi thật.
        toast.error(t("engineering.fleetNeedsRealCanary", "Rollout đã DỪNG: canary chỉ giả lập (không ghi xuống thiết bị) nên không được tính là đạt khi promote sẽ ghi thật. Cần một canary thật (deployed/verified)."));
      } else if (r.halted) {
        toast.error(r.haltReason || t("engineering.fleetHalted", "Rollout đã DỪNG do canary không đạt"));
      } else if (r.promoted) {
        toast.success(t("engineering.fleetPromoted", "Canary đạt — đã promote toàn đội máy"));
      } else {
        toast.success(t("engineering.fleetCanaryOk", "Canary đã chạy xong"));
      }
      showDeployResultInPanel();
    },
    onError: (e) => toastTrpcError(e),
  });
  const fleetResult = deployToFleetM.data ?? null;

  // ── Symbols (tag table) CRUD — feeds Online Monitor ──
  const upsertSymbol = trpc.programming.upsertSymbol.useMutation({
    onSuccess: () => {
      toast.success(t("engineering.symbolSaved", "Đã lưu biến"));
      utils.programming.listSymbols.invalidate();
      dispatch({ type: "sym/set", patch: { open: false } });
    },
    onError: (e) => toastTrpcError(e),
  });
  const deleteSymbol = trpc.programming.deleteSymbol.useMutation({
    onSuccess: () => {
      toast.success(t("engineering.symbolDeleted", "Đã xóa biến"));
      utils.programming.listSymbols.invalidate();
    },
    onError: (e) => toastTrpcError(e),
  });

  // ── Online Monitor (watch) — start/stop server watch session + subscribe live room ──
  // Đổi project → dừng watch (session gắn theo project) để không rò session cũ: hệ quả của
  // "project/select" trong workspaceReducer (trước là useEffect theo [projectId]).
  const startWatchM = trpc.programming.startWatch.useMutation({
    onSuccess: (r) => {
      if (r.started) {
        dispatch({ type: "watch/set", watching: true });
        toast.success(t("engineering.watchStarted", "Đã mở phiên theo dõi"));
      } else {
        dispatch({ type: "watch/set", watching: false });
        const msg =
          r.reason === "no_device"
            ? t("engineering.watchNoDevice", "Dự án chưa gắn thiết bị — không có nguồn để đọc")
            : r.reason === "streaming_disabled"
              ? t("engineering.watchDisabled", "DPC_STREAMING_ENABLED đang TẮT — không mở được luồng")
              : t("engineering.watchNotStarted", "Không mở được phiên theo dõi");
        toast.warning(msg);
      }
    },
    onError: (e) => toastTrpcError(e),
  });
  const stopWatchM = trpc.programming.stopWatch.useMutation({
    onSuccess: () => dispatch({ type: "watch/set", watching: false }),
    onError: (e) => toastTrpcError(e),
  });
  // Subscribe socket room `engineering:{deviceId}` khi đang watch (chỉ đọc giá trị live).
  const { values: liveValues, lastUpdate, connected: streamConnected } = useEngineeringStream(
    project?.deviceId ?? null,
    watching,
  );

  // ── Symbol editor dialog (thêm/sửa một biến) — state.sym ──
  const openSymDialog = (s?: {
    id: number; name: string; address: string | null; dataType: string | null;
    comment: string | null; watchable: boolean;
  }) => dispatch({ type: "sym/open", symbol: s });

  // U7 (doc 26 §2.1) — cờ đang tạo dự án DEMO một chạm (onboarding KTV mới): state.demoCreating.
  // Create-project dialog: state.newProject (U2 — deviceId "" = chưa gắn thiết bị nguồn).

  // ── U2: Attach-device dialog (gắn/đổi thiết bị nguồn cho project đang mở) — state.attach ──
  const openAttachDialog = () =>
    dispatch({ type: "attach/open", deviceId: project?.deviceId != null ? String(project.deviceId) : "" });

  // ── Deploy form — state.deploy (W2-9: second-approver SoD cho production + lý do bắt buộc) ──
  const approversQ = trpc.programming.listApprovers.useQuery(undefined, { enabled: canView });
  // Loại chính người yêu cầu ra khỏi danh sách (không được tự ký).
  const approverOptions = useMemo(
    () => (approversQ.data ?? []).filter((a) => a.id !== user?.id),
    [approversQ.data, user?.id],
  );
  const isProd = deployStage === "production";
  // doc 40 ENG-F2 — production qua Approval Inbox: chỉ cần lý do (không tự chọn approver nữa).
  const useApprovalFlow = isProd && deployApprovalEnabled;
  const prodDeployReady = !isProd
    ? true
    : useApprovalFlow
      ? deployReason.trim().length > 0
      : approverId !== "" && deployReason.trim().length > 0;
  // doc 80 Đợt 1 Task 5 (F2) — người ký mà lượt deploy SẮP gửi (y hệt đối số deployM.mutate bên
  // dưới) ⇒ bản xem trước chạy khô ĐÚNG lượt ấy. Hộp duyệt: người ký là approver tương lai.
  const pendingConfirmedBy = isProd
    ? (useApprovalFlow ? undefined : approverId ? Number(approverId) : undefined)
    : (signOff && user?.id ? user.id : undefined);
  // doc 81 Đợt 2 Task 12b (R-2-r) — IDE LUÔN nói "build này thuộc dự án đang mở" (expectedProjectId):
  // server từ chối có mã nếu lệch, TRƯỚC OTP/sổ/thiết bị. Cùng giá trị ở preview / deploy / yêu cầu
  // duyệt / đội máy.
  const expectedProjectId = projectId ?? undefined;
  const deployPreviewQ = trpc.programming.deployPreview.useQuery(
    { buildId: buildId!, stage: deployStage, confirmedBy: pendingConfirmedBy, expectedProjectId },
    { enabled: canView && buildId != null },
  );
  const previewBlocked = deployPreviewQ.data?.verdict === "blocked";

  // ── doc 40 W5 §11 — Triển khai đội máy (fleet rollout canary) — state.fleet ──
  const fleetIsProd = fleetStage === "production";
  const toggleFleetDevice = (id: number) => dispatch({ type: "fleet/toggleDevice", deviceId: id });
  const fleetReady =
    fleetDeviceIds.length > 0 &&
    (!fleetIsProd || (fleetApproverId !== "" && fleetReason.trim().length > 0));
  // Đổi project → xóa lựa chọn đội máy (tránh giữ id máy của project cũ): hệ quả của
  // "project/select" trong workspaceReducer (trước là useEffect theo [projectId]).

  // ── Editor mode: a visual editor exists for ladder (rung grid) + robot (teach/jog) — state.editorMode ──
  const visualKind =
    project?.kind === "iec61131-ld" ? "ladder" : project?.kind === "robot-tm" ? "teach" : null;

  // Doc 34 · P3 — embedded AI Programming Copilot (collapsible, unobtrusive). Seeded with the
  // current editor buffer as context; Apply inserts the generated code into this editor. Only
  // the 8 copilot-supported kinds map to a source kind (else the panel picks its own default).
  const copilotInitialKind = useMemo<CopilotKind | undefined>(() => {
    const k = project?.kind;
    return k && (COPILOT_KINDS as readonly string[]).includes(k) ? (k as CopilotKind) : undefined;
  }, [project?.kind]);

  // doc 41 — publish this editor to the Programming Copilot: the live buffer as context, build/validate diagnostics for
  // inline "explain / fix" actions, and Apply inserts generated code back into the editor. Clears on unmount.
  // doc 81 Đợt 2 Task 13 (R-2-b) — IDE vẽ Copilot TRONG layout (inspector phải, lõi dùng chung ProgrammingCopilotCore);
  // dock cố định đã gỡ ở Task 14. `open` của context = tab Copilot đang mở (nút AI top bar mở/đóng nó — R-2-j).
  const { open: copilotOpen, setOpen: setCopilotOpen } = useProgrammingCopilot();
  // Task 15 — vào chế độ scratch ⇒ mở tab Copilot (một lần); đã có dự án ⇒ rời chế độ scratch (tham số rời URL, giữ
  // các tham số khác) để F5 mở lại đúng dự án như luồng thường.
  const scratchOpenedRef = useRef(false);
  useEffect(() => {
    if (scratchMode && !scratchOpenedRef.current) {
      scratchOpenedRef.current = true;
      setCopilotOpen(true);
    }
  }, [scratchMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (scratchMode && project) setCopilotParam(null);
  }, [scratchMode, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const copilotBinding = useMemo<CopilotBinding>(
    () => !project
      // Task 15 — CHƯA mở dự án (chế độ scratch): không có buffer chủ ⇒ không Chèn/Thay buffer (trang Copilot cũ cũng
      // chỉ Sao chép); lõi hiện ghi chú nháp và ẩn "Đồng bộ từ editor".
      ? { scratch: true, surfaceLabel: t("nav.engineeringWorkspace", "Engineering Workspace"), diagnostics: [] }
      : ({
      kind: copilotInitialKind,
      code,
      surfaceLabel: t("nav.engineeringWorkspace", "Engineering Workspace"),
      diagnostics: (diagnostics ?? []).map((d) => ({
        message: `${d.line ? `L${d.line}: ` : ""}${d.message}`,
        severity: d.severity === "error" ? ("error" as const) : ("warn" as const),
        source: "validate",
      })),
      onApply: (gen: string) => {
        dispatch({ type: "code/append", text: gen });
        toast.success(t("progCopilot.inserted", "Inserted generated code into the editor"));
      },
      // G2-D — byte-exact buffer REPLACE, used by the per-hunk apply surface. Deliberately
      // NOT `onApply` (which appends): a hunk's line coordinates only mean something if the
      // buffer becomes exactly the projected text. No toast here — accepting/undoing hunks is
      // a rapid toggle and a toast per click would be noise.
      onApplyText: (next: string) => setCode(next),
    }),
    [project == null, copilotInitialKind, code, diagnostics], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useCopilotBinding(() => copilotBinding, [copilotBinding]);
  // Copilot đã mở một lần ⇒ giữ mount lõi (stream đang chạy không bị huỷ khi chuyển sang tab Thuộc tính — Review
  // Focus 3). Mở bằng nút AI top bar (không phải bấm tab) ⇒ đưa focus vào panel; lần nạp trang (đã nhớ "mở") thì không.
  const copilotPanelRef = useRef<HTMLDivElement | null>(null);
  const copilotOpenedByTabRef = useRef(false);
  const copilotWasOpenRef = useRef(copilotOpen);
  useEffect(() => {
    if (copilotOpen) dispatch({ type: "copilot/mounted" });
    if (copilotOpen && !copilotWasOpenRef.current && !copilotOpenedByTabRef.current) copilotPanelRef.current?.focus();
    copilotOpenedByTabRef.current = false;
    copilotWasOpenRef.current = copilotOpen;
  }, [copilotOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // U10 (doc 26) — phím tắt tác vụ trong editor. Ctrl/Cmd+S = Lưu phiên bản (chặn hộp
  // "lưu trang" của trình duyệt); Ctrl/Cmd+Enter = Build phiên bản đã lưu. Hook scope
  // 'global' tự BỎ QUA khi con trỏ ở input/textarea/contenteditable (trừ Ctrl+S vốn cần
  // chặn toàn cục) → không nuốt phím của trình soạn code.
  const saveVersionShortcut = () => {
    if (!project || !canCreate || !code.trim() || createArtifact.isPending) return;
    createArtifact.mutate({
      projectId: project.id,
      branch: project.defaultBranch ?? "main",
      language: language || KIND_LANGUAGE[project.kind as Kind] || "text",
      content: code,
    });
  };
  // doc 80 Đợt 1 Task 5 (WS-01) — cờ bật + phiên bản chưa duyệt ⇒ Build khoá KÈM lý do (server
  // cũng trả PRECONDITION_FAILED có mã — đây chỉ là để không bắt người dùng bấm mới biết).
  const buildLockedByReview = versionReviewEnabled && artifact != null && artifact.reviewStatus !== "approved";
  const buildVersionShortcut = () => {
    if (!canCreate || !artifactId || buildM.isPending || buildLockedByReview) return;
    if (requireSaved()) buildM.mutate({ artifactId });
  };
  useKeyboardShortcuts(
    [
      { key: "s", ctrlKey: true, action: saveVersionShortcut },
      { key: "Enter", ctrlKey: true, action: buildVersionShortcut },
    ],
    // Task 13 fix round 1 — wizard deploy đang mở ⇒ tắt phím tắt trang (Ctrl/Cmd+Enter build / Ctrl/Cmd+S lưu): không thể đổi
    // build/phiên bản dưới bước "Xem trước & xác nhận" (build đã xem trước là build sẽ deploy).
    { enabled: canView && !state.ui.wizard.open, scope: "global" },
  );

  // U7 (doc 26 §2.1) — MỘT CHẠM: tạo dự án DEMO + phiên bản mẫu (code hợp lệ) rồi tự
  // chọn để KTV mới bấm Kiểm tra/Mô phỏng ngay. Không seed DB tĩnh — tạo theo yêu cầu
  // người dùng qua đúng mutation sẵn có. Kind "stub" là mặc định AN TOÀN (không I/O
  // thiết bị); createProject/createArtifact.onSuccess tự set projectId + artifactId.
  const createDemo = async () => {
    if (!canCreate || demoCreating) return;
    dispatch({ type: "demo/creating", creating: true });
    try {
      const proj = await createProject.mutateAsync({
        code: `DEMO-${Date.now()}`,
        name: t("engineering.demoName", "Dự án DEMO — khởi động nhanh"),
        kind: "stub",
      });
      await createArtifact.mutateAsync({
        projectId: proj.id,
        branch: proj.defaultBranch ?? "main",
        language: KIND_LANGUAGE.stub,
        content: t(
          "engineering.demoProgram",
          "// Dự án DEMO — chương trình mẫu (an toàn, không phát lệnh xuống thiết bị)\n// 1) Bấm \"Kiểm tra\" để phân tích tĩnh\n// 2) Bấm \"Build\" để biên dịch phiên bản này\n// 3) Bấm \"Mô phỏng (twin)\" để chạy thử trên bản sao số\nSTART\n  WAIT 100        // chờ 100ms\n  SET output = 1  // bật đầu ra minh hoạ\n  WAIT 100\n  SET output = 0\nEND\n",
        ),
      });
    } catch {
      // Lỗi đã được onError của mutation toast — nuốt để không vỡ UI.
    } finally {
      dispatch({ type: "demo/creating", creating: false });
    }
  };

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6 text-muted-foreground">{t("common.noPermission", "Bạn không có quyền xem trang này.")}</div>
      </DashboardLayout>
    );
  }

  const isImplemented = (k: string) => adapters.find((a) => a.kind === k)?.implemented ?? false;

  // ══ doc 81 Đợt 2 Task 13 — P1 Workbench (doc 81 §1.3) ═══════════════════════════════════════════════════════
  const ui = state.ui;
  const deployStatusText = featureStatusLabel(deployStatus, {
    on: t("engineering.deployOn", "ON"),
    off: t("engineering.deployOff", "OFF"),
    loading: t("engineering.deployChecking", "…"),
    error: t("engineering.deployUnknown", "?"),
  });
  const realDeployLabel = t("engineering.ws.realDeploy", "Triển khai thật");
  const problemsCount = diagnostics?.length ?? 0;
  const openBottom = (tab: BottomTabId) => dispatch({ type: "ui/bottom", tab, open: true });
  const selectActivity = (id: string) => {
    dispatch({ type: "ui/activity", activity: id as ActivityId });
    document.getElementById(`ide-sec-${id}`)?.scrollIntoView?.({ block: "start" });
  };
  const sourceTabLabel = artifact
    ? t("engineering.ws.sourceTab", "Nguồn v{{version}}", { version: artifact.version })
    : t("engineering.ws.sourceTabNew", "Nguồn (chưa lưu)");
  const activeEditorTab =
    ui.editorTab === "source" ? (visualKind && editorMode === "visual" ? "visual" : "source") : ui.editorTab;
  const editorTabs = project
    ? [
        { id: "source", label: sourceTabLabel, dirty: isDirty },
        ...(visualKind
          ? [{ id: "visual", label: visualKind === "ladder" ? t("engineering.modeLadder", "Ladder") : t("engineering.modeTeach", "Teach/Jog") }]
          : []),
        { id: "diff", label: t("engineering.ws.diffTab", "Δ So sánh") },
        { id: "tags", label: t("engineering.ws.tagsTab", "Tags") },
      ]
    : [];
  const onEditorTabChange = (id: string) => {
    if (id === "source" || id === "visual") {
      setEditorMode(id === "visual" ? "visual" : "code");
      dispatch({ type: "ui/editorTab", tab: "source" });
    } else dispatch({ type: "ui/editorTab", tab: id as EditorTabId });
  };

  // ── Pipeline chips (thay stepper luồng vàng): chỉ HIỂN THỊ tiến độ, đọc từ state hiện có ──
  const pipeline = project
    ? [
        { key: "compose", Icon: FileCode, label: t("engineering.gtCompose", "Soạn"), done: (artifactsQ.data ?? []).length > 0 },
        { key: "validate", Icon: CheckCircle2, label: t("engineering.gtValidate", "Kiểm tra"), done: diagnostics != null && diagnostics.every((d) => d.severity !== "error") },
        { key: "build", Icon: Hammer, label: t("engineering.gtBuild", "Build"), done: (buildsQ.data ?? []).length > 0 },
        { key: "sim", Icon: FlaskConical, label: t("engineering.gtSim", "Mô phỏng"), done: Boolean(simResult && simResult.ok) },
        { key: "deploy", Icon: Rocket, label: t("engineering.gtDeploy", "Deploy"), done: (deploymentsQ.data ?? []).length > 0 },
      ]
    : [];

  // ── Pre-flight actuation readiness (2FA/quyền) — dùng chung cho deploy đơn và đội máy (wizard) ──
  const readinessBlock = readiness.blockers.length > 0 && (
    <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <div className="font-medium">{t("engineering.readinessTitle", "Chưa đủ điều kiện để deploy (actuation)")}</div>
        <ul className="list-disc space-y-0.5 pl-4">
          {readiness.blockers.map((bl) => (
            <li key={bl.code}>{t(`actuationReadiness.${bl.code}`, bl.defaultMessage)}</li>
          ))}
        </ul>
      </div>
    </div>
  );

  const currentBuild = (buildsQ.data ?? []).find((b) => b.id === buildId) ?? null;
  const simVerdict = (() => {
    if (!simResult) return null;
    // U8 — Verdict rõ ràng ở đầu kết quả: !ok ⇒ KHÔNG ĐẠT · ok + warnings ⇒ CÓ CẢNH BÁO · ok + sạch ⇒ ĐẠT (OK)
    const verdict = !simResult.ok ? "fail" : simResult.warnings.length > 0 ? "warn" : "pass";
    return {
      pass: { cls: "border-success/40 bg-success/10 text-success", Icon: CheckCircle2, label: t("engineering.simPass", "ĐẠT (OK)") },
      warn: { cls: "border-warning/40 bg-warning/10 text-warning", Icon: AlertTriangle, label: t("engineering.simWarn", "CÓ CẢNH BÁO") },
      fail: { cls: "border-destructive/40 bg-destructive/10 text-destructive", Icon: XCircle, label: t("engineering.simFail", "KHÔNG ĐẠT") },
    }[verdict];
  })();

  // ═════ Top bar (PageHeaderCompact, 40–48 px): dự án/phiên bản · Kiểm/Build/Mô phỏng/Deploy · pipeline · review ═════
  const header = (
    <PageHeaderCompact
      className="h-12 shrink-0 border-b px-3 py-0"
      icon={<Code2 />}
      title={t("engineering.title", "Xưởng lập trình thiết bị")}
      chips={
        <>
          {!canEdit && <ViewOnlyBadge module="machine_control" />}
          {/* Doc 80 Task 1 (PLT-02/G-07): 4 trạng thái trung thực — chip (không banner), KHÔNG tên biến môi trường. */}
          <FeatureStatusNoticeChip
            status={deployStatus}
            subject={realDeployLabel}
            offMessage={t(
              "engineering.deployOffBanner",
              "Triển khai thật đang tắt — mọi deploy chỉ mô phỏng, không ghi xuống thiết bị. An toàn (E-stop/interlock) luôn nằm trên PLC chứng nhận.",
            )}
            errorMessage={t(
              "engineering.deployStatusError",
              "Không kiểm tra được trạng thái triển khai — tạm coi mọi deploy chỉ mô phỏng cho tới khi xác nhận lại.",
            )}
          />
          {project && (
            <button
              type="button"
              onClick={() => selectActivity(artifact ? "versions" : "projects")}
              className="inline-flex h-7 max-w-[12rem] shrink-0 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted"
              title={t("engineering.ws.projectVersion", "Dự án / phiên bản đang mở")}
            >
              <FolderGit2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{project.name} · {artifact ? `v${artifact.version}` : t("engineering.ws.noVersionSel", "chưa chọn phiên bản")}</span>
            </button>
          )}
          {isDirty && (
            <Badge variant="outline" className="shrink-0 border-warning/50 text-[10px] text-warning">
              <AlertTriangle className="mr-1 h-3 w-3" /> {t("engineering.unsaved", "Chưa lưu")}
            </Badge>
          )}
          {versionReviewEnabled && artifact && <ReviewStatusBadge status={artifact.reviewStatus} artifactId={artifact.id} />}
          {project && <PipelineChips steps={pipeline} t={t} />}
          {/* W6-26 — "Khi nào dùng" + cross-link golden-thread (ranh giới IDE vs IR vs POU), trong popover. */}
          <NoticeChip kind="whenToUse">
            <p className="text-sm">
              {t("engineering.whenToUse", "When to use — the full IDE pipeline: build, simulate, sign-off & deploy device programs. Low-level motion/IO? Use the IR Editor. IEC 61131 LAD/FBD/SFC? Use POU Studio.")}
            </p>
            {/* U1 — cross-link MANG ?projectId: mở đúng project đang chọn ở IR/POU (không mở trống). */}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <Link href="/engineering-home" className="font-medium text-primary hover:underline">{t("nav.engineeringHome")}</Link>
              <Link href={withParams("/ir-editor", { projectId })} className="font-medium text-primary hover:underline">
                {projectId ? t("engineering.openInIr", "Mở project này trong IR") : t("nav.irEditor")}
              </Link>
              <Link href={withParams("/pou-studio", { projectId })} className="font-medium text-primary hover:underline">
                {projectId ? t("engineering.openInPou", "Mở project này trong POU") : t("nav.pouStudio")}
              </Link>
            </div>
          </NoticeChip>
        </>
      }
      actions={
        <>
          <Button
            size="sm"
            aria-label={t("engineering.saveVersion", "Lưu phiên bản")}
            disabled={!project || !canCreate || !code.trim() || createArtifact.isPending}
            onClick={saveVersionShortcut}
            title={createReason ?? t("engineering.saveShortcut", "Lưu phiên bản (Ctrl/Cmd+S)")}
          >
            <Plus className="h-4 w-4 min-[1700px]:mr-1" /> <span className="hidden min-[1700px]:inline">{t("engineering.saveVersion", "Lưu phiên bản")}</span>
          </Button>
          <Button
            size="sm" variant="outline"
            aria-label={t("engineering.validate", "Kiểm tra")}
            disabled={!artifactId || validateM.isPending}
            onClick={() => {
              if (artifactId && requireSaved()) {
                validateM.mutate({ artifactId });
                openBottom("problems"); // R-2-l — ý định rõ: xem kết quả kiểm tra
              }
            }}
          >
            <CheckCircle2 className="h-4 w-4 min-[1700px]:mr-1" /> <span className="hidden min-[1700px]:inline">{t("engineering.validate", "Kiểm tra")}</span>
          </Button>
          <Button
            size="sm" variant="outline"
            aria-label={t("engineering.build", "Build")}
            disabled={!canCreate || !artifactId || buildM.isPending || buildLockedByReview}
            onClick={() => {
              if (!canCreate || !artifactId || buildM.isPending || buildLockedByReview) return;
              if (!isDirty) openBottom("builds"); // R-2-l — ý định rõ: xem build (chưa lưu ⇒ chỉ toast, không mở)
              buildVersionShortcut();
            }}
            title={
              createReason ??
              (buildLockedByReview
                ? t("engineering.review.buildLocked", "Phiên bản chưa được DUYỆT — cần một người khác tác giả duyệt trước khi build.")
                : t("engineering.buildShortcut", "Build (Ctrl/Cmd+Enter)"))
            }
          >
            <Hammer className="h-4 w-4 min-[1700px]:mr-1" /> <span className="hidden min-[1700px]:inline">{t("engineering.build", "Build")}</span>
          </Button>
          <Button
            size="sm" variant="outline"
            aria-label={t("engineering.simulate", "Mô phỏng (twin)")}
            disabled={!buildId || simulateM.isPending}
            onClick={() => {
              if (!buildId) return;
              simulateM.mutate({ buildId, scenario: {} });
              openBottom("builds");
            }}
          >
            <Play className="h-4 w-4 min-[1700px]:mr-1" /> <span className="hidden min-[1700px]:inline">{t("engineering.gtSim", "Mô phỏng")}</span>
          </Button>
          <Button
            size="sm" variant="outline"
            aria-label={t("engineering.ws.deployOpen", "Deploy…")}
            disabled={!buildId}
            onClick={() => buildId != null && dispatch({ type: "wizard/open", buildId })}
            title={buildId == null ? t("engineering.fleetNeedBuild", "Chọn một build ở khối \"Builds & Mô phỏng\" trước để triển khai ra đội máy.") : t("engineering.ws.deployOpenHint", "Mở wizard triển khai (4 bước, có canary)")}
          >
            <Rocket className="h-4 w-4 min-[1700px]:mr-1" /> <span className="hidden min-[1700px]:inline">{t("engineering.ws.deployOpen", "Deploy…")}</span>
          </Button>
          {/* Doc 69 · Wave 2 / C — manual lookup right where the code is written (query = kind + language). */}
          <ManualHelp
            query={`${project?.kind ?? ""} ${language} programming syntax reference`.trim()}
            size="sm"
            variant="ghost"
          />
          <Button
            size="sm" variant="ghost"
            aria-label={t("common.refresh", "Làm mới")}
            title={t("common.refresh", "Làm mới")}
            onClick={() => { statusQ.refetch(); projectsQ.refetch(); }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </>
      }
    />
  );

  // ═════ Explorer (trái): Dự án / Phiên bản / Tags-IO / Deploy ═════
  const sectionTitle = "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
  const explorer = (
    <div className="flex flex-col gap-4 p-2 text-sm">
      {/* ── Dự án ── */}
      <section id="ide-sec-projects" aria-labelledby="ide-h-projects" className="scroll-mt-2 space-y-1">
        <div className="flex items-center justify-between">
          <h2 id="ide-h-projects" className={sectionTitle}>
            <FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />{t("engineering.projects", "Dự án")}
          </h2>
          <Sheet open={npOpen} onOpenChange={setNpOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={!canCreate} title={createReason ?? t("engineering.newProject", "Dự án mới")} aria-label={t("engineering.newProject", "Dự án mới")}>
                <Plus className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex w-[92vw] flex-col gap-0 p-0 sm:max-w-[480px]">
              <SheetHeader className="border-b px-4 py-3 pr-10">
                <SheetTitle>{t("engineering.newProject", "Dự án mới")}</SheetTitle>
                <SheetDescription>{t("engineering.newProjectDesc", "Một workspace lập trình cho một thiết bị/cell")}</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <div>
                  <Label>{t("engineering.code", "Mã")}</Label>
                  <Input value={npCode} onChange={(e) => setNpCode(e.target.value)} placeholder="ZMC-CELL-01" />
                </div>
                <div>
                  <Label>{t("engineering.name", "Tên")}</Label>
                  <Input value={npName} onChange={(e) => setNpName(e.target.value)} />
                </div>
                <div>
                  <Label>{t("engineering.kind", "Loại thiết bị")}</Label>
                  <Select value={npKind} onValueChange={(v) => setNpKind(v as Kind)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}{isImplemented(k) ? "" : ` (${t("engineering.planned", "sắp có")})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* U2 — thiết bị nguồn (tùy chọn): gắn ngay để mở khoá Online Monitor sau này. */}
                <div>
                  <Label>{t("engineering.sourceDevice", "Thiết bị nguồn")}</Label>
                  <Select value={npDeviceId} onValueChange={setNpDeviceId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("engineering.sourceDevicePh", "Chọn thiết bị (tùy chọn)…")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(machinesQ.data ?? []).map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>{m.name} · #{m.id}</SelectItem>
                      ))}
                      {(machinesQ.data ?? []).length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          {t("engineering.noMachines", "Chưa có máy nào — có thể gắn sau ở Online Monitor")}
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("engineering.sourceDeviceHint", "Gắn thiết bị để mở khoá theo dõi trực tiếp (Online Monitor). Có thể để trống rồi gắn sau.")}
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t px-4 py-3">
                <Button
                  disabled={!npCode || !npName || createProject.isPending}
                  onClick={() => {
                    createProject.mutate({
                      code: npCode,
                      name: npName,
                      kind: npKind,
                      deviceId: npDeviceId ? Number(npDeviceId) : undefined,
                    });
                    dispatch({ type: "newProject/submitted" });
                  }}
                >
                  {t("common.create", "Tạo")}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
        {/* U13 — ô tìm + lọc theo loại (lọc phía client, không đổi backend). */}
        {(projectsQ.data ?? []).length > 0 && (
          <div className="mb-2 space-y-1.5">
            <Input
              value={projSearch}
              onChange={(e) => setProjSearch(e.target.value)}
              placeholder={t("engineering.searchProjects", "Tìm theo tên hoặc mã…")}
              className="h-8 text-sm"
            />
            <Select value={projKindFilter} onValueChange={setProjKindFilter}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("engineering.allKinds", "Tất cả loại")}</SelectItem>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {/* Doc 80 Task 1 (PLT-02/G-07) — đang tải / lỗi KHÔNG phải "Chưa có dự án". */}
        {projectsQ.isLoading && (
          <div className="space-y-1.5 py-1" data-testid="engineering-projects-loading">
            <Skeleton className="h-7 w-full rounded-md" />
            <Skeleton className="h-7 w-full rounded-md" />
            <Skeleton className="h-7 w-3/4 rounded-md" />
          </div>
        )}
        {!projectsQ.isLoading && projectsQ.isError && (
          <p className="py-4 text-center text-sm text-destructive">
            {t("engineering.projectsLoadError", "Không tải được danh sách dự án.")}
          </p>
        )}
        {!projectsQ.isLoading && !projectsQ.isError && (projectsQ.data ?? []).length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("engineering.noProjects", "Chưa có dự án")}</p>
        )}
        {(projectsQ.data ?? []).length > 0 && filteredProjects.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("engineering.noProjectMatch", "Không có dự án khớp bộ lọc")}</p>
        )}
        {filteredProjects.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              if (p.id === projectId) return;
              guardDirty(() => {
                // Chuỗi reset (artifact/build/sim/diagnostics + watch + máy đội): workspaceReducer.
                dispatch({ type: "project/select", projectId: p.id });
                setLastProjectId(p.id); // U1 — nhớ project để mang theo khi chuyển trang
              });
            }}
            aria-current={projectId === p.id ? "true" : undefined}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${projectId === p.id ? "bg-muted font-medium" : ""}`}
          >
            <span className="truncate">{p.name}</span>
            <Badge variant="outline" className="ml-1 shrink-0 text-[10px]">{p.kind}</Badge>
          </button>
        ))}
      </section>

      {/* ── Phiên bản ── */}
      <section id="ide-sec-versions" aria-labelledby="ide-h-versions" className="scroll-mt-2 space-y-1">
        <h2 id="ide-h-versions" className={sectionTitle}>
          <FileCode className="h-3.5 w-3.5" aria-hidden="true" />
          {project ? <>{project.name} · {t("engineering.versions", "Phiên bản")}</> : t("engineering.versions", "Phiên bản")}
        </h2>
        {!project ? (
          <p className="text-xs text-muted-foreground">{t("engineering.ws.pickProjectFirst", "Chọn một dự án ở mục Dự án.")}</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {(artifactsQ.data ?? []).map((a) => (
              <button
                key={a.id}
                onClick={() => { if (a.id !== artifactId) guardDirty(() => dispatch({ type: "artifact/select", artifactId: a.id })); }}
                className={`rounded border px-2 py-1 text-xs hover:bg-muted ${artifactId === a.id ? "border-primary bg-muted" : ""}`}
              >
                v{a.version} · {a.branch}
                <Badge variant="outline" className="ml-1 text-[9px]">{a.status}</Badge>
                {versionReviewEnabled && <ReviewStatusBadge status={a.reviewStatus} artifactId={a.id} />}
              </button>
            ))}
            {(artifactsQ.data ?? []).length === 0 && (
              <span className="text-xs text-muted-foreground">{t("engineering.noVersions", "Chưa có phiên bản — soạn rồi lưu bên dưới")}</span>
            )}
          </div>
        )}
      </section>

      {/* ── Tags / IO (Online Monitor) ── */}
      <section id="ide-sec-tags" aria-labelledby="ide-h-tags" className="scroll-mt-2 space-y-1.5">
        <h2 id="ide-h-tags" className={sectionTitle}>
          <Variable className="h-3.5 w-3.5" aria-hidden="true" />{t("engineering.ws.activityTags", "Tags / IO")}
        </h2>
        {!project ? (
          <p className="text-xs text-muted-foreground">{t("engineering.ws.pickProjectFirst", "Chọn một dự án ở mục Dự án.")}</p>
        ) : (
          <>
            {/* Badge NGUỒN trung thực — không giả lập giá trị. */}
            <div className="flex flex-wrap items-center gap-1">
              {(() => {
                if (!streamingEnabled)
                  return (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <WifiOff className="h-3 w-3" /> {t("engineering.srcOff", "Nguồn: TẮT (streaming off)")}
                    </Badge>
                  );
                if (project.deviceId == null)
                  return (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <WifiOff className="h-3 w-3" /> {t("engineering.srcNone", "Nguồn: chưa gắn thiết bị")}
                    </Badge>
                  );
                return watching ? (
                  <Badge variant="default" className="gap-1 text-[10px]">
                    {streamConnected ? <Wifi className="h-3 w-3" /> : <Radio className="h-3 w-3 animate-pulse" />}
                    {t("engineering.srcLive", "Nguồn: thiết bị")} #{project.deviceId}
                    {lastUpdate == null && <span className="opacity-80">· {t("engineering.srcNoData", "chưa có dữ liệu")}</span>}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Radio className="h-3 w-3" /> {t("engineering.srcReady", "Thiết bị")} #{project.deviceId}
                  </Badge>
                );
              })()}
            </div>
            <div className="flex flex-wrap gap-1">
              {/* U2 — gắn/đổi thiết bị nguồn ngay cạnh badge Nguồn (sửa project.deviceId). */}
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!canEdit} title={editReason} onClick={openAttachDialog}>
                <Wifi className="mr-1 h-3.5 w-3.5" />
                {project.deviceId == null ? t("engineering.attachDevice", "Gắn thiết bị") : t("engineering.changeDevice", "Đổi thiết bị")}
              </Button>
              {watching ? (
                <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={stopWatchM.isPending} onClick={() => stopWatchM.mutate({ projectId: project.id })}>
                  <WifiOff className="mr-1 h-3.5 w-3.5" /> {t("engineering.stopWatch", "Dừng theo dõi")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={startWatchM.isPending || (symbolsQ.data ?? []).filter((s) => s.watchable).length === 0}
                  onClick={() =>
                    startWatchM.mutate({
                      projectId: project.id,
                      symbols: (symbolsQ.data ?? []).filter((s) => s.watchable).map((s) => s.name),
                    })
                  }
                >
                  <Radio className="mr-1 h-3.5 w-3.5" /> {t("engineering.startWatch", "Theo dõi trực tiếp")}
                </Button>
              )}
            </div>
            <ul className="space-y-0.5 text-xs">
              {(symbolsQ.data ?? []).slice(0, 12).map((s) => {
                const live = liveValues.get(s.name);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-muted">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">{live ? String(live.value) : "—"}</span>
                  </li>
                );
              })}
            </ul>
            <Button size="sm" variant="ghost" className="h-7 w-full justify-start text-xs" onClick={() => dispatch({ type: "ui/editorTab", tab: "tags" })}>
              <Variable className="mr-1 h-3.5 w-3.5" /> {t("engineering.ws.openTagsTab", "Mở bảng tag")} ({(symbolsQ.data ?? []).length})
            </Button>
          </>
        )}
      </section>

      {/* ── Deploy ── */}
      <section id="ide-sec-deploy" aria-labelledby="ide-h-deploy" className="scroll-mt-2 space-y-1.5">
        <h2 id="ide-h-deploy" className={sectionTitle}>
          <Rocket className="h-3.5 w-3.5" aria-hidden="true" />{t("engineering.ws.activityDeploy", "Deploy")}
        </h2>
        {!project ? (
          <p className="text-xs text-muted-foreground">{t("engineering.ws.pickProjectFirst", "Chọn một dự án ở mục Dự án.")}</p>
        ) : (
          <>
            <ul className="space-y-0.5 text-xs">
              {(deploymentsQ.data ?? []).slice(0, 5).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 rounded px-1 py-0.5">
                  <span className="truncate">{`#${d.id} · ${d.stage}`}</span>
                  <Badge variant={d.status === "rejected" ? "destructive" : "secondary"} className="text-[9px]">{d.status}</Badge>
                </li>
              ))}
              {(deploymentsQ.data ?? []).length === 0 && (
                <li className="text-muted-foreground">{t("engineering.noDeploys", "Chưa có deploy")}</li>
              )}
            </ul>
            {/* Đích đội máy đã chọn (giữ giữa các lần mở wizard; đổi dự án ⇒ xoá — chuỗi reset). */}
            <p data-testid="ide-fleet-targets" data-count={fleetDeviceIds.length} className="text-xs text-muted-foreground">
              {fleetDeviceIds.length > 0
                ? t("engineering.ws.fleetSelected", "Đội máy đã chọn: {{list}}", { list: fleetDeviceIds.map((id) => machineLabel(id)).join(", ") })
                : t("engineering.ws.fleetNone", "Chưa chọn máy nào cho đội (canary).")}
            </p>
            <div className="flex flex-col gap-1">
              <Button size="sm" variant="ghost" className="h-7 justify-start text-xs" onClick={() => openBottom("deploys")}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> {t("engineering.ws.deploysTab", "Lịch sử deploy")}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 justify-start text-xs" onClick={() => openBottom("matrix")}>
                <GitCompare className="mr-1 h-3.5 w-3.5" /> {t("engineering.fleetMatrix", "Ma trận máy × version")}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );

  // ═════ MAIN (editor) — nội dung theo tab editor ═════
  const emptyMain = (
    <div className="flex h-full items-center justify-center p-6">
      {projectsQ.isLoading ? (
        <p className="text-center text-muted-foreground">{t("common.loading", "Đang tải…")}</p>
      ) : projectsQ.isError ? (
        <p className="text-center text-destructive">{t("common.error", "Có lỗi khi tải")}</p>
      ) : (projectsQ.data ?? []).length === 0 ? (
        // U7 — CHƯA có dự án nào: onboarding GIÀU + nút "Tạo dự án DEMO" một chạm.
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Rocket className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">{t("engineering.emptyTitle", "Bắt đầu tại đây")}</h3>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              {t("engineering.emptyDesc", "Chưa có dự án nào. Tạo một dự án DEMO có sẵn chương trình mẫu để làm quen — rồi bấm Kiểm tra và Mô phỏng ngay. An toàn tuyệt đối: không phát lệnh xuống thiết bị.")}
            </p>
          </div>
          <ol className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {[t("engineering.step1", "Tạo dự án demo"), t("engineering.step2", "Bấm Kiểm tra"), t("engineering.step3", "Bấm Mô phỏng")].map((label, i) => (
              <li key={i} className="inline-flex items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <Button onClick={createDemo} disabled={!canCreate || demoCreating} title={createReason}>
            {demoCreating ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : <Rocket className="mr-1 h-4 w-4" />}
            {t("engineering.createDemo", "Tạo dự án DEMO")}
          </Button>
          {!canCreate && <p className="text-xs text-muted-foreground">{createReason}</p>}
        </div>
      ) : (
        <p className="text-center text-muted-foreground">{t("engineering.selectProject", "Chọn một dự án để bắt đầu")}</p>
      )}
    </div>
  );

  // R-2-s — điều khiển của tab Δ / Tags nằm CUỐI thanh tab editor (một `data-layout-toolbar` duy nhất trong MAIN).
  const diffToolbarEnd = (
    <>
      <span className="hidden items-center gap-1 text-xs font-medium text-muted-foreground xl:flex">
        <GitCompare className="h-3.5 w-3.5" /> {t("engineering.compareVersions", "So sánh phiên bản")}
      </span>
      <Select value={diffBaseId != null ? String(diffBaseId) : ""} onValueChange={(v) => setDiffBaseId(Number(v))}>
        <SelectTrigger className="h-7 w-32 text-xs" aria-label={t("engineering.diffBase", "Bản gốc")}><SelectValue placeholder={t("engineering.diffBase", "Bản gốc")} /></SelectTrigger>
        <SelectContent>
          {(artifactsQ.data ?? []).map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>v{a.version} · {a.branch}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">→</span>
      <Select value={diffCompareId != null ? String(diffCompareId) : ""} onValueChange={(v) => setDiffCompareId(Number(v))}>
        <SelectTrigger className="h-7 w-32 text-xs" aria-label={t("engineering.diffCompare", "So với")}><SelectValue placeholder={t("engineering.diffCompare", "So với")} /></SelectTrigger>
        <SelectContent>
          {(artifactsQ.data ?? []).map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>v{a.version} · {a.branch}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
  const diffView = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {diffBase && diffCompare ? (
          <LineDiff left={diffBase.content ?? ""} right={diffCompare.content ?? ""} maxHeightClass="max-h-none" />
        ) : (
          <p className="py-2 text-center text-xs text-muted-foreground">{t("engineering.diffPick", "Chọn 2 phiên bản để xem khác biệt")}</p>
        )}
      </div>
    </div>
  );

  const tagsToolbarEnd = (
    <>
      <span className="hidden items-center gap-1 text-xs font-medium text-muted-foreground xl:flex">
        <Variable className="h-3.5 w-3.5" /> {t("engineering.symbols", "Bảng biến / tag")}
      </span>
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!canEdit} title={editReason} onClick={() => openSymDialog()}>
        <Plus className="mr-1 h-3.5 w-3.5" /> {t("engineering.addSymbol", "Thêm biến")}
      </Button>
    </>
  );
  const tagsView = project && (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("engineering.symbolName", "Tên")}</TableHead>
              <TableHead>{t("engineering.address", "Địa chỉ")}</TableHead>
              <TableHead>{t("engineering.dataType", "Kiểu")}</TableHead>
              <TableHead>{t("engineering.liveValue", "Giá trị live")}</TableHead>
              <TableHead>{t("engineering.updatedAt", "Cập nhật")}</TableHead>
              <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(symbolsQ.data ?? []).map((s) => {
              const live = liveValues.get(s.name);
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {s.name}
                    {!s.watchable && <Badge variant="outline" className="ml-1 text-[9px]">{t("engineering.noWatch", "no-watch")}</Badge>}
                  </TableCell>
                  <TableCell>{s.address ?? "—"}</TableCell>
                  <TableCell>{s.dataType ?? "—"}</TableCell>
                  <TableCell className="font-mono">{live ? String(live.value) : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{live ? new Date(live.ts).toLocaleTimeString() : "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canEdit} title={editReason} aria-label={t("common.edit", "Sửa")} onClick={() => openSymDialog(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                        disabled={!canDelete || deleteSymbol.isPending}
                        title={!canDelete ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" }) : undefined}
                        aria-label={t("common.delete", "Xóa")}
                        onClick={() => dispatch({ type: "deleteSym/open", id: s.id })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {!symbolsQ.isLoading && (symbolsQ.data ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">{t("engineering.noSymbols", "Chưa có biến — bấm \"Thêm biến\" để soạn bảng tag")}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        {symbolsQ.isLoading && <p className="py-2 text-center text-sm text-muted-foreground">{t("common.loading", "Đang tải…")}</p>}
        {symbolsQ.isError && <p className="py-2 text-center text-sm text-destructive">{t("common.error", "Có lỗi khi tải")}</p>}
        {watching && lastUpdate == null && (
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {t("engineering.watchNoDataHint", "Đang theo dõi nhưng chưa có mẫu — nguồn đọc thật cần thiết bị/adapter (chưa gắn HW).")}
          </p>
        )}
      </div>
    </div>
  );

  const sourceView =
    visualKind && editorMode === "visual" ? (
      <div className="h-full overflow-auto p-2">
        {visualKind === "ladder" ? <LadderEditor value={code} onChange={setCode} /> : <TeachJogPanel value={code} onChange={setCode} />}
      </div>
    ) : (
      // CodeMirror cao HẾT vùng MAIN (wrapper của CodeEditor + khung của @uiw cùng h-full).
      <div className="h-full [&>div]:h-full [&>div]:rounded-none [&>div]:border-0 [&>div>div]:h-full">
        <CodeEditor
          value={code}
          onChange={setCode}
          language={language}
          aria-label="program-source"
          height="100%"
          onCursorChange={(p) => dispatch({ type: "cursor/set", line: p.line, col: p.col })}
          // doc69 · Wave 4 / C1 — the primary authoring surface gets inline (ghost-text) completion.
          inlineCopilot
        />
      </div>
    );

  const editorMain = !project
    ? emptyMain
    : activeEditorTab === "diff"
      ? diffView
      : activeEditorTab === "tags"
        ? tagsView
        : sourceView;

  // ═════ Inspector phải: [Thuộc tính | Copilot] — Copilot là panel TRONG layout (R-2-b) ═════
  const inspectorTabId = (k: "props" | "copilot") => `ide-insp-${k}`;
  const inspector = (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label={t("engineering.ws.inspectorLabel", "Thuộc tính / Copilot")}
        className="flex h-8 shrink-0 items-stretch border-b"
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const next = !copilotOpen;
          copilotOpenedByTabRef.current = true;
          setCopilotOpen(next);
          document.getElementById(`${inspectorTabId(next ? "copilot" : "props")}-tab`)?.focus();
        }}
      >
        {(["props", "copilot"] as const).map((k) => {
          const selected = (k === "copilot") === copilotOpen;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              id={`${inspectorTabId(k)}-tab`}
              aria-selected={selected}
              aria-controls={inspectorTabId(k)}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                copilotOpenedByTabRef.current = true;
                setCopilotOpen(k === "copilot");
              }}
              className={`flex items-center gap-1 border-r px-3 text-xs ${selected ? "bg-background font-medium" : "text-muted-foreground hover:bg-muted"}`}
            >
              {k === "copilot" && <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
              {k === "copilot" ? t("engineering.ws.copilotTab", "Copilot") : t("engineering.ws.propsTab", "Thuộc tính")}
            </button>
          );
        })}
      </div>
      {/* Thuộc tính — dự án / phiên bản (duyệt WS-01) / build (bản xem trước deploy chạy khô) */}
      <div role="tabpanel" id={inspectorTabId("props")} aria-labelledby={`${inspectorTabId("props")}-tab`} hidden={copilotOpen} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-xs">
        {!project ? (
          <p className="text-muted-foreground">{t("engineering.ws.pickProjectFirst", "Chọn một dự án ở mục Dự án.")}</p>
        ) : (
          <>
            <section className="space-y-1">
              <h3 className={sectionTitle}>{t("engineering.projects", "Dự án")}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                <dt className="text-muted-foreground">{t("engineering.name", "Tên")}</dt><dd className="truncate">{project.name}</dd>
                <dt className="text-muted-foreground">{t("engineering.code", "Mã")}</dt><dd className="truncate">{project.code}</dd>
                <dt className="text-muted-foreground">{t("engineering.kind", "Loại thiết bị")}</dt>
                <dd className="truncate">{project.kind}{isImplemented(project.kind) ? "" : ` (${t("engineering.planned", "sắp có")})`}</dd>
                <dt className="text-muted-foreground">{t("engineering.sourceDevice", "Thiết bị nguồn")}</dt>
                <dd className="truncate">{project.deviceId != null ? machineLabel(project.deviceId) : "—"}</dd>
              </dl>
            </section>
            <section className="space-y-1">
              <h3 className={sectionTitle}>{t("engineering.versions", "Phiên bản")}</h3>
              {artifact ? (
                <p className="flex flex-wrap items-center gap-1">
                  <span>{`v${artifact.version} · ${artifact.branch}`}</span>
                  <Badge variant="outline" className="text-[9px]">{artifact.status}</Badge>
                </p>
              ) : (
                <p className="text-muted-foreground">{t("engineering.ws.noVersionSel", "chưa chọn phiên bản")}</p>
              )}
              {/* doc 80 Đợt 1 Task 5 (WS-01) — duyệt phiên bản ngay trong IDE (chỉ khi cờ bật). */}
              {versionReviewEnabled && artifact && (
                <VersionReviewPanel
                  artifact={artifact}
                  userId={user?.id}
                  canReview={canCreate}
                  busy={reviewM.isPending || requestReviewM.isPending}
                  onRequest={() => requestReviewM.mutate({ artifactId: artifact.id })}
                  onApprove={() => reviewM.mutate({ artifactId: artifact.id, decision: "approved" })}
                  onReject={(reason) => reviewM.mutate({ artifactId: artifact.id, decision: "rejected", reason })}
                />
              )}
              {buildLockedByReview && (
                <p data-testid="build-review-lock" className="flex items-center gap-1 text-warning">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {t("engineering.review.buildLocked", "Phiên bản chưa được DUYỆT — cần một người khác tác giả duyệt trước khi build.")}
                </p>
              )}
            </section>
            <section className="space-y-1.5">
              <h3 className={sectionTitle}>{t("engineering.gtBuild", "Build")}</h3>
              {buildId == null ? (
                <p className="text-muted-foreground">{t("engineering.ws.noBuildSel", "Chưa chọn build — chọn ở panel dưới (Build / Mô phỏng).")}</p>
              ) : (
                <>
                  <p>{t("engineering.ws.buildSummary", "Build #{{id}} · {{status}}", { id: buildId, status: currentBuild?.status ?? "…" })}</p>
                  {/* doc 80 Đợt 1 Task 5 (F2) — verdict + từng cổng, chạy khô TRƯỚC khi hỏi OTP. Khi wizard mở, bản xem
                      trước nằm ở bước cuối của wizard (một chỗ tại một thời điểm). */}
                  {!ui.wizard.open && (
                    <DeployPreviewPanel
                      preview={deployPreviewQ.data as DeployPreviewView | undefined}
                      isLoading={deployPreviewQ.isLoading}
                      isError={deployPreviewQ.isError}
                    />
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>
      {/* Copilot — lõi dùng chung (IDE/IR/POU); mount một lần rồi GIỮ (stream không bị huỷ khi đổi tab — Review Focus 3). */}
      <div
        role="tabpanel"
        id={inspectorTabId("copilot")}
        aria-labelledby={`${inspectorTabId("copilot")}-tab`}
        aria-label={t("progCopilot.dock.title", "Trợ lý Lập trình")}
        hidden={!copilotOpen}
        tabIndex={-1}
        ref={copilotPanelRef}
        className="min-h-0 flex-1 overflow-y-auto p-3 focus:outline-none"
      >
        {(copilotOpen || ui.copilotMounted) && <ProgrammingCopilotCore binding={copilotBinding} />}
      </div>
    </div>
  );

  // ═════ Panel dưới: Vấn đề / Build-Mô phỏng / Lịch sử deploy / Ma trận máy×version (GẬP lần đầu — R-2-l) ═════
  const bottomTabs: Array<{ id: BottomTabId; label: string; count?: number }> = [
    { id: "problems", label: t("engineering.ws.problemsTab", "Vấn đề"), count: problemsCount },
    { id: "builds", label: t("engineering.ws.buildsTab", "Build / Mô phỏng"), count: (buildsQ.data ?? []).length },
    { id: "deploys", label: t("engineering.ws.deploysTab", "Lịch sử deploy"), count: (deploymentsQ.data ?? []).length },
    { id: "matrix", label: t("engineering.fleetMatrix", "Ma trận máy × version") },
  ];
  const bottomPanelId = (id: BottomTabId) => `ide-bottom-${id}`;
  const bottomPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label={t("engineering.ws.bottomLabel", "Vấn đề · Build · Deploy")} className="flex h-8 shrink-0 items-stretch border-b">
        {bottomTabs.map((bt) => {
          const selected = ui.bottomTab === bt.id;
          return (
            <button
              key={bt.id}
              type="button"
              role="tab"
              id={`${bottomPanelId(bt.id)}-tab`}
              aria-selected={selected}
              aria-controls={bottomPanelId(bt.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => dispatch({ type: "ui/bottom", tab: bt.id })}
              className={`flex items-center gap-1 border-r px-3 text-xs ${selected ? "bg-background font-medium" : "text-muted-foreground hover:bg-muted"}`}
            >
              {bt.label}
              {bt.count != null && bt.count > 0 && <Badge variant="secondary" className="h-4 px-1 text-[9px]">{bt.count}</Badge>}
            </button>
          );
        })}
      </div>
      {/* Vấn đề — chẩn đoán của lần Kiểm tra (gắn phiên bản lúc yêu cầu, Task 12b) */}
      <div role="tabpanel" id={bottomPanelId("problems")} aria-labelledby={`${bottomPanelId("problems")}-tab`} hidden={ui.bottomTab !== "problems"} className="min-h-0 flex-1 overflow-auto p-2 text-xs">
        {diagnostics ? (
          diagnostics.length === 0 ? (
            <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" /> {t("engineering.noDiag", "Không có cảnh báo")}</span>
          ) : (
            diagnostics.map((d, i) => (
              <div key={i} className="flex items-center gap-1">
                {d.severity === "error" ? <XCircle className="h-3 w-3 text-destructive" /> : <AlertTriangle className="h-3 w-3 text-warning" />}
                <span>{progDiagText(t, d)}</span>
              </div>
            ))
          )
        ) : (
          <p className="text-muted-foreground">{t("engineering.ws.noDiagYet", "Chưa kiểm tra phiên bản đang chọn — bấm Kiểm tra.")}</p>
        )}
      </div>
      {/* Build / Mô phỏng */}
      <div role="tabpanel" id={bottomPanelId("builds")} aria-labelledby={`${bottomPanelId("builds")}-tab`} hidden={ui.bottomTab !== "builds"} className="min-h-0 flex-1 space-y-2 overflow-auto p-2 text-xs">
        <div className="flex flex-wrap gap-1">
          {(buildsQ.data ?? []).map((b) => (
            <button
              key={b.id}
              onClick={() => dispatch({ type: "build/select", buildId: b.id })}
              className={`rounded border px-2 py-1 text-xs hover:bg-muted ${buildId === b.id ? "border-primary bg-muted" : ""}`}
            >
              #{b.id} <Badge variant={b.ok ? "default" : "destructive"} className="ml-1 text-[9px]">{b.status}</Badge>
            </button>
          ))}
          {(buildsQ.data ?? []).length === 0 && <span className="text-muted-foreground">{t("engineering.noBuilds", "Chưa có build")}</span>}
        </div>
        {simResult && simVerdict && (
          <div className="rounded-md border bg-muted/30 p-2">
            {/* Badge verdict LỚN, màu rõ — đồng bộ ngữ nghĩa màu với Orchestration */}
            <div className={`mb-2 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${simVerdict.cls}`}>
              <simVerdict.Icon className="h-4 w-4 shrink-0" /> {simVerdict.label}
            </div>
            <div className="mb-1 font-medium">{t("engineering.timeline", "Timeline")} ({simResult.timeline.length} {t("engineering.steps", "bước")})</div>
            {simResult.warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-1 text-warning">
                <AlertTriangle className="h-3 w-3 shrink-0" /> {w}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Lịch sử deploy (+ khôi phục) + kết quả lượt rollout đội máy gần nhất */}
      <div role="tabpanel" id={bottomPanelId("deploys")} aria-labelledby={`${bottomPanelId("deploys")}-tab`} hidden={ui.bottomTab !== "deploys"} className="min-h-0 flex-1 space-y-2 overflow-auto p-2 text-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>{t("engineering.stage", "Giai đoạn")}</TableHead>
              <TableHead>{t("common.status", "Trạng thái")}</TableHead>
              <TableHead>{t("engineering.simulated", "Mô phỏng")}</TableHead>
              <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(deploymentsQ.data ?? []).slice(0, 10).map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.id}</TableCell>
                <TableCell>{d.stage}</TableCell>
                <TableCell><Badge variant={d.status === "rejected" ? "destructive" : "secondary"}>{d.status}</Badge></TableCell>
                <TableCell>{d.simulated ? <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-label={t("engineering.simulated", "Mô phỏng")} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right">
                  {/* Rollback: chỉ cho deploy đã thành công (không phải rejected / đã rollback). */}
                  {canCreate && (d.status === "deployed" || d.status === "verified" || d.status === "simulated") && (
                    // final wave R-2-z3 — RollbackConfirm dùng chung, ĐÚNG hợp đồng cũ: AlertDialog phá huỷ không lý do;
                    // OTP do stepUp.guard CỦA TRANG (R-2-q: requireOtp=false, lưới step-up thấy .mutate trong guard).
                    // doc 80 WS-04 — khoá thử sinh lúc MỞ hộp (ổn định trong lượt này, mới ở lần mở sau).
                    <RollbackConfirm
                      requireReason={false}
                      requireOtp={false}
                      versionLabel={`#${d.id}`}
                      disabled={rollbackM.isPending}
                      title={t("engineering.rollbackTitle", "Khôi phục phiên bản trước?")}
                      description={t("engineering.rollbackDesc", "Sẽ ghi một deployment MỚI về build của lần deploy thành công trước ở giai đoạn \"{{stage}}\". Chịu cùng cổng an toàn (sign-off / flag) như deploy.", { stage: d.stage })}
                      confirmLabel={t("engineering.rollback", "Khôi phục")}
                      onOpenChange={(o) => dispatch(o
                        ? { type: "rollback/open", target: { id: d.id, stage: d.stage, attemptKey: newDeployAttemptKey("rollback-dep", d.id) } }
                        : { type: "rollback/close" })}
                      trigger={
                        <Button size="sm" variant="outline" disabled={rollbackM.isPending}>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> {t("engineering.rollback", "Khôi phục")}
                        </Button>
                      }
                      onRollback={() => {
                        if (rollbackTarget == null || rollbackTarget.id !== d.id) return;
                        const { id, attemptKey } = rollbackTarget;
                        stepUp.guard((totpCode) => rollbackM.mutate({
                          deploymentId: id,
                          idempotencyKey: attemptKey,
                          actionId: attemptKey,
                          totpCode,
                        }));
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(deploymentsQ.data ?? []).length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">{t("engineering.noDeploys", "Chưa có deploy")}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        {fleetResult && (
          <div className="space-y-2">
            <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
              fleetResult.halted ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-success/40 bg-success/10 text-success"
            }`}>
              {fleetResult.halted ? <XCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
              {fleetResult.halted
                ? fleetResult.haltCode === "canary_not_real"
                  ? t("engineering.fleetNeedsRealCanaryShort", "DỪNG — cần canary thật")
                  : t("engineering.fleetHaltedShort", "DỪNG — canary không đạt")
                : fleetResult.promoted
                  ? t("engineering.fleetPromotedShort", "Đã promote toàn đội máy")
                  : t("engineering.fleetCanaryOkShort", "Canary đã chạy")}
            </div>
            {fleetResult.halted && fleetResult.haltCode === "canary_not_real" ? (
              <p className="text-xs text-destructive">
                {t("engineering.fleetNeedsRealCanary", "Rollout đã DỪNG: canary chỉ giả lập (không ghi xuống thiết bị) nên không được tính là đạt khi promote sẽ ghi thật. Cần một canary thật (deployed/verified).")}
              </p>
            ) : fleetResult.haltReason && (
              <p className="text-xs text-destructive">{fleetResult.haltReason}</p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("engineering.fleetTargets", "Máy")}</TableHead>
                  <TableHead>{t("engineering.fleetPhase", "Pha")}</TableHead>
                  <TableHead>{t("common.status", "Trạng thái")}</TableHead>
                  <TableHead>{t("engineering.rollback", "Khôi phục")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fleetResult.results.map((r) => (
                  <TableRow key={r.deviceId}>
                    <TableCell className="font-medium">{machineLabel(r.deviceId)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{r.phase}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={r.status === "rejected" || r.status === "failed" ? "destructive" : "secondary"}>{r.status}</Badge>
                      {r.error && <span className="ml-1 text-[10px] text-muted-foreground">{r.error}</span>}
                    </TableCell>
                    <TableCell>
                      {r.rolledBack === true
                        ? <Badge variant="outline" className="text-[10px]"><RotateCcw className="mr-1 h-3 w-3" />{t("engineering.rolledBack", "Đã khôi phục")}</Badge>
                        : r.rollbackError
                          ? <span className="text-[10px] text-warning">{r.rollbackError}</span>
                          : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      {/* Ma trận máy × version (máy nào đang chạy artifact/hash nào) */}
      <div role="tabpanel" id={bottomPanelId("matrix")} aria-labelledby={`${bottomPanelId("matrix")}-tab`} hidden={ui.bottomTab !== "matrix"} className="min-h-0 flex-1 overflow-auto p-2 text-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("engineering.fleetTargets", "Máy")}</TableHead>
              <TableHead>{t("engineering.versions", "Phiên bản")}</TableHead>
              <TableHead>{t("engineering.stage", "Giai đoạn")}</TableHead>
              <TableHead>{t("common.status", "Trạng thái")}</TableHead>
              <TableHead>Hash</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(fleetMatrixQ.data ?? []).map((e) => (
              <TableRow key={e.deviceId}>
                <TableCell className="font-medium">{machineLabel(e.deviceId)}</TableCell>
                <TableCell>{e.version != null ? `v${e.version} · ${e.branch ?? ""}` : "—"}</TableCell>
                <TableCell>{e.stage}</TableCell>
                <TableCell><Badge variant={e.simulated ? "outline" : "secondary"}>{e.status}</Badge></TableCell>
                <TableCell className="font-mono text-[10px]">{e.contentHash ? e.contentHash.slice(0, 12) + "…" : "—"}</TableCell>
              </TableRow>
            ))}
            {(fleetMatrixQ.data ?? []).length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">{t("engineering.fleetMatrixEmpty", "Chưa có máy nào ghi nhận phiên bản")}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  // ═════ Thanh trạng thái (24 px): Ln/Col · ngôn ngữ · số dòng · adapter · Triển khai thật · Vấn đề · Copilot ═════
  const statusBar = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span className="shrink-0 tabular-nums">{t("engineering.ws.lnCol", "Ln {{line}}, Col {{col}}", { line: state.cursor.line, col: state.cursor.col })}</span>
      {project && (
        // U9 — Select token hợp lệ theo kind, thay ô gõ tay (tránh gõ sai).
        <Select value={language} onValueChange={setLanguage} disabled={!canCreate}>
          <SelectTrigger className="h-5 w-auto gap-1 border-0 px-1 text-[11px] shadow-none" aria-label={t("engineering.language", "Ngôn ngữ")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {langOptions.map((lang) => (
              <SelectItem key={lang} value={lang}>{lang}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {project && <span className="shrink-0">{code.split("\n").length} {t("engineering.lines", "dòng")}</span>}
      {project && (
        <span className="shrink-0" title={t("engineering.kind", "Loại thiết bị")}>
          {project.kind}{isImplemented(project.kind) ? "" : ` (${t("engineering.planned", "sắp có")})`}
        </span>
      )}
      <span
        data-testid="engineering-deploy-badge"
        data-state={deployStatus}
        className={`shrink-0 rounded px-1 font-medium ${deployStatus === "on" ? "text-success" : deployStatus === "error" ? "text-destructive" : "text-warning"}`}
      >
        {realDeployLabel}: {deployStatusText}
      </span>
      <button
        type="button"
        data-testid="ide-status-problems"
        onClick={() => openBottom("problems")}
        className="inline-flex shrink-0 items-center gap-1 rounded px-1 hover:bg-accent"
        aria-label={t("engineering.ws.problemsStatus", "Vấn đề: {{count}}", { count: problemsCount })}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {problemsCount}
      </button>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1">
        <Sparkles className="h-3 w-3" aria-hidden="true" /> {t("engineering.ws.copilotTab", "Copilot")} {copilotOpen ? "●" : "○"}
      </span>
    </div>
  );

  // ═════ Deploy wizard 4 bước (WizardDialog): Build · Đích & canary · Ký duyệt · Xem trước & xác nhận ═════
  // R-2-n: mỗi lượt xác nhận gửi ĐÚNG như thẻ cũ — một máy (deployBuild / requestDeployApproval) HOẶC một lượt
  // deployToFleet với các máy đã chọn; cùng cổng khoá nút, cùng OTP (stepUp.guard của trang — R-2-q), cùng
  // expectedProjectId (R-2-r). Bản xem trước (deployPreview) ở bước cuối — TRƯỚC OTP.
  const wizardMode = ui.wizard.mode;
  const fleetMode = wizardMode === "fleet";
  const stageSelect = (value: "staging" | "production", onChange: (v: "staging" | "production") => void) => (
    <div>
      <Label className="text-xs">{t("engineering.stage", "Giai đoạn")}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as "staging" | "production")}>
        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="staging">staging</SelectItem>
          <SelectItem value="production">production</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
  const approverSelect = (value: string, onChange: (v: string) => void) => (
    <div>
      <Label className="text-xs">{t("engineering.approver", "Người ký duyệt")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-48">
          <SelectValue placeholder={t("engineering.selectApprover", "Chọn người ký duyệt…")} />
        </SelectTrigger>
        <SelectContent>
          {approverOptions.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>{a.name || a.username || `#${a.id}`}</SelectItem>
          ))}
          {approverOptions.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("engineering.noApprovers", "Không có người đủ quyền ký duyệt")}</div>
          )}
        </SelectContent>
      </Select>
    </div>
  );

  const singleDeployDisabled = useApprovalFlow
    ? !canCreate || !buildId || requestDeployApprovalM.isPending || !prodDeployReady || previewBlocked
    : !canCreate || !buildId || deployM.isPending || !prodDeployReady || previewBlocked;
  const fleetDeployDisabled = !canCreate || !buildId || !fleetReady || deployToFleetM.isPending;
  // Task 13 fix round 1 — build GHIM lúc mở wizard; build đang chọn đổi (vd kết quả Build về muộn) ⇒ nút cuối KHOÁ:
  // build đã xem trước luôn là build sẽ được deploy. Chặt hơn thẻ cũ (fail-closed), không nới cổng nào.
  const wizardBuildChanged = ui.wizard.open && ui.wizard.buildId !== buildId;

  const finishWizard = () => {
    if (!buildId || wizardBuildChanged) return;
    if (fleetMode) {
      if (fleetDeployDisabled) return;
      // QA W5: nonce/lần-thử để LẦN NÀY khác lần trước → sau khi canary hỏng (rejected) và sửa build, bấm lại sẽ
      // DEPLOY LẠI thay vì trả về hàng rejected cũ (deployBuild dedupe theo idempotencyKey).
      const fleetRunId = rid("frun");
      stepUp.guard((totpCode) => deployToFleetM.mutate({
        buildId,
        deviceIds: fleetDeviceIds,
        stage: fleetStage,
        strategy: {
          canaryCount: Math.min(fleetCanary, fleetDeviceIds.length),
          promoteOnVerified: fleetPromoteVerified,
          autoRollbackOnMismatch: fleetAutoRollback,
        },
        // Ổn định trong 1 lần bấm (chống double-submit), khác giữa các lần rollout.
        idempotencyKeyPrefix: `fleet-${buildId}-${fleetStage}-${fleetRunId}`,
        actionId: fleetRunId,
        confirmedBy: fleetIsProd
          ? (fleetApproverId ? Number(fleetApproverId) : undefined)
          : (fleetSignOff && user?.id ? user.id : undefined),
        reason: fleetIsProd ? fleetReason.trim() : undefined,
        totpCode,
        expectedProjectId,
      }));
      return;
    }
    if (singleDeployDisabled) return;
    if (useApprovalFlow) {
      requestDeployApprovalM.mutate({
        buildId,
        // doc 80 WS-04 — khoá MỚI mỗi lượt bấm (nút khoá khi isPending ⇒ không double-submit); bấm lại sau khi bị
        // từ chối ⇒ yêu cầu mới.
        idempotencyKey: newDeployAttemptKey("depreq", buildId, "production"),
        reason: deployReason.trim(),
        expectedProjectId,
      });
      return;
    }
    // doc 80 WS-04 — nonce/lượt xác nhận (mẫu fleet): ổn định trong lượt này (thử lại OTP dùng lại cùng khoá), khác
    // giữa các lượt ⇒ bấm lại sau khi bị từ chối sẽ DEPLOY LẠI thay vì nhận lại dòng rejected cũ.
    const attemptKey = newDeployAttemptKey("dep", buildId, deployStage);
    stepUp.guard((totpCode) => deployM.mutate({
      buildId,
      stage: deployStage,
      idempotencyKey: attemptKey,
      actionId: rid("act"),
      confirmedBy: isProd
        ? (approverId ? Number(approverId) : undefined)
        : (signOff && user?.id ? user.id : undefined),
      reason: isProd ? deployReason.trim() : undefined,
      totpCode,
      expectedProjectId,
    }));
  };

  const wizardSteps = [
    {
      id: "build",
      title: t("engineering.ws.stepBuild", "Build"),
      canProceed: buildId != null,
      content: (
        <div className="space-y-3 text-sm">
          {readinessBlock}
          {project && artifact && (
            <p className="text-muted-foreground">{t("engineering.ws.buildOfVersion", "Phiên bản v{{version}} của {{project}}", { version: artifact.version, project: project.name })}</p>
          )}
          {buildId != null && (
            <p className="font-medium">{t("engineering.ws.buildSummary", "Build #{{id}} · {{status}}", { id: buildId, status: currentBuild?.status ?? "…" })}</p>
          )}
          {simVerdict && (
            <p className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${simVerdict.cls}`}>
              <simVerdict.Icon className="h-3.5 w-3.5" /> {t("engineering.gtSim", "Mô phỏng")}: {simVerdict.label}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t("engineering.ws.changeBuildHint", "Đổi build ở panel dưới (Build / Mô phỏng).")}</p>
        </div>
      ),
    },
    {
      id: "target",
      title: t("engineering.ws.stepTarget", "Đích & canary"),
      // Cổng nằm ở nút cuối (y hệt nút cũ) — bước này không chặn; bước cuối nói rõ còn thiếu gì.
      canProceed: true,
      content: (
        <div className="space-y-3 text-sm">
          <RadioGroup
            value={wizardMode}
            onValueChange={(v) => dispatch({ type: "wizard/mode", mode: v as DeployWizardMode })}
            aria-label={t("engineering.ws.modeLabel", "Kiểu triển khai")}
            className="gap-2"
          >
            <label className="flex items-start gap-2">
              <RadioGroupItem value="single" aria-label={t("engineering.ws.modeSingle", "Một máy (thiết bị của dự án)")} className="mt-0.5" />
              <span>
                <span className="font-medium">{t("engineering.ws.modeSingle", "Một máy (thiết bị của dự án)")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("engineering.ws.singleTarget", "Đích: {{device}}", {
                    device: project?.deviceId != null ? machineLabel(project.deviceId) : t("engineering.ws.noDevice", "dự án chưa gắn thiết bị — xem bản xem trước ở bước cuối"),
                  })}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <RadioGroupItem value="fleet" aria-label={t("engineering.ws.modeFleet", "Đội máy (canary)")} className="mt-0.5" />
              <span className="font-medium">{t("engineering.ws.modeFleet", "Đội máy (canary)")}</span>
            </label>
          </RadioGroup>
          {fleetMode && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                {t("engineering.fleetHint", "Đẩy build đang chọn ra nhiều máy TUẦN TỰ qua đúng đường deploy (giữ nguyên mọi cổng an toàn). Canary N máy đầu; nếu không đạt sẽ DỪNG và (tùy chọn) tự khôi phục các máy đã ghi.")}
              </p>
              {/* Chọn máy đích (đa chọn) */}
              <div>
                <Label className="text-xs">{t("engineering.fleetTargets", "Máy đích")} ({fleetDeviceIds.length})</Label>
                <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                  {(machinesQ.data ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground">{t("engineering.noMachines", "Chưa có máy nào — có thể gắn sau ở Online Monitor")}</p>
                  )}
                  {(machinesQ.data ?? []).map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={fleetDeviceIds.includes(m.id)} onCheckedChange={() => toggleFleetDevice(m.id)} />
                      <span className="truncate">{m.name} · #{m.id}</span>
                    </label>
                  ))}
                </div>
              </div>
              {/* Chiến lược canary */}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label className="text-xs">{t("engineering.fleetCanaryCount", "Số máy canary")}</Label>
                  <Input
                    type="number" min={1} max={fleetDeviceIds.length || 1}
                    className="h-8 w-24 text-sm"
                    value={fleetCanary}
                    onChange={(e) => setFleetCanary(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={fleetPromoteVerified} onCheckedChange={(v) => setFleetPromoteVerified(Boolean(v))} />
                  {t("engineering.fleetPromoteVerified", "Chỉ promote khi canary VERIFIED")}
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={fleetAutoRollback} onCheckedChange={(v) => setFleetAutoRollback(Boolean(v))} />
                  <RotateCcw className="h-3 w-3" /> {t("engineering.fleetAutoRollback", "Tự khôi phục nếu canary hỏng")}
                </label>
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "signoff",
      title: t("engineering.ws.stepSignoff", "Ký duyệt"),
      canProceed: true,
      content: fleetMode ? (
        <div className="space-y-3 text-sm">
          {readinessBlock}
          <div className="flex flex-wrap items-end gap-3">
            {stageSelect(fleetStage, setFleetStage)}
            {!fleetIsProd && (
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={fleetSignOff} onCheckedChange={(v) => setFleetSignOff(Boolean(v))} />
                <ShieldCheck className="h-3 w-3" /> {t("engineering.signOff", "Tôi ký duyệt (HITL sign-off)")}
              </label>
            )}
          </div>
          {/* Production: người ký duyệt (SoD) + lý do bắt buộc. */}
          {fleetIsProd && (
            <div className="flex flex-wrap items-end gap-3">
              {approverSelect(fleetApproverId, setFleetApproverId)}
              <div className="min-w-[220px] flex-1">
                <Label className="text-xs">{t("engineering.approvalReason", "Lý do duyệt (bắt buộc)")}</Label>
                <Input
                  className="h-8 text-xs"
                  value={fleetReason}
                  onChange={(e) => setFleetReason(e.target.value)}
                  placeholder={t("engineering.approvalReasonPh", "Nêu lý do / căn cứ duyệt deploy production…")}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {readinessBlock}
          <div className="flex flex-wrap items-end gap-2">
            {stageSelect(deployStage, setDeployStage)}
            {/* Staging: tự ký (SoD chỉ áp dụng cho production). */}
            {!isProd && (
              <label className="flex items-center gap-2 text-xs">
                <Checkbox data-testid="engineering-deploy-signoff" checked={signOff} onCheckedChange={(v) => setSignOff(Boolean(v))} />
                <ShieldCheck className="h-3 w-3" /> {t("engineering.signOff", "Tôi ký duyệt (HITL sign-off)")}
              </label>
            )}
            {/* Production + Approval Inbox BẬT: KHÔNG cho người yêu cầu tự chọn approver. */}
            {useApprovalFlow && (
              <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3 w-3 shrink-0 text-primary" />
                {t("engineering.approvalInboxHint", "Sẽ gửi CHỜ DUYỆT — người thứ hai ký ở Hộp duyệt")}
              </span>
            )}
            {/* Production (legacy, flag OFF): second-approver do người yêu cầu chọn. */}
            {isProd && !deployApprovalEnabled && approverSelect(approverId, setApproverId)}
          </div>
          {/* Production: ô lý do duyệt bắt buộc + ghi chú SoD. */}
          {isProd && (
            <div className="space-y-1">
              <Label className="text-xs">{t("engineering.approvalReason", "Lý do duyệt (bắt buộc)")}</Label>
              <Textarea
                className="min-h-[56px] text-xs"
                value={deployReason}
                onChange={(e) => setDeployReason(e.target.value)}
                placeholder={t("engineering.approvalReasonPh", "Nêu lý do / căn cứ duyệt deploy production…")}
              />
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3 w-3 shrink-0" />
                {useApprovalFlow
                  ? t("engineering.sodHintInbox", "Deploy production được gửi CHỜ DUYỆT: một người KHÁC bạn sẽ ký bằng session của họ (phân tách nhiệm vụ).")
                  : t("engineering.sodHint", "Deploy production cần người ký duyệt KHÁC người yêu cầu (phân tách nhiệm vụ).")}
              </p>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "preview",
      title: t("engineering.ws.stepPreview", "Xem trước & xác nhận"),
      canProceed: !wizardBuildChanged && (fleetMode ? !fleetDeployDisabled : !singleDeployDisabled),
      content: (
        <div className="space-y-3 text-sm">
          {readinessBlock}
          {fleetMode ? (
            <p className="rounded-md border bg-muted/30 p-2 text-xs">
              {t("engineering.ws.fleetSummary", "{{count}} máy · canary {{canary}} · {{stage}}", {
                count: fleetDeviceIds.length,
                canary: Math.min(fleetCanary, fleetDeviceIds.length),
                stage: fleetStage,
              })}
            </p>
          ) : (
            buildId != null && (
              // doc 80 Đợt 1 Task 5 (F2) — verdict + từng cổng, chạy khô TRƯỚC khi hỏi OTP.
              <DeployPreviewPanel
                preview={deployPreviewQ.data as DeployPreviewView | undefined}
                isLoading={deployPreviewQ.isLoading}
                isError={deployPreviewQ.isError}
              />
            )
          )}
          {wizardBuildChanged && (
            <p data-testid="ide-wizard-build-changed" role="alert" className="text-xs font-medium text-destructive">
              {t("engineering.ws.buildChanged", "Build đang chọn đã đổi (từ #{{pinned}} sang #{{current}}) sau khi mở wizard — đóng và mở lại wizard để xem trước đúng build sẽ deploy.", { pinned: ui.wizard.buildId ?? "—", current: buildId ?? "—" })}
            </p>
          )}
          {fleetMode && !fleetReady && (
            <p data-testid="ide-wizard-not-ready" className="text-xs text-warning">
              {t("engineering.ws.fleetNotReady", "Chưa đủ để triển khai đội máy: cần ít nhất một máy (bước Đích & canary); production cần người ký duyệt và lý do (bước Ký duyệt).")}
            </p>
          )}
          {!fleetMode && !prodDeployReady && (
            <p data-testid="ide-wizard-not-ready" className="text-xs text-warning">
              {t("engineering.ws.prodNotReady", "Production cần người ký duyệt (khi không qua Hộp duyệt) và lý do — điền ở bước Ký duyệt.")}
            </p>
          )}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("engineering.ws.otpNote", "Bấm nút cuối ⇒ hỏi mã OTP 2 bước (nếu bật) rồi mới gửi; cổng an toàn và lý do giữ như cũ.")}
          </p>
        </div>
      ),
    },
  ];

  const wizardFinish = fleetMode
    ? { label: t("engineering.fleetDeployBtn", "Triển khai (canary)"), testId: "engineering-fleet-deploy-button", pending: deployToFleetM.isPending }
    : useApprovalFlow
      ? { label: t("engineering.requestDeployBtn", "Gửi yêu cầu deploy"), testId: "engineering-request-deploy-button", pending: requestDeployApprovalM.isPending }
      : { label: t("engineering.deployBtn", "Deploy build"), testId: "engineering-deploy-button", pending: deployM.isPending };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100dvh-3.5rem)] min-h-[30rem] min-w-0 flex-col">
        {header}
        <EngineeringShell
          layoutId="engineering"
          userId={user?.id ?? null}
          heightClass="min-h-0 flex-1"
          className="rounded-none border-x-0 border-b-0"
          activityItems={[
            { id: "projects", label: t("engineering.ws.activityProjects", "Dự án"), icon: <FolderGit2 /> },
            { id: "versions", label: t("engineering.ws.activityVersions", "Phiên bản"), icon: <FileCode /> },
            { id: "tags", label: t("engineering.ws.activityTags", "Tags / IO"), icon: <Variable /> },
            { id: "deploy", label: t("engineering.ws.activityDeploy", "Deploy"), icon: <Rocket /> },
          ]}
          activeActivity={ui.activity}
          onActivityChange={selectActivity}
          explorer={explorer}
          explorerLabel={t("engineering.ws.explorerLabel", "Trình duyệt dự án")}
          explorerSize={{ minPx: 240, maxPx: 300, defaultPx: 240 }}
          editorTabs={editorTabs}
          activeTabId={activeEditorTab}
          onTabChange={onEditorTabChange}
          editor={editorMain}
          editorToolbarEnd={project ? (activeEditorTab === "diff" ? diffToolbarEnd : activeEditorTab === "tags" ? tagsToolbarEnd : undefined) : undefined}
          inspector={inspector}
          inspectorLabel={t("engineering.ws.inspectorLabel", "Thuộc tính / Copilot")}
          inspectorIsAi={copilotOpen}
          inspectorSize={{ minPx: 320, maxPx: 420, defaultPx: 320 }}
          inspectorRevealToken={copilotOpen ? 1 : 0}
          bottomPanel={bottomPanel}
          bottomLabel={t("engineering.ws.bottomLabel", "Vấn đề · Build · Deploy")}
          bottomDefaultCollapsed
          bottomOpenRequest={ui.bottomOpenRequest}
          statusBar={statusBar}
        />
      </div>

      {/* Deploy wizard (sheet phải) — preview TRƯỚC OTP; OTP = stepUp.guard của trang (R-2-q). */}
      <WizardDialog
        open={ui.wizard.open}
        onOpenChange={(o) => { if (!o) dispatch({ type: "wizard/close" }); }}
        title={t("engineering.ws.wizardTitle", "Triển khai build")}
        description={t("engineering.ws.wizardDesc", "Chọn đích, ký duyệt, xem trước — mã OTP được hỏi sau bước cuối.")}
        size="lg"
        steps={wizardSteps}
        onFinish={finishWizard}
        finishLabel={wizardFinish.label}
        finishTestId={wizardFinish.testId}
        finishTitle={createReason}
        pending={wizardFinish.pending}
      />

      {/* Symbol editor (thêm/sửa một biến trong bảng tag) — sheet phải */}
      <Sheet open={symOpen} onOpenChange={setSymOpen}>
        <SheetContent side="right" className="flex w-[92vw] flex-col gap-0 p-0 sm:max-w-[480px]">
          <SheetHeader className="border-b px-4 py-3 pr-10">
            <SheetTitle>{symId ? t("engineering.editSymbol", "Sửa biến") : t("engineering.addSymbol", "Thêm biến")}</SheetTitle>
            <SheetDescription>{t("engineering.symbolDesc", "Một tag/biến của thiết bị để theo dõi (watch) trong Online Monitor")}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <div>
              <Label>{t("engineering.symbolName", "Tên")}</Label>
              <Input value={symName} onChange={(e) => setSymName(e.target.value)} placeholder="X0 / Motor_Speed" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t("engineering.address", "Địa chỉ")}</Label>
                <Input value={symAddr} onChange={(e) => setSymAddr(e.target.value)} placeholder="D100 / %MW10" />
              </div>
              <div>
                <Label>{t("engineering.dataType", "Kiểu")}</Label>
                <Input value={symType} onChange={(e) => setSymType(e.target.value)} placeholder="INT / BOOL / REAL" />
              </div>
            </div>
            <div>
              <Label>{t("engineering.comment", "Ghi chú")}</Label>
              <Input value={symComment} onChange={(e) => setSymComment(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={symWatchable} onCheckedChange={(v) => setSymWatchable(Boolean(v))} />
              {t("engineering.watchable", "Cho phép theo dõi (watch)")}
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t px-4 py-3">
            <Button
              disabled={!project || !canEdit || !symName.trim() || upsertSymbol.isPending}
              title={editReason}
              onClick={() =>
                project &&
                upsertSymbol.mutate({
                  projectId: project.id,
                  name: symName.trim(),
                  address: symAddr.trim() || undefined,
                  dataType: symType.trim() || undefined,
                  comment: symComment.trim() || undefined,
                  watchable: symWatchable,
                })
              }
            >
              {t("common.save", "Lưu")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* U2 — Attach/đổi thiết bị nguồn cho project (mở khoá Online Monitor) — sheet phải */}
      <Sheet open={attachOpen} onOpenChange={setAttachOpen}>
        <SheetContent side="right" className="flex w-[92vw] flex-col gap-0 p-0 sm:max-w-[480px]">
          <SheetHeader className="border-b px-4 py-3 pr-10">
            <SheetTitle>{t("engineering.attachDeviceTitle", "Gắn thiết bị nguồn")}</SheetTitle>
            <SheetDescription>
              {t("engineering.attachDeviceDesc", "Chọn máy làm nguồn đọc cho \"{{name}}\". Sau khi gắn, badge Nguồn chuyển sang thiết bị và có thể Theo dõi trực tiếp.", { name: project?.name ?? "" })}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <div>
              <Label>{t("engineering.sourceDevice", "Thiết bị nguồn")}</Label>
              <Select value={attachDeviceId} onValueChange={setAttachDeviceId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("engineering.sourceDevicePh", "Chọn thiết bị (tùy chọn)…")} />
                </SelectTrigger>
                <SelectContent>
                  {(machinesQ.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.name} · #{m.id}</SelectItem>
                  ))}
                  {(machinesQ.data ?? []).length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t("engineering.noMachines", "Chưa có máy nào — có thể gắn sau ở Online Monitor")}
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>
            {project?.deviceId != null && (
              // Cho phép gỡ gắn (đặt lại về chưa gắn thiết bị).
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={!canEdit || updateProject.isPending}
                title={editReason}
                onClick={() => updateProject.mutate({ id: project.id, deviceId: null })}
              >
                <WifiOff className="mr-1 h-4 w-4" /> {t("engineering.detachDevice", "Gỡ gắn thiết bị")}
              </Button>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t px-4 py-3">
            <Button
              disabled={!project || !canEdit || !attachDeviceId || updateProject.isPending}
              title={editReason}
              onClick={() => project && updateProject.mutate({ id: project.id, deviceId: Number(attachDeviceId) })}
            >
              {t("common.save", "Lưu")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* U11 (doc 26 §3.1) — bỏ thay đổi chưa lưu khi chuyển dự án/phiên bản (thay window.confirm) */}
      <AlertDialog open={pendingNav != null} onOpenChange={(o) => { if (!o) dispatch({ type: "nav/clear" }); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("engineering.dirtyTitle", "Bỏ thay đổi chưa lưu?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("engineering.dirtyConfirm", "Có chỉnh sửa chưa lưu — chuyển sẽ mất thay đổi. Tiếp tục?")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Hủy")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const run = pendingNav;
                dispatch({ type: "nav/clear" });
                run?.();
              }}
            >
              {t("engineering.dirtyDiscard", "Bỏ thay đổi & tiếp tục")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* U11 (doc 26 §3.1) — xác nhận xóa một biến khỏi bảng tag (thay window.confirm) */}
      <AlertDialog open={deleteSymTarget != null} onOpenChange={(o) => { if (!o) dispatch({ type: "deleteSym/close" }); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("engineering.deleteSymbolTitle", "Xóa biến khỏi bảng tag?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("engineering.deleteSymbolDesc", "Biến này sẽ bị gỡ khỏi bảng tag và không còn được theo dõi. Không thể hoàn tác.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Hủy")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteSymTarget) deleteSymbol.mutate({ id: deleteSymTarget.id });
                dispatch({ type: "deleteSym/close" });
              }}
            >
              {t("common.delete", "Xóa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* doc 54 P3.2 — step-up 2FA prompt for deploy/rollback/fleet actuation */}
      {stepUp.dialog}
    </DashboardLayout>
  );
}

/**
 * doc 81 Đợt 2 Task 12 — trang = WorkspaceProvider (state + reducer) bọc view. Provider không thêm
 * phần tử DOM nào: DOM y hệt trước khi nâng state (ảnh chụp DOM của test đặc tả khớp từng byte).
 */
export default function EngineeringWorkspace() {
  return (
    <WorkspaceProvider>
      <EngineeringWorkspaceView />
    </WorkspaceProvider>
  );
}
