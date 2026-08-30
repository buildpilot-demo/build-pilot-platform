import { useParams } from 'react-router-dom'
import { ComingSoon } from '../../components/ComingSoon'

// Filled in during Stages 3-7 (project detail: workflow timeline, transcript,
// requirements, build/deploy status, revision history, manual retry controls).
export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()

  return (
    <ComingSoon
      title={`Project ${projectId}`}
      description="Live workflow timeline, call transcript, requirements, build/deploy status, and revision history for this project."
    />
  )
}
