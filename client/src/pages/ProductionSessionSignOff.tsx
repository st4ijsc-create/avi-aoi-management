import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Shield, ShieldCheck, ShieldAlert, RefreshCw, FileCheck2, ArrowRightLeft, StickyNote } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import ShiftHandoverDialog from "@/components/ShiftHandoverDialog";

type SignOffTarget = { id: number; shiftDate: string | Date; operatorId: number };

export default function ProductionSessionSignOff() {
  const { t } = useTranslation();
  const [signTarget, setSignTarget] = useState<SignOffTarget | null>(null);
  const [password, setPassword] = useState("");
  const [verifyId, setVerifyId] = useState<number | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);

  const closedQ = trpc.productionSession.list.useQuery({ status: "closed", limit: 100 });
  const signedQ = trpc.productionSession.list.useQuery({ status: "signed_off", limit: 100 });
  const openQ = trpc.productionSession.list.useQuery({ status: "open", limit: 100 });
  const pausedQ = trpc.productionSession.list.useQuery({ status: "paused", limit: 100 });
  const liveSessions = [...(openQ.data ?? []), ...(pausedQ.data ?? [])];
  const verifyQ = trpc.productionSession.verifySignoff.useQuery(
    { id: verifyId ?? 0 },
    { enabled: !!verifyId },
  );

  const signOffMutation = trpc.productionSession.supervisorSignOff.useMutation({
    onSuccess: (res) => {
      toast.success(
        t(
          "sessionSignoff.signSuccess",
          "Đã ký duyệt phiên #{{id}} bằng {{algorithm}} (chữ ký: {{signature}})",
          {
            id: res.session.id,
            algorithm: res.signoff.algorithm,
            signature: res.signoff.signaturePreview,
          },
        ),
      );
      closedQ.refetch();
      signedQ.refetch();
      setSignTarget(null);
      setPassword("");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleConfirmSign = () => {
    if (!signTarget) return;
    if (password.trim().length < 4) {
      toast.error(
        t(
          "sessionSignoff.passwordRequired",
          "Vui lòng nhập lại mật khẩu để xác nhận chữ ký điện tử (21 CFR Part 11 §11.200)",
        ),
      );
      return;
    }
    signOffMutation.mutate({ id: signTarget.id, supervisorPasswordConfirmed: true });
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Shield className="h-6 w-6" />}
          title={t("sessionSignoff.title", "Ký duyệt phiên sản xuất (HMAC-SHA256)")}
          description={t(
            "sessionSignoff.description",
            "21 CFR Part 11 §11.70 — Chữ ký điện tử ràng buộc với bản ghi sản xuất, không thể tách rời.",
          )}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => setHandoverOpen(true)}>
                <ArrowRightLeft className="h-4 w-4 mr-2" />
                {t("handover.submit", "Bàn giao ca")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  closedQ.refetch();
                  signedQ.refetch();
                  openQ.refetch();
                  pausedQ.refetch();
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("common.refresh", "Làm mới")}
              </Button>
            </div>
          }
        />

        <Card className="border-info/50 bg-info/5">
          <CardContent className="flex items-start gap-4 pt-6">
            <Shield className="h-6 w-6 text-info flex-shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-info">{t("sessionSignoff.complianceTitle", "Tuân thủ 21 CFR Part 11")}</p>
              <p className="text-muted-foreground mt-1">
                {t(
                  "sessionSignoff.complianceBody",
                  "Mỗi chữ ký được tạo bằng HMAC-SHA256 trên payload phiên (sessionId, operatorId, closedAt, kpiSnapshot). Mọi sửa đổi sau ký sẽ phá vỡ chữ ký khi xác thực lại.",
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Live sessions + received handover notes (W4-E) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" /> {t("handover.liveTitle", "Phiên đang mở & bàn giao")}
            </CardTitle>
            <CardDescription>
              {t("handover.liveDesc", "{{count}} phiên đang mở/tạm dừng — ghi chú bàn giao hiển thị trên phiên nhận", {
                count: liveSessions.length,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {liveSessions.length > 0 ? (
              <div className="space-y-2">
                {liveSessions.map((s: any) => (
                  <div key={s.id} className="border rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">
                          {t("sessionSignoff.sessionNumber", "Phiên #{{id}}", { id: s.id })}
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{s.sessionCode}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("sessionSignoff.shift", "Ca")} {new Date(s.shiftDate).toLocaleDateString()} ·{" "}
                          <Badge variant="outline">{s.status}</Badge>
                          {s.handoverToSessionId && (
                            <span className="ml-2">
                              {t("handover.handedTo", "→ bàn giao cho phiên #{{id}}", { id: s.handoverToSessionId })}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setHandoverOpen(true)}>
                        <ArrowRightLeft className="h-4 w-4 mr-2" />
                        {t("handover.submit", "Bàn giao ca")}
                      </Button>
                    </div>
                    {s.handoverNotes && (
                      <div className="mt-2 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-sm">
                        <StickyNote className="h-4 w-4 mt-0.5 shrink-0 text-info" />
                        <span className="whitespace-pre-wrap">{s.handoverNotes}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("handover.noLive", "Không có phiên đang mở.")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sessionSignoff.pendingTitle", "Phiên chờ ký duyệt")}</CardTitle>
            <CardDescription>
              {t("sessionSignoff.pendingCount", "{{count}} phiên ở trạng thái closed", {
                count: closedQ.data?.length ?? 0,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {closedQ.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : closedQ.data && closedQ.data.length > 0 ? (
              <div className="space-y-2">
                {closedQ.data.map((s: any) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between border rounded-md p-3"
                  >
                    <div>
                      <div className="font-medium">
                        {t("sessionSignoff.sessionOperator", "Phiên #{{id}} — Operator {{operatorId}}", {
                          id: s.id,
                          operatorId: s.operatorId,
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("sessionSignoff.shift", "Ca")} {new Date(s.shiftDate).toLocaleDateString()} ·{" "}
                        {s.actualEnd
                          ? t("sessionSignoff.closedAgo", "Đóng {{ago}}", {
                              ago: formatDistanceToNow(new Date(s.actualEnd), { addSuffix: true }),
                            })
                          : t("sessionSignoff.notClosed", "Chưa đóng")}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setSignTarget(s)}>
                      <FileCheck2 className="h-4 w-4 mr-2" />
                      {t("sessionSignoff.signAction", "Ký duyệt")}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("sessionSignoff.noPending", "Không có phiên nào chờ ký.")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sessionSignoff.signedTitle", "Phiên đã ký")}</CardTitle>
            <CardDescription>
              {t("sessionSignoff.signedCount", "{{count}} phiên ở trạng thái signed_off", {
                count: signedQ.data?.length ?? 0,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {signedQ.data && signedQ.data.length > 0 ? (
              <div className="space-y-2">
                {signedQ.data.map((s: any) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between border rounded-md p-3"
                  >
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {t("sessionSignoff.sessionNumber", "Phiên #{{id}}", { id: s.id })}
                        <Badge variant="outline" className="text-success border-success">
                          <ShieldCheck className="h-3 w-3 mr-1" /> {s.signoffAlgorithm ?? "HMAC-SHA256"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        Hash: {s.signoffPayloadHash?.slice(0, 24)}…
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setVerifyId(s.id)}>
                      {t("sessionSignoff.verifyAction", "Xác thực")}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("sessionSignoff.noSigned", "Chưa có phiên nào được ký.")}</p>
            )}
          </CardContent>
        </Card>

        {/* Sign confirmation dialog */}
        <Dialog open={!!signTarget} onOpenChange={(o) => !o && setSignTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("sessionSignoff.confirmTitle", "Xác nhận chữ ký điện tử")}</DialogTitle>
              <DialogDescription>
                {t(
                  "sessionSignoff.confirmDescription",
                  "Bạn sắp ký phiên #{{id}}. Hành động này tạo bản ghi HMAC-SHA256 vĩnh viễn và không thể hoàn tác.",
                  { id: signTarget?.id },
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="signoff-password">{t("sessionSignoff.reenterPassword", "Nhập lại mật khẩu")}</Label>
              <Input
                id="signoff-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("sessionSignoff.passwordPlaceholder", "Mật khẩu của bạn")}
                autoComplete="current-password"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSignTarget(null)}>
                {t("common.cancel", "Hủy")}
              </Button>
              <Button onClick={handleConfirmSign} disabled={signOffMutation.isPending}>
                {signOffMutation.isPending
                  ? t("sessionSignoff.signing", "Đang ký…")
                  : t("sessionSignoff.signAction", "Ký duyệt")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Verify dialog */}
        <Dialog open={!!verifyId} onOpenChange={(o) => !o && setVerifyId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("sessionSignoff.verifyTitle", "Xác thực chữ ký HMAC")}</DialogTitle>
              <DialogDescription>{t("sessionSignoff.sessionNumber", "Phiên #{{id}}", { id: verifyId })}</DialogDescription>
            </DialogHeader>
            {verifyQ.isLoading ? (
              <p className="text-sm">{t("sessionSignoff.recomputing", "Đang tính lại HMAC…")}</p>
            ) : verifyQ.data ? (
              <div
                className={`rounded-md border p-3 flex items-start gap-3 ${
                  verifyQ.data.signed && verifyQ.data.valid
                    ? "bg-success/10 border-success text-success"
                    : "bg-destructive/10 border-destructive text-destructive"
                }`}
              >
                {verifyQ.data.signed && verifyQ.data.valid ? (
                  <ShieldCheck className="h-5 w-5 mt-0.5" />
                ) : (
                  <ShieldAlert className="h-5 w-5 mt-0.5" />
                )}
                <div className="text-sm">
                  <div className="font-semibold">
                    {verifyQ.data.signed && verifyQ.data.valid
                      ? t("sessionSignoff.valid", "Hợp lệ")
                      : t("sessionSignoff.invalid", "Không hợp lệ")}
                  </div>
                  <div>{verifyQ.data.reason}</div>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button onClick={() => setVerifyId(null)}>{t("common.close", "Đóng")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Shift handover (W4-E) — first client caller of productionSession.handover */}
        <ShiftHandoverDialog
          open={handoverOpen}
          onOpenChange={setHandoverOpen}
          onDone={() => {
            openQ.refetch();
            pausedQ.refetch();
          }}
        />
      </PageContainer>
    </DashboardLayout>
  );
}
