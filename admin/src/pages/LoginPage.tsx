import { useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { motion, useReducedMotion } from "framer-motion";
import { LockIcon } from "../components/Icons";

// Login-only — deliberately no sign-up form here. The single admin account
// is created once via the bootstrap script (see convex/lib/bootstrapAdmin.ts
// and README), not through this UI, so this console can't be self-registered
// into by an unauthenticated visitor (T7.4).
export function LoginPage() {
  const { signIn } = useAuthActions();
  const reduceMotion = useReducedMotion();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await signIn("password", { email: email.trim(), password, flow: "signIn" });
    } catch {
      setError("Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="setup-screen">
      <motion.div
        className="auth-card"
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="brand brand--center"><span className="brand__mark">BP</span><span><strong>Build Pilot</strong><small>Operations console</small></span></div>
        <p className="eyebrow"><LockIcon width={14} height={14} />Sign in</p>
        <h1>Admin access only</h1>
        <p>Enter your operator credentials to open the console.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label><span>Email</span><input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label><span>Password</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="button button--primary" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
        {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      </motion.div>
    </main>
  );
}
