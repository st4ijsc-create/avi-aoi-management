/**
 * SYNAPSE Platform cockpit (doc 33 — frontend surfacing). READ-ONLY.
 *
 * One page that makes the SYNAPSE platform layer visible in the Control Tower: the deployment
 * edition, the plugin catalogue + out-of-process sidecar capabilities, policy-as-code, the SLO
 * catalogue + live decision-traces, the published contracts, and the developer portal. Thin +
 * honest: only the read-only SYNAPSE routers, loading/empty states, no mutations.
 */
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Boxes,
  Plug,
  ShieldCheck,
  Activity,
  FileJson,
  BookOpen,
  CheckCircle2,
  XCircle,
  Gauge,
} from "lucide-react";

function Loading() {
  return <Skeleton className="h-24 w-full" />;
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  );
}

function EditionTab() {
  const { t } = useTranslation();
  const cur = trpc.edition.current.useQuery();
  const list = trpc.edition.list.useQuery();
  if (cur.isLoading) return <Loading />;
  const p = cur.data?.profile;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">{t("synapse.edition.current", "Deployment hiện tại")}</CardTitle></CardHeader>
        <CardContent>
          <KV k="Edition" v={<Badge>{p?.editionName ?? "—"}</Badge>} />
          <KV k="Topology" v={p?.topology ?? "—"} />
          <KV k="Infra profile" v={p?.infraProfile ?? "—"} />
          <KV k="Broker" v={p?.broker ?? "—"} />
          <KV k="Time-series" v={p?.timeseries ?? "—"} />
          <KV k="EDITION_PROFILE" v={p?.profileEnforced ? "on" : "advisory"} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("synapse.edition.catalogue", "Ba edition")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(list.data?.editions ?? []).map((e) => (
            <div key={e.code} className="rounded-md border p-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{e.name}</span>
                <Badge variant="outline">{e.topology}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{e.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PluginsTab() {
  const { t } = useTranslation();
  const plugins = trpc.plugin.list.useQuery();
  const sidecar = trpc.plugin.sidecarCapabilities.useQuery();
  if (plugins.isLoading) return <Loading />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">{t("synapse.plugins.catalogue", "Plugin catalogue")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(plugins.data ?? []).map((pl) => (
            <div key={pl.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{pl.name}</span>
                  <Badge variant="outline" className="text-xs">{pl.kind}</Badge>
                  {pl.apiCompatible
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : <XCircle className="h-4 w-4 text-destructive" />}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  v{pl.version} · apiVersion {pl.apiVersion} · {(pl.protocols ?? []).join(", ") || "—"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {pl.hasConfigSchema && <Badge variant="secondary" className="text-xs">auto-form</Badge>}
                {pl.signaturePresent && <Badge variant="secondary" className="text-xs">signed</Badge>}
              </div>
            </div>
          ))}
          {(plugins.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">—</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("synapse.plugins.sidecar", "Out-of-process sidecar")}</CardTitle></CardHeader>
        <CardContent>
          <KV k="Isolation" v={sidecar.data?.isolation ?? "—"} />
          <KV k="IPC" v={sidecar.data?.ipc ?? "—"} />
          <KV k="Validate gate" v={sidecar.data?.validateGate ?? "—"} />
          <KV k="Signature (prod)" v={sidecar.data?.signatureRequiredInProduction ? "required" : "—"} />
          <KV k="Restart backoff" v={sidecar.data ? `${sidecar.data.restartPolicy.baseMs}ms → ${sidecar.data.restartPolicy.maxMs}ms` : "—"} />
        </CardContent>
      </Card>
    </div>
  );
}

function SecurityTab() {
  const { t } = useTranslation();
  const policies = trpc.security.policies.useQuery();
  if (policies.isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("synapse.security.policies", "Policy-as-code")}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {(policies.data ?? []).map((p) => (
          <div key={p.id} className="rounded-md border p-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs">{p.id}</span>
              <Badge variant={p.effect === "deny" ? "destructive" : "secondary"}>{p.effect}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{p.reason}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">actions: {p.actions.join(", ") || "*"} · v{p.version}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ObservabilityTab() {
  const { t } = useTranslation();
  const slos = trpc.observability.slos.useQuery();
  const decisions = trpc.observability.recentDecisions.useQuery({ limit: 20 });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">{t("synapse.obs.slos", "SLO catalogue")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(slos.data ?? []).map((s) => (
            <div key={s.id} className="rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{s.name}</span>
                <Badge variant="outline">{(s.objective * 100).toFixed(s.objective >= 0.99 ? 1 : 0)}%</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("synapse.obs.decisions", "Decision-trace gần đây")}</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {(decisions.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">{t("synapse.obs.noDecisions", "Chưa có quyết định nào (bật FLEET_ORCH + OBSERVABILITY).")}</p>
          )}
          {(decisions.data ?? []).map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{d.decisionType} · {d.subject}</span>
              <span className="font-mono">{d.chosen ?? "—"}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ContractsTab() {
  const { t } = useTranslation();
  const schemas = trpc.contracts.schemas.useQuery();
  const providers = trpc.contracts.reconcileProviders.useQuery();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">{t("synapse.contracts.schemas", "Schema registry")}</CardTitle></CardHeader>
        <CardContent>
          {(schemas.data ?? []).length === 0
            ? <p className="text-sm text-muted-foreground">{t("synapse.contracts.noSchemas", "Chưa đăng ký schema nào.")}</p>
            : (schemas.data ?? []).map((s) => <KV key={s.name} k={s.name} v={`v${s.latestVersion}`} />)}
          <p className="mt-2 text-xs text-muted-foreground">OpenAPI + AsyncAPI: {t("synapse.contracts.served", "phục vụ qua trpc.contracts / devPortal")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("synapse.contracts.reconcile", "Reconciliation providers")}</CardTitle></CardHeader>
        <CardContent>
          {(providers.data ?? []).length === 0
            ? <p className="text-sm text-muted-foreground">{t("synapse.contracts.noProviders", "Chưa cắm provider MES/ERP/WMS.")}</p>
            : (providers.data ?? []).map((p) => <KV key={p.id} k={p.id} v={p.description} />)}
        </CardContent>
      </Card>
    </div>
  );
}

function DevPortalTab() {
  const { t } = useTranslation();
  const idx = trpc.devPortal.index.useQuery();
  if (idx.isLoading) return <Loading />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">{t("synapse.dev.portal", "Developer Portal")}</CardTitle></CardHeader>
        <CardContent>
          <KV k="Plugin API" v={idx.data?.pluginApiVersion ?? "—"} />
          <KV k="OpenAPI paths" v={idx.data?.specs.openapiPaths ?? 0} />
          <KV k="AsyncAPI channels" v={idx.data?.specs.asyncapiChannels ?? 0} />
          <KV k={t("synapse.dev.kpi", "Time-to-first-plugin")} v={`≤ ${idx.data?.kpi.timeToFirstPluginTargetDays ?? 1}d`} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("synapse.dev.extPoints", "Extension points")}</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {(idx.data?.extensionPoints ?? []).map((e) => (
            <div key={e.kind} className="text-sm">
              <span className="font-medium">{e.title}</span>
              <span className="ml-2 text-xs text-muted-foreground">{e.contract}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SynapsePlatformPage() {
  const { t } = useTranslation();
  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          title={t("synapse.title", "SYNAPSE Platform")}
          description={t("synapse.subtitle", "Editions · Plugins · Security · Observability · Contracts · Dev Portal (read-only)")}
        />
        <Tabs defaultValue="edition" className="mt-4">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="edition"><Boxes className="mr-1 h-4 w-4" />{t("synapse.tab.edition", "Editions")}</TabsTrigger>
            <TabsTrigger value="plugins"><Plug className="mr-1 h-4 w-4" />{t("synapse.tab.plugins", "Plugins")}</TabsTrigger>
            <TabsTrigger value="security"><ShieldCheck className="mr-1 h-4 w-4" />{t("synapse.tab.security", "Security")}</TabsTrigger>
            <TabsTrigger value="obs"><Activity className="mr-1 h-4 w-4" />{t("synapse.tab.obs", "Observability")}</TabsTrigger>
            <TabsTrigger value="contracts"><FileJson className="mr-1 h-4 w-4" />{t("synapse.tab.contracts", "Contracts")}</TabsTrigger>
            <TabsTrigger value="dev"><BookOpen className="mr-1 h-4 w-4" />{t("synapse.tab.dev", "Dev Portal")}</TabsTrigger>
          </TabsList>
          <TabsContent value="edition" className="mt-4"><EditionTab /></TabsContent>
          <TabsContent value="plugins" className="mt-4"><PluginsTab /></TabsContent>
          <TabsContent value="security" className="mt-4"><SecurityTab /></TabsContent>
          <TabsContent value="obs" className="mt-4"><ObservabilityTab /></TabsContent>
          <TabsContent value="contracts" className="mt-4"><ContractsTab /></TabsContent>
          <TabsContent value="dev" className="mt-4"><DevPortalTab /></TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}
