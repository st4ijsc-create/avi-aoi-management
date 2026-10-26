/**
 * SCADA R1b-2a Task 7 — hộp "Khai mức hàng loạt" của M12: MỘT lô (MỘT adapter, ≤ `TRAN_HANG_LOAT` kênh) gửi `scadaKenh.khaiHangLoat`.
 *
 *   • Chọn mức 1 / 3 / 4 / 5 hoặc "Bỏ khai" (⇒ NULL ⇒ máy chủ coi là 5, fail-closed); lý do ≥ 5 ký tự (`TruongLyDo`).
 *   • `items = hang.map(h => ({ tagId, patch: { actuationLevel } }))` — mọi hàng được chọn, cùng một mức. Máy chủ kiểm từng kênh bằng cùng
 *     hàm với capNhat, tất-cả-hoặc-không; kênh đã đúng mức được giữ nguyên (`soGiuNguyen`).
 *   • fix round 1 (c1, điều phối 2026-10-26: theo brief) — ô mã TOTP 6 số HIỆN SẴN như `HopSuaKenh` ⇒ MỘT lượt gọi mỗi lô (thủ tục thuộc nhóm
 *     giới hạn "2fa" — hai lượt mỗi lô sẽ nhân đôi chi phí). Nút gửi khoá tới khi đủ 6 chữ số. Máy chủ từ chối mã (sai / đã dùng / tạm khoá
 *     kèm số phút / không kiểm được) ⇒ câu ĐÃ DỊCH hiện NGAY TRONG hộp, người dùng sửa mã rồi gửi lại. Mã bị xoá khỏi state sau MỌI kết cục
 *     (thành công đóng hộp; lỗi bất kỳ xoá ô mã — mã một lần, mã đã gửi không còn dùng được).
 *   • Census `client/src/lib/vramPanelStepUp.unit.test.ts` `KHOA_TOTP_TRONG_HANDLER`: thủ tục tự kiểm mã ở handler ⇒ điểm gọi
 *     `khai.mutate({ …, totpCode })` (không qua `stepUp.guard`).
 *   • fix round 1 (c5) — dòng nhắc "gỡ ghim trước" khớp ĐÚNG luật máy chủ `STOP_PIN_GO_TRUOC` (khaiKenh.kiemPatchKenh): hàng có ghim DỪNG
 *     (stopValue khác null) VÀ mức hiệu lực CŨ ≤ 1 VÀ mức hiệu lực MỚI > 1. Nhắc, không chặn — máy chủ là trọng tài.
 *   • Lỗi mang `appParams.tagId` ⇒ hộp nêu `tagKey` của hàng đó + câu i18n của mã lỗi (`mapTrpcError`), hộp giữ mở. Lỗi khác ⇒ toast.
 *   • Thành công ⇒ toast `daKhai {soDoi, soGiuNguyen}`, làm mới `scadaKenh.danhSach` (+ `cheDo.danhSach`: khả năng dừng phụ thuộc mức),
 *     `onDaKhai` (bỏ chọn), đóng.
 * Màu chỉ lấy token ISA có sẵn (qua `KhoiCanhBao`).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { HangKenh } from "./BangKenh";
import { KhoiCanhBao } from "./KhoiCanhBao";
import { dinhDangSo } from "./kenhHienThi";
import { LOP_O_CHON, TruongLyDo, TruongTotp, laLoiMaTotp, lyDoDuDai, maTotpDu } from "./TruongLyDo";

/**
 * Trần số kênh MỘT lô — bản sao phía client của `TRAN_KENH_DA_KHAI_MOT_LO` (`server/services/scada/troLaiKenh.ts`); test DOM của M12 ghim
 * hai số bằng nhau (preflight D3). Máy chủ vẫn là ranh giới (`QUA_NHIEU_KENH_DA_KHAI`).
 */
export const TRAN_HANG_LOAT = 200;

const MUC_KHAI = [1, 3, 4, 5] as const;
type MucKhai = (typeof MUC_KHAI)[number];
/** Giá trị ô chọn của "Bỏ khai" (⇒ actuationLevel null ⇒ hiệu lực 5). */
const BO_KHAI = "bo";
/** Mức tác động tối đa mà STOP HMI còn gửi ghim (khớp `MUC_TOI_DA_STOP_HMI` ở máy chủ). */
const MUC_TOI_DA_STOP_HMI = 1;

/** Mọi từ chối của lượt kiểm mã (bộ của `kiemTotpCauHinh`) ⇒ hiện trong hộp, cạnh ô mã. */
function laLoiTotpLo(e: unknown): boolean {
  const ma = (e as { data?: { appCode?: string } } | null)?.data?.appCode;
  return laLoiMaTotp(e) || ma === "TOTP_KHONG_KIEM_DUOC" || ma === "SCADA_CONFIG_TOTP_NOT_ENROLLED";
}

/** Luật `STOP_PIN_GO_TRUOC` của máy chủ: đang ghim DỪNG, mức hiệu lực cũ ≤ 1, mức hiệu lực mới > 1 ⇒ tag sẽ rơi khỏi STOP HMI. */
export const roiKhoiStop = (h: Pick<HangKenh, "stopValue" | "mucHieuLuc">, mucHieuLucMoi: number): boolean =>
  h.stopValue !== null && h.stopValue !== undefined && h.mucHieuLuc <= MUC_TOI_DA_STOP_HMI && mucHieuLucMoi > MUC_TOI_DA_STOP_HMI;

type Loi = { kieu: "tag"; tagKey: string; cau: string } | { kieu: "ma"; cau: string };

