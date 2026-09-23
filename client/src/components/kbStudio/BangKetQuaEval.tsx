/**
 * R1 — phần TRÌNH BÀY một lượt eval: bảy ô tổng hợp + bảng câu hỏi × kết quả. Thuần props (không
 * tRPC) để lưới `renderToStaticMarkup` dựng cây thật. Ô không đo được hiện "—" kèm lý do, không "0 %".
 */
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { phanTram, diem, locCau, laCauSai, type KetQuaCau, type TongHopEval } from "./evalTabLogic";

export interface LuotChiTiet {
  id: number;
  trangThai: string;
  lyDo: string | null;
  k: number;
  nguong: number;
  tangDuongOng: boolean;
  soChunk: number;
  soNguon: number;
  embedModel: string | null;
  msTong: number;
  tongHop: unknown;
  ketQua: unknown;
}

function Dau({ v }: { v: boolean | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  return v ? (
    <span className="text-emerald-600 dark:text-emerald-400" data-dau="dung">✓</span>
  ) : (
    <span className="text-red-600 dark:text-red-400" data-dau="sai">✗</span>
  );
}

function O({ nhan, giaTri, goiY, testId }: { nhan: string; giaTri: string; goiY: string; testId: string }) {
  return (
    <div className="rounded-md border p-3 min-w-[9rem] flex-1" title={goiY} data-testid={testId}>
      <div className="text-xs text-muted-foreground">{nhan}</div>
      <div className="text-2xl font-semibold tabular-nums">{giaTri}</div>
    </div>
  );
}

export function BangKetQuaEval({ luot, chiSai }: { luot: LuotChiTiet; chiSai: boolean }) {
  const { t } = useTranslation();
  if (luot.trangThai !== "xong") {
    return (
      <Alert variant="destructive" data-testid="eval-khong-do">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          {t("kbStudio.eval.run.notMeasured")} {luot.lyDo ?? ""}
        </AlertDescription>
      </Alert>
    );
  }
  const th = (luot.tongHop ?? null) as TongHopEval | null;
  const ds = (Array.isArray(luot.ketQua) ? luot.ketQua : []) as KetQuaCau[];
  const hienThi = locCau(ds, chiSai);
  const soSai = ds.filter(laCauSai).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <O testId="eval-o-trung-nguon" nhan={t("kbStudio.eval.metric.hit", { k: luot.k })} giaTri={phanTram(th?.trungNguon)} goiY={t("kbStudio.eval.metric.hitHint")} />
        <O testId="eval-o-mrr" nhan="MRR" giaTri={th?.mrr == null ? "—" : th.mrr.toFixed(2)} goiY={t("kbStudio.eval.metric.mrrHint")} />
        <O testId="eval-o-qua-nguong" nhan={t("kbStudio.eval.metric.overThreshold", { nguong: luot.nguong })} giaTri={phanTram(th?.quaNguong)} goiY={t("kbStudio.eval.metric.overThresholdHint")} />
        <O testId="eval-o-dap-an" nhan={t("kbStudio.eval.metric.answer")} giaTri={phanTram(th?.dapAnNguCanh)} goiY={t("kbStudio.eval.metric.answerHint")} />
        <O
          testId="eval-o-duong-ong"
          nhan={t("kbStudio.eval.metric.pipeline")}
          giaTri={luot.tangDuongOng ? phanTram(th?.duongOng) : "—"}
          goiY={luot.tangDuongOng ? t("kbStudio.eval.metric.pipelineHint") : t("kbStudio.eval.metric.pipelineOff")}
        />
        <O
          testId="eval-o-duong-ong-bat-ky"
          nhan={t("kbStudio.eval.metric.pipelineAny")}
          giaTri={luot.tangDuongOng ? phanTram(th?.duongOngBatKy) : "—"}
          goiY={luot.tangDuongOng ? t("kbStudio.eval.metric.pipelineAnyHint") : t("kbStudio.eval.metric.pipelineOff")}
        />
        <O testId="eval-o-tu-choi" nhan={t("kbStudio.eval.metric.reject", { n: th?.soCauNgoai ?? 0 })} giaTri={phanTram(th?.tuChoiDung)} goiY={t("kbStudio.eval.metric.rejectHint")} />
      </div>

      <div className="text-xs text-muted-foreground" data-testid="eval-dong-meta">
        {t("kbStudio.eval.run.meta", {
          cau: th?.soCau ?? ds.length,
          chunk: luot.soChunk,
          nguon: luot.soNguon,
          model: luot.embedModel ?? "—",
          giay: (luot.msTong / 1000).toFixed(1),
        })}
      </div>

      {th && th.soCauHong > 0 ? (
        <Alert data-testid="eval-cau-hong">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{t("kbStudio.eval.run.broken", { n: th.soCauHong })}</AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="eval-bang-cau" data-so-sai={soSai}>
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">{t("kbStudio.eval.col.question")}</th>
              <th className="py-1.5 pr-2">{t("kbStudio.eval.col.rank")}</th>
              <th className="py-1.5 pr-2">{t("kbStudio.eval.col.score")}</th>
              <th className="py-1.5 pr-2">{t("kbStudio.eval.col.threshold")}</th>
              <th className="py-1.5 pr-2">{t("kbStudio.eval.col.answer")}</th>
              <th className="py-1.5 pr-2">{t("kbStudio.eval.col.pipeline")}</th>
              <th className="py-1.5">{t("kbStudio.eval.col.top1")}</th>
            </tr>
          </thead>
          <tbody>
            {hienThi.map((k) => (
              <tr key={k.id} className="border-b align-top" data-cau={k.id} data-sai={laCauSai(k) ? "1" : "0"}>
                <td className="py-1.5 pr-2 font-mono text-xs whitespace-nowrap">
                  {k.id}
                  {k.loai === "ngoai" ? (
                    <Badge variant="outline" className="ml-1 text-[10px]">{t("kbStudio.eval.outOfCorpus")}</Badge>
                  ) : null}
                  {k.de === "hong" ? (
                    <Badge variant="destructive" className="ml-1 text-[10px]">{t("kbStudio.eval.brokenBadge")}</Badge>
                  ) : k.de === "vang-tep" ? (
                    <Badge variant="secondary" className="ml-1 text-[10px]">{t("kbStudio.eval.missingFileBadge")}</Badge>
                  ) : null}
                </td>
                <td className="py-1.5 pr-2">{k.cauHoi}</td>
                <td className="py-1.5 pr-2 tabular-nums">
                  {k.loai === "ngoai" ? "—" : k.hangNguon === null ? <Dau v={false} /> : `${k.hangNguon}/${luot.k}`}
                </td>
                <td className="py-1.5 pr-2 tabular-nums">{diem(k.loai === "ngoai" ? k.top1?.score : k.diemNguon)}</td>
                <td className="py-1.5 pr-2">
                  <Dau v={k.loai === "ngoai" ? k.tuChoiDung : k.hangNguon === null ? false : k.quaNguong} />
                </td>
                <td className="py-1.5 pr-2">
                  <Dau v={k.dapAnNguCanh} />
                </td>
                <td
                  className="py-1.5 pr-2 whitespace-nowrap"
                  title={(k.trichDan ?? []).map((c) => `${c.studio ? "★ " : ""}${c.sourcePath} · ${diem(c.score)}`).join("\n")}
                >
                  <Dau v={k.duongOng} />
                  {k.duongOng === false && k.duongOngBatKy === true ? (
                    <Badge variant="secondary" className="ml-1 text-[10px]" data-ban-he-thong>
                      {t("kbStudio.eval.systemCopyBadge")}
                    </Badge>
                  ) : null}
                </td>
                <td className="py-1.5 text-xs text-muted-foreground truncate max-w-[16rem]" title={k.top1?.sourceRef}>
                  {k.top1 ? `${k.top1.sourceRef} · ${diem(k.top1.score)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
