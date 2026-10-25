/**
 * Form CÓ KIỂU cho 4 node mới của Luồng AI: `du-lieu.so-lieu` · `tich-hop.thong-bao` · `kich-hoat.su-kien` · `bao-tri.tao-phieu` (lô Luồng-form).
 * KHÔNG phải đường duy nhất: ô JSON thô vẫn còn cho người nâng cao, và MÁY CHỦ kiểm tham số y như nhau lúc lưu (`kiemThamSoNutMoi` / `kiemThamSoSuKien`) và lúc chạy.
 * Form chặn giá trị ngoài khoảng ngay khi gõ; mọi ô chữ vẫn nhận biểu thức `{{ … }}`. Danh sách người nhận lấy từ `flow.nguoiNhanChoLuong` (máy chủ lọc theo nhà máy của luồng).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { OBieuThuc, OChon, OHop, Truong } from "./FormKit";

type ThamSo = Record<string, unknown>;
export interface FormNutProps {
  p: ThamSo;
  doi: (k: string, v: unknown) => void;
  flowId?: string;
}

/** Danh mục: tên truy vấn ⇒ khoá i18n. PHẢI khớp `DANH_MUC` của máy chủ (census đối chiếu). */
export const TRUY_VAN_SO_LIEU: { v: string; k: string }[] = [
  { v: "san-luong.tong-quan", k: "sanLuong" },
  { v: "oee.trung-binh", k: "oee" },
  { v: "ng.diem-do-hang-dau", k: "ng" },
  { v: "may.trang-thai", k: "may" },
  { v: "canh-bao.dang-mo", k: "canhBao" },
];
export const SU_KIEN_NOI_BO: { v: string; k: string }[] = [
  { v: "ng.alert", k: "ngAlert" },
  { v: "yield.warning", k: "yieldWarning" },
  { v: "downtime.start", k: "downtimeStart" },
];
export const NHOM_PHIEU_FORM: { v: string; k: string }[] = [
  { v: "dien", k: "dien" },
  { v: "co-khi", k: "coKhi" },
  { v: "plc-phan-mem", k: "plcPhanMem" },
  { v: "vat-tu-khac", k: "vatTuKhac" },
];
export const TRAN_NGUOI_NHAN_FORM = 20;

const laBieuThuc = (v: unknown) => typeof v === "string" && v.includes("{{");

/** Ô số nguyên có khoảng: gõ ngoài khoảng ⇒ kẹp về khoảng; để trống ⇒ bỏ tham số (máy chủ dùng mặc định). */
function OSo({ k, p, doi, min, max, testId }: { k: string; p: ThamSo; doi: FormNutProps["doi"]; min: number; max: number; testId: string }) {
  const v = p[k];
  return (
    <Input
      data-testid={testId}
      type="number"
      min={min}
      max={max}
      step={1}
      className="h-9 text-xs"
      value={typeof v === "number" ? String(v) : ""}
      onChange={(e) => {
        if (e.target.value === "") return doi(k, undefined);
        const n = Math.round(Number(e.target.value));
        if (!Number.isFinite(n)) return;
        doi(k, Math.min(max, Math.max(min, n)));
      }}
    />
  );
}

/** Ô chọn từ danh sách CỐ ĐỊNH hoặc "theo biểu thức" (hiện ô chữ). */
function OChonHoacBieuThuc({ k, p, doi, luaChon, testId, macDinh }: { k: string; p: ThamSo; doi: FormNutProps["doi"]; luaChon: { v: string; nhan: string }[]; testId: string; macDinh?: string }) {
  const { t } = useTranslation();
  const v = p[k];
  const theoBt = laBieuThuc(v);
  const BT = "__bieu-thuc__";
  return (
    <div className="space-y-1">
      <OChon
        testId={testId}
        giaTri={theoBt ? BT : String(v ?? macDinh ?? luaChon[0].v)}
        onDoi={(x) => doi(k, x === BT ? "{{ $json.x }}" : /^\d+$/.test(x) ? Number(x) : x)}
        luaChon={[...luaChon, { v: BT, nhan: t("flowStudio.form.theoBieuThuc") }]}
      />
      {theoBt && <OBieuThuc testId={`${testId}-bt`} giaTri={v} onDoi={(x) => doi(k, x)} />}
    </div>
  );
}

