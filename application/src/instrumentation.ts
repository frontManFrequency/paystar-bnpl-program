export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { writePidFile, getDb } = await import('./server/db');
    writePidFile();
    await getDb(); // migrate + seed on first start; reopen persisted data afterwards
  }
}
