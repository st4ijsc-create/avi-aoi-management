/**
 * ★ Đợt 11.8 — "LỊCH SỬ AGENT": danh sách phiên agent hợp nhất (`aiPhien` kind=agent; nguồn web · vscode · cli) — mở xem lượt, đổi tên, xoá.
 *   • Xoá có BƯỚC XÁC NHẬN ngay trong trang (không dùng `confirm()`), và nói rõ: xoá phiên KHÔNG xoá nhật ký các lượt chạy (sổ kiểm toán máy chủ giữ).
 *   • Chữ trong lượt (do người dùng/model viết) hiện CHỮ THUẦN; huy hiệu "đã dùng AI ngoài" khi `coLuotNgoai` (máy chủ ghi, client không khai).
 *   • Đổi tên mang `expectedVersion` (xung đột phiên bản ⇒ báo, tải lại).
 * Tách ruột `NoiDungLichSuAgent` (thuần theo props) để lưới DOM dựng cây thật — Radix Dialog đi qua Portal (cùng lý do `QuanLyTriNho`).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { History, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";

export interface PhienAgentUI {
  id: string;
  title: string;
  source: string;
  turnCount: number;
  coLuotNgoai: boolean;
  version: number;
  updatedAt: string;
}
export interface PhienXemUI {
  id: string;
  title: string;
  turns: Array<{ role: string; content: string }>;
  soLuotChay: number;
}

const MA_NOTE = ["PERMISSION_DENIED", "PROJECT_NOT_FOUND", "NOT_FOUND", "CONFLICT", "THAM_SO_SAI", "LOI"] as const;
type HamT = (k: string, o?: Record<string, unknown>) => string;
export function cauNoteLichSuAgent(note: string | null | undefined, t: HamT): string {
  const m = String(note ?? "?");
  return (MA_NOTE as readonly string[]).includes(m) ? t(`repoWs.lichSuAgent.note.${m}`) : t("repoWs.lichSuAgent.note.khac", { ma: m });
}

/** Nhãn nguồn phiên (khoá i18n cố định; nguồn lạ ⇒ chữ thô đã cắt). */
function nhanNguon(nguon: string, t: HamT): string {
  if (nguon === "web") return t("repoWs.lichSuAgent.nguon.web");
  if (nguon === "vscode") return t("repoWs.lichSuAgent.nguon.vscode");
  if (nguon === "cli") return t("repoWs.lichSuAgent.nguon.cli");
  return nguon.slice(0, 16);
}

export interface NoiDungLichSuAgentProps {
  phien: PhienAgentUI[];
  dangTai: boolean;
  biTuChoi: boolean;
  xem: PhienXemUI | null;
  dangGui: string | null;
  onMo: (id: string) => void;
  onDongXem: () => void;
  onDoiTen: (id: string, ten: string, version: number) => void;
  onXoa: (id: string) => void;
}

