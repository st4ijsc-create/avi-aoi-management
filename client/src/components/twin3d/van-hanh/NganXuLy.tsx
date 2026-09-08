/**
 * NganXuLy.tsx — ★★★ PHẦN QUAN TRỌNG NHẤT CỦA MÀN VẬN HÀNH (§9.2).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * TWIN LÀ NƠI **XỬ LÝ**, KHÔNG CHỈ ĐỂ XEM
 * ════════════════════════════════════════════════════════════════════════════
 * Yêu cầu chủ sở hữu: *"mọi hoạt động quản lý cũng như theo dõi sau này đều có
 * thể xử lý trên 3D Digital Twin này"*. Khảo sát cho thấy **không hệ lớn nào**
 * (AWS TwinMaker, Azure ADT, ThingsBoard) cho ack alarm / tạo phiếu ngay trên
 * 3D ⇒ **không có tiền lệ để sao chép**.
 *
 * Cách giải mâu thuẫn giữa yêu cầu đó và luật "3D không nên là mặt xử lý alarm"
 * (ASM/ISA-101): **ngữ cảnh ở 3D, hành động ở ngăn 2D này**. Người dùng click
 * máy trên cảnh → ngăn này mở ngay cạnh, và mọi thao tác diễn ra trên bề mặt 2D
 * tuân chuẩn. KHÔNG có nút ack nổi trên máy 3D (NT-2).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TÁI DÙNG BACKEND CÓ SẴN — KHÔNG VIẾT THỦ TỤC MỚI
 * ════════════════════════════════════════════════════════════════════════════
 * Cả ba nhóm hành động đều đã có thủ tục chạy thật trong repo. Đo 2026-09-06:
 *
 *   ack       → `andon.acknowledge({ id })`                 andon/canEdit
 *               ghi `andon_events`: status/acknowledgedAt/acknowledgedBy/mttaSeconds
 *               + audit row + socket `andon:event`. Idempotent.
 *   ẩn tạm    → `equipmentStandards.shelveMasterAlarm({ id, shelvedUntil })`
 *               machine_control/canCreate + cờ `EQ_GOVERN_ENABLED` (=true ở dev)
 *               ghi `master_alarms.shelvedUntil` + `recordAuditEvent(action:"shelve")`
 *               ⚠ Đây là shelve ở cấp ĐỊNH NGHĨA alarm (ISA-18.2), không phải
 *                 snooze một sự kiện — repo KHÔNG có đường shelve từng andon_event.
 *                 Xem docblock `AnTamAlarm` bên dưới về hệ quả UI.
 *   tạo phiếu → `maintenance.createWorkOrder({...})`         machine_monitoring/canCreate
 *               (→ resolve thành `machine_status`, xem `shared/permissions.ts`)
 *               ghi `maintenance_work_orders`, trigger="MANUAL", trả nguyên hàng.
 *   gán KTV   → cùng `createWorkOrder` qua ô `assignedTo` + `priority`.
 *               KHÔNG có thủ tục `assignWorkOrder` riêng — gán là một ô của phiếu.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ QUYỀN — ẨN, KHÔNG DISABLE (cùng luật CHẶN-2 của màn Thiết kế)
 * ════════════════════════════════════════════════════════════════════════════
 * Nút xám nói *"chức năng này thuộc về bạn, chỉ đang không dùng được lúc này"* —
 * SAI với người không bao giờ có quyền. `duocPhep=false` ⇒ không render.
 * `lyDoChan` (đã ack / chưa chọn máy) mới là ca disable + giải thích.
 *
 * ⚠ Đây là cưỡng chế TRÌNH BÀY, KHÔNG thay cổng server (phòng thủ nhiều lớp).
 * ⚠ Phép đo quyền PHẢI bằng tài khoản KHÔNG-admin — admin bypass
 *   `requirePermission`, nên đo bằng admin chứng minh SỐ 0.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ §9.9 — MỌI HÀNH ĐỘNG Ở ĐÂY PHẢI LÀM ĐƯỢC TỪ BÀN PHÍM
 * ════════════════════════════════════════════════════════════════════════════
 * Ngăn này là DOM thật, mọi nút là `<button>` thật, thứ tự tab theo thứ tự đọc.
 * Danh sách máy bên trái chọn được bằng Tab+Enter, và selection đó mở đúng ngăn
 * này — nên đường "Tab tới danh sách → Enter → ack" không đi qua WebGL một bước
 * nào. Đó là điều kiện để người dùng bàn phím/trình đọc màn hình xử lý được việc.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ClipboardPlus, Clock, ExternalLink, Maximize2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";

import { mauChoTrangThai } from "../mauTrangThai";
import { NganNhung } from "./NganNhung";
import {
  MOC_AN_TAM_GIO,
  hanAnTam,
  hanhDongChoVatThe,
  nguoiGanDuoc,
  nutDieuHuongCho,
  type CanhBaoDangMo,
  type LoaiDich,
  type QuyenXuLy,
  docStatsAoi,
} from "./nganXuLyLogic";
import { nhungChoHref, type LyDoNgan, type NganNhungMo } from "./nhungTaiCho";
import { hienSo, nhanDoTuoi, nhanTuoiDocDuoc, type TrangThaiHienThi } from "./trungThucDuLieu";

export interface NganXuLyProps {
  /** Máy đang chọn; `null` ⇒ ngăn hiện lời mời chọn. */
  machineId: number | null;
  ma: string;
  ten: string;
  /** Trạng thái ĐÃ xét tuổi (NT-3) — KHÔNG phải giá trị thô từ DB. */
  trangThai: TrangThaiHienThi;
  /** `max(timestamp)` của dữ liệu máy này. */
  thoiDiemDuLieu: number | null;
  bayGio: number;
  canhBao: readonly CanhBaoDangMo[];
  quyen: QuyenXuLy;
  /** Người dùng có `canView` module này không — để ẩn nút điều hướng vô ích. */
  coQuyenXem: (module: string) => boolean;
  /** Gọi sau khi ack/tạo phiếu thành công để tầng trên nạp lại dữ liệu. */
  onDaXuLy: () => void;
  /**
   * Điều hướng nội bộ (wouter `setLocation`) — **CHỈ CÒN cho đích chưa nhúng
   * được**. Xem `onMoTaiCho` và docblock "XEM CHI TIẾT TẠI CHỖ" bên dưới.
   */
  onDieuHuong: (href: string) => void;
  /**
   * ★★★ Đợt 10 mục 5 — MỞ CHI TIẾT **TẠI CHỖ**, không rời `/twin`.
   *
   * Ngăn mở là trạng thái của TẦNG TRÊN (nó ghi vào URL `?xem=` để F5 không mất
   * ngữ cảnh), nên `NganXuLy` chỉ *yêu cầu* mở, không tự giữ state. `undefined`
   * ⇒ tầng trên chưa nối, và mọi nút rơi về `onDieuHuong` như trước — không có
   * nút nào chết, chỉ mất tính năng mới.
   */
  onMoTaiCho?: (ngan: NganNhungMo) => void;
  /**
   * Ngăn nhúng đang mở (đọc từ URL ở tầng trên). `undefined`/`null` ⇒ đóng.
   * `NganXuLy` render ngăn vì đây là nơi các nút mở nó sống — người dùng bấm ở
   * đâu thì nội dung mở ra ngay từ đó.
   */
  nganNhung?: NganNhungMo | null;
  /** Đóng ngăn nhúng — tầng trên xoá `?xem=`. */
  onDongNhung?: () => void;
  /**
   * ★ ĐỢT 24 VIỆC 3 (L-5) — vì sao ngăn mở được. Chuyển thẳng xuống
   * `NganNhung`; bỏ trống ⇒ `"mo"` (hành vi cũ).
   */
  lyDoNgan?: LyDoNgan;
  /** Loại vật thể đang chọn — quyết định bộ nút §9.3. */
  loaiDich?: LoaiDich;
}

