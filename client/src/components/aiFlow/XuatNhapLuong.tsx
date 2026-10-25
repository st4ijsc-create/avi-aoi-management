/**
 * Xuất / nhập luồng giữa nhà máy (lô nhập/xuất): chỉ TỆP tải về / tải lên — không chia sẻ trực tiếp qua máy chủ.
 *   • `NutXuatLuong`: gọi `flow.xuat` ⇒ hộp xem TRƯỚC (cảnh báo văn bản tự do còn nhắc nhà máy nguồn + việc người nhận phải điền) ⇒ "Tải về" (chỉ GÓI, không kèm cảnh báo).
 *   • `NutNhapLuong`: chọn tệp ⇒ `flow.nhapXemTruoc` (định dạng lạ ⇒ lỗi rõ; băm thiếu/lệch, bí mật/dữ liệu ghim/id nhà máy trong gói ⇒ chỉ cảnh báo) ⇒ đặt tên (+ chọn nhà máy) ⇒ `flow.nhap`.
 * Mọi kiểm tra thật ở MÁY CHỦ; giao diện chỉ hiển thị.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { MAU_HANG, laHang } from "@/lib/flowStudio";

function taiTep(ten: string, noiDung: unknown): void {
  const blob = new Blob([JSON.stringify(noiDung, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ten;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const tenTep = (ten: string) => `${ten.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u0111\u0110]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "luong"}.luong-ai.json`;

export function NutXuatLuong({ flowId, version, disabled }: { flowId: string; version?: number | null; disabled?: boolean }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [dangTai, setDangTai] = useState(false);
  const [kq, setKq] = useState<Awaited<ReturnType<typeof utils.flow.xuat.fetch>> | null>(null);
  const mo = async () => {
    setDangTai(true);
    try {
      setKq(await utils.flow.xuat.fetch({ flowId, ...(version ? { version } : {}) }));
    } catch (e) {
      toastTrpcError(e as never);
    } finally {
      setDangTai(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" data-testid="nut-xuat" disabled={disabled || dangTai} onClick={() => void mo()}>
        {dangTai ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
        {t("flowStudio.xuatNhap.xuat")}
      </Button>
      <Dialog open={!!kq} onOpenChange={(o) => !o && setKq(null)}>
        <DialogContent className="max-w-lg" data-testid="hop-xuat">
          <DialogHeader>
            <DialogTitle>{t("flowStudio.xuatNhap.xuatTieuDe")}</DialogTitle>
            <DialogDescription>{t("flowStudio.xuatNhap.xuatMoTa")}</DialogDescription>
          </DialogHeader>
          {kq && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{kq.tenLuong}</span>
                {laHang(kq.hang) && <Badge variant="outline" className={`text-[10px] ${MAU_HANG[kq.hang]}`}>{t(`flowStudio.hang.${kq.hang}`)}</Badge>}
              </div>
              <div>
                <p className="text-xs font-medium">{t("flowStudio.xuatNhap.canhBaoVanBan", { n: kq.canhBao.length })}</p>
                {kq.canhBao.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="xuat-khong-canh-bao">{t("flowStudio.xuatNhap.khongCanhBao")}</p>
                ) : (
                  <ul className="max-h-40 overflow-auto space-y-1 text-xs" data-testid="xuat-canh-bao">
                    {kq.canhBao.map((c, i) => (
                      <li key={i} className="rounded border border-warning/40 bg-warning/10 px-2 py-1" data-testid={`xuat-canh-bao-${c.nodeId}`}>
                        <span className="font-mono">{c.nodeId}</span> · <span className="font-mono">{c.truong}</span> · {t(`flowStudio.xuatNhap.loaiCanhBao.${c.loai}`)}: <b>{c.khop}</b>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">{t("flowStudio.xuatNhap.canhBaoKhongXoa")}</p>
              </div>
              <div>
                <p className="text-xs font-medium">{t("flowStudio.xuatNhap.viecPhaiDien", { n: kq.viec.length })}</p>
                <ul className="max-h-32 overflow-auto text-xs space-y-0.5" data-testid="xuat-viec">
                  {kq.viec.map((v, i) => (
                    <li key={i}><span className="font-mono">{v.nodeId}</span> · {t(`flowStudio.xuatNhap.viec.${v.viec}`)}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setKq(null)}>{t("flowStudio.chung.huy")}</Button>
            <Button data-testid="xuat-tai-ve" onClick={() => kq && taiTep(tenTep(kq.tenLuong), kq.goi)}>
              <Download className="h-4 w-4 mr-1" />
              {t("flowStudio.xuatNhap.taiVe")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NutNhapLuong({ laAdmin }: { laAdmin: boolean }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const oTep = useRef<HTMLInputElement>(null);
  const [goi, setGoi] = useState<unknown>(null);
  const [loiDoc, setLoiDoc] = useState<string | null>(null);
  const [ten, setTen] = useState("");
  const [nhaMay, setNhaMay] = useState("");
  const dsNhaMay = trpc.factory.list.useQuery(undefined, { enabled: goi !== null || loiDoc !== null });
  const nhaMays = dsNhaMay.data ?? [];
  const canChon = !laAdmin && nhaMays.length > 1;
  const hienChon = laAdmin ? nhaMays.length > 0 : nhaMays.length > 1;
  const chuaGan = !laAdmin && dsNhaMay.isSuccess && nhaMays.length === 0;
  const xt = trpc.flow.nhapXemTruoc.useQuery({ goi }, { enabled: goi !== null, retry: false });
  const nhap = trpc.flow.nhap.useMutation({
    onSuccess: (r) => {
      setGoi(null);
      void utils.flow.danhSach.invalidate();
      navigate(`/ai-flows/${encodeURIComponent(r.flowId)}`);
    },
    onError: (e) => toastTrpcError(e),
  });
  const docTep = async (f: File | undefined) => {
    if (!f) return;
    setLoiDoc(null);
    try {
      const j = JSON.parse(await f.text()) as unknown;
      setTen(String((j as { luong?: { name?: unknown } } | null)?.luong?.name ?? f.name.replace(/\.luong-ai\.json$|\.json$/i, "")).slice(0, 200));
      setNhaMay("");
      setGoi(j);
    } catch {
      setGoi(null);
      setLoiDoc(t("flowStudio.xuatNhap.khongPhaiJson"));
    }
  };
  const dong = () => {
    setGoi(null);
    setLoiDoc(null);
    if (oTep.current) oTep.current.value = "";
  };
  return (
    <>
      <input ref={oTep} type="file" accept=".json,application/json" className="hidden" data-testid="nhap-tep" onChange={(e) => void docTep(e.target.files?.[0])} />
      <Button size="sm" variant="outline" data-testid="nut-nhap" onClick={() => oTep.current?.click()}>
        <Upload className="h-4 w-4 mr-1" />
        {t("flowStudio.xuatNhap.nhap")}
      </Button>
      <Dialog open={goi !== null || loiDoc !== null} onOpenChange={(o) => !o && dong()}>
        <DialogContent className="max-w-lg" data-testid="hop-nhap">
          <DialogHeader>
            <DialogTitle>{t("flowStudio.xuatNhap.nhapTieuDe")}</DialogTitle>
            <DialogDescription>{t("flowStudio.xuatNhap.nhapMoTa")}</DialogDescription>
          </DialogHeader>
          {loiDoc && <p role="alert" className="text-sm text-destructive" data-testid="nhap-loi">{loiDoc}</p>}
          {xt.isError && <p role="alert" className="text-sm text-destructive" data-testid="nhap-loi">{mapTrpcError(xt.error)}</p>}
          {xt.data && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-xs">
                <span>{t("flowStudio.danhSach.soNode", { n: xt.data.soNode })}</span>
                {laHang(xt.data.hang) && <Badge variant="outline" className={`text-[10px] ${MAU_HANG[xt.data.hang]}`}>{t(`flowStudio.hang.${xt.data.hang}`)}</Badge>}
                {!xt.data.hopLe && <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">{t("flowStudio.xuatNhap.khongHopLe")}</Badge>}
              </div>
              {xt.data.canhBao.length > 0 && (
                <ul className="space-y-1 text-xs" data-testid="nhap-canh-bao">
                  {xt.data.canhBao.map((c) => (
                    <li key={c} className="rounded border border-warning/40 bg-warning/10 px-2 py-1" data-testid={`nhap-canh-bao-${c}`}>{t(`flowStudio.xuatNhap.canhBaoGoi.${c}`)}</li>
                  ))}
                </ul>
              )}
              <div>
                <p className="text-xs font-medium">{t("flowStudio.xuatNhap.viecPhaiDienNhap", { n: xt.data.viec.length })}</p>
                <ul className="max-h-32 overflow-auto text-xs space-y-0.5" data-testid="nhap-viec">
                  {xt.data.viec.map((v, i) => (
                    <li key={i}><span className="font-mono">{v.nodeId}</span> · {t(`flowStudio.xuatNhap.viec.${v.viec}`)}</li>
                  ))}
                </ul>
              </div>
              {chuaGan && <p role="alert" className="text-xs text-warning" data-testid="nhap-chua-gan">{t("flowStudio.danhSach.chuaGanNhaMay")}</p>}
              {hienChon && (
                <div className="space-y-1">
                  <label className="text-xs font-medium" htmlFor="nhap-nha-may">{t("flowStudio.danhSach.nhaMay")}</label>
                  <select id="nhap-nha-may" data-testid="nhap-nha-may" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={nhaMay} onChange={(e) => setNhaMay(e.target.value)}>
                    <option value="">{laAdmin ? t("flowStudio.danhSach.nhaMayToanHeThong") : t("flowStudio.danhSach.chonNhaMay")}</option>
                    {nhaMays.map((f) => (
                      <option key={f.id} value={String(f.id)}>{f.name} ({f.code})</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-medium">{t("flowStudio.danhSach.tenLuong")}</label>
                <Input data-testid="nhap-ten" value={ten} onChange={(e) => setTen(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={dong}>{t("flowStudio.chung.huy")}</Button>
            <Button
              data-testid="nhap-xac-nhan"
              disabled={!xt.data || !ten.trim() || nhap.isPending || chuaGan || (canChon && !nhaMay)}
              onClick={() => nhap.mutate({ goi, ten: ten.trim(), ...(hienChon && nhaMay ? { factoryId: Number(nhaMay) } : {}) })}
            >
              {nhap.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t("flowStudio.xuatNhap.xacNhanNhap")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
