import { useState } from "react";
import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { adminApi } from "../lib/api";
import { formatDate, formatMs, label, prettifyKey, shortenId } from "../lib/format";
import { LiveActivityFeed } from "../components/LiveActivityFeed";
import { StagePanelStack } from "../components/StagePanelStack";
import { DiscoveryCallPanel } from "../components/DiscoveryCallPanel";
import { PipelineStepper } from "../components/PipelineStepper";
import { RecoveryActionButton } from "../components/RecoveryActionButton";
import { Loading } from "../components/Loading";
import { StatusBadge } from "../components/StatusBadge";
import { ExternalIcon, CompassIcon } from "../components/Icons";

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const reduceMotion = useReducedMotion();
  const details = useQuery(adminApi.projectDetails, { projectId });
  // Dedicated, independently-reactive subscription for the live timeline —
  // updates the moment any stage writes a new activityEvents row for this
  // project, without waiting on (or re-fetching) the rest of the page.
  const activity = useQuery(adminApi.projectActivity, { projectId });
  if (details === undefined) return <Loading label="Loading project workspace" />;
  if (details === null) return <div className="not-found"><div className="not-found__mark"><CompassIcon /></div><p className="eyebrow">Project</p><h1>Project not found</h1><p>This project may have been removed or the identifier is invalid.</p><Link className="button button--primary" to="/search">Search projects</Link></div>;

  const {
    project,
    business,
    workflowRun,
    repository,
    deployment,
    revisionRequest,
    voiceSession,
    transcript,
    requirement,
    requirementVersion,
    buildJob,
  } = details;
  const activityTimelinePanel = <section className="panel"><div className="panel__header"><div><p className="eyebrow">Workflow history</p><h2>Activity timeline</h2></div><div className="timeline__heading-meta">{project.totalDurationMs !== undefined && <span className="identifier" title="Total time since this project was created">Total {formatMs(project.totalDurationMs)}</span>}<span className="live-label"><span />Live updates</span></div></div><LiveActivityFeed events={activity} /></section>;
  return <div className="page-stack">
    <div className="breadcrumbs"><Link to="/search">Projects</Link><span>/</span><span>{project.name || project._id.slice(-10)}</span></div>
    <motion.section
      className="project-heading"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <div>
        <div className="project-heading__status"><StatusBadge state={project.state} /><span>Updated {formatDate(project.updatedAt)}</span></div>
        <h1>{project.name || "Untitled project"}</h1>
        <ProjectIdChip id={project._id} />
      </div>
      <div className="heading-actions">
        <RecoveryActionButton project={project} revisionRequest={revisionRequest} />
        {project.liveUrl && <a className="button" href={project.liveUrl} target="_blank" rel="noreferrer">Open live site <ExternalIcon /></a>}
      </div>
    </motion.section>
    <PipelineStepper project={project} hideHeading />
    <section className="top-grid">
      {activityTimelinePanel}
      <StagePanelStack project={project} activity={activity} buildJob={buildJob} />
    </section>
    <section className="detail-grid">
      <div className="detail-main">
        <DiscoveryCallPanel voiceSession={voiceSession} transcript={transcript} />
        {requirementVersion && <section className="panel"><div className="panel__header"><div><p className="eyebrow">Structured brief</p><h2>Validated requirements</h2></div><StatusBadge state={requirement?.status || requirementVersion.validationStatus} /></div><div className="info-panel"><StructuredData value={requirementVersion.structuredData} />{requirementVersion.validationErrors?.length ? <ul className="error-list">{requirementVersion.validationErrors.map((error) => <li key={error}>{error}</li>)}</ul> : null}</div></section>}
      </div>
      <aside className="detail-aside">
        <InfoPanel title="Project details" rows={[
          ["Business", business?.name], ["Category", business?.category], ["Location", business?.city], ["Created", formatDate(project.createdAt)], ["Correlation ID", project.correlationId],
        ]} />
        <InfoPanel title="Active workflow" rows={[
          ["Status", workflowRun && label(workflowRun.status)], ["State", workflowRun && label(workflowRun.state)], ["Started", workflowRun && formatDate(workflowRun.startedAt)],
        ]} />
        {(repository || deployment) && <InfoPanel title="Delivery" rows={[
          ["Repository", repository && `${repository.owner}/${repository.name}`], ["Branch", repository?.targetBranch], ["Deployment", deployment && label(deployment.status)], ["Commit", deployment?.commitSha?.slice(0, 10)],
        ]} />}
      </aside>
    </section>
  </div>;
}

function ProjectIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied (e.g. insecure context) — the ID
      // is still visible/selectable, so there's nothing further to do.
    }
  }

  return (
    <p className="identifier-line">
      ID <button type="button" className="id-chip" title={id} onClick={() => void handleCopy()}><code>{shortenId(id, 18)}</code></button>
      {copied && <span className="id-chip__copied">Copied</span>}
    </p>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, string | undefined]> }) {
  const visible = rows.filter(([, value]) => value);
  if (!visible.length) return null;
  return (
    <motion.section
      className="panel info-panel"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
    >
      <h2>{title}</h2>
      <dl>{visible.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
    </motion.section>
  );
}

function StructuredData({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>Unknown</span>;
  if (Array.isArray(value)) return <ul className="data-list">{value.map((item, index) => <li key={index}><StructuredData value={item} /></li>)}</ul>;
  if (typeof value === "object") return <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{prettifyKey(key)}</dt><dd><StructuredData value={item} /></dd></div>)}</dl>;
  return <span>{typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}</span>;
}
