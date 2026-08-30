export type TranscriptTurn = { speaker: string; message: string; isAgent: boolean };

const AGENT_HINTS = ["agent", "assistant", "bot", "ai", "system"];

function isAgentSpeaker(speaker: string) {
  const normalized = speaker.toLowerCase();
  return AGENT_HINTS.some((hint) => normalized.includes(hint));
}

// Both the mock and real inbound-webhook paths flatten a transcript to
// "speaker: message" lines, one turn per line (see
// convex/lib/mockConversations.ts::mockTranscriptText and
// convex/http.ts::transcriptText) — parse that back into turns for a
// readable chat view. Falls back to undefined (render as plain text) if any
// line doesn't fit the pattern, so an unstructured transcript never renders
// as a broken chat.
export function parseTranscript(text: string): TranscriptTurn[] | undefined {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return undefined;
  const turns: TranscriptTurn[] = [];
  for (const line of lines) {
    const match = line.match(/^([A-Za-z][\w' -]{0,28}):\s*(.+)$/);
    if (!match) return undefined;
    const [, speaker, message] = match;
    turns.push({ speaker, message, isAgent: isAgentSpeaker(speaker) });
  }
  return turns;
}
