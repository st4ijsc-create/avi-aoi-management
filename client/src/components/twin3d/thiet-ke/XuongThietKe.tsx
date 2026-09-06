/**
 * XuongThietKe.tsx — BỐ CỤC BA VÙNG của màn Thiết kế (§7.1) và nơi mọi mảnh gặp
 * nhau: cây trái · canvas 3D giữa · Inspector phải · thư viện asset dải dưới,
 * cộng dải "Sức khoẻ dữ liệu" trên cùng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RB-4 — MỘT `<Canvas>` DUY NHẤT
 * ════════════════════════════════════════════════════════════════════════════
 * Ba vùng dùng `react-resizable-panels` (panel/drawer), KHÔNG dùng Radix Tabs.
 * `TwinHub.tsx:8-9` ghi rõ nó cố ý dựa vào Tabs-unmount để giữ 1 WebGL context;
 * ở đây không có cơ chế đó, nên bất biến phải do CẤU TRÚC bảo đảm: `CanhThietKe`
 * được dựng ĐÚNG MỘT LẦN trong cây này và không bao giờ nằm trong một nhánh
 * điều kiện có thể dựng thêm bản thứ hai.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI NGUỒN ĐỔI DỮ LIỆU, MỘT MÔ HÌNH
 * ════════════════════════════════════════════════════════════════════════════
 * Gizmo (chuột) và ô nhập (bàn phím) cùng ghi vào `datChoSua` — một `Map` duy
 * nhất. `datChoGoc` giữ ảnh chụp lúc tải để `gomThayDoi` biết cái gì thật sự
 * đổi. Đây là điều kiện để §7.3 "N thay đổi chưa lưu" là một con số THẬT chứ
 * không phải "số lần người dùng chạm vào cái gì đó".
 *
 * ★ Undo/redo dùng `lichSuThaoTac.ts` (30 test) — command pattern, không snapshot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Redo2, Save, Sparkles, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { trpc } from "@/lib/trpc";

import { gocTuQuatTrucDung, metSangMm, mmSangMet, quatXoayQuanhTrucDung } from "../heToaDo";
import {
  canhTheoBien,
  danDeu,
  type HuongCanh,
  type TrucScene,
  BUOC_GOC_MAC_DINH_DO,
  BUOC_LUOI_MAC_DINH_MM,
  buocNhanBanHopLe,
  nhanBanTuyenTinh,
} from "../hinhHocCanChinh";
import { hinhKhoiCho } from "../hinhKhoiMay";
import {
  coTheHoanTac,
  coTheLamLai,
  ghiThaoTac,
  hoanTac,
  lamLai,
  lichSuRong,
  xoaLichSu,
  type LichSu,
} from "../lichSuThaoTac";
import { CAU_HINH_SINH_MAC_DINH, type CauHinhSinh } from "../sinhBoCuc";
import type { MayTrongLo } from "../loi";

import { BangThuocTinh } from "./BangThuocTinh";
import { CanhThietKe } from "./CanhThietKe";
import { CayPhanCap } from "./CayPhanCap";
import { HopThoaiSinh } from "./HopThoaiSinh";
import { ThanhCanChinh } from "./ThanhCanChinh";
import { ThuVienAsset } from "./ThuVienAsset";
import { DaiSucKhoe } from "./DaiSucKhoe";
import { cheDoTuPhim, type CheDoGizmo, type TrucKhoa, trucSauPhim } from "./gizmoNoiLogic";
import {
  apChon,
  apDichVaoDatCho,
  bboxCuaDatCho,
  chiaLo,
  dungCayThietKe,
  gomThayDoi,
  khoaNode,
  kichThuocDeVe,
  nodeChuDao,
  tachKhoaNode,
  tinhSucKhoeDuLieu,
  type DatChoDauVao,
  type KhoaNode,
  type TapChon,
} from "./trangThaiThietKe";
import { dungLopMa, soMaySeDoi, tongKetSinh, type HopMa } from "./xemTruocSinh";

export interface XuongThietKeProps {
  factoryId: number;
  /** Tầng đang chọn; `null` = nhà máy chưa có toà nhà nào. */
  tangId: number | null;
  sanRongMm: number;
  sanSauMm: number;
}

