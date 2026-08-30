import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { HealthCheckPage } from './pages/health/HealthCheckPage'
import { NotFoundPage } from './pages/not-found/NotFoundPage'
import { ProjectDetailPage } from './pages/projects/ProjectDetailPage'
import { SearchPage } from './pages/search/SearchPage'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="health" element={<HealthCheckPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
