import { redirect } from 'next/navigation';

// The outbound kanban board now lives on the unified Dashboard (/app/dashboard).
// Keep this route as a permanent redirect so old links/bookmarks still land there.
export default function TicketsRedirect() {
  redirect('/app/dashboard');
}
