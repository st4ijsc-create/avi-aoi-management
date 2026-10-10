/**
 * doc 81 Đợt 4 Task D1 — gắn MỘT lần ở gốc ứng dụng (App.tsx, trong provider tRPC): biết người dùng đăng nhập ⇒ bắt đầu
 * đồng bộ sở thích giao diện localStorage ⇄ `user_settings.uiPrefs` (lib/uiPrefsSync.ts); đổi người dùng / đăng xuất ⇒ dừng.
 *
 * Gọi qua client tRPC TRẦN (`utils.client.*.query/mutate`), KHÔNG qua `useQuery/useMutation`: lỗi (mất mạng, DB chưa áp
 * 0365) KHÔNG đi qua cache của react-query ⇒ lưới toast toàn cục của main.tsx không bắn — ứng dụng chạy tiếp trên
 * localStorage, không spam thông báo.
 */
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { startUiPrefsSync } from "@/lib/uiPrefsSync";

export function UiPrefsSync(): null {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const userId = (user as { id?: number | string } | null | undefined)?.id ?? null;
  useEffect(() => {
    if (userId === null || userId === "") return;
    const s = startUiPrefsSync(userId, {
      get: () => utils.client.userSettingsRouter.getUiPrefs.query(),
      // fix 1 #1 — server từ chối (CONFLICT) nếu phiên (cookie) không còn là người dùng này (tab cũ).
      set: (patch) => utils.client.userSettingsRouter.setUiPrefs.mutate({ patch, expectedUserId: Number(userId) }),
    });
    // Đổi người dùng / đăng xuất ⇒ dừng; bản cũ đẩy nốt khoá đang chờ (fix 1 #3, có hạn giờ).
    return () => void s.stop();
    // utils.client ổn định suốt đời provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  return null;
}
