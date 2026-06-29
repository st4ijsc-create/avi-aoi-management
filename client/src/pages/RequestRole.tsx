/**
 * Doc 10 / U12 — "Request a higher role" flow.
 *
 * A generic `user`/`viewer` had no in-app way to ask for elevated access. This page lets a
 * user state their current role, the role they need, and why — then compose the request as
 * an email to the admin (mailto) or copy it to the clipboard. HONEST: there is no automated
 * approval backend here; it routes a clear request to a human admin (who grants via the
 * existing Users/RoleBuilder admin pages).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldQuestion, Mail, Copy } from "lucide-react";

const ROLES = ["operator", "maintenance", "quality_inspector", "supervisor", "manager", "admin"];

export default function RequestRole() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [desired, setDesired] = useState("");
  const [reason, setReason] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const body = useMemo(() => {
    const who = (user as any)?.name ?? (user as any)?.username ?? `user#${(user as any)?.id ?? "?"}`;
    return [
      `Người yêu cầu / Requester: ${who}`,
      `Vai trò hiện tại / Current role: ${user?.role ?? "user"}`,
      `Vai trò mong muốn / Requested role: ${desired || "(chưa chọn)"}`,
      `Lý do / Reason: ${reason || "(trống)"}`,
    ].join("\n");
  }, [user, desired, reason]);

  const subject = t("roleUpgrade.subject", "Yêu cầu nâng quyền truy cập");

  const openMail = () => {
    const to = adminEmail.trim();
    const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      toast.success(t("roleUpgrade.copied", "Đã sao chép yêu cầu"));
    } catch {
      toast.error(t("roleUpgrade.copyFail", "Không sao chép được"));
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-2xl space-y-4 p-2 sm:p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <ShieldQuestion className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("roleUpgrade.title", "Xin nâng quyền")}</h1>
            <p className="text-sm text-muted-foreground">{t("roleUpgrade.subtitle", "Gửi yêu cầu tới quản trị viên để được cấp vai trò phù hợp")}</p>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">{t("roleUpgrade.formTitle", "Thông tin yêu cầu")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs">{t("roleUpgrade.current", "Vai trò hiện tại")}</Label>
              <Input value={user?.role ?? "user"} disabled />
            </div>
            <div>
              <Label className="text-xs">{t("roleUpgrade.desired", "Vai trò mong muốn")}</Label>
              <Select value={desired} onValueChange={setDesired}>
                <SelectTrigger><SelectValue placeholder={t("roleUpgrade.pick", "Chọn vai trò")} /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("roleUpgrade.reason", "Lý do")}</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("roleUpgrade.reasonPh", "Vì sao bạn cần quyền này?")} />
            </div>
            <div>
              <Label className="text-xs">{t("roleUpgrade.adminEmail", "Email quản trị (tuỳ chọn)")}</Label>
              <Input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@company.com" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={openMail} disabled={!desired}><Mail className="mr-1 h-4 w-4" /> {t("roleUpgrade.sendMail", "Gửi qua email")}</Button>
              <Button variant="outline" onClick={copy} disabled={!desired}><Copy className="mr-1 h-4 w-4" /> {t("roleUpgrade.copy", "Sao chép")}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("roleUpgrade.note", "Quản trị viên cấp quyền tại trang Người dùng / Phân quyền.")}</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
