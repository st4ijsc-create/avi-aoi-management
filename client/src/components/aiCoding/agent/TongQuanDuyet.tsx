/**
 * Đợt 11.3-B (UX-D04) — TỔNG QUAN DUYỆT THAY ĐỔI của một lượt agent: danh sách tệp (đã xem / chưa xem · chờ / đã duyệt / đã bác), tiến độ quyết,
 * kết quả kiểm chứng GẦN NHẤT (chỉ ĐỌC, từ dữ liệu có cấu trúc — không bịa), và phím: J/K (tệp kế/trước), A (duyệt tệp đang chọn), R (bác — mở ô lý do của thẻ).
 *
 * An toàn (bất biến do lưới canh):
 *   • KHÔNG có đường ghi mới: A gọi đúng `agent.duyet(thẻ)` (actionId của thẻ) — cùng cửa duyệt của người; R chỉ MỞ ô lý do của thẻ, việc bác vẫn do thẻ gửi.
 *   • "Đã xem" là trạng thái CLIENT (không gửi, không phải quyết định); A bị KHOÁ cho tới khi dòng đó đã được chọn/xem (J/K hoặc bấm) — không duyệt hàng loạt mà chưa nhìn.
 *   • Phím chỉ nhận khi CHÍNH vùng tổng quan giữ tiêu điểm (không autofocus; không bao giờ khi đang gõ ở ô khác), không nhận `e.repeat`, không nhận khi có Ctrl/Alt/Meta.
 *   • KHÔNG có nút commit/push (11.3-D). Chữ tệp/lệnh vẽ CHỮ THUẦN.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleDot, FileDiff, FilePlus, FileX, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { idHanhDong } from "./trangThaiAgent";
import { chiSoKe, ketQuaKiemChung, tienDoQuyet, timTheDuyet, tongQuanThayDoi, type LoaiThayDoi } from "./tongQuanThayDoi";
import type { HookAgent } from "./useLuotChayAgent";

const ICON: Record<LoaiThayDoi, typeof FileDiff> = { sua: FileDiff, tao: FilePlus, xoa: FileX, "doi-ten": Pencil };

export function neoTheDuyet(id: string): string {
  return `agent-the-${id}`;
}

export function TongQuanDuyet({ agent, onYeuCauBac }: { agent: HookAgent; onYeuCauBac: (id: string) => void }) {
  const { t } = useTranslation();
  const s = agent.trangThai;
  const ds = tongQuanThayDoi(s);
  const kc = ketQuaKiemChung(s);
  const [chon, setChon] = useState(-1);
  const [daXem, setDaXem] = useState<ReadonlySet<string>>(new Set());
  if (ds.length === 0) return null;
  const td = tienDoQuyet(ds);
  const dangChon = chon >= 0 && chon < ds.length ? ds[chon]! : null;

  const xem = (i: number) => {
    const muc = ds[i];
    if (!muc) return;
    setChon(i);
    setDaXem((c) => new Set([...c, muc.id]));
    document.getElementById(neoTheDuyet(muc.id))?.scrollIntoView?.({ block: "nearest" });
  };
  const duyetChon = () => {
    if (!dangChon || dangChon.trangThai !== "cho" || !daXem.has(dangChon.id)) return;
    const the = timTheDuyet(s, dangChon.id);
    if (the && agent.dangGuiDuyet !== idHanhDong(the)) void agent.duyet(the);
  };
  const bacChon = () => {
    if (dangChon && dangChon.trangThai === "cho") onYeuCauBac(dangChon.id);
  };

  return (
    <div
      data-testid="agent-tong-quan-duyet"
      tabIndex={0}
      role="region"
      aria-label={t("repoWs.agent.tongQuan.tieuDe", "Tổng quan thay đổi")}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        const k = e.key.toLowerCase();
        if (k === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          xem(chiSoKe(chon, ds.length, 1));
        } else if (k === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          xem(chiSoKe(chon, ds.length, -1));
        } else if (k === "a") {
          e.preventDefault();
          duyetChon();
        } else if (k === "r") {
          e.preventDefault();
          bacChon();
        }
      }}
      className="space-y-1.5 rounded-md border bg-background/95 p-2 text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t("repoWs.agent.tongQuan.tieuDe", "Tổng quan thay đổi")}</span>
        <span data-testid="tq-tien-do" className="tabular-nums text-muted-foreground">
          {t("repoWs.agent.tongQuan.tienDo", "{{daQuyet}}/{{tong}} đã quyết", { daQuyet: td.daQuyet, tong: td.tong })}
        </span>
        {td.conCho > 0 && <span className="text-amber-700 dark:text-amber-300">{t("repoWs.agent.tongQuan.conCho", "{{n}} đang chờ bạn", { n: td.conCho })}</span>}
      </div>

      {kc && (
        <p data-testid="tq-kiem-chung" data-xanh={kc.xanh ? "1" : "0"} className={cn("flex flex-wrap items-center gap-1", kc.xanh ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300")}>
          <span className="font-medium">{t("repoWs.agent.tongQuan.kiemChung", "Kiểm chứng gần nhất")}:</span>
          <code className="min-w-0 break-all font-mono">{kc.lenh}</code>
          <span>
            {kc.hetGio ? t("repoWs.agent.tongQuan.hetGio", "hết giờ") : kc.xanh ? t("repoWs.agent.tongQuan.xanh", "XANH") : t("repoWs.agent.tongQuan.do", "ĐỎ")}
            {kc.soDo !== null || kc.soXanh !== null ? ` (${kc.soDo ?? "?"} ${t("repoWs.agent.tongQuan.soDo", "đỏ")} · ${kc.soXanh ?? "?"} ${t("repoWs.agent.tongQuan.soXanh", "xanh")})` : ""}
          </span>
          {kc.truocThayDoiCuoi && <span data-testid="tq-kiem-chung-cu" className="text-muted-foreground">{t("repoWs.agent.tongQuan.truocSua", "— chạy TRƯỚC thay đổi đã duyệt gần nhất")}</span>}
        </p>
      )}

      <ul className="space-y-0.5">
        {ds.map((m, i) => {
          const Icon = ICON[m.loai];
          const chonDong = i === chon;
          const xemRoi = daXem.has(m.id);
          return (
            <li key={m.id} data-testid="tq-dong" data-id={m.id} data-trang-thai={m.trangThai} data-da-xem={xemRoi ? "1" : "0"} data-chon={chonDong ? "1" : "0"}>
              <button
                type="button"
                onClick={() => xem(i)}
                className={cn("flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted", chonDong && "bg-muted ring-1 ring-primary")}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono">{m.tep || t("repoWs.agent.tongQuan.khongDuong", "(không rõ đường)")}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{xemRoi ? t("repoWs.agent.tongQuan.daXem", "đã xem") : t("repoWs.agent.tongQuan.chuaXem", "chưa xem")}</span>
                {m.trangThai === "da-duyet" ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label={t("repoWs.agent.daDuyet", "Đã duyệt.")} />
                ) : m.trangThai === "bi-bac" ? (
                  <X className="h-3.5 w-3.5 shrink-0 text-red-600" aria-label={t("repoWs.agent.daBac", "Đã bác.")} />
                ) : m.trangThai === "het-hieu-luc" ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{t("repoWs.agent.tongQuan.hetHan", "hết hiệu lực")}</span>
                ) : (
                  <CircleDot className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label={t("repoWs.agent.tongQuan.cho", "đang chờ")} />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" data-testid="tq-duyet" disabled={!dangChon || dangChon.trangThai !== "cho" || !daXem.has(dangChon.id)} onClick={duyetChon}>
          {t("repoWs.agent.tongQuan.duyetA", "Duyệt (A)")}
        </Button>
        <Button type="button" size="sm" variant="outline" data-testid="tq-bac" disabled={!dangChon || dangChon.trangThai !== "cho"} onClick={bacChon}>
          {t("repoWs.agent.tongQuan.bacR", "Bác (R)")}
        </Button>
        <span data-testid="tq-goi-y-phim" className="text-[11px] text-muted-foreground">
          {t("repoWs.agent.tongQuan.phim", "Khi vùng này được chọn: J/K = tệp kế/trước · A = duyệt · R = bác (A chỉ sau khi đã xem tệp)")}
        </span>
      </div>
    </div>
  );
}
