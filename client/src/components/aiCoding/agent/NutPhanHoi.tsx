/**
 * ★ AI Local Đợt 5.1 (2026-10-17) — NÚT PHẢN HỒI 👍/👎 (+ lý do) cho MỘT câu trả lời của lượt agent hoặc MỘT diff trên thẻ
 * duyệt. Thành phần ĐỘC LẬP: không biết gì về trang chứa nó, chỉ cần định danh (`dich`). Gắn vào khung agent / thẻ duyệt
 * là việc của nơi dùng.
 *
 * Hợp đồng với máy chủ (`aiAgent.phanHoi`):
 *   • client CHỈ gửi định danh + phiếu + lý do; văn bản được lưu máy chủ tự lấy từ sổ của nó (không gửi chữ lên);
 *   • `tra-loi`: `chiSoTin` = thứ tự khối `chu` trên dòng thời gian (cùng luật gộp với `khoiTraLoiTuSuKien` — lưới chéo
 *     `phanHoiKhoi.unit.test.ts`); `diff`: `actionId` = id hàng `ai_pending_actions` (`idHanhDong`);
 *   • bấm lại nút đang chọn = GỠ phiếu (`danhGia: null`).
 *
 * Trạng thái hiển thị là KẾT QUẢ THẬT của máy chủ (`phieu.danhGia`), không lạc quan: lỗi ⇒ giữ phiếu cũ + báo mã lỗi.
 * 👎 ghi phiếu NGAY rồi mở ô lý do (tuỳ chọn) — người bỏ ngang ô lý do vẫn để lại tín hiệu.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { agentTrpc, type DauVaoPhanHoi, type KetQuaPhanHoi } from "@/lib/agentApi";

export type DichPhanHoi = { loai: "tra-loi"; runId: string; chiSoTin: number } | { loai: "diff"; actionId: string };
type Phieu = 1 | -1 | null;

export interface NutPhanHoiProps {
  dich: DichPhanHoi;
  /** Phiếu đã có (vd từ `phanHoiCuaToi`). */
  danhGiaBanDau?: Phieu;
  /** Tiêm cho lưới; mặc định `agentTrpc.phanHoi`. */
  gui?: (vao: DauVaoPhanHoi) => Promise<KetQuaPhanHoi>;
  className?: string;
}

const TRAN_LY_DO = 2000;

export function NutPhanHoi({ dich, danhGiaBanDau = null, gui = agentTrpc.phanHoi, className }: NutPhanHoiProps) {
  const { t } = useTranslation();
  const [phieu, setPhieu] = useState<Phieu>(danhGiaBanDau);
  const [dangGui, setDangGui] = useState(false);
  const [moLyDo, setMoLyDo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [daGuiLyDo, setDaGuiLyDo] = useState(false);
  const [maLoi, setMaLoi] = useState<string | null>(null);

  async function guiPhieu(danhGia: Phieu, kemLyDo?: string): Promise<boolean> {
    setDangGui(true);
    setMaLoi(null);
    try {
      const kq = await gui({ ...dich, danhGia, ...(kemLyDo ? { lyDo: kemLyDo } : {}) } as DauVaoPhanHoi);
      if (!kq.ok) {
        setMaLoi(kq.ma ?? "LOI");
        return false;
      }
      setPhieu(kq.danhGia);
      return true;
    } catch {
      setMaLoi("MANG");
      return false;
    } finally {
      setDangGui(false);
    }
  }

  async function bamLen() {
    const ok = await guiPhieu(phieu === 1 ? null : 1);
    if (ok) setMoLyDo(false);
  }

  async function bamXuong() {
    if (phieu === -1) {
      if (await guiPhieu(null)) setMoLyDo(false);
      return;
    }
    if (await guiPhieu(-1)) {
      setMoLyDo(true);
      setDaGuiLyDo(false);
    }
  }

  async function guiLyDo() {
    const s = lyDo.trim();
    if (!s) return;
    if (await guiPhieu(-1, s)) {
      setDaGuiLyDo(true);
      setMoLyDo(false);
    }
  }

  const cauLoi = (ma: string) =>
    ma === "PERMISSION_DENIED"
      ? t("aiAgentPhanHoi.loi.quyen", "Bạn không có quyền gửi phản hồi.")
      : ma === "NOT_FOUND"
        ? t("aiAgentPhanHoi.loi.khongThay", "Không tìm thấy câu trả lời / đề xuất này (có thể đã hết hạn lưu).")
        : ma === "KHONG_PHAI_DIFF"
          ? t("aiAgentPhanHoi.loi.khongPhaiDiff", "Đề xuất này không phải một thay đổi tệp — không chấm được.")
          : t("aiAgentPhanHoi.loi.chung", "Không ghi được phản hồi — thử lại sau.");

  return (
    <div className={cn("flex flex-col gap-1", className)} data-testid="nut-phan-hoi">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant={phieu === 1 ? "default" : "ghost"}
          className="h-7 px-2"
          aria-pressed={phieu === 1}
          aria-label={t("aiAgentPhanHoi.huuIch", "Hữu ích")}
          title={t("aiAgentPhanHoi.huuIch", "Hữu ích")}
          disabled={dangGui}
          onClick={() => void bamLen()}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={phieu === -1 ? "destructive" : "ghost"}
          className="h-7 px-2"
          aria-pressed={phieu === -1}
          aria-label={t("aiAgentPhanHoi.khongHuuIch", "Chưa tốt")}
          title={t("aiAgentPhanHoi.khongHuuIch", "Chưa tốt")}
          disabled={dangGui}
          onClick={() => void bamXuong()}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </Button>
        {dangGui && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
        {daGuiLyDo && phieu === -1 && (
          <span className="text-xs text-muted-foreground">{t("aiAgentPhanHoi.daGhiLyDo", "Đã ghi lý do.")}</span>
        )}
      </div>
      {moLyDo && (
        <div className="flex items-start gap-1">
          <textarea
            className="min-h-[2.25rem] flex-1 rounded border bg-background px-2 py-1 text-xs"
            aria-label={t("aiAgentPhanHoi.lyDoNhan", "Vì sao chưa tốt? (tuỳ chọn)")}
            placeholder={t("aiAgentPhanHoi.lyDoGoiY", "VD: sai API, không biên dịch được, sửa nhầm tệp…")}
            maxLength={TRAN_LY_DO}
            value={lyDo}
            onChange={(e) => setLyDo(e.target.value)}
          />
          <Button type="button" size="sm" className="h-7" disabled={dangGui || !lyDo.trim()} onClick={() => void guiLyDo()}>
            {t("aiAgentPhanHoi.guiLyDo", "Gửi lý do")}
          </Button>
        </div>
      )}
      {maLoi && (
        <p role="alert" className="text-xs text-destructive">
          {cauLoi(maLoi)}
        </p>
      )}
    </div>
  );
}
