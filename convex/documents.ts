// convex/documents.ts
//
// Stage 5 (Person C), T4.1 — Phase 6 (Document Generation). Triggered by
// convex/requirements.ts's T3.3 (`extractRequirements`) via
// `ctx.scheduler.runAfter(0, internal.documents.generateDocuments, { projectId })`
// once requirements are validated and the project reaches
// REQUIREMENTS_VALIDATED (PRD Section 4.6 requirement 5 / docs/task-plan.md
// T3.3).
//
// Document generation here is deliberately deterministic templating (no
// external provider call) — the validated `requirements.data` already has
// everything the docs need, and a hackathon-safe pipeline shouldn't add a
// third-party dependency (and a failure/retry mode) to a step that doesn't
// need one. `BUILD_SPEC.md`'s structure is this file's own contract with
// Devin (docs/task-plan.md T0.8: "you own both ends of this format —
// generation here, and consumption in T4.4/T4.7"): plain markdown with a
// fixed, stable set of `##`/`###` section headers and a `- key: value`
// metadata block Devin (and any future automated parser) can read
// line-by-line without needing a real markdown parser. Do not rename or
// reorder the sections in `buildBuildSpec` below without updating T4.7's
// prompt to Devin to match.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { registerStageAction } from "./lib/externalCall";
import { transitionProject } from "./stateMachine";
import type { NormalizedRequirements } from "./requirements";

const STAGE = "DOCUMENT_GENERATION";
const GENERATOR_VERSION = "v1";

/** The four document types this stage always produces, and the repo-relative path each is pushed to (Section 4.6/Phase 6). */
const DOCUMENT_SPECS: { type: Doc<"generatedDocuments">["type"]; path: string }[] = [
  { type: "README", path: "README.md" },
  { type: "BUILD_SPEC", path: "BUILD_SPEC.md" },
  { type: "REQUIREMENTS", path: "REQUIREMENTS.md" },
  { type: "UI_GUIDELINES", path: "UI_GUIDELINES.md" },
];

// ---------------------------------------------------------------------------
// generateDocuments — the frozen scheduler target this file publishes.
// ---------------------------------------------------------------------------

export const generateDocuments = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<void> => {
    const context = await ctx.runQuery(internal.documents.loadGenerationContext, { projectId });
    if (!context) {
      throw new Error(`generateDocuments: project ${projectId} not found`);
    }
    const { project, requirements } = context;

    if (!requirements || !requirements.data || requirements.status !== "VALIDATED") {
      // convex/requirements.ts only schedules this action once a
      // requirementVersion has been VALIDATED (its Requirement 3/5), so
      // this means something upstream is wrong — not a business-as-usual
      // failure mode, so this is a plain thrown error rather than a
      // state-machine transition (mirrors extractRequirements's own
      // "no transcript stored yet" guard).
      throw new Error(
        `generateDocuments: project ${projectId} has no VALIDATED requirements to generate documents from`,
      );
    }

    // Requirement 4 (entry): REQUIREMENTS_VALIDATED -> DOCUMENTS_GENERATING.
    // Guarded so a rescheduled/replayed run that's already past this point
    // doesn't hit an illegal transition.
    if (project.state === "REQUIREMENTS_VALIDATED") {
      await ctx.runMutation(internal.documents.beginGenerating, {
        projectId,
        correlationId: project.correlationId,
      });
    }

    const docs = DOCUMENT_SPECS.map(({ type, path }) => ({
      type,
      path,
      content: renderDocument(type, requirements.data as NormalizedRequirements, project),
    }));

    // Requirement 3/4: store the docs and transition
    // DOCUMENTS_GENERATING -> DOCUMENTS_READY.
    await ctx.runMutation(internal.documents.storeDocumentsAndAdvance, {
      projectId,
      correlationId: project.correlationId,
      requirementVersionId: requirements.validatedVersionId,
      docs,
    });

    // Requirement 5: fire-and-forget schedule of Person C's own T4.2 (Stage
    // 5) asset collection — no live coordination needed, same pattern as
    // T3.3 scheduling this action. T4.2's `collectAssets` itself always
    // hands off to T4.4's repository preparation once it's done (Phase 7 is
    // not a hard blocker — see convex/assets.ts).
    await ctx.scheduler.runAfter(0, internal.assets.collectAssets, { projectId });
  },
});

// Registers this action so the Admin UI's "Replay Last Response" button
// can re-invoke it for a project stalled at DOCUMENT_GENERATION.
registerStageAction(STAGE, internal.documents.generateDocuments);

// ---------------------------------------------------------------------------
// Internal query/mutations backing generateDocuments.
// ---------------------------------------------------------------------------

export const loadGenerationContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) {
      return null;
    }
    const requirements = await ctx.db
      .query("requirements")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();

    return { project, requirements };
  },
});

