/**
 * ★★ AI Local Đợt 8.3 — HỘP DUYỆT `/ai-flows/duyet`: các bước `nguoi.duyet` đang chờ (`flow.danhSachCho`).
 * Đồng ý / Từ chối + lý do ⇒ `flow.duyet`. Hai người bấm cùng lúc ⇒ máy chủ trả CONFLICT ⇒ báo "đã có người duyệt".
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageContainer, PageHeader } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { fmtDateTime } from "@/lib/fmtDateTime";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Check, Inbox, Loader2, X } from "lucide-react";

type Cho = { runId: string; nodeId: string };

export default function AIFlowApprovalsPage() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const ds = trpc.flow.danhSachCho.useQuery(undefined, { refetchInterval: 5000 });
  const [lyDo, setLyDo] = useState<Record<string, string>>({});
  const [dangGui, setDangGui] = useState<string | null>(null);
  const khoa = (c: Cho) => `${c.runId}:${c.nodeId}`;

  const duyet = trpc.flow.duyet.useMutation({
    onSuccess: (_r, v) => {
      toast.success(v.dongY ? t("flowStudio.duyet.daDongY") : t("flowStudio.duyet.daTuChoi"));
      void utils.flow.danhSachCho.invalidate();
    },
    onError: (e) => {
      if (e.data?.code === "CONFLICT") {
        toast.error(t("flowStudio.duyet.daCoNguoiDuyet"));
        void utils.flow.danhSachCho.invalidate();
      } else toastTrpcError(e);
    },
    onSettled: () => setDangGui(null),
  });

  const gui = (c: Cho, dongY: boolean) => {
    setDangGui(khoa(c));
    duyet.mutate({ runId: c.runId, nodeId: c.nodeId, dongY, lyDo: lyDo[khoa(c)]?.trim() || undefined });
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Inbox className="h-6 w-6" />}
          title={t("flowStudio.duyet.tieuDe")}
          description={t("flowStudio.duyet.moTa")}
          actions={
            <Link href="/ai-flows">
              <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />{t("flowStudio.duyet.veDanhSach")}</Button>
            </Link>
          }
        />
        {ds.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {ds.data && ds.data.length === 0 && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground" data-testid="hop-duyet-rong">{t("flowStudio.duyet.rong")}</CardContent></Card>
        )}
        <div className="grid gap-3 lg:grid-cols-2" data-testid="hop-duyet">
          {(ds.data ?? []).map((c) => {
            const k = khoa(c);
            return (
              <Card key={k} data-testid={`cho-${c.flowId}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{c.tieuDe || t("flowStudio.duyet.khongTieuDe")}</CardTitle>
                  <CardDescription className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span>{c.tenLuong ?? c.flowId} · v{c.version}</span>
                    <span className="font-mono">{c.nodeId}</span>
                    <span>{t("flowStudio.duyet.han")}: {c.expiresAt ? fmtDateTime(c.expiresAt) : t("flowStudio.duyet.khongHan")}</span>
                    {c.vaiTroDuyet && <Badge variant="outline" className="text-[10px]">{c.vaiTroDuyet}</Badge>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {c.noiDung && <p className="text-sm whitespace-pre-wrap">{c.noiDung}</p>}
                  <div className="text-xs text-muted-foreground">{t("flowStudio.duyet.soItem", { n: c.soItem })}</div>
                  {c.itemDau != null && (
                    <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-[11px] font-mono whitespace-pre-wrap break-all">{JSON.stringify(c.itemDau, null, 2)}</pre>
                  )}
                  <Textarea
                    className="text-sm min-h-[60px]"
                    placeholder={t("flowStudio.duyet.lyDo")}
                    value={lyDo[k] ?? ""}
                    onChange={(e) => setLyDo({ ...lyDo, [k]: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-2 items-center">
                    <Button size="sm" data-testid="nut-dong-y" disabled={dangGui === k} onClick={() => gui(c, true)}>
                      <Check className="h-4 w-4 mr-1" />
                      {t("flowStudio.duyet.dongY")}
                    </Button>
                    <Button size="sm" variant="destructive" data-testid="nut-tu-choi" disabled={dangGui === k} onClick={() => gui(c, false)}>
                      <X className="h-4 w-4 mr-1" />
                      {t("flowStudio.duyet.tuChoi")}
                    </Button>
                    <Link href={`/ai-flows/${encodeURIComponent(c.flowId)}?run=${c.runId}`} className="ml-auto text-xs underline text-muted-foreground">
                      {t("flowStudio.duyet.xemLuot")}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
