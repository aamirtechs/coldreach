import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient, SubscriptionKey } from "@prisma/client";
import { KEY_PLAN_IDS, getPlan, type PlanId } from "@/lib/domain/plans";
import { getOrCreateSubscription } from "./subscription";

/**
 * Subscription keys (v1.32.0).
 *
 * The platform owner generates keys in the admin panel, one batch
 * per plan. A key is a random code shown in full exactly once, at
 * generation; the database stores only its SHA-256 hash plus a
 * display hint (first and last group), so a leaked database never
 * leaks a usable key.
 *
 * A workspace owner redeems a key on the Billing page. Redemption
 * sets the workspace's plan to the key's plan and grants
 * durationDays of paid time: when the workspace still has paid time
 * left on a timed plan, the new days stack on top of the current
 * period end, so renewing early never loses days. Plans granted by
 * hand (no period end) are replaced, with the key's days counted
 * from the redemption moment.
 */

const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1
const KEY_GROUPS = 4;
const KEY_GROUP_SIZE = 4;
export const KEY_STATUSES = ["UNUSED", "REDEEMED", "REVOKED"] as const;
export type SubscriptionKeyStatus = (typeof KEY_STATUSES)[number];

export function isKeyStatus(value: string): value is SubscriptionKeyStatus {
  return (KEY_STATUSES as readonly string[]).includes(value);
}

/** "CR-AB12-CD34-EF56-GH78" with a fresh random body. */
export function generateKeyCode(): string {
  const bytes = randomBytes(KEY_GROUPS * KEY_GROUP_SIZE);
  const chars: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    chars.push(KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length]);
  }
  const groups: string[] = [];
  for (let g = 0; g < KEY_GROUPS; g += 1) {
    groups.push(chars.slice(g * KEY_GROUP_SIZE, (g + 1) * KEY_GROUP_SIZE).join(""));
  }
  return `CR-${groups.join("-")}`;
}

/** Canonical form used for hashing: letters and digits only, upper case. */
export function canonicalKeyCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashKeyCode(input: string): string {
  return createHash("sha256").update(canonicalKeyCode(input)).digest("hex");
}

/** "CR-AB12-****-****-GH78": enough to identify a key, never to use it. */
export function keyHintOf(code: string): string {
  const groups = code.split("-");
  if (groups.length !== KEY_GROUPS + 1) return "CR-****";
  return `CR-${groups[1]}-****-****-${groups[KEY_GROUPS]}`;
}

export interface GeneratedKey {
  id: string;
  /** The full code. Returned once, at generation, and never stored. */
  code: string;
  plan: PlanId;
  durationDays: number;
}

export async function generateSubscriptionKeys(
  db: PrismaClient,
  args: {
    plan: PlanId;
    count: number;
    durationDays: number;
    createdByUserId?: string | null;
    note?: string | null;
  },
): Promise<GeneratedKey[]> {
  if (!KEY_PLAN_IDS.includes(args.plan)) {
    throw new Error("Keys can only be generated for a paid plan (Starter, Growth, or Pro).");
  }
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 100) {
    throw new Error("Generate between 1 and 100 keys at a time.");
  }
  if (!Number.isInteger(args.durationDays) || args.durationDays < 1 || args.durationDays > 366) {
    throw new Error("Key duration must be between 1 and 366 days.");
  }
  const generated: GeneratedKey[] = [];
  for (let i = 0; i < args.count; i += 1) {
    // A hash collision is astronomically unlikely; retry a few times
    // anyway so a batch can never fail halfway on one.
    let created: SubscriptionKey | null = null;
    let code = "";
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      code = generateKeyCode();
      try {
        created = await db.subscriptionKey.create({
          data: {
            codeHash: hashKeyCode(code),
            codeHint: keyHintOf(code),
            plan: args.plan,
            durationDays: args.durationDays,
            note: args.note?.trim() ? args.note.trim() : null,
            createdByUserId: args.createdByUserId ?? null,
          },
        });
      } catch {
        created = null;
      }
    }
    if (!created) throw new Error("Could not generate a unique key. Try again.");
    generated.push({ id: created.id, code, plan: args.plan, durationDays: args.durationDays });
  }
  return generated;
}

export interface ListedKey {
  id: string;
  codeHint: string;
  plan: PlanId;
  planName: string;
  durationDays: number;
  status: string;
  note: string | null;
  createdAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
  redeemedByWorkspaceId: string | null;
  redeemedByWorkspaceName: string | null;
}

