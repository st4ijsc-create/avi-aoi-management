/**
 * SCADA R1a Task 14 — M5 "Xác nhận lệnh" (báo cáo §4.6). Bước 2 của lệnh ghi tag từ HMI: hiện bản xem trước của `scadaCommands.request`
 * (do faceplate M4 gọi), đếm ngược tới `expiresAt`, nhận mã TOTP khi cần, gọi `scadaCommands.confirm`, rồi hiện kết quả.
 *
 *   • Trường hiển thị khớp đúng bản xem trước: máy, kênh (+ đơn vị), hiện tại (giá trị · chất lượng · tuổi), yêu cầu, sau công thức, dải,
 *     mức (+ cần TOTP), chế độ THẬT / MÔ PHỎNG (+ lý do), đường, lý do người dùng nhập ở faceplate, lưu ý của máy chủ.
 *   • Đếm ngược về 0 ⇒ khoá nút gửi. `mode: "simulated"` ⇒ nút "Gửi (mô phỏng)".
 *   • Ô TOTP 6 số khi `needsTotp` hoặc mức 4–5; BẮT BUỘC khi `needsTotp`, mức 5, hoặc máy chủ vừa đòi mã (TOTP_CAN / TOTP_SAI).
 *   • Kết quả theo `nhanKetQua` (ketQuaLenh.ts): CHỈ `acked_verified` tự đóng sau 3 s; mọi trạng thái khác giữ hộp mở.
 *   • Từ chối nói lý do + cách xử lý (`ThongBaoLoiLenh`), không chỉ mã. TOTP_CAN / TOTP_SAI / TOTP_KHONG_KIEM_DUOC giữ yêu cầu (gửi lại
 *     được trong TTL — QĐ T9-2); mọi từ chối khác kết thúc yêu cầu ở máy chủ.
 *   • Đóng khi yêu cầu còn `proposed` ⇒ `scadaCommands.huy` (nhả khoá chọn ngay, không chờ 60 s).
 *   • `scada:cmd` (useScadaCmd) là đường BỔ SUNG khi đang gửi; giá trị trả về của `confirm` / lỗi của nó luôn thắng.
 *   • kiem-dinh P1-4 — pha `dangGui`: nút Đóng khoá, nút X ẩn, Esc / bấm ra ngoài bị chặn (lệnh đã rời tay, không còn gì để huỷ). Nếu hộp
 *     vẫn bị GỠ giữa lúc gửi (đổi trang, mất kết nối, cha gỡ) thì kết cục của `confirm` — callback CẤP `useMutation` vẫn chạy sau khi gỡ
 *     (TanStack v5: Mutation tự gọi `options.onSuccess/onError`) — hiện thành TOAST CẤP TRANG (sonner) kèm kênh + máy.
 *
 * Màu (§4.10): trạng thái lệnh là CHỮ trong hộp thoại, KHÔNG dùng màu cảnh báo — khối kết quả / từ chối chỉ dùng token ISA trung tính.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { Link } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useScadaCmd, type SuKienScadaCmd } from "@/hooks/useScadaCmd";
import { dinhDangTuoi, hienChatLuong } from "./chatLuongHienThi";
import { useDonViThoiGian } from "./BangTruyenThong";
import { dinhDangGiaTri, dinhDangGiaTriChinhXac, dinhDangSo, phanTichDinhDang } from "./kenhHienThi";
import {
  LIEN_KET_DANG_KY_2FA,
  conLaiTuLucNhan,
  khoaGoiYStop,
  laTrangThaiKetQua,
  moTaLoiLenh,
  nhanKetQua,
  type MoTaLoi,
  type TrangThaiKetQua,
} from "./ketQuaLenh";

export type YeuCauLenh = inferRouterOutputs<AppRouter>["scadaCommands"]["request"];
type BanXemTruoc = YeuCauLenh["preview"];

/** Token ISA trung tính cho khối trạng thái lệnh (§4.10: không dùng màu cảnh báo cho trạng thái lệnh). */
const VIEN_TRUNG_TINH = "var(--isa-graphic)";

