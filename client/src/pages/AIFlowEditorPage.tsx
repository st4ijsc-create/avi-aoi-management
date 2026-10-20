/**
 * ★★ AI Local Đợt 8.3 — TRÌNH SỬA LUỒNG `/ai-flows/:id` (Flow Studio, spec §4.8–4.9).
 *
 * Bố cục: thanh công cụ (tên · hạng · phiên bản · Lưu · Bật/Tắt · Chạy tay) — bảng node (danh mục `flow.danhMucNode`,
 * nhóm theo tiền tố, kéo thả hoặc bấm để thêm) — canvas xyflow — bảng phải (Cấu hình node / Lượt chạy).
 * Lưu = `flow.luu` ⇒ phiên bản MỚI bất biến; bị từ chối ⇒ hiện danh sách lỗi kiểm luồng của máy chủ. Bật/Tắt =
 * `flow.datPhienBanHoatDong` cho phiên bản ĐÃ LƯU đang mở. Chạy tay = `flow.chayTay` (items JSON) ⇒ chuyển sang dòng thời gian
 * và tô node theo trạng thái lượt. `?run=<id>` mở thẳng một lượt (liên kết từ hộp duyệt).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearch } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Inbox, Loader2, Play, Plus, Power, PowerOff, Save, Search, AlertTriangle } from "lucide-react";
import { kiemLuong, type FlowDefinition, type KhaiBaoNut, type NodeInstance } from "@shared/flow/model";
import FlowCanvas, { KIEU_KEO_NUT } from "@/components/aiFlow/FlowCanvas";
import NodeConfigPanel from "@/components/aiFlow/NodeConfigPanel";
import RunTimeline from "@/components/aiFlow/RunTimeline";
import { MAU_HANG, docItemsNhap, laHang, loiBieuThucThamSo, nhomDanhMuc, taoNutMoi, type KhaiBaoNutClient } from "@/lib/flowStudio";

const O_CHON =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function AIFlowEditorPage() {
  const { t } = useTranslation();
  const { id: flowId = "" } = useParams<{ id: string }>();
  const search = useSearch();
  const runTuUrl = new URLSearchParams(search).get("run");
  const utils = trpc.useUtils();

  const [phienBanXem, setPhienBanXem] = useState<number | undefined>(undefined);
  const chiTiet = trpc.flow.chiTiet.useQuery({ flowId, version: phienBanXem }, { enabled: !!flowId });
  const danhMucQ = trpc.flow.danhMucNode.useQuery();
  const biMatQ = trpc.flow.biMatDanhSach.useQuery(undefined, { retry: false });

  const [def, setDef] = useState<FlowDefinition | null>(null);
  const [banNap, setBanNap] = useState<string>("");
  const [chon, setChon] = useState<string | null>(null);
  const [tab, setTab] = useState<"cauHinh" | "chay">(runTuUrl ? "chay" : "cauHinh");
  const [runId, setRunId] = useState<string | null>(runTuUrl);
  const [trangThai, setTrangThai] = useState<Record<string, string>>({});
  const [loiLuu, setLoiLuu] = useState<string[] | null>(null);
  const [locNut, setLocNut] = useState("");
  const [moChay, setMoChay] = useState(false);
  const [itemsChu, setItemsChu] = useState('[\n  { "json": {} }\n]');
  const [tokenMoi, setTokenMoi] = useState<string | null>(null);
  const [lanKhop, setLanKhop] = useState(0);

  // nap dinh nghia tu may chu khi doi phien ban / lan dau
  useEffect(() => {
    const d = chiTiet.data?.definition;
    if (!d) return;
    const khoa = `${flowId}@${chiTiet.data?.version}`;
    if (khoa === banNap) return;
    setDef(JSON.parse(JSON.stringify(d)) as FlowDefinition);
    setBanNap(khoa);
    setLanKhop((k) => k + 1);
    setChon(null);
    setLoiLuu(null);
  }, [chiTiet.data, flowId, banNap]);

  const danhMuc = useMemo(() => new Map<string, KhaiBaoNutClient>((danhMucQ.data ?? []).map((k) => [k.type, k as KhaiBaoNutClient])), [danhMucQ.data]);
  const nhom = useMemo(() => nhomDanhMuc(danhMucQ.data ?? [], locNut), [danhMucQ.data, locNut]);

  const banGoc = chiTiet.data?.definition;
  const dirty = useMemo(() => {
    if (!def || !banGoc) return false;
    const { version: _a, ...x } = def;
    const { version: _b, ...y } = banGoc;
    return JSON.stringify(x) !== JSON.stringify(y);
  }, [def, banGoc]);

  const kiem = useMemo(() => (def && danhMuc.size ? kiemLuong(def, (ty) => danhMuc.get(ty) as KhaiBaoNut | undefined) : null), [def, danhMuc]);
  const soLoiBieuThuc = useMemo(() => (def ? def.nodes.reduce((s, n) => s + Object.keys(loiBieuThucThamSo(n.parameters)).length, 0) : 0), [def]);

  const luong = chiTiet.data?.luong;
  const version = chiTiet.data?.version ?? null;
  const dangBatBanNay = !!luong?.enabled && luong.activeVersion === version;
  const hangHienThi = kiem?.hang ?? (laHang(chiTiet.data?.hang) ? chiTiet.data.hang : "thuan");

  const luu = trpc.flow.luu.useMutation({
    onSuccess: async (r) => {
      setLoiLuu(null);
      toast.success(t("flowStudio.sua.daLuu", { version: r.version }));
      await utils.flow.chiTiet.invalidate({ flowId });
      setPhienBanXem(r.version);
    },
    onError: (e) => {
      const m = e.message.replace(/^[^:]*:\s*/, "");
      setLoiLuu(e.data?.code === "BAD_REQUEST" ? m.split(/;\s*/).filter(Boolean) : [mapTrpcError(e)]);
    },
  });

  const datBat = trpc.flow.datPhienBanHoatDong.useMutation({
    onSuccess: async (r) => {
      toast.success(r.bat ? t("flowStudio.sua.daBat", { version: r.version }) : t("flowStudio.sua.daTat"));
      if (r.tokenWebhook) setTokenMoi(r.tokenWebhook);
      await utils.flow.chiTiet.invalidate({ flowId });
      void utils.flow.danhSach.invalidate();
    },
    onError: (e) => toastTrpcError(e),
  });

  const chayTay = trpc.flow.chayTay.useMutation({
    onSuccess: (r) => {
      setMoChay(false);
      setRunId(r.runId);
      setTab("chay");
      toast.success(t("flowStudio.sua.daChay", { version: r.version }));
      void utils.flow.lichSuChay.invalidate({ flowId });
    },
    onError: (e) => toastTrpcError(e),
  });

  const doiNut = useCallback((n: NodeInstance) => setDef((d) => (d ? { ...d, nodes: d.nodes.map((x) => (x.id === n.id ? n : x)) } : d)), []);
  const xoaNut = useCallback((id: string) => {
    setDef((d) => (d ? { ...d, nodes: d.nodes.filter((x) => x.id !== id), connections: d.connections.filter((c) => c.from.node !== id && c.to.node !== id) } : d));
    setChon(null);
  }, []);
  const themNut = (kb: KhaiBaoNutClient) => {
    if (!def) return;
    // dat canh node dang chon (cot ke tiep, xep doc neu cot da co node); khong chon => cuoi hang
    const sel = def.nodes.find((x) => x.id === chon);
    const maxX = def.nodes.reduce((m, n) => Math.max(m, n.position[0]), -260);
    const x = sel ? sel.position[0] + 260 : maxX + 260;
    const cungCot = def.nodes.filter((m) => Math.abs(m.position[0] - x) < 100);
    const y = sel ? sel.position[1] + cungCot.length * 140 : 0;
    const n = taoNutMoi(kb, def.nodes.map((v) => v.id), [x, y]);
    setDef({ ...def, nodes: [...def.nodes, n] });
    setChon(n.id);
    setTab("cauHinh");
    setLanKhop((k) => k + 1);
  };

  // luot dang xem thuoc phien ban khac => canvas chuyen sang dung phien ban do (khi khong co thay doi chua luu)
  const nhanTrangThaiLuot = useCallback(
    (m: Record<string, string>, pb: number | null) => {
      setTrangThai(m);
      if (pb && version && pb !== version && !dirty) setPhienBanXem(pb);
    },
    [version, dirty],
  );

  const nutChon = def?.nodes.find((n) => n.id === chon) ?? null;
  const tenNut = useCallback((id: string) => def?.nodes.find((n) => n.id === id)?.name ?? id, [def]);

  const batDauChay = () => {
    const r = docItemsNhap(itemsChu);
    if (!r.ok) {
      toast.error(t("flowStudio.sua.itemsHong"));
      return;
    }
    chayTay.mutate({ flowId, items: r.items.length ? r.items : undefined, version: version ?? undefined });
  };

  if (chiTiet.error) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-3">
          <p className="text-destructive">{mapTrpcError(chiTiet.error)}</p>
          <Link href="/ai-flows"><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1" />{t("flowStudio.sua.quayLai")}</Button></Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)] min-h-[560px]" data-testid="flow-editor">
        {/* thanh cong cu */}
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <Link href="/ai-flows">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("flowStudio.sua.quayLai")}><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <Input
            data-testid="flow-ten"
            className="h-8 w-64 text-sm font-medium"
            value={def?.name ?? ""}
            onChange={(e) => def && setDef({ ...def, name: e.target.value })}
            aria-label={t("flowStudio.sua.tenLuong")}
          />
          <span className="text-[11px] text-muted-foreground font-mono hidden md:inline">{flowId}</span>
          <Badge variant="outline" className={MAU_HANG[hangHienThi]} data-testid="flow-hang">{t(`flowStudio.hang.${hangHienThi}`)}</Badge>
          <select
            className={O_CHON}
            data-testid="flow-phien-ban"
            aria-label={t("flowStudio.sua.phienBan")}
            value={version ?? ""}
            onChange={(e) => setPhienBanXem(Number(e.target.value))}
          >
            {(chiTiet.data?.dsPhienBan ?? []).map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}{luong?.activeVersion === v.version ? ` · ${t("flowStudio.sua.hoatDong")}` : ""}
              </option>
            ))}
          </select>
          <Badge variant="outline" data-testid="flow-trang-thai-bat" className={dangBatBanNay ? "bg-success/15 text-success border-success/40" : ""}>
            {luong?.enabled ? t("flowStudio.sua.dangBat", { version: luong.activeVersion }) : t("flowStudio.sua.dangTat")}
          </Badge>
          {dirty && <Badge variant="outline" className="bg-warning/15 text-warning border-warning/40">{t("flowStudio.sua.chuaLuu")}</Badge>}
          {(kiem && !kiem.ok) || soLoiBieuThuc > 0 ? (
            <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/40" title={kiem?.loi.join("\n")}>
              <AlertTriangle className="h-3 w-3 mr-1" />
              {t("flowStudio.sua.soLoi", { n: Math.max(kiem?.loi.length ?? 0, soLoiBieuThuc) })}
            </Badge>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" data-testid="nut-luu" disabled={!def || luu.isPending} onClick={() => def && luu.mutate({ definition: def as unknown as Record<string, unknown> })}>
              {luu.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              {t("flowStudio.sua.luu")}
            </Button>
            {dangBatBanNay ? (
              <Button size="sm" variant="outline" data-testid="nut-tat" disabled={datBat.isPending || !version} onClick={() => version && datBat.mutate({ flowId, version, bat: false })}>
                <PowerOff className="h-4 w-4 mr-1" />
                {t("flowStudio.sua.tat")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                data-testid="nut-bat"
                disabled={datBat.isPending || !version || dirty}
                title={dirty ? t("flowStudio.sua.luuTruocKhiBat") : undefined}
                onClick={() => version && datBat.mutate({ flowId, version, bat: true })}
              >
                <Power className="h-4 w-4 mr-1" />
                {t("flowStudio.sua.bat", { version: version ?? "" })}
              </Button>
            )}
            <Button size="sm" variant="secondary" data-testid="nut-chay-tay" disabled={!version} onClick={() => setMoChay(true)}>
              <Play className="h-4 w-4 mr-1" />
              {t("flowStudio.sua.chayTay")}
            </Button>
            <Link href="/ai-flows/duyet">
              <Button size="sm" variant="ghost"><Inbox className="h-4 w-4 mr-1" />{t("flowStudio.danhSach.hopDuyet")}</Button>
            </Link>
          </div>
        </div>

        {loiLuu && (
          <div className="border-b bg-destructive/10 px-4 py-2 text-sm" role="alert" data-testid="loi-luu">
            <div className="font-medium text-destructive mb-1">{t("flowStudio.sua.biTuChoi")}</div>
            <ul className="list-disc pl-5 text-xs space-y-0.5">
              {loiLuu.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {/* bang node */}
          <aside className="w-56 shrink-0 border-r overflow-y-auto p-2 space-y-3 hidden md:block" data-testid="bang-node">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="h-8 pl-7 text-xs" placeholder={t("flowStudio.sua.timNode")} value={locNut} onChange={(e) => setLocNut(e.target.value)} />
            </div>
            {nhom.map((g) => (
              <div key={g.nhom}>
                <div className="text-[11px] font-semibold uppercase text-muted-foreground mb-1">{t(`flowStudio.nhom.${g.nhom}`, { defaultValue: g.nhom })}</div>
                <div className="space-y-1">
                  {g.nut.map((k) => (
                    <div
                      key={k.type}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(KIEU_KEO_NUT, k.type);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className="group flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs cursor-grab hover:border-primary"
                      data-testid={`palette-${k.type}`}
                    >
                      <span className="font-mono truncate flex-1" title={k.type}>{k.type}</span>
                      <span className={`h-2 w-2 rounded-full shrink-0 border ${MAU_HANG[k.tacDungPhu]}`} title={t(`flowStudio.hang.${k.tacDungPhu}`)} />
                      <button
                        type="button"
                        className="opacity-60 group-hover:opacity-100"
                        aria-label={t("flowStudio.sua.themNode", { type: k.type })}
                        data-testid={`them-${k.type}`}
                        onClick={() => themNut(k)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </aside>

          {/* canvas */}
          <main className="flex-1 min-w-0 relative">
            {!def || !danhMucQ.data ? (
              <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <FlowCanvas
                def={def}
                danhMuc={danhMuc}
                onChange={setDef}
                chon={chon}
                onChon={(id) => {
                  setChon(id);
                  if (id) setTab("cauHinh");
                }}
                trangThai={tab === "chay" ? trangThai : undefined}
                khop={lanKhop}
              />
            )}
          </main>

          {/* bang phai */}
          <aside className="w-[380px] shrink-0 border-l overflow-y-auto" data-testid="bang-phai">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "cauHinh" | "chay")}>
              <TabsList className="m-2 grid grid-cols-2">
                <TabsTrigger value="cauHinh" data-testid="tab-cau-hinh">{t("flowStudio.sua.tabCauHinh")}</TabsTrigger>
                <TabsTrigger value="chay" data-testid="tab-chay">{t("flowStudio.sua.tabChay")}</TabsTrigger>
              </TabsList>
              <TabsContent value="cauHinh" className="px-3 pb-4">
                {nutChon ? (
                  <NodeConfigPanel
                    key={nutChon.id}
                    node={nutChon}
                    kb={danhMuc.get(nutChon.type)}
                    onDoi={doiNut}
                    onXoa={() => xoaNut(nutChon.id)}
                    biMat={biMatQ.data ?? undefined}
                    webhook={{
                      flowId,
                      coToken: !!chiTiet.data?.coTokenWebhook,
                      dangBat: dangBatBanNay,
                      dangXoay: datBat.isPending,
                      tokenMoi,
                      onXoay: () => version && datBat.mutate({ flowId, version, bat: true, xoayToken: true }),
                    }}
                  />
                ) : (
                  def && (
                    <div className="space-y-3 text-sm">
                      <p className="text-xs text-muted-foreground">{t("flowStudio.sua.chonNodeGoiY")}</p>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">{t("flowStudio.sua.uuTien")}</label>
                        <select
                          className={`${O_CHON} w-full`}
                          value={def.settings?.uuTien ?? "background"}
                          onChange={(e) => setDef({ ...def, settings: { ...def.settings, uuTien: e.target.value as FlowDefinition["settings"]["uuTien"] } })}
                        >
                          {(["interactive", "agent", "background"] as const).map((v) => <option key={v} value={v}>{t(`flowStudio.sua.uuTienChon.${v}`)}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">{t("flowStudio.sua.luuDuLieu")}</label>
                        <select
                          className={`${O_CHON} w-full`}
                          value={def.settings?.luuDuLieu ?? "day-du"}
                          onChange={(e) => setDef({ ...def, settings: { ...def.settings, luuDuLieu: e.target.value as FlowDefinition["settings"]["luuDuLieu"] } })}
                        >
                          {(["day-du", "chi-loi", "khong"] as const).map((v) => <option key={v} value={v}>{t(`flowStudio.sua.luuDuLieuChon.${v}`)}</option>)}
                        </select>
                      </div>
                      {kiem && kiem.loi.length > 0 && (
                        <div className="rounded border border-destructive/40 bg-destructive/10 p-2">
                          <div className="text-xs font-medium text-destructive mb-1">{t("flowStudio.sua.loiKiemTruoc")}</div>
                          <ul className="list-disc pl-4 text-[11px] space-y-0.5">{kiem.loi.map((l, i) => <li key={i}>{l}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  )
                )}
              </TabsContent>
              <TabsContent value="chay" className="px-3 pb-4">
                <RunTimeline flowId={flowId} runId={runId} onChonRun={setRunId} tenNut={tenNut} onTrangThai={nhanTrangThaiLuot} />
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      </div>

      <Dialog open={moChay} onOpenChange={setMoChay}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("flowStudio.sua.chayTayTieuDe")}</DialogTitle>
            <DialogDescription>
              {t("flowStudio.sua.chayTayMoTa", { version: version ?? "" })}
              {dirty ? ` ${t("flowStudio.sua.chayTayChuaLuu")}` : ""}
            </DialogDescription>
          </DialogHeader>
          <Textarea data-testid="items-json" className="font-mono text-xs min-h-[180px]" value={itemsChu} onChange={(e) => setItemsChu(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoChay(false)}>{t("flowStudio.chung.huy")}</Button>
            <Button data-testid="xac-nhan-chay" disabled={chayTay.isPending} onClick={batDauChay}>
              {chayTay.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
              {t("flowStudio.sua.chay")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
