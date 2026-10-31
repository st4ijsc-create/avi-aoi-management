/**
 * SCADA R1b-2b-2b B-T8 — "Nhật ký lệnh" (`/scada/journal`), hợp đồng Phần A C1 `commandLog.nhatKy`.
 *
 * Gộp hai nguồn theo thời gian: sổ lệnh (`lenh`, command_log) và lần thử (`thu`, scada_command_attempts — kể cả lần BỊ TỪ CHỐI trước khi
 * thành lệnh). Phân trang theo con trỏ: "Tải thêm" gửi `conTro` của trang trước; `conTro = null` ⇒ hết. Đổi bộ lọc ⇒ về trang đầu.
 *
 * Nhãn "sim" CHỈ theo `laStub` (adapter giao thức stub) — không suy từ trạng thái `simulated` của lệnh.
 * Chi tiết kỹ thuật bị che ở máy chủ với người không phải kỹ sư (`loi` null + `loiBiChe`): hiện "chi tiết bị ẩn", KHÔNG hiện "không có lý do".
 * Trang `CommandAuditLog` cũ không đổi.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollText } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { khoaMaLoi } from "@/lib/commandAuditMa";
import {
  PageHeader,
  PageContainer,
  SectionCard,
  EmptyState,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LOP_O_CHON } from "@/components/scada/TruongLyDo";

type KetQuaNhatKy = inferRouterOutputs<AppRouter>["commandLog"]["nhatKy"];
type HangNhatKy = KetQuaNhatKy["hang"][number];

/** Khớp `statusEnum` của máy chủ (≤ 8 trạng thái lọc). */
const TRANG_THAI_LENH = [
  "simulated",
  "sent",
  "acked",
  "acked_verified",
  "acked_unverified",
  "failed",
  "timeout",
  "rejected",
] as const;
const NGUON = ["tat_ca", "lenh", "thu"] as const;
type Nguon = (typeof NGUON)[number];
const GIOI_HAN_TRANG = 50;

interface BoLoc {
  machineId: string;
  nguon: Nguon;
  trangThai: string[];
  tu: string;
  den: string;
}
const LOC_RONG: BoLoc = {
  machineId: "",
  nguon: "tat_ca",
  trangThai: [],
  tu: "",
  den: "",
};

const thoiDiem = (v: string): string | undefined => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

function inputTu(loc: BoLoc, conTro?: string) {
  return {
    ...(loc.machineId ? { machineId: Number(loc.machineId) } : {}),
    nguon: loc.nguon,
    ...(loc.trangThai.length > 0
      ? { trangThai: loc.trangThai as (typeof TRANG_THAI_LENH)[number][] }
      : {}),
    ...(thoiDiem(loc.tu) ? { tu: thoiDiem(loc.tu) } : {}),
    ...(thoiDiem(loc.den) ? { den: thoiDiem(loc.den) } : {}),
    ...(conTro ? { conTro } : {}),
    gioiHan: GIOI_HAN_TRANG,
  };
}

const laNotFound = (e: unknown): boolean =>
  (e as { data?: { code?: string } } | null)?.data?.code === "NOT_FOUND";

