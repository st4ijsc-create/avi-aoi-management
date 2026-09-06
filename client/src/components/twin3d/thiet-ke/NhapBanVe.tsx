/**
 * NhapBanVe.tsx — CON ĐƯỜNG A: dựng nhà xưởng từ bản vẽ kỹ thuật (§10A.1).
 *
 *   Chọn file (≤ 60 MB)
 *     → Worker occt-import-js chuyển STEP/IGES/BREP → lưới (KHÔNG chặn giao diện)
 *     → Đo: số tam giác, số node, bbox tổng
 *     → ★★★ HỘP THOẠI HIỆU CHỈNH — BẮT BUỘC, KHÔNG BỎ QUA ĐƯỢC
 *     → Xác nhận kích thước → (a) làm vỏ nhà, hoặc (b) tách thành tầng (§10A.3)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO HỘP THOẠI PHẢI CÓ THƯỚC TỈ LỆ VÀ HÌNH NGƯỜI CAO 1,7 M
 * ════════════════════════════════════════════════════════════════════════════
 * Nguyên văn §10A.1: file CAD **không tự khai đơn vị một cách đáng tin**. Nhập
 * sai đơn vị cho ra nhà xưởng lớn gấp 1.000 lần hoặc nhỏ bằng hạt gạo, và người
 * dùng **sẽ không hiểu vì sao**. Một dòng chữ "84.000 mm" không giúp gì — người
 * ta đọc lướt qua con số. Nhưng một hình người 1,7 m đứng cạnh khối nhà thì sai
 * lệch đơn vị **lộ ra ngay bằng mắt**: hoặc người cao bằng toà nhà, hoặc người
 * nhỏ như hạt bụi. Đó là phép kiểm rẻ nhất và đáng tin nhất, và nó là LÝ DO TỒN
 * TẠI của hộp thoại này — không phải trang trí.
 *
 * ⚠ Hộp thoại KHÔNG có nút "Bỏ qua". Chỉ có [Huỷ] (không nhập gì) và [Xác nhận]
 *   (đã nhìn). Thêm một lối thoát nhanh là xoá đúng thứ vừa nói ở trên.
 *
 * ⚠ Đơn vị mặc định của dropdown do `docBanVe.donViDeNghi` ĐỀ NGHỊ, và khi nó
 *   KHÔNG chắc chắn thì UI nói thẳng là chưa đoán được (NT-4) — một phỏng đoán
 *   trông tự tin còn tệ hơn một mặc định trung tính.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUp, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  apDungHieuChinh,
  CAU_HINH_MAC_DINH,
  DANH_SACH_DON_VI,
  type CauHinhHieuChinh,
  type DonViNguon,
  type KieuDiemGoc,
  type TrucLen,
} from "../hieuChinhNhapModel";
import {
  dinhDangTuTenTep,
  donViDeNghi,
  donViDeNghiChacChan,
  phanQuyetChan,
  tomTatKetQuaOcct,
  TRAN_BYTE,
  TRAN_TAM_GIAC,
  canOcct,
  type DinhDangBanVe,
  type PhanQuyetChan,
  type TomTatBanVe,
} from "../docBanVe";
import { deNghiTachTang, type KetQuaTachTang } from "../tachTangTuHinhHoc";
import { mmSangMet } from "../heToaDo";
import type { PhanHoiOcct, YeuCauOcct } from "../occtWorker";

/** Chiều cao hình người đối chiếu, MÉT (§10A.1). */
export const CAO_HINH_NGUOI_M = 1.7;

export interface NhapBanVeProps {
  /** Gọi khi người dùng xác nhận — mọi số ĐÃ hiệu chỉnh, đơn vị MILIMÉT. */
  onXacNhan?: (ket: {
    kichThuocMm: { rongMm: number; caoMm: number; sauMm: number };
    cauHinh: CauHinhHieuChinh;
    tomTat: TomTatBanVe;
    tachTang: KetQuaTachTang;
    cachDung: "vo_nha" | "tach_tang";
  }) => void;
}

