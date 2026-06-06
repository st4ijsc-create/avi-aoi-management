/**
 * Sprint F3a — Sparkplug-B CORE: orchestrator dựng các payload birth/data/death.
 *
 * KHÔNG mở socket / không I/O — mỗi hàm trả {topic, buffer} để caller publish.
 * Tái dùng SparkplugNodeState (seq/bdSeq/alias). THUẦN, test offline được.
 *
 * F4 HITL: NCMD/DCMD execute NOT implemented — module này chỉ tạo chiều PUBLISH
 * (NBIRTH/NDEATH/DBIRTH/DDATA/DDEATH). Không subscribe/xử lý lệnh điều khiển.
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
