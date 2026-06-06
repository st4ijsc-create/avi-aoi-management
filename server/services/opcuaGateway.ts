/**
 * G1 (Giai đoạn 1) — Edge Gateway OPC-UA / Modbus ingest (SCAFFOLD).
 *
 * Mục tiêu: ingest dữ liệu từ PLC/SCADA qua OPC-UA (node-opcua) và Modbus
 * (modbus-serial) → đẩy vào UNS / DB như thiết bị non-AOI (machines enum AUTOMATION).
 *
 * Trạng thái: lớp CODE-ONLY, feature-flag `OPCUA_GATEWAY_ENABLED`. Các package
 * node-opcua / modbus-serial CHƯA cài → dùng dynamic import qua biến specifier
 * (tránh TS2307) và NO-OP khi không có lib/ENV. Không kết nối hạ tầng khi flag tắt.
 *
 * Bật thực sự: cài node-opcua, set OPCUA_GATEWAY_ENABLED=true + OPCUA_ENDPOINT_URL.
 */

type OpcuaSample = {
  nodeId: string;
  value: unknown;
  timestamp: Date;
};

type OnSample = (sample: OpcuaSample) => void | Promise<void>;

let started = false;
let pollTimer: NodeJS.Timeout | null = null;
let clientHandle: unknown = null;

function flagEnabled(): boolean {
  return process.env.OPCUA_GATEWAY_ENABLED === "true";
}

/**
 * Khởi động edge gateway. No-op khi flag tắt hoặc thiếu package/ENV.
 * `onSample` được gọi cho mỗi giá trị đọc được (caller route vào UNS/DB).
 */
export async function startOpcuaGateway(onSample?: OnSample): Promise<boolean> {
  if (started) return true;
  if (!flagEnabled()) {
    console.log("[OpcuaGateway] disabled (set OPCUA_GATEWAY_ENABLED=true to enable)");
    return false;
  }

  const endpoint = process.env.OPCUA_ENDPOINT_URL;
  if (!endpoint) {
    console.warn("[OpcuaGateway] OPCUA_ENDPOINT_URL chưa cấu hình — bỏ qua.");
    return false;
  }

  // Dynamic import qua biến specifier để tránh lỗi biên dịch khi chưa cài package.
  const pkg = "node-opcua";
  const opcua = await import(pkg).catch(() => null);
  if (!opcua) {
    console.warn("[OpcuaGateway] package 'node-opcua' chưa cài — chạy no-op.");
    return false;
  }

  try {
    const { OPCUAClient, AttributeIds } = opcua as any;
    const client = OPCUAClient.create({ endpointMustExist: false });
    await client.connect(endpoint);
    const session = await client.createSession();
    clientHandle = { client, session };

    const nodeIds = (process.env.OPCUA_NODE_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const intervalMs = Number(process.env.OPCUA_POLL_INTERVAL_MS ?? 5000);

    const poll = async () => {
      for (const nodeId of nodeIds) {
        try {
          const dv = await session.read({ nodeId, attributeId: AttributeIds.Value });
          const sample: OpcuaSample = {
            nodeId,
            value: dv?.value?.value,
            timestamp: new Date(),
          };
          if (onSample) await onSample(sample);
        } catch (err) {
          console.error(`[OpcuaGateway] read ${nodeId} lỗi:`, (err as any)?.message || err);
        }
      }
    };

    pollTimer = setInterval(poll, intervalMs > 0 ? intervalMs : 5000);
    started = true;
    console.log(`[OpcuaGateway] đã kết nối ${endpoint}, poll ${nodeIds.length} node mỗi ${intervalMs}ms`);
    return true;
  } catch (err) {
    console.error("[OpcuaGateway] khởi động lỗi:", (err as any)?.message || err);
    return false;
  }
}

/** Dừng gateway và giải phóng tài nguyên. An toàn gọi nhiều lần. */
export async function stopOpcuaGateway(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const handle = clientHandle as any;
  if (handle?.session) {
    await handle.session.close().catch(() => {});
  }
  if (handle?.client) {
    await handle.client.disconnect().catch(() => {});
  }
  clientHandle = null;
  started = false;
}

export function isOpcuaGatewayRunning(): boolean {
  return started;
}
