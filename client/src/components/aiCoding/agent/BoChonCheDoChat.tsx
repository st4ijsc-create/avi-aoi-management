/**
 * Đợt 1 · T5 — bộ chọn chế độ ô chat: **Hỏi** · **Agent · duyệt từng bước** · **Agent · tự động** (chỉ hiện khi có
 * `ai_repo_exec`, kèm câu cảnh báo). Lưu/đọc lựa chọn: `cheDoChat.ts`.
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheDoChat } from "./cheDoChat";

export function BoChonCheDoChat({
  giaTri,
  onDoi,
  coQuyenTuDong,
  khoa,
}: {
  giaTri: CheDoChat;
  onDoi: (v: CheDoChat) => void;
  coQuyenTuDong: boolean;
  /** Đang có lượt chạy ⇒ không đổi chế độ giữa chừng. */
  khoa?: boolean;
}) {
  const { t } = useTranslation();
  const ds: Array<{ v: CheDoChat; nhan: string; goiY: string }> = [
    { v: "hoi", nhan: t("repoWs.agent.cheDo.hoi", "Hỏi"), goiY: t("repoWs.agent.cheDo.hoiGoiY", "Hỏi đáp như cũ — không tự ghi tệp") },
    {
      v: "sua",
      nhan: t("repoWs.agent.cheDo.sua", "Agent · duyệt từng bước"),
      goiY: t("repoWs.agent.cheDo.suaGoiY", "Agent tự đọc, sửa, chạy lệnh qua nhiều bước — mỗi lượt ghi/lệnh chờ bạn duyệt"),
    },
  ];
  if (coQuyenTuDong) {
    ds.push({
      v: "tu-dong",
      nhan: t("repoWs.agent.cheDo.tuDong", "Agent · tự động"),
      goiY: t("repoWs.agent.cheDo.tuDongGoiY", "Ghi/lệnh trong danh sách trắng tự chạy sau checkpoint (hoàn tác được)"),
    });
  }
  return (
    <div className="mb-1.5 space-y-1">
      <div role="radiogroup" aria-label={t("repoWs.agent.cheDo.nhom", "Chế độ trò chuyện")} className="inline-flex flex-wrap gap-0.5 rounded-md border p-0.5">
        {ds.map((x) => (
          <button
            key={x.v}
            type="button"
            role="radio"
            aria-checked={giaTri === x.v}
            disabled={khoa && giaTri !== x.v}
            title={x.goiY}
            onClick={() => onDoi(x.v)}
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              giaTri === x.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {x.nhan}
          </button>
        ))}
      </div>
      {giaTri === "tu-dong" && (
        <p data-testid="canh-bao-tu-dong" className="flex items-start gap-1 text-[10px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>{t("repoWs.agent.cheDo.tuDongCanhBao", "Tự động: agent GHI tệp và CHẠY lệnh danh sách trắng KHÔNG hỏi lại. Kiểm tra kết quả và dùng Hoàn tác nếu cần.")}</span>
        </p>
      )}
    </div>
  );
}
