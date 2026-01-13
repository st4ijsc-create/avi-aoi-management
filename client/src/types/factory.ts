export interface FactoryStats {
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  yieldRate: number;
}

export interface WorkshopData {
  id: number;
  code: string;
  name: string;
  stats?: FactoryStats;
}

export interface FactoryData {
  id: number;
  code: string;
  name: string;
  region?: string | null;
  country?: string | null;
  address?: string | null;
  stats: FactoryStats;
  workshops: WorkshopData[];
}
