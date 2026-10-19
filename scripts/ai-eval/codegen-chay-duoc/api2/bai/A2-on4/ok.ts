import mqtt from "mqtt";

export async function ketNoiThietBi(url: string, maMay: string): Promise<{ guiTrangThai(s: string): Promise<void>; dong(): Promise<void> }> {
  const topic = `nhamay/${maMay}/trangthai`;
  const client = await mqtt.connectAsync(url, {
    clientId: `may-${maMay}`,
    clean: true,
    protocolVersion: 4,
    will: { topic, payload: Buffer.from("MAT_KET_NOI"), qos: 1, retain: true },
  });
  const gui = async (s: string) => { await client.publishAsync(topic, s, { qos: 1, retain: true }); };
  await gui("TRUC_TUYEN");
  return {
    guiTrangThai: gui,
    async dong() {
      await gui("NGOAI_TUYEN");
      await client.endAsync();
    },
  };
}
