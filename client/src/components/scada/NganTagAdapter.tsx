/**
 * SCADA R0 Task 11 — ngăn tag của một adapter (M10): giá trị, chất lượng, tuổi, statusCode; nút "100 mẫu thô"; và (Lab) khối
 * "đặt lỗi stub" CHỈ khi API báo `labStub` cho hàng này VÀ người xem là engineer/admin có quyền sửa (`canAct`; máy chủ vẫn kiểm lại).
 * final M2 — đặt / xoá lỗi Lab đi qua hộp lý do (cùng mẫu với Kết nối lại / Tạm tắt ở `ScadaDiag.tsx`): lý do 5..300 ký tự, ghi audit.
 *
 * R1a Task 14 — nút "Faceplate" trên hàng tag GHI ĐƯỢC (writable + kênh ra + bật, theo `scadaKenh.danhSach`) mở M4 (`Faceplate`).
 *   Không khoá theo vai: operator được ghi kênh mức 1–3 (Q4) — máy chủ quyết (sàn vai + quyền + 2FA + phạm vi ở `request`).
 *
 * Hiển thị chất lượng theo D10 (xem `chatLuongHienThi.ts`): uncertain ⇒ "?" + viền chấm xám; bad/cũ ⇒ gạch tím + mờ. Tuổi âm/null ⇒ "—".
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinhDangTuoi, hienChatLuong, kieuVien, type VienChatLuong } from "./chatLuongHienThi";
import { ChipTrangThai, tenEdge, useDonViThoiGian, type HangDiag } from "./BangTruyenThong";
import { laLoaiKenhGhi } from "./kenhHienThi";
import { Faceplate } from "./Faceplate";
import type { HangKenh } from "./BangKenh";

const KY_TU_TOI_DA_LAB = 128;
/** Khớp `lyDoInput` ở máy chủ (`trim().min(5).max(300)`), như hộp lý do của ScadaDiag. */
const LY_DO_TOI_THIEU = 5;
const LY_DO_TOI_DA = 300;

/** Kiểu CSS của ô giá trị theo viền D10 — chuyển sang chatLuongHienThi.ts (R1a T14, dùng chung với Faceplate); giữ tên xuất ở đây. */
export { kieuVien };

