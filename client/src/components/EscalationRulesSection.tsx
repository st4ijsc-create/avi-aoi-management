/**
 * W8-C (doc 27 §7 Đợt 6 leftover — "web admin UI cho escalation rules") —
 * alert_escalation_rules CRUD + escalation activity, rendered as the
 * "Escalation" tab of MqttAlertRules (the natural home: the 5-minute sweep in
 * mqttAlertScheduler escalates exactly the two alert tables this page manages).
 *
 * RBAC mirrors alertEscalationRouter: reads for any authenticated user;
 * mutations are supervisorProcedure (admin/supervisor, 2FA) — the UI hides
 * mutating controls for other roles instead of letting them hit FORBIDDEN.
 *
 * HONESTY notes surfaced in the UI (same as the router/sweep):
 *   - a severity-filtered rule never matches mqtt_alert_history (no severity
 *     column there) — the form says so;
 *   - escalatedAt is set exactly once per alert (no re-storm), so the activity
 *     list is a true ledger of what paged people.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/patterns";
import { ArrowUpCircle, Bell, Edit, Info, Loader2, Plus, Trash2 } from "lucide-react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type EscalationRule = RouterOutputs["alertEscalation"]["list"][number];
type EscalationActivityRow = RouterOutputs["alertEscalation"]["recentEscalations"][number];

const ROLES = ["admin", "supervisor", "quality_inspector", "operator", "maintenance", "engineer", "viewer", "user"] as const;
type NotifyRole = (typeof ROLES)[number];

/** Known alertType values the sweep can match (conn enum + mqtt rule types). */
const CONN_ALERT_TYPES = ["connection_lost", "reconnect_failed", "high_reconnect_rate", "long_disconnection"];
const MQTT_RULE_TYPES = ["LATENCY_THRESHOLD", "BROKER_DISCONNECT", "MESSAGE_FAILURE_RATE", "THROUGHPUT_LOW", "THROUGHPUT_HIGH", "CLIENT_OFFLINE"];

interface RuleForm {
  name: string;
  description: string;
  severity: "any" | "info" | "warning" | "critical";
  alertType: string; // "any" or a concrete type
  escalateAfterMin: number;
  notifyRoles: NotifyRole[];
  notifyUserIds: number[];
  enabled: boolean;
}

const EMPTY_FORM: RuleForm = {
  name: "",
  description: "",
  severity: "any",
  alertType: "any",
  escalateAfterMin: 15,
  notifyRoles: [],
  notifyUserIds: [],
  enabled: true,
};

function severityBadge(severity: string | null, anyLabel: string) {
  if (!severity) return <Badge variant="outline" className="text-muted-foreground">{anyLabel}</Badge>;
  const tone = severity === "critical" ? "error" : severity === "warning" ? "warning" : "info";
  return <StatusBadge status={severity} tone={tone} label={severity} />;
}

