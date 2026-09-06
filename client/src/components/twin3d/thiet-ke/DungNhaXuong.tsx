/**
 * DungNhaXuong.tsx — Màn dựng nhà xưởng, CON ĐƯỜNG B (§10A.2): form ba bước.
 *
 *   Bước 1  Toà nhà  (mã, tên, dài × rộng × cao — MÉT)
 *   Bước 2  Bảng các tầng (số, tên, dài, rộng, cao thông thuỷ, cao độ)
 *   Bước 3  Xem trước + [Tạo]
 *
 * ★★★ NHẬP BẰNG MÉT, LƯU BẰNG MILIMÉT. Component này KHÔNG tự chia/nhân 1000 —
 *   mọi quy đổi đi qua `boCucTang.ts` (dùng `heToaDo.metSangMm`). Một chỗ duy
 *   nhất biết hệ số, nên không có chỗ thứ hai để lệch.
 *
 * ★★★ NT-4 — badge vàng "chưa đo" hiện trên MỌI giá trị `nguon='sinh'`: cao độ
 *   hệ tự tính, kích thước tầng thừa kế từ toà nhà, và 4 bức tường bao. Người
 *   dùng gõ đè lên ô nào thì ô đó thành `'tay'` và lần sinh sau không đè lại.
 *
 * ⚠ TUYỆT ĐỐI KHÔNG đọc `factories.floorWidthM/floorDepthM` làm kích thước
 *   (§10A.0): SIM-FAC có 1500 × 1200, đọc đúng đơn vị là 1,5 km × 1,2 km — số
 *   rác. Form này bắt đầu từ MẶC ĐỊNH trung tính, không từ dữ liệu cũ.
 *
 * ⚠ Xem trước ở bước 3 là 2D (SVG mặt bằng + mặt cắt), KHÔNG phải `<Canvas>`:
 *   RB-4 cho phép đúng MỘT canvas WebGL sống tại một thời điểm, và màn Thiết kế
 *   của Đợt 4 sẽ giữ chỗ đó. Component 3D thật nối vào sau qua `KhungXemTruoc3D`
 *   (khai ở cuối file, hiện để trống — Đợt 4 lắp).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Building2, ChevronLeft, ChevronRight, Plus, Trash2, TriangleAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  kiemTraNhapLieu,
  sinhTuongBao,
  tangMetSangMm,
  toaNhaMetSangMm,
  type TangMm,
  type TangNhapMet,
  type ToaNhaMm,
  type ToaNhaNhapMet,
} from "../boCucTang";
import { mmSangMet } from "../heToaDo";

/** Số bước của form (§10A.2). */
const SO_BUOC = 3;

/** Dòng tầng trong state — giữ chuỗi thô để người dùng gõ dở không bị nhảy số. */
interface DongTang {
  capSo: string;
  ten: string;
  daiM: string;
  rongM: string;
  caoThongThuyM: string;
  caoDoM: string;
}

function dongTangMoi(capSo: number, ten: string): DongTang {
  return { capSo: String(capSo), ten, daiM: "", rongM: "", caoThongThuyM: "6", caoDoM: "" };
}

