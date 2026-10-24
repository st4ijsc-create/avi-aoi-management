/**
 * SCADA R0 Task 11 — M10 "Chẩn đoán truyền thông" (`/scada/diag`).
 *
 * Bảng adapter OT (trạng thái kết nối, poll/p95, bộ đếm 1 h, chất lượng tag, lỗi gần nhất) làm mới bằng tRPC polling mỗi 2 s (đạt
 * "M10 hiện mất kết nối ≤ 5 s"; không dùng kênh socket `scada:subscribe`). Bấm hàng ⇒ ngăn tag + mẫu thô. Hành động "Kết nối lại" /
 * "Tạm tắt" mở hộp xác nhận bắt buộc lý do (≥ 5 ký tự, ghi audit ở máy chủ).
 *
 * QUYỀN: nút chỉ hiện với engineer|admin có `machine_control.canEdit` — chỉ là tiện lợi; ranh giới bảo mật là máy chủ (vai + 2FA +
 * giấy phép + quyền + phạm vi mỗi lần gọi). Lỗi máy chủ đi qua `toastTrpcError` (mã AppError đã i18n: FEATURE_DISABLED, NOT_FOUND…).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Activity, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { PageHeader, PageContainer, SectionCard, EmptyState } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BangTruyenThong, coLoi, type HangDiag, type MayDung } from "@/components/scada/BangTruyenThong";
import { NganTagAdapter } from "@/components/scada/NganTagAdapter";

/** Chu kỳ làm mới (ms): ≤ 5 s theo mục tiêu "M10 hiện mất kết nối". */
const CHU_KY_LAM_MOI_MS = 2000;
/** Khớp `lyDoInput` ở máy chủ (`trim().min(5)`). */
const LY_DO_TOI_THIEU = 5;
const LY_DO_TOI_DA = 300;

type HanhDong = { kieu: "ketNoiLai" | "tamTat"; hang: HangDiag };

