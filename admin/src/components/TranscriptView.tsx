import { parseTranscript } from "../lib/transcript";

export function TranscriptView({ text }: { text: string }) {
  const turns = parseTranscript(text);
  if (!turns) return <p className="transcript-text">{text}</p>;

  return (
    <div className="transcript">
      {turns.map((turn, index) => (
        <div key={index} className={`transcript__turn transcript__turn--${turn.isAgent ? "agent" : "user"}`}>
          <span className="transcript__avatar" aria-hidden="true">{turn.speaker.charAt(0).toUpperCase()}</span>
          <div className="transcript__bubble">
            <span className="transcript__speaker">{turn.speaker}</span>
            <p>{turn.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
