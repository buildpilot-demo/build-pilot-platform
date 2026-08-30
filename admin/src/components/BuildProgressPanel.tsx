import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { formatDate, label } from "../lib/format";
import { EmptyState } from "./Loading";
import { StatusBadge } from "./StatusBadge";
import { ExternalIcon } from "./Icons";
import type { BuildJob, BuildProgressEvent } from "../lib/types";

const SOURCE_LABEL: Record<string, string> = {
  devin_message: "Devin",
  devin_status: "Status",
  github_commit: "GitHub",
};

/**
 * Live Devin build progress (T-progress): the session's own messages
 * (GET /v1/sessions/{id}), status_enum changes, and new-commit-on-branch
 * signals from GitHub. Presentational only - StagePanelStack owns fetching
 * (getBuildProgress) and the shared panel/motion chrome every stage card
 * uses, so this only renders the Build stage's own header + event list.
 */
export function BuildStagePanel({ buildJob, events }: { buildJob: BuildJob; events?: BuildProgressEvent[] }) {
  const reduceMotion = useReducedMotion();
  const list = events ?? [];
  const latestFirst = [...list].reverse();

  return (
    <>
      <div className="panel__header">
        <div>
          <p className="eyebrow">Behind the scenes</p>
          <h2>Devin Build</h2>
        </div>
        <StatusBadge state={buildJob.statusEnum ?? buildJob.status} />
      </div>
      <div className="timeline__meta" style={{ margin: "0 22px 12px" }}>
        {buildJob.sessionId && <span className="identifier">session {buildJob.sessionId.slice(0, 16)}</span>}
        {buildJob.resumedAt && <span>Resumed {formatDate(buildJob.resumedAt)}</span>}
        {buildJob.pullRequestUrl && (
          <a href={buildJob.pullRequestUrl} target="_blank" rel="noreferrer">
            Pull request <ExternalIcon />
          </a>
        )}
        {buildJob.mergedAt && <span>Merged into main {formatDate(buildJob.mergedAt)}</span>}
        {buildJob.mergeError && <span className="pipeline__note">Merge failed: {buildJob.mergeError}</span>}
        {buildJob.lastPolledAt && <span>Last checked {formatDate(buildJob.lastPolledAt)}</span>}
      </div>
      {latestFirst.length === 0 ? (
        <EmptyState title="Waiting for the first update" body="Devin's session messages and new commits will stream in here as it works." />
      ) : (
        <ol className="timeline">
          <AnimatePresence initial={false}>
            {latestFirst.map((event) => (
              <motion.li
                key={event._id}
                layout
                className="timeline__item"
                initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className={`timeline__marker timeline__marker--${event.source === "devin_status" ? "warning" : "progress"}`} />
                <div className="timeline__content">
                  <div className="timeline__heading">
                    <strong>{SOURCE_LABEL[event.source] ?? label(event.source)}</strong>
                    <span className="timeline__heading-meta"><time>{formatDate(event.occurredAt)}</time></span>
                  </div>
                  <p>{event.message}</p>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </>
  );
}
