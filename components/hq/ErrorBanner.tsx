'use client';

import React from 'react';

interface ErrorBannerProps {
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ message, onRetry, className = '' }: ErrorBannerProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={`bg-red-950/80 border border-red-500/50 rounded-lg p-4 my-3 text-red-200 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md ${className}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-red-400 font-bold">Error:</span>
        <span className="break-all">{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider bg-red-800 hover:bg-red-700 active:bg-red-900 text-white rounded transition shadow-sm self-end sm:self-auto min-h-[36px]"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export default ErrorBanner;
