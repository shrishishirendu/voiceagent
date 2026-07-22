import { redirect } from 'next/navigation';

// Contacts were folded into the Customers CRM screen (Phase 2). Keep this route as a
// permanent redirect so any old links/bookmarks still land somewhere sensible.
export default function ContactsRedirect() {
  redirect('/app/customers');
}
