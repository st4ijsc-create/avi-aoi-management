/**
 * AI Brain Dashboard
 * Observability for the local-AI "brain":
 *  - Cognitive Escalation Ladder — request distribution across tiers (from aiGguf.routerStats)
 *  - Local engine health — GPU mode, VRAM, resident models, inference queue (from aiGguf.health)
 *
 * Note: routerStats is an in-memory counter — it reflects activity since the server last started.
 */

import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Brain,
  Cpu,
  Zap,
  Layers,
  Eye,
  UserCheck,
  Gauge,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Server,
  ListChecks,
  ArrowDownToLine,
  ArrowUpFromLine,
  Timer,
  ShieldAlert,
  GitCompare,
} from "lucide-react";

// Cognitive Escalation Ladder — tier metadata (mirrors aiModelRouter.ts Tier 0–4).
const TIERS = [
  { n: 0, icon: ListChecks, label: "Tier 0 · Reflex", desc: "Rule / SQL / heuristic — không LLM", bar: "bg-slate-400", text: "text-slate-500", bg: "bg-slate-500/10" },
  { n: 1, icon: Zap, label: "Tier 1 · Fast", desc: "Model nhỏ (3B): intent, chat ngắn, extract", bar: "bg-emerald-500", text: "text-emerald-500", bg: "bg-emerald-500/10" },
  { n: 2, icon: Layers, label: "Tier 2 · Deep", desc: "Model lớn (7B) + RAG: RCA, report, reasoning", bar: "bg-blue-500", text: "text-blue-500", bg: "bg-blue-500/10" },
  { n: 3, icon: Eye, label: "Tier 3 · Perception", desc: "Vision (Qwen2.5-VL): mô tả lỗi, visual QA", bar: "bg-fuchsia-500", text: "text-fuchsia-500", bg: "bg-fuchsia-500/10" },
  { n: 4, icon: UserCheck, label: "Tier 4 · Human / HITL", desc: "Hành động ghi, độ tin cậy thấp → người duyệt", bar: "bg-amber-500", text: "text-amber-500", bg: "bg-amber-500/10" },
] as const;

