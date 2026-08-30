import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { adminApi } from "../lib/api";
import { RecoveryActionButton } from "../components/RecoveryActionButton";
import { PipelineStepper } from "../components/PipelineStepper";
import { ProjectTable } from "../components/ProjectTable";
import { Loading, EmptyState } from "../components/Loading";
import { StatusBadge } from "../components/StatusBadge";
import { CompassIcon } from "../components/Icons";

// One business -> many projects (each call placed from Search starts an
// independent Lead/Project/WorkflowRun — see convex/projects.ts:selectBusiness).
// This is the business-level home: the latest project's live pipeline
// progress (with a one-click Retry/Resume) plus the full project history —
// the activity timeline/build/discovery-call detail lives one click away on
// the project's own page (see ProjectPage).
export function BusinessPage() {
  const { businessId = "" } = useParams();
  const reduceMotion = useReducedMotion();
  const details = useQuery(adminApi.businessDetails, { businessId });

  const latestProjectId = details?.latestProjectId;
  const projectDetails = useQuery(adminApi.projectDetails, latestProjectId ? { projectId: latestProjectId } : "skip");

  if (details === undefined) return <Loading label="Loading business" />;
  if (details === null) {
    return (
      <div className="not-found">
        <div className="not-found__mark"><CompassIcon /></div>
        <p className="eyebrow">Business</p>
        <h1>Business not found</h1>
        <p>This business may have been removed or the identifier is invalid.</p>
        <Link className="button button--primary" to="/search">Search businesses</Link>
      </div>
    );
  }

  const { business, projects } = details;
  const currentProject = projectDetails?.project;

  return (
    <div className="page-stack">
      <div className="breadcrumbs"><Link to="/search">Businesses</Link><span>/</span><span>{business.name}</span></div>
      <motion.section
        className="project-heading"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <div>
          <div className="project-heading__status">
            <span className="eyebrow">{business.category}</span>
            {projects.length > 0 && <span>{projects.length} project{projects.length === 1 ? "" : "s"} started</span>}
          </div>
          <h1>{business.name}</h1>
          <p className="identifier-line">{[business.address, business.area, business.city].filter(Boolean).join(", ")}</p>
          <p className="identifier-line">{[business.normalizedPhone || business.phone, business.email].filter(Boolean).join(" · ")}</p>
        </div>
      </motion.section>

      {latestProjectId && (
        <>
          <section className="panel">
            <div className="panel__header">
              <div><p className="eyebrow">Latest project</p><h2>Progress</h2></div>
              <div className="heading-actions">
                {currentProject && <StatusBadge state={currentProject.state} />}
                <RecoveryActionButton project={currentProject} revisionRequest={projectDetails?.revisionRequest} />
              </div>
            </div>
            {projectDetails === undefined ? <Loading label="Loading latest project" /> : currentProject ? <PipelineStepper project={currentProject} /> : null}
          </section>
        </>
      )}
      {!latestProjectId && (
        <section className="panel">
          <EmptyState title="No project started yet" body="Call this business from the search results to start its first project." />
        </section>
      )}

      <section className="panel panel--wide">
        <div className="panel__header"><div><p className="eyebrow">History</p><h2>All projects for this business</h2></div></div>
        <ProjectTable projects={projects} />
      </section>
    </div>
  );
}
