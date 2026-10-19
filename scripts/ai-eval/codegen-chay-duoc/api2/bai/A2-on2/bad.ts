import { AttributeIds, MessageSecurityMode, OPCUAClient, SecurityPolicy } from "node-opcua";

// SAI (lỗi điển hình): thăm dò bằng session.read theo chu kỳ thay vì subscription/monitored item.
export async function thuMauThayDoi(endpoint: string, nodeId: string, soMau: number, chuKyMs: number): Promise<number[]> {
  const client = OPCUAClient.create({
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { maxRetry: 1, initialDelay: 200, maxDelay: 500 },
  });
  await client.connect(endpoint);
  try {
    const session = await client.createSession();
    try {
      const kq: number[] = [];
      while (kq.length < soMau) {
        const dv = await session.read({ nodeId, attributeId: AttributeIds.Value });
        const v = Number(dv.value.value);
        if (kq.length === 0 || v > kq[kq.length - 1]) kq.push(v);
        await new Promise((r) => setTimeout(r, chuKyMs));
      }
      return kq;
    } finally {
      await session.close();
    }
  } finally {
    await client.disconnect();
  }
}
