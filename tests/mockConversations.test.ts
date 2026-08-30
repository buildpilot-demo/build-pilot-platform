import { describe, expect, it } from "vitest";
import { mockTranscriptText, selectMockConversation } from "../convex/lib/mockConversations.js";

describe("selectMockConversation", () => {
  it("returns a conversation matching the business category when one exists", () => {
    const conversation = selectMockConversation("seed-1", "restaurant");
    expect(conversation.businessCategory).toBe("restaurant");
  });

  it("matches via keywords when the category isn't an exact match", () => {
    const conversation = selectMockConversation("seed-2", "hair salon");
    expect(conversation.industry).toBe("Hair & Beauty Salon");
  });

  it("falls back to the full pool when no category matches", () => {
    const conversation = selectMockConversation("seed-3", "unknown-category");
    expect(conversation).toBeDefined();
    expect(conversation.transcript.length).toBeGreaterThan(0);
  });

  it("randomly selects across the whole pool over repeated calls", () => {
    const seenIds = new Set<string>();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      seenIds.add(selectMockConversation("same-seed", "unknown-category").id);
    }
    expect(seenIds.size).toBeGreaterThan(1);
  });

  it("substitutes the real business name into the businessName field and transcript dialogue", () => {
    const conversation = selectMockConversation("seed-5", "restaurant", "Siena Restaurant Dubai");
    expect(conversation.businessName).toBe("Siena Restaurant Dubai");
    const text = mockTranscriptText(conversation);
    expect(text).toContain("Siena Restaurant Dubai");
    expect(text).not.toContain("{{businessName}}");
  });
});

describe("mockTranscriptText", () => {
  it("renders each turn as 'role: message' joined by newlines", () => {
    const conversation = selectMockConversation("seed-4", "plumber");
    const text = mockTranscriptText(conversation);
    expect(text).toContain("agent:");
    expect(text).toContain("user:");
    expect(text.split("\n").length).toBe(conversation.transcript.length);
  });
});
