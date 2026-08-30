import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { SearchPage } from "./pages/SearchPage";
import { BusinessPage } from "./pages/BusinessPage";
import { ProjectPage } from "./pages/ProjectPage";
import { HealthPage } from "./pages/HealthPage";
import { NotFoundPage } from "./pages/NotFoundPage";

// NOTE: Admin authentication is intentionally disabled for now; any user can
// access the dashboard. Authentication will be added back in a future pass.
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="businesses/:businessId" element={<BusinessPage />} />
        <Route path="projects/:projectId" element={<ProjectPage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
