// Doc 34 · P1 — Vendor manual → programming knowledge ingestion.
//
// Walks vendor PDF manuals on disk and produces a per-vendor programming
// knowledge collection: structure-aware text chunks + rich metadata. This is
// the OFFLINE text-extraction + chunking step ONLY. Embeddings (embeddings.jsonl)
// are produced by a separate runtime step (see doc 34 §III.3(c)) — NOT here.
//
// SHARED ON-DISK CONTRACT (a separate retrieval service reads these — do not drift):
//   knowledge/programming/<vendorSlug>/chunks.jsonl   — one JSON object per line:
//     { id, vendor, docTitle, sourcePath, page, lang, section, text, keywords }
//   knowledge/programming/manifest.json:
//     { generatedAt, embedModel, collections:[{vendor,docs,chunks,sourceDir}], totalChunks }
//
// Source manuals live at PROG_KB_MANUALS_DIR (default "D:/SOURCES/AI Local/Manual"),
// one subfolder per vendor, each containing *.pdf. Folder name is "Manual" (singular).
//
// Usage:
//   node scripts/ai-kb/ingest-manuals.mjs                       # full ingest (overwrite)
//   node scripts/ai-kb/ingest-manuals.mjs --dry                 # parse + report, write nothing
//   node scripts/ai-kb/ingest-manuals.mjs --only "Universal Robots" --dry
//   node scripts/ai-kb/ingest-manuals.mjs --limit 2 --dry
//   node scripts/ai-kb/ingest-manuals.mjs --stamp 2026-07-05T00:00:00Z
//
// Robustness: a corrupt or scanned/image-only PDF that yields little/no text is
// logged under manifest.lowYield and SKIPPED — it never crashes the run.

// Load repo-root .env BEFORE reading process.env (PROG_KB_MANUALS_DIR, chunk caps).
// dotenv (a project dependency) does NOT overwrite already-set process.env keys.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
// pdf-parse v2 (ESM). Named export `PDFParse`; instance.getText() -> TextResult
// with { pages:[{num,text}], text, total }. Import resolves from the project
// node_modules because this file lives under the repo tree.
import { PDFParse } from "pdf-parse";

const ROOT = process.cwd();
const MANUALS_DIR = (process.env.PROG_KB_MANUALS_DIR ?? "D:/SOURCES/AI Local/Manual").replace(/[\\/]+$/, "");
const OUT_DIR = path.join(ROOT, "knowledge", "programming");
// Char cap per chunk (~450–600 tokens EN). Mirrors build-knowledge-chunks.mjs (1800).
const MAX_CHARS = Number(process.env.PROG_KB_CHUNK_MAX_CHARS ?? 1800);
// Merge trailing prose fragments below this into the previous chunk (same page).
const MIN_CHUNK_CHARS = Number(process.env.PROG_KB_CHUNK_MIN_CHARS ?? 120);
// A doc yielding fewer total text chars than this is treated as scanned/empty.
const MIN_DOC_CHARS = Number(process.env.PROG_KB_MIN_DOC_CHARS ?? 200);
// A multi-page doc averaging fewer chars/page than this looks image-only (scanned).
const MIN_AVG_CHARS_PER_PAGE = Number(process.env.PROG_KB_MIN_AVG_CHARS_PER_PAGE ?? 40);
// Embedding model recorded in the manifest (contract-fixed; embeddings made elsewhere).
const EMBED_MODEL = "Qwen3-Embedding-0.6B-f16";

// ─── CLI args ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { only: null, limit: Infinity, dry: false, stamp: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const key = eq >= 0 ? a.slice(0, eq) : a;
    const inlineVal = eq >= 0 ? a.slice(eq + 1) : null;
    const takeVal = () => (inlineVal !== null ? inlineVal : argv[++i]);
    switch (key) {
      case "--only":
        out.only = takeVal();
        break;
      case "--limit":
        out.limit = Math.max(0, Number(takeVal()) || 0);
        break;
      case "--dry":
        out.dry = true;
        break;
      case "--stamp":
        out.stamp = takeVal();
        break;
      default:
        if (a.startsWith("--")) console.warn(`[prog-kb] Unknown flag ignored: ${a}`);
    }
  }
  return out;
}

