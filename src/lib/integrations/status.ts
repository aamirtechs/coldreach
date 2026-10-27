import type { PrismaClient } from "@prisma/client";
import { oauthProviderStatuses } from "@/lib/oauth/config";
import { aiConfigured, aiMissingEnv, AI_MODEL_DEFAULT } from "@/lib/ai/openai";
import { stripeMissingEnv } from "@/lib/billing/stripe";
import { hubspotConfigured, hubspotMissingEnv, HUBSPOT_PROVIDER } from "@/lib/crm/hubspot";
import { verifyProviderConfigured, verifyProviderMissingEnv } from "@/lib/verify/provider";
import { hasEncryptionKey } from "@/lib/security/crypto";

/**
 * Integration status for the Settings panel (Phase 6, Stage A).
 *
 * Every row is computed from the real configuration surface: env
 * presence checks from the owning modules plus database counts. No
 * secret value, and no part of one, is ever included: a row carries
 * only the names of the environment variables that are missing.
 * The activationAnchor points at the ACTIVATION.md section that
 * walks the owner through fixing that row.
 */

export interface IntegrationStatus {
  id: string;
  label: string;
  configured: boolean;
  /** Exact environment variable names still missing. Empty when configured. */
  missingEnv: string[];
  /** Human detail, for example a count or the active model. */
  detail: string;
  /** Anchor in ACTIVATION.md with the owner steps for this row. */
  activationAnchor: string;
}

const ACTIVATION_BASE = "https://github.com/aamirtechs/coldreach/blob/main/ACTIVATION.md";

export function activationUrl(anchor: string): string {
  return `${ACTIVATION_BASE}#${anchor}`;
}

export async function getIntegrationStatuses(
  db: PrismaClient,
  workspaceId: string,
): Promise<IntegrationStatus[]> {
  const rows: IntegrationStatus[] = [];

  for (const provider of oauthProviderStatuses()) {
    rows.push({
      id: `oauth-${provider.id}`,
      label: `${provider.label} mailbox OAuth`,
      configured: provider.configured,
      missingEnv: provider.missingEnv,
      detail: provider.configured
        ? "Connect flow is live on the Sending Accounts page."
        : "Connect buttons stay disabled until these are set.",
      activationAnchor: provider.id === "google" ? "2-google-oauth-gmail" : "3-microsoft-oauth-microsoft-365",
    });
  }

  rows.push({
    id: "encryption-key",
    label: "Credential encryption (ENCRYPTION_KEY)",
    configured: hasEncryptionKey(),
    missingEnv: hasEncryptionKey() ? [] : ["ENCRYPTION_KEY"],
    detail: hasEncryptionKey()
      ? "OAuth tokens, webhook secrets, and CRM tokens can be stored encrypted."
      : "Without it, mailbox, webhook, and CRM credentials cannot be stored.",
    activationAnchor: "1-before-you-start-encryption-key-and-app-url",
  });

  rows.push({
    id: "openai",
    label: "AI assistance (OpenAI)",
    configured: aiConfigured(),
    missingEnv: aiMissingEnv(),
    detail: aiConfigured()
      ? `Live with model ${process.env.AI_MODEL || AI_MODEL_DEFAULT}.`
      : 'AI panels show "AI is not configured" until OPENAI_API_KEY is set.',
    activationAnchor: "4-openai-api-key",
  });

  const stripeMissing = [
    ...stripeMissingEnv(),
    ...(process.env.STRIPE_WEBHOOK_SECRET ? [] : ["STRIPE_WEBHOOK_SECRET"]),
  ];
  rows.push({
    id: "stripe",
    label: "Stripe billing",
    configured: stripeMissing.length === 0,
    missingEnv: stripeMissing,
    detail:
      stripeMissing.length === 0
        ? "Checkout, the customer portal, and webhook sync are live."
        : "Billing runs on the manual plan override until Stripe is set.",
    activationAnchor: "5-stripe-billing",
  });

  const [smtpCount, webhookCount, hubspotConnection] = await Promise.all([
    db.sendingAccount.count({ where: { workspaceId, provider: "SMTP" } }),
    db.webhookEndpoint.count({ where: { workspaceId } }),
    db.crmConnection.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: HUBSPOT_PROVIDER } },
      select: { status: true, lastSyncAt: true },
    }),
  ]);

  rows.push({
    id: "smtp",
    label: "SMTP sending accounts",
    configured: smtpCount > 0,
    missingEnv: [],
    detail:
      smtpCount > 0
        ? `${smtpCount} SMTP account${smtpCount === 1 ? "" : "s"} in this workspace. Credentials resolve from server environment variables named by each account's credential reference.`
        : "No SMTP accounts in this workspace. Add one on the Sending Accounts page; its credentials live in server environment variables, never in the database.",
    activationAnchor: "7-production-verification-checklist",
  });

  rows.push({
    id: "webhooks",
    label: "Outbound webhooks",
    configured: webhookCount > 0,
    missingEnv: [],
    detail:
      webhookCount > 0
        ? `${webhookCount} endpoint${webhookCount === 1 ? "" : "s"} configured in this workspace.`
        : "No endpoints yet. Add one on the Integrations page to push events to Zapier, Make, or your own receiver.",
    activationAnchor: "7-production-verification-checklist",
  });

  rows.push({
    id: "verify",
    label: "Email verification provider (NeverBounce)",
    configured: verifyProviderConfigured(),
    missingEnv: verifyProviderMissingEnv(),
    detail: verifyProviderConfigured()
      ? "Provider checks refine the built-in verifier on lead lists."
      : "Built-in verification (syntax, disposable list, MX) always runs. The provider only refines it.",
    activationAnchor: "6-email-verification-provider-optional",
  });

  rows.push({
    id: "hubspot",
    label: "HubSpot CRM sync",
    configured: hubspotConfigured() && hubspotConnection?.status === "CONNECTED",
    missingEnv: hubspotMissingEnv(),
    detail: !hubspotConfigured()
      ? "Set the app credentials to enable the connect flow."
      : hubspotConnection?.status === "CONNECTED"
        ? `Connected. ${hubspotConnection.lastSyncAt ? `Last sync ${hubspotConnection.lastSyncAt.toISOString()}.` : "No sync run yet."}`
        : "App credentials are set. Connect the workspace from the HubSpot card in this panel.",
    activationAnchor: "8-hubspot-crm-sync",
  });

  return rows;
}
