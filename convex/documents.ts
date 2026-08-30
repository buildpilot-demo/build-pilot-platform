import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v, type GenericId } from "convex/values";

import { transitionProject, type StateMachineContext } from "./stateMachine.js";
import { buildSiteConfig3dContent } from "./lib/siteConfig3d.js";
import type { ExternalCallContext } from "./lib/externalCall.js";

type ProjectId = GenericId<"projects">;

type DocumentContext = {
  projectId: ProjectId;
  workflowRunId: GenericId<"workflowRuns">;
  requirementVersionId: GenericId<"requirementVersions">;
  correlationId: string;
  projectName: string;
  requirements: unknown;
  // Free-text lead-search category (businesses.category, e.g. "vegan
  // restaurants", "coffee shops") — used to select which asset collection
  // (public/assets/{collection} in the starter template) this site's
  // cinematic hero/products section draws from. See lib/siteConfig3d.ts.
  businessCategory: string;
};

const loadContextRef = makeFunctionReference<"query">("documents:loadDocumentContext");
const beginRef = makeFunctionReference<"mutation">("documents:beginDocumentGeneration");
const persistRef = makeFunctionReference<"mutation">("documents:persistDocuments");
const failRef = makeFunctionReference<"mutation">("documents:failDocumentGeneration");
const prepareRepositoryRef = makeFunctionReference<"action">("github:prepareRepository");

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).filter(Boolean)
    : [];
}

// Builds src/site.config.ts's single, typed, machine-readable object — see
// buildpilot-starter-template's src/types/site-config.ts for the
// discriminated-union SiteConfig shape this must conform to (docs/
// DEVIN_3D_WEBSITE_SPEC.md). Business identity/contact fields are copied
// straight from the validated requirements; everything creative (hero
// copy, palette, highlight/product descriptions) comes from
// buildSiteConfig3dContent's LLM call, which itself decides — based on
// whether businessCategory maps to a real asset collection — whether this
// project gets the cinematic (frame-animated, image-backed) variant or the
// plain (text-only) variant. See resolveAssetCollection in
// lib/siteConfig3d.ts: a category with no matching collection produces the
// plain variant rather than reusing an unrelated collection's imagery.
async function buildSiteConfig(ctx: ExternalCallContext, context: DocumentContext): Promise<Record<string, unknown>> {
  const requirements = record(context.requirements);
  const contact = record(requirements.contact);
  const branding = record(requirements.branding);
  const businessName = text(requirements.businessName, context.projectName);
  const purpose = text(requirements.businessPurpose, `A customer website for ${businessName}.`);
  const services = list(requirements.services);
  const targetAudience = optionalText(requirements.targetAudience);
  const tone = text(branding.tone, "professional, clear, and welcoming");
  const style = optionalText(branding.style);
  const additionalNotes = list(requirements.additionalNotes);

  const content = await buildSiteConfig3dContent(ctx, {
    projectId: context.projectId,
    correlationId: context.correlationId,
    requirementVersionId: context.requirementVersionId,
    businessCategory: context.businessCategory,
    business: { businessName, purpose, services, targetAudience, tone, style, additionalNotes },
  });

  const base = {
    businessName,
    purpose,
    ...(targetAudience ? { targetAudience } : {}),
    contact: {
      ...(optionalText(contact.phone) ? { phone: optionalText(contact.phone) } : {}),
      ...(optionalText(contact.email) ? { email: optionalText(contact.email) } : {}),
      ...(optionalText(contact.address) ? { address: optionalText(contact.address) } : {}),
    },
    palette: content.palette,
    enquirySection: {
      id: "enquiry",
      eyebrow: content.enquirySection.eyebrow,
      heading: content.enquirySection.heading,
      body: content.enquirySection.body,
      submitLabel: "Send enquiry",
      enquiryTypes: content.enquirySection.enquiryTypes,
      disconnectedMessage: "Form submission is not connected yet.",
      consentLabel: content.enquirySection.consentLabel,
    },
  };

  if (content.variant === "plain") {
    return {
      variant: "plain",
      ...base,
      navigation: [
        { label: "Highlights", href: "#highlights" },
        { label: "Enquire", href: "#enquiry" },
      ],
      hero: {
        eyebrow: content.hero.eyebrow,
        heading: content.hero.heading,
        body: content.hero.body,
        primaryCta: { label: content.hero.primaryCtaLabel, href: "#enquiry" },
        secondaryCta: { label: content.hero.secondaryCtaLabel, href: "#highlights" },
      },
      highlightsSection: {
        id: "highlights",
        eyebrow: content.highlightsSection.eyebrow,
        heading: content.highlightsSection.heading,
        body: content.highlightsSection.body,
        items: content.highlightsSection.items,
      },
    };
  }

  return {
    variant: "cinematic",
    ...base,
    navigation: [
      { label: "Highlights", href: "#products" },
      { label: "Enquire", href: "#enquiry" },
    ],
    assets: {
      collection: content.assetCollection,
      root: content.assets.root,
      framesDirectory: content.assets.framesDirectory,
      productsDirectory: content.assets.productsDirectory,
    },
    hero: {
      directory: content.assets.framesDirectory,
      poster: `${content.assets.framesDirectory}/${content.hero_technical.filePrefix}${String(content.hero_technical.firstFrame).padStart(content.hero_technical.framePadding, "0")}.${content.hero_technical.fileExtension}`,
      filePrefix: content.hero_technical.filePrefix,
      fileExtension: content.hero_technical.fileExtension,
      framePadding: content.hero_technical.framePadding,
      firstFrame: content.hero_technical.firstFrame,
      frameCount: content.hero_technical.frameCount,
      width: content.hero_technical.width,
      height: content.hero_technical.height,
      scrollHeightVh: content.hero_technical.scrollHeightVh,
      maxDevicePixelRatio: content.hero_technical.maxDevicePixelRatio,
      maxCachedFrames: content.hero_technical.maxCachedFrames,
      loadConcurrency: content.hero_technical.loadConcurrency,
      narrowViewportBreakpoint: content.hero_technical.narrowViewportBreakpoint,
      focalPoint: content.hero_technical.focalPoint,
      chapters: [
        { id: "opening", from: 0, to: 0.24, align: "left", showScrollCue: true, ...content.hero.chapters[0] },
        { id: "mid", from: 0.34, to: 0.6, align: "right", ...content.hero.chapters[1] },
        {
          id: "closing",
          from: 0.72,
          to: 1,
          align: "left",
          ...content.hero.chapters[2],
          primaryCta: { label: content.hero.primaryCtaLabel, href: "#enquiry" },
          secondaryCta: { label: content.hero.secondaryCtaLabel, href: "#products" },
        },
      ],
    },
    productsSection: {
      id: "products",
      eyebrow: content.productsSection.eyebrow,
      heading: content.productsSection.heading,
      body: content.productsSection.body,
      scrollHeightVh: content.productsScrollHeightVh,
      items: content.productsSection.items,
    },
  };
}