export default function NhapBanVe({ onXacNhan }: NhapBanVeProps) {
  const { t } = useTranslation();
  const oFile = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null);

  const [dangDoc, setDangDoc] = useState(false);
  const [tenTep, setTenTep] = useState("");
  const [kichThuocByte, setKichThuocByte] = useState(0);
  const [dinhDang, setDinhDang] = useState<DinhDangBanVe | null>(null);
  const [tomTat, setTomTat] = useState<TomTatBanVe | null>(null);
  const [loiKyThuat, setLoiKyThuat] = useState<string | null>(null);
  const [moHopThoai, setMoHopThoai] = useState(false);
  const [cauHinh, setCauHinh] = useState<CauHinhHieuChinh>(CAU_HINH_MAC_DINH);
  const [cachDung, setCachDung] = useState<"vo_nha" | "tach_tang">("vo_nha");

  // ── Dọn worker khi rời màn (RB-7 tinh thần: không để tài nguyên treo) ──
  useEffect(() => {
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);

  const phanQuyet: PhanQuyetChan = useMemo(
    () => phanQuyetChan(tomTat, kichThuocByte, dinhDang),
    [tomTat, kichThuocByte, dinhDang],
  );

  /** Kết quả hiệu chỉnh — tính lại MỖI khi người dùng đổi bất kỳ ô nào. */
  const hieuChinh = useMemo(
    () => (tomTat ? apDungHieuChinh(tomTat.bbox, cauHinh) : null),
    [tomTat, cauHinh],
  );

  /** Gợi ý tách tầng (§10A.3) — tính trên bbox ĐÃ hiệu chỉnh, không trên số thô. */
  const tachTang: KetQuaTachTang | null = useMemo(() => {
    if (!tomTat || !hieuChinh) return null;
    const m = hieuChinh.maTranBienDoi;
    // Chỉ cần trục CAO (Y) sau biến đổi: hàng thứ hai của ma trận column-major.
    const doiY = (x: number, y: number, z: number) => m[1] * x + m[5] * y + m[9] * z + m[13];
    const nodesDaHieuChinh = tomTat.nodes.map((n) => {
      const ys = [
        doiY(n.bbox.minX, n.bbox.minY, n.bbox.minZ),
        doiY(n.bbox.maxX, n.bbox.maxY, n.bbox.maxZ),
        doiY(n.bbox.minX, n.bbox.maxY, n.bbox.minZ),
        doiY(n.bbox.maxX, n.bbox.minY, n.bbox.maxZ),
      ];
      return {
        ...n,
        bbox: { ...n.bbox, minY: Math.min(...ys), maxY: Math.max(...ys) },
      };
    });
    return deNghiTachTang(nodesDaHieuChinh);
  }, [tomTat, hieuChinh]);

  const chonFile = useCallback(
    async (file: File) => {
      setLoiKyThuat(null);
      setTomTat(null);
      setTenTep(file.name);
      setKichThuocByte(file.size);
      const dd = dinhDangTuTenTep(file.name);
      setDinhDang(dd);

      // ★ Chặn TRƯỚC khi đọc: đọc một file 500 MB trong worker là cách chắc chắn
      // để treo tab, và người dùng sẽ không biết vì sao (§10A.1).
      if (dd === null || file.size > TRAN_BYTE) {
        setMoHopThoai(true);
        return;
      }

      if (!canOcct(dd)) {
        // .glb/.gltf nạp bằng GLTFLoader (three) — thuộc Đợt 4, xem docblock cuối
        // file. Đến đó vẫn phải đi qua CHÍNH hộp thoại này.
        setLoiKyThuat("gltfChuaLap");
        setMoHopThoai(true);
        return;
      }

      setDangDoc(true);
      try {
        const buffer = await file.arrayBuffer();
        if (!worker.current) {
          worker.current = new Worker(new URL("../occtWorker.ts", import.meta.url), {
            type: "module",
          });
        }
        const w = worker.current;
        const kq = await new Promise<PhanHoiOcct>((giaiQuyet, tuChoi) => {
          const xong = (ev: MessageEvent<PhanHoiOcct>) => {
            w.removeEventListener("message", xong);
            w.removeEventListener("error", hong);
            giaiQuyet(ev.data);
          };
          const hong = (ev: ErrorEvent) => {
            w.removeEventListener("message", xong);
            w.removeEventListener("error", hong);
            tuChoi(new Error(ev.message));
          };
          w.addEventListener("message", xong);
          w.addEventListener("error", hong);
          const yeuCau: YeuCauOcct = { dinhDang: dd as "step" | "iges" | "brep", buffer };
          // Transferable: không sao chép vài chục MB sang worker.
          w.postMessage(yeuCau, [buffer]);
        });

        if (!kq.ok) {
          setLoiKyThuat(kq.loi ?? "docThatBai");
          setTomTat(null);
        } else {
          const tt = tomTatKetQuaOcct(kq.ketQua as Parameters<typeof tomTatKetQuaOcct>[0]);
          setTomTat(tt);
          // ★ Đơn vị chỉ là ĐỀ NGHỊ; hộp thoại vẫn bắt xác nhận bằng mắt (NT-4).
          setCauHinh((c) => ({ ...c, donViNguon: donViDeNghi(tt.bbox) }));
        }
      } catch (e) {
        setLoiKyThuat(e instanceof Error ? e.message : String(e));
        setTomTat(null);
      } finally {
        setDangDoc(false);
        setMoHopThoai(true);
      }
    },
    [],
  );

  const donViChacChan = tomTat ? donViDeNghiChacChan(tomTat.bbox) : false;

  return (
    <div className="grid gap-3" data-testid="nhap-ban-ve">
      <input
        ref={oFile}
        type="file"
        accept=".step,.stp,.iges,.igs,.brep,.glb,.gltf"
        className="hidden"
        data-testid="o-chon-tep"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void chonFile(f);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        disabled={dangDoc}
        data-testid="nut-chon-ban-ve"
        onClick={() => oFile.current?.click()}
      >
        {dangDoc ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileUp className="mr-2 h-4 w-4" />
        )}
        {dangDoc ? t("twin3d.banVe.dangDoc") : t("twin3d.banVe.chonTep")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t("twin3d.banVe.dinhDangNhan", {
          tranMb: Math.round(TRAN_BYTE / 1024 / 1024),
          tranTamGiac: TRAN_TAM_GIAC.toLocaleString("vi-VN"),
        })}
      </p>

      {/* ★★★ HỘP THOẠI HIỆU CHỈNH — BẮT BUỘC. Không có nút "Bỏ qua". */}
      <Dialog open={moHopThoai} onOpenChange={setMoHopThoai}>
        <DialogContent className="max-w-3xl" data-testid="hop-thoai-hieu-chinh">
          <DialogHeader>
            <DialogTitle>{t("twin3d.banVe.hieuChinhTieuDe")}</DialogTitle>
            <DialogDescription>{t("twin3d.banVe.hieuChinhMoTa")}</DialogDescription>
          </DialogHeader>

          {phanQuyet.chan || loiKyThuat ? (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              data-testid="thong-bao-chan"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  {t(`twin3d.banVe.chan.${loiKyThuat === "gltfChuaLap" ? "gltfChuaLap" : phanQuyet.lyDo ?? "docThatBai"}`, {
                    tranMb: Math.round(TRAN_BYTE / 1024 / 1024),
                    tranTamGiac: TRAN_TAM_GIAC.toLocaleString("vi-VN"),
                    soTamGiac: phanQuyet.soTamGiac.toLocaleString("vi-VN"),
                    mb: (phanQuyet.kichThuocByte / 1024 / 1024).toFixed(1),
                  })}
                </p>
                <p className="mt-1 text-xs opacity-80">{tenTep}</p>
              </div>
            </div>
          ) : (
            tomTat &&
            hieuChinh && (
              <div className="grid gap-4">
                {/* ── Bốn ô hiệu chỉnh của §10A.1 ── */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">{t("twin3d.banVe.donViNguon")}</Label>
                    <Select
                      value={cauHinh.donViNguon}
                      onValueChange={(v) =>
                        setCauHinh((c) => ({ ...c, donViNguon: v as DonViNguon }))
                      }
                    >
                      <SelectTrigger data-testid="chon-don-vi">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DANH_SACH_DON_VI.map((dv) => (
                          <SelectItem key={dv} value={dv} data-testid={`don-vi-${dv}`}>
                            {dv}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* ★ NT-4: đoán không chắc thì NÓI là không chắc. */}
                    {!donViChacChan && (
                      <span className="text-[11px] text-amber-600 dark:text-amber-500">
                        {t("twin3d.banVe.donViKhongDoanDuoc")}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="text-xs">{t("twin3d.banVe.trucLen")}</Label>
                    <Select
                      value={cauHinh.trucLen}
                      onValueChange={(v) => setCauHinh((c) => ({ ...c, trucLen: v as TrucLen }))}
                    >
                      <SelectTrigger data-testid="chon-truc-len">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Z" data-testid="truc-len-Z">Z (CAD)</SelectItem>
                        <SelectItem value="Y" data-testid="truc-len-Y">Y (glTF)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="text-xs">{t("twin3d.banVe.xoayQuanhTrucLen")}</Label>
                    <Input
                      value={String(cauHinh.xoayQuanhTrucLenDo)}
                      inputMode="decimal"
                      data-testid="o-xoay"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setCauHinh((c) => ({
                          ...c,
                          xoayQuanhTrucLenDo: Number.isFinite(n) ? n : 0,
                        }));
                      }}
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="text-xs">{t("twin3d.banVe.diemGoc")}</Label>
                    <Select
                      value={cauHinh.kieuDiemGoc}
                      onValueChange={(v) =>
                        setCauHinh((c) => ({ ...c, kieuDiemGoc: v as KieuDiemGoc }))
                      }
                    >
                      <SelectTrigger data-testid="chon-diem-goc">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="goc_bbox">{t("twin3d.banVe.gocBbox")}</SelectItem>
                        <SelectItem value="tam_bbox">{t("twin3d.banVe.tamBbox")}</SelectItem>
                        <SelectItem value="goc_file">{t("twin3d.banVe.gocFile")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* ★★★ XEM TRƯỚC KÈM THƯỚC TỈ LỆ + HÌNH NGƯỜI 1,7 M */}
                <XemTruocDoiChieu
                  rongM={mmSangMet(hieuChinh.kichThuocMm.rongMm)}
                  caoM={mmSangMet(hieuChinh.kichThuocMm.caoMm)}
                />

                <p className="text-sm" data-testid="cau-xac-nhan-kich-thuoc">
                  {t("twin3d.banVe.xacNhanKichThuoc", {
                    rong: mmSangMet(hieuChinh.kichThuocMm.rongMm).toLocaleString("vi-VN", {
                      maximumFractionDigits: 1,
                    }),
                    sau: mmSangMet(hieuChinh.kichThuocMm.sauMm).toLocaleString("vi-VN", {
                      maximumFractionDigits: 1,
                    }),
                    cao: mmSangMet(hieuChinh.kichThuocMm.caoMm).toLocaleString("vi-VN", {
                      maximumFractionDigits: 1,
                    }),
                  })}
                </p>

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span data-testid="so-tam-giac">
                    {t("twin3d.banVe.soTamGiac")}: {tomTat.soTamGiac.toLocaleString("vi-VN")}
                  </span>
                  <span data-testid="so-node">
                    {t("twin3d.banVe.soNode")}: {tomTat.soNode}
                  </span>
                </div>

                {/* Cách dùng: vỏ nhà, hay tách thành tầng (§10A.1 / §10A.3) */}
                <div className="grid gap-2">
                  <Label className="text-xs">{t("twin3d.banVe.cachDung")}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={cachDung === "vo_nha" ? "default" : "outline"}
                      data-testid="chon-vo-nha"
                      onClick={() => setCachDung("vo_nha")}
                    >
                      {t("twin3d.banVe.lamVoNha")}
                    </Button>
                    <Button
                      size="sm"
                      variant={cachDung === "tach_tang" ? "default" : "outline"}
                      data-testid="chon-tach-tang"
                      disabled={!tachTang || tachTang.khongTachDuoc}
                      onClick={() => setCachDung("tach_tang")}
                    >
                      {t("twin3d.banVe.tachThanhTang")}
                    </Button>
                    {tachTang && !tachTang.khongTachDuoc && (
                      <Badge variant="outline" data-testid="so-cum-tang">
                        {t("twin3d.banVe.phatHienCum", { so: tachTang.cum.length })}
                      </Badge>
                    )}
                    {tachTang?.khongTachDuoc && (
                      <span className="text-xs text-muted-foreground" data-testid="khong-tach-duoc">
                        {t("twin3d.banVe.khongTachDuoc")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          )}

          <DialogFooter>
            {/* ★ Chỉ [Huỷ] và [Xác nhận]. KHÔNG có "Bỏ qua" — xem docblock đầu file. */}
            <Button variant="outline" data-testid="nut-huy" onClick={() => setMoHopThoai(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={phanQuyet.chan || !hieuChinh || !tomTat || !tachTang}
              data-testid="nut-xac-nhan-hieu-chinh"
              onClick={() => {
                if (!hieuChinh || !tomTat || !tachTang) return;
                onXacNhan?.({
                  kichThuocMm: hieuChinh.kichThuocMm,
                  cauHinh,
                  tomTat,
                  tachTang,
                  cachDung,
                });
                setMoHopThoai(false);
              }}
            >
              {t("twin3d.banVe.xacNhan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * ★★★ XEM TRƯỚC ĐỐI CHIẾU — thước tỉ lệ + hình người cao 1,7 m (§10A.1).
 *
 * Vẽ khối nhà và một hình người ở CÙNG một tỉ lệ. Nếu đơn vị chọn sai 1000 lần
 * thì một trong hai biến mất khỏi khung hình, và điều đó nhìn thấy trong nửa
 * giây — rẻ hơn mọi phép kiểm tự động, và đó là nguyên văn lý lẽ của spec.
 *
 * ⚠ SVG chứ không phải WebGL: hình này chỉ cần đúng TỈ LỆ, và RB-4 giữ context
 *   WebGL duy nhất cho khung cảnh chính.
 */
export function XemTruocDoiChieu({ rongM, caoM }: { rongM: number; caoM: number }) {
  const { t } = useTranslation();
  const W = 660;
  const H = 260;
  const LE = 24;

  // Tỉ lệ phải bao được CẢ khối nhà LẪN hình người — nếu chỉ vừa khối nhà thì
  // một toà nhà 84 km sẽ tự co lại vừa khung và trông hoàn toàn bình thường,
  // tức là phép đối chiếu mất tác dụng đúng lúc cần nó nhất.
  const rongVe = Math.max(rongM, CAO_HINH_NGUOI_M * 2, 0.001);
  const caoVe = Math.max(caoM, CAO_HINH_NGUOI_M, 0.001);
  const heSo = Math.min((W - LE * 2) / rongVe, (H - LE * 2) / caoVe);

  const wNha = rongM * heSo;
  const hNha = caoM * heSo;
  const hNguoi = CAO_HINH_NGUOI_M * heSo;
  const ySan = H - LE;
  const xNha = LE;
  const xNguoi = xNha + wNha + 14;

  // Thước tỉ lệ: chọn bước tròn (1/5/10/50/100 m) sao cho vạch dài 60–200 px.
  const buocUngVien = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const buocM = buocUngVien.find((b) => b * heSo >= 60) ?? buocUngVien[buocUngVien.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-md border border-border bg-muted/30"
      role="img"
      aria-label={t("twin3d.banVe.xemTruocDoiChieu")}
      data-testid="xem-truoc-doi-chieu"
    >
      {/* Mặt đất */}
      <line x1={0} y1={ySan} x2={W} y2={ySan} className="stroke-border" strokeWidth={1} />

      {/* Khối nhà theo tỉ lệ thật */}
      <rect
        x={xNha}
        y={ySan - hNha}
        width={Math.max(wNha, 0.5)}
        height={Math.max(hNha, 0.5)}
        className="fill-primary/10 stroke-primary/60"
        strokeWidth={1.5}
        data-testid="khoi-nha-doi-chieu"
      />

      {/* ★★★ HÌNH NGƯỜI CAO 1,7 M — cùng tỉ lệ với khối nhà */}
      <g data-testid="hinh-nguoi-1m7" className="fill-foreground stroke-foreground">
        <circle cx={xNguoi} cy={ySan - hNguoi * 0.9} r={Math.max(hNguoi * 0.1, 0.6)} />
        <line
          x1={xNguoi}
          y1={ySan - hNguoi * 0.8}
          x2={xNguoi}
          y2={ySan - hNguoi * 0.35}
          strokeWidth={Math.max(hNguoi * 0.06, 0.6)}
        />
        <line
          x1={xNguoi - hNguoi * 0.16}
          y1={ySan - hNguoi * 0.62}
          x2={xNguoi + hNguoi * 0.16}
          y2={ySan - hNguoi * 0.62}
          strokeWidth={Math.max(hNguoi * 0.05, 0.5)}
        />
        <line
          x1={xNguoi}
          y1={ySan - hNguoi * 0.35}
          x2={xNguoi - hNguoi * 0.13}
          y2={ySan}
          strokeWidth={Math.max(hNguoi * 0.05, 0.5)}
        />
        <line
          x1={xNguoi}
          y1={ySan - hNguoi * 0.35}
          x2={xNguoi + hNguoi * 0.13}
          y2={ySan}
          strokeWidth={Math.max(hNguoi * 0.05, 0.5)}
        />
        <text
          x={xNguoi + hNguoi * 0.2 + 4}
          y={ySan - hNguoi * 0.45}
          className="fill-muted-foreground stroke-none text-[10px]"
        >
          1,7 m
        </text>
      </g>

      {/* ★★★ THƯỚC TỈ LỆ */}
      <g data-testid="thuoc-ti-le">
        <line
          x1={LE}
          y1={ySan + 12}
          x2={LE + buocM * heSo}
          y2={ySan + 12}
          className="stroke-foreground"
          strokeWidth={2}
        />
        <line x1={LE} y1={ySan + 8} x2={LE} y2={ySan + 16} className="stroke-foreground" strokeWidth={2} />
        <line
          x1={LE + buocM * heSo}
          y1={ySan + 8}
          x2={LE + buocM * heSo}
          y2={ySan + 16}
          className="stroke-foreground"
          strokeWidth={2}
        />
        <text
          x={LE + buocM * heSo + 6}
          y={ySan + 16}
          className="fill-muted-foreground text-[11px]"
          data-testid="nhan-thuoc-ti-le"
        >
          {buocM} m
        </text>
      </g>
    </svg>
  );
}

/**
 * ★ CHỖ NỐI CHO ĐỢT SAU — nạp `.glb`/`.gltf` bằng `GLTFLoader`.
 *
 * Đợt 3 KHÔNG lắp phần này: `GLTFLoader` kéo theo `three`, và Đợt 1 đang giữ
 * `client/src/components/twin3d/loi/*` — nơi lớp bọc three của dự án sẽ sống.
 * Lắp một bản three thứ hai ở đây là đúng lỗi câm mà RB-8/§4.7 cảnh báo
 * (`resolve.dedupe: ['three']` tồn tại chính vì chuyện đó).
 *
 * Khi lắp: nạp bằng loader của Đợt 1, gom bbox từng node thành `TomTatBanVe`
 * (cùng hình dạng mà `tomTatKetQuaOcct` trả về), rồi đi qua CHÍNH hộp thoại hiệu
 * chỉnh này — glTF khai Y-up và đơn vị mét theo chuẩn, nhưng "theo chuẩn" không
 * phải "đúng trong thực tế", và §10A.1 không cho phép bỏ bước xác nhận nào.
 */
export async function napGltfChoBanVe(_file: File): Promise<TomTatBanVe> {
  throw new Error("napGltfChoBanVe: Đợt 4 lắp (cần lớp bọc three của Đợt 1)");
}
