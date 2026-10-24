/**
 * SCADA R1b-1 Task 2 — nút "DỪNG MÁY" (STOP HMI MỘT bước, `scadaCommands.dungMay`) + cảnh báo cấp máy "Máy chưa ghim STOP".
 *
 * Điều phối 2026-10-24:
 *   • Nút đỏ "DỪNG MÁY" dùng token trạng thái DỪNG của ISA/PackML (`--packml-abort`, họ chế độ máy — KHÔNG phải bảng màu cảnh báo).
 *   • HIỆN CẢ KHI máy LOCAL (D3) — đó là lúc cần nhất. Không chặn ở client theo `coGhimStop` (máy chủ quyết; dữ liệu cờ có thể cũ).
 *   • Một hộp xác nhận MỘT bước "Dừng máy X? (gửi STOP đã ghim tới N adapter)": nút MẶC ĐỊNH "Dừng máy" màu đỏ có focus sẵn ⇒ một lần
 *     Enter là gửi. KHÔNG ô lý do (`lyDo` tuỳ chọn ở máy chủ; không bắt gõ khi dừng máy).
 *   • Kết quả theo TỪNG adapter: đạt / không đạt / chưa xác minh (`phanLoaiKetQuaDung`) + câu của `nhanKetQua`; edge ⇒ "đã gửi tới edge".
 *     Adapter nào không đạt / chưa xác minh ⇒ dòng đỏ + "Dùng E-STOP cứng tại máy".
 *   • Lỗi của cả lần bấm (CHUA_GHIM_STOP, NOT_FOUND, mạng …) ⇒ `ThongBaoLoiLenh` + dòng đỏ E-STOP. Lỗi KHÔNG mã đọc như ở `confirm`
 *     ("không rõ máy đã nhận") — chiều an toàn.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ThongBaoLoiLenh } from "./HopThoaiLenh";
import { laTrangThaiKetQua, moTaLoiLenh, nhanKetQua, phanLoaiKetQuaDung, type LoaiKetQuaDung, type MoTaLoi } from "./ketQuaLenh";

/** Token trạng thái DỪNG (PackML stopping/aborted — `stateVocabulary`): nền nút + viền/chữ dòng "dùng E-STOP". Không dùng màu cảnh báo. */
export const BIEN_MAU_DUNG = "--packml-abort";
/** Chữ trên nền token dừng: nền trường ISA (tương phản ở cả hai giao diện sáng / tối). */
const BIEN_CHU_TREN_DUNG = "--isa-field";

type HangKetQua = {
  adapterId: number;
  code: string;
  status: string;
  ok: boolean;
  simulated: boolean;
  reason?: string;
  edgeStopRequest?: boolean;
  writes: Array<{ tagKey: string; value: unknown }>;
};

/** UUID v4 cho `clientRequestId` (mỗi lần bấm một mã — bấm lại là một STOP mới, máy chủ gửi cả hai). */
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

const chuoiGhim = (w: HangKetQua["writes"]) => w.map((x) => `${x.tagKey}=${typeof x.value === "object" ? JSON.stringify(x.value) : String(x.value)}`).join(", ");

/** Cảnh báo cấp máy (M4 / M12): máy không có adapter bật nào mang ghim DỪNG ⇒ nút DỪNG MÁY không gửi được gì. */
export function CanhBaoChuaGhimStop() {
  const { t } = useTranslation();
  return (
    <p
      data-testid="canh-bao-chua-ghim-stop"
      role="note"
      className="rounded-sm border-l-4 bg-muted/40 px-3 py-1.5 text-sm font-medium"
      style={{ borderLeftColor: `var(${BIEN_MAU_DUNG})` }}
    >
      {t("scada.dungMay.canhBaoChuaGhim")}
    </p>
  );
}

/** Dòng đỏ "Dùng E-STOP cứng tại máy" (token dừng). */
function DongEstop() {
  const { t } = useTranslation();
  return (
    <p data-testid="dung-estop" className="font-semibold" style={{ color: `var(${BIEN_MAU_DUNG})` }}>
      {t("scada.dungMay.dungEstop")}
    </p>
  );
}

export interface HopDungMayProps {
  machineId: number;
  tenMay: string;
  /** số adapter sẽ nhận STOP (`soAdapterGhimStop`); vắng ⇒ câu không có số */
  soAdapter?: number;
  /** máy do edge sở hữu (chữ MODE_LOCAL chua_co_mau) */
  laEdge?: boolean;
  onDong: () => void;
}

type Pha = "xacNhan" | "dangGui" | "ketQua" | "loi";

