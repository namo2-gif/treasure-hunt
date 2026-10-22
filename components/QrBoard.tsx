'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { QrBoardDTO } from '@/lib/dto';

const STORAGE_KEY = 'th_qr_board_expanded';

function getInitialExpanded(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === null) return true;
    return val === 'true';
  } catch {
    return true;
  }
}

function getPollInterval(): number {
  // 5 s ±1 s jitter (4000 ms to 6000 ms)
  return 5000 + (Math.random() * 2000 - 1000);
}

export default function QrBoard() {
  const [expanded, setExpanded] = useState<boolean>(getInitialExpanded);
  const [hidden, setHidden] = useState<boolean>(false);
  const [data, setData] = useState<QrBoardDTO | null>(null);
  const [retrying, setRetrying] = useState<boolean>(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef<boolean>(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/qr-board', { cache: 'no-store' });
      if (!mountedRef.current) return;

      if (res.status === 401) {
        setHidden(true);
        return;
      }

      const json = await res.json();
      if (!mountedRef.current) return;

      if (!json.ok) {
        // Domain rejections: NOT_IN_ROUND or WRONG_PHASE -> hide component
        if (json.code === 'NOT_IN_ROUND' || json.code === 'WRONG_PHASE') {
          setHidden(true);
        }
        return;
      }

      setData(json as QrBoardDTO);
      setRetrying(false);
    } catch {
      if (mountedRef.current) {
        setRetrying(true);
      }
    }
  }, []);

  const scheduleNextPoll = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!expanded || hidden || (typeof document !== 'undefined' && document.hidden)) {
      return;
    }
    timerRef.current = setTimeout(async () => {
      await fetchData();
      if (mountedRef.current && expanded && !hidden && !document.hidden) {
        scheduleNextPoll();
      }
    }, getPollInterval());
  }, [expanded, hidden, fetchData]);

  // Initial fetch on mount
  useEffect(() => {
    mountedRef.current = true;
    fetchData();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchData]);

  // Handle polling when expanded changes or visibility changes
  useEffect(() => {
    if (expanded && !hidden) {
      scheduleNextPoll();
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current);
      } else if (expanded && !hidden) {
        fetchData();
        scheduleNextPoll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [expanded, hidden, scheduleNextPoll, fetchData]);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore localStorage quota/privacy errors */
      }
      if (next) {
        // Re-fetch immediately when expanding
        fetchData();
      }
      return next;
    });
  };

  if (hidden) {
    return null;
  }

  return (
    // Fixed top-right, below the safe-area inset. Pointer-events-none wrapper so it
    // never blocks scrolling; interactive children re-enable pointer events.
    <div
      className="fixed right-4 z-40 flex flex-col items-end pointer-events-none"
      style={{ top: 'max(1rem, env(safe-area-inset-top, 1rem))' }}
    >
      {/* Toggle icon — always rendered first so it stays at the top of the column */}
      <button
        type="button"
        onClick={toggleExpanded}
        aria-label="QR locations"
        aria-expanded={expanded}
        className="w-12 h-12 rounded-full bg-surface border border-slate-700 text-accent hover:border-accent hover:text-amber-400 shadow-xl flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-accent pointer-events-auto shrink-0"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-6 h-6"
          aria-hidden="true"
        >
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      </button>

      {/* Expanded card — drops directly below the icon */}
      {expanded && (
        <div className="mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-surface border border-slate-700/80 p-3 shadow-2xl pointer-events-auto flex flex-col max-h-[55vh]">
          <div className="flex items-center justify-between pb-2 border-b border-slate-700/60 mb-2 shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-100">QR Locations</span>
              {retrying && <span className="text-[11px] text-amber-400 font-mono">Retrying...</span>}
            </div>
            {data && (
              <span className="text-xs text-slate-400 font-medium">Run {data.run}</span>
            )}
          </div>

          <div className="overflow-y-auto space-y-1.5 flex-1 pr-1">
            {!data ? (
              <div className="text-xs text-slate-400 font-mono py-1">Loading...</div>
            ) : data.locations.length === 0 ? (
              <div className="text-xs text-slate-400 font-mono py-1">No active QR locations</div>
            ) : (
              data.locations.map((loc) => (
                <div key={loc.number} className="text-xs text-slate-300 font-mono py-0.5">
                  QR {loc.number} · {loc.name} · {loc.count}/{loc.capacity}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
