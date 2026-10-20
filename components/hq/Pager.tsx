'use client';

import React from 'react';

interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newPageSize: number) => void;
  className?: string;
}

export default function Pager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className = '',
}: PagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div
      className={`flex items-center justify-between gap-2 py-2 px-1 text-xs text-slate-300 select-none ${className}`}
    >
      {/* Count Range */}
      <span className="font-mono text-[11px] sm:text-xs text-slate-400 whitespace-nowrap">
        <b className="text-slate-200">{start}</b>–<b className="text-slate-200">{end}</b> of{' '}
        <b className="text-accent">{total}</b>
      </span>

      {/* Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-8 px-1.5 sm:px-2 rounded bg-slate-900 border border-slate-700 text-slate-300 text-[11px] sm:text-xs focus:outline-none focus:border-accent"
            aria-label="Items per page"
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        )}

        <button
          type="button"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
          className="h-8 px-2.5 sm:px-3 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors"
          aria-label="Previous page"
        >
          <span className="sm:inline">Prev</span>
        </button>

        <button
          type="button"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          className="h-8 px-2.5 sm:px-3 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors"
          aria-label="Next page"
        >
          <span className="sm:inline">Next</span>
        </button>
      </div>
    </div>
  );
}
