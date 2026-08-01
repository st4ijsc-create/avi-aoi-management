/**
 * doc 47 IA Đợt 2 — mô hình dữ liệu dùng chung cho "Tổng quan" cấu hình nhà máy.
 *
 * Nạp 5 tầng phân cấp qua các query `list` HIỆN CÓ của hub (react-query dedupe
 * theo queryKey — KHÔNG phát sinh request thừa vì DataSettings đã mount sẵn) rồi
 * ghép cây Nhà máy → Xưởng → Dây chuyền → Trạm → Máy hoàn toàn phía client theo
 * id cha. Đồng thời tính các "lỗ hổng cấu hình" THẬT (container rỗng · trùng mã ·
 * máy chưa kết nối) — không bịa dữ liệu, không bịa vấn đề.
 *
 * HONEST-DEGRADATION: apiKey KHÔNG có trong payload machine.list (server tước bỏ,
 * doc 42 theme 10) nên rule "máy chưa kết nối" dùng tín hiệu THẬT lấy được từ list:
 * `registrationStatus !== 'approved'` (chưa duyệt/cấp key) và thiếu `model`.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

/** Mức nghiêm trọng: 0 = ok (xanh), 1 = cảnh báo (hổ phách), 2 = lỗi (đỏ). */
export type Sev = 0 | 1 | 2;

export type FactoryConfigLevel = "factory" | "workshop" | "line" | "station" | "machine";

/** Đích điều hướng "Sửa →": mở tab CRUD tương ứng trong hub + lọc theo cha. */
export interface NavTarget {
  level: FactoryConfigLevel;
  id: number;
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  stationId?: number;
}

export type Navigate = (target: NavTarget) => void;

/** Một mấu (breadcrumb) trên đường dẫn Nhà máy ▸ Xưởng ▸ … */
export interface PathCrumb {
  level: FactoryConfigLevel;
  code: string;
  name: string;
}

/** Nút cây phân cấp (đã cuộn health từ con lên). */
export interface TreeNode {
  key: string;
  level: FactoryConfigLevel;
  id: number;
  code: string;
  name: string;
  /** Health đã cuộn = max(ownSev, sev của mọi con). */
  sev: Sev;
  ownSev: Sev;
  /** Số con trực tiếp (dùng cho badge "n trạm"…). Máy = 0. */
  childCount: number;
  children: TreeNode[];
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  stationId?: number;
  nav: NavTarget;
}

/** Một lỗ hổng cấu hình phát hiện được. */
export interface Finding {
  id: string;
  sev: "error" | "warning";
  /** Khoá i18n: dataSettings.overview.health.<kind> */
  kind:
    | "emptyFactory"
    | "emptyWorkshop"
    | "emptyLine"
    | "emptyStation"
    | "dupCode"
    | "machineUnapproved"
    | "machineNoModel";
  vars?: Record<string, string | number>;
  path: PathCrumb[];
  nav: NavTarget;
}

export interface FactoryModel {
  roots: TreeNode[];
  findings: Finding[];
  counts: { factories: number; workshops: number; lines: number; stations: number; machines: number };
  summary: { total: number; errors: number; warnings: number };
}

// ── loose row shapes (chỉ khai báo trường dùng đến) ──────────────────────────
interface FactoryRow { id: number; code: string; name: string }
interface WorkshopRow { id: number; factoryId: number; code: string; name: string }
interface LineRow { id: number; workshopId: number; code: string; name: string }
interface StationRow { id: number; lineId: number; code: string; name: string }
interface MachineRow {
  id: number;
  stationId: number;
  code: string;
  name: string;
  model?: string | null;
  registrationStatus?: string | null;
}

const norm = (c: string | null | undefined): string => (c ?? "").trim().toLowerCase();

function groupBy<T>(rows: T[], keyOf: (r: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return map;
}

/** Tập các mã (chuẩn hoá) xuất hiện >1 lần trong cùng một loại thực thể. */
function dupCodes(rows: { code: string }[]): Set<string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = norm(r.code);
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const set = new Set<string>();
  for (const [c, n] of counts) if (n > 1) set.add(c);
  return set;
}

const worse = (a: Sev, b: Sev): Sev => (a >= b ? a : b);

/**
 * Ghép cây + phát hiện lỗ hổng từ 5 mảng phẳng. Thuần tuý, không phụ thuộc React.
 */
