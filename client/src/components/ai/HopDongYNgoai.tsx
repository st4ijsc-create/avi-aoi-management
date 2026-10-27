/**
 * Đợt 10.4b (L0b) — HỘP ĐỒNG Ý khi chọn model NGOÀI ở bề mặt sinh chữ (kế hoạch §D4). THUẦN trình bày: dữ liệu `thongTin` do bề mặt lấy từ máy chủ
 * (`aiChonModel.thongTinNgoai` — nối ở L1; ở L0b dùng máy chủ giả). Nội dung bắt buộc: nhà cung cấp/model; "câu bạn gõ được coi là dữ liệu vận hành" (chat/KB —
 * kiem-dinh M1); nhà máy ĐÃ/CHƯA cho dữ liệu vận hành; trần còn lại (người thường: trần của mình + "nhà máy còn đủ trần"; số của nhà máy CHỈ admin — khoá vắng ⇒
 * không hiện); "AI ngoài chỉ đọc — công cụ ghi/chạy tắt"; không đính kèm ảnh/tệp. `duocPhep=false` ⇒ nút đồng ý KHOÁ kèm lý do (rào thật ở máy chủ).
 */
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tachMaNgoai } from "@/lib/dongYNgoai";

export interface ThongTinNgoai {
  nhaCungCap: string;
  model: string;
  duocPhep: boolean;
  lyDo?: string;
  tranVuot?: "luot" | "nha-may" | "nguoi" | "phut";
  mucDuLieu: "ky-thuat" | "van-hanh";
  choDuLieuVanHanh: boolean;
  conLaiTranNgay: { nguoi: { token: number | null }; nhaMay: { duTranChoLuotNay: boolean; token?: number | null; usd?: number | null } };
  dinhKemBiCam: boolean;
}

interface Props {
  ma: string;
  beMat: "chat" | "coding" | "agent";
  thongTin?: ThongTinNgoai;
  dangTai?: boolean;
  loi?: string;
  onDongY: () => void;
  onTuChoi: () => void;
}

const fmt = (n: number | null | undefined, donVi = "") => (n == null ? "—" : `${n.toLocaleString("vi-VN")}${donVi}`);

export function HopDongYNgoai({ ma, beMat, thongTin: x, dangTai, loi, onDongY, onTuChoi }: Props) {
  const { t } = useTranslation();
  const tach = tachMaNgoai(ma);
  const nhanTranVuot = (k: string) =>
    k === "luot"
      ? t("hopDongYNgoai.tranVuot.luot", "trần mỗi lượt của model")
      : k === "nha-may"
        ? t("hopDongYNgoai.tranVuot.nha-may", "trần ngày của nhà máy")
        : k === "nguoi"
          ? t("hopDongYNgoai.tranVuot.nguoi", "trần ngày của bạn")
          : k === "phut"
            ? t("hopDongYNgoai.tranVuot.phut", "quá nhiều lượt mỗi phút")
            : k;
  const khoa = !x || !x.duocPhep || !!dangTai;
  return (
    <Dialog open onOpenChange={(v) => (!v ? onTuChoi() : undefined)}>
      <DialogContent className="max-w-lg" data-testid="hop-dong-y-ngoai">
        <DialogHeader>
          <DialogTitle>{t("hopDongYNgoai.tieuDe", "Dùng model bên ngoài")}</DialogTitle>
          <DialogDescription>
            {t("hopDongYNgoai.moTa", "Mỗi lượt hỏi bằng model này gửi nội dung ra nhà cung cấp bên ngoài (trả phí). Nội dung được che dữ liệu nhạy cảm theo mẫu trước khi rời máy.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p data-testid="hdy-nha-cung-cap" className="font-medium">
            {x ? `${x.nhaCungCap} · ${x.model}` : tach ? `${tach.nhaCungCap} · ${tach.model}` : ma}
          </p>
          {dangTai && <p className="text-xs text-muted-foreground">{t("hopDongYNgoai.dangTai", "Đang kiểm tra điều kiện…")}</p>}
          {loi && (
            <p role="alert" data-testid="hdy-loi" className="rounded border border-red-500 p-2 text-xs text-red-700">
              {loi}
            </p>
          )}
          {beMat === "chat" && (
            <p data-testid="hdy-nguoi-go" className="rounded border border-amber-500/60 bg-amber-500/10 p-2 text-xs">
              {t("hopDongYNgoai.nguoiGoVanHanh", "Câu bạn gõ được coi là DỮ LIỆU VẬN HÀNH (đây là trợ lý vận hành) — chỉ gửi được khi nhà máy đã cho phép gửi dữ liệu vận hành ra ngoài.")}
            </p>
          )}
          {x && (
            <div className="space-y-1 text-xs" data-testid="hdy-chi-tiet">
              <p data-testid="hdy-nha-may-cho">
                {t("hopDongYNgoai.nhaMayCho", "Nhà máy đã cho phép gửi dữ liệu vận hành ra ngoài")}: <b>{x.choDuLieuVanHanh ? t("hopDongYNgoai.co", "có") : t("hopDongYNgoai.chua", "chưa")}</b>
              </p>
              <p data-testid="hdy-tran-nguoi">
                {t("hopDongYNgoai.tranNguoi", "Trần còn lại của bạn hôm nay")}: {x.conLaiTranNgay.nguoi.token === null ? t("hopDongYNgoai.chuaDatTran", "chưa đặt trần") : fmt(x.conLaiTranNgay.nguoi.token, " token")}
              </p>
              <p data-testid="hdy-tran-nha-may">
                {t("hopDongYNgoai.nhaMayDuTran", "Nhà máy còn đủ trần cho lượt này")}:{" "}
                <b className={x.conLaiTranNgay.nhaMay.duTranChoLuotNay ? "" : "text-red-700"}>{x.conLaiTranNgay.nhaMay.duTranChoLuotNay ? t("hopDongYNgoai.co", "có") : t("hopDongYNgoai.khong", "không")}</b>
                {"token" in x.conLaiTranNgay.nhaMay || "usd" in x.conLaiTranNgay.nhaMay ? (
                  <span data-testid="hdy-tran-nha-may-so" className="text-muted-foreground">
                    {" "}
                    ({fmt(x.conLaiTranNgay.nhaMay.token ?? null, " token")} / {x.conLaiTranNgay.nhaMay.usd == null ? "—" : `$${x.conLaiTranNgay.nhaMay.usd}`})
                  </span>
                ) : null}
              </p>
              <p className="text-muted-foreground">{t("hopDongYNgoai.chiDoc", "AI ngoài chỉ đọc — công cụ ghi/chạy lệnh bị tắt. Không đính kèm được ảnh/tệp.")}</p>
              {!x.duocPhep && (
                <p role="alert" data-testid="hdy-khoa" className="text-red-700">
                  {t("hopDongYNgoai.chuaDuocPhep", "Chưa dùng được")}: {x.lyDo ? t(`errors.reason.${x.lyDo}`, x.lyDo) : ""}
                  {x.tranVuot && <span data-testid="hdy-tran-vuot"> ({nhanTranVuot(x.tranVuot)})</span>}
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" data-testid="hdy-tu-choi" onClick={onTuChoi}>
              {t("hopDongYNgoai.tuChoi", "Không, giữ model hiện tại")}
            </Button>
            <Button type="button" size="sm" data-testid="hdy-dong-y" disabled={khoa} onClick={onDongY}>
              {t("hopDongYNgoai.dongY", "Đồng ý, dùng model này")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
