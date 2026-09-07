/**
 * ThuVienAsset.tsx — dải thư viện asset dưới cùng màn Thiết kế (§7.1, §7.4).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 12 LÔ M — NÚT "TẢI MÔ HÌNH LÊN" ĐÃ LÀM THẬT (#18)
 * ════════════════════════════════════════════════════════════════════════════
 * Bản trước cố ý hiện toast "sẽ có ở đợt sau" thay vì mở hộp chọn tệp rồi hỏng
 * — quyết định đúng lúc đó, và lý lẽ nguyên văn của nó đáng giữ lại: *"một nút
 * mở được nhưng không hoàn thành được việc là lời khai sai về năng lực của hệ,
 * và nó tốn của người dùng một lần thử, một tệp 15 MB, và niềm tin."*
 *
 * Nợ N-2/N-3 giờ đã trả được vì ba mảnh có mặt cùng lúc:
 *   • `kiemTraAsset.ts` — ngưỡng ba bậc §10B.2, module thuần, 18 test.
 *   • `twinCanh.taiModelMay` — đường ghi có hàng rào tenant, dùng lại đăng bạ
 *     `equipment_3d_models` sẵn có (KHÔNG dựng bảng/đăng bạ thứ hai — G12).
 *   • `napModel.ts` + `loi/ModelMay.tsx` — cảnh 3D biết dùng model đã tải.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NỐI VÀO GÁN 3 CẤP CÓ SẴN (§10B.2), KHÔNG DỰNG CƠ CHẾ THỨ HAI
 * ════════════════════════════════════════════════════════════════════════════
 * §10B.2 mô tả đúng hai nút mà khối này dựng:
 *
 *     ┌──────────────────────────────────────────────┐
 *     │  aoi-machine.glb    12.400 tam giác  1,8 MB  │
 *     │  [Gán cho máy này]  [Gán cho MỌI máy AOI ▾]  │
 *     └──────────────────────────────────────────────┘
 *
 * Cấp 2 là cấp spec gọi là "đáng dùng nhất" — một tệp cho `AOI` đổi hình mọi máy
 * AOI cùng lúc. Cả hai nút đi vào CÙNG một thủ tục, khác nhau đúng trường
 * `phamVi`; thứ tự ưu tiên khi hiển thị do `napModel.chonModelChoMay` áp, và nó
 * là bản sao có test của `pickBestModel` phía server.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐO TAM GIÁC TRÊN TRÌNH DUYỆT, TRƯỚC KHI UPLOAD (§7.4)
 * ════════════════════════════════════════════════════════════════════════════
 * Luồng của §7.4 đặt phép đo TRƯỚC lượt tải lên, và đó không phải chuyện tiết
 * kiệm băng thông: người dùng phải thấy CON SỐ rồi mới quyết định. Một hệ chỉ
 * báo "tệp bị từ chối" sau 40 MB upload không nói được họ cần nén bao nhiêu.
 *
 * ★ `GLTFLoader` nạp động (`await import`) — nó kéo theo `three`, và gói này
 *   nằm trong chunk `vendor-three`. Nạp tĩnh sẽ lôi `three` vào chunk của mọi
 *   màn có dải asset, kể cả khi người dùng không bao giờ bấm nút tải lên.
 *
 * ★ Thẻ khối dựng sẵn lấy TỪ `hinhKhoiMay.ts` (`DANH_SACH_KHOI`, 7 khối đã đo
 *   đúng 60 tam giác mỗi khối) — không chép danh sách ra đây. Chép ra là tạo
 *   nguồn sự thật thứ hai, và nó sẽ trôi khỏi bản gốc ở đợt thêm loại máy mới.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Box, CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { trpc } from "@/lib/trpc";

import { DANH_SACH_KHOI, type KhoiKey } from "../hinhKhoiMay";
import {
  NGUONG_BYTE_CHAN,
  boundsTuBBox,
  chamModel,
  chamTenTep,
  soLechKichThuoc,
  type KetQuaKiemTra,
} from "../kiemTraAsset";

/** Nhóm hạ tầng/kho — khớp `twinvatTheenum` của §5.3, không tự chế danh sách. */
const HA_TANG = ["tuong", "cot", "cua", "vachKe", "raoAnToan", "bienBao"] as const;
const KHO = ["ke", "pallet", "bangTai"] as const;