export const beginGenerating = internalMutation({
  args: { projectId: v.id("projects"), correlationId: v.string() },
  handler: async (ctx, { projectId, correlationId }) => {
    await transitionProject(ctx, projectId, "DOCUMENTS_GENERATING", {
      correlationId,
      stage: STAGE,
    });
  },
});

const documentTypeValidator = v.union(
  v.literal("README"),
  v.literal("BUILD_SPEC"),
  v.literal("REQUIREMENTS"),
  v.literal("UI_GUIDELINES"),
);

export const storeDocumentsAndAdvance = internalMutation({
  args: {
    projectId: v.id("projects"),
    correlationId: v.string(),
    requirementVersionId: v.optional(v.id("requirementVersions")),
    docs: v.array(v.object({ type: documentTypeValidator, path: v.string(), content: v.string() })),
  },
  handler: async (ctx, { projectId, correlationId, requirementVersionId, docs }) => {
    const now = Date.now();
    for (const doc of docs) {
      // Upsert by (projectId, type) so a replayed/regenerated run overwrites
      // the previous version of each document instead of accumulating
      // duplicate rows.
      const existing = await ctx.db
        .query("generatedDocuments")
        .withIndex("by_projectId_and_type", (q) => q.eq("projectId", projectId).eq("type", doc.type))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          path: doc.path,
          content: doc.content,
          requirementVersionId,
          generatorVersion: GENERATOR_VERSION,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("generatedDocuments", {
          projectId,
          type: doc.type,
          path: doc.path,
          content: doc.content,
          requirementVersionId,
          generatorVersion: GENERATOR_VERSION,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Requirement 4: DOCUMENTS_GENERATING -> DOCUMENTS_READY.
    await transitionProject(ctx, projectId, "DOCUMENTS_READY", { correlationId, stage: STAGE });
  },
});

// ---------------------------------------------------------------------------
// Deterministic templating — requirements.data -> markdown document content.
// ---------------------------------------------------------------------------

type GeneratedDocumentType = Doc<"generatedDocuments">["type"];

function renderDocument(
  type: GeneratedDocumentType,
  data: NormalizedRequirements,
  project: Doc<"projects">,
): string {
  switch (type) {
    case "README":
      return buildReadme(data, project);
    case "BUILD_SPEC":
      return buildBuildSpec(data, project);
    case "REQUIREMENTS":
      return buildRequirementsDoc(data);
    case "UI_GUIDELINES":
      return buildUiGuidelines(data);
  }
}

function listOrNone(items: string[] | undefined): string {
  return items && items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- (none provided)";
}

function buildReadme(data: NormalizedRequirements, project: Doc<"projects">): string {
  return `# ${data.businessName}

${data.purpose ?? "A website generated by BuildPilot for this business."}

## About

${data.purpose ?? "Purpose not captured during the discovery call — see REQUIREMENTS.md for what was gathered."}

## Services

${listOrNone(data.services)}

## Pages

${data.pages.map((page) => `- ${page.name}${page.description ? ` — ${page.description}` : ""}`).join("\n")}

## Contact

${data.contactDetails?.phone ? `- Phone: ${data.contactDetails.phone}\n` : ""}${
    data.contactDetails?.email ? `- Email: ${data.contactDetails.email}\n` : ""
  }${data.contactDetails?.address ? `- Address: ${data.contactDetails.address}\n` : ""}${
    !data.contactDetails?.phone && !data.contactDetails?.email && !data.contactDetails?.address
      ? "- (not provided)\n"
      : ""
  }
---
Generated by BuildPilot. Project reference: \`${project._id}\` / correlation \`${project.correlationId}\`.
`;
}

/**
 * BUILD_SPEC.md — the document Devin actually reads to implement the site
 * (docs/task-plan.md T4.7). Structure is frozen: a `## Metadata` block of
 * `- key: value` lines Devin/any script can parse without a markdown
 * parser, followed by fixed `##` sections in this exact order. Extend by
 * adding new sections at the end, never by renaming/reordering existing
 * ones (T4.7's prompt to Devin references these headers by name).
 */
function buildBuildSpec(data: NormalizedRequirements, project: Doc<"projects">): string {
  const primaryColor = data.branding?.primaryColor ?? "not specified — use a neutral, professional default";
  const secondaryColor = data.branding?.secondaryColor ?? "not specified — use a neutral, professional default";
  const fonts = data.branding?.fonts && data.branding.fonts.length > 0 ? data.branding.fonts.join(", ") : "not specified — use a clean, readable system/web-safe font";

  return `# BUILD_SPEC

## Metadata
- projectId: ${project._id}
- correlationId: ${project.correlationId}
- businessName: ${data.businessName}
- generatorVersion: ${GENERATOR_VERSION}

## Overview

Build a production-ready marketing/informational website for **${data.businessName}** on top of the existing starter template (React + TypeScript + Vite + Convex + Firebase Hosting). Do not regenerate the template's boilerplate (routing, build config, error boundary, health-check route) — only add the business-specific pages, content, and styling described below.

${data.purpose ? `Purpose: ${data.purpose}` : "Purpose was not captured during the discovery call — infer a reasonable, generic purpose consistent with the business name and services below, and do not invent specific facts not listed here."}

## Target Users

${listOrNone(data.targetUsers)}

## Services

${listOrNone(data.services)}

## Pages

Implement exactly these pages/routes (add a simple nav linking all of them):

${data.pages.map((page) => `### ${page.name}\n${page.description ?? "(no additional description provided — keep content generic and consistent with the Overview and Services above.)"}`).join("\n\n")}

## Primary Call To Action

- Label: ${data.cta.label}
- Type: ${data.cta.type ?? "not specified"}
- Target: ${data.cta.target ?? "not specified — link to the most relevant contact method/page"}

This CTA must be visible on every page (e.g. in the header or a persistent button).

## Branding

- Primary color: ${primaryColor}
- Secondary color: ${secondaryColor}
- Fonts: ${fonts}

## Contact Details

${data.contactDetails?.phone ? `- Phone: ${data.contactDetails.phone}\n` : ""}${
    data.contactDetails?.email ? `- Email: ${data.contactDetails.email}\n` : ""
  }${data.contactDetails?.address ? `- Address: ${data.contactDetails.address}\n` : ""}${
    !data.contactDetails?.phone && !data.contactDetails?.email && !data.contactDetails?.address
      ? "- Not provided — omit a specific contact method rather than inventing one; keep the CTA generic.\n"
      : ""
  }
## Acceptance Criteria

- \`npm run build\` exits 0.
- Every page listed above exists and is reachable from the nav.
- The primary CTA (above) is present and functional on every page.
- No placeholder/lorem-ipsum content in the final commit — use the business-specific details above; where a detail was not provided, keep that section generic rather than inventing specifics.
- No secrets or credentials committed.

## Out of Scope

- Do not modify build tooling, CI workflows, or Firebase Hosting configuration.
- Do not add pages/routes beyond those listed above.
`;
}

function buildRequirementsDoc(data: NormalizedRequirements): string {
  return `# REQUIREMENTS

This document is the validated, structured extraction of the business discovery call for **${data.businessName}**. It is the source of truth BUILD_SPEC.md was generated from — refer back to it for anything BUILD_SPEC.md doesn't cover.

## Business Name

${data.businessName}

## Purpose

${data.purpose ?? "(not provided)"}

## Services

${listOrNone(data.services)}

## Target Users

${listOrNone(data.targetUsers)}

## Pages

${data.pages.map((page) => `- **${page.name}**${page.description ? `: ${page.description}` : ""}`).join("\n")}

## Branding

- Primary color: ${data.branding?.primaryColor ?? "(not provided)"}
- Secondary color: ${data.branding?.secondaryColor ?? "(not provided)"}
- Fonts: ${data.branding?.fonts && data.branding.fonts.length > 0 ? data.branding.fonts.join(", ") : "(not provided)"}

## Call To Action

- Label: ${data.cta.label}
- Type: ${data.cta.type ?? "(not provided)"}
- Target: ${data.cta.target ?? "(not provided)"}

## Contact Details

- Phone: ${data.contactDetails?.phone ?? "(not provided)"}
- Email: ${data.contactDetails?.email ?? "(not provided)"}
- Address: ${data.contactDetails?.address ?? "(not provided)"}
`;
}

function buildUiGuidelines(data: NormalizedRequirements): string {
  const primaryColor = data.branding?.primaryColor ?? "#1F2937 (neutral slate — no brand color provided)";
  const secondaryColor = data.branding?.secondaryColor ?? "#F3F4F6 (neutral light gray — no brand color provided)";
  const fonts = data.branding?.fonts && data.branding.fonts.length > 0 ? data.branding.fonts.join(", ") : "System UI default (no brand fonts provided)";

  return `# UI_GUIDELINES

Visual direction for **${data.businessName}**'s site. Where the discovery call didn't specify a detail, a safe, professional default is given instead — treat those as suggestions, not invented facts about the business.

## Color Palette

- Primary: ${primaryColor}
- Secondary: ${secondaryColor}

## Typography

- Fonts: ${fonts}
- Keep headings and body copy legible; avoid decorative fonts for body text.

## Tone

${data.purpose ? `Match the tone implied by the business's purpose: "${data.purpose}".` : "No purpose was captured — default to a clean, professional, approachable tone suitable for a small/local business."}

## Layout Principles

- Consistent header/nav across all pages (see REQUIREMENTS.md / BUILD_SPEC.md for the page list).
- The primary CTA ("${data.cta.label}") should be visually prominent (e.g. a button in the header and on relevant page sections).
- Mobile-responsive layout.
- Avoid placeholder imagery/text in the shipped build — prefer simple, clean layouts over unverified stock content.
`;
}
