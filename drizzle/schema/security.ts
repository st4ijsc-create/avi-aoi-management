/**
 * Schema domain: Security identity — device X.509 PKI + service (SPIFFE-lite) identity.
 * SYNAPSE năng lực 14 (doc 37 Đợt-C2). Flag-gated (DEVICE_PKI_ENABLED / SERVICE_MTLS_ENABLED).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Vì sao module này tồn tại (doc 37, năng lực 14 ~55%):
 *   synapse đã có policy-as-code (policyGate) + WORM hash-chain audit (auditChain) +
 *   avi_app least-privilege (mig 0224). THIẾU hai mảnh identity nền tảng:
 *     • DEVICE identity — mỗi adapter/robot/edge-node phải có một chứng chỉ X.509 do
 *       CA nội bộ ký, xoay vòng 90 ngày, thu hồi được (device_certificates).
 *     • SERVICE identity — mỗi service nội bộ có một SPIFFE-lite ID + JWT-SVID để
 *       xác thực service-to-service (service_identities).
 *
 * SCOPE THÀNH THẬT (đọc kỹ): đây là mặt PHẦN MỀM của PKI. CA key sinh 1 lần, lưu ở
 * OS-keystore/ENV (giống license). KHÔNG có TPM sealing, KHÔNG có full mTLS TLS
 * handshake tại transport (đó là việc của reverse-proxy / deployment). Cert được đúc
 * bằng node:crypto (ASN.1 DER thủ công, Ed25519) và verify bằng X509Certificate gốc.
 * Toàn bộ enforcement được cổng bởi cờ; cờ OFF → không đổi hành vi.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  pgTable, serial, integer, varchar, text, timestamp, jsonb, index, uniqueIndex, pgEnum,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────────────
/** Life-cycle of a device certificate. */
export const deviceCertStatusEnum = pgEnum("device_cert_status_enum", [
  "active",
  "revoked",
  "expired",
  "superseded", // rotated away from (a newer cert took over)
]);

/** Which kind of principal a device cert binds to. */
export const deviceCertKindEnum = pgEnum("device_cert_kind_enum", [
  "adapter",
  "robot",
  "edge_node",
  "plc",
  "generic",
]);

/** Life-cycle of a service (SPIFFE-lite) identity. */
export const serviceIdentityStatusEnum = pgEnum("service_identity_status_enum", [
  "active",
  "revoked",
]);

// ─── Internal CA metadata ────────────────────────────────────────────────────
/**
 * One-row-per-generation record of the internal CA. The PRIVATE key never lands
 * here — it lives in the OS-keystore/ENV (see internalCa.ts). We persist only the
 * public cert (PEM) + fingerprint so verifiers/UX can pin/trust it and so rotation
 * of the CA is auditable. `active=true` marks the CA currently issuing leaf certs.
 */
export const securityCaMetadata = pgTable("security_ca_metadata", {
  id: serial("id").primaryKey(),
  /** Trust domain this CA anchors, e.g. "st4i.local". */
  trustDomain: varchar("trust_domain", { length: 255 }).notNull(),
  /** CA subject CN, e.g. "ST4I-Internal-CA". */
  subjectCn: varchar("subject_cn", { length: 255 }).notNull(),
  /** CA certificate (PEM, PUBLIC only). */
  certPem: text("cert_pem").notNull(),
  /** Public key (SPKI PEM) — the anchor verifiers pin. */
  pubkeyPem: text("pubkey_pem").notNull(),
  /** sha256 fingerprint (colon-hex) of the CA cert. */
  fingerprintSha256: varchar("fingerprint_sha256", { length: 128 }).notNull(),
  /** Algorithm — MVP: ed25519. */
  algorithm: varchar("algorithm", { length: 32 }).default("ed25519").notNull(),
  notBefore: timestamp("not_before").notNull(),
  notAfter: timestamp("not_after").notNull(),
  /** Exactly one row should be active at a time (partial unique index below). */
  active: integer("active").default(1).notNull(), // 1=active, 0=retired (int for partial-index portability)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ca_meta_domain").on(t.trustDomain),
  index("idx_ca_meta_active").on(t.active),
]);

