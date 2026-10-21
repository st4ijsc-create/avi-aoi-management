/**
 * ★★ AI Local Đợt 8.3 — LỊCH SỬ + DÒNG THỜI GIAN lượt chạy của Flow Studio.
 *
 * `flow.lichSuChay` (danh sách lượt) + `flow.dongThoiGian` (bước + sự kiện của lượt đang xem). Lượt còn sống
 * (`dang-chay` / `cho-duyet`) ⇒ tự làm mới; trạng thái từng node đẩy ngược lên trang để tô canvas.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { fmtDateTime } from "@/lib/fmtDateTime";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, GitCompare, Loader2, RefreshCw } from "lucide-react";
import RunCompare from "./RunCompare";
import { MAU_TRANG_THAI, luotDangSong, maLoiChuGiai, trangThaiTheoNut, vetModelCuaBuoc, type VetModelClient } from "@/lib/flowStudio";

/** Đợt 9 — model THỰC chạy của một lần gọi AI trong bước + nhãn dự phòng (kèm lý do khi khe nặng đang bận). */
export function VetModelHuy({ nodeId, vet }: { nodeId: string; vet: VetModelClient[] }) {
  const { t } = useTranslation();
  if (!vet.length) return null;
  return (
    <div className="flex flex-col gap-1" data-testid={`buoc-model-${nodeId}`}>
      {vet.map((m, i) => (
        <div key={i} className="flex items-center gap-1 flex-wrap text-[11px]" title={m.lyDo.join("; ")}>
          <span className="text-muted-foreground">{t("flowStudio.chay.model")}:</span>
          <span className="font-mono" data-testid={`model-thuc-${nodeId}`}>{m.model ?? t("flowStudio.chay.modelMacDinh")}</span>
          <span className="text-muted-foreground">· {m.vaiTro}</span>
          {m.duPhong && (
            <Badge variant="outline" className="text-[10px] bg-warning/15 text-warning border-warning/40" data-testid={`du-phong-${nodeId}`} data-khe-ban={m.kheBan ? "1" : "0"}>
              {m.kheBan ? t("flowStudio.chay.duPhongKheBan") : t("flowStudio.chay.duPhong")}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

/** Chú giải cho 3 lỗi node hay gặp (nhận diện theo MÃ ổn định `error.ma`), trỏ tới tài liệu vận hành. */
function ChuGiaiLoi({ loi }: { loi: unknown }) {
  const { t } = useTranslation();
  const ma = maLoiChuGiai(loi);
  if (!ma) return null;
  const noiDung =
    ma === "BI_MAT_CHUA_KHAI_HOST"
      ? t("flowStudio.chay.chuGiai.BI_MAT_CHUA_KHAI_HOST")
      : ma === "CHU_LUOT_KHONG_XAC_DINH"
        ? t("flowStudio.chay.chuGiai.CHU_LUOT_KHONG_XAC_DINH")
        : ma === "CAY_LUOT_DAY"
          ? t("flowStudio.chay.chuGiai.CAY_LUOT_DAY")
          : ma === "ITEM_GOI_CON_QUA_NHIEU"
            ? t("flowStudio.chay.chuGiai.ITEM_GOI_CON_QUA_NHIEU")
            : t("flowStudio.chay.chuGiai.DICH_NOI_BO");
  return (
    <p className="text-[11px] text-muted-foreground" data-testid={`chu-giai-${ma}`}>
      {noiDung} <span className="font-mono">docs/AI_FLOW_SECURITY_OPERATIONS.md</span>
    </p>
  );
}

function NhanTrangThai({ tt }: { tt: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={`text-[10px] ${MAU_TRANG_THAI[tt] ?? ""}`} data-testid={`trang-thai-${tt}`}>
      {t(`flowStudio.trangThai.${tt}`, { defaultValue: tt })}
    </Badge>
  );
}

function khoangMs(a: string | Date | null | undefined, b: string | Date | null | undefined): string {
  if (!a || !b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function KhoiJson({ nhan, v }: { nhan: string; v: unknown }) {
  const [mo, setMo] = useState(false);
  if (v === null || v === undefined) return null;
  const s = JSON.stringify(v, null, 2);
  const ngan = s.length > 160 ? `${s.replace(/\s+/g, " ").slice(0, 160)}…` : s.replace(/\s+/g, " ");
  return (
    <div className="text-[11px]">
      <button type="button" className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setMo(!mo)}>
        {mo ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-medium">{nhan}</span>
        {!mo && <span className="font-mono truncate max-w-[220px]">{ngan}</span>}
      </button>
      {mo && <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap break-all">{s}</pre>}
    </div>
  );
}

export interface RunTimelineProps {
  flowId: string;
  runId: string | null;
  onChonRun: (id: string) => void;
  tenNut: (nodeId: string) => string;
  /** Trạng thái từng node của lượt đang xem + phiên bản của lượt (trang chuyển canvas sang đúng phiên bản ấy). */
  onTrangThai: (m: Record<string, string>, version: number | null) => void;
}

export default function RunTimeline({ flowId, runId, onChonRun, tenNut, onTrangThai }: RunTimelineProps) {
  const { t } = useTranslation();
  const lichSu = trpc.flow.lichSuChay.useQuery(
    { flowId, gioiHan: 30 },
    { refetchInterval: (q) => ((q.state.data ?? []).some((r) => luotDangSong(r.status)) ? 2000 : false) },
  );
  const dtg = trpc.flow.dongThoiGian.useQuery(
    { runId: runId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: !!runId, refetchInterval: (q) => (luotDangSong(q.state.data?.run.status) ? 1500 : false) },
  );
  const [moSuKien, setMoSuKien] = useState(false);
  const [soSanh, setSoSanh] = useState(false);

  const trangThaiRun = dtg.data?.run.status;
  useEffect(() => {
    onTrangThai(dtg.data && runId ? trangThaiTheoNut(dtg.data.buoc) : {}, dtg.data && runId ? dtg.data.run.version : null);
    // lich su cung lam moi khi luot doi trang thai
    if (trangThaiRun) void lichSu.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dtg.data, runId, trangThaiRun]);

  return (
    <div className="space-y-4" data-testid="run-timeline">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">{t("flowStudio.chay.lichSu")}</h3>
          <Button type="button" variant={soSanh ? "secondary" : "ghost"} size="sm" className="h-7 ml-auto mr-1 text-xs" data-testid="nut-so-sanh-luot" disabled={(lichSu.data?.length ?? 0) < 2} onClick={() => setSoSanh(!soSanh)}>
            <GitCompare className="h-3.5 w-3.5 mr-1" />
            {t("flowStudio.soSanh.nut")}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={t("flowStudio.chay.lamMoi")} onClick={() => { void lichSu.refetch(); void dtg.refetch(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        {lichSu.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {lichSu.data && lichSu.data.length === 0 && <p className="text-xs text-muted-foreground">{t("flowStudio.chay.chuaCoLuot")}</p>}
        <ul className="space-y-1 max-h-48 overflow-auto" data-testid="lich-su-chay">
          {(lichSu.data ?? []).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onChonRun(r.id)}
                className={`w-full text-left rounded border px-2 py-1 flex items-center gap-2 text-xs hover:bg-muted ${r.id === runId ? "border-primary bg-muted" : ""}`}
              >
                <NhanTrangThai tt={r.status} />
                <span className="font-mono">v{r.version}</span>
                <span className="text-muted-foreground truncate">{fmtDateTime(r.startedAt)}</span>
                <span className="ml-auto text-muted-foreground">{khoangMs(r.startedAt, r.finishedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {soSanh && lichSu.data && <RunCompare lichSu={lichSu.data} runIdMacDinh={runId} tenNut={tenNut} />}

      {runId && !soSanh && (
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">{t("flowStudio.chay.dongThoiGian")}</h3>
            {dtg.data && <NhanTrangThai tt={dtg.data.run.status} />}
            {luotDangSong(trangThaiRun) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {dtg.error && <p className="text-xs text-destructive">{mapTrpcError(dtg.error)}</p>}
          {dtg.data && (
            <>
              <div className="text-[11px] text-muted-foreground space-y-0.5">
                <div className="font-mono break-all">{dtg.data.run.id}</div>
                <div>
                  {t("flowStudio.chay.phienBan")} v{dtg.data.run.version} · {t("flowStudio.chay.kichHoat")} {dtg.data.run.triggerKind} · {fmtDateTime(dtg.data.run.startedAt)} ·{" "}
                  {khoangMs(dtg.data.run.startedAt, dtg.data.run.finishedAt)}
                </div>
              </div>
              {dtg.data.run.error != null && <KhoiJson nhan={t("flowStudio.chay.loi")} v={dtg.data.run.error} />}
              <ChuGiaiLoi loi={dtg.data.run.error} />
              <ol className="space-y-2" data-testid="cac-buoc">
                {dtg.data.buoc.map((b) => (
                  <li key={b.id} className="rounded border p-2 space-y-1" data-testid={`buoc-${b.nodeId}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <NhanTrangThai tt={b.status} />
                      <span className="text-xs font-medium truncate">{tenNut(b.nodeId)}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {t("flowStudio.chay.lanLanThu", { lan: b.lan, lanThu: b.lanThu })}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{khoangMs(b.startedAt, b.finishedAt)}</span>
                    </div>
                    <VetModelHuy nodeId={b.nodeId} vet={vetModelCuaBuoc(dtg.data.suKien, b.nodeId, b.lan)} />
                    <KhoiJson nhan={t("flowStudio.chay.dauVao")} v={b.input} />
                    <KhoiJson nhan={t("flowStudio.chay.dauRa")} v={b.output} />
                    {b.error != null && (
                      <div className="text-destructive">
                        <KhoiJson nhan={t("flowStudio.chay.loi")} v={b.error} />
                        <ChuGiaiLoi loi={b.error} />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <div>
                <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setMoSuKien(!moSuKien)}>
                  {moSuKien ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {t("flowStudio.chay.suKien", { n: dtg.data.suKien.length })}
                </button>
                {moSuKien && (
                  <ul className="mt-1 space-y-1">
                    {dtg.data.suKien.map((e) => (
                      <li key={e.id} className="text-[11px] font-mono">
                        <span className="text-muted-foreground">{fmtDateTime(e.at)}</span> <span className="font-medium">{e.kind}</span>{" "}
                        <span className="break-all">{e.payload == null ? "" : JSON.stringify(e.payload).slice(0, 200)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
