/**
 * Runs a single sending tick from the command line.
 *
 * Usage: npm run worker:once
 *
 * Loads .env first (Node 24 process.loadEnvFile), then imports the app
 * modules, so DATABASE_URL and SESSION_SECRET are in place before the
 * Prisma client is constructed. An external scheduler can call this on
 * an interval, or call POST /api/worker/tick instead.
 */

// Module scope (like every other script in this folder) so the
// top-level main() below cannot collide with another script's.
export {};

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: rely on the ambient environment.
  }
  const { runSendTick } = await import("../src/lib/worker/sendTick");
  const summary = await runSendTick();
  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("worker:once failed", error);
    process.exit(1);
  });
