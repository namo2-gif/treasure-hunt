'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

const HQNav = () => (
  <nav className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs font-medium text-slate-400">
    <Link href="/hq" className="hover:text-accent transition-colors">Dashboard</Link>
    <Link href="/hq/teams" className="hover:text-accent transition-colors">Teams & Students</Link>
    <Link href="/hq/selection" className="hover:text-accent transition-colors">Selection</Link>
    <Link href="/hq/content" className="hover:text-accent transition-colors">Content</Link>
    <Link href="/hq/qr" className="hover:text-accent transition-colors">QR Locations</Link>
    <Link href="/hq/interventions" className="hover:text-accent transition-colors">Interventions</Link>
    <Link href="/hq/logs" className="hover:text-accent transition-colors">Log & Export</Link>
    <Link href="/hq/settings" className="text-accent">Settings</Link>
  </nav>
);

interface SettingItem {
  key: string;
  value: any;
  locked: boolean;
  label: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [editValues, setEditValues] = useState<{ [key: string]: any }>({});
  const [loading, setLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ [key: string]: { ok: boolean; text: string } }>({});

  async function loadSettings() {
    try {
      const res = await fetch('/api/admin/settings');
      const data = await res.json();
      if (data.ok && data.settings) {
        setSettings(data.settings);
        const map: { [key: string]: any } = {};
        for (const s of data.settings) {
          map[s.key] = s.value;
        }
        setEditValues(map);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
    const interval = setInterval(loadSettings, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleSave(key: string) {
    setUpdatingKey(key);
    setMessages((prev) => ({ ...prev, [key]: { ok: true, text: 'Saving...' } }));
    try {
      const val = editValues[key];
      const parsedVal = isNaN(Number(val)) ? val : Number(val);

      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: parsedVal }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessages((prev) => ({ ...prev, [key]: { ok: true, text: 'Saved successfully' } }));
        await loadSettings();
      } else {
        setMessages((prev) => ({ ...prev, [key]: { ok: false, text: data.message || data.code || 'Failed to save' } }));
      }
    } catch (e: any) {
      setMessages((prev) => ({ ...prev, [key]: { ok: false, text: e.message || 'Network error' } }));
    } finally {
      setUpdatingKey(null);
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="pb-4 border-b border-slate-700">
        <div>
          <span className="px-2 py-0.5 text-xs font-semibold uppercase bg-accent/20 text-accent rounded">HQ</span>
          <h1 className="text-xl font-bold text-slate-100 mt-1">System Settings</h1>
        </div>
        <HQNav />
      </div>

      <div className="mt-6 p-4 sm:p-5 rounded-xl bg-slate-800/80 border border-slate-700">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide mb-1">
          Configuration & Locks
        </h2>
        <p className="text-xs text-slate-400 mb-5">
          Settings automatically lock based on the current event phase per specification.
        </p>

        {loading && settings.length === 0 ? (
          <div className="text-xs text-slate-400 py-6 text-center">Loading settings...</div>
        ) : (
          <div className="space-y-4">
            {settings.map((s) => {
              const msg = messages[s.key];
              return (
                <div
                  key={s.key}
                  className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200">{s.label}</span>
                      <code className="text-[10px] text-slate-400 font-mono">({s.key})</code>
                      {s.locked ? (
                        <span className="px-1.5 py-0.5 text-[10px] uppercase font-bold bg-amber-950/60 text-amber-400 border border-amber-800 rounded">
                          🔒 Locked
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[10px] uppercase font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-800 rounded">
                          Editable
                        </span>
                      )}
                    </div>
                    {s.locked && (
                      <p className="text-[10px] text-amber-400/80 mt-1">
                        Locked: Phase has moved past the allowed configuration window.
                      </p>
                    )}
                    {msg && (
                      <div
                        className={`text-[11px] mt-1 ${
                          msg.ok ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {msg.text}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <input
                      type="number"
                      disabled={s.locked || updatingKey === s.key}
                      value={editValues[s.key] !== undefined ? editValues[s.key] : ''}
                      onChange={(e) =>
                        setEditValues({
                          ...editValues,
                          [s.key]: e.target.value,
                        })
                      }
                      className="flex-1 sm:w-28 min-w-0 px-2.5 py-1.5 text-xs rounded bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent disabled:opacity-50 disabled:bg-slate-950"
                    />
                    <button
                      disabled={s.locked || updatingKey === s.key}
                      onClick={() => handleSave(s.key)}
                      className="px-4 py-1.5 text-xs font-semibold rounded bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-500 transition-colors disabled:opacity-40 shrink-0"
                    >
                      {updatingKey === s.key ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
