/**
 * doc 81 Đợt 7 J2 — driver for PinnedTlsCoreCheck.kt part 2 (REAL TLS handshakes on a plain JVM).
 *
 *   npx tsx FactoryAlertSystem/android/app/src/test/pinned-tls-check-driver.mts      (from the repo root)
 *
 * 1. mints two site certificates with the SERVER's own minting code (server/services/mqttBrokerTls.ts) — the
 *    exact kind of certificate the built-in broker presents (ECDSA P-256, self-signed);
 * 2. starts, on 127.0.0.1 port 0 only: a Node TLS echo server presenting certificate A, and a plaintext TCP server;
 * 3. compiles PinnedTlsCore.kt + PinnedTlsCoreCheck.kt with the Kotlin compiler from the Gradle cache and runs the
 *    check with pinA, pinB (= certificate B's fingerprint), so the JVM verifies right pin / wrong pin / plaintext;
 * 4. INDEPENDENTLY checks what the servers saw: exactly the two right-pin connections completed a TLS handshake,
 *    the TLS server received exactly the echo payload (a wrong-pin client never got to send a byte), and the
 *    plaintext server never received the payload.
 * Env: JAVA (default Android Studio JBR), GRADLE_CACHE (default ~/.gradle/caches/modules-2/files-2.1),
 *      PINNED_TLS_CORE_SRC (a scratch copy of PinnedTlsCore.kt to check instead — for mutants).
 * Temp files only (os.tmpdir); nothing is written in the repo.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { mintSiteBrokerCertificate } from "../../../../../server/services/mqttBrokerTls";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "..");
const JAVA = process.env.JAVA || "C:/Program Files/Android/Android Studio/jbr/bin/java.exe";
const G = process.env.GRADLE_CACHE || path.join(os.homedir(), ".gradle/caches/modules-2/files-2.1");

function jar(group: string, artifact: string, version: string): string {
  const dir = path.join(G, group, artifact, version);
  for (const h of fs.readdirSync(dir)) {
    for (const f of fs.readdirSync(path.join(dir, h))) {
      if (f === `${artifact}-${version}.jar`) return path.join(dir, h, f);
    }
  }
  throw new Error(`jar not found: ${group}:${artifact}:${version}`);
}

function fp(certPem: string): string {
  const b64 = certPem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)![1].replace(/\s+/g, "");
  return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
}

const a = mintSiteBrokerCertificate({ commonName: "J2-check-A", days: 30 });
const b = mintSiteBrokerCertificate({ commonName: "J2-check-B", days: 30 });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dot7-j2-"));
const certFile = path.join(tmp, "a.pem");
fs.writeFileSync(certFile, a.certPem);

let secureConnections = 0;
let tlsBytes = "";
const tlsServer = tls.createServer({ key: a.keyPem, cert: a.certPem }, (s) => {
  secureConnections++;
  s.on("data", (d) => { tlsBytes += d.toString("latin1"); s.write(d); });
  s.on("error", () => {});
});
tlsServer.on("tlsClientError", () => {});
let plainBytes = Buffer.alloc(0);
const plainServer = net.createServer((s) => {
  s.on("data", (d) => { plainBytes = Buffer.concat([plainBytes, d]); s.destroy(); });
  s.on("error", () => {});
});
await new Promise<void>((r) => tlsServer.listen(0, "127.0.0.1", () => r()));
await new Promise<void>((r) => plainServer.listen(0, "127.0.0.1", () => r()));
const tlsPort = (tlsServer.address() as net.AddressInfo).port;
const plainPort = (plainServer.address() as net.AddressInfo).port;

const std = jar("org.jetbrains.kotlin", "kotlin-stdlib", "1.9.0");
const kcp = [
  jar("org.jetbrains.kotlin", "kotlin-compiler-embeddable", "1.9.22"), std,
  jar("org.jetbrains.kotlin", "kotlin-script-runtime", "1.9.22"),
  jar("org.jetbrains.kotlin", "kotlin-reflect", "1.8.20-RC2"),
  jar("org.jetbrains.kotlin", "kotlin-daemon-embeddable", "1.9.22"),
  jar("org.jetbrains.intellij.deps", "trove4j", "1.0.20200330"),
  jar("org.jetbrains", "annotations", "13.0"),
  jar("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm", "1.5.0"),
].join(path.delimiter);
const out = path.join(tmp, "out");
const sources = [
  // PINNED_TLS_CORE_SRC: compile a scratch copy instead (mutation runs) — the repo file is never edited for a mutant
  process.env.PINNED_TLS_CORE_SRC || path.join(SRC, "main/java/com/foutec/FactoryAlertSystem/PinnedTlsCore.kt"),
  path.join(SRC, "test/java/com/foutec/FactoryAlertSystem/PinnedTlsCoreCheck.kt"),
];
const compile = spawnSync(JAVA, ["-cp", kcp, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect",
  "-jvm-target", "17", "-classpath", std, "-d", out, ...sources], { encoding: "utf8" });
if (compile.status !== 0) {
  console.error(compile.stdout, compile.stderr);
  process.exit(2);
}
const run = await new Promise<{ code: number | null; text: string }>((resolve) => {
  // async spawn: the Node servers above must keep serving while the JVM runs
  import("node:child_process").then(({ spawn }) => {
    const p = spawn(JAVA, ["-cp", `${out}${path.delimiter}${std}`, "com.foutec.FactoryAlertSystem.PinnedTlsCoreCheckKt",
      String(tlsPort), fp(a.certPem), fp(b.certPem), String(plainPort), certFile]);
    let text = "";
    p.stdout.on("data", (d) => { text += d; });
    p.stderr.on("data", (d) => { text += d; });
    p.on("close", (code) => resolve({ code, text }));
  });
});
tlsServer.close();
plainServer.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(run.text.trim());
const problems: string[] = [];
if (run.code !== 0) problems.push(`JVM check exit ${run.code}`);
if (secureConnections !== 2) problems.push(`TLS server completed ${secureConnections} handshakes (expected 2: the two right-pin opens)`);
if (tlsBytes !== "ping-from-jvm") problems.push(`TLS server received ${JSON.stringify(tlsBytes)} (expected only the echo payload)`);
if (plainBytes.includes(Buffer.from("ping-from-jvm"))) problems.push("plaintext server received the payload");
if (plainBytes.length > 0 && plainBytes[0] !== 0x16) problems.push(`plaintext server received non-TLS bytes first (0x${plainBytes[0].toString(16)})`);
if (problems.length) {
  console.log(`DRIVER FAILED: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`DRIVER OK: handshakes=${secureConnections}, tlsBytes=${tlsBytes.length}, plaintext server first byte=0x${(plainBytes[0] ?? 0).toString(16)} (TLS ClientHello)`);
