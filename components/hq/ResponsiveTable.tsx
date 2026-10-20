import React from 'react';

export default function ResponsiveTable({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`w-full overflow-x-auto rounded-lg border border-slate-700/80 bg-slate-900/40 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
