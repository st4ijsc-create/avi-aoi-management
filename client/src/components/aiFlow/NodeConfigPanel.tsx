/**
 * ★★ AI Local Đợt 8.3 — BẢNG CẤU HÌNH NODE của Flow Studio.
 *
 * Form CHUYÊN cho node lõi (đặt trường, nếu, AI llm/trích xuất/phân loại/tóm tắt, duyệt người, HTTP + bí mật, lịch cron,
 * webhook, mã) + trình sửa JSON dự phòng cho loại khác. Mọi ô có thể chứa `{{ … }}` báo lỗi biểu thức TỨC THÌ bằng
 * `loiBieuThucChuoi` (= `kiemCuPhap` của động cơ). Bí mật chỉ chọn theo ID (`credentialRef`) — giá trị không bao giờ tới đây.
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { NodeInstance } from "@shared/flow/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { MAU_HANG, loiBieuThucChuoi, type KhaiBaoNutClient } from "@/lib/flowStudio";

const O_CHON =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type ThamSo = Record<string, unknown>;

function LoiBt({ giaTri }: { giaTri: unknown }) {
  const { t } = useTranslation();
  if (typeof giaTri !== "string") return null;
  const l = loiBieuThucChuoi(giaTri);
  if (!l) return null;
  return (
    <p className="text-xs text-destructive mt-1" role="alert" data-testid="loi-bieu-thuc">
      {t("flowStudio.cauHinh.loiBieuThuc", { loi: l })}
    </p>
  );
}

function Truong({ nhan, children, goiY }: { nhan: string; children: ReactNode; goiY?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{nhan}</Label>
      {children}
      {goiY && <p className="text-[11px] text-muted-foreground">{goiY}</p>}
    </div>
  );
}

/** Ô chữ có thể chứa biểu thức (một dòng hoặc nhiều dòng). */
function OBieuThuc({ giaTri, onDoi, nhieuDong, placeholder, testId }: { giaTri: unknown; onDoi: (v: string) => void; nhieuDong?: boolean; placeholder?: string; testId?: string }) {
  const s = typeof giaTri === "string" ? giaTri : giaTri === undefined || giaTri === null ? "" : JSON.stringify(giaTri);
  const loi = typeof giaTri === "string" && !!loiBieuThucChuoi(giaTri);
  const cls = loi ? "border-destructive focus-visible:ring-destructive" : "";
  return (
    <>
      {nhieuDong ? (
        <Textarea data-testid={testId} className={`text-xs font-mono min-h-[72px] ${cls}`} value={s} placeholder={placeholder} onChange={(e) => onDoi(e.target.value)} />
      ) : (
        <Input data-testid={testId} className={`h-9 text-xs font-mono ${cls}`} value={s} placeholder={placeholder} onChange={(e) => onDoi(e.target.value)} />
      )}
      <LoiBt giaTri={giaTri} />
    </>
  );
}

function OChon({ giaTri, onDoi, luaChon, testId }: { giaTri: string; onDoi: (v: string) => void; luaChon: { v: string; nhan: string }[]; testId?: string }) {
  return (
    <select data-testid={testId} className={O_CHON} value={giaTri} onChange={(e) => onDoi(e.target.value)}>
      {luaChon.map((o) => (
        <option key={o.v} value={o.v}>{o.nhan}</option>
      ))}
    </select>
  );
}

function OHop({ giaTri, onDoi, nhan, testId }: { giaTri: boolean; onDoi: (v: boolean) => void; nhan: string; testId?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer">
      <input data-testid={testId} type="checkbox" className="h-4 w-4" checked={giaTri} onChange={(e) => onDoi(e.target.checked)} />
      {nhan}
    </label>
  );
}

const VAI_TRO_GOI_Y = ["chat", "extract", "classify", "summarize", "code.software", "code.plc"];

