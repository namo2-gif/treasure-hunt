'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [studentId, setStudentId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Validate next redirect url: relative path starting with /s/ or equal to /
  const rawNext = searchParams.get('next');
  const nextUrl =
    rawNext && (rawNext === '/' || rawNext.startsWith('/s/')) ? rawNext : '/';

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          setError(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (countdown && countdown > 0) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: studentId.trim(),
          code: code.trim().toUpperCase(),
        }),
      });

      const data = await res.json();

      if (data.ok) {
        router.push(nextUrl);
        router.refresh();
      } else {
        if (data.code === 'THROTTLED' && data.retryAfterSec) {
          setCountdown(data.retryAfterSec);
        }
        setError(data.message || 'Login failed.');
      }
    } catch {
      setError('Network failure. Retrying...');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="w-full max-w-player min-h-screen flex flex-col p-4 mx-auto items-center justify-center">
      <div className="flex flex-col items-center justify-center flex-1 w-full mx-auto py-8">
        <div className="w-full bg-surface border border-slate-700/60 rounded-xl p-6 shadow-xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-accent mb-1">
            Campus Treasure Hunt
          </h1>
          <p className="text-xs text-slate-400">
            Enter your credentials to join your squad
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="studentId"
              className="block text-xs font-semibold tracking-wider uppercase text-slate-300 mb-1.5"
            >
              Student ID
            </label>
            <input
              id="studentId"
              type="text"
              required
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value.toUpperCase())}
              placeholder="e.g. S0101"
              disabled={loading || (countdown !== null && countdown > 0)}
              className="w-full h-12 px-3.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono text-base"
            />
          </div>

          <div>
            <label
              htmlFor="code"
              className="block text-xs font-semibold tracking-wider uppercase text-slate-300 mb-1.5"
            >
              Personal Code (6 characters)
            </label>
            <input
              id="code"
              type="text"
              required
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. 7K9X2B"
              disabled={loading || (countdown !== null && countdown > 0)}
              className="w-full h-12 px-3.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono text-center text-lg tracking-widest uppercase"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-950/60 border border-red-800/60 text-red-200 text-xs text-center font-medium">
              {countdown && countdown > 0 ? (
                <span>Too many tries. Wait {countdown} seconds.</span>
              ) : (
                error
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (countdown !== null && countdown > 0)}
            className="w-full h-12 mt-2 bg-accent hover:bg-accentHover active:bg-amber-600 text-slate-950 font-bold rounded-lg text-sm tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? 'Verifying...'
              : countdown && countdown > 0
              ? `Locked (${countdown}s)`
              : 'Enter Hunt'}
          </button>
        </form>
      </div>

      <p className="mt-8 text-center text-xs text-slate-600">
        Lost your code? Contact your team captain or hunt organizers.
      </p>
    </div>
  </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center flex-1 text-slate-400 text-sm">
          Loading login...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
