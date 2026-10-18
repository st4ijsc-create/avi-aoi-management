import { AttributeIds, MessageSecurityMode, OPCUAClient, SecurityPolicy, StatusCodes } from "node-opcua";

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
        const dv = dvs[i];
        kq[id] = dv.statusCode.equals(StatusCodes.Good) ? Number(dv.value.value) : null;
      });
      return kq;
    } finally {
      await session.close();
    }
  } finally {
    await client.disconnect();
  }
}
