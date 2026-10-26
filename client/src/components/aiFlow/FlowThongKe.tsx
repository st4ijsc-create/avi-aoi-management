/**
 * Tab "Thống kê" của một luồng (lô B7-D): tỉ lệ thành công, p50/p90 thời gian lượt xong, theo node, token + lời gọi theo model, ước lượng đổi khe. Dữ liệu từ `flow.thongKe` (SQL trực tiếp,
 * không bảng mới). Con số "đổi khe" là ƯỚC LƯỢNG (model đổi giữa hai lời gọi liên tiếp trong một lượt) — giao diện nói rõ.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { O_CHON } from "./FormKit";

export const CUA_SO_NGAY = [1, 7, 30, 90] as const;
export const dinhDangGiay = (v: number | null): string => (v === null ? "—" : v >= 100 ? `${Math.round(v)} s` : `${Math.round(v * 10) / 10} s`);
export const dinhDangPhanTram = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`);

export default function FlowThongKe({ flowId }: { flowId: string }) {
  const { t } = useTranslation();
  const [ngay, setNgay] = useState<number>(7);
  const tk = trpc.flow.thongKe.useQuery({ flowId, ngay }, { refetchInterval: 30_000 });
  return (
    <div className="space-y-3 text-sm" data-testid="flow-thong-ke">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium">{t("flowStudio.thongKe.cuaSo")}</label>
        <select data-testid="tk-ngay" className={`${O_CHON} w-28`} value={ngay} onChange={(e) => setNgay(Number(e.target.value))}>
          {CUA_SO_NGAY.map((n) => <option key={n} value={n}>{t("flowStudio.thongKe.ngay", { n })}</option>)}
        </select>
        {tk.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>
      {tk.data && (
        <>
          <div className="grid grid-cols-2 gap-2" data-testid="tk-tong-quan">
            <div className="rounded border p-2">
              <div className="text-[11px] text-muted-foreground">{t("flowStudio.thongKe.tiLe")}</div>
              <div className="text-lg font-semibold" data-testid="tk-ti-le">{dinhDangPhanTram(tk.data.luot.tiLeThanhCong)}</div>
              <div className="text-[11px]">{t("flowStudio.thongKe.chiTietLuot", tk.data.luot)}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-[11px] text-muted-foreground">{t("flowStudio.thongKe.thoiGian")}</div>
              <div className="text-lg font-semibold" data-testid="tk-p50">p50 {dinhDangGiay(tk.data.thoiGianLuotXongGiay.p50)}</div>
              <div className="text-[11px]">p90 {dinhDangGiay(tk.data.thoiGianLuotXongGiay.p90)} · {t("flowStudio.thongKe.soLuotXong", { n: tk.data.thoiGianLuotXongGiay.soLuot })}</div>
            </div>
          </div>
          <section>
            <h4 className="text-xs font-medium mb-1">{t("flowStudio.thongKe.theoNut")}</h4>
            {tk.data.theoNut.length === 0 ? <p className="text-[11px] text-muted-foreground">{t("flowStudio.thongKe.chuaCoDuLieu")}</p> : (
              <table className="w-full text-[11px]" data-testid="tk-theo-nut">
                <thead><tr className="text-left text-muted-foreground"><th>{t("flowStudio.thongKe.nut")}</th><th>{t("flowStudio.thongKe.buoc")}</th><th>{t("flowStudio.thongKe.loi")}</th><th>p50</th><th>p90</th></tr></thead>
                <tbody>{tk.data.theoNut.map((n) => <tr key={n.nodeId}><td className="font-mono">{n.nodeId}</td><td>{n.soBuoc}</td><td>{n.soLoi}</td><td>{dinhDangGiay(n.p50Giay)}</td><td>{dinhDangGiay(n.p90Giay)}</td></tr>)}</tbody>
              </table>
            )}
          </section>
          <section>
            <h4 className="text-xs font-medium mb-1">{t("flowStudio.thongKe.theoModel")}</h4>
            {tk.data.theoModel.length === 0 ? <p className="text-[11px] text-muted-foreground">{t("flowStudio.thongKe.chuaCoDuLieu")}</p> : (
              <table className="w-full text-[11px]" data-testid="tk-theo-model">
                <thead><tr className="text-left text-muted-foreground"><th>{t("flowStudio.thongKe.model")}</th><th>{t("flowStudio.thongKe.loiGoi")}</th><th>{t("flowStudio.thongKe.tokenVao")}</th><th>{t("flowStudio.thongKe.tokenRa")}</th></tr></thead>
                <tbody>{tk.data.theoModel.map((m) => <tr key={m.model}><td className="font-mono break-all">{m.model}</td><td>{m.soLoiGoi}</td><td>{m.tokenVao}</td><td>{m.tokenRa}{m.khongBaoToken > 0 ? ` (${t("flowStudio.thongKe.khongBaoToken", { n: m.khongBaoToken })})` : ""}</td></tr>)}</tbody>
              </table>
            )}
          </section>
          <p className="text-[11px] text-muted-foreground" data-testid="tk-doi-khe">
            {t("flowStudio.thongKe.doiKhe", { uoc: tk.data.doiKhe.uocLuong, ban: tk.data.doiKhe.luotKheBan })}
          </p>
        </>
      )}
    </div>
  );
}
