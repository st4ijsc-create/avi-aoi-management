/**
 * SCADA R0 Task 11 — bảng truyền thông của M10 (`/scada/diag`): một hàng/adapter.
 * Cột: Adapter · Giao thức·endpoint · Sở hữu · Trạng thái (kèm "Mất kết nối 3 ph") · Poll / p95 · Request·lỗi·timeout (1 h) ·
 * Tag tốt / ? / xấu · Lỗi gần nhất · (hành động). Bấm hàng ⇒ ngăn tag (`NganTagAdapter`).
 *
 * Nút "Kết nối lại" / "Tạm tắt" chỉ HIỆN khi `canAct` (engineer|admin + machine_control.canEdit) — KHÔNG phải ranh giới bảo mật (máy chủ
 * kiểm lại vai, 2FA, quyền và phạm vi mỗi lần gọi). Adapter do edge sở hữu: không có nút (trung tâm không điều khiển phiên của nó).
 * Màu chỉ lấy token ISA có sẵn (`--isa-*`, `--alarm-*`); màu không bao giờ là kênh duy nhất (chấm + chữ).
 * SCADA R1b-1 Task 2 fix round 1 — khi có `may` (hàng `scadaKenh.cheDo.danhSach`), adapter được NHÓM theo máy: mỗi máy một hàng đầu có
 * nút "DỪNG MÁY" (`NutDungMay`, cùng hộp xác nhận với faceplate) + cảnh báo khả năng dừng (`CanhBaoKhaNangDung`). Nút hiện với MỌI người
 * xem (máy chủ kiểm vai / quyền / phạm vi) — không phụ thuộc `canAct`.
 */
import type { inferRouterOutputs } from "@trpc/server";
import { useTranslation } from "react-i18next";
import { Plug, Power } from "lucide-react";
import type { AppRouter } from "../../../../server/routers";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BIEN_MAU_TONE, nhanTrangThai, type DonViThoiGian } from "./chatLuongHienThi";
import { NutDungMay, type KhaNangDung } from "./DungMay";

export type HangDiag = inferRouterOutputs<AppRouter>["scadaDiag"]["danhSach"][number];

/** Tên hiển thị của edge: mã, hoặc id nếu edge không còn mã. */
export function tenEdge(h: HangDiag): string | null {
  return h.soHuu.loai === "edge" ? (h.soHuu.edgeCode ?? String(h.soHuu.edgeNodeId)) : null;
}

/** Chỉ báo lỗi cho bộ lọc "chỉ lỗi": mất kết nối / không rõ / có tag xấu / có lỗi hoặc timeout trong 1 h. Edge và adapter tắt KHÔNG phải lỗi. */
export function coLoi(h: HangDiag): boolean {
  if (h.trangThai === "edge_chua_co_so_lieu" || h.trangThai === "disabled") return false;
  return h.trangThai === "lost" || h.trangThai === "khong_ro" || h.tag.xau > 0 || h.boDem1h.loi > 0 || h.boDem1h.timeout > 0;
}

export function useDonViThoiGian(): DonViThoiGian {
  const { t } = useTranslation();
  return {
    giay: t("scada.diag.donVi.giay"),
    phut: t("scada.diag.donVi.phut"),
    gio: t("scada.diag.donVi.gio"),
    ngay: t("scada.diag.donVi.ngay"),
  };
}

export function ChipTrangThai({ hang, now }: { hang: HangDiag; now: number }) {
  const { t } = useTranslation();
  const donVi = useDonViThoiGian();
  const tuMs = hang.tu ? Date.parse(hang.tu) : null;
  const nt = nhanTrangThai(hang.trangThai, Number.isNaN(tuMs) ? null : tuMs, now, donVi);
  const mau = `var(${BIEN_MAU_TONE[nt.tone]})`;
  const edge = tenEdge(hang);
  const chu = t(nt.nhan, { edgeCode: edge ?? "" });
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: mau }} data-tone={nt.tone}>
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: mau }} aria-hidden="true" />
      <span>
        {chu}
        {nt.thoiGian ? ` ${nt.thoiGian}` : ""}
      </span>
    </span>
  );
}

/** Hàng máy cho nhóm + nút DỪNG MÁY (tập con của `scadaKenh.cheDo.danhSach`). */
export interface MayDung {
  machineId: number;
  code: string;
  ten: string;
  coGhimStop?: boolean;
  soAdapterGhimStop?: number;
  khaNangDung?: KhaNangDung;
}

export interface BangTruyenThongProps {
  rows: HangDiag[];
  /** R1b-1 T2 fix round 1 — có ⇒ nhóm theo máy, mỗi máy một hàng đầu có nút DỪNG MÁY */
  may?: MayDung[];
  now: number;
  canAct: boolean;
  onChon: (h: HangDiag) => void;
  onKetNoiLai: (h: HangDiag) => void;
  onTamTat: (h: HangDiag) => void;
}

