import { NextResponse } from "next/server";
import { apiError, requireSession } from "@/lib/api";
import { getOAuthConfig, isOAuthProviderId, missingProviderEnv, type OAuthProviderId } from "@/lib/oauth/config";
import { createOAuthState } from "@/lib/oauth/state";

/**
 * Starts an OAuth connection for Gmail or Microsoft 365.
 *
 * When the provider's client credentials are not configured on this
 * server the route answers with a plain JSON error naming the missing
 * environment variables. It never redirects to a consent screen that
 * cannot work, and the Accounts UI mirrors this state.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { provider } = await params;
  if (!isOAuthProviderId(provider)) {
    return NextResponse.json({ error: `Unknown OAuth provider "${provider}"` }, { status: 404 });
  }
  const id: OAuthProviderId = provider;
  const config = getOAuthConfig(id);
  if (!config) {
    return NextResponse.json(
      {
        error: `${id} OAuth is not configured on this server. Set ${missingProviderEnv(id).join(" and ")} in the environment, then try again. See INTEGRATIONS.md.`,
        missingEnv: missingProviderEnv(id),
      },
      { status: 501 },
    );
  }
  try {
    const state = await createOAuthState({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      provider: id,
    });
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scopes.join(" "));
    url.searchParams.set("state", state);
    if (id === "google") {
      // offline access + forced consent is what guarantees Google
      // issues a refresh token, which long lived sending depends on.
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
    } else {
      url.searchParams.set("response_mode", "query");
    }
    return NextResponse.redirect(url.toString());
  } catch (error) {
    return apiError(error);
  }
}
