import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, LogIn, ExternalLink, Shield, ShieldCheck, ArrowLeft, Chrome, Github, Globe } from "lucide-react";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { landingPathForRole } from "@/lib/roleLanding";
import { BRAND } from "@/config/brand";
import { loginNextPath } from "@/lib/loginNext";

/**
 * kiem-dinh mục 5 (2026-10-24) — màn 2FA nhận HAI loại mã, khớp `/api/auth/verify-2fa` (oauth.ts: đúng 6 số ⇒ TOTP, còn lại ⇒ mã dự phòng):
 *   · TOTP: đúng 6 chữ số;  · mã dự phòng: đúng 8 ký tự hex (`backupCodeSecret.sinhMaDuPhong` = hex HOA; máy chủ so không phân biệt hoa thường).
 * Mã dự phòng là LỐI THOÁT khi TOTP bị tạm khoá (bộ đếm T16: khoá TOTP không bao giờ chặn mã dự phòng, và ngược lại).
 */
export type LoaiMa2FA = "totp" | "backup";
export function loaiMa2FA(ma: string): LoaiMa2FA | null {
  if (/^\d{6}$/.test(ma)) return "totp";
  if (/^[0-9A-F]{8}$/.test(ma)) return "backup";
  return null;
}
/** Ô nhập: chỉ giữ ký tự hex, viết HOA, tối đa 8. */
export const chuanHoaMa2FA = (v: string): string => v.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 8);

