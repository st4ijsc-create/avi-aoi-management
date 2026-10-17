/**
 * ★★★ Đợt 3b (3.4) — KHUNG CHỨA bảng Git: giữ lời gọi tRPC, `BangGit` thuần hiển thị.
 *
 * • ĐỌC: `gitTrangThai` · `gitNhanh` · `gitLog` · `gitDiffTep` (tệp đang xem).
 * • GHI: `gitCommit` · `gitTaoNhanh` · `gitChuyenNhanh` — người bấm = người duyệt (không model nào chọn tệp/thông điệp).
 *   Sau mỗi lượt ghi: làm mới cả bảng + gọi `onDaDoiCay` (trang làm mới cây tệp/tab — chuyển nhánh đổi nội dung đĩa).
 * • "Gợi ý thông điệp" (`gitGoiYThongDiep`) chỉ trả CHỮ về ô nhập.
 * • Lỗi vận chuyển ⇒ `mapTrpcError` (không `e.message` thô); lỗi có mã ⇒ `cauLoiGit` (mỗi mã một câu, ba locale).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { BangGit } from "./BangGit";
import { cauLoiGit } from "./bangGitLogic";

interface Props {
  projectId: string;
  lang: "vi" | "en" | "zh";
  /** Nhánh đổi / commit xong ⇒ trang làm mới cây tệp + tệp đang mở. */
  onDaDoiCay: () => void;
}

export function KhungGit({ projectId, lang, onDaDoiCay }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [tepXem, setTepXem] = React.useState<string | null>(null);
  React.useEffect(() => setTepXem(null), [projectId]);

  const ttQ = trpc.repoWorkspace.gitTrangThai.useQuery({ projectId }, { staleTime: 5_000 });
  const nhanhQ = trpc.repoWorkspace.gitNhanh.useQuery({ projectId }, { enabled: ttQ.data?.ok === true });
  const logQ = trpc.repoWorkspace.gitLog.useQuery({ projectId }, { enabled: ttQ.data?.ok === true });
  const diffQ = trpc.repoWorkspace.gitDiffTep.useQuery(
    { projectId, path: tepXem ?? "" },
    { enabled: ttQ.data?.ok === true && !!tepXem },
  );
  const commitM = trpc.repoWorkspace.gitCommit.useMutation();
  const taoM = trpc.repoWorkspace.gitTaoNhanh.useMutation();
  const chuyenM = trpc.repoWorkspace.gitChuyenNhanh.useMutation();
  const goiYM = trpc.repoWorkspace.gitGoiYThongDiep.useMutation();
  const dangBan = commitM.isPending || taoM.isPending || chuyenM.isPending;

  const lamMoi = () => {
    void utils.repoWorkspace.gitTrangThai.invalidate({ projectId });
    void utils.repoWorkspace.gitNhanh.invalidate({ projectId });
    void utils.repoWorkspace.gitLog.invalidate({ projectId });
    void utils.repoWorkspace.gitDiffTep.invalidate();
  };

  const onCommit = async (paths: string[], thongDiep: string): Promise<boolean> => {
    try {
      const r = await commitM.mutateAsync({ projectId, paths, thongDiep });
      if (!r.ok) {
        toast.error(cauLoiGit(r.ma, t));
        return false;
      }
      toast.success(t("repoWs.git.daCommit", { n: paths.length, hash: (r.hash ?? "").slice(0, 8) }));
      setTepXem(null);
      lamMoi();
      onDaDoiCay();
      return true;
    } catch (e) {
      toast.error(mapTrpcError(e));
      return false;
    }
  };

  const onGoiY = async (paths: string[]): Promise<string | null> => {
    try {
      const r = await goiYM.mutateAsync({ projectId, paths, lang });
      if (!r.ok) {
        toast.error(cauLoiGit(r.ma, t));
        return null;
      }
      return r.thongDiep;
    } catch (e) {
      toast.error(mapTrpcError(e));
      return null;
    }
  };

  const doiNhanh = async (loai: "tao" | "chuyen", ten: string) => {
    try {
      const r = loai === "tao" ? await taoM.mutateAsync({ projectId, ten }) : await chuyenM.mutateAsync({ projectId, ten });
      if (!r.ok) {
        toast.error(cauLoiGit(r.ma, t));
        return;
      }
      toast.success(loai === "tao" ? t("repoWs.git.daTaoNhanh", { ten }) : t("repoWs.git.daChuyenNhanh", { ten }));
      setTepXem(null);
      lamMoi();
      onDaDoiCay();
    } catch (e) {
      toast.error(mapTrpcError(e));
    }
  };

  const d = ttQ.data;
  const loi = ttQ.isError ? mapTrpcError(ttQ.error) : d && !d.ok ? d.ma : null;
  const dd = diffQ.data;
  return (
    <BangGit
      tt={d && d.ok ? d.tt : null}
      loi={loi}
      dangTai={ttQ.isLoading}
      coQuyenGhi={d?.ok === true && d.coQuyenGhi}
      nhanh={nhanhQ.data?.nhanh ?? []}
      nhanhHienTai={nhanhQ.data?.hienTai ?? null}
      log={logQ.data?.dong ?? []}
      tepXem={tepXem}
      diff={dd && dd.ok ? dd.diff : null}
      loiDiff={diffQ.isError ? mapTrpcError(diffQ.error) : dd && !dd.ok ? dd.ma : null}
      dangTaiDiff={diffQ.isLoading && !!tepXem}
      dangBan={dangBan}
      onXemTep={setTepXem}
      onCommit={onCommit}
      onGoiY={onGoiY}
      onTaoNhanh={(ten) => void doiNhanh("tao", ten)}
      onChuyenNhanh={(ten) => void doiNhanh("chuyen", ten)}
      onLamMoi={lamMoi}
    />
  );
}
