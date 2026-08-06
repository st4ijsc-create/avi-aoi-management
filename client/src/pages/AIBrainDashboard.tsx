/**
 * AI Brain Dashboard
 * Observability for the local-AI "brain":
 *  - Cognitive Escalation Ladder — request distribution across tiers (from aiGguf.routerStats)
 *  - Local engine health — GPU mode, VRAM, resident models, inference queue (from aiGguf.health)
 *
 * Note: routerStats is an in-memory counter — it reflects activity since the server last started.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { useAuth } from "@/_core/hooks/useAuth";
// ★ Pha 5 Task 3b (I-2) — thẩm quyền VRAM là bit PER-USER (`vram_control`), KHÔNG suy được từ vai:
// module ấy cố ý không nằm trong `DEFAULT_ROLE_PERMISSIONS`. Đây là người đọc quyền ĐÃ CÓ CHỦ của
// repo (5 trang khác dùng đúng kiểu này) — không đẻ người đọc thứ hai.
import { usePermissions } from "@/_core/hooks/usePermissions";
import { PageHeader, PageContainer } from "@/components/patterns";
import { ClassifierHealthBanner } from "@/components/ai/ClassifierHealthBanner";
import { VramBrokerPanel } from "@/components/ai/VramBrokerPanel";
/** ★ Pha 5 Task 2 (C-1) — cùng MỘT vị từ với `VramBrokerPanel`; xem `@/lib/vramReadSurface`. */
import {
  vramReadSurfaceKind,
  vramReadSurfaceErrorCode,
  VRAM_READ_SURFACE_NOTICE,
} from "@/lib/vramReadSurface";
/** ★ Pha 5 Task 3 (N9) — tầm với mặt LỆNH VRAM của vai; xem `@/lib/vramCommandReach`. */
import { vramCommandReach } from "@/lib/vramCommandReach";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Bot,
  Ban,
  ShieldOff,
  ShieldCheck,
} from "lucide-react";

// doc69 Giai đoạn 4/Wave 3 (D4) — Agent Ops session status → badge style.
const AGENT_SESSION_STATUS_STYLE: Record<string, string> = {
  planning: "bg-slate-500/10 text-slate-500",
  awaiting_approval: "bg-amber-500/10 text-amber-500",
  running: "bg-blue-500/10 text-blue-500",
  awaiting_confirm: "bg-amber-500/10 text-amber-500",
  paused: "bg-orange-500/10 text-orange-500",
  done: "bg-emerald-500/10 text-emerald-500",
  aborted: "bg-slate-500/10 text-slate-500",
  failed: "bg-red-500/10 text-red-500",
};

const CANCELABLE_SESSION_STATUSES = new Set(["planning", "awaiting_approval", "running", "awaiting_confirm", "paused"]);

function fmtAgo(d?: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}

// Cognitive Escalation Ladder — tier metadata (mirrors aiModelRouter.ts Tier 0–4).
const TIERS = [
  { n: 0, icon: ListChecks, label: "Tier 0 · Reflex", desc: "Rule / SQL / heuristic — không LLM", bar: "bg-slate-400", text: "text-slate-500", bg: "bg-slate-500/10" },
  { n: 1, icon: Zap, label: "Tier 1 · Fast", desc: "Model nhỏ (3B): intent, chat ngắn, extract", bar: "bg-emerald-500", text: "text-emerald-500", bg: "bg-emerald-500/10" },
  { n: 2, icon: Layers, label: "Tier 2 · Deep", desc: "Model lớn (7B) + RAG: RCA, report, reasoning", bar: "bg-blue-500", text: "text-blue-500", bg: "bg-blue-500/10" },
  { n: 3, icon: Eye, label: "Tier 3 · Perception", desc: "Vision (Qwen2.5-VL): mô tả lỗi, visual QA", bar: "bg-fuchsia-500", text: "text-fuchsia-500", bg: "bg-fuchsia-500/10" },
  { n: 4, icon: UserCheck, label: "Tier 4 · Human / HITL", desc: "Hành động ghi, độ tin cậy thấp → người duyệt", bar: "bg-amber-500", text: "text-amber-500", bg: "bg-amber-500/10" },
] as const;

