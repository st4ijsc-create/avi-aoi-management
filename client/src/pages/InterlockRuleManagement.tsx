/**
 * Sprint G2.2b — Interlock rule administration (CONFIG + VIEW + workflow only).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This page manages interlock RULE definitions and their approve/enable
 *     workflow through interlockRouter only. It NEVER calls commandDispatcher and
 *     NEVER bypasses HITL.
 *   - A freshly-created rule is ALWAYS disabled + unapproved (router enforces).
 *   - approve is ADMIN-ONLY (the button is hidden for non-admins; the router also
 *     rejects non-admins). enable requires the rule to be approved first — the
 *     "Bật" button is disabled with an explanatory tooltip until approvedBy is set.
 *   - "Test (dry-run)" calls testEvaluate which writes NOTHING (no event/Andon/
 *     command); it only reports whether the condition would fire.
 * RBAC via module 'interlock':
 *   view = canView ; create = canCreate ; edit/enable/disable/resolveEvent = canEdit ;
 *   delete = canDelete ; approve = admin-only.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ShieldAlert, Plus, Pencil, Trash2, CheckCircle2, Play, Pause, FlaskConical } from "lucide-react";
import { toast } from "sonner";

const SCOPES = ["line", "station", "machine"] as const;
const SOURCE_TYPES = ["spc_violation", "ng_rate", "process_result", "telemetry_tag", "cpk"] as const;
const OPERATORS = ["lt", "lte", "gt", "gte", "eq"] as const;
const ACTIONS = ["alert", "block_downstream", "stop_line", "reduce_speed"] as const;

type Scope = (typeof SCOPES)[number];
type SourceType = (typeof SOURCE_TYPES)[number];
type Operator = (typeof OPERATORS)[number];
type Action = (typeof ACTIONS)[number];

interface RuleForm {
  id?: number;
  name: string;
  description: string;
  scope: Scope;
  lineId: string;
  stationId: string;
  machineId: string;
  sourceType: SourceType;
  sourceKey: string;
  comparisonOperator: Operator;
  threshold: string;
  windowSize: string;
  consecutiveCount: string;
  windowSeconds: string;
  action: Action;
  targetMachineId: string;
  targetAdapterId: string;
  commandTag: string;
  commandValue: string;
  cooldownSeconds: string;
}

const emptyRule: RuleForm = {
  name: "", description: "", scope: "machine", lineId: "", stationId: "", machineId: "",
  sourceType: "ng_rate", sourceKey: "", comparisonOperator: "gt", threshold: "",
  windowSize: "", consecutiveCount: "", windowSeconds: "", action: "alert",
  targetMachineId: "", targetAdapterId: "", commandTag: "", commandValue: "", cooldownSeconds: "300",
};

function numOrNull(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function actionVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action === "alert") return "secondary";
  if (action === "reduce_speed") return "outline";
  return "destructive"; // block_downstream / stop_line
}

export default function InterlockRuleManagement() {
  const { t } = useTranslation();
  const { hasPermission, isAdmin } = usePermissions();
  const canView = hasPermission("interlock", "canView");
  const canCreate = hasPermission("interlock", "canCreate");
  const canEdit = hasPermission("interlock", "canEdit");
  const canDelete = hasPermission("interlock", "canDelete");

  const utils = trpc.useUtils();
  const rulesQuery = trpc.interlock.list.useQuery(undefined, { enabled: canView });
  const eventsQuery = trpc.interlock.events.useQuery({ limit: 100 }, { enabled: canView });

  const invalidateRules = () => void utils.interlock.list.invalidate();
  const invalidateEvents = () => void utils.interlock.events.invalidate();

  // ── Rule dialog ──
  const [ruleOpen, setRuleOpen] = useState(false);
  const [form, setForm] = useState<RuleForm>(emptyRule);

  const createRule = trpc.interlock.create.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastCreated")); setRuleOpen(false); invalidateRules(); },
    onError: (e) => toast.error(e.message),
  });
  const updateRule = trpc.interlock.update.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastUpdated")); setRuleOpen(false); invalidateRules(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteRule = trpc.interlock.delete.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastDeleted")); invalidateRules(); },
    onError: (e) => toast.error(e.message),
  });
  const approveRule = trpc.interlock.approve.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastApproved")); invalidateRules(); },
    onError: (e) => toast.error(e.message),
  });
  const enableRule = trpc.interlock.enable.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastEnabled")); invalidateRules(); },
    onError: (e) => toast.error(e.message),
  });
  const disableRule = trpc.interlock.disable.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastDisabled")); invalidateRules(); },
    onError: (e) => toast.error(e.message),
  });
  const resolveEvent = trpc.interlock.resolveEvent.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastResolved")); invalidateEvents(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Test (dry-run) dialog ──
  const [testRuleId, setTestRuleId] = useState<number | null>(null);
  const [observedValue, setObservedValue] = useState("");
  const [seriesText, setSeriesText] = useState("");
  const [testEnabled, setTestEnabled] = useState(false);

  const parsedSeries = seriesText.trim()
    ? seriesText.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n))
    : undefined;

  const testQuery = trpc.interlock.testEvaluate.useQuery(
    {
      id: testRuleId ?? 0,
      observedValue: observedValue.trim() ? Number(observedValue) : undefined,
      series: parsedSeries && parsedSeries.length > 0 ? parsedSeries : undefined,
    },
    { enabled: testEnabled && testRuleId != null },
  );

  const openCreate = () => { setForm(emptyRule); setRuleOpen(true); };
  const openEdit = (r: any) => {
    setForm({
      id: r.id,
      name: r.name ?? "",
      description: r.description ?? "",
      scope: r.scope,
      lineId: r.lineId != null ? String(r.lineId) : "",
      stationId: r.stationId != null ? String(r.stationId) : "",
      machineId: r.machineId != null ? String(r.machineId) : "",
      sourceType: r.sourceType,
      sourceKey: r.sourceKey ?? "",
      comparisonOperator: r.comparisonOperator,
      threshold: r.threshold != null ? String(r.threshold) : "",
      windowSize: r.windowSize != null ? String(r.windowSize) : "",
      consecutiveCount: r.consecutiveCount != null ? String(r.consecutiveCount) : "",
      windowSeconds: r.windowSeconds != null ? String(r.windowSeconds) : "",
      action: r.action,
      targetMachineId: r.targetMachineId != null ? String(r.targetMachineId) : "",
      targetAdapterId: r.targetAdapterId != null ? String(r.targetAdapterId) : "",
      commandTag: r.commandTag ?? "",
      commandValue: r.commandValue != null ? String(r.commandValue) : "",
      cooldownSeconds: r.cooldownSeconds != null ? String(r.cooldownSeconds) : "300",
    });
    setRuleOpen(true);
  };

  const submitRule = () => {
    // Router input does NOT accept commandValue — recorded server-side only (F5b).
    const base = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      scope: form.scope,
      lineId: numOrNull(form.lineId),
      stationId: numOrNull(form.stationId),
      machineId: numOrNull(form.machineId),
      sourceType: form.sourceType,
      sourceKey: form.sourceKey.trim() || null,
      comparisonOperator: form.comparisonOperator,
      threshold: numOrNull(form.threshold),
      windowSize: numOrNull(form.windowSize),
      consecutiveCount: numOrNull(form.consecutiveCount),
      windowSeconds: numOrNull(form.windowSeconds),
      action: form.action,
      targetMachineId: form.action !== "alert" ? numOrNull(form.targetMachineId) : null,
      targetAdapterId: form.action !== "alert" ? numOrNull(form.targetAdapterId) : null,
      commandTag: form.action !== "alert" ? (form.commandTag.trim() || null) : null,
      cooldownSeconds: numOrNull(form.cooldownSeconds) ?? 300,
    };
    if (form.id != null) updateRule.mutate({ id: form.id, ...base });
    else createRule.mutate(base);
  };

  const rules = rulesQuery.data ?? [];
  const events = eventsQuery.data ?? [];

  if (!canView) {
    return <div className="p-6 text-muted-foreground">{t("interlockRules.noViewPermission")}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-rose-600" />
          <h1 className="text-2xl font-bold">{t("interlockRules.title")}</h1>
        </div>
        {canCreate && (
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> {t("interlockRules.newRule")}</Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t("interlockRules.subtitle")}</p>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">{t("interlockRules.tabRules")}</TabsTrigger>
          <TabsTrigger value="events">{t("interlockRules.tabEvents")}</TabsTrigger>
        </TabsList>

        {/* ── Rules tab ── */}
        <TabsContent value="rules">
          <Card>
            <CardHeader><CardTitle>{t("interlockRules.rules")} ({rules.length})</CardTitle></CardHeader>
            <CardContent>
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("interlockRules.name")}</TableHead>
                      <TableHead>{t("interlockRules.scope")}</TableHead>
                      <TableHead>{t("interlockRules.source")}</TableHead>
                      <TableHead>{t("interlockRules.condition")}</TableHead>
                      <TableHead>{t("interlockRules.action")}</TableHead>
                      <TableHead>{t("interlockRules.gate")}</TableHead>
                      <TableHead>{t("interlockRules.cooldown")}</TableHead>
                      <TableHead className="text-right">{t("interlockRules.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">{t("interlockRules.empty")}</TableCell></TableRow>
                    )}
                    {rules.map((r) => {
                      const approved = r.approvedBy != null;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell><Badge variant="outline">{r.scope}</Badge></TableCell>
                          <TableCell><Badge variant="outline">{r.sourceType}</Badge>{r.sourceKey ? <div className="text-xs text-muted-foreground">{r.sourceKey}</div> : null}</TableCell>
                          <TableCell className="text-xs">{r.comparisonOperator} {r.threshold ?? "—"}</TableCell>
                          <TableCell><Badge variant={actionVariant(r.action)}>{r.action}</Badge></TableCell>
                          <TableCell className="space-x-1">
                            {approved
                              ? <Badge variant="default">{t("interlockRules.approved")}</Badge>
                              : <Badge variant="secondary">{t("interlockRules.notApproved")}</Badge>}
                            {r.enabled
                              ? <Badge variant="default">{t("interlockRules.enabled")}</Badge>
                              : <Badge variant="outline">{t("interlockRules.disabled")}</Badge>}
                          </TableCell>
                          <TableCell className="text-xs">{r.cooldownSeconds}s</TableCell>
                          <TableCell className="text-right space-x-1 whitespace-nowrap">
                            <Button size="sm" variant="outline" onClick={() => { setTestRuleId(r.id); setObservedValue(""); setSeriesText(""); setTestEnabled(false); }}>
                              <FlaskConical className="h-4 w-4" />
                            </Button>
                            {isAdmin && !approved && (
                              <Button size="sm" variant="outline" disabled={approveRule.isPending}
                                onClick={() => approveRule.mutate({ id: r.id })}>
                                <CheckCircle2 className="h-4 w-4 mr-1" /> {t("interlockRules.approve")}
                              </Button>
                            )}
                            {canEdit && !r.enabled && (
                              approved ? (
                                <Button size="sm" variant="outline" disabled={enableRule.isPending}
                                  onClick={() => enableRule.mutate({ id: r.id })}>
                                  <Play className="h-4 w-4 mr-1" /> {t("interlockRules.enable")}
                                </Button>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span tabIndex={0}>
                                      <Button size="sm" variant="outline" disabled>
                                        <Play className="h-4 w-4 mr-1" /> {t("interlockRules.enable")}
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>{t("interlockRules.enableNeedsApproval")}</TooltipContent>
                                </Tooltip>
                              )
                            )}
                            {canEdit && r.enabled && (
                              <Button size="sm" variant="outline" disabled={disableRule.isPending}
                                onClick={() => disableRule.mutate({ id: r.id })}>
                                <Pause className="h-4 w-4 mr-1" /> {t("interlockRules.disable")}
                              </Button>
                            )}
                            {canEdit && (
                              <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button size="sm" variant="destructive" disabled={deleteRule.isPending}
                                onClick={() => { if (confirm(t("interlockRules.confirmDelete", { name: r.name }))) deleteRule.mutate({ id: r.id }); }}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Events tab ── */}
        <TabsContent value="events">
          <Card>
            <CardHeader><CardTitle>{t("interlockRules.events")} ({events.length})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("interlockRules.rule")}</TableHead>
                    <TableHead>{t("interlockRules.firedAt")}</TableHead>
                    <TableHead>{t("interlockRules.observed")}</TableHead>
                    <TableHead>{t("interlockRules.threshold")}</TableHead>
                    <TableHead>{t("interlockRules.action")}</TableHead>
                    <TableHead>{t("interlockRules.status")}</TableHead>
                    <TableHead className="text-right">{t("interlockRules.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{t("interlockRules.empty")}</TableCell></TableRow>
                  )}
                  {events.map((ev) => (
                    <TableRow key={ev.id}>
                      <TableCell className="font-medium">#{ev.ruleId}</TableCell>
                      <TableCell className="text-xs">{ev.firedAt ? new Date(ev.firedAt).toLocaleString() : "—"}</TableCell>
                      <TableCell>{ev.observedValue ?? "—"}</TableCell>
                      <TableCell>{ev.threshold ?? "—"}</TableCell>
                      <TableCell>{ev.action ? <Badge variant={actionVariant(ev.action)}>{ev.action}</Badge> : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{ev.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {canEdit && ev.status !== "resolved" && (
                          <Button size="sm" variant="outline" disabled={resolveEvent.isPending}
                            onClick={() => resolveEvent.mutate({ id: ev.id })}>
                            {t("interlockRules.resolve")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Rule create/edit dialog (condition builder) ── */}
      <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id != null ? t("interlockRules.editRule") : t("interlockRules.newRule")}</DialogTitle>
            <DialogDescription>{t("interlockRules.ruleDialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("interlockRules.name")}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>{t("interlockRules.description")}</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("interlockRules.scope")}</Label>
                <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as Scope })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SCOPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>{form.scope === "line" ? t("interlockRules.lineId") : form.scope === "station" ? t("interlockRules.stationId") : t("interlockRules.machineId")}</Label>
                {form.scope === "line" && <Input type="number" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} />}
                {form.scope === "station" && <Input type="number" value={form.stationId} onChange={(e) => setForm({ ...form, stationId: e.target.value })} />}
                {form.scope === "machine" && <Input type="number" value={form.machineId} onChange={(e) => setForm({ ...form, machineId: e.target.value })} />}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("interlockRules.sourceType")}</Label>
                <Select value={form.sourceType} onValueChange={(v) => setForm({ ...form, sourceType: v as SourceType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SOURCE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("interlockRules.sourceKey")}</Label>
                <Input value={form.sourceKey} onChange={(e) => setForm({ ...form, sourceKey: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("interlockRules.operator")}</Label>
                <Select value={form.comparisonOperator} onValueChange={(v) => setForm({ ...form, comparisonOperator: v as Operator })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("interlockRules.threshold")}</Label>
                <Input type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{t("interlockRules.windowSize")}</Label>
                <Input type="number" value={form.windowSize} onChange={(e) => setForm({ ...form, windowSize: e.target.value })} />
              </div>
              <div>
                <Label>{t("interlockRules.consecutiveCount")}</Label>
                <Input type="number" value={form.consecutiveCount} onChange={(e) => setForm({ ...form, consecutiveCount: e.target.value })} />
              </div>
              <div>
                <Label>{t("interlockRules.windowSeconds")}</Label>
                <Input type="number" value={form.windowSeconds} onChange={(e) => setForm({ ...form, windowSeconds: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("interlockRules.action")}</Label>
                <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v as Action })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("interlockRules.cooldown")}</Label>
                <Input type="number" value={form.cooldownSeconds} onChange={(e) => setForm({ ...form, cooldownSeconds: e.target.value })} />
              </div>
            </div>

            {form.action !== "alert" && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="text-sm font-medium">{t("interlockRules.commandTarget")}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("interlockRules.targetMachineId")}</Label>
                    <Input type="number" value={form.targetMachineId} onChange={(e) => setForm({ ...form, targetMachineId: e.target.value })} />
                  </div>
                  <div>
                    <Label>{t("interlockRules.targetAdapterId")}</Label>
                    <Input type="number" value={form.targetAdapterId} onChange={(e) => setForm({ ...form, targetAdapterId: e.target.value })} />
                  </div>
                  <div>
                    <Label>{t("interlockRules.commandTag")}</Label>
                    <Input value={form.commandTag} onChange={(e) => setForm({ ...form, commandTag: e.target.value })} />
                  </div>
                  <div>
                    <Label>{t("interlockRules.commandValue")}</Label>
                    <Input value={form.commandValue} onChange={(e) => setForm({ ...form, commandValue: e.target.value })} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t("interlockRules.commandValueNote")}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleOpen(false)}>{t("interlockRules.cancel")}</Button>
            <Button onClick={submitRule} disabled={createRule.isPending || updateRule.isPending || !form.name.trim()}>
              {t("interlockRules.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Test (dry-run) dialog ── */}
      <Dialog open={testRuleId != null} onOpenChange={(o) => { if (!o) { setTestRuleId(null); setTestEnabled(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("interlockRules.testTitle")}</DialogTitle>
            <DialogDescription>{t("interlockRules.testDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("interlockRules.observedValue")}</Label>
              <Input type="number" value={observedValue} onChange={(e) => { setObservedValue(e.target.value); setTestEnabled(false); }} />
            </div>
            <div>
              <Label>{t("interlockRules.series")}</Label>
              <Input value={seriesText} placeholder="1.2, 1.5, 1.8" onChange={(e) => { setSeriesText(e.target.value); setTestEnabled(false); }} />
            </div>
            <Button onClick={() => setTestEnabled(true)} disabled={testRuleId == null}>
              {t("interlockRules.runTest")}
            </Button>

            {testEnabled && testQuery.isLoading && <p className="text-sm text-muted-foreground">{t("interlockRules.testRunning")}</p>}
            {testEnabled && testQuery.error && <p className="text-sm text-rose-600">{testQuery.error.message}</p>}
            {testEnabled && testQuery.data && (
              <div className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span>{t("interlockRules.wouldFire")}:</span>
                  <Badge variant={testQuery.data.wouldFire ? "destructive" : "secondary"}>
                    {testQuery.data.wouldFire ? t("interlockRules.yes") : t("interlockRules.no")}
                  </Badge>
                </div>
                <div>{t("interlockRules.outcome")}: <span className="font-mono">{testQuery.data.outcome}</span></div>
                <div>{t("interlockRules.observed")}: <span className="font-mono">{String(testQuery.data.observed)}</span></div>
                <div>{t("interlockRules.threshold")}: <span className="font-mono">{String(testQuery.data.threshold)}</span></div>
                <p className="text-xs text-muted-foreground">{testQuery.data.note}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTestRuleId(null); setTestEnabled(false); }}>{t("interlockRules.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
