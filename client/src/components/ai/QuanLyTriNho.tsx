/**
 * ★★★ Đợt 3b (3.5) — MÀN QUẢN LÝ TRÍ NHỚ: xem / sửa / xoá / thêm tay BÀI HỌC (`ai_coding_lessons`) của CHÍNH người
 * dùng trên dự án đang chọn.
 *
 * • Trước: bài học chỉ quản được bằng câu chat ("nhớ rằng: …", "liệt kê bài học", "quên bài học N") — khảo sát L7 G5.
 * • Không quyền mới, không đường ghi mới: tuyến `repoWorkspace.baiHoc*` dùng ĐÚNG cửa ghi của đường chat
 *   (`lamSachBaiHoc` quét tiêm + che bí mật; rủi ro cao ⇒ từ chối) và tầng dữ liệu phạm vi chủ sở hữu.
 * • Câu nói thật: bài học là của RIÊNG bạn × dự án này; cờ `AI_CODING_LESSONS` tắt ⇒ băng "đang không vào prompt".
 *
 * Tách ruột `NoiDungQuanLyTriNho` (thuần theo props) để lưới DOM dựng cây thật — Radix Dialog đi qua Portal (cùng lý do
 * `QuanLyDuAnRepo`/`BoChonPhien`).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Brain, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";

export interface BaiHocUI {
  id: string;
  noiDung: string;
  updatedAt: string;
  mucRuiRo: string;
}

/** Trần ký tự một bài học (khớp `GIOI_HAN_BAI_HOC.KY_TU_MOI_BAI` — máy chủ cắt lại). */
export const TRAN_KY_TU_BAI_HOC = 400;

const MA_NOTE = ["PERMISSION_DENIED", "PROJECT_NOT_FOUND", "LESSON_RISKY", "LESSON_EMPTY", "LESSON_FULL", "LESSON_DUPLICATE", "NOT_FOUND", "SAVE_FAILED"] as const;

type HamT = (k: string, o?: Record<string, unknown>) => string;
export function cauNoteTriNho(note: string | null | undefined, t: HamT): string {
  const m = String(note ?? "?");
  return (MA_NOTE as readonly string[]).includes(m) ? t(`repoWs.triNho.note.${m}`) : t("repoWs.triNho.note.khac", { ma: m });
}

export interface NoiDungQuanLyTriNhoProps {
  baiHoc: BaiHocUI[];
  tran: number;
  batTrongPrompt: boolean;
  dangTai: boolean;
  loiTai: string | null;
  dangBan: boolean;
  onThem: (noiDung: string) => Promise<boolean>;
  onSua: (id: string, noiDung: string) => Promise<boolean>;
  onXoa: (id: string) => void;
}

