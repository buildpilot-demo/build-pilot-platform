import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ActivityEvent } from "../lib/types";
import { activityEventTone, formatDate, label } from "../lib/format";
import { EmptyState } from "./Loading";

// Events are already newest-first here (see admin:getDashboard's
// .order("desc")) — this spans many projects, so only the very latest
// event across all of them gets the pulsing "in progress" treatment.
export function ActivityTimeline({ events = [] }: { events?: ActivityEvent[] }) {
  const reduceMotion = useReducedMotion();
  if (!events.length) return <EmptyState title="No activity yet" body="Workflow transitions and provider events will stream into this timeline." />;
  return <ol className="timeline">
    <AnimatePresence initial={false}>
      {events.map((event, index) => {
        const tone = activityEventTone(event, index === 0);
        const isActive = index === 0 && tone === "progress";
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
                <strong>{event.message || label(event.eventType || event.stage)}</strong>
                <span className="timeline__heading-meta">
                  {isActive && <span className="timeline__active-badge">In progress…</span>}
                  <time>{formatDate(event.timestamp)}</time>
                </span>
              </div>
              <p>{event.fromState && event.toState ? `${label(event.fromState)} → ${label(event.toState)}` : event.reason || label(event.stage)}</p>
              {(event.provider || event.errorCode) && <div className="timeline__meta">{event.provider && <span>{event.provider}</span>}{event.errorCode && <span>{event.errorCode}</span>}</div>}
            </div>
          </motion.li>
        );
      })}
    </AnimatePresence>
  </ol>;
}
