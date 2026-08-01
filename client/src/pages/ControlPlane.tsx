/**
 * P4 (audit H / doc 08 + doc 12 §8) — FACTORY CONTROL PLANE surface.
 *
 * One read-mostly cockpit over the build-own control plane:
 *   • EQUIPMENT / CAPABILITY / PackML (equipmentRouter — QUERY-ONLY): per-machine
 *     resolved Capability Contract, adapter kind, and a best-effort PackML state +
 *     the legal next PackML commands. No mutation; no device path.
 *   • ORCHESTRATION / FOE (orchestrationRouter): deployed workflows + run history.
 *     The FOE flag (FOE_ENABLED) is surfaced honestly; deploy/start/resume/abort are
 *     machine_control writes that route through the HITL/dry-run dispatcher — this page
 *     shows status only and the safety note (the Studio drives writes).
 *   • EDGE RUNTIME (edgeRuntime): registered edge coordinators + their flag state.
 *
 * SAFETY/HONESTY: every router here either is query-only or routes commands through the
 * existing HITL dispatcher. When a flag is OFF or a device is absent we say so plainly —
 * we never imply control happened. Read-only roles see a ViewOnlyBadge.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageContainer, PageHeader } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Factory, RefreshCw, ShieldAlert, Cpu, Workflow, Server, AlertTriangle, CheckCircle2, CircleSlash,
} from "lucide-react";

function fmt(v?: string | Date | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function FlagPill({ enabled, t }: { enabled: boolean; t: (k: string, f: string) => string }) {
  return enabled
    ? <Badge className="bg-success text-success-foreground"><CheckCircle2 aria-hidden="true" className="mr-1 h-3 w-3" />{t("controlPlane.flagOn", "Đã bật")}</Badge>
    : <Badge variant="outline" className="text-muted-foreground"><CircleSlash aria-hidden="true" className="mr-1 h-3 w-3" />{t("controlPlane.flagOff", "Chưa bật")}</Badge>;
}

function runStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "completed":
      return <Badge className="bg-success text-success-foreground">{t("controlPlane.runCompleted", "Hoàn tất")}</Badge>;
    case "running":
      return <Badge className="bg-info text-info-foreground">{t("controlPlane.runRunning", "Đang chạy")}</Badge>;
    case "held":
    case "awaiting_confirm":
      return <Badge className="bg-warning text-warning-foreground">{t("controlPlane.runHeld", "Chờ HITL")}</Badge>;
    case "failed":
    case "aborted":
      return <Badge variant="destructive">{status}</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function ControlPlane() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");

  // ── Equipment / capability / PackML ──
  const equipQ = trpc.equipment.listEquipment.useQuery(undefined, { enabled: canView });
  const packmlQ = trpc.equipment.listPackmlModel.useQuery(undefined, { enabled: canView });
  const adapterQ = trpc.equipment.listAdapterKinds.useQuery(undefined, { enabled: canView });

  type EquipRow = {
    machineId: number; code: string; name: string; machineType: string;
    operationStatus: string; adapterKind: string; commandCount: number; telemetryCount: number;
  };
  const equipment = (equipQ.data ?? []) as EquipRow[];

  const [stateMachineId, setStateMachineId] = useState<number | null>(null);
  const stateQ = trpc.equipment.getState.useQuery(
    { machineId: stateMachineId ?? 0 },
    { enabled: canView && stateMachineId != null },
  );

  // ── Orchestration / FOE ──
  const foeStatusQ = trpc.orchestration.status.useQuery(undefined, { enabled: canView });
  const foeEnabled = foeStatusQ.data?.enabled ?? false;
  const workflowsQ = trpc.orchestration.listWorkflows.useQuery(undefined, { enabled: canView });
  const runsQ = trpc.orchestration.listRuns.useQuery(undefined, { enabled: canView });

  // ── Edge runtime ──
  const edgeStatusQ = trpc.edgeRuntime.status.useQuery(undefined, { enabled: canView });
  const edgeEnabled = edgeStatusQ.data?.enabled ?? false;
  const edgeNodesQ = trpc.edgeRuntime.listNodes.useQuery(undefined, { enabled: canView });

  const refetchAll = () => {
    void equipQ.refetch(); void workflowsQ.refetch(); void runsQ.refetch(); void edgeNodesQ.refetch();
  };

  const adapterKinds = useMemo(
    () => (adapterQ.data?.adapters ?? []) as Array<string | { kind?: string }>,
    [adapterQ.data],
  );

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <p className="text-sm text-muted-foreground">
            {t("controlPlane.noPermission", "Bạn không có quyền xem Control Plane.")}
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer className="space-y-4">
        {/* Header */}
        <PageHeader
          icon={<Factory className="h-6 w-6" />}
          title={t("controlPlane.title", "Factory Control Plane")}
          badge={<ViewOnlyBadge module="machine_control" />}
          description={t("controlPlane.subtitle", "Năng lực thiết bị (Capability/PackML), điều phối FOE và runtime biên — điều khiển luôn qua HITL/dry-run")}
          actions={
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">FOE</span><FlagPill enabled={foeEnabled} t={t} />
                <span className="ml-2 text-xs text-muted-foreground">Edge</span><FlagPill enabled={edgeEnabled} t={t} />
              </div>
              <Button size="icon" variant="ghost" onClick={refetchAll} title={t("common.refresh", "Làm mới")}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>
          }
        />

        {/* Safety banner */}
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            {t(
              "controlPlane.safetyBanner",
              "An toàn: trang này là chế độ xem/điều phối. Mọi lệnh do workflow phát đều đi qua bộ điều phối HITL/dry-run hiện có; không có đường ghi trực tiếp xuống thiết bị từ đây. Cờ tắt → engine trả kết quả 'disabled'.",
            )}
          </span>
        </div>

        <Tabs defaultValue="equipment">
          <TabsList>
            <TabsTrigger value="equipment"><Cpu className="mr-1.5 h-4 w-4" />{t("controlPlane.tabEquipment", "Thiết bị & PackML")}</TabsTrigger>
            <TabsTrigger value="foe"><Workflow className="mr-1.5 h-4 w-4" />{t("controlPlane.tabFoe", "Điều phối (FOE)")}</TabsTrigger>
            <TabsTrigger value="edge"><Server className="mr-1.5 h-4 w-4" />{t("controlPlane.tabEdge", "Runtime biên")}</TabsTrigger>
          </TabsList>

          {/* ── EQUIPMENT / CAPABILITY / PackML ── */}
          <TabsContent value="equipment" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t("controlPlane.equipmentTitle", "Năng lực thiết bị (Capability Contract)")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("controlPlane.colCode", "Mã")}</TableHead>
                        <TableHead>{t("controlPlane.colName", "Tên")}</TableHead>
                        <TableHead>{t("controlPlane.colType", "Loại")}</TableHead>
                        <TableHead>{t("controlPlane.colAdapter", "Adapter")}</TableHead>
                        <TableHead>{t("controlPlane.colCmds", "Lệnh")}</TableHead>
                        <TableHead>{t("controlPlane.colTags", "Tag")}</TableHead>
                        <TableHead>{t("controlPlane.colOpStatus", "Trạng thái")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* ENG-F7 — nhánh isLoading TRƯỚC empty-state (tránh "Chưa có thiết bị" giả khi đang tải) */}
                      {equipQ.isLoading && (
                        <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">{t("common.loading", "Đang tải…")}</TableCell></TableRow>
                      )}
                      {!equipQ.isLoading && equipment.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">{t("controlPlane.noEquipment", "Chưa có thiết bị.")}</TableCell></TableRow>
                      )}
                      {equipment.map((m) => (
                        <TableRow
                          key={m.machineId}
                          className={`cursor-pointer ${stateMachineId === m.machineId ? "bg-muted/50" : ""}`}
                          onClick={() => setStateMachineId(m.machineId)}
                        >
                          <TableCell className="font-mono text-xs">{m.code}</TableCell>
                          <TableCell className="font-medium">{m.name}</TableCell>
                          <TableCell className="text-xs">{m.machineType}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{m.adapterKind}</Badge></TableCell>
                          <TableCell className="text-xs">{m.commandCount}</TableCell>
                          <TableCell className="text-xs">{m.telemetryCount}</TableCell>
                          <TableCell className="text-xs">{m.operationStatus}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* PackML state snapshot for selected machine */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t("controlPlane.packmlTitle", "Trạng thái PackML")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {stateMachineId == null ? (
                    <p className="text-muted-foreground">{t("controlPlane.selectMachine", "Chọn một thiết bị để xem trạng thái PackML.")}</p>
                  ) : stateQ.data ? (
                    <>
                      <div>
                        <span className="text-muted-foreground">{t("controlPlane.packmlState", "Trạng thái")}: </span>
                        <Badge>{stateQ.data.packmlState}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("controlPlane.opStatusNote", "Suy ra từ operationStatus")}: {stateQ.data.operationStatus}
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-muted-foreground">{t("controlPlane.allowedCmds", "Lệnh hợp lệ kế tiếp")}:</p>
                        <div className="flex flex-wrap gap-1">
                          {(stateQ.data.allowedPackmlCommands ?? []).length === 0
                            ? <span className="text-xs text-muted-foreground">—</span>
                            : (stateQ.data.allowedPackmlCommands ?? []).map((c) => (
                                <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                              ))}
                        </div>
                      </div>
                      <p className="rounded border border-dashed border-muted-foreground/30 p-2 text-[11px] text-muted-foreground">
                        {t("controlPlane.packmlReadNote", "Đây là phép chiếu CHỈ ĐỌC. Phát lệnh PackML đi qua bộ điều phối HITL, không từ trang này.")}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">{t("common.loading", "Đang tải…")}</p>
                  )}

                  {/* PackML vocabulary + adapter catalog */}
                  <div className="border-t pt-2">
                    <p className="mb-1 text-xs text-muted-foreground">{t("controlPlane.packmlVocab", "Từ vựng PackML")}:</p>
                    <div className="flex flex-wrap gap-1">
                      {((packmlQ.data?.states ?? []) as string[]).map((s) => (
                        <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">{t("controlPlane.adapters", "Adapter đã đăng ký")}:</p>
                    <div className="flex flex-wrap gap-1">
                      {adapterKinds.length === 0
                        ? <span className="text-xs text-muted-foreground">—</span>
                        : adapterKinds.map((a, i) => {
                            const label = typeof a === "string" ? a : (a.kind ?? JSON.stringify(a));
                            return <Badge key={i} variant="outline" className="text-[10px]">{label}</Badge>;
                          })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── ORCHESTRATION / FOE ── */}
          <TabsContent value="foe" className="space-y-4">
            {!foeStatusQ.isLoading && !foeEnabled && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>{t("controlPlane.foeDisabledBanner", "FOE chưa bật (FOE_ENABLED) — vẫn xem được workflow/run, nhưng deploy/start/resume/abort sẽ trả kết quả 'disabled'. Phát động từ Orchestration Studio.")}</span>
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">{t("controlPlane.workflows", "Workflow đã triển khai")}</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("controlPlane.colRef", "Ref")}</TableHead>
                        <TableHead>{t("controlPlane.colName", "Tên")}</TableHead>
                        <TableHead>{t("controlPlane.colVersion", "Phiên bản")}</TableHead>
                        <TableHead>{t("controlPlane.colWfStatus", "Trạng thái")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((workflowsQ.data ?? []) as Array<{ id: number; ref: string; name: string; version: number; status: string }>).length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">{t("controlPlane.noWorkflows", "Chưa có workflow.")}</TableCell></TableRow>
                      )}
                      {((workflowsQ.data ?? []) as Array<{ id: number; ref: string; name: string; version: number; status: string }>).map((w) => (
                        <TableRow key={w.id}>
                          <TableCell className="font-mono text-xs">{w.ref}</TableCell>
                          <TableCell className="font-medium">{w.name}</TableCell>
                          <TableCell className="text-xs">v{w.version}</TableCell>
                          <TableCell><Badge variant="outline">{w.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">{t("controlPlane.runs", "Lượt chạy gần đây")}</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("controlPlane.colRunId", "Run")}</TableHead>
                        <TableHead>{t("controlPlane.colWfStatus", "Trạng thái")}</TableHead>
                        <TableHead>{t("controlPlane.colCreated", "Tạo lúc")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((runsQ.data ?? []) as Array<{ id: number; status: string; createdAt?: string | Date }>).length === 0 && (
                        <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground">{t("controlPlane.noRuns", "Chưa có lượt chạy.")}</TableCell></TableRow>
                      )}
                      {((runsQ.data ?? []) as Array<{ id: number; status: string; createdAt?: string | Date }>).map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                          <TableCell>{runStatusBadge(r.status, t)}</TableCell>
                          <TableCell className="text-xs">{fmt(r.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── EDGE RUNTIME ── */}
          <TabsContent value="edge" className="space-y-4">
            {!edgeStatusQ.isLoading && !edgeEnabled && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>{t("controlPlane.edgeDisabledBanner", "Edge runtime chưa bật (EDGE_RUNTIME_ENABLED). Quản lý chi tiết tại trang Edge Nodes.")}</span>
              </div>
            )}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t("controlPlane.edgeNodes", "Node biên đã đăng ký")}</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("controlPlane.colCode", "Mã")}</TableHead>
                      <TableHead>{t("controlPlane.colName", "Tên")}</TableHead>
                      <TableHead>{t("controlPlane.colWfStatus", "Trạng thái")}</TableHead>
                      <TableHead>{t("controlPlane.colHeartbeat", "Heartbeat")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((edgeNodesQ.data ?? []) as Array<{ id: number; code: string; name: string; status: string; lastHeartbeatAt?: string | Date | null }>).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">{t("controlPlane.noEdgeNodes", "Chưa có node biên.")}</TableCell></TableRow>
                    )}
                    {((edgeNodesQ.data ?? []) as Array<{ id: number; code: string; name: string; status: string; lastHeartbeatAt?: string | Date | null }>).map((n) => (
                      <TableRow key={n.id}>
                        <TableCell className="font-mono text-xs">{n.code}</TableCell>
                        <TableCell className="font-medium">{n.name}</TableCell>
                        <TableCell><Badge variant="outline">{n.status}</Badge></TableCell>
                        <TableCell className="text-xs">{fmt(n.lastHeartbeatAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}
