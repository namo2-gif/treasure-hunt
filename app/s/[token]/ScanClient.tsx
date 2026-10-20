'use client';

import React, { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getErrorMessage } from '@/lib/messages';

interface ScanResult {
  ok: boolean;
  code?: string;
  message?: string;
  already?: boolean;
  kind?: 'r2' | 'r3';
  run?: number;
  piece_no?: number;
  qr_name?: string;
  zone?: number;
  zone_name?: string;
  n?: number;
}

export default function ScanClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const scannedRef = useRef(false);

  const doScan = useCallback(async () => {
    setLoading(true);
    setNetworkError(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=/s/${encodeURIComponent(token)}`;
        return;
      }
      if (res.status >= 500) throw new Error('server');
      setResult(await res.json());
    } catch {
      setNetworkError('Network error connecting to hunt server. Please retry.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // Only runs in client JavaScript on mount (link previews and prefetchers never register anyone).
    if (scannedRef.current) return;
    scannedRef.current = true;
    doScan();
  }, [doScan]);

  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full max-w-player mx-auto py-8 text-center">
      <div className="w-full p-6 rounded-2xl bg-surface border border-slate-700/80 shadow-2xl">
        {loading ? (
          <div className="py-8">
            <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-bold text-slate-100">Scanning Beacon</h2>
            <p className="text-xs text-slate-400 mt-1">Registering your location with headquarters...</p>
          </div>
        ) : networkError ? (
          <div className="py-4">
            <div className="w-12 h-12 rounded-full bg-red-950/60 border border-red-800 text-red-400 flex items-center justify-center mx-auto mb-3 text-xl font-bold">
              !
            </div>
            <h2 className="text-lg font-bold text-slate-100">Connection Error</h2>
            <p className="text-xs text-red-300 mt-2">{networkError}</p>
            <button
              onClick={doScan}
              className="mt-6 w-full py-3 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm border border-slate-600 transition-colors"
            >
              Retry Scan
            </button>
          </div>
        ) : result?.ok ? (
          <div className="py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-950/60 border border-emerald-800 text-emerald-400 flex items-center justify-center mx-auto mb-3 text-xl font-bold">
              ✓
            </div>
            <span className="px-2.5 py-0.5 text-xs font-bold uppercase rounded bg-emerald-500/20 text-emerald-400">
              {result.already ? (result.kind === 'r3' ? 'Already Scanned' : 'Already Registered') : 'Verified'}
            </span>
            {result.kind === 'r3' ? (
              <div className="mt-3">
                <h2 className="text-xl font-extrabold text-slate-100">
                  {result.already ? 'Location Verified' : 'Location Verified!'}
                </h2>
                <p className="text-sm text-slate-300 mt-2 font-medium">
                  {result.already
                    ? 'You already scanned here.'
                    : 'Location verified. Your riddles are unlocked.'}
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <h2 className="text-xl font-extrabold text-slate-100">{result.qr_name}</h2>
                <p className="text-sm text-slate-300 mt-2 font-medium">
                  Registered at <span className="text-accent font-bold">{result.qr_name}</span>.
                  <br />
                  You are piece <span className="text-accent font-bold">{result.piece_no}</span> of{' '}
                  <span className="text-accent font-bold">{result.n}</span>.
                </p>
              </div>
            )}
            <div className="mt-8">
              <Link
                href="/"
                className="block w-full py-3.5 px-4 rounded-xl bg-accent hover:bg-accentHover text-slate-950 font-bold text-sm tracking-wide transition-colors shadow-lg"
              >
                Go to Team Hunt Screen
              </Link>
            </div>
          </div>
        ) : (
          <div className="py-4">
            <div className="w-12 h-12 rounded-full bg-amber-950/60 border border-amber-800 text-amber-400 flex items-center justify-center mx-auto mb-3 text-xl font-bold">
              ✕
            </div>
            <span className="px-2.5 py-0.5 text-xs font-bold uppercase rounded bg-red-500/20 text-red-400">
              Registration Failed
            </span>
            <h2 className="text-lg font-bold text-slate-100 mt-3">Cannot Register</h2>
            <p className="text-sm text-amber-300 mt-2 font-medium">
              {result?.code ? getErrorMessage(result.code) : result?.message || 'Unable to scan.'}
            </p>
            <div className="mt-8">
              <Link
                href="/"
                className="block w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm border border-slate-600 transition-colors"
              >
                Return to Home
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
