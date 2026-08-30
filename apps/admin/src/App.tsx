import { Route, Routes } from 'react-router-dom'
import { HealthCheck } from './routes/HealthCheck'

function App() {
  return (
    <Routes>
      <Route path="/health" element={<HealthCheck />} />
      <Route path="/" element={<main>BuildPilot Admin</main>} />
    </Routes>
  )
}

export default App