export default function ScadaNhatKy() {
  const { t, i18n } = useTranslation();
  const utils = trpc.useUtils();
  // Giữ `utils` ở ref: hiệu ứng tải trang đầu chỉ được chạy lại khi BỘ LỌC đổi (không theo danh tính đối tượng `utils`).
  const utilsRef = useRef(utils);
  utilsRef.current = utils;
  const mayQ = trpc.scadaKenh.cheDo.danhSach.useQuery();
  const may = (mayQ.data ?? []) as Array<{
    machineId: number;
    code: string;
    ten: string;
  }>;
  const tenMay = useMemo(
    () => new Map(may.map(m => [m.machineId, m.code])),
    [may]
  );

  const [loc, setLoc] = useState<BoLoc>(LOC_RONG);
  const [hang, setHang] = useState<HangNhatKy[]>([]);
  const [conTro, setConTro] = useState<string | null>(null);
  const [trang, setTrang] = useState<"tai" | "xong" | "loi">("tai");
  const [dangTaiThem, setDangTaiThem] = useState(false);
  // Lượt gọi mới nhất thắng: đổi bộ lọc giữa chừng thì kết quả của lượt cũ bị bỏ.
  const lanGoi = useRef(0);

  const taiTrangDau = useCallback(async (bo: BoLoc) => {
    {
      const lan = ++lanGoi.current;
      setTrang("tai");
      setDangTaiThem(false);
      try {
        const kq = await utilsRef.current.commandLog.nhatKy.fetch(inputTu(bo), {
          staleTime: 0,
        });
        if (lan !== lanGoi.current) return;
        setHang(kq.hang);
        setConTro(kq.conTro);
        setTrang("xong");
      } catch (e) {
        if (lan !== lanGoi.current) return;
        toastTrpcError(e);
        if (bo.machineId && laNotFound(e)) {
          // Máy bị gỡ khỏi phạm vi giữa chừng ⇒ bỏ bộ lọc máy (hiệu ứng dưới tải lại trang đầu không còn máy ấy).
          setLoc(c => ({ ...c, machineId: "" }));
          return;
        }
        setHang([]);
        setConTro(null);
        setTrang("loi");
      }
    }
  }, []);

  useEffect(() => {
    void taiTrangDau(loc);
  }, [loc, taiTrangDau]);

  const taiThem = async () => {
    if (!conTro || dangTaiThem) return;
    const lan = lanGoi.current;
    setDangTaiThem(true);
    try {
      const kq = await utilsRef.current.commandLog.nhatKy.fetch(
        inputTu(loc, conTro),
        { staleTime: 0 }
      );
      if (lan !== lanGoi.current) return;
      setHang(cu => {
        const co = new Set(cu.map(h => h.id));
        return [...cu, ...kq.hang.filter(h => !co.has(h.id))];
      });
      setConTro(kq.conTro);
    } catch (e) {
      if (lan === lanGoi.current) toastTrpcError(e);
    } finally {
      if (lan === lanGoi.current) setDangTaiThem(false);
    }
  };

  const dinhDangGio = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(i18n.language);
  };

  /** Mã từ chối: chữ đã dịch nếu có và KHÔNG còn chỗ trống `{{…}}`; ngược lại mã thô (không bao giờ trống). */
  const chuMa = (ma: string): string => {
    // chỉ MÃ (HOA_SO_GACH): khoá UI như `khac` / `lienKet2FA` của cùng nhánh khoá không được coi là mã
    if (!/^[A-Z0-9_]+$/.test(ma)) return ma;
    // thứ tự: cổng / dự phòng (khoaMaLoi) → mã từ chối của lenhHmi (`scada.lenh.loi.*`: CHUA_GHIM_STOP, STOP_QUA_HAN…) → mã thô
    const khoa =
      khoaMaLoi(ma, k => i18n.exists(k)) ??
      (i18n.exists(`scada.lenh.loi.${ma}`) ? `scada.lenh.loi.${ma}` : null);
    if (!khoa) return ma;
    const tho = i18n.t(khoa, { skipInterpolation: true }) as string;
    return /\{\{/.test(tho) ? ma : t(khoa);
  };

  const nhanTrangThai = (h: HangNhatKy): string => {
    if (h.nguon === "lenh") {
      const k = `scada.nhatKy.trangThai.${h.trangThai}`;
      return i18n.exists(k) ? t(k) : h.trangThai;
    }
    const k = `scada.nhatKy.thu.${h.trangThai.replace(":", ".")}`;
    return i18n.exists(k) ? t(k) : h.trangThai;
  };

  const idLenhCoTrang = useMemo(
    () => new Set(hang.filter(h => h.nguon === "lenh").map(h => h.id)),
    [hang]
  );
  const bat = (k: string) =>
    loc.trangThai.includes(k)
      ? loc.trangThai.filter(x => x !== k)
      : [...loc.trangThai, k];

  return (
    <DashboardLayout
      title={t("scada.nhatKy.title")}
      navItems={navItems}
      currentPath="/scada/journal"
    >
      <PageContainer fluid>
        <PageHeader
          icon={<ScrollText className="h-6 w-6" />}
          title={t("scada.nhatKy.title")}
          description={t("scada.nhatKy.subtitle")}
        />

        <SectionCard
          title={t("scada.nhatKy.loc.tieuDe")}
          contentClassName="space-y-3"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="nhatky-may">{t("scada.nhatKy.loc.may")}</Label>
              <select
                id="nhatky-may"
                className={`${LOP_O_CHON} w-56`}
                value={loc.machineId}
                onChange={e => setLoc({ ...loc, machineId: e.target.value })}
              >
                <option value="">{t("scada.nhatKy.loc.tatCaMay")}</option>
                {may.map(m => (
                  <option key={m.machineId} value={String(m.machineId)}>
                    {m.code} · {m.ten}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nhatky-nguon">
                {t("scada.nhatKy.loc.nguon")}
              </Label>
              <select
                id="nhatky-nguon"
                className={`${LOP_O_CHON} w-44`}
                value={loc.nguon}
                onChange={e =>
                  setLoc({ ...loc, nguon: e.target.value as Nguon })
                }
              >
                {NGUON.map(n => (
                  <option key={n} value={n}>
                    {t(`scada.nhatKy.loc.nguonGiaTri.${n}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nhatky-tu">{t("scada.nhatKy.loc.tu")}</Label>
              <input
                id="nhatky-tu"
                type="datetime-local"
                className={`${LOP_O_CHON} w-52`}
                value={loc.tu}
                onChange={e => setLoc({ ...loc, tu: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nhatky-den">{t("scada.nhatKy.loc.den")}</Label>
              <input
                id="nhatky-den"
                type="datetime-local"
                className={`${LOP_O_CHON} w-52`}
                value={loc.den}
                onChange={e => setLoc({ ...loc, den: e.target.value })}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLoc(LOC_RONG)}
            >
              {t("scada.nhatKy.loc.xoa")}
            </Button>
          </div>
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <legend className="mb-1 text-sm font-medium">
              {t("scada.nhatKy.loc.trangThai")}
            </legend>
            {TRANG_THAI_LENH.map(s => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={loc.trangThai.includes(s)}
                  onChange={() => setLoc({ ...loc, trangThai: bat(s) })}
                />
                {t(`scada.nhatKy.trangThai.${s}`)}
              </label>
            ))}
          </fieldset>
        </SectionCard>

        <SectionCard
          title={t("scada.nhatKy.danhSach", { count: hang.length })}
          contentClassName="overflow-x-auto"
        >
          {trang === "tai" ? (
            <div
              role="status"
              aria-label={t("scada.nhatKy.dangTai")}
              className="space-y-2"
            >
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : trang === "loi" ? (
            <EmptyState
              variant="error"
              title={t("scada.nhatKy.loiTai")}
              compact
            />
          ) : hang.length === 0 ? (
            <EmptyState
              variant="no-data"
              title={t("scada.nhatKy.trong")}
              compact
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("scada.nhatKy.col.thoiGian")}</TableHead>
                    <TableHead>{t("scada.nhatKy.col.nguon")}</TableHead>
                    <TableHead>{t("scada.nhatKy.col.may")}</TableHead>
                    <TableHead>{t("scada.nhatKy.col.tag")}</TableHead>
                    <TableHead>{t("scada.nhatKy.col.trangThai")}</TableHead>
                    <TableHead>{t("scada.nhatKy.col.ma")}</TableHead>
                    <TableHead>{t("scada.nhatKy.col.lyDo")}</TableHead>
                    <TableHead>{t("scada.nhatKy.col.loi")}</TableHead>
                    <TableHead>{t("scada.nhatKy.col.nguoi")}</TableHead>
                    <TableHead>{t("scada.nhatKy.col.lienKet")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hang.map(h => {
                    const idSo = h.id.split(":")[1];
                    return (
                      <TableRow
                        key={h.id}
                        id={`nhatky-${h.nguon}-${idSo}`}
                        data-testid={`hang-${h.id}`}
                      >
                        <TableCell className="whitespace-nowrap text-sm tabular-nums">
                          {dinhDangGio(h.at)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {t(`scada.nhatKy.nguon.${h.nguon}`)}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-1.5">
                            <span>
                              {h.adapterCode ??
                                (h.machineId !== null
                                  ? (tenMay.get(h.machineId) ??
                                    `#${h.machineId}`)
                                  : "—")}
                            </span>
                            {h.laStub && (
                              <Badge
                                variant="outline"
                                title={t("scada.nhatKy.simGiaiThich")}
                                data-testid="nhan-sim"
                              >
                                {t("scada.nhatKy.sim")}
                              </Badge>
                            )}
                          </div>
                          {h.adapterCode && h.machineId !== null && (
                            <div className="text-xs text-muted-foreground">
                              {tenMay.get(h.machineId) ?? `#${h.machineId}`}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {h.tagKey ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {nhanTrangThai(h)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {h.reasonCode ? chuMa(h.reasonCode) : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {h.lyDo ? (
                            h.lyDo
                          ) : h.loiBiChe && h.nguon === "thu" ? (
                            <span className="text-muted-foreground">
                              {t("commandAudit.loiBiChe")}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {h.loi ? (
                            h.loi
                          ) : h.loiBiChe && h.nguon === "lenh" ? (
                            <span className="text-muted-foreground">
                              {t("commandAudit.loiBiChe")}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {h.nguoi
                            ? h.nguoi.ngoaiPhamVi
                              ? t("scada.nhatKy.nguoiNgoaiPhamVi")
                              : (h.nguoi.ten ?? "—")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {h.commandLogIds.length === 0
                            ? "—"
                            : h.commandLogIds.map(id =>
                                idLenhCoTrang.has(`lenh:${id}`) ? (
                                  <a
                                    key={id}
                                    href={`#nhatky-lenh-${id}`}
                                    className="mr-1 underline"
                                  >
                                    #{id}
                                  </a>
                                ) : (
                                  <span key={id} className="mr-1">
                                    #{id}
                                  </span>
                                )
                              )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {conTro !== null && (
                <div className="mt-3 flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => void taiThem()}
                    disabled={dangTaiThem}
                  >
                    {dangTaiThem
                      ? t("scada.nhatKy.dangTaiThem")
                      : t("scada.nhatKy.taiThem")}
                  </Button>
                </div>
              )}
            </>
          )}
        </SectionCard>
      </PageContainer>
    </DashboardLayout>
  );
}