function chuoiGiaTri(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** "TAG=giá trị" mỗi dòng ⇒ bản đồ giá trị: số / true|false / còn lại là chuỗi. Dòng sai dạng bị bỏ. */
export function phanTichGiaTri(text: string): Record<string, number | boolean | string> | undefined {
  const out: Record<string, number | boolean | string> = {};
  for (const dong of text.split("\n")) {
    const i = dong.indexOf("=");
    if (i <= 0) continue;
    const k = dong.slice(0, i).trim();
    const raw = dong.slice(i + 1).trim();
    if (!k || k.length > KY_TU_TOI_DA_LAB) continue;
    out[k] = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
const danhSachTag = (text: string): string[] | undefined => {
  const ds = text.split(",").map((s) => s.trim()).filter(Boolean);
  return ds.length > 0 ? ds : undefined;
};

type LoiLab = { matKetNoi?: boolean; tagXau?: string[]; tagNghiNgo?: string[]; giaTri?: Record<string, number | boolean | string> };

function KhoiLab({ adapterId, code }: { adapterId: number; code: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [matKetNoi, setMatKetNoi] = useState(false);
  const [tagXau, setTagXau] = useState("");
  const [tagNghiNgo, setTagNghiNgo] = useState("");
  const [giaTri, setGiaTri] = useState("");
  /** Thao tác đang chờ lý do: lỗi sẽ gửi + loại hộp ("apDung" / "xoaLoi"). */
  const [cho, setCho] = useState<{ kieu: "apDung" | "xoaLoi"; loi: LoiLab } | null>(null);
  const [lyDo, setLyDo] = useState("");
  const dongHop = () => {
    setCho(null);
    setLyDo("");
  };
  const dat = trpc.scadaDiag.datLoiStub.useMutation({
    onSuccess: (r: { apDung: boolean }) => {
      if (r?.apDung === false) toast.warning(t("scada.diag.lab.khongChay"));
      else toast.success(t("scada.diag.lab.daDat"));
      void utils.scadaDiag.danhSach.invalidate();
      void utils.scadaDiag.tagCuaAdapter.invalidate();
      dongHop();
    },
    onError: (e: unknown) => toastTrpcError(e as never),
  });
  const lyDoCat = lyDo.trim();
  const lyDoDu = lyDoCat.length >= LY_DO_TOI_THIEU;
  const apDung = () => {
    const loi: LoiLab = {};
    if (matKetNoi) loi.matKetNoi = true;
    const x = danhSachTag(tagXau);
    if (x) loi.tagXau = x;
    const n = danhSachTag(tagNghiNgo);
    if (n) loi.tagNghiNgo = n;
    const g = phanTichGiaTri(giaTri);
    if (g) loi.giaTri = g;
    setCho({ kieu: "apDung", loi });
  };
  const xoaLoi = () => {
    setMatKetNoi(false);
    setTagXau("");
    setTagNghiNgo("");
    setGiaTri("");
    setCho({ kieu: "xoaLoi", loi: {} });
  };
  const gui = () => {
    if (!cho || !lyDoDu || dat.isPending) return;
    dat.mutate({ adapterId, loi: cho.loi, lyDo: lyDoCat });
  };
  return (
    <section className="mt-4 space-y-3 rounded-md border border-dashed p-3" aria-labelledby="lab-tieu-de">
      <h3 id="lab-tieu-de" className="text-sm font-semibold">
        {t("scada.diag.lab.tieuDe")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("scada.diag.lab.moTa")}</p>
      <div className="flex items-center gap-2">
        <Switch id="lab-mat-ket-noi" checked={matKetNoi} onCheckedChange={setMatKetNoi} aria-label={t("scada.diag.lab.matKetNoi")} />
        <Label htmlFor="lab-mat-ket-noi">{t("scada.diag.lab.matKetNoi")}</Label>
      </div>
      <div className="space-y-1">
        <Label htmlFor="lab-tag-xau">{t("scada.diag.lab.tagXau")}</Label>
        <Input id="lab-tag-xau" value={tagXau} onChange={(e) => setTagXau(e.target.value)} placeholder={t("scada.diag.lab.tagPlaceholder")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lab-tag-nghi-ngo">{t("scada.diag.lab.tagNghiNgo")}</Label>
        <Input id="lab-tag-nghi-ngo" value={tagNghiNgo} onChange={(e) => setTagNghiNgo(e.target.value)} placeholder={t("scada.diag.lab.tagPlaceholder")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lab-gia-tri">{t("scada.diag.lab.giaTri")}</Label>
        <Textarea id="lab-gia-tri" rows={3} value={giaTri} onChange={(e) => setGiaTri(e.target.value)} placeholder="TAG=12.5" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={apDung} disabled={dat.isPending}>
          {t("scada.diag.lab.apDung")}
        </Button>
        <Button size="sm" variant="outline" onClick={xoaLoi} disabled={dat.isPending}>
          {t("scada.diag.lab.xoaLoi")}
        </Button>
      </div>
      <Dialog open={!!cho} onOpenChange={(o) => !o && !dat.isPending && dongHop()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {cho ? t(cho.kieu === "apDung" ? "scada.diag.lab.dialogApDungTieuDe" : "scada.diag.lab.dialogXoaLoiTieuDe", { code }) : ""}
            </DialogTitle>
            <DialogDescription>{t("scada.diag.lab.dialogMoTa")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="scada-lab-ly-do">{t("scada.diag.dialog.lyDo")}</Label>
            <Textarea
              id="scada-lab-ly-do"
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
            <Button variant="outline" onClick={dongHop} disabled={dat.isPending}>
              {t("scada.diag.dialog.huy")}
            </Button>
            <Button onClick={gui} disabled={!lyDoDu || dat.isPending}>
              {t("scada.diag.dialog.gui")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MauTho({ adapterId, tagKey }: { adapterId: number; tagKey: string }) {
  const { t } = useTranslation();
  const q = trpc.scadaDiag.mauTho.useQuery({ adapterId, tagKey });
  const mau = q.data ?? [];
  return (
    <section className="mt-4" aria-label={t("scada.diag.mauTho.tieuDe", { tag: tagKey })}>
      <h3 className="mb-1 text-sm font-semibold">{t("scada.diag.mauTho.tieuDe", { tag: tagKey })}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("scada.diag.mauTho.thoiGian")}</TableHead>
            <TableHead>{t("scada.diag.tag.giaTri")}</TableHead>
            <TableHead>{t("scada.diag.tag.chatLuong")}</TableHead>
            <TableHead>{t("scada.diag.tag.statusCode")}</TableHead>
            <TableHead>{t("scada.diag.mauTho.nguonGio")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mau.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                {q.isLoading ? t("common.loading") : t("scada.diag.mauTho.trong")}
              </TableCell>
            </TableRow>
          )}
          {mau.map((m, i) => (
            <TableRow key={`${m.ts}-${i}`}>
              <TableCell className="whitespace-nowrap text-xs">{new Date(m.ts).toLocaleTimeString()}</TableCell>
              <TableCell className="text-sm">{chuoiGiaTri(m.giaTri)}</TableCell>
              <TableCell className="text-xs">{m.quality ?? "—"}</TableCell>
              <TableCell className="text-xs">{m.statusCode ?? "—"}</TableCell>
              <TableCell className="text-xs">{m.tsSource ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

export interface NganTagAdapterProps {
  hang: HangDiag | null;
  now: number;
  canAct: boolean;
  onDong: () => void;
}

export function NganTagAdapter({ hang, now, canAct, onDong }: NganTagAdapterProps) {
  const { t, i18n } = useTranslation();
  const donVi = useDonViThoiGian();
  const [mauTag, setMauTag] = useState<{ adapterId: number; tagKey: string } | null>(null);
  const [fpTag, setFpTag] = useState<{ adapterId: number; tagKey: string } | null>(null);
  const adapterId = hang?.adapterId ?? 0;
  // Đóng ngăn (hang = null) hoặc đổi adapter ⇒ bỏ tag mẫu thô đang xem: mở lại không bắn `mauTho` cũ / không hiện bảng cũ.
  useEffect(() => {
    setMauTag(null);
    setFpTag(null);
  }, [hang?.adapterId]);
  const q = trpc.scadaDiag.tagCuaAdapter.useQuery({ adapterId }, { enabled: !!hang, refetchInterval: 2000 });
  const tags = q.data ?? [];
  // R1a T14 — tag nào ghi được (cùng điều kiện cổng 3 của request: writable + kênh ra + bật; máy chủ vẫn kiểm lại)
  const coBang = !!hang && hang.trangThai !== "edge_chua_co_so_lieu";
  const kenhQ = trpc.scadaKenh.danhSach.useQuery({ adapterId }, { enabled: coBang });
  const ghiDuoc = new Set(
    ((kenhQ.data ?? []) as HangKenh[]).filter((k) => k.writable && k.isEnabled && laLoaiKenhGhi(k.loaiKenh)).map((k) => k.tagKey),
  );
  const fpDangMo = fpTag && hang && fpTag.adapterId === hang.adapterId ? fpTag : null;
  const mauDangXem = mauTag && hang && mauTag.adapterId === hang.adapterId ? mauTag : null;
  return (
    <Sheet open={!!hang} onOpenChange={(o) => !o && onDong()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        {hang && (
          <>
            <SheetHeader>
              <SheetTitle>{t("scada.diag.tag.tieuDe", { code: hang.code })}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <ChipTrangThai hang={hang} now={now} />
                <span>{hang.protocol}</span>
                <span className="break-all">{hang.endpoint}</span>
              </SheetDescription>
            </SheetHeader>
            <div className="px-4">
              {hang.trangThai === "edge_chua_co_so_lieu" ? (
                <p className="text-sm text-muted-foreground">{t("scada.diag.edgeChuaCoSoLieu", { edgeCode: tenEdge(hang) ?? "" })}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("scada.diag.tag.tag")}</TableHead>
                      <TableHead>{t("scada.diag.tag.giaTri")}</TableHead>
                      <TableHead>{t("scada.diag.tag.chatLuong")}</TableHead>
                      <TableHead>{t("scada.diag.tag.tuoi")}</TableHead>
                      <TableHead>{t("scada.diag.tag.statusCode")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tags.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          {q.isLoading ? t("common.loading") : t("scada.diag.tag.trong")}
                        </TableCell>
                      </TableRow>
                    )}
                    {tags.map((g) => {
                      const co = g.q !== null && g.q !== undefined;
                      const ch = co ? hienChatLuong(g.q as "good" | "uncertain" | "bad", g.stale) : null;
                      const vien: VienChatLuong = ch?.vien ?? "none";
                      return (
                        <TableRow key={g.tagKey}>
                          <TableCell>
                            <div className="text-sm font-medium">{g.tagKey}</div>
                            <div className="text-xs text-muted-foreground">{g.address}</div>
                          </TableCell>
                          <TableCell>
                            <span data-testid="gia-tri" data-vien={vien} className="text-sm tabular-nums" style={kieuVien(vien, ch?.kieu === "cu")}>
                              {chuoiGiaTri(g.v)}
                              {ch?.kieu === "nghi_ngo" ? " ?" : ""}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">{co ? t(`scada.diag.chatLuong.${ch!.kieu}`) : t("scada.diag.chatLuong.chuaCo")}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs tabular-nums" data-testid="tuoi">
                            {dinhDangTuoi(g.ageMs, donVi, i18n.language)}
                          </TableCell>
                          <TableCell className="text-xs">{g.statusCode ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <Button size="sm" variant="ghost" onClick={() => setMauTag({ adapterId: hang.adapterId, tagKey: g.tagKey })}>
                              {t("scada.diag.nut.mauTho")}
                            </Button>
                            {ghiDuoc.has(g.tagKey) && (
                              <Button size="sm" variant="outline" onClick={() => setFpTag({ adapterId: hang.adapterId, tagKey: g.tagKey })}>
                                {t("scada.faceplate.nutMo")}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              {mauDangXem && <MauTho adapterId={mauDangXem.adapterId} tagKey={mauDangXem.tagKey} />}
              {canAct && hang.labStub && <KhoiLab adapterId={hang.adapterId} code={hang.code} />}
              {fpDangMo && (
                <Faceplate
                  adapterId={fpDangMo.adapterId}
                  tagKey={fpDangMo.tagKey}
                  machineId={hang.machineId}
                  edgeCode={tenEdge(hang)}
                  onDong={() => setFpTag(null)}
                />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
