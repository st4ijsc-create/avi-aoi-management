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
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { computeIsDirty } from "@/lib/engineeringBuffer";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link, useLocation, useSearch } from "wouter";
import { useEngineering } from "@/contexts/EngineeringContext";
import { parseDeepLink, withParams } from "@/lib/engineeringDeepLink";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer } from "@/components/patterns";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { CodeEditor } from "@/components/engineering/CodeEditor";
import { LadderEditor } from "@/components/engineering/LadderEditor";
import { TeachJogPanel } from "@/components/engineering/TeachJogPanel";
// Doc 34 · P3 — embed the in-app Programming Copilot (LLM codegen, validated by the substrate).
import { COPILOT_KINDS, type CopilotKind } from "@/components/programming/ProgrammingCopilotPanel";
import { useCopilotBinding, useProgrammingCopilot } from "@/contexts/ProgrammingCopilotContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LineDiff } from "@/components/diff/LineDiff";
import {
  Code2, Plus, FolderGit2, FileCode, Play, Hammer, FlaskConical, Rocket,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, Variable, ShieldCheck,
  Radio, Trash2, Pencil, Wifi, WifiOff, RotateCcw, GitCompare, Info,
  Check, ChevronRight, Sparkles, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useEngineeringStream } from "@/hooks/useEngineeringStream";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useActuationReadiness } from "@/hooks/useActuationReadiness";
import { useStepUpOtp } from "@/components/security/StepUpOtpDialog";

/** All target classes (mirrors server programmingKindEnum / PROGRAMMING_KINDS). */
const KINDS = [
  "stub",
  "zmotion-basic",
  "gcode",
  "mitsubishi-engineering",
  "robot-tm",
  "iec61131-st",
  "iec61131-ld",
] as const;
type Kind = (typeof KINDS)[number];

/** Default concrete language token per kind (the adapter accepts these). */
const KIND_LANGUAGE: Record<Kind, string> = {
  stub: "text",
  "zmotion-basic": "basic",
  gcode: "gcode",
  "mitsubishi-engineering": "st",
  "robot-tm": "tmscript",
  "iec61131-st": "st",
  "iec61131-ld": "ld",
};

/**
 * U9 (doc 26) — tập token ngôn ngữ HỢP LỆ mỗi kind (mirror capabilities.languages
 * của adapter server). Đổi ô gõ tay → Select để khỏi gõ sai token adapter hiểu nhầm.
 * Phần tử đầu là mặc định gợi ý cho kind (khớp KIND_LANGUAGE).
 */
const KIND_LANGUAGES: Record<Kind, readonly string[]> = {
  stub: ["text", "basic", "st", "gcode"],
  "zmotion-basic": ["basic"],
  gcode: ["gcode"],
  "mitsubishi-engineering": ["st", "device"],
  "robot-tm": ["tmscript"],
  "iec61131-st": ["st"],
  "iec61131-ld": ["ld"],
};

type Diagnostic = { severity: string; message: string; line?: number; symbol?: string };

/**
 * U14 (doc 26 §3.2) — STEPPER luồng vàng: Soạn → Kiểm tra → Build → Mô phỏng →
 * Deploy → Giám sát. Chỉ HIỂN THỊ tiến độ (đọc từ state hiện có, không tự chạy gì) +
 * bấm để CUỘN tới card tương ứng. Dính (sticky) trên đầu cột editor.
 */
type GoldenStep = {
  key: string;
  label: string;
  Icon: typeof CheckCircle2;
  done: boolean;
  anchor: string;
};