// ─── Small utilities ───────────────────────────────────────────────────────────
function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Top-N frequency keywords (mirrors build-knowledge-chunks.keywordsFromText,
// but keeps digit-bearing tokens like error codes / instruction mnemonics).
function keywordsFromText(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

// Per-chunk language detection. Manuals here are English; the field is kept for
// the multilingual contract (en|vi|zh). CJK -> zh; Vietnamese-specific letters -> vi.
const CJK_RE = /[一-鿿㐀-䶿]/g;
const VI_RE = /[ăâđêôơưĂÂĐÊÔƠƯàảãạáằẳẵặắầẩẫậấèẻẽẹéềểễệếìỉĩịíòỏõọóồổỗộốờởỡợớùủũụúừửữựứỳỷỹỵý]/g;
function detectLang(text) {
  const len = text.length || 1;
  const cjk = (text.match(CJK_RE) || []).length;
  if (cjk / len > 0.05) return "zh";
  const vi = (text.match(VI_RE) || []).length;
  if (vi / len > 0.01) return "vi";
  return "en";
}

// Stable, content-addressed id. Depends only on (vendor, sourcePath, page,
// chunkIndex) — stable across runs, order-independent per doc.
function makeChunkId(vendorSlug, sourcePath, page, chunkIndex) {
  const h = crypto
    .createHash("sha256")
    .update(`${vendorSlug}|${sourcePath}|${page}|${chunkIndex}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `${vendorSlug}:${h}`;
}

// ─── Structure detection ───────────────────────────────────────────────────────
// Heading heuristic: ALL-CAPS lines, numbered headings (1 / 1.2 / 3.4.1),
// or chapter/section/instruction markers. Used to fill `section`.
function detectHeading(rawLine) {
  const line = rawLine.trim();
  if (line.length < 2 || line.length > 90) return null;
  if (!/[A-Za-z]/.test(line)) return null;
  // Numbered heading: "3", "3.2", "3.2.1 Motion commands"
  if (/^\d+(\.\d+){0,4}\.?(\s+\S.*)?$/.test(line) && /[A-Za-z]/.test(line)) return line;
  // Keyword-prefixed heading
  if (/^(chapter|section|appendix|part|instruction|function|command)\b/i.test(line)) return line;
  // ALL-CAPS heading (allow digits/punct), needs >=2 uppercase letters, no lowercase.
  if (/^[A-Z0-9][A-Z0-9 \-_/().,:&']+$/.test(line) && (line.match(/[A-Z]/g) || []).length >= 2) {
    return line;
  }
  return null;
}

// Code/table line heuristic: preserve monospace/indented runs and column-tab
// (instruction-table) runs so chunking never splits them mid-block.
function isCodeLine(rawLine) {
  if (!rawLine.trim()) return false;
  if (/\t/.test(rawLine)) return true; // pdf-parse emits \t as the column/cell separator
  if (/^\s{2,}\S/.test(rawLine)) return true; // indented (code / continuation)
  return false;
}

// Split a page into ordered units: prose paragraphs and code/table blocks.
// Each unit = { type:'prose'|'code', text, section }.
function pageToUnits(pageText, sectionRef) {
  const lines = pageText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const units = [];
  let buf = [];
  let bufKind = null; // 'prose' | 'code'

  const flush = () => {
    if (!buf.length) return;
    const text =
      bufKind === "code" ? buf.join("\n").replace(/\s+$/, "") : buf.join("\n").replace(/[ \t]+\n/g, "\n").trim();
    if (text.trim()) units.push({ type: bufKind, text, section: sectionRef.value });
    buf = [];
    bufKind = null;
  };

  for (const line of lines) {
    // Track running section heading (also keep the heading line in the text).
    const heading = detectHeading(line);
    if (heading) sectionRef.value = heading;

    if (line.trim() === "") {
      // Blank line: paragraph boundary for prose; keep a single blank inside code.
      if (bufKind === "code") {
        buf.push("");
      } else {
        flush();
      }
      continue;
    }

    const kind = isCodeLine(line) ? "code" : "prose";
    if (bufKind && kind !== bufKind) flush();
    bufKind = kind;
    buf.push(line);
  }
  flush();
  return units;
}

// Last 1–2 sentences of a prose chunk, for gentle overlap into the next chunk.
function overlapTail(text) {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  const tail = sentences.slice(-2).join(" ");
  return tail.length > 400 ? tail.slice(-400) : tail;
}

// Split an over-long prose paragraph by sentence boundaries (never mid-word).
function splitLongProse(text, maxChars) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length <= maxChars) {
      cur = cur ? `${cur} ${s}` : s;
    } else {
      if (cur) parts.push(cur.trim());
      // A single monster sentence with no boundary: hard-wrap on whitespace.
      if (s.length > maxChars) {
        let rest = s;
        while (rest.length > maxChars) {
          let cut = rest.lastIndexOf(" ", maxChars);
          if (cut < maxChars * 0.5) cut = maxChars; // no good space -> hard cut
          parts.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        cur = rest;
      } else {
        cur = s;
      }
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Pack a doc's pages into chunks. Returns [{ text, page, section }].
// Rules: ~MAX_CHARS cap; never split code/table blocks; ~1–2 sentence overlap
// across prose chunk boundaries; merge sub-MIN prose fragments within a page.
function chunkDocument(pages) {
  const sectionRef = { value: "" };
  const chunks = [];
  let prevProseTail = ""; // overlap source (only from prose)
  let prevWasCode = false;

  for (const { num, text } of pages) {
    const units = pageToUnits(text, sectionRef);
    if (!units.length) continue;

    let cur = "";
    let curSection = sectionRef.value;
    let curHadContent = false;

    const emit = () => {
      const t = cur.trim();
      if (!t) {
        cur = "";
        curHadContent = false;
        return;
      }
      chunks.push({ text: t, page: num, section: curSection });
      prevProseTail = /\t/.test(t) || /\n\s{2,}\S/.test(t) ? "" : overlapTail(t);
      prevWasCode = false;
      cur = "";
      curHadContent = false;
    };

    for (const unit of units) {
      if (unit.type === "code") {
        // Flush any pending prose first; code blocks are kept intact.
        if (curHadContent) emit();
        if (unit.text.length >= MAX_CHARS) {
          // Oversized code/table: emit whole (do NOT split a code block).
          chunks.push({ text: unit.text, page: num, section: unit.section });
          prevProseTail = "";
          prevWasCode = true;
          continue;
        }
        cur = unit.text;
        curSection = unit.section;
        curHadContent = true;
        prevWasCode = true;
        emit();
        continue;
      }

      // prose unit — may need sentence-splitting if huge
      const pieces = unit.text.length > MAX_CHARS ? splitLongProse(unit.text, MAX_CHARS) : [unit.text];
      for (const piece of pieces) {
        // Start a fresh chunk: seed with overlap tail from previous prose chunk.
        if (!curHadContent && prevProseTail && !prevWasCode) {
          const seed = `${prevProseTail}\n\n`;
          if (seed.length + piece.length <= MAX_CHARS) {
            cur = seed + piece;
            curSection = unit.section;
            curHadContent = true;
            prevWasCode = false;
            continue;
          }
        }
        const candidateLen = cur ? cur.length + 2 + piece.length : piece.length;
        if (curHadContent && candidateLen > MAX_CHARS) {
          emit();
          cur = piece;
          curSection = unit.section;
          curHadContent = true;
        } else {
          cur = cur ? `${cur}\n\n${piece}` : piece;
          if (!curHadContent) curSection = unit.section;
          curHadContent = true;
        }
        prevWasCode = false;
      }
    }
    if (curHadContent) emit();
  }

  // Merge sub-MIN prose fragments into the previous chunk on the same page
  // (avoids a spray of tiny header/footer fragments). Never merges code blocks.
  const merged = [];
  for (const c of chunks) {
    const isCode = /\t/.test(c.text) || /\n\s{2,}\S/.test(c.text);
    const prev = merged[merged.length - 1];
    if (
      !isCode &&
      prev &&
      prev.page === c.page &&
      c.text.length < MIN_CHUNK_CHARS &&
      prev.text.length + c.text.length + 2 <= MAX_CHARS
    ) {
      prev.text = `${prev.text}\n\n${c.text}`;
      continue;
    }
    merged.push({ ...c });
  }
  return merged;
}

// ─── FUTURE: OCR of scanned/image-only pages via the Qwen3-VL sidecar ───────────
// TODO(doc34-P1-OCR): scanned PDFs (detected as lowYield below) currently produce
// no chunks. A future enhancement should render low-text pages to images and OCR
// them through the vision sidecar, then feed the recovered text into chunkDocument().
// Intentionally NOT implemented here — this pipeline is text-extraction only.
// eslint-disable-next-line no-unused-vars
async function ocrPageViaVLSidecar(_pdfPath, _pageNum) {
  throw new Error("OCR not implemented (doc34-P1-OCR future hook)");
}

// ─── PDF extraction (pdf-parse v2) ─────────────────────────────────────────────
// Returns { pages:[{num,text}], total } or throws.
async function extractPdf(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: new Uint8Array(buf), verbosity: 0 });
  try {
    // pageJoiner:"" suppresses the "-- page N of M --" boundary marker so
    // per-page text stays clean; we get real page numbers from pages[].num.
    const res = await parser.getText({ pageJoiner: "", parsePageInfo: false, parseHyperlinks: false });
    const pages = (res.pages ?? []).map((p) => ({ num: p.num, text: p.text ?? "" }));
    return { pages, total: res.total ?? pages.length };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

// ─── Vendor / file discovery ───────────────────────────────────────────────────
function listVendors(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function listPdfs(vendorDir) {
  return fs
    .readdirSync(vendorDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => e.name)
    .sort();
}

function relSourcePath(pdfPath) {
  return path.relative(MANUALS_DIR, pdfPath).split(path.sep).join("/");
}

// ─── Manifest (rebuilt from disk so partial runs stay consistent) ──────────────
function rebuildManifest(stamp) {
  const collections = [];
  let totalChunks = 0;
  if (fs.existsSync(OUT_DIR)) {
    for (const entry of fs.readdirSync(OUT_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const jsonl = path.join(OUT_DIR, entry.name, "chunks.jsonl");
      if (!fs.existsSync(jsonl)) continue;
      const lines = fs
        .readFileSync(jsonl, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.length) continue;
      const docs = new Set();
      let vendorSlug = entry.name;
      let firstSegment = "";
      for (const line of lines) {
        try {
          const o = JSON.parse(line);
          if (o.sourcePath) {
            docs.add(o.sourcePath);
            if (!firstSegment) firstSegment = String(o.sourcePath).split("/")[0];
          }
          if (o.vendor) vendorSlug = o.vendor;
        } catch {
          /* ignore malformed line */
        }
      }
      collections.push({
        vendor: vendorSlug,
        docs: docs.size,
        chunks: lines.length,
        sourceDir: firstSegment ? `${MANUALS_DIR}/${firstSegment}` : MANUALS_DIR,
      });
      totalChunks += lines.length;
    }
  }
  collections.sort((a, b) => a.vendor.localeCompare(b.vendor));
  return {
    generatedAt: stamp || "unstamped",
    embedModel: EMBED_MODEL,
    collections,
    totalChunks,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[prog-kb] manualsDir="${MANUALS_DIR}" out="${path.relative(ROOT, OUT_DIR)}" maxChars=${MAX_CHARS} ` +
      `dry=${args.dry} only=${args.only ?? "*"} limit=${args.limit === Infinity ? "all" : args.limit}`,
  );

  if (!fs.existsSync(MANUALS_DIR)) {
    console.error(`[prog-kb] Manuals dir not found: ${MANUALS_DIR}`);
    process.exit(1);
  }

  const vendors = listVendors(MANUALS_DIR).filter((v) => {
    if (!args.only) return true;
    const want = args.only.toLowerCase();
    return v.toLowerCase() === want || slugify(v) === slugify(args.only);
  });

  if (!vendors.length) {
    console.error(`[prog-kb] No matching vendor folders under ${MANUALS_DIR}${args.only ? ` (--only ${args.only})` : ""}.`);
    process.exit(1);
  }

  const lowYield = [];
  const summary = []; // { vendor, slug, docs, chunks }
  const perVendorLines = new Map(); // slug -> string[] jsonl lines
  let processedPdfs = 0;
  let sampleChunk = null;

  for (const vendor of vendors) {
    if (processedPdfs >= args.limit) break;
    const vendorDir = path.join(MANUALS_DIR, vendor);
    const slug = slugify(vendor);
    const pdfs = listPdfs(vendorDir);
    let vendorDocs = 0;
    let vendorChunks = 0;
    const lines = [];

    for (const pdfName of pdfs) {
      if (processedPdfs >= args.limit) break;
      processedPdfs += 1;
      const pdfPath = path.join(vendorDir, pdfName);
      const sourcePath = relSourcePath(pdfPath);
      const docTitle = pdfName.replace(/\.pdf$/i, "");

      let extracted;
      try {
        extracted = await extractPdf(pdfPath);
      } catch (err) {
        lowYield.push({ sourcePath, vendor: slug, reason: `parse-error: ${err?.message ?? err}`, pages: 0, chars: 0 });
        console.warn(`[prog-kb]   SKIP (parse-error) ${sourcePath}: ${err?.message ?? err}`);
        continue;
      }

      const totalChars = extracted.pages.reduce((n, p) => n + (p.text?.length ?? 0), 0);
      const pageCount = extracted.total || extracted.pages.length;
      const avgPerPage = pageCount ? totalChars / pageCount : 0;
      const scanned = totalChars < MIN_DOC_CHARS || (pageCount >= 5 && avgPerPage < MIN_AVG_CHARS_PER_PAGE);
      if (scanned) {
        // Likely a scanned/image-only or empty PDF — log + skip (OCR is a future hook).
        lowYield.push({
          sourcePath,
          vendor: slug,
          reason: `low-text-yield (likely scanned/image PDF): ${totalChars} chars over ${pageCount} pages`,
          pages: pageCount,
          chars: totalChars,
        });
        console.warn(`[prog-kb]   SKIP (low-yield) ${sourcePath}: ${totalChars} chars / ${pageCount} pages`);
        continue;
      }

      const docChunks = chunkDocument(extracted.pages);
      if (!docChunks.length) {
        lowYield.push({ sourcePath, vendor: slug, reason: "no chunks produced after extraction", pages: pageCount, chars: totalChars });
        console.warn(`[prog-kb]   SKIP (no-chunks) ${sourcePath}`);
        continue;
      }

      docChunks.forEach((c, chunkIndex) => {
        const obj = {
          id: makeChunkId(slug, sourcePath, c.page, chunkIndex),
          vendor: slug,
          docTitle,
          sourcePath,
          page: Number.isFinite(c.page) ? c.page : null,
          lang: detectLang(c.text),
          section: c.section ?? "",
          text: c.text,
          keywords: keywordsFromText(c.text),
        };
        lines.push(JSON.stringify(obj));
        if (!sampleChunk) sampleChunk = obj;
      });

      vendorDocs += 1;
      vendorChunks += docChunks.length;
      console.log(`[prog-kb]   ${sourcePath} -> ${pageCount} pages, ${docChunks.length} chunks`);
    }

    if (lines.length) perVendorLines.set(slug, lines);
    summary.push({ vendor, slug, docs: vendorDocs, chunks: vendorChunks });
  }

  // Uniqueness guard: ids must be unique across the whole run.
  const seen = new Set();
  for (const lines of perVendorLines.values()) {
    for (const line of lines) {
      const id = JSON.parse(line).id;
      if (seen.has(id)) throw new Error(`[prog-kb] Duplicate chunk id: ${id}`);
      seen.add(id);
    }
  }

  // ── Write (unless --dry) ──
  if (!args.dry) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const [slug, lines] of perVendorLines) {
      const dir = path.join(OUT_DIR, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "chunks.jsonl"), lines.join("\n") + "\n", "utf8");
    }
    const manifest = rebuildManifest(args.stamp);
    if (lowYield.length) manifest.lowYield = lowYield;
    fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  }

  // ── Summary table ──
  const totalDocs = summary.reduce((n, s) => n + s.docs, 0);
  const totalChunks = summary.reduce((n, s) => n + s.chunks, 0);
  console.log("\n[prog-kb] ── Summary ─────────────────────────────");
  console.log(`[prog-kb] ${"VENDOR".padEnd(22)} ${"DOCS".padStart(5)} ${"CHUNKS".padStart(7)}`);
  for (const s of summary) {
    console.log(`[prog-kb] ${s.vendor.padEnd(22)} ${String(s.docs).padStart(5)} ${String(s.chunks).padStart(7)}`);
  }
  console.log(`[prog-kb] ${"TOTAL".padEnd(22)} ${String(totalDocs).padStart(5)} ${String(totalChunks).padStart(7)}`);
  if (lowYield.length) {
    console.log(`\n[prog-kb] lowYield (${lowYield.length} skipped):`);
    for (const ly of lowYield) console.log(`[prog-kb]   - ${ly.sourcePath}: ${ly.reason}`);
  }
  console.log(
    `\n[prog-kb] ${args.dry ? "DRY-RUN (nothing written)" : `Wrote ${perVendorLines.size} collection(s) + manifest.json`} to ${path.relative(ROOT, OUT_DIR)}`,
  );

  if (args.dry && sampleChunk) {
    console.log("\n[prog-kb] Sample chunk:");
    console.log(JSON.stringify(sampleChunk, null, 2));
  }
}

run().catch((err) => {
  console.error("[prog-kb] Ingestion failed:", err?.stack ?? err);
  process.exit(1);
});
