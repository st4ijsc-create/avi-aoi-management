/**
 * ★★ AI Local Đợt 8.3 — DANH SÁCH LUỒNG AI `/ai-flows` (Flow Studio).
 *
 * Bảng luồng (`flow.danhSach`): tên · hạng tác dụng phụ (huy hiệu màu) · phiên bản hoạt động/mới nhất · bật/tắt · lượt gần
 * nhất. Tạo luồng mới (lưu ngay phiên bản 1 = một node kích hoạt thủ công) hoặc từ MẪU (`flow.mauLuong`, bản sao id mới —
 * không bao giờ tự bật). Khối BÍ MẬT: danh sách không giá trị (`flow.biMatDanhSach`); tạo/xoá chỉ admin (máy chủ cũng chặn).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageContainer, PageHeader } from "@/components/patterns";
import { ConfirmDeleteDialog } from "@/components/patterns/ConfirmDeleteDialog";
import { trpc } from "@/lib/trpc";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { fmtDateTime } from "@/lib/fmtDateTime";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileStack, Inbox, KeyRound, Loader2, Plus, Trash2, Workflow } from "lucide-react";
import type { FlowDefinition } from "@shared/flow/model";
import { MAU_HANG, MAU_TRANG_THAI, idLuongTuTen, laHang, luongMoi, saoTuMau } from "@/lib/flowStudio";

const O_CHON =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function KhoiBiMat({ laAdmin }: { laAdmin: boolean }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const ds = trpc.flow.biMatDanhSach.useQuery(undefined, { retry: false });
  const [id, setId] = useState("");
  const [ten, setTen] = useState("");
  const [loai, setLoai] = useState("token");
  const [giaTri, setGiaTri] = useState("");
  // Đợt 9 — host bí mật được phép gửi tới (BẮT BUỘC khi tạo; M2) + nhà máy của bí mật (admin: trống = toàn hệ thống, chỉ admin dùng).
  const [hostChu, setHostChu] = useState("");
  const [nhaMayBm, setNhaMayBm] = useState("");
  const [suaHost, setSuaHost] = useState<null | { id: string; chu: string }>(null);
  const dsNhaMay = trpc.factory.list.useQuery(undefined, { enabled: laAdmin });
  const tachHost = (chu: string) => chu.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  const datHost = trpc.flow.biMatDatHost.useMutation({
    onSuccess: () => {
      toast.success(t("flowStudio.biMat.daLuuHost"));
      setSuaHost(null);
      void utils.flow.biMatDanhSach.invalidate();
    },
    onError: (e) => toastTrpcError(e),
  });
  const tao = trpc.flow.biMatTao.useMutation({
    onSuccess: () => {
      toast.success(t("flowStudio.biMat.daTao"));
      setId("");
      setTen("");
      setGiaTri("");
      setHostChu("");
      void utils.flow.biMatDanhSach.invalidate();
    },
    onError: (e) => toastTrpcError(e),
  });
  const xoa = trpc.flow.biMatXoa.useMutation({
    onSuccess: () => {
      toast.success(t("flowStudio.biMat.daXoa"));
      void utils.flow.biMatDanhSach.invalidate();
    },
    onError: (e) => toastTrpcError(e),
  });
  const hopLe = /^[A-Za-z0-9_-]{1,64}$/.test(id) && ten.trim().length > 0 && giaTri.length >= 4 && tachHost(hostChu).length > 0;

  return (
    <Card data-testid="khoi-bi-mat">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" />{t("flowStudio.biMat.tieuDe")}</CardTitle>
        <CardDescription>{t("flowStudio.biMat.moTa")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ds.error && <p className="text-xs text-destructive">{mapTrpcError(ds.error)}</p>}
        {ds.data && ds.data.length === 0 && <p className="text-xs text-muted-foreground">{t("flowStudio.biMat.rong")}</p>}
        {ds.data && ds.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("flowStudio.biMat.id")}</TableHead>
                <TableHead>{t("flowStudio.biMat.ten")}</TableHead>
                <TableHead>{t("flowStudio.biMat.loai")}</TableHead>
                <TableHead>{t("flowStudio.biMat.host")}</TableHead>
                <TableHead>{t("flowStudio.biMat.phienBanKhoa")}</TableHead>
                <TableHead>{t("flowStudio.biMat.ngayTao")}</TableHead>
                {laAdmin && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ds.data.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">{b.id}</TableCell>
                  <TableCell className="text-sm">{b.ten}</TableCell>
                  <TableCell className="text-xs">{t(`flowStudio.biMat.loaiChon.${b.loai}`, { defaultValue: b.loai })}</TableCell>
                  <TableCell className="text-xs" data-testid={`host-${b.id}`}>
                    {b.hostChoPhep.length === 0 ? (
                      <Badge variant="outline" className="text-[10px] bg-warning/15 text-warning border-warning/40">{t("flowStudio.biMat.hostChuaKhai")}</Badge>
                    ) : (
                      <span className="font-mono">{b.hostChoPhep.join(", ")}</span>
                    )}
                    {laAdmin && (
                      <Button variant="ghost" size="sm" className="h-6 px-1 ml-1 text-[11px]" data-testid={`sua-host-${b.id}`} onClick={() => setSuaHost({ id: b.id, chu: b.hostChoPhep.join(", ") })}>
                        {t("flowStudio.biMat.suaHost")}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{b.phienBanKhoa}</TableCell>
                  <TableCell className="text-xs">{fmtDateTime(b.createdAt)}</TableCell>
                  {laAdmin && (
                    <TableCell>
                      <ConfirmDeleteDialog
                        itemLabel={b.ten}
                        description={t("flowStudio.biMat.xoaMoTa")}
                        onConfirm={() => xoa.mutateAsync({ id: b.id }).then(() => undefined)}
                        trigger={<Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("flowStudio.biMat.xoa")}><Trash2 className="h-4 w-4" /></Button>}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {laAdmin && (
          <form
            className="grid gap-2 md:grid-cols-3 items-end"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (hopLe) tao.mutate({ id, ten: ten.trim(), loai, giaTri, hostChoPhep: tachHost(hostChu), ...(nhaMayBm ? { factoryId: Number(nhaMayBm) } : {}) });
            }}
          >
            <div className="space-y-1"><label className="text-xs">{t("flowStudio.biMat.id")}</label><Input className="h-9 font-mono text-xs" value={id} onChange={(e) => setId(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-xs">{t("flowStudio.biMat.ten")}</label><Input className="h-9 text-sm" value={ten} onChange={(e) => setTen(e.target.value)} /></div>
            <div className="space-y-1">
              <label className="text-xs">{t("flowStudio.biMat.loai")}</label>
              <select className={O_CHON} value={loai} onChange={(e) => setLoai(e.target.value)}>
                {["token", "tai-khoan", "khac"].map((v) => <option key={v} value={v}>{t(`flowStudio.biMat.loaiChon.${v}`)}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs">{t("flowStudio.biMat.giaTri")}</label>
              <Input type="password" autoComplete="new-password" className="h-9 text-sm" value={giaTri} onChange={(e) => setGiaTri(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs">{t("flowStudio.biMat.host")}</label>
              <Input data-testid="bi-mat-host" className="h-9 font-mono text-xs" placeholder="erp.nha-may.vn, api.mes.vn" value={hostChu} onChange={(e) => setHostChu(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs">{t("flowStudio.biMat.nhaMay")}</label>
              <select data-testid="bi-mat-nha-may" className={O_CHON} value={nhaMayBm} onChange={(e) => setNhaMayBm(e.target.value)}>
                <option value="">{t("flowStudio.danhSach.nhaMayToanHeThong")}</option>
                {(dsNhaMay.data ?? []).map((f) => <option key={f.id} value={String(f.id)}>{f.name} ({f.code})</option>)}
              </select>
            </div>
            <Button type="submit" disabled={!hopLe || tao.isPending}>
              {tao.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              {t("flowStudio.biMat.tao")}
            </Button>
          </form>
        )}
        {laAdmin && <p className="text-[11px] text-muted-foreground">{t("flowStudio.biMat.chiGhi")}</p>}
        <Dialog open={!!suaHost} onOpenChange={(o) => !o && setSuaHost(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("flowStudio.biMat.suaHostTieuDe", { id: suaHost?.id ?? "" })}</DialogTitle>
              <DialogDescription>{t("flowStudio.biMat.hostGoiY")}</DialogDescription>
            </DialogHeader>
            <Input data-testid="sua-host-o" className="font-mono text-xs" value={suaHost?.chu ?? ""} onChange={(e) => suaHost && setSuaHost({ ...suaHost, chu: e.target.value })} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setSuaHost(null)}>{t("flowStudio.chung.huy")}</Button>
              <Button data-testid="luu-host" disabled={!suaHost || tachHost(suaHost.chu).length === 0 || datHost.isPending} onClick={() => suaHost && datHost.mutate({ id: suaHost.id, hostChoPhep: tachHost(suaHost.chu) })}>
                {t("flowStudio.biMat.luuHost")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default function AIFlowsPage() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const laAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const ds = trpc.flow.danhSach.useQuery(undefined, { refetchInterval: 10_000 });
  const cho = trpc.flow.danhSachCho.useQuery(undefined, { refetchInterval: 10_000 });
  const mau = trpc.flow.mauLuong.useQuery();

  const [moTao, setMoTao] = useState<null | { mau: FlowDefinition | null }>(null);
  const [tenMoi, setTenMoi] = useState("");
  const [mauChon, setMauChon] = useState<string>("");
  // Đợt 9 — phạm vi nhà máy của luồng MỚI: danh sách nhà máy ĐÃ LỌC theo phạm vi người dùng (`factory.list`).
  // Admin: tuỳ chọn ("" = toàn hệ thống, chỉ admin dùng); thuộc NHIỀU nhà máy: BẮT BUỘC chọn; đúng một nhà máy: máy chủ tự gán.
  const dsNhaMay = trpc.factory.list.useQuery(undefined, { enabled: !!moTao });
  const [nhaMay, setNhaMay] = useState<string>("");
  const nhaMays = dsNhaMay.data ?? [];
  const hienChonNhaMay = laAdmin ? nhaMays.length > 0 : nhaMays.length > 1;
  const canChonNhaMay = !laAdmin && nhaMays.length > 1;
  // Tài khoản thường chưa được gán nhà máy nào ⇒ máy chủ sẽ từ chối (FORBIDDEN) — báo TRƯỚC và vô hiệu nút Tạo.
  const chuaGanNhaMay = !laAdmin && dsNhaMay.isSuccess && nhaMays.length === 0;

  const luu = trpc.flow.luu.useMutation({
    onSuccess: (r) => {
      setMoTao(null);
      void utils.flow.danhSach.invalidate();
      navigate(`/ai-flows/${encodeURIComponent(r.flowId)}`);
    },
    onError: (e) => toastTrpcError(e),
  });

  const datBat = trpc.flow.datPhienBanHoatDong.useMutation({
    onSuccess: (r) => {
      toast.success(r.bat ? t("flowStudio.sua.daBat", { version: r.version }) : t("flowStudio.sua.daTat"));
      void utils.flow.danhSach.invalidate();
    },
    onError: (e) => toastTrpcError(e),
  });

  const taoLuong = () => {
    const ten = tenMoi.trim();
    if (!ten) return;
    const id = idLuongTuTen(ten);
    const m = moTao?.mau ?? null;
    if (chuaGanNhaMay || (canChonNhaMay && !nhaMay)) return;
    luu.mutate({
      definition: (m ? saoTuMau(m, id, ten) : luongMoi(id, ten)) as unknown as Record<string, unknown>,
      ...(hienChonNhaMay && nhaMay ? { factoryId: Number(nhaMay) } : {}),
    });
  };

  const moTuMau = () => {
    const dau = mau.data?.[0];
    setMauChon(dau?.id ?? "");
    setTenMoi(dau ? dau.ten : "");
    setMoTao({ mau: (dau?.definition as FlowDefinition | undefined) ?? null });
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Workflow className="h-6 w-6" />}
          title={t("flowStudio.danhSach.tieuDe")}
          description={t("flowStudio.danhSach.moTa")}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/ai-flows/duyet">
                <Button variant="outline" size="sm" data-testid="link-hop-duyet">
                  <Inbox className="h-4 w-4 mr-1" />
                  {t("flowStudio.danhSach.hopDuyet")}
                  {(cho.data?.length ?? 0) > 0 && <Badge className="ml-1.5 h-5 px-1.5">{cho.data!.length}</Badge>}
                </Button>
              </Link>
              <Button variant="outline" size="sm" data-testid="nut-tao-tu-mau" disabled={!mau.data?.length} onClick={moTuMau}>
                <FileStack className="h-4 w-4 mr-1" />
                {t("flowStudio.danhSach.taoTuMau")}
              </Button>
              <Button size="sm" data-testid="nut-tao-luong" onClick={() => { setTenMoi(""); setMoTao({ mau: null }); }}>
                <Plus className="h-4 w-4 mr-1" />
                {t("flowStudio.danhSach.taoMoi")}
              </Button>
            </div>
          }
        />

        <Card className="mb-4">
          <CardContent className="p-0">
            {ds.isLoading && <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>}
            {ds.error && <p className="p-4 text-sm text-destructive">{mapTrpcError(ds.error)}</p>}
            {ds.data && ds.data.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">{t("flowStudio.danhSach.rong")}</p>}
            {ds.data && ds.data.length > 0 && (
              <Table data-testid="bang-luong">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("flowStudio.danhSach.ten")}</TableHead>
                    <TableHead>{t("flowStudio.danhSach.hang")}</TableHead>
                    <TableHead>{t("flowStudio.danhSach.phienBan")}</TableHead>
                    <TableHead>{t("flowStudio.danhSach.bat")}</TableHead>
                    <TableHead>{t("flowStudio.danhSach.luotCuoi")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("flowStudio.danhSach.capNhat")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ds.data.map((f) => {
                    const id = String(f.id);
                    const hang = laHang(f.riskClass) ? f.riskClass : "thuan";
                    const pbHoatDong = f.activeVersion as number | null;
                    const pbMoi = f.phienBanMoiNhat as number | null;
                    const ttCuoi = f.trangThaiLuotCuoi as string | null;
                    return (
                      <TableRow key={id} data-testid={`luong-${id}`}>
                        <TableCell className="max-w-[320px]">
                          <Link href={`/ai-flows/${encodeURIComponent(id)}`} className="font-medium hover:underline break-words">{String(f.name)}</Link>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">{id}</div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className={MAU_HANG[hang]}>{t(`flowStudio.hang.${hang}`)}</Badge></TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {pbHoatDong ? t("flowStudio.danhSach.pbHoatDong", { v: pbHoatDong }) : t("flowStudio.danhSach.chuaCo")}
                          <span className="text-muted-foreground"> · {t("flowStudio.danhSach.pbMoiNhat", { v: pbMoi ?? "—" })}</span>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={f.enabled === true}
                            disabled={datBat.isPending || !(pbHoatDong ?? pbMoi)}
                            aria-label={t("flowStudio.danhSach.bat")}
                            onCheckedChange={(v) => datBat.mutate({ flowId: id, version: (f.enabled ? pbHoatDong : pbMoi) ?? pbMoi ?? 1, bat: v })}
                          />
                        </TableCell>
                        <TableCell>
                          {ttCuoi ? (
                            <Badge variant="outline" className={`text-[10px] ${MAU_TRANG_THAI[ttCuoi] ?? ""}`}>{t(`flowStudio.trangThai.${ttCuoi}`, { defaultValue: ttCuoi })}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{fmtDateTime(f.updatedAt as string)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <KhoiBiMat laAdmin={laAdmin} />
      </PageContainer>

      <Dialog open={!!moTao} onOpenChange={(o) => !o && setMoTao(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{moTao?.mau ? t("flowStudio.danhSach.taoTuMau") : t("flowStudio.danhSach.taoMoi")}</DialogTitle>
            <DialogDescription>{moTao?.mau ? t("flowStudio.danhSach.taoTuMauMoTa") : t("flowStudio.danhSach.taoMoiMoTa")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {moTao?.mau && (
              <div className="space-y-1">
                <label className="text-xs font-medium">{t("flowStudio.danhSach.mau")}</label>
                <div className="space-y-1" data-testid="ds-mau">
                  {(mau.data ?? []).map((m) => (
                    <label key={m.id} className={`flex items-center gap-2 rounded border px-2 py-1.5 text-sm cursor-pointer ${mauChon === m.id ? "border-primary bg-muted" : ""}`}>
                      <input
                        type="radio"
                        name="mau"
                        checked={mauChon === m.id}
                        onChange={() => {
                          setMauChon(m.id);
                          setTenMoi(m.ten);
                          setMoTao({ mau: m.definition as FlowDefinition });
                        }}
                      />
                      <span className="flex-1">{m.ten}</span>
                      <span className="text-[11px] text-muted-foreground">{t("flowStudio.danhSach.soNode", { n: m.soNode })}</span>
                      {laHang(m.hang) && <Badge variant="outline" className={`text-[10px] ${MAU_HANG[m.hang]}`}>{t(`flowStudio.hang.${m.hang}`)}</Badge>}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {chuaGanNhaMay && (
              <p role="alert" data-testid="chua-gan-nha-may" className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning">
                {t("flowStudio.danhSach.chuaGanNhaMay")}
              </p>
            )}
            {hienChonNhaMay && (
              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="chon-nha-may">{t("flowStudio.danhSach.nhaMay")}</label>
                <select
                  id="chon-nha-may"
                  data-testid="chon-nha-may"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={nhaMay}
                  onChange={(e) => setNhaMay(e.target.value)}
                >
                  <option value="">{laAdmin ? t("flowStudio.danhSach.nhaMayToanHeThong") : t("flowStudio.danhSach.chonNhaMay")}</option>
                  {nhaMays.map((f) => (
                    <option key={f.id} value={String(f.id)}>{f.name} ({f.code})</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">{laAdmin ? t("flowStudio.danhSach.nhaMayGoiYAdmin") : t("flowStudio.danhSach.nhaMayCanChon")}</p>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("flowStudio.danhSach.tenLuong")}</label>
              <Input data-testid="ten-luong-moi" value={tenMoi} onChange={(e) => setTenMoi(e.target.value)} onKeyDown={(e) => e.key === "Enter" && taoLuong()} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoTao(null)}>{t("flowStudio.chung.huy")}</Button>
            <Button data-testid="xac-nhan-tao" disabled={!tenMoi.trim() || luu.isPending || chuaGanNhaMay || (canChonNhaMay && !nhaMay)} onClick={taoLuong}>
              {luu.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t("flowStudio.danhSach.tao")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