/** Chuỗi ô nhập → số, hoặc `undefined` khi bỏ trống (= "để hệ tự tính"). */
function soHoacTrong(s: string): number | undefined {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Chuỗi ô nhập → số, hoặc NaN khi hỏng (để `kiemTraNhapLieu` bắt được). */
function soBatBuoc(s: string): number {
  const t = s.trim();
  return t === "" ? NaN : Number(t);
}

/**
 * ★ Badge vàng "chưa đo" (NT-4). Dùng ở MỌI ô mà giá trị do hệ sinh.
 * Tách thành component để không ai quên `title` giải thích — một badge không nói
 * được vì sao nó ở đó thì người dùng học cách phớt lờ nó.
 */
export function BadgeChuaDo({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      title={t("twin3d.chuaDoGiaiThich")}
      data-testid="badge-chua-do"
      className={`border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400 ${className ?? ""}`}
    >
      {t("twin3d.chuaDo")}
    </Badge>
  );
}

export interface DungNhaXuongProps {
  factoryId: number;
  /** Gọi sau khi tạo xong, để màn cha chuyển sang bố cục tầng vừa dựng. */
  onXongTao?: (ket: { toaNhaId: number; tangIds: number[] }) => void;
}

export default function DungNhaXuong({ factoryId, onXongTao }: DungNhaXuongProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  const [buoc, setBuoc] = useState(1);
  const [ma, setMa] = useState("TN-A");
  const [ten, setTen] = useState("");
  const [daiM, setDaiM] = useState("");
  const [rongM, setRongM] = useState("");
  const [caoM, setCaoM] = useState("");
  const [viTriXM, setViTriXM] = useState("0");
  const [viTriYM, setViTriYM] = useState("0");

  const [cungKichThuoc, setCungKichThuoc] = useState(true);
  const [tuTinhCaoDo, setTuTinhCaoDo] = useState(true);
  const [sinhTuong, setSinhTuong] = useState(true);
  const [dongs, setDongs] = useState<DongTang[]>([dongTangMoi(1, "Tầng trệt")]);

  // ── Quy đổi: MÉT (form) → MILIMÉT (DB), qua boCucTang, không tự chia 1000 ──
  const toaNhaNhap: ToaNhaNhapMet = useMemo(
    () => ({
      ma: ma.trim(),
      ten: ten.trim(),
      daiM: soBatBuoc(daiM),
      rongM: soBatBuoc(rongM),
      caoM: soBatBuoc(caoM),
      viTriXM: soHoacTrong(viTriXM) ?? 0,
      viTriYM: soHoacTrong(viTriYM) ?? 0,
    }),
    [ma, ten, daiM, rongM, caoM, viTriXM, viTriYM],
  );

  const tangNhap: TangNhapMet[] = useMemo(
    () =>
      dongs.map((d) => ({
        capSo: Number(d.capSo.trim() === "" ? NaN : d.capSo),
        ten: d.ten.trim(),
        // Ô tích "các tầng cùng kích thước với toà nhà" ⇒ bỏ trống ⇒ THỪA KẾ, và
        // thừa kế là một PHỎNG ĐOÁN nên tầng sinh ra mang nguon='sinh' (NT-4).
        daiM: cungKichThuoc ? undefined : soHoacTrong(d.daiM),
        rongM: cungKichThuoc ? undefined : soHoacTrong(d.rongM),
        caoThongThuyM: soBatBuoc(d.caoThongThuyM),
        // Ô tích "tự tính cao độ" ⇒ bỏ trống ⇒ hệ tính. Bỏ tích ⇒ số người gõ
        // được giữ nguyên, và lần tự tính sau KHÔNG đè (luật NT-4).
        caoDoM: tuTinhCaoDo ? undefined : soHoacTrong(d.caoDoM),
      })),
    [dongs, cungKichThuoc, tuTinhCaoDo],
  );

  const loi = useMemo(() => kiemTraNhapLieu(toaNhaNhap, tangNhap), [toaNhaNhap, tangNhap]);

  const toaNhaMm: ToaNhaMm | null = useMemo(() => {
    if (loi.some((l) => l.khoa.startsWith("kichThuocKhongHopLe"))) return null;
    return toaNhaMetSangMm(toaNhaNhap);
  }, [toaNhaNhap, loi]);

  const tangMm: TangMm[] = useMemo(
    () => (toaNhaMm ? tangMetSangMm(tangNhap, toaNhaMm) : []),
    [tangNhap, toaNhaMm],
  );

  const dungM = trpc.twinCanh.dungNhaXuong.useMutation({
    onSuccess: (ket) => {
      toast.success(t("twin3d.dungXuong.daTao", { soTang: ket.soTang, soTuong: ket.soTuong }));
      void utils.twinCanh.danhSachToaNha.invalidate();
      onXongTao?.({ toaNhaId: ket.toaNhaId, tangIds: ket.tangIds });
    },
    onError: (e) => toastTrpcError(e),
  });

  function taoNhaXuong() {
    if (!toaNhaMm || loi.length > 0) return;
    dungM.mutate({
      factoryId,
      toaNha: {
        ma: toaNhaMm.ma,
        ten: toaNhaMm.ten,
        rongMm: toaNhaMm.rongMm,
        sauMm: toaNhaMm.sauMm,
        caoMm: toaNhaMm.caoMm,
        viTriXMm: toaNhaMm.viTriXMm,
        viTriYMm: toaNhaMm.viTriYMm,
      },
      tangs: tangMm.map((tg) => ({
        capSo: tg.capSo,
        ten: tg.ten,
        caoDoMm: tg.caoDoMm,
        caoThongThuyMm: tg.caoThongThuyMm,
        // Kích thước THỪA KẾ gửi lên `null` = "chưa ai đo mặt sàn này"; cảnh 3D
        // lấy từ toà nhà cha. Gửi số thừa kế sẽ biến phỏng đoán thành số đo.
        daiMm: tg.kichThuocNguon === "tay" ? tg.daiMm : null,
        rongMm: tg.kichThuocNguon === "tay" ? tg.rongMm : null,
        nguonHinhHoc: tg.nguonHinhHoc,
        nguon: tg.nguon,
      })),
      tuongBaoTheoTang: sinhTuong
        ? tangMm.map((tg) => ({ capSo: tg.capSo, tuongs: sinhTuongBao(tg) }))
        : undefined,
    });
  }

  const buocHopLe = useMemo(() => {
    if (buoc === 1) {
      return !loi.some(
        (l) => l.khoa === "thieuMa" || l.khoa === "thieuTen" || l.khoa.startsWith("kichThuocKhongHopLe"),
      );
    }
    return loi.length === 0;
  }, [buoc, loi]);

  return (
    <div className="flex flex-col gap-4" data-testid="dung-nha-xuong">
      <ThanhBuoc buoc={buoc} />

      {buoc === 1 && (
        <section className="grid gap-4 rounded-lg border border-border bg-card p-4" data-testid="buoc-toa-nha">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="h-4 w-4" /> {t("twin3d.toaNha.tieuDe")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <O nhan={t("twin3d.toaNha.ma")} giaTri={ma} datGiaTri={setMa} testid="o-ma" />
            <O nhan={t("twin3d.toaNha.ten")} giaTri={ten} datGiaTri={setTen} testid="o-ten" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <O nhan={t("twin3d.toaNha.dai")} giaTri={daiM} datGiaTri={setDaiM} so testid="o-dai" />
            <O nhan={t("twin3d.toaNha.rong")} giaTri={rongM} datGiaTri={setRongM} so testid="o-rong" />
            <O nhan={t("twin3d.toaNha.cao")} giaTri={caoM} datGiaTri={setCaoM} so testid="o-cao" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <O nhan={t("twin3d.dungXuong.viTriX")} giaTri={viTriXM} datGiaTri={setViTriXM} so testid="o-vi-tri-x" />
            <O nhan={t("twin3d.dungXuong.viTriY")} giaTri={viTriYM} datGiaTri={setViTriYM} so testid="o-vi-tri-y" />
          </div>
          {/* ★ Nói thẳng đơn vị lưu: người dùng gõ mét, hệ lưu mm — không giấu. */}
          <p className="text-xs text-muted-foreground">{t("twin3d.dungXuong.ghiChuDonVi")}</p>
        </section>
      )}

      {buoc === 2 && (
        <section className="grid gap-3 rounded-lg border border-border bg-card p-4" data-testid="buoc-tang">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("twin3d.tang.tieuDe")}</h3>
            <Button
              size="sm"
              variant="outline"
              data-testid="nut-them-tang"
              onClick={() => {
                const capMax = dongs.reduce((m, d) => Math.max(m, Number(d.capSo) || 0), 0);
                setDongs((ds) => [...ds, dongTangMoi(capMax + 1, `Tầng ${capMax + 1}`)]);
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> {t("twin3d.tang.themMoi")}
            </Button>
          </div>

          <div className="flex flex-wrap gap-4">
            <OTich
              nhan={t("twin3d.tang.cungKichThuoc")}
              bat={cungKichThuoc}
              datBat={setCungKichThuoc}
              testid="tich-cung-kich-thuoc"
            />
            <OTich
              nhan={t("twin3d.tang.tuTinhCaoDo")}
              bat={tuTinhCaoDo}
              datBat={setTuTinhCaoDo}
              testid="tich-tu-tinh-cao-do"
            />
            <OTich
              nhan={t("twin3d.dungXuong.sinhTuongBao")}
              bat={sinhTuong}
              datBat={setSinhTuong}
              testid="tich-sinh-tuong"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm" data-testid="bang-tang">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="p-2 text-left">{t("twin3d.tang.capSo")}</th>
                  <th className="p-2 text-left">{t("twin3d.tang.ten")}</th>
                  <th className="p-2 text-left">{t("twin3d.toaNha.dai")}</th>
                  <th className="p-2 text-left">{t("twin3d.toaNha.rong")}</th>
                  <th className="p-2 text-left">{t("twin3d.tang.caoThongThuy")}</th>
                  <th className="p-2 text-left">{t("twin3d.tang.caoDo")}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {dongs.map((d, i) => {
                  const tinh = tangMm.find((tg) => tg.capSo === Number(d.capSo));
                  return (
                    <tr key={i} className="border-b border-border/50" data-testid={`dong-tang-${i}`}>
                      <td className="p-1">
                        <Input
                          value={d.capSo}
                          inputMode="numeric"
                          className="h-8 w-16"
                          data-testid={`o-tang-cap-${i}`}
                          onChange={(e) => suaDong(setDongs, i, { capSo: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          value={d.ten}
                          className="h-8"
                          data-testid={`o-tang-ten-${i}`}
                          onChange={(e) => suaDong(setDongs, i, { ten: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        {cungKichThuoc ? (
                          <OThuaKe
                            giaTriM={tinh ? mmSangMet(tinh.daiMm) : null}
                            testid={`o-tang-dai-thua-ke-${i}`}
                          />
                        ) : (
                          <Input
                            value={d.daiM}
                            inputMode="decimal"
                            className="h-8 w-24"
                            data-testid={`o-tang-dai-${i}`}
                            onChange={(e) => suaDong(setDongs, i, { daiM: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="p-1">
                        {cungKichThuoc ? (
                          <OThuaKe
                            giaTriM={tinh ? mmSangMet(tinh.rongMm) : null}
                            testid={`o-tang-rong-thua-ke-${i}`}
                          />
                        ) : (
                          <Input
                            value={d.rongM}
                            inputMode="decimal"
                            className="h-8 w-24"
                            data-testid={`o-tang-rong-${i}`}
                            onChange={(e) => suaDong(setDongs, i, { rongM: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="p-1">
                        <Input
                          value={d.caoThongThuyM}
                          inputMode="decimal"
                          className="h-8 w-24"
                          data-testid={`o-tang-cao-thong-thuy-${i}`}
                          onChange={(e) => suaDong(setDongs, i, { caoThongThuyM: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        {tuTinhCaoDo ? (
                          <OThuaKe
                            giaTriM={tinh ? mmSangMet(tinh.caoDoMm) : null}
                            testid={`o-tang-cao-do-sinh-${i}`}
                          />
                        ) : (
                          <Input
                            value={d.caoDoM}
                            inputMode="decimal"
                            className="h-8 w-24"
                            data-testid={`o-tang-cao-do-${i}`}
                            onChange={(e) => suaDong(setDongs, i, { caoDoM: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="p-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          data-testid={`nut-xoa-tang-${i}`}
                          disabled={dongs.length <= 1}
                          onClick={() => setDongs((ds) => ds.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {buoc === 3 && toaNhaMm && (
        <section className="grid gap-4 rounded-lg border border-border bg-card p-4" data-testid="buoc-xem-truoc">
          <h3 className="text-sm font-semibold">{t("twin3d.dungXuong.xemTruoc")}</h3>
          <XemTruocMatCat toaNha={toaNhaMm} tangs={tangMm} />
          <dl className="grid gap-2 text-sm sm:grid-cols-3" data-testid="tom-tat-xem-truoc">
            <Dong nhan={t("twin3d.banVe.baoNgoai")}>
              {`${mmSangMet(toaNhaMm.rongMm)} × ${mmSangMet(toaNhaMm.sauMm)} × ${mmSangMet(toaNhaMm.caoMm)} m`}
            </Dong>
            <Dong nhan={t("twin3d.tang.tieuDe")}>
              <span data-testid="so-tang-xem-truoc">{tangMm.length}</span>
            </Dong>
            <Dong nhan={t("twin3d.dungXuong.sinhTuongBao")}>
              {sinhTuong ? (
                <span className="inline-flex items-center gap-2">
                  <span data-testid="so-tuong-xem-truoc">{tangMm.length * 4}</span>
                  <BadgeChuaDo />
                </span>
              ) : (
                "—"
              )}
            </Dong>
          </dl>
        </section>
      )}

      {loi.length > 0 && buoc === SO_BUOC && (
        <ul
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="danh-sach-loi"
        >
          {loi.map((l, i) => (
            <li key={i} className="flex items-center gap-2">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              {t(`twin3d.dungXuong.loi.${l.khoa}`, { capSo: l.capSo })}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={buoc === 1}
          data-testid="nut-buoc-truoc"
          onClick={() => setBuoc((b) => Math.max(1, b - 1))}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> {t("twin3d.dungXuong.buocTruoc")}
        </Button>
        {buoc < SO_BUOC ? (
          <Button
            disabled={!buocHopLe}
            data-testid="nut-buoc-sau"
            onClick={() => setBuoc((b) => Math.min(SO_BUOC, b + 1))}
          >
            {t("twin3d.dungXuong.buocSau")} <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button
            disabled={loi.length > 0 || dungM.isPending}
            data-testid="nut-tao"
            onClick={taoNhaXuong}
          >
            {t("twin3d.dungXuong.tao")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mảnh nhỏ
// ---------------------------------------------------------------------------

function suaDong(
  dat: React.Dispatch<React.SetStateAction<DongTang[]>>,
  i: number,
  banVa: Partial<DongTang>,
) {
  dat((ds) => ds.map((d, j) => (j === i ? { ...d, ...banVa } : d)));
}

function ThanhBuoc({ buoc }: { buoc: number }) {
  const { t } = useTranslation();
  const nhan = [
    t("twin3d.toaNha.tieuDe"),
    t("twin3d.tang.tieuDe"),
    t("twin3d.dungXuong.xemTruoc"),
  ];
  return (
    <ol className="flex items-center gap-2 text-xs" data-testid="thanh-buoc">
      {nhan.map((n, i) => (
        <li
          key={n}
          data-testid={`buoc-${i + 1}`}
          data-dang-o={buoc === i + 1 ? "true" : "false"}
          className={`rounded-full px-3 py-1 ${
            buoc === i + 1
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {i + 1}. {n}
        </li>
      ))}
    </ol>
  );
}

function O({
  nhan,
  giaTri,
  datGiaTri,
  so,
  testid,
}: {
  nhan: string;
  giaTri: string;
  datGiaTri: (v: string) => void;
  so?: boolean;
  testid: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{nhan}</Label>
      <Input
        value={giaTri}
        inputMode={so ? "decimal" : "text"}
        data-testid={testid}
        onChange={(e) => datGiaTri(e.target.value)}
      />
    </div>
  );
}

function OTich({
  nhan,
  bat,
  datBat,
  testid,
}: {
  nhan: string;
  bat: boolean;
  datBat: (v: boolean) => void;
  testid: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={bat} onCheckedChange={(v) => datBat(v === true)} data-testid={testid} />
      {nhan}
    </label>
  );
}

/** Ô CHỈ ĐỌC hiện giá trị hệ sinh, kèm badge "chưa đo" (NT-4). */
function OThuaKe({ giaTriM, testid }: { giaTriM: number | null; testid: string }) {
  return (
    <span className="inline-flex items-center gap-2" data-testid={testid}>
      {/* Chưa tính được ⇒ "—", KHÔNG phải "0": đếm rỗng khác đếm bằng 0 (NT-3.5). */}
      <span className="tabular-nums text-muted-foreground">
        {giaTriM === null || !Number.isFinite(giaTriM) ? "—" : giaTriM}
      </span>
      <BadgeChuaDo />
    </span>
  );
}

function Dong({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{nhan}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/**
 * Xem trước MẶT CẮT ĐỨNG bằng SVG (2D), tỉ lệ thật.
 *
 * ⚠ Cố ý KHÔNG dùng `<Canvas>` — RB-4: đúng MỘT context WebGL sống tại một thời
 * điểm, và chỗ đó thuộc về khung cảnh chính của màn Thiết kế (Đợt 4). Một mặt
 * cắt SVG đủ để người dùng thấy các tầng chồng nhau có đúng tỉ lệ không, mà
 * không tốn một context nào.
 */
function XemTruocMatCat({ toaNha, tangs }: { toaNha: ToaNhaMm; tangs: TangMm[] }) {
  const { t } = useTranslation();
  const daiM = mmSangMet(toaNha.rongMm);
  const caoM = mmSangMet(toaNha.caoMm);
  const caoVe = Math.max(caoM, ...tangs.map((tg) => mmSangMet(tg.caoDoMm + tg.caoThongThuyMm)), 1);
  const W = 640;
  const H = 220;
  const heSo = Math.min(W / Math.max(daiM, 1), H / caoVe) * 0.86;
  const x0 = (W - daiM * heSo) / 2;
  const y0 = H - 16;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-md border border-border bg-muted/30"
      role="img"
      aria-label={t("twin3d.dungXuong.xemTruoc")}
      data-testid="xem-truoc-mat-cat"
    >
      <rect
        x={x0}
        y={y0 - caoM * heSo}
        width={daiM * heSo}
        height={caoM * heSo}
        className="fill-primary/5 stroke-primary/50"
        strokeWidth={1.5}
        data-testid="hinh-bao-ngoai"
      />
      {tangs.map((tg) => {
        const yTang = y0 - mmSangMet(tg.caoDoMm) * heSo;
        const hTang = mmSangMet(tg.caoThongThuyMm) * heSo;
        const wTang = mmSangMet(tg.daiMm) * heSo;
        return (
          <g key={tg.capSo} data-testid={`xem-truoc-tang-${tg.capSo}`}>
            <rect
              x={x0}
              y={yTang - hTang}
              width={wTang}
              height={hTang}
              className="fill-foreground/5 stroke-foreground/40"
              strokeWidth={1}
            />
            {/* Bản sàn dày 300 mm, vẽ đặc để mắt phân biệt tầng với khoảng trống. */}
            <rect x={x0} y={yTang} width={wTang} height={2} className="fill-foreground/60" />
            <text x={x0 + 6} y={yTang - 6} className="fill-muted-foreground text-[10px]">
              {tg.ten}
            </text>
          </g>
        );
      })}
      {/* Thước tỉ lệ 10 m — cùng lý do như hộp thoại hiệu chỉnh: một sai lệch đơn
          vị phải LỘ RA BẰNG MẮT, không chờ ai đọc số. */}
      <g data-testid="thuoc-ti-le-mat-cat">
        <line x1={x0} y1={H - 8} x2={x0 + 10 * heSo} y2={H - 8} className="stroke-foreground" strokeWidth={2} />
        <text x={x0 + 10 * heSo + 6} y={H - 5} className="fill-muted-foreground text-[10px]">
          10 m
        </text>
      </g>
    </svg>
  );
}

/**
 * ★ CHỖ NỐI CHO ĐỢT SAU — khung xem trước 3D thật.
 *
 * Đợt 1 đang giữ `client/src/components/twin3d/loi/*` và `FactoryCommandView.tsx`;
 * Đợt 3 KHÔNG chạm các tệp đó. Khi engine của Đợt 1/4 sẵn sàng, thay phần thân
 * bằng `<KhoiCanh3D>` và giữ nguyên chữ ký props này — `DungNhaXuong` không cần
 * đổi dòng nào.
 *
 * ⚠ RB-4: chỉ được dựng `<Canvas>` ở đây khi màn Thiết kế KHÔNG đang giữ một
 * canvas khác. Đợt 4 phải quyết định điều đó ở tầng trên, không phải ở đây.
 */
export interface KhungXemTruoc3DProps {
  toaNha: ToaNhaMm;
  tangs: TangMm[];
}

export function KhungXemTruoc3D(_props: KhungXemTruoc3DProps) {
  // Cố ý TRỐNG — xem docblock trên. Trả `null` chứ không dựng khung rỗng: một
  // hộp trống trên màn hình nói "hỏng rồi", còn không có gì nói "chưa lắp".
  return null;
}
