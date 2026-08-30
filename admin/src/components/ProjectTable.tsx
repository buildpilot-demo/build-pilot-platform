import { motion, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import type { Project } from "../lib/types";
import { formatRelative } from "../lib/format";
import { StatusBadge } from "./StatusBadge";
import { ArrowIcon } from "./Icons";
import { EmptyState } from "./Loading";

export function ProjectTable({ projects }: { projects: Project[] }) {
  const reduceMotion = useReducedMotion();
  const navigate = useNavigate();
  if (!projects.length) return <EmptyState title="No projects found" body="Projects matching this view will appear here in real time." />;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Project</th><th>Status</th><th>Updated</th><th>Reference</th><th><span className="sr-only">Open</span></th></tr></thead>
        <tbody>{projects.map((project, index) => (
          <motion.tr
            key={project._id}
            className="row--clickable"
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/projects/${project._id}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") navigate(`/projects/${project._id}`);
            }}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1], delay: reduceMotion ? 0 : Math.min(index, 8) * 0.03 }}
          >
            <td><span className="project-name">{project.name || "Untitled project"}</span></td>
            <td><StatusBadge state={project.state} /></td>
            <td className="muted nowrap">{formatRelative(project.updatedAt)}</td>
            <td><code className="identifier">{project._id.slice(-10)}</code></td>
            <td><span className="row-link" aria-hidden="true"><ArrowIcon /></span></td>
          </motion.tr>
        ))}</tbody>
      </table>
    </div>
  );
}
