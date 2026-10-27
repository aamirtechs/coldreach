/**
 * Local load smoke, Phase 5.
 *
 * Fires a modest, defined request mix at a running `next start`
 * server from this machine and reports throughput and latency
 * percentiles. The numbers are indicative single-VM figures (the
 * app, the database, and the load generator share one small
 * machine); they are not production benchmarks and QA.md says so.
 *
 * Mix per round: landing page, login page, health endpoint, the
 * public API auth-rejection path, and one real static asset
 * discovered from the landing HTML. Each target has an expected
 * status; anything else counts as an error.
 *
 * Usage: SMOKE_BASE_URL=http://localhost:3100 npx tsx scripts/load-smoke.ts
 * Optional: LOAD_REQUESTS (default 300), LOAD_CONCURRENCY (default 10).
 */

export {};

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const TOTAL = Number(process.env.LOAD_REQUESTS ?? 300);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 10);

interface Target {
  name: string;
  path: string;
  expectedStatus: number;
}

interface Result {
  target: string;
  status: number;
  ms: number;
  ok: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function main(): Promise<void> {
  // Discover a real static asset from the landing page HTML.
  const landing = await fetch(`${BASE}/`);
  const html = await landing.text();
  const assetMatch = html.match(/\/_next\/static\/[^"']+/);
  const assetPath = assetMatch ? assetMatch[0] : "/favicon.ico";

  const targets: Target[] = [
    { name: "landing", path: "/", expectedStatus: 200 },
    { name: "login page", path: "/login", expectedStatus: 200 },
    { name: "health", path: "/api/health", expectedStatus: 200 },
    { name: "api 401 path", path: "/api/v1/leads", expectedStatus: 401 },
    { name: "static asset", path: assetPath, expectedStatus: 200 },
  ];

  // Warm-up: one request per target, also a liveness gate.
  for (const target of targets) {
    const response = await fetch(`${BASE}${target.path}`);
    await response.text();
    if (response.status !== target.expectedStatus) {
      console.log(
        `Warm-up mismatch on ${target.name}: got ${response.status}, expected ${target.expectedStatus}`,
      );
    }
  }

  const queue: Target[] = [];
  for (let i = 0; i < TOTAL; i += 1) {
    queue.push(targets[i % targets.length]);
  }

  const results: Result[] = [];
  let cursor = 0;
  const startedAt = Date.now();
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= queue.length) return;
      const target = queue[index];
      const start = performance.now();
      try {
        const response = await fetch(`${BASE}${target.path}`);
        await response.text();
        results.push({
          target: target.name,
          status: response.status,
          ms: performance.now() - start,
          ok: response.status === target.expectedStatus,
        });
      } catch {
        results.push({ target: target.name, status: 0, ms: performance.now() - start, ok: false });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const elapsedMs = Date.now() - startedAt;

  const errors = results.filter((result) => !result.ok);
  const latencies = results.map((result) => result.ms).sort((a, b) => a - b);
  console.log(
    `\nLoad smoke against ${BASE}: ${results.length} requests, concurrency ${CONCURRENCY}, ${(elapsedMs / 1000).toFixed(1)}s wall`,
  );
  console.log(`Errors: ${errors.length} (${((errors.length / results.length) * 100).toFixed(1)}%)`);
  console.log(
    `Latency overall: p50 ${percentile(latencies, 50).toFixed(0)}ms, p95 ${percentile(latencies, 95).toFixed(0)}ms, max ${latencies[latencies.length - 1]?.toFixed(0)}ms`,
  );
  for (const target of targets) {
    const own = results.filter((result) => result.target === target.name);
    const ownLatencies = own.map((result) => result.ms).sort((a, b) => a - b);
    const ownErrors = own.filter((result) => !result.ok).length;
    console.log(
      `  ${target.name.padEnd(12)} n=${own.length} errors=${ownErrors} p50=${percentile(ownLatencies, 50).toFixed(0)}ms p95=${percentile(ownLatencies, 95).toFixed(0)}ms`,
    );
  }
  if (errors.length > 0) {
    const sample = errors.slice(0, 5).map((e) => `${e.target}:${e.status}`).join(", ");
    console.log(`Error sample: ${sample}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Load smoke crashed", error);
  process.exit(1);
});
