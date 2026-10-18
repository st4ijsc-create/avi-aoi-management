import {
  AttributeIds, ClientMonitoredItem, ClientSubscription, DataValue, MessageSecurityMode, OPCUAClient, SecurityPolicy, TimestampsToReturn,
} from "node-opcua";

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
      const sub = ClientSubscription.create(session, {
        requestedPublishingInterval: chuKyMs,
        requestedLifetimeCount: 100,
        requestedMaxKeepAliveCount: 10,
        maxNotificationsPerPublish: 100,
        publishingEnabled: true,
        priority: 10,
      });
      try {
        const kq: number[] = [];
        await new Promise<void>((ok, loi) => {
          const item = ClientMonitoredItem.create(
            sub,
            { nodeId, attributeId: AttributeIds.Value },
            { samplingInterval: chuKyMs, queueSize: 10, discardOldest: true },
            TimestampsToReturn.Both,
          );
          item.on("changed", (dv: DataValue) => {
            if (kq.length < soMau) kq.push(Number(dv.value.value));
            if (kq.length === soMau) ok();
          });
          item.on("err", (e: unknown) => loi(new Error(String(e))));
        });
        return kq;
      } finally {
        await sub.terminate();
      }
    } finally {
      await session.close();
    }
  } finally {
    await client.disconnect();
  }
}
