/**
 * ★ Đợt 11.8 — MÀN "AGENT TỪ REPO: ĐỌC & XÁC NHẬN" (`aiAgent.dinhNghiaDanhSach` · `xacNhanDinhNghia` · `goTinCayDinhNghia`).
 *
 * Định nghĩa agent đặt tên có thể nằm TRONG repo (`.thoca/agents/*.md`) — tệp do bất kỳ ai có quyền ghi repo viết ⇒ chưa tin cho tới khi CHÍNH BẠN đọc và xác nhận.
 *   • Nội dung tệp hiện CHỮ THUẦN (máy chủ đã thoát ký tự lạ/ẩn); mô tả, tên, công cụ, model: text node — không markdown, không liên kết.
 *   • Nút "Tin cậy bản này" CHỈ bật SAU KHI bạn mở xem nội dung, và gửi lại đúng BĂM của bản đang hiển thị: tệp đổi giữa lúc đọc và lúc xác nhận ⇒
 *     máy chủ trả \`BAM_LECH\`, không ghi gì (bạn đọc lại bản mới).
 *   • "Gỡ tin cậy" xoá mọi tin cậy của BẠN cho định nghĩa đó (agent sẽ cần xác nhận lại).
 * Tách ruột \`NoiDungBangAgentTuRepo\` (thuần theo props) để lưới DOM dựng cây thật — Radix Dialog đi qua Portal (cùng lý do \`QuanLyTriNho\`).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bot, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";

export interface MucAgentUI {
  ten: string;
  moTa: string;
  nguon: "dungSan" | "tuRepo";
  congCu: string[];
  model: string;
  cheDo: "hoi" | "sua";
  maxLuot: number | null;
  bam: string;
  daTinCay: boolean;
  noiDungHienThi: string | null;
}

const MA_NOTE = ["PERMISSION_DENIED", "PROJECT_NOT_FOUND", "KHONG_CO", "BAM_LECH", "LOI_LUU", "THAM_SO_SAI"] as const;
type HamT = (k: string, o?: Record<string, unknown>) => string;
export function cauNoteAgentTuRepo(note: string | null | undefined, t: HamT): string {
  const m = String(note ?? "?");
  return (MA_NOTE as readonly string[]).includes(m) ? t(`repoWs.agentTuRepo.note.${m}`) : t("repoWs.agentTuRepo.note.khac", { ma: m });
}

export interface NoiDungBangAgentTuRepoProps {
  muc: MucAgentUI[];
  canhBao: Array<{ tep: string; ma: string }>;
  dangTai: boolean;
  biTuChoi: boolean;
  /** Tên agent đang gửi xác nhận / gỡ (khoá nút). */
  dangGui: string | null;
  onTinCay: (ten: string, bam: string) => void;
  onGoTinCay: (ten: string) => void;
}

