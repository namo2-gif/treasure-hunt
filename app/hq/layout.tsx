import React from 'react';
import Shell from '@/components/hq/Shell';

export default function HQLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Shell>{children}</Shell>;
}
