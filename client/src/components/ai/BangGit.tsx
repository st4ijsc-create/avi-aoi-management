/**
 * ★★★ Đợt 3b (3.4) — BẢNG GIT (thuần hiển thị + callback; lời gọi tRPC ở `KhungGit`).
 *
 * Ba cột: TRẠNG THÁI (chọn tệp + ô thông điệp + "Gợi ý thông điệp" + Commit) · DIFF của tệp đang xem (dùng lại
 * `HunkDiffView` chế độ `readOnly` — không vẽ diff lần thứ hai) · NHÁNH (chọn/chuyển, tạo mới) + LOG ngắn.
 *
 * ⚠ Nút ghi (Commit / tạo / chuyển nhánh) KHOÁ khi: repo chính (chỉ đọc) · `.git` là worktree · người dùng thiếu
 *   `ai_repo_exec` — và câu giải thích nói ĐÚNG lý do. Khoá ở đây là phép lịch sự; máy chủ (`cuaGitDuAn` + RBAC) mới
 *   là hàng rào.
 * ⚠ "Gợi ý thông điệp" chỉ ĐIỀN CHỮ vào ô — người vẫn đọc/sửa và vẫn phải bấm Commit.
 * ⚠ Cây bẩn ⇒ ô nhánh vẫn mở nhưng nút Chuyển/Tạo khoá + câu "commit hoặc bỏ thay đổi trước" (máy chủ cũng từ chối).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, GitCommitHorizontal, RefreshCw, Sparkles, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HunkDiffView } from "@/components/diff/HunkDiffView";
import { cauLoiGit, nhanTrangThai, tenNhanhHopLeClient, thongDiepDung } from "./bangGitLogic";

export interface MucGitUI {
  path: string;
  tuDuong: string | null;
  xy: string;
}

export interface TrangThaiGitUI {
  nhanh: string | null;
  chuaCoCommit: boolean;
  muc: MucGitUI[];
  soAn: number;
  tongThat: number;
  catBot: boolean;
  laRepoChinh: boolean;
  ghiDuoc: boolean;
}

export interface DiffGitUI {
  path: string;
  xy: string;
  goc: string;
  moi: string;
  nhiPhan: boolean;
  catBot: boolean;
  daChe: boolean;
}

export interface DongLogUI {
  hash: string;
  ngan: string;
  tacGia: string;
  luc: number;
  tieuDe: string;
}

export interface BangGitProps {
  /** `null` + `loi` ⇒ băng lỗi (KHÔNG BAO GIỜ giả danh "không có thay đổi"). */
  tt: TrangThaiGitUI | null;
  loi: string | null;
  dangTai: boolean;
  coQuyenGhi: boolean;
  nhanh: string[];
  nhanhHienTai: string | null;
  log: DongLogUI[];
  tepXem: string | null;
  diff: DiffGitUI | null;
  loiDiff: string | null;
  dangTaiDiff: boolean;
  dangBan: boolean;
  onXemTep: (path: string) => void;
  onCommit: (paths: string[], thongDiep: string) => Promise<boolean>;
  onGoiY: (paths: string[]) => Promise<string | null>;
  onTaoNhanh: (ten: string) => void;
  onChuyenNhanh: (ten: string) => void;
  onLamMoi: () => void;
}

const MAU: Record<string, string> = {
  moi: "text-emerald-600 dark:text-emerald-400",
  sua: "text-amber-600 dark:text-amber-400",
  xoa: "text-red-600 dark:text-red-400",
  doiTen: "text-sky-600 dark:text-sky-400",
  xungDot: "text-fuchsia-600 dark:text-fuchsia-400",
};