type Nhom = "may" | "haTang" | "kho";

function The({ nhan, testId }: { nhan: string; testId: string }) {
  return (
    <div
      className="flex shrink-0 cursor-grab items-center gap-1.5 rounded border bg-background px-2 py-1 text-[11px] hover:bg-muted"
      draggable
      data-testid={testId}
    >
      <Box className="h-3.5 w-3.5 text-muted-foreground" />
      {nhan}
    </div>
  );
}

/** Máy mà dải này có thể gán model cho — hình dạng tối thiểu từ `canhThietKe`. */
export interface MayChoThuVien {
  id: number;
  ma: string;
  ten?: string | null;
  loaiMay: string;
  /** Kích thước KHAI BÁO (mm) để so với bbox của file (§10B.2). */
  rongMm?: number | null;
  caoMm?: number | null;
  sauMm?: number | null;
}

/** Số đo một tệp glTF sau khi nạp trên trình duyệt. */
interface SoDoTep {
  tenTep: string;
  soByte: number;
  soTamGiac: number;
  soMaterial: number;
  /** BBox theo ĐƠN VỊ CỦA FILE (thường mét) — quy ra mm ở chỗ so sánh. */
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
  base64: string;
  ket: KetQuaKiemTra;
}

export interface ThuVienAssetProps {
  /** Máy trên tầng đang mở. Rỗng ⇒ khối tải lên vẫn hiện nhưng không gán được. */
  may?: readonly MayChoThuVien[];
  /** machineId đang chọn ở cây/cảnh — đích của nút "Gán cho máy này". */
  mayDangChon?: number | null;
  /** ★ CHẶN-2 — dải này chỉ mở đường GHI khi người dùng có quyền sửa. */
  coQuyenSua?: boolean;
  /** Gọi sau khi đăng ký xong, để cảnh nạp lại bảng model. */
  onDaGanModel?: () => void;
}

/**
 * Đọc một `File` thành base64 THUẦN (đã bỏ tiền tố `data:`).
 *
 * ⚠ `FileReader.result` của `readAsDataURL` là `data:<mime>;base64,<payload>`.
 *   Gửi nguyên chuỗi đó lên server thì `Buffer.from(x,"base64")` KHÔNG ném — nó
 *   lặng lẽ bỏ ký tự lạ và cho ra một buffer RÁC, rồi `validateUpload` từ chối
 *   với câu "không phải glTF" trong khi tệp hoàn toàn hợp lệ. Cắt ở đây, một chỗ.
 */
function docBase64(tep: File): Promise<{ base64: string; buffer: ArrayBuffer }> {
  return new Promise((giai, tuChoi) => {
    const r = new FileReader();
    r.onerror = () => tuChoi(new Error("read-failed"));
    r.onload = () => {
      const tho = String(r.result ?? "");
      const i = tho.indexOf(",");
      const base64 = i >= 0 ? tho.slice(i + 1) : tho;
      const r2 = new FileReader();
      r2.onerror = () => tuChoi(new Error("read-failed"));
      r2.onload = () => giai({ base64, buffer: r2.result as ArrayBuffer });
      r2.readAsArrayBuffer(tep);
    };
    r.readAsDataURL(tep);
  });
}

