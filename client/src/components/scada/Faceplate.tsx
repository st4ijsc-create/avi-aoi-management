/**
 * SCADA R1a Task 14 — M4 faceplate của MỘT kênh (báo cáo §4.5). Bước 1 của lệnh ghi tag từ HMI.
 *
 *   • Đầu: kênh (tên hiển thị) · máy · chế độ máy (huy hiệu chữ xám — §4.10).
 *   • Giá trị sống (`scadaDiag.tagCuaAdapter`, 2 s) kèm chất lượng + tuổi, hiển thị chất lượng theo D10 (`hienChatLuong` / `kieuVien`).
 *   • Dải + bước + mức tác động (`scadaKenh.danhSach`: `mucHieuLuc` của MÁY CHỦ, không tự suy).
 *   • Chế độ máy (`scadaKenh.cheDo.danhSach`, 5 s): LOCAL ⇒ ẨN MỌI lệnh, hiện "Đang điều khiển tại chỗ" + lý do. Không thấy máy / adapter
 *     không gắn máy / đang tải ⇒ coi như LOCAL (fail-closed; máy chủ vẫn là ranh giới thật — cổng 7 của `request`).
 *   • Ô nhập theo `displayFormat`: số = ô nhập + dải; `bool:Tắt,Bật` = hai nút có nhãn; `enum:A,B,C` = mỗi giá trị một nút.
 *   • Lý do ≥ 5 ký tự nhập TRƯỚC khi gọi `scadaCommands.request`; "Đổi…" gọi request rồi mở M5 (`HopThoaiLenh`).
 *   • Từ chối của request ⇒ `ThongBaoLoiLenh` (lý do + cách xử lý). OFF_STEP ⇒ nút "Dùng {goiY}" CHỈ điền ô — người dùng vẫn phải bấm
 *     "Đổi…" lại (không tự gửi, không tự làm tròn).
 *   • Danh sách "Điều kiện cho phép" (request chạy khô) để R1b.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BIEN_MAU_VIEN_XAM, dinhDangTuoi, hienChatLuong, kieuVien, type VienChatLuong } from "./chatLuongHienThi";
import { useDonViThoiGian } from "./BangTruyenThong";
import {
  chiSoEnum,
  dinhDangSo,
  docSoNhap,
  enumDungDuoc,
  giaTriBool,
  giaTriEnum,
  laLoaiKenhGhi,
  mucHienThi,
  phanTichDinhDang,
} from "./kenhHienThi";
import { TruongLyDo, lyDoDuDai } from "./TruongLyDo";
import { HopThoaiLenh, ThongBaoLoiLenh, useDinhDangGiaTri, type YeuCauLenh } from "./HopThoaiLenh";
import { khoaLyDoLocal, moTaLoiLenh, type MoTaLoi } from "./ketQuaLenh";
import type { HangKenh } from "./BangKenh";

const CHU_KY_GIA_TRI_MS = 2000;
const CHU_KY_CHE_DO_MS = 5000;

type HangSong = { tagKey: string; v: unknown; q: "good" | "uncertain" | "bad" | null; ageMs: number | null; stale: boolean };
type HangCheDo = { machineId: number; code: string; ten: string; cheDo: "REMOTE" | "LOCAL"; lyDo: string };
type GiaTriGui = number | boolean | string;

/** UUID v4 cho `clientRequestId` (crypto.randomUUID khi có; dự phòng getRandomValues). */
function taoUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c?.getRandomValues?.(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface FaceplateProps {
  adapterId: number;
  tagKey: string;
  /** máy của adapter (null = adapter không gắn máy ⇒ không có chế độ REMOTE) */
  machineId: number | null;
  /** mã edge nếu adapter do edge sở hữu */
  edgeCode: string | null;
  onDong: () => void;
}

export function Faceplate({ adapterId, tagKey, machineId, edgeCode, onDong }: FaceplateProps) {
  const { t, i18n } = useTranslation();
  const donVi = useDonViThoiGian();
  const so = (v: number | null | undefined) => dinhDangSo(v, i18n.language);

  const kenhQ = trpc.scadaKenh.danhSach.useQuery({ adapterId });
  const songQ = trpc.scadaDiag.tagCuaAdapter.useQuery({ adapterId }, { refetchInterval: CHU_KY_GIA_TRI_MS });
  const cheDoQ = trpc.scadaKenh.cheDo.danhSach.useQuery(undefined, { refetchInterval: CHU_KY_CHE_DO_MS });

  const hang = ((kenhQ.data ?? []) as HangKenh[]).find((k) => k.tagKey === tagKey) ?? null;
  const song = ((songQ.data ?? []) as HangSong[]).find((g) => g.tagKey === tagKey) ?? null;
  const may = machineId === null ? null : (((cheDoQ.data ?? []) as HangCheDo[]).find((m) => m.machineId === machineId) ?? null);
  const cheDo: "REMOTE" | "LOCAL" = may?.cheDo === "REMOTE" ? "REMOTE" : "LOCAL";
  const lyDoCheDo = may?.lyDo ?? "chua_khai";

  const dataType = hang?.dataType ?? "string";
  const dd = phanTichDinhDang(hang?.displayFormat, dataType);
  const fmt = useDinhDangGiaTri(hang?.displayFormat, dataType);

  const [nhap, setNhap] = useState("");
  const [chon, setChon] = useState<GiaTriGui | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<{ moTa: MoTaLoi; chiTiet: string } | null>(null);
  const [yeuCau, setYeuCau] = useState<{ kq: YeuCauLenh; lyDo: string; nhanLuc: number } | null>(null);
  /** fix round 1 — chặn gửi bằng REF: true từ lúc gọi request tới khi lỗi / M5 đóng (hai cú bấm cùng lượt render ⇒ MỘT request). */
  const dangBayRef = useRef(false);
  const conGanRef = useRef(true);
  useEffect(() => {
    conGanRef.current = true;
    return () => {
      conGanRef.current = false;
    };
  }, []);
  // yêu cầu tạo xong SAU khi faceplate đã gỡ (không còn M5 để đóng) ⇒ huỷ ngay, không giữ khoá chọn tới hết TTL
  const huy = trpc.scadaCommands.huy.useMutation({ onError: () => undefined });
  // lý do của lượt request đang bay (ref: onSuccess đọc đúng lượt, không phụ thuộc lần render)
  const lyDoDaGui = useRef("");

  const request = trpc.scadaCommands.request.useMutation({
    onSuccess: (kq: YeuCauLenh) => {
      if (!conGanRef.current) {
        huy.mutate({ requestId: kq.requestId });
        return;
      }
      setLoi(null);
      // nhanLuc — neo đồng hồ đếm của M5 vào lúc nhận phản hồi (conLaiTuLucNhan)
      setYeuCau({ kq, lyDo: lyDoDaGui.current, nhanLuc: Date.now() });
    },
    onError: (e: unknown) => {
      dangBayRef.current = false;
      setLoi({ moTa: moTaLoiLenh(e, "request", { laEdge: !!edgeCode, locale: i18n.language }), chiTiet: mapTrpcError(e) });
    },
  });

  // ── giá trị sẽ gửi theo khuôn ──
  let giaTri: GiaTriGui | null = null;
  let nhapLoi = false;
  const enumHong = dd.kieu === "enum" && !enumDungDuoc(dataType, dd.nhan);
  if (dd.kieu === "bool" || dd.kieu === "enum") giaTri = enumHong ? null : chon;
  else if (dd.kieu === "so") {
    const n = docSoNhap(nhap);
    if (n === "loi" || (n !== null && dataType === "int" && !Number.isInteger(n))) nhapLoi = true;
    else giaTri = n;
  } else giaTri = nhap.trim() === "" ? null : nhap.trim();

  const ghiDuoc = !!hang && hang.writable && hang.isEnabled && laLoaiKenhGhi(hang.loaiKenh);
  const dangTaiCheDo = cheDoQ.isLoading;
  const doiDuoc = giaTri !== null && lyDoDuDai(lyDo) && !request.isPending && !yeuCau;

  const doi = () => {
    if (dangBayRef.current || giaTri === null || !lyDoDuDai(lyDo)) return;
    dangBayRef.current = true;
    const ly = lyDo.trim();
    setLoi(null);
    lyDoDaGui.current = ly;
    request.mutate({ adapterId, tagKey, value: giaTri, lyDo: ly, clientRequestId: taoUuid() });
  };
  const dungGoiY = (g: number) => {
    setNhap(String(g));
    setLoi(null);
  };

  // ── giá trị sống ──
  const coQ = song?.q !== null && song?.q !== undefined;
  const ch = coQ ? hienChatLuong(song!.q as "good" | "uncertain" | "bad", song!.stale) : null;
  const vien: VienChatLuong = ch?.vien ?? "none";
  const muc = hang ? mucHienThi(hang) : null;
  const coDai = !!hang && (hang.writeMin !== null || hang.writeMax !== null);
  const nhanBool: [string, string] = dd.kieu === "bool" && dd.nhan ? dd.nhan : [t("scada.faceplate.bool.false"), t("scada.faceplate.bool.true")];

  const nutChon = (nhan: string, v: GiaTriGui, key: string, khoa = false) => {
    const dangChon = chon === v;
    return (
      <Button
        key={key}
        type="button"
        size="sm"
        variant={dangChon ? "default" : "outline"}
        aria-pressed={dangChon}
        disabled={khoa}
        onClick={() => setChon(v)}
      >
        {nhan}
      </Button>
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onDong()}>
      <DialogContent className="sm:max-w-md" data-testid="faceplate">
        <DialogHeader>
          <DialogTitle>{t("scada.faceplate.tieuDe", { kenh: hang?.displayName ?? tagKey })}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span>{may ? `${may.code} · ${may.ten}` : t("scada.faceplate.khongRoMay")}</span>
            <span className="text-xs">{tagKey}</span>
            <span
              data-testid="che-do-may"
              className="rounded-sm border px-1.5 text-xs font-semibold text-muted-foreground"
              style={{ borderColor: `var(${BIEN_MAU_VIEN_XAM})` }}
            >
              {cheDo}
            </span>
          </DialogDescription>
        </DialogHeader>

        {kenhQ.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("scada.faceplate.dangTai")}
          </p>
        ) : kenhQ.isError ? (
          <p className="text-sm">{t("scada.faceplate.loiTai")}</p>
        ) : !hang ? (
          <p className="text-sm">{t("scada.faceplate.khongThay")}</p>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">{t("scada.faceplate.giaTri")}</dt>
              <dd>
                <span data-testid="gia-tri-song" data-vien={vien} className="text-lg font-semibold tabular-nums" style={kieuVien(vien, ch?.kieu === "cu")}>
                  {fmt(song?.v)}
                  {hang.unit ? ` ${hang.unit}` : ""}
                  {ch?.kieu === "nghi_ngo" ? " ?" : ""}
                </span>
              </dd>
              <dt className="text-muted-foreground">{t("scada.faceplate.chatLuong")}</dt>
              <dd data-testid="chat-luong">{coQ ? t(`scada.diag.chatLuong.${ch!.kieu}`) : t("scada.diag.chatLuong.chuaCo")}</dd>
              <dt className="text-muted-foreground">{t("scada.faceplate.tuoi")}</dt>
              <dd data-testid="tuoi" className="tabular-nums">
                {dinhDangTuoi(song?.ageMs, donVi, i18n.language)}
              </dd>
              <dt className="text-muted-foreground">{t("scada.faceplate.dai")}</dt>
              <dd data-testid="dai" className="tabular-nums">
                {coDai ? `${so(hang.writeMin)} … ${so(hang.writeMax)}` : "—"}
              </dd>
              <dt className="text-muted-foreground">{t("scada.faceplate.buoc")}</dt>
              <dd data-testid="buoc" className="tabular-nums">
                {so(hang.writeStep)}
              </dd>
              <dt className="text-muted-foreground">{t("scada.faceplate.muc")}</dt>
              <dd data-testid="muc" className="tabular-nums">
                {muc?.kieu === "khai" ? so(muc.muc) : muc?.kieu === "macDinhDong" ? t("scada.kenh.mucMacDinhDong") : "—"}
              </dd>
            </dl>

            {!ghiDuoc ? (
              <p className="text-sm text-muted-foreground">{t("scada.faceplate.chiDoc")}</p>
            ) : dangTaiCheDo ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t("scada.faceplate.dangTai")}
              </p>
            ) : cheDo === "LOCAL" ? (
              <div className="rounded-sm border-l-4 bg-muted/40 px-3 py-2 text-sm" style={{ borderLeftColor: `var(${BIEN_MAU_VIEN_XAM})` }}>
                <p className="font-semibold">{t("scada.faceplate.taiCho")}</p>
                <p className="text-muted-foreground">{t(khoaLyDoLocal(lyDoCheDo, !!edgeCode), { lyDo: lyDoCheDo })}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {dd.kieu === "bool" ? (
                  <div className="space-y-1">
                    <span className="text-sm font-medium">{t("scada.faceplate.giaTriMoi")}</span>
                    <div className="flex flex-wrap gap-2">
                      {nutChon(nhanBool[0], giaTriBool(dataType, nhanBool, false), "f")}
                      {nutChon(nhanBool[1], giaTriBool(dataType, nhanBool, true), "t")}
                    </div>
                  </div>
                ) : dd.kieu === "enum" ? (
                  <div className="space-y-1">
                    <span className="text-sm font-medium">{t("scada.faceplate.giaTriMoi")}</span>
                    <div className="flex flex-wrap gap-2">
                      {dd.nhan.map((n, i) => nutChon(n, giaTriEnum(dataType, dd.nhan, i), `e${i}`, enumHong))}
                    </div>
                    {chon !== null && chiSoEnum(chon, dd.nhan) < 0 && <p className="text-xs">{String(chon)}</p>}
                    {enumHong && <p className="text-xs text-muted-foreground">{t("scada.faceplate.enumBoolSai", { n: dd.nhan.length })}</p>}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor="faceplate-gia-tri">{t("scada.faceplate.giaTriMoi")}</Label>
                    <Input
                      id="faceplate-gia-tri"
                      inputMode={dd.kieu === "so" ? "decimal" : "text"}
                      autoComplete="off"
                      value={nhap}
                      aria-invalid={nhapLoi ? true : undefined}
                      onChange={(e) => setNhap(e.target.value)}
                    />
                    {coDai && (
                      <p className="text-xs text-muted-foreground">
                        {t("scada.faceplate.trongDai", { min: so(hang.writeMin), max: so(hang.writeMax) })}
                      </p>
                    )}
                    {nhapLoi && <p className="text-xs text-destructive">{t("scada.faceplate.soLoi")}</p>}
                  </div>
                )}
                <TruongLyDo id="faceplate-ly-do" value={lyDo} onChange={setLyDo} />
                {loi && <ThongBaoLoiLenh moTa={loi.moTa} chiTiet={loi.chiTiet} onDungGoiY={dungGoiY} />}
                <div className="flex justify-end">
                  <Button onClick={doi} disabled={!doiDuoc}>
                    {request.isPending ? t("scada.faceplate.dangTao") : t("scada.faceplate.nutDoi")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {yeuCau && (
          <HopThoaiLenh
            yeuCau={yeuCau.kq}
            lyDo={yeuCau.lyDo}
            nhanLuc={yeuCau.nhanLuc}
            dinhDang={hang?.displayFormat ?? null}
            dataType={dataType}
            edgeCode={edgeCode}
            onDong={() => {
              dangBayRef.current = false;
              setYeuCau(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
