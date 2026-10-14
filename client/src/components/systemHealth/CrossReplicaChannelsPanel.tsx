/**
 * doc 81 Đợt 12 final fix wave (ruling R-12-e M-3) — System Health: the cross-replica pg channels of THIS central replica
 * (`systemHealth.crossReplicaChannels`, admin_system:canView, read-only):
 *   • the OT STOP epoch sync (`ot_stop_epoch`) — state ("disabled: no HMAC key" named as such, with the env variable to set — never a
 *     value), key source (an env NAME), peer STOPs applied, rejections by reason, the start hello (verified peers, key mismatches),
 *     NOTIFY latency;
 *   • the `device_owner_changed` listener — state, reconnects, lost episodes, heartbeat RTT.
 * Before this panel the status existed only as an API: an alert was the only visible signal.
 */
import { useTranslation } from "react-i18next";
import { Waypoints, Loader2, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { SectionCard, StatusBadge } from "@/components/patterns";
import type { StatusMapEntry } from "@/components/patterns";
import { mapTrpcError } from "@/lib/trpcErrors";

type Tone = StatusMapEntry["tone"];

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums" data-testid={testId}>
        {children}
      </span>
    </div>
  );
}

export function CrossReplicaChannelsPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("admin_system", "canView");
  const query = trpc.systemHealth.crossReplicaChannels.useQuery(undefined, { refetchInterval: 15_000, enabled: canView });
  if (!canView) return null;
  const d = query.data as
    | {
        otStopEpoch: {
          state: string;
          keySource: string | null;
          disabled: string | null;
          peerStops: number;
          rejected: number;
          rejectedBy: Record<string, number>;
          peerLatencyMs: { count: number; p99: number };
          hello?: { verifiedPeers: number; mismatches: number };
        };
        deviceOwner: { state: string; reconnects: number; lostEpisodes: number; lastPingRttMs: number | null } | null;
      }
    | undefined;

  const stateTone: Record<string, Tone> = { ok: "success", connecting: "info", degraded: "warning", disabled: "error", off: "default" };
  const epochLabel = (s: string) =>
    s === "ok"
      ? t("systemHealth.crossReplica.stateOk", "Đang đồng bộ")
      : s === "connecting"
        ? t("systemHealth.crossReplica.stateConnecting", "Đang kết nối")
        : s === "degraded"
          ? t("systemHealth.crossReplica.stateDegraded", "Suy giảm")
          : s === "disabled"
            ? t("systemHealth.crossReplica.stateDisabledNoKey", "Tắt: chưa có khoá HMAC")
            : t("systemHealth.crossReplica.stateOff", "Chưa chạy");
  const ownerLabel = (s: string | null) =>
    s === "ok"
      ? t("systemHealth.crossReplica.ownerOk", "Đang nghe")
      : s === "connecting"
        ? t("systemHealth.crossReplica.stateConnecting", "Đang kết nối")
        : s === "degraded"
          ? t("systemHealth.crossReplica.stateDegraded", "Suy giảm")
          : t("systemHealth.crossReplica.stateOff", "Chưa chạy");

  return (
    <SectionCard
      icon={<Waypoints className="h-5 w-5 text-primary" />}
      title={t("systemHealth.crossReplica.title", "Kênh giữa các bản sao trung tâm")}
      description={t(
        "systemHealth.crossReplica.desc",
        "Trạng thái của bản sao trung tâm này: đồng bộ lệnh DỪNG OT (một lệnh DỪNG gửi ở bản sao khác huỷ các lệnh ghi đang chờ ở đây) và kênh báo đổi chủ sở hữu thiết bị. Chỉ đọc.",
      )}
    >
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading", "Đang tải…")}
        </div>
      ) : query.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive py-6">
          <AlertTriangle className="h-4 w-4" /> {mapTrpcError(query.error)}
        </div>
      ) : !d ? (
        <p className="text-sm text-muted-foreground">{t("systemHealth.crossReplica.unavailable", "Không đọc được trạng thái các kênh.")}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-medium">{t("systemHealth.crossReplica.epochTitle", "Đồng bộ DỪNG OT giữa các bản sao")}</h4>
            <Row label={t("systemHealth.crossReplica.state", "Trạng thái")} testId="xr-epoch-state">
              <StatusBadge status={d.otStopEpoch.state} tone={stateTone[d.otStopEpoch.state] ?? "default"} label={epochLabel(d.otStopEpoch.state)} />
            </Row>
            {d.otStopEpoch.disabled === "no_hmac_key" ? (
              <p className="py-1 text-xs text-destructive" data-testid="xr-disabled-hint">
                {t(
                  "systemHealth.crossReplica.disabledHint",
                  "Đặt {{envKey}} (ít nhất 32 ký tự, giống nhau trên mọi bản sao trung tâm) hoặc {{envSecret}} rồi khởi động lại. Không hại khi chỉ có MỘT tiến trình trung tâm.",
                  { envKey: "OT_STOP_EPOCH_HMAC_KEY", envSecret: "SECRET_ENCRYPTION_KEY" },
                )}
              </p>
            ) : null}
            <Row label={t("systemHealth.crossReplica.keySource", "Nguồn khoá")}>
              {d.otStopEpoch.keySource ? <code className="text-xs">{d.otStopEpoch.keySource}</code> : "—"}
            </Row>
            <Row label={t("systemHealth.crossReplica.peerStops", "Lệnh DỪNG nhận từ bản sao khác")} testId="xr-peer-stops">
              {d.otStopEpoch.peerStops}
            </Row>
            <Row label={t("systemHealth.crossReplica.rejected", "Thông báo bị từ chối")} testId="xr-rejected">
              {d.otStopEpoch.rejected}
              {d.otStopEpoch.rejected > 0
                ? ` (${Object.entries(d.otStopEpoch.rejectedBy)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => `${k} ${n}`)
                    .join(", ")})`
                : ""}
            </Row>
            <Row label={t("systemHealth.crossReplica.helloPeers", "Bản sao đã xác minh cùng khoá")} testId="xr-hello">
              {d.otStopEpoch.hello?.verifiedPeers ?? 0}
            </Row>
            {(d.otStopEpoch.hello?.mismatches ?? 0) > 0 ? (
              <Row label={t("systemHealth.crossReplica.keyMismatch", "Bản sao ký bằng khoá KHÁC")} testId="xr-key-mismatch">
                <StatusBadge status="mismatch" tone="error" label={String(d.otStopEpoch.hello?.mismatches ?? 0)} />
              </Row>
            ) : null}
            <Row label={t("systemHealth.crossReplica.latency", "Độ trễ NOTIFY (p99)")} testId="xr-latency">
              {d.otStopEpoch.peerLatencyMs.count > 0 ? `${d.otStopEpoch.peerLatencyMs.p99} ms` : "—"}
            </Row>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-medium">{t("systemHealth.crossReplica.ownerTitle", "Kênh đổi chủ sở hữu thiết bị")}</h4>
            <Row label={t("systemHealth.crossReplica.state", "Trạng thái")} testId="xr-owner-state">
              <StatusBadge status={d.deviceOwner?.state ?? "off"} tone={stateTone[d.deviceOwner?.state ?? "off"] ?? "default"} label={ownerLabel(d.deviceOwner?.state ?? null)} />
            </Row>
            <Row label={t("systemHealth.crossReplica.reconnects", "Số lần kết nối lại")} testId="xr-owner-reconnects">
              {d.deviceOwner?.reconnects ?? 0}
            </Row>
            <Row label={t("systemHealth.crossReplica.lostEpisodes", "Số đợt mất kênh")} testId="xr-owner-lost">
              {d.deviceOwner?.lostEpisodes ?? 0}
            </Row>
            <Row label={t("systemHealth.crossReplica.pingRtt", "Nhịp tim gần nhất")} testId="xr-owner-rtt">
              {d.deviceOwner?.lastPingRttMs != null ? `${d.deviceOwner.lastPingRttMs} ms` : "—"}
            </Row>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
