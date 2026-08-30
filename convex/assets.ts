// convex/assets.ts
//
// Stage 5 (Person C), T4.2 — Phase 7 (Asset Collection, docs/project-requirements.md
// Section 6) + Section 12 (Security Rules) for whatever media is already
// sitting around by the time documents are ready:
//
//   Convex → collects assets (discovery provider / WhatsApp media)
//   Convex → validates: MIME type from bytes, size limits, provenance, sanitizes filenames
//   Convex → stores binaries in Convex File Storage, metadata in `assets`
//   Convex → rejects: executable content, oversized files, unknown provenance
//
// Scheduled by convex/documents.ts's `generateDocuments` once a project
// reaches DOCUMENTS_READY. There is no ASSET_COLLECTION entry in Section 8's
// state machine — this stage is explicitly allowed to complete with zero
// assets (candidates found, none valid, or none found at all) and always
// hands off to convex/github.ts's `prepareRepository` (T4.4) regardless, per
// docs/task-plan.md T4.2 requirement 4. Any logo/hero/product imagery gap
// left here is filled later, after the repo exists, by T4.5b's licensed
// stock-image sourcing — this file never invents or substitutes imagery.
//
// Only two candidate sources exist at this point in the pipeline:
//   - CONTEXTDEV: image-looking URLs found inside `businesses.rawResponse`
//     (the stored Context.dev payload for this project's business).
//   - WHATSAPP_MEDIA: `mediaUrls` on any *inbound* `whatsappMessages` row
//     already stored for this project (in practice empty this early — real
//     WhatsApp media shows up during the Phase 12 revision loop — but the
//     task explicitly asks for "if present at this point", so it's checked
//     defensively rather than assumed empty).
// Nothing else is treated as a candidate: customer text/transcripts/media
// are untrusted input (Section 12), and this deliberately does NOT crawl a
// business's website or follow arbitrary links — every candidate must trace
// back to one of the two known origins above, or it's never fetched at all.
// That's what "reject unknown provenance" means in practice here: the
// origin allowlist itself, not a check run against already-fetched bytes.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const STAGE = "ASSET_COLLECTION";

/** Section 12 "size ... limits enforced" — generous enough for a logo/hero/product photo, small enough to bound storage + fetch time. */
const MAX_ASSET_BYTES = 8 * 1024 * 1024; // 8MB
const FETCH_TIMEOUT_MS = 10_000;
/** Hard cap on how many candidate URLs a single run will even attempt to fetch, so a pathological rawResponse/message history can't turn this into an unbounded fan-out of outbound requests. */
const MAX_CANDIDATES = 15;
const MAX_SCAN_DEPTH = 4;

const assetSourceValidator = v.union(
  v.literal("CONTEXTDEV"),
  v.literal("WHATSAPP_MEDIA"),
  v.literal("ADMIN_UPLOAD"),
  v.literal("GENERATED"),
);

// ---------------------------------------------------------------------------
// collectAssets — the frozen scheduler target this file publishes.
// ---------------------------------------------------------------------------

export const collectAssets = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<{ collected: number; rejected: number; candidateCount: number }> => {
    const context = await ctx.runQuery(internal.assets.loadCollectionContext, { projectId });
    if (!context) {
      throw new Error(`collectAssets: project ${projectId} not found`);
    }
    const { project, business, inboundMedia, existingChecksums } = context;

    const candidates = [
      ...extractContextDevCandidates(business),
      ...extractWhatsAppCandidates(inboundMedia),
    ].slice(0, MAX_CANDIDATES);

    const seenChecksums = new Set(existingChecksums);
    let collected = 0;
    let rejected = 0;

    for (const candidate of candidates) {
      const outcome = await fetchAndValidateAsset(candidate.url);

      if ("rejected" in outcome) {
        rejected++;
        await ctx.runMutation(internal.assets.logRejection, {
          projectId,
          correlationId: project.correlationId,
          source: candidate.source,
          url: candidate.url,
          reason: outcome.reason,
        });
        continue;
      }

      const checksum = await sha256Hex(outcome.bytes);
      if (seenChecksums.has(checksum)) {
        // Same bytes already collected for this project (either from an
        // earlier candidate in this run, or a previous run of this same
        // action) — skip rather than storing a duplicate binary.
        continue;
      }

      const storageId = await ctx.storage.store(
        new Blob([outcome.bytes as unknown as ArrayBuffer], { type: outcome.mime }),
        { sha256: checksum },
      );
      const filename = sanitizeFilename(candidate.url, outcome.ext, checksum);

      await ctx.runMutation(internal.assets.recordValidAsset, {
        projectId,
        source: candidate.source,
        storageId,
        filename,
        mimeType: outcome.mime,
        sizeBytes: outcome.bytes.byteLength,
        checksum,
        provenance: candidate.provenance,
      });

      seenChecksums.add(checksum);
      collected++;
    }

    await ctx.runMutation(internal.assets.recordCollectionSummary, {
      projectId,
      correlationId: project.correlationId,
      collected,
      rejected,
      candidateCount: candidates.length,
    });

    // T4.2 requirement 4: zero assets is not a hard blocker — always hand
    // off to repository preparation (T4.4).
    await ctx.scheduler.runAfter(0, internal.github.prepareRepository, { projectId });

    return { collected, rejected, candidateCount: candidates.length };
  },
});

