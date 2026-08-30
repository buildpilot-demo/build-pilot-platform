import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { Link } from "react-router-dom";
import { adminApi } from "../lib/api";
import { Loading, EmptyState } from "../components/Loading";
import { ProjectTable } from "../components/ProjectTable";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { PipelineStepper } from "../components/PipelineStepper";
import { LayersIcon, PulseIcon, CheckCircleIcon, WarningIcon } from "../components/Icons";

const TERMINAL_STATES = new Set(["DELIVERED", "CANCELLED"]);

const METRIC_ICON = { slate: LayersIcon, blue: PulseIcon, green: CheckCircleIcon, orange: WarningIcon } as const;

export function DashboardPage() {
  // useQuery keeps this subscribed over Convex's reactive websocket — every
  // write to `projects`/`workflowRuns` on the backend re-renders this page
  // automatically. No setInterval/polling anywhere in this file.
  const data = useQuery(adminApi.dashboard, {});
  const reduceMotion = useReducedMotion();
  if (data === undefined) return <Loading label="Loading workspace overview" />;
  const totals = data.totals ?? {};
  const projects = data.projects ?? [];
  const activeProjects = projects.filter((project) => !TERMINAL_STATES.has(project.state));

  return <div className="page-stack">
    <section className="page-heading"><div><p className="eyebrow">Operations overview</p><h1>Good to see you.</h1><p>Monitor every build from first contact through delivery.</p></div><Link className="button button--primary" to="/search">Find a project</Link></section>
    <section className="metric-grid" aria-label="Project summary">
      <Metric label="Total projects" value={totals.projects ?? projects.length} detail="All recorded workflows" delay={0} />
      <Metric label="In progress" value={totals.active ?? 0} detail="Active workflows" tone="blue" delay={reduceMotion ? 0 : 0.04} />
      <Metric label="Delivered" value={totals.delivered ?? 0} detail="Successful handoffs" tone="green" delay={reduceMotion ? 0 : 0.08} />
      <Metric label="Needs attention" value={totals.needsAttention ?? 0} detail="Operator review required" tone="orange" delay={reduceMotion ? 0 : 0.12} />
    </section>
    <section className="panel">
      <div className="panel__header"><div><p className="eyebrow">Live pipeline</p><h2>Projects in flight</h2></div><span className="live-label"><span />Live updates</span></div>
      {activeProjects.length ? <div className="pipeline-list">{activeProjects.map((project) => <PipelineStepper key={project._id} project={project} />)}</div> : <EmptyState title="No active projects" body="Select a business from search to start a new workflow." />}
    </section>
    <div className="dashboard-grid">
      <section className="panel panel--wide"><div className="panel__header"><div><p className="eyebrow">Current work</p><h2>Recent projects</h2></div><Link to="/search" className="text-link">View all</Link></div><ProjectTable projects={projects.slice(0, 8)} /></section>
      <section className="panel"><div className="panel__header"><div><p className="eyebrow">Live feed</p><h2>Recent activity</h2></div></div><ActivityTimeline events={data.recentActivity?.slice(0, 7)} /></section>
    </div>
  </div>;
}

function Metric({ label, value, detail, tone = "slate", delay = 0 }: { label: string; value: number; detail: string; tone?: keyof typeof METRIC_ICON; delay?: number }) {
  const Icon = METRIC_ICON[tone];
  const reduceMotion = useReducedMotion();
  return (
    <motion.article
      className={`metric metric--${tone}`}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1], delay }}
    >
      <div className="metric__top"><span>{label}</span><span className="metric__symbol"><Icon /></span></div>
      <strong>{value.toLocaleString()}</strong>
      <small>{detail}</small>
    </motion.article>
  );
}
