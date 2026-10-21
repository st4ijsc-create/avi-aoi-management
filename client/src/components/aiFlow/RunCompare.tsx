/**
 * ★★ AI Local Đợt 9.2 — SO SÁNH HAI LƯỢT CHẠY trong Flow Studio.
 *
 * Gọi `flow.dongThoiGian` cho từng lượt (không thủ tục mới) rồi so bằng `soSanhLuot` (thuần, `shared/flow/soSanhLuot.ts`):
 * khớp bước theo node#lần, khác trạng thái / thời gian / đầu vào / đầu ra / lỗi theo đường dẫn JSON.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { fmtDateTime } from "@/lib/fmtDateTime";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { soSanhLuot, type BuocSoSanh, type KetQuaKhacJson, type LuotTho } from "@shared/flow/soSanhLuot";
import { MAU_TRANG_THAI } from "@/lib/flowStudio";

const MAU_KET: Record<BuocSoSanh["ket"], string> = {
  giong: "bg-success/15 text-success border-success/40",
  khac: "bg-warning/15 text-warning border-warning/40",
  "chi-a": "bg-info/15 text-info border-info/40",
  "chi-b": "bg-info/15 text-info border-info/40",
};

const giaTriNgan = (v: unknown): string => {
  if (v === undefined) return "∅";
  const s = JSON.stringify(v);
  return s && s.length > 80 ? `${s.slice(0, 80)}…` : String(s);
};

const fmtMs = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function Khac({ nhan, k }: { nhan: string; k: KetQuaKhacJson }) {
  const { t } = useTranslation();
  if (!k.muc.length && !k.catBot && !k.bi) return null;
  return (
    <div className="text-[11px] space-y-0.5">
      <div className="font-medium">{nhan}</div>
      {k.catBot && <p className="text-warning">{t("flowStudio.soSanh.catBot")}</p>}
      {k.muc.map((m, i) => (
        <div key={i} className="font-mono break-all">
          <span className="text-muted-foreground">[{t(`flowStudio.soSanh.loai.${m.loai}`)}]</span> {m.duong}: <span className="text-destructive">{giaTriNgan(m.a)}</span> →{" "}
          <span className="text-success">{giaTriNgan(m.b)}</span>
        </div>
      ))}
      {k.bi && <p className="text-muted-foreground">{t("flowStudio.soSanh.biCat")}</p>}
    </div>
  );
}

export interface RunCompareProps {
  lichSu: { id: string; version: number; status: string; startedAt: string | Date }[];
  runIdMacDinh: string | null;
  tenNut: (nodeId: string) => string;
}

export default function RunCompare({ lichSu, runIdMacDinh, tenNut }: RunCompareProps) {
  const { t } = useTranslation();
  const [a, setA] = useState<string>(runIdMacDinh ?? lichSu[0]?.id ?? "");
  const [b, setB] = useState<string>(() => lichSu.find((r) => r.id !== (runIdMacDinh ?? lichSu[0]?.id))?.id ?? "");
  const NIL = "00000000-0000-0000-0000-000000000000";
  const qa = trpc.flow.dongThoiGian.useQuery({ runId: a || NIL }, { enabled: !!a });
  const qb = trpc.flow.dongThoiGian.useQuery({ runId: b || NIL }, { enabled: !!b });

  const kq = useMemo(() => (qa.data && qb.data ? soSanhLuot(qa.data as unknown as LuotTho, qb.data as unknown as LuotTho) : null), [qa.data, qb.data]);

  const chon = (gt: string, dat: (v: string) => void, testId: string, nhan: string) => (
    <label className="flex-1 min-w-0 text-[11px] space-y-0.5">
      <span className="text-muted-foreground">{nhan}</span>
      <select
        data-testid={testId}
        className="h-8 w-full rounded-md border border-input bg-background px-1 text-xs"
        value={gt}
        onChange={(e) => dat(e.target.value)}
      >
        <option value="">{t("flowStudio.soSanh.chon")}</option>
        {lichSu.map((r) => (
          <option key={r.id} value={r.id}>
            {`${t(`flowStudio.trangThai.${r.status}`, { defaultValue: r.status })} · v${r.version} · ${fmtDateTime(r.startedAt)}`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="border-t pt-3 space-y-3" data-testid="so-sanh-luot">
      <h3 className="text-sm font-semibold">{t("flowStudio.soSanh.tieuDe")}</h3>
      {lichSu.length < 2 ? (
        <p className="text-xs text-muted-foreground">{t("flowStudio.soSanh.canHai")}</p>
      ) : (
        <div className="flex gap-2">
          {chon(a, setA, "so-sanh-a", t("flowStudio.soSanh.luotA"))}
          {chon(b, setB, "so-sanh-b", t("flowStudio.soSanh.luotB"))}
        </div>
      )}
      {(qa.isLoading || qb.isLoading) && a && b && <Loader2 className="h-4 w-4 animate-spin" />}
      {(qa.error || qb.error) && <p className="text-xs text-destructive">{mapTrpcError((qa.error ?? qb.error)!)}</p>}
      {kq && qa.data && qb.data && (
        <>
          <div className="text-[11px] space-y-0.5" data-testid="so-sanh-tom-tat">
            <div>{t("flowStudio.soSanh.tomTat", kq.tomTat)}</div>
            {kq.khacPhienBan && <div className="text-warning">{t("flowStudio.soSanh.khacPhienBan", { a: qa.data.run.version, b: qb.data.run.version })}</div>}
            {kq.khacTrangThaiLuot && <div className="text-warning">{t("flowStudio.soSanh.khacTrangThai", { a: qa.data.run.status, b: qb.data.run.status })}</div>}
            <div className="text-muted-foreground">{t("flowStudio.soSanh.thoiGian", { a: fmtMs(kq.msLuotA), b: fmtMs(kq.msLuotB) })}</div>
            {a === b || (kq.tomTat.khac === 0 && kq.tomTat.chiA === 0 && kq.tomTat.chiB === 0 && !kq.khacTrangThaiLuot) ? <div className="text-success">{t("flowStudio.soSanh.giongHet")}</div> : null}
          </div>
          <ol className="space-y-2">
            {kq.cacBuoc.map((s) => (
              <li key={s.khoa} className="rounded border p-2 space-y-1" data-testid={`so-sanh-buoc-${s.nodeId}`} data-ket={s.ket}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={`text-[10px] ${MAU_KET[s.ket]}`}>{t(`flowStudio.soSanh.ket.${s.ket}`)}</Badge>
                  <span className="text-xs font-medium truncate">{tenNut(s.nodeId)}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">#{s.lan}</span>
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                    {s.trangThaiA && <Badge variant="outline" className={`text-[10px] ${MAU_TRANG_THAI[s.trangThaiA] ?? ""}`}>{s.trangThaiA}</Badge>}
                    →
                    {s.trangThaiB && <Badge variant="outline" className={`text-[10px] ${MAU_TRANG_THAI[s.trangThaiB] ?? ""}`}>{s.trangThaiB}</Badge>}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {t("flowStudio.soSanh.thoiGian", { a: fmtMs(s.msA), b: fmtMs(s.msB) })}
                  {s.chenhMs !== null && s.chenhMs !== 0 ? ` · ${t("flowStudio.soSanh.chenh", { ms: s.chenhMs > 0 ? `+${s.chenhMs}` : s.chenhMs })}` : ""}
                </div>
                <Khac nhan={t("flowStudio.soSanh.vao")} k={s.khacVao} />
                <Khac nhan={t("flowStudio.soSanh.ra")} k={s.khacRa} />
                <Khac nhan={t("flowStudio.soSanh.loi")} k={s.khacLoi} />
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