export function buildFactoryModel(
  factories: FactoryRow[],
  workshops: WorkshopRow[],
  lines: LineRow[],
  stations: StationRow[],
  machines: MachineRow[],
): FactoryModel {
  const wsByFactory = groupBy(workshops, (w) => w.factoryId);
  const lnByWorkshop = groupBy(lines, (l) => l.workshopId);
  const stByLine = groupBy(stations, (s) => s.lineId);
  const mcByStation = groupBy(machines, (m) => m.stationId);

  const dupF = dupCodes(factories);
  const dupW = dupCodes(workshops);
  const dupL = dupCodes(lines);
  const dupS = dupCodes(stations);
  const dupM = dupCodes(machines);

  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  const roots: TreeNode[] = factories.map((f) => {
    const fCrumb: PathCrumb = { level: "factory", code: f.code, name: f.name };
    const fNav: NavTarget = { level: "factory", id: f.id };
    const isDupF = dupF.has(norm(f.code));
    if (isDupF) push({ id: `dup-f-${f.id}`, sev: "error", kind: "dupCode", vars: { code: f.code }, path: [fCrumb], nav: fNav });

    const fWorkshops = wsByFactory.get(f.id) ?? [];
    if (fWorkshops.length === 0) {
      push({ id: `empty-f-${f.id}`, sev: "warning", kind: "emptyFactory", path: [fCrumb], nav: fNav });
    }

    const wsNodes: TreeNode[] = fWorkshops.map((w) => {
      const wCrumb: PathCrumb = { level: "workshop", code: w.code, name: w.name };
      const wNav: NavTarget = { level: "workshop", id: w.id, factoryId: f.id };
      const isDupW = dupW.has(norm(w.code));
      if (isDupW) push({ id: `dup-w-${w.id}`, sev: "error", kind: "dupCode", vars: { code: w.code }, path: [fCrumb, wCrumb], nav: wNav });

      const wLines = lnByWorkshop.get(w.id) ?? [];
      if (wLines.length === 0) {
        push({ id: `empty-w-${w.id}`, sev: "warning", kind: "emptyWorkshop", path: [fCrumb, wCrumb], nav: wNav });
      }

      const lnNodes: TreeNode[] = wLines.map((l) => {
        const lCrumb: PathCrumb = { level: "line", code: l.code, name: l.name };
        const lNav: NavTarget = { level: "line", id: l.id, factoryId: f.id, workshopId: w.id };
        const isDupL = dupL.has(norm(l.code));
        if (isDupL) push({ id: `dup-l-${l.id}`, sev: "error", kind: "dupCode", vars: { code: l.code }, path: [fCrumb, wCrumb, lCrumb], nav: lNav });

        const lStations = stByLine.get(l.id) ?? [];
        if (lStations.length === 0) {
          push({ id: `empty-l-${l.id}`, sev: "warning", kind: "emptyLine", path: [fCrumb, wCrumb, lCrumb], nav: lNav });
        }

        const stNodes: TreeNode[] = lStations.map((s) => {
          const sCrumb: PathCrumb = { level: "station", code: s.code, name: s.name };
          const sNav: NavTarget = { level: "station", id: s.id, factoryId: f.id, workshopId: w.id, lineId: l.id };
          const isDupS = dupS.has(norm(s.code));
          if (isDupS) push({ id: `dup-s-${s.id}`, sev: "error", kind: "dupCode", vars: { code: s.code }, path: [fCrumb, wCrumb, lCrumb, sCrumb], nav: sNav });

          const sMachines = mcByStation.get(s.id) ?? [];
          if (sMachines.length === 0) {
            push({ id: `empty-s-${s.id}`, sev: "warning", kind: "emptyStation", path: [fCrumb, wCrumb, lCrumb, sCrumb], nav: sNav });
          }

          const mcNodes: TreeNode[] = sMachines.map((m) => {
            const mCrumb: PathCrumb = { level: "machine", code: m.code, name: m.name };
            const mNav: NavTarget = { level: "machine", id: m.id, factoryId: f.id, workshopId: w.id, lineId: l.id, stationId: s.id };
            const mPath = [fCrumb, wCrumb, lCrumb, sCrumb, mCrumb];
            const isDupM = dupM.has(norm(m.code));
            const status = (m.registrationStatus ?? "").trim();
            const notApproved = status !== "approved";
            const noModel = !(m.model && String(m.model).trim());

            let ownSev: Sev = 0;
            if (isDupM) {
              ownSev = 2;
              push({ id: `dup-m-${m.id}`, sev: "error", kind: "dupCode", vars: { code: m.code }, path: mPath, nav: mNav });
            }
            // Ưu tiên hiện 1 cảnh báo/máy: chưa duyệt (bao trùm) → nếu không thì thiếu model.
            if (notApproved) {
              if (ownSev < 1) ownSev = 1;
              push({ id: `mach-noapprove-${m.id}`, sev: "warning", kind: "machineUnapproved", vars: { status: status || "pending" }, path: mPath, nav: mNav });
            } else if (noModel) {
              if (ownSev < 1) ownSev = 1;
              push({ id: `mach-nomodel-${m.id}`, sev: "warning", kind: "machineNoModel", path: mPath, nav: mNav });
            }

            return {
              key: `machine:${m.id}`,
              level: "machine" as const,
              id: m.id,
              code: m.code,
              name: m.name,
              sev: ownSev,
              ownSev,
              childCount: 0,
              children: [],
              factoryId: f.id,
              workshopId: w.id,
              lineId: l.id,
              stationId: s.id,
              nav: mNav,
            };
          });

          let sSev: Sev = isDupS ? 2 : sMachines.length === 0 ? 1 : 0;
          for (const c of mcNodes) sSev = worse(sSev, c.sev);
          return {
            key: `station:${s.id}`,
            level: "station" as const,
            id: s.id,
            code: s.code,
            name: s.name,
            sev: sSev,
            ownSev: isDupS ? 2 : sMachines.length === 0 ? 1 : 0,
            childCount: mcNodes.length,
            children: mcNodes,
            factoryId: f.id,
            workshopId: w.id,
            lineId: l.id,
            nav: sNav,
          };
        });

        let lSev: Sev = isDupL ? 2 : lStations.length === 0 ? 1 : 0;
        for (const c of stNodes) lSev = worse(lSev, c.sev);
        return {
          key: `line:${l.id}`,
          level: "line" as const,
          id: l.id,
          code: l.code,
          name: l.name,
          sev: lSev,
          ownSev: isDupL ? 2 : lStations.length === 0 ? 1 : 0,
          childCount: stNodes.length,
          children: stNodes,
          factoryId: f.id,
          workshopId: w.id,
          nav: lNav,
        };
      });

      let wSev: Sev = isDupW ? 2 : wLines.length === 0 ? 1 : 0;
      for (const c of lnNodes) wSev = worse(wSev, c.sev);
      return {
        key: `workshop:${w.id}`,
        level: "workshop" as const,
        id: w.id,
        code: w.code,
        name: w.name,
        sev: wSev,
        ownSev: isDupW ? 2 : wLines.length === 0 ? 1 : 0,
        childCount: lnNodes.length,
        children: lnNodes,
        factoryId: f.id,
        nav: wNav,
      };
    });

    let fSev: Sev = isDupF ? 2 : fWorkshops.length === 0 ? 1 : 0;
    for (const c of wsNodes) fSev = worse(fSev, c.sev);
    return {
      key: `factory:${f.id}`,
      level: "factory" as const,
      id: f.id,
      code: f.code,
      name: f.name,
      sev: fSev,
      ownSev: isDupF ? 2 : fWorkshops.length === 0 ? 1 : 0,
      childCount: wsNodes.length,
      children: wsNodes,
      nav: fNav,
    };
  });

  // errors trước, warnings sau — giữ nguyên thứ tự duyệt cây (top-down) trong mỗi nhóm.
  const order = { error: 0, warning: 1 } as const;
  findings.sort((a, b) => order[a.sev] - order[b.sev]);

  const errors = findings.filter((f) => f.sev === "error").length;
  return {
    roots,
    findings,
    counts: {
      factories: factories.length,
      workshops: workshops.length,
      lines: lines.length,
      stations: stations.length,
      machines: machines.length,
    },
    summary: { total: findings.length, errors, warnings: findings.length - errors },
  };
}

