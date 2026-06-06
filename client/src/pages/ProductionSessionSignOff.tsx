import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Shield, ShieldCheck, ShieldAlert, RefreshCw, FileCheck2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type SignOffTarget = { id: number; shiftDate: string | Date; operatorId: number };

export default function ProductionSessionSignOff() {
  const [signTarget, setSignTarget] = useState<SignOffTarget | null>(null);
  const [password, setPassword] = useState("");
  const [verifyId, setVerifyId] = useState<number | null>(null);

  const closedQ = trpc.productionSession.list.useQuery({ status: "closed", limit: 100 });
  const signedQ = trpc.productionSession.list.useQuery({ status: "signed_off", limit: 100 });
  const verifyQ = trpc.productionSession.verifySignoff.useQuery(
    { id: verifyId ?? 0 },
    { enabled: !!verifyId },
  );

  const signOffMutation = trpc.productionSession.supervisorSignOff.useMutation({
    onSuccess: (res) => {
      toast.success(
        `Đã ký duyệt phiên #${res.session.id} bằng ${res.signoff.algorithm} (chữ ký: ${res.signoff.signaturePreview})`,
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
      toast.error("Vui lòng nhập lại mật khẩu để xác nhận chữ ký điện tử (21 CFR Part 11 §11.200)");
      return;
    }
    signOffMutation.mutate({ id: signTarget.id, supervisorPasswordConfirmed: true });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Ký duyệt phiên sản xuất (HMAC-SHA256)</h1>
            <p className="text-muted-foreground">
              21 CFR Part 11 §11.70 — Chữ ký điện tử ràng buộc với bản ghi sản xuất, không thể tách rời.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              closedQ.refetch();
              signedQ.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Làm mới
          </Button>
        </div>

        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardContent className="flex items-start gap-4 pt-6">
            <Shield className="h-6 w-6 text-blue-500 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-blue-500">Tuân thủ 21 CFR Part 11</p>
              <p className="text-muted-foreground mt-1">
                Mỗi chữ ký được tạo bằng HMAC-SHA256 trên payload phiên (sessionId, operatorId, closedAt,
                kpiSnapshot). Mọi sửa đổi sau ký sẽ phá vỡ chữ ký khi xác thực lại.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Phiên chờ ký duyệt</CardTitle>
            <CardDescription>{closedQ.data?.length ?? 0} phiên ở trạng thái closed</CardDescription>
          </CardHeader>
          <CardContent>
            {closedQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : closedQ.data && closedQ.data.length > 0 ? (
              <div className="space-y-2">
                {closedQ.data.map((s: any) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between border rounded-md p-3"
                  >
                    <div>
                      <div className="font-medium">
                        Phiên #{s.id} — Operator {s.operatorId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Ca {new Date(s.shiftDate).toLocaleDateString()} ·{" "}
                        {s.actualEnd
                          ? `Đóng ${formatDistanceToNow(new Date(s.actualEnd), { addSuffix: true })}`
                          : "Chưa đóng"}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setSignTarget(s)}>
                      <FileCheck2 className="h-4 w-4 mr-2" />
                      Ký duyệt
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Không có phiên nào chờ ký.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Phiên đã ký</CardTitle>
            <CardDescription>{signedQ.data?.length ?? 0} phiên ở trạng thái signed_off</CardDescription>
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
                        Phiên #{s.id}
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          <ShieldCheck className="h-3 w-3 mr-1" /> {s.signoffAlgorithm ?? "HMAC-SHA256"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        Hash: {s.signoffPayloadHash?.slice(0, 24)}…
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setVerifyId(s.id)}>
                      Xác thực
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Chưa có phiên nào được ký.</p>
            )}
          </CardContent>
        </Card>

        {/* Sign confirmation dialog */}
        <Dialog open={!!signTarget} onOpenChange={(o) => !o && setSignTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Xác nhận chữ ký điện tử</DialogTitle>
              <DialogDescription>
                Bạn sắp ký phiên #{signTarget?.id}. Hành động này tạo bản ghi HMAC-SHA256 vĩnh viễn và
                không thể hoàn tác.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="signoff-password">Nhập lại mật khẩu</Label>
              <Input
                id="signoff-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mật khẩu của bạn"
                autoComplete="current-password"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSignTarget(null)}>
                Hủy
              </Button>
              <Button onClick={handleConfirmSign} disabled={signOffMutation.isPending}>
                {signOffMutation.isPending ? "Đang ký…" : "Ký duyệt"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Verify dialog */}
        <Dialog open={!!verifyId} onOpenChange={(o) => !o && setVerifyId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Xác thực chữ ký HMAC</DialogTitle>
              <DialogDescription>Phiên #{verifyId}</DialogDescription>
            </DialogHeader>
            {verifyQ.isLoading ? (
              <p className="text-sm">Đang tính lại HMAC…</p>
            ) : verifyQ.data ? (
              <div
                className={`rounded-md border p-3 flex items-start gap-3 ${
                  verifyQ.data.signed && verifyQ.data.valid
                    ? "bg-green-500/10 border-green-500 text-green-700 dark:text-green-300"
                    : "bg-red-500/10 border-red-500 text-red-700 dark:text-red-300"
                }`}
              >
                {verifyQ.data.signed && verifyQ.data.valid ? (
                  <ShieldCheck className="h-5 w-5 mt-0.5" />
                ) : (
                  <ShieldAlert className="h-5 w-5 mt-0.5" />
                )}
                <div className="text-sm">
                  <div className="font-semibold">
                    {verifyQ.data.signed && verifyQ.data.valid ? "Hợp lệ" : "Không hợp lệ"}
                  </div>
                  <div>{verifyQ.data.reason}</div>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button onClick={() => setVerifyId(null)}>Đóng</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
