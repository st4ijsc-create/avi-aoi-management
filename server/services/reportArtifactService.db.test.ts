/**
 * Doc 32 Wave R2 (R2-B) — INTEGRATION tests for reportArtifactService against
 * the ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL to <db>_test;
 * report_artifacts created by migration 0202).
 *
 * The storage layer (server/storage.ts) is MOCKED so no network / disk is
 * touched: storagePut/storageGet return synthetic /uploads URLs and record
 * their calls; storageDelete records the keys the cleanup removed.
 *
 * Proves the mission's acceptance list:
 *   • persistArtifact stores + the row has sha256 / size / expiresAt = +365d;
 *   • content-hash dedupe returns the existing row without a second upload;
 *   • getArtifact access control (creator ok, other user denied, admin ok,
 *     system artifact denied to non-privileged);
 *   • getDownloadTarget on an expired artifact → ArtifactError('expired');
 *   • cleanup deletes ONLY expired artifacts (+ their storage objects).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

// ── Mock the storage layer (hoisted above the service import) ────────────────
const storageMock = vi.hoisted(() => ({
  puts: [] as Array<{ key: string; size: number; contentType: string }>,
  gets: [] as Array<{ key: string }>,
  deletes: [] as Array<{ key: string }>,
}));

vi.mock("../storage", () => ({
  storagePut: vi.fn(async (key: string, data: Buffer | Uint8Array, contentType: string) => {
    storageMock.puts.push({ key, size: (data as Buffer).length, contentType });
    return { key, url: `/uploads/${key}` };
  }),
  storageGet: vi.fn(async (key: string) => {
    storageMock.gets.push({ key });
    return { key, url: `/uploads/${key}` };
  }),
  storageDelete: vi.fn(async (key: string) => {
    storageMock.deletes.push({ key });
    return { deleted: true };
  }),
}));

import {
  persistArtifact,
  getArtifact,
  getDownloadTarget,
  deleteArtifact,
  listArtifacts,
  runReportArtifactCleanupOnce,
  ArtifactError,
  sha256Hex,
} from "./reportArtifactService";

const DB_URL = process.env.DATABASE_URL;
const RT = `r2b_${Date.now().toString(36)}`;
const RT_SYS = `${RT}_sys`;
const USER = 730001;
const OTHER = 730002;

const creator = { id: USER, role: "operator" };
const other = { id: OTHER, role: "operator" };
const admin = { id: OTHER, role: "admin" };

let sql: ReturnType<typeof postgres>;

describe.skipIf(!DB_URL)("R2-B reportArtifactService (isolated test DB, storage mocked)", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
  });

  afterAll(async () => {
    await sql`DELETE FROM report_artifacts WHERE "reportType" IN (${RT}, ${RT_SYS})`;
    await sql.end();
  });

  it("persistArtifact stores bytes + writes a row with sha256, size, expiresAt=+365d", async () => {
    const buffer = Buffer.from("R2-B daily report body — persist me");
    const before = storageMock.puts.length;

    const res = await persistArtifact({
      buffer,
      format: "pdf",
      reportType: RT,
      title: "R2-B daily",
      params: { factoryId: 1, scope: "daily" },
      createdBy: USER,
      source: "on_demand",
    });

    // Content integrity + retention.
    expect(res.fileHash).toBe(sha256Hex(buffer));
    expect(res.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.fileSize).toBe(buffer.length);
    expect(res.downloadUrl).toBe(`/api/reports/artifacts/${res.id}/download`);
    expect(res.deduped).toBe(false);

    const expectedExpiry = Date.now() + 365 * 24 * 60 * 60 * 1000;
    expect(Math.abs(res.expiresAt.getTime() - expectedExpiry)).toBeLessThan(60_000);

    // A real upload happened with a hash-namespaced key + pdf content type.
    expect(storageMock.puts.length).toBe(before + 1);
    const put = storageMock.puts[storageMock.puts.length - 1];
    expect(put.key).toBe(res.storageKey);
    expect(put.key).toMatch(/^report-artifacts\/\d{4}\/\d{2}\/[0-9a-f]{64}\.pdf$/);
    expect(put.contentType).toBe("application/pdf");
    expect(put.size).toBe(buffer.length);

    // The row is really persisted and readable back.
    const row = await getArtifact(res.id, creator);
    expect(row.reportType).toBe(RT);
    expect(row.fileHash).toBe(res.fileHash);
    expect(row.params).toEqual({ factoryId: 1, scope: "daily" });
  });

  it("dedupes identical bytes — returns the existing row without a second upload", async () => {
    const buffer = Buffer.from("R2-B dedupe body — identical bytes twice");
    const first = await persistArtifact({ buffer, format: "csv", reportType: RT, createdBy: USER });
    const uploadsAfterFirst = storageMock.puts.length;

    const second = await persistArtifact({ buffer, format: "csv", reportType: RT, createdBy: USER });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    // No new upload for the duplicate.
    expect(storageMock.puts.length).toBe(uploadsAfterFirst);
  });

  it("getArtifact access control: creator ok · other user denied · admin ok · system→privileged only", async () => {
    const owned = await persistArtifact({
      buffer: Buffer.from("owned artifact"),
      format: "xlsx",
      reportType: RT,
      createdBy: USER,
    });

    // Creator can read.
    await expect(getArtifact(owned.id, creator)).resolves.toMatchObject({ id: owned.id });
    // Admin (privileged) can read someone else's.
    await expect(getArtifact(owned.id, admin)).resolves.toMatchObject({ id: owned.id });
    // A different non-privileged user is forbidden.
    await expect(getArtifact(owned.id, other)).rejects.toMatchObject({ reason: "forbidden" });

    // System artifact (createdBy null) — non-privileged denied, admin ok.
    const system = await persistArtifact({
      buffer: Buffer.from("system artifact"),
      format: "html",
      reportType: RT_SYS,
      createdBy: null,
      source: "scheduled",
    });
    await expect(getArtifact(system.id, creator)).rejects.toMatchObject({ reason: "forbidden" });
    await expect(getArtifact(system.id, admin)).resolves.toMatchObject({ id: system.id });
  });

  it("getDownloadTarget resolves a fresh URL for a live artifact and rejects an expired one (GONE)", async () => {
    const live = await persistArtifact({
      buffer: Buffer.from("live for download"),
      format: "pdf",
      reportType: RT,
      createdBy: USER,
    });
    const target = await getDownloadTarget(live.id, creator);
    expect(target.directUrl).toBe(`/uploads/${live.storageKey}`);
    expect(target.filename).toBe(`${RT}-${live.id}.pdf`);
    expect(target.downloadUrl).toBe(`/api/reports/artifacts/${live.id}/download`);

    // Forge an already-expired artifact (retentionDays = -1 → expiresAt in the past).
    const expired = await persistArtifact({
      buffer: Buffer.from("expired report"),
      format: "pdf",
      reportType: RT,
      createdBy: USER,
      retentionDays: -1,
    });
    // Metadata is still fetchable...
    await expect(getArtifact(expired.id, creator)).resolves.toMatchObject({ id: expired.id });
    // ...but a download is GONE.
    await expect(getDownloadTarget(expired.id, creator)).rejects.toMatchObject({ reason: "expired" });
    await expect(getDownloadTarget(expired.id, creator)).rejects.toBeInstanceOf(ArtifactError);
  });

  it("cleanup deletes ONLY expired artifacts (row + storage object)", async () => {
    const live = await persistArtifact({
      buffer: Buffer.from("keep me — not expired"),
      format: "pdf",
      reportType: RT,
      createdBy: USER,
    });
    const expired = await persistArtifact({
      buffer: Buffer.from("sweep me — expired"),
      format: "pdf",
      reportType: RT,
      createdBy: USER,
      retentionDays: -1,
    });

    const deletesBefore = storageMock.deletes.length;
    const result = await runReportArtifactCleanupOnce({ now: new Date() });
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    // Expired row is gone; live row survives.
    await expect(getArtifact(expired.id, creator)).rejects.toMatchObject({ reason: "not_found" });
    await expect(getArtifact(live.id, creator)).resolves.toMatchObject({ id: live.id });

    // The expired object's storage key was removed.
    expect(storageMock.deletes.length).toBeGreaterThan(deletesBefore);
    expect(storageMock.deletes.some((d) => d.key === expired.storageKey)).toBe(true);
  });

  it("listArtifacts hard-scopes a non-privileged viewer to their own rows", async () => {
    // OTHER (non-privileged) sees none of USER's artifacts.
    const otherList = await listArtifacts(other, { reportType: RT });
    expect(otherList.items.every((a) => a.createdBy === OTHER)).toBe(true);

    // Admin (privileged) can filter by createdBy and see USER's rows.
    const adminList = await listArtifacts(admin, { reportType: RT, createdBy: USER });
    expect(adminList.total).toBeGreaterThanOrEqual(1);
    expect(adminList.items.every((a) => a.createdBy === USER)).toBe(true);
  });

  it("deleteArtifact is access-checked and removes the row", async () => {
    const a = await persistArtifact({
      buffer: Buffer.from("delete me"),
      format: "csv",
      reportType: RT,
      createdBy: USER,
    });
    // A different non-privileged user cannot delete it.
    await expect(deleteArtifact(a.id, other)).rejects.toMatchObject({ reason: "forbidden" });
    // The creator can.
    await expect(deleteArtifact(a.id, creator)).resolves.toBe(true);
    await expect(getArtifact(a.id, creator)).rejects.toMatchObject({ reason: "not_found" });
  });
});
