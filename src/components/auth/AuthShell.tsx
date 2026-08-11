import { EnvoyLogo } from '@/components/shared/Logo';

// Shared frame for every signed-out account screen (login, signup, invite accept,
// forgot/reset password). One component so the five pages can't drift apart visually.
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="app-bg min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className={`card w-full ${wide ? 'max-w-md' : 'max-w-sm'} p-8`}>
        {/* EnvoyLogo is itself a link — do not wrap it in another one. */}
        <div className="flex justify-center mb-6">
          <EnvoyLogo href="/" onDark={false} />
        </div>
        <h1 className="text-lg font-semibold text-center mb-1">{title}</h1>
        {subtitle && <p className="text-sm text-neutral-500 text-center mb-6">{subtitle}</p>}
        {children}
      </div>
      {footer && <div className="mt-5 text-sm text-neutral-500 text-center">{footer}</div>}
    </main>
  );
}

// Consistent inline error styling — brand red, with a role so screen readers announce it.
export function AuthError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-[var(--brand,#E31E24)]">
      {children}
    </p>
  );
}