async function renderDocuments(ctx: ExternalCallContext, context: DocumentContext) {
  const businessName = text(record(context.requirements).businessName, context.projectName);
  const siteConfig = await buildSiteConfig(ctx, context);

  return [
    {
      type: "site_config" as const,
      path: "src/site.config.ts",
      content: `// Generated by BuildPilot from the validated call transcript for ${businessName}.\n// Do not hand-edit business data here across rebuilds — update the source\n// requirements and regenerate instead. See src/types/site-config.ts (starter\n// template) for the full SiteConfig shape (cinematic or plain variant) and\n// docs/DEVIN_3D_WEBSITE_SPEC.md for how each field is used.\nimport type { SiteConfig } from "./types/site-config";\n\nexport const siteConfig: SiteConfig = ${JSON.stringify(siteConfig, null, 2)} satisfies SiteConfig;\n`,
    },
  ];
}

async function checksum(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const loadDocumentContext = internalQueryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<DocumentContext> => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);
    if (!project.workflowRunId) throw new Error(`Project ${args.projectId} has no workflow run`);
    const requirement = await ctx.db
      .query("requirements")
      .withIndex("by_project_id", (query) => query.eq("projectId", args.projectId))
      .filter((query) => query.eq(query.field("status"), "valid"))
      .order("desc")
      .first();
    if (!requirement?.currentVersionId) throw new Error(`Project ${args.projectId} has no validated requirement version`);
    const version = await ctx.db.get("requirementVersions", requirement.currentVersionId);
    if (!version || version.validationStatus !== "valid") throw new Error("Current requirement version is not valid");
    const business = await ctx.db.get("businesses", project.businessId);
    return {
      projectId: args.projectId,
      workflowRunId: project.workflowRunId,
      requirementVersionId: version._id,
      correlationId: project.correlationId,
      projectName: project.name ?? `Project ${args.projectId}`,
      requirements: version.structuredData,
      businessCategory: business?.category ?? "",
    };
  },
});

