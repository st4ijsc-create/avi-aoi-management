// Máy chủ OPC UA GIẢ (node-opcua OPCUAServer, in-process, 127.0.0.1, cổng ngẫu nhiên, KHÔNG bảo mật, ẩn danh).
// PKI máy chủ dùng chung ở %TEMP%/ai-eval-opcua-pki (tạo chứng chỉ một lần). Đếm yêu cầu theo loại để bài kiểm biết
// lời giải gọi DỊCH VỤ nào (vd đọc gộp MỘT ReadRequest, theo dõi bằng CreateMonitoredItems chứ không thăm dò).
import os from "node:os";
import path from "node:path";
import { OPCUAServer, OPCUACertificateManager, MessageSecurityMode, SecurityPolicy } from "node-opcua";

export async function batOpcua(dung) {
  const cm = new OPCUACertificateManager({ rootFolder: path.join(os.tmpdir(), "ai-eval-opcua-pki"), automaticallyAcceptUnknownCertificate: true });
  const server = new OPCUAServer({
    port: 0, hostname: "127.0.0.1", alternateHostname: ["127.0.0.1"], serverCertificateManager: cm,
    securityModes: [MessageSecurityMode.None], securityPolicies: [SecurityPolicy.None], allowAnonymous: true,
  });
  await server.initialize();
  const as = server.engine.addressSpace;
  const ns = as.getOwnNamespace();
  const yeuCau = {};
  server.on("request", (req) => { const k = req.constructor.name; yeuCau[k] = (yeuCau[k] ?? 0) + 1; });
  if (dung) await dung({ server, as, ns, objects: as.rootFolder.objects });
  await server.start();
  const port = server.endpoints[0].port;
  return {
    server, as, ns, yeuCau, endpoint: `opc.tcp://127.0.0.1:${port}`,
    soPhien: () => server.currentSessionCount,
    soKenh: () => server.currentChannelCount,
    soSubscription: () => server.currentSubscriptionCount,
    tat: () => server.shutdown(0),
  };
}