export interface UseFactoryModelResult {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** Nhà máy rỗng hẳn (chưa cấu hình gì) — dùng cho empty-state trung thực. */
  isEmpty: boolean;
  model: FactoryModel;
}

/**
 * Hook nạp 5 list + ghép model. Dùng chung cho FactoryTree & ConfigHealthPanel.
 * Các query trùng key với hub nên react-query trả cache (không gọi mạng lại).
 */
export function useFactoryModel(): UseFactoryModelResult {
  const factoriesQ = trpc.factory.list.useQuery();
  const workshopsQ = trpc.workshop.list.useQuery();
  const linesQ = trpc.line.list.useQuery();
  const stationsQ = trpc.station.list.useQuery();
  const machinesQ = trpc.machine.list.useQuery();

  const isLoading =
    factoriesQ.isLoading ||
    workshopsQ.isLoading ||
    linesQ.isLoading ||
    stationsQ.isLoading ||
    machinesQ.isLoading;
  const isError =
    factoriesQ.isError ||
    workshopsQ.isError ||
    linesQ.isError ||
    stationsQ.isError ||
    machinesQ.isError;
  const error =
    factoriesQ.error ?? workshopsQ.error ?? linesQ.error ?? stationsQ.error ?? machinesQ.error;

  const refetch = () => {
    factoriesQ.refetch();
    workshopsQ.refetch();
    linesQ.refetch();
    stationsQ.refetch();
    machinesQ.refetch();
  };

  const model = useMemo(
    () =>
      buildFactoryModel(
        (factoriesQ.data ?? []) as FactoryRow[],
        (workshopsQ.data ?? []) as WorkshopRow[],
        (linesQ.data ?? []) as LineRow[],
        (stationsQ.data ?? []) as StationRow[],
        (machinesQ.data ?? []) as MachineRow[],
      ),
    [factoriesQ.data, workshopsQ.data, linesQ.data, stationsQ.data, machinesQ.data],
  );

  const isEmpty = !isLoading && !isError && model.counts.factories === 0;

  return { isLoading, isError, error, refetch, isEmpty, model };
}

/** Đơn vị con dùng cho badge đếm ở mỗi cấp (khoá i18n dataSettings.overview.count.*). */
export const CHILD_UNIT: Record<FactoryConfigLevel, string | null> = {
  factory: "workshop",
  workshop: "line",
  line: "station",
  station: "machine",
  machine: null,
};
