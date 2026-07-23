import { redirect } from 'next/navigation';

// `/app` has no view of its own — the authenticated shell renders real sub-routes
// (/app/dashboard, /app/tickets, …). Sign-in and every "go to app" link target /app,
// so land them on the dashboard. The layout's tenant/onboarding gate runs first.
export default function AppIndex() {
  redirect('/app/dashboard');
}
