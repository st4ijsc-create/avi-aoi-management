/**
 * Doc 80 Đợt 1 Task 1 (PLT-02 / G-07 / X-07) — trạng thái "tính năng này dùng được chưa"
 * dùng chung, thay cho `flag ?? true` / `flag ?? false` rải rác ở 5 trang Engineering.
 *
 * ── BỆNH ─────────────────────────────────────────────────────────────────────────
 * Bốn trang (`FleetOrchestration`, `EquipmentStandards`, `EquipmentIntegration`,
 * `SafetyWorkforce`) mặc định LẠC QUAN `statusQ.data?.enabled ?? true` khi query
 * `status` CHƯA trả lời (đang tải) hoặc trả lỗi — coi "chưa biết" như "bật". `/engineering`
 * (`EngineeringWorkspace`) mặc định BI QUAN `?? false` cho badge "Triển khai", VÀ card
 * "Dự án" hiện chuỗi "Chưa có dự án" bất cứ khi nào `projectsQ.data` còn `undefined`
 * (kể cả đang tải) — quan sát live 2026-09-25 (doc 80 G-07): vài giây đầu màn hình nói
 * "Chưa có dự án" + badge "Triển khai: OFF" + banner nêu tên biến môi trường
 * `DPC_DEPLOY_ENABLED`, rồi lật sang "4 dự án" + "ON". Người dùng không phân biệt được
 * "đang tải" với "tắt thật" — một giá trị mặc định bị trưng ra như SỰ THẬT đã biết.
 *
 * ── HỢP ĐỒNG (4 trạng thái, không bao giờ gộp) ─────────────────────────────────────
 *   "loading" — query chưa trả lời             → skeleton, nút ghi bị khoá
 *   "error"   — query trả lời nhưng lỗi         → khoá + báo lỗi, KHÔNG BAO GIỜ là "on"
 *   "off"     — query trả lời, cờ đang tắt      → banner i18n thân thiện, KHÔNG nêu tên biến môi trường
 *   "on"      — query trả lời, cờ đang bật      → không hiện gì
 *
 * "off" KHÔNG tự khoá nút ghi ở đây — hầu hết mutation trên các trang này đã tự trả lỗi
 * FEATURE_DISABLED (409) hoặc `status:"simulated"` khi cờ tắt (Phụ lục F §3 PLT-02) và
 * trang đã có toast giải thích riêng; component này chỉ đảm bảo "đang tải/lỗi" không bị
 * hiển thị NHƯ MỘT trong hai trạng thái đã biết (bật/tắt).
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type FeatureStatus = "loading" | "off" | "on" | "error";

interface StatusLikeQuery<T> {
  data: T | undefined;
  isPending?: boolean;
  isLoading?: boolean;
  isError?: boolean;
}

/**
 * Suy ra 1 trong 4 trạng thái từ một tRPC query + hàm chọn cờ boolean trong payload.
 * KHÔNG BAO GIỜ mặc định query chưa xong/lỗi thành `true` hay `false` — chưa xong ⇒
 * "loading", lỗi ⇒ "error"; chỉ khi query đã CÓ dữ liệu mới suy ra "on"/"off".
 */
export function deriveFeatureStatus<T>(
  query: StatusLikeQuery<T>,
  select: (data: T) => boolean | undefined,
): FeatureStatus {
  if (query.isError) return "error";
  const pending = query.isPending ?? query.isLoading ?? false;
  if (pending || query.data === undefined) return "loading";
  const enabled = select(query.data);
  return enabled === undefined ? "error" : enabled ? "on" : "off";
}

/**
 * "loading"/"error" ⇒ chưa biết ⇒ nút ghi phải khoá. "off" đã biết (server tự chặn/ghi
 * nhận mô phỏng ở lượt ghi thật) nên KHÔNG nằm trong danh sách này — xem docblock đầu tệp.
 */
export function isFeatureStatusUnsettled(status: FeatureStatus): boolean {
  return status === "loading" || status === "error";
}

export interface FeatureStatusGateProps {
  status: FeatureStatus;
  /** Câu i18n cho trạng thái TẮT — PHẢI là câu thân thiện, không được chứa tên biến môi trường. */
  offMessage: ReactNode;
  /** Câu riêng cho trạng thái LỖI; không truyền thì dùng câu mặc định chung. */
  errorMessage?: ReactNode;
  className?: string;
}

/**
 * Banner dùng chung cho 4 trạng thái: "on" không hiện gì; "loading" hiện skeleton;
 * "off" hiện banner thân thiện (không tên biến môi trường); "error" hiện banner lỗi riêng
 * biệt — không bao giờ trộn với "on" hay "off".
 */
export function FeatureStatusGate({ status, offMessage, errorMessage, className }: FeatureStatusGateProps) {
  const { t } = useTranslation();
  if (status === "on") return null;

  if (status === "loading") {
    return (
      <Skeleton
        data-testid="feature-status-loading"
        className={cn("h-10 w-full rounded-md", className)}
      />
    );
  }

  if (status === "error") {
    return (
      <div
        role="alert"
        data-testid="feature-status-error"
        className={cn(
          "flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm",
          className,
        )}
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <span>
          {errorMessage
            ?? t(
              "common.featureStatusError",
              "Could not check this feature's status — treating it as unavailable.",
            )}
        </span>
      </div>
    );
  }

  // status === "off"
  return (
    <div
      data-testid="feature-status-off"
      className={cn(
        "flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm",
        className,
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <span>{offMessage}</span>
    </div>
  );
}

/**
 * Nhãn ngắn (badge/KPI) theo cùng 4 trạng thái — "loading"/"error" không bao giờ in ra
 * literal "ON"/"OFF" của nhãn đã biết. Generic theo `T` (thường là `string`) để chỗ gọi
 * (vd `MetricCard.value: string | number`) không phải ép kiểu về `ReactNode`.
 */
export function featureStatusLabel<T>(
  status: FeatureStatus,
  labels: { on: T; off: T; loading: T; error: T },
): T {
  if (status === "on") return labels.on;
  if (status === "off") return labels.off;
  if (status === "loading") return labels.loading;
  return labels.error;
}

/** Tông màu cho badge/KPI theo cùng 4 trạng thái. */
export function featureStatusTone(status: FeatureStatus): "good" | "warning" | "default" {
  if (status === "on") return "good";
  if (status === "off") return "warning";
  return "default";
}