const MA_TOTP_DAI = 6;

// fix round 1 — đồng hồ đếm neo lúc nhận: logic thuần ở ketQuaLenh.ts
export { TTL_YEU_CAU_MS, conLaiTuLucNhan } from "./ketQuaLenh";

/** Kiểu dữ liệu suy từ giá trị khi người gọi không truyền (chỉ để chọn khuôn hiển thị; máy chủ đã ép kiểu). */
function suyKieu(v: unknown): string {
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return "float";
  return "string";
}

/**
 * Hàm định dạng giá trị theo khuôn kênh + ngôn ngữ (dùng chung M4/M5). `chinhXac` (M5) ⇒ số in ĐỦ chữ thập phân của chính nó, không
 * làm tròn theo khuôn số (fix round 1); nhãn bool/enum vẫn theo khuôn.
 */
export function useDinhDangGiaTri(displayFormat: string | null | undefined, dataType: string, chinhXac = false): (v: unknown) => string {
  const { t, i18n } = useTranslation();
  const dd = phanTichDinhDang(displayFormat, dataType);
  const nhanBool: [string, string] = [t("scada.faceplate.bool.false"), t("scada.faceplate.bool.true")];
  return (v: unknown) => (chinhXac ? dinhDangGiaTriChinhXac : dinhDangGiaTri)(v, dd, i18n.language, nhanBool);
}

/** Câu chính của một từ chối (dùng trong hộp và trong toast cấp trang — kiem-dinh P1-4). */
function cauLoiLenh(t: TFunction, moTa: MoTaLoi, chiTiet: string): string {
  const lyDo = moTa.khoaLyDo ? t(moTa.khoaLyDo, { lyDo: moTa.thamSo.lyDo }) : undefined;
  return t(moTa.khoa, { ...moTa.thamSo, ...(lyDo !== undefined ? { lyDo } : {}), ...(moTa.canChiTiet ? { chiTiet } : {}) });
}

/** Một từ chối của request/confirm thành chữ + cách xử lý (+ liên kết 2FA / gợi ý STOP / nút điền gợi ý OFF_STEP). */
export function ThongBaoLoiLenh({
  moTa,
  chiTiet,
  onDungGoiY,
  coGhimStop,
}: {
  moTa: MoTaLoi;
  chiTiet: string;
  onDungGoiY?: (goiY: number) => void;
  /** R1b-1 T2 (ruling R-2) — máy có ghim STOP ⇒ gợi ý nút DỪNG MÁY; vắng/false ⇒ gợi ý E-STOP cứng */
  coGhimStop?: boolean;
}) {
  const { t } = useTranslation();
  const cau = cauLoiLenh(t, moTa, chiTiet);
  return (
    <div
      data-testid="loi-lenh"
      role="alert"
      className="space-y-1.5 rounded-sm border-l-4 bg-muted/40 px-3 py-2 text-sm text-foreground"
      style={{ borderLeftColor: VIEN_TRUNG_TINH }}
    >
      <p className="font-medium">{cau}</p>
      {moTa.goiYStop && <p data-testid="goi-y-stop">{t(khoaGoiYStop(coGhimStop))}</p>}
      {moTa.lienKet2FA && (
        <p>
          <Link href={LIEN_KET_DANG_KY_2FA} className="font-medium underline underline-offset-2">
            {t("scada.lenh.loi.lienKet2FA")}
          </Link>
        </p>
      )}
      {moTa.goiY !== undefined && onDungGoiY && (
        <Button type="button" size="sm" variant="outline" onClick={() => onDungGoiY(moTa.goiY as number)}>
          {t("scada.lenh.loi.nutDungGoiY", { goiY: moTa.thamSo.goiY })}
        </Button>
      )}
      {moTa.ma && <p className="text-xs text-muted-foreground">{t("scada.lenh.loi.ma", { ma: moTa.ma })}</p>}
    </div>
  );
}