export function BangGit(p: BangGitProps) {
  const { t } = useTranslation();
  const [chon, setChon] = useState<string[]>([]);
  const [thongDiep, setThongDiep] = useState("");
  const [tenMoi, setTenMoi] = useState("");
  const [nhanhChon, setNhanhChon] = useState<string>("");
  const [dangGoiY, setDangGoiY] = useState(false);

  const dsDuong = useMemo(() => (p.tt?.muc ?? []).map((m) => m.path), [p.tt]);
  // Danh sách đổi (sau commit / làm mới) ⇒ bỏ chọn những tệp không còn trong trạng thái.
  useEffect(() => {
    setChon((c) => c.filter((x) => dsDuong.includes(x)));
  }, [dsDuong]);
  useEffect(() => {
    setNhanhChon(p.nhanhHienTai ?? "");
  }, [p.nhanhHienTai]);

  const lyDoKhoaGhi: string | null = !p.tt
    ? null
    : p.tt.laRepoChinh
      ? t("repoWs.git.chiDocRepoChinh")
      : !p.tt.ghiDuoc
        ? t("repoWs.git.chiDocWorktree")
        : !p.coQuyenGhi
          ? t("repoWs.git.thieuQuyen")
          : null;
  const ghiDuoc = lyDoKhoaGhi === null && !p.dangBan;
  const ban = (p.tt?.tongThat ?? 0) > 0;
  const tatCaDaChon = dsDuong.length > 0 && chon.length === dsDuong.length;

  if (p.loi) {
    return (
      <div data-git-loi className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
        {cauLoiGit(p.loi, t)}
        <Button variant="ghost" size="sm" className="ml-2 h-6 px-2 text-[11px]" onClick={p.onLamMoi}>
          {t("repoWs.git.lamMoi")}
        </Button>
      </div>
    );
  }
  if (p.dangTai || !p.tt) {
    return <p className="px-1 py-2 text-[12px] text-muted-foreground">{t("repoWs.git.dangTai")}</p>;
  }

  const commit = async () => {
    const ok = await p.onCommit(chon, thongDiep);
    if (ok) {
      setThongDiep("");
      setChon([]);
    }
  };
  const goiY = async () => {
    setDangGoiY(true);
    try {
      const s = await p.onGoiY(chon);
      if (s) setThongDiep(s);
    } finally {
      setDangGoiY(false);
    }
  };

  return (
    <div data-bang-git className="grid min-h-0 gap-3 text-[12px] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
      {/* ── 1. TRẠNG THÁI + COMMIT ── */}
      <section className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-semibold">{t("repoWs.git.thayDoi", { n: p.tt.muc.length })}</span>
          <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={p.onLamMoi} aria-label={t("repoWs.git.lamMoi")} title={t("repoWs.git.lamMoi")}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        {lyDoKhoaGhi && (
          <p data-git-chi-doc className="flex items-start gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            {lyDoKhoaGhi}
          </p>
        )}
        {p.tt.muc.length === 0 ? (
          <p data-git-sach className="text-muted-foreground">{t("repoWs.git.sach")}</p>
        ) : (
          <>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                data-chon-tat-ca
                checked={tatCaDaChon}
                onChange={(e) => setChon(e.target.checked ? dsDuong : [])}
              />
              {t("repoWs.git.chonTatCa")}
            </label>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto">
              {p.tt.muc.map((m) => {
                const n = nhanTrangThai(m.xy);
                return (
                  <li key={m.path} className={cn("flex items-center gap-1.5 rounded px-1 hover:bg-muted", p.tepXem === m.path && "bg-muted")}>
                    <input
                      type="checkbox"
                      data-chon-tep={m.path}
                      checked={chon.includes(m.path)}
                      onChange={(e) => setChon((c) => (e.target.checked ? [...c, m.path] : c.filter((x) => x !== m.path)))}
                      aria-label={m.path}
                    />
                    <button type="button" data-xem-tep={m.path} className="min-w-0 flex-1 truncate text-left font-mono text-[11px]" onClick={() => p.onXemTep(m.path)} title={m.tuDuong ? `${m.tuDuong} → ${m.path}` : m.path}>
                      {m.path}
                    </button>
                    <span className={cn("w-3 shrink-0 text-center font-mono text-[11px] font-bold", MAU[n.loai])} title={m.xy}>
                      {n.kyTu}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {(p.tt.soAn > 0 || p.tt.catBot) && (
          <p className="text-[10px] text-muted-foreground">
            {p.tt.soAn > 0 && t("repoWs.git.soAn", { n: p.tt.soAn })} {p.tt.catBot && t("repoWs.git.catBot")}
          </p>
        )}
        <textarea
          data-o-thong-diep
          value={thongDiep}
          onChange={(e) => setThongDiep(e.target.value)}
          rows={3}
          disabled={!ghiDuoc}
          placeholder={t("repoWs.git.thongDiepPh")}
          aria-label={t("repoWs.git.thongDiepPh")}
          className="w-full resize-y rounded-md border bg-background px-2 py-1 text-[12px] disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            data-nut-goi-y
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={chon.length === 0 || dangGoiY || p.dangBan}
            onClick={() => void goiY()}
            title={t("repoWs.git.goiYTip")}
          >
            <Sparkles className="h-3 w-3" />
            {dangGoiY ? t("repoWs.git.dangGoiY") : t("repoWs.git.goiY")}
          </Button>
          <Button
            size="sm"
            data-nut-commit
            className="h-7 px-2 text-[11px]"
            disabled={!ghiDuoc || chon.length === 0 || !thongDiepDung(thongDiep)}
            onClick={() => void commit()}
          >
            {t("repoWs.git.commit", { n: chon.length })}
          </Button>
        </div>
      </section>

      {/* ── 2. DIFF ── */}
      <section data-git-diff className="min-w-0">
        {!p.tepXem ? (
          <p className="text-muted-foreground">{t("repoWs.git.chonDeXem")}</p>
        ) : p.dangTaiDiff ? (
          <p className="text-muted-foreground">{t("repoWs.git.dangTaiDiff")}</p>
        ) : p.loiDiff ? (
          <p className="text-destructive">{cauLoiGit(p.loiDiff, t)}</p>
        ) : p.diff ? (
          <div className="min-w-0">
            <p className="mb-1 truncate font-mono text-[11px] font-semibold">{p.diff.path}</p>
            {p.diff.nhiPhan ? (
              <p data-git-nhi-phan className="text-muted-foreground">{t("repoWs.git.nhiPhan")}</p>
            ) : p.diff.catBot ? (
              <p data-git-cat-bot className="text-muted-foreground">{t("repoWs.git.diffQuaLon")}</p>
            ) : (
              <>
                {p.diff.daChe && <p className="mb-1 text-[10px] text-amber-700 dark:text-amber-300">{t("repoWs.git.daChe")}</p>}
                <HunkDiffView base={p.diff.goc} suggested={p.diff.moi} readOnly />
              </>
            )}
          </div>
        ) : null}
      </section>

      {/* ── 3. NHÁNH + LOG ── */}
      <section className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-semibold">{t("repoWs.git.nhanh")}</span>
          <span data-nhanh-hien-tai className="ml-auto truncate font-mono text-[11px]">{p.tt.nhanh ?? t("repoWs.git.khongNhanh")}</span>
        </div>
        <div className="flex items-center gap-1">
          <select
            data-chon-nhanh
            value={nhanhChon}
            onChange={(e) => setNhanhChon(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1 text-[11px]"
            aria-label={t("repoWs.git.chonNhanh")}
          >
            {p.nhanh.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            data-nut-chuyen-nhanh
            className="h-7 px-2 text-[11px]"
            disabled={!ghiDuoc || ban || !nhanhChon || nhanhChon === p.nhanhHienTai}
            onClick={() => p.onChuyenNhanh(nhanhChon)}
          >
            {t("repoWs.git.chuyen")}
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <input
            data-o-nhanh-moi
            value={tenMoi}
            onChange={(e) => setTenMoi(e.target.value.trim())}
            placeholder={t("repoWs.git.nhanhMoiPh")}
            aria-label={t("repoWs.git.nhanhMoiPh")}
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px]"
          />
          <Button
            variant="outline"
            size="sm"
            data-nut-tao-nhanh
            className="h-7 px-2 text-[11px]"
            disabled={!ghiDuoc || ban || !tenNhanhHopLeClient(tenMoi) || p.nhanh.includes(tenMoi)}
            onClick={() => {
              p.onTaoNhanh(tenMoi);
              setTenMoi("");
            }}
          >
            {t("repoWs.git.tao")}
          </Button>
        </div>
        {tenMoi !== "" && !tenNhanhHopLeClient(tenMoi) && <p data-loi-ten-nhanh className="text-[10px] text-destructive">{t("repoWs.git.tenNhanhSai")}</p>}
        {ban && <p data-git-cay-ban className="text-[10px] text-muted-foreground">{t("repoWs.git.canSachDeDoiNhanh")}</p>}
        <div className="mt-1 text-[11px] font-semibold">{t("repoWs.git.log")}</div>
        {p.log.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t("repoWs.git.logRong")}</p>
        ) : (
          <ul data-git-log className="max-h-40 space-y-0.5 overflow-y-auto">
            {p.log.map((d) => (
              <li key={d.hash} className="truncate text-[11px]" title={`${d.hash}\n${d.tacGia} · ${new Date(d.luc * 1000).toLocaleString()}`}>
                <span className="font-mono text-muted-foreground">{d.ngan}</span> {d.tieuDe}
                <span className="text-muted-foreground"> — {d.tacGia}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
