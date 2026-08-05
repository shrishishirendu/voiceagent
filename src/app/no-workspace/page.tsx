import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { SignOutButton } from '@/components/auth/SignOutButton';

// Terminal state for a valid sign-in that belongs to no company: the account exists and
// the password was right, but the email is on no tenant's member list and never signed up
// to create one.
//
// This used to be impossible to reach, because resolveAccess() silently made such a user
// the owner of a brand-new empty workspace. That was the bug — an employee who was never
// invited would land in a private workspace of their own and see an empty app, with no
// indication anything was wrong.
export default async function NoWorkspacePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  return (
    <AuthShell
      title="Your account isn't linked to a company"
      subtitle={session.user.id}
    >
      <div className="text-sm text-neutral-500 space-y-3">
        <p>
          You&rsquo;re signed in, but this email isn&rsquo;t on any company&rsquo;s team yet. Ask an
          administrator at your company to invite you — you&rsquo;ll get an email with a link to
          finish setting up.
        </p>
        <p>
          If you meant to set up a brand-new company instead, sign out and create a company
          account.
        </p>
      </div>

      <div className="mt-5">
        <SignOutButton />
      </div>
    </AuthShell>
  );
}