export const beginDocumentGeneration = internalMutationGeneric({
  args: { projectId: v.id("projects"), workflowRunId: v.id("workflowRuns"), correlationId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);
    if (project.state === "REQUIREMENTS_VALIDATED") {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "DOCUMENTS_GENERATING", {
        workflowRunId: args.workflowRunId,
        correlationId: args.correlationId,
        stage: "DOCUMENT_GENERATION",
      });
    } else if (project.state !== "DOCUMENTS_GENERATING" && project.state !== "DOCUMENTS_READY") {
      throw new Error(`Cannot generate documents while project is ${project.state}`);
    }
    return null;
  },
});

export const persistDocuments = internalMutationGeneric({
  args: {
    projectId: v.id("projects"),
    workflowRunId: v.id("workflowRuns"),
    requirementVersionId: v.id("requirementVersions"),
    correlationId: v.string(),
    documents: v.array(v.object({
      type: v.literal("site_config"),
      path: v.string(),
      content: v.string(),
      checksum: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const document of args.documents) {
      const previous = await ctx.db
        .query("generatedDocuments")
        .withIndex("by_project_path", (query) => query.eq("projectId", args.projectId))
        .filter((query) => query.eq(query.field("path"), document.path))
        .order("desc")
        .first();
      if (previous?.checksum === document.checksum && previous.requirementVersionId === args.requirementVersionId) continue;
      await ctx.db.insert("generatedDocuments", {
        projectId: args.projectId,
        workflowRunId: args.workflowRunId,
        requirementVersionId: args.requirementVersionId,
        ...document,
        version: (previous?.version ?? 0) + 1,
        createdAt: now,
      });
    }
    const project = await ctx.db.get("projects", args.projectId);
    if (project?.state === "DOCUMENTS_GENERATING") {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "DOCUMENTS_READY", {
        workflowRunId: args.workflowRunId,
        correlationId: args.correlationId,
        stage: "DOCUMENT_GENERATION",
      });
    }
    return null;
  },
});

export const failDocumentGeneration = internalMutationGeneric({
  args: { projectId: v.id("projects"), workflowRunId: v.id("workflowRuns"), correlationId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (project?.state === "DOCUMENTS_GENERATING") {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "DOCUMENT_GENERATION_FAILED", {
        workflowRunId: args.workflowRunId,
        correlationId: args.correlationId,
        stage: "DOCUMENT_GENERATION",
        failedStage: "DOCUMENT_GENERATION",
        errorCode: "DOCUMENT_GENERATION_FAILED",
        errorMessage: args.message,
        retryable: true,
        retryCount: 1,
        maxRetries: 3,
        provider: "internal",
        providerRequestId: args.correlationId,
      });
    }
    return null;
  },
});

// Internal: scheduled automatically once requirements are validated, never
// called by a client.
export const generateDocuments = internalActionGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(loadContextRef, args) as DocumentContext;
    await ctx.runMutation(beginRef, {
      projectId: args.projectId,
      workflowRunId: context.workflowRunId,
      correlationId: context.correlationId,
    });
    try {
      const rendered = await renderDocuments(ctx as unknown as ExternalCallContext, context);
      const documents = await Promise.all(rendered.map(async (document) => ({
        ...document,
        checksum: await checksum(document.content),
      })));
      await ctx.runMutation(persistRef, {
        projectId: args.projectId,
        workflowRunId: context.workflowRunId,
        requirementVersionId: context.requirementVersionId,
        correlationId: context.correlationId,
        documents,
      });
      await ctx.scheduler.runAfter(0, prepareRepositoryRef, { projectId: args.projectId });
      return { documents: documents.map(({ type, path, checksum: digest }) => ({ type, path, checksum: digest })) };
    } catch (error) {
      await ctx.runMutation(failRef, {
        projectId: args.projectId,
        workflowRunId: context.workflowRunId,
        correlationId: context.correlationId,
        message: error instanceof Error ? error.message : "Document generation failed",
      });
      throw error;
    }
  },
});
