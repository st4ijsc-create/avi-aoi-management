/**
 * R1 (kế hoạch AI Local 2026-09-22 §4) — Training Studio "Eval" tab: EVAL THẬT.
 *
 * Trước R1 tab này chỉ xem mẫu chunk (không điểm chất lượng nào). Nay: chọn corpus + bộ câu hỏi vàng
 * (`knowledge/studio-golden/*.jsonl`) → `kbStudio.evalCorpus` chạy truy hồi qua ĐÚNG đường sản xuất
 * và chấm bằng máy (server/services/kbStudioEval.ts) → bảng câu hỏi × đúng/sai × nguồn, đồ thị điểm
 * theo lượt có đánh dấu lượt đứng sau một lần nạp mới. Xem mẫu chunk giữ lại ở cuối, gấp gọn.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Play } from "lucide-react";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BangKetQuaEval, type LuotChiTiet } from "./BangKetQuaEval";
import { chuoiBieuDo, phanTram, type TongHopEval } from "./evalTabLogic";

/** Ba màu đã qua `validate_palette.js` (dataviz) cho cả nền tối (mặc định) lẫn `.light`. */
const MAU_WRAP =
  "[--ev1:#00a1a9] [--ev2:#7575e9] [--ev3:#cb7f00] [.light_&]:[--ev1:#0086a8] [.light_&]:[--ev2:#5e4bc3] [.light_&]:[--ev3:#be7200]";

