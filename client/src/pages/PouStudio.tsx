/**
 * Doc 24 Wave-3 / P4 — IEC 61131-3 POU STUDIO (structured LAD/FBD/SFC + PLCopen XML).
 *
 * A focused read + basic-authoring surface for the structured IEC 61131-3 POU model:
 *   • edit a POU PROJECT as JSON (LAD rungs / FBD networks / SFC steps + variable decls),
 *   • run the SEMANTIC linter (undeclared var / type mismatch / unreachable step),
 *   • preview the deterministic POU → Structured Text lowering (with (* [IEC …] *) markers),
 *   • ROUND-TRIP via PLCopen TC6 XML: Export the model to XML, or Import XML back to a model.
 *
 * HONESTY (mirrors the adapter + router): every action here is a PURE preview/transform —
 * NO device path, NO persistence. A POU reaches an OPEN runtime (OpenPLC) only through the
 * EXISTING gated programming pipeline (save as an "iec61131-pou" artifact → build → HITL →
 * gated deploy). E-stop / SIL safety is NEVER authored here — it stays on the certified L1 PLC.
 *
 * A full drag-drop graphical ladder/FBD canvas is a later stretch; this page is the model +
 * interchange + transpile surface. Reads are open (machine_monitoring / canView).
 *
 * Layout (doc 81 Đợt 2 Task 14 — mẫu P1 trên EngineeringShell, cùng khuôn IR Editor):
 *   top bar 48 px (h1 · lint · Khi nào dùng │ Build/Deploy ở Engineering · Lưu vào project (sheet) · Làm mới) →
 *   activity bar + Explorer "Mở" (MỚI: dự án iec61131-pou → phiên bản pou-json → Mở = nạp vào trình soạn, chỉ đọc; mẫu
 *   LAD/FBD/SFC) · MAIN = một toolbar tab editor (Canvas / JSON — R-2-s) + editor cao hết vùng · Inspector phải
 *   [Chuyển mã → ST | PLCopen XML | Copilot] (Copilot TRONG layout — R-2-b, không dock) · panel dưới "Vấn đề" (gập lần
 *   đầu — R-2-l) · thanh trạng thái (chip "Xem trước — không deploy" + KPI + số vấn đề).
 */
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useCopilotBinding, useProgrammingCopilot, type CopilotBinding } from "@/contexts/ProgrammingCopilotContext";
import { useLocation, Link, useSearch } from "wouter";
import { useEngineering } from "@/contexts/EngineeringContext";
import { parseDeepLink, withParams } from "@/lib/engineeringDeepLink";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { useShellPageVariant } from "@/lib/shellPage";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeaderCompact, NoticeChip, StatusBadge } from "@/components/patterns";
import { EngineeringShell } from "@/components/engineering/shell";
import { CopilotInspector } from "@/components/programming/CopilotInspector";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CodeEditor } from "@/components/engineering/CodeEditor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Code2, FileCode2, ShieldCheck, AlertTriangle, XCircle,
  Download, Upload, Copy, Lock, Info, RefreshCw, Save, Hammer, FolderPlus, FolderOpen, ExternalLink, Loader2, Sparkles,
  PanelRight,
} from "lucide-react";
import { toast } from "sonner";
import { PouCanvas, type PouCanvasDiag } from "@/components/programming/PouCanvas";
import type { PouProject } from "../../../server/services/programming/iec61131/pouModel";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type PouProjectInput = RouterInputs["programming"]["pouTranspilePreview"]["project"];
type TranspileOut = RouterOutputs["programming"]["pouTranspilePreview"];
type LintOut = RouterOutputs["programming"]["pouLint"];

