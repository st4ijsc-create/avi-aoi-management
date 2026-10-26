/**
 * Đợt 10.2 — danh mục model chọn được (`aiChonModel.danhMuc`). Lỗi / không có quyền MOD_AI / chưa tải ⇒ danh mục CHỈ có "Tự động" (bề mặt vẫn dùng được, không chặn).
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { AUTO, type MucModel } from "@/lib/chonModel";

export function useDanhMucModel(): { danhMuc: MucModel[]; daTai: boolean } {
  const q = trpc.aiChonModel.danhMuc.useQuery(undefined, { staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
  const danhMuc = useMemo<MucModel[]>(() => (q.data && q.data.length ? (q.data as MucModel[]) : [AUTO]), [q.data]);
  return { danhMuc, daTai: !!q.data };
}
