import { motion, useReducedMotion } from "framer-motion";
import { label, stateTone } from "../lib/format";

export function StatusBadge({ state }: { state?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      key={state}
      className={`status status--${stateTone(state)}`}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className="status__dot" />
      {label(state)}
    </motion.span>
  );
}
