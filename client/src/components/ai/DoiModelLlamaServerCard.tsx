/**
 * Đợt 6 (AI Local) — THẺ "ĐỔI MODEL llama-server" (chỉ admin; người khác: thủ tục trả FORBIDDEN ⇒ thẻ ẩn).
 *
 * Máy chủ làm hết việc (`server/services/ai/doiModelLlamaServer.ts`): kiểm danh sách trắng + VRAM, tạm dừng bộ
 * giám sát, chờ hàng đợi, khởi động lại bằng đúng kịch bản của bộ giám sát, kiểm `/props` + một lượt sinh thử, tự
 * quay về model cũ khi hỏng. Thẻ này chỉ: chọn model, xác nhận, rồi hiện TỪNG BƯỚC + kết quả `/props` mà máy chủ
 * báo (hỏi lại mỗi 2 s khi đang đổi). Sàn máy chủ: admin + 2FA (không step-up OTP — xem `aiGgufRouter.ts`).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, MinusCircle, RefreshCw, Server, XCircle } from "lucide-react";

const GiB = 1024 ** 3;
const BUOC = [
  "kiem-lua-chon",
  "giu-khoa",
  "kiem-server",
  "uoc-luong-vram",
  "tam-dung-giam-sat",
  "cho-hang-doi",
  "khoi-dong",
  "kiem-props",
  "sinh-thu",
  "ghi-lua-chon", // CHỐT lựa chọn bền chỉ SAU /props + sinh thử (an toàn khi sập)
  "ap-dung",
  "quay-ve",
] as const;
const KHOA_BUOC: Record<(typeof BUOC)[number], string> = {
  "kiem-lua-chon": "kiemLuaChon",
  "giu-khoa": "giuKhoa",
  "kiem-server": "kiemServer",
  "uoc-luong-vram": "uocLuongVram",
  "tam-dung-giam-sat": "tamDungGiamSat",
  "cho-hang-doi": "choHangDoi",
  "ghi-lua-chon": "ghiLuaChon",
  "khoi-dong": "khoiDong",
  "kiem-props": "kiemProps",
  "sinh-thu": "sinhThu",
  "ap-dung": "apDung",
  "quay-ve": "quayVe",
};
const MAC_DINH_BUOC: Record<(typeof BUOC)[number], string> = {
  "kiem-lua-chon": "Kiểm lựa chọn",
  "giu-khoa": "Giữ khoá đổi model",
  "kiem-server": "Đọc /props hiện tại",
  "uoc-luong-vram": "Ước lượng VRAM",
  "tam-dung-giam-sat": "Tạm dừng giám sát",
  "cho-hang-doi": "Chờ lượt AI đang chạy",
  "ghi-lua-chon": "Ghi lựa chọn bền",
  "khoi-dong": "Khởi động lại llama-server",
  "kiem-props": "Kiểm /props",
  "sinh-thu": "Sinh thử",
  "ap-dung": "Áp dụng định tuyến",
  "quay-ve": "Quay về model cũ",
};

function IconBuoc({ s }: { s: string }) {
  if (s === "xong") return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
  if (s === "loi") return <XCircle className="h-4 w-4 text-destructive" aria-hidden />;
  if (s === "dang-chay") return <Loader2 className="h-4 w-4 animate-spin text-info" aria-hidden />;
  if (s === "bo-qua") return <MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden />;
  return <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />;
}

export default function DoiModelLlamaServerCard() {
  const { t } = useTranslation();
  const [chon, setChon] = useState<string>("");

  const tq = trpc.aiGguf.doiModelTongQuan.useQuery(undefined, {
    retry: false,
    // Lượt đổi chạy nền ở máy chủ: hỏi mỗi 2 s khi đang chạy, 15 s khi rảnh.
    refetchInterval: (q) => (q.state.data?.phien?.ketQua === "dang-chay" ? 2000 : 15000),
  });
  const batDau = trpc.aiGguf.doiModelBatDau.useMutation({
    onSuccess: () => {
      toast.info(t("gguf.doiModel.daBatDau", "Đã bắt đầu đổi model — theo dõi từng bước bên dưới."));
      void tq.refetch();
    },
    onError: (e) => toastTrpcError(e),
  });

  const d = tq.data;
  const phien = d?.phien ?? null;
  const chay = phien?.ketQua === "dang-chay";

  const luaChonDuoc = useMemo(() => (d?.models ?? []).filter((m) => m.loai === "sinh-chu"), [d?.models]);
  const tenDangChay = d?.dangChay?.tenModel ?? null;

  // Không phải admin (FORBIDDEN) / không có module AI ⇒ thẻ không hiện. Lỗi khác vẫn hiện để không im lặng.
  if (tq.error && /FORBIDDEN|UNAUTHORIZED/.test(tq.error.data?.code ?? "")) return null;

  const mauKetQua: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
    "thanh-cong": "default",
    "that-bai-da-quay-ve": "secondary",
    "that-bai-quay-ve-hong": "destructive",
    "huy-khong-doi": "outline",
    "dang-chay": "outline",
  };

  return (
    <Card data-testid="doi-model-llama-server">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="h-4 w-4" aria-hidden />
          {t("gguf.doiModel.tieuDe", "Model của llama-server")}
        </CardTitle>
        <CardDescription>
          {t("gguf.doiModel.moTa", "Đổi model chữ chính đang chạy trên llama-server. Máy chủ kiểm VRAM, khởi động lại, kiểm /props và một lượt sinh thử; hỏng thì tự quay về model cũ.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {tq.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("gguf.doiModel.dangTai", "Đang đọc trạng thái…")}</p>
        ) : tq.error ? (
          <p className="text-sm text-destructive">{tq.error.message}</p>
        ) : d ? (
          <>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">{t("gguf.doiModel.dangChay", "Đang chạy")}: </span>
                {tenDangChay ? (
                  <span className="font-medium break-all">{tenDangChay}</span>
                ) : (
                  <span className="text-destructive">{t("gguf.doiModel.khongDocDuocProps", "không đọc được /props")} {d.loiDocProps ? `(${d.loiDocProps})` : ""}</span>
                )}
              </div>
              {d.dangChay && (
                <div>
                  <span className="text-muted-foreground">{t("gguf.doiModel.ngCanh", "Ngữ cảnh / slot")}: </span>
                  <span className={d.dangChay.nCtx === d.mongDoi.nCtx && d.dangChay.tongSlot === d.mongDoi.tongSlot ? "" : "text-warning"}>
                    {d.dangChay.nCtx ?? "?"} × {d.dangChay.tongSlot ?? "?"}
                  </span>
                  <span className="text-muted-foreground"> ({t("gguf.doiModel.mongDoi", "mong đợi")} {d.mongDoi.nCtx} × {d.mongDoi.tongSlot})</span>
                </div>
              )}
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">{t("gguf.doiModel.nguon", "Nguồn lựa chọn")}: </span>
                {d.luaChon?.nguon === "lua-chon" ? (
                  <Badge variant="secondary">{t("gguf.doiModel.nguonQuanTri", "lựa chọn quản trị")}</Badge>
                ) : (
                  <Badge variant="outline">{t("gguf.doiModel.nguonEnv", "cấu hình gốc")}</Badge>
                )}{" "}
                <span className="text-xs text-muted-foreground">
                  {t("gguf.doiModel.cauHinhGoc", "cấu hình gốc")}: {d.modelEnv || "—"}
                  {d.luaChon?.nguon === "lua-chon-bo-qua" && d.luaChon.lyDo ? ` · ${d.luaChon.lyDo}` : ""}
                </span>
              </div>
            </div>

            {!d.bat ? (
              <p className="text-sm text-muted-foreground">{d.lyDoTat}</p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select value={chon} onValueChange={setChon} disabled={chay || batDau.isPending}>
                  <SelectTrigger className="sm:w-[28rem]" aria-label={t("gguf.doiModel.chonModel", "Chọn model")}>
                    <SelectValue placeholder={t("gguf.doiModel.chonModel", "Chọn model")} />
                  </SelectTrigger>
                  <SelectContent>
                    {luaChonDuoc.map((m) => (
                      <SelectItem key={m.ten} value={m.ten} disabled={m.ten === tenDangChay}>
                        {m.ten} · {(m.kichThuoc / GiB).toFixed(1)} GiB{m.ten === tenDangChay ? ` · ${t("gguf.doiModel.dangChayNhan", "đang chạy")}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!chon || chon === tenDangChay || chay || batDau.isPending}
                  onClick={() => {
                    if (window.confirm(t("gguf.doiModel.xacNhan", "Đổi model llama-server? Mọi lượt AI tạm ngưng trong lúc đổi."))) batDau.mutate({ tenModel: chon });
                  }}
                >
                  {batDau.isPending || chay ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-1 h-4 w-4" aria-hidden />}
                  {t("gguf.doiModel.nutDoi", "Đổi model")}
                </Button>
              </div>
            )}
            {d.bat && (
              <p className="text-xs text-muted-foreground">
                {t("gguf.doiModel.canhBao", "Mọi lượt AI bị tạm ngưng trong lúc đổi (thường 1–3 phút). Chỉ liệt kê model sinh chữ trong kho model.")}
              </p>
            )}

            {phien && (
              <div className="space-y-2 rounded-md border p-3" aria-live="polite">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium break-all">
                    {phien.modelCu} → {phien.modelMoi}
                  </span>
                  <Badge variant={mauKetQua[phien.ketQua] ?? "outline"}>{t(`gguf.doiModel.ketQua.${phien.ketQua}`, phien.ketQua)}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(phien.batDau).toLocaleString()}</span>
                </div>
                <ol className="space-y-1 text-sm">
                  {phien.buoc
                    .filter((b) => !(b.buoc === "quay-ve" && b.trangThai === "bo-qua"))
                    .map((b) => (
                      <li key={b.buoc} className="flex items-start gap-2">
                        <IconBuoc s={b.trangThai} />
                        <span className="min-w-0">
                          {t(`gguf.doiModel.buoc.${KHOA_BUOC[b.buoc]}`, MAC_DINH_BUOC[b.buoc])}
                          {b.chiTiet ? <span className="ml-1 text-xs text-muted-foreground break-all">— {b.chiTiet}</span> : null}
                        </span>
                      </li>
                    ))}
                </ol>
                {phien.props && (
                  <div className="rounded bg-muted p-2 font-mono text-xs break-all">
                    /props: model_path={phien.props.modelPath} · n_ctx={phien.props.nCtx ?? "?"} · total_slots={phien.props.tongSlot ?? "?"}
                    {phien.sinhThu ? ` · ${t("gguf.doiModel.sinhThuNhan", "sinh thử")}="${phien.sinhThu.chu}" (${phien.sinhThu.ms} ms)` : ""}
                  </div>
                )}
                {phien.loi && <p className="text-sm text-destructive break-words">{phien.loi}</p>}
                {phien.canhBao.map((c, i) => (
                  <p key={i} className="text-xs text-warning break-words">
                    {c}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
