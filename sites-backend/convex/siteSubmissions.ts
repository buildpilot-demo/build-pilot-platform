import { mutationGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";

// Public write path for every generated customer site's enquiry/contact
// form. Customer sites call this by function path ("siteSubmissions:submitInquiry")
// via makeFunctionReference rather than a generated api import, since they
// have no codegen against this schema — keep this function's name and args
// stable, since renaming it breaks already-built sites without a
// corresponding change on their side.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_NAME_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 5_000;
const MAX_CONTACT_FIELD_LENGTH = 320;

export const submitInquiry = mutationGeneric({
  args: {
    siteId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    enquiryType: v.optional(v.string()),
    message: v.string(),
    consentAccepted: v.boolean(),
    consentTextVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    const message = args.message.trim();
    const email = args.email?.trim() || undefined;
    const phone = args.phone?.trim() || undefined;

    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new ConvexError("Please provide a valid name.");
    }
    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      throw new ConvexError("Please provide a message.");
    }
    if (email && (email.length > MAX_CONTACT_FIELD_LENGTH || !EMAIL_PATTERN.test(email))) {
      throw new ConvexError("Please provide a valid email address.");
    }
    if (phone && phone.length > MAX_CONTACT_FIELD_LENGTH) {
      throw new ConvexError("Please provide a valid phone number.");
    }
    if (!args.consentAccepted) {
      throw new ConvexError("Please agree to be contacted so we can reply to your enquiry.");
    }

    const tenant = await ctx.db
      .query("siteTenants")
      .withIndex("by_site_id", (query) => query.eq("siteId", args.siteId.trim()))
      .first();
    if (!tenant || tenant.status !== "active") {
      throw new ConvexError("This site is not currently accepting submissions.");
    }

    const id = await ctx.db.insert("siteSubmissions", {
      siteTenantId: tenant._id,
      siteId: tenant.siteId,
      projectId: tenant.projectId,
      type: "contact",
      name,
      email,
      phone,
      enquiryType: args.enquiryType?.trim() || undefined,
      message,
      consentAccepted: args.consentAccepted,
      consentTextVersion: args.consentTextVersion,
      status: "accepted",
      createdAt: Date.now(),
    });

    return { id };
  },
});
