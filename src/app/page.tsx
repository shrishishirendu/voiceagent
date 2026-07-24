import { Landing } from '@/components/landing/Landing';

// Public pre-login marketing landing. `/` is outside the middleware matcher, so it is
// reachable unauthenticated; the "Launch app" CTA routes to /app/dashboard, where the
// middleware + onboarding gate send signed-out users to /login and new owners to onboarding.
export default function RootPage() {
  return <Landing />;
}