export function EscalationRulesSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "supervisor";
  const utils = trpc.useUtils();

  const rulesQ = trpc.alertEscalation.list.useQuery(undefined, { retry: false });
  const activityQ = trpc.alertEscalation.recentEscalations.useQuery({ limit: 50 }, {
    retry: false,
    refetchInterval: 60_000,
  });
  // supervisorProcedure — only fetch when the viewer can actually open the form.
  const usersQ = trpc.alertEscalation.listNotifiableUsers.useQuery(undefined, {
    enabled: canManage,
    retry: false,
    staleTime: 60_000,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EscalationRule | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);

  const refresh = () => {
    void utils.alertEscalation.list.invalidate();
    void utils.alertEscalation.recentEscalations.invalidate();
  };
  const onError = (e: { message: string }) => toastTrpcError(e);

  const createM = trpc.alertEscalation.create.useMutation({
    onSuccess: () => { toast.success(t("escalation.ruleCreated", "Escalation rule created")); setDialogOpen(false); refresh(); },
    onError,
  });
  const updateM = trpc.alertEscalation.update.useMutation({
    onSuccess: () => { toast.success(t("escalation.ruleUpdated", "Escalation rule updated")); setDialogOpen(false); refresh(); },
    onError,
  });
  const deleteM = trpc.alertEscalation.delete.useMutation({
    onSuccess: () => { toast.success(t("escalation.ruleDeleted", "Escalation rule deleted")); refresh(); },
    onError,
  });
  const toggleM = trpc.alertEscalation.toggle.useMutation({ onSuccess: refresh, onError });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };
  const openEdit = (rule: EscalationRule) => {
    setEditing(rule);
    setForm({
      name: rule.name,
      description: rule.description ?? "",
      severity: (rule.severity as RuleForm["severity"]) ?? "any",
      alertType: rule.alertType ?? "any",
      escalateAfterMin: rule.escalateAfterMin,
      notifyRoles: ((rule.notifyRoles as string[]) ?? []).filter((r): r is NotifyRole => (ROLES as readonly string[]).includes(r)),
      notifyUserIds: (rule.notifyUserIds as number[]) ?? [],
      enabled: rule.enabled,
    });
    setDialogOpen(true);
  };

  const submit = () => {
    if (!form.name.trim()) {
      toast.error(t("escalation.nameRequired", "Rule name is required"));
      return;
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      severity: form.severity === "any" ? null : form.severity,
      alertType: form.alertType === "any" ? null : form.alertType,
      escalateAfterMin: form.escalateAfterMin,
      notifyRoles: form.notifyRoles,
      notifyUserIds: form.notifyUserIds,
      enabled: form.enabled,
    };
    if (editing) updateM.mutate({ id: editing.id, ...payload });
    else createM.mutate(payload);
  };

  const userNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of usersQ.data ?? []) m.set(u.id, u.name ?? u.username ?? `#${u.id}`);
    return m;
  }, [usersQ.data]);

  const rules = rulesQ.data ?? [];
  const activity = (activityQ.data ?? []) as EscalationActivityRow[];
  const anyLabel = t("escalation.any", "Any");

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* How it works — honest sweep semantics */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {t(
            "escalation.howItWorks",
            "The scheduler sweeps every 5 minutes: an OPEN alert (not acknowledged/resolved) older than a rule's threshold is escalated exactly once — owner push + retained MQTT for the mobile app + in-app notifications for the selected roles/users (+ FCM for station alerts).",
          )}
        </span>
      </div>

      {/* ── Rules ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpCircle className="h-4 w-4 text-warning" />
              {t("escalation.rulesTitle", "Escalation rules")}
            </CardTitle>
            <CardDescription>
              {t("escalation.rulesDesc", "Who gets paged when an alert sits unhandled too long")}
            </CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" />
              {t("escalation.createRule", "New escalation rule")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("escalation.col.name", "Name")}</TableHead>
                <TableHead>{t("escalation.col.severity", "Severity")}</TableHead>
                <TableHead>{t("escalation.col.type", "Alert type")}</TableHead>
                <TableHead>{t("escalation.col.after", "Escalate after")}</TableHead>
                <TableHead>{t("escalation.col.notify", "Notify")}</TableHead>
                <TableHead>{t("common.status", "Status")}</TableHead>
                {canManage && <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rulesQ.isLoading && (
                <TableRow>
                  <TableCell colSpan={canManage ? 7 : 6} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              )}
              {!rulesQ.isLoading && rules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 7 : 6} className="py-8 text-center text-muted-foreground">
                    {t("escalation.noRules", "No escalation rules yet — unhandled alerts will not be escalated.")}
                  </TableCell>
                </TableRow>
              )}
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>
                    <span className="font-medium">{rule.name}</span>
                    {rule.description && <p className="text-xs text-muted-foreground">{rule.description}</p>}
                  </TableCell>
                  <TableCell>{severityBadge(rule.severity, anyLabel)}</TableCell>
                  <TableCell>
                    {rule.alertType ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{rule.alertType}</code>
                    ) : (
                      <span className="text-xs text-muted-foreground">{anyLabel}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {rule.escalateAfterMin} {t("escalation.minutes", "min")}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {((rule.notifyRoles as string[]) ?? []).map((r) => (
                        <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                      ))}
                      {((rule.notifyUserIds as number[]) ?? []).length > 0 && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Bell className="h-3 w-3" />
                          {((rule.notifyUserIds as number[]) ?? []).length} {t("escalation.users", "users")}
                        </Badge>
                      )}
                      {((rule.notifyRoles as string[]) ?? []).length === 0 &&
                        ((rule.notifyUserIds as number[]) ?? []).length === 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {t("escalation.ownerOnly", "owner push + MQTT only")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <Switch
                        checked={rule.enabled}
                        disabled={toggleM.isPending}
                        onCheckedChange={(v) => toggleM.mutate({ id: rule.id, enabled: v })}
                      />
                    ) : (
                      <StatusBadge
                        status={rule.enabled ? "enabled" : "disabled"}
                        tone={rule.enabled ? "success" : "default"}
                        label={rule.enabled ? t("escalation.enabled", "Enabled") : t("escalation.disabled", "Disabled")}
                      />
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(rule)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive/80"
                          disabled={deleteM.isPending}
                          onClick={() => deleteM.mutate({ id: rule.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Activity (escalated ledger) ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("escalation.activityTitle", "Recent escalations")}</CardTitle>
          <CardDescription>
            {t("escalation.activityDesc", "Alerts the sweep actually escalated (each alert escalates at most once)")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("escalation.col.escalatedAt", "Escalated at")}</TableHead>
                <TableHead>{t("escalation.col.source", "Source")}</TableHead>
                <TableHead>{t("escalation.col.severity", "Severity")}</TableHead>
                <TableHead>{t("escalation.col.alert", "Alert")}</TableHead>
                <TableHead>{t("escalation.col.triggeredAt", "Triggered at")}</TableHead>
                <TableHead>{t("common.status", "Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activityQ.isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              )}
              {!activityQ.isLoading && activity.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t("escalation.noActivity", "Nothing has been escalated yet.")}
                  </TableCell>
                </TableRow>
              )}
              {activity.map((row) => (
                <TableRow key={`${row.source}-${row.id}`}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {row.escalatedAt ? new Date(row.escalatedAt).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {row.source === "conn"
                        ? t("escalation.sourceConn", "connection")
                        : t("escalation.sourceMqtt", "mqtt rule")}
                    </Badge>
                  </TableCell>
                  <TableCell>{severityBadge(row.severity, "—")}</TableCell>
                  <TableCell className="max-w-72">
                    <span className="font-medium">{row.title}</span>
                    {row.message && <p className="truncate text-xs text-muted-foreground">{row.message}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(row.triggeredAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {row.isResolved ? (
                      <StatusBadge status="resolved" tone="success" label={t("escalation.resolved", "Resolved")} />
                    ) : row.isAcknowledged ? (
                      <StatusBadge status="acked" tone="info" label={t("escalation.acknowledged", "Acknowledged")} />
                    ) : (
                      <StatusBadge status="open" tone="error" label={t("escalation.stillOpen", "Still open")} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Create / edit dialog ──────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("escalation.editRule", "Edit escalation rule")
                : t("escalation.createRule", "New escalation rule")}
            </DialogTitle>
            <DialogDescription>
              {t("escalation.dialogDesc", "When a matching alert stays unhandled past the threshold, the selected people are paged — once per alert.")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("escalation.col.name", "Name")}</Label>
                <Input
                  value={form.name}
                  placeholder={t("escalation.namePlaceholder", "e.g. Critical unhandled 15m")}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("escalation.col.after", "Escalate after")} ({t("escalation.minutes", "min")})</Label>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={form.escalateAfterMin}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      escalateAfterMin: Math.min(1440, Math.max(1, parseInt(e.target.value) || 15)),
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("escalation.description", "Description")}</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("escalation.col.severity", "Severity")}</Label>
                <Select
                  value={form.severity}
                  onValueChange={(v) => setForm((f) => ({ ...f, severity: v as RuleForm["severity"] }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{anyLabel}</SelectItem>
                    <SelectItem value="info">info</SelectItem>
                    <SelectItem value="warning">warning</SelectItem>
                    <SelectItem value="critical">critical</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("escalation.severityHint", "A severity filter only matches connection alerts — MQTT rule history has no severity.")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("escalation.col.type", "Alert type")}</Label>
                <Select value={form.alertType} onValueChange={(v) => setForm((f) => ({ ...f, alertType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{anyLabel}</SelectItem>
                    {CONN_ALERT_TYPES.map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                    {MQTT_RULE_TYPES.map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("escalation.notifyRoles", "Notify roles")}</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={form.notifyRoles.includes(r)}
                      onCheckedChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          notifyRoles: v ? [...f.notifyRoles, r] : f.notifyRoles.filter((x) => x !== r),
                        }))
                      }
                    />
                    {r}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("escalation.notifyUsers", "Notify specific users")}</Label>
              {usersQ.isError ? (
                <p className="text-xs text-muted-foreground">
                  {t("escalation.usersUnavailable", "User list unavailable for your role.")}
                </p>
              ) : (
                <div className="grid max-h-40 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                  {(usersQ.data ?? []).map((u) => (
                    <label key={u.id} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={form.notifyUserIds.includes(u.id)}
                        onCheckedChange={(v) =>
                          setForm((f) => ({
                            ...f,
                            notifyUserIds: v
                              ? [...f.notifyUserIds, u.id]
                              : f.notifyUserIds.filter((x) => x !== u.id),
                          }))
                        }
                      />
                      <span className="truncate">{userNameById.get(u.id)}</span>
                      <Badge variant="outline" className="ml-auto shrink-0 text-[9px]">{u.role}</Badge>
                    </label>
                  ))}
                  {(usersQ.data ?? []).length === 0 && !usersQ.isLoading && (
                    <p className="col-span-2 text-xs text-muted-foreground">
                      {t("escalation.noUsers", "No active users found.")}
                    </p>
                  )}
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
              {t("escalation.enabled", "Enabled")}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={submit} disabled={createM.isPending || updateM.isPending}>
              {(createM.isPending || updateM.isPending) && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {editing ? t("common.update", "Update") : t("escalation.createRule", "New escalation rule")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EscalationRulesSection;