export function ThuVienAsset({
  may = [],
  mayDangChon = null,
  coQuyenSua = false,
  onDaGanModel,
}: ThuVienAssetProps = {}) {
  const { t } = useTranslation();
  const [nhom, setNhom] = useState<Nhom>("may");
  const [loc, setLoc] = useState("");
  const [dangDo, setDangDo] = useState(false);
  const [soDo, setSoDo] = useState<SoDoTep | null>(null);
  const [loaiChon, setLoaiChon] = useState<string>("");
  const oTep = useRef<HTMLInputElement | null>(null);

  const taiM = trpc.twinCanh.taiModelMay.useMutation();

  const the = useMemo(() => {
    const q = loc.trim().toLowerCase();
    const ds: { nhan: string; id: string }[] =
      nhom === "may"
        ? DANH_SACH_KHOI.map((k: KhoiKey) => ({ id: k, nhan: k.replace(/_/g, " ") }))
        : nhom === "haTang"
          ? HA_TANG.map((k) => ({ id: k, nhan: t(`twin3d.vatThe.${k}`) }))
          : KHO.map((k) => ({ id: k, nhan: t(`twin3d.vatThe.${k}`) }));
    return q === "" ? ds : ds.filter((x) => x.nhan.toLowerCase().includes(q));
  }, [nhom, loc, t]);

  /** Chủng loại máy CÓ THẬT trên tầng này — không liệt kê 24 giá trị enum lý thuyết. */
  const loaiCoThat = useMemo(() => {
    const s = new Set<string>();
    for (const m of may) if (m.loaiMay) s.add(m.loaiMay);
    return [...s].sort();
  }, [may]);

  const mayChon = useMemo(
    () => may.find((m) => m.id === mayDangChon) ?? null,
    [may, mayDangChon],
  );

  /**
   * Đo tệp NGAY TRÊN TRÌNH DUYỆT rồi hiện số — chưa upload gì.
   *
   * ★★★ `GLTFLoader.parse` KHÔNG ném cho mọi tệp hỏng; với glTF JSON sai lược đồ
   *   nó gọi `onError`. Nên bắt CẢ HAI đường (try/catch + callback lỗi), nếu
   *   không một tệp hỏng làm treo hộp thoại ở trạng thái "đang đo" vĩnh viễn.
   */
  const chonTep = useCallback(
    async (tep: File) => {
      setSoDo(null);
      const theoTen = chamTenTep(tep.name);
      if (theoTen) {
        toast.error(t("twin3d.model.duoiKhongNhan"));
        return;
      }
      // ★ Chặn dung lượng TRƯỚC khi nạp: một tệp 200 MB nạp trong tab sẽ làm
      //   đơ trình duyệt trước khi ta kịp nói nó quá lớn.
      if (tep.size > NGUONG_BYTE_CHAN) {
        setSoDo({
          tenTep: tep.name,
          soByte: tep.size,
          soTamGiac: 0,
          soMaterial: 0,
          bbox: null,
          base64: "",
          ket: chamModel({ soTamGiac: 0, soByte: tep.size }),
        });
        return;
      }

      setDangDo(true);
      try {
        const [{ GLTFLoader }, THREE] = await Promise.all([
          import("three/examples/jsm/loaders/GLTFLoader.js"),
          import("three"),
        ]);
        const { base64, buffer } = await docBase64(tep);
        const goc = await new Promise<import("three").Object3D>((giai, tuChoi) => {
          new GLTFLoader().parse(
            buffer,
            "",
            (g) => giai(g.scene),
            (e) => tuChoi(e instanceof Error ? e : new Error(String(e))),
          );
        });

        let soTamGiac = 0;
        const vatLieu = new Set<unknown>();
        goc.traverse((o) => {
          const m = o as import("three").Mesh;
          if (m.isMesh && m.geometry) {
            const g = m.geometry;
            // ★ Có index thì số tam giác = index/3; không index thì = đỉnh/3.
            //   Dùng nhầm một trong hai cho ra sai số gấp vài lần và không gì nổ.
            soTamGiac += g.index
              ? g.index.count / 3
              : (g.getAttribute("position")?.count ?? 0) / 3;
            if (m.material) vatLieu.add(m.material);
          }
        });
        soTamGiac = Math.round(soTamGiac);

        const hop = new THREE.Box3().setFromObject(goc);
        const bbox: SoDoTep["bbox"] = hop.isEmpty()
          ? null
          : {
              min: [hop.min.x, hop.min.y, hop.min.z],
              max: [hop.max.x, hop.max.y, hop.max.z],
            };

        setSoDo({
          tenTep: tep.name,
          soByte: tep.size,
          soTamGiac,
          soMaterial: vatLieu.size,
          bbox,
          base64,
          ket: chamModel({ soTamGiac, soByte: tep.size }),
        });
      } catch {
        toast.error(t("twin3d.model.napHong"));
      } finally {
        setDangDo(false);
      }
    },
    [t],
  );

  /**
   * So bbox của file với kích thước KHAI BÁO của máy đang chọn (§10B.2).
   *
   * ⚠ bbox của glTF ở ĐƠN VỊ CỦA FILE — quy ước glTF 2.0 là MÉT. Nhân 1000 để
   *   ra mm. Đây là chỗ duy nhất trong khối này giả định đơn vị, và nó nói ra
   *   thay vì im: §10B.2 cảnh báo `donViDeNghi` của `docBanVe.ts` tự khai "chắc
   *   chắn" SAI với vật thể nhỏ, nên ta KHÔNG gọi nó — ta dùng quy ước của định
   *   dạng, và kết quả chỉ dùng để HỎI người dùng, không để tự sửa gì.
   */
  const lech = useMemo(() => {
    if (!soDo?.bbox || !mayChon) return null;
    const khai = {
      rongMm: Number(mayChon.rongMm ?? 0),
      caoMm: Number(mayChon.caoMm ?? 0),
      sauMm: Number(mayChon.sauMm ?? 0),
    };
    if (khai.rongMm <= 0 && khai.caoMm <= 0 && khai.sauMm <= 0) return null;
    const [ix, iy, iz] = soDo.bbox.min;
    const [ax, ay, az] = soDo.bbox.max;
    return soLechKichThuoc(
      { rongMm: (ax - ix) * 1000, caoMm: (ay - iy) * 1000, sauMm: (az - iz) * 1000 },
      khai,
    );
  }, [soDo, mayChon]);

  const gan = useCallback(
    async (phamVi: "may" | "chung_loai") => {
      if (!soDo || soDo.ket.bac === "chan" || soDo.base64 === "") return;
      try {
        await taiM.mutateAsync({
          phamVi,
          machineId: phamVi === "may" ? (mayDangChon ?? undefined) : undefined,
          loaiMay: phamVi === "chung_loai" ? loaiChon : undefined,
          tenTep: soDo.tenTep,
          noiDungBase64: soDo.base64,
          soTamGiac: soDo.soTamGiac,
          bounds: soDo.bbox ? boundsTuBBox(soDo.bbox) : undefined,
        });
        toast.success(t("twin3d.model.daGan"));
        setSoDo(null);
        if (oTep.current) oTep.current.value = "";
        onDaGanModel?.();
      } catch (e) {
        toastTrpcError(e);
      }
    },
    [soDo, taiM, mayDangChon, loaiChon, t, onDaGanModel],
  );

  const mb = (b: number) => (b / 1048576).toFixed(1);

  return (
    <div className="border-t px-3 py-1.5" data-testid="thu-vien-asset">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t("twin3d.thuVien.tieuDe")}
        </span>
        <Tabs value={nhom} onValueChange={(v) => setNhom(v as Nhom)}>
          <TabsList className="h-7">
            <TabsTrigger value="may" className="h-6 px-2 text-[11px]">
              {t("twin3d.thuVien.may")}
            </TabsTrigger>
            <TabsTrigger value="haTang" className="h-6 px-2 text-[11px]">
              {t("twin3d.thuVien.haTang")}
            </TabsTrigger>
            <TabsTrigger value="kho" className="h-6 px-2 text-[11px]">
              {t("twin3d.thuVien.kho")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          className="h-7 w-40 text-xs"
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          placeholder={t("twin3d.thuVien.loc")}
          data-testid="loc-thu-vien"
        />

        {/* ★★★ CHẶN-2 — nút tải lên là đường GHI: ẩn hẳn khi chỉ đọc, không
            `disabled`. Một nút xám vẫn nói "chức năng này thuộc về bạn". */}
        {coQuyenSua ? (
          <>
            <input
              ref={oTep}
              type="file"
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
              className="hidden"
              data-testid="o-chon-tep-model"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void chonTep(f);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 gap-1.5 text-[11px]"
              data-testid="nut-tai-model"
              disabled={dangDo}
              onClick={() => oTep.current?.click()}
            >
              {dangDo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {t("twin3d.thuVien.taiLen")}
            </Button>
          </>
        ) : null}
      </div>

      {/* ── Thẻ model vừa đo — §10B.2 vẽ đúng khối này ──────────────────── */}
      {soDo ? (
        <div
          className="mt-1.5 rounded border bg-muted/40 px-2 py-1.5 text-[11px]"
          data-testid="the-model-vua-do"
        >
          <div className="flex flex-wrap items-center gap-2">
            {soDo.ket.bac === "chan" ? (
              <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            ) : soDo.ket.bac === "canh_bao" ? (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
            )}
            <span className="font-medium" data-testid="ten-tep-model">
              {soDo.tenTep}
            </span>
            {/* ★ CON SỐ, không phải chữ "lớn/nhỏ". Người dùng cần biết nén bao
                nhiêu, và chỉ con số nói được điều đó (NT-4). */}
            <span className="text-muted-foreground" data-testid="so-tam-giac">
              {soDo.soTamGiac.toLocaleString()} {t("twin3d.model.tamGiac")}
            </span>
            <span className="text-muted-foreground" data-testid="so-byte-model">
              {mb(soDo.soByte)} MB
            </span>
            {soDo.soMaterial > 0 ? (
              <span className="text-muted-foreground">
                {soDo.soMaterial} {t("twin3d.model.material")}
              </span>
            ) : null}
          </div>

          {/* Lý do — mỗi lý do một dòng, khoá i18n theo hậu tố, không câu viết cứng. */}
          {soDo.ket.lyDo.length > 0 ? (
            <ul className="mt-1 space-y-0.5" data-testid="ly-do-model">
              {soDo.ket.lyDo.map((ld) => (
                <li
                  key={ld}
                  className={soDo.ket.bac === "chan" ? "text-destructive" : "text-warning"}
                >
                  {t(`twin3d.model.lyDo.${ld}`)}
                </li>
              ))}
            </ul>
          ) : null}
          {soDo.ket.goiYNen ? (
            <p className="mt-0.5 text-muted-foreground" data-testid="goi-y-nen">
              {t("twin3d.model.goiYNen")}
            </p>
          ) : null}

          {/* ★ §10B.2 — bbox lệch > 30 % so với khai báo thì HỎI, không tự sửa. */}
          {lech?.vuotNguong ? (
            <p className="mt-0.5 text-warning" data-testid="canh-bao-lech-bbox">
              {t("twin3d.model.lechKichThuoc", {
                phanTram: Math.round(lech.lechLonNhat * 100),
              })}
            </p>
          ) : null}

          {/* ── Hai nút gán của §10B.2 ─────────────────────────────────── */}
          {soDo.ket.bac !== "chan" ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                data-testid="nut-gan-may-nay"
                disabled={mayDangChon === null || taiM.isPending}
                onClick={() => void gan("may")}
              >
                {mayChon
                  ? t("twin3d.model.ganMayNay", { ma: mayChon.ma })
                  : t("twin3d.model.chuaChonMay")}
              </Button>

              <div className="flex items-center gap-1">
                <Select value={loaiChon} onValueChange={setLoaiChon}>
                  <SelectTrigger className="h-7 w-36 text-[11px]" data-testid="chon-chung-loai">
                    <SelectValue placeholder={t("twin3d.model.chonChungLoai")} />
                  </SelectTrigger>
                  <SelectContent>
                    {loaiCoThat.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  data-testid="nut-gan-chung-loai"
                  disabled={loaiChon === "" || taiM.isPending}
                  onClick={() => void gan("chung_loai")}
                >
                  {/* ★ Nói RÕ SỐ MÁY sẽ đổi. "Gán cho mọi máy AOI" không cho biết
                      đó là 1 máy hay 14 — và 14 là một quyết định khác hẳn. */}
                  {t("twin3d.model.ganMoiMay", {
                    n: may.filter((m) => m.loaiMay === loaiChon).length,
                  })}
                </Button>
              </div>

              {taiM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            </div>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            className="mt-1 h-6 px-2 text-[11px]"
            data-testid="nut-bo-model"
            onClick={() => {
              setSoDo(null);
              if (oTep.current) oTep.current.value = "";
            }}
          >
            {t("common.cancel", "Huỷ")}
          </Button>
        </div>
      ) : null}

      <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
        {the.map((x) => (
          <The key={x.id} nhan={x.nhan} testId={`the-asset-${x.id}`} />
        ))}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{t("twin3d.thuVien.keoVaoCanh")}</p>
    </div>
  );
}

export default ThuVienAsset;
