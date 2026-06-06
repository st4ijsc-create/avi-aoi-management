/**
 * Sprint F3a — Sparkplug-B CORE: state THUẦN (test offline, không broker/DB).
 *
 * Quản lý seq (0..255 wrap), bdSeq (0..255 wrap), alias registry (name → số tăng dần
 * ổn định), và trạng thái birth/death của node + devices.
 */

/** Bộ đếm seq Sparkplug: trả 0..255 rồi wrap về 0. */
export class SparkplugSeqCounter {
  private value = 0;

  /** Trả seq hiện tại rồi tăng (wrap 256→0). */
  next(): number {
    const cur = this.value;
    this.value = (this.value + 1) & 0xff;
    return cur;
  }

  /** Đặt lại về 0 (dùng khi NBIRTH). */
  reset(): void {
    this.value = 0;
  }

  /** seq sẽ trả ở lần next() kế tiếp (không tăng). */
  peek(): number {
    return this.value;
  }
}

/**
 * Trạng thái Sparkplug cho MỘT edge node: bdSeq, alias registry, birth state.
 */
export class SparkplugNodeState {
  readonly seq = new SparkplugSeqCounter();

  private _bdSeq = 0;
  private aliasMap = new Map<string, number>();
  private aliasNext = 0;
  private nodeBirthed = false;
  private devicesBirthed = new Set<string>();

  /** bdSeq hiện tại (đặt ở NBIRTH/NDEATH gần nhất). */
  get bdSeq(): number {
    return this._bdSeq;
  }

  /** Tăng bdSeq (wrap 256→0) và trả giá trị mới — gọi khi tạo NBIRTH. */
  nextBdSeq(): number {
    this._bdSeq = (this._bdSeq + 1) & 0xff;
    return this._bdSeq;
  }

  /** Cấp alias ổn định cho một metric name (tăng dần, lặp lại trả cùng số). */
  getAlias(name: string): number {
    const existing = this.aliasMap.get(name);
    if (existing !== undefined) return existing;
    const alias = this.aliasNext++;
    this.aliasMap.set(name, alias);
    return alias;
  }

  /** Xoá toàn bộ alias (gọi khi NBIRTH — alias phải khai báo lại). */
  resetAliases(): void {
    this.aliasMap.clear();
    this.aliasNext = 0;
  }

  markNodeBirthed(): void {
    this.nodeBirthed = true;
  }

  markNodeDead(): void {
    this.nodeBirthed = false;
    this.devicesBirthed.clear();
  }

  isNodeBirthed(): boolean {
    return this.nodeBirthed;
  }

  markDeviceBirthed(deviceId: string): void {
    this.devicesBirthed.add(deviceId);
  }

  isDeviceBirthed(deviceId: string): boolean {
    return this.devicesBirthed.has(deviceId);
  }

  markDeviceDead(deviceId: string): void {
    this.devicesBirthed.delete(deviceId);
  }

  /** Reset toàn bộ state (seq, alias, birth). bdSeq GIỮ NGUYÊN (đời broker). */
  reset(): void {
    this.seq.reset();
    this.resetAliases();
    this.nodeBirthed = false;
    this.devicesBirthed.clear();
  }
}