export default function Login() {
  const { t } = useTranslation();
  const BrandMark = BRAND.logoIcon;
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  });
  
  // 2FA States
  const [requires2FA, setRequires2FA] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [otpToken, setOtpToken] = useState("");
  // kiem-dinh mục 5 — khoá tạm của bộ đếm 2FA (429 + remainingMinutes): hạn mở theo đồng hồ máy khách, theo TỪNG loại mã. Không lưu số lần.
  const [khoaDen, setKhoaDen] = useState<Partial<Record<LoaiMa2FA, number>>>({});
  const [bayGio, setBayGio] = useState(() => Date.now());
  const coKhoa = Object.values(khoaDen).some((d) => d !== undefined && d > bayGio);
  useEffect(() => {
    if (!coKhoa) return;
    const id = setInterval(() => setBayGio(Date.now()), 1000);
    return () => clearInterval(id);
  }, [coKhoa]);
  const phutConLai = (loai: LoaiMa2FA): number => {
    const d = khoaDen[loai];
    return d !== undefined && d > bayGio ? Math.ceil((d - bayGio) / 60_000) : 0;
  };
  const loaiMa = loaiMa2FA(otpToken);
  const maBiKhoa = loaiMa !== null && phutConLai(loaiMa) > 0;

  const loginMutation = trpc.auth.login.useMutation();
  const { data: setupCheck } = trpc.auth.checkSetupRequired.useQuery();
  const { data: oauthProviders } = trpc.auth.oauthProviders.useQuery();

  // Redirect to setup if no admin exists
  useEffect(() => {
    if (setupCheck?.required) {
      setLocation("/setup");
    }
  }, [setupCheck, setLocation]);

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.username || !formData.password) {
      toast.error(t('auth.pleaseEnterCredentials'));
      return;
    }

    setIsLoading(true);
    try {
      const result = await loginMutation.mutateAsync({
        username: formData.username,
        password: formData.password,
      });

      // Check if 2FA is required
      if ('requires2FA' in result && result.requires2FA) {
        setRequires2FA(true);
        setUserId(result.userId);
        toast.info(t('auth.twoFactorRequired'));
        return;
      }

      toast.success(t('auth.loginSuccess'));
      // Wait a bit for cookie to be set, then reload into the role-aware landing.
      const dest =
        'user' in result ? landingPathForRole(result.user?.role) : "/";
      setTimeout(() => {
        window.location.href = resolveDestination(dest);
      }, 500);
    } catch (error: any) {
      console.error("Login error:", error);
      // ⚠ KHÔNG toast `error.message` ở đây. Đó là chuỗi THÔ của máy chủ, luôn tiếng
      // Việt ("Tên đăng nhập hoặc mật khẩu không đúng") — nghiệm thu mắt 2026-08-16
      // bắt được nó nổ ra cạnh bản dịch đúng, nên người dùng `zh` nhận MỘT LÚC HAI
      // toast: một tiếng Trung đúng và một tiếng Việt.
      // Máy chủ đã gửi appCode đúng (`INVALID_VALUE` + field `credentials`, xem
      // `server/routers.ts` nhánh LoginError) và bộ xử lý toàn cục ở `main.tsx` dịch
      // nó rồi — đó mới là chỗ DUY NHẤT được phép báo lỗi mutation không có onError.
    } finally {
      setIsLoading(false);
    }
  };

  const handle2FAVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const loai = loaiMa2FA(otpToken);
    if (!loai) {
      toast.error(t('auth.twoFactor.nhapMaHopLe'));
      return;
    }
    if (phutConLai(loai) > 0) return; // đang khoá loại mã này — nút đã khoá, Enter cũng không gửi

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/verify-2fa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId, token: otpToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        // ⚠ KHÔNG dùng `data.error` — đó là câu THÔ của máy chủ, luôn tiếng Việt.
        // `/api/auth/verify-2fa` là đường REST nên không đi qua errorFormatter của
        // tRPC; nó nay gửi kèm `code` máy-đọc-được và client tự tra khoá i18n.
        // `data.error` chỉ còn là lưới cuối nếu gặp mã chưa biết.
        const KHOA_2FA: Record<string, string> = {
          TWOFA_MISSING_FIELDS: 'auth.twoFactor.missingFields',
          TWOFA_SESSION_INVALID: 'auth.twoFactor.sessionInvalid',
          TWOFA_USER_NOT_FOUND: 'auth.twoFactor.userNotFound',
          TWOFA_NOT_ENABLED: 'auth.twoFactor.notEnabled',
          TWOFA_INVALID_TOKEN: 'auth.twoFactor.invalidToken',
          TWOFA_FAILED: 'auth.twoFactor.failed',
          // SCADA R1a Task 16 — bộ đếm TOTP sai: chỉ nói "tạm khoá, thử lại sau N phút" (không bao giờ số lần còn lại).
          TWOFA_TOTP_LOCKED: 'auth.twoFactor.totpLocked',
          TWOFA_TOTP_UNAVAILABLE: 'auth.twoFactor.totpUnavailable',
          TWOFA_BACKUP_LOCKED: 'auth.twoFactor.backupLocked',
        };
        const khoa = typeof data?.code === 'string' ? KHOA_2FA[data.code] : undefined;
        const minutes = typeof data?.remainingMinutes === 'number' ? data.remainingMinutes : 5;
        // kiem-dinh mục 5 — khoá ⇒ khoá nút cho loại mã bị khoá + đếm ngược (phút từ máy chủ; không bao giờ số lần)
        if (data?.code === 'TWOFA_TOTP_LOCKED' || data?.code === 'TWOFA_BACKUP_LOCKED') {
          const loaiKhoa: LoaiMa2FA = data.code === 'TWOFA_TOTP_LOCKED' ? 'totp' : 'backup';
          const nay = Date.now();
          setBayGio(nay);
          setKhoaDen((k) => ({ ...k, [loaiKhoa]: nay + minutes * 60_000 }));
        }
        toast.error(khoa ? t(khoa, { minutes }) : (data.error || t('auth.verificationFailed')));
        return;
      }

      toast.success(t('auth.loginSuccess'));
      const dest = landingPathForRole(data?.user?.role);
      window.location.href = resolveDestination(dest);
    } catch (error) {
      console.error("2FA verification error:", error);
      toast.error(t('auth.verificationFailedRetry'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setRequires2FA(false);
    setUserId(null);
    setOtpToken("");
    setKhoaDen({});
  };

  // doc 81 Đợt 3b final wave (R-3b-c): ?next= chỉ nhận đường NỘI BỘ (safeInternalPath) — trước `startsWith("/")` để lọt
  // "//evil.example" / "/\evil.example" (open redirect sau đăng nhập).
  const getRedirectPath = () => {
    if (typeof window === "undefined") return "/";
    return loginNextPath(window.location.search) ?? "/";
  };

  // An explicit ?next=/some/path (e.g. a deep link the user was sent to before
  // login) always wins; otherwise we honor the role-aware landing destination.
  const resolveDestination = (roleDest: string) => {
    if (typeof window === "undefined") return roleDest;
    return loginNextPath(window.location.search) ?? roleDest;
  };

  type ExternalProvider = "google" | "microsoft" | "github";

  const handleOAuthLogin = (provider: "manus" | ExternalProvider) => {
    if (provider === "manus") {
      window.location.href = getLoginUrl();
      return;
    }

    const redirectPath = getRedirectPath();
    window.location.href = `/api/oauth/${provider}/login?redirect=${encodeURIComponent(redirectPath)}`;
  };

  const hasManusOAuth = oauthProviders?.manus ?? false;
  const enabledExternalProviders = oauthProviders?.providers ?? [];
  const hasExternalOAuth = enabledExternalProviders.length > 0;

  // 2FA Verification Screen
  if (requires2FA) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 mb-4">
              <ShieldCheck className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">{t('auth.twoFactorAuth')}</h1>
            <p className="text-slate-400 mt-2">{t('auth.twoFactorSubtitle')}</p>
          </div>

          <Card className="border-slate-700 bg-slate-800/50 backdrop-blur">
            <CardHeader className="text-center">
              <CardTitle className="text-white flex items-center justify-center gap-2">
                <Shield className="h-5 w-5 text-teal-400" />
                {t('auth.securityVerification')}
              </CardTitle>
              <CardDescription>
                {t('auth.openAuthenticatorApp')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handle2FAVerify} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp" className="text-slate-300">{t('auth.verificationCode')}</Label>
                  <Input
                    id="otp"
                    placeholder="000000"
                    value={otpToken}
                    onChange={(e) => setOtpToken(chuanHoaMa2FA(e.target.value))}
                    className="bg-slate-700/50 border-slate-600 text-white text-center text-2xl tracking-widest font-mono"
                    maxLength={9}
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    aria-describedby="otp-goi-y"
                    autoFocus
                  />
                  <p id="otp-goi-y" className="text-xs text-slate-400">{t('auth.twoFactor.maHoacMaDuPhong')}</p>
                  {(phutConLai('totp') > 0 || phutConLai('backup') > 0) && (
                    <div data-testid="dem-nguoc-khoa-2fa" role="status" className="space-y-1 text-sm text-amber-300">
                      {phutConLai('totp') > 0 && <p>{t('auth.twoFactor.demNguocTotp', { minutes: phutConLai('totp') })}</p>}
                      {phutConLai('backup') > 0 && <p>{t('auth.twoFactor.demNguocBackup', { minutes: phutConLai('backup') })}</p>}
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t('common.back')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading || loaiMa === null || maBiKhoa}
                    className="flex-1 bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t('auth.verifying')}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4 mr-2" />
                        {t('common.confirm')}
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 mb-4">
            <BrandMark className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{BRAND.name}</h1>
          <p className="text-slate-400 mt-2">{t(BRAND.taglineKey, BRAND.tagline)}</p>
        </div>

        <Card className="border-slate-700 bg-slate-800/50 backdrop-blur">
          <CardHeader className="text-center">
            <CardTitle className="text-white">{t('auth.login')}</CardTitle>
            <CardDescription>
              {t('auth.loginSubtitle')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="local" className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-slate-700/50">
                <TabsTrigger value="local" className="data-[state=active]:bg-teal-600">
                  <Shield className="h-4 w-4 mr-2" />
                  {t('auth.localLogin')}
                </TabsTrigger>
                <TabsTrigger value="oauth" className="data-[state=active]:bg-teal-600">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('auth.oauthLogin')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="local" className="mt-4">
                <form onSubmit={handleLocalLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-slate-300">{t('common.username')}</Label>
                    <Input
                      id="username"
                      placeholder={t('auth.usernamePlaceholder')}
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-slate-300">{t('common.password')}</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder={t('auth.passwordPlaceholder')}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t('auth.loggingIn')}
                      </>
                    ) : (
                      <>
                        <LogIn className="h-4 w-4 mr-2" />
                        {t('auth.login')}
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="oauth" className="mt-4">
                {oauthProviders === undefined ? (
                  <div className="text-center text-slate-400 text-sm py-4">
                    {t('auth.loadingLoginConfig')}
                  </div>
                ) : hasManusOAuth || hasExternalOAuth ? (
                  <div className="space-y-6">
                    {hasManusOAuth && (
                      <div className="text-center space-y-3">
                        <p className="text-slate-400 text-sm">
                          {t('auth.loginWithManusDesc')}
                        </p>
                        <Button
                          onClick={() => handleOAuthLogin("manus")}
                          className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          {t('auth.loginWithManus')}
                        </Button>
                      </div>
                    )}

                    {hasExternalOAuth && (
                      <div className="space-y-3">
                        <p className="text-center text-slate-400 text-sm">
                          {t('auth.orUseEnterprise')}
                        </p>
                        {enabledExternalProviders.includes("google") && (
                          <Button
                            onClick={() => handleOAuthLogin("google")}
                            className="w-full bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600"
                          >
                            <Chrome className="h-4 w-4 mr-2" />
                            {t('auth.loginWithGoogle')}
                          </Button>
                        )}
                        {enabledExternalProviders.includes("microsoft") && (
                          <Button
                            onClick={() => handleOAuthLogin("microsoft")}
                            className="w-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700"
                          >
                            <Globe className="h-4 w-4 mr-2" />
                            {t('auth.loginWithMicrosoft')}
                          </Button>
                        )}
                        {enabledExternalProviders.includes("github") && (
                          <Button
                            onClick={() => handleOAuthLogin("github")}
                            variant="outline"
                            className="w-full border-slate-600 text-slate-100 hover:bg-slate-800"
                          >
                            <Github className="h-4 w-4 mr-2" />
                            {t('auth.loginWithGithub')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-center text-slate-400 text-sm">
                    {t('auth.oauthNotConfigured')}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-6">
          © {new Date().getFullYear()} {BRAND.name}
        </p>
      </div>
    </div>
  );
}
