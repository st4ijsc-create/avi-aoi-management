/**
 * ★★★ Đợt 3c (2026-10-17) — KHUNG CHỨA của bảng "Chạy & Xem trước": giữ lời gọi tRPC, `BangChayUngDung` thuần hiển thị.
 *
 *   • `aiChayUngDung.trangThai` poll 2 s khi tiến trình sống (máy chủ còn dùng nhịp này để đo "đã nghe cổng chưa").
 *     ⚠ Poll KHÔNG tính là hoạt động (không giữ ứng dụng khỏi tự dừng nhàn rỗi) — chỉ lượt xem trước qua proxy mới tính.
 *   • "Cài phụ thuộc" ⇒ `aiChayUngDung.deXuatLenh` ⇒ `pendingAction` ⇒ `onDeXuat` ⇒ TRANG nạp vào ĐÚNG thẻ duyệt HITL
 *     hiện có (`setPending`). Lệnh chạy khi và chỉ khi người bấm Xác nhận.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { BangChayUngDung, type DuLieuBangChay } from "./BangChayUngDung";

interface Props {
  projectId: string;
  lang: "vi" | "en" | "zh";
  /** Một `pendingAction` của `run_command` vừa được máy chủ dựng — trang đưa vào thẻ duyệt. */
  onDeXuat: (pendingAction: unknown, lenh: string) => void;
}

export function KhungChayUngDung({ projectId, lang, onDeXuat }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const ttQ = trpc.aiChayUngDung.trangThai.useQuery(
    { projectId },
    {
      refetchInterval: (q) => {
        const d = q.state.data as { ok?: boolean; ungDung?: { laChu?: boolean; trangThai?: string } | null } | undefined;
        const tt = d?.ok && d.ungDung && d.ungDung.laChu ? d.ungDung.trangThai : null;
        return tt === "dang-khoi-dong" || tt === "dang-chay" || tt === "dang-dung" ? 2000 : false;
      },
    },
  );
  const duLieu = ttQ.data && ttQ.data.ok ? (ttQ.data as unknown as DuLieuBangChay) : null;
  const laChu = !!duLieu?.ungDung && duLieu.ungDung.laChu;
  const nkQ = trpc.aiChayUngDung.nhatKy.useQuery({ projectId }, { enabled: laChu, refetchInterval: laChu ? 2000 : false });
  const chayM = trpc.aiChayUngDung.chay.useMutation();
  const dungM = trpc.aiChayUngDung.dung.useMutation();
  const deXuatM = trpc.aiChayUngDung.deXuatLenh.useMutation();
  const dangBan = chayM.isPending || dungM.isPending || deXuatM.isPending;

  const lamMoi = () => {
    void utils.aiChayUngDung.trangThai.invalidate({ projectId });
    void utils.aiChayUngDung.nhatKy.invalidate({ projectId });
  };

  const onChay = async () => {
    try {
      const r = await chayM.mutateAsync({ projectId });
      if (!r.ok) toast.error(t("repoWs.chayUD.khongChayDuoc", { ma: r.ma, chiTiet: (r as { chiTiet?: string }).chiTiet ?? "" }));
    } catch (e) {
      toast.error(mapTrpcError(e));
    }
    lamMoi();
  };

  const onDung = async () => {
    try {
      await dungM.mutateAsync({ projectId });
    } catch (e) {
      toast.error(mapTrpcError(e));
    }
    lamMoi();
  };

  const onCai = async (lenh: string) => {
    try {
      const r = await deXuatM.mutateAsync({ projectId, command: lenh, lang });
      if (!r.ok || !r.pendingAction) {
        toast.error(r.message ?? t("repoWs.chayUD.loiDeXuat", { ma: r.note ?? "?" }));
        return;
      }
      onDeXuat(r.pendingAction, lenh);
    } catch (e) {
      toast.error(mapTrpcError(e));
    }
  };

  return (
    <BangChayUngDung
      projectId={projectId}
      duLieu={duLieu}
      nhatKy={nkQ.data && nkQ.data.ok ? { dong: nkQ.data.dong, catDau: nkQ.data.catDau } : null}
      dangBan={dangBan}
      onCai={(l) => void onCai(l)}
      onChay={() => void onChay()}
      onDung={() => void onDung()}
    />
  );
}
