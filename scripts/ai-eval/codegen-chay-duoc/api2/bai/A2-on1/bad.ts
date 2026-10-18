import { AttributeIds, MessageSecurityMode, OPCUAClient, SecurityPolicy } from "node-opcua";

// SAI (lỗi điển hình): bỏ qua statusCode — giá trị của nút trạng thái Bad vẫn bị trả như số đo thật.
export async function docNhieuBien(endpoint: string, nodeIds: string[]): Promise<Record<string, number | null>> {
  const client = OPCUAClient.create({
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { maxRetry: 1, initialDelay: 200, maxDelay: 500 },
  });
  await client.connect(endpoint);
  try {
    const session = await client.createSession();
    try {
      const dvs = await session.read(nodeIds.map((nodeId) => ({ nodeId, attributeId: AttributeIds.Value })));
      const kq: Record<string, number | null> = {};
      nodeIds.forEach((id, i) => {
        const v = dvs[i].value?.value;
        kq[id] = typeof v === "number" ? v : null;
      });
      return kq;
    } finally {
      await session.close();
    }
  } finally {
    await client.disconnect();
  }
}
