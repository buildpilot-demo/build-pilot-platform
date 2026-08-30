import { motion, useReducedMotion } from "framer-motion";
import { formatDate, shortenId } from "../lib/format";
import { TranscriptView } from "./TranscriptView";
import { StatusBadge } from "./StatusBadge";
import type { ProjectDetails } from "../lib/types";

// Combines the voice-session metadata and its transcript into one panel
// (previously two separate side-by-side panels, which left a ragged empty
// column whenever the transcript was much taller than the call metadata).
export function DiscoveryCallPanel({
  voiceSession,
  transcript,
}: {
  voiceSession?: ProjectDetails["voiceSession"];
  transcript?: ProjectDetails["transcript"];
}) {
  const reduceMotion = useReducedMotion();
  if (!voiceSession && !transcript) return null;

  return (
    <motion.section
      className="panel"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="panel__header">
        <div><p className="eyebrow">Discovery call</p><h2>Voice session</h2></div>
        <div className="timeline__heading-meta">
          {transcript?.language && <span className="identifier">{transcript.language}</span>}
          {voiceSession && <StatusBadge state={voiceSession.status} />}
        </div>
      </div>
      {voiceSession && (
        <div className="timeline__meta panel__meta-row">
          {voiceSession.conversationId && <span className="identifier" title={voiceSession.conversationId}>conversation {shortenId(voiceSession.conversationId)}</span>}
          {voiceSession.twilioCallSid && <span className="identifier" title={voiceSession.twilioCallSid}>twilio {shortenId(voiceSession.twilioCallSid)}</span>}
          {voiceSession.startedAt && <span>Started {formatDate(voiceSession.startedAt)}</span>}
          {voiceSession.completedAt && <span>Completed {formatDate(voiceSession.completedAt)}</span>}
        </div>
      )}
      {transcript ? (
        <TranscriptView text={transcript.text} />
      ) : (
        <p className="panel__meta-row muted">Transcript not available yet.</p>
      )}
    </motion.section>
  );
}