export function HopDungMay({ machineId, tenMay, soAdapter, laEdge, onDong }: HopDungMayProps) {
  const { t, i18n } = useTranslation();
  const [pha, setPha] = useState<Pha>("xacNhan");
  const [ketQua, setKetQua] = useState<HangKetQua[]>([]);
  const [loi, setLoi] = useState<{ moTa: MoTaLoi; chiTiet: string } | null>(null);
  /** chặn gửi bằng REF: Enter + bấm chuột trong cùng lượt render ⇒ MỘT lần gửi */
  const daGuiRef = useRef(false);
  const nutRef = useRef<HTMLButtonElement | null>(null);

  const dungMay = trpc.scadaCommands.dungMay.useMutation({
    onSuccess: (kq: { ketQua: HangKetQua[] }) => {
      setKetQua(kq.ketQua);
      setPha("ketQua");
    },
    onError: (e: unknown) => {
      setLoi({ moTa: moTaLoiLenh(e, "confirm", { laEdge: !!laEdge, locale: i18n.language }), chiTiet: mapTrpcError(e) });
      setPha("loi");
    },
  });

  const gui = () => {
    if (daGuiRef.current) return;
    daGuiRef.current = true;
    setPha("dangGui");
    dungMay.mutate({ machineId, clientRequestId: taoUuid() });
  };

  const nhanLoai: Record<LoaiKetQuaDung, string> = {
    dat: t("scada.dungMay.dat"),
    khongDat: t("scada.dungMay.khongDat"),
    chuaXacMinh: t("scada.dungMay.chuaXacMinh"),
  };

  return (
    <Dialog open onOpenChange={(o) => !o && pha !== "dangGui" && onDong()}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="hop-dung-may"
        // nút MẶC ĐỊNH có focus sẵn ⇒ một lần Enter là gửi (Radix mặc định focus phần tử đầu tiên — nút Huỷ / nút đóng)
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nutRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("scada.dungMay.tieuDe", { may: tenMay })}</DialogTitle>
          <DialogDescription>
            {soAdapter !== undefined ? t("scada.dungMay.moTa", { n: soAdapter }) : t("scada.dungMay.moTaKhongRo")}
          </DialogDescription>
        </DialogHeader>

        {pha === "xacNhan" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              gui();
            }}
          >
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onDong}>
                {t("scada.dungMay.nutHuy")}
              </Button>
              <Button
                ref={nutRef}
                type="submit"
                autoFocus
                data-testid="nut-xac-nhan-dung"
                className="font-bold"
                style={{ backgroundColor: `var(${BIEN_MAU_DUNG})`, color: `var(${BIEN_CHU_TREN_DUNG})` }}
              >
                {t("scada.dungMay.nutXacNhan")}
              </Button>
            </DialogFooter>
          </form>
        )}

        {pha === "dangGui" && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("scada.dungMay.dangGui")}
          </p>
        )}

        {pha === "ketQua" && (
          <div className="space-y-2" data-testid="ket-qua-dung">
            <p className="text-sm font-medium">{t("scada.dungMay.ketQuaTieuDe")}</p>
            <ul className="space-y-2">
              {ketQua.map((r) => {
                const loai = phanLoaiKetQuaDung(r);
                const nhan = nhanKetQua(laTrangThaiKetQua(r.status) ? r.status : "failed", {
                  reason: r.reason,
                  // đạt ⇔ đọc lại khớp ĐÚNG các ghim đã gửi ⇒ "đã đọc lại" = các ghim
                  readBack: loai === "dat" ? chuoiGhim(r.writes) : undefined,
                  requested: null,
                  dinhDang: (v) => String(v),
                });
                const xau = loai !== "dat";
                return (
                  <li
                    key={r.adapterId}
                    data-testid={`ket-qua-dung-${r.adapterId}`}
                    data-loai={loai}
                    className="space-y-0.5 rounded-sm border-l-4 bg-muted/40 px-3 py-2 text-sm"
                    style={{ borderLeftColor: xau ? `var(${BIEN_MAU_DUNG})` : "var(--isa-graphic)" }}
                  >
                    <p>
                      <span className="font-semibold">{r.code}</span>
                      {" · "}
                      <span className="font-semibold">{nhanLoai[loai]}</span>
                    </p>
                    <p>{r.edgeStopRequest ? t("scada.dungMay.daGuiEdge") : t(nhan.khoa, nhan.thamSo)}</p>
                    {(r.status === "rejected" || r.status === "failed") && !r.edgeStopRequest && (
                      <p className="text-xs text-muted-foreground">{t("scada.lenh.ketQua.ma", { ma: nhan.thamSo.ma ?? r.reason ?? "—" })}</p>
                    )}
                    {xau && <DongEstop />}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {pha === "loi" && loi && (
          <div className="space-y-2">
            <ThongBaoLoiLenh moTa={loi.moTa} chiTiet={loi.chiTiet} />
            <DongEstop />
          </div>
        )}

        {pha !== "xacNhan" && (
          <DialogFooter>
            <Button variant="outline" onClick={onDong} disabled={pha === "dangGui"}>
              {t("scada.dungMay.nutDong")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface NutDungMayProps extends Omit<HopDungMayProps, "onDong"> {
  /** `false` ⇒ cảnh báo cấp máy "Máy chưa ghim STOP"; vắng (chưa tải) ⇒ không cảnh báo */
  coGhimStop?: boolean;
}

/** Nút "DỪNG MÁY" + cảnh báo cấp máy. Luôn hiện (kể cả LOCAL); máy chủ là ranh giới (CHUA_GHIM_STOP). */
export function NutDungMay({ coGhimStop, ...hop }: NutDungMayProps) {
  const { t } = useTranslation();
  const [mo, setMo] = useState(false);
  return (
    <div className="space-y-2" data-testid="khoi-dung-may">
      <Button
        type="button"
        data-testid="nut-dung-may"
        className="w-full font-bold tracking-wide"
        style={{ backgroundColor: `var(${BIEN_MAU_DUNG})`, color: `var(${BIEN_CHU_TREN_DUNG})` }}
        onClick={() => setMo(true)}
      >
        {t("scada.dungMay.nut")}
      </Button>
      {coGhimStop === false && <CanhBaoChuaGhimStop />}
      {mo && <HopDungMay {...hop} onDong={() => setMo(false)} />}
    </div>
  );
}
