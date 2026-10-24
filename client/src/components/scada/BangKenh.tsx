/**
 * SCADA R1a Task 13 — bảng kênh của MỘT adapter (M12 `/scada/config/channels`): một hàng/tag.
 * Cột: Tag · Loại kênh hiệu lực (+ "khai" / "suy từ writable") · Dải · Bước · Mức tác động hiệu lực · Tên hiển thị · (sửa).
 *
 *   • Kênh RA chưa khai mức ⇒ "5 — mặc định đóng" (máy chủ fail-closed: NULL ⇒ 5).
 *   • Kênh dừng chưa khai mức VÀ chưa ghim stop_value (`canhBaoKenhDung`) ⇒ cảnh báo nổi bật ngay trong hàng.
 *   • Nút "Sửa" chỉ HIỆN khi `canAct` (engineer|admin + machine_control.canEdit) — chỉ là tiện lợi; ranh giới bảo mật là máy chủ
 *     (vai + 2FA + giấy phép + quyền + phạm vi mỗi lần gọi). Lỗi máy chủ (STOP_PIN_NGOAI_DAI, INTERLOCK_NGOAI_DAI, …) đi qua `toastTrpcError`.
 *   • Sửa qua hộp thoại bắt buộc lý do ≥ 5 ký tự; CHỈ trường đổi được gửi (trường vắng = giữ, `null` = bỏ khai).
 *   • R1a Task 14 — cột "Faceplate" (khi trang truyền `onFaceplate`): nút trên kênh GHI ĐƯỢC (writable + kênh ra + bật) mở M4. Không
 *     khoá theo `canAct`: operator được ghi kênh mức 1–3 (Q4); máy chủ quyết ở `scadaCommands.request`.
 * Màu chỉ lấy token ISA có sẵn (`--isa-*`, `--alarm-*`); màu không bao giờ là kênh duy nhất (biểu tượng + chữ).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Gauge, Pencil } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BIEN_MAU_TONE } from "./chatLuongHienThi";
import { dinhDangSo, docSoNhap, laLoaiKenhGhi, mucHienThi } from "./kenhHienThi";
import { LOP_O_CHON, TruongLyDo, lyDoDuDai } from "./TruongLyDo";

export type HangKenh = inferRouterOutputs<AppRouter>["scadaKenh"]["danhSach"][number];
type LoaiKenh = HangKenh["loaiKenh"];
type Patch = {
  channelKind?: LoaiKenh | null;
  displayName?: string | null;
  displayFormat?: string | null;
  writeMin?: number | null;
  writeMax?: number | null;
  writeStep?: number | null;
  actuationLevel?: 1 | 3 | 4 | 5 | null;
};

const LOAI_KENH: LoaiKenh[] = ["input", "input_output", "calculated", "calculated_output", "output"];
const MUC_KHAI = [1, 3, 4, 5] as const;
const laKenhSo = (dataType: string) => dataType === "int" || dataType === "float";

/** Cảnh báo nổi bật (ISA-101: màu bão hoà chỉ cho bất thường) — viền trái + biểu tượng + chữ, không chỉ màu. */
export function KhoiCanhBao({ children, tone = "--alarm-high", testId }: { children: React.ReactNode; tone?: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="flex items-start gap-1.5 rounded-sm border-l-4 px-2 py-1 text-xs font-medium whitespace-normal"
      style={{ borderLeftColor: `var(${tone})`, color: `var(${tone})` }}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="text-foreground">{children}</span>
    </div>
  );
}

