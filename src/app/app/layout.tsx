import { ToastProvider } from '@/components/shared/Toast';
import { BulkIntakeProvider } from '@/components/shared/BulkIntakeContext';
import { AppShellChrome } from './AppShellChrome';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <BulkIntakeProvider>
        <AppShellChrome>{children}</AppShellChrome>
      </BulkIntakeProvider>
    </ToastProvider>
  );
}
