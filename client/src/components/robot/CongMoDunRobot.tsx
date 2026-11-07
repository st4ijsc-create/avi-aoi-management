/**
 * Pha 0 · C0-5 — CỔNG mô-đun robot/AGV cho 3 trang `RobotControl` · `CommandConsole` · `FleetOrchestration`.
 * Cờ tắt (hoặc chưa đọc được) ⇒ KHÔNG mount trang (không truy vấn, không mutation, không nút lệnh) — chỉ dải "tạm dừng". Mã trang giữ nguyên (không gỡ).
 * `DaiRobotTamDung` còn dùng thành dải nhỏ trong trang có phần robot lẫn phần khác (SafetyWorkforce: phối hợp người↔robot).
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Loader2, PauseCircle } from "lucide-react";
import { useRobotModuleTrang } from "@/hooks/useRobotModuleTamDung";

export function DaiRobotTamDung({ nho = false }: { nho?: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="status" data-testid="dai-robot-tam-dung" className={`flex items-start gap-3 rounded-md border border-dashed ${nho ? "p-2 text-xs" : "p-4 text-sm"}`}>
      <PauseCircle className={nho ? "mt-0.5 h-4 w-4 shrink-0" : "mt-0.5 h-5 w-5 shrink-0"} aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">{t("robotTamDung.tieuDe")}</p>
        <p className="text-muted-foreground">{nho ? t("robotTamDung.moTaNgan") : t("robotTamDung.moTa")}</p>
      </div>
    </div>
  );
}

export function CongMoDunRobot({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const trang = useRobotModuleTrang();
  if (trang === "bat") return <>{children}</>;
  if (trang === "dang-tai") {
    return (
      <div data-testid="cong-robot-dang-tai" className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("robotTamDung.dangKiemTra")}
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6" data-testid="cong-robot-tam-dung">
      <DaiRobotTamDung />
      <div>
        <Link href="/" className="text-sm font-medium underline">
          {t("robotTamDung.veTrangChu")}
        </Link>
      </div>
    </div>
  );
}