type Pha = "proposed" | "dangGui" | "ketQua" | "ketThuc";
type KetQua = { status: TrangThaiKetQua; reason?: string; readBackValue?: unknown };

export interface HopThoaiLenhProps {
  yeuCau: YeuCauLenh;
  /** lý do người dùng đã nhập ở faceplate (đã gửi trong `request`) — hiện lại ở đây */
  lyDo: string;
  /** `displayFormat` của kênh (định dạng giá trị) */
  dinhDang: string | null;
  /** kiểu dữ liệu của kênh; vắng ⇒ suy từ giá trị yêu cầu */
  dataType?: string;
  /** mã edge nếu adapter do edge sở hữu (chữ MODE_LOCAL chua_co_mau) */
  edgeCode: string | null;
  /** lúc nhận phản hồi `request` (Date.now()); vắng ⇒ lúc hộp gắn — neo đồng hồ đếm (`conLaiTuLucNhan`) */
  nhanLuc?: number;
  /** R1b-1 T2 (ruling R-2) — máy có ghim STOP (`scadaKenh.cheDo.danhSach`) ⇒ gợi ý MODE_LOCAL nói tới nút DỪNG MÁY */
  coGhimStop?: boolean;
  onDong: () => void;
}

function Truong({ k, nhan, children }: { k: string; nhan: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{nhan}</dt>
      <dd data-testid={`truong-${k}`} className="min-w-0 break-words">
        {children}
      </dd>
    </>
  );
}