export function HopKhaiHangLoat({
  adapterId,
  hang,
  onDong,
  onDaKhai,
}: {
  adapterId: number;
  hang: HangKenh[];
  onDong: () => void;
  /** Gọi sau một lô thành công (trước `onDong`) — bảng bỏ chọn. */
  onDaKhai?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const utils = trpc.useUtils();
  const [muc, setMuc] = useState<string>("");
  const [lyDo, setLyDo] = useState("");
  const [maTotp, setMaTotp] = useState("");
  const [loi, setLoi] = useState<Loi | null>(null);

  const khai = trpc.scadaKenh.khaiHangLoat.useMutation({
    onSuccess: (res: { soDoi: number; soGiuNguyen: number }) => {
      setMaTotp("");
      toast.success(t("scada.kenh.hangLoat.daKhai", { soDoi: res.soDoi, soGiuNguyen: res.soGiuNguyen }));
      void utils.scadaKenh.danhSach.invalidate();
      void utils.scadaKenh.cheDo.danhSach.invalidate();
      onDaKhai?.();
      onDong();
    },
    onError: (e: unknown) => {
      setMaTotp(""); // mã một lần: lượt đã gửi không còn dùng lại được, dù lỗi là gì
      if (laLoiTotpLo(e)) {
        setLoi({ kieu: "ma", cau: mapTrpcError(e) });
        return;
      }
      const tagId = (e as { data?: { appParams?: { tagId?: unknown } } } | null)?.data?.appParams?.tagId;
      const h = typeof tagId === "number" ? hang.find((x) => x.tagId === tagId) : undefined;
      if (h) setLoi({ kieu: "tag", tagKey: h.tagKey, cau: mapTrpcError(e) });
      else toastTrpcError(e as never);
    },
  });

  const mucMoi: MucKhai | null | undefined = muc === "" ? undefined : muc === BO_KHAI ? null : (Number(muc) as MucKhai);
  const mucHieuLucMoi = mucMoi === undefined ? undefined : (mucMoi ?? 5);
  const hangGhim = mucHieuLucMoi === undefined ? [] : hang.filter((h) => roiKhoiStop(h, mucHieuLucMoi));
  const quaTran = hang.length > TRAN_HANG_LOAT;
  const dangGui = khai.isPending;
  const duocGui = hang.length > 0 && !quaTran && mucMoi !== undefined && lyDoDuDai(lyDo) && maTotpDu(maTotp) && !dangGui;

  const gui = () => {
    if (!duocGui || mucMoi === undefined) return;
    setLoi(null);
    khai.mutate({
      adapterId,
      items: hang.map((h) => ({ tagId: h.tagId, patch: { actuationLevel: mucMoi } })),
      lyDo: lyDo.trim(),
      totpCode: maTotp,
    });
  };
  const id = (s: string) => `scada-kenh-hang-loat-${s}`;

  return (
    <Dialog open onOpenChange={(o) => !o && !dangGui && onDong()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("scada.kenh.hangLoat.tieuDe", { n: hang.length })}</DialogTitle>
          <DialogDescription>{t("scada.kenh.hangLoat.moTa")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <p className="text-xs font-medium">{t("scada.kenh.hangLoat.danhSach")}</p>
          <p data-testid="hang-loat-danh-sach" className="max-h-24 overflow-y-auto rounded-sm border px-2 py-1 text-xs text-muted-foreground break-words">
            {hang.map((h) => h.tagKey).join(", ")}
          </p>
        </div>
        {quaTran && (
          <KhoiCanhBao testId="hang-loat-qua-tran">{t("scada.kenh.hangLoat.quaTran", { n: hang.length, toiDa: TRAN_HANG_LOAT })}</KhoiCanhBao>
        )}
        <div className="space-y-1">
          <Label htmlFor={id("muc")}>{t("scada.kenh.hangLoat.muc")}</Label>
          <select id={id("muc")} className={LOP_O_CHON} value={muc} onChange={(e) => setMuc(e.target.value)} disabled={dangGui}>
            <option value="">{t("scada.kenh.hangLoat.mucChon")}</option>
            {MUC_KHAI.map((m) => (
              <option key={m} value={String(m)}>
                {dinhDangSo(m, i18n.language)}
              </option>
            ))}
            <option value={BO_KHAI}>{t("scada.kenh.hangLoat.boKhai")}</option>
          </select>
        </div>
        {hangGhim.length > 0 && (
          <KhoiCanhBao testId="hang-loat-ghim-nhac">
            <span className="block">{t("scada.kenh.hangLoat.ghimNhac")}</span>
            <span className="block font-normal">{t("scada.kenh.hangLoat.ghimTag", { tags: hangGhim.map((h) => h.tagKey).join(", ") })}</span>
          </KhoiCanhBao>
        )}
        <TruongLyDo id={id("ly-do")} value={lyDo} onChange={setLyDo} />
        <TruongTotp
          id={id("totp")}
          value={maTotp}
          onChange={(v) => {
            setMaTotp(v);
            if (loi?.kieu === "ma") setLoi(null); // polish (review minor 2): sửa mã ⇒ câu lỗi mã cũ hết hiệu lực
          }}
          disabled={dangGui}
        />
        {loi && (
          <div role="alert">
            <KhoiCanhBao testId={loi.kieu === "ma" ? "hang-loat-loi-ma" : "hang-loat-loi-tag"}>
              {loi.kieu === "ma" ? loi.cau : t("scada.kenh.hangLoat.loiTag", { tagKey: loi.tagKey, loi: loi.cau })}
            </KhoiCanhBao>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDong} disabled={dangGui}>
            {t("scada.kenh.dialog.huy")}
          </Button>
          <Button onClick={gui} disabled={!duocGui}>
            {t("scada.kenh.hangLoat.gui")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
