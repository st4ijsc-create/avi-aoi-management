/**
 * Control / Trust Readiness — doc 40 Wave 3A (§11) · "Trust & Enforcement Center".
 *
 * Ma trận đèn xanh/vàng/đỏ READ-ONLY cho trạng thái gate/flag runtime của tầng điều
 * khiển & tin cậy, gom theo nhóm (Kết nối / Điều khiển / Xác minh / An toàn / Bảo mật /
 * Observability). Mỗi mục nhãn "đang thật (armed) / dormant vì X / bypass". Đây là công
 * cụ QA + audit trực quan: một trang biết đường/gate nào đang thật, cái nào ngủ vì cờ
 * tắt, cái nào bị bypass làm yếu thế trận.
 *
 * 100% READ-ONLY — chỉ đọc trpc.readiness.matrix (server chỉ đọc process.env + getter
 * thuần). Honest: khi không đọc được DB, mục 2FA hiển thị dormant (không bịa số).
 * RBAC: route gated (admin / machine_control) — xem App.tsx.
 */
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import {
  PageHeader,
  PageContainer,
  MetricCard,
  SectionCard,
  StatusBadge,
} from "@/components/patterns";
import type { StatusMapEntry } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ShieldCheck,
  RefreshCw,
  Plug,
  SlidersHorizontal,
  BadgeCheck,
  Siren,
  Lock,
  Activity,
  AlertTriangle,
  CircleCheck,
  MoonStar,
  ShieldOff,
} from "lucide-react";

type MatrixOut = inferRouterOutputs<AppRouter>["readiness"]["matrix"];
type ReadinessItem = MatrixOut["items"][number];
type ReadinessState = ReadinessItem["state"];
type ReadinessGroup = ReadinessItem["group"];

// ── state → đèn (tone + nhãn) ─────────────────────────────────────────────────

const STATE_MAP: Record<ReadinessState, StatusMapEntry> = {
  armed: { tone: "success", label: "Đang thật" },
  dormant: { tone: "default", label: "Dormant" },
  bypass: { tone: "warning", label: "Bypass" },
  warn: { tone: "error", label: "Cảnh báo" },
};

// ── nhóm hiển thị (thứ tự + nhãn + icon) ──────────────────────────────────────

const GROUPS: { key: ReadinessGroup; label: string; icon: ReactNode }[] = [
  { key: "connectivity", label: "ctrlReady.ketNoi", icon: <Plug className="h-4 w-4" /> },
  { key: "control", label: "ctrlReady.dieuKhien", icon: <SlidersHorizontal className="h-4 w-4" /> },
  { key: "verification", label: "ctrlReady.xacMinh", icon: <BadgeCheck className="h-4 w-4" /> },
  { key: "safety", label: "ctrlReady.anToan", icon: <Siren className="h-4 w-4" /> },
  { key: "security", label: "ctrlReady.baoMat", icon: <Lock className="h-4 w-4" /> },
  { key: "observability", label: "Observability", icon: <Activity className="h-4 w-4" /> },
];