export async function listSubscriptionKeys(
  db: PrismaClient,
  args: { status?: string | null; limit?: number } = {},
): Promise<{ keys: ListedKey[]; counts: Record<string, number> }> {
  const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
  const [rows, grouped] = await Promise.all([
    db.subscriptionKey.findMany({
      where: args.status && isKeyStatus(args.status) ? { status: args.status } : {},
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { redeemedByWorkspace: { select: { name: true } } },
    }),
    db.subscriptionKey.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const counts: Record<string, number> = { UNUSED: 0, REDEEMED: 0, REVOKED: 0 };
  for (const row of grouped) counts[row.status] = row._count._all;
  return {
    counts,
    keys: rows.map((row) => ({
      id: row.id,
      codeHint: row.codeHint,
      plan: row.plan as PlanId,
      planName: getPlan(row.plan as PlanId).name,
      durationDays: row.durationDays,
      status: row.status,
      note: row.note,
      createdAt: row.createdAt,
      redeemedAt: row.redeemedAt,
      revokedAt: row.revokedAt,
      redeemedByWorkspaceId: row.redeemedByWorkspaceId,
      redeemedByWorkspaceName: row.redeemedByWorkspace?.name ?? null,
    })),
  };
}

/** Revokes an UNUSED key. Redeemed keys keep the time they granted. */
export async function revokeSubscriptionKey(db: PrismaClient, id: string): Promise<ListedKey> {
  const existing = await db.subscriptionKey.findUnique({
    where: { id },
    include: { redeemedByWorkspace: { select: { name: true } } },
  });
  if (!existing) throw new Error("Key not found.");
  if (existing.status === "REDEEMED") {
    throw new Error("This key was already redeemed. The time it granted is not taken back.");
  }
  if (existing.status === "REVOKED") throw new Error("This key is already revoked.");
  const updated = await db.subscriptionKey.update({
    where: { id },
    data: { status: "REVOKED", revokedAt: new Date() },
    include: { redeemedByWorkspace: { select: { name: true } } },
  });
  return {
    id: updated.id,
    codeHint: updated.codeHint,
    plan: updated.plan as PlanId,
    planName: getPlan(updated.plan as PlanId).name,
    durationDays: updated.durationDays,
    status: updated.status,
    note: updated.note,
    createdAt: updated.createdAt,
    redeemedAt: updated.redeemedAt,
    revokedAt: updated.revokedAt,
    redeemedByWorkspaceId: updated.redeemedByWorkspaceId,
    redeemedByWorkspaceName: updated.redeemedByWorkspace?.name ?? null,
  };
}

export interface RedeemResult {
  plan: PlanId;
  planName: string;
  durationDays: number;
  currentPeriodEnd: Date;
}

/**
 * Redeems a key for a workspace. Throws an Error with a customer-safe
 * message for every failure (unknown, revoked, already used).
 */
export async function redeemSubscriptionKey(
  db: PrismaClient,
  args: { workspaceId: string; code: string; now?: Date },
): Promise<RedeemResult> {
  const now = args.now ?? new Date();
  const codeHash = hashKeyCode(args.code ?? "");
  const key = await db.subscriptionKey.findUnique({ where: { codeHash } });
  if (!key) throw new Error("That key is not recognized. Check it and try again.");
  if (key.status === "REVOKED") throw new Error("That key has been revoked.");
  if (key.status === "REDEEMED") throw new Error("That key has already been used.");

  const subscription = await getOrCreateSubscription(db, args.workspaceId);
  const stillTimed =
    subscription.plan !== "FREE" &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd > now;
  const base = stillTimed ? (subscription.currentPeriodEnd as Date) : now;
  const currentPeriodEnd = new Date(base.getTime() + key.durationDays * 24 * 60 * 60 * 1000);

  // Claim the key first with a status guard, so two simultaneous
  // redemptions of the same code can never both succeed.
  const claimed = await db.subscriptionKey.updateMany({
    where: { id: key.id, status: "UNUSED" },
    data: { status: "REDEEMED", redeemedByWorkspaceId: args.workspaceId, redeemedAt: now },
  });
  if (claimed.count === 0) throw new Error("That key has already been used.");

  await db.subscription.update({
    where: { workspaceId: args.workspaceId },
    data: {
      plan: key.plan,
      status: "ACTIVE",
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
    },
  });

  const plan = key.plan as PlanId;
  return { plan, planName: getPlan(plan).name, durationDays: key.durationDays, currentPeriodEnd };
}
