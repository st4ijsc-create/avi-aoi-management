/**
 * AI Local Đợt 5.2 — khung "Eval mã (A/B corpus)" trong tab Đánh giá của Training Studio.
 *
 * Câu hỏi nó trả lời: "nạp corpus này có làm MÃ tốt hơn hay tệ đi?" — bộ bài của bộ đo `codegen-chay-duoc`, mỗi bài
 * sinh hai lần (corpus TẮT / BẬT), máy chạy test chấm. Lượt chạy NỀN trên máy chủ; khung này chỉ bắt đầu / huỷ / đọc
 * tiến độ (hỏi lại 3 s khi còn lượt chạy). Kết luận cổng ("tụt" / "nâng" / "trong nhiễu") do MÁY CHỦ tính kèm biên
 * nhiễu ĐO ĐƯỢC — khung chỉ hiển thị, không tự suy. HAI THƯỚC (2026-10-17): cột "Bài có đoạn" là thước của kết luận
 * chính (chỉ bài nhánh BẬT nhận ≥ 1 đoạn); cột TẮT/BẬT/Chênh là thước TOÀN BỘ cũ, kết luận của nó in nhỏ dưới huy hiệu.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Play, Square } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { conDangChay, dauChenh, docTongHop, kieuHuyHieu } from "./evalMaLogic";

export function EvalMaPanel({ corpus }: { corpus: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [boBai, setBoBai] = useState("tasks-hard");
  const [soLap, setSoLap] = useState("1");
  const setsQ = trpc.kbStudio.listBoBaiMa.useQuery();
  const runsQ = trpc.kbStudio.danhSachEvalMa.useQuery(
    { corpus },
    { enabled: !!corpus, refetchInterval: (q) => (conDangChay((q.state.data?.runs ?? []) as Array<{ trangThai?: unknown }>) ? 3000 : false) },
  );
  const sets = setsQ.data?.sets ?? [];
  useEffect(() => {
    if (sets.length && !sets.some((s) => s.ten === boBai)) setBoBai(sets[0]!.ten);
  }, [sets, boBai]);

  const batDau = trpc.kbStudio.batDauEvalMa.useMutation({ onSuccess: () => utils.kbStudio.danhSachEvalMa.invalidate({ corpus }) });
  const huy = trpc.kbStudio.huyEvalMa.useMutation({ onSuccess: () => utils.kbStudio.danhSachEvalMa.invalidate({ corpus }) });
  const runs = runsQ.data?.runs ?? [];
  const batDuoc = setsQ.data?.batDuoc === true;
  const dangChayId = runsQ.data?.dangChay ?? setsQ.data?.dangChay ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("kbStudio.evalMa.title", "Eval mã — corpus BẬT / TẮT")}</CardTitle>
        <CardDescription>{t("kbStudio.evalMa.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!batDuoc && setsQ.isSuccess ? (
          <Alert>
            <AlertDescription>{t("kbStudio.evalMa.tat")}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={boBai} onValueChange={setBoBai}>
            <SelectTrigger className="w-56" aria-label={t("kbStudio.evalMa.boBaiAria", "Bộ bài")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sets.map((s) => (
                <SelectItem key={s.ten} value={s.ten}>
                  {s.ten} · {t("kbStudio.evalMa.soBai", { n: s.soBai, defaultValue: `${s.soBai} bài` })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={soLap} onValueChange={setSoLap}>
            <SelectTrigger className="w-28" aria-label={t("kbStudio.evalMa.soLapAria", "Số lần lặp")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["1", "2", "3"].map((n) => (
                <SelectItem key={n} value={n}>
                  × {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!batDuoc || !corpus || !boBai || batDau.isPending || !!dangChayId}
            onClick={() => batDau.mutate({ corpus, boBai, soLap: Number(soLap) })}
          >
            {batDau.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
            {t("kbStudio.evalMa.chay", "Chạy eval mã")}
          </Button>
          {dangChayId ? (
            <Button size="sm" variant="outline" disabled={huy.isPending} onClick={() => huy.mutate({ id: dangChayId })}>
              <Square className="mr-1 h-4 w-4" />
              {t("kbStudio.evalMa.huy", "Huỷ")}
            </Button>
          ) : null}
        </div>
        {batDau.error ? (
          <Alert variant="destructive">
            <AlertDescription>{mapTrpcError(batDau.error)}</AlertDescription>
          </Alert>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("kbStudio.evalMa.giaiThich")}</p>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("kbStudio.evalMa.chuaCo", "Chưa có lượt eval mã nào cho corpus này.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2">{t("kbStudio.evalMa.col.thoiDiem", "Thời điểm")}</th>
                  <th className="py-1 pr-2">{t("kbStudio.evalMa.col.boBai", "Bộ bài")}</th>
                  <th className="py-1 pr-2">{t("kbStudio.evalMa.col.tat", "TẮT")}</th>
                  <th className="py-1 pr-2">{t("kbStudio.evalMa.col.bat", "BẬT")}</th>
                  <th className="py-1 pr-2">{t("kbStudio.evalMa.col.chenh", "Chênh toàn bộ (biên)")}</th>
                  <th className="py-1 pr-2">{t("kbStudio.evalMa.col.tapCoDoan", "Bài có đoạn: TẮT → BẬT (chênh, biên)")}</th>
                  <th className="py-1 pr-2">{t("kbStudio.evalMa.col.ketLuan", "Kết luận")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  // Chỉ lượt `xong` mới có số A/B để đọc — `khong-do-duoc` có tổng hợp lưu để chẩn đoán nhưng KHÔNG được vẽ như kết quả.
                  const th = r.trangThai === "xong" ? docTongHop(r.tongHop) : null;
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="py-1 pr-2 whitespace-nowrap">{new Date(r.batDau).toLocaleString()}</td>
                      <td className="py-1 pr-2">
                        {r.boBai} × {r.soLap}
                        {th?.doiChung ? (
                          <Badge variant="outline" className="ml-1">
                            {t("kbStudio.evalMa.doiChung", "A/A đối chứng")}
                          </Badge>
                        ) : null}
                      </td>
                      {th ? (
                        <>
                          <td className="py-1 pr-2">
                            {th.tat.dat}/{th.n}
                            {th.tat.cut ? <span className="text-xs text-muted-foreground"> ({t("kbStudio.evalMa.cut", { n: th.tat.cut, defaultValue: `cụt ${th.tat.cut}` })})</span> : null}
                          </td>
                          <td className="py-1 pr-2">
                            {th.bat.dat}/{th.n}
                            {th.bat.cut ? <span className="text-xs text-muted-foreground"> ({t("kbStudio.evalMa.cut", { n: th.bat.cut, defaultValue: `cụt ${th.bat.cut}` })})</span> : null}
                          </td>
                          <td className="py-1 pr-2">
                            {dauChenh(th.chenh)} (±{th.nguongNhieu})
                          </td>
                          <td className="py-1 pr-2 whitespace-nowrap">
                            {th.tapCoDoan ? (
                              <>
                                {th.tapCoDoan.tat}/{th.tapCoDoan.n} → {th.tapCoDoan.bat}/{th.tapCoDoan.n} · {dauChenh(th.tapCoDoan.chenh)} (±{th.tapCoDoan.nguongNhieu})
                                <span className="text-xs text-muted-foreground">
                                  {" "}
                                  · {t("kbStudio.evalMa.soBai", { n: th.tapCoDoan.soBai, defaultValue: `${th.tapCoDoan.soBai} bài` })}
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">{t("kbStudio.evalMa.tapConCu", "— (lượt cũ, chưa có thước này)")}</span>
                            )}
                          </td>
                          <td className="py-1 pr-2">
                            <Badge variant={kieuHuyHieu(th.ketLuan)}>{t(`kbStudio.evalMa.ketLuan.${th.ketLuan}`)}</Badge>
                            {th.tapCoDoan ? (
                              <div className="text-xs text-muted-foreground">
                                {t("kbStudio.evalMa.toanBo", {
                                  kl: t(`kbStudio.evalMa.ketLuan.${th.ketLuanToanBo}`),
                                  defaultValue: `toàn bộ: ${th.ketLuanToanBo}`,
                                })}
                              </div>
                            ) : null}
                          </td>
                        </>
                      ) : (
                        <td className="py-1 pr-2" colSpan={5}>
                          {r.trangThai === "dang-chay" ? (
                            <span className="inline-flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {t("kbStudio.evalMa.dangChay", { pct: r.tienDo, defaultValue: `đang chạy ${r.tienDo} %` })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {t(`kbStudio.evalMa.trangThai.${r.trangThai}`, r.trangThai)}
                              {r.lyDo ? ` — ${r.lyDo}` : ""}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