export function BangTruyenThong({ rows, now, canAct, onChon, onKetNoiLai, onTamTat, may }: BangTruyenThongProps) {
  const { t } = useTranslation();
  const soCot = canAct ? 9 : 8;
  // nhóm theo máy giữ thứ tự xuất hiện; adapter không gắn máy: không có hàng đầu (không có máy để dừng)
  const nhom: Array<{ machineId: number | null; hangs: HangDiag[] }> = [];
  if (may) {
    for (const h of rows) {
      const g = nhom.find((x) => x.machineId === (h.machineId ?? null));
      if (g) g.hangs.push(h);
      else nhom.push({ machineId: h.machineId ?? null, hangs: [h] });
    }
  } else nhom.push({ machineId: null, hangs: rows });
  const hangDauMay = (machineId: number, hangs: HangDiag[]) => {
    const m = may?.find((x) => x.machineId === machineId);
    return (
      <TableRow key={`may-${machineId}`} data-testid={`may-dung-${machineId}`} className="bg-muted/30 hover:bg-muted/30">
        <TableCell colSpan={soCot}>
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-[160px] pt-1">
              <div className="font-semibold">{t("scada.dungMay.mayTieuDe", { code: m?.code ?? `#${machineId}` })}</div>
              {m?.ten && <div className="text-xs text-muted-foreground">{m.ten}</div>}
            </div>
            <div className="min-w-[220px] max-w-md flex-1">
              <NutDungMay
                machineId={machineId}
                tenMay={m ? `${m.code} · ${m.ten}` : `#${machineId}`}
                soAdapter={m?.soAdapterGhimStop}
                coGhimStop={m?.coGhimStop}
                khaNang={m?.khaNangDung}
                laEdge={hangs.some((h) => h.soHuu.loai === "edge")}
              />
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("scada.diag.col.adapter")}</TableHead>
          <TableHead>{t("scada.diag.col.giaoThuc")}</TableHead>
          <TableHead>{t("scada.diag.col.soHuu")}</TableHead>
          <TableHead>{t("scada.diag.col.trangThai")}</TableHead>
          <TableHead>{t("scada.diag.col.poll")}</TableHead>
          <TableHead>{t("scada.diag.col.request")}</TableHead>
          <TableHead>{t("scada.diag.col.tag")}</TableHead>
          <TableHead>{t("scada.diag.col.loiGanNhat")}</TableHead>
          {canAct && <TableHead>{t("scada.diag.col.hanhDong")}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {nhom.flatMap((g) => [
          ...(may && g.machineId !== null ? [hangDauMay(g.machineId, g.hangs)] : []),
          ...g.hangs.map((h) => {
          const edge = tenEdge(h);
          const hanhDong = canAct && h.soHuu.loai !== "edge";
          return (
            <TableRow
              key={h.adapterId}
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => onChon(h)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onChon(h);
                }
              }}
            >
              <TableCell>
                <div className="font-medium">{h.code}</div>
                <div className="text-xs text-muted-foreground">{h.ten}</div>
              </TableCell>
              <TableCell>
                <div className="text-sm">{h.protocol}</div>
                <div className="max-w-[220px] truncate text-xs text-muted-foreground" title={h.endpoint}>
                  {h.endpoint}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm">
                {edge ? t("scada.diag.soHuu.edge", { code: edge }) : t("scada.diag.soHuu.trungTam")}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <ChipTrangThai hang={h} now={now} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm tabular-nums">
                {edge ? "—" : `${h.pollMs} ms / ${h.p95Ms === null || h.p95Ms === undefined ? "—" : `${h.p95Ms} ms`}`}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm tabular-nums">
                {edge ? "—" : `${h.boDem1h.request} · ${h.boDem1h.loi} · ${h.boDem1h.timeout}`}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm tabular-nums">
                {edge ? "—" : `${h.tag.tot} / ${h.tag.nghiNgo} / ${h.tag.xau}`}
              </TableCell>
              <TableCell className="max-w-[240px] truncate text-sm" title={h.loi ?? ""}>
                {h.loi ?? "—"}
              </TableCell>
              {canAct && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {hanhDong && (
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => onKetNoiLai(h)}>
                        <Plug className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        {t("scada.diag.nut.ketNoiLai")}
                      </Button>
                      {h.trangThai !== "disabled" && (
                        <Button variant="outline" size="sm" onClick={() => onTamTat(h)}>
                          <Power className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                          {t("scada.diag.nut.tamTat")}
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
          }),
        ])}
      </TableBody>
    </Table>
  );
}
