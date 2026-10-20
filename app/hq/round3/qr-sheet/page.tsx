'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';

interface ZoneQR {
  id: number;
  name: string;
  token: string;
  dataUrl: string;
}

export default function R3QRSheetPage() {
  const [zones, setZones] = useState<ZoneQR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadQRs() {
      try {
        const res = await fetch('/api/admin/round3/zones');
        const data = await res.json();
        if (!data.ok) {
          setError(data.message || 'Failed to load zones');
          return;
        }

        const origin = window.location.origin;
        const withDataUrls: ZoneQR[] = await Promise.all(
          (data.zones || []).map(async (z: { id: number; name: string; token: string }) => {
            const url = `${origin}/s/${z.token}`;
            const dataUrl = await QRCode.toDataURL(url, {
              width: 320,
              margin: 2,
              color: {
                dark: '#000000',
                light: '#ffffff',
              },
            });
            return {
              id: z.id,
              name: z.name,
              token: z.token,
              dataUrl,
            };
          })
        );

        setZones(withDataUrls);
      } catch (err: any) {
        setError(err?.message || 'Error generating QR codes');
      } finally {
        setLoading(false);
      }
    }
    loadQRs();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 print:p-0 print:bg-white print:text-black">
      {/* Screen-only controls */}
      <div className="max-w-4xl mx-auto mb-6 flex items-center justify-between print:hidden">
        <div>
          <Link href="/hq/round3" className="text-sm text-cyan-400 hover:underline">
            &larr; Back to Round 3 Admin
          </Link>
          <h1 className="text-xl font-bold mt-1 text-slate-100">Round 3 Start QR Codes (Printable)</h1>
          <p className="text-xs text-slate-400">5 zone start QR codes formatted for half-A4 printing.</p>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium text-sm transition-colors shadow"
        >
          Print Sheet
        </button>
      </div>

      {loading && <div className="text-center py-12 text-slate-400">Generating QR codes...</div>}
      {error && <div className="text-center py-12 text-rose-400">{error}</div>}

      {!loading && !error && (
        <div className="max-w-4xl mx-auto space-y-8 print:space-y-0 print:max-w-none">
          {zones.map((zone, idx) => (
            <div
              key={zone.id}
              className={`p-8 border-2 border-slate-700 bg-slate-900 rounded-lg flex flex-col items-center justify-center text-center 
                print:border-2 print:border-black print:rounded-none print:bg-white print:p-8 print:h-[135mm] print:box-border
                ${(idx + 1) % 2 === 0 ? 'print:break-after-page' : 'print:mb-4'}`}
              style={{ pageBreakInside: 'avoid' }}
            >
              <div className="text-xs font-semibold tracking-widest uppercase text-slate-400 print:text-gray-600 mb-2">
                Campus Treasure Hunt &bull; Round 3 Start
              </div>
              <h2 className="text-2xl font-black text-slate-100 print:text-black mb-4">
                Zone {zone.id}: {zone.name}
              </h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={zone.dataUrl}
                alt={`QR for ${zone.name}`}
                className="w-64 h-64 border border-slate-200 rounded print:border-none"
              />
              <p className="text-sm text-slate-300 print:text-black font-medium mt-4">
                Scan this code to unlock the box riddles for your zone
              </p>
              <p className="text-xs font-mono text-slate-400 print:text-gray-500 mt-1">
                Token: {zone.token}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