function fmtGB(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function fmtNum(n?: number): string {
  if (!n || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function AIBrainDashboard() {
  const { t } = useTranslation();
  // Poll hygiene (doc 27 B12): pause the 3×5s pollers when the tab is hidden,
  // refetch immediately on return — see usePollingInterval.
  const polling = usePollingInterval(5000);
  const router = trpc.aiGguf.routerStats.useQuery(undefined, { ...polling });
  const health = trpc.aiGguf.health.useQuery(undefined, { ...polling });
  // AI Gateway stats — DB-backed tokens / latency / rate-limit / A/B over the last 24h.
  const gateway = trpc.aiGguf.gatewayStats.useQuery({ sinceHours: 24 }, { ...polling });

  const stats = router.data;
  const total = stats?.total ?? 0;
  const byTier = stats?.byTier ?? {};
  const h = health.data;
  const vram = h?.vram ?? null;
  const vramPct = vram && vram.total > 0 ? Math.min(100, (vram.used / vram.total) * 100) : 0;

  const gw = gateway.data;
  const refreshAll = () => { router.refetch(); health.refetch(); gateway.refetch(); };

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Brain className="h-6 w-6 text-primary" />}
          title={t("aiBrain.title", "AI Brain")}
          description={t("aiBrain.subtitle", "Giám sát bộ não AI cục bộ — phân tầng độ khó & sức khỏe engine")}
          actions={
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              {t("common.refresh", "Làm mới")}
            </Button>
          }
        />

        {/* Engine health summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* GPU mode */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" />{t("aiBrain.engine", "Engine")}</CardDescription>
            </CardHeader>
            <CardContent>
              {health.isLoading ? <Skeleton className="h-6 w-24" /> : (
                <>
                  <div className="text-lg font-semibold">{h?.gpuMode ?? "—"}</div>
                  <Badge variant={h?.operational ? "default" : "secondary"} className="mt-1">
                    {h?.operational ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                    {h?.operational ? t("aiBrain.operational", "Hoạt động") : t("aiBrain.idle", "Chưa nạp model")}
                  </Badge>
                </>
              )}
            </CardContent>
          </Card>

          {/* VRAM */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" />VRAM</CardDescription>
            </CardHeader>
            <CardContent>
              {health.isLoading ? <Skeleton className="h-6 w-24" /> : vram ? (
                <>
                  <div className="text-lg font-semibold">{fmtGB(vram.used)} <span className="text-sm text-muted-foreground font-normal">/ {fmtGB(vram.total)}</span></div>
                  <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${vramPct}%` }} />
                  </div>
                </>
              ) : <div className="text-sm text-muted-foreground">{t("aiBrain.noVram", "CPU / không có VRAM")}</div>}
            </CardContent>
          </Card>

          {/* Models loaded */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5"><Server className="h-3.5 w-3.5" />{t("aiBrain.models", "Model nóng")}</CardDescription>
            </CardHeader>
            <CardContent>
              {health.isLoading ? <Skeleton className="h-6 w-16" /> : (
                <>
                  <div className="text-lg font-semibold">{h?.modelsLoaded ?? 0} <span className="text-sm text-muted-foreground font-normal">/ {h?.maxLoadedModels ?? "—"}</span></div>
                  <div className="text-xs text-muted-foreground mt-1">{h?.totalLoadedHuman ?? "—"} · {h?.modelsAvailable ?? 0} {t("aiBrain.available", "có sẵn")}</div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Queue */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" />{t("aiBrain.queue", "Hàng đợi suy luận")}</CardDescription>
            </CardHeader>
            <CardContent>
              {health.isLoading ? <Skeleton className="h-6 w-16" /> : (
                <>
                  <div className="text-lg font-semibold">{h?.queue?.running ?? 0} <span className="text-sm text-muted-foreground font-normal">{t("aiBrain.running", "chạy")}</span></div>
                  <div className="text-xs text-muted-foreground mt-1">{h?.queue?.queued ?? 0} {t("aiBrain.queued", "chờ")} · max {h?.queue?.max ?? "—"}</div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Cognitive Escalation Ladder */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><Brain className="h-4 w-4 text-primary" />{t("aiBrain.ladder", "Thang leo nhận thức (dễ → khó)")}</CardTitle>
                <CardDescription>{t("aiBrain.ladderDesc", "Phân bố yêu cầu theo tầng kể từ lần khởi động server gần nhất")}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={stats?.fastModelConfigured ? "default" : "secondary"}>
                  <Zap className="h-3 w-3 mr-1" />
                  {stats?.fastModelConfigured ? t("aiBrain.fastOn", "Fast-tier (3B) bật") : t("aiBrain.fastOff", "Chưa có fast-tier")}
                </Badge>
                <Badge variant="outline">{total} {t("aiBrain.requests", "yêu cầu")}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {router.isLoading ? (
              <>{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}</>
            ) : total === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                {t("aiBrain.noData", "Chưa có yêu cầu AI nào được định tuyến. Hãy dùng AI Chat / phân tích để bắt đầu thu thập.")}
              </div>
            ) : (
              TIERS.map(tier => {
                const count = (byTier as Record<number, number>)[tier.n] ?? 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                const Icon = tier.icon;
                return (
                  <div key={tier.n} className="flex items-center gap-3">
                    <div className={`h-9 w-9 shrink-0 rounded-lg ${tier.bg} flex items-center justify-center`}>
                      <Icon className={`h-5 w-5 ${tier.text}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{tier.label}</span>
                        <span className="text-sm tabular-nums text-muted-foreground shrink-0">{count} · {pct.toFixed(0)}%</span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${tier.bar} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{tier.desc}</div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* AI Gateway — tokens / latency / rate-limit / A/B (DB-backed, last 24h) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-primary" />
                  {t("aiBrain.gateway", "AI Gateway — đo lường suy luận (24h)")}
                </CardTitle>
                <CardDescription>
                  {t("aiBrain.gatewayDesc", "Token, độ trễ, giới hạn tần suất và A/B — lưu bền trong DB (không mất khi khởi động lại)")}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={gw?.source === "db" ? "default" : "secondary"}>
                  {gw?.source === "db" ? t("aiBrain.srcDb", "DB bền vững") : t("aiBrain.srcMem", "Bộ nhớ tạm")}
                </Badge>
                {gw?.abEnabled ? (
                  <Badge variant="outline"><GitCompare className="h-3 w-3 mr-1" />A/B</Badge>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {gateway.isLoading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : !gw || gw.total === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                {t("aiBrain.gatewayEmpty", "Chưa có suy luận nào đi qua Gateway trong 24h. Dùng AI Chat / phân tích để bắt đầu thu thập.")}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Token + latency + throttle summary */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5"><ArrowDownToLine className="h-3.5 w-3.5" />{t("aiBrain.tokensIn", "Token vào")}</div>
                    <div className="text-lg font-semibold mt-1 tabular-nums">{fmtNum(gw.tokensIn)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5"><ArrowUpFromLine className="h-3.5 w-3.5" />{t("aiBrain.tokensOut", "Token ra")}</div>
                    <div className="text-lg font-semibold mt-1 tabular-nums">{fmtNum(gw.tokensOut)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" />{t("aiBrain.avgLatency", "Độ trễ TB")}</div>
                    <div className="text-lg font-semibold mt-1 tabular-nums">{gw.avgLatencyMs > 0 ? `${gw.avgLatencyMs} ms` : "—"}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5" />{t("aiBrain.throttled", "Bị giới hạn / lỗi")}</div>
                    <div className="text-lg font-semibold mt-1 tabular-nums">{fmtNum(gw.rateLimited)} <span className="text-sm text-muted-foreground font-normal">/ {fmtNum(gw.errors)}</span></div>
                  </div>
                </div>

                {/* A/B split (only when active) */}
                {gw.ab ? (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mb-2"><GitCompare className="h-3.5 w-3.5" />{t("aiBrain.abSplit", "Phân chia A/B")}</div>
                    <div className="flex items-center gap-4 text-sm">
                      <span>A (control): <span className="font-semibold tabular-nums">{fmtNum(gw.ab.A)}</span></span>
                      <span>B (experiment): <span className="font-semibold tabular-nums">{fmtNum(gw.ab.B)}</span></span>
                    </div>
                  </div>
                ) : null}

                {/* Per-model token + latency breakdown */}
                {gw.byModel.length > 0 ? (
                  <div className="rounded-lg border overflow-hidden">
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/40">
                      <div className="col-span-5">{t("aiBrain.model", "Model")}</div>
                      <div className="col-span-2 text-right">{t("aiBrain.requests", "Yêu cầu")}</div>
                      <div className="col-span-3 text-right">{t("aiBrain.tokens", "Token (vào/ra)")}</div>
                      <div className="col-span-2 text-right">{t("aiBrain.latency", "Trễ TB")}</div>
                    </div>
                    {gw.byModel.map(m => (
                      <div key={m.model} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm border-t">
                        <div className="col-span-5 truncate font-mono text-xs" title={m.model}>{m.model}</div>
                        <div className="col-span-2 text-right tabular-nums">{fmtNum(m.count)}</div>
                        <div className="col-span-3 text-right tabular-nums text-muted-foreground">{fmtNum(m.tokensIn)}/{fmtNum(m.tokensOut)}</div>
                        <div className="col-span-2 text-right tabular-nums">{m.avgLatencyMs}ms</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
