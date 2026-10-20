'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { adminFetch, AdminFetchError } from '@/lib/admin-fetch';
import ErrorBanner from '@/components/hq/ErrorBanner';

interface LogEntry {
  id: number;
  adminId: number | null;
  adminUsername: string | null;
  action: string;
  target: string | null;
  before: any;
  after: any;
  createdAt: string;
}

export default function LogsAndExportsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState('');

  async function fetchLogs(p = page) {
    try {
      const d = await adminFetch<any>(`/api/admin/log?page=${p}&limit=${limit}`);
      if (d.ok) {
        setLogs(d.logs || []);
        setTotal(d.total || 0);
        setPage(d.page || p);
      }
    } catch (err: any) {
      if (err instanceof AdminFetchError && err.status === 401) return;
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs(1);
    const interval = setInterval(() => fetchLogs(page), 5000);
    return () => clearInterval(interval);
  }, [page]);

  const filteredLogs = filterAction.trim()
    ? logs.filter((l) =>
        l.action.toLowerCase().includes(filterAction.toLowerCase()) ||
        (l.target && l.target.toLowerCase().includes(filterAction.toLowerCase())) ||
        (l.adminUsername && l.adminUsername.toLowerCase().includes(filterAction.toLowerCase()))
      )
    : logs;

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="pb-5 border-b border-slate-800 flex items-center justify-between">
        <div>
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-accent/20 text-accent rounded border border-accent/30">
            Compliance & Telemetry
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            Audit Log & CSV Exports
          </h1>
        </div>
      </div>

      {/* CSV Exports Section */}
      <div className="mt-6 p-5 rounded-xl bg-slate-800/80 border border-slate-700">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide mb-3">CSV Data Exports</h2>
        <p className="text-xs text-slate-400 mb-4">
          Download real-time snapshot data in standard CSV format for offline reporting and verification.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/admin/export/registrations"
            download
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-500 text-xs font-semibold flex items-center gap-2 transition-colors"
          >
            <span>📥</span> Download Registrations CSV
          </a>
          <a
            href="/api/admin/export/attempts"
            download
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-500 text-xs font-semibold flex items-center gap-2 transition-colors"
          >
            <span>📥</span> Download Attempts CSV
          </a>
          <a
            href="/api/admin/export/standings"
            download
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-500 text-xs font-semibold flex items-center gap-2 transition-colors"
          >
            <span>📥</span> Download Standings CSV
          </a>
        </div>
      </div>

      {/* Audit Log Table Section */}
      <div className="mt-6 p-5 rounded-xl bg-slate-800/80 border border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
              Append-Only Admin Audit Log
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Live updates every 5s. Total entries: {total}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter by action, target, user..."
              className="px-3 py-1.5 text-xs rounded bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent"
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            />
          </div>
        </div>

        {loading && logs.length === 0 ? (
          <div className="text-xs text-slate-400 py-8 text-center">Loading audit log...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 border-collapse">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 uppercase text-[10px]">
                  <th className="py-2 px-2.5">ID</th>
                  <th className="py-2 px-2.5">Time</th>
                  <th className="py-2 px-2.5">Admin</th>
                  <th className="py-2 px-2.5">Action</th>
                  <th className="py-2 px-2.5">Target</th>
                  <th className="py-2 px-2.5">Before</th>
                  <th className="py-2 px-2.5">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      No matching log records found.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-800/50">
                      <td className="py-2 px-2.5 font-mono text-slate-400">#{entry.id}</td>
                      <td className="py-2 px-2.5 whitespace-nowrap text-slate-400">
                        {new Date(entry.createdAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="py-2 px-2.5 font-medium text-slate-200">
                        {entry.adminUsername || (entry.adminId ? `Admin #${entry.adminId}` : 'System')}
                      </td>
                      <td className="py-2 px-2.5">
                        <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-accent">
                          {entry.action}
                        </span>
                      </td>
                      <td className="py-2 px-2.5 text-slate-300 font-mono text-[11px]">
                        {entry.target || '—'}
                      </td>
                      <td className="py-2 px-2.5 font-mono text-[10px] text-slate-400 max-w-[150px] truncate" title={JSON.stringify(entry.before)}>
                        {entry.before ? JSON.stringify(entry.before).slice(0, 60) : '—'}
                      </td>
                      <td className="py-2 px-2.5 font-mono text-[10px] text-slate-300 max-w-[150px] truncate" title={JSON.stringify(entry.after)}>
                        {entry.after ? JSON.stringify(entry.after).slice(0, 60) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
          <div>
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (page > 1) {
                  setPage(page - 1);
                  fetchLogs(page - 1);
                }
              }}
              disabled={page <= 1}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:bg-slate-700 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => {
                if (page < totalPages) {
                  setPage(page + 1);
                  fetchLogs(page + 1);
                }
              }}
              disabled={page >= totalPages}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:bg-slate-700 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
