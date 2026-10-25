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
  adapters: Array<{
    adapterId: number;
    code: string;
    trangThai: "duoc" | "qua_edge" | "mat_ket_noi" | "mo_phong" | "ghim_cu" | "chua_ghim" | "ghim_muc_cao" | "khong_kiem_duoc";
    lyDo?: string;
    edgeCode?: string;
    edgeToiDuoc?: boolean;
    /** kiem-dinh R1b-1 H1 (b) — tag các ghim STOP HMI sẽ BỎ QUA (mức tác động > 1) */
    ghimBoQua?: string[];
  }>;
  tongHop: "duoc" | "mot_phan" | "khong";
  loiKhaoSat?: boolean;
}

/** Đang gửi lâu hơn ngần này ⇒ "kết quả chưa rõ" + cho đóng hộp. */
export const QUA_HAN_GUI_MS = 10_000;

/** Khoá chữ (+ tham số) của MỘT kết luận khả năng dừng (dòng trong hộp xác nhận). */
export function khoaKhaNang(a: KhaNangDung["adapters"][number]): { khoa: string; thamSo?: Record<string, string> } {
  switch (a.trangThai) {
    case "duoc":
      return { khoa: "scada.dungMay.khaNang.duoc" };
    case "qua_edge":
      return { khoa: "scada.dungMay.khaNang.quaEdge", thamSo: { code: a.edgeCode ?? "—" } };
    case "mat_ket_noi":
      return { khoa: "scada.dungMay.khaNang.matKetNoi" };
    case "mo_phong":
      return { khoa: a.lyDo === "ot_control_tat" ? "scada.dungMay.khaNang.moPhongOtTat" : "scada.dungMay.khaNang.moPhongChuaNghiemThu" };
    case "ghim_cu":
      return { khoa: "scada.dungMay.khaNang.ghimCuKetNoiCu" };
    case "chua_ghim":
      return { khoa: "scada.dungMay.khaNang.chuaGhim" };
    case "ghim_muc_cao":
      // kiem-dinh R1b-1 H1 (b) — mọi ghim ở tag mức tác động > 1 ⇒ không tới bằng STOP HMI
      return { khoa: "scada.dungMay.khaNang.ghimMucCao", thamSo: { list: (a.ghimBoQua ?? []).join(", ") || "—" } };
    default:
      // khong_kiem_duoc + kết luận lạ (máy chủ mới hơn client) ⇒ chiều an toàn
      return { khoa: "scada.dungMay.khaNang.khongKiemDuoc" };
  }
}

/** Dòng cảnh báo cấp máy (thuần — test được). Rỗng ⇒ không cảnh báo; `chuaGhimHet` ⇒ dùng câu "Máy chưa ghim STOP" có sẵn. */
export function dongCanhBaoKhaNang(k: KhaNangDung): { chuaGhimHet: boolean; dong: Array<{ key: string; khoa: string; thamSo?: Record<string, string> }> } {
  if (k.loiKhaoSat) return { chuaGhimHet: false, dong: [{ key: "kkd", khoa: "scada.dungMay.canhBao.khongKiemDuoc" }] };
  if (k.adapters.every((a) => a.trangThai === "chua_ghim")) return { chuaGhimHet: true, dong: [] };
  const dong: Array<{ key: string; khoa: string; thamSo?: Record<string, string> }> = [];
  for (const a of k.adapters) {
    // kiem-dinh R1b-1 H1 (b) — cùng luật với dungMay: ghim của tag mức tác động > 1 KHÔNG tới bằng STOP HMI
    if (a.trangThai === "ghim_muc_cao") {
      dong.push({ key: `gmc-${a.adapterId}`, khoa: "scada.dungMay.canhBao.ghimMucCao", thamSo: { code: a.code, list: (a.ghimBoQua ?? []).join(", ") || "—" } });
    } else if (a.ghimBoQua && a.ghimBoQua.length > 0) {
      dong.push({ key: `bq-${a.adapterId}`, khoa: "scada.dungMay.canhBao.boQuaMucCao", thamSo: { code: a.code, list: a.ghimBoQua.join(", ") } });
    }
    if (a.trangThai === "mat_ket_noi") dong.push({ key: `mkn-${a.adapterId}`, khoa: "scada.dungMay.canhBao.matKetNoi", thamSo: { code: a.code } });
    if (a.trangThai === "ghim_cu") dong.push({ key: `gc-${a.adapterId}`, khoa: "scada.dungMay.canhBao.ghimCu", thamSo: { code: a.code } });
    if (a.trangThai === "mo_phong" && a.lyDo !== "ot_control_tat") dong.push({ key: `mp-${a.adapterId}`, khoa: "scada.dungMay.canhBao.moPhong", thamSo: { code: a.code } });
    if (a.trangThai === "qua_edge") {
      const code = a.edgeCode ?? "—";
      dong.push({ key: `qe-${a.adapterId}`, khoa: "scada.dungMay.canhBao.quaEdge", thamSo: { code } });
      if (a.edgeToiDuoc === false) dong.push({ key: `ekt-${a.adapterId}`, khoa: "scada.dungMay.canhBao.edgeKhongToi", thamSo: { code } });
    }
  }
  // điều kiện của MÁY CHỦ / lỗi kiểm: MỘT dòng dù nhiều adapter
  if (k.adapters.some((a) => a.trangThai === "mo_phong" && a.lyDo === "ot_control_tat")) dong.push({ key: "ot", khoa: "scada.dungMay.canhBao.moPhongOtTat" });
  if (k.adapters.some((a) => a.trangThai === "khong_kiem_duoc")) dong.push({ key: "kkd", khoa: "scada.dungMay.canhBao.khongKiemDuoc" });
  const chuaGhim = k.adapters.filter((a) => a.trangThai === "chua_ghim").map((a) => a.code);
  if (chuaGhim.length > 0) dong.push({ key: "cgmp", khoa: "scada.dungMay.canhBao.chuaGhimMotPhan", thamSo: { list: chuaGhim.join(", ") } });
  return { chuaGhimHet: false, dong };
}

