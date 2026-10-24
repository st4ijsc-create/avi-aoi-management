/**
 * SCADA R1a Task 13 — khối "Kênh chế độ" theo máy (M12): mỗi máy trong phạm vi một hàng — tag chế độ, giá trị REMOTE, chế độ HIỆN TẠI
 * (REMOTE | LOCAL) kèm LÝ DO bằng chữ người đọc. Đủ 9 lý do của `cheDoMay` (`KHOA_LY_DO`); `chua_khai` ⇒ "Chưa khai ⇒ coi như LOCAL".
 *
 * Cảnh báo NGUỒN (`canhBaoNguon`: deadband | edge | bao_khi_doi) hiện trong khối VÀ trong hộp thoại đặt kênh: kênh chế độ nên là tag poll
 * định kỳ trên adapter trung tâm. CHỈ cảnh báo — không chặn lưu (điều phối 2026-10-24).
 *
 * Nút "Đặt kênh chế độ" / "Gỡ" chỉ HIỆN khi `canAct` (engineer|admin + machine_control.canEdit; máy chủ vẫn kiểm lại vai, 2FA, quyền, phạm vi).
 * Kênh bị che (`kenhAn`: ngoài phạm vi người xem / sai máy) ⇒ chỉ hiện chế độ + lý do, không lộ adapter / tag.
 * R1b-1 Task 2 — máy không có adapter bật nào mang ghim DỪNG (`coGhimStop` false) ⇒ cảnh báo cấp máy "Máy chưa ghim STOP — nút dừng HMI
 * không dùng được" trong ô chế độ.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { KhoiCanhBao } from "./BangKenh";
import { KHOA_LY_DO, epGiaTriRemote, toneCheDo, type LyDoCheDo } from "./kenhHienThi";
import { LOP_O_CHON, TruongLyDo, lyDoDuDai } from "./TruongLyDo";
import { CanhBaoChuaGhimStop } from "./DungMay";

export type HangCheDo = inferRouterOutputs<AppRouter>["scadaKenh"]["cheDo"]["danhSach"][number];
type CanhBaoNguon = HangCheDo["canhBaoNguon"];

/** Adapter trong phạm vi người xem (từ `scadaDiag.danhSach`) — đủ để chọn adapter của máy và biết adapter do edge sở hữu. */
export interface AdapterChon {
  adapterId: number;
  code: string;
  ten: string;
  machineId: number | null;
  edge: boolean;
}

/** Cảnh báo nguồn: câu điều phối + lý do cụ thể (tag có deadband / adapter edge / giao thức báo-khi-đổi). */
export function CanhBaoNguonKenh({ nguon }: { nguon: Exclude<CanhBaoNguon, null> }) {
  const { t } = useTranslation();
  return (
    <KhoiCanhBao tone="--alarm-medium" testId="canh-bao-nguon">
      <span className="block">{t("scada.kenh.canhBaoNguon")}</span>
      <span className="block font-normal text-muted-foreground">{t(`scada.kenh.canhBaoNguonLoai.${nguon}`)}</span>
    </KhoiCanhBao>
  );
}

type Hop = { kieu: "dat" | "go"; may: HangCheDo };

