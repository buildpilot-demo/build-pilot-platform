import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ActivityEvent } from "../lib/types";
import { activityEventTone, formatDate, formatMs, label } from "../lib/format";
import { EmptyState } from "./Loading";

/**
 * Reverse-chronological (latest-first) activity feed for a single project's
 * detail view. Backed by useQuery(projectActivity) — purely reactive, no
 * polling or manual scroll management needed since new events simply appear
 * at the top.
 *
 * The most recent event is treated as "in progress" (pulsing marker + badge)
 * whenever it represents a live/queued/processing state rather than a
 * terminal success, failure, or manual-intervention state — reusing the
 * same stateTone() classification already driving the marker color, so a
 * step is only ever shown as active while the pipeline is actually still
 * working on it.
 */
export function LiveActivityFeed({ events }: { events?: ActivityEvent[] }) {
  const reduceMotion = useReducedMotion();
  const list = events ?? [];

  if (!list.length) {
    return <EmptyState title="No activity yet" body="Every state transition and provider call will stream into this timeline as it happens." />;
  }

  // events arrive oldest-first from projectActivity; render newest-first.
  const latestFirst = [...list].reverse();

  return (
    <ol className="timeline live-feed">
      <AnimatePresence initial={false}>
        {latestFirst.map((event, index) => {
          const isLatest = index === 0;
          const tone = activityEventTone(event, isLatest);
          const isActive = isLatest && tone === "progress";
          return (
            <motion.li
              key={event._id}
              layout
              className={`timeline__item${isActive ? " timeline__item--active" : ""}`}
              initial={reduceMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className={`timeline__marker timeline__marker--${tone}${isActive ? " timeline__marker--pulse" : ""}`} />
              <div className="timeline__content">
                <div className="timeline__heading">
                  <strong>{label(event.stage)}</strong>
                  <span className="timeline__heading-meta">
                    {isActive && <span className="timeline__active-badge">In progress…</span>}
                    <time>{formatDate(event.timestamp)}</time>
                    {/* elapsedMs is time since the *previous* step, not how
                        long this one has been running - showing it next to
                        "In progress…" would misread as the latter, so it's
                        withheld for the currently active step. */}
                    {!isActive && event.elapsedMs !== undefined && <span className="timeline__elapsed" title="Time since the previous step">+{formatMs(event.elapsedMs)}</span>}
                  </span>
                </div>
                <p>{event.fromState || event.toState ? `${event.fromState ? label(event.fromState) : "—"} → ${event.toState ? label(event.toState) : "—"}` : event.message || event.reason || "—"}</p>
                <div className="timeline__meta">
                  {event.provider && <span>{event.provider}</span>}
                  {event.errorCode && <span>{event.errorCode}</span>}
                  {event.correlationId && <span className="identifier">{event.correlationId}</span>}
                </div>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