function HopSuaKenh({ hang, onDong }: { hang: HangKenh; onDong: () => void }) {
  const { t, i18n } = useTranslation();
  const utils = trpc.useUtils();
  const [loai, setLoai] = useState<string>(hang.channelKindKhai ?? "");
  const [ten, setTen] = useState(hang.displayName ?? "");
  const [dinhDang, setDinhDang] = useState(hang.displayFormat ?? "");
  const [min, setMin] = useState(hang.writeMin === null ? "" : String(hang.writeMin));
  const [max, setMax] = useState(hang.writeMax === null ? "" : String(hang.writeMax));
  const [buoc, setBuoc] = useState(hang.writeStep === null ? "" : String(hang.writeStep));
  const [muc, setMuc] = useState<string>(hang.actuationLevel === null ? "" : String(hang.actuationLevel));
  const [lyDo, setLyDo] = useState("");

  const so = laKenhSo(hang.dataType);
  const mutation = trpc.scadaKenh.capNhat.useMutation({
    onSuccess: (res: { changed?: boolean }) => {
      if (res?.changed === false) toast.success(t("scada.kenh.toast.capNhatKhongDoi"));
      else toast.success(t("scada.kenh.toast.capNhat"));
      void utils.scadaKenh.danhSach.invalidate();
      void utils.scadaKenh.cheDo.danhSach.invalidate();
      onDong();
    },
    onError: (e: unknown) => toastTrpcError(e as never),
  });

  // ── Patch: CHỈ trường đổi so với khai báo hiện tại ──
  const patch: Patch = {};
  const vMin = so ? docSoNhap(min) : hang.writeMin;
  const vMax = so ? docSoNhap(max) : hang.writeMax;
  const vBuoc = so ? docSoNhap(buoc) : hang.writeStep;
  const soHopLe = vMin !== "loi" && vMax !== "loi" && vBuoc !== "loi";
  const daiHopLe =
    soHopLe &&
    !(typeof vMin === "number" && typeof vMax === "number" && vMin > vMax) &&
    !(typeof vBuoc === "number" && vBuoc <= 0);
  if ((loai || null) !== hang.channelKindKhai) patch.channelKind = (loai || null) as LoaiKenh | null;
  if ((ten.trim() || null) !== hang.displayName) patch.displayName = ten.trim() || null;
  if ((dinhDang.trim() || null) !== hang.displayFormat) patch.displayFormat = dinhDang.trim() || null;
  if (soHopLe) {
    if (vMin !== hang.writeMin) patch.writeMin = vMin as number | null;
    if (vMax !== hang.writeMax) patch.writeMax = vMax as number | null;
    if (vBuoc !== hang.writeStep) patch.writeStep = vBuoc as number | null;
  }
  const mucMoi = muc === "" ? null : (Number(muc) as 1 | 3 | 4 | 5);
  if (mucMoi !== hang.actuationLevel) patch.actuationLevel = mucMoi;

  const coDoi = Object.keys(patch).length > 0;
  const lyDoDu = lyDoDuDai(lyDo);
  const dangGui = mutation.isPending;
  const gui = () => {
    if (!coDoi || !daiHopLe || !lyDoDu || dangGui) return;
    mutation.mutate({ tagId: hang.tagId, patch, lyDo: lyDo.trim() });
  };
  const id = (s: string) => `scada-kenh-sua-${s}`;

  return (
    <Dialog open onOpenChange={(o) => !o && !dangGui && onDong()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("scada.kenh.dialog.suaTieuDe", { tagKey: hang.tagKey })}</DialogTitle>
          <DialogDescription>{t("scada.kenh.dialog.suaMoTa")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={id("loai")}>{t("scada.kenh.dialog.loaiKenh")}</Label>
            <select id={id("loai")} className={LOP_O_CHON} value={loai} onChange={(e) => setLoai(e.target.value)}>
              <option value="">{t("scada.kenh.dialog.loaiSuyRa")}</option>
              {LOAI_KENH.map((k) => (
                <option key={k} value={k}>
                  {t(`scada.kenh.loai.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("ten")}>{t("scada.kenh.dialog.tenHienThi")}</Label>
            <Input id={id("ten")} maxLength={128} value={ten} onChange={(e) => setTen(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("dinhDang")}>{t("scada.kenh.dialog.dinhDang")}</Label>
            <Input id={id("dinhDang")} maxLength={64} value={dinhDang} onChange={(e) => setDinhDang(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("min")}>{t("scada.kenh.dialog.min")}</Label>
            <Input
              id={id("min")}
              inputMode="decimal"
              autoComplete="off"
              disabled={!so}
              value={min}
              aria-invalid={so && docSoNhap(min) === "loi" ? true : undefined}
              onChange={(e) => setMin(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("max")}>{t("scada.kenh.dialog.max")}</Label>
            <Input
              id={id("max")}
              inputMode="decimal"
              autoComplete="off"
              disabled={!so}
              value={max}
              aria-invalid={so && docSoNhap(max) === "loi" ? true : undefined}
              onChange={(e) => setMax(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("buoc")}>{t("scada.kenh.dialog.buoc")}</Label>
            <Input
              id={id("buoc")}
              inputMode="decimal"
              autoComplete="off"
              disabled={!so}
              value={buoc}
              aria-invalid={so && docSoNhap(buoc) === "loi" ? true : undefined}
              onChange={(e) => setBuoc(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("muc")}>{t("scada.kenh.dialog.muc")}</Label>
            <select id={id("muc")} className={LOP_O_CHON} value={muc} onChange={(e) => setMuc(e.target.value)}>
              <option value="">{t("scada.kenh.dialog.mucChuaKhai")}</option>
              {MUC_KHAI.map((m) => (
                <option key={m} value={String(m)}>
                  {dinhDangSo(m, i18n.language)}
                </option>
              ))}
            </select>
          </div>
          {!so && <p className="text-xs text-muted-foreground sm:col-span-2">{t("scada.kenh.dialog.daiChiSo")}</p>}
          {!soHopLe && <p className="text-xs text-destructive sm:col-span-2">{t("scada.kenh.dialog.soLoi")}</p>}
          {soHopLe && !daiHopLe && <p className="text-xs text-destructive sm:col-span-2">{t("scada.kenh.dialog.daiLoi")}</p>}
        </div>
        <TruongLyDo id={id("ly-do")} value={lyDo} onChange={setLyDo} />
        <DialogFooter>
          <Button variant="outline" onClick={onDong} disabled={dangGui}>
            {t("scada.kenh.dialog.huy")}
          </Button>
          <Button onClick={gui} disabled={!coDoi || !daiHopLe || !lyDoDu || dangGui}>
            {t("scada.kenh.dialog.gui")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface BangKenhProps {
  rows: HangKenh[];
  canAct: boolean;
  /** R1a T14 — mở faceplate M4 của một kênh ghi được (vắng ⇒ không có cột) */
  onFaceplate?: (h: HangKenh) => void;
}

/** Kênh nhận lệnh từ faceplate: cùng điều kiện cổng 3 của request (writable + kênh ra) + đang bật. */
export const kenhGhiDuoc = (h: HangKenh): boolean => h.writable && h.isEnabled && laLoaiKenhGhi(h.loaiKenh);

export function BangKenh({ rows, canAct, onFaceplate }: BangKenhProps) {
  const { t, i18n } = useTranslation();
  const [sua, setSua] = useState<HangKenh | null>(null);
  const so = (v: number | null) => dinhDangSo(v, i18n.language);

  return (
    <>
      <Table data-testid="bang-kenh">
        <TableHeader>
          <TableRow>
            <TableHead>{t("scada.kenh.col.tag")}</TableHead>
            <TableHead>{t("scada.kenh.col.loai")}</TableHead>
            <TableHead>{t("scada.kenh.col.dai")}</TableHead>
            <TableHead>{t("scada.kenh.col.buoc")}</TableHead>
            <TableHead>{t("scada.kenh.col.muc")}</TableHead>
            <TableHead>{t("scada.kenh.col.tenHienThi")}</TableHead>
            {onFaceplate && <TableHead>{t("scada.faceplate.nutMo")}</TableHead>}
            {canAct && <TableHead>{t("scada.kenh.col.hanhDong")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((h) => {
            const muc = mucHienThi(h);
            const coDai = h.writeMin !== null || h.writeMax !== null;
            return (
              <TableRow key={h.tagId} className={h.isEnabled ? undefined : "opacity-60"}>
                <TableCell className="min-w-[200px] align-top">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{h.tagKey}</span>
                    {h.unit && <span className="text-xs text-muted-foreground">{h.unit}</span>}
                    {h.laKenhCheDo && (
                      <span className="rounded-sm border px-1 text-xs" style={{ borderColor: `var(${BIEN_MAU_TONE.ok})` }}>
                        {t("scada.kenh.laKenhCheDo")}
                      </span>
                    )}
                    {!h.isEnabled && <span className="text-xs text-muted-foreground">{t("scada.kenh.daTat")}</span>}
                  </div>
                  {h.canhBaoKenhDung && (
                    <div className="mt-1">
                      <KhoiCanhBao testId="canh-bao-kenh-dung">{t("scada.kenh.canhBaoKenhDung")}</KhoiCanhBao>
                    </div>
                  )}
                </TableCell>
                <TableCell className="align-top whitespace-nowrap text-sm">
                  <div>{t(`scada.kenh.loai.${h.loaiKenh}`)}</div>
                  <div className="text-xs text-muted-foreground">
                    {h.channelKindKhai !== null ? t("scada.kenh.nguon.khai") : t("scada.kenh.nguon.suy")}
                  </div>
                </TableCell>
                <TableCell className="align-top whitespace-nowrap text-sm tabular-nums" data-testid="dai">
                  {coDai ? `${so(h.writeMin)} … ${so(h.writeMax)}` : "—"}
                </TableCell>
                <TableCell className="align-top whitespace-nowrap text-sm tabular-nums" data-testid="buoc">
                  {so(h.writeStep)}
                </TableCell>
                <TableCell className="align-top whitespace-nowrap text-sm tabular-nums">
                  <span data-testid="muc">
                    {muc.kieu === "khai" ? so(muc.muc) : muc.kieu === "macDinhDong" ? t("scada.kenh.mucMacDinhDong") : "—"}
                  </span>
                </TableCell>
                <TableCell className="align-top text-sm">
                  <div>{h.displayName ?? "—"}</div>
                  {h.displayFormat && <div className="text-xs text-muted-foreground">{h.displayFormat}</div>}
                </TableCell>
                {onFaceplate && (
                  <TableCell className="align-top">
                    {kenhGhiDuoc(h) && (
                      <Button variant="outline" size="sm" onClick={() => onFaceplate(h)}>
                        <Gauge className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        {t("scada.faceplate.nutMo")}
                      </Button>
                    )}
                  </TableCell>
                )}
                {canAct && (
                  <TableCell className="align-top">
                    <Button variant="outline" size="sm" onClick={() => setSua(h)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      {t("scada.kenh.nut.sua")}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {sua && <HopSuaKenh key={sua.tagId} hang={sua} onDong={() => setSua(null)} />}
    </>
  );
}
