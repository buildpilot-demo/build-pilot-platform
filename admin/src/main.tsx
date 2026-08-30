import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim();

root.render(
  <StrictMode>
    <ErrorBoundary>
      {convexUrl ? (
        <ConvexProvider client={new ConvexReactClient(convexUrl)}>
          <BrowserRouter><App /></BrowserRouter>
        </ConvexProvider>
      ) : (
        <main className="setup-screen"><div className="brand brand--center"><span className="brand__mark">BP</span><span><strong>Build Pilot</strong><small>Operations console</small></span></div><p className="eyebrow">Configuration needed</p><h1>Connect your Convex deployment</h1><p>Set <code>VITE_CONVEX_URL</code> in your local environment, then restart the development server.</p><div className="setup-screen__code">VITE_CONVEX_URL=https://your-deployment.convex.cloud</div></main>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