// ── Built-in samples (LAD seal-in / FBD arithmetic / SFC sequence) ────────────
const SAMPLE_LAD = {
  name: "MotorProject",
  pous: [{
    name: "MotorControl", pouType: "program",
    vars: [
      { name: "Start", type: "BOOL", section: "VAR_INPUT" },
      { name: "Stop", type: "BOOL", section: "VAR_INPUT" },
      { name: "Interlock", type: "BOOL", section: "VAR_INPUT" },
      { name: "Motor", type: "BOOL", section: "VAR_OUTPUT" },
    ],
    body: { language: "LD", networks: [{
      logic: { kind: "series", elements: [
        { kind: "parallel", elements: [{ kind: "contact", variable: "Start" }, { kind: "contact", variable: "Motor" }] },
        { kind: "contact", variable: "Stop", negated: true },
        { kind: "contact", variable: "Interlock" },
      ] },
      coils: [{ variable: "Motor", kind: "coil" }],
    }] },
  }],
};
const SAMPLE_FBD = {
  name: "ComputeProject",
  pous: [{
    name: "Compute", pouType: "functionBlock",
    vars: [
      { name: "A", type: "INT", section: "VAR_INPUT" },
      { name: "B", type: "INT", section: "VAR_INPUT" },
      { name: "Enable", type: "BOOL", section: "VAR_INPUT" },
      { name: "Big", type: "BOOL", section: "VAR_OUTPUT" },
      { name: "Sum", type: "INT", section: "VAR_OUTPUT" },
    ],
    body: { language: "FBD", networks: [{
      blocks: [
        { id: "b1", type: "ADD", inputs: [{ name: "IN1", source: { kind: "var", name: "A" } }, { name: "IN2", source: { kind: "var", name: "B" } }] },
        { id: "b2", type: "GT", inputs: [{ name: "IN1", source: { kind: "block", blockId: "b1" } }, { name: "IN2", source: { kind: "const", value: 100 } }] },
        { id: "b3", type: "AND", inputs: [{ name: "IN1", source: { kind: "block", blockId: "b2" } }, { name: "IN2", source: { kind: "var", name: "Enable" } }] },
      ],
      outputs: [
        { variable: "Sum", source: { kind: "block", blockId: "b1" } },
        { variable: "Big", source: { kind: "block", blockId: "b3" } },
      ],
    }] },
  }],
};
const SAMPLE_SFC = {
  name: "SequenceProject",
  pous: [{
    name: "Sequence", pouType: "program",
    vars: [
      { name: "GoNext", type: "BOOL", section: "VAR_INPUT" },
      { name: "Done", type: "BOOL", section: "VAR_INPUT" },
      { name: "Lamp", type: "BOOL", section: "VAR_OUTPUT" },
    ],
    body: { language: "SFC",
      steps: [
        { name: "Init", initial: true, actions: [{ qualifier: "N", actionText: "Lamp := FALSE;" }] },
        { name: "Run", actions: [{ qualifier: "N", actionText: "Lamp := TRUE;" }] },
        { name: "Finish", actions: [] },
      ],
      transitions: [
        { from: "Init", to: "Run", condition: "GoNext" },
        { from: "Run", to: "Finish", condition: "Done" },
        { from: "Finish", to: "Init", condition: "NOT GoNext" },
      ],
    },
  }],
};

