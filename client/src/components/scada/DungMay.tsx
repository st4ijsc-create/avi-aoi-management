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
 *   • fix round 1: khảo sát khả năng dừng (`khaNangDung` của `scadaKenh.cheDo.danhSach`, hàm máy chủ `khaoSatKhaNangDung`) — hộp xác
 *     nhận liệt kê TRƯỚC khi gửi điều sẽ xảy ra với từng adapter; cảnh báo cấp máy (`CanhBaoKhaNangDung`) ở M4 / M10 cho ghim chưa hiệu
 *     lực / chỉ mô phỏng / chưa ghim. Đang gửi quá 10 s ⇒ mở nút Đóng + "Kết quả chưa rõ — dùng E-STOP cứng tại máy".
 */
import { useEffect, useRef, useState } from "react";
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

/** Hình dạng `khaNangDung` (server/services/scada/khaNangDung.ts `KhaNangDungMay`). */
export interface KhaNangDung {
  machineId: number;
  adapters: Array<{ adapterId: number; code: string; trangThai: "duoc" | "mo_phong" | "ghim_cu" | "chua_ghim"; lyDo?: string }>;
  tongHop: "duoc" | "mot_phan" | "khong";
}

/** Đang gửi lâu hơn ngần này ⇒ "kết quả chưa rõ" + cho đóng hộp. */
export const QUA_HAN_GUI_MS = 10_000;

/** Khoá chữ của MỘT kết luận khả năng dừng (dòng trong hộp xác nhận). */
export function khoaKhaNang(a: KhaNangDung["adapters"][number]): string {
  switch (a.trangThai) {
    case "duoc":
      return a.lyDo === "edge" ? "scada.dungMay.khaNang.duocEdge" : "scada.dungMay.khaNang.duoc";
    case "mo_phong":
      return a.lyDo === "ot_control_tat" ? "scada.dungMay.khaNang.moPhongOtTat" : "scada.dungMay.khaNang.moPhongChuaNghiemThu";
    case "ghim_cu":
      return a.lyDo === "khong_ket_noi" ? "scada.dungMay.khaNang.ghimCuKhongKetNoi" : "scada.dungMay.khaNang.ghimCuKetNoiCu";
    default:
      return "scada.dungMay.khaNang.chuaGhim";
  }
}

/**
 * Cảnh báo cấp máy theo khả năng dừng (điều phối 2026-10-24): `ghim_cu` ⇒ "cần kết nối lại adapter {code}" (từng adapter); `mo_phong`
 * chưa nghiệm thu ⇒ "chỉ mô phỏng — adapter {code} chưa nghiệm thu" (từng adapter); OT control tắt ⇒ MỘT dòng (điều kiện của máy chủ);
 * MỌI adapter `chua_ghim` (hoặc không có adapter) ⇒ "Máy chưa ghim STOP — nút dừng HMI không dùng được".
 */
export function CanhBaoKhaNangDung({ khaNang }: { khaNang: KhaNangDung }) {
  const { t } = useTranslation();
  if (khaNang.adapters.every((a) => a.trangThai === "chua_ghim")) return <CanhBaoChuaGhimStop />;
  const dong: Array<{ key: string; text: string }> = [];
  for (const a of khaNang.adapters) {
    if (a.trangThai === "ghim_cu") dong.push({ key: `gc-${a.adapterId}`, text: t("scada.dungMay.canhBao.ghimCu", { code: a.code }) });
    if (a.trangThai === "mo_phong" && a.lyDo !== "ot_control_tat") dong.push({ key: `mp-${a.adapterId}`, text: t("scada.dungMay.canhBao.moPhong", { code: a.code }) });
  }
  if (khaNang.adapters.some((a) => a.trangThai === "mo_phong" && a.lyDo === "ot_control_tat")) dong.push({ key: "ot", text: t("scada.dungMay.canhBao.moPhongOtTat") });
  if (dong.length === 0) return null;
  return (
    <div
      data-testid="canh-bao-kha-nang-dung"
      role="note"
      className="space-y-0.5 rounded-sm border-l-4 bg-muted/40 px-3 py-1.5 text-sm font-medium"
      style={{ borderLeftColor: `var(${BIEN_MAU_DUNG})` }}
    >
      {dong.map((d) => (
        <p key={d.key}>{d.text}</p>
      ))}
    </div>
  );
}

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
  /** khảo sát khả năng dừng (vắng ⇒ không liệt kê) */
  khaNang?: KhaNangDung;
  onDong: () => void;
}

type Pha = "xacNhan" | "dangGui" | "ketQua" | "loi";

export function HopDungMay({ machineId, tenMay, soAdapter, laEdge, khaNang, onDong }: HopDungMayProps) {
  const { t, i18n } = useTranslation();
  const [pha, setPha] = useState<Pha>("xacNhan");
  const [ketQua, setKetQua] = useState<HangKetQua[]>([]);
  const [loi, setLoi] = useState<{ moTa: MoTaLoi; chiTiet: string } | null>(null);
  /** chặn gửi bằng REF: Enter + bấm chuột trong cùng lượt render ⇒ MỘT lần gửi */
  const daGuiRef = useRef(false);
  const nutRef = useRef<HTMLButtonElement | null>(null);
  /** fix round 1 (minor 6) — đang gửi quá QUA_HAN_GUI_MS ⇒ kết quả chưa rõ: cho đóng hộp + nhắc E-STOP cứng */
  const [quaHan, setQuaHan] = useState(false);
  useEffect(() => {
    if (pha !== "dangGui") return;
    const id = setTimeout(() => setQuaHan(true), QUA_HAN_GUI_MS);
    return () => clearTimeout(id);
  }, [pha]);
  const khoaDong = pha === "dangGui" && !quaHan;

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
    <Dialog open onOpenChange={(o) => !o && !khoaDong && onDong()}>
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

        {pha === "xacNhan" && khaNang && khaNang.adapters.length > 0 && (
          <div className="space-y-1" data-testid="kha-nang-dung">
            <p className="text-sm font-medium">{t("scada.dungMay.khaNangTieuDe")}</p>
            <ul className="space-y-1 text-sm">
              {khaNang.adapters.map((a) => (
                <li
                  key={a.adapterId}
                  data-testid={`kha-nang-${a.adapterId}`}
                  data-trang-thai={a.trangThai}
                  className="border-l-4 pl-2"
                  style={{ borderLeftColor: a.trangThai === "duoc" ? "var(--isa-graphic)" : `var(${BIEN_MAU_DUNG})` }}
                >
                  <span className="font-semibold">{a.code}</span>
                  {" · "}
                  {t(khoaKhaNang(a))}
                </li>
              ))}
            </ul>
          </div>
        )}

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
        {pha === "dangGui" && quaHan && (
          <p data-testid="chua-ro" className="font-semibold" style={{ color: `var(${BIEN_MAU_DUNG})` }}>
            {t("scada.dungMay.chuaRo")}
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
            <Button variant="outline" onClick={onDong} disabled={khoaDong}>
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
  const khaNang = hop.khaNang;
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
      {khaNang ? <CanhBaoKhaNangDung khaNang={khaNang} /> : coGhimStop === false && <CanhBaoChuaGhimStop />}
      {mo && <HopDungMay {...hop} onDong={() => setMo(false)} />}
    </div>
  );
}
