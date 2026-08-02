import { supabase } from '@/lib/supabase';
import { getVisibleTenants } from '@/services/tenantService';

/** OAuth consent operations run with the authenticated browser session. */

export interface OAuthAuthorizationDetails {
  authorization_id?: string;
  redirect_uri?: string;
  redirect_url?: string;
  client?: {
    id?: string;
    name?: string;
    uri?: string;
    logo_uri?: string;
  } | null;
  scope?: string | null;
}

export interface OAuthConsentDecision {
  redirect_url: string;
}

export interface ConsentWorkspace {
  id: string;
  name: string;
  slug: string;
}

export const getAuthorizationDetails = async (
  authorizationId: string,
): Promise<OAuthAuthorizationDetails> => {
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error) throw new Error(error.message);
  const auth = data as Record<string, unknown>;

  // Supabase returns only redirect_url when this authorization request was
  // already approved (or previously resolved). Let the caller complete the
  // redirect instead of treating that valid response as malformed details.
  if (typeof auth?.redirect_url === 'string') {
    return { redirect_url: auth.redirect_url };
  }

  if (!auth?.authorization_id || !auth?.redirect_uri) {
    throw new Error('Authorization request could not be resolved.');
  }
  return {
    authorization_id: auth.authorization_id as string,
    redirect_uri: auth.redirect_uri as string,
    client: auth.client
      ? {
          id: (auth.client as Record<string, unknown>).id as string | undefined,
          name: (auth.client as Record<string, unknown>).name as string | undefined,
          uri: (auth.client as Record<string, unknown>).uri as string | undefined,
          logo_uri: (auth.client as Record<string, unknown>).logo_uri as string | undefined,
        }
      : null,
    scope: (auth.scope as string | null | undefined) ?? null,
  };
};

export const approveAuthorization = async (authorizationId: string): Promise<OAuthConsentDecision> => {
  const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId);
  if (error) throw new Error(error.message);
  const decision = data as Record<string, unknown>;
  const redirectUrl = typeof decision.redirect_url === 'string' ? decision.redirect_url : decision.redirect_to;
  if (typeof redirectUrl !== 'string') {
    throw new Error('Authorization approved, but no redirect URL was returned.');
  }
  return { redirect_url: redirectUrl };
};

export const denyAuthorization = async (authorizationId: string): Promise<OAuthConsentDecision | null> => {
  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId);
  if (error) throw new Error(error.message);
  const decision = data as Record<string, unknown>;
  const redirectUrl = typeof decision.redirect_url === 'string' ? decision.redirect_url : decision.redirect_to;
  return typeof redirectUrl === 'string' ? { redirect_url: redirectUrl } : null;
};

/**
 * Resolves the workspace the agent token will be bound to. The access token
 * hook binds the token to the consenting user's default tenant — the same
 * ordering rule used by public.default_tenant_for_user().
 */
export const getConsentWorkspace = async (): Promise<ConsentWorkspace | null> => {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const userId = userData.user?.id;
  if (!userId) return null;

  const { data: memberships, error: membershipError } = await supabase
    .from('tenant_users')
    .select('tenant_id, is_tenant_admin')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (membershipError) throw new Error(membershipError.message);
  if (!memberships || memberships.length === 0) return null;

  const visibleTenants = await getVisibleTenants();
  const tenantsById = new Map(visibleTenants.map((tenant) => [tenant.id, tenant]));

  const ordered = [...memberships].sort((a, b) => Number(b.is_tenant_admin) - Number(a.is_tenant_admin));
  for (const membership of ordered) {
    const tenant = tenantsById.get(membership.tenant_id);
    if (tenant) {
      return { id: tenant.id, name: tenant.name, slug: tenant.slug };
    }
  }
  return null;
};
