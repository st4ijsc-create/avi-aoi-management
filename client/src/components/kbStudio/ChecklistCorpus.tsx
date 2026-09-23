/**
 * R5 — checklist 4 bước có trạng thái cho corpus đang nhập ở tab Nguồn. Hiện CẢ KHI hướng dẫn đã gấp:
 * người quay lại lần thứ mười không cần đọc lại bốn đoạn chữ — họ cần biết corpus này đang ở bước nào.
 * `ChecklistCorpusView` thuần props (lưới SSR); `ChecklistCorpus` đổ dữ liệu tRPC thật.
 */
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, AlertTriangle, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { dungChecklist, type BuocChecklist } from "./checklistCorpusLogic";

const ICON = {
  xong: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />,
  chua: <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />,
  "canh-bao": <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />,
  "dang-tai": <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />,
} as const;

export function ChecklistCorpusView({ buoc }: { buoc: readonly BuocChecklist[] }) {
  const { t } = useTranslation();
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="checklist-corpus">
      {buoc.map((b, i) => (
        <li key={b.id} className="flex items-start gap-2 rounded-md border p-2" data-buoc={b.id} data-trang-thai={b.trangThai}>
          <span className="mt-0.5">{ICON[b.trangThai]}</span>
          <span className="min-w-0">
            <span className="block text-xs font-medium">
              {i + 1}. {t(`kbStudio.checklist.${b.id}.ten`)}
            </span>
            <span className="block text-xs text-muted-foreground">{t(`kbStudio.checklist.${b.id}.${b.khoa}`, b.thamSo)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ChecklistCorpus({ tenCorpus }: { tenCorpus: string }) {
  const ten = tenCorpus.trim();
  const corporaQ = trpc.kbStudio.listCorpora.useQuery();
  const coTen = ten.length > 0;
  const jobsQ = trpc.kbStudio.listJobs.useQuery({ corpus: ten, limit: 200 }, { enabled: coTen });
  const boVangQ = trpc.kbStudio.listGoldenSets.useQuery(undefined, { enabled: coTen });
  const luotQ = trpc.kbStudio.listEvalRuns.useQuery({ corpus: ten, limit: 50 }, { enabled: coTen });
  const buoc = dungChecklist({
    tenCorpus: ten,
    corpora: corporaQ.data?.corpora,
    jobs: coTen ? jobsQ.data?.jobs : undefined,
    boVang: coTen ? boVangQ.data?.sets : undefined,
    luot: coTen ? luotQ.data?.runs : undefined,
  });
  return <ChecklistCorpusView buoc={buoc} />;
}
