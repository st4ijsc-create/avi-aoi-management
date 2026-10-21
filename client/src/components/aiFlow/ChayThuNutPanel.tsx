/**
 * ★★ AI Local Đợt 9.1 — "CHẠY THỬ MỘT NODE" trong bảng cấu hình node của Flow Studio.
 *
 * Gửi node đang sửa trên canvas (kể cả CHƯA lưu) + item mẫu theo từng cổng vào tới `flow.chayThuNut`; kết quả hiện ngay tại node.
 * Máy chủ không tạo lượt chạy; node có tác dụng ra ngoài (HTTP, mã, agent…) chỉ trả "xem trước" tham số đã tính biểu thức.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { NodeInstance } from "@shared/flow/model";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, FlaskConical } from "lucide-react";
import { docItemsNhap, type KhaiBaoNutClient } from "@/lib/flowStudio";

const MAU = '[\n  { "json": {} }\n]';

function Khoi({ v, testId }: { v: unknown; testId?: string }) {
  return (
    <pre data-testid={testId} className="max-h-56 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap break-all">
      {JSON.stringify(v, null, 2)}
    </pre>
  );
}

export default function ChayThuNutPanel({ node, kb }: { node: NodeInstance; kb: KhaiBaoNutClient | undefined }) {
  const { t } = useTranslation();
  const cong = kb && kb.congVao.length ? [...kb.congVao] : ["main"];
  const [chu, setChu] = useState<Record<string, string>>(() => Object.fromEntries(cong.map((c) => [c, MAU])));
  const [truoc, setTruoc] = useState("");
  const [loiJson, setLoiJson] = useState(false);
  const chay = trpc.flow.chayThuNut.useMutation({ onError: (e) => toastTrpcError(e) });

  const bam = () => {
    const inputs: Record<string, { json: Record<string, unknown> }[]> = {};
    for (const c of cong) {
      const r = docItemsNhap(chu[c] ?? "");
      if (!r.ok) return setLoiJson(true);
      inputs[c] = r.items;
    }
    let dauRaNutTruoc: Record<string, { json: Record<string, unknown> }[]> | undefined;
    if (truoc.trim()) {
      try {
        const o = JSON.parse(truoc) as Record<string, unknown>;
        dauRaNutTruoc = {};
        for (const [id, v] of Object.entries(o)) {
          const r = docItemsNhap(JSON.stringify(v));
          if (!r.ok) return setLoiJson(true);
          dauRaNutTruoc[id] = r.items;
        }
      } catch {
        return setLoiJson(true);
      }
    }
    setLoiJson(false);
    chay.mutate({ nut: node, inputs, dauRaNutTruoc });
  };

  const r = chay.data;
  return (
    <div className="border-t pt-3 space-y-2" data-testid="chay-thu-nut">
      <div>
        <h4 className="text-xs font-semibold flex items-center gap-1"><FlaskConical className="h-3.5 w-3.5" />{t("flowStudio.chayThu.tieuDe")}</h4>
        <p className="text-[11px] text-muted-foreground">{t("flowStudio.chayThu.moTa")}</p>
      </div>
      {cong.map((c) => (
        <div key={c} className="space-y-1">
          <Label className="text-[11px]">{t("flowStudio.chayThu.itemsCong", { cong: c })}</Label>
          <Textarea data-testid={`chay-thu-items-${c}`} className="font-mono text-xs min-h-[72px]" value={chu[c] ?? ""} onChange={(e) => setChu({ ...chu, [c]: e.target.value })} />
        </div>
      ))}
      <details>
        <summary className="text-[11px] text-muted-foreground cursor-pointer">{t("flowStudio.chayThu.dauRaTruoc")}</summary>
        <Textarea data-testid="chay-thu-truoc" className="mt-1 font-mono text-xs min-h-[56px]" value={truoc} onChange={(e) => setTruoc(e.target.value)} placeholder='{ "node-1": [ { "json": { } } ] }' />
      </details>
      {loiJson && <p className="text-xs text-destructive" role="alert">{t("flowStudio.chayThu.jsonHong")}</p>}
      <Button type="button" size="sm" variant="secondary" data-testid="nut-chay-thu-nut" disabled={chay.isPending} onClick={bam}>
        {chay.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5 mr-1" />}
        {chay.isPending ? t("flowStudio.chayThu.dangChay") : t("flowStudio.chayThu.chay")}
      </Button>

      {r && (
        <div className="rounded border p-2 space-y-2 text-xs" data-testid="ket-qua-chay-thu" data-che={r.che} data-ok={r.ok ? "1" : "0"}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium ${r.ok ? "text-success" : "text-destructive"}`}>{r.ok ? t("flowStudio.chayThu.thanhCong") : t("flowStudio.chayThu.loi")}</span>
            <span className="text-muted-foreground">{r.che === "chay" ? t("flowStudio.chayThu.daChay") : t("flowStudio.chayThu.xemTruoc")}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{t("flowStudio.chayThu.ms", { ms: r.ms })}</span>
          </div>
          {r.credentialRef && <p className="text-[11px] text-muted-foreground">{t("flowStudio.chayThu.biMat", { id: r.credentialRef })}</p>}
          {r.loi && <p className="text-destructive break-all" data-testid="chay-thu-loi">{r.loi}</p>}
          {r.output &&
            Object.entries(r.output).map(([c, ds]) => (
              <div key={c} className="space-y-1">
                <div className="text-[11px] font-medium">{t("flowStudio.chayThu.dauRa", { cong: c, n: Array.isArray(ds) ? ds.length : 0 })}</div>
                <Khoi v={ds} testId={`chay-thu-ra-${c}`} />
              </div>
            ))}
          {r.cho != null && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium">{t("flowStudio.chayThu.cho", { kind: String((r.cho as { kind?: string }).kind ?? "") })}</div>
              <Khoi v={r.cho} testId="chay-thu-cho" />
            </div>
          )}
          {r.thamSoDaDanhGia !== undefined && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium">{t("flowStudio.chayThu.thamSo")}</div>
              <Khoi v={r.thamSoDaDanhGia} testId="chay-thu-tham-so" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
