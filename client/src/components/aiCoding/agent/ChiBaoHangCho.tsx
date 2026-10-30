/**
 * ★ Đợt 11.8 (UX-D09) — CHỈ BÁO HÀNG CHỜ MODEL trước khi gửi: "N lượt đứng trước bạn" (`aiAgent.trangThaiHangCho`: chỉ SỐ, không id/người khác).
 *   • Chỉ hỏi khi `bat` (tab chế độ agent đang mở, chưa có lượt chạy) VÀ tài liệu đang HIỆN (`document.visibilityState === "visible"`) — ẩn/rời tab ⇒ DỪNG poll.
 *   • Chu kỳ 10 s. Lỗi / không có quyền / `phiaTruoc` null hoặc 0 ⇒ ẨN chỉ báo, KHÔNG toast, không thử dồn.
 *   • Khi lượt đã chạy, hàng chờ thật hiện qua sự kiện `dang-cho-model` trên dòng thời gian — chỉ báo này tự tắt (`bat=false`).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Hourglass } from "lucide-react";
import { trpc } from "@/lib/trpc";

export const CHU_KY_HANG_CHO_MS = 10_000;

const dangHien = () => typeof document === "undefined" || document.visibilityState === "visible";

export function useTaiLieuDangHien(): boolean {
  const [hien, setHien] = useState(dangHien);
  useEffect(() => {
    const doi = () => setHien(dangHien());
    document.addEventListener("visibilitychange", doi);
    doi();
    return () => document.removeEventListener("visibilitychange", doi);
  }, []);
  return hien;
}

export function ChiBaoHangCho({ bat }: { bat: boolean }) {
  const { t } = useTranslation();
  const hien = useTaiLieuDangHien();
  const hoi = bat && hien;
  const q = trpc.aiAgent.trangThaiHangCho.useQuery(undefined, {
    enabled: hoi,
    refetchInterval: hoi ? CHU_KY_HANG_CHO_MS : false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const d = q.data;
  if (!hoi || q.isError || !d || d.ok !== true || typeof d.phiaTruoc !== "number" || d.phiaTruoc <= 0) return null;
  return (
    <p data-testid="agent-hang-cho" role="status" className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
      <Hourglass className="h-3 w-3" aria-hidden />
      {t("repoWs.agent.hangCho", "Hàng chờ model: {{n}} lượt đứng trước bạn", { n: d.phiaTruoc })}
    </p>
  );
}