function GoldenThreadStepper({ steps, t }: { steps: GoldenStep[]; t: TFunction }) {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <nav
      aria-label={t("engineering.gtNav", "Golden thread progress")}
      className="sticky top-0 z-10 overflow-x-auto rounded-md border bg-background/95 px-2 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <ol className="flex min-w-max items-center gap-0.5">
        {steps.map((s, i) => {
          const StepIcon = s.Icon;
          return (
            <li key={s.key} className="flex items-center">
              <button
                type="button"
                onClick={() => scrollTo(s.anchor)}
                aria-current={s.done ? "step" : undefined}
                className="group flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors hover:bg-muted"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    s.done
                      ? "border-success/40 bg-success/15 text-success"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {s.done ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <StepIcon className={`h-3.5 w-3.5 ${s.done ? "text-success" : "text-muted-foreground"}`} />
                <span className={s.done ? "font-medium text-foreground" : "text-muted-foreground"}>{s.label}</span>
              </button>
              {i < steps.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function rid(prefix: string): string {
  // Non-crypto unique-ish id for idempotency/action keys (UI-side).
  return `${prefix}-${Date.now()}-${Math.floor(performance.now())}`;
}

export default function EngineeringWorkspace() {
  const { t } = useTranslation();
  // U3 (doc 26) — breadcrumb "Kỹ thuật › Section › Trang" + link về Hub.
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const canView = hasPermission("machine_monitoring", "canView");
  const canCreate = hasPermission("machine_control", "canCreate");
  const canEdit = hasPermission("machine_control", "canEdit");
  const canDelete = hasPermission("machine_control", "canDelete");

  const utils = trpc.useUtils();
  const statusQ = trpc.programming.status.useQuery(undefined, { enabled: canView });
  const deployEnabled = statusQ.data?.deployEnabled ?? false;
  const streamingEnabled = statusQ.data?.streamingEnabled ?? false;
  // doc 40 ENG-F2 — khi bật, deploy production đi qua Approval Inbox (request→approve).
  const deployApprovalEnabled = statusQ.data?.deployApprovalEnabled ?? false;
  const adapters = statusQ.data?.adapters ?? [];
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
  const [projectId, setProjectId] = useState<number | null>(null);
  const project = useMemo(
    () => projectsQ.data?.find((p) => p.id === projectId) ?? null,
    [projectsQ.data, projectId],
  );

  // U13 (doc 26 §2.2) — tìm/lọc client cho Project Explorer (tên/mã + loại thiết bị).
  const [projSearch, setProjSearch] = useState("");
  const [projKindFilter, setProjKindFilter] = useState<string>("all");
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
  const { lastSelected, setLastProjectId } = useEngineering();
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const wanted = deepLink.projectId ?? lastSelected.projectId;
    if (wanted == null) { deepLinkApplied.current = true; return; }
    if (!projectsQ.data) return; // đợi list
    deepLinkApplied.current = true;
    if (projectsQ.data.some((p) => p.id === wanted)) setProjectId(wanted);
  }, [deepLink.projectId, lastSelected.projectId, projectsQ.data]);

  const artifactsQ = trpc.programming.listArtifacts.useQuery(
    { projectId: projectId! },
    { enabled: canView && projectId != null },
  );
  const [artifactId, setArtifactId] = useState<number | null>(null);
  const artifact = useMemo(
    () => artifactsQ.data?.find((a) => a.id === artifactId) ?? null,
    [artifactsQ.data, artifactId],
  );

  // ── W3-11: version diff (chọn 2 phiên bản) + rollback deployment ──
  const [diffBaseId, setDiffBaseId] = useState<number | null>(null);
  const [diffCompareId, setDiffCompareId] = useState<number | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<{ id: number; stage: string } | null>(null);
  const diffBase = useMemo(() => artifactsQ.data?.find((a) => a.id === diffBaseId) ?? null, [artifactsQ.data, diffBaseId]);
  const diffCompare = useMemo(() => artifactsQ.data?.find((a) => a.id === diffCompareId) ?? null, [artifactsQ.data, diffCompareId]);

  // Editor buffer (loaded from the selected artifact; dirty until saved as a new version).
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("text");
  useEffect(() => {
    if (artifact) {
      setCode(artifact.content ?? "");
      setLanguage(artifact.language);
    } else if (project) {
      // U9 — chưa chọn phiên bản: mặc định ngôn ngữ đúng theo loại dự án.
      setLanguage(KIND_LANGUAGE[project.kind as Kind] ?? "text");
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
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const guardDirty = (action: () => void) => {
    if (isDirty) setPendingNav(() => action);
    else action();
  };
  // Xác nhận xóa một biến khỏi bảng tag (thay window.confirm bằng AlertDialog).
  const [deleteSymTarget, setDeleteSymTarget] = useState<{ id: number } | null>(null);

  // Chặn Validate/Build khi còn chỉnh sửa chưa lưu (kết quả sẽ thuộc phiên bản cũ).
  const requireSaved = (): boolean => {
    if (isDirty) {
      toast.warning(t("engineering.saveBeforeCheck", "Lưu phiên bản trước khi kiểm tra/build"));
      return false;
    }
    return true;
  };

  const [diagnostics, setDiagnostics] = useState<Diagnostic[] | null>(null);

  const buildsQ = trpc.programming.listBuilds.useQuery(
    { artifactId: artifactId! },
    { enabled: canView && artifactId != null },
  );
  const [buildId, setBuildId] = useState<number | null>(null);
  const [simResult, setSimResult] = useState<{ ok: boolean; warnings: string[]; timeline: any[] } | null>(null);

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
      setProjectId(row.id);
    },
    onError: (e) => toast.error(e.message),
  });
  // U2 (doc 26) — gắn / đổi thiết bị nguồn cho project đang mở (set project.deviceId).
  const updateProject = trpc.programming.updateProject.useMutation({
    onSuccess: () => {
      toast.success(t("engineering.deviceAttached", "Đã cập nhật thiết bị nguồn"));
      utils.programming.listProjects.invalidate();
      setAttachOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const createArtifact = trpc.programming.createArtifact.useMutation({
    onSuccess: (row) => {
      toast.success(t("engineering.versionSaved", "Đã lưu phiên bản v") + row.version);
      utils.programming.listArtifacts.invalidate();
      setArtifactId(row.id);
    },
    onError: (e) => toast.error(e.message),
  });
  const validateM = trpc.programming.validateArtifact.useMutation({
    onSuccess: (r) => {
      setDiagnostics(r.diagnostics as Diagnostic[]);
      utils.programming.listArtifacts.invalidate();
      r.ok ? toast.success(t("engineering.validOk", "Hợp lệ")) : toast.warning(t("engineering.validErr", "Có lỗi"));
    },
    onError: (e) => toast.error(e.message),
  });
  const buildM = trpc.programming.buildArtifact.useMutation({
    onSuccess: (b) => {
      utils.programming.listBuilds.invalidate();
      setBuildId(b.id);
      b.ok ? toast.success(t("engineering.buildOk", "Build OK")) : toast.error(t("engineering.buildFail", "Build lỗi"));
    },
    onError: (e) => toast.error(e.message),
  });
  const simulateM = trpc.programming.simulateBuild.useMutation({
    onSuccess: (r) => {
      setSimResult({ ok: r.ok, warnings: r.warnings as string[], timeline: r.timeline as any[] });
      toast.success(t("engineering.simDone", "Đã mô phỏng"));
    },
    onError: (e) => toast.error(e.message),
  });
  // doc 54 P3.2 — step-up 2FA (fresh OTP) for deploy actuation when ACTUATION_STEPUP_2FA is on.
  const stepUp = useStepUpOtp();
  const deployM = trpc.programming.deployBuild.useMutation({
    onSuccess: (d) => {
      utils.programming.listDeployments.invalidate();
      // doc 40 (Minh ui-fix) — báo toast THEO trạng thái THẬT (status), không chỉ theo cờ
      // `simulated`. Trước đây rejected/failed vẫn hiện "Đã deploy" → che giấu việc bị từ chối.
      switch (d.status) {
        case "rejected":
        case "failed":
          toast.error(d.error || t("engineering.deployRejected", "Deploy bị từ chối"));
          break;
        case "verified":
          toast.success(t("engineering.deployVerified", "Đã deploy & xác minh (read-back khớp)"));
          break;
        case "deployed":
          toast.warning(t("engineering.deployedUnverified", "Đã deploy nhưng CHƯA xác minh read-back (thiết bị vắng / không hỗ trợ đọc lại)"));
          break;
        case "simulated":
        default:
          toast.success(t("engineering.deploySimulated", "Đã ghi nhận (SIMULATED — flag OFF / chưa sign-off)"));
          break;
      }
    },
    onError: (e) => toast.error(e.message),
  });
  // doc 40 ENG-F2 — gửi YÊU CẦU deploy production (request→approve). Không tự deploy: tạo
  // hàng chờ duyệt để người thứ hai ký ở Approval Inbox (đóng lỗ four-eyes hình thức).
  const requestDeployApprovalM = trpc.programming.requestDeployApproval.useMutation({
    onSuccess: () => {
      utils.programming.listDeployments.invalidate();
      toast.success(t("engineering.deployRequested", "Đã gửi yêu cầu deploy — chờ người thứ hai duyệt ở Hộp duyệt"));
    },
    onError: (e) => toast.error(e.message),
  });
  // W3-11 — rollback: ghi một deployment MỚI về build của lần deploy thành công trước.
  const rollbackM = trpc.programming.rollbackDeployment.useMutation({
    onSuccess: () => {
      utils.programming.listDeployments.invalidate();
      setRollbackTarget(null);
      toast.success(t("engineering.rollbackDone", "Đã khôi phục về phiên bản trước"));
    },
    onError: (e) => { setRollbackTarget(null); toast.error(e.message); },
  });
  // doc 40 W5 §11 — triển khai đội máy (canary): tuần tự qua đúng deployBuild từng máy.
  const deployToFleetM = trpc.programming.deployToFleet.useMutation({
    onSuccess: (r) => {
      utils.programming.listDeployments.invalidate();
      utils.programming.fleetVersionMatrix.invalidate();
      if (r.halted) {
        toast.error(r.haltReason || t("engineering.fleetHalted", "Rollout đã DỪNG do canary không đạt"));
      } else if (r.promoted) {
        toast.success(t("engineering.fleetPromoted", "Canary đạt — đã promote toàn đội máy"));
      } else {
        toast.success(t("engineering.fleetCanaryOk", "Canary đã chạy xong"));
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const fleetResult = deployToFleetM.data ?? null;

  // ── Symbols (tag table) CRUD — feeds Online Monitor ──
  const upsertSymbol = trpc.programming.upsertSymbol.useMutation({
    onSuccess: () => {
      toast.success(t("engineering.symbolSaved", "Đã lưu biến"));
      utils.programming.listSymbols.invalidate();
      setSymOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteSymbol = trpc.programming.deleteSymbol.useMutation({
    onSuccess: () => {
      toast.success(t("engineering.symbolDeleted", "Đã xóa biến"));
      utils.programming.listSymbols.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Online Monitor (watch) — start/stop server watch session + subscribe live room ──
  const [watching, setWatching] = useState(false);
  // Đổi project → dừng watch (session gắn theo project) để không rò session cũ.
  useEffect(() => { setWatching(false); }, [projectId]);
  const startWatchM = trpc.programming.startWatch.useMutation({
    onSuccess: (r) => {
      if (r.started) {
        setWatching(true);
        toast.success(t("engineering.watchStarted", "Đã mở phiên theo dõi"));
      } else {
        setWatching(false);
        const msg =
          r.reason === "no_device"
            ? t("engineering.watchNoDevice", "Dự án chưa gắn thiết bị — không có nguồn để đọc")
            : r.reason === "streaming_disabled"
              ? t("engineering.watchDisabled", "DPC_STREAMING_ENABLED đang TẮT — không mở được luồng")
              : t("engineering.watchNotStarted", "Không mở được phiên theo dõi");
        toast.warning(msg);
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const stopWatchM = trpc.programming.stopWatch.useMutation({
    onSuccess: () => setWatching(false),
    onError: (e) => toast.error(e.message),
  });
  // Subscribe socket room `engineering:{deviceId}` khi đang watch (chỉ đọc giá trị live).
  const { values: liveValues, lastUpdate, connected: streamConnected } = useEngineeringStream(
    project?.deviceId ?? null,
    watching,
  );

  // ── Symbol editor dialog state (thêm/sửa một biến) ──
  const [symOpen, setSymOpen] = useState(false);
  const [symId, setSymId] = useState<number | null>(null);
  const [symName, setSymName] = useState("");
  const [symAddr, setSymAddr] = useState("");
  const [symType, setSymType] = useState("");
  const [symComment, setSymComment] = useState("");
  const [symWatchable, setSymWatchable] = useState(true);
  const openSymDialog = (s?: {
    id: number; name: string; address: string | null; dataType: string | null;
    comment: string | null; watchable: boolean;
  }) => {
    setSymId(s?.id ?? null);
    setSymName(s?.name ?? "");
    setSymAddr(s?.address ?? "");
    setSymType(s?.dataType ?? "");
    setSymComment(s?.comment ?? "");
    setSymWatchable(s?.watchable ?? true);
    setSymOpen(true);
  };

  // U7 (doc 26 §2.1) — cờ đang tạo dự án DEMO một chạm (onboarding KTV mới).
  const [demoCreating, setDemoCreating] = useState(false);

  // ── Create-project dialog state ──
  const [npOpen, setNpOpen] = useState(false);
  const [npCode, setNpCode] = useState("");
  const [npName, setNpName] = useState("");
  const [npKind, setNpKind] = useState<Kind>("stub");
  // U2 — thiết bị nguồn (tùy chọn) khi tạo project; "" = chưa gắn.
  const [npDeviceId, setNpDeviceId] = useState<string>("");

  // ── U2: Attach-device dialog (gắn/đổi thiết bị nguồn cho project đang mở) ──
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachDeviceId, setAttachDeviceId] = useState<string>("");
  const openAttachDialog = () => {
    setAttachDeviceId(project?.deviceId != null ? String(project.deviceId) : "");
    setAttachOpen(true);
  };

  // ── Deploy form state ──
  const [deployStage, setDeployStage] = useState<"staging" | "production">("staging");
  const [signOff, setSignOff] = useState(false);
  // W2-9 — second-approver (SoD) cho deploy production: người ký duyệt + lý do bắt buộc.
  const [approverId, setApproverId] = useState<string>("");
  const [deployReason, setDeployReason] = useState("");
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

  // ── doc 40 W5 §11 — Triển khai đội máy (fleet rollout canary) state ──
  const [fleetDeviceIds, setFleetDeviceIds] = useState<number[]>([]);
  const [fleetStage, setFleetStage] = useState<"staging" | "production">("staging");
  const [fleetSignOff, setFleetSignOff] = useState(false);
  const [fleetCanary, setFleetCanary] = useState(1);
  const [fleetPromoteVerified, setFleetPromoteVerified] = useState(false);
  const [fleetAutoRollback, setFleetAutoRollback] = useState(true);
  const [fleetApproverId, setFleetApproverId] = useState<string>("");
  const [fleetReason, setFleetReason] = useState("");
  const fleetIsProd = fleetStage === "production";
  const toggleFleetDevice = (id: number) =>
    setFleetDeviceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const fleetReady =
    fleetDeviceIds.length > 0 &&
    (!fleetIsProd || (fleetApproverId !== "" && fleetReason.trim().length > 0));
  // Đổi project → xóa lựa chọn đội máy (tránh giữ id máy của project cũ).
  useEffect(() => { setFleetDeviceIds([]); }, [projectId]);

  // ── Editor mode: a visual editor exists for ladder (rung grid) + robot (teach/jog) ──
  const [editorMode, setEditorMode] = useState<"code" | "visual">("code");
  const visualKind =
    project?.kind === "iec61131-ld" ? "ladder" : project?.kind === "robot-tm" ? "teach" : null;

  // Doc 34 · P3 — embedded AI Programming Copilot (collapsible, unobtrusive). Seeded with the
  // current editor buffer as context; Apply inserts the generated code into this editor. Only
  // the 8 copilot-supported kinds map to a source kind (else the panel picks its own default).
  const copilotInitialKind = useMemo<CopilotKind | undefined>(() => {
    const k = project?.kind;
    return k && (COPILOT_KINDS as readonly string[]).includes(k) ? (k as CopilotKind) : undefined;
  }, [project?.kind]);

  // doc 41 — publish this editor to the Programming Copilot DOCK (the "extension"): the live
  // buffer as context, build/validate diagnostics for inline "explain / fix" actions, and
  // Apply inserts generated code back into the editor. Clears when the workspace unmounts.
  const { openDock } = useProgrammingCopilot();
  useCopilotBinding(
    () => ({
      kind: copilotInitialKind,
      code,
      surfaceLabel: t("nav.engineeringWorkspace", "Engineering Workspace"),
      diagnostics: (diagnostics ?? []).map((d) => ({
        message: `${d.line ? `L${d.line}: ` : ""}${d.message}`,
        severity: d.severity === "error" ? ("error" as const) : ("warn" as const),
        source: "validate",
      })),
      onApply: (gen: string) => {
        setCode((prev) => (prev.trim() ? `${prev}\n\n${gen}` : gen));
        toast.success(t("progCopilot.inserted", "Inserted generated code into the editor"));
      },
    }),
    [copilotInitialKind, code, diagnostics],
  );

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
  const buildVersionShortcut = () => {
    if (!canCreate || !artifactId || buildM.isPending) return;
    if (requireSaved()) buildM.mutate({ artifactId });
  };
  useKeyboardShortcuts(
    [
      { key: "s", ctrlKey: true, action: saveVersionShortcut },
      { key: "Enter", ctrlKey: true, action: buildVersionShortcut },
    ],
    { enabled: canView, scope: "global" },
  );

  // U7 (doc 26 §2.1) — MỘT CHẠM: tạo dự án DEMO + phiên bản mẫu (code hợp lệ) rồi tự
  // chọn để KTV mới bấm Kiểm tra/Mô phỏng ngay. Không seed DB tĩnh — tạo theo yêu cầu
  // người dùng qua đúng mutation sẵn có. Kind "stub" là mặc định AN TOÀN (không I/O
  // thiết bị); createProject/createArtifact.onSuccess tự set projectId + artifactId.
  const createDemo = async () => {
    if (!canCreate || demoCreating) return;
    setDemoCreating(true);
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
      setDemoCreating(false);
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

  return (
    <DashboardLayout>
      <PageContainer fluid className="space-y-4">
        <PageHeader
          breadcrumbs={crumbs}
          icon={<Code2 className="h-6 w-6" />}
          title={t("engineering.title", "Xưởng lập trình thiết bị")}
          badge={!canEdit ? <ViewOnlyBadge module="machine_control" /> : undefined}
          description={t("engineering.subtitle", "Soạn → kiểm tra → build → mô phỏng → (sign-off) deploy cho PLC / Robot / Zmotion")}
          actions={
            <>
              <Badge variant={deployEnabled ? "default" : "secondary"}>
                {t("engineering.deployFlag", "Deploy")}: {deployEnabled ? "ON" : "OFF"}
              </Badge>
              <Button variant="outline" size="sm" onClick={() => { statusQ.refetch(); projectsQ.refetch(); }}>
                <RefreshCw className="mr-1 h-4 w-4" /> {t("common.refresh", "Làm mới")}
              </Button>
            </>
          }
        />

        {/* W6-26 — "Khi nào dùng" + cross-link golden-thread (ranh giới IDE vs IR vs POU). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-start gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            {t("engineering.whenToUse", "When to use — the full IDE pipeline: build, simulate, sign-off & deploy device programs. Low-level motion/IO? Use the IR Editor. IEC 61131 LAD/FBD/SFC? Use POU Studio.")}
          </span>
          {/* U1 — cross-link MANG ?projectId: mở đúng project đang chọn ở IR/POU (không mở trống). */}
          <span className="inline-flex items-center gap-3">
            <Link href="/engineering-home" className="font-medium text-primary hover:underline">{t("nav.engineeringHome")}</Link>
            <Link href={withParams("/ir-editor", { projectId })} className="font-medium text-primary hover:underline">
              {projectId ? t("engineering.openInIr", "Mở project này trong IR") : t("nav.irEditor")}
            </Link>
            <Link href={withParams("/pou-studio", { projectId })} className="font-medium text-primary hover:underline">
              {projectId ? t("engineering.openInPou", "Mở project này trong POU") : t("nav.pouStudio")}
            </Link>
          </span>
        </div>

        {!deployEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t("engineering.deployOffBanner", "DPC_DEPLOY_ENABLED đang TẮT — mọi deploy được ghi nhận là SIMULATED, không ghi xuống thiết bị. An toàn (E-stop/interlock) luôn nằm trên PLC chứng nhận.")}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          {/* ── Project Explorer ── */}
          <Card className="h-fit">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderGit2 className="h-4 w-4" /> {t("engineering.projects", "Dự án")}
              </CardTitle>
              <Dialog open={npOpen} onOpenChange={setNpOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={!canCreate} title={createReason}><Plus className="h-4 w-4" /></Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("engineering.newProject", "Dự án mới")}</DialogTitle>
                    <DialogDescription>{t("engineering.newProjectDesc", "Một workspace lập trình cho một thiết bị/cell")}</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
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
                  <DialogFooter>
                    <Button
                      disabled={!npCode || !npName || createProject.isPending}
                      onClick={() => {
                        createProject.mutate({
                          code: npCode,
                          name: npName,
                          kind: npKind,
                          deviceId: npDeviceId ? Number(npDeviceId) : undefined,
                        });
                        setNpOpen(false);
                        setNpCode(""); setNpName(""); setNpDeviceId("");
                      }}
                    >
                      {t("common.create", "Tạo")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-1">
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
              {(projectsQ.data ?? []).length === 0 && (
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
                      setProjectId(p.id); setArtifactId(null); setBuildId(null); setSimResult(null); setDiagnostics(null);
                      setLastProjectId(p.id); // U1 — nhớ project để mang theo khi chuyển trang
                    });
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${projectId === p.id ? "bg-muted font-medium" : ""}`}
                >
                  <span className="truncate">{p.name}</span>
                  <Badge variant="outline" className="ml-1 shrink-0 text-[10px]">{p.kind}</Badge>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* ── Editor + actions ── */}
          <div className="space-y-4">
            {!project ? (
              projectsQ.isLoading ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("common.loading", "Đang tải…")}</CardContent></Card>
              ) : projectsQ.isError ? (
                <Card><CardContent className="py-12 text-center text-destructive">{t("common.error", "Có lỗi khi tải")}</CardContent></Card>
              ) : (projectsQ.data ?? []).length === 0 ? (
                // U7 — CHƯA có dự án nào: onboarding GIÀU + nút "Tạo dự án DEMO" một chạm.
                <Card>
                  <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Rocket className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold">{t("engineering.emptyTitle", "Bắt đầu tại đây")}</h3>
                      <p className="mx-auto max-w-md text-sm text-muted-foreground">
                        {t("engineering.emptyDesc", "Chưa có dự án nào. Tạo một dự án DEMO có sẵn chương trình mẫu để làm quen — rồi bấm Kiểm tra và Mô phỏng ngay. An toàn tuyệt đối: không phát lệnh xuống thiết bị.")}
                      </p>
                    </div>
                    {/* 3 bước để bắt đầu */}
                    <ol className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                      {[
                        t("engineering.step1", "Tạo dự án demo"),
                        t("engineering.step2", "Bấm Kiểm tra"),
                        t("engineering.step3", "Bấm Mô phỏng"),
                      ].map((label, i) => (
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
                  </CardContent>
                </Card>
              ) : (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("engineering.selectProject", "Chọn một dự án để bắt đầu")}</CardContent></Card>
              )
            ) : (
              <>
                {/* U14 (doc 26 §3.2) — STEPPER luồng vàng: đánh dấu bước đã hoàn tất + cuộn tới card. */}
                <GoldenThreadStepper
                  t={t}
                  steps={[
                    // Soạn: đã có ≥1 phiên bản đã lưu (code soạn xong & lưu).
                    { key: "compose", label: t("engineering.gtCompose", "Soạn"), Icon: FileCode, anchor: "gt-editor", done: (artifactsQ.data ?? []).length > 0 },
                    // Kiểm tra: đã chạy validate, không còn lỗi error.
                    { key: "validate", label: t("engineering.gtValidate", "Kiểm tra"), Icon: CheckCircle2, anchor: "gt-editor", done: diagnostics != null && diagnostics.every((d) => d.severity !== "error") },
                    // Build: đã có ≥1 build.
                    { key: "build", label: t("engineering.gtBuild", "Build"), Icon: Hammer, anchor: "gt-editor", done: (buildsQ.data ?? []).length > 0 },
                    // Mô phỏng: đã chạy sim và ĐẠT.
                    { key: "sim", label: t("engineering.gtSim", "Mô phỏng"), Icon: FlaskConical, anchor: "gt-builds", done: Boolean(simResult && simResult.ok) },
                    // Deploy: đã có ≥1 lượt deploy (kể cả simulated).
                    { key: "deploy", label: t("engineering.gtDeploy", "Deploy"), Icon: Rocket, anchor: "gt-deploy", done: (deploymentsQ.data ?? []).length > 0 },
                    // Giám sát: đang theo dõi trực tiếp.
                    { key: "monitor", label: t("engineering.gtMonitor", "Giám sát"), Icon: Radio, anchor: "gt-monitor", done: watching },
                  ]}
                />

                {/* Artifacts (versions) */}
                <Card id="gt-editor" className="scroll-mt-16">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileCode className="h-4 w-4" /> {project.name} · {t("engineering.versions", "Phiên bản")}
                      {isDirty && (
                        <Badge variant="outline" className="border-warning/50 text-[10px] text-warning">
                          <AlertTriangle className="mr-1 h-3 w-3" /> {t("engineering.unsaved", "Chưa lưu")}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 flex flex-wrap gap-1">
                      {(artifactsQ.data ?? []).map((a) => (
                        <button
                          key={a.id}
                          onClick={() => { if (a.id !== artifactId) guardDirty(() => setArtifactId(a.id)); }}
                          className={`rounded border px-2 py-1 text-xs hover:bg-muted ${artifactId === a.id ? "border-primary bg-muted" : ""}`}
                        >
                          v{a.version} · {a.branch}
                          <Badge variant="outline" className="ml-1 text-[9px]">{a.status}</Badge>
                        </button>
                      ))}
                      {(artifactsQ.data ?? []).length === 0 && (
                        <span className="text-sm text-muted-foreground">{t("engineering.noVersions", "Chưa có phiên bản — soạn rồi lưu bên dưới")}</span>
                      )}
                    </div>

                    {/* W3-11 — So sánh 2 phiên bản (diff dòng) */}
                    {(artifactsQ.data ?? []).length >= 2 && (
                      <div className="mb-3 rounded-md border bg-muted/20 p-2">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                            <GitCompare className="h-3.5 w-3.5" /> {t("engineering.compareVersions", "So sánh phiên bản")}
                          </span>
                          <Select value={diffBaseId != null ? String(diffBaseId) : ""} onValueChange={(v) => setDiffBaseId(Number(v))}>
                            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder={t("engineering.diffBase", "Bản gốc")} /></SelectTrigger>
                            <SelectContent>
                              {(artifactsQ.data ?? []).map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>v{a.version} · {a.branch}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-xs text-muted-foreground">→</span>
                          <Select value={diffCompareId != null ? String(diffCompareId) : ""} onValueChange={(v) => setDiffCompareId(Number(v))}>
                            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder={t("engineering.diffCompare", "So với")} /></SelectTrigger>
                            <SelectContent>
                              {(artifactsQ.data ?? []).map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>v{a.version} · {a.branch}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {diffBase && diffCompare ? (
                          <LineDiff left={diffBase.content ?? ""} right={diffCompare.content ?? ""} maxHeightClass="max-h-[300px]" />
                        ) : (
                          <p className="py-2 text-center text-xs text-muted-foreground">{t("engineering.diffPick", "Chọn 2 phiên bản để xem khác biệt")}</p>
                        )}
                      </div>
                    )}

                    {/* Editor */}
                    <div className="mb-2 flex items-center gap-2">
                      <Label className="text-xs">{t("engineering.language", "Ngôn ngữ")}</Label>
                      {/* U9 — Select token hợp lệ theo kind, thay ô gõ tay (tránh gõ sai). */}
                      <Select value={language} onValueChange={setLanguage} disabled={!canCreate}>
                        <SelectTrigger className="h-7 w-32 text-xs" aria-label={t("engineering.language", "Ngôn ngữ")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {langOptions.map((lang) => (
                            <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {visualKind && (
                        <div className="flex overflow-hidden rounded-md border">
                          <button
                            onClick={() => setEditorMode("code")}
                            className={`px-2 py-1 text-xs ${editorMode === "code" ? "bg-muted font-medium" : ""}`}
                          >
                            {t("engineering.modeCode", "Code")}
                          </button>
                          <button
                            onClick={() => setEditorMode("visual")}
                            className={`px-2 py-1 text-xs ${editorMode === "visual" ? "bg-muted font-medium" : ""}`}
                          >
                            {visualKind === "ladder" ? t("engineering.modeLadder", "Ladder") : t("engineering.modeTeach", "Teach/Jog")}
                          </button>
                        </div>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">{code.split("\n").length} {t("engineering.lines", "dòng")}</span>
                    </div>
                    {visualKind && editorMode === "visual" ? (
                      visualKind === "ladder" ? (
                        <LadderEditor value={code} onChange={setCode} />
                      ) : (
                        <TeachJogPanel value={code} onChange={setCode} />
                      )
                    ) : (
                      <CodeEditor
                        value={code}
                        onChange={setCode}
                        language={language}
                        aria-label="program-source"
                        // doc69 · Wave 4 / C1 — the primary authoring surface gets inline (ghost-text)
                        // completion; opt-in per CodeEditor.tsx, other consumers are unchanged.
                        inlineCopilot
                      />
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={!canCreate || !code.trim() || createArtifact.isPending}
                        onClick={saveVersionShortcut}
                        title={createReason ?? t("engineering.saveShortcut", "Lưu phiên bản (Ctrl/Cmd+S)")}
                      >
                        <Plus className="mr-1 h-4 w-4" /> {t("engineering.saveVersion", "Lưu phiên bản")}
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        disabled={!artifactId || validateM.isPending}
                        onClick={() => { if (artifactId && requireSaved()) validateM.mutate({ artifactId }); }}
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4" /> {t("engineering.validate", "Kiểm tra")}
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        disabled={!canCreate || !artifactId || buildM.isPending}
                        onClick={buildVersionShortcut}
                        title={createReason ?? t("engineering.buildShortcut", "Build (Ctrl/Cmd+Enter)")}
                      >
                        <Hammer className="mr-1 h-4 w-4" /> {t("engineering.build", "Build")}
                      </Button>
                    </div>

                    {/* Diagnostics */}
                    {diagnostics && (
                      <div className="mt-3 rounded-md border bg-muted/30 p-2 text-xs">
                        {diagnostics.length === 0 ? (
                          <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" /> {t("engineering.noDiag", "Không có cảnh báo")}</span>
                        ) : (
                          diagnostics.map((d, i) => (
                            <div key={i} className="flex items-center gap-1">
                              {d.severity === "error" ? <XCircle className="h-3 w-3 text-destructive" /> : <AlertTriangle className="h-3 w-3 text-warning" />}
                              <span>{d.line ? `L${d.line}: ` : ""}{d.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Doc 34 · P3 / doc 41 — AI Programming Copilot now lives in the persistent
                    DOCK (right rail, mounted app-wide) — the "extension" model. This card is
                    the anchor + opener; the dock is already seeded with this editor's buffer +
                    diagnostics and Apply inserts generated code back here. */}
                <Card id="gt-copilot" className="scroll-mt-16">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Sparkles className="h-4 w-4 text-primary" />
                      {t("progCopilot.embedTitle", "AI Programming Copilot")}
                      <Badge variant="outline" className="text-[10px]">{t("progCopilot.beta", "Beta")}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {t("progCopilot.dockHint", "Trợ lý sinh/hoàn thiện/dịch/rà soát mã — mở ở thanh bên phải, đã gắn sẵn buffer & lỗi của editor này.")}
                    </p>
                    <Button size="sm" variant="outline" onClick={openDock}>
                      <Sparkles className="mr-1.5 h-4 w-4" />
                      {t("progCopilot.openDock", "Mở Trợ lý")}
                    </Button>
                  </CardContent>
                </Card>

                {/* Builds + Simulate */}
                <Card id="gt-builds" className="scroll-mt-16">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" /> {t("engineering.builds", "Builds & Mô phỏng")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1">
                      {(buildsQ.data ?? []).map((b) => (
                        <button
                          key={b.id}
                          onClick={() => { setBuildId(b.id); setSimResult(null); }}
                          className={`rounded border px-2 py-1 text-xs hover:bg-muted ${buildId === b.id ? "border-primary bg-muted" : ""}`}
                        >
                          #{b.id} <Badge variant={b.ok ? "default" : "destructive"} className="ml-1 text-[9px]">{b.status}</Badge>
                        </button>
                      ))}
                      {(buildsQ.data ?? []).length === 0 && <span className="text-sm text-muted-foreground">{t("engineering.noBuilds", "Chưa có build")}</span>}
                    </div>
                    <Button
                      size="sm" variant="outline"
                      disabled={!buildId || simulateM.isPending}
                      onClick={() => buildId && simulateM.mutate({ buildId, scenario: {} })}
                    >
                      <Play className="mr-1 h-4 w-4" /> {t("engineering.simulate", "Mô phỏng (twin)")}
                    </Button>
                    {simResult && (() => {
                      // U8 — Verdict rõ ràng ở đầu kết quả: đọc trạng thái từ simResult hiện có.
                      //  · !ok            → KHÔNG ĐẠT (đỏ)
                      //  · ok + warnings  → CÓ CẢNH BÁO (vàng)
                      //  · ok + sạch      → ĐẠT (OK) (xanh)
                      const verdict = !simResult.ok ? "fail" : simResult.warnings.length > 0 ? "warn" : "pass";
                      const vCfg = {
                        pass: { cls: "border-success/40 bg-success/10 text-success", Icon: CheckCircle2, label: t("engineering.simPass", "ĐẠT (OK)") },
                        warn: { cls: "border-warning/40 bg-warning/10 text-warning", Icon: AlertTriangle, label: t("engineering.simWarn", "CÓ CẢNH BÁO") },
                        fail: { cls: "border-destructive/40 bg-destructive/10 text-destructive", Icon: XCircle, label: t("engineering.simFail", "KHÔNG ĐẠT") },
                      }[verdict];
                      const VIcon = vCfg.Icon;
                      return (
                        <div className="rounded-md border bg-muted/30 p-2 text-xs">
                          {/* Badge verdict LỚN, màu rõ — đồng bộ ngữ nghĩa màu với Orchestration */}
                          <div className={`mb-2 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${vCfg.cls}`}>
                            <VIcon className="h-4 w-4 shrink-0" /> {vCfg.label}
                          </div>
                          <div className="mb-1 font-medium">{t("engineering.timeline", "Timeline")} ({simResult.timeline.length} {t("engineering.steps", "bước")})</div>
                          {simResult.warnings.map((w, i) => (
                            <div key={i} className="flex items-center gap-1 text-warning">
                              <AlertTriangle className="h-3 w-3 shrink-0" /> {w}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>

                {/* Deploy (gated) */}
                <Card id="gt-deploy" className="scroll-mt-16">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><Rocket className="h-4 w-4" /> {t("engineering.deploy", "Deploy (có kiểm soát)")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* doc 40 ENG-F13 — PRE-FLIGHT: cảnh báo TRƯỚC nếu user thiếu 2FA / quyền để
                        deploy (actuation). Không đợi tới lúc bấm mới nhận FORBIDDEN từ server. */}
                    {readiness.blockers.length > 0 && (
                      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-1">
                          <div className="font-medium">
                            {t("engineering.readinessTitle", "Chưa đủ điều kiện để deploy (actuation)")}
                          </div>
                          <ul className="list-disc space-y-0.5 pl-4">
                            {readiness.blockers.map((bl) => (
                              <li key={bl.code}>{t(`actuationReadiness.${bl.code}`, bl.defaultMessage)}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <Label className="text-xs">{t("engineering.stage", "Giai đoạn")}</Label>
                        <Select value={deployStage} onValueChange={(v) => setDeployStage(v as any)}>
                          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="staging">staging</SelectItem>
                            <SelectItem value="production">production</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {/* Staging: tự ký (SoD chỉ áp dụng cho production). */}
                      {!isProd && (
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox checked={signOff} onCheckedChange={(v) => setSignOff(Boolean(v))} />
                          <ShieldCheck className="h-3 w-3" /> {t("engineering.signOff", "Tôi ký duyệt (HITL sign-off)")}
                        </label>
                      )}
                      {/* Production + Approval Inbox BẬT: KHÔNG cho người yêu cầu tự chọn approver.
                          Chỉ gửi yêu cầu; người thứ hai ký ở Hộp duyệt bằng session của họ. */}
                      {useApprovalFlow && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs text-muted-foreground">
                          <ShieldCheck className="h-3 w-3 shrink-0 text-primary" />
                          {t("engineering.approvalInboxHint", "Sẽ gửi CHỜ DUYỆT — người thứ hai ký ở Hộp duyệt")}
                        </span>
                      )}
                      {/* Production (legacy, flag OFF): second-approver do người yêu cầu chọn. */}
                      {isProd && !deployApprovalEnabled && (
                        <div>
                          <Label className="text-xs">{t("engineering.approver", "Người ký duyệt")}</Label>
                          <Select value={approverId} onValueChange={setApproverId}>
                            <SelectTrigger className="h-8 w-48">
                              <SelectValue placeholder={t("engineering.selectApprover", "Chọn người ký duyệt…")} />
                            </SelectTrigger>
                            <SelectContent>
                              {approverOptions.map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  {a.name || a.username || `#${a.id}`}
                                </SelectItem>
                              ))}
                              {approverOptions.length === 0 && (
                                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                  {t("engineering.noApprovers", "Không có người đủ quyền ký duyệt")}
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {useApprovalFlow ? (
                        <Button
                          size="sm"
                          disabled={!canCreate || !buildId || requestDeployApprovalM.isPending || !prodDeployReady}
                          title={createReason}
                          onClick={() =>
                            buildId && requestDeployApprovalM.mutate({
                              buildId,
                              // Khóa idempotency ổn định theo build → double-click không tạo 2 yêu cầu.
                              idempotencyKey: `depreq-${buildId}-production`,
                              reason: deployReason.trim(),
                            })
                          }
                        >
                          <Rocket className="mr-1 h-4 w-4" /> {t("engineering.requestDeployBtn", "Gửi yêu cầu deploy")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={!canCreate || !buildId || deployM.isPending || !prodDeployReady}
                          title={createReason}
                          onClick={() =>
                            buildId && stepUp.guard((totpCode) => deployM.mutate({
                              buildId,
                              stage: deployStage,
                              // Khóa idempotency ổn định theo (build, stage) → double-click không tạo 2 deploy.
                              idempotencyKey: `dep-${buildId}-${deployStage}`,
                              actionId: rid("act"),
                              confirmedBy: isProd
                                ? (approverId ? Number(approverId) : undefined)
                                : (signOff && user?.id ? user.id : undefined),
                              reason: isProd ? deployReason.trim() : undefined,
                              totpCode,
                            }))
                          }
                        >
                          <Rocket className="mr-1 h-4 w-4" /> {t("engineering.deployBtn", "Deploy build")}
                        </Button>
                      )}
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

                    {/* Deployments audit */}
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
                                <Button
                                  size="sm" variant="outline"
                                  disabled={rollbackM.isPending}
                                  onClick={() => setRollbackTarget({ id: d.id, stage: d.stage })}
                                >
                                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> {t("engineering.rollback", "Khôi phục")}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(deploymentsQ.data ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">{t("engineering.noDeploys", "Chưa có deploy")}</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* doc 40 W5 §11 — TRIỂN KHAI ĐỘI MÁY (fleet rollout canary + ma trận version) */}
                <Card id="gt-fleet" className="scroll-mt-16">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Rocket className="h-4 w-4" /> {t("engineering.fleetTitle", "Triển khai đội máy (canary)")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      {t("engineering.fleetHint", "Đẩy build đang chọn ra nhiều máy TUẦN TỰ qua đúng đường deploy (giữ nguyên mọi cổng an toàn). Canary N máy đầu; nếu không đạt sẽ DỪNG và (tùy chọn) tự khôi phục các máy đã ghi.")}
                    </p>

                    {/* Pre-flight actuation readiness (2FA/quyền) — dùng chung với deploy đơn. */}
                    {readiness.blockers.length > 0 && (
                      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <ul className="list-disc space-y-0.5 pl-4">
                          {readiness.blockers.map((bl) => (
                            <li key={bl.code}>{t(`actuationReadiness.${bl.code}`, bl.defaultMessage)}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {!buildId && (
                      <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                        {t("engineering.fleetNeedBuild", "Chọn một build ở khối \"Builds & Mô phỏng\" trước để triển khai ra đội máy.")}
                      </p>
                    )}

                    {/* Chọn máy đích (đa chọn) */}
                    <div>
                      <Label className="text-xs">{t("engineering.fleetTargets", "Máy đích")} ({fleetDeviceIds.length})</Label>
                      <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                        {(machinesQ.data ?? []).length === 0 && (
                          <p className="text-xs text-muted-foreground">{t("engineering.noMachines", "Chưa có máy nào — có thể gắn sau ở Online Monitor")}</p>
                        )}
                        {(machinesQ.data ?? []).map((m) => (
                          <label key={m.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={fleetDeviceIds.includes(m.id)}
                              onCheckedChange={() => toggleFleetDevice(m.id)}
                            />
                            <span className="truncate">{m.name} · #{m.id}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Chiến lược canary */}
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <Label className="text-xs">{t("engineering.stage", "Giai đoạn")}</Label>
                        <Select value={fleetStage} onValueChange={(v) => setFleetStage(v as "staging" | "production")}>
                          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="staging">staging</SelectItem>
                            <SelectItem value="production">production</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
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
                        <div>
                          <Label className="text-xs">{t("engineering.approver", "Người ký duyệt")}</Label>
                          <Select value={fleetApproverId} onValueChange={setFleetApproverId}>
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
                        <div className="flex-1 min-w-[220px]">
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

                    <Button
                      size="sm"
                      disabled={!canCreate || !buildId || !fleetReady || deployToFleetM.isPending}
                      title={createReason}
                      onClick={() => {
                        if (!buildId) return;
                        // QA W5: nonce/lần-thử để LẦN NÀY khác lần trước → sau khi canary
                        // hỏng (rejected) và sửa build, bấm lại sẽ DEPLOY LẠI thay vì trả
                        // về hàng rejected cũ (deployBuild dedupe theo idempotencyKey).
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
                        }));
                      }}
                    >
                      {deployToFleetM.isPending
                        ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
                        : <Rocket className="mr-1 h-4 w-4" />}
                      {t("engineering.fleetDeployBtn", "Triển khai (canary)")}
                    </Button>

                    {/* Kết quả rollout từng máy */}
                    {fleetResult && (
                      <div className="space-y-2">
                        <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                          fleetResult.halted
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-success/40 bg-success/10 text-success"
                        }`}>
                          {fleetResult.halted ? <XCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
                          {fleetResult.halted
                            ? t("engineering.fleetHaltedShort", "DỪNG — canary không đạt")
                            : fleetResult.promoted
                              ? t("engineering.fleetPromotedShort", "Đã promote toàn đội máy")
                              : t("engineering.fleetCanaryOkShort", "Canary đã chạy")}
                        </div>
                        {fleetResult.haltReason && (
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

                    {/* Ma trận máy × version (máy nào đang chạy artifact/hash nào) */}
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <GitCompare className="h-3.5 w-3.5" /> {t("engineering.fleetMatrix", "Ma trận máy × version")}
                      </div>
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
                              <TableCell>
                                <Badge variant={e.simulated ? "outline" : "secondary"}>{e.status}</Badge>
                              </TableCell>
                              <TableCell className="font-mono text-[10px]">{e.contentHash ? e.contentHash.slice(0, 12) + "…" : "—"}</TableCell>
                            </TableRow>
                          ))}
                          {(fleetMatrixQ.data ?? []).length === 0 && (
                            <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">{t("engineering.fleetMatrixEmpty", "Chưa có máy nào ghi nhận phiên bản")}</TableCell></TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Symbols + Online Monitor (watch table) */}
                <Card id="gt-monitor" className="scroll-mt-16">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Variable className="h-4 w-4" /> {t("engineering.symbols", "Bảng biến / tag")}
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Badge NGUỒN trung thực — không giả lập giá trị. */}
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
                              {lastUpdate == null && (
                                <span className="opacity-80">· {t("engineering.srcNoData", "chưa có dữ liệu")}</span>
                              )}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <Radio className="h-3 w-3" /> {t("engineering.srcReady", "Thiết bị")} #{project.deviceId}
                            </Badge>
                          );
                        })()}
                        {/* U2 — gắn/đổi thiết bị nguồn ngay cạnh badge Nguồn (sửa project.deviceId). */}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canEdit}
                          title={editReason}
                          onClick={openAttachDialog}
                        >
                          <Wifi className="mr-1 h-4 w-4" />
                          {project.deviceId == null
                            ? t("engineering.attachDevice", "Gắn thiết bị")
                            : t("engineering.changeDevice", "Đổi thiết bị")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canEdit}
                          title={editReason}
                          onClick={() => openSymDialog()}
                        >
                          <Plus className="mr-1 h-4 w-4" /> {t("engineering.addSymbol", "Thêm biến")}
                        </Button>
                        {watching ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={stopWatchM.isPending}
                            onClick={() => stopWatchM.mutate({ projectId: project.id })}
                          >
                            <WifiOff className="mr-1 h-4 w-4" /> {t("engineering.stopWatch", "Dừng theo dõi")}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={
                              startWatchM.isPending ||
                              (symbolsQ.data ?? []).filter((s) => s.watchable).length === 0
                            }
                            onClick={() =>
                              startWatchM.mutate({
                                projectId: project.id,
                                symbols: (symbolsQ.data ?? [])
                                  .filter((s) => s.watchable)
                                  .map((s) => s.name),
                              })
                            }
                          >
                            <Radio className="mr-1 h-4 w-4" /> {t("engineering.startWatch", "Theo dõi trực tiếp")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {/* Loading / error cho bảng biến. */}
                    {symbolsQ.isLoading && (
                      <p className="py-2 text-center text-sm text-muted-foreground">{t("common.loading", "Đang tải…")}</p>
                    )}
                    {symbolsQ.isError && (
                      <p className="py-2 text-center text-sm text-destructive">{t("common.error", "Có lỗi khi tải")}</p>
                    )}
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
                                {!s.watchable && (
                                  <Badge variant="outline" className="ml-1 text-[9px]">{t("engineering.noWatch", "no-watch")}</Badge>
                                )}
                              </TableCell>
                              <TableCell>{s.address ?? "—"}</TableCell>
                              <TableCell>{s.dataType ?? "—"}</TableCell>
                              <TableCell className="font-mono">
                                {live ? String(live.value) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {live ? new Date(live.ts).toLocaleTimeString() : "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="icon" variant="ghost" className="h-7 w-7"
                                    disabled={!canEdit}
                                    title={editReason}
                                    aria-label={t("common.edit", "Sửa")}
                                    onClick={() => openSymDialog(s)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                                    disabled={!canDelete || deleteSymbol.isPending}
                                    title={!canDelete ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" }) : undefined}
                                    aria-label={t("common.delete", "Xóa")}
                                    onClick={() => setDeleteSymTarget({ id: s.id })}
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
                    {watching && lastUpdate == null && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {t("engineering.watchNoDataHint", "Đang theo dõi nhưng chưa có mẫu — nguồn đọc thật cần thiết bị/adapter (chưa gắn HW).")}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Symbol editor dialog (thêm/sửa một biến trong bảng tag) */}
                <Dialog open={symOpen} onOpenChange={setSymOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>
                        {symId ? t("engineering.editSymbol", "Sửa biến") : t("engineering.addSymbol", "Thêm biến")}
                      </DialogTitle>
                      <DialogDescription>{t("engineering.symbolDesc", "Một tag/biến của thiết bị để theo dõi (watch) trong Online Monitor")}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
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
                    <DialogFooter>
                      <Button
                        disabled={!canEdit || !symName.trim() || upsertSymbol.isPending}
                        title={editReason}
                        onClick={() =>
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
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* U2 — Attach/đổi thiết bị nguồn cho project (mở khoá Online Monitor) */}
                <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("engineering.attachDeviceTitle", "Gắn thiết bị nguồn")}</DialogTitle>
                      <DialogDescription>
                        {t("engineering.attachDeviceDesc", "Chọn máy làm nguồn đọc cho \"{{name}}\". Sau khi gắn, badge Nguồn chuyển sang thiết bị và có thể Theo dõi trực tiếp.", { name: project.name })}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
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
                      {project.deviceId != null && (
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
                    <DialogFooter>
                      <Button
                        disabled={!canEdit || !attachDeviceId || updateProject.isPending}
                        title={editReason}
                        onClick={() => updateProject.mutate({ id: project.id, deviceId: Number(attachDeviceId) })}
                      >
                        {t("common.save", "Lưu")}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        </div>
      </PageContainer>

      {/* U11 (doc 26 §3.1) — bỏ thay đổi chưa lưu khi chuyển dự án/phiên bản (thay window.confirm) */}
      <AlertDialog open={pendingNav != null} onOpenChange={(o) => { if (!o) setPendingNav(null); }}>
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
                setPendingNav(null);
                run?.();
              }}
            >
              {t("engineering.dirtyDiscard", "Bỏ thay đổi & tiếp tục")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* U11 (doc 26 §3.1) — xác nhận xóa một biến khỏi bảng tag (thay window.confirm) */}
      <AlertDialog open={deleteSymTarget != null} onOpenChange={(o) => { if (!o) setDeleteSymTarget(null); }}>
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
                setDeleteSymTarget(null);
              }}
            >
              {t("common.delete", "Xóa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* W3-11 — xác nhận khôi phục (rollback) một deployment về phiên bản trước */}
      <AlertDialog open={rollbackTarget != null} onOpenChange={(o) => { if (!o) setRollbackTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("engineering.rollbackTitle", "Khôi phục phiên bản trước?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("engineering.rollbackDesc", "Sẽ ghi một deployment MỚI về build của lần deploy thành công trước ở giai đoạn \"{{stage}}\". Chịu cùng cổng an toàn (sign-off / flag) như deploy.", { stage: rollbackTarget?.stage ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Hủy")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rollbackTarget == null) return;
                // idempotencyKey/actionId ỔN ĐỊNH theo deploymentId → click lại không tạo bản trùng.
                stepUp.guard((totpCode) => rollbackM.mutate({
                  deploymentId: rollbackTarget.id,
                  idempotencyKey: `rollback-dep-${rollbackTarget.id}`,
                  actionId: `rollback-dep-${rollbackTarget.id}`,
                  totpCode,
                }));
              }}
            >
              {t("engineering.rollback", "Khôi phục")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* doc 54 P3.2 — step-up 2FA prompt for deploy/rollback/fleet actuation */}
      {stepUp.dialog}
    </DashboardLayout>
  );
}