function pretty(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

type PouEditorTab = "canvas" | "json";

export default function PouStudio() {
  const { t } = useTranslation();
  // doc 81 Đợt 2 Task 14 — đã chuyển sang EngineeringShell ⇒ "full-bleed": rail trái thu gọn, <main> không đệm.
  useShellPageVariant("full-bleed");
  const [, navigate] = useLocation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [jsonText, setJsonText] = useState<string>(() => pretty(SAMPLE_LAD));
  const [xmlText, setXmlText] = useState<string>("");
  const [rightTab, setRightTab] = useState<"transpile" | "plcopen">("transpile");
  // W3-12: lưu POU thành artifact "iec61131-pou" → build/deploy qua Engineering (pipeline gated).
  const [saveOpen, setSaveOpen] = useState(false);
  const [savePid, setSavePid] = useState<string>("");
  const [createNew, setCreateNew] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [savedProjectId, setSavedProjectId] = useState<number | null>(null);
  // View toggle: the graphical CANVAS is the default; the JSON editor stays available. Both
  // are views over the SAME POU model (the single source of truth).
  // doc 81 Đợt 2 Task 14 — hai view là hai TAB EDITOR của MAIN (Canvas / JSON).
  const [viewMode, setViewMode] = useState<PouEditorTab>("canvas");
  const [pouIndex, setPouIndex] = useState(0);
  // doc 81 Đợt 2 Task 14 — Explorer "Mở" (mới): dự án iec61131-pou đang xem + ý định mở panel dưới (R-2-l).
  const [openPid, setOpenPid] = useState<number | null>(null);
  const [bottomOpenRequest, setBottomOpenRequest] = useState(0);
  // Ruling R-2-u: explorer "Mở" GẬP ở lần đầu; deep link tới dự án POU ⇒ ý định mở.
  const [explorerOpenRequest, setExplorerOpenRequest] = useState(0);

  // Parse the JSON editor → a project object (or a parse error). Typed as the router INPUT
  // shape (defaulted fields optional); the canvas boundary casts to the richer output type.
  const parsed = useMemo((): { ok: true; project: PouProjectInput } | { ok: false; error: string } => {
    try {
      return { ok: true, project: JSON.parse(jsonText) as PouProjectInput };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [jsonText]);

  const project = parsed.ok ? parsed.project : null;
  const pous = parsed.ok ? parsed.project.pous : [];
  const safePouIndex = pous.length ? Math.min(pouIndex, pous.length - 1) : 0;
  const selPouName = pous[safePouIndex]?.name;

  // doc 81 Đợt 2 Task 14 (R-2-b) — Copilot là tab của inspector phải; `open` của context = tab Copilot đang chọn.
  const { open: copilotOpen } = useProgrammingCopilot();
  // final wave M-8 — panel phải (ST / PLCopen / Copilot) GẬP ĐƯỢC để canvas rộng hơn; nội dung vẫn mount (stream Copilot
  // sống). Mở Copilot (nút AI top bar / tab) ⇒ panel tự mở lại. Lựa chọn chỉ trong phiên.
  const [rightCollapsed, setRightCollapsed] = useState(false);
  useEffect(() => { if (copilotOpen) setRightCollapsed(false); }, [copilotOpen]);

  // Pure server-side preview + lint (no persistence).
  const transpileQ = trpc.programming.pouTranspilePreview.useQuery(
    { project: project as PouProjectInput },
    { enabled: canView && parsed.ok, retry: false },
  );
  const lintQ = trpc.programming.pouLint.useQuery(
    { project: project as PouProjectInput },
    { enabled: canView && parsed.ok, retry: false },
  );
  // Như Tabs cũ: chỉ xuất XML khi tab PLCopen đang HIỆN (Copilot che tab đó ⇒ không chạy).
  const exportQ = trpc.programming.plcopenExport.useQuery(
    { project: project as PouProjectInput },
    { enabled: canView && parsed.ok && rightTab === "plcopen" && !copilotOpen, retry: false },
  );

  const transpile = transpileQ.data as TranspileOut | undefined;
  const lint = lintQ.data as LintOut | undefined;
  const shapeError =
    (transpileQ.error ? mapTrpcError(transpileQ.error) : null) ??
    (lintQ.error ? mapTrpcError(lintQ.error) : null);

  const errorCount = (lint?.diagnostics ?? []).filter((d) => d.severity === "error").length;
  const warnCount = (lint?.diagnostics ?? []).filter((d) => d.severity === "warn").length;
  const lintOk = lint?.ok ?? false;
  const problemsCount = (lint?.diagnostics ?? []).length + (shapeError ? 1 : 0);

  // doc 41 — publish POU Studio to the Programming Copilot as an ADVISORY assistant.
  // Structured LAD/FBD/SFC has no text buffer to inject into (no onApply); the copilot
  // explains the transpiled ST preview and reasons over the semantic-linter diagnostics.
  const copilotBinding = useMemo<CopilotBinding>(
    () => ({
      kind: "iec61131-pou" as const,
      surfaceLabel: t("nav.pouStudio", "POU Studio"),
      code: transpile?.code ?? undefined,
      diagnostics: (lint?.diagnostics ?? []).map((d) => ({
        message: `[${d.rule}] ${d.pou}/${d.ref}: ${d.message}`,
        severity: d.severity === "error" ? ("error" as const) : ("warn" as const),
        source: "lint",
      })),
    }),
    [lint, transpile], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useCopilotBinding(() => copilotBinding, [copilotBinding]);

  // Group the selected POU's diagnostics by lint `ref` (rung / net / step) for canvas markers.
  const diagsByRef = useMemo(() => {
    const m = new Map<string, PouCanvasDiag[]>();
    for (const d of lint?.diagnostics ?? []) {
      if (selPouName && d.pou !== selPouName) continue;
      const list = m.get(d.ref) ?? [];
      list.push(d);
      m.set(d.ref, list);
    }
    return m;
  }, [lint, selPouName]);

  // Canvas edits write straight back into the model → JSON view, PLCopen export and transpile
  // all stay in sync (the model is the single source of truth; the canvas and JSON are views).
  const handleModelChange = useCallback((next: PouProject) => {
    setJsonText(pretty(next));
  }, []);

  const loadSample = useCallback((s: unknown) => {
    setJsonText(pretty(s));
    setPouIndex(0);
    toast.success(t("pou.sampleLoaded", "Sample POU loaded"));
  }, [t]);

  const doImport = useCallback(async () => {
    if (!xmlText.trim()) { toast.error(t("pou.pasteXml", "Paste PLCopen XML first.")); return; }
    try {
      const res = await utils.programming.plcopenImport.fetch({ xml: xmlText });
      if (!res.ok) {
        // i18n-raw-ok: chẩn đoán PLCopen từ lời gọi THÀNH CÔNG, không phải lỗi tRPC.
        toast.error(t("pou.importFail", "Import failed: {{msg}}", { msg: res.errors.map((e) => e.message).join("; ") }));
        return;
      }
      setJsonText(pretty(res.project));
      setPouIndex(0);
      setRightTab("transpile");
      toast.success(t("pou.imported", "PLCopen XML imported into the model"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [xmlText, utils, t]);

  const copyXml = useCallback(() => {
    const xml = exportQ.data?.xml;
    if (!xml) return;
    void navigator.clipboard?.writeText(xml).then(
      () => toast.success(t("pou.copied", "PLCopen XML copied")),
      () => toast.error(t("pou.copyFail", "Copy failed")),
    );
  }, [exportQ.data, t]);

  // ── W3-12: save POU into a gated programming project ("iec61131-pou") ───────
  const projectsQ = trpc.programming.listProjects.useQuery({ limit: 200 }, { enabled: canView });
  const pouProjects = useMemo(
    () => (projectsQ.data ?? []).filter((p) => p.kind === "iec61131-pou"),
    [projectsQ.data],
  );

  // U1 (doc 26) — deep-link ?projectId= chọn sẵn project lưu; store lastSelected là fallback.
  // Chỉ nhận project loại iec61131-pou (đúng danh sách Select) để không hiển thị rỗng.
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
    if (pouProjects.some((p) => p.id === wanted)) {
      setSavePid(String(wanted)); setSavedProjectId(wanted); setOpenPid(wanted);
      // Chỉ deep link `?projectId` là ý định mở explorer; dự án nhớ lần trước (lastSelected) chỉ chọn sẵn, explorer vẫn gập.
      if (deepLink.projectId === wanted) setExplorerOpenRequest((n) => n + 1);
    }
  }, [deepLink.projectId, lastSelected.projectId, projectsQ.data, pouProjects]);
  const createProjectM = trpc.programming.createProject.useMutation();
  const createArtifactM = trpc.programming.createArtifact.useMutation();
  const saving = createProjectM.isPending || createArtifactM.isPending;

  // doc 81 Đợt 2 Task 14 — Explorer "Mở": phiên bản pou-json của dự án đang xem (CHỈ ĐỌC; mở = nạp nội dung vào trình
  // soạn, không ghi gì). Chỉ truy vấn khi người dùng chọn một dự án (hoặc deep-link đã chọn sẵn).
  const artifactsQ = trpc.programming.listArtifacts.useQuery(
    { projectId: openPid ?? 0 },
    { enabled: canView && openPid != null },
  );
  const openRows = useMemo(() => (artifactsQ.data ?? []).filter((a) => a.language === "pou-json"), [artifactsQ.data]);
  const otherLangCount = (artifactsQ.data ?? []).length - openRows.length;
  const openArtifact = (a: { version: number; content: string | null }) => {
    if (openPid == null || a.content == null) return;
    setJsonText(a.content);
    setPouIndex(0);
    // Mở phiên bản của dự án P ⇒ P là đích lưu (lưu lại = phiên bản mới của CÙNG dự án) — như deep-link ?projectId=.
    setSavePid(String(openPid));
    setSavedProjectId(openPid);
    toast.success(t("pou.ws.opened", "Opened v{{v}} in the editor", { v: a.version }));
  };

  // Tạo/chọn project → tạo artifact (draft) từ JSON model hiện tại; deploy vẫn là bước gated riêng.
  const doSaveToProject = useCallback(async () => {
    if (!parsed.ok) { toast.error(t("pou.badJson", "Invalid JSON")); return; }
    try {
      let pid: number;
      if (createNew) {
        const code = newCode.trim();
        const name = newName.trim();
        if (!code || !name) { toast.error(t("pou.newProjectFields", "Enter a project code and name.")); return; }
        const proj = await createProjectM.mutateAsync({ code, name, kind: "iec61131-pou" });
        pid = proj.id;
      } else {
        pid = Number(savePid);
        if (!Number.isInteger(pid) || pid <= 0) { toast.error(t("pou.pickProject", "Pick or create a project first.")); return; }
      }
      const art = await createArtifactM.mutateAsync({ projectId: pid, branch: "main", language: "pou-json", content: jsonText });
      setSavedProjectId(pid);
      setSaveOpen(false);
      setCreateNew(false);
      setNewCode(""); setNewName("");
      setSavePid(String(pid));
      // Fix round 1 (review I2): Explorer "Mở" chuyển sang dự án vừa lưu và danh sách phiên bản của nó được làm mới.
      setOpenPid(pid);
      await Promise.all([
        utils.programming.listProjects.invalidate(),
        utils.programming.listArtifacts.invalidate({ projectId: pid }),
      ]);
      toast.success(t("pou.savedVersion", "Saved as draft v{{v}} — build & deploy in Engineering.", { v: art.version }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [parsed, createNew, newCode, newName, savePid, jsonText, createProjectM, createArtifactM, utils, t]);

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("pou.noPermission", "You do not have permission to view the POU studio.")}
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  const openProblems = () => setBottomOpenRequest((n) => n + 1);

  // ═════ Top bar (PageHeaderCompact 48 px — R-2-t): lint · Khi nào dùng │ Build/Deploy ở Engineering · Lưu vào project · Làm mới ═════
  const header = (
    <PageHeaderCompact
      className="h-12 shrink-0 border-b px-3 py-0"
      icon={<FileCode2 />}
      title={t("pou.title", "IEC 61131 POU Studio")}
      chips={
        <>
          {!canControl && <ViewOnlyBadge module="machine_control" />}
          {/* Live lint indicator */}
          <StatusBadge
            status={lintOk ? "ok" : "error"}
            label={
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                {lintOk ? t("pou.lintOk", "Lint OK") : t("pou.lintErrors", "{{n}} error(s)", { n: errorCount })}
                {warnCount > 0 ? ` · ${t("pou.lintWarns", "{{n}} warn", { n: warnCount })}` : ""}
              </span>
            }
          />
          {shapeError && parsed.ok && (
            <Badge variant="destructive" className="shrink-0 text-[11px]">{t("pou.shapeError", "Shape error")}</Badge>
          )}
          {/* W6-26 — "Khi nào dùng" + cross-link golden-thread (POU = IEC 61131 LAD/FBD/SFC), trong popover. */}
          <NoticeChip kind="whenToUse">
            <p className="text-sm">{t("pou.whenToUse", "When to use — IEC 61131 LAD/FBD/SFC POUs. For low-level motion/IO use the IR Editor; build & deploy in the Engineering Workspace.")}</p>
            {/* U1 — mang ?projectId theo project lưu đang chọn để trang đích mở đúng đối tượng. */}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <Link href={withParams("/engineering", { projectId: savePid || null })} className="font-medium text-primary hover:underline">{t("nav.engineeringWorkspace")}</Link>
              <Link href={withParams("/ir-editor", { projectId: savePid || null })} className="font-medium text-primary hover:underline">{t("nav.irEditor")}</Link>
            </div>
          </NoticeChip>
        </>
      }
      actions={
        <>
          {savedProjectId != null && (
            <Button size="sm" variant="outline" onClick={() => navigate("/engineering")} aria-label={t("pou.goEngineering", "Build/Deploy in Engineering")} title={t("pou.goEngineeringTip", "Open Engineering to build & deploy this artifact")}>
              <ExternalLink className="h-4 w-4 min-[1700px]:mr-1.5" /><span className="hidden min-[1700px]:inline">{t("pou.goEngineering", "Build/Deploy in Engineering")}</span>
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => setSaveOpen(true)}
            disabled={!canControl || !parsed.ok}
            aria-label={t("pou.saveToProject", "Save into project → Build/Deploy")}
            title={!canControl ? t("pou.needControl", "Requires machine_control permission") : !parsed.ok ? t("pou.badJson", "Invalid JSON") : t("pou.saveToProject", "Save into project → Build/Deploy")}
          >
            <Save className="h-4 w-4 min-[1500px]:mr-1.5" /><span className="hidden min-[1500px]:inline">{t("pou.saveToProject", "Save into project → Build/Deploy")}</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { void transpileQ.refetch(); void lintQ.refetch(); }} aria-label={t("common.refresh", "Refresh")} title={t("common.refresh", "Refresh")}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </>
      }
    />
  );

  // ═════ Explorer "Mở" (mới): dự án iec61131-pou → phiên bản pou-json → Mở; mẫu dựng sẵn ═════
  const sectionTitle = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
  const explorer = (
    <div className="h-full space-y-4 overflow-y-auto p-2">
      <section className="space-y-1.5">
        <h2 className={sectionTitle}>{t("pou.ws.openProjects", "POU projects")}</h2>
        {projectsQ.isLoading ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{t("common.loading", "Loading…")}</p>
        ) : pouProjects.length === 0 ? (
          <p className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
            {t("pou.noPouProjects", "No iec61131-pou projects yet — switch to “New project” to create one.")}
          </p>
        ) : (
          <ul className="space-y-1">
            {pouProjects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={openPid === p.id}
                  onClick={() => setOpenPid(p.id)}
                  className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs ${openPid === p.id ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted"}`}
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate">{p.code} · {p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {openPid != null && (
        <section className="space-y-1.5" aria-label={t("pou.ws.openVersions", "Versions (pou-json)")}>
          <h2 className={sectionTitle}>{t("pou.ws.openVersions", "Versions (pou-json)")}</h2>
          {artifactsQ.isLoading ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{t("common.loading", "Loading…")}</p>
          ) : artifactsQ.error ? (
            <p role="alert" className="text-xs text-destructive">{mapTrpcError(artifactsQ.error)}</p>
          ) : openRows.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("pou.ws.noVersions", "No pou-json versions in this project yet.")}</p>
          ) : (
            <ul className="space-y-1">
              {openRows.map((a) => (
                <li key={a.id} data-artifact-row={a.id} className="flex items-center justify-between gap-1 rounded border px-2 py-1 text-xs">
                  <span className="min-w-0 truncate">v{a.version} · {a.branch}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <StatusBadge status={String(a.status)} />
                    <Button size="sm" variant="outline" className="h-7 px-2" disabled={a.content == null} onClick={() => openArtifact(a)}>
                      <FolderOpen className="mr-1 h-3.5 w-3.5" />{t("pou.ws.open", "Open")}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {otherLangCount > 0 && (
            <p className="text-[10px] text-muted-foreground">{t("pou.ws.otherLang", "{{n}} version(s) in another language — open them in the Engineering Workspace.", { n: otherLangCount })}</p>
          )}
        </section>
      )}
      <section className="space-y-1.5">
        <h2 className={sectionTitle}>{t("pou.ws.samples", "Samples")}</h2>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => loadSample(SAMPLE_LAD)}>LAD</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => loadSample(SAMPLE_FBD)}>FBD</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => loadSample(SAMPLE_SFC)}>SFC</Button>
        </div>
      </section>
    </div>
  );

  // ═════ MAIN: tab editor Canvas / JSON — một toolbar (R-2-s): chọn POU + tóm tắt; editor cao hết vùng ═════
  const toolbarEnd = (
    <>
      {parsed.ok ? (
        <span className="hidden max-w-[22rem] truncate text-[11px] text-muted-foreground min-[1440px]:inline">
          {transpile?.summary.pous.map((p) => `${p.name} · ${p.language}`).join("  ·  ") ?? t("pou.parsed", "parsed")}
        </span>
      ) : (
        <span className="max-w-[24rem] truncate text-[11px] text-destructive" title={parsed.error}>{t("pou.badJson", "Invalid JSON")}: {parsed.error}</span>
      )}
      <Button
        type="button" size="sm" variant="ghost" className="h-7 w-7 px-0"
        aria-pressed={rightCollapsed}
        aria-label={rightCollapsed ? t("pou.ws.showRight", "Show right panel") : t("pou.ws.hideRight", "Hide right panel")}
        title={rightCollapsed ? t("pou.ws.showRight", "Show right panel") : t("pou.ws.hideRight", "Hide right panel")}
        onClick={() => setRightCollapsed((c) => !c)}
      >
        <PanelRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      {/* POU selector (multi-POU projects) — shared by both views */}
      {parsed.ok && pous.length > 1 && (
        <Select value={String(safePouIndex)} onValueChange={(v) => setPouIndex(Number(v))}>
          <SelectTrigger className="h-7 w-48 text-xs" aria-label={t("pou.selectPou", "POU")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {pous.map((p, i) => <SelectItem key={i} value={String(i)}>{p.name} · {p.body.language}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </>
  );
  const editorMain =
    viewMode === "canvas" ? (
      parsed.ok ? (
        <PouCanvas
          fill
          key={`${safePouIndex}:${parsed.project.pous[safePouIndex]?.body.language}`}
          project={parsed.project as PouProject}
          pouIndex={safePouIndex}
          diagsByRef={diagsByRef}
          onChange={handleModelChange}
          t={t}
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-destructive/5 p-6 text-center text-sm text-destructive">
          {t("pou.canvasBadJson", "Fix the JSON (switch to the JSON view) before the canvas can render.")}
        </div>
      )
    ) : (
      // CodeMirror cao HẾT vùng MAIN (wrapper của CodeEditor + khung của @uiw cùng h-full) — như IDE.
      <div className="h-full [&>div]:h-full [&>div]:rounded-none [&>div]:border-0 [&>div>div]:h-full">
        <CodeEditor
          value={jsonText}
          onChange={setJsonText}
          language="json"
          height="100%"
          aria-label="pou-json"
          // doc69 · Wave 2 / C — this is the hand-authoring surface for the POU model
          // (the JSON escape hatch alongside the graphical Canvas view); previously a
          // plain <Textarea> with no editor affordances at all. Swapping to the shared
          // CodeEditor picks up line numbers + bracket matching for free and, opt-in,
          // ghost-text completion — same as the other code-authoring surfaces.
          inlineCopilot
        />
      </div>
    );

  // ═════ Inspector phải: [Chuyển mã → ST | PLCopen XML | Copilot] ═════
  const transpileTab = (
    <div>
      {transpile && !transpile.ok && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("pou.blocked", "Transpile is blocked by the safety linter. Fix the errors on the left to generate ST.")}</span>
        </div>
      )}
      {transpile?.code ? (
        <div className="overflow-hidden rounded-md border bg-muted/30">
          <pre className="max-h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_12.5rem)] overflow-auto p-3 font-mono text-xs leading-5">
            {transpile.code.split("\n").map((line, i) => {
              const isMarker = line.includes("(* [IEC");
              return <div key={i} className={`whitespace-pre ${isMarker ? "text-primary/80" : ""}`}>{line || " "}</div>;
            })}
          </pre>
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {transpileQ.isFetching ? t("pou.transpiling", "Transpiling…") : t("pou.noCode", "No ST generated. Resolve any lint errors, then retry.")}
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        {t("pou.transpileNote", "Each graphical body is lowered under a (* [IEC LD|FBD|SFC #id] *) provenance marker so the ST and the source read side-by-side.")}
      </p>
    </div>
  );
  const plcopenTab = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void exportQ.refetch()} disabled={!parsed.ok}>
          <Download className="mr-1 h-4 w-4" />{t("pou.export", "Export model → XML")}
        </Button>
        <Button size="sm" variant="ghost" onClick={copyXml} disabled={!exportQ.data?.xml}>
          <Copy className="mr-1 h-4 w-4" />{t("common.copy", "Copy")}
        </Button>
      </div>
      {exportQ.data?.xml && (
        <div className="overflow-hidden rounded-md border bg-muted/30">
          <pre className="max-h-[220px] overflow-auto p-3 font-mono text-[11px] leading-5">{exportQ.data.xml}</pre>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <Upload className="h-3.5 w-3.5" /> {t("pou.importXml", "Import PLCopen TC6 XML")}
        </div>
        <Textarea
          className="min-h-[160px] font-mono text-[11px]"
          spellCheck={false}
          placeholder={t("pou.pastePlaceholder", "Paste a PLCopen <project>…</project> XML document here…") as string}
          value={xmlText}
          onChange={(e) => setXmlText(e.target.value)}
        />
        <Button size="sm" variant="outline" onClick={() => void doImport()} disabled={!xmlText.trim()}>
          <Upload className="mr-1 h-4 w-4" />{t("pou.importBtn", "Import → replace model")}
        </Button>
      </div>
      <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        {t("pou.plcopenNote", "PLCopen TC6 is the vendor-neutral interchange format (CODESYS / Beremiz / TwinCAT). Round-trip is structurally stable: export → import reproduces the model.")}
      </p>
    </div>
  );
  const inspector = (
    <CopilotInspector
      idPrefix="pou-insp"
      label={t("pou.ws.inspectorLabel", "ST / PLCopen / Copilot")}
      tabs={[
        { id: "transpile", label: t("pou.transpile", "Transpile → ST"), icon: <Code2 aria-hidden="true" />, content: transpileTab },
        { id: "plcopen", label: t("pou.plcopen", "PLCopen XML"), icon: <FileCode2 aria-hidden="true" />, content: plcopenTab },
      ]}
      activeTab={rightTab}
      onTabChange={(id) => setRightTab(id as "transpile" | "plcopen")}
      binding={copilotBinding}
    />
  );

  // ═════ Panel dưới: Vấn đề (chẩn đoán lint + lỗi hình dạng) — GẬP lần đầu (R-2-l), số luôn thấy ở thanh trạng thái ═════
  const bottomPanel = (
    <div className="h-full overflow-y-auto p-2 text-xs" data-testid="pou-problems">
      {(lint?.diagnostics ?? []).length === 0 && !shapeError ? (
        <p className="text-muted-foreground">{t("pou.ws.noProblems", "No lint diagnostics.")}</p>
      ) : (
        <div className="space-y-1">
          {(lint?.diagnostics ?? []).map((d, i) => (
            <div key={i} className={`flex items-start gap-1 rounded px-1.5 py-0.5 text-[11px] ${d.severity === "error" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
              {d.severity === "error" ? <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
              <span><span className="font-mono">[{d.rule}]</span> {d.pou}/{d.ref}: {d.message}</span>
            </div>
          ))}
          {shapeError && (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">{shapeError}</div>
          )}
        </div>
      )}
    </div>
  );

  // ═════ Thanh trạng thái 24 px: chip "Xem trước — không deploy" · KPI · Vấn đề · Copilot ═════
  const statusBar = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <NoticeChip kind="honesty" label={t("pou.ws.previewChip", "Preview — no deploy")} className="h-5 px-1.5 text-[11px]" data-testid="pou-preview-chip">
        <p className="flex items-start gap-1.5"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t("pou.honestyNote", "Model + lint + PLCopen XML round-trip + transpile-to-ST only — all pure previews. A POU compiles to and deploys on an OPEN runtime (OpenPLC) via the existing gated pipeline; it is never pushed to a certified vendor PLC. E-stop / SIL safety stays on the certified L1 PLC and is never authored here.")}</p>
      </NoticeChip>
      <span data-testid="pou-kpi-pous" className="shrink-0 tabular-nums">{t("pou.kpi.pous", "POUs")}: {transpile?.summary.pouCount ?? 0}</span>
      <span data-testid="pou-kpi-networks" className="shrink-0 tabular-nums">{t("pou.kpi.networks", "Networks / steps")}: {transpile?.summary.networks ?? 0}</span>
      <button
        type="button"
        data-testid="pou-kpi-errors"
        onClick={openProblems}
        className={`inline-flex shrink-0 items-center gap-1 rounded px-1 tabular-nums hover:bg-accent ${errorCount > 0 ? "font-medium text-destructive" : ""}`}
        title={t("pou.ws.problemsStatus", "Problems: {{count}}", { count: problemsCount })}
      >
        {t("pou.kpi.errors", "Lint errors")}: {errorCount}
      </button>
      <span
        data-testid="pou-kpi-status"
        data-state={lintOk ? "ok" : "blocked"}
        className={`shrink-0 ${lintOk ? "text-success" : "font-medium text-destructive"}`}
      >
        {t("pou.kpi.status", "Lint status")}: {lintOk ? t("pou.kpi.pass", "Pass") : t("pou.kpi.blocked", "Blocked")}
      </span>
      <button
        type="button"
        data-testid="pou-status-problems"
        onClick={openProblems}
        className="inline-flex shrink-0 items-center gap-1 rounded px-1 hover:bg-accent"
        aria-label={t("pou.ws.problemsStatus", "Problems: {{count}}", { count: problemsCount })}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {problemsCount}
      </button>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1">
        <Sparkles className="h-3 w-3" aria-hidden="true" /> {t("engineering.ws.copilotTab", "Copilot")} {copilotOpen ? "●" : "○"}
      </span>
    </div>
  );

  const saveFieldId = (k: string) => `pou-save-${k}`;
  return (
    <DashboardLayout>
      <div className="flex h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem))] min-h-[30rem] min-w-0 flex-col">
        {header}
        <EngineeringShell
          layoutId="pou-studio"
          // R-2-k — giữ tên MAIN đã hiệu chuẩn (b60ba0df5).
          mainName="pou-editor"
          userId={user?.id ?? null}
          heightClass="min-h-0 flex-1"
          className="rounded-none border-x-0 border-b-0"
          activityItems={[
            { id: "open", label: t("pou.ws.activityOpen", "Open"), icon: <FolderOpen /> },
          ]}
          activeActivity="open"
          onActivityChange={() => undefined}
          explorer={explorer}
          explorerLabel={t("pou.ws.explorerLabel", "POU explorer")}
          // Ruling R-2-u: explorer "Mở" GẬP lần đầu (canvas là việc chính), mở khi bấm "Mở" hoặc deep link; giữ dải chung 240–300 px.
          explorerDefaultCollapsed
          explorerOpenRequest={explorerOpenRequest}
          explorerSize={{ minPx: 240, maxPx: 300, defaultPx: 240 }}
          editorTabs={[
            { id: "canvas", label: t("pou.viewCanvas", "Canvas") },
            { id: "json", label: t("pou.viewJson", "JSON") },
          ]}
          activeTabId={viewMode}
          onTabChange={(id) => setViewMode(id as PouEditorTab)}
          editor={editorMain}
          editorToolbarEnd={toolbarEnd}
          inspector={inspector}
          inspectorLabel={t("pou.ws.inspectorLabel", "ST / PLCopen / Copilot")}
          inspectorIsAi={copilotOpen}
          inspectorSize={{ minPx: 320, maxPx: 420, defaultPx: 320 }}
          inspectorRevealToken={copilotOpen ? 1 : 0}
          inspectorCollapsed={rightCollapsed}
          bottomPanel={bottomPanel}
          bottomLabel={t("pou.ws.problemsTab", "Problems")}
          bottomDefaultCollapsed
          bottomOpenRequest={bottomOpenRequest}
          statusBar={statusBar}
        />
      </div>

      {/* W3-12: lưu POU vào project gated → build/deploy ở Engineering — sheet phải (không dialog giữa màn). */}
      <Sheet open={saveOpen} onOpenChange={setSaveOpen}>
        <SheetContent side="right" className="flex w-[92vw] flex-col gap-0 p-0 sm:max-w-[480px]">
          <SheetHeader className="border-b px-4 py-3 pr-10">
            <SheetTitle>{t("pou.saveDialogTitle", "Save POU into a programming project")}</SheetTitle>
            <SheetDescription>
              {t("pou.saveDialogDesc", "Appends the current model as a draft “iec61131-pou” artifact. Build and gated deploy happen in the Engineering workspace — this screen never writes to a device.")}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-3 p-4">
            <div className="inline-flex rounded-md border border-border p-0.5">
              <Button size="sm" variant={!createNew ? "secondary" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setCreateNew(false)}>
                {t("pou.useExisting", "Existing project")}
              </Button>
              <Button size="sm" variant={createNew ? "secondary" : "ghost"} className="h-7 gap-1 px-2 text-xs" onClick={() => setCreateNew(true)}>
                <FolderPlus className="h-3.5 w-3.5" />{t("pou.newProject", "New project")}
              </Button>
            </div>

            {!createNew ? (
              <div className="space-y-1.5">
                <Label htmlFor={saveFieldId("project")} className="text-xs">{t("pou.projectLabel", "POU project (iec61131-pou)")}</Label>
                {pouProjects.length === 0 ? (
                  <p className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
                    {t("pou.noPouProjects", "No iec61131-pou projects yet — switch to “New project” to create one.")}
                  </p>
                ) : (
                  <Select value={savePid} onValueChange={(v) => { setSavePid(v); setLastProjectId(Number(v) || null); }}>
                    <SelectTrigger id={saveFieldId("project")} className="h-9"><SelectValue placeholder={t("pou.pickProjectPlaceholder", "Pick a project…")} /></SelectTrigger>
                    <SelectContent>
                      {pouProjects.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} · {p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor={saveFieldId("code")} className="text-xs">{t("pou.projectCode", "Project code")}</Label>
                  <Input id={saveFieldId("code")} className="h-9 font-mono" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="motor-ctrl" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={saveFieldId("name")} className="text-xs">{t("pou.projectName", "Project name")}</Label>
                  <Input id={saveFieldId("name")} className="h-9" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("pou.projectNamePh", "Motor control POU") as string} />
                </div>
              </div>
            )}

            <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
              <Hammer className="mt-0.5 h-3 w-3 shrink-0" />
              {t("pou.saveHint", "The saved draft still passes through the gated pipeline: build → HITL sign-off → gated deploy. Nothing is deployed by saving here.")}
            </p>
          </div>

          <div className="mt-auto flex justify-end gap-2 border-t px-4 py-3">
            <Button variant="ghost" onClick={() => setSaveOpen(false)} disabled={saving}>{t("common.cancel", "Cancel")}</Button>
            <Button onClick={() => void doSaveToProject()} disabled={saving || !canControl}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              {createNew ? t("pou.createAndSave", "Create project & save") : t("pou.saveVersion", "Save version")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