export function FormSoLieu({ p, doi }: FormNutProps) {
  const { t } = useTranslation();
  const tv = typeof p.truyVan === "string" ? p.truyVan : "";
  return (
    <div className="space-y-3" data-testid="form-so-lieu">
      <Truong nhan={t("flowStudio.form.soLieu.truyVan")} goiY={t("flowStudio.form.soLieu.truyVanGoiY")}>
        <OChon
          testId="so-lieu-truy-van"
          giaTri={TRUY_VAN_SO_LIEU.some((x) => x.v === tv) ? tv : ""}
          onDoi={(x) => doi("truyVan", x)}
          luaChon={[{ v: "", nhan: t("flowStudio.form.soLieu.chonTruyVan") }, ...TRUY_VAN_SO_LIEU.map((x) => ({ v: x.v, nhan: t(`flowStudio.form.soLieu.tv.${x.k}`) }))]}
        />
      </Truong>
      <Truong nhan={t("flowStudio.form.soLieu.gio")} goiY={t("flowStudio.form.soLieu.gioGoiY")}>
        <OSo k="gio" p={p} doi={doi} min={1} max={168} testId="so-lieu-gio" />
      </Truong>
      <Truong nhan={t("flowStudio.form.soLieu.gioiHan")} goiY={t("flowStudio.form.soLieu.gioiHanGoiY")}>
        <OSo k="gioiHan" p={p} doi={doi} min={1} max={20} testId="so-lieu-gioi-han" />
      </Truong>
      <Truong nhan={t("flowStudio.form.truongRa")}>
        <Input data-testid="so-lieu-truong-ra" className="h-9 text-xs font-mono" value={String(p.truongRa ?? "")} onChange={(e) => doi("truongRa", e.target.value)} />
      </Truong>
    </div>
  );
}

