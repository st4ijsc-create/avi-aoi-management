/**
 * R3 (kế hoạch AI Local 2026-09-22 §4) — tab "Hồ sơ model" của Training Studio, thay panel "Xây dựng mô
 * hình" vô hiệu (nút "Bắt đầu tinh chỉnh" bị khoá). Hiện thứ THẬT SỰ đang phục vụ và thứ đã ĐO về nó:
 * `kbStudio.hoSoModel` (server/services/ai/hoSoModelStudio.ts) — llama-server /props · .env · hồ sơ router
 * · sổ đo lượt B7 · báo cáo đo M/H/dự án. Ô không có dữ liệu hiện "—" kèm lý do, không bao giờ "0".
 *
 * Tinh chỉnh LoRA giữ ở dạng GHI CHÚ (không nút vô hiệu): G9 (audit 2026-09-21) đã kết luận bằng số rằng
 * LoRA không chữa lỗi suy luận; mở lại khi có lớp lỗi quy ước repo đo được.
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle, Info } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/EmptyState";
import { mapTrpcError } from "@/lib/trpcErrors";
import type { HoSoModel } from "../../../../server/services/ai/hoSoModelStudio";

const so = (x: number | null | undefined, donVi = "") => (x === null || x === undefined ? "—" : `${x.toLocaleString()}${donVi}`);

function Dong({ nhan, giaTri, testId }: { nhan: string; giaTri: string; testId?: string }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0" data-testid={testId}>
      <span className="text-muted-foreground">{nhan}</span>
      <span className="font-medium text-right break-all">{giaTri}</span>
    </div>
  );
}

export function HoSoModelView({ hs }: { hs: HoSoModel }) {
  const { t } = useTranslation();
  const d = hs.dangPhucVu;
  return (
    <div className="space-y-4">
      {hs.lech.length > 0 ? (
        <Alert variant="destructive" data-testid="hoso-lech">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-0.5">
              {hs.lech.map((m) => (
                <li key={m}>{t(`kbStudio.hoSo.lech.${m}`)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("kbStudio.hoSo.dangPhucVu")}</CardTitle>
            <CardDescription>{t("kbStudio.hoSo.nguonProps")}</CardDescription>
          </CardHeader>
          <CardContent>
            {d.trangThai === "ok" ? (
              <>
                <Dong testId="hoso-model-that" nhan={t("kbStudio.hoSo.modelFile")} giaTri={d.modelFile} />
                <Dong nhan={t("kbStudio.hoSo.ctxSlot")} giaTri={`${so(d.ctxMoiSlot)} × ${so(d.soSlot)}`} />
                <Dong nhan={t("kbStudio.hoSo.banDung")} giaTri={d.banDung ?? "—"} />
              </>
            ) : (
              <p className="text-sm text-destructive" data-testid="hoso-khong-lien-lac">
                {t(`kbStudio.hoSo.trangThai.${d.trangThai}`, { lyDo: d.lyDo })}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("kbStudio.hoSo.cauHinh")}</CardTitle>
            <CardDescription>{t("kbStudio.hoSo.nguonEnv")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Dong nhan={t("kbStudio.hoSo.modelKhai")} giaTri={hs.cauHinh.modelKhai ?? "—"} />
            <Dong nhan={t("kbStudio.hoSo.tranCtx")} giaTri={so(hs.cauHinh.ggufMaxCtx)} />
            <Dong nhan={t("kbStudio.hoSo.nganSachNghi")} giaTri={so(hs.cauHinh.nganSachNghi, " tok")} />
            <Dong nhan={t("kbStudio.hoSo.sampling")} giaTri={hs.cauHinh.hoSoSampling} />
            <Dong nhan={t("kbStudio.hoSo.modelNhung")} giaTri={hs.cauHinh.modelNhung ?? "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("kbStudio.hoSo.router")}</CardTitle>
            <CardDescription>{t("kbStudio.hoSo.nguonRouter")}</CardDescription>
          </CardHeader>
          <CardContent>
            {hs.hoSoRouter ? (
              <>
                <Dong nhan={t("kbStudio.hoSo.hoSoKhop")} giaTri={hs.hoSoRouter.label} />
                <Dong
                  testId="hoso-router-nguon"
                  nhan={t("kbStudio.hoSo.nguonNguong")}
                  giaTri={
                    hs.hoSoRouter.thresholdsInheritedFrom
                      ? t("kbStudio.hoSo.thuaKe", { tu: hs.hoSoRouter.thresholdsInheritedFrom })
                      : t(`kbStudio.hoSo.provenance.${hs.hoSoRouter.provenance}`)
                  }
                />
                <Dong nhan={t("kbStudio.hoSo.doNgay")} giaTri={hs.hoSoRouter.measuredOn} />
                <Dong
                  nhan={t("kbStudio.hoSo.nguong")}
                  giaTri={`≤${hs.hoSoRouter.easyMaxChars} / >${hs.hoSoRouter.hardMinChars} / <${hs.hoSoRouter.latencyPinMs} ms`}
                />
                {hs.hoSoRouter.needsLocalMeasurement ? (
                  <p className="mt-2 flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {t("kbStudio.hoSo.canDoTaiCho")}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("kbStudio.hoSo.soDo")}</CardTitle>
            <CardDescription>{t("kbStudio.hoSo.nguonSoDo")}</CardDescription>
          </CardHeader>
          <CardContent>
            {hs.soDoSong ? (
              <>
                <Dong testId="hoso-luot" nhan={t("kbStudio.hoSo.luot")} giaTri={`${so(hs.soDoSong.luot)} · ${t("kbStudio.hoSo.loi", { n: hs.soDoSong.loi })}`} />
                <Dong nhan={t("kbStudio.hoSo.coDoNghi")} giaTri={`${so(hs.soDoSong.coDoNghi)} / ${so(hs.soDoSong.luot)}`} />
                <Dong nhan={t("kbStudio.hoSo.nghiTra")} giaTri={`${so(hs.soDoSong.nghiTB)} / ${so(hs.soDoSong.traTB)} tok`} />
                <Dong nhan={t("kbStudio.hoSo.tre")} giaTri={so(hs.soDoSong.treTrungVi, " ms")} />
                <Dong nhan={t("kbStudio.hoSo.theoModel")} giaTri={hs.soDoSong.theoModel.map((m) => `${m.model} (${m.luot})`).join(" · ") || "—"} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("kbStudio.hoSo.khongCoSoDo")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("kbStudio.hoSo.baoCao")}</CardTitle>
          <CardDescription>{t("kbStudio.hoSo.nguonBaoCao")}</CardDescription>
        </CardHeader>
        <CardContent>
          {hs.baoCaoDo === null ? (
            <p className="text-sm text-muted-foreground" data-testid="hoso-khong-bao-cao">{t("kbStudio.hoSo.khongCoBaoCao")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="hoso-bang-bao-cao">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-1 pr-2">{t("kbStudio.hoSo.cot.truc")}</th>
                    <th className="py-1 pr-2">{t("kbStudio.hoSo.cot.nhan")}</th>
                    <th className="py-1 pr-2">{t("kbStudio.hoSo.cot.luot")}</th>
                    <th className="py-1 pr-2">{t("kbStudio.hoSo.cot.dat")}</th>
                    <th className="py-1">{t("kbStudio.hoSo.cot.luc")}</th>
                  </tr>
                </thead>
                <tbody>
                  {hs.baoCaoDo.map((b) => (
                    <tr key={b.nhan} className="border-b" data-bao-cao={b.nhan}>
                      <td className="py-1 pr-2"><Badge variant="outline">{t(`kbStudio.hoSo.truc.${b.truc}`)}</Badge></td>
                      <td className="py-1 pr-2 font-mono">{b.nhan}</td>
                      <td className="py-1 pr-2 tabular-nums">{b.soLuot}</td>
                      <td className="py-1 pr-2 tabular-nums">{b.dat}/{b.tong} = {Math.round((100 * b.dat) / b.tong)} %</td>
                      <td className="py-1">{new Date(b.luc).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>{t("kbStudio.hoSo.lora")}</AlertDescription>
      </Alert>
    </div>
  );
}

export function ModelBuilderTab() {
  const { t } = useTranslation();
  const q = trpc.kbStudio.hoSoModel.useQuery(undefined, { refetchOnWindowFocus: false });
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("kbStudio.hoSo.title")}</CardTitle>
        <CardDescription>{t("kbStudio.hoSo.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : q.isError ? (
          <EmptyState variant="error" compact title={t("kbStudio.hoSo.loadError")} description={mapTrpcError(q.error)} actionLabel={t("common.retry", "Retry")} onAction={() => q.refetch()} />
        ) : q.data ? (
          <HoSoModelView hs={q.data as HoSoModel} />
        ) : null}
      </CardContent>
    </Card>
  );
}

export default ModelBuilderTab;