function HopDatKenhCheDo({ may, adapters, onDong }: { may: HangCheDo; adapters: AdapterChon[]; onDong: () => void }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const cuaMay = adapters.filter((a) => a.machineId === may.machineId);
  const [adapterId, setAdapterId] = useState<number | null>(may.kenh?.adapterId ?? cuaMay[0]?.adapterId ?? null);
  const [tagKey, setTagKey] = useState(may.kenh?.tagKey ?? "");
  const [gia, setGia] = useState(may.kenh ? String(may.kenh.giaTriRemote) : "");
  const [lyDo, setLyDo] = useState("");

  const tagQ = trpc.scadaKenh.danhSach.useQuery({ adapterId: adapterId ?? 0 }, { enabled: adapterId !== null });
  const tags = ((tagQ.data ?? []) as Array<{ tagKey: string; dataType: string; isEnabled: boolean }>).filter((x) => x.isEnabled);
  const tag = tags.find((x) => x.tagKey === tagKey) ?? null;
  const ep = tag ? epGiaTriRemote(tag.dataType, gia) : ({ ok: false } as const);

  const mutation = trpc.scadaKenh.cheDo.dat.useMutation({
    onSuccess: () => {
      toast.success(t("scada.kenh.toast.datCheDo"));
      void utils.scadaKenh.cheDo.danhSach.invalidate();
      void utils.scadaKenh.danhSach.invalidate();
      onDong();
    },
    onError: (e: unknown) => toastTrpcError(e as never),
  });

  // Cảnh báo nguồn: kênh đang chọn trùng kênh hiện có (máy chủ đã tính cờ) HOẶC adapter đang chọn do edge sở hữu.
  const dangChon = cuaMay.find((a) => a.adapterId === adapterId) ?? null;
  const trungKenhHienCo = !!may.kenh && may.kenh.adapterId === adapterId && may.kenh.tagKey === tagKey;
  const canhBao: CanhBaoNguon = trungKenhHienCo && may.canhBaoNguon ? may.canhBaoNguon : dangChon?.edge ? "edge" : null;

  const lyDoDu = lyDoDuDai(lyDo);
  const dangGui = mutation.isPending;
  const hopLe = adapterId !== null && !!tag && ep.ok && lyDoDu && !dangGui;
  const gui = () => {
    if (!hopLe || adapterId === null || !ep.ok) return;
    mutation.mutate({ machineId: may.machineId, adapterId, tagKey, giaTriRemote: ep.giaTri, lyDo: lyDo.trim() });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !dangGui && onDong()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("scada.kenh.dialog.datTieuDe", { code: may.code })}</DialogTitle>
          <DialogDescription>{t("scada.kenh.dialog.datMoTa")}</DialogDescription>
        </DialogHeader>
        {cuaMay.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("scada.kenh.dialog.khongCoAdapterMay")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="scada-kenh-dat-adapter">{t("scada.kenh.dialog.adapter")}</Label>
              <select
                id="scada-kenh-dat-adapter"
                className={LOP_O_CHON}
                value={adapterId === null ? "" : String(adapterId)}
                onChange={(e) => {
                  setAdapterId(e.target.value === "" ? null : Number(e.target.value));
                  setTagKey("");
                  setGia("");
                }}
              >
                {cuaMay.map((a) => (
                  <option key={a.adapterId} value={String(a.adapterId)}>
                    {a.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="scada-kenh-dat-tag">{t("scada.kenh.dialog.tag")}</Label>
              <select id="scada-kenh-dat-tag" className={LOP_O_CHON} value={tagKey} onChange={(e) => setTagKey(e.target.value)}>
                <option value="" />
                {tags.map((x) => (
                  <option key={x.tagKey} value={x.tagKey}>
                    {x.tagKey}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="scada-kenh-dat-gia">{t("scada.kenh.dialog.giaTriRemote")}</Label>
              <Input id="scada-kenh-dat-gia" value={gia} onChange={(e) => setGia(e.target.value)} disabled={!tag} />
              {tag && gia.trim() !== "" && !ep.ok && <p className="text-xs text-destructive">{t("scada.kenh.dialog.giaTriSai")}</p>}
            </div>
            {canhBao && (
              <div className="sm:col-span-2">
                <CanhBaoNguonKenh nguon={canhBao} />
              </div>
            )}
          </div>
        )}
        <TruongLyDo id="scada-kenh-dat-ly-do" value={lyDo} onChange={setLyDo} />
        <DialogFooter>
          <Button variant="outline" onClick={onDong} disabled={dangGui}>
            {t("scada.kenh.dialog.huy")}
          </Button>
          <Button onClick={gui} disabled={!hopLe}>
            {t("scada.kenh.dialog.gui")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HopGoKenhCheDo({ may, onDong }: { may: HangCheDo; onDong: () => void }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [lyDo, setLyDo] = useState("");
  const mutation = trpc.scadaKenh.cheDo.go.useMutation({
    onSuccess: () => {
      toast.success(t("scada.kenh.toast.goCheDo"));
      void utils.scadaKenh.cheDo.danhSach.invalidate();
      void utils.scadaKenh.danhSach.invalidate();
      onDong();
    },
    onError: (e: unknown) => toastTrpcError(e as never),
  });
  const lyDoDu = lyDoDuDai(lyDo);
  const dangGui = mutation.isPending;
  return (
    <Dialog open onOpenChange={(o) => !o && !dangGui && onDong()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("scada.kenh.dialog.goTieuDe", { code: may.code })}</DialogTitle>
          <DialogDescription>{t("scada.kenh.dialog.goMoTa")}</DialogDescription>
        </DialogHeader>
        <TruongLyDo id="scada-kenh-go-ly-do" value={lyDo} onChange={setLyDo} />
        <DialogFooter>
          <Button variant="outline" onClick={onDong} disabled={dangGui}>
            {t("scada.kenh.dialog.huy")}
          </Button>
          <Button
            onClick={() => lyDoDu && !dangGui && mutation.mutate({ machineId: may.machineId, lyDo: lyDo.trim() })}
            disabled={!lyDoDu || dangGui}
          >
            {t("scada.kenh.dialog.gui")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface KenhCheDoMayProps {
  rows: HangCheDo[];
  adapters: AdapterChon[];
  canAct: boolean;
}

export function KenhCheDoMay({ rows, adapters, canAct }: KenhCheDoMayProps) {
  const { t } = useTranslation();
  const [hop, setHop] = useState<Hop | null>(null);
  const maAdapter = (id: number) => adapters.find((a) => a.adapterId === id)?.code ?? `#${id}`;

  return (
    <div data-testid="khoi-che-do">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("scada.kenh.cheDo.col.may")}</TableHead>
            <TableHead>{t("scada.kenh.cheDo.col.adapter")}</TableHead>
            <TableHead>{t("scada.kenh.cheDo.col.tag")}</TableHead>
            <TableHead>{t("scada.kenh.cheDo.col.giaTriRemote")}</TableHead>
            <TableHead>{t("scada.kenh.cheDo.col.cheDo")}</TableHead>
            {canAct && <TableHead>{t("scada.kenh.cheDo.col.hanhDong")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((m) => {
            const mau = `var(${BIEN_MAU_TONE[toneCheDo(m.cheDo, m.lyDo)]})`;
            const khoaLyDo = KHOA_LY_DO[m.lyDo as LyDoCheDo];
            return (
              <TableRow key={m.machineId}>
                <TableCell className="align-top">
                  <div className="font-medium">{m.code}</div>
                  <div className="text-xs text-muted-foreground">{m.ten}</div>
                </TableCell>
                <TableCell className="align-top text-sm">{m.kenh ? maAdapter(m.kenh.adapterId) : "—"}</TableCell>
                <TableCell className="align-top text-sm">
                  {m.kenh ? m.kenh.tagKey : m.kenhAn ? <span className="text-muted-foreground">{t("scada.kenh.cheDo.kenhAn")}</span> : "—"}
                </TableCell>
                <TableCell className="align-top text-sm tabular-nums" data-testid="gia-tri-remote">
                  {m.kenh ? String(m.kenh.giaTriRemote) : "—"}
                </TableCell>
                <TableCell className="min-w-[260px] align-top">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: mau }} data-tone={toneCheDo(m.cheDo, m.lyDo)}>
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: mau }} aria-hidden="true" />
                    {m.cheDo}
                  </span>
                  <div className="text-xs text-muted-foreground">{khoaLyDo ? t(khoaLyDo) : t("scada.kenh.cheDo.khongRo", { lyDo: m.lyDo })}</div>
                  {m.canhBaoNguon && (
                    <div className="mt-1">
                      <CanhBaoNguonKenh nguon={m.canhBaoNguon} />
                    </div>
                  )}
                  {m.coGhimStop === false && (
                    <div className="mt-1">
                      <CanhBaoChuaGhimStop />
                    </div>
                  )}
                </TableCell>
                {canAct && (
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-1">
                      <Button variant="outline" size="sm" onClick={() => setHop({ kieu: "dat", may: m })}>
                        {t("scada.kenh.nut.datKenhCheDo")}
                      </Button>
                      {(m.kenh || m.kenhAn) && (
                        <Button variant="outline" size="sm" onClick={() => setHop({ kieu: "go", may: m })}>
                          {t("scada.kenh.nut.goKenhCheDo")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {hop?.kieu === "dat" && <HopDatKenhCheDo key={hop.may.machineId} may={hop.may} adapters={adapters} onDong={() => setHop(null)} />}
      {hop?.kieu === "go" && <HopGoKenhCheDo key={hop.may.machineId} may={hop.may} onDong={() => setHop(null)} />}
    </div>
  );
}