export function XuongThietKe({ factoryId, tangId, sanRongMm, sanSauMm }: XuongThietKeProps) {
  const { t } = useTranslation();
  const tienIch = trpc.useUtils();

  // ── Dữ liệu ──────────────────────────────────────────────────────────────
  const canhQ = trpc.twinCanh.canhThietKe.useQuery(
    { factoryId, tangIds: tangId === null ? [] : [tangId] },
    { enabled: factoryId > 0 },
  );

  const [datChoSua, setDatChoSua] = useState<Map<KhoaNode, DatChoDauVao>>(new Map());
  const [lichSu, setLichSu] = useState<LichSu>(lichSuRong);
  const [chon, setChon] = useState<TapChon>([]);
  const [cheDo, setCheDo] = useState<CheDoGizmo>("translate");
  const [snapBat, setSnapBat] = useState(true);
  const [trucKhoa, setTrucKhoa] = useState<TrucKhoa>(null);
  const [hienLuoi, setHienLuoi] = useState(true);
  const [moSinh, setMoSinh] = useState(false);
  const [cauHinhSinh, setCauHinhSinh] = useState<CauHinhSinh>({ ...CAU_HINH_SINH_MAC_DINH });
  const [ma, setMa] = useState<readonly HopMa[]>([]);
  const [dangDo, setDangDo] = useState(false);

  /** Ảnh chụp lúc tải — mẫu so để biết cái gì THẬT SỰ đổi (§7.3). */
  const datChoGoc = useMemo(() => {
    const m = new Map<KhoaNode, DatChoDauVao>();
    for (const d of canhQ.data?.datCho ?? []) {
      m.set(khoaNode(d.loaiThucThe, d.thucTheId), d as DatChoDauVao);
    }
    return m;
  }, [canhQ.data]);

  // Nạp bản sửa từ bản gốc mỗi khi dữ liệu server đổi (tải xong / sau khi lưu).
  useEffect(() => {
    setDatChoSua(new Map(datChoGoc));
    setLichSu(xoaLichSu());
  }, [datChoGoc]);

  const kichThuocTheoLoai = useMemo(() => {
    const m = new Map<string, { rongMm: number; caoMm: number; sauMm: number }>();
    for (const k of canhQ.data?.kichThuoc ?? []) {
      m.set(k.loaiMay, { rongMm: k.rongMm, caoMm: k.caoMm, sauMm: k.sauMm });
    }
    return m;
  }, [canhQ.data]);

  const may = canhQ.data?.may ?? [];

  // ── Cây + sức khoẻ ───────────────────────────────────────────────────────
  const datChoMang = useMemo(() => [...datChoSua.values()], [datChoSua]);

  const cay = useMemo(
    () =>
      dungCayThietKe(
        // `traCayPhanCapNhaMay` không trả `tangId` (xưởng chưa gắn tầng ở mô
        // hình hiện tại — xem `chuanBiSinh`), nên bù `null` tường minh thay vì
        // để kiểu lỏng: `null` nghĩa "chưa gắn", và cây trái không dùng ô này.
        (canhQ.data?.xuong ?? []).map((x) => ({ ...x, tangId: null })),
        canhQ.data?.chuyen ?? [],
        canhQ.data?.tram ?? [],
        may.map((m) => ({
          id: m.id,
          ma: m.ma,
          ten: m.ten,
          loaiMay: String(m.loaiMay),
          isActive: m.isActive,
          stationId: m.stationId,
        })),
        datChoMang,
      ),
    [canhQ.data, may, datChoMang],
  );

  const sucKhoe = useMemo(
    () =>
      tinhSucKhoeDuLieu(
        may.map((m) => ({
          id: m.id,
          ma: m.ma,
          ten: m.ten,
          loaiMay: String(m.loaiMay),
          isActive: m.isActive,
          stationId: m.stationId,
        })),
        datChoMang,
        canhQ.isLoading,
      ),
    [may, datChoMang, canhQ.isLoading],
  );

  // ── Máy để VẼ ────────────────────────────────────────────────────────────
  const mayVe = useMemo<MayTrongLo[]>(() => {
    const ra: MayTrongLo[] = [];
    for (const m of may) {
      if (!m.isActive) continue;
      const d = datChoSua.get(khoaNode("machine", m.id));
      if (!d || !d.hienThi) continue;
      const { kichThuoc } = kichThuocDeVe(d, kichThuocTheoLoai.get(String(m.loaiMay)) ?? null);
      ra.push({
        machineId: m.id,
        khoi: hinhKhoiCho(String(m.loaiMay)),
        kichThuocMm: kichThuoc,
        // DB: X = Đông, Y = mặt bằng, Z = độ cao → scene: x, y = độ cao, z = mặt bằng.
        viTri: {
          x: mmSangMet(d.viTriXMm),
          y: mmSangMet(d.viTriZMm),
          z: mmSangMet(d.viTriYMm),
        },
        gocXoayRad: gocTuQuatTrucDung({ x: d.quatX, y: d.quatY, z: d.quatZ, w: d.quatW }),
        mau: d.daKhoa ? "#94a3b8" : "#64748b",
      });
    }
    return ra;
  }, [may, datChoSua, kichThuocTheoLoai]);

  const khoaChuDao = nodeChuDao(chon);
  const nodeDangChon = khoaChuDao ? (cay.theoKhoa.get(khoaChuDao) ?? null) : null;
  const datChoDangChon = khoaChuDao ? (datChoSua.get(khoaChuDao) ?? null) : null;
  const machineIdChon = useMemo(() => {
    if (!khoaChuDao) return null;
    const tach = tachKhoaNode(khoaChuDao);
    return tach && tach.loai === "machine" ? tach.id : null;
  }, [khoaChuDao]);

  // ── Sửa một vật thể + ghi lịch sử ────────────────────────────────────────
  const apSua = useCallback(
    (khoa: KhoaNode, sua: Partial<DatChoDauVao>, op: "keo" | "xoay" | "canh" | "khoa" = "keo") => {
      setDatChoSua((cu) => {
        const truoc = cu.get(khoa);
        if (!truoc) return cu;
        const sau = { ...truoc, ...sua };
        const m = new Map(cu);
        m.set(khoa, sau);
        setLichSu((ls) =>
          ghiThaoTac(ls, {
            op,
            targets: [khoa],
            truoc: { [khoa]: truoc as unknown as Record<string, unknown> },
            sau: { [khoa]: sau as unknown as Record<string, unknown> },
            moc: Date.now(),
          }),
        );
        return m;
      });
    },
    [],
  );

  /** Áp một lô thay đổi (align/distribute/array) như MỘT lệnh undo. */
  const apLo = useCallback(
    (
      doi: readonly { khoa: KhoaNode; sua: Partial<DatChoDauVao> }[],
      op: "canh" | "danDeu" | "nhanBan",
    ) => {
      if (doi.length === 0) return;
      setDatChoSua((cu) => {
        const m = new Map(cu);
        const truoc: Record<string, Record<string, unknown>> = {};
        const sau: Record<string, Record<string, unknown>> = {};
        for (const { khoa, sua } of doi) {
          const t = cu.get(khoa);
          if (!t) continue;
          const s = { ...t, ...sua };
          m.set(khoa, s);
          truoc[khoa] = t as unknown as Record<string, unknown>;
          sau[khoa] = s as unknown as Record<string, unknown>;
        }
        setLichSu((ls) =>
          ghiThaoTac(ls, { op, targets: doi.map((d) => d.khoa), truoc, sau, moc: Date.now() }),
        );
        return m;
      });
    },
    [],
  );

  // ── Undo / redo ──────────────────────────────────────────────────────────
  const chayHoanTac = useCallback(() => {
    setLichSu((ls) => {
      const kq = hoanTac(ls);
      if (kq.canGhi) {
        setDatChoSua((cu) => {
          const m = new Map(cu);
          for (const [k, v] of Object.entries(kq.canGhi!)) m.set(k, v as unknown as DatChoDauVao);
          return m;
        });
      }
      return kq.lichSu;
    });
  }, []);

  const chayLamLai = useCallback(() => {
    setLichSu((ls) => {
      const kq = lamLai(ls);
      if (kq.canGhi) {
        setDatChoSua((cu) => {
          const m = new Map(cu);
          for (const [k, v] of Object.entries(kq.canGhi!)) m.set(k, v as unknown as DatChoDauVao);
          return m;
        });
      }
      return kq.lichSu;
    });
  }, []);

  // ── Lưu ──────────────────────────────────────────────────────────────────
  const thayDoi = useMemo(() => gomThayDoi(datChoGoc, datChoSua), [datChoGoc, datChoSua]);
  const luuM = trpc.twinCanh.luuHangLoat.useMutation();

  const luu = useCallback(async () => {
    if (thayDoi.length === 0) return;
    try {
      for (const lo of chiaLo(thayDoi)) {
        // ★ NT-4 — hàng đi qua đường NÀY là do NGƯỜI kéo/gõ ⇒ nguon='tay',
        //   lần Sinh tự động sau KHÔNG đè lên nó.
        await luuM.mutateAsync({ hangs: lo.map((h) => ({ ...h, nguon: "tay" as const })) });
      }
      await tienIch.twinCanh.canhThietKe.invalidate();
      toast.success(t("twin3d.studioUi.daLuu"));
    } catch (e) {
      toast.error(
        t("twin3d.studioUi.loiLuu", { loi: e instanceof Error ? e.message : String(e) }),
      );
    }
  }, [thayDoi, luuM, tienIch, toast, t]);

  // ★ §7.3 — chặn rời trang khi còn thay đổi chưa lưu.
  useEffect(() => {
    if (thayDoi.length === 0) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [thayDoi.length]);

  // ── Phím tắt (§7.2) ──────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      // Không nuốt phím khi con trỏ đang trong ô nhập — nếu không thì gõ "we"
      // vào ô lọc sẽ đổi chế độ gizmo.
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) chayLamLai();
        else chayHoanTac();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void luu();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const moi = cheDoTuPhim(e.key);
      if (moi) {
        setCheDo(moi);
        return;
      }
      const truc = trucSauPhim(trucKhoa, e.key);
      if (truc !== trucKhoa) setTrucKhoa(truc);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [chayHoanTac, chayLamLai, luu, trucKhoa]);

  // ── Align / distribute / array — qua `hinhHocCanChinh` (hoán vị trục ở
  //    `bboxCuaDatCho`/`apDichVaoDatCho`, xem docblock của chúng) ────────────
  const dsBboxDangChon = useMemo(
    () =>
      chon
        .map((k) => {
          const d = datChoSua.get(k);
          if (!d) return null;
          const loai = tachKhoaNode(k);
          const m = loai ? may.find((x) => x.id === loai.id) : null;
          const { kichThuoc } = kichThuocDeVe(
            d,
            m ? (kichThuocTheoLoai.get(String(m.loaiMay)) ?? null) : null,
          );
          return { khoa: k, bbox: bboxCuaDatCho(d, kichThuoc) };
        })
        .filter((v): v is { khoa: KhoaNode; bbox: ReturnType<typeof bboxCuaDatCho> } => v !== null),
    [chon, datChoSua, may, kichThuocTheoLoai],
  );

  const apKetQuaDich = useCallback(
    (kq: readonly { khoa: string; dich: { x: number; y: number; z: number } }[], op: "canh" | "danDeu") => {
      const doi: { khoa: KhoaNode; sua: Partial<DatChoDauVao> }[] = [];
      for (const k of kq) {
        if (k.dich.x === 0 && k.dich.y === 0 && k.dich.z === 0) continue;
        const d = datChoSua.get(k.khoa);
        if (!d || d.daKhoa) continue;
        const moi = apDichVaoDatCho(d, k.dich);
        doi.push({
          khoa: k.khoa,
          sua: { viTriXMm: moi.viTriXMm, viTriYMm: moi.viTriYMm, viTriZMm: moi.viTriZMm },
        });
      }
      apLo(doi, op);
    },
    [datChoSua, apLo],
  );

  // ── Sinh tự động ─────────────────────────────────────────────────────────
  const xemTruocQ = trpc.twinCanh.xemTruocSinh.useQuery(
    { factoryId, tangIds: tangId === null ? [] : [tangId], cauHinh: cauHinhSinh },
    { enabled: false },
  );
  const sinhM = trpc.twinCanh.sinhTuDong.useMutation();

  const tongKet = useMemo(() => {
    const d = xemTruocQ.data;
    if (!d) return null;
    return tongKetSinh(
      { datCho: d.datCho, vatThe: d.vatThe, boQua: d.boQua, canhBao: d.canhBao },
      d.datChoHienCo as DatChoDauVao[],
    );
  }, [xemTruocQ.data]);

  const xemTruoc = useCallback(async () => {
    const kq = await xemTruocQ.refetch();
    const d = kq.data;
    if (!d) return;
    setMa(
      dungLopMa(
        { datCho: d.datCho, vatThe: d.vatThe, boQua: d.boQua, canhBao: d.canhBao },
        d.datChoHienCo as DatChoDauVao[],
      ),
    );
  }, [xemTruocQ]);

  const apDungSinh = useCallback(async () => {
    try {
      const kq = await sinhM.mutateAsync({
        factoryId,
        tangIds: tangId === null ? [] : [tangId],
        cauHinh: cauHinhSinh,
      });
      await tienIch.twinCanh.canhThietKe.invalidate();
      setMa([]);
      setMoSinh(false);
      toast.success(t("twin3d.sinh.xong", { n: kq.daGhi, m: kq.giuNguyen }));
    } catch (e) {
      toastTrpcError(e);
    }
  }, [sinhM, factoryId, tangId, cauHinhSinh, tienIch, toast, t]);

  // ── Gỡ khỏi mặt bằng ─────────────────────────────────────────────────────
  const goM = trpc.twinCanh.goKhoiMatBang.useMutation();
  const goKhoi = useCallback(
    async (khoa: KhoaNode) => {
      const tach = tachKhoaNode(khoa);
      if (!tach) return;
      try {
        await goM.mutateAsync({ loaiThucThe: tach.loai, thucTheId: tach.id });
        await tienIch.twinCanh.canhThietKe.invalidate();
        setChon([]);
      } catch (e) {
        toastTrpcError(e);
      }
    },
    [goM, tienIch, toast],
  );

  // ── Đo khoảng cách (§7.2 #12) ────────────────────────────────────────────
  const [ketQuaDoMm, setKetQuaDoMm] = useState<number | null>(null);
  const diemDo = useRef<{ x: number; y: number; z: number }[]>([]);
  useEffect(() => {
    if (!dangDo) {
      diemDo.current = [];
      setKetQuaDoMm(null);
    }
  }, [dangDo]);

  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="xuong-thiet-ke">
      {/* ── Thanh công cụ trên cùng ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <div className="flex items-center gap-1">
          {(["translate", "rotate", "scale"] as CheDoGizmo[]).map((cd, i) => (
            <Button
              key={cd}
              size="sm"
              variant={cheDo === cd ? "secondary" : "ghost"}
              className="h-7 px-2 text-[11px]"
              data-testid={`nut-che-do-${cd}`}
              onClick={() => setCheDo(cd)}
            >
              {t(`twin3d.congCu.${["diChuyen", "xoay", "coGian"][i]}`)}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <Switch
            checked={snapBat}
            onCheckedChange={setSnapBat}
            data-testid="cong-tac-bat-dinh"
          />
          <Label className="text-[11px]">{t("twin3d.studioUi.batDinh")}</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <Switch checked={hienLuoi} onCheckedChange={setHienLuoi} data-testid="cong-tac-luoi" />
          <Label className="text-[11px]">{t("twin3d.studioUi.luoi")}</Label>
        </div>

        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={!coTheHoanTac(lichSu)}
          data-testid="nut-hoan-tac"
          onClick={chayHoanTac}
          aria-label={t("twin3d.studioUi.hoanTac")}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={!coTheLamLai(lichSu)}
          data-testid="nut-lam-lai"
          onClick={chayLamLai}
          aria-label={t("twin3d.studioUi.lamLai")}
        >
          <Redo2 className="h-4 w-4" />
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {thayDoi.length > 0 ? (
            <Badge variant="outline" className="text-[11px]" data-testid="dem-chua-luu">
              {t("twin3d.studioUi.chuaLuu", { n: thayDoi.length })}
            </Badge>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-[11px]"
            data-testid="nut-mo-sinh"
            onClick={() => setMoSinh(true)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t("twin3d.studioUi.sinhTuDong")}
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-[11px]"
            disabled={thayDoi.length === 0 || luuM.isPending}
            data-testid="nut-luu"
            onClick={() => void luu()}
          >
            <Save className="h-3.5 w-3.5" />
            {luuM.isPending ? t("twin3d.studioUi.dangLuu") : t("twin3d.studioUi.luu")}
          </Button>
        </div>
      </div>

      {/* ── ★ Dải "Sức khoẻ dữ liệu" (§7.1) ─────────────────────────────── */}
      <DaiSucKhoe sucKhoe={sucKhoe} />

      <ThanhCanChinh
        soDangChon={chon.length}
        onCanh={(huong: HuongCanh) => apKetQuaDich(canhTheoBien(dsBboxDangChon, huong), "canh")}
        onDanDeu={(truc: TrucScene) => apKetQuaDich(danDeu(dsBboxDangChon, truc), "danDeu")}
        onNhanBanTuyenTinh={(buocMm, soLuong, truc) => {
          /*
           * ★ PHẠM VI CÓ Ý THỨC — nhân bản ở đợt này chỉ XEM TRƯỚC, chưa ghi.
           *
           * `nhanBanTuyenTinh(bbox, truc, buocMm, soLuong)` trả BBOX của các bản
           * sao — thuần hình học, không biết gì về danh tính. Để GHI được chúng
           * cần một bản ghi `machines` mới cho từng bản sao: `twin_dat_cho` có
           * `uniqueIndex(loaiThucThe, thucTheId)` nên một bản sao KHÔNG thể có
           * hàng đặt chỗ riêng nếu không có máy riêng. Ghi bừa vào đó tạo ra
           * đúng thứ mà dải Sức khoẻ đang đếm là "đặt chỗ mồ côi".
           *
           * Nên ở đây nó dựng GHOST và dừng. Nói thẳng phạm vi tốt hơn là làm
           * nửa vời rồi để dữ liệu lệch tự sinh.
           */
          if (!buocNhanBanHopLe(buocMm)) return;
          const ra: HopMa[] = [];
          for (const v of dsBboxDangChon) {
            const banSao = nhanBanTuyenTinh(v.bbox, truc, buocMm, soLuong);
            banSao.forEach((b, i) => {
              ra.push({
                khoa: `ban-sao:${v.khoa}:${i}`,
                loai: "machine" as const,
                // BBox ở trục SCENE → quy ngược về trục DB (y↔z). Cùng phép hoán
                // vị của `dichSceneSangDatCho`, xem docblock `bboxCuaDatCho`.
                viTriXMm: (b.minX + b.maxX) / 2,
                viTriYMm: (b.minZ + b.maxZ) / 2,
                viTriZMm: b.minY,
                rongMm: b.maxX - b.minX,
                caoMm: b.maxY - b.minY,
                sauMm: b.maxZ - b.minZ,
                seDoi: true,
              });
            });
          }
          setMa(ra);
        }}
        onNhanBanToaTron={() => {
          toast.info(t("twin3d.thuVien.sapCo"));
        }}
        dangDo={dangDo}
        onBatDo={setDangDo}
        ketQuaDoMm={ketQuaDoMm}
      />

      {/* ── Ba vùng ─────────────────────────────────────────────────────── */}
      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={20} minSize={12} className="min-w-0">
          <CayPhanCap
            cay={cay}
            chon={chon}
            onChon={(khoa, shift) => setChon((cu) => apChon(cu, khoa, shift))}
            soChoXepCho={sucKhoe.choXepCho}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={58} minSize={30} className="min-w-0">
          <div className="h-full min-h-0" data-testid="vung-canvas">
            {/* ★★★ RB-4 — ĐÚNG MỘT chỗ dựng canvas trong toàn màn. */}
            <CanhThietKe
              may={mayVe}
              mayDangChon={machineIdChon}
              mayDaKhoa={datChoDangChon?.daKhoa ?? false}
              cheDo={cheDo}
              snapBat={snapBat}
              buocLuoiMm={BUOC_LUOI_MAC_DINH_MM}
              buocGocDo={BUOC_GOC_MAC_DINH_DO}
              trucKhoa={trucKhoa}
              ma={ma}
              sanRongM={mmSangMet(sanRongMm)}
              sanSauM={mmSangMet(sanSauMm)}
              hienLuoi={hienLuoi}
              chuMatContext={t("twin3d.loi.matContext")}
              onChonMay={(machineId) =>
                setChon(machineId === null ? [] : [khoaNode("machine", machineId)])
              }
              onBienDoiXong={({ viTri, gocYDo }) => {
                if (!khoaChuDao) return;
                const q = quatXoayQuanhTrucDung((gocYDo * Math.PI) / 180);
                apSua(
                  khoaChuDao,
                  {
                    // scene → DB: y scene là ĐỘ CAO (→ viTriZMm), z scene là
                    // mặt bằng (→ viTriYMm). Xem `dichSceneSangDatCho`.
                    viTriXMm: metSangMm(viTri.x),
                    viTriYMm: metSangMm(viTri.z),
                    viTriZMm: metSangMm(viTri.y),
                    quatX: q.x,
                    quatY: q.y,
                    quatZ: q.z,
                    quatW: q.w,
                  },
                  cheDo === "rotate" ? "xoay" : "keo",
                );
              }}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={22} minSize={14} className="min-w-0">
          <BangThuocTinh
            node={nodeDangChon}
            datCho={datChoDangChon}
            soDangChon={chon.length}
            buocGocDo={BUOC_GOC_MAC_DINH_DO}
            onSua={(khoa, sua) => apSua(khoa, sua, "keo")}
            onGoKhoiMatBang={(khoa) => void goKhoi(khoa)}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* ── Thư viện asset — dải dưới ───────────────────────────────────── */}
      <ThuVienAsset />

      <HopThoaiSinh
        mo={moSinh}
        onDoiMo={(v) => {
          setMoSinh(v);
          if (!v) setMa([]);
        }}
        cauHinh={cauHinhSinh}
        onDoiCauHinh={setCauHinhSinh}
        tongKet={tongKet}
        soMaySeDoi={soMaySeDoi(ma)}
        dangTinh={xemTruocQ.isFetching}
        dangGhi={sinhM.isPending}
        onXemTruoc={() => void xemTruoc()}
        onApDung={() => void apDungSinh()}
      />
    </div>
  );
}

export default XuongThietKe;
