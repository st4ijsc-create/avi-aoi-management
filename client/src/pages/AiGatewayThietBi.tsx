/**
 * ★★★ Đợt 4A (2026-10-17) — trang `/ai-thiet-bi`: (1) XÁC NHẬN mã thiết bị mà extension VSCode hiện ra (device flow:
 * extension xin mã ⇒ người dùng mở trang này trong phiên ĐÃ đăng nhập, đã qua 2FA nếu bật ⇒ đối chiếu tên thiết bị +
 * phạm vi ⇒ Cho phép/Từ chối); (2) quản lý token cá nhân của cổng `/v1` (tạo — bản rõ hiện ĐÚNG MỘT LẦN —, xem, thu hồi).
 *
 * ★★★ Rà bảo mật de591c868 #3 — LỪA ĐẢO MÃ THIẾT BỊ: kẻ tấn công khởi tạo luồng rồi gửi nạn nhân `/ai-thiet-bi?ma=…`.
 *   ⇒ trang KHÔNG điền sẵn mã từ URL (người dùng GÕ mã đang hiện trong VSCode của CHÍNH họ — tham số `?ma=` bị bỏ qua
 *   có chủ đích); khi có mã, hiện NGUỒN GỐC lượt khởi tạo (IP, User-Agent, lúc tạo) + cảnh báo IP khác IP trình duyệt;
 *   "Cho phép" khoá tới khi tích xác nhận "chính tôi vừa bấm đăng nhập trong VSCode" (máy chủ cưỡng chế lại:
 *   `xacNhanTuKhoiTao`, note `CAN_XAC_NHAN`). Lưới: `AiGatewayThietBi.dom.test.tsx`.
 * ⚠ Bản rõ token chỉ sống trong state của lượt tạo; rời trang là mất (máy chủ chỉ giữ băm). Không ghi localStorage.
 * ⚠ Mọi chữ qua i18n `aiGatewayToken.*` (vi/en/zh); `note` từ máy chủ dịch qua `aiGatewayToken.errors.<note>`.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, MonitorSmartphone, Copy, ShieldCheck, ShieldX, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

const PHAM_VI = ["chat", "fim", "embed"] as const;
type PhamVi = (typeof PHAM_VI)[number];

/** Cùng luật `chuanHoaMaNguoiDung` phía máy chủ (chỉ để bật nút — máy chủ kiểm lại). */
function chuanHoaMa(vao: string): string | null {
  const s = vao.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function XacNhanThietBi() {
  const { t, i18n } = useTranslation();
  // ⚠ KHÔNG đọc `?ma=` (xem docblock): ô mã luôn bắt đầu RỖNG.
  const [maGo, setMaGo] = useState("");
  const [xacNhan, setXacNhan] = useState(false);
  const [ketQua, setKetQua] = useState<"da-duyet" | "tu-choi" | null>(null);
  const ma = chuanHoaMa(maGo);
  const xem = trpc.aiGatewayToken.xemThietBi.useQuery({ maNguoiDung: ma ?? "" }, { enabled: !!ma && !ketQua, retry: false });
  const utils = trpc.useUtils();
  const quyet = trpc.aiGatewayToken.quyetThietBi.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        setKetQua(r.trangThai);
        void utils.aiGatewayToken.danhSach.invalidate();
      } else toast.error(t(`aiGatewayToken.errors.${r.note}`));
    },
  });
  const loiXem = xem.data && !xem.data.ok ? xem.data.note : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="h-5 w-5" />
          {t("aiGatewayToken.device.title")}
        </CardTitle>
        <CardDescription>{t("aiGatewayToken.device.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 max-w-xs">
          <Label htmlFor="ma-thiet-bi">{t("aiGatewayToken.device.codeLabel")}</Label>
          <Input
            id="ma-thiet-bi"
            value={maGo}
            autoComplete="off"
            placeholder="BCDF-GHJK"
            className="font-mono tracking-widest uppercase"
            onChange={(e) => {
              setMaGo(e.target.value);
              setKetQua(null);
              setXacNhan(false);
            }}
          />
        </div>
        {ketQua === "da-duyet" && <p className="text-sm text-green-600">{t("aiGatewayToken.device.approved")}</p>}
        {ketQua === "tu-choi" && <p className="text-sm text-muted-foreground">{t("aiGatewayToken.device.denied")}</p>}
        {!ketQua && loiXem && <p className="text-sm text-destructive">{t(`aiGatewayToken.errors.${loiXem}`)}</p>}
        {!ketQua && xem.data?.ok && (
          <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <span>{t("aiGatewayToken.device.phishingWarning")}</span>
            </div>
            <p className="text-sm">
              {t("aiGatewayToken.device.deviceName")}: <strong>{xem.data.ten}</strong>
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t("aiGatewayToken.device.requestedFrom")}</dt>
              <dd className="font-mono break-all">{xem.data.ipKhoiTao ?? t("aiGatewayToken.device.unknown")}</dd>
              <dt className="text-muted-foreground">{t("aiGatewayToken.device.userAgent")}</dt>
              <dd className="font-mono text-xs break-all">{xem.data.tacNhanKhoiTao ?? t("aiGatewayToken.device.unknown")}</dd>
              <dt className="text-muted-foreground">{t("aiGatewayToken.device.requestedAt")}</dt>
              <dd>{xem.data.taoLuc ? new Date(xem.data.taoLuc).toLocaleString(i18n.language) : t("aiGatewayToken.device.unknown")}</dd>
            </dl>
            {xem.data.khacIp && (
              <p className="text-sm text-destructive">{t("aiGatewayToken.device.ipMismatch")}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {t("aiGatewayToken.device.scopes")}:
              {xem.data.phamVi.map((p) => (
                <Badge key={p} variant="secondary">
                  {t(`aiGatewayToken.scope.${p}`)}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("aiGatewayToken.device.expiresIn", { s: xem.data.conLaiGiay })}</p>
            <p className="text-xs text-muted-foreground">{t("aiGatewayToken.device.warning")}</p>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={xacNhan} onCheckedChange={(v) => setXacNhan(v === true)} aria-label={t("aiGatewayToken.device.confirmMine")} />
              <span>{t("aiGatewayToken.device.confirmMine")}</span>
            </label>
            <div className="flex gap-2">
              <Button
                disabled={quyet.isPending || !xacNhan}
                onClick={() => ma && xacNhan && quyet.mutate({ maNguoiDung: ma, dongY: true, xacNhanTuKhoiTao: true })}
              >
                <ShieldCheck className="h-4 w-4 mr-1" />
                {t("aiGatewayToken.device.approve")}
              </Button>
              <Button variant="outline" disabled={quyet.isPending} onClick={() => ma && quyet.mutate({ maNguoiDung: ma, dongY: false })}>
                <ShieldX className="h-4 w-4 mr-1" />
                {t("aiGatewayToken.device.deny")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TokenCuaToi() {
  const { t, i18n } = useTranslation();
  const utils = trpc.useUtils();
  const ds = trpc.aiGatewayToken.danhSach.useQuery();
  const [ten, setTen] = useState("");
  const [soNgay, setSoNgay] = useState(90);
  const [phamVi, setPhamVi] = useState<PhamVi[]>(["chat", "fim"]);
  const [tokenMoi, setTokenMoi] = useState<string | null>(null);
  const tao = trpc.aiGatewayToken.tao.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        setTokenMoi(r.token);
        setTen("");
        void utils.aiGatewayToken.danhSach.invalidate();
      } else toast.error(t(`aiGatewayToken.errors.${r.note}`));
    },
  });
  const thuHoi = trpc.aiGatewayToken.thuHoi.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success(t("aiGatewayToken.tokens.revoked"));
      else toast.error(t(`aiGatewayToken.errors.${r.note}`));
      void utils.aiGatewayToken.danhSach.invalidate();
    },
  });
  const ngay = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : t("aiGatewayToken.tokens.never"));
  const loiDs = ds.data && !ds.data.ok ? ds.data.note : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {t("aiGatewayToken.tokens.title")}
        </CardTitle>
        <CardDescription>{t("aiGatewayToken.tokens.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] items-end">
          <div className="space-y-2">
            <Label htmlFor="ten-token">{t("aiGatewayToken.create.name")}</Label>
            <Input id="ten-token" value={ten} maxLength={100} onChange={(e) => setTen(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="so-ngay">{t("aiGatewayToken.create.days")}</Label>
            <Input
              id="so-ngay"
              type="number"
              min={1}
              max={365}
              className="w-24"
              value={soNgay}
              onChange={(e) => setSoNgay(Math.min(365, Math.max(1, Number(e.target.value) || 90)))}
            />
          </div>
          <Button
            disabled={!ten.trim() || phamVi.length === 0 || tao.isPending}
            onClick={() => tao.mutate({ ten: ten.trim(), phamVi, soNgay })}
          >
            {t("aiGatewayToken.create.submit")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-4">
          {PHAM_VI.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={phamVi.includes(p)}
                onCheckedChange={(v) => setPhamVi((cu) => (v ? [...cu, p] : cu.filter((x) => x !== p)))}
              />
              {t(`aiGatewayToken.scope.${p}`)}
            </label>
          ))}
        </div>
        {tokenMoi && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 space-y-2">
            <p className="text-sm font-medium">{t("aiGatewayToken.create.once")}</p>
            <div className="flex gap-2">
              <Input readOnly value={tokenMoi} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(tokenMoi).then(() => toast.success(t("aiGatewayToken.create.copied")));
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        {loiDs && <p className="text-sm text-destructive">{t(`aiGatewayToken.errors.${loiDs}`)}</p>}
        {ds.data?.ok && ds.data.tokens.length === 0 && <p className="text-sm text-muted-foreground">{t("aiGatewayToken.tokens.empty")}</p>}
        {ds.data?.ok && ds.data.tokens.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">{t("aiGatewayToken.tokens.name")}</th>
                  <th className="py-2 pr-3">{t("aiGatewayToken.tokens.prefix")}</th>
                  <th className="py-2 pr-3">{t("aiGatewayToken.tokens.scopes")}</th>
                  <th className="py-2 pr-3">{t("aiGatewayToken.tokens.status")}</th>
                  <th className="py-2 pr-3">{t("aiGatewayToken.tokens.expires")}</th>
                  <th className="py-2 pr-3">{t("aiGatewayToken.tokens.lastUsed")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {ds.data.tokens.map((tk) => (
                  <tr key={tk.id} className="border-t">
                    <td className="py-2 pr-3">
                      {tk.ten}
                      <span className="ml-2 text-xs text-muted-foreground">{t(`aiGatewayToken.source.${tk.nguon}`)}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{tk.tienTo}…</td>
                    <td className="py-2 pr-3">{tk.phamVi.map((p) => t(`aiGatewayToken.scope.${p}`)).join(", ")}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={tk.trangThai === "hieu-luc" ? "default" : "secondary"}>{t(`aiGatewayToken.status.${tk.trangThai}`)}</Badge>
                    </td>
                    <td className="py-2 pr-3">{ngay(tk.hetHanLuc)}</td>
                    <td className="py-2 pr-3">{ngay(tk.dungLanCuoiLuc)}</td>
                    <td className="py-2 text-right">
                      {tk.trangThai === "hieu-luc" && (
                        <Button size="sm" variant="ghost" disabled={thuHoi.isPending} onClick={() => thuHoi.mutate({ id: tk.id })}>
                          <Trash2 className="h-4 w-4 mr-1" />
                          {t("aiGatewayToken.tokens.revoke")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AiGatewayThietBi() {
  const { t } = useTranslation();
  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader
          icon={<KeyRound className="h-6 w-6" />}
          title={t("aiGatewayToken.title")}
          description={t("aiGatewayToken.subtitle")}
        />
        <XacNhanThietBi />
        <TokenCuaToi />
      </div>
    </DashboardLayout>
  );
}
