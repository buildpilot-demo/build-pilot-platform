import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { adminApi } from "../lib/api";
import { activityEventTone, formatDate, label } from "../lib/format";
import { resolvePipelineProgress } from "../lib/pipeline";
import { resolveNextCheckpoint } from "../lib/resume";
import { STAGE_GROUPS, stageGroupKey } from "../lib/stageGroups";
import { BuildStagePanel } from "./BuildProgressPanel";
import { EmptyState } from "./Loading";
import type { ActivityEvent, BuildJob, BuildProgressEvent, Project } from "../lib/types";

type StageGroup = { key: string; title: string; events: ActivityEvent[]; latest: ActivityEvent };

/**
 * The Project page's "Behind the scenes" column, generalized from a
 * single, Devin-only progress panel into one card per pipeline stage the
 * project has actually reached - grouped via stageGroupKey (see
 * lib/stageGroups.ts) and ordered by each group's most recent event, newest
 * first. As the project advances into a new stage, that stage's card moves
 * to the top and earlier stages' cards get pushed down, so the history of
 * "what happened at each step" stays visible instead of being replaced.
 *
 * Only the Devin build stage has a rich sub-event feed today
 * (buildProgressEvents - session messages/status changes/commits); every
 * other stage renders a simpler card built directly from that stage's own
 * activityEvents rows.
 */
export function StagePanelStack({
  project,
  activity,
  buildJob,
}: {
  project: Project;
  activity?: ActivityEvent[];
  buildJob?: BuildJob;
}) {
  const buildEvents = useQuery(adminApi.buildProgress, buildJob ? { buildJobId: buildJob._id } : "skip");
  const events = activity ?? [];

  const groups = STAGE_GROUPS.map((group): StageGroup | undefined => {
    const groupEvents = events.filter((event) => stageGroupKey(event) === group.key);
    if (groupEvents.length) return { ...group, events: groupEvents, latest: groupEvents[groupEvents.length - 1] };
    // buildJob exists but hasn't (yet, or ever, for older data) produced a
    // matching BUILD_QUEUED activityEvents row - synthesize a placeholder
    // "latest" so the Devin build card still appears rather than silently
    // disappearing from the stack.
    if (group.key === "BUILD_QUEUED" && buildJob) {
      return { ...group, events: [], latest: { _id: buildJob._id, stage: "DEVIN_BUILD", timestamp: buildJob.updatedAt } };
    }
    return undefined;
  }).filter((group): group is StageGroup => Boolean(group));

  const ordered = [...groups].sort((a, b) => b.latest.timestamp - a.latest.timestamp);
  const currentGroupKey = resolveNextCheckpoint(project.state);
  const isPipelineActive = resolvePipelineProgress(project.state, project.failedStage).status === "active";

  if (!ordered.length) {
    return (
      <section className="panel">
        <div className="panel__header"><div><p className="eyebrow">Behind the scenes</p><h2>Stage progress</h2></div></div>
        <EmptyState title="No stage activity yet" body="A panel for each pipeline stage will appear here as the project moves through it." />
      </section>
    );
  }

  return (
    <div className="stage-stack">
      <AnimatePresence initial={false}>
        {ordered.map((group) => {
          const isActive = isPipelineActive && group.key === currentGroupKey;
          return (
            <StagePanelCard key={group.key} group={group} isActive={isActive} buildJob={group.key === "BUILD_QUEUED" ? buildJob : undefined} buildEvents={buildEvents} />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function StagePanelCard({
  group,
  isActive,
  buildJob,
  buildEvents,
}: {
  group: StageGroup;
  isActive: boolean;
  buildJob?: BuildJob;
  buildEvents?: BuildProgressEvent[];
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.section
      layout
      className="panel"
      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      {buildJob ? (
        <BuildStagePanel buildJob={buildJob} events={buildEvents} />
      ) : (
        <GenericStagePanel group={group} isActive={isActive} />
      )}
    </motion.section>
  );
}

function GenericStagePanel({ group, isActive }: { group: StageGroup; isActive: boolean }) {
  const reduceMotion = useReducedMotion();
  const latestFirst = [...group.events].reverse();
  const tone = activityEventTone(group.latest, isActive);
  const headerLabel = isActive ? "In progress" : tone === "danger" ? "Failed" : tone === "warning" ? "Needs review" : tone === "admin" ? "Resumed by admin" : "Completed";

  return (
    <>
      <div className="panel__header">
        <div>
          <p className="eyebrow">Behind the scenes</p>
          <h2>{group.title}</h2>
        </div>
        <span className={`status status--${tone}`}><span className="status__dot" />{headerLabel}</span>
      </div>
      <ol className="timeline">
        <AnimatePresence initial={false}>
          {latestFirst.map((event, index) => {
            const eventIsActive = isActive && index === 0;
            const eventTone = activityEventTone(event, eventIsActive);
            return (
              <motion.li
                key={event._id}
                layout
                className="timeline__item"
                initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className={`timeline__marker timeline__marker--${eventTone}${eventIsActive ? " timeline__marker--pulse" : ""}`} />
                <div className="timeline__content">
                  <div className="timeline__heading">
                    <strong>{event.message || label(event.eventType || event.stage)}</strong>
                    <time>{formatDate(event.timestamp)}</time>
                  </div>
                  <p>{event.fromState || event.toState ? `${event.fromState ? label(event.fromState) : "—"} → ${event.toState ? label(event.toState) : "—"}` : event.reason || "—"}</p>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </>
  );
}
