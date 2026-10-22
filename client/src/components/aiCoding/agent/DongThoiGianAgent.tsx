/**
 * Đợt 1 · T5 — **DÒNG THỜI GIAN CHẾ ĐỘ AGENT** (tối thiểu dùng được; Đợt 3 hoàn thiện).
 *
 * Nhận đầu ra của `useLuotChayAgent` và vẽ: bảng kế hoạch GHIM trên đầu · trạng thái (chờ lượt model / chờ duyệt /
 * token) · câu hỏi · chữ trả lời (markdown) · khối "đang nghĩ" (`BangDangNghi`) · mỗi lượt gọi tool một dòng thu gọn
 * (bấm mở tóm tắt) · thẻ cần duyệt (`TheDuyetDiff` cho diff; xoá/đổi tên/chạy lệnh thẻ gọn) với Bác CÓ LÝ DO · lỗi ·
 * kết thúc (lý do dừng, tệp đã đổi, Hoàn tác lượt chạy).
 *
 * ★ (2026-10-17) nội dung đáng ngờ: `canh-bao-du-lieu` / `ha-tu-tri` ⇒ dòng cảnh báo (lượt KHÔNG dừng); thẻ duyệt có
 *   `deXuat.nguonDangNgo` ⇒ dòng "Lượt này đã đọc nội dung đáng ngờ: …" để người duyệt thấy. Nguồn vẽ TRƠN (text node).
 * ★ Đợt 2: thẻ "Đề xuất nhớ" (`TheDeXuatNho`) — model gọi `remember` chỉ ĐỀ XUẤT; người bấm Nhớ (ghi bài học) hoặc Bỏ
 *   qua. Nội dung đề xuất là chữ model viết ⇒ vẽ TRƠN (text node), không markdown, không nhãn tin cậy.
 * ⚠ Luật chủ dự án (ec85a97e6): văn bản do MODEL viết KHÔNG BAO GIỜ đi bộ `boKhoiDauRaLenh` (nhãn tin cậy "đầu ra
 *   lệnh"). Ở đây chữ model vẽ bằng `Streamdown` TRƠN; đầu ra lệnh vẽ bằng `DauRaLenhAgent` từ dữ liệu CÓ CẤU TRÚC của
 *   sự kiện `ket-qua-tool` (server), không qua fence trong văn bản.
 * ★ Đợt 5.1: nút 👍/👎 (`NutPhanHoi`) ngay dưới câu trả lời CUỐI của lượt ĐÃ XONG (`viTriTraLoiCuoi`: đúng `runId` +
 *   `chiSoTin` theo hợp đồng `aiAgent.phanHoi`). Phiếu cũ của mình tải lại từ `aiAgent.phanHoiCuaToi`. Thẻ duyệt diff
 *   KHÔNG mang nút: quyết định duyệt/bác (kèm lý do bác) máy chủ đã tự ghi từ cửa duyệt thật.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Cpu,
  CircleDot,
  FileText,
  Hourglass,
  ListTodo,
  Loader2,
  BookmarkPlus,
  RotateCcw,
  User,
  Wrench,
  X,
} from "lucide-react";
import type { LyDoDung, ThongTinModelBatDau, ViecKeHoach } from "@shared/agentCore/kieu";
import { Button } from "@/components/ui/button";
import { TheDuyetDiff } from "@/components/ai/TheDuyetDiff";
import type { ActionState } from "@/components/ConfirmActionCard";
import { agentTrpc, phieuTraLoiCuaToi } from "@/lib/agentApi";
import { cn } from "@/lib/utils";
import { BangDangNghi } from "../BangDangNghi";
import { NutPhanHoi } from "./NutPhanHoi";
import { idHanhDong, layDiffTuDeXuat, thamSoChinh, viTriTraLoiCuoi, type MucDongThoiGian } from "./trangThaiAgent";
import type { HookAgent, TheDuyetMuc, TheNhoMuc } from "./useLuotChayAgent";

type T = ReturnType<typeof useTranslation>["t"];

/** Câu cho MỌI `LyDoDung` (i18n). */
export function cauLyDoDung(t: T, lyDo: LyDoDung): string {
  switch (lyDo) {
    case "hoan-thanh":
      return t("repoWs.agent.lyDo.hoanThanh", "Hoàn thành.");
    case "het-luot":
      return t("repoWs.agent.lyDo.hetLuot", "Dừng: đã hết số lượt cho phép.");
    case "het-gio":
      return t("repoWs.agent.lyDo.hetGio", "Dừng: đã hết thời gian cho phép.");
    case "het-token":
      return t("repoWs.agent.lyDo.hetToken", "Dừng: đã hết ngân sách token.");
    case "huy":
      return t("repoWs.agent.lyDo.huy", "Đã dừng theo yêu cầu.");
    case "lap-lai":
      return t("repoWs.agent.lyDo.lapLai", "Dừng: model lặp lại cùng một thao tác.");
    case "menh-lenh-trong-du-lieu":
      return t("repoWs.agent.lyDo.menhLenh", "Dừng an toàn: phát hiện mệnh lệnh nằm trong dữ liệu đọc được.");
    case "loi-model":
      return t("repoWs.agent.lyDo.loiModel", "Dừng: lỗi model.");
    default:
      return String(lyDo);
  }
}

