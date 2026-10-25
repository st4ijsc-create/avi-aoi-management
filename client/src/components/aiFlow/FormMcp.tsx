/**
 * Form CÓ KIỂU cho `tich-hop.mcp-goi` (MCP client) — lô MCP client. Luồng chỉ mang TÊN máy chủ + TÊN tool (do quản trị khai ở AI_FLOW_MCP_CHO_PHEP; mặc định RỖNG ⇒ node từ chối mọi lời gọi) và
 * đối số tool dạng cặp tên → biểu thức. Bí mật chọn từ danh sách bí mật của luồng (phải khai host của máy chủ MCP). Máy chủ kiểm tham số y như nhau lúc lưu và lúc chạy.
 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { NodeInstance } from "@shared/flow/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OBieuThuc, OChon, Truong } from "./FormKit";

export const TRAN_DOI_SO_FORM_MCP = 20;
export const RE_TEN_MAY_CHU_FORM = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const RE_TEN_TOOL_FORM = /^[A-Za-z0-9_.-]{1,64}$/;

interface Props {
  node: NodeInstance;
  p: Record<string, unknown>;
  doi: (k: string, v: unknown) => void;
  onDoi: (n: NodeInstance) => void;
  biMat: { id: string; ten: string }[] | undefined;
}

export function FormMcp({ node, p, doi, onDoi, biMat }: Props) {
  const { t } = useTranslation();
  const s = (k: string) => (p[k] === undefined || p[k] === null ? "" : String(p[k]));
  const doiSo: [string, unknown][] = p.thamSo && typeof p.thamSo === "object" && !Array.isArray(p.thamSo) ? Object.entries(p.thamSo as Record<string, unknown>) : [];
  const ghi = (moi: [string, unknown][]) => doi("thamSo", Object.fromEntries(moi));
  const server = s("server");
  const tool = s("tool");
  return (
    <div className="space-y-3" data-testid="form-mcp">
      <Truong nhan={t("flowStudio.form.mcp.server")} goiY={t("flowStudio.form.mcp.serverGoiY")}>
        <Input data-testid="mcp-server" className="h-9 text-xs font-mono" value={server} placeholder="may-do" onChange={(e) => doi("server", e.target.value)} />
        {server && !RE_TEN_MAY_CHU_FORM.test(server) && <p className="text-xs text-destructive" role="alert">{t("flowStudio.form.mcp.serverSai")}</p>}
      </Truong>
      <Truong nhan={t("flowStudio.form.mcp.tool")} goiY={t("flowStudio.form.mcp.toolGoiY")}>
        <Input data-testid="mcp-tool" className="h-9 text-xs font-mono" value={tool} placeholder="ten-tool" onChange={(e) => doi("tool", e.target.value)} />
        {tool && !RE_TEN_TOOL_FORM.test(tool) && <p className="text-xs text-destructive" role="alert">{t("flowStudio.form.mcp.toolSai")}</p>}
      </Truong>
      <div className="space-y-2" data-testid="mcp-doi-so">
        <p className="text-xs font-medium">{t("flowStudio.form.mcp.doiSo", { n: doiSo.length, max: TRAN_DOI_SO_FORM_MCP })}</p>
        {doiSo.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-1" data-testid={`mcp-doi-so-${i}`}>
            <Input data-testid={`mcp-doi-so-ten-${i}`} className="h-8 w-32 text-xs font-mono" value={k} onChange={(e) => ghi(doiSo.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} />
            <OBieuThuc testId={`mcp-doi-so-gia-tri-${i}`} giaTri={v} onDoi={(gt) => ghi(doiSo.map((x, j) => (j === i ? [x[0], gt] : x)))} />
            <button type="button" data-testid={`mcp-doi-so-bo-${i}`} aria-label={t("flowStudio.form.mcp.boDoiSo")} onClick={() => ghi(doiSo.filter((_, j) => j !== i))}>
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" data-testid="mcp-them-doi-so" disabled={doiSo.length >= TRAN_DOI_SO_FORM_MCP} onClick={() => ghi([...doiSo, [`doiSo${doiSo.length + 1}`, ""]])}>
          {t("flowStudio.form.mcp.themDoiSo")}
        </Button>
      </div>
      <Truong nhan={t("flowStudio.cauHinh.biMat")} goiY={t("flowStudio.form.mcp.biMatGoiY")}>
        <OChon
          testId="mcp-bi-mat"
          giaTri={node.credentialRef ?? ""}
          onDoi={(v) => onDoi({ ...node, credentialRef: v || undefined, parameters: v ? { ...p, kieuXacThuc: p.kieuXacThuc || "bearer" } : (({ kieuXacThuc: _b, ...r }) => r)(p) })}
          luaChon={[{ v: "", nhan: t("flowStudio.cauHinh.khongBiMat") }, ...(biMat ?? []).map((b) => ({ v: b.id, nhan: `${b.ten} (${b.id})` }))]}
        />
      </Truong>
      {node.credentialRef && (
        <Truong nhan={t("flowStudio.cauHinh.kieuXacThuc")} goiY={t("flowStudio.cauHinh.kieuXacThucGoiY")}>
          <Input data-testid="mcp-kieu-xac-thuc" className="h-9 text-xs font-mono" value={s("kieuXacThuc")} onChange={(e) => doi("kieuXacThuc", e.target.value)} />
        </Truong>
      )}
      <Truong nhan={t("flowStudio.cauHinh.truongRa")} goiY={t("flowStudio.form.mcp.truongRaGoiY")}>
        <Input data-testid="mcp-truong-ra" className="h-9 text-xs font-mono" value={s("truongRa")} placeholder="mcp" onChange={(e) => doi("truongRa", e.target.value)} />
      </Truong>
      <p className="text-[11px] text-muted-foreground">{t("flowStudio.form.mcp.canhBao")}</p>
    </div>
  );
}
