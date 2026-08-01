/**
 * Upload validation — model3d (glTF 2.0) branch. Pure, no IO.
 *
 * Guards the twin.models.uploadAndRegister path: a GLB (binary, magic "glTF") or a JSON
 * glTF (text declaring "asset") is accepted; anything else is rejected 400; oversize 413.
 */
import { describe, it, expect, afterEach } from "vitest";
import { validateUpload, sniffMime } from "./uploadValidation";

/** A minimal GLB header: magic "glTF" + a little padding. */
function glbBuffer(): Buffer {
  return Buffer.concat([Buffer.from([0x67, 0x6c, 0x54, 0x46]), Buffer.from([0x02, 0, 0, 0, 0, 0, 0, 0])]);
}
const GLTF_JSON = Buffer.from('{"asset":{"version":"2.0"},"scenes":[],"nodes":[]}', "utf8");

describe("uploadValidation — model3d", () => {
  afterEach(() => {
    delete process.env.UPLOAD_MAX_BYTES_MODEL3D;
  });

  it("sniffMime detects a GLB by its 'glTF' magic", () => {
    expect(sniffMime(glbBuffer())).toBe("model/gltf-binary");
  });

  it("accepts a GLB binary", () => {
    const r = validateUpload(glbBuffer(), "model3d");
    expect(r.ok).toBe(true);
    expect(r.detectedMime).toBe("model/gltf-binary");
  });

  it("accepts a JSON glTF (text with an \"asset\")", () => {
    const r = validateUpload(GLTF_JSON, "model3d");
    expect(r.ok).toBe(true);
    expect(r.detectedMime).toBe("model/gltf+json");
  });

  it("accepts a JSON glTF with a leading BOM / whitespace", () => {
    const r = validateUpload(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("  \n"), GLTF_JSON]), "model3d");
    expect(r.ok).toBe(true);
    expect(r.detectedMime).toBe("model/gltf+json");
  });

  it("rejects arbitrary bytes (not glTF) with 400", () => {
    const r = validateUpload(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x99]), "model3d");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("rejects JSON that is not a glTF (no \"asset\") with 400", () => {
    const r = validateUpload(Buffer.from('{"hello":"world"}', "utf8"), "model3d");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("rejects an empty body with 400", () => {
    const r = validateUpload(Buffer.alloc(0), "model3d");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("rejects oversize with 413 (env-tuned ceiling)", () => {
    process.env.UPLOAD_MAX_BYTES_MODEL3D = "8"; // 8 bytes
    const r = validateUpload(glbBuffer(), "model3d"); // 12 bytes > 8
    expect(r.ok).toBe(false);
    expect(r.status).toBe(413);
  });
});
