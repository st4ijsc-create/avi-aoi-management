/**
 * ★★ Đợt 7.4 (AI Local) — "TRUNG TÂM MODEL": màn quản trị sổ model (spec §3.3, §3.5, §3.6, §3.8).
 *
 * Năm tab đọc MỘT thủ tục `aiGguf.soModelTongQuan` (admin + 2FA + MOD_AI; người khác FORBIDDEN ⇒ khối ẩn):
 *   • Vai trò & gán — model mỗi vai trò đang phân giải ra + lý do định tuyến; gán còn hiệu lực; form "Đặt gán"
 *     (`soModelDatGan` — cổng active: hồ sơ cần ≥ 1 lượt đo + giấy phép ≠ unknown; lời từ chối của máy chủ hiện nguyên văn).
 *   • Kho model — artifact + "Đồng bộ kho" (`soModelDongBoKho`) + khai giấy phép / cách ly (`soModelSuaArtifact`).
 *   • Hồ sơ phục vụ — danh sách + form tạo/sửa (`soModelTaoHoSo`; cờ server/sampling chưa mở ở v1).
 *   • Khe nặng — thống kê bộ giám sát khe nặng của TIẾN TRÌNH API (tự làm mới 5 s khi tab mở).
 *   • Đo — `ai_model_eval_runs` (100 lượt mới nhất), xếp theo độ đúng trước, tốc độ sau.
 * Mọi chữ giao diện qua i18n `gguf.trungTam.*` (vi/en/zh).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { hoSoDangGan, luotTotNhat, soSanh, tapDangGan, tiLeDat, type LuotDo } from "@/lib/soSanhLuotDo";
import { AlertTriangle, Boxes, Loader2, RefreshCw } from "lucide-react";

type TongQuan = inferRouterOutputs<AppRouter>["aiGguf"]["soModelTongQuan"];
type Artifact = TongQuan["artifacts"][number];
type HoSo = TongQuan["profiles"][number];

const GB = 1e9;
const O_NHAP =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PHAM_VI = ["global", "tenant", "project", "flow", "be-mat"] as const;
const CHE_DO = ["thu", "shadow", "active"] as const;
const KHE = ["nang", "nho", "sidecar"] as const;
const SUY_NGHI = ["auto", "on", "off"] as const;
const RE_ID_HO_SO = /^[a-z0-9][a-z0-9.@-]{0,95}$/;
const RE_GIAY_PHEP = /^[a-z0-9][a-z0-9.+_-]{0,47}$/;

function soB(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `${n}B` : "—";
}

function giay(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export default function TrungTamModel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("vai-tro");
  const tq = trpc.aiGguf.soModelTongQuan.useQuery(undefined, {
    retry: false,
    // Khe nặng đổi theo giây ⇒ 5 s khi tab Khe mở; còn lại 30 s (sổ hiếm khi đổi, và mutation tự refetch).
    refetchInterval: tab === "khe" ? 5000 : 30000,
  });

  if (tq.error && /FORBIDDEN|UNAUTHORIZED/.test(tq.error.data?.code ?? "")) return null;
  const d = tq.data;

  return (
    <Card data-testid="trung-tam-model">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="h-4 w-4" aria-hidden />
          {t("gguf.trungTam.tieuDe", "Trung tâm Model")}
        </CardTitle>
        <CardDescription>{t("gguf.trungTam.moTa", "Sổ model: vai trò → model, kho tệp GGUF, hồ sơ phục vụ, khe nặng và kết quả đo.")}</CardDescription>
      </CardHeader>
      <CardContent>
        {tq.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("gguf.trungTam.dangTai", "Đang đọc sổ model…")}</p>
        ) : tq.error ? (
          <p className="text-sm text-destructive">{mapTrpcError(tq.error)}</p>
        ) : d ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="vai-tro">{t("gguf.trungTam.tab.vaiTro", "Vai trò & gán")}</TabsTrigger>
              <TabsTrigger value="kho">{t("gguf.trungTam.tab.kho", "Kho model")}</TabsTrigger>
              <TabsTrigger value="ho-so">{t("gguf.trungTam.tab.hoSo", "Hồ sơ phục vụ")}</TabsTrigger>
              <TabsTrigger value="khe">{t("gguf.trungTam.tab.khe", "Khe nặng")}</TabsTrigger>
              <TabsTrigger value="do">{t("gguf.trungTam.tab.do", "Đo")}</TabsTrigger>
            </TabsList>
            {d.taiLuc === 0 && (
              <p className="mt-2 text-xs text-warning">{t("gguf.trungTam.anhRong", "Sổ model chưa nạp được (CSDL/migration) — định tuyến đang dùng .env.")}</p>
            )}
            <TabsContent value="vai-tro" className="space-y-4">
              <TabVaiTro d={d} lamMoi={() => void tq.refetch()} />
            </TabsContent>
            <TabsContent value="kho" className="space-y-4">
              <TabKho d={d} lamMoi={() => void tq.refetch()} />
            </TabsContent>
            <TabsContent value="ho-so" className="space-y-4">
              <TabHoSo d={d} lamMoi={() => void tq.refetch()} />
            </TabsContent>
            <TabsContent value="khe" className="space-y-4">
              <TabKhe d={d} />
            </TabsContent>
            <TabsContent value="do" className="space-y-4">
              <TabDo d={d} />
            </TabsContent>
          </Tabs>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Vai trò & gán ─────────────────────────────────────────────────────────────

function TabVaiTro({ d, lamMoi }: { d: TongQuan; lamMoi: () => void }) {
  const { t } = useTranslation();
  const envKeys = useMemo(() => [...new Set(d.vaiTro.map((v) => v.envKey))].sort(), [d.vaiTro]);
  const [roleId, setRoleId] = useState("");
  const [scopeKind, setScopeKind] = useState<(typeof PHAM_VI)[number]>("global");
  const [scopeId, setScopeId] = useState("");
  const [loaiDich, setLoaiDich] = useState<"profile" | "env">("env");
  const [dich, setDich] = useState("");
  const [fallback, setFallback] = useState("");
  const [mode, setMode] = useState<(typeof CHE_DO)[number]>("thu");

  const datGan = trpc.aiGguf.soModelDatGan.useMutation({
    onSuccess: (r) => {
      toast.success(t("gguf.trungTam.datGan.daDat", "Đã đặt gán (thay {{n}} gán cũ).", { n: r.daThay }));
      lamMoi();
    },
  });
  // i18n-raw-ok: lời từ chối CỔNG của sổ model (chưa đo / giấy phép chưa rõ / đích sai) là câu chỉ dẫn hành động do máy chủ soạn;
  // câu đã dịch theo mã (mapTrpcError) chỉ nói "không thực hiện được", nên hiện thêm nguyên văn làm chi tiết.
  const chiTietLoi = datGan.error?.message ?? "";

  const roleMoTa = new Map(d.vaiTro.map((v) => [v.id, v.moTa]));
  const dsFallback = fallback.split(",").map((s) => s.trim()).filter(Boolean);
  // Số đo cạnh nhau: bộ đo của vai trò; hồ sơ đang gán (active toàn cục) so với hồ sơ đích — CHỈ so trực tiếp khi cùng bộ đo.
  const suite = d.vaiTro.find((v) => v.id === roleId)?.evalSuite ?? null;
  const hienTaiId = roleId ? hoSoDangGan(d.gan, roleId) : null;
  const dichHoSo = loaiDich === "profile" && dich ? dich : null;
  const luotDich = luotTotNhat(d.evalRuns, dichHoSo, suite);
  const luotHienTai = luotTotNhat(d.evalRuns, hienTaiId, suite);
  const dichCoDo = !!dichHoSo && d.hoSoCoDo.includes(dichHoSo);
  // Cổng máy chủ (CHUA_CO_DO): chế độ active trỏ hồ sơ chưa có lượt đo nào ⇒ UI vô hiệu nút và nói rõ lý do (máy chủ vẫn là nơi chặn thật).
  const chanVIChuaDo = mode === "active" && !!dichHoSo && !dichCoDo;
  const hopLe = !!roleId && !!dich && (scopeKind === "global" || /^[A-Za-z0-9_-]{1,64}$/.test(scopeId)) && dsFallback.length <= 4 && !chanVIChuaDo;

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("gguf.trungTam.vaiTro.cot.id", "Vai trò")}</TableHead>
              <TableHead>{t("gguf.trungTam.vaiTro.cot.moTa", "Mô tả")}</TableHead>
              <TableHead>{t("gguf.trungTam.vaiTro.cot.model", "Model phân giải")}</TableHead>
              <TableHead>{t("gguf.trungTam.vaiTro.cot.lyDo", "Lý do định tuyến")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.vaiTro.map((v) => (
              <TableRow key={v.id} data-vai-tro={v.id}>
                <TableCell className="font-mono text-xs">{v.id}</TableCell>
                <TableCell className="text-xs">{v.moTa ?? "—"}</TableCell>
                <TableCell className="text-xs whitespace-normal break-all">
                  {v.dinhTuyen.model ?? <span className="text-muted-foreground">{t("gguf.trungTam.vaiTro.macDinhEngine", "mặc định của engine")}</span>}
                  <Badge variant="outline" className="ml-1">{t(`gguf.trungTam.nguon.${v.dinhTuyen.nguon}`, v.dinhTuyen.nguon)}</Badge>
                </TableCell>
                <TableCell className="min-w-[16rem] text-xs text-muted-foreground whitespace-normal break-all">
                  {t("gguf.trungTam.vaiTro.tang", "tầng {{n}}", { n: v.dinhTuyen.lyDo.tang })} · {v.dinhTuyen.lyDo.bangChung}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-medium">{t("gguf.trungTam.gan.tieuDe", "Gán còn hiệu lực")}</h4>
        {d.gan.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("gguf.trungTam.gan.rong", "Chưa có gán nào — mọi vai trò đi theo .env.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("gguf.trungTam.vaiTro.cot.id", "Vai trò")}</TableHead>
                  <TableHead>{t("gguf.trungTam.gan.cot.phamVi", "Phạm vi")}</TableHead>
                  <TableHead>{t("gguf.trungTam.gan.cot.cheDo", "Chế độ")}</TableHead>
                  <TableHead>{t("gguf.trungTam.gan.cot.dich", "Đích")}</TableHead>
                  <TableHead>{t("gguf.trungTam.gan.cot.duPhong", "Dự phòng")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.gan.map((g, i) => (
                  <TableRow key={`${g.roleId}-${g.scopeKind}-${g.scopeId ?? ""}-${g.mode}-${i}`}>
                    <TableCell className="font-mono text-xs">{g.roleId}</TableCell>
                    <TableCell className="text-xs">
                      {t(`gguf.trungTam.phamVi.${g.scopeKind}`, g.scopeKind)}
                      {g.scopeId ? <span className="ml-1 font-mono text-muted-foreground">{g.scopeId}</span> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={g.mode === "active" ? "default" : "secondary"}>{t(`gguf.trungTam.cheDo.${g.mode}`, g.mode)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal break-all">
                      {g.profileId ? (
                        <>
                          <span className="text-muted-foreground">{t("gguf.trungTam.gan.hoSo", "hồ sơ")}: </span>
                          <span className="font-mono">{g.profileId}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-muted-foreground">{t("gguf.trungTam.gan.envKey", "khoá .env")}: </span>
                          <span className="font-mono">{g.envKey}</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-normal break-all">{g.fallback.length ? g.fallback.join(" → ") : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <form
        className="space-y-3 rounded-md border p-3"
        data-testid="form-dat-gan"
        onSubmit={(e) => {
          e.preventDefault();
          if (!hopLe) return;
          datGan.mutate({
            roleId,
            scopeKind,
            scopeId: scopeKind === "global" ? null : scopeId,
            profileId: loaiDich === "profile" ? dich : null,
            envKey: loaiDich === "env" ? dich : null,
            fallback: dsFallback,
            mode,
          });
        }}
      >
        <h4 className="text-sm font-medium">{t("gguf.trungTam.datGan.tieuDe", "Đặt gán")}</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span>{t("gguf.trungTam.vaiTro.cot.id", "Vai trò")}</span>
            <select className={O_NHAP} value={roleId} onChange={(e) => setRoleId(e.target.value)} name="roleId">
              <option value="">{t("gguf.trungTam.chon", "— chọn —")}</option>
              {d.vaiTro.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
            </select>
            {roleId && roleMoTa.get(roleId) ? <span className="text-muted-foreground">{roleMoTa.get(roleId)}</span> : null}
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("gguf.trungTam.gan.cot.phamVi", "Phạm vi")}</span>
            <select className={O_NHAP} value={scopeKind} onChange={(e) => setScopeKind(e.target.value as (typeof PHAM_VI)[number])} name="scopeKind">
              {PHAM_VI.map((p) => (
                <option key={p} value={p}>
                  {t(`gguf.trungTam.phamVi.${p}`, p)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("gguf.trungTam.datGan.maPhamVi", "Mã phạm vi")}</span>
            <Input className="h-8 text-xs" value={scopeId} disabled={scopeKind === "global"} onChange={(e) => setScopeId(e.target.value)} name="scopeId" />
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("gguf.trungTam.datGan.loaiDich", "Loại đích")}</span>
            <select
              className={O_NHAP}
              value={loaiDich}
              name="loaiDich"
              onChange={(e) => {
                setLoaiDich(e.target.value as "profile" | "env");
                setDich("");
              }}
            >
              <option value="env">{t("gguf.trungTam.gan.envKey", "khoá .env")}</option>
              <option value="profile">{t("gguf.trungTam.gan.hoSo", "hồ sơ")}</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("gguf.trungTam.gan.cot.dich", "Đích")}</span>
            <select className={O_NHAP} value={dich} onChange={(e) => setDich(e.target.value)} name="dich">
              <option value="">{t("gguf.trungTam.chon", "— chọn —")}</option>
              {(loaiDich === "env" ? envKeys : d.profiles.map((p) => p.id)).map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("gguf.trungTam.gan.cot.cheDo", "Chế độ")}</span>
            <select className={O_NHAP} value={mode} onChange={(e) => setMode(e.target.value as (typeof CHE_DO)[number])} name="mode">
              {CHE_DO.map((m) => (
                <option key={m} value={m}>
                  {t(`gguf.trungTam.cheDo.${m}`, m)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs sm:col-span-3">
            <span>{t("gguf.trungTam.datGan.duPhong", "Dự phòng (mã hồ sơ, cách nhau dấu phẩy, tối đa 4)")}</span>
            <Input className="h-8 text-xs" value={fallback} onChange={(e) => setFallback(e.target.value)} name="fallback" />
          </label>
        </div>
        {roleId && dichHoSo ? (
          <SoDoCanhNhau suite={suite} hienTaiId={hienTaiId} dichId={dichHoSo} luotHienTai={luotHienTai} luotDich={luotDich} dichCoDo={dichCoDo} />
        ) : null}
        {chanVIChuaDo ? (
          <p className="text-xs text-destructive" role="status" data-testid="ly-do-chan-gan">
            {t("gguf.trungTam.datGan.chuaDoChan", "Hồ sơ {{id}} chưa có lượt đo nào — chưa gán active được. Gán ở chế độ 'thử', chạy bộ đo của vai trò, rồi mới active.", { id: dichHoSo })}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("gguf.trungTam.datGan.cong", "Chế độ active trỏ hồ sơ cần ≥ 1 lượt đo của hồ sơ đó và giấy phép model đã khai. Gán theo khoá .env không cần đo.")}</p>
        <Button type="submit" size="sm" disabled={!hopLe || datGan.isPending}>
          {datGan.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("gguf.trungTam.datGan.nut", "Đặt gán")}
        </Button>
        {datGan.error && (
          <div className="rounded-md border border-destructive/40 p-2 text-sm text-destructive" role="alert" data-testid="loi-dat-gan">
            <p>{mapTrpcError(datGan.error)}</p>
            {chiTietLoi ? <p className="mt-1 text-xs break-words">{chiTietLoi}</p> : null}
          </div>
        )}
      </form>
    </>
  );
}

function MotLuot({ nhan, id, luot }: { nhan: "hienTai" | "dich"; id: string | null; luot: LuotDo | null }) {
  const { t } = useTranslation();
  const tl = luot ? tiLeDat(luot) : null;
  return (
    <div className="rounded-md border p-2 text-xs" data-testid={`so-do-${nhan}`}>
      <div className="text-muted-foreground">{nhan === "hienTai" ? t("gguf.trungTam.soDo.hienTai", "Đang gán") : t("gguf.trungTam.soDo.dich", "Đích")}</div>
      <div className="font-mono break-all">{id ?? t("gguf.trungTam.soDo.khongCo", "— (không có hồ sơ)")}</div>
      {luot ? (
        <div>
          {luot.nPass ?? "?"}/{luot.nTasks ?? "?"}×{luot.nRuns ?? 1}
          {tl !== null ? ` (${Math.round(tl * 100)} %)` : ""} · p50 {luot.p50Ms !== null ? giay(luot.p50Ms) : "—"} / p90 {luot.p90Ms !== null ? giay(luot.p90Ms) : "—"}
        </div>
      ) : (
        <div className="text-muted-foreground">{t("gguf.trungTam.soDo.chuaDo", "chưa có lượt đo ở bộ này")}</div>
      )}
    </div>
  );
}

function SoDoCanhNhau({ suite, hienTaiId, dichId, luotHienTai, luotDich, dichCoDo }: { suite: string | null; hienTaiId: string | null; dichId: string; luotHienTai: LuotDo | null; luotDich: LuotDo | null; dichCoDo: boolean }) {
  const { t } = useTranslation();
  const kq = soSanh(luotHienTai, luotDich);
  return (
    <div className="space-y-2" data-testid="so-do-canh-nhau">
      <h5 className="text-xs font-medium">
        {t("gguf.trungTam.soDo.tieuDe", "Số đo")}
        {suite ? <span className="ml-1 font-mono text-muted-foreground">{suite}</span> : null}
      </h5>
      {!suite ? <p className="text-xs text-muted-foreground">{t("gguf.trungTam.soDo.khongCoBoDo", "Vai trò này chưa khai bộ đo — không so trực tiếp được.")}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <MotLuot nhan="hienTai" id={hienTaiId} luot={luotHienTai} />
        <MotLuot nhan="dich" id={dichId} luot={luotDich} />
      </div>
      {suite && !luotDich && dichCoDo ? (
        <p className="text-xs text-muted-foreground">{t("gguf.trungTam.soDo.boKhac", "Hồ sơ đích có lượt đo nhưng ở bộ đo khác — không so trực tiếp.")}</p>
      ) : null}
      {kq === "hon" ? (
        <p className="text-xs" data-testid="ket-qua-so-sanh" data-ket-qua="hon">{t("gguf.trungTam.soDo.kq.hon", "Đích tốt hơn hồ sơ đang gán.")}</p>
      ) : kq === "kem" ? (
        <p className="text-xs" data-testid="ket-qua-so-sanh" data-ket-qua="kem">{t("gguf.trungTam.soDo.kq.kem", "Đích KÉM hơn hồ sơ đang gán.")}</p>
      ) : kq === "bang" ? (
        <p className="text-xs" data-testid="ket-qua-so-sanh" data-ket-qua="bang">{t("gguf.trungTam.soDo.kq.bang", "Đích ngang hồ sơ đang gán.")}</p>
      ) : null}
    </div>
  );
}

// ─── Kho model ─────────────────────────────────────────────────────────────────

function DongArtifact({ a, lamMoi }: { a: Artifact; lamMoi: () => void }) {
  const { t } = useTranslation();
  const [license, setLicense] = useState(a.license);
  const sua = trpc.aiGguf.soModelSuaArtifact.useMutation({
    onSuccess: () => {
      toast.success(t("gguf.trungTam.kho.daLuu", "Đã lưu artifact."));
      lamMoi();
    },
    onError: (e) => toastTrpcError(e),
  });
  const licenseHopLe = RE_GIAY_PHEP.test(license.trim());
  return (
    <TableRow data-artifact={a.id}>
      <TableCell className="min-w-[14rem] font-mono text-xs whitespace-normal break-all">{a.filePath}</TableCell>
      <TableCell className="text-xs">{a.family}</TableCell>
      <TableCell className="text-xs">
        {soB(a.paramsTotalB)} / {soB(a.paramsActiveB)}
      </TableCell>
      <TableCell className="text-xs">{a.quant ?? "—"}</TableCell>
      <TableCell className="text-xs">{a.sizeBytes ? (a.sizeBytes / GB).toFixed(1) : "—"}</TableCell>
      <TableCell className="text-xs">{t(`gguf.trungTam.loai.${a.loai}`, a.loai)}</TableCell>
      <TableCell>
        <Badge variant={a.status === "available" ? "default" : a.status === "missing" ? "destructive" : "secondary"}>{t(`gguf.trungTam.trangThai.${a.status}`, a.status)}</Badge>
      </TableCell>
      <TableCell className="min-w-[12rem] text-xs whitespace-normal">
        <div className="flex items-center gap-1">
          <Input className="h-7 text-xs" value={license} onChange={(e) => setLicense(e.target.value)} aria-label={t("gguf.trungTam.kho.cot.giayPhep", "Giấy phép")} />
          <Button size="sm" variant="outline" className="h-7" disabled={!licenseHopLe || license.trim() === a.license || sua.isPending} onClick={() => sua.mutate({ id: a.id, license: license.trim() })}>
            {t("gguf.trungTam.luu", "Lưu")}
          </Button>
        </div>
        {a.license === "unknown" && (
          <p className="mt-1 flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {t("gguf.trungTam.kho.chuaGanActive", "Giấy phép chưa khai — chưa gán active được.")}
          </p>
        )}
      </TableCell>
      <TableCell>
        {a.status !== "missing" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={sua.isPending}
            onClick={() => sua.mutate({ id: a.id, status: a.status === "quarantined" ? "available" : "quarantined" })}
          >
            {a.status === "quarantined" ? t("gguf.trungTam.kho.boCachLy", "Bỏ cách ly") : t("gguf.trungTam.kho.cachLy", "Cách ly")}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function TabKho({ d, lamMoi }: { d: TongQuan; lamMoi: () => void }) {
  const { t } = useTranslation();
  const dongBo = trpc.aiGguf.soModelDongBoKho.useMutation({
    onSuccess: (r) => {
      toast.success(t("gguf.trungTam.kho.daDongBo", "Đồng bộ xong: thêm {{them}}, cập nhật {{capNhat}}, mất {{mat}}.", r));
      lamMoi();
    },
    onError: (e) => toastTrpcError(e),
  });
  const ds = [...d.artifacts].sort((a, b) => a.filePath.localeCompare(b.filePath));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={dongBo.isPending} onClick={() => dongBo.mutate()}>
          {dongBo.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-1 h-4 w-4" aria-hidden />}
          {t("gguf.trungTam.kho.dongBo", "Đồng bộ kho")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("gguf.trungTam.kho.ghiChu", "Quét thư mục GGUF: thêm tệp mới, đánh dấu tệp mất / có lại. Giấy phép không tự đoán.")}</span>
      </div>
      {ds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("gguf.trungTam.kho.rong", "Kho chưa có artifact — bấm Đồng bộ kho.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("gguf.trungTam.kho.cot.tep", "Tệp")}</TableHead>
                <TableHead>{t("gguf.trungTam.kho.cot.ho", "Họ")}</TableHead>
                <TableHead>{t("gguf.trungTam.kho.cot.thamSo", "Tham số tổng / hoạt động")}</TableHead>
                <TableHead>{t("gguf.trungTam.kho.cot.quant", "Quant")}</TableHead>
                <TableHead>{t("gguf.trungTam.kho.cot.kichThuoc", "GB")}</TableHead>
                <TableHead>{t("gguf.trungTam.kho.cot.loai", "Loại")}</TableHead>
                <TableHead>{t("gguf.trungTam.kho.cot.trangThai", "Trạng thái")}</TableHead>
                <TableHead>{t("gguf.trungTam.kho.cot.giayPhep", "Giấy phép")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ds.map((a) => (
                <DongArtifact key={`${a.id}:${a.license}:${a.status}`} a={a} lamMoi={lamMoi} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

// ─── Hồ sơ phục vụ ─────────────────────────────────────────────────────────────

const HO_SO_TRONG = { id: "", artifactId: "", slotClass: "nang" as (typeof KHE)[number], ctx: "65536", thinking: "auto" as (typeof SUY_NGHI)[number], enabled: true };

function TabHoSo({ d, lamMoi }: { d: TongQuan; lamMoi: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState(HO_SO_TRONG);
  const luu = trpc.aiGguf.soModelTaoHoSo.useMutation({
    onSuccess: (r) => {
      toast.success(r.taoMoi ? t("gguf.trungTam.hoSo.daTao", "Đã tạo hồ sơ.") : t("gguf.trungTam.hoSo.daSua", "Đã sửa hồ sơ."));
      lamMoi();
    },
    onError: (e) => toastTrpcError(e),
  });
  const artifactSinhChu = d.artifacts.filter((a) => a.loai === "sinh-chu");
  const tenTep = new Map(d.artifacts.map((a) => [a.id, a.filePath]));
  const ctx = Number(f.ctx);
  const hopLe = RE_ID_HO_SO.test(f.id) && !!f.artifactId && Number.isInteger(ctx) && ctx >= 512 && ctx <= 262144;
  const nap = (p: HoSo) =>
    setF({ id: p.id, artifactId: p.artifactId, slotClass: p.slotClass as (typeof KHE)[number], ctx: String(p.ctx), thinking: p.thinking as (typeof SUY_NGHI)[number], enabled: p.enabled });

  return (
    <>
      {d.profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("gguf.trungTam.hoSo.rong", "Chưa có hồ sơ phục vụ nào.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("gguf.trungTam.hoSo.cot.id", "Mã hồ sơ")}</TableHead>
                <TableHead>{t("gguf.trungTam.hoSo.cot.artifact", "Artifact")}</TableHead>
                <TableHead>{t("gguf.trungTam.hoSo.cot.khe", "Khe")}</TableHead>
                <TableHead>{t("gguf.trungTam.hoSo.cot.ctx", "Ngữ cảnh")}</TableHead>
                <TableHead>{t("gguf.trungTam.hoSo.cot.suyNghi", "Suy nghĩ")}</TableHead>
                <TableHead>{t("gguf.trungTam.hoSo.cot.bat", "Bật")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.profiles.map((p) => (
                <TableRow key={p.id} data-ho-so={p.id}>
                  <TableCell className="font-mono text-xs">{p.id}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-normal break-all">{tenTep.get(p.artifactId) ?? p.artifactId}</TableCell>
                  <TableCell className="text-xs">{t(`gguf.trungTam.khe.${p.slotClass}`, p.slotClass)}</TableCell>
                  <TableCell className="text-xs">{p.ctx}</TableCell>
                  <TableCell className="text-xs">{t(`gguf.trungTam.suyNghi.${p.thinking}`, p.thinking)}</TableCell>
                  <TableCell>
                    <Badge variant={p.enabled ? "default" : "outline"}>{p.enabled ? t("gguf.trungTam.co", "có") : t("gguf.trungTam.khong", "không")}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => nap(p)}>
                      {t("gguf.trungTam.hoSo.sua", "Sửa")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <form
        className="space-y-3 rounded-md border p-3"
        data-testid="form-ho-so"
        onSubmit={(e) => {
          e.preventDefault();
          if (!hopLe) return;
          luu.mutate({ id: f.id, artifactId: f.artifactId, slotClass: f.slotClass, ctx, thinking: f.thinking, enabled: f.enabled });
        }}
      >
        <h4 className="text-sm font-medium">{t("gguf.trungTam.hoSo.formTieuDe", "Tạo / sửa hồ sơ")}</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span>{t("gguf.trungTam.hoSo.cot.id", "Mã hồ sơ")}</span>
            <Input className="h-8 font-mono text-xs" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} placeholder="qwen3.6-35b@64k" name="id" />
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span>{t("gguf.trungTam.hoSo.cot.artifact", "Artifact")}</span>
            <select className={O_NHAP} value={f.artifactId} onChange={(e) => setF({ ...f, artifactId: e.target.value })} name="artifactId">
              <option value="">{t("gguf.trungTam.chon", "— chọn —")}</option>
              {artifactSinhChu.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.filePath}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("gguf.trungTam.hoSo.cot.khe", "Khe")}</span>
            <select className={O_NHAP} value={f.slotClass} onChange={(e) => setF({ ...f, slotClass: e.target.value as (typeof KHE)[number] })} name="slotClass">
              {KHE.map((k) => (
                <option key={k} value={k}>
                  {t(`gguf.trungTam.khe.${k}`, k)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("gguf.trungTam.hoSo.cot.ctx", "Ngữ cảnh")}</span>
            <Input className="h-8 text-xs" type="number" min={512} max={262144} value={f.ctx} onChange={(e) => setF({ ...f, ctx: e.target.value })} name="ctx" />
          </label>
          <label className="space-y-1 text-xs">
            <span>{t("gguf.trungTam.hoSo.cot.suyNghi", "Suy nghĩ")}</span>
            <select className={O_NHAP} value={f.thinking} onChange={(e) => setF({ ...f, thinking: e.target.value as (typeof SUY_NGHI)[number] })} name="thinking">
              {SUY_NGHI.map((s) => (
                <option key={s} value={s}>
                  {t(`gguf.trungTam.suyNghi.${s}`, s)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} name="enabled" />
            <span>{t("gguf.trungTam.hoSo.cot.bat", "Bật")}</span>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t("gguf.trungTam.hoSo.ghiChu", "Mã trùng ⇒ sửa hồ sơ đó. Cờ máy chủ và tham số lấy mẫu chưa mở chỉnh ở bản này.")}</p>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!hopLe || luu.isPending}>
            {luu.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("gguf.trungTam.luu", "Lưu")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setF(HO_SO_TRONG)}>
            {t("gguf.trungTam.hoSo.moi", "Hồ sơ mới")}
          </Button>
        </div>
      </form>
    </>
  );
}

// ─── Khe nặng ──────────────────────────────────────────────────────────────────

function TabKhe({ d }: { d: TongQuan }) {
  const { t } = useTranslation();
  const k = d.kheNang;
  // ★ Đợt 9 — khoá khe (phép đo / đổi model ngoài app đang giữ :8091) — CHỈ hiển thị.
  const khoa = d.khoaKhe;
  const oKhoa = khoa ? (
    <div className="rounded border border-amber-500/60 bg-amber-500/10 p-2 text-xs" data-testid="khoa-khe" role="status">
      <span className="font-medium">{t("gguf.trungTam.khe.khoa.tieuDe", "Khe đang bị khoá")}</span>
      {" — "}
      {t("gguf.trungTam.khe.khoa.chu", "chủ")}: <span className="font-mono break-all">{khoa.chu}</span>
      {khoa.lyDo ? <> · {t("gguf.trungTam.khe.khoa.lyDo", "lý do")}: {khoa.lyDo}</> : null}
      {" · "}
      {t("gguf.trungTam.khe.khoa.hetHan", "hết hạn")}: <span className="font-mono">{new Date(khoa.hetHan).toLocaleString()}</span>
      {khoa.hong ? <> · {t("gguf.trungTam.khe.khoa.hong", "tệp khoá không đúng định dạng — khoá ngắn")}</> : null}
    </div>
  ) : null;
  if (!k)
    return (
      <div className="space-y-2">
        {oKhoa}
        <p className="text-sm text-muted-foreground">{t("gguf.trungTam.khe.chuaDung", "Khe nặng chưa dùng trong tiến trình này.")}</p>
      </div>
    );
  const dangChay = Object.entries(k.dangChay);
  const nghi = Object.entries(k.nghi);
  return (
    <div className="space-y-3 text-sm" data-testid="khe-nang">
      {oKhoa}
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <span className="text-muted-foreground">{t("gguf.trungTam.khe.dangGiu", "Đang giữ")}: </span>
          <span className="font-mono break-all">{k.dangGiu ?? "—"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{t("gguf.trungTam.khe.dangDoi", "Đang đổi sang")}: </span>
          <span className="font-mono break-all">{k.dangDoi ?? "—"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{t("gguf.trungTam.khe.tuDoi", "Tự đổi khe")}: </span>
          {k.tuDoi ? t("gguf.trungTam.co", "có") : t("gguf.trungTam.khong", "không")}
        </div>
        <div>
          <span className="text-muted-foreground">{t("gguf.trungTam.khe.soLanDoi", "Số lần đổi")}: </span>
          {k.soLanDoi}
        </div>
        <div>
          <span className="text-muted-foreground">{t("gguf.trungTam.khe.soLanHong", "Số lần hỏng")}: </span>
          <span className={k.soLanHong ? "text-destructive" : ""}>{k.soLanHong}</span>
        </div>
      </div>
      <div>
        <h4 className="mb-1 text-sm font-medium">{t("gguf.trungTam.khe.dangChay", "Đang chạy")}</h4>
        {dangChay.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("gguf.trungTam.khe.khongCo", "không có")}</p>
        ) : (
          <ul className="text-xs">
            {dangChay.map(([m, n]) => (
              <li key={m} className="font-mono">
                {m}: {n}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="mb-1 text-sm font-medium">{t("gguf.trungTam.khe.hangCho", "Hàng chờ")}</h4>
        {k.dangCho.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("gguf.trungTam.khe.khongCo", "không có")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("gguf.trungTam.khe.cot.model", "Model")}</TableHead>
                <TableHead>{t("gguf.trungTam.khe.cot.muc", "Mức ưu tiên")}</TableHead>
                <TableHead>{t("gguf.trungTam.khe.cot.cho", "Đã chờ")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {k.dangCho.map((c, i) => (
                <TableRow key={`${c.model}-${i}`}>
                  <TableCell className="font-mono text-xs whitespace-normal break-all">{c.model}</TableCell>
                  <TableCell className="text-xs">{t(`gguf.trungTam.muc.${c.muc}`, c.muc)}</TableCell>
                  <TableCell className="text-xs">{giay(c.choMs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div>
        <h4 className="mb-1 text-sm font-medium">{t("gguf.trungTam.khe.nghi", "Model đang nghỉ (sau lỗi nạp)")}</h4>
        {nghi.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("gguf.trungTam.khe.khongCo", "không có")}</p>
        ) : (
          <ul className="text-xs">
            {nghi.map(([m, ms]) => (
              <li key={m} className="font-mono">
                {m}: {t("gguf.trungTam.khe.conLai", "còn {{t}}", { t: giay(ms) })}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("gguf.trungTam.khe.ghiChu", "Số liệu của tiến trình API, tự làm mới mỗi 5 giây khi tab này mở.")}</p>
    </div>
  );
}

// ─── Đo ────────────────────────────────────────────────────────────────────────

function TabDo({ d }: { d: TongQuan }) {
  const { t } = useTranslation();
  if (d.evalRuns.length === 0) return <p className="text-sm text-muted-foreground">{t("gguf.trungTam.do.rong", "Chưa có lượt đo.")}</p>;
  // Tiêu chí chủ dự án: độ ĐÚNG trước, tốc độ sau (model chậm không bị loại vì chậm). Nhóm theo bộ đo; mỗi bộ ghi vai trò dùng nó.
  const tiLe = (r: LuotDo) => tiLeDat(r) ?? -1;
  const ds = [...d.evalRuns].sort((a, b) => a.suite.localeCompare(b.suite) || tiLe(b) - tiLe(a) || (a.p50Ms ?? Infinity) - (b.p50Ms ?? Infinity));
  const dangGan = tapDangGan(d.gan, d.vaiTro);
  const vaiTroCuaBo = (suite: string) => d.vaiTro.filter((v) => v.evalSuite === suite).map((v) => v.id);
  return (
    <div className="overflow-x-auto" data-testid="bang-luot-do">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("gguf.trungTam.do.cot.boDo", "Bộ đo")}</TableHead>
            <TableHead>{t("gguf.trungTam.do.cot.vaiTro", "Vai trò")}</TableHead>
            <TableHead>{t("gguf.trungTam.hoSo.cot.id", "Mã hồ sơ")}</TableHead>
            <TableHead>{t("gguf.trungTam.do.cot.dat", "Đạt / bài × lượt")}</TableHead>
            <TableHead>{t("gguf.trungTam.do.cot.p50", "p50 / p90")}</TableHead>
            <TableHead>{t("gguf.trungTam.do.cot.gitSha", "Mã commit")}</TableHead>
            <TableHead>{t("gguf.trungTam.do.cot.luc", "Lúc")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ds.map((r) => {
            const gan = dangGan.has(`${r.profileId}|${r.suite}`);
            return (
              <TableRow key={r.id} data-dang-gan={gan ? "1" : "0"} data-profile={r.profileId}>
                <TableCell className="font-mono text-xs">{r.suite}</TableCell>
                <TableCell className="font-mono text-xs">{vaiTroCuaBo(r.suite).join(", ") || "—"}</TableCell>
                <TableCell className="font-mono text-xs whitespace-normal break-all">
                  {r.profileId}
                  {gan ? (
                    <Badge variant="default" className="ml-1" data-testid="dang-gan">
                      {t("gguf.trungTam.do.dangGan", "đang gán")}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">
                  {r.nPass ?? "?"}/{r.nTasks ?? "?"}×{r.nRuns ?? 1}
                  {tiLe(r) >= 0 ? ` (${Math.round(tiLe(r) * 100)} %)` : ""}
                </TableCell>
                <TableCell className="text-xs">
                  {r.p50Ms !== null ? giay(r.p50Ms) : "—"} / {r.p90Ms !== null ? giay(r.p90Ms) : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.gitSha ? r.gitSha.slice(0, 9) : "—"}</TableCell>
                <TableCell className="text-xs">{new Date(r.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