// ---------------------------------------------------------------------------
// Internal query/mutations backing collectAssets.
// ---------------------------------------------------------------------------

export const loadCollectionContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) {
      return null;
    }
    const business = await ctx.db.get(project.businessId);
    const inboundMedia = await ctx.db
      .query("whatsappMessages")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    const existingAssets = await ctx.db
      .query("assets")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();

    return {
      project,
      business,
      inboundMedia,
      // Dedup guard so a re-run (e.g. an admin manually re-triggering this
      // stage) doesn't store the same bytes twice — Sets aren't a valid
      // Convex value, so this crosses the query/action boundary as an array.
      existingChecksums: existingAssets
        .map((a) => a.checksum)
        .filter((c): c is string => c !== undefined),
    };
  },
});

export const logRejection = internalMutation({
  args: {
    projectId: v.id("projects"),
    correlationId: v.string(),
    source: assetSourceValidator,
    url: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { projectId, correlationId, source, url, reason }) => {
    // Rejected candidates never touch File Storage (Section 12: "rejects
    // executable content or unknown provenance") — the `assets` table's
    // `storageId` is required, so there is deliberately no `assets` row for
    // these; the audit trail lives in `activityEvents` instead.
    await ctx.db.insert("activityEvents", {
      projectId,
      correlationId,
      eventType: "ASSET_REJECTED",
      stage: STAGE,
      metadata: { source, url, reason },
      createdAt: Date.now(),
    });
  },
});

export const recordValidAsset = internalMutation({
  args: {
    projectId: v.id("projects"),
    source: assetSourceValidator,
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    checksum: v.string(),
    provenance: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("assets", {
      ...args,
      status: "VALID",
      createdAt: Date.now(),
    });
  },
});

