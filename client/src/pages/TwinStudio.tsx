/**
 * `/twin-studio` — Màn THIẾT KẾ (dựng nhà xưởng, đặt máy) của Nhà máy 3D Digital Twin.
 *
 * ★ QUYỀN (§6.4 + bài học Khối D): route này gate `settings_factory`, và mục nav
 * tương ứng trong `navigation.tsx` khai ĐÚNG chuỗi đó. Lớp lỗi phải tránh là "một
 * lối vào rồi TỪ CHỐI" — mục nav khai quyền X trong khi route đích đòi quyền Y, nên
 * người dùng THẤY dòng menu rồi bị chặn khi bấm vào.
 *   `RouteGuard navHref="/twin-studio"` là cách repo cưỡng chế điều đó: guard không
 * tự khai quyền mà TRA từ chính `navGroups`, nên hai bên không thể lệch nhau.
 *   Router ghi (`twinCanh`) mở RỘNG HƠN — `settings_factory` HOẶC `machine_control`
 * theo §6.4. Rộng hơn ở đường GHI trong khi đường VÀO hẹp hơn là an toàn theo hướng
 * đúng: không ai thấy menu rồi bị chặn. Chiều ngược lại mới là lỗi Khối D.
 *
 * ⚠ Phép đo quyền cho màn này PHẢI thực hiện bằng tài khoản KHÔNG phải admin — admin
 * bypass `requirePermission`, nên đo bằng admin chứng minh số 0 (§6.4).
 *
 * ── ĐỢT 3 lắp phần DỰNG NHÀ XƯỞNG (§10A) ─────────────────────────────────────
 *   Con đường B (§10A.2) — `DungNhaXuong`: form 3 bước, nhập mét, lưu milimét.
 *   Con đường A (§10A.1) — `NhapBanVe`: nhập CAD, hộp thoại hiệu chỉnh BẮT BUỘC.
 * Ba vùng của §7.1, gizmo, cây phân cấp, bộ 12 công cụ, thư viện asset thuộc ĐỢT 4.
 *
 * ⚠ KHÔNG dựng `<Canvas>` ở màn này trong Đợt 3 (RB-4: một context WebGL sống tại
 *   một thời điểm; chỗ đó thuộc về khung cảnh chính của Đợt 4). Xem trước của Đợt 3
 *   là SVG đúng tỉ lệ — đủ để thấy tầng chồng nhau và đối chiếu hình người 1,7 m.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, FileUp } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import DungNhaXuong from "@/components/twin3d/thiet-ke/DungNhaXuong";
import NhapBanVe from "@/components/twin3d/thiet-ke/NhapBanVe";

export default function TwinStudio() {
  const { t } = useTranslation();
  const factoriesQ = trpc.factory.list.useQuery();
  const factories = useMemo(
    () => (factoriesQ.data ?? []) as Array<{ id: number; name?: string; code?: string }>,
    [factoriesQ.data],
  );
  const [factoryId, setFactoryId] = useState<number | null>(null);

  useEffect(() => {
    if (factoryId === null && factories.length > 0) setFactoryId(factories[0].id);
  }, [factories, factoryId]);

  const toaNhaQ = trpc.twinCanh.danhSachToaNha.useQuery(
    { factoryId: factoryId ?? 0 },
    { enabled: factoryId !== null },
  );

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="man-twin-studio">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("twin3d.studio.tieuDe")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("twin3d.studio.moTa")}</p>
        </div>
        <div className="grid min-w-52 gap-1.5">
          <Label className="text-xs">{t("common.factory")}</Label>
          <Select
            value={factoryId === null ? "" : String(factoryId)}
            onValueChange={(v) => setFactoryId(Number(v))}
          >
            <SelectTrigger data-testid="chon-nha-may">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {factories.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.name ?? f.code ?? `#${f.id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {/* Đếm RỖNG khác đếm bằng 0 (NT-3.5): chưa tải xong hiện "—", không hiện 0. */}
      <p className="text-xs text-muted-foreground" data-testid="dem-toa-nha">
        {t("twin3d.toaNha.tieuDe")}:{" "}
        {toaNhaQ.isLoading || factoryId === null ? "—" : (toaNhaQ.data?.length ?? 0)}
      </p>

      <Tabs defaultValue="dien-kich-thuoc">
        <TabsList>
          <TabsTrigger value="dien-kich-thuoc" data-testid="tab-con-duong-b">
            <Building2 className="mr-1.5 h-4 w-4" />
            {t("twin3d.toaNha.themMoi")}
          </TabsTrigger>
          <TabsTrigger value="nhap-ban-ve" data-testid="tab-con-duong-a">
            <FileUp className="mr-1.5 h-4 w-4" />
            {t("twin3d.banVe.chonTep")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dien-kich-thuoc" className="mt-4">
          {factoryId !== null && (
            <DungNhaXuong factoryId={factoryId} onXongTao={() => void toaNhaQ.refetch()} />
          )}
        </TabsContent>

        <TabsContent value="nhap-ban-ve" className="mt-4">
          {/* Đợt 4 nối kết quả hiệu chỉnh vào `twin_vat_the` (vỏ nhà) hoặc vào
              chính form con đường B (tách tầng — §10A.3 `cumTangSangDongNhap`). */}
          <NhapBanVe />
        </TabsContent>
      </Tabs>
    </div>
  );
}
