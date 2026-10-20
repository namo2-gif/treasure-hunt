'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminFetch, AdminFetchError } from '@/lib/admin-fetch';
import ErrorBanner from '@/components/hq/ErrorBanner';

interface QRLocation {
  id: number;
  name: string;
  token: string;
  capacity: number;
  active: boolean;
  link: string;
  run1Count: number;
  run2Count: number;
}

export default function AdminQRManagementPage() {
  const router = useRouter();
  const [qrs, setQrs] = useState<QRLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New QR form
  const [newName, setNewName] = useState('');
  const [newCapacity, setNewCapacity] = useState(12);
  const [creating, setCreating] = useState(false);

  // Edit capacity state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCapacityVal, setEditCapacityVal] = useState<number>(12);

  async function fetchQRs() {
    try {
      const data = await adminFetch<any>('/api/admin/qr');
      if (data.ok) {
        setQrs(data.qrs);
      } else {
        setError(data.message || 'Failed to fetch QR locations');
      }
    } catch (err: any) {
      if (err instanceof AdminFetchError && err.status === 401) return;
      setError(err?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchQRs();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    setCreating(true);
    setError(null);
    try {
      const data = await adminFetch<any>('/api/admin/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), capacity: newCapacity }),
      });
      if (data.ok) {
        setNewName('');
        setNewCapacity(12);
        await fetchQRs();
      } else {
        setError(data.message || 'Failed to create QR location');
      }
    } catch (err: any) {
      setError(err?.message || 'Network error creating QR');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(qr: QRLocation) {
    try {
      const data = await adminFetch<any>(`/api/admin/qr/${qr.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !qr.active }),
      });
      if (data.ok) {
        await fetchQRs();
      } else {
        alert(data.message || 'Update failed');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  }

  async function handleSaveCapacity(id: number) {
    try {
      const data = await adminFetch<any>(`/api/admin/qr/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capacity: editCapacityVal }),
      });
      if (data.ok) {
        setEditingId(null);
        await fetchQRs();
      } else {
        alert(data.message || 'Update failed');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  }

  async function handleRegenerateToken(id: number) {
    if (!window.confirm('Regenerate token for this QR? Any physical printed copies with the old code will stop working.')) {
      return;
    }
    try {
      const data = await adminFetch<any>(`/api/admin/qr/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerateToken: true }),
      });
      if (data.ok) {
        await fetchQRs();
      } else {
        alert(data.message || 'Regeneration failed');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!window.confirm(`Delete QR location "${name}"?`)) return;

    try {
      const data = await adminFetch<any>(`/api/admin/qr/${id}`, { method: 'DELETE' });
      if (data.ok) {
        await fetchQRs();
      } else {
        alert(`Cannot delete: ${data.message}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  }

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-slate-800">
        <div>
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-accent/20 text-accent rounded border border-accent/30">
            Checkpoints & Capacity
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            QR Location Management
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/hq/qr/print"
            target="_blank"
            className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-accent hover:bg-amber-400 text-slate-950 transition-colors shadow"
          >
            🖨️ Printable QR Sheet (4/A4)
          </Link>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={fetchQRs} />

      {/* Add New QR Form */}
      <div className="mt-6 p-5 rounded-xl bg-slate-800/80 border border-slate-700">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide mb-3">
          Add New QR Location
        </h2>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Location / Poster Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Science Hallway 2F"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent"
            />
          </div>

          <div className="w-28">
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Capacity (Cap)
            </label>
            <input
              type="number"
              min="1"
              max="100"
              required
              value={newCapacity}
              onChange={(e) => setNewCapacity(parseInt(e.target.value) || 12)}
              className="w-full px-3 py-2 text-xs rounded bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent"
            />
          </div>

          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 text-xs font-bold rounded bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-500 transition-colors disabled:opacity-50"
          >
            {creating ? 'Adding...' : '+ Add QR'}
          </button>
        </form>
      </div>

      {/* QR List Table */}
      <div className="mt-6 rounded-xl bg-slate-800/80 border border-slate-700 overflow-hidden shadow">
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
            Locations ({qrs.length} total, {qrs.filter((q) => q.active).length} active)
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading locations...</div>
        ) : qrs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">No QR locations registered yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-700">
                <tr>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-3">Token & Link</th>
                  <th className="py-3 px-3">Capacity</th>
                  <th className="py-3 px-3">Occupancy</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {qrs.map((qr) => (
                  <tr key={qr.id} className="hover:bg-slate-700/20 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-100">{qr.name}</td>
                    <td className="py-3 px-3 font-mono text-[11px]">
                      <span className="text-accent">{qr.token.slice(0, 8)}...</span>
                      <a
                        href={`/s/${qr.token}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-slate-400 hover:text-slate-200 underline text-[10px]"
                      >
                        [Test URL]
                      </a>
                    </td>
                    <td className="py-3 px-3">
                      {editingId === qr.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={editCapacityVal}
                            onChange={(e) => setEditCapacityVal(parseInt(e.target.value) || 1)}
                            className="w-14 px-1.5 py-0.5 text-xs rounded bg-slate-900 border border-slate-600 text-slate-100"
                          />
                          <button
                            onClick={() => handleSaveCapacity(qr.id)}
                            className="px-1.5 py-0.5 text-[10px] bg-emerald-600 text-white rounded font-bold"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-1.5 py-0.5 text-[10px] bg-slate-700 text-slate-300 rounded"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={() => {
                            setEditingId(qr.id);
                            setEditCapacityVal(qr.capacity);
                          }}
                          className="cursor-pointer hover:text-accent font-semibold underline decoration-dotted"
                          title="Click to edit capacity"
                        >
                          {qr.capacity} players
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-400">
                      R1: <span className="text-slate-100 font-bold">{qr.run1Count}</span> | R2:{' '}
                      <span className="text-slate-100 font-bold">{qr.run2Count}</span>
                    </td>
                    <td className="py-3 px-3">
                      <button
                        onClick={() => handleToggleActive(qr)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors ${
                          qr.active
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : 'bg-red-500/20 text-red-400 border border-red-500/40'
                        }`}
                      >
                        {qr.active ? 'Active' : 'Deactivated'}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        onClick={() => handleRegenerateToken(qr.id)}
                        className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600"
                        title="Regenerate token"
                      >
                        New Token
                      </button>
                      <button
                        onClick={() => handleDelete(qr.id, qr.name)}
                        className="px-2 py-1 text-[11px] rounded bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800"
                        title="Delete location"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
