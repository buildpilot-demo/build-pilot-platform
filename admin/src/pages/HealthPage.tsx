import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { adminApi } from "../lib/api";
import { formatDate, label, stateTone } from "../lib/format";
import { Loading, EmptyState } from "../components/Loading";
import { StatusBadge } from "../components/StatusBadge";

export function HealthPage() {
  const health = useQuery(adminApi.health, {});
  const reduceMotion = useReducedMotion();
  if (health === undefined) return <Loading label="Checking system health" />;
  const services = health.services ?? [];
  const overall = health.status ?? (services.every((service) => stateTone(service.status) === "success") ? "OPERATIONAL" : "DEGRADED");

  return <div className="page-stack">
    <section className="page-heading"><div><p className="eyebrow">Infrastructure</p><h1>System health</h1><p>Live visibility into the services powering Build Pilot.</p></div><StatusBadge state={overall} /></section>
    <motion.section
      className="health-hero"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={`health-hero__pulse health-hero__pulse--${stateTone(overall)}`}><span /></div>
      <div><p className="eyebrow">Current status</p><h2>{label(overall)}</h2><p>Last checked {formatDate(health.checkedAt)}</p></div>
    </motion.section>
    <section className="panel"><div className="panel__header"><div><p className="eyebrow">Service map</p><h2>Connected systems</h2></div><span className="live-label"><span />Live updates</span></div>
      {services.length ? <div className="service-list">{services.map((service, index) => (
        <motion.article
          className="service-row"
          key={service.name}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1], delay: reduceMotion ? 0 : Math.min(index, 10) * 0.04 }}
        >
          <div className={`service-icon service-icon--${stateTone(service.status)}`}>{service.name.slice(0, 2).toUpperCase()}</div>
          <div className="service-row__body"><strong>{service.name}</strong><p>{service.message || "Service is responding normally"}</p></div>
          {service.latencyMs !== undefined && <span className="latency">{service.latencyMs} ms</span>}
          <StatusBadge state={service.status} />
        </motion.article>
      ))}</div> : <EmptyState title="No service checks returned" body="Health monitors will appear after the backend health query reports them." />}
    </section>
  </div>;
}
