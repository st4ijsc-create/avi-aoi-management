/**
 * Minimal, dependency-free X.509 v3 minting for Ed25519 — doc 37 Đợt-C2 (năng lực 14).
 *
 * WHY hand-rolled: node:crypto can PARSE/verify X.509 (`X509Certificate`) and generate
 * Ed25519 keypairs (`generateKeyPairSync`), but it has NO certificate BUILDER. Rather
 * than add a dependency (node-forge) or shell out to openssl, this module hand-encodes
 * the ~150 bytes of ASN.1 DER needed for an Ed25519 v3 certificate. It is deliberately
 * scoped to Ed25519 because that is the simplest, most robust case:
 *   • SubjectPublicKeyInfo is exported verbatim by node (`publicKey.export spki/der`);
 *   • the signature AlgorithmIdentifier is `{ 1.3.101.112 }` with NO parameters;
 *   • the signature is a fixed 64-byte PureEdDSA value (`sign(null, tbs, key)`).
 * The result round-trips through the native `X509Certificate` (parse + `.verify(caPub)`
 * + `.checkIssued(caCert)` all succeed — validated end-to-end).
 *
 * This is intentionally NOT a general CA toolkit: no RSA/ECDSA, no CRL/OCSP encoding,
 * no arbitrary extension set. It mints exactly two shapes: a self-signed CA cert and a
 * CA-signed leaf. Anything richer → deployment-grade PKI (step-ca / smallstep / Vault).
 */
import { generateKeyPairSync, sign, KeyObject, X509Certificate, randomBytes } from "node:crypto";

// ── ASN.1 DER primitives ─────────────────────────────────────────────────────
const TAG = {
  INT: 0x02,
  BIT: 0x03,
  OCTET: 0x04,
  OID: 0x06,
  UTF8: 0x0c,
  SEQ: 0x30,
  SET: 0x31,
  UTC: 0x17,
  BOOL: 0x01,
} as const;

/** DER length octets (short form < 128, else long form). */
function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let x = n;
  while (x > 0) {
    bytes.unshift(x & 0xff);
    x >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** Tag-Length-Value. */
function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

/** Context-specific [n] EXPLICIT wrapper (constructed). */
function ctx(n: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0xa0 | n]), derLen(content.length), content]);
}

/** Encode a dotted OID string to a DER OID element. */
function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const first = 40 * parts[0] + parts[1];
  const out: number[] = [first];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const chunk = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    out.push(...chunk);
  }
  return tlv(TAG.OID, Buffer.from(out));
}

/** Encode a big-endian byte buffer as a positive DER INTEGER. */
function derPositiveInt(buf: Buffer): Buffer {
  let b = buf.length === 0 ? Buffer.from([0]) : buf;
  // strip leading zero bytes but keep at least one
  let start = 0;
  while (start < b.length - 1 && b[start] === 0) start++;
  b = b.subarray(start);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); // keep positive
  return tlv(TAG.INT, b);
}

function derUtf8(s: string): Buffer {
  return tlv(TAG.UTF8, Buffer.from(s, "utf8"));
}

/** UTCTime YYMMDDHHMMSSZ (valid for years 1950–2049; our 90-day certs are fine). */
function derUtcTime(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, "0");
  const s =
    `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(TAG.UTC, Buffer.from(s, "ascii"));
}

/** RDNSequence carrying a single CN (2.5.4.3). */
function derNameCN(cn: string): Buffer {
  const atv = tlv(TAG.SEQ, Buffer.concat([oid("2.5.4.3"), derUtf8(cn)]));
  return tlv(TAG.SEQ, tlv(TAG.SET, atv));
}

/** AlgorithmIdentifier for Ed25519 (OID 1.3.101.112, absent parameters). */
const ED25519_ALG_ID = tlv(TAG.SEQ, oid("1.3.101.112"));

/** basicConstraints extension (critical). */
function extBasicConstraints(isCa: boolean): Buffer {
  const val = isCa
    ? tlv(TAG.SEQ, tlv(TAG.BOOL, Buffer.from([0xff]))) // cA TRUE
    : tlv(TAG.SEQ, Buffer.alloc(0)); // cA FALSE (default) → empty SEQUENCE
  return tlv(
    TAG.SEQ,
    Buffer.concat([oid("2.5.29.19"), tlv(TAG.BOOL, Buffer.from([0xff])), tlv(TAG.OCTET, val)]),
  );
}

function toPem(der: Buffer): string {
  const b64 = der.toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

export interface Ed25519Keypair {
  publicKey: KeyObject;
  privateKey: KeyObject;
  publicKeyPem: string;
  privateKeyPem: string;
}

/** Generate an Ed25519 keypair (returns KeyObjects + PEM). */
export function generateEd25519(): Ed25519Keypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey,
    privateKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export interface MintOptions {
  subjectCN: string;
  issuerCN: string;
  /** DER of the SUBJECT's SubjectPublicKeyInfo (from publicKey.export spki/der). */
  subjectSpkiDer: Buffer;
  /** The CA (or self, for a self-signed CA) Ed25519 PRIVATE key that signs the cert. */
  signingKey: KeyObject;
  /** Validity window in days. */
  days: number;
  /** true → basicConstraints cA:TRUE (a CA cert); false → leaf. */
  isCa: boolean;
  /** Optional explicit serial (positive big-endian). Random 16 bytes if omitted. */
  serial?: Buffer;
  /** Optional explicit notBefore (defaults to now). */
  notBefore?: Date;
}

export interface MintResult {
  pem: string;
  cert: X509Certificate;
  serialHex: string;
  fingerprintSha256: string;
  notBefore: Date;
  notAfter: Date;
}

/**
 * Mint an Ed25519 X.509 v3 certificate. For a self-signed CA, pass isCa:true and set
 * signingKey to the same key whose public half is in subjectSpkiDer, with issuerCN==subjectCN.
 */
export function mintEd25519Cert(opts: MintOptions): MintResult {
  const serial = opts.serial ?? randomBytes(16);
  const notBefore = opts.notBefore ?? new Date();
  const notAfter = new Date(notBefore.getTime() + opts.days * 86_400_000);

  const version = ctx(0, derPositiveInt(Buffer.from([0x02]))); // v3
  const validity = tlv(TAG.SEQ, Buffer.concat([derUtcTime(notBefore), derUtcTime(notAfter)]));
  const extensions = ctx(3, tlv(TAG.SEQ, extBasicConstraints(opts.isCa)));

  const tbs = tlv(
    TAG.SEQ,
    Buffer.concat([
      version,
      derPositiveInt(serial),
      ED25519_ALG_ID, // signature alg inside TBS
      derNameCN(opts.issuerCN),
      validity,
      derNameCN(opts.subjectCN),
      opts.subjectSpkiDer,
      extensions,
    ]),
  );

  const signature = sign(null, tbs, opts.signingKey); // Ed25519 PureEdDSA
  const sigBit = tlv(TAG.BIT, Buffer.concat([Buffer.from([0]), signature]));
  const certDer = tlv(TAG.SEQ, Buffer.concat([tbs, ED25519_ALG_ID, sigBit]));

  const pem = toPem(certDer);
  const cert = new X509Certificate(pem);
  return {
    pem,
    cert,
    serialHex: cert.serialNumber,
    fingerprintSha256: cert.fingerprint256,
    notBefore,
    notAfter,
  };
}