export default function ScadaDiag() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const role = (user as { role?: string } | null | undefined)?.role;
  // Tiện lợi giao diện, KHÔNG phải ranh giới bảo mật (máy chủ: roleProcedure + 2FA + machine_control.canEdit + phạm vi).
  const canAct = (role === "admin" || role === "engineer") && hasPermission("machine_control", "canEdit");

  const utils = trpc.useUtils();
  const q = trpc.scadaDiag.danhSach.useQuery(undefined, { refetchInterval: CHU_KY_LAM_MOI_MS });
  const rows = (q.data ?? []) as HangDiag[];
  // R1b-1 T2 fix round 1 — máy (chế độ + khả năng dừng) cho hàng đầu nhóm có nút DỪNG MÁY; cùng chu kỳ 5 s với faceplate
  const mayQ = trpc.scadaKenh.cheDo.danhSach.useQuery(undefined, { refetchInterval: 5000 });
  const may = (mayQ.data ?? []) as MayDung[];

  // `now` sống theo nhịp làm mới để "Mất kết nối 3 ph" tăng dần giữa hai lần kéo dữ liệu.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [chiLoi, setChiLoi] = useState(false);
  const [chonId, setChonId] = useState<number | null>(null);
  const [hanhDong, setHanhDong] = useState<HanhDong | null>(null);
  const [lyDo, setLyDo] = useState("");

  const hienThi = chiLoi ? rows.filter(coLoi) : rows;
  const hangChon = rows.find((r) => r.adapterId === chonId) ?? null;

  const lamMoi = () => {
    void utils.scadaDiag.danhSach.invalidate();
    void utils.scadaDiag.tagCuaAdapter.invalidate();
  };
  const dong = () => {
    setHanhDong(null);
    setLyDo("");
  };
  const ketNoiLai = trpc.scadaDiag.ketNoiLai.useMutation({
    onSuccess: (res: { reset?: boolean }) => {
      if (res?.reset === false) toast.warning(t("scada.diag.toast.ketNoiLaiChuaXong"));
      else toast.success(t("scada.diag.toast.ketNoiLai"));
      lamMoi();
      dong();
    },
    onError: (e: unknown) => toastTrpcError(e as never),
  });
  const tamTat = trpc.scadaDiag.tamTat.useMutation({
    onSuccess: () => {
      toast.success(t("scada.diag.toast.tamTat"));
      lamMoi();
      dong();
    },
    onError: (e: unknown) => toastTrpcError(e as never),
  });
  const dangGui = ketNoiLai.isPending || tamTat.isPending;
  const lyDoCat = lyDo.trim();
  const lyDoDu = lyDoCat.length >= LY_DO_TOI_THIEU;

  const gui = () => {
    if (!hanhDong || !lyDoDu || dangGui) return;
    const vars = { adapterId: hanhDong.hang.adapterId, lyDo: lyDoCat };
    if (hanhDong.kieu === "ketNoiLai") ketNoiLai.mutate(vars);
    else tamTat.mutate(vars);
  };

  return (
    <DashboardLayout title={t("scada.diag.title")} navItems={navItems} currentPath="/scada/diag">
      <PageContainer fluid>
        <PageHeader
          icon={<Activity className="h-6 w-6" />}
          title={t("scada.diag.title")}
          description={t("scada.diag.subtitle")}
          actions={
            <Button variant="outline" size="sm" onClick={() => q.refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" /> {t("common.refresh")}
            </Button>
          }
        />
        <SectionCard
          title={t("scada.diag.danhSach", { count: hienThi.length })}
          contentClassName="overflow-x-auto"
          action={
            <div className="flex items-center gap-2">
              <Switch id="scada-diag-chi-loi" checked={chiLoi} onCheckedChange={setChiLoi} aria-label={t("scada.diag.loc.chiLoi")} />
              <Label htmlFor="scada-diag-chi-loi">{t("scada.diag.loc.chiLoi")}</Label>
            </div>
          }
        >
          {q.isLoading ? (
            <div role="status" aria-label={t("scada.diag.dangTai")} className="space-y-2" data-testid="scada-diag-dang-tai">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            // fix round 2 — nút DỪNG MÁY (hàng đầu theo máy, từ `scadaKenh.cheDo.danhSach`) KHÔNG phụ thuộc bộ lọc "chỉ lỗi" hay việc
            // danh sách adapter tải được: lỗi tải adapter ⇒ biểu ngữ "dùng E-STOP cứng" + vẫn vẽ nút theo máy; lỗi tải máy ⇒ biểu ngữ.
            <div className="space-y-2">
              {q.isError && (
                <>
                  <EmptyState variant="error" title={t("scada.diag.loiTai")} compact />
                  <p data-testid="dung-may-loi-tai-diag" role="alert" className="text-sm font-semibold" style={{ color: "var(--packml-abort)" }}>
                    {t("scada.dungMay.loiTaiDiag")}
                  </p>
                </>
              )}
              {mayQ.isError && (
                <p data-testid="dung-may-loi-tai-may" role="alert" className="text-sm font-semibold" style={{ color: "var(--packml-abort)" }}>
                  {t("scada.dungMay.loiTaiMay")}
                </p>
              )}
              {!q.isError && hienThi.length === 0 && (
                <EmptyState variant="no-data" title={chiLoi ? t("scada.diag.khongCoLoi") : t("scada.diag.trong")} compact />
              )}
              {((!q.isError && hienThi.length > 0) || may.length > 0) && (
                <BangTruyenThong
                  rows={q.isError ? [] : hienThi}
                  may={may}
                  now={now}
                  canAct={canAct}
                  onChon={(h) => setChonId(h.adapterId)}
                  onKetNoiLai={(h) => setHanhDong({ kieu: "ketNoiLai", hang: h })}
                  onTamTat={(h) => setHanhDong({ kieu: "tamTat", hang: h })}
                />
              )}
            </div>
          )}
        </SectionCard>

        <NganTagAdapter hang={hangChon} now={now} canAct={canAct} onDong={() => setChonId(null)} />

        <Dialog open={!!hanhDong} onOpenChange={(o) => !o && !dangGui && dong()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {hanhDong
                  ? t(hanhDong.kieu === "ketNoiLai" ? "scada.diag.dialog.ketNoiLaiTieuDe" : "scada.diag.dialog.tamTatTieuDe", { code: hanhDong.hang.code })
                  : ""}
              </DialogTitle>
              <DialogDescription>
                {hanhDong ? t(hanhDong.kieu === "ketNoiLai" ? "scada.diag.dialog.ketNoiLaiMoTa" : "scada.diag.dialog.tamTatMoTa") : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="scada-diag-ly-do">{t("scada.diag.dialog.lyDo")}</Label>
              <Textarea
                id="scada-diag-ly-do"
                rows={3}
                maxLength={LY_DO_TOI_DA}
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
                autoFocus
              />
              {lyDoCat.length > 0 && !lyDoDu && (
                <p className="text-xs text-destructive">{t("scada.diag.dialog.lyDoNgan", { min: LY_DO_TOI_THIEU })}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={dong} disabled={dangGui}>
                {t("scada.diag.dialog.huy")}
              </Button>
              <Button onClick={gui} disabled={!lyDoDu || dangGui}>
                {t("scada.diag.dialog.gui")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageContainer>
    </DashboardLayout>
  );
}
