import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { CompassIcon } from "../components/Icons";

export function NotFoundPage() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="not-found"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="not-found__mark"><CompassIcon /></div>
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>The view you requested does not exist in this workspace.</p>
      <Link className="button button--primary" to="/dashboard">Return to dashboard</Link>
    </motion.div>
  );
}
