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
 */
import { useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer, SectionCard, MetricCard, StatusBadge } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Cpu, Code2, FileCode2, ShieldCheck, AlertTriangle, XCircle, CheckCircle2,
  Download, Upload, Copy, Lock, Info, RefreshCw, Workflow,
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

export default function PouStudio() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");
  const utils = trpc.useUtils();

  const [jsonText, setJsonText] = useState<string>(() => pretty(SAMPLE_LAD));
  const [xmlText, setXmlText] = useState<string>("");
  const [rightTab, setRightTab] = useState<"transpile" | "plcopen">("transpile");
  // View toggle: the graphical CANVAS is the default; the JSON editor stays available. Both
  // are views over the SAME POU model (the single source of truth).
  const [viewMode, setViewMode] = useState<"canvas" | "json">("canvas");
  const [pouIndex, setPouIndex] = useState(0);

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

  // Pure server-side preview + lint (no persistence).
  const transpileQ = trpc.programming.pouTranspilePreview.useQuery(
    { project: project as PouProjectInput },
    { enabled: canView && parsed.ok, retry: false },
  );
  const lintQ = trpc.programming.pouLint.useQuery(
    { project: project as PouProjectInput },
    { enabled: canView && parsed.ok, retry: false },
  );
  const exportQ = trpc.programming.plcopenExport.useQuery(
    { project: project as PouProjectInput },
    { enabled: canView && parsed.ok && rightTab === "plcopen", retry: false },
  );

  const transpile = transpileQ.data as TranspileOut | undefined;
  const lint = lintQ.data as LintOut | undefined;
  const shapeError = (transpileQ.error?.message ?? lintQ.error?.message) || null;

  const errorCount = (lint?.diagnostics ?? []).filter((d) => d.severity === "error").length;
  const warnCount = (lint?.diagnostics ?? []).filter((d) => d.severity === "warn").length;
  const lintOk = lint?.ok ?? false;

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

  return (
    <DashboardLayout>
      <PageContainer fluid className="flex flex-col gap-4 space-y-0">
        <PageHeader
          icon={<FileCode2 className="h-6 w-6" />}
          title={t("pou.title", "IEC 61131 POU Studio")}
          badge={!canControl ? <ViewOnlyBadge module="machine_control" /> : undefined}
          description={t("pou.subtitle", "Author structured LAD/FBD/SFC POUs, lint them, exchange PLCopen TC6 XML, and preview the transpile to Structured Text — a preview, not a device write.")}
          actions={
            <Button size="icon" variant="ghost" onClick={() => { void transpileQ.refetch(); void lintQ.refetch(); }} title={t("common.refresh", "Refresh")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* Persistent honesty / safety caveat */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("pou.honestyNote", "Model + lint + PLCopen XML round-trip + transpile-to-ST only — all pure previews. A POU compiles to and deploys on an OPEN runtime (OpenPLC) via the existing gated pipeline; it is never pushed to a certified vendor PLC. E-stop / SIL safety stays on the certified L1 PLC and is never authored here.")}</span>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard icon={<Cpu className="h-4 w-4" />} label={t("pou.kpi.pous", "POUs")} value={transpile?.summary.pouCount ?? 0} />
          <MetricCard icon={<Code2 className="h-4 w-4" />} label={t("pou.kpi.networks", "Networks / steps")} value={transpile?.summary.networks ?? 0} />
          <MetricCard icon={<XCircle className="h-4 w-4" />} label={t("pou.kpi.errors", "Lint errors")} value={errorCount} tone={errorCount > 0 ? "danger" : "default"} />
          <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label={t("pou.kpi.status", "Lint status")} value={lintOk ? t("pou.kpi.pass", "Pass") : t("pou.kpi.blocked", "Blocked")} tone={lintOk ? "good" : "danger"} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* LEFT — POU editor: graphical canvas OR JSON (two views over one model) */}
          <SectionCard
            icon={<FileCode2 className="h-4 w-4" />}
            title={t("pou.editor", "POU editor")}
            description={
              parsed.ok
                ? <span className="text-xs">{transpile?.summary.pous.map((p) => `${p.name} · ${p.language}`).join("  ·  ") ?? t("pou.parsed", "parsed")}</span>
                : <span className="text-xs text-destructive">{t("pou.badJson", "Invalid JSON")}: {parsed.error}</span>
            }
            action={
              <div className="flex flex-wrap items-center gap-1">
                <div className="inline-flex shrink-0 rounded-md border border-border p-0.5">
                  <Button size="sm" variant={viewMode === "canvas" ? "secondary" : "ghost"} className="h-7 gap-1 px-2 text-xs" onClick={() => setViewMode("canvas")} aria-pressed={viewMode === "canvas"}>
                    <Workflow className="h-3.5 w-3.5" />{t("pou.viewCanvas", "Canvas")}
                  </Button>
                  <Button size="sm" variant={viewMode === "json" ? "secondary" : "ghost"} className="h-7 gap-1 px-2 text-xs" onClick={() => setViewMode("json")} aria-pressed={viewMode === "json"}>
                    <Code2 className="h-3.5 w-3.5" />{t("pou.viewJson", "JSON")}
                  </Button>
                </div>
                <span className="mx-1 h-4 w-px bg-border" />
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => loadSample(SAMPLE_LAD)}>LAD</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => loadSample(SAMPLE_FBD)}>FBD</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => loadSample(SAMPLE_SFC)}>SFC</Button>
              </div>
            }
          >
            {/* POU selector (multi-POU projects) — shared by both views */}
            {parsed.ok && pous.length > 1 && (
              <div className="mb-2 flex items-center gap-2">
                <Label className="text-[11px] text-muted-foreground">{t("pou.selectPou", "POU")}</Label>
                <Select value={String(safePouIndex)} onValueChange={(v) => setPouIndex(Number(v))}>
                  <SelectTrigger className="h-8 w-64 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {pous.map((p, i) => <SelectItem key={i} value={String(i)}>{p.name} · {p.body.language}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {viewMode === "canvas" ? (
              parsed.ok ? (
                <PouCanvas
                  key={`${safePouIndex}:${parsed.project.pous[safePouIndex]?.body.language}`}
                  project={parsed.project as PouProject}
                  pouIndex={safePouIndex}
                  diagsByRef={diagsByRef}
                  onChange={handleModelChange}
                  t={t}
                />
              ) : (
                <div className="flex h-[560px] items-center justify-center rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
                  {t("pou.canvasBadJson", "Fix the JSON (switch to the JSON view) before the canvas can render.")}
                </div>
              )
            ) : (
              <Textarea
                className="min-h-[560px] font-mono text-xs"
                spellCheck={false}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
            )}
            {/* Live lint indicator */}
            <div className="mt-2 flex items-center gap-2">
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
                <Badge variant="destructive" className="text-[11px]">{t("pou.shapeError", "Shape error")}</Badge>
              )}
            </div>

            {/* Diagnostics list */}
            {(lint?.diagnostics ?? []).length > 0 && (
              <div className="mt-2 space-y-1">
                {lint!.diagnostics.map((d, i) => (
                  <div key={i} className={`flex items-start gap-1 rounded px-1.5 py-0.5 text-[11px] ${d.severity === "error" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
                    {d.severity === "error" ? <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
                    <span><span className="font-mono">[{d.rule}]</span> {d.pou}/{d.ref}: {d.message}</span>
                  </div>
                ))}
              </div>
            )}
            {shapeError && (
              <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">{shapeError}</div>
            )}
          </SectionCard>

          {/* RIGHT — transpile preview OR PLCopen XML exchange */}
          <Card>
            <CardContent className="pt-4">
              <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as "transpile" | "plcopen")} className="gap-3">
                <TabsList className="w-full">
                  <TabsTrigger value="transpile" className="flex-1"><Code2 className="mr-1 h-4 w-4" />{t("pou.transpile", "Transpile → ST")}</TabsTrigger>
                  <TabsTrigger value="plcopen" className="flex-1"><FileCode2 className="mr-1 h-4 w-4" />{t("pou.plcopen", "PLCopen XML")}</TabsTrigger>
                </TabsList>

                {/* Transpile preview */}
                <TabsContent value="transpile">
                  {transpile && !transpile.ok && (
                    <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t("pou.blocked", "Transpile is blocked by the safety linter. Fix the errors on the left to generate ST.")}</span>
                    </div>
                  )}
                  {transpile?.code ? (
                    <div className="overflow-hidden rounded-md border bg-muted/30">
                      <pre className="max-h-[460px] overflow-auto p-3 font-mono text-xs leading-5">
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
                </TabsContent>

                {/* PLCopen XML exchange */}
                <TabsContent value="plcopen">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
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
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
