import { ReactNode } from 'react';

export default async function IntegrationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="bg-ink flex flex-1 min-h-screen w-screen">
      {children}
    </div>
  );
}
