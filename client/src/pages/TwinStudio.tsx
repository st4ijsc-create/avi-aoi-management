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
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, FileUp, LayoutGrid } from "lucide-react";
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
import { EmptyState } from "@/components/EmptyState";
import { isScopeEmpty } from "@/lib/scopeEmpty";
import DungNhaXuong from "@/components/twin3d/thiet-ke/DungNhaXuong";
import NhapBanVe from "@/components/twin3d/thiet-ke/NhapBanVe";
import XuongThietKe from "@/components/twin3d/thiet-ke/XuongThietKe";
import { chieuCaoTruDinh, useTruDinhKhung } from "@/components/twin3d/van-hanh/useTruDinhKhung";

export default function TwinStudio() {
  const { t } = useTranslation();
  /*
   * ★★★ ĐỢT 35 (Pareto #4) — CHIỀU CAO ĐO TỪ VỊ TRÍ THẬT, KHÔNG `h-[calc(100vh-5rem)]`.
   *   QA Đợt 32 đo: đỉnh khung này là **133 px** (không phải 80) ⇒ đáy 953 > 900 và 773 > 720,
   *   thư viện asset/bảng thuộc tính bị cắt dưới mép. Cùng bài học Đợt 30 (Line) — xem docblock
   *   `useTruDinhKhung`. Biến RIÊNG `--twin-studio-top`.
   */
  const khungRef = useRef<HTMLDivElement | null>(null);
  useTruDinhKhung(khungRef, "--twin-studio-top");
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

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ THƯỜNG-2(b) — "CHƯA CÓ NHÀ MÁY" ≠ "CHƯA ĐƯỢC GÁN NHÀ MÁY"
   * ════════════════════════════════════════════════════════════════════════
   * Đo được 2026-09-06: tài khoản không-admin KHÔNG có hàng trong
   * `user_factory_assignments` mở màn này thì `factory.list` trả `[]` ⇒
   * `factoryId` ở nguyên `null` ⇒ nhánh `factoryId === null` render **`null`**,
   * tức MÀN HÌNH TRẮNG không một chữ giải thích. Người dùng không phân biệt được
   * "hệ thống chưa có nhà máy nào" với "tôi chưa được gán".
   *
   * ★ `canhThietKe` là truy vấn CÙNG MÀN có mang nhãn phạm vi (server đã đính ba
   *   ô qua `resolveTenantFactoryScope`). Đây đúng là khuôn mà `withScopeLabels`
   *   dặn: thủ tục trả mảng không mang được nhãn qua tRPC, nên giao diện lấy lý
   *   do từ truy vấn có nhãn cùng màn.
   *
   * ⚠ `enabled` khi CHƯA có nhà máy — đó chính là ca cần hỏi. Truyền `factoryId:
   *   0` là hợp lệ với `positive()`? KHÔNG. Nên chỉ chạy khi thật sự rỗng và
   *   dùng `factoryId` giả 1 chỉ để LẤY NHÃN, không dùng dữ liệu trả về.
   */
  const nhanPhamViQ = trpc.twinCanh.canhThietKe.useQuery(
    { factoryId: 1, tangIds: [] },
    { enabled: factoryId === null && !factoriesQ.isLoading, retry: false },
  );
  const phamViRong = isScopeEmpty(
    (nhanPhamViQ.data as { scopeEmptyReason?: string | null } | undefined)?.scopeEmptyReason,
  );

  /**
   * ĐỢT 4 — toà nhà đầu tiên của nhà máy, để lấy TẦNG và KÍCH THƯỚC SÀN.
   *
   * ★ `numeric(14,3)` về từ drizzle là **string**; `Number(...)` tường minh ở
   *   đây là bắt buộc. Cộng thẳng hai giá trị string sẽ NỐI CHUỖI
   *   ("38400"+"0" = "384000") — không throw, và nhà xưởng to gấp 10 lần.
   */
  const toaNhaDau = (toaNhaQ.data ?? [])[0] as
    | { id: number; rongMm: string | number; sauMm: string | number }
    | undefined;
  const chiTietQ = trpc.twinCanh.chiTietToaNha.useQuery(
    { id: toaNhaDau?.id ?? 0 },
    { enabled: toaNhaDau !== undefined },
  );
  const tangDau = useMemo(() => {
    /*
     * ★ #43 — TẦNG MANG THEO CẢ TRẠNG THÁI ẢNH NỀN.
     *   `traToaNhaKemTang` đã trả `anhNenUrl`/`tiLeMmMoiPx`/`daHieuChuan` (nó
     *   spread nguyên hàng `twin_tang`), nên không cần truy vấn thứ hai. Gọi
     *   thêm một truy vấn cho cùng dữ liệu là mở đường cho hai chỗ hiện hai
     *   trạng thái hiệu chuẩn khác nhau — và người dùng không biết tin cái nào.
     *
     * ⚠ `tiLeMmMoiPx` là `numeric` ⇒ về từ drizzle là STRING (hoặc null sau khi
     *   `chuoiRaSo` quy đổi ở tầng db). `Number(...)` tường minh, xem cảnh báo
     *   nối-chuỗi ở docblock `toaNhaDau` phía trên.
     */
    const tang = (chiTietQ.data?.tangs ?? [])[0] as
      | {
          id: number;
          anhNenUrl?: string | null;
          tiLeMmMoiPx?: number | string | null;
          daHieuChuan?: boolean | null;
        }
      | undefined;
    if (!toaNhaDau || !tang) return null;
    return {
      tangId: tang.id,
      rongMm: Number(toaNhaDau.rongMm),
      sauMm: Number(toaNhaDau.sauMm),
      anhNenUrl: tang.anhNenUrl ?? null,
      tiLeMmMoiPx:
        tang.tiLeMmMoiPx === null || tang.tiLeMmMoiPx === undefined
          ? null
          : Number(tang.tiLeMmMoiPx),
      daHieuChuan: tang.daHieuChuan === true,
    };
  }, [toaNhaDau, chiTietQ.data]);

  return (
    <div
      ref={khungRef}
      /*
       * ★★★ ĐỢT 45 (mục 7) — KHỐI TIÊU ĐỀ 2 HÀNG, CẢNH ≥ 55 % VÙNG LÀM VIỆC.
       *   QA Đợt 44 (D-7 mục 13) đo @1600: tiêu đề + mô tả 2 dòng + "Toà nhà: 1" + thanh tab h-12 +
       *   đệm = ~187 px trước khi tới tab; canvas 726×373 = 50 % vùng làm việc. @1280 vùng cảnh còn
       *   193 px, canvas sàn 320 chui ra ngoài, mini-map che nút. Cùng nội dung xếp lại thành HAI hàng:
       *     hàng 1: [tiêu đề · mô tả MỘT dòng (cắt, title đủ)]                [Nhà máy ▾]
       *     hàng 2: [Thêm toà nhà | Chọn tệp bản vẽ | Thiết kế] · Toà nhà: 1
       *   Không bỏ chữ nào (mô tả vẫn đọc đủ qua title; đếm toà nhà giữ testid) — chỉ đổi chỗ đứng.
       */
      className="flex flex-col gap-2 px-4 pb-3 pt-3"
      style={{ height: chieuCaoTruDinh("--twin-studio-top") }}
      data-testid="man-twin-studio"
    >
      <header className="flex shrink-0 items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="shrink-0 text-lg font-semibold text-foreground">{t("twin3d.studio.tieuDe")}</h1>
          <p
            className="hidden min-w-0 truncate text-sm text-muted-foreground lg:block"
            title={t("twin3d.studio.moTa")}
            data-testid="mo-ta-studio"
          >
            {t("twin3d.studio.moTa")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t("common.factory")}</Label>
          <Select
            value={factoryId === null ? "" : String(factoryId)}
            onValueChange={(v) => setFactoryId(Number(v))}
          >
            <SelectTrigger className="h-8 min-w-48" data-testid="chon-nha-may">
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

      <Tabs defaultValue="thiet-ke" className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <TabsList className="h-9">
            <TabsTrigger value="dien-kich-thuoc" data-testid="tab-con-duong-b">
              <Building2 className="mr-1.5 h-4 w-4" />
              {t("twin3d.toaNha.themMoi")}
            </TabsTrigger>
            <TabsTrigger value="nhap-ban-ve" data-testid="tab-con-duong-a">
              <FileUp className="mr-1.5 h-4 w-4" />
              {t("twin3d.banVe.chonTep")}
            </TabsTrigger>
            {/* ★★★ ĐỢT 4 (§7) — xưởng dựng bố cục. ĐÂY là tab mang `<Canvas>`.
                RB-4: Radix Tabs UNMOUNT nội dung tab không hoạt động, nên chỉ một
                WebGL context sống tại một thời điểm — cùng cơ chế mà
                `TwinHub.tsx:8-9` cố ý dựa vào. `window.__soCanvas` đo được điều
                đó, và `KhungCanh` tự console.error nếu > 1. */}
            <TabsTrigger value="thiet-ke" data-testid="tab-thiet-ke">
              <LayoutGrid className="mr-1.5 h-4 w-4" />
              {t("twin3d.studioUi.thietKe")}
            </TabsTrigger>
          </TabsList>
          {/* Đếm RỖNG khác đếm bằng 0 (NT-3.5): chưa tải xong hiện "—", không hiện 0. */}
          <p className="text-xs text-muted-foreground" data-testid="dem-toa-nha">
            {t("twin3d.toaNha.tieuDe")}:{" "}
            {toaNhaQ.isLoading || factoryId === null ? "—" : (toaNhaQ.data?.length ?? 0)}
          </p>
        </div>

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

        <TabsContent
          value="thiet-ke"
          className="mt-2 min-h-0 flex-1 overflow-hidden rounded-md border data-[state=inactive]:hidden"
        >
          {factoryId === null ? (
            /* ★★★ THƯỜNG-2(b) — nói RÕ vì sao trống, thay cho `null` câm. */
            factoriesQ.isLoading || nhanPhamViQ.isLoading ? null : phamViRong ? (
              <div className="p-4" data-testid="dai-pham-vi-rong">
                <EmptyState scopeEmptyReason="no_factory_assignment" />
              </div>
            ) : (
              <p className="p-4 text-sm text-muted-foreground" data-testid="chua-co-nha-may">
                {t("twin3d.studioUi.chuaCoNhaMay", "Chưa có nhà máy nào để thiết kế.")}
              </p>
            )
          ) : tangDau === null ? (
            <p className="p-4 text-sm text-muted-foreground" data-testid="chua-co-tang">
              {t("twin3d.studioUi.chuaCoTang")}
            </p>
          ) : (
            <XuongThietKe
              factoryId={factoryId}
              tangId={tangDau.tangId}
              sanRongMm={tangDau.rongMm}
              sanSauMm={tangDau.sauMm}
              anhNenUrl={tangDau.anhNenUrl}
              tiLeMmMoiPx={tangDau.tiLeMmMoiPx}
              daHieuChuan={tangDau.daHieuChuan}
              onDaGhiTang={() => void chiTietQ.refetch()}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
