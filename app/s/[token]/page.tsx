import { redirect } from 'next/navigation';
import { getPlayerSession } from '@/lib/session';
import ScanClient from './ScanClient';

export const dynamic = 'force-dynamic';

export default async function ScanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getPlayerSession();

  // 1. No valid session: redirect to /login?next=/s/<token> (Section 7.2)
  if (!session) {
    redirect(`/login?next=/s/${encodeURIComponent(token)}`);
  }

  // 2. With session: render small page where client JS POSTs /api/scan
  return (
    <main className="w-full max-w-player min-h-screen flex flex-col p-4 mx-auto items-center justify-center">
      <ScanClient token={token} />
    </main>
  );
}
