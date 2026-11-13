/**
 * Vùng URGENT bền (H37 + 22 kind của A2(n)) ở đầu trang SCADA — thẻ theo mockup `man-urgent-ben.html` (chu-du-an-HST duyệt 13/11).
 * Nguồn: `notification.list` (bảng notifications, MỘT hàng mỗi người nhận); đọc = `notification.markAsRead` của CHÍNH người xem.
 * Luật (hợp đồng scada-master + 3 quyết định chu-du-an-HST):
 *  • thẻ KHÔNG tự rời; "Tôi đã đọc" chỉ thu gọn thẻ vào nhóm "Đã đọc" — VẪN nằm trong vùng này; "đã đọc" ≠ "đã xử lý";
 *  • KHÔNG có nút xoá, KHÔNG có "đánh dấu tất cả đã đọc" (server hiện còn lật/xoá cả URGENT — backlog 22);
 *  • đối tượng = run + "Mở run" (server chưa có trường máy/dây chuyền — không đoán ở client);
 *  • chữ nhãn theo kind (23 khoá); kind lạ ⇒ `title` của server, không bao giờ ẩn; `message` của server hiện NGUYÊN VĂN ở phần chi tiết;
 *  • `role="alert"` chỉ cho thẻ chưa đọc; tuổi nằm trong vùng `aria-live="off"` (cập nhật theo giây không gây đọc lại);
 *  • "cũ" chỉ khi KHÔNG làm mới được danh sách (có thể có URGENT mới chưa tới) — không gắn tuổi dữ liệu lên từng thẻ.
 * Màu: viền trái + ký hiệu ■ dùng token cảnh báo; nền TRUNG TÍNH (không tranh độ nổi với DỪNG MÁY); ■/◆ không chỉ dựa vào màu.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { trpc } from "@/lib/trpc";
import { catTheHien, duongToiRun, phanNhomUrgent, tuoiNgan, type HangThongBao, type TheUrgent } from "@/lib/urgentBen";
import { BIEN_MAU_GACH_TIM } from "./chatLuongHienThi";

const CHU_KY_MS = 30_000;

function useBayGio(chuKyMs = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), chuKyMs);
    return () => clearInterval(id);
  }, [chuKyMs]);
  return now;
}

function TheTuoi({ the, now }: { the: TheUrgent; now: number }) {
  const { t } = useTranslation();
  if (the.createdAt == null) return null;
  const x = tuoiNgan(now - the.createdAt);
  const tuoi =
    x.loai === "giay" ? t("urgent.tuoi.giay", { n: x.n })
    : x.loai === "phut" ? t("urgent.tuoi.phut", { m: x.m, s: x.s })
    : x.loai === "gio" ? t("urgent.tuoi.gio", { h: x.h, m: x.m })
    : t("urgent.tuoi.ngay", { d: x.d, h: x.h });
  // aria-live="off": thẻ là role="alert" (assertive) — tuổi đổi mỗi giây KHÔNG được đọc lại.
  return (
    <span aria-live="off" className="font-mono text-xs text-muted-foreground" data-testid="urgent-ghi-nhan">
      {t("urgent.ghiNhan", { tuoi })}
    </span>
  );
}

function NhanThe({ the }: { the: TheUrgent }) {
  const { t } = useTranslation();
  // nhãn theo kind; kind lạ ⇒ title của server (không bao giờ ẩn)
  return <>{the.khoaNhan ? t(the.khoaNhan) : the.title || the.kind}</>;
}

export function VungUrgentBen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const signedIn = !!(user as { id?: number } | null)?.id;
  const poll = usePollingInterval(signedIn ? CHU_KY_MS : false);
  const utils = trpc.useUtils();
  const q = trpc.notification.list.useQuery({ type: "ALERT", limit: 100 }, { ...poll, enabled: signedIn, retry: false });
  const [loiDanhDau, setLoiDanhDau] = React.useState(false);
  const markRead = trpc.notification.markAsRead.useMutation({
    onMutate: () => setLoiDanhDau(false),
    onError: () => setLoiDanhDau(true),
    onSettled: () => {
      void utils.notification.list.invalidate();
      void utils.notification.unreadCount.invalidate();
    },
  });
  const [moHet, setMoHet] = React.useState(false);
  const now = useBayGio();

  const nhom = React.useMemo(() => phanNhomUrgent((q.data ?? []) as HangThongBao[]), [q.data]);
  const { hien, conLai } = catTheHien(nhom.chuaDoc, moHet);
  const cu = q.isError && q.data != null; // ĐÃ có danh sách của lần trước mà lần này lỗi ⇒ giữ thẻ, nói rõ có thể thiếu URGENT mới
  const coThe = nhom.chuaDoc.length + nhom.daDoc.length > 0;
  if (!signedIn || (!coThe && !cu)) return null;
  const nhacGhim = [...nhom.chuaDoc, ...nhom.daDoc].some((x) => x.nhacGhim);
  const gio = (ms: number | null) => (ms == null ? "—" : new Date(ms).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }));

  const nutMoRun = (the: TheUrgent) =>
    the.runId == null ? null : (
      <Link href={duongToiRun(the.runId)} className="inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-sm font-medium">
        {t("urgent.moRun")}
      </Link>
    );

  return (
    <section aria-label={t("urgent.vung.tieuDe")} data-testid="vung-urgent-ben" className="mb-3 flex flex-col gap-2">
      {cu ? (
        <div
          role="status"
          data-testid="urgent-cu"
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold"
          style={{ borderColor: `var(${BIEN_MAU_GACH_TIM})`, color: `var(${BIEN_MAU_GACH_TIM})`, backgroundImage: "repeating-linear-gradient(45deg, transparent 0 6px, color-mix(in oklch, currentColor 14%, transparent) 6px 8px)" }}
        >
          <span aria-hidden="true">◆</span>
          {t("urgent.cu")}
        </div>
      ) : null}

      {hien.map((the) => (
        <article
          key={the.id}
          role="alert"
          data-testid="urgent-the"
          data-doc="chua"
          data-kind={the.kind}
          className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1 rounded-md border border-l-8 bg-card p-3 text-foreground"
          style={{ borderLeftColor: "var(--alarm-critical)" }}
        >
          <span aria-hidden="true" className="text-xl leading-none" style={{ color: "var(--alarm-critical)" }}>■</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold" data-testid="urgent-nhan"><NhanThe the={the} /></h3>
            {the.runId != null ? <p className="font-mono text-xs font-semibold" data-testid="urgent-run">{t("urgent.run", { runId: the.runId })}</p> : null}
            <TheTuoi the={the} now={now} />
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-muted-foreground">{t("urgent.chiTiet")}</summary>
              <p className="mt-1 whitespace-pre-wrap break-words font-mono" data-testid="urgent-message">{the.message || the.title}</p>
            </details>
          </div>
          <div className="flex min-w-36 flex-col items-stretch gap-1.5">
            {nutMoRun(the)}
            <button
              type="button"
              data-testid="urgent-da-doc"
              className="min-h-11 rounded-md border px-3 text-sm font-medium"
              title={t("urgent.ghiNguoiGio")}
              disabled={markRead.isPending}
              onClick={() => markRead.mutate({ id: the.id })}
            >
              {t("urgent.toiDaDoc")}
            </button>
            <small className="text-center text-[11px] text-muted-foreground">{t("urgent.ghiNguoiGio")}</small>
          </div>
        </article>
      ))}

      {conLai > 0 ? (
        <button type="button" data-testid="urgent-nhieu" onClick={() => setMoHet(true)} className="min-h-11 rounded-md border border-l-8 bg-card px-3 text-left text-sm" style={{ borderLeftColor: "var(--alarm-critical)" }}>
          <span aria-hidden="true" style={{ color: "var(--alarm-critical)" }}>■ </span>
          <b>{t("urgent.nhieu", { n: conLai })}</b> · <u>{t("urgent.xemTatCa")}</u>
        </button>
      ) : null}
      {moHet && nhom.chuaDoc.length > 3 ? (
        <button type="button" data-testid="urgent-thu-gon" onClick={() => setMoHet(false)} className="min-h-11 self-start rounded-md border px-3 text-sm">
          {t("urgent.thuGon")}
        </button>
      ) : null}

      {nhom.daDoc.length > 0 ? (
        <details open data-testid="urgent-nhom-da-doc" className="rounded-md border bg-card">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t("urgent.vung.daDoc", { n: nhom.daDoc.length })}</summary>
          <ul className="flex flex-col gap-1 px-3 pb-2">
            {nhom.daDoc.map((the) => (
              <li
                key={the.id}
                data-testid="urgent-the"
                data-doc="da"
                data-kind={the.kind}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 border-l-8 py-1 pl-2"
                style={{ borderLeftColor: "var(--isa-graphic-muted)" }}
              >
                <span aria-hidden="true" className="text-base leading-none text-muted-foreground">■</span>
                <div className="min-w-0 text-sm">
                  <span className="font-semibold" data-testid="urgent-nhan"><NhanThe the={the} /></span>
                  <div className="font-mono text-xs text-muted-foreground">
                    {the.runId != null ? `${t("urgent.run", { runId: the.runId })} · ` : ""}
                    {t("urgent.banDaDoc", { gio: gio(the.readAt) })} · <TheTuoi the={the} now={now} />
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">{t("urgent.chiTiet")}</summary>
                    <p className="mt-1 whitespace-pre-wrap break-words font-mono" data-testid="urgent-message">{the.message || the.title}</p>
                  </details>
                </div>
                {nutMoRun(the)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {loiDanhDau ? <p role="status" className="text-sm font-semibold" style={{ color: "var(--alarm-critical)" }}>{t("urgent.loiDanhDau")}</p> : null}
      {nhacGhim ? <p className="text-xs text-muted-foreground" data-testid="urgent-chu-giai-ghim">{t("urgent.chuGiaiGhim")}</p> : null}
      <p className="sr-only">{t("urgent.vung.moTa")}</p>
    </section>
  );
}
