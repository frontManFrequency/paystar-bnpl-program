import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { actorFromToken } from './registry';
import type { Actor, Role } from './core';
import { MODEL_ID } from './db';

export const COOKIE = `ps_m${MODEL_ID}_session`;
export async function currentActor(): Promise<Actor | null> {
  const c = await cookies();
  return actorFromToken(c.get(COOKIE)?.value);
}
/** Page guard: unauthenticated → chooser; wrong role → forbidden page (server-side, not just hidden links). */
export async function requirePageRole(...roles: Role[]): Promise<Actor> {
  const a = await currentActor();
  if (!a) redirect('/?login=required');
  if (!roles.includes(a!.role)) redirect('/forbidden');
  return a!;
}