export function NoiDungQuanLyTriNho(p: NoiDungQuanLyTriNhoProps) {
  const { t } = useTranslation();
  const [moi, setMoi] = useState("");
  const [dangSua, setDangSua] = useState<string | null>(null);
  const [banSua, setBanSua] = useState("");

  return (
    <div data-noi-dung-tri-nho className="flex flex-col gap-2 text-[12px]">
      <p className="text-[11px] text-muted-foreground">{t("repoWs.triNho.giaiThich")}</p>
      {!p.batTrongPrompt && (
        <p data-tri-nho-tat className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {t("repoWs.triNho.coTat")}
        </p>
      )}
      <form
        className="flex flex-col gap-1"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!moi.trim()) return;
          if (await p.onThem(moi)) setMoi("");
        }}
      >
        <textarea
          data-o-bai-hoc-moi
          value={moi}
          maxLength={TRAN_KY_TU_BAI_HOC * 2}
          onChange={(e) => setMoi(e.target.value)}
          rows={2}
          placeholder={t("repoWs.triNho.themPh")}
          aria-label={t("repoWs.triNho.themPh")}
          className="w-full resize-y rounded-md border bg-background px-2 py-1 text-[12px]"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" data-nut-them-bai-hoc className="h-7 px-2 text-[11px]" disabled={!moi.trim() || p.dangBan}>
            {t("repoWs.triNho.them")}
          </Button>
          <span className="text-[10px] tabular-nums text-muted-foreground">{t("repoWs.triNho.dem", { n: p.baiHoc.length, tran: p.tran })}</span>
        </div>
      </form>
      {p.loiTai ? (
        <p data-tri-nho-loi className="text-destructive">{p.loiTai}</p>
      ) : p.dangTai ? (
        <p className="text-muted-foreground">{t("repoWs.triNho.dangTai")}</p>
      ) : p.baiHoc.length === 0 ? (
        <p data-tri-nho-rong className="text-muted-foreground">{t("repoWs.triNho.rong")}</p>
      ) : (
        <ol className="max-h-80 space-y-1 overflow-y-auto">
          {p.baiHoc.map((b, i) => (
            <li key={b.id} data-bai-hoc={b.id} className="group rounded-md border px-2 py-1">
              {dangSua === b.id ? (
                <form
                  className="flex flex-col gap-1"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await p.onSua(b.id, banSua)) setDangSua(null);
                  }}
                >
                  <textarea
                    data-o-sua-bai-hoc
                    autoFocus
                    value={banSua}
                    maxLength={TRAN_KY_TU_BAI_HOC * 2}
                    onChange={(e) => setBanSua(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") setDangSua(null); }}
                    rows={2}
                    className="w-full resize-y rounded border bg-background px-1.5 py-1 text-[12px]"
                  />
                  <div className="flex gap-1">
                    <Button type="submit" size="sm" data-nut-luu-bai-hoc className="h-6 px-2 text-[11px]" disabled={!banSua.trim() || p.dangBan}>
                      {t("repoWs.triNho.luu")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setDangSua(null)}>
                      {t("repoWs.triNho.huy")}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-1.5">
                  <span className="shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{b.noiDung}</span>
                  {b.mucRuiRo === "low" && (
                    <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" title={t("repoWs.triNho.ruiRoThapTip")}>
                      {t("repoWs.triNho.ruiRoThap")}
                    </span>
                  )}
                  <button
                    type="button"
                    data-nut-sua-bai-hoc={b.id}
                    onClick={() => { setDangSua(b.id); setBanSua(b.noiDung); }}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    title={t("repoWs.triNho.sua")}
                    aria-label={t("repoWs.triNho.sua")}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    data-nut-xoa-bai-hoc={b.id}
                    onClick={() => p.onXoa(b.id)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                    title={t("repoWs.triNho.xoa")}
                    aria-label={t("repoWs.triNho.xoa")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="text-[10px] text-muted-foreground">{t("repoWs.triNho.phamVi")}</p>
    </div>
  );
}

/** VỎ: nút não + dialog; giữ lời gọi tRPC. */
export function QuanLyTriNho({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [mo, setMo] = useState(false);
  const utils = trpc.useUtils();
  const dsQ = trpc.repoWorkspace.baiHocDanhSach.useQuery({ projectId }, { enabled: mo && !!projectId });
  const themM = trpc.repoWorkspace.baiHocThem.useMutation();
  const suaM = trpc.repoWorkspace.baiHocSua.useMutation();
  const xoaM = trpc.repoWorkspace.baiHocXoa.useMutation();
  const lamMoi = () => void utils.repoWorkspace.baiHocDanhSach.invalidate({ projectId });

  const onThem = async (noiDung: string) => {
    try {
      const r = await themM.mutateAsync({ projectId, noiDung });
      if (!r.ok) { toast.error(cauNoteTriNho(r.note, t)); return false; }
      if (r.note) toast.info(cauNoteTriNho(r.note, t));
      lamMoi();
      return true;
    } catch (e) { toast.error(mapTrpcError(e)); return false; }
  };
  const onSua = async (id: string, noiDung: string) => {
    try {
      const r = await suaM.mutateAsync({ projectId, id, noiDung });
      if (!r.ok) { toast.error(cauNoteTriNho(r.note, t)); return false; }
      lamMoi();
      return true;
    } catch (e) { toast.error(mapTrpcError(e)); return false; }
  };
  const onXoa = async (id: string) => {
    if (!window.confirm(t("repoWs.triNho.xacNhanXoa"))) return;
    try {
      const r = await xoaM.mutateAsync({ projectId, id });
      if (!r.ok) toast.error(cauNoteTriNho(r.note, t));
      lamMoi();
    } catch (e) { toast.error(mapTrpcError(e)); }
  };

  const d = dsQ.data;
  return (
    <Dialog open={mo} onOpenChange={setMo}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" data-nut-tri-nho className="h-6 w-6" title={t("repoWs.triNho.nut")} aria-label={t("repoWs.triNho.nut")} disabled={!projectId}>
          <Brain className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("repoWs.triNho.tieuDe")}</DialogTitle>
          <DialogDescription>{t("repoWs.triNho.moTa", { duAn: projectId })}</DialogDescription>
        </DialogHeader>
        <NoiDungQuanLyTriNho
          baiHoc={d?.ok ? d.baiHoc : []}
          tran={d?.ok ? d.tran : 0}
          batTrongPrompt={d?.ok ? d.batTrongPrompt : true}
          dangTai={dsQ.isLoading}
          loiTai={dsQ.isError ? mapTrpcError(dsQ.error) : d && !d.ok ? cauNoteTriNho(d.note, t) : null}
          dangBan={themM.isPending || suaM.isPending || xoaM.isPending}
          onThem={onThem}
          onSua={onSua}
          onXoa={(id) => void onXoa(id)}
        />
      </DialogContent>
    </Dialog>
  );
}
