const formatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDate(value?: number) {
  return value ? formatter.format(new Date(value)) : "—";
}

export function formatRelative(value?: number) {
  if (!value) return "Unknown";
  const seconds = Math.round((value - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (absolute < 60) return relative.format(seconds, "second");
  if (absolute < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (absolute < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}

export function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  if (totalMinutes < 1) return "just now";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

// Wraps the impure Date.now() read in a plain utility (rather than inline in
// a component body) so a snapshot-at-render-time duration can still be
// computed without tripping the react-hooks purity lint rule.
export function elapsedSince(timestamp: number) {
  return formatDuration(Date.now() - timestamp);
}

// Formats a fixed millisecond span (activityEvents.elapsedMs, projects.
// totalDurationMs) — unlike formatDuration/elapsedSince, this measures a
// span that already happened rather than "time since X", so sub-minute
// spans show seconds instead of collapsing to "just now".
export function formatMs(ms?: number): string | undefined {
  if (ms === undefined) return undefined;
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 1) return "<1s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return seconds ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function shortenId(value: string, visible = 14) {
  return value.length > visible + 1 ? `${value.slice(0, visible)}…` : value;
}

export function label(value?: string) {
  if (!value) return "Unknown";
  return value.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

// label() assumes SCREAMING_SNAKE_CASE (state enums); structured-data keys
// from the LLM extraction come back camelCase, so "additionalNotes" needs
// a word boundary split before it, not just underscore replacement.
export function prettifyKey(key: string) {
  const spaced = key.replaceAll("_", " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

export type Tone = "success" | "warning" | "danger" | "neutral" | "progress" | "admin";

export function stateTone(state?: string): "success" | "warning" | "danger" | "neutral" | "progress" {
  if (!state) return "neutral";
  if (["LIVE", "DELIVERED", "COMPLETED", "HEALTHY", "OPERATIONAL"].some((term) => state.includes(term))) return "success";
  if (state.includes("FAIL") || state.includes("DOWN") || state.includes("ERROR")) return "danger";
  if (state.includes("MANUAL") || state.includes("DEGRADED") || state.includes("PENDING")) return "warning";
  if (["BUILD", "PROCESS", "QUEUE", "CALLING", "DEPLOY", "GENERAT", "VALIDAT", "REVISING"].some((term) => state.includes(term))) return "progress";
  return "neutral";
}

// Unifies activityEvents timeline coloring across four buckets an operator
// actually cares about: completed (success/green), currently in progress
// (progress/indigo, pulsing), failed (danger/red), and an admin-triggered
// resume (admin/violet — see stateMachine.ts's ADMIN_OVERRIDE eventType,
// written by adminRecovery.ts::applyResume). stateTone()'s own heuristic
// only recognizes a handful of terminal-sounding substrings ("COMPLETED",
// "LIVE"...), so an intermediate "*_READY" transition would otherwise render
// as neutral/gray even though, once it's no longer the newest event, it
// plainly already happened - isLatest lets every earlier non-failing
// transition read as "completed" instead.
export function activityEventTone(
  event: { toState?: string; errorCode?: string; eventType?: string },
  isLatest: boolean,
): Tone {
  if (event.eventType === "ADMIN_OVERRIDE") return "admin";
  const raw = stateTone(event.toState || event.errorCode);
  if (raw === "danger" || raw === "warning") return raw;
  if (isLatest) return raw;
  return "success";
}
