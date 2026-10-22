import { redirect } from 'next/navigation';
import { getPlayerSession } from '@/lib/session';
import Game from '@/components/Game';
import ClientLogoutButton from './ClientLogoutButton';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await getPlayerSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <main className="w-full max-w-player min-h-screen flex flex-col p-4 pt-20 mx-auto">
      <div className="flex flex-col flex-1 w-full mx-auto py-2">
        <Game />
        <div className="w-full mt-8">
          <ClientLogoutButton />
        </div>
      </div>
    </main>
  );
}