function StateIcon({ state }: { state: ReadinessState }) {
  switch (state) {
    case "armed":
      return <CircleCheck className="h-4 w-4 shrink-0 text-success" />;
    case "dormant":
      return <MoonStar className="h-4 w-4 shrink-0 text-muted-foreground" />;
    case "bypass":
      return <ShieldOff className="h-4 w-4 shrink-0 text-warning" />;
    case "warn":
      return <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Page
// ════════════════════════════════════════════════════════════════════════════

export default function ControlReadiness() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const query = trpc.readiness.matrix.useQuery(undefined, { refetchInterval: 30_000 });
  const data = query.data;

  const byGroup = useMemo(() => {
    const map = new Map<ReadinessGroup, ReadinessItem[]>();
    for (const g of GROUPS) map.set(g.key, []);
    for (const item of data?.items ?? []) {
      const list = map.get(item.group);
      if (list) list.push(item);
    }
    return map;
  }, [data]);

  const refresh = () => void utils.readiness.matrix.invalidate();
  const s = data?.summary;

  return (
    <DashboardLayout
      title={t("controlReadiness.title", "Trung tâm Tin cậy & Thực thi")}
      navItems={navItems}
      currentPath="/control-readiness"
    >
      <PageContainer>
        <PageHeader
          icon={<ShieldCheck className="h-6 w-6 text-primary" />}
          title={t("controlReadiness.title", "Trung tâm Tin cậy & Thực thi")}
          badge={<ViewOnlyBadge module="machine_control" />}
          description={t(
            "controlReadiness.subtitle",
            "Ma trận đèn READ-ONLY trạng thái gate/flag runtime của tầng điều khiển & tin cậy. Mỗi mục: đang thật (armed) / dormant vì cờ tắt / bypass (một lớp bảo vệ bị tắt). Công cụ QA + audit — không mở đường ghi thiết bị.",
          )}
          actions={
            <Button variant="outline" onClick={refresh} disabled={query.isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${query.isFetching ? "animate-spin" : ""}`} />
              {t("common.refresh", "Làm mới")}
            </Button>
          }
        />

        {/* Chú giải + tổng hợp đèn */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            icon={<CircleCheck className="h-5 w-5" />}
            label={t("controlReadiness.armed", "Đang thật (armed)")}
            value={s?.armed ?? "—"}
            tone="success"
          />
          <MetricCard
            icon={<MoonStar className="h-5 w-5" />}
            label={t("controlReadiness.dormant", "Dormant (cờ tắt)")}
            value={s?.dormant ?? "—"}
            tone="default"
          />
          <MetricCard
            icon={<ShieldOff className="h-5 w-5" />}
            label={t("controlReadiness.bypass", "Bypass (bảo vệ tắt)")}
            value={s?.bypass ?? "—"}
            tone="warning"
          />
          <MetricCard
            icon={<AlertTriangle className="h-5 w-5" />}
            label={t("controlReadiness.warn", "Cảnh báo")}
            value={s?.warn ?? "—"}
            tone="danger"
          />
        </div>

        {query.isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {query.error?.message ??
                t("controlReadiness.loadError", "Không tải được ma trận readiness.")}
            </AlertDescription>
          </Alert>
        )}

        {/* Cảnh báo nổi bật: bypass + warn cần chú ý */}
        {data && (data.summary.bypass > 0 || data.summary.warn > 0) && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {t(
                "controlReadiness.attention",
                "Có mục cần chú ý (bypass/cảnh báo). Xem các đèn cam/đỏ bên dưới — mỗi mục nêu rõ lý do và cách siết lại.",
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Ma trận theo nhóm */}
        {GROUPS.map((g) => {
          const items = byGroup.get(g.key) ?? [];
          return (
            <SectionCard
              key={g.key}
              icon={g.icon}
              title={t(g.label)}
              description={
                query.isLoading
                  ? t("common.loading", "Đang tải…")
                  : `${items.length} ${t("controlReadiness.checks", "mục")}`
              }
            >
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {query.isLoading
                    ? t("common.loading", "Đang tải…")
                    : t("controlReadiness.empty", "Không có mục nào trong nhóm này.")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <li key={item.key} className="flex items-start gap-3 py-3">
                      <StateIcon state={item.state} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{item.label}</span>
                          <StatusBadge status={item.state} map={STATE_MAP} />
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {item.key}
                          </code>
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">{item.reason}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          );
        })}

        {/* 2FA đặc quyền — chi tiết user thiếu 2FA */}
        {data?.privileged2fa?.available && data.privileged2fa.without2fa > 0 && (
          <SectionCard
            icon={<Lock className="h-4 w-4" />}
            title={t("controlReadiness.privileged2fa", "User đặc quyền chưa bật 2FA")}
            description={t(
              "controlReadiness.privileged2faDesc",
              "Các tài khoản này bị khóa mọi lệnh actuation/deploy cho tới khi bật 2FA.",
            )}
          >
            <ul className="flex flex-wrap gap-2">
              {data.privileged2fa.users.map((u) => (
                <li
                  key={u.id}
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-sm text-destructive"
                >
                  {u.username ?? `#${u.id}`} · {u.role}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {data?.generatedAt && (
          <p className="text-xs text-muted-foreground">
            {t("controlReadiness.generatedAt", "Cập nhật")}:{" "}
            {new Date(data.generatedAt).toLocaleString()}
          </p>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
