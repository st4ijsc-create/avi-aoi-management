/**
 * SCADA R1a Task 13 — M12 "Kênh & giới hạn" (`/scada/config/channels`).
 *
 * Hai khối: (1) KÊNH CHẾ ĐỘ theo máy (`KenhCheDoMay`): tag chế độ, giá trị REMOTE, chế độ hiện tại kèm lý do, cảnh báo nguồn;
 * (2) BẢNG KÊNH của MỘT adapter (`BangKenh`): loại kênh, dải, bước, mức tác động, tên hiển thị, cảnh báo kênh dừng chưa khai mức.
 * Danh sách adapter để chọn lấy từ `scadaDiag.danhSach` (đã lọc phạm vi ở máy chủ) — không thêm thủ tục.
 *
 * R1a Task 14 — nút "Faceplate" trên kênh ghi được mở M4 (`Faceplate`) cho adapter đang chọn (máy + mã edge lấy từ `scadaDiag.danhSach`).
 *
 * QUYỀN: nút sửa chỉ hiện với engineer|admin có `machine_control.canEdit` (cùng cổng `canAct` của ScadaDiag) — chỉ là tiện lợi; ranh giới
 * bảo mật là máy chủ (vai + 2FA + giấy phép + quyền + phạm vi mỗi lần gọi). Lỗi máy chủ đi qua `toastTrpcError` (mã AppError đã i18n).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { PageHeader, PageContainer, SectionCard, EmptyState } from "@/components/patterns";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BangKenh } from "@/components/scada/BangKenh";
import { KenhCheDoMay, type AdapterChon, type HangCheDo } from "@/components/scada/KenhCheDoMay";
import { LOP_O_CHON } from "@/components/scada/TruongLyDo";
import { Faceplate } from "@/components/scada/Faceplate";
import type { HangKenh } from "@/components/scada/BangKenh";

/** Chế độ máy đổi theo mẫu thật (nhấp nháy REMOTE/LOCAL) ⇒ làm mới định kỳ; bảng kênh chỉ làm mới khi sửa. */
const CHU_KY_CHE_DO_MS = 5000;

type HangAdapterDiag = {
  adapterId: number;
  code: string;
  ten: string;
  machineId: number | null;
  soHuu: { loai: string; edgeCode?: string | null; edgeNodeId?: number };
};

function KhungCho({ nhan }: { nhan: string }) {
  return (
    <div role="status" aria-label={nhan} className="space-y-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export default function ScadaKenh() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const role = (user as { role?: string } | null | undefined)?.role;
  // Tiện lợi giao diện, KHÔNG phải ranh giới bảo mật (máy chủ: roleProcedure + 2FA + machine_control.canEdit + phạm vi).
  const canAct = (role === "admin" || role === "engineer") && hasPermission("machine_control", "canEdit");

  const adapterQ = trpc.scadaDiag.danhSach.useQuery();
  const cheDoQ = trpc.scadaKenh.cheDo.danhSach.useQuery(undefined, { refetchInterval: CHU_KY_CHE_DO_MS });
  const adapters: AdapterChon[] = ((adapterQ.data ?? []) as HangAdapterDiag[]).map((a) => ({
    adapterId: a.adapterId,
    code: a.code,
    ten: a.ten,
    machineId: a.machineId,
    edge: a.soHuu.loai === "edge",
  }));

  const [chonId, setChonId] = useState<number | null>(null);
  const adapter = adapters.find((a) => a.adapterId === chonId) ?? adapters[0] ?? null;
  const kenhQ = trpc.scadaKenh.danhSach.useQuery({ adapterId: adapter?.adapterId ?? 0 }, { enabled: adapter !== null });
  const kenhs = (kenhQ.data ?? []) as HangKenh[];
  const cheDos = (cheDoQ.data ?? []) as HangCheDo[];
  const [fpTag, setFpTag] = useState<{ adapterId: number; tagKey: string } | null>(null);
  const diagChon = ((adapterQ.data ?? []) as HangAdapterDiag[]).find((a) => a.adapterId === adapter?.adapterId);
  const edgeCode = diagChon?.soHuu.loai === "edge" ? (diagChon.soHuu.edgeCode ?? String(diagChon.soHuu.edgeNodeId ?? "")) : null;

  return (
    <DashboardLayout title={t("scada.kenh.title")} navItems={navItems} currentPath="/scada/config/channels">
      <PageContainer fluid>
        <PageHeader icon={<SlidersHorizontal className="h-6 w-6" />} title={t("scada.kenh.title")} description={t("scada.kenh.subtitle")} />

        <SectionCard title={t("scada.kenh.cheDo.tieuDe")} description={t("scada.kenh.cheDo.moTa")} contentClassName="overflow-x-auto">
          {cheDoQ.isLoading ? (
            <KhungCho nhan={t("scada.kenh.dangTai")} />
          ) : cheDoQ.isError ? (
            <EmptyState variant="error" title={t("scada.kenh.loiTai")} compact />
          ) : cheDos.length === 0 ? (
            <EmptyState variant="no-data" title={t("scada.kenh.cheDo.trong")} compact />
          ) : (
            <KenhCheDoMay rows={cheDos} adapters={adapters} canAct={canAct} />
          )}
        </SectionCard>

        <SectionCard
          title={adapter ? t("scada.kenh.tieuDeBang", { code: adapter.code, count: kenhs.length }) : t("scada.kenh.title")}
          contentClassName="overflow-x-auto"
          action={
            adapters.length > 0 ? (
              <div className="flex items-center gap-2">
                <Label htmlFor="scada-kenh-adapter">{t("scada.kenh.adapter")}</Label>
                <select
                  id="scada-kenh-adapter"
                  className={`${LOP_O_CHON} w-56`}
                  value={adapter ? String(adapter.adapterId) : ""}
                  onChange={(e) => setChonId(Number(e.target.value))}
                >
                  {adapters.map((a) => (
                    <option key={a.adapterId} value={String(a.adapterId)}>
                      {a.code} · {a.ten}
                    </option>
                  ))}
                </select>
              </div>
            ) : undefined
          }
        >
          {adapterQ.isLoading ? (
            <KhungCho nhan={t("scada.kenh.dangTai")} />
          ) : adapterQ.isError ? (
            <EmptyState variant="error" title={t("scada.kenh.loiTai")} compact />
          ) : !adapter ? (
            <EmptyState variant="no-data" title={t("scada.kenh.khongCoAdapter")} compact />
          ) : kenhQ.isLoading ? (
            <KhungCho nhan={t("scada.kenh.dangTai")} />
          ) : kenhQ.isError ? (
            <EmptyState variant="error" title={t("scada.kenh.loiTai")} compact />
          ) : kenhs.length === 0 ? (
            <EmptyState variant="no-data" title={t("scada.kenh.trong")} compact />
          ) : (
            <BangKenh rows={kenhs} canAct={canAct} onFaceplate={(h) => adapter && setFpTag({ adapterId: adapter.adapterId, tagKey: h.tagKey })} />
          )}
        </SectionCard>
        {fpTag && adapter && fpTag.adapterId === adapter.adapterId && (
          <Faceplate
            adapterId={fpTag.adapterId}
            tagKey={fpTag.tagKey}
            machineId={adapter.machineId}
            edgeCode={edgeCode}
            onDong={() => setFpTag(null)}
          />
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
