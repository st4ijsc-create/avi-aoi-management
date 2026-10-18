import { DataType, MessageSecurityMode, OPCUAClient, SecurityPolicy, StatusCodes, Variant } from "node-opcua";

export async function goiLenh(endpoint: string, objectId: string, methodId: string, toc: number, chieuThuan: boolean): Promise<{ ok: boolean; ketQua?: string; ma: string }> {
  const client = OPCUAClient.create({
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { maxRetry: 1, initialDelay: 200, maxDelay: 500 },
  });
  await client.connect(endpoint);
  try {
    const session = await client.createSession();
    try {
      const r = await session.call({
        objectId,
        methodId,
        inputArguments: [
          new Variant({ dataType: DataType.Double, value: toc }),
          new Variant({ dataType: DataType.Boolean, value: chieuThuan }),
        ],
      });
      const ok = r.statusCode.equals(StatusCodes.Good);
      return ok ? { ok, ma: r.statusCode.name, ketQua: String(r.outputArguments?.[0]?.value) } : { ok, ma: r.statusCode.name };
    } finally {
      await session.close();
    }
  } finally {
    await client.disconnect();
  }
}
