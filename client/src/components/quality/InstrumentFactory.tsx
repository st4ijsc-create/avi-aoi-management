/**
 * ★★★ 2026-10-25 — NHÀ MÁY SỞ HỮU CỦA THIẾT BỊ ĐO (migration 0421: `measurement_instruments.factoryId`, NULL = chưa gán).
 *
 * Thiết bị chưa gán nhà máy CHỈ người phạm vi toàn quyền (admin) thấy — nên màn quản trị phải (1) cho admin CHỌN nhà máy, (2) HIỆN nhà máy trong danh sách, (3) CẢNH BÁO nhẹ cho thiết bị chưa gán, nếu
 * không thiết bị mới tạo "biến mất" khỏi người dùng nhà máy mà không ai biết vì sao. Các mảnh ở đây thuần theo props (không gọi mạng) để kiểm DOM được.
 */
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

export interface NhaMayLuaChon {
  id: number;
  code?: string | null;
  name?: string | null;
}

const tenNhaMay = (n: NhaMayLuaChon): string => (n.name ? String(n.name) : n.code ? String(n.code) : `#${n.id}`);

/** Ô "Nhà máy" trong danh sách: tên nhà máy, hoặc nhãn cảnh báo khi chưa gán. */
export function TheNhaMayThietBi({ factoryId, factories }: { factoryId: number | null | undefined; factories: readonly NhaMayLuaChon[] }) {
  const { t } = useTranslation();
  if (factoryId == null) {
    return (
      <Badge
        data-chua-gan-nha-may
        title={t("instrumentCal.factory.unassignedHint")}
        className="border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400"
      >
        {t("instrumentCal.factory.unassigned")}
      </Badge>
    );
  }
  const n = factories.find((f) => f.id === factoryId);
  return <span data-the-nha-may-thiet-bi>{n ? tenNhaMay(n) : `#${factoryId}`}</span>;
}

/** Ô chọn nhà máy (CHỈ đưa ra cho người toàn quyền/admin — người gọi quyết định hiển thị). "" = chưa gán. */
export function OChonNhaMayThietBi({
  value,
  factories,
  onChange,
  disabled,
  nhan,
}: {
  value: number | null | undefined;
  factories: readonly NhaMayLuaChon[];
  onChange: (factoryId: number | null) => void;
  disabled?: boolean;
  nhan?: string;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{nhan ?? t("instrumentCal.factory.label")}</span>
      <select
        data-o-chon-nha-may-thiet-bi
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value == null ? "" : String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">{t("instrumentCal.factory.unassigned")}</option>
        {factories.map((f) => (
          <option key={f.id} value={String(f.id)}>
            {tenNhaMay(f)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Cảnh báo nhẹ: có thiết bị chưa gán nhà máy (chỉ khi soLuong > 0). */
export function CanhBaoChuaGanNhaMay({ soLuong }: { soLuong: number }) {
  const { t } = useTranslation();
  if (soLuong <= 0) return null;
  return (
    <div data-canh-bao-chua-gan-nha-may className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <span>{t("instrumentCal.factory.unassignedBanner", { count: soLuong })}</span>
    </div>
  );
}