export function NoiDungLichSuAgent({ phien, dangTai, biTuChoi, xem, dangGui, onMo, onDongXem, onDoiTen, onXoa }: NoiDungLichSuAgentProps) {
  const { t } = useTranslation();
  const tt = t as unknown as HamT;
  const [dangXoa, setDangXoa] = useState<string | null>(null);
  const [dangSua, setDangSua] = useState<{ id: string; ten: string } | null>(null);
  if (biTuChoi) return <p data-testid="lsa-bi-tu-choi" className="text-xs text-muted-foreground">{t("repoWs.lichSuAgent.biTuChoi", "Bạn không có quyền xem lịch sử agent của dự án này.")}</p>;
  if (dangTai) return <p className="text-xs text-muted-foreground">{t("repoWs.lichSuAgent.dangTai", "Đang tải…")}</p>;
  if (xem) {
    return (
      <div data-testid="lsa-xem" className="space-y-2">
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" data-testid="lsa-quay-lai" onClick={onDongXem}>{t("repoWs.lichSuAgent.quayLai", "Quay lại")}</Button>
          <span data-testid="lsa-xem-ten" className="min-w-0 truncate text-sm font-medium">{xem.title}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">{t("repoWs.lichSuAgent.soLuotChay", "{{n}} lượt chạy gắn với phiên này.", { n: xem.soLuotChay })}</p>
        <ul className="max-h-80 space-y-1.5 overflow-auto">
          {xem.turns.map((x, i) => (
            <li key={i} data-testid="lsa-luot" data-vai={x.role} className="rounded border px-2 py-1 text-xs">
              <span className="mr-1 font-semibold">{x.role === "user" ? t("repoWs.lichSuAgent.ban", "Bạn") : t("repoWs.lichSuAgent.agent", "Agent")}:</span>
              <span className="whitespace-pre-wrap break-words">{x.content}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (phien.length === 0) return <p data-testid="lsa-rong" className="text-xs text-muted-foreground">{t("repoWs.lichSuAgent.rong", "Chưa có phiên agent nào trong dự án này.")}</p>;
  return (
    <ul data-testid="lsa-ds" className="space-y-1.5">
      {phien.map((p) => {
        const gui = dangGui === p.id;
        const sua = dangSua?.id === p.id;
        const xoa = dangXoa === p.id;
        return (
          <li key={p.id} data-testid="lsa-phien" data-id={p.id} className="rounded-md border p-2 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              {sua ? (
                <input
                  data-testid="lsa-o-ten"
                  className="h-7 min-w-0 flex-1 rounded border bg-background px-1.5 text-sm"
                  maxLength={200}
                  value={dangSua.ten}
                  onChange={(e) => setDangSua({ id: p.id, ten: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && dangSua.ten.trim()) {
                      onDoiTen(p.id, dangSua.ten.trim(), p.version);
                      setDangSua(null);
                    }
                    if (e.key === "Escape") setDangSua(null);
                  }}
                />
              ) : (
                <span data-testid="lsa-ten" className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
              )}
              <span data-testid="lsa-nguon" className="rounded border px-1 text-[11px] text-muted-foreground">{nhanNguon(p.source, tt)}</span>
              {p.coLuotNgoai && (
                <span data-testid="lsa-co-ngoai" className="rounded border border-amber-300 bg-amber-50 px-1 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  {t("repoWs.lichSuAgent.coNgoai", "đã dùng AI ngoài")}
                </span>
              )}
              <span className="text-[11px] tabular-nums text-muted-foreground">{t("repoWs.lichSuAgent.soLuot", "{{n}} lượt", { n: p.turnCount })}</span>
            </div>
            {!xoa && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="outline" data-testid="lsa-mo" disabled={gui} onClick={() => onMo(p.id)}>{t("repoWs.lichSuAgent.mo", "Xem")}</Button>
                {sua ? (
                  <Button type="button" size="sm" variant="outline" data-testid="lsa-luu-ten" disabled={!dangSua.ten.trim() || gui} onClick={() => { onDoiTen(p.id, dangSua.ten.trim(), p.version); setDangSua(null); }}>
                    {t("repoWs.lichSuAgent.luuTen", "Lưu tên")}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="outline" data-testid="lsa-sua" disabled={gui} onClick={() => setDangSua({ id: p.id, ten: p.title })} aria-label={t("repoWs.lichSuAgent.doiTen", "Đổi tên")}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" data-testid="lsa-xoa" disabled={gui} onClick={() => setDangXoa(p.id)} aria-label={t("repoWs.lichSuAgent.xoa", "Xoá phiên")}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
            {xoa && (
              <div data-testid="lsa-xac-nhan-xoa" role="alertdialog" className="mt-1.5 space-y-1.5 rounded border border-red-300 bg-red-50/60 p-2 text-xs dark:border-red-900/50 dark:bg-red-950/20">
                <p>{t("repoWs.lichSuAgent.hoiXoa", "Xoá phiên “{{ten}}”? Việc này không hoàn tác được.", { ten: p.title })}</p>
                <p data-testid="lsa-ghi-chu-nhat-ky" className="text-muted-foreground">{t("repoWs.lichSuAgent.nhatKy", "Xoá phiên KHÔNG xoá nhật ký các lượt chạy (sổ kiểm toán trên máy chủ vẫn giữ).")}</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="destructive" data-testid="lsa-xac-nhan" disabled={gui} onClick={() => { onXoa(p.id); setDangXoa(null); }}>
                    {t("repoWs.lichSuAgent.xacNhanXoa", "Xoá phiên")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" data-testid="lsa-huy-xoa" onClick={() => setDangXoa(null)}>{t("repoWs.lichSuAgent.huy", "Huỷ")}</Button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function LichSuAgent({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [mo, setMo] = useState(false);
  const [dangGui, setDangGui] = useState<string | null>(null);
  const [idXem, setIdXem] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const dsQ = trpc.aiPhien.danhSach.useQuery({ projectId, kind: "agent" }, { enabled: mo && !!projectId });
  const xemQ = trpc.aiPhien.mo.useQuery({ sessionId: idXem ?? "x" }, { enabled: mo && idXem !== null, retry: false });
  const doiTenM = trpc.aiPhien.doiTen.useMutation();
  const xoaM = trpc.aiPhien.xoa.useMutation();
  const lamMoi = () => utils.aiPhien.danhSach.invalidate();
  const d = dsQ.data;
  const s = xemQ.data?.ok && xemQ.data.session ? xemQ.data.session : null;
  const xem: PhienXemUI | null = idXem !== null && s ? { id: s.id, title: s.title, turns: s.turns, soLuotChay: s.runIds.length } : null;
  const baoLoi = (note: string | null | undefined) => toast.error(cauNoteLichSuAgent(note, t as unknown as HamT));
  return (
    <Dialog open={mo} onOpenChange={(v) => { setMo(v); if (!v) setIdXem(null); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" data-testid="lsa-mo-man" title={t("repoWs.lichSuAgent.tieuDe", "Lịch sử agent")} aria-label={t("repoWs.lichSuAgent.tieuDe", "Lịch sử agent")}>
          <History className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("repoWs.lichSuAgent.tieuDe", "Lịch sử agent")}</DialogTitle>
          <DialogDescription>{t("repoWs.lichSuAgent.moTaMan", "Các phiên agent của bạn trong dự án {{duAn}} (web, VS Code, dòng lệnh).", { duAn: projectId })}</DialogDescription>
        </DialogHeader>
        <NoiDungLichSuAgent
          phien={(d?.sessions ?? []) as PhienAgentUI[]}
          dangTai={dsQ.isLoading || (idXem !== null && xemQ.isLoading)}
          biTuChoi={d?.ok === false && d.note === "PERMISSION_DENIED"}
          xem={xem}
          dangGui={dangGui}
          onMo={(id) => setIdXem(id)}
          onDongXem={() => setIdXem(null)}
          onDoiTen={(id, title, expectedVersion) => {
            setDangGui(id);
            doiTenM
              .mutateAsync({ sessionId: id, title, expectedVersion })
              .then((r) => {
                if (!r.ok) baoLoi(r.note);
              })
              .catch((e) => toast.error(mapTrpcError(e)))
              .finally(() => {
                setDangGui(null);
                void lamMoi();
              });
          }}
          onXoa={(id) => {
            setDangGui(id);
            xoaM
              .mutateAsync({ sessionId: id })
              .then((r) => {
                if (r.ok) toast.success(t("repoWs.lichSuAgent.daXoa", "Đã xoá phiên."));
                else baoLoi(r.note);
              })
              .catch((e) => toast.error(mapTrpcError(e)))
              .finally(() => {
                setDangGui(null);
                void lamMoi();
              });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
