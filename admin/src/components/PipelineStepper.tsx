import { motion, useReducedMotion } from "framer-motion";
import { Link } from "react-router-dom";
import type { Project } from "../lib/types";
import { elapsedSince, label } from "../lib/format";
import { PRIMARY_STAGES, resolvePipelineProgress } from "../lib/pipeline";
import { StatusBadge } from "./StatusBadge";

export function PipelineStepper({ project, hideHeading = false }: { project: Project; hideHeading?: boolean }) {
  const reduceMotion = useReducedMotion();
  const { index, total, status } = resolvePipelineProgress(project.state, project.failedStage);
  const currentLabel = status === "active" ? label(project.state) : label(project.failedStage ?? PRIMARY_STAGES[index]);
  const elapsed = elapsedSince(project.updatedAt);

  return (
    <motion.article
      className={`pipeline pipeline--${status}`}
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      {!hideHeading && (
        <div className="pipeline__heading">
          <Link className="project-name" to={`/projects/${project._id}`}>{project.name || "Untitled project"}</Link>
          <StatusBadge state={project.state} />
        </div>
      )}
      <div className="pipeline__track" role="img" aria-label={`Stage ${index + 1} of ${total}: ${currentLabel}`}>
        {PRIMARY_STAGES.map((stage, stageIndex) => {
          const stepStatus = stageIndex < index ? "done" : stageIndex === index ? status : "pending";
          return (
            <motion.span
              key={stage}
              className={`pipeline__step pipeline__step--${stepStatus}`}
              title={label(stage)}
              initial={reduceMotion ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              style={{ transformOrigin: "left" }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1], delay: reduceMotion ? 0 : Math.min(stageIndex, 12) * 0.015 }}
            />
          );
        })}
      </div>
      <div className="pipeline__meta">
        <span className="pipeline__stage">{currentLabel}</span>
        <span className="pipeline__elapsed">{elapsed} in this stage</span>
        {status === "failed" && <span className="pipeline__note">{project.errorCode ?? "Failed"}{project.retryable ? " · retryable" : ""}</span>}
        {status === "blocked" && <span className="pipeline__note">{project.errorCode ?? "Needs manual review"}</span>}
      </div>
    </motion.article>
  );
}