function XemMauChunk({ corpus }: { corpus: string }) {
  const { t } = useTranslation();
  const q = trpc.kbStudio.corpusPreview.useQuery({ corpus, limit: 20 }, { enabled: !!corpus });
  if (q.isLoading) return <Skeleton className="h-20 w-full" />;
  if (q.isError)
    return <EmptyState variant="error" compact title={t("kbStudio.eval.loadError")} description={mapTrpcError(q.error)} />;
  if (!q.data || q.data.sample.length === 0)
    return <EmptyState variant="no-data" compact title={t("kbStudio.eval.empty")} description={t("kbStudio.eval.desc")} />;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          <span className="text-muted-foreground">{t("kbStudio.eval.totalChunks")}: </span>
          <span className="font-medium">{q.data.totalChunks}</span>
        </span>
        <span>
          <span className="text-muted-foreground">{t("kbStudio.eval.distinctSources")}: </span>
          <span className="font-medium">{q.data.distinctSources}</span>
        </span>
      </div>
      <div className="space-y-2 max-h-[420px] overflow-y-auto">
        {q.data.sample.map((chunk) => (
          <Card key={chunk.id} className="bg-muted/30">
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                <Badge variant="outline">{chunk.sourceType}</Badge>
                <span className="truncate max-w-[280px]" title={chunk.sourceRef}>
                  {chunk.sourceRef}
                </span>
                <span>#{chunk.chunkIndex}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{chunk.text}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function EvalTab() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [corpus, setCorpus] = useState<string>("");
  const [boVang, setBoVang] = useState<string>("");
  const [duongOng, setDuongOng] = useState(true);
  const [chonLuot, setChonLuot] = useState<number | null>(null);
  const [chiSai, setChiSai] = useState(false);
  const [giay, setGiay] = useState(0);

  const corporaQuery = trpc.kbStudio.listCorpora.useQuery();
  const setsQuery = trpc.kbStudio.listGoldenSets.useQuery();
  const runsQuery = trpc.kbStudio.listEvalRuns.useQuery({ corpus }, { enabled: !!corpus });
  const corpora = corporaQuery.data?.corpora ?? [];
  const sets = setsQuery.data?.sets ?? [];
  const runs = runsQuery.data?.runs ?? [];

  // Bộ vàng mặc định = bộ trùng tên corpus (nếu có) — đổi corpus thì chọn lại.
  useEffect(() => {
    setBoVang(sets.some((s) => s.ten === corpus) ? corpus : "");
    setChonLuot(null);
  }, [corpus, setsQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const idLuot = chonLuot ?? runs[0]?.id ?? null;
  const luotQuery = trpc.kbStudio.getEvalRun.useQuery(
    { id: idLuot ?? 0, corpus },
    { enabled: !!corpus && idLuot !== null },
  );

  const run = trpc.kbStudio.evalCorpus.useMutation({
    onSuccess: async (row) => {
      setChonLuot(row.id);
      await utils.kbStudio.listEvalRuns.invalidate({ corpus });
    },
  });

  useEffect(() => {
    if (!run.isPending) return;
    const t0 = Date.now();
    setGiay(0);
    const h = setInterval(() => setGiay(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(h);
  }, [run.isPending]);

  const diemBieuDo = useMemo(() => chuoiBieuDo(runs), [runs]);
  const boDangChon = sets.find((s) => s.ten === boVang);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("kbStudio.eval.title")}</CardTitle>
          <CardDescription>{t("kbStudio.eval.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={corpus} onValueChange={setCorpus}>
              <SelectTrigger aria-label={t("kbStudio.eval.corpusSelectAria")} className="w-64">
                <SelectValue placeholder={t("kbStudio.eval.corpusPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {corpora.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name} · {c.chunkCount}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={boVang} onValueChange={setBoVang} disabled={!corpus}>
              <SelectTrigger aria-label={t("kbStudio.eval.goldenSelectAria")} className="w-64" data-testid="eval-chon-bo-vang">
                <SelectValue placeholder={t("kbStudio.eval.goldenPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {sets.map((s) => (
                  <SelectItem key={s.ten} value={s.ten}>
                    {s.ten} · {t("kbStudio.eval.goldenCount", { trong: s.soCauTrong, ngoai: s.soCauNgoai })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm" title={t("kbStudio.eval.pipelineHint")}>
              <Checkbox checked={duongOng} onCheckedChange={(v) => setDuongOng(v === true)} />
              {t("kbStudio.eval.pipelineToggle")}
            </label>
            <Button
              size="sm"
              data-testid="eval-chay"
              disabled={!corpus || !boVang || run.isPending || (boDangChon?.soDongLoi ?? 0) > 0}
              onClick={() => run.mutate({ corpus, goldenSet: boVang, pipeline: duongOng })}
            >
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              {run.isPending ? t("kbStudio.eval.running", { giay }) : t("kbStudio.eval.run.button")}
            </Button>
          </div>

          {corpus && sets.length > 0 && !sets.some((s) => s.ten === corpus) ? (
            <Alert data-testid="eval-khong-co-bo-vang">
              <AlertDescription>{t("kbStudio.eval.noGoldenForCorpus", { corpus })}</AlertDescription>
            </Alert>
          ) : null}
          {boDangChon && boDangChon.soDongLoi > 0 ? (
            <Alert variant="destructive">
              <AlertDescription>{t("kbStudio.eval.goldenBroken", { n: boDangChon.soDongLoi })}</AlertDescription>
            </Alert>
          ) : null}
          {run.isError ? (
            <Alert variant="destructive" data-testid="eval-loi-chay">
              <AlertDescription>{mapTrpcError(run.error)}</AlertDescription>
            </Alert>
          ) : null}

          {!corpus ? (
            <EmptyState variant="no-config" compact title={t("kbStudio.eval.corpusRequired")} description={t("kbStudio.eval.desc")} />
          ) : runsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : runsQuery.data && !runsQuery.data.tableAvailable ? (
            <EmptyState variant="no-config" compact title={t("kbStudio.eval.tableUnavailable")} />
          ) : runs.length === 0 ? (
            <EmptyState variant="no-data" compact title={t("kbStudio.eval.noRuns")} description={t("kbStudio.eval.noRunsHint")} />
          ) : (
            <>
              {diemBieuDo.length > 1 ? (
                <div className={`h-56 w-full ${MAU_WRAP}`} data-testid="eval-bieu-do">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={diemBieuDo} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="nhan" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} width={48} />
                      <Tooltip formatter={(v) => (v === null || v === undefined ? "—" : `${v} %`)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {diemBieuDo
                        .filter((d) => d.sauNap)
                        .map((d) => (
                          <ReferenceLine key={`nap-${d.id}`} x={d.nhan} strokeDasharray="4 3" className="stroke-muted-foreground" label={{ value: t("kbStudio.eval.chart.ingest"), fontSize: 10, position: "insideTopLeft" }} />
                        ))}
                      <Line type="monotone" dataKey="trungNguon" name={t("kbStudio.eval.chart.hit")} stroke="var(--ev1)" strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="dapAnNguCanh" name={t("kbStudio.eval.chart.answer")} stroke="var(--ev2)" strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="duongOng" name={t("kbStudio.eval.chart.pipeline")} stroke="var(--ev3)" strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="eval-bang-luot">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-1 pr-2">{t("kbStudio.eval.runs.col.run")}</th>
                      <th className="py-1 pr-2">{t("kbStudio.eval.runs.col.time")}</th>
                      <th className="py-1 pr-2">{t("kbStudio.eval.runs.col.corpus")}</th>
                      <th className="py-1 pr-2">{t("kbStudio.eval.chart.hit")}</th>
                      <th className="py-1 pr-2">{t("kbStudio.eval.chart.answer")}</th>
                      <th className="py-1 pr-2">{t("kbStudio.eval.chart.pipeline")}</th>
                      <th className="py-1">{t("kbStudio.eval.runs.col.duration")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => {
                      const th = (r.tongHop ?? null) as TongHopEval | null;
                      const dangChon = r.id === idLuot;
                      return (
                        <tr
                          key={r.id}
                          className={`border-b cursor-pointer hover:bg-muted/40 ${dangChon ? "bg-muted/60" : ""}`}
                          onClick={() => setChonLuot(r.id)}
                          data-luot={r.id}
                        >
                          <td className="py-1 pr-2 font-mono">
                            #{r.id} {r.boVang !== corpus ? <Badge variant="outline" className="ml-1 text-[10px]">{r.boVang}</Badge> : null}
                          </td>
                          <td className="py-1 pr-2">{new Date(r.createdAt).toLocaleString()}</td>
                          <td className="py-1 pr-2 tabular-nums">
                            {r.soChunk} / {r.soNguon}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">{r.trangThai === "xong" ? phanTram(th?.trungNguon) : t("kbStudio.eval.runs.notMeasured")}</td>
                          <td className="py-1 pr-2 tabular-nums">{phanTram(th?.dapAnNguCanh)}</td>
                          <td className="py-1 pr-2 tabular-nums">{r.tangDuongOng ? phanTram(th?.duongOng) : "—"}</td>
                          <td className="py-1 tabular-nums">{(r.msTong / 1000).toFixed(1)} s</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                <div className="text-sm font-medium">{t("kbStudio.eval.run.detail", { id: idLuot ?? "—" })}</div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={chiSai} onCheckedChange={(v) => setChiSai(v === true)} data-testid="eval-chi-sai" />
                  {t("kbStudio.eval.onlyWrong")}
                </label>
              </div>
              {luotQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : luotQuery.data ? (
                <BangKetQuaEval luot={luotQuery.data as unknown as LuotChiTiet} chiSai={chiSai} />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {corpus ? (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("kbStudio.eval.previewTitle")}</summary>
          <div className="pt-3">
            <XemMauChunk corpus={corpus} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default EvalTab;