export const recordCollectionSummary = internalMutation({
  args: {
    projectId: v.id("projects"),
    correlationId: v.string(),
    collected: v.number(),
    rejected: v.number(),
    candidateCount: v.number(),
  },
  handler: async (ctx, { projectId, correlationId, collected, rejected, candidateCount }) => {
    await ctx.db.insert("activityEvents", {
      projectId,
      correlationId,
      eventType: "ASSET_COLLECTION_COMPLETED",
      stage: STAGE,
      metadata: { collected, rejected, candidateCount },
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Candidate discovery — known-origin allowlist only (see module doc comment
// for why this is what "reject unknown provenance" means here).
// ---------------------------------------------------------------------------

interface AssetCandidate {
  url: string;
  source: "CONTEXTDEV" | "WHATSAPP_MEDIA";
  provenance: string;
}

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|bmp)(?:[?#].*)?$/i;
const IMAGE_KEY_RE = /logo|image|img|photo|picture|thumbnail|banner|hero|avatar/i;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Recursively scans an arbitrary JSON-ish value (Context.dev's
 * `rawResponse` is stored as `v.any()`, so its exact shape isn't
 * guaranteed) for string fields that look like image URLs: either the key
 * path suggests it (`logo`, `image`, `photo`, ...) or the URL itself ends
 * in a known image extension. Bounded by `MAX_SCAN_DEPTH`/`MAX_CANDIDATES`
 * so a large or deeply-nested payload can't blow up this scan.
 */
function scanForImageUrls(
  value: unknown,
  path: string,
  out: { url: string; field: string }[],
  depth: number,
): void {
  if (depth > MAX_SCAN_DEPTH || out.length >= MAX_CANDIDATES) {
    return;
  }
  if (typeof value === "string") {
    if (isHttpUrl(value) && (IMAGE_EXTENSION_RE.test(value) || IMAGE_KEY_RE.test(path))) {
      out.push({ url: value, field: path || "root" });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => scanForImageUrls(item, path ? `${path}[${i}]` : `[${i}]`, out, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      scanForImageUrls(child, path ? `${path}.${key}` : key, out, depth + 1);
    }
  }
}

function extractContextDevCandidates(business: Doc<"businesses"> | null): AssetCandidate[] {
  if (!business?.rawResponse) {
    return [];
  }
  const found: { url: string; field: string }[] = [];
  scanForImageUrls(business.rawResponse, "", found, 0);
  return found.map(({ url, field }) => ({
    url,
    source: "CONTEXTDEV",
    provenance: `CONTEXTDEV:business:${business._id}:field:${field}`,
  }));
}

function extractWhatsAppCandidates(messages: Doc<"whatsappMessages">[]): AssetCandidate[] {
  const out: AssetCandidate[] = [];
  for (const message of messages) {
    if (message.direction !== "inbound" || !message.mediaUrls) {
      continue;
    }
    message.mediaUrls.forEach((url, i) => {
      if (isHttpUrl(url)) {
        out.push({
          url,
          source: "WHATSAPP_MEDIA",
          provenance: `WHATSAPP_MEDIA:message:${message.twilioMessageSid}:index:${i}`,
        });
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetch + validate — MIME-from-bytes, size limits, executable rejection
// (Section 12 / Phase 7).
// ---------------------------------------------------------------------------

interface FetchedAsset {
  bytes: Uint8Array;
  mime: string;
  ext: string;
}

interface RejectedAsset {
  rejected: true;
  reason: string;
}

/** Allowed content types — verified from magic bytes, never from a URL/extension/Content-Type header. Deliberately excludes SVG (script-capable) and any document/archive format. */
const MAGIC_SNIFFERS: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  {
    mime: "image/png",
    ext: "png",
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: "image/jpeg",
    ext: "jpg",
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/gif",
    ext: "gif",
    test: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  },
  {
    mime: "image/webp",
    ext: "webp",
    test: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    mime: "image/bmp",
    ext: "bmp",
    test: (b) => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d,
  },
];

/** Explicit reject list for common executable/script/archive container signatures — checked before (and instead of) the allowlist above, so these get a clear `EXECUTABLE_CONTENT_DETECTED` reason rather than a generic "unverified" one. */
const DANGEROUS_SIGNATURES: { label: string; test: (b: Uint8Array) => boolean }[] = [
  { label: "Windows PE/EXE (MZ header)", test: (b) => b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a },
  { label: "ELF executable", test: (b) => b.length >= 4 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46 },
  {
    label: "Mach-O executable",
    test: (b) =>
      b.length >= 4 &&
      ((b[0] === 0xfe && b[1] === 0xed && b[2] === 0xfa) || (b[0] === 0xcf && b[1] === 0xfa && b[2] === 0xed && b[3] === 0xfe)),
  },
  { label: "Shebang script", test: (b) => b.length >= 2 && b[0] === 0x23 && b[1] === 0x21 },
  {
    label: "ZIP-family archive (zip/jar/apk/docx/xlsx, ...)",
    test: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  },
];

async function fetchAndValidateAsset(url: string): Promise<FetchedAsset | RejectedAsset> {
  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return { rejected: true, reason: `FETCH_FAILED: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!response.ok) {
    return { rejected: true, reason: `FETCH_FAILED: HTTP ${response.status}` };
  }

  // Client-declared length is untrusted, but rejecting early on it avoids
  // downloading a body we already know is too big.
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_ASSET_BYTES) {
    return { rejected: true, reason: `OVERSIZED: declared ${declaredLength} bytes exceeds ${MAX_ASSET_BYTES}` };
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Real enforcement — a missing/incorrect Content-Length header can't be
  // used to smuggle an oversized file past the check above.
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    return { rejected: true, reason: `OVERSIZED: ${bytes.byteLength} bytes exceeds ${MAX_ASSET_BYTES}` };
  }
  if (bytes.byteLength === 0) {
    return { rejected: true, reason: "EMPTY_FILE" };
  }

  const dangerous = DANGEROUS_SIGNATURES.find((sig) => sig.test(bytes));
  if (dangerous) {
    return { rejected: true, reason: `EXECUTABLE_CONTENT_DETECTED: ${dangerous.label}` };
  }

  const sniffed = MAGIC_SNIFFERS.find((sniffer) => sniffer.test(bytes));
  if (!sniffed) {
    return { rejected: true, reason: "UNVERIFIED_MIME_TYPE: content bytes did not match any allowed image format" };
  }

  return { bytes, mime: sniffed.mime, ext: sniffed.ext };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Sanitized filename derived from the source URL's last path segment —
 * never trusts the URL's claimed extension (the extension is always the
 * one matching the sniffed MIME type), strips path-traversal/unsafe
 * characters, and appends a checksum-derived suffix so repeated candidates
 * with the same basename (e.g. every business using `logo.png`) can't
 * collide in storage.
 */
function sanitizeFilename(rawUrl: string, ext: string, checksum: string): string {
  let base = "asset";
  try {
    const lastSegment = new URL(rawUrl).pathname.split("/").filter(Boolean).pop();
    if (lastSegment) {
      base = lastSegment.replace(/\.[a-zA-Z0-9]+$/, "");
    }
  } catch {
    // Malformed URL somehow got this far — fall back to the default base.
  }

  const cleaned = base
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 48);

  const safeBase = cleaned.length > 0 ? cleaned : "asset";
  return `${safeBase}-${checksum.slice(0, 10)}.${ext}`;
}