function fmtGB(bytes?: number | null): string {
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
  const { user } = useAuth();
  // ★ I-2 — vế thứ HAI của quyết định nút VRAM (vế thứ nhất là sàn VAI). `hasPermission` tự
  // short-circuit cho admin, và trả `false` trong lúc `getMyPermissions` còn nạp ⇒ chiều an toàn.
  const { hasPermission } = usePermissions();
  // Poll hygiene (doc 27 B12): pause the 3×5s pollers when the tab is hidden,
  // refetch immediately on return — see usePollingInterval.
  const polling = usePollingInterval(5000);
  const router = trpc.aiGguf.routerStats.useQuery(undefined, { ...polling });
  const health = trpc.aiGguf.health.useQuery(undefined, { ...polling });
  // AI Gateway stats — DB-backed tokens / latency / rate-limit / A/B over the last 24h.
  const gateway = trpc.aiGguf.gatewayStats.useQuery({ sinceHours: 24 }, { ...polling });

  // doc69 Giai đoạn 4/Wave 3 (D4) — Agent Ops: ops-scoped (cross-user) session list
  // (admin/engineer only — RBAC-gated server-side too) + the D2 autonomy kill-switch.
  const isOpsRole = user?.role === "admin" || user?.role === "engineer";
  const isAdmin = user?.role === "admin";
  const opsSessions = trpc.aiAgent.listAgentSessionsForOps.useQuery(
    { limit: 20 },
    { ...polling, enabled: isOpsRole },
  );
  const killSwitch = trpc.aiAgent.getKillSwitchStatus.useQuery(undefined, { ...polling });
  const utils = trpc.useUtils();
  const [tripReason, setTripReason] = useState("");
  const cancelSessionMut = trpc.aiAgent.cancelSession.useMutation({
    onSuccess: () => {
      toast.success(t("aiBrain.agentOps.cancelSuccess", "Đã hủy phiên agent."));
      opsSessions.refetch();
    },
    onError: (err: any) => toast.error(t("aiBrain.agentOps.cancelError", "Không thể hủy phiên agent."), { description: mapTrpcError(err) }),
  });
  const tripMut = trpc.aiAgent.tripKillSwitch.useMutation({
    onSuccess: () => {
      toast.success(t("aiBrain.killSwitch.tripSuccess", "Đã TRIP công tắc — mọi tự-xác-nhận autonomy bị khóa ngay."));
      setTripReason("");
      killSwitch.refetch();
      utils.aiAgent.getKillSwitchStatus.invalidate();
    },
    onError: (err: any) => toast.error(t("aiBrain.killSwitch.tripError", "Không thể trip công tắc."), { description: mapTrpcError(err) }),
  });
  const untripMut = trpc.aiAgent.untripKillSwitch.useMutation({
    onSuccess: () => {
      toast.success(t("aiBrain.killSwitch.untripSuccess", "Đã UNTRIP công tắc."));
      killSwitch.refetch();
      utils.aiAgent.getKillSwitchStatus.invalidate();
    },
    onError: (err: any) => toast.error(t("aiBrain.killSwitch.untripError", "Không thể untrip công tắc."), { description: mapTrpcError(err) }),
  });

  /**
   * ★★★ Pha 4 Task 4 — **THẺ VRAM ĐỔI NGUỒN: `aiGguf.health.vram` → `vram.state` (qua BROKER).**
   *
   * ⚠⚠ Trước bản này thẻ VRAM in `getVramState()` THÔ của `node-llama-cpp` — một con số **không đi
   * qua** trần/sổ/`computeHeadroom`/`applyEnforcement`, tức KHÔNG phải con số đang TỪ CHỐI các lượt
   * xin. Hai đồng hồ nói hai số cho cùng một câu hỏi là lớp lỗi "hai bản sao vị từ" (review Task 1
   * gọi tên đích danh dòng này). Nay: **một đồng hồ**, và nó là đồng hồ đang cưỡng chế.
   * ⚠ `effectiveBytes`/`ceilingBytes` có thể `null` (không hữu hạn ⇒ bị chặn CÓ TÊN ở
   * `nonFiniteFields`) — KHÔNG `?? 0`: một số 0 bịa ra ở đây là "còn 0 MiB", một lời khẳng định.
   */
  const vramState = trpc.vram.state.useQuery(undefined, { ...polling });
  /**
   * ★★★ Pha 5 Task 2 (C-1) — **TỪ CHỐI QUYỀN ≠ KHÔNG CÓ PHẦN CỨNG.**
   *
   * Task 2 siết `vram.state` lên `machine_control/canView`. Trước lượt siết ấy nhánh `FORBIDDEN`
   * là **bất khả đạt** (`machine_control` chưa seed cho vai nào; `admin` qua được chỉ nhờ
   * short-circuit) — nên nhánh `:` cuối của thẻ dưới, vốn in `t("aiBrain.noVram")`, **chưa ai
   * thấy bao giờ**. Sau lượt siết, **mọi vai không phải `admin`** rơi vào đó **mỗi lần**, và thẻ
   * sẽ khẳng định *"CPU / không có VRAM"* — một lời khẳng định về **PHẦN CỨNG** dựng từ một lượt
   * **từ chối QUYỀN**. Đúng lớp lỗi mà docstring ngay dưới cấm `?? 0` để tránh.
   * ⇒ `kind` là ô DUY NHẤT quyết định thẻ, và nó dùng chung vị từ với `VramBrokerPanel`.
   */
  const vramKind = vramReadSurfaceKind({
    isLoading: vramState.isLoading,
    isError: vramState.isError,
    errorCode: vramReadSurfaceErrorCode(vramState.error),
    hasData: vramState.data !== undefined,
  });
  const stats = router.data;
  const total = stats?.total ?? 0;
  const byTier = stats?.byTier ?? {};
  const h = health.data;
  const vb = vramState.data;
  const vramCeiling = vb?.headroom.ceilingBytes ?? null;
  const vramUsed = vb?.headroom.usedBytes ?? null;
  const vramPct =
    vramCeiling !== null && vramUsed !== null && vramCeiling > 0
      ? Math.min(100, (vramUsed / vramCeiling) * 100)
      : 0;

  const gw = gateway.data;
  const refreshAll = () => { router.refetch(); health.refetch(); gateway.refetch(); vramState.refetch(); if (isOpsRole) opsSessions.refetch(); killSwitch.refetch(); };

  const handleTrip = () => {
    const reason = tripReason.trim();
    if (reason.length < 3) {
      toast.error(t("aiBrain.killSwitch.reasonPlaceholder", "Lý do dừng (bắt buộc)…"));
      return;
    }
    tripMut.mutate({ reason });
  };

  const handleUntrip = () => {
    if (!window.confirm(t("aiBrain.killSwitch.untripConfirm", "Bạn có chắc muốn MỞ LẠI (untrip) công tắc tự vận? Autonomy có thể tự xác nhận hành động nếu được bật ở nơi khác."))) {
      return;
    }
    untripMut.mutate();
  };

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

        {/* doc 69 Wave 6 (F1) — "no active classifier" health banner (additive) */}
        <ClassifierHealthBanner />

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
              {vramKind === "loading" ? <Skeleton className="h-6 w-24" /> : vramKind === "ready" && vb ? (
                <>
                  <div className="text-lg font-semibold">{fmtGB(vramUsed)} <span className="text-sm text-muted-foreground font-normal">/ {fmtGB(vramCeiling)}</span></div>
                  <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${vramPct}%` }} />
                  </div>
                  {/* ⚠ Con số trên là TRẦN DÙNG ĐƯỢC của broker, không phải dung lượng card — nói ra. */}
                  <div className="text-xs text-muted-foreground mt-1">{t("aiBrain.vramBrokerSource", "theo broker (số đang cưỡng chế)")}</div>
                </>
              ) : (
                /* ⚠ KHÔNG một chữ nào về phần cứng ở đây: thiếu dữ liệu KHÔNG chứng minh thiếu VRAM. */
                <div className="flex items-start gap-1.5 text-sm text-destructive">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {t(
                      VRAM_READ_SURFACE_NOTICE[vramKind === "denied" ? "denied" : "unreadable"].key,
                      VRAM_READ_SURFACE_NOTICE[vramKind === "denied" ? "denied" : "unreadable"].fallback,
                    )}
                  </span>
                </div>
              )}
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

        {/*
          ★★★ Pha 4 Task 4 — panel VRAM đọc từ BROKER (mặt đọc Task 1 + ba lệnh Task 2 + câu chữ
          Task 3). Đây là người đọc thật thứ hai của `buildVramAgentState()` (thứ nhất là
          `aiLocalTools/vramTools.ts`), và là chỗ tám hàm `translateVram*` có call-site sản phẩm.
        */}
        {/*
          ★★★ Pha 5 Task 3 (N9) — **CÁI NUÔI NÚT, KHÔNG PHẢI CÁI NÚT.**
          Bản trước đổ `isOpsRole` (`admin || engineer` — cổng của **Agent Ops**, không phải một câu
          về VRAM) vào đây ⇒ `supervisor` không bao giờ bấm được dù vị từ nút có đúng đến đâu, còn
          `engineer` thấy hai nút phá huỷ **chắc chắn 403**. Nay ô này **LÀ** một lời gọi
          `vramCommandReach(...)`, và kiểu trả về là thứ duy nhất panel nhận được.

          ★ Task 3b (I-2) — ô này nay nhận **CẢ HAI** vế mà máy chủ có: sàn VAI **và** bit PER-USER
          `vram_control` (`hasPermission`). Chỉ theo vai là **sai vĩnh viễn** sau 3b, vì module mới
          cố ý không bao giờ vào khuôn vai ⇒ một `supervisor` chưa được cấp tay sẽ thấy nút bấm
          được cho một lệnh chắc chắn 403.
        */}
        <VramBrokerPanel commandReach={vramCommandReach(user?.role, hasPermission)} polling={polling} />

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

        {/* doc69 Giai đoạn 4/Wave 3 (D4) — Agent Ops: ops-scoped session list +
            autonomy kill-switch. Additive — does not touch the cards above. */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  {t("aiBrain.agentOps.title", "Agent Ops")}
                </CardTitle>
                <CardDescription>{t("aiBrain.agentOps.desc", "Phiên agent gần đây trên toàn hệ thống (admin/kỹ thuật) — theo dõi và can thiệp khi cần")}</CardDescription>
              </div>
              <Badge variant={killSwitch.data?.tripped ? "destructive" : "outline"}>
                {killSwitch.data?.tripped ? <ShieldOff className="h-3 w-3 mr-1" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                {killSwitch.data?.tripped
                  ? t("aiBrain.killSwitch.tripped", "ĐÃ TRIP — autonomy bị khóa")
                  : t("aiBrain.killSwitch.notTripped", "Chưa trip — autonomy có thể chạy nếu được bật")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Kill-switch control — visible to everyone (read), trip/untrip action admin-only */}
            <div className="rounded-lg border p-3 flex flex-col gap-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                {t("aiBrain.killSwitch.title", "Công tắc dừng khẩn cấp tự vận (autonomy)")}
              </div>
              {isAdmin ? (
                killSwitch.data?.tripped ? (
                  <Button variant="outline" size="sm" className="self-start" disabled={untripMut.isPending} onClick={handleUntrip}>
                    <ShieldCheck className="h-4 w-4 mr-1.5" />
                    {t("aiBrain.killSwitch.untripButton", "Untrip — mở lại")}
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={tripReason}
                      onChange={(e) => setTripReason(e.target.value)}
                      placeholder={t("aiBrain.killSwitch.reasonPlaceholder", "Lý do dừng (bắt buộc)…")}
                      className="max-w-xs h-8 text-sm"
                      maxLength={500}
                    />
                    <Button variant="destructive" size="sm" disabled={tripMut.isPending || tripReason.trim().length < 3} onClick={handleTrip}>
                      <ShieldOff className="h-4 w-4 mr-1.5" />
                      {t("aiBrain.killSwitch.tripButton", "Trip — dừng khẩn cấp")}
                    </Button>
                  </div>
                )
              ) : (
                <div className="text-xs text-muted-foreground">{t("aiBrain.killSwitch.adminOnlyNote", "Chỉ admin đã bật 2FA mới có thể đổi trạng thái công tắc này.")}</div>
              )}
            </div>

            {/* Ops-scoped session list */}
            {!isOpsRole ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                {t("aiBrain.agentOps.restrictedNote", "Cần quyền admin hoặc kỹ thuật để xem danh sách phiên agent toàn hệ thống.")}
              </div>
            ) : opsSessions.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !opsSessions.data?.sessions?.length ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                {t("aiBrain.agentOps.empty", "Không có phiên agent gần đây.")}
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden overflow-x-auto">
                <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/40 min-w-[640px]">
                  <div className="col-span-2">{t("aiBrain.agentOps.colUser", "Người dùng")}</div>
                  <div className="col-span-4">{t("aiBrain.agentOps.colGoal", "Mục tiêu")}</div>
                  <div className="col-span-2">{t("aiBrain.agentOps.colStatus", "Trạng thái")}</div>
                  <div className="col-span-1 text-right">{t("aiBrain.agentOps.colProgress", "Tiến độ")}</div>
                  <div className="col-span-1 text-right">{t("aiBrain.agentOps.colUpdated", "Cập nhật")}</div>
                  <div className="col-span-2 text-right">{t("aiBrain.agentOps.colActions", "Hành động")}</div>
                </div>
                {opsSessions.data.sessions.map((s) => {
                  const isOwn = s.userId === user?.id;
                  const canCancel = isOwn && CANCELABLE_SESSION_STATUSES.has(s.status);
                  return (
                    <div key={s.id} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm border-t min-w-[640px] items-center">
                      <div className="col-span-2 truncate text-xs" title={s.username ?? String(s.userId)}>{s.username ?? `#${s.userId}`}</div>
                      <div className="col-span-4 truncate" title={s.goal}>{s.goal}</div>
                      <div className="col-span-2">
                        <Badge variant="outline" className={AGENT_SESSION_STATUS_STYLE[s.status] ?? ""}>
                          {t(`aiBrain.agentOps.status.${s.status}`, s.status)}
                        </Badge>
                      </div>
                      <div className="col-span-1 text-right tabular-nums text-muted-foreground">{s.stepIndex}/{s.stepTotal}</div>
                      <div className="col-span-1 text-right tabular-nums text-muted-foreground">{fmtAgo(s.updatedAt)}</div>
                      <div className="col-span-2 text-right">
                        {canCancel ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={cancelSessionMut.isPending}
                            onClick={() => cancelSessionMut.mutate({ sessionId: s.id })}
                          >
                            <Ban className="h-3.5 w-3.5 mr-1" />
                            {t("aiBrain.agentOps.cancel", "Hủy")}
                          </Button>
                        ) : !isOwn && CANCELABLE_SESSION_STATUSES.has(s.status) ? (
                          <span className="text-xs text-muted-foreground" title={t("aiBrain.agentOps.ownSessionOnly", "Chỉ có thể hủy phiên của chính bạn")}>—</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
