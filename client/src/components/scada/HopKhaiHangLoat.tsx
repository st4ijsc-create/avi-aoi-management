/**
 * SCADA R1b-2a Task 7 — hộp "Khai mức hàng loạt" của M12: MỘT lô (MỘT adapter, ≤ `TRAN_HANG_LOAT` kênh) gửi `scadaKenh.khaiHangLoat`.
 *
 *   • Chọn mức 1 / 3 / 4 / 5 hoặc "Bỏ khai" (⇒ NULL ⇒ máy chủ coi là 5, fail-closed); lý do ≥ 5 ký tự (`TruongLyDo`).
 *   • `items = hang.map(h => ({ tagId, patch: { actuationLevel } }))` — mọi hàng được chọn, cùng một mức. Máy chủ kiểm từng kênh bằng cùng
 *     hàm với capNhat, tất-cả-hoặc-không; kênh đã đúng mức được giữ nguyên (`soGiuNguyen`).
 *   • Mã TOTP CHỈ hỏi khi máy chủ đòi: lượt đầu gửi KHÔNG mã; lô có thay đổi ⇒ máy chủ trả `SCADA_CONFIG_TOTP_REQUIRED` (sau mọi kiểm hợp lệ,
 *     không tiêu mã) ⇒ hộp mã của `useHopMaTotpTroLai` mở, người dùng nhập rồi gửi lại ĐÚNG lô đó kèm `totpCode`. Lô không đổi gì ⇒ không hỏi
 *     mã. Mã sai / đã dùng / tạm khoá ⇒ xoá ô mã, giữ hộp. Mã không ở lại trong state sau bất kỳ kết cục nào (hook: `daXong` / `xuLyLoi`).
 *   • Census `client/src/lib/vramPanelStepUp.unit.test.ts` `KHOA_TOTP_TRONG_HANDLER`: thủ tục tự kiểm mã ở handler ⇒ điểm gọi DUY NHẤT
 *     `khai.mutate({ …, totpCode })` (không qua `stepUp.guard`); lượt đầu mang `totpCode: undefined`.
 *   • Có hàng đang ghim DỪNG mà chọn mức > 1 ⇒ dòng nhắc "gỡ ghim trước" TRƯỚC khi gửi (không chặn — máy chủ là trọng tài:
 *     `STOP_PIN_GO_TRUOC`).
 *   • Lỗi mang `appParams.tagId` ⇒ hộp nêu `tagKey` của hàng đó + câu i18n của mã lỗi (`mapTrpcError`), hộp giữ mở. Lỗi khác ⇒ toast.
 *   • Thành công ⇒ toast `daKhai {soDoi, soGiuNguyen}`, làm mới `scadaKenh.danhSach` (+ `cheDo.danhSach`: khả năng dừng phụ thuộc mức),
 *     `onDaKhai` (bỏ chọn), đóng.
 * Màu chỉ lấy token ISA có sẵn (qua `KhoiCanhBao`).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KhoiCanhBao, type HangKenh } from "./BangKenh";
import { useHopMaTotpTroLai } from "./HopMaTotpTroLai";
import { dinhDangSo } from "./kenhHienThi";
import { LOP_O_CHON, TruongLyDo, lyDoDuDai } from "./TruongLyDo";

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

/** Biến của một lô KHÔNG kèm mã (hộp mã của hook thêm `totpCode` khi gửi lại). */
type BienKhai = Omit<inferRouterInputs<AppRouter>["scadaKenh"]["khaiHangLoat"], "totpCode">;

const coGhimDung = (h: HangKenh): boolean => h.stopValue !== null && h.stopValue !== undefined;

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
  const [loiTag, setLoiTag] = useState<{ tagKey: string; cau: string } | null>(null);

  const khai = trpc.scadaKenh.khaiHangLoat.useMutation({
    onSuccess: (res: { soDoi: number; soGiuNguyen: number }) => {
      totp.daXong();
      toast.success(t("scada.kenh.hangLoat.daKhai", { soDoi: res.soDoi, soGiuNguyen: res.soGiuNguyen }));
      void utils.scadaKenh.danhSach.invalidate();
      void utils.scadaKenh.cheDo.danhSach.invalidate();
      onDaKhai?.();
      onDong();
    },
    onError: (e, bien) => {
      if (totp.xuLyLoi(e, bien)) return;
      const tagId = (e as { data?: { appParams?: { tagId?: unknown } } } | null)?.data?.appParams?.tagId;
      const h = typeof tagId === "number" ? hang.find((x) => x.tagId === tagId) : undefined;
      if (h) setLoiTag({ tagKey: h.tagKey, cau: mapTrpcError(e) });
      else toastTrpcError(e as never);
    },
  });
  /** Điểm gọi DUY NHẤT (xem đầu tệp): lượt đầu không mã, lượt gửi lại của hộp mã mang `totpCode`. */
  const guiKhai = (bien: BienKhai & { totpCode?: string }) =>
    khai.mutate({ adapterId: bien.adapterId, items: bien.items, lyDo: bien.lyDo, totpCode: bien.totpCode });
  const totp = useHopMaTotpTroLai<BienKhai>((bien) => guiKhai(bien), khai.isPending, {
    tieuDe: "scada.kenh.hangLoat.maTieuDe",
    than: "scada.kenh.hangLoat.maThan",
  });

  const mucMoi: MucKhai | null | undefined = muc === "" ? undefined : muc === BO_KHAI ? null : (Number(muc) as MucKhai);
  const mucHieuLucMoi = mucMoi === undefined ? undefined : (mucMoi ?? 5);
  const hangGhim = mucHieuLucMoi !== undefined && mucHieuLucMoi > MUC_TOI_DA_STOP_HMI ? hang.filter(coGhimDung) : [];
  const quaTran = hang.length > TRAN_HANG_LOAT;
  const dangGui = khai.isPending;
  const duocGui = hang.length > 0 && !quaTran && mucMoi !== undefined && lyDoDuDai(lyDo) && !dangGui;

  const gui = () => {
    if (!duocGui || mucMoi === undefined) return;
    setLoiTag(null);
    guiKhai({ adapterId, items: hang.map((h) => ({ tagId: h.tagId, patch: { actuationLevel: mucMoi } })), lyDo: lyDo.trim() });
  };
  const id = (s: string) => `scada-kenh-hang-loat-${s}`;

  return (
    <>
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
          {loiTag && (
            <div role="alert">
              <KhoiCanhBao testId="hang-loat-loi-tag">{t("scada.kenh.hangLoat.loiTag", { tagKey: loiTag.tagKey, loi: loiTag.cau })}</KhoiCanhBao>
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
      {totp.hop}
    </>
  );
}
