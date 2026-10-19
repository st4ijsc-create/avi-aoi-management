// Broker MQTT GIẢ (aedes 0.51, in-process, 127.0.0.1, cổng trống) cho bộ tasks-api2. aedes 0.51 CHỈ nói MQTT 3.1.1.
// tat() HUỶ mọi socket còn mở — lời giải tự kết nối lại (reconnectPeriod mặc định) không được giữ bài kiểm tới trần giờ.
import net from "node:net";
import aedesMod from "aedes";

export async function batBroker() {
  const broker = aedesMod.createBroker ? await aedesMod.createBroker() : aedesMod();
  const socket = new Set();
  const server = net.createServer((s) => { socket.add(s); s.on("close", () => socket.delete(s)); broker.handle(s); });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const port = server.address().port;
  const tat = () => new Promise((ok) => {
    server.close(() => {});
    for (const s of socket) s.destroy();
    broker.close(() => ok());
  });
  return { broker, url: `mqtt://127.0.0.1:${port}`, port, tat };
}
