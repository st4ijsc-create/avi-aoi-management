/**
 * Sprint F3a — Sparkplug-B CORE: orchestrator dựng các payload birth/data/death.
 *
 * KHÔNG mở socket / không I/O — mỗi hàm trả {topic, buffer} để caller publish.
 * Tái dùng SparkplugNodeState (seq/bdSeq/alias). THUẦN, test offline được.
 *
 * F4 HITL: chiều RECEIVE NCMD/DCMD do `sparkplugCommand.ts` đảm nhiệm (flag
 * SPARKPLUG_COMMAND_ENABLED, mặc định OFF) — KHÔNG bao giờ execute hardware ở đây;
 * mọi DCMD đi qua commandDispatcher (HITL + dry-run). Module này vẫn THUẦN, chỉ tạo
 * chiều PUBLISH (NBIRTH/NDEATH/DBIRTH/DDATA/DDEATH). `buildRebirth()` chỉ dựng lại
 * các BIRTH certificate (re-publish telemetry) cho lệnh "Node Control/Rebirth" —
 * caller (unsPublisher) lo I/O publish.
 */
import { buildTopic } from "./topicBuilder";
import { encodePayload, type SparkplugMetric, type SparkplugPayload } from "./sparkplugEncoder";
import { SparkplugNodeState } from "./sparkplugState";

/** Định nghĩa một metric khi birth (có giá trị khởi tạo). */
export interface MetricDef {
  name: string;
  type: string;
  value: unknown;
  timestamp?: number;
}

/** Một giá trị metric cập nhật trong DDATA. */
export interface MetricSample {
  name: string;
  type: string;
  value: unknown;
  timestamp?: number;
}

export interface BuiltMessage {
  topic: string;
  buffer: Buffer;
}

/**
 * Orchestrator Sparkplug cho một edge node. Giữ state seq/bdSeq/alias.
 */
export class SparkplugNode {
  readonly state = new SparkplugNodeState();

  /**
   * NBIRTH: bdSeq (nextBdSeq), seq=0, kèm metric definitions (name+alias+type+value).
   * Reset seqCounter + alias trước khi cấp alias mới cho các def.
   */
  buildNbirth(groupId: string, edgeNodeId: string, metricDefs: MetricDef[]): BuiltMessage {
    this.state.seq.reset();
    this.state.resetAliases();
    const bdSeq = this.state.nextBdSeq();

    const ts = Date.now();
    const metrics: SparkplugMetric[] = [
      { name: "bdSeq", type: "Int64", value: bdSeq, timestamp: ts },
    ];
    for (const def of metricDefs) {
      metrics.push({
        name: def.name,
        alias: this.state.getAlias(def.name),
        type: def.type,
        value: def.value,
        timestamp: def.timestamp ?? ts,
      });
    }

    const payload: SparkplugPayload = {
      timestamp: ts,
      seq: this.state.seq.next(), // 0
      metrics,
    };
    this.state.markNodeBirthed();
    return {
      topic: buildTopic(groupId, "NBIRTH", edgeNodeId),
      buffer: encodePayload(payload),
    };
  }

  /**
   * NDEATH: chỉ metric "bdSeq" = bdSeq HIỆN TẠI (đặt làm MQTT will — encode TRƯỚC connect).
   * Không tăng seq (death không nằm trong chuỗi seq DATA).
   */
  buildNdeath(groupId: string, edgeNodeId: string): BuiltMessage {
    const payload: SparkplugPayload = {
      timestamp: Date.now(),
      metrics: [{ name: "bdSeq", type: "Int64", value: this.state.bdSeq }],
    };
    return {
      topic: buildTopic(groupId, "NDEATH", edgeNodeId),
      buffer: encodePayload(payload),
    };
  }

  /** DBIRTH cho một device: seq tăng, metric defs kèm alias. */
  buildDbirth(
    groupId: string,
    edgeNodeId: string,
    deviceId: string,
    metricDefs: MetricDef[],
  ): BuiltMessage {
    const ts = Date.now();
    const metrics: SparkplugMetric[] = metricDefs.map((def) => ({
      name: def.name,
      alias: this.state.getAlias(def.name),
      type: def.type,
      value: def.value,
      timestamp: def.timestamp ?? ts,
    }));
    const payload: SparkplugPayload = {
      timestamp: ts,
      seq: this.state.seq.next(),
      metrics,
    };
    this.state.markDeviceBirthed(deviceId);
    return {
      topic: buildTopic(groupId, "DBIRTH", edgeNodeId, deviceId),
      buffer: encodePayload(payload),
    };
  }

  /** DDATA: seq tăng; metric dùng alias (đã cấp ở birth, hoặc cấp mới ổn định). */
  buildDdata(
    groupId: string,
    edgeNodeId: string,
    deviceId: string,
    metrics: MetricSample[],
  ): BuiltMessage {
    const ts = Date.now();
    const m: SparkplugMetric[] = metrics.map((s) => ({
      alias: this.state.getAlias(s.name),
      type: s.type,
      value: s.value,
      timestamp: s.timestamp ?? ts,
    }));
    const payload: SparkplugPayload = {
      timestamp: ts,
      seq: this.state.seq.next(),
      metrics: m,
    };
    return {
      topic: buildTopic(groupId, "DDATA", edgeNodeId, deviceId),
      buffer: encodePayload(payload),
    };
  }

  /**
   * F4 HITL — REBIRTH: dựng lại NBIRTH cho node + DBIRTH cho từng device đang birthed,
   * phục vụ lệnh Sparkplug "Node Control/Rebirth" (chỉ re-publish telemetry/certificate,
   * KHÔNG phải lệnh điều khiển máy). THUẦN: trả danh sách {topic,buffer} để caller publish.
   *
   * `deviceMetricDefs` cho phép caller cung cấp lại metric-defs cho mỗi device đã từng
   * birth (tái dùng metric set đã track ở publisher). Device không có defs → DBIRTH rỗng
   * (vẫn hợp lệ: device tự re-DDATA sẽ lazy-DBIRTH lại theo F3b).
   */
  buildRebirth(
    groupId: string,
    edgeNodeId: string,
    nodeMetricDefs: MetricDef[] = [],
    deviceMetricDefs: Array<{ deviceId: string; metricDefs: MetricDef[] }> = [],
  ): BuiltMessage[] {
    // Snapshot devices đang birthed TRƯỚC khi NBIRTH reset birth-state.
    const birthedDevices = deviceMetricDefs.filter((d) => this.state.isDeviceBirthed(d.deviceId));
    const out: BuiltMessage[] = [this.buildNbirth(groupId, edgeNodeId, nodeMetricDefs)];
    for (const d of birthedDevices) {
      out.push(this.buildDbirth(groupId, edgeNodeId, d.deviceId, d.metricDefs));
    }
    return out;
  }

  /** DDEATH cho một device: seq tăng, không metric. */
  buildDdeath(groupId: string, edgeNodeId: string, deviceId: string): BuiltMessage {
    const payload: SparkplugPayload = {
      timestamp: Date.now(),
      seq: this.state.seq.next(),
      metrics: [],
    };
    this.state.markDeviceDead(deviceId);
    return {
      topic: buildTopic(groupId, "DDEATH", edgeNodeId, deviceId),
      buffer: encodePayload(payload),
    };
  }
}
