/**
 * doc 48 R4 (tech-debt) — shared primitives extracted VERBATIM from ApiDocs.tsx so the
 * page and its extracted API-docs section components share one CodeBlock/glassCard/
 * copyToClipboard. PURE RELOCATION — identical implementation, no behavior change.
 */
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { toast } from "sonner";

export const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text).then(() => {
    toast.success("Đã copy vào clipboard");
  });
};

export const CodeBlock = ({ code, language = "json" }: { code: string; language?: string }) => (
  <div className="relative">
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-2 top-2 h-8 w-8"
      onClick={() => copyToClipboard(code)}
    >
      <Copy className="h-4 w-4" />
    </Button>
    <pre className="overflow-auto rounded-2xl bg-zinc-900/95 p-4 text-xs text-zinc-100 shadow-inner">
      <code data-language={language}>{code}</code>
    </pre>
  </div>
);

export const glassCard = "border border-white/10 bg-white/5 backdrop-blur-xl";