export function HopThoaiLenh({ yeuCau, lyDo, dinhDang, dataType, edgeCode, nhanLuc, coGhimStop, onDong }: HopThoaiLenhProps) {
  const { t, i18n } = useTranslation();
  const donVi = useDonViThoiGian();
  const p: BanXemTruoc = yeuCau.preview;
  const requestId = yeuCau.requestId;
  // fix round 1 — bước kiểm cuối của người vận hành: giá trị CHÍNH XÁC (240.25 không thành "240,3" theo khuôn 0.0)
  const fmt = useDinhDangGiaTri(dinhDang, dataType ?? suyKieu(p.requested), true);
  const so = (v: number | null | undefined) => dinhDangSo(v, i18n.language);

  const [pha, setPha] = useState<Pha>("proposed");
  const phaRef = useRef<Pha>("proposed");
  const doiPha = (x: Pha) => {
    phaRef.current = x;
    setPha(x);
  };
  const [ketQua, setKetQua] = useState<KetQua | null>(null);
  const [loi, setLoi] = useState<{ moTa: MoTaLoi; chiTiet: string } | null>(null);
  const [maTotp, setMaTotp] = useState("");
  const [mayDoiMa, setMayDoiMa] = useState(false);
  /**
   * fix round 1 — máy chủ CÓ THỂ còn giữ yêu cầu `proposed` + khoá chọn ⇒ đóng / gỡ hộp phải gọi `huy`. true lúc đầu; false khi đang
   * gửi / có kết quả / từ chối kết thúc; true lại sau từ chối mà máy chủ giữ yêu cầu (MoTaLoi.huyKhiDong). Đặt false ngay khi đã huy.
   */
  const canHuyRef = useRef(true);

  // ── đếm ngược tới expiresAt ──
  const [lucNhan] = useState(() => nhanLuc ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const conLaiMs = conLaiTuLucNhan(yeuCau.expiresAt, lucNhan, now);
  const hetGio = conLaiMs <= 0;

  const onDongRef = useRef(onDong);
  useEffect(() => {
    onDongRef.current = onDong;
  }, [onDong]);

  // kiem-dinh P1-4 — hộp đã bị gỡ? (đặt lại false khi gắn: StrictMode gắn → gỡ → gắn lại)
  const daGoRef = useRef(false);
  useEffect(() => {
    daGoRef.current = false;
    return () => {
      daGoRef.current = true;
    };
  }, []);
  /** Hộp đã gỡ GIỮA lúc gửi ⇒ kết cục thành toast cấp trang (một lần). true ⇒ người gọi không đụng state nữa. */
  const baoNenNeuDaGo = (cau: string, loai: "success" | "warning" | "error"): boolean => {
    if (!daGoRef.current) return false;
    if (phaRef.current !== "dangGui") return true; // gỡ khi không gửi: không có gì để báo (huy đã chạy nếu cần)
    phaRef.current = "ketQua";
    toast[loai](t("scada.lenh.toastNen", { kenh: p.channel, may: p.machine, ketQua: cau }));
    return true;
  };

  const confirm = trpc.scadaCommands.confirm.useMutation({
    onSuccess: (kq: { status: string; reason?: string; readBackValue?: unknown }) => {
      const status = laTrangThaiKetQua(kq.status) ? kq.status : "failed";
      const nhanNen = nhanKetQua(status, { readBack: kq.readBackValue, reason: kq.reason, requested: p.requested, dinhDang: fmt });
      if (baoNenNeuDaGo(t(nhanNen.khoa, nhanNen.thamSo), status === "acked_verified" ? "success" : "warning")) return;
      canHuyRef.current = false;
      setLoi(null);
      setKetQua({
        status: laTrangThaiKetQua(kq.status) ? kq.status : "failed",
        ...(kq.reason ? { reason: kq.reason } : {}),
        ...("readBackValue" in kq ? { readBackValue: kq.readBackValue } : {}),
      });
      doiPha("ketQua");
    },
    onError: (e: unknown) => {
      const moTa = moTaLoiLenh(e, "confirm", { laEdge: !!edgeCode, locale: i18n.language });
      if (baoNenNeuDaGo(cauLoiLenh(t, moTa, mapTrpcError(e)), "error")) return;
      setLoi({ moTa, chiTiet: mapTrpcError(e) });
      setKetQua(null);
      canHuyRef.current = moTa.huyKhiDong;
      if (moTa.ma === "TOTP_CAN" || moTa.ma === "TOTP_SAI") setMayDoiMa(true);
      if (moTa.giuYeuCau) setMaTotp("");
      doiPha(moTa.giuYeuCau ? "proposed" : "ketThuc");
    },
  });
  // Huỷ là dọn dẹp tốt-nhất-có-thể (khoá chọn tự hết sau TTL): không toast lỗi sau khi hộp đã đóng.
  const huy = trpc.scadaCommands.huy.useMutation({ onError: () => undefined });
  const huyRef = useRef(huy.mutate);
  huyRef.current = huy.mutate;
  /** Huỷ MỘT lần (đóng hộp, hoặc gỡ hộp khi điều hướng / đổi hàng / đổi adapter). */
  const huyNeuCan = useCallback(() => {
    if (!canHuyRef.current) return;
    canHuyRef.current = false;
    huyRef.current({ requestId });
  }, [requestId]);
  // fix round 1 — gỡ hộp khi yêu cầu còn proposed (back/forward, đổi hàng ngăn tag, đổi adapter ở M12) ⇒ huy tốt-nhất-có-thể
  useEffect(() => () => huyNeuCan(), [huyNeuCan]);

  // ── scada:cmd — chỉ khi đang gửi; kết quả/ lỗi của confirm đến sau vẫn ghi đè ──
  const nhanSuKien = useCallback((e: SuKienScadaCmd) => {
    if (phaRef.current !== "dangGui") return;
    if (laTrangThaiKetQua(e.status)) {
      setKetQua({
        status: e.status,
        ...(e.reason ? { reason: e.reason } : {}),
        ...("readBackValue" in e ? { readBackValue: e.readBackValue } : {}),
      });
      canHuyRef.current = false;
      phaRef.current = "ketQua";
      setPha("ketQua");
    }
  }, []);
  useScadaCmd(requestId, nhanSuKien);

  // ── tự đóng: CHỈ khi nhanKetQua nói vậy (acked_verified) ──
  const nhan = ketQua ? nhanKetQua(ketQua.status, { readBack: ketQua.readBackValue, reason: ketQua.reason, requested: p.requested, dinhDang: fmt }) : null;
  const tuDong = nhan?.tuDongDongMs ?? null;
  useEffect(() => {
    if (tuDong === null) return;
    const id = setTimeout(() => onDongRef.current(), tuDong);
    return () => clearTimeout(id);
  }, [tuDong, ketQua]);

  const coOTotp = p.needsTotp || p.level >= 4 || mayDoiMa;
  const batBuocTotp = p.needsTotp || p.level === 5 || mayDoiMa;
  const maHopLe = maTotp.length === MA_TOTP_DAI;
  const maDuDieuKien = batBuocTotp ? maHopLe : maTotp.length === 0 || maHopLe;
  const guiDuoc = pha === "proposed" && !hetGio && !confirm.isPending && maDuDieuKien;

  const gui = () => {
    // fix round 1 — chặn bằng REF (hai cú bấm trong cùng một lượt render không gửi hai lần), không bằng state của lần render
    if (phaRef.current !== "proposed" || hetGio || !maDuDieuKien) return;
    setLoi(null);
    canHuyRef.current = false;
    doiPha("dangGui");
    confirm.mutate({ requestId, ...(maHopLe ? { totpCode: maTotp } : {}) });
  };
  const dong = () => {
    huyNeuCan();
    onDong();
  };

  const cur = p.current;
  const chatLuong = hienChatLuong(cur.q, false).kieu;
  const tenMoPhong = p.simulatedReasons.map((r) => t(`scada.lenh.moPhong.${r}`, { defaultValue: r })).join(", ");
  const conLaiGiay = Math.ceil(conLaiMs / 1000);

  return (
    <Dialog open onOpenChange={(o) => !o && phaRef.current !== "dangGui" && dong()}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="hop-thoai-lenh"
        showCloseButton={pha !== "dangGui"}
        onEscapeKeyDown={(e) => phaRef.current === "dangGui" && e.preventDefault()}
        onInteractOutside={(e) => phaRef.current === "dangGui" && e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-baseline justify-between gap-3 pr-6">
            <DialogTitle>{t("scada.lenh.tieuDe")}</DialogTitle>
            {pha === "proposed" && (
              <span data-testid="dem-nguoc" className="text-sm tabular-nums text-muted-foreground">
                {t("scada.lenh.conLai", { giay: conLaiGiay })}
              </span>
            )}
          </div>
          <DialogDescription>{t("scada.lenh.moTa")}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <Truong k="may" nhan={t("scada.lenh.truong.may")}>
            {p.machine}
          </Truong>
          <Truong k="kenh" nhan={t("scada.lenh.truong.kenh")}>
            {p.channel}
            {p.unit ? ` (${p.unit})` : ""}
          </Truong>
          <Truong k="hienTai" nhan={t("scada.lenh.truong.hienTai")}>
            <span className="tabular-nums">{fmt(cur.v)}</span>
            {" · "}
            {t(`scada.diag.chatLuong.${chatLuong}`)}
            {" · "}
            <span className="tabular-nums">{dinhDangTuoi(cur.ageMs, donVi, i18n.language)}</span>
          </Truong>
          <Truong k="yeuCau" nhan={t("scada.lenh.truong.yeuCau")}>
            <span className="font-semibold tabular-nums">{fmt(p.requested)}</span>
          </Truong>
          <Truong k="sauCongThuc" nhan={t("scada.lenh.truong.sauCongThuc")}>
            <span className="tabular-nums">{fmt(p.afterFormula)}</span>
          </Truong>
          <Truong k="dai" nhan={t("scada.lenh.truong.dai")}>
            {p.range
              ? t("scada.lenh.daiBuoc", { min: so(p.range.min), max: so(p.range.max), buoc: so(p.range.step) })
              : t("scada.lenh.khongDai")}
          </Truong>
          <Truong k="muc" nhan={t("scada.lenh.truong.muc")}>
            {t(p.needsTotp || p.level === 5 ? "scada.lenh.mucCanTotp" : "scada.lenh.mucKhongTotp", { muc: so(p.level) })}
          </Truong>
          <Truong k="cheDo" nhan={t("scada.lenh.truong.cheDo")}>
            {p.mode === "simulated" ? (
              <>
                <span className="font-semibold">{t("scada.lenh.cheDoMoPhong")}</span>
                {tenMoPhong ? ` — ${tenMoPhong}` : ""}
              </>
            ) : (
              <span className="font-semibold">{t("scada.lenh.cheDoThat")}</span>
            )}
          </Truong>
          <Truong k="duong" nhan={t("scada.lenh.truong.duong")}>
            {p.route === "central" ? t("scada.lenh.duongCentral") : String(p.route)}
          </Truong>
          <Truong k="lyDo" nhan={t("scada.lenh.truong.lyDo")}>
            {lyDo}
          </Truong>
          {p.warnings.length > 0 && (
            <Truong k="canhBao" nhan={t("scada.lenh.truong.canhBao")}>
              <ul className="list-disc pl-4">
                {p.warnings.map((w) => (
                  <li key={w}>{t(`scada.lenh.canhBaoMa.${w}`, { defaultValue: w })}</li>
                ))}
              </ul>
            </Truong>
          )}
        </dl>

        {coOTotp && (pha === "proposed" || pha === "dangGui") && (
          <div className="space-y-1">
            <Label htmlFor="scada-lenh-totp">{t("scada.lenh.totp.nhan")}</Label>
            <Input
              id="scada-lenh-totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={MA_TOTP_DAI}
              className="w-40 tracking-widest tabular-nums"
              value={maTotp}
              disabled={pha !== "proposed"}
              onChange={(e) => setMaTotp(e.target.value.replace(/\D/g, "").slice(0, MA_TOTP_DAI))}
            />
            {!batBuocTotp && <p className="text-xs text-muted-foreground">{t("scada.lenh.totp.tuyChon")}</p>}
          </div>
        )}

        {pha === "proposed" && hetGio && <p className="text-sm font-medium">{t("scada.lenh.hetGio")}</p>}
        {pha === "dangGui" && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("scada.lenh.nut.dangGui")}
          </p>
        )}

        {loi && <ThongBaoLoiLenh moTa={loi.moTa} chiTiet={loi.chiTiet} coGhimStop={coGhimStop} />}

        {pha === "ketQua" && ketQua && nhan && (
          <div
            data-testid="ket-qua"
            role="status"
            className="space-y-1 rounded-sm border-l-4 bg-muted/40 px-3 py-2 text-sm text-foreground"
            style={{ borderLeftColor: VIEN_TRUNG_TINH }}
          >
            <p className="font-medium">{t(nhan.khoa, nhan.thamSo)}</p>
            {ketQua.status === "simulated" && tenMoPhong && <p>{t("scada.lenh.ketQua.lyDoMoPhong", { lyDo: tenMoPhong })}</p>}
            {nhan.goiYStop && <p data-testid="goi-y-stop">{t(khoaGoiYStop(coGhimStop))}</p>}
            {(ketQua.status === "rejected" || ketQua.status === "failed") && (
              <p className="text-xs text-muted-foreground">{t("scada.lenh.ketQua.ma", { ma: nhan.thamSo.ma })}</p>
            )}
            {tuDong !== null && <p className="text-xs text-muted-foreground">{t("scada.lenh.ketQua.tuDongDong")}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => phaRef.current !== "dangGui" && dong()} disabled={pha === "dangGui"}>
            {pha === "proposed" ? t("scada.lenh.nut.huy") : t("scada.lenh.nut.dong")}
          </Button>
          <Button onClick={gui} disabled={!guiDuoc}>
            {p.mode === "simulated" ? t("scada.lenh.nut.guiMoPhong") : t("scada.lenh.nut.gui")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