export function NganXuLy(props: NganXuLyProps) {
  const { t } = useTranslation();
  const {
    machineId,
    ma,
    ten,
    trangThai,
    thoiDiemDuLieu,
    bayGio,
    canhBao,
    quyen,
    coQuyenXem,
    onDaXuLy,
    onDieuHuong,
    onMoTaiCho,
    nganNhung = null,
    onDongNhung,
    lyDoNgan,
    loaiDich = "machine",
  } = props;

  const hanhDong = hanhDongChoVatThe({ quyen, machineId, canhBao });
  const tra = (ma_: string) => hanhDong.find((h) => h.ma === ma_)!;

  /* ── Mutation: ACK ────────────────────────────────────────────────────── */
  const ackM = trpc.andon.acknowledge.useMutation({
    onSuccess: () => {
      toast.success(t("twin3d.vanHanh.daAck", "Đã xác nhận cảnh báo"));
      onDaXuLy();
    },
    onError: (e) => toastTrpcError(e),
  });

  /* ── Mutation: TẠO PHIẾU ──────────────────────────────────────────────── */
  const taoPhieuM = trpc.maintenance.createWorkOrder.useMutation({
    onSuccess: (row) => {
      toast.success(
        t("twin3d.vanHanh.daTaoPhieu", "Đã tạo phiếu {{so}}", {
          so: (row as { workOrderNumber?: string })?.workOrderNumber ?? "",
        }),
      );
      setMoTaoPhieu(false);
      onDaXuLy();
    },
    onError: (e) => toastTrpcError(e),
  });

  const [moTaoPhieu, setMoTaoPhieu] = useState(false);
  const [tieuDePhieu, setTieuDePhieu] = useState("");
  const [uuTien, setUuTien] = useState("3");
  const [ganCho, setGanCho] = useState<string>("");

  /**
   * Danh sách người để gán. Nếu tài khoản không có quyền thì truy vấn lỗi và ta
   * ĐỂ Ô TRỐNG thay vì chặn cả form — gán KTV là tuỳ chọn, không phải điều kiện
   * để tạo phiếu.
   *
   * ★★★ NỢ ĐÃ ĐÓNG (2026-09-07). Trước đây ô này gọi `user.list`, là thủ tục
   * **ADMIN-ONLY** (`userRouters.ts` ném FORBIDDEN khi `ctx.user.role !==
   * 'admin'`), nên dropdown **RỖNG với MỌI tài khoản không phải admin** — tức
   * với đúng những vai (bảo trì, kỹ thuật, giám sát) mà tính năng này sinh ra
   * để phục vụ. QA trước tái hiện bằng admin nên không thấy: admin bypass, và ô
   * rỗng trông y hệt "chưa có ai để gán".
   *
   * Nay dùng `user.assignableTechnicians` — thủ tục HẸP, gate bằng ĐÚNG quyền
   * mà `maintenance.createWorkOrder` đòi (`machine_monitoring/canCreate`), chỉ
   * trả `{id, name}` của người `isActive = true`. `user.list` KHÔNG bị đổi: nó
   * là hợp đồng dùng chung, nhiều màn khác gọi.
   *
   * ★ Cổng `quyen.taoPhieu` (không phải `suaPhieu`): danh sách này phục vụ việc
   *   TẠO phiếu, và nó cùng một quyền với thủ tục server — hai bên khai cùng một
   *   câu thì không thể lệch (luật Khối D "một lối vào rồi TỪ CHỐI").
   */
  const nguoiQ = trpc.user.assignableTechnicians.useQuery(undefined, {
    enabled: moTaoPhieu && quyen.taoPhieu,
    retry: false,
  });

  /**
   * ★ T-4 — LỌC tài khoản đã vô hiệu hoá khỏi danh sách gán (§9.2).
   * Gán phiếu cho người đã nghỉ việc là phiếu KHÔNG AI NHẬN, và nó im lặng.
   */
  const nguoiGan = useMemo(() => nguoiGanDuoc(nguoiQ.data), [nguoiQ.data]);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ §11 #60 — STATS AOI OK/NG/NTF/YIELD (Đợt 8 lô D)                     */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * ★★★ SPEC/BRIEF SAI — nguồn ĐÚNG là `getMachineStats`, KHÔNG `getAllMachinesStats`.
   *
   * Brief lô D chỉ `dashboard.getAllMachinesStats`. Đo hợp đồng
   * (`dashboardStatsRouters.ts:95-153`): thủ tục đó gọi `getMachinesWithHierarchy()`
   * rồi `Promise.all` **một `getMachineStats` cho MỖI máy** — 42 máy trên SIM-FAC —
   * để ngăn này dùng đúng **một** hàng. Đó là 42 lần truy vấn để hiển thị 1/42
   * kết quả, đúng lớp lỗi N+1 mà Đ6 sinh ra để diệt ("Không còn N+1 trong vòng
   * render").
   *
   * `dashboard.getMachineStats` (`:75-93`) là **cùng một** `protectedProcedure`,
   * **cùng một** `db.getMachineStats` với cùng `StatsScopeArgs`, và **cùng một**
   * khoá cache (`scopedStatsCacheKey(CACHE_KEYS.MACHINE_STATS, …)`) — nên số ra
   * bằng nhau từng chữ số, chỉ khác là không kéo theo 41 máy không ai xem.
   * ⇒ Dùng thủ tục hẹp. Đã báo cáo là bác brief, không im lặng đổi.
   *
   * ★ G15 — BA trạng thái: `dangTai` · `isError` · có dữ liệu. Truy vấn 403
   *   (thiếu quyền đọc thống kê) trả rỗng, và một ngăn in "Yield 0 %" cho người
   *   không được phép thấy số là lời nói dối tệ nhất của một màn giám sát.
   */
  const statsQ = trpc.dashboard.getMachineStats.useQuery(
    { machineId: machineId ?? 0 },
    { enabled: machineId !== null, retry: false, staleTime: 30_000 },
  );

  const statsAoi = useMemo(
    () => docStatsAoi(statsQ.data, statsQ.isSuccess),
    [statsQ.data, statsQ.isSuccess],
  );

  const canhBaoChuaAck = canhBao.filter((c) => c.trangThai === "raised");
  const tuoi = nhanDoTuoi(thoiDiemDuLieu, bayGio);
  const kieuMau = mauChoTrangThai(trangThai.trangThai);

  /* ── Chưa chọn gì ─────────────────────────────────────────────────────── */
  /*
   * ★★★ ĐỢT 24 VIỆC 3 (L-5) — **GỐC RỄ THẬT CỦA SỰ IM LẶNG NẰM Ở ĐÂY.**
   *
   * ══════════════════════════════════════════════════════════════════════
   * ĐO ĐƯỢC 2026-09-08 trên `dist`, vai `e2e_tai_loE` (`.qa-dot24/probe.mjs`)
   * ══════════════════════════════════════════════════════════════════════
   *   `/twin?xem=machine:1`               → `ngan-chua-chon` 1 · `ngan-nhung` **0**
   *   `/twin?chon=machine:1&xem=machine:1`→ `ngan-chua-chon` 0 · `ngan-nhung` **1**
   *
   * ⇒ Nhánh sớm này trả về TRƯỚC `<NganNhung>` (ở cuối hàm), nên một URL chỉ
   *   mang `?xem=` **không mở được ngăn nào — kể cả khi id HOÀN TOÀN HỢP LỆ**.
   *   Đây mới là "không mở panel và không câu nào nói vì sao" mà Đợt 22 đo
   *   được; nó KHÔNG phải chuyện phạm vi, và một bản vá chỉ thêm câu báo lý do
   *   sẽ không bao giờ chạy tới.
   *
   * ★ `?xem=` và `?chon=` là HAI khoá ĐỘC LẬP có chủ ý (`nhungTaiCho.ts` dùng
   *   khoá riêng để mở ngăn không làm mất phạm vi/camera). Nên "chưa chọn máy"
   *   KHÔNG kéo theo "không có ngăn nào để mở" — ràng hai thứ ấy vào nhau là
   *   giả định của bản cũ, và nó im lặng nuốt một trạng thái URL hợp lệ.
   *
   * ⇒ Giữ nguyên câu "chọn một máy…" (cột phải vẫn chưa có gì để xử lý), nhưng
   *   `NganNhung` phải được render ở CẢ HAI nhánh. Nó tự `portal` ra
   *   `document.body`, nên chỗ đứng trong cây JSX không đổi chỗ vẽ.
   */
  if (machineId === null) {
    return (
      <aside
        className="flex h-full flex-col gap-2 border-l bg-card p-3"
        data-testid="ngan-xu-ly"
        aria-label={t("twin3d.vanHanh.nganXuLy", "Ngăn xử lý")}
      >
        <p className="text-sm text-muted-foreground" data-testid="ngan-chua-chon">
          {t("twin3d.vanHanh.chuaChon", "Chọn một máy trên cảnh hoặc trong danh sách để xử lý.")}
        </p>
        {/* ★ L-5 — ngăn `?xem=` mở được cả khi CHƯA chọn máy nào. */}
        <NganNhung
          ngan={nganNhung}
          lyDo={lyDoNgan}
          nhanPhu={ma ? `${ma}${ten ? ` · ${ten}` : ""}` : undefined}
          onDong={() => onDongNhung?.()}
        />
      </aside>
    );
  }

  return (
    <aside
      className="flex h-full flex-col gap-3 overflow-y-auto border-l bg-card p-3"
      data-testid="ngan-xu-ly"
      data-machine-id={machineId}
      aria-label={t("twin3d.vanHanh.nganXuLy", "Ngăn xử lý")}
    >
      {/* ── Đầu ngăn: danh tính + trạng thái + ĐỘ TƯƠI ─────────────────── */}
      <header>
        <h2 className="text-sm font-semibold text-foreground" data-testid="ngan-ma-may">
          {ma}
        </h2>
        <p className="truncate text-xs text-muted-foreground">{ten}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" data-testid="ngan-trang-thai" data-gia-tri={trangThai.trangThai}>
            {t(kieuMau.khoaNhan)}
          </Badge>
          {/*
            ★★★ NT-3 — khi trạng thái hiển thị KHÁC giá trị máy tự khai, phải NÓI
            RA. Lặng lẽ đổi màu giấu mất chính thông tin quan trọng nhất: máy vẫn
            đang khai "running" trong khi dữ liệu đã hai tháng tuổi.
          */}
          {trangThai.daGhiDe ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-amber-700 dark:text-amber-400"
              data-testid="ngan-canh-bao-ghi-de"
            >
              <AlertTriangle className="mr-1 h-3 w-3" />
              {t("twin3d.vanHanh.duLieuQuaCu", "Dữ liệu quá cũ — trạng thái không đáng tin")}
            </Badge>
          ) : null}
        </div>
        {/*
          ★ NT-3.2 — "cập nhật N giây trước" tính từ `max(timestamp)` của DỮ LIỆU,
          không phải thời điểm render. `—` khi chưa từng có dữ liệu (NT-3.5).
        */}
        <p
          className={`mt-1 text-[11px] ${tuoi.do ? "text-destructive" : "text-muted-foreground"}`}
          data-testid="ngan-do-tuoi"
          data-giay={tuoi.giay ?? ""}
        >
          <Clock className="mr-1 inline h-3 w-3" />
          {/* ★ ĐỢT 23 M4 — CÙNG hàm ghép chữ với thanh công cụ nền
              (`nhanTuoiDocDuoc`). Trước đợt này hai chỗ tự ghép riêng và cùng
              in GIÂY SỐNG: ngăn chi tiết in "Cập nhật 1572061 giây trước" y
              như thanh nền. Một hàm ⇒ không thể lệch nhau (G12). */}
          {tuoi.giay === null
            ? t("twin3d.vanHanh.chuaTungBaoCao", "Chưa từng nhận dữ liệu")
            : t("twin3d.vanHanh.capNhatTruoc", "Cập nhật {{tuoi}} trước", {
                tuoi: nhanTuoiDocDuoc(tuoi, t),
              })}
        </p>
      </header>

      {/* ── §11 #60 — STATS AOI OK/NG/NTF/YIELD ────────────────────────── */}
      {/*
        ★★★ `—` CHỨ KHÔNG `0` khi chưa đo được (NT-3 / G15). Ba ca:
          · chưa đo được (đang tải / 403 / lỗi)  ⇒ mọi ô `—`
          · đo được, mẫu rỗng (0 chiếc)          ⇒ đếm `0`, tỉ lệ `—`
          · đo được, có mẫu                      ⇒ số thật
        `data-*` mang giá trị THÔ để nghiệm thu đọc được số, không phải đọc chữ.
      */}
      <section className="border-t pt-2" data-testid="nhom-stats-aoi">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("twin3d.vanHanh.statsAoi", "Kết quả AOI")}
          {statsAoi.mauRong ? (
            <span className="font-normal normal-case" data-testid="stats-mau-rong">
              {t("twin3d.vanHanh.chuaKiemChiecNao", "chưa kiểm chiếc nào")}
            </span>
          ) : null}
        </h3>
        <dl className="grid grid-cols-4 gap-1 text-center" data-testid="stats-aoi">
          {(
            [
              ["ok", "twin3d.vanHanh.aoiOk", "OK", statsAoi.ok, "text-success"],
              ["ng", "twin3d.vanHanh.aoiNg", "NG", statsAoi.ng, "text-destructive"],
              ["ntf", "twin3d.vanHanh.aoiNtf", "NTF", statsAoi.ntf, "text-muted-foreground"],
            ] as const
          ).map(([ma_, khoa, macDinh, gt, lop]) => (
            <div key={ma_} className="rounded border px-1 py-1">
              <dt className="text-[10px] uppercase text-muted-foreground">{t(khoa, macDinh)}</dt>
              <dd
                className={`text-sm font-semibold tabular-nums ${lop}`}
                data-testid={`stats-${ma_}`}
                data-gia-tri={gt ?? ""}
              >
                {hienSo(gt)}
              </dd>
            </div>
          ))}
          <div className="rounded border px-1 py-1">
            <dt className="text-[10px] uppercase text-muted-foreground">
              {t("twin3d.vanHanh.aoiYield", "Yield")}
            </dt>
            <dd
              className="text-sm font-semibold tabular-nums"
              data-testid="stats-yield"
              data-gia-tri={statsAoi.yieldRate ?? ""}
            >
              {statsAoi.yieldRate === null ? hienSo(null) : `${statsAoi.yieldRate}%`}
            </dd>
          </div>
        </dl>
        <p className="mt-1 text-[10px] text-muted-foreground" data-testid="stats-tong">
          {t("twin3d.vanHanh.aoiTong", "Tổng kiểm")}: {hienSo(statsAoi.total)}
          {statsAoi.fpy === null ? "" : ` · FPY ${statsAoi.fpy}%`}
        </p>
      </section>

      {/* ── NHÓM 1: XỬ LÝ CẢNH BÁO ─────────────────────────────────────── */}
      <section className="border-t pt-2" data-testid="nhom-canh-bao">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("twin3d.vanHanh.canhBao", "Cảnh báo")} ({hienSo(canhBao.length)})
        </h3>

        {canhBao.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="ngan-khong-canh-bao">
            {t("twin3d.vanHanh.khongCoCanhBao", "Không có cảnh báo đang mở.")}
          </p>
        ) : (
          <ul className="mb-2 space-y-1">
            {canhBao.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs"
                data-testid={`ngan-canh-bao-${c.id}`}
                data-trang-thai={c.trangThai}
              >
                <span className="truncate">{c.tieuDe}</span>
                <Badge variant={c.trangThai === "raised" ? "destructive" : "outline"} className="shrink-0">
                  {c.trangThai === "raised"
                    ? t("twin3d.vanHanh.chuaAck", "Chưa xác nhận")
                    : t("twin3d.vanHanh.daAckNgan", "Đã xác nhận")}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {/*
          ★ ẨN khi không có quyền (không disable). Với người có quyền, nút disable
          kèm lý do khi tình huống chưa cho phép — hai ca hoàn toàn khác nhau.
        */}
        {tra("ack").duocPhep ? (
          <Button
            size="sm"
            className="w-full"
            data-testid="nut-ack"
            disabled={tra("ack").lyDoChan !== null || ackM.isPending}
            onClick={() => {
              const dau = canhBaoChuaAck[0];
              if (dau) ackM.mutate({ id: dau.id });
            }}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            {t("twin3d.vanHanh.xacNhan", "Xác nhận")}
            {canhBaoChuaAck.length > 1 ? ` (${canhBaoChuaAck.length})` : ""}
          </Button>
        ) : null}

        {tra("anTam").duocPhep ? <AnTamAlarm chan={tra("anTam").lyDoChan !== null} /> : null}
      </section>

      {/* ── NHÓM 2: TẠO VIỆC ───────────────────────────────────────────── */}
      <section className="border-t pt-2" data-testid="nhom-tao-viec">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("twin3d.vanHanh.taoViec", "Tạo việc")}
        </h3>

        {tra("taoPhieu").duocPhep ? (
          moTaoPhieu ? (
            <div className="space-y-2" data-testid="form-tao-phieu">
              <div className="grid gap-1">
                <Label className="text-xs" htmlFor="twin-tieu-de-phieu">
                  {t("twin3d.vanHanh.tieuDePhieu", "Tiêu đề phiếu")}
                </Label>
                <Input
                  id="twin-tieu-de-phieu"
                  data-testid="o-tieu-de-phieu"
                  value={tieuDePhieu}
                  onChange={(e) => setTieuDePhieu(e.target.value)}
                  placeholder={t("twin3d.vanHanh.viDuTieuDe", "Ví dụ: Kiểm tra băng tải AOI-03")}
                />
              </div>

              <div className="grid gap-1">
                <Label className="text-xs">{t("twin3d.vanHanh.uuTien", "Mức ưu tiên")}</Label>
                <Select value={uuTien} onValueChange={setUuTien}>
                  <SelectTrigger data-testid="chon-uu-tien">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* 1 = cao nhất (hợp đồng của `maintenance_work_orders.priority`). */}
                    {[1, 2, 3, 4, 5].map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        {t("twin3d.vanHanh.uuTienMuc", "Mức {{p}}", { p })}
                        {p === 1 ? ` — ${t("twin3d.vanHanh.caoNhat", "cao nhất")}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Gán KTV chỉ hiện với người có `canEdit` — §9.2 tách hai quyền. */}
              {quyen.suaPhieu ? (
                <div className="grid gap-1">
                  <Label className="text-xs">{t("twin3d.vanHanh.ganKyThuat", "Gán kỹ thuật viên")}</Label>
                  <Select value={ganCho} onValueChange={setGanCho}>
                    <SelectTrigger data-testid="chon-ky-thuat-vien">
                      <SelectValue placeholder={t("twin3d.vanHanh.chuaGan", "Chưa gán")} />
                    </SelectTrigger>
                    <SelectContent>
                      {nguoiGan.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name ?? u.username ?? `#${u.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  data-testid="nut-luu-phieu"
                  // `title` tối thiểu 3 ký tự theo zod của `createWorkOrder` — chặn
                  // ở đây để người dùng biết TRƯỚC khi server từ chối.
                  disabled={tieuDePhieu.trim().length < 3 || taoPhieuM.isPending}
                  onClick={() =>
                    taoPhieuM.mutate({
                      machineId,
                      title: tieuDePhieu.trim(),
                      priority: Number(uuTien),
                      type: "CORRECTIVE",
                      status: "OPEN",
                      ...(ganCho ? { assignedTo: Number(ganCho) } : {}),
                    })
                  }
                >
                  {t("common.save", "Lưu")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMoTaoPhieu(false)}>
                  {t("common.cancel", "Huỷ")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              data-testid="nut-tao-phieu"
              disabled={tra("taoPhieu").lyDoChan !== null}
              onClick={() => {
                setMoTaoPhieu(true);
                // Gợi ý tiêu đề từ ngữ cảnh — người dùng sửa được, và nó làm
                // đường "tạo phiếu bằng bàn phím" ngắn đi một bước.
                setTieuDePhieu(
                  t("twin3d.vanHanh.tieuDeGoiY", "Xử lý sự cố {{ma}}", { ma }),
                );
              }}
            >
              <ClipboardPlus className="mr-1.5 h-3.5 w-3.5" />
              {t("twin3d.vanHanh.taoPhieu", "Tạo phiếu công việc")}
            </Button>
          )
        ) : null}
      </section>

      {/* ── NHÓM 3: MỞ CHỨC NĂNG (§9.3) ────────────────────────────────── */}
      <section className="border-t pt-2" data-testid="nhom-mo-chuc-nang">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("twin3d.vanHanh.moChucNang", "Mở chức năng")}
        </h3>
        {/*
          ════════════════════════════════════════════════════════════════════
          ★★★ ĐỢT 10 MỤC 5 — XEM CHI TIẾT **TẠI CHỖ**, KHÔNG REDIRECT
          ════════════════════════════════════════════════════════════════════
          Yêu cầu chủ sở hữu: *"xem chi tiết của máy/Line không sử dụng redirect
          chuyển trang để xem rất bất tiện … cần dialog hoặc modal … và có phím
          back … để ng dùng không cần rời màn hình 3D digital Twin"*.

          Trước đợt này MỌI nút dưới đây gọi `onDieuHuong(n.href)` = `setLocation`
          (`TwinVanHanh.tsx:1721`) ⇒ **rời hẳn `/twin`**: cảnh 3D bị huỷ, camera
          và phạm vi mất, đường về duy nhất là nút Back của trình duyệt.

          Bây giờ mỗi nút chia **hai đường, quyết định bởi CHÍNH `href`** (không
          có cờ thứ hai để lệch — G12):

            nhúng được  → `onMoTaiCho` mở ngăn ngay trên `/twin`, icon `Maximize2`
                          ("phóng to tại chỗ"). Đây là **MẶC ĐỊNH**.
            chưa nhúng  → `onDieuHuong` như cũ, giữ icon `ExternalLink`.

          ★★★ VÌ SAO ICON PHẢI KHÁC NHAU. `ExternalLink` là lời hứa "bấm cái này
            là rời trang". Để nguyên nó trên một nút mở tại chỗ là nói dối người
            dùng theo chiều ngược lại — họ do dự bấm vì sợ mất cảnh, đúng nỗi bất
            tiện mà mục này sinh ra để bỏ. Hai hành vi khác nhau PHẢI nhìn ra
            được, nếu không thì tính năng có mà không ai dám dùng.

          ★ Lối thoát phụ ("mở màn đầy đủ" ở tab mới) KHÔNG mất — nó nằm trong
            chính ngăn nhúng (`NganNhung.tsx`), nơi người dùng đã thấy nội dung
            và mới biết mình có muốn cả trang hay không.

          ⚠ `onMoTaiCho` `undefined` (tầng trên chưa nối) ⇒ **rơi về `onDieuHuong`**,
            không phải nút chết. Một nút không làm gì là chế độ hỏng câm.
        */}
        <div className="space-y-1">
          {nutDieuHuongCho(loaiDich, machineId)
            // ★ Ẩn nút dẫn tới màn người dùng không vào được — nếu không thì họ
            //   bấm rồi bị RouteGuard chặn: đúng lớp lỗi "một lối vào rồi TỪ CHỐI".
            .filter((n) => coQuyenXem(n.quyen))
            .map((n) => {
              const ngan = nhungChoHref(n.href);
              const taiCho = ngan !== null && onMoTaiCho !== undefined;
              return (
                <Button
                  key={n.href}
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start"
                  data-testid={`nut-dieu-huong-${n.khoaNhan.split(".").pop()}`}
                  data-tai-cho={taiCho ? "1" : "0"}
                  onClick={() => (taiCho ? onMoTaiCho(ngan) : onDieuHuong(n.href))}
                >
                  {taiCho ? (
                    <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {t(n.khoaNhan)}
                </Button>
              );
            })}
        </div>
      </section>

      {/*
        ── NGĂN CHI TIẾT TẠI CHỖ ─────────────────────────────────────────

        Đặt ở ĐÂY, trong chính `NganXuLy`, vì đây là nơi các nút mở nó sống —
        người dùng bấm ở đâu thì nội dung mở ra ngay từ đó. `NganNhung` tự
        portal ra `document.body` (Radix `Sheet`) nên nó KHÔNG bị kẹt trong cột
        `w-80` này; vị trí trong cây JSX chỉ quyết định quyền sở hữu logic, không
        quyết định chỗ vẽ.

        `nganNhung === null` ⇒ `NganNhung` trả `null`, 0 nút DOM.
      */}
      <NganNhung
        ngan={nganNhung}
        lyDo={lyDoNgan}
        nhanPhu={ma ? `${ma}${ten ? ` · ${ten}` : ""}` : undefined}
        onDong={() => onDongNhung?.()}
      />
    </aside>
  );
}

/**
 * Ẩn tạm (shelve) — ISA-18.2, **CÓ HẠN + CÓ VẾT KIỂM TOÁN**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NÓI THẲNG MỘT GIỚI HẠN ĐO ĐƯỢC, THAY VÌ LÀM MỘT NÚT GIẢ
 * ════════════════════════════════════════════════════════════════════════════
 * `equipmentStandards.shelveMasterAlarm` shelve một **ĐỊNH NGHĨA alarm**
 * (`master_alarms`, khoá theo `alarmKey`+`assetType`) — nghĩa là nó tắt alarm đó
 * cho MỌI máy khớp định nghĩa, không phải cho riêng sự kiện đang xem. Repo
 * KHÔNG có đường shelve một `andon_events` đơn lẻ (grep toàn `server/`: 0 kết quả).
 *
 * Hai lựa chọn sai và một lựa chọn đúng:
 *   ✗ Nối nút này vào `shelveMasterAlarm` với `master_alarms.id` đoán từ máy
 *     đang chọn — người dùng tưởng đang tắt một cảnh báo, thực tế tắt cả một
 *     lớp cảnh báo trên toàn nhà máy. Đó là hành vi NGUY HIỂM và câm.
 *   ✗ Vẽ nút rồi `toast("chưa hỗ trợ")` — một nút giả, đúng thứ G11 cảnh báo.
 *   ✓ Nói RÕ phạm vi của thao tác và dẫn người dùng tới màn quản trị alarm, nơi
 *     họ chọn đúng định nghĩa muốn ẩn. Trung thực hơn, và không mất chức năng
 *     nào — chỉ mất ảo giác rằng nó là một cú bấm.
 *
 * ⇒ Đợt sau, nếu chủ sở hữu muốn shelve TỪNG SỰ KIỆN, đó là một cột mới trên
 *   `andon_events` + một thủ tục mới. Ghi vào sổ nợ, không vá lén ở đây.
 */
function AnTamAlarm({ chan }: { chan: boolean }) {
  const { t } = useTranslation();
  const [mo, setMo] = useState(false);

  return (
    <div className="mt-1.5">
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        data-testid="nut-an-tam"
        disabled={chan}
        onClick={() => setMo((v) => !v)}
      >
        <Clock className="mr-1.5 h-3.5 w-3.5" />
        {t("twin3d.vanHanh.anTam", "Ẩn tạm")}
      </Button>
      {mo ? (
        <div className="mt-1.5 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]" data-testid="an-tam-giai-thich">
          <p className="font-medium text-amber-700 dark:text-amber-400">
            {t("twin3d.vanHanh.anTamPhamVi", "Ẩn tạm áp cho ĐỊNH NGHĨA cảnh báo, không cho riêng sự kiện này.")}
          </p>
          <p className="mt-1 text-muted-foreground">
            {t(
              "twin3d.vanHanh.anTamHuongDan",
              "Ẩn một định nghĩa sẽ tắt cảnh báo đó trên mọi thiết bị khớp. Mốc cho phép: {{moc}} giờ, hết hạn tự bung, có ghi vết kiểm toán.",
              { moc: MOC_AN_TAM_GIO.join(" / ") },
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default NganXuLy;
export { hanAnTam };
