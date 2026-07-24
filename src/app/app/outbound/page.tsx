import { redirect } from 'next/navigation';

// The outbound charts (call outcomes, calls-per-day) were folded into the unified
// Dashboard (/app/dashboard). Keep this route as a permanent redirect.
export default function OutboundRedirect() {
  redirect('/app/dashboard');
}
