import { motion, useReducedMotion } from "framer-motion";
import { InboxIcon } from "./Icons";

export function Loading({ label = "Loading live data" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="empty"
      initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="empty__icon"><InboxIcon /></div>
      <h3>{title}</h3>
      <p>{body}</p>
    </motion.div>
  );
}