/** Chọn người nhận: tìm theo tên (máy chủ chỉ trả người trong phạm vi nhà máy của luồng), tối đa 20. */
function ChonNguoiNhan({ flowId, ids, onDoi }: { flowId?: string; ids: number[]; onDoi: (v: number[]) => void }) {
  const { t } = useTranslation();
  const [tim, setTim] = useState("");
  const [timTre, setTimTre] = useState("");
  const [ten, setTen] = useState<Record<number, string>>({});
  useEffect(() => {
    const h = setTimeout(() => setTimTre(tim.trim()), 300);
    return () => clearTimeout(h);
  }, [tim]);
  const q = trpc.flow.nguoiNhanChoLuong.useQuery({ flowId: flowId ?? "x", tim: timTre }, { enabled: !!flowId && timTre.length >= 2, retry: false });
  const day = ids.length >= TRAN_NGUOI_NHAN_FORM;
  return (
    <div className="space-y-2" data-testid="chon-nguoi-nhan">
      <div className="flex flex-wrap gap-1" data-testid="nguoi-nhan-da-chon">
        {ids.length === 0 && <span className="text-[11px] text-muted-foreground">{t("flowStudio.form.thongBao.chuaChon")}</span>}
        {ids.map((id) => (
          <span key={id} data-testid={`nn-da-chon-${id}`} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs">
            {ten[id] ?? `#${id}`}
            <button type="button" aria-label={t("flowStudio.form.thongBao.bo")} data-testid={`nn-bo-${id}`} onClick={() => onDoi(ids.filter((x) => x !== id))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("flowStudio.form.thongBao.demNguoi", { n: ids.length, max: TRAN_NGUOI_NHAN_FORM })}</p>
      <Input data-testid="nn-tim" className="h-9 text-xs" placeholder={t("flowStudio.form.thongBao.timNguoi")} value={tim} onChange={(e) => setTim(e.target.value)} />
      {timTre.length >= 2 && q.isLoading && <p className="text-[11px] text-muted-foreground">…</p>}
      {q.data && q.data.length === 0 && <p className="text-[11px] text-muted-foreground" data-testid="nn-khong-thay">{t("flowStudio.form.thongBao.khongThay")}</p>}
      <ul className="space-y-1" data-testid="nn-ket-qua">
        {(q.data ?? []).map((u) => (
          <li key={u.id} className="flex items-center gap-2 text-xs">
            <span className="truncate">{u.ten ?? `#${u.id}`}</span>
            <span className="text-muted-foreground">{u.vaiTro}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto h-6 px-2"
              data-testid={`nn-them-${u.id}`}
              disabled={day || ids.includes(u.id)}
              onClick={() => {
                setTen((m) => ({ ...m, [u.id]: u.ten ?? `#${u.id}` }));
                onDoi([...ids, u.id]);
              }}
            >
              {t("flowStudio.form.thongBao.them")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FormThongBao({ p, doi, flowId }: FormNutProps) {
  const { t } = useTranslation();
  const theoBt = !Array.isArray(p.nguoiNhan) && p.nguoiNhan !== undefined;
  const ids = Array.isArray(p.nguoiNhan) ? (p.nguoiNhan as unknown[]).map(Number).filter((x) => Number.isSafeInteger(x) && x > 0) : [];
  return (
    <div className="space-y-3" data-testid="form-thong-bao">
      <Truong nhan={t("flowStudio.form.thongBao.nguoiNhan")} goiY={t("flowStudio.form.thongBao.nguoiNhanGoiY")}>
        {theoBt ? (
          <div className="space-y-1">
            <OBieuThuc testId="nn-bieu-thuc" giaTri={p.nguoiNhan} onDoi={(v) => doi("nguoiNhan", v)} />
            <Button type="button" size="sm" variant="outline" data-testid="nn-ve-danh-sach" onClick={() => doi("nguoiNhan", [])}>
              {t("flowStudio.form.thongBao.veDanhSach")}
            </Button>
          </div>
        ) : (
          <ChonNguoiNhan flowId={flowId} ids={ids} onDoi={(v) => doi("nguoiNhan", v)} />
        )}
      </Truong>
      <Truong nhan={t("flowStudio.form.thongBao.tieuDe")}>
        <OBieuThuc testId="tb-tieu-de" giaTri={p.tieuDe} onDoi={(v) => doi("tieuDe", v)} />
      </Truong>
      <Truong nhan={t("flowStudio.form.thongBao.noiDung")}>
        <OBieuThuc testId="tb-noi-dung" nhieuDong giaTri={p.noiDung} onDoi={(v) => doi("noiDung", v)} />
      </Truong>
      <Truong nhan={t("flowStudio.form.thongBao.loai")}>
        <OChonHoacBieuThuc k="loai" p={p} doi={doi} testId="tb-loai" macDinh="REPORT" luaChon={["REPORT", "INFO", "WARNING"].map((v) => ({ v, nhan: t(`flowStudio.form.thongBao.loaiOpt.${v}`) }))} />
      </Truong>
      <Truong nhan={t("flowStudio.form.thongBao.uuTien")}>
        <OChonHoacBieuThuc k="uuTien" p={p} doi={doi} testId="tb-uu-tien" macDinh="NORMAL" luaChon={["LOW", "NORMAL", "HIGH"].map((v) => ({ v, nhan: t(`flowStudio.form.thongBao.uuTienOpt.${v}`) }))} />
      </Truong>
      <Truong nhan={t("flowStudio.form.thongBao.duongDan")}>
        <Input data-testid="tb-duong-dan" className="h-9 text-xs font-mono" value={String(p.duongDan ?? "")} onChange={(e) => doi("duongDan", e.target.value)} />
      </Truong>
    </div>
  );
}

export function FormSuKien({ p, doi }: FormNutProps) {
  const { t } = useTranslation();
  const sk = typeof p.suKien === "string" ? p.suKien : "";
  return (
    <div className="space-y-3" data-testid="form-su-kien">
      <Truong nhan={t("flowStudio.form.suKien.suKien")} goiY={t("flowStudio.form.suKien.suKienGoiY")}>
        <OChon
          testId="sk-su-kien"
          giaTri={SU_KIEN_NOI_BO.some((x) => x.v === sk) ? sk : ""}
          onDoi={(x) => doi("suKien", x)}
          luaChon={[{ v: "", nhan: t("flowStudio.form.suKien.chonSuKien") }, ...SU_KIEN_NOI_BO.map((x) => ({ v: x.v, nhan: t(`flowStudio.form.suKien.sk.${x.k}`) }))]}
        />
      </Truong>
      <div className="space-y-1">
        <OHop testId="sk-bat" giaTri={p.bat === true} onDoi={(v) => doi("bat", v)} nhan={t("flowStudio.form.suKien.bat")} />
        <p className="text-[11px] text-muted-foreground">{t("flowStudio.form.suKien.batGoiY")}</p>
      </div>
      <Truong nhan={t("flowStudio.form.suKien.cuaSo")} goiY={t("flowStudio.form.suKien.cuaSoGoiY")}>
        <OSo k="cuaSoPhut" p={p} doi={doi} min={1} max={1440} testId="sk-cua-so" />
      </Truong>
      <Truong nhan={t("flowStudio.form.suKien.tran")} goiY={t("flowStudio.form.suKien.tranGoiY")}>
        <OSo k="tranMoiGio" p={p} doi={doi} min={1} max={30} testId="sk-tran" />
      </Truong>
    </div>
  );
}

export function FormTaoPhieu({ p, doi }: FormNutProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="form-tao-phieu">
      <Truong nhan={t("flowStudio.form.taoPhieu.may")} goiY={t("flowStudio.form.taoPhieu.mayGoiY")}>
        <OBieuThuc testId="tp-may" giaTri={p.may} onDoi={(v) => doi("may", v)} />
      </Truong>
      <Truong nhan={t("flowStudio.form.taoPhieu.tieuDe")}>
        <OBieuThuc testId="tp-tieu-de" giaTri={p.tieuDe} onDoi={(v) => doi("tieuDe", v)} />
      </Truong>
      <Truong nhan={t("flowStudio.form.taoPhieu.moTa")}>
        <OBieuThuc testId="tp-mo-ta" nhieuDong giaTri={p.moTa} onDoi={(v) => doi("moTa", v)} />
      </Truong>
      <Truong nhan={t("flowStudio.form.taoPhieu.nhom")} goiY={t("flowStudio.form.taoPhieu.nhomGoiY")}>
        <OChonHoacBieuThuc k="nhom" p={p} doi={doi} testId="tp-nhom" macDinh="vat-tu-khac" luaChon={NHOM_PHIEU_FORM.map((x) => ({ v: x.v, nhan: t(`flowStudio.form.taoPhieu.nhomOpt.${x.k}`) }))} />
      </Truong>
      <Truong nhan={t("flowStudio.form.taoPhieu.uuTien")} goiY={t("flowStudio.form.taoPhieu.uuTienGoiY")}>
        <OChonHoacBieuThuc k="uuTien" p={p} doi={doi} testId="tp-uu-tien" macDinh="3" luaChon={[1, 2, 3, 4, 5].map((n) => ({ v: String(n), nhan: String(n) }))} />
      </Truong>
      <Truong nhan={t("flowStudio.form.taoPhieu.loai")}>
        <OChonHoacBieuThuc k="loai" p={p} doi={doi} testId="tp-loai" macDinh="CORRECTIVE" luaChon={["CORRECTIVE", "BREAKDOWN", "INSPECTION"].map((v) => ({ v, nhan: t(`flowStudio.form.taoPhieu.loaiOpt.${v}`) }))} />
      </Truong>
    </div>
  );
}