/**
 * Cảnh báo cấp máy theo khả năng dừng (điều phối 2026-10-24 + fix round 2): mất kết nối / ghim chưa hiệu lực / chỉ mô phỏng (chưa nghiệm
 * thu; OT tắt — một dòng) / qua edge (+ edge không liên lạc được) / không kiểm được / một phần adapter chưa ghim; MỌI adapter chưa ghim ⇒
 * "Máy chưa ghim STOP — nút dừng HMI không dùng được".
 */
export function CanhBaoKhaNangDung({ khaNang }: { khaNang: KhaNangDung }) {
  const { t } = useTranslation();
  const { chuaGhimHet, dong } = dongCanhBaoKhaNang(khaNang);
  if (chuaGhimHet) return <CanhBaoChuaGhimStop />;
  if (dong.length === 0) return null;
  return (
    <div
      data-testid="canh-bao-kha-nang-dung"
      role="note"
      className="space-y-0.5 rounded-sm border-l-4 bg-muted/40 px-3 py-1.5 text-sm font-medium"
      style={{ borderLeftColor: `var(${BIEN_MAU_DUNG})` }}
    >
      {dong.map((d) => (
        <p key={d.key}>{t(d.khoa, d.thamSo)}</p>
      ))}
    </div>
  );
}

/** kiem-dinh R1b-1 H1 (b) — một ghim máy chủ BỎ QUA (`lenhHmi.GhimBoQuaDungMay`). */
type GhimBoQua = { adapterId: number; code: string; tagKey: string; ly_do: string; muc: number };

type HangKetQua = {
  adapterId: number;
  code: string;
  status: string;
  ok: boolean;
  simulated: boolean;
  reason?: string;
  edgeStopRequest?: boolean;
  centralFallbackSent?: boolean;
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
  /** kiem-dinh R1b-1 H1 (b) — ghim máy chủ KHÔNG gửi (tag mức tác động > 1) */
  const [boQua, setBoQua] = useState<GhimBoQua[]>([]);
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
    onSuccess: (kq: { ketQua: HangKetQua[]; boQua?: GhimBoQua[] }) => {
      setKetQua(kq.ketQua);
      setBoQua(Array.isArray(kq.boQua) ? kq.boQua : []);
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

        {pha === "xacNhan" && khaNang?.loiKhaoSat && (
          <p data-testid="kha-nang-dung-loi" className="text-sm font-medium" style={{ color: `var(${BIEN_MAU_DUNG})` }}>
            {t("scada.dungMay.canhBao.khongKiemDuoc")}
          </p>
        )}
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
                  {t(khoaKhaNang(a).khoa, khoaKhaNang(a).thamSo)}
                  {a.trangThai !== "ghim_muc_cao" && a.ghimBoQua && a.ghimBoQua.length > 0 && (
                    <span data-testid={`kha-nang-bo-qua-${a.adapterId}`}>
                      {" · "}
                      {t("scada.dungMay.khaNang.boQuaMucCao", { list: a.ghimBoQua.join(", ") })}
                    </span>
                  )}
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
                    <p>
                      {r.edgeStopRequest
                        ? t("scada.dungMay.daGuiEdge")
                        : r.centralFallbackSent
                          ? t("scada.dungMay.daGuiDuPhong")
                          : t(nhan.khoa, nhan.thamSo)}
                    </p>
                    {(r.status === "rejected" || r.status === "failed") && !r.edgeStopRequest && !r.centralFallbackSent && (
                      <p className="text-xs text-muted-foreground">{t("scada.lenh.ketQua.ma", { ma: nhan.thamSo.ma ?? r.reason ?? "—" })}</p>
                    )}
                    {xau && <DongEstop />}
                  </li>
                );
              })}
            </ul>
            {/* kiem-dinh R1b-1 H1 (b) — ghim máy chủ KHÔNG gửi (tag mức tác động > 1): nói rõ tag nào chưa được dừng bằng HMI */}
            {boQua.length > 0 && (
              <div
                data-testid="ket-qua-bo-qua"
                className="space-y-0.5 rounded-sm border-l-4 bg-muted/40 px-3 py-2 text-sm"
                style={{ borderLeftColor: `var(${BIEN_MAU_DUNG})` }}
              >
                <p className="font-semibold">{t("scada.dungMay.boQua.tieuDe")}</p>
                <ul>
                  {boQua.map((b) => (
                    <li key={`${b.adapterId}-${b.tagKey}`}>{t("scada.dungMay.boQua.dong", { code: b.code, tagKey: b.tagKey, muc: b.muc })}</li>
                  ))}
                </ul>
                <DongEstop />
              </div>
            )}
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
  // fix round 3 — null = KHÔNG BIẾT (khảo sát lỗi): không bao giờ đọc thành "chưa ghim"
  /** `false` ⇒ cảnh báo cấp máy "Máy chưa ghim STOP"; vắng (chưa tải) ⇒ không cảnh báo */
  coGhimStop?: boolean | null;
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
      {khaNang ? (
        <CanhBaoKhaNangDung khaNang={khaNang} />
      ) : coGhimStop === false ? (
        <CanhBaoChuaGhimStop />
      ) : coGhimStop === null ? (
        <CanhBaoKhaNangDung khaNang={{ machineId: hop.machineId, adapters: [], tongHop: "khong", loiKhaoSat: true }} />
      ) : null}
      {mo && <HopDungMay {...hop} onDong={() => setMo(false)} />}
    </div>
  );
}