export function NoiDungBangAgentTuRepo({ muc, canhBao, dangTai, biTuChoi, dangGui, onTinCay, onGoTinCay }: NoiDungBangAgentTuRepoProps) {
  const { t } = useTranslation();
  // "đã xem" theo (tên + băm): tệp đổi băm ⇒ phải xem lại bản mới
  const [daXem, setDaXem] = useState<ReadonlySet<string>>(new Set());
  const [dangMo, setDangMo] = useState<string | null>(null);
  if (biTuChoi) return <p data-testid="atr-bi-tu-choi" className="text-xs text-muted-foreground">{t("repoWs.agentTuRepo.biTuChoi", "Bạn không có quyền xem định nghĩa agent của dự án này.")}</p>;
  if (dangTai) return <p className="text-xs text-muted-foreground">{t("repoWs.agentTuRepo.dangTai", "Đang tải…")}</p>;
  const tuRepo = muc.filter((m) => m.nguon === "tuRepo");
  const dungSan = muc.filter((m) => m.nguon === "dungSan");
  return (
    <div data-testid="atr-noi-dung" className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        {t("repoWs.agentTuRepo.luuY", "Agent từ repo do tệp trong dự án định nghĩa — chưa được tin cho tới khi bạn đọc nội dung và xác nhận. Nếu tệp đổi sau khi bạn đọc, xác nhận bị từ chối.")}
      </p>
      <section>
        <h4 className="mb-1 text-xs font-semibold">{t("repoWs.agentTuRepo.tuRepo", "Từ repo")}</h4>
        {tuRepo.length === 0 && <p data-testid="atr-rong" className="text-xs text-muted-foreground">{t("repoWs.agentTuRepo.rong", "Dự án này chưa có tệp định nghĩa agent hợp lệ.")}</p>}
        <ul className="space-y-2">
          {tuRepo.map((m) => {
            const khoa = `${m.ten}:${m.bam}`;
            const xem = daXem.has(khoa);
            const mo = dangMo === khoa;
            const gui = dangGui === m.ten;
            return (
              <li key={khoa} data-testid="atr-muc" data-ten={m.ten} data-tin-cay={m.daTinCay ? "co" : "chua"} className="rounded-md border p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span data-testid="atr-ten" className="font-medium">{m.ten}</span>
                  <span className="rounded border border-sky-300 bg-sky-50 px-1 text-[11px] text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200">{t("repoWs.agent.con.tuRepo", "từ repo")}</span>
                  <span className="rounded border px-1 text-[11px] text-muted-foreground">{m.cheDo === "sua" ? t("repoWs.agent.con.sua", "sửa") : t("repoWs.agent.con.hoi", "hỏi")}</span>
                  {m.daTinCay ? (
                    <span data-testid="atr-da-tin" className="flex items-center gap-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="h-3 w-3" aria-hidden />
                      {t("repoWs.agentTuRepo.daTin", "đã tin cậy bản này")}
                    </span>
                  ) : (
                    <span data-testid="atr-chua-tin" className="text-[11px] text-amber-700 dark:text-amber-300">{t("repoWs.agentTuRepo.chuaTin", "chưa tin cậy")}</span>
                  )}
                </div>
                <p data-testid="atr-mo-ta" className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{m.moTa}</p>
                <p data-testid="atr-thong-so" className="mt-1 break-words text-[11px] text-muted-foreground">
                  {t("repoWs.agentTuRepo.thongSo", "Model: {{model}} · tối đa {{luot}} lượt · công cụ: {{cc}}", { model: m.model, luot: m.maxLuot ?? "—", cc: m.congCu.join(", ") || "—" })}
                </p>
                {m.noiDungHienThi !== null && (
                  <div className="mt-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid="atr-doc"
                      onClick={() => {
                        setDangMo(mo ? null : khoa);
                        if (!mo) setDaXem(new Set([...daXem, khoa]));
                      }}
                    >
                      {mo ? t("repoWs.agentTuRepo.an", "Ẩn nội dung") : t("repoWs.agentTuRepo.doc", "Đọc nội dung tệp")}
                    </Button>
                    {mo && (
                      <pre data-testid="atr-noi-dung-tep" className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-2 text-[11px]">
                        {m.noiDungHienThi}
                      </pre>
                    )}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {!m.daTinCay && (
                    <Button type="button" size="sm" data-testid="atr-tin-cay" disabled={!xem || gui} onClick={() => onTinCay(m.ten, m.bam)}>
                      {t("repoWs.agentTuRepo.tinCay", "Tin cậy bản này")}
                    </Button>
                  )}
                  {!m.daTinCay && !xem && <span data-testid="atr-can-doc" className="self-center text-[11px] text-muted-foreground">{t("repoWs.agentTuRepo.canDoc", "Hãy đọc nội dung trước khi tin cậy.")}</span>}
                  <Button type="button" size="sm" variant="outline" data-testid="atr-go-tin" disabled={gui} onClick={() => onGoTinCay(m.ten)}>
                    {t("repoWs.agentTuRepo.goTin", "Gỡ tin cậy")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      {canhBao.length > 0 && (
        <section data-testid="atr-canh-bao">
          <h4 className="mb-1 text-xs font-semibold">{t("repoWs.agentTuRepo.biBo", "Tệp bị bỏ qua")}</h4>
          <ul className="space-y-0.5 text-[11px] text-muted-foreground">
            {canhBao.map((c, i) => (
              <li key={i} className="break-words">
                <span className="font-mono">{c.tep}</span> — <span className="font-mono">{c.ma}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4 className="mb-1 text-xs font-semibold">{t("repoWs.agentTuRepo.dungSan", "Dựng sẵn")}</h4>
        <ul className="space-y-0.5 text-xs">
          {dungSan.map((m) => (
            <li key={m.ten} data-testid="atr-dung-san" className="break-words">
              <span className="font-medium">{m.ten}</span> <span className="text-muted-foreground">— {m.moTa}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function BangAgentTuRepo({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [mo, setMo] = useState(false);
  const [dangGui, setDangGui] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const q = trpc.aiAgent.dinhNghiaDanhSach.useQuery({ projectId }, { enabled: mo && !!projectId });
  const xacNhanM = trpc.aiAgent.xacNhanDinhNghia.useMutation();
  const goM = trpc.aiAgent.goTinCayDinhNghia.useMutation();
  const lamMoi = () => utils.aiAgent.dinhNghiaDanhSach.invalidate();
  const d = q.data;
  return (
    <Dialog open={mo} onOpenChange={setMo}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" data-testid="atr-mo" title={t("repoWs.agentTuRepo.tieuDe", "Agent từ repo")} aria-label={t("repoWs.agentTuRepo.tieuDe", "Agent từ repo")}>
          <Bot className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("repoWs.agentTuRepo.tieuDe", "Agent từ repo")}</DialogTitle>
          <DialogDescription>{t("repoWs.agentTuRepo.moTaMan", "Đọc và xác nhận định nghĩa agent nằm trong dự án {{duAn}}.", { duAn: projectId })}</DialogDescription>
        </DialogHeader>
        <NoiDungBangAgentTuRepo
          muc={(d?.muc ?? []) as MucAgentUI[]}
          canhBao={d?.canhBao ?? []}
          dangTai={q.isLoading}
          biTuChoi={d?.ok === false && d.note === "PERMISSION_DENIED"}
          dangGui={dangGui}
          onTinCay={(ten, bam) => {
            setDangGui(ten);
            xacNhanM
              .mutateAsync({ projectId, ten, bam })
              .then((r) => {
                if (r.ok) toast.success(t("repoWs.agentTuRepo.daXacNhan", "Đã tin cậy agent “{{ten}}”.", { ten }));
                else toast.error(cauNoteAgentTuRepo(r.note, t as unknown as HamT));
              })
              .catch((e) => toast.error(mapTrpcError(e)))
              .finally(() => {
                setDangGui(null);
                void lamMoi();
              });
          }}
          onGoTinCay={(ten) => {
            setDangGui(ten);
            goM
              .mutateAsync({ projectId, ten })
              .then((r) => {
                if (r.ok) toast.success(t("repoWs.agentTuRepo.daGo", "Đã gỡ tin cậy “{{ten}}”.", { ten }));
                else toast.error(cauNoteAgentTuRepo(r.note, t as unknown as HamT));
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