function OVaiTro({ giaTri, onDoi }: { giaTri: unknown; onDoi: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Truong nhan={t("flowStudio.cauHinh.vaiTro")} goiY={t("flowStudio.cauHinh.vaiTroGoiY")}>
      <Input className="h-9 text-xs font-mono" list="flow-vai-tro" value={String(giaTri ?? "")} onChange={(e) => onDoi(e.target.value)} />
      <datalist id="flow-vai-tro">
        {VAI_TRO_GOI_Y.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </Truong>
  );
}

/** `du-lieu.dat` — danh sách cặp tên/giá trị (giữ thứ tự hàng đang sửa, kể cả tên rỗng chưa gõ xong). */
function FormDatTruong({ p, doi }: { p: ThamSo; doi: (k: string, v: unknown) => void }) {
  const { t } = useTranslation();
  const truong = (p.truong && typeof p.truong === "object" && !Array.isArray(p.truong) ? p.truong : {}) as Record<string, unknown>;
  const [hang, setHang] = useState<[string, unknown][]>(() => Object.entries(truong));
  const ghi = (ds: [string, unknown][]) => {
    setHang(ds);
    const o: Record<string, unknown> = {};
    for (const [k, v] of ds) if (k.trim()) o[k.trim()] = v;
    doi("truong", o);
  };
  return (
    <div className="space-y-2">
      <Label className="text-xs">{t("flowStudio.cauHinh.truongDat")}</Label>
      {hang.map(([k, v], i) => (
        <div key={i} className="flex gap-1 items-start">
          <Input data-testid={`dat-ten-${i}`} className="h-9 text-xs font-mono w-28 shrink-0" placeholder={t("flowStudio.cauHinh.tenTruong")} value={k} onChange={(e) => ghi(hang.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))} />
          <div className="flex-1 min-w-0">
            <OBieuThuc testId={`dat-gia-tri-${i}`} giaTri={v} placeholder="{{ $json.x }}" onDoi={(s) => ghi(hang.map((h, j) => (j === i ? [h[0], s] : h)))} />
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={t("flowStudio.cauHinh.xoaHang")} onClick={() => ghi(hang.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" data-testid="dat-them-truong" onClick={() => ghi([...hang, ["", ""]])}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        {t("flowStudio.cauHinh.themTruong")}
      </Button>
      <OHop nhan={t("flowStudio.cauHinh.giuCu")} giaTri={p.giuCu !== false} onDoi={(v) => doi("giuCu", v)} />
    </div>
  );
}

interface TruongTrich {
  ten: string;
  kieu: string;
  batBuoc?: boolean;
  moTa?: string;
}

function FormTrichXuat({ p, doi }: { p: ThamSo; doi: (k: string, v: unknown) => void }) {
  const { t } = useTranslation();
  const ds = (Array.isArray(p.truong) ? p.truong : []) as TruongTrich[];
  const ghi = (moi: TruongTrich[]) => doi("truong", moi);
  const kieu = ["chuoi", "so", "boolean", "danh-sach"].map((v) => ({ v, nhan: t(`flowStudio.cauHinh.kieu.${v}`) }));
  return (
    <div className="space-y-2">
      <Label className="text-xs">{t("flowStudio.cauHinh.truongTrich")}</Label>
      {ds.map((f, i) => (
        <div key={i} className="rounded border p-2 space-y-1">
          <div className="flex gap-1">
            <Input className="h-8 text-xs font-mono" placeholder={t("flowStudio.cauHinh.tenTruong")} value={f.ten} onChange={(e) => ghi(ds.map((x, j) => (j === i ? { ...x, ten: e.target.value } : x)))} />
            <select className={`${O_CHON} h-8 w-28`} value={f.kieu} onChange={(e) => ghi(ds.map((x, j) => (j === i ? { ...x, kieu: e.target.value } : x)))}>
              {kieu.map((o) => (
                <option key={o.v} value={o.v}>{o.nhan}</option>
              ))}
            </select>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t("flowStudio.cauHinh.xoaHang")} onClick={() => ghi(ds.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Input className="h-8 text-xs" placeholder={t("flowStudio.cauHinh.moTa")} value={f.moTa ?? ""} onChange={(e) => ghi(ds.map((x, j) => (j === i ? { ...x, moTa: e.target.value } : x)))} />
          <OHop nhan={t("flowStudio.cauHinh.batBuoc")} giaTri={f.batBuoc === true} onDoi={(v) => ghi(ds.map((x, j) => (j === i ? { ...x, batBuoc: v } : x)))} />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => ghi([...ds, { ten: "", kieu: "chuoi" }])}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        {t("flowStudio.cauHinh.themTruong")}
      </Button>
    </div>
  );
}

/** Ô nhập số HOẶC biểu thức: chuỗi toàn chữ số ⇒ lưu số; còn lại lưu chữ (có thể là {{ … }}). */
const soHoacChu = (v: string): number | string => (/^\d{1,12}$/.test(v.trim()) ? Number(v.trim()) : v);

/**
 * ★★★ Đợt 9.3 — FORM NODE OT (CHẾ ĐỘ MÔ PHỎNG, quyết định D4): `ot.doc-tag` chỉ ĐỌC; `ot.de-xuat-lenh` / `ot.de-xuat-luong` chỉ ĐỀ XUẤT.
 * Không có ô, nút hay giá trị nào ở đây dẫn tới gửi lệnh thật — biểu ngữ nói rõ điều đó ngay trong form.
 */
function FormOt({ type, p, doi }: { type: string; p: ThamSo; doi: (k: string, v: unknown) => void }) {
  const { t } = useTranslation();
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : p[k] === undefined || p[k] === null ? "" : String(p[k]));
  const ten = (k: string, nhan: string, goiY?: string, testId?: string) => (
    <Truong nhan={nhan} goiY={goiY}>
      <OBieuThuc testId={testId} giaTri={p[k]} onDoi={(v) => doi(k, soHoacChu(v))} />
    </Truong>
  );
  return (
    <div className="space-y-3" data-testid="form-ot">
      <div className="flex gap-2 rounded border border-warning/50 bg-warning/10 p-2 text-xs" role="note" data-testid="ot-mo-phong">
        <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
        <div className="space-y-1">
          <p className="font-medium">{t("flowStudio.ot.moPhong")}</p>
          <p className="text-muted-foreground">{t("flowStudio.ot.batCan2fa")}</p>
        </div>
      </div>
      {type === "ot.doc-tag" && (
        <>
          <p className="text-[11px] text-muted-foreground">{t("flowStudio.ot.docTagChiDoc")}</p>
          {ten("may", t("flowStudio.ot.may"), undefined, "ot-may")}
          <Truong nhan={t("flowStudio.ot.tag")}>
            <OBieuThuc testId="ot-tag" giaTri={p.tag} onDoi={(v) => doi("tag", v)} />
          </Truong>
          <Truong nhan={t("flowStudio.ot.gioiHan")}>
            <Input type="number" min={1} max={100} className="h-9 text-xs" value={s("gioiHan")} onChange={(e) => doi("gioiHan", e.target.value === "" ? undefined : Number(e.target.value))} />
          </Truong>
          <Truong nhan={t("flowStudio.cauHinh.truongRa")}><Input className="h-9 text-xs font-mono" value={s("truongRa")} onChange={(e) => doi("truongRa", e.target.value)} /></Truong>
        </>
      )}
      {type === "ot.de-xuat-lenh" && (
        <>
          {ten("may", t("flowStudio.ot.may"), undefined, "ot-may")}
          <Truong nhan={t("flowStudio.ot.lenh")} goiY={t("flowStudio.ot.lenhGoiY")}>
            <Input data-testid="ot-lenh" className="h-9 text-xs font-mono" list="flow-ot-lenh" value={s("lenh")} onChange={(e) => doi("lenh", e.target.value)} />
            <datalist id="flow-ot-lenh">
              {["pause", "start", "stop", "reset"].map((v) => <option key={v} value={v} />)}
            </datalist>
          </Truong>
          <Truong nhan={t("flowStudio.ot.tag")}>
            <OBieuThuc testId="ot-tag" giaTri={p.tag} onDoi={(v) => doi("tag", v)} />
          </Truong>
          <Truong nhan={t("flowStudio.ot.giaTri")}>
            <OBieuThuc testId="ot-gia-tri" giaTri={p.giaTri} onDoi={(v) => doi("giaTri", v === "" ? undefined : v)} />
          </Truong>
          <Truong nhan={t("flowStudio.ot.hetHanGio")}>
            <Input type="number" min={1} max={168} className="h-9 text-xs" value={s("hetHanGio")} onChange={(e) => doi("hetHanGio", e.target.value === "" ? undefined : Number(e.target.value))} />
          </Truong>
        </>
      )}
      {type === "ot.de-xuat-luong" && (
        <>
          <p className="text-[11px] text-muted-foreground">{t("flowStudio.ot.luongGoiY")}</p>
          {ten("workflowId", t("flowStudio.ot.workflowId"), undefined, "ot-workflow")}
          {ten("version", t("flowStudio.ot.version"), undefined, "ot-version")}
          <FormJson nhan={t("flowStudio.ot.thamSoFoe")} giaTri={p.thamSo ?? {}} onDoi={(v) => doi("thamSo", v)} />
          <Truong nhan={t("flowStudio.ot.hetHanGio")}>
            <Input type="number" min={1} max={168} className="h-9 text-xs" value={s("hetHanGio")} onChange={(e) => doi("hetHanGio", e.target.value === "" ? undefined : Number(e.target.value))} />
          </Truong>
        </>
      )}
    </div>
  );
}

/** Trình sửa JSON dự phòng: giữ chữ đang gõ, chỉ ghi khi JSON hợp lệ là đối tượng. */
function FormJson({ giaTri, onDoi, nhan }: { giaTri: unknown; onDoi: (v: Record<string, unknown>) => void; nhan: string }) {
  const { t } = useTranslation();
  const [chu, setChu] = useState(() => JSON.stringify(giaTri ?? {}, null, 2));
  const [loi, setLoi] = useState(false);
  return (
    <Truong nhan={nhan}>
      <Textarea
        data-testid="json-tham-so"
        className={`font-mono text-xs min-h-[220px] ${loi ? "border-destructive" : ""}`}
        value={chu}
        onChange={(e) => {
          setChu(e.target.value);
          try {
            const v = JSON.parse(e.target.value) as unknown;
            if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("x");
            setLoi(false);
            onDoi(v as Record<string, unknown>);
          } catch {
            setLoi(true);
          }
        }}
      />
      {loi && <p className="text-xs text-destructive">{t("flowStudio.cauHinh.jsonHong")}</p>}
    </Truong>
  );
}

export interface BiMatTomTat {
  id: string;
  ten: string;
  loai: string;
}

export interface NodeConfigPanelProps {
  node: NodeInstance;
  kb: KhaiBaoNutClient | undefined;
  onDoi: (n: NodeInstance) => void;
  onXoa: () => void;
  biMat: BiMatTomTat[] | undefined;
  webhook: { flowId: string; coToken: boolean; dangBat: boolean; onXoay: () => void; dangXoay: boolean; tokenMoi: string | null };
}

export default function NodeConfigPanel({ node, kb, onDoi, onXoa, biMat, webhook }: NodeConfigPanelProps) {
  const { t } = useTranslation();
  const p = node.parameters ?? {};
  const doi = (k: string, v: unknown) => onDoi({ ...node, parameters: { ...p, [k]: v } });
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : p[k] === undefined || p[k] === null ? "" : String(p[k]));

  let form: ReactNode;
  switch (node.type) {
    case "kich-hoat.thu-cong":
      form = <p className="text-xs text-muted-foreground">{t("flowStudio.cauHinh.thuCongGoiY")}</p>;
      break;
    case "du-lieu.dat":
      form = <FormDatTruong p={p} doi={doi} />;
      break;
    case "logic.neu":
      form = (
        <Truong nhan={t("flowStudio.cauHinh.dieuKien")} goiY={t("flowStudio.cauHinh.dieuKienGoiY")}>
          <OBieuThuc testId="neu-dieu-kien" giaTri={p.dieuKien} placeholder="{{ $json.so > 10 }}" onDoi={(v) => doi("dieuKien", v)} />
        </Truong>
      );
      break;
    case "ai.llm":
      form = (
        <div className="space-y-3">
          <OVaiTro giaTri={p.vaiTro} onDoi={(v) => doi("vaiTro", v)} />
          <Truong nhan={t("flowStudio.cauHinh.heThong")}><OBieuThuc nhieuDong giaTri={p.heThong} onDoi={(v) => doi("heThong", v)} /></Truong>
          <Truong nhan={t("flowStudio.cauHinh.loiNhac")}><OBieuThuc nhieuDong giaTri={p.loiNhac} onDoi={(v) => doi("loiNhac", v)} /></Truong>
          <OHop nhan={t("flowStudio.cauHinh.nghi")} giaTri={p.nghi === true} onDoi={(v) => doi("nghi", v)} />
          <Truong nhan={t("flowStudio.cauHinh.maxTokens")}><Input type="number" className="h-9 text-xs" value={s("maxTokens")} onChange={(e) => doi("maxTokens", e.target.value === "" ? undefined : Number(e.target.value))} /></Truong>
          <Truong nhan={t("flowStudio.cauHinh.truongRa")}><Input className="h-9 text-xs font-mono" value={s("truongRa")} onChange={(e) => doi("truongRa", e.target.value)} /></Truong>
        </div>
      );
      break;
    case "ai.trich-xuat":
      form = (
        <div className="space-y-3">
          <OVaiTro giaTri={p.vaiTro} onDoi={(v) => doi("vaiTro", v)} />
          <Truong nhan={t("flowStudio.cauHinh.vanBan")}><OBieuThuc giaTri={p.vanBan} onDoi={(v) => doi("vanBan", v)} /></Truong>
          <FormTrichXuat p={p} doi={doi} />
          <Truong nhan={t("flowStudio.cauHinh.truongRa")}><Input className="h-9 text-xs font-mono" value={s("truongRa")} onChange={(e) => doi("truongRa", e.target.value)} /></Truong>
        </div>
      );
      break;
    case "ai.phan-loai":
      form = (
        <div className="space-y-3">
          <OVaiTro giaTri={p.vaiTro} onDoi={(v) => doi("vaiTro", v)} />
          <Truong nhan={t("flowStudio.cauHinh.vanBan")}><OBieuThuc giaTri={p.vanBan} onDoi={(v) => doi("vanBan", v)} /></Truong>
          <Truong nhan={t("flowStudio.cauHinh.nhan")} goiY={t("flowStudio.cauHinh.nhanGoiY")}>
            <Input
              className="h-9 text-xs font-mono"
              defaultValue={(Array.isArray(p.nhan) ? p.nhan : []).join(", ")}
              onChange={(e) => doi("nhan", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
            />
          </Truong>
          <Truong nhan={t("flowStudio.cauHinh.huongDan")}><OBieuThuc nhieuDong giaTri={p.huongDan} onDoi={(v) => doi("huongDan", v)} /></Truong>
          <Truong nhan={t("flowStudio.cauHinh.truongRa")}><Input className="h-9 text-xs font-mono" value={s("truongRa")} onChange={(e) => doi("truongRa", e.target.value)} /></Truong>
        </div>
      );
      break;
    case "ai.tom-tat":
      form = (
        <div className="space-y-3">
          <OVaiTro giaTri={p.vaiTro} onDoi={(v) => doi("vaiTro", v)} />
          <Truong nhan={t("flowStudio.cauHinh.yeuCau")}><OBieuThuc nhieuDong giaTri={p.yeuCau} onDoi={(v) => doi("yeuCau", v)} /></Truong>
          <OHop nhan={t("flowStudio.cauHinh.nghi")} giaTri={p.nghi === true} onDoi={(v) => doi("nghi", v)} />
          <Truong nhan={t("flowStudio.cauHinh.truongRa")}><Input className="h-9 text-xs font-mono" value={s("truongRa")} onChange={(e) => doi("truongRa", e.target.value)} /></Truong>
        </div>
      );
      break;
    case "nguoi.duyet":
      form = (
        <div className="space-y-3">
          <Truong nhan={t("flowStudio.cauHinh.tieuDe")}><OBieuThuc testId="duyet-tieu-de" giaTri={p.tieuDe} onDoi={(v) => doi("tieuDe", v)} /></Truong>
          <Truong nhan={t("flowStudio.cauHinh.noiDung")}><OBieuThuc nhieuDong giaTri={p.noiDung} onDoi={(v) => doi("noiDung", v)} /></Truong>
          <Truong nhan={t("flowStudio.cauHinh.hetHanGio")}><Input type="number" className="h-9 text-xs" value={s("hetHanGio")} onChange={(e) => doi("hetHanGio", e.target.value === "" ? undefined : Number(e.target.value))} /></Truong>
          <Truong nhan={t("flowStudio.cauHinh.vaiTroDuyet")}><Input className="h-9 text-xs font-mono" value={s("vaiTroDuyet")} onChange={(e) => doi("vaiTroDuyet", e.target.value)} /></Truong>
        </div>
      );
      break;
    case "tich-hop.http-doc":
    case "tich-hop.http-gui": {
      const gui = node.type === "tich-hop.http-gui";
      form = (
        <div className="space-y-3">
          <Truong nhan={t("flowStudio.cauHinh.url")} goiY={t("flowStudio.cauHinh.urlGoiY")}><OBieuThuc giaTri={p.url} placeholder="https://" onDoi={(v) => doi("url", v)} /></Truong>
          {gui && (
            <>
              <Truong nhan={t("flowStudio.cauHinh.phuongThuc")}>
                <OChon giaTri={s("phuongThuc") || "POST"} onDoi={(v) => doi("phuongThuc", v)} luaChon={["POST", "PUT", "PATCH", "DELETE"].map((v) => ({ v, nhan: v }))} />
              </Truong>
              <Truong nhan={t("flowStudio.cauHinh.than")}><OBieuThuc nhieuDong giaTri={p.than} onDoi={(v) => doi("than", v)} /></Truong>
            </>
          )}
          <Truong nhan={t("flowStudio.cauHinh.biMat")} goiY={t("flowStudio.cauHinh.biMatGoiY")}>
            <OChon
              testId="http-bi-mat"
              giaTri={node.credentialRef ?? ""}
              onDoi={(v) => onDoi({ ...node, credentialRef: v || undefined, parameters: v ? { ...p, kieuXacThuc: p.kieuXacThuc || "bearer" } : (({ kieuXacThuc: _b, ...r }) => r)(p) })}
              luaChon={[{ v: "", nhan: t("flowStudio.cauHinh.khongBiMat") }, ...(biMat ?? []).map((b) => ({ v: b.id, nhan: `${b.ten} (${b.id})` }))]}
            />
          </Truong>
          {node.credentialRef && (
            <Truong nhan={t("flowStudio.cauHinh.kieuXacThuc")} goiY={t("flowStudio.cauHinh.kieuXacThucGoiY")}>
              <Input className="h-9 text-xs font-mono" list="flow-kieu-xac-thuc" value={s("kieuXacThuc")} onChange={(e) => doi("kieuXacThuc", e.target.value)} />
              <datalist id="flow-kieu-xac-thuc">
                <option value="bearer" />
                <option value="basic" />
                <option value="header:X-Api-Key" />
              </datalist>
            </Truong>
          )}
          <Truong nhan={t("flowStudio.cauHinh.truongRa")}><Input className="h-9 text-xs font-mono" value={s("truongRa")} onChange={(e) => doi("truongRa", e.target.value)} /></Truong>
          <OHop nhan={t("flowStudio.cauHinh.loiKhiKhong2xx")} giaTri={p.loiKhiKhong2xx !== false} onDoi={(v) => doi("loiKhiKhong2xx", v)} />
        </div>
      );
      break;
    }
    case "kich-hoat.lich":
      form = (
        <div className="space-y-3">
          <Truong nhan={t("flowStudio.cauHinh.cron")} goiY={t("flowStudio.cauHinh.cronGoiY")}><Input className="h-9 text-xs font-mono" value={s("cron")} onChange={(e) => doi("cron", e.target.value)} /></Truong>
          <Truong nhan={t("flowStudio.cauHinh.muiGio")}><Input className="h-9 text-xs font-mono" value={s("muiGio")} onChange={(e) => doi("muiGio", e.target.value)} /></Truong>
        </div>
      );
      break;
    case "kich-hoat.webhook": {
      const url = `${typeof window !== "undefined" ? window.location.origin : ""}/api/flow/webhook/${webhook.flowId}/${node.id}`;
      form = (
        <div className="space-y-3">
          <Truong nhan={t("flowStudio.cauHinh.webhookUrl")} goiY={t("flowStudio.cauHinh.webhookGoiY")}>
            <Input readOnly className="h-9 text-xs font-mono" value={url} onFocus={(e) => e.currentTarget.select()} />
          </Truong>
          <p className="text-xs">{webhook.coToken ? t("flowStudio.cauHinh.webhookCoToken") : t("flowStudio.cauHinh.webhookChuaToken")}</p>
          <Button type="button" variant="outline" size="sm" disabled={!webhook.dangBat || webhook.dangXoay} onClick={webhook.onXoay}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            {t("flowStudio.cauHinh.xoayToken")}
          </Button>
          {!webhook.dangBat && <p className="text-[11px] text-muted-foreground">{t("flowStudio.cauHinh.xoayTokenCanBat")}</p>}
          {webhook.tokenMoi && (
            <div className="rounded border border-warning/50 bg-warning/10 p-2 space-y-1">
              <p className="text-xs font-medium">{t("flowStudio.cauHinh.tokenMotLan")}</p>
              <Input readOnly className="h-8 text-xs font-mono" value={webhook.tokenMoi} onFocus={(e) => e.currentTarget.select()} />
            </div>
          )}
        </div>
      );
      break;
    }
    case "ot.doc-tag":
    case "ot.de-xuat-lenh":
    case "ot.de-xuat-luong":
      form = <FormOt type={node.type} p={p} doi={doi} />;
      break;
    case "du-lieu.ma":
      form = (
        <Truong nhan={t("flowStudio.cauHinh.ma")} goiY={t("flowStudio.cauHinh.maGoiY")}>
          <Textarea className="font-mono text-xs min-h-[220px]" spellCheck={false} value={s("ma")} onChange={(e) => doi("ma", e.target.value)} />
        </Truong>
      );
      break;
    default:
      form = <FormJson key={node.id} nhan={t("flowStudio.cauHinh.thamSoJson")} giaTri={p} onDoi={(v) => onDoi({ ...node, parameters: v })} />;
  }

  return (
    <div className="space-y-4" data-testid="node-config">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground font-mono truncate">{node.type} · {node.id}</div>
          {kb && <span className={`inline-block mt-1 text-[10px] px-1.5 rounded border ${MAU_HANG[kb.tacDungPhu]}`}>{t(`flowStudio.hang.${kb.tacDungPhu}`)}</span>}
          {!kb && <p className="text-xs text-destructive mt-1">{t("flowStudio.cauHinh.chuaDangKy")}</p>}
        </div>
        <Button type="button" variant="outline" size="sm" data-testid="xoa-node" onClick={onXoa}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          {t("flowStudio.cauHinh.xoaNode")}
        </Button>
      </div>
      <Truong nhan={t("flowStudio.cauHinh.ten")}>
        <Input data-testid="node-ten" className="h-9 text-sm" value={node.name} onChange={(e) => onDoi({ ...node, name: e.target.value })} />
      </Truong>
      <div key={node.id}>{form}</div>
      <div className="border-t pt-3 space-y-2">
        <Truong nhan={t("flowStudio.cauHinh.khiLoi")}>
          <OChon
            giaTri={node.khiLoi ?? "dung"}
            onDoi={(v) => onDoi({ ...node, khiLoi: v === "dung" ? undefined : (v as NodeInstance["khiLoi"]) })}
            luaChon={["dung", "tiep-tuc", "nhanh-loi"].map((v) => ({ v, nhan: t(`flowStudio.cauHinh.khiLoiChon.${v}`) }))}
          />
        </Truong>
        <OHop nhan={t("flowStudio.cauHinh.tatNode")} giaTri={node.disabled === true} onDoi={(v) => onDoi({ ...node, disabled: v || undefined })} />
      </div>
    </div>
  );
}
