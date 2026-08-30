import { ConvexReactClient } from 'convex/react'

const convexUrl = import.meta.env.VITE_CONVEX_URL

if (!convexUrl) {
  throw new Error(
    'VITE_CONVEX_URL is not set. Copy .env.example to .env.local and set it to your Convex deployment URL (see https://docs.convex.dev/production/hosting/).',
  )
}

export const convex = new ConvexReactClient(convexUrl)