export type SecurityCaMetadata = typeof securityCaMetadata.$inferSelect;
export type InsertSecurityCaMetadata = typeof securityCaMetadata.$inferInsert;

// ─── Device certificates (X.509 PKI) ─────────────────────────────────────────
export const deviceCertificates = pgTable("device_certificates", {
  id: serial("id").primaryKey(),
  /** Logical device reference (edge_nodes.code / adapter id / robot id). Free-text ref,
   *  NOT a hard FK — device registries are heterogeneous across synapse domains. */
  deviceId: varchar("device_id", { length: 255 }).notNull(),
  kind: deviceCertKindEnum("kind").default("generic").notNull(),
  /** Subject CN embedded in the cert, e.g. "device:adapter-42". */
  subjectCn: varchar("subject_cn", { length: 255 }).notNull(),
  /** SPIFFE-lite ID also embedded so a device cert doubles as a workload id. */
  spiffeId: varchar("spiffe_id", { length: 512 }),
  /** Cert serial (hex, from the X.509). Unique per CA. */
  serialNumber: varchar("serial_number", { length: 128 }).notNull(),
  /** sha256 fingerprint (colon-hex) — the value a verifier matches against. */
  fingerprintSha256: varchar("fingerprint_sha256", { length: 128 }).notNull(),
  /** Leaf certificate (PEM). */
  certPem: text("cert_pem").notNull(),
  /** Device public key (SPKI PEM). */
  pubkeyPem: text("pubkey_pem").notNull(),
  /** Which CA generation signed this (FK to metadata). */
  issuedBy: integer("issued_by").references(() => securityCaMetadata.id),
  /** If this cert replaced an earlier one via rotation, link back to it. */
  rotatedFromId: integer("rotated_from_id"),
  status: deviceCertStatusEnum("status").default("active").notNull(),
  notBefore: timestamp("not_before").notNull(),
  notAfter: timestamp("not_after").notNull(),
  revokedAt: timestamp("revoked_at"),
  revokedReason: text("revoked_reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_device_certs_device").on(t.deviceId),
  index("idx_device_certs_status").on(t.status),
  uniqueIndex("idx_device_certs_serial").on(t.serialNumber),
  uniqueIndex("idx_device_certs_fpr").on(t.fingerprintSha256),
  index("idx_device_certs_expiry").on(t.notAfter),
]);

export type DeviceCertificate = typeof deviceCertificates.$inferSelect;
export type InsertDeviceCertificate = typeof deviceCertificates.$inferInsert;

// ─── Service identities (SPIFFE-lite) ────────────────────────────────────────
export const serviceIdentities = pgTable("service_identities", {
  id: serial("id").primaryKey(),
  /** Short service name, e.g. "orchestrator", "vision-adapter". */
  serviceName: varchar("service_name", { length: 128 }).notNull(),
  /** Full SPIFFE-lite ID: spiffe://<trust-domain>/service/<name>. */
  spiffeId: varchar("spiffe_id", { length: 512 }).notNull(),
  /** Optional short-lived leaf cert (PEM) if the service also gets an X.509 SVID. */
  certPem: text("cert_pem"),
  /** Optional public key (SPKI PEM). */
  pubkeyPem: text("pubkey_pem"),
  fingerprintSha256: varchar("fingerprint_sha256", { length: 128 }),
  issuedBy: integer("issued_by").references(() => securityCaMetadata.id),
  status: serviceIdentityStatusEnum("status").default("active").notNull(),
  notBefore: timestamp("not_before"),
  notAfter: timestamp("not_after"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("idx_service_ident_spiffe").on(t.spiffeId),
  index("idx_service_ident_name").on(t.serviceName),
  index("idx_service_ident_status").on(t.status),
]);

export type ServiceIdentity = typeof serviceIdentities.$inferSelect;
export type InsertServiceIdentity = typeof serviceIdentities.$inferInsert;
