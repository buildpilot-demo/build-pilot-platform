import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { GridIcon, SearchIcon, PulseIcon, MenuIcon, CloseIcon } from "./Icons";

const navigation = [
  { to: "/dashboard", label: "Overview", icon: GridIcon },
  { to: "/search", label: "Business Discovery", icon: SearchIcon },
  { to: "/health", label: "System health", icon: PulseIcon },
];

export function AppShell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const activeNav = navigation.find((item) => location.pathname.startsWith(item.to));
  const title = activeNav?.label ?? "Project details";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
        <div className="brand"><span className="brand__mark">BP</span><span><strong>Build Pilot</strong><small>Operations console</small></span></div>
        <button className="icon-button sidebar__close" aria-label="Close menu" onClick={() => setOpen(false)}><CloseIcon /></button>
        <nav className="nav" aria-label="Main navigation">
          <p className="nav__label">Workspace</p>
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `nav__link ${isActive ? "nav__link--active" : ""}`}>
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="nav__pill"
                      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <Icon /><span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer"><span className="connection-dot" /><span><strong>Live workspace</strong><small>Convex reactive sync</small></span></div>
      </aside>
      <AnimatePresence>
        {open && (
          <motion.button
            className="scrim"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
        )}
      </AnimatePresence>
      <div className="workspace">
        <header className="topbar">
          <button className="icon-button menu-button" aria-label="Open menu" onClick={() => setOpen(true)}><MenuIcon /></button>
          <div><p className="topbar__kicker">Admin workspace</p><strong>{title}</strong></div>
          <div className="operator"><span className="operator__avatar">OP</span><span><strong>Operator</strong><small>Administrator</small></span></div>
        </header>
        <main className="content">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
