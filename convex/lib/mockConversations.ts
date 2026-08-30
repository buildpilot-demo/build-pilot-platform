import mockConversationsData from "../data/mockConversations.json" with { type: "json" };

// T-mock: sample ElevenLabs-style conversation transcripts used when
// ELEVENLABS_MOCK_CONVERSATION=Y (see voiceCalls.ts::startCall) so the rest
// of the pipeline can be exercised end-to-end without a live ElevenLabs/
// Twilio call. Data lives in convex/data/mockConversations.json.
export type MockTranscriptTurn = { role: "agent" | "user"; message: string };

export type MockConversation = {
  id: string;
  industry: string;
  businessCategory: string;
  keywords?: string[];
  businessName: string;
  ownerName?: string;
  language?: string;
  transcript: MockTranscriptTurn[];
};

const conversations: MockConversation[] = (
  mockConversationsData as { conversations: MockConversation[] }
).conversations;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const BUSINESS_NAME_PLACEHOLDER = "{{businessName}}";

// Fills in the {{businessName}} placeholder (in both the businessName field
// and the transcript dialogue) with the real, selected business's name, so
// the mock transcript - and everything downstream that reads it (requirement
// extraction, project.name, the generated site.config.ts) - refers to the
// actual business rather than the sample's hardcoded name.
function applyBusinessName(conversation: MockConversation, businessName: string): MockConversation {
  const trimmed = businessName.trim();
  if (!trimmed) return conversation;
  return {
    ...conversation,
    businessName: trimmed,
    transcript: conversation.transcript.map((turn) => ({
      ...turn,
      message: turn.message.split(BUSINESS_NAME_PLACEHOLDER).join(trimmed),
    })),
  };
}

export function selectMockConversation(
  seedKey: string,
  businessCategory?: string,
  businessName?: string,
): MockConversation {
  if (conversations.length === 0) {
    throw new Error("No mock conversations are configured in convex/data/mockConversations.json");
  }
  const category = businessCategory ? normalize(businessCategory) : undefined;
  const matches = category
    ? conversations.filter(
        (conversation) =>
          normalize(conversation.businessCategory) === category ||
          normalize(conversation.industry) === category ||
          (conversation.keywords ?? []).some(
            (keyword) => category.includes(normalize(keyword)) || normalize(keyword).includes(category),
          ),
      )
    : [];
  const pool = matches.length > 0 ? matches : conversations;
  // Randomly pick from the matching pool (rather than always the same/first
  // entry) so repeated mock calls exercise a variety of sample transcripts.
  // seedKey is kept for API compatibility with callers but no longer
  // determines the pick.
  void seedKey;
  const index = Math.floor(Math.random() * pool.length);
  const conversation = pool[index];
  return businessName ? applyBusinessName(conversation, businessName) : conversation;
}

export function mockTranscriptText(conversation: MockConversation): string {
  return conversation.transcript
    .map((turn) => `${turn.role}: ${turn.message}`)
    .join("\n");
}