function BangKeHoach({ viec }: { viec: ViecKeHoach[] }) {
  const { t } = useTranslation();
  if (!viec.length) return null;
  const xong = viec.filter((v) => v.trangThai === "xong").length;
  return (
    <div data-testid="agent-ke-hoach" className="sticky top-0 z-10 rounded-md border bg-background/95 px-2 py-1.5 text-[12px] shadow-sm backdrop-blur">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <ListTodo className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span>{t("repoWs.agent.keHoach", "Kế hoạch")}</span>
        <span className="tabular-nums text-muted-foreground">{t("repoWs.agent.keHoachDem", "{{xong}}/{{tong}} xong", { xong, tong: viec.length })}</span>
      </div>
      <ul className="space-y-0.5">
        {viec.map((v, i) => {
          const Icon = v.trangThai === "xong" ? Check : v.trangThai === "dang-lam" ? CircleDot : Circle;
          const nhan =
            v.trangThai === "xong"
              ? t("repoWs.agent.viec.xong", "xong")
              : v.trangThai === "dang-lam"
                ? t("repoWs.agent.viec.dangLam", "đang làm")
                : t("repoWs.agent.viec.cho", "chờ");
          return (
            <li key={i} data-trang-thai={v.trangThai} className="flex min-w-0 items-start gap-1.5">
              <Icon className={cn("mt-0.5 h-3 w-3 shrink-0", v.trangThai === "xong" ? "text-emerald-600" : v.trangThai === "dang-lam" ? "text-primary" : "text-muted-foreground")} aria-label={nhan} />
              <span className={cn("min-w-0 break-words", v.trangThai === "xong" && "text-muted-foreground line-through")}>{v.noiDung}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Đầu ra lệnh từ `hienThi` CÓ CẤU TRÚC (không phải văn bản model). Hình dạng server chưa chốt ⇒ đọc khoan dung. */
function DauRaLenhAgent({ hienThi }: { hienThi: unknown }) {
  const { t } = useTranslation();
  let vanBan: string | null = null;
  let maThoat: number | null = null;
  if (typeof hienThi === "string") vanBan = hienThi;
  else if (hienThi && typeof hienThi === "object") {
    const h = hienThi as Record<string, unknown>;
    const phan = [h.stdout, h.stderr, h.dauRa, h.textSummary].filter((x): x is string => typeof x === "string" && x.length > 0);
    vanBan = phan.length ? phan.join("\n") : null;
    const m = h.exitCode ?? h.maThoat;
    maThoat = typeof m === "number" ? m : null;
  }
  if (vanBan === null && maThoat === null) return null;
  return (
    <div data-testid="agent-dau-ra-lenh" className="rounded border bg-muted/40">
      <div className="flex items-center gap-2 border-b px-2 py-0.5 text-[10px] text-muted-foreground">
        <span>{t("repoWs.agent.dauRaLenh", "Đầu ra lệnh (từ máy chủ)")}</span>
        {maThoat !== null && <span className="tabular-nums">{t("repoWs.agent.maThoat", "mã thoát {{ma}}", { ma: maThoat })}</span>}
      </div>
      {vanBan !== null && <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words px-2 py-1 font-mono text-[11px]">{vanBan.slice(0, 8000)}</pre>}
    </div>
  );
}

/** ★★ Đợt 9 — `hienThi` của compile_st: { ok: boolean|null, soLoi } (đọc khoan dung; hình dạng lạ ⇒ không hiện chip). */
export function docKetQuaCompileSt(hienThi: unknown): { ok: boolean | null; soLoi: number } | null {
  if (!hienThi || typeof hienThi !== "object") return null;
  const h = hienThi as { ok?: unknown; soLoi?: unknown };
  const ok = h.ok === true ? true : h.ok === false ? false : null;
  const soLoi = typeof h.soLoi === "number" && Number.isFinite(h.soLoi) ? Math.max(0, Math.floor(h.soLoi)) : 0;
  if (h.ok === undefined && h.soLoi === undefined) return null;
  return { ok, soLoi };
}

function ChipCompileSt({ hienThi }: { hienThi: unknown }) {
  const { t } = useTranslation();
  const r = docKetQuaCompileSt(hienThi);
  if (!r) return null;
  if (r.ok === true) return <span data-testid="agent-compile-st" data-ok="1" className="shrink-0 text-emerald-600">{t("repoWs.agent.compileSt.sach", "biên dịch sạch")}</span>;
  if (r.ok === false) return <span data-testid="agent-compile-st" data-ok="0" className="shrink-0 text-amber-600">{t("repoWs.agent.compileSt.loi", "{{n}} lỗi", { n: r.soLoi })}</span>;
  return <span data-testid="agent-compile-st" data-ok="na" className="shrink-0 text-muted-foreground">{t("repoWs.agent.compileSt.chuaKiem", "chưa kiểm được")}</span>;
}

function DongTool({ m }: { m: Extract<MucDongThoiGian, { kieu: "tool" }> }) {
  const { t } = useTranslation();
  const [mo, setMo] = useState(false);
  const chinh = thamSoChinh(m.ten, m.thamSo);
  const kq = m.ketQua;
  return (
    <div data-testid="agent-dong-tool" data-tool={m.ten} className="rounded-md border text-[12px]">
      <button type="button" onClick={() => setMo(!mo)} aria-expanded={mo} className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/50">
        {mo ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden /> : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
        <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-mono font-medium">{m.ten}</span>
        {chinh && <span className="min-w-0 truncate font-mono text-muted-foreground" title={chinh}>{chinh}</span>}
        {m.ten === "compile_st" && kq && <ChipCompileSt hienThi={kq.hienThi} />}
        <span className="ml-auto shrink-0">
          {!kq ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label={t("repoWs.agent.toolDangChay", "đang chạy")} />
          ) : kq.ok ? (
            <Check className="h-3 w-3 text-emerald-600" aria-label={t("repoWs.agent.toolOk", "thành công")} />
          ) : (
            <X className="h-3 w-3 text-red-600" aria-label={t("repoWs.agent.toolLoi", "thất bại")} />
          )}
        </span>
      </button>
      {mo && (
        <div className="space-y-1 border-t px-2 py-1.5">
          {!kq ? (
            <p className="text-muted-foreground">{t("repoWs.agent.toolChuaCoKetQua", "Chưa có kết quả.")}</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words">{kq.tomTat}</p>
              {kq.ma && <p className="font-mono text-[11px] text-muted-foreground">{t("repoWs.agent.maKetQua", "Mã: {{ma}}", { ma: kq.ma })}</p>}
              {m.ten === "run_command" && <DauRaLenhAgent hienThi={kq.hienThi} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function trangThaiThe(m: TheDuyetMuc): ActionState {
  if (m.trangThai === "da-duyet") return "executed";
  if (m.trangThai === "bi-bac") return "cancelled";
  if (m.trangThai === "het-hieu-luc") return "expired";
  return "pending";
}

function MoTaGon({ m }: { m: TheDuyetMuc }) {
  const { t } = useTranslation();
  const ts = m.deXuat.thamSo ?? {};
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (m.deXuat.ten === "delete_file") return <p>{t("repoWs.agent.duyet.xoa", "XOÁ tệp {{tep}}", { tep: s(ts.path) })}</p>;
  if (m.deXuat.ten === "rename_file") return <p>{t("repoWs.agent.duyet.doiTen", "ĐỔI TÊN {{tu}} → {{den}}", { tu: s(ts.from), den: s(ts.to) })}</p>;
  if (m.deXuat.ten === "run_command")
    return (
      <p className="min-w-0 break-words">
        {t("repoWs.agent.duyet.chayLenh", "CHẠY lệnh:")} <code className="font-mono">{s(ts.command)}</code>
      </p>
    );
  return <p className="font-mono">{m.deXuat.ten} {thamSoChinh(m.deXuat.ten, ts)}</p>;
}

/** Cờ trên thẻ duyệt: lượt đã đọc nội dung đáng ngờ (nguồn từ máy chủ — chữ trơn). */
function DongDangNgo({ nguon }: { nguon: string[] | undefined }) {
  const { t } = useTranslation();
  if (!Array.isArray(nguon) || nguon.length === 0) return null;
  return (
    <p data-testid="agent-the-dang-ngo" className="mb-1 flex items-start gap-1 text-[12px] font-medium text-red-700 dark:text-red-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">
        {t("repoWs.agent.theDangNgo", "Lượt này đã đọc nội dung đáng ngờ: {{nguon}} — xem kỹ trước khi duyệt.", { nguon: nguon.join(", ") })}
      </span>
    </p>
  );
}

function TheDuyetAgent({ m, agent }: { m: TheDuyetMuc; agent: HookAgent }) {
  const { t } = useTranslation();
  const diff = useMemo(() => layDiffTuDeXuat(m.deXuat), [m.deXuat]);
  const [xemTruoc, setXemTruoc] = useState(diff?.args.modified ?? "");
  const [moLyDo, setMoLyDo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const busy = agent.dangGuiDuyet === idHanhDong(m);
  const conCho = m.trangThai === "cho";

  const oBac = moLyDo && conCho && (
    <div data-testid="agent-o-ly-do" className="mt-2 space-y-1.5 rounded-md border border-amber-300 bg-amber-50/60 p-2 dark:border-amber-800 dark:bg-amber-950/20">
      <label className="block text-[12px] font-medium" htmlFor={`ly-do-${m.id}`}>
        {t("repoWs.agent.lyDoBac", "Lý do bác (model sẽ đọc để làm lại)")}
      </label>
      <textarea
        id={`ly-do-${m.id}`}
        value={lyDo}
        onChange={(e) => setLyDo(e.target.value)}
        rows={2}
        className="w-full resize-y rounded border border-input bg-background px-2 py-1 text-[12px]"
        placeholder={t("repoWs.agent.lyDoBacGoiY", "Vd: đừng đổi API công khai, chỉ sửa hàm nội bộ")}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="destructive" disabled={busy || !lyDo.trim()} onClick={() => void agent.bac(m, lyDo)}>
          {t("repoWs.agent.guiBac", "Gửi lời bác")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setMoLyDo(false)}>
          {t("repoWs.agent.thoiBac", "Thôi")}
        </Button>
      </div>
    </div>
  );

  const ketCuc = !conCho && (
    <p data-testid="agent-ket-cuc-duyet" className="mt-1 text-[11px] text-muted-foreground">
      {m.trangThai === "da-duyet"
        ? t("repoWs.agent.daDuyet", "Đã duyệt.")
        : m.trangThai === "bi-bac"
          ? m.lyDo
            ? t("repoWs.agent.daBacLyDo", "Đã bác — lý do: {{lyDo}}", { lyDo: m.lyDo })
            : t("repoWs.agent.daBac", "Đã bác.")
          : t("repoWs.agent.hetHieuLuc", "Hết hiệu lực (lượt chạy đã dừng).")}
    </p>
  );

  if (diff) {
    return (
      <div data-testid="agent-the-duyet" data-loai="diff">
        <DongDangNgo nguon={m.deXuat.nguonDangNgo} />
        {m.deXuat.moTa && <p className="mb-1 text-[12px] text-muted-foreground">{m.deXuat.moTa}</p>}
        <TheDuyetDiff
          action={{ expiresAt: diff.expiresAt, preview: { warnings: diff.warnings } }}
          args={diff.args}
          state={trangThaiThe(m)}
          busy={busy || !conCho || moLyDo}
          preview={xemTruoc}
          onPreview={setXemTruoc}
          onConfirm={(chonKhoi) => void agent.duyet(m, chonKhoi)}
          onCancel={() => setMoLyDo(true)}
        />
        {oBac}
        {ketCuc}
      </div>
    );
  }

  return (
    <div data-testid="agent-the-duyet" data-loai={m.deXuat.ten} className="rounded-lg border-2 border-amber-300 bg-amber-50/40 p-2 text-[13px] dark:border-amber-800 dark:bg-amber-950/20">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span>{t("repoWs.agent.canDuyet", "Cần bạn duyệt")}</span>
      </div>
      <DongDangNgo nguon={m.deXuat.nguonDangNgo} />
      <MoTaGon m={m} />
      {m.deXuat.moTa && <p className="mt-1 text-[12px] text-muted-foreground">{m.deXuat.moTa}</p>}
      {conCho && !moLyDo && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="sm" disabled={busy} onClick={() => void agent.duyet(m)}>
            {t("repoWs.agent.nutDuyet", "Duyệt")}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMoLyDo(true)}>
            {t("repoWs.agent.nutBac", "Bác")}
          </Button>
        </div>
      )}
      {oBac}
      {ketCuc}
    </div>
  );
}

/** Câu cho mã từ chối của Nhớ / Bỏ qua (i18n). */
function cauLoiNho(t: T, ma: string | undefined): string {
  switch (ma) {
    case "NOT_FOUND":
      return t("repoWs.agent.nho.loiHetHieuLuc", "Đề xuất đã hết hiệu lực (lượt chạy không còn trên máy chủ).");
    case "DA_XU_LY":
      return t("repoWs.agent.nho.loiDaXuLy", "Đề xuất này đã được xử lý.");
    case "TRI_NHO_TAT":
      return t("repoWs.agent.nho.loiTat", "Trí nhớ đang tắt trên máy chủ — không lưu.");
    case "RUI_RO_CAO":
      return t("repoWs.agent.nho.loiRuiRo", "Không lưu: ghi chú trông giống một mệnh lệnh.");
    case "DAY":
      return t("repoWs.agent.nho.loiDay", "Đã đủ số bài học tối đa cho dự án này — xoá bớt trước.");
    case "PERMISSION_DENIED":
      return t("repoWs.agent.nho.loiQuyen", "Bạn không có quyền với lượt chạy này.");
    default:
      return t("repoWs.agent.nho.loiKhac", "Không lưu được ({{ma}}).", { ma: ma ?? "?" });
  }
}

function TheDeXuatNho({ m, agent }: { m: TheNhoMuc; agent: HookAgent }) {
  const { t } = useTranslation();
  const dangGui = m.trangThai === "dang-gui";
  return (
    <div
      data-testid="agent-de-xuat-nho"
      data-trang-thai={m.trangThai}
      className="rounded-md border border-sky-300 bg-sky-50/50 p-2 text-[12px] dark:border-sky-800 dark:bg-sky-950/20"
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5 font-medium text-sky-900 dark:text-sky-200">
        <BookmarkPlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t("repoWs.agent.nho.tieuDe", "Đề xuất nhớ")}</span>
        <span className="rounded border border-sky-300 px-1 text-[10px] font-normal dark:border-sky-700">
          {m.scope === "user" ? t("repoWs.agent.nho.phamViNguoiDung", "Sở thích của bạn") : t("repoWs.agent.nho.phamViDuAn", "Dự án này")}
        </span>
      </div>
      {/* Chữ MODEL viết ⇒ text node trơn. */}
      <p className="min-w-0 whitespace-pre-wrap break-words">{m.note}</p>
      {(m.trangThai === "cho" || dangGui) && (
        <>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("repoWs.agent.nho.giaiThich", "Chỉ được lưu khi bạn bấm Nhớ; sẽ dùng làm ngữ cảnh cho các lượt sau.")}
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <Button size="sm" disabled={dangGui} onClick={() => void agent.quyetDeXuatNho(m, true)}>
              {dangGui ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {t("repoWs.agent.nho.nutNho", "Nhớ")}
            </Button>
            <Button size="sm" variant="outline" disabled={dangGui} onClick={() => void agent.quyetDeXuatNho(m, false)}>
              {t("repoWs.agent.nho.nutBoQua", "Bỏ qua")}
            </Button>
          </div>
        </>
      )}
      {m.trangThai === "da-nho" && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          <Check className="h-3 w-3" aria-hidden />
          {t("repoWs.agent.nho.daNho", "Đã nhớ — sẽ dùng cho các lượt sau.")}
        </p>
      )}
      {m.trangThai === "da-bo" && <p className="mt-1 text-[11px] text-muted-foreground">{t("repoWs.agent.nho.daBo", "Đã bỏ qua.")}</p>}
      {m.trangThai === "loi" && <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">{cauLoiNho(t, m.maLoi)}</p>}
    </div>
  );
}

/**
 * (Đợt 5.1) 👍/👎 cho khối trả lời (`runId`, `chiSoTin`). Đọc phiếu CỦA MÌNH trước rồi mới vẽ nút (nút giữ phiếu ban đầu
 * trong state riêng); đọc hỏng ⇒ vẽ với "chưa bỏ phiếu" — ghi vẫn đi qua máy chủ, hiển thị theo kết quả THẬT.
 * ⚠ `phanHoiCuaToi` chỉ trả 50 phiếu mới nhất ⇒ phiếu rất cũ không hiện lại (ghi đè vẫn đúng hàng phía máy chủ).
 */
function PhanHoiTraLoi({ runId, chiSoTin }: { runId: string; chiSoTin: number }) {
  const khoa = `${runId}#${chiSoTin}`;
  const [daDoc, setDaDoc] = useState<{ khoa: string; danhGia: 1 | -1 | null } | null>(null);
  useEffect(() => {
    let huy = false;
    agentTrpc
      .phanHoiCuaToi()
      .then(
        (ds) => phieuTraLoiCuaToi(ds, runId, chiSoTin),
        () => null,
      )
      .then((danhGia) => {
        if (!huy) setDaDoc({ khoa, danhGia });
      });
    return () => {
      huy = true;
    };
  }, [khoa, runId, chiSoTin]);
  if (!daDoc || daDoc.khoa !== khoa) return null;
  return (
    <div data-testid="agent-phan-hoi-tra-loi" className="pl-1">
      <NutPhanHoi key={khoa} dich={{ loai: "tra-loi", runId, chiSoTin }} danhGiaBanDau={daDoc.danhGia} />
    </div>
  );
}

function KetThuc({ agent, onMoTep }: { agent: HookAgent; onMoTep: (p: string) => void }) {
  const { t } = useTranslation();
  const s = agent.trangThai;
  if (!s.ketThuc) return null;
  const kq = agent.ketQuaHoanTac;
  const coTheHoanTac = !!s.runId && (s.tepDaDoi.length > 0 || s.checkpoints.length > 0);
  return (
    <div data-testid="agent-ket-thuc" className={cn("space-y-2 rounded-md border p-2 text-[12px]", s.ketThuc.lyDo === "hoan-thanh" ? "border-emerald-300" : "border-amber-300")}>
      <p className="font-medium">{cauLyDoDung(t, s.ketThuc.lyDo)}</p>
      {s.ketThuc.tomTat && <p className="whitespace-pre-wrap break-words text-muted-foreground">{s.ketThuc.tomTat}</p>}
      {s.tepDaDoi.length > 0 && (
        <div>
          <p className="mb-0.5 font-medium">{t("repoWs.agent.tepDaDoi", "Tệp đã đổi ({{n}})", { n: s.tepDaDoi.length })}</p>
          <ul className="space-y-0.5">
            {s.tepDaDoi.map((p) => (
              <li key={p}>
                <button type="button" onClick={() => onMoTep(p)} className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-primary hover:underline" title={t("repoWs.agent.moTep", "Mở trong trình xem")}>
                  <FileText className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="min-w-0 truncate">{p}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {coTheHoanTac && !kq && (
        <Button size="sm" variant="outline" disabled={agent.dangHoanTac} onClick={() => void agent.hoanTac()}>
          {agent.dangHoanTac ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
          {t("repoWs.agent.hoanTac", "Hoàn tác lượt chạy")}
        </Button>
      )}
      {kq && (
        <div data-testid="agent-ket-qua-hoan-tac" className="space-y-1">
          <p>{t("repoWs.agent.daKhoiPhuc", "Đã khôi phục {{n}} tệp.", { n: kq.khoiPhuc.length })}</p>
          {kq.xungDot.length > 0 && (
            <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              <p className="font-medium">{t("repoWs.agent.xungDot", "Xung đột — KHÔNG ghi đè ({{n}} tệp đã bị sửa tiếp sau lượt chạy):", { n: kq.xungDot.length })}</p>
              <ul className="list-inside list-disc font-mono text-[11px]">
                {kq.xungDot.map((x) => (
                  <li key={x.duong}>
                    {x.duong}
                    {x.lyDo ? ` — ${x.lyDo}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ★ Đợt 9 — dòng ngắn "Đang chạy <model> · vai trò <vai trò> (dự án …)" từ sự kiện `bat-dau.model` (chỉ khi server bật
 * `AI_AGENT_THEO_VAI_TRO`; `null` ⇒ KHÔNG vẽ gì — DOM y như cũ). `nguon = "du-phong"` ⇒ nhãn "dự phòng"; `bangChung` (chuỗi giải
 * thích của máy chủ) nằm ở tooltip.
 */
export function DongModelBatDau({ m, dangChay }: { m: ThongTinModelBatDau | null; dangChay: boolean }) {
  const { t } = useTranslation();
  if (!m) return null;
  const duAn = m.vaiTro === "code.plc" ? t("repoWs.agent.modelBatDau.duAnPlc", " (dự án PLC)") : m.vaiTro === "code.software" ? t("repoWs.agent.modelBatDau.duAnPhanMem", " (dự án phần mềm)") : "";
  const model = m.model ?? t("repoWs.agent.modelBatDau.macDinh", "model mặc định của engine");
  return (
    <div
      data-testid="agent-model-bat-dau"
      data-nguon={m.nguon}
      data-vai-tro={m.vaiTro}
      // i18n-raw-ok: `bangChung` là chuỗi giải thích kỹ thuật do máy chủ dựng (nguồn định tuyến) — chỉ ở tooltip.
      title={m.bangChung}
      className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground"
    >
      <Cpu className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">
        {dangChay
          ? t("repoWs.agent.modelBatDau.dangChay", "Đang chạy {{model}} · vai trò {{vaiTro}}{{duAn}}", { model, vaiTro: m.vaiTro, duAn })
          : t("repoWs.agent.modelBatDau.daChay", "Đã chạy {{model}} · vai trò {{vaiTro}}{{duAn}}", { model, vaiTro: m.vaiTro, duAn })}
      </span>
      {m.nguon === "du-phong" && (
        <span data-testid="agent-model-du-phong" className="rounded border border-amber-300 bg-amber-50 px-1 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {t("repoWs.agent.modelBatDau.duPhong", "dự phòng — khe đang giữ model khác")}
        </span>
      )}
    </div>
  );
}

export function DongThoiGianAgent({ agent, onMoTep }: { agent: HookAgent; onMoTep: (path: string) => void }) {
  const { t } = useTranslation();
  const s = agent.trangThai;
  const ds = s.dongThoiGian;
  const choPhanHoi = viTriTraLoiCuoi(s);
  const coGi = ds.length > 0 || !!agent.luotDangChayCu || agent.matKetNoi !== null;
  if (!coGi) return null;

  return (
    <div data-testid="agent-dong-thoi-gian" className="space-y-2">
      {agent.luotDangChayCu && !s.dangChay && (
        <div data-testid="agent-moi-noi-lai" className="flex flex-wrap items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-2 py-1.5 text-[12px] text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
          <Bot className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-words">
            {t("repoWs.agent.coLuotDangChay", "Bạn có một lượt chạy agent chưa xong.")}
            {agent.luotDangChayCu.cauHoi ? ` “${agent.luotDangChayCu.cauHoi.slice(0, 80)}”` : ""}
          </span>
          <Button size="sm" variant="outline" onClick={() => void agent.noiLai(agent.luotDangChayCu!.id)}>
            {t("repoWs.agent.noiLai", "Nối lại")}
          </Button>
        </div>
      )}

      <BangKeHoach viec={s.keHoach} />

      <DongModelBatDau m={s.modelBatDau} dangChay={s.dangChay} />

      {s.dangChay && (
        <div data-testid="agent-trang-thai" aria-live="polite" className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
          {s.choDuyet ? (
            <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
              <Hourglass className="h-3.5 w-3.5" aria-hidden />
              {t("repoWs.agent.dangChoDuyet", "Đang chờ bạn duyệt")}
            </span>
          ) : s.phiaTruoc !== null ? (
            <span className="flex items-center gap-1">
              <Hourglass className="h-3.5 w-3.5" aria-hidden />
              {t("repoWs.agent.choModel", "Đang chờ lượt model ({{n}} phía trước)", { n: s.phiaTruoc })}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t("repoWs.agent.dangChay", "Agent đang làm việc…")}
            </span>
          )}
          {s.usage && (
            <span className="ml-auto tabular-nums">
              {t("repoWs.agent.usage", "token vào {{vao}} · ra {{ra}}", { vao: s.usage.vao, ra: s.usage.ra })}
              {typeof s.usage.ctxPhanTram === "number" ? ` · ${t("repoWs.agent.ctx", "ngữ cảnh {{p}}%", { p: Math.round(s.usage.ctxPhanTram) })}` : ""}
            </span>
          )}
        </div>
      )}

      {ds.map((m, i) => {
        const cuoi = i === ds.length - 1;
        switch (m.kieu) {
          case "cau-hoi":
            return (
              <div key={i} className="flex justify-end gap-2">
                <div className="min-w-0 max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary px-3 py-2 text-[13px] text-primary-foreground">{m.noiDung}</div>
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary"><User className="h-3.5 w-3.5" /></div>
              </div>
            );
          case "chu":
            return (
              <Fragment key={i}>
                <div data-testid="agent-chu" className="prose prose-sm dark:prose-invert min-w-0 max-w-none break-words rounded-lg bg-muted px-3 py-2 text-[13px] leading-relaxed">
                  {/* Chữ MODEL viết ⇒ Streamdown TRƠN (không bộ khối "đầu ra lệnh"). */}
                  <Streamdown mode={s.dangChay && cuoi ? "streaming" : "static"}>{m.noiDung}</Streamdown>
                </div>
                {choPhanHoi?.iDong === i && <PhanHoiTraLoi runId={choPhanHoi.runId} chiSoTin={choPhanHoi.chiSoTin} />}
              </Fragment>
            );
          case "nghi":
            return (
              <BangDangNghi
                key={i}
                vanBan={m.noiDung}
                dangStream={s.dangChay && cuoi}
                daCoChu={ds.slice(i + 1).some((x) => x.kieu === "chu")}
              />
            );
          case "tool":
            return <DongTool key={`t-${m.id}-${i}`} m={m} />;
          case "duyet":
            return <TheDuyetAgent key={`d-${m.id}-${i}`} m={m} agent={agent} />;
          case "nho":
            return <TheDeXuatNho key={`n-${m.id}-${i}`} m={m} agent={agent} />;
          case "canh-bao":
            return (
              <p
                key={i}
                data-testid="agent-canh-bao"
                data-loai={m.loaiCanhBao}
                className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[12px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">
                  {m.loaiCanhBao === "ha-tu-tri"
                    ? t("repoWs.agent.haTuTri", "Đã hạ tự trị: lượt này đã đọc nội dung đáng ngờ ({{nguon}}) — mọi ghi/lệnh sau đó cần bạn duyệt.", { nguon: m.nguon })
                    : t("repoWs.agent.canhBaoDuLieu", "Nội dung đọc từ {{nguon}} chứa câu dạng mệnh lệnh — agent coi là dữ liệu, không làm theo.", { nguon: m.nguon })}
                </span>
              </p>
            );
          case "loi":
            return (
              <p key={i} data-testid="agent-loi" className="flex items-start gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-[12px] text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{m.thongDiep}</span>
              </p>
            );
          default:
            return null;
        }
      })}

      {agent.matKetNoi !== null && (
        <div data-testid="agent-mat-ket-noi" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 px-2 py-1.5 text-[12px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
          <span className="min-w-0 flex-1 break-words">
            {agent.matKetNoi || t("repoWs.agent.matKetNoi", "Mất kết nối luồng sự kiện — lượt chạy vẫn tiếp tục ở máy chủ.")}
          </span>
          {s.runId && (
            <Button size="sm" variant="outline" onClick={() => void agent.noiLai()}>
              {t("repoWs.agent.noiLai", "Nối lại")}
            </Button>
          )}
        </div>
      )}
      {agent.loiThaoTac && (
        <p data-testid="agent-loi-thao-tac" className="text-[12px] text-red-700 dark:text-red-300">{agent.loiThaoTac}</p>
      )}

      <KetThuc agent={agent} onMoTep={onMoTep} />
    </div>
  );
}
