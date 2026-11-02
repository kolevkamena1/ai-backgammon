import { lazy, Suspense } from 'react'
import App from './App.tsx'

// The admin dashboard is its own bundle chunk: players never download it. Cloudflare Access gates
// the path and the API behind it; this check only decides which React tree to mount.
const StatsPage = lazy(() => import('./stats/StatsPage.tsx'))

export default function Root() {
  const isStatsRoute = location.pathname === '/stats' || location.pathname.startsWith('/stats/')

  return isStatsRoute ? (
    <Suspense fallback={null}>
      <StatsPage />
    </Suspense>
  ) : (
    <App />
  )
}

