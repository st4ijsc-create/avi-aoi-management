/**
 * R1b-2b-2b B-T9 — Lab "thử đọc một địa chỉ" ở ngăn tag M10 (`scadaDiag.thuDocDiaChi`, hợp đồng C4). CHỈ ĐỌC: không có nút / ô nào ghi hay sửa.
 * Máy chủ là ranh giới thật (vai admin|engineer + giấy phép + machine_control.canEdit + phạm vi + giao thức + trần 10 lượt / phút / người + một lượt /
 * adapter); khối này chỉ hiện cho người có `canAct`. Lý do 5..300 ký tự bắt buộc (ghi audit ở máy chủ, không lưu giá trị đọc).
 * Lỗi OPERATION_FAILED {operation:"scadaLabRead", reason} đi qua `mapTrpcError` ⇒ câu dịch; kết quả cũ / lỗi cũ bị thay mỗi lượt mới.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hienChatLuong } from "./chatLuongHienThi";
import { LOP_O_CHON, TruongLyDo, lyDoDuDai } from "./TruongLyDo";

const KIEU = ["bool", "int", "float", "string"] as const;
type KieuDoc = (typeof KIEU)[number];

interface KetQuaDoc {
  quality: "good" | "uncertain" | "bad";
  raw: unknown;
  giaTri: number | boolean | string | null;
  statusCode: string | null;
  reason: string | null;
  ms: number;
}

const chuoi = (v: unknown): string => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function KhoiThuDocDiaChi({ adapterId }: { adapterId: number }) {
  const { t } = useTranslation();
  const [diaChi, setDiaChi] = useState("");
  const [kieu, setKieu] = useState<KieuDoc>("int");
  const [lyDo, setLyDo] = useState("");
  const [ketQua, setKetQua] = useState<KetQuaDoc | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  const doc = trpc.scadaDiag.thuDocDiaChi.useMutation({
    onSuccess: (r: unknown) => {
      setLoi(null);
      setKetQua(r as KetQuaDoc);
    },
    onError: (e: unknown) => {
      setKetQua(null);
      setLoi(mapTrpcError(e as never));
    },
  });

  const diaChiCat = diaChi.trim();
  const guiDuoc = diaChiCat.length > 0 && lyDoDuDai(lyDo) && !doc.isPending;
  const gui = () => {
    if (!guiDuoc) return;
    doc.mutate({ adapterId, address: diaChiCat, dataType: kieu, lyDo: lyDo.trim() });
  };

  const lyDoKetQua = (r: string | null): string => (r === null ? "—" : r === "timeout" ? t("scada.lab.thuDoc.reasonTimeout") : r === "no_sample" ? t("scada.lab.thuDoc.reasonNoSample") : r);

  return (
    <section data-testid="khoi-thu-doc" className="mt-4 space-y-3 rounded-md border border-dashed p-3" aria-labelledby="thu-doc-tieu-de">
      <h3 id="thu-doc-tieu-de" className="text-sm font-semibold">
        {t("scada.lab.thuDoc.tieuDe")}
      </h3>
      <p className="text-xs font-medium">{t("scada.lab.thuDoc.chiDoc")}</p>
      <p className="text-xs text-muted-foreground">{t("scada.lab.thuDoc.troGiup")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="thu-doc-dia-chi">{t("scada.lab.thuDoc.diaChi")}</Label>
          <Input id="thu-doc-dia-chi" value={diaChi} maxLength={128} onChange={(e) => setDiaChi(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="thu-doc-kieu">{t("scada.lab.thuDoc.kieu")}</Label>
          <select id="thu-doc-kieu" className={LOP_O_CHON} value={kieu} onChange={(e) => setKieu(e.target.value as KieuDoc)}>
            {KIEU.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>
      <TruongLyDo id="thu-doc-ly-do" value={lyDo} onChange={setLyDo} />
      <Button size="sm" onClick={gui} disabled={!guiDuoc}>
        {t("scada.lab.thuDoc.nutDoc")}
      </Button>
      {loi && (
        <p role="alert" className="text-sm text-destructive">
          {loi}
        </p>
      )}
      {ketQua && (
        <dl data-testid="thu-doc-ket-qua" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("scada.lab.thuDoc.chatLuong")}</dt>
          <dd>{t(`scada.diag.chatLuong.${hienChatLuong(ketQua.quality, false).kieu}`)}</dd>
          <dt className="text-muted-foreground">{t("scada.lab.thuDoc.giaTriTho")}</dt>
          <dd className="break-all">{chuoi(ketQua.raw)}</dd>
          <dt className="text-muted-foreground">{t("scada.lab.thuDoc.giaTri")}</dt>
          <dd className="break-all">{chuoi(ketQua.giaTri)}</dd>
          <dt className="text-muted-foreground">{t("scada.lab.thuDoc.maTrangThai")}</dt>
          <dd>{chuoi(ketQua.statusCode)}</dd>
          <dt className="text-muted-foreground">{t("scada.lab.thuDoc.lyDoKetQua")}</dt>
          <dd className="break-all">{lyDoKetQua(ketQua.reason)}</dd>
          <dt className="text-muted-foreground">{t("scada.lab.thuDoc.thoiGian")}</dt>
          <dd>{ketQua.ms} ms</dd>
        </dl>
      )}
    </section>
  );
}
