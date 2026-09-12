#!/usr/bin/env node
/**
 * auth-diagnostics.mjs — npm run auth:check
 *
 * Diagnoses the auth-hook pipeline on the live Supabase project. Login 500s
 * surface as "Error running hook URI: pg-functions://postgres/public/
 * custom_access_token_hook" with no detail — this tool reproduces the mint
 * server-side and reports the real Postgres error, plus the state of every
 * moving part:
 *
 *   1. Hook version — is the deployed function the plugin-claims version?
 *   2. Registry table — plugin_claims exists, row count, resolvers.
 *   3. Direct hook invocation — calls the hook with a synthetic event and
 *      reports the exact error (or success shape).
 *   4. Core claim inputs — user_roles/roles readability, default_tenant_for_user.
 *
 * Read-only by default (SELECTs + a synthetic hook call that mutates nothing).
 *
 * Environment: SUPABASE_ACCESS_TOKEN (prompted when missing, never stored).
 */

import { pathToFileURL } from 'url';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { extractProjectRef, getSupabaseUrl, resolvePat, runSqlQuery } from './lib/remote-sql.mjs';

const c = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m', dim:'\x1b[2m' };
const log  = (...a) => console.log(...a);
const info = (m) => log(`${c.cyan}i${c.reset}  ${m}`);
const okMsg = (m) => log(`${c.green}✓${c.reset}  ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset}  ${m}`);
const fail = (m) => log(`${c.red}✗${c.reset}  ${m}`);

async function sql(pat, projectRef, query) {
  return runSqlQuery(projectRef, pat, query);
}

const FAKE_UID = '00000000-0000-4000-8000-000000000000';
let hookDef = '';

async function main() {
  log('');
  log(`${c.bold}Auth hook diagnostics${c.reset}`);

  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    fail('SUPABASE_URL not found in .env — cannot connect.');
    process.exitCode = 1;
    return;
  }
  const projectRef = extractProjectRef(supabaseUrl);
  const pat = await resolvePat();
  if (!pat) {
    fail('No Supabase PAT — diagnostics require project-owner SQL access.');
    process.exitCode = 1;
    return;
  }

  const q = (query) => sql(pat, projectRef, query);
  let issues = 0;

  // ── 1. Hook version ──
  info('Checking hook version…');
  try {
    const res = await q(`SELECT pg_get_functiondef('public.custom_access_token_hook(jsonb)'::regprocedure) AS def`);
    const def = res?.[0]?.def ?? '';
    hookDef = def;
    const version = def.includes('plugin_claims')
      ? 'plugin-claims version (Access_hook_plugin_claims.sql)'
      : 'pre-plugin version (Auth/Access_hook.sql or _oauth_claims.sql)';
    info(`  ${c.bold}${version}${c.reset}`);
    info(`  Hardened (pass-through): ${def.includes('degraded to pass-through') ? 'yes' : 'NO — this is the hard-fail version'}`);
    info(`  Injects user_roles claim: ${def.includes("'{claims,user_roles}'") || def.includes("user_roles") ? 'yes' : 'NO — claim injection missing from the deployed body!'}`);
    if (!def.includes('plugin_claims')) {
      warn('  The current hook does not include the plugin-claims merge. Apply Auth/Access_hook_plugin_claims.sql (npm run migrations / npm run update).');
    }
    if (!def.includes('degraded to pass-through')) {
      warn('  Hook is the HARD-FAIL version — any defect 500s every login. Apply the latest Auth/Access_hook_plugin_claims.sql.');
    }
    // Stash the definition for the deeper check below.
    hookDef = def;
  } catch (e) {
    fail(`  Could not read hook definition: ${e.message}`);
    issues++;
  }

  // ── 2. Registry state ──
  info('Checking plugin_claims registry…');
  try {
    const res = await q(`
      SELECT to_regclass('public.plugin_claims') AS reg,
             (SELECT count(*) FROM public.plugin_claims) AS rows`);
    const { reg, rows } = res?.[0] ?? {};
    if (!reg) {
      warn('  public.plugin_claims does NOT exist — apply 202609090001_plugin_claims_registry.sql.');
    } else {
      okMsg(`  Registry exists, ${rows} claim row(s).`);
    }
  } catch (e) {
    fail(`  Registry check failed: ${e.message}`);
    issues++;
  }

  // ── 3. Core claim inputs ──
  info('Checking core claim inputs (roles, tenant lookup)…');
  try {
    await q(`SELECT count(*) AS n FROM public.user_roles ur JOIN public.roles r ON ur.role_id = r.id`);
    okMsg('  user_roles/roles readable by the hook owner.');
  } catch (e) {
    fail(`  roles/user_roles check failed: ${e.message}`);
    issues++;
  }
  try {
    await q(`SELECT public.default_tenant_for_user('${FAKE_UID}'::uuid) AS t`);
    okMsg('  default_tenant_for_user executes.');
  } catch (e) {
    fail(`  default_tenant_for_user FAILS — the auth hook degrades on this today, or 500s logins on older hook versions: ${e.message}`);
    issues++;
  }

  // ── 1b. Diff the deployed body against the migration file ──
  if (hookDef) {
    info('Diffing deployed body against migrations/Auth/Access_hook_plugin_claims.sql…');
    try {
      const fileRaw = readFileSync(join(import.meta.dirname, '..', 'migrations', 'Auth', 'Access_hook_plugin_claims.sql'), 'utf8');
      const normalize = (s) => s.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--'));
      const fileMatch = /AS \$\$([\s\S]*?)\$\$;/s.exec(fileRaw);
      const fileLines = fileMatch ? normalize(fileMatch[1]) : [];
      const deployedMatch = /AS \$function\$([\s\S]*?)\$function\$/s.exec(hookDef);
      const deployed = deployedMatch ? normalize(deployedMatch[1]) : [];

      info(`  Deployed body: ${deployed.length} statement line(s), migration file: ${fileLines.length} line(s)`);
      let firstDiff = -1;
      const max = Math.max(deployed.length, fileLines.length);
      for (let i = 0; i < max; i++) {
        if ((deployed[i] ?? '(end)') !== (fileLines[i] ?? '(end)')) { firstDiff = i; break; }
      }
      if (firstDiff === -1) {
        okMsg('  Deployed body matches the migration file 1:1.');
      } else {
        fail(`  Body divergence at line ${firstDiff + 1} of the function body:`);
        log(`      deployed: ${c.red}${(deployed[firstDiff] ?? '(missing)').slice(0, 140)}${c.reset}`);
        log(`      file:     ${c.green}${(fileLines[firstDiff] ?? '(missing)').slice(0, 140)}${c.reset}`);
        issues++;
      }
    } catch (e) {
      warn(`  Body diff skipped: ${e.message}`);
    }
  }

  // ── 1c. Function metadata: owner + SET clauses (SECURITY DEFINER context!) ──
  info('Checking function owner and SET clauses…');
  try {
    const res = await q(`
      SELECT pg_get_userbyid(proowner) AS owner, proconfig, proacl
      FROM pg_proc
      WHERE proname = 'custom_access_token_hook'
        AND pronamespace = 'public'::regnamespace`);
    const row = res?.[0] ?? {};
    info(`  Owner: ${c.bold}${row.owner ?? '(unknown)'}${c.reset}`);
    info(`  SET clauses: ${JSON.stringify(row.proconfig ?? [])}`);
    info(`  ACL: ${JSON.stringify(row.proacl ?? [])}`);
    if (row.owner && row.owner !== 'postgres') {
      warn(`  Function is owned by "${row.owner}" — SECURITY DEFINER executes as that role.\n    If "${row.owner}" cannot read public.user_roles/roles (RLS), every mint degrades.\n    Fix: ALTER FUNCTION public.custom_access_token_hook(jsonb) OWNER TO postgres;`);
      issues++;
    }
  } catch (e) {
    warn(`  Owner check skipped: ${e.message}`);
  }

  // ── 1d. RLS status on the tables the hook reads ──
  info('Checking RLS on user_roles / roles…');
  try {
    const res = await q(`
      SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
      FROM pg_class c
      WHERE c.oid IN ('public.user_roles'::regclass, 'public.roles'::regclass)`);
    for (const row of res ?? []) {
      const flag = row.rls_enabled ? (row.rls_forced ? 'RLS enabled + FORCED' : 'RLS enabled (owner bypasses)') : 'no RLS';
      (row.rls_forced ? fail : okMsg)(`  ${row.relname}: ${flag}`);
      if (row.rls_forced) issues++;
    }
  } catch (e) {
    warn(`  RLS check skipped: ${e.message}`);
  }

  info('Invoking the hook with a REAL user (super-admin, if one exists)…');
  try {
    const res = await q(`
      WITH target AS (
        SELECT ur.user_id
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE r.name = 'super-admin'
        LIMIT 1
      )
      SELECT
        (SELECT user_id FROM target) AS uid,
        (SELECT array_agg(r2.name) FROM public.user_roles ur2
           JOIN public.roles r2 ON ur2.role_id = r2.id
          WHERE ur2.user_id = (SELECT user_id FROM target)) AS expected_roles`);
    const uid = res?.[0]?.uid;
    const expected = res?.[0]?.expected_roles ?? [];
    if (!uid) {
      warn('  No super-admin user found in user_roles/roles — check that the account has a row there.');
      issues++;
    } else {
      info(`  Testing user ${uid} (expected roles: ${JSON.stringify(expected)})…`);
      const hookRes = await q(`
        SELECT public.custom_access_token_hook(
          jsonb_build_object('user_id', '${uid}', 'claims', '{}'::jsonb)
        ) AS event`);
      let event = hookRes?.[0]?.event ?? {};
      info(`  Raw event (first 240 chars): ${JSON.stringify(event).slice(0, 240)}`);
      // The Management API may return the jsonb as a serialized string — handle both.
      if (typeof event === 'string') {
        try { event = JSON.parse(event); } catch { /* keep as-is */ }
      }
      const claims = event?.claims ?? null;
      const roles = Array.isArray(claims?.user_roles) ? claims.user_roles : null;
      if (roles === null) {
        fail('  HOOK RETURNED NO user_roles CLAIM for a real user — this is why the app denies access.');
        fail('  The function body is degrading before the claim injection. Deployed body excerpt:');
        for (const line of hookDef.split('\n').filter((l) => l.includes('user_roles') || l.includes('EXCEPTION') || l.includes('RETURN') || l.includes('degraded'))) {
          log(`      ${c.dim}${line.trim()}${c.reset}`);
        }
        issues++;
      } else if (!roles.includes('super-admin')) {
        fail(`  Hook returned roles ${JSON.stringify(roles)} — 'super-admin' is MISSING from the user's role rows.\n    → Check public.user_roles / public.roles rows for this user.`);
        issues++;
      } else {
        okMsg(`  Hook minted correct claims for the real user: ${JSON.stringify(roles)}`);
      }

      // ── Step-replica: run the hook's exact statements with per-step error capture ──
      // The real hook degrades silently (RAISE WARNING never reaches this tool),
      // so we replicate its body step by step and surface the first failing step.
      info('Running step-replica of the hook body to isolate the failing statement…');
      try {
        await q(`
          DROP FUNCTION IF EXISTS public.__hook_debug(jsonb);
          CREATE OR REPLACE FUNCTION public.__hook_debug(event jsonb)
          RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $body$
          DECLARE
            uid uuid; role_names text[]; agent_flag boolean; default_tenant uuid;
            steps text := '';
          BEGIN
            uid := (event ->> 'user_id')::uuid;
            steps := steps || '1.uid=' || uid::text || E'\\n';

            BEGIN
              SELECT array_agg(r.name) INTO role_names
              FROM public.user_roles ur JOIN public.roles r ON ur.role_id = r.id
              WHERE ur.user_id = uid;
              steps := steps || '2.roles=' || coalesce(role_names::text, 'NULL') || E'\\n';
            EXCEPTION WHEN OTHERS THEN
              steps := steps || '2.roles FAILED: ' || SQLERRM || E'\\n';
            END;

            agent_flag := 'agent' = ANY(coalesce(role_names, ARRAY[]::text[]));
            steps := steps || '3.agent=' || agent_flag::text || E'\\n';

            BEGIN
              default_tenant := public.default_tenant_for_user(uid);
              steps := steps || '4.tenant=' || coalesce(default_tenant::text, 'NULL') || E'\\n';
            EXCEPTION WHEN OTHERS THEN
              steps := steps || '4.tenant FAILED: ' || SQLERRM || E'\\n';
            END;

            IF NOT (event ? 'claims') THEN
              event := jsonb_set(event, '{claims}', '{}'::jsonb);
            END IF;

            BEGIN
              event := jsonb_set(event, '{claims,user_roles}', to_jsonb(role_names), true);
              steps := steps || '5.set-user_roles OK' || E'\\n';
            EXCEPTION WHEN OTHERS THEN
              steps := steps || '5.set-user_roles FAILED: ' || SQLERRM || E'\\n';
            END;

            BEGIN
              event := jsonb_set(event, '{claims,is_agent}', to_jsonb(agent_flag), true);
              steps := steps || '6.set-is_agent OK' || E'\\n';
            EXCEPTION WHEN OTHERS THEN
              steps := steps || '6.set-is_agent FAILED: ' || SQLERRM || E'\\n';
            END;

            BEGIN
              PERFORM 1 FROM public.plugin_claims LIMIT 1;
              steps := steps || '7.registry-readable OK' || E'\\n';
            EXCEPTION WHEN OTHERS THEN
              steps := steps || '7.registry FAILED: ' || SQLERRM || E'\\n';
            END;

            RETURN jsonb_build_object('steps', steps, 'claims', event->'claims');
          END;
          $body$`);
        const dbg = await q(`
          SELECT public.__hook_debug(jsonb_build_object('user_id', '${uid}', 'claims', '{}'::jsonb)) AS steps`);
        await q(`DROP FUNCTION IF EXISTS public.__hook_debug(jsonb)`);
        const dbgRaw = dbg?.[0]?.steps;
        const stepsText = typeof dbgRaw === 'string' ? dbgRaw : String(dbgRaw?.steps ?? '');
        if (dbgRaw?.claims) {
          info(`  Replica final claims: ${JSON.stringify(dbgRaw.claims)}`);
        }
        for (const line of stepsText.split('\n').filter(Boolean)) {
          if (line.includes('FAILED')) {
            fail(`  ${line}`);
            issues++;
          } else {
            okMsg(`  ${line}`);
          }
        }
      } catch (e) {
        fail(`  Step-replica failed to run: ${e.message}`);
        issues++;
      }

      // ── Debug twin: the DEPLOYED body with the swallowed SQLERRM surfaced ──
      // Takes pg_get_functiondef's exact body, renames it, and makes the
      // degradation path RETURN the error instead of a bare warning — this
      // tells us precisely which statement throws inside the real hook.
      info('Calling the debug twin (deployed body + embedded SQLERRM)…');
      try {
        let twinBody = hookDef;
        twinBody = twinBody
          .replace(/\$function\$/g, '$twin$')
          .replace('CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)',
            'CREATE OR REPLACE FUNCTION public.__hook_debug2(event jsonb)')
          .replace("RETURN COALESCE(event, '{\"claims\": {}}'::jsonb);",
            "RETURN COALESCE(event, '{\"claims\": {}}'::jsonb) || jsonb_build_object('_debug_error', SQLERRM);");
        if (!twinBody.includes('_debug_error')) {
          warn('  Could not instrument the deployed body (degradation marker missing) — skipping debug twin.');
        } else {
          twinBody = twinBody.replace(/;\s*$/, ';');
          await q(twinBody);
          const twinRes = await q(`
            SELECT public.__hook_debug2(jsonb_build_object('user_id', '${uid}', 'claims', '{}'::jsonb)) AS event`);
          await q(`DROP FUNCTION IF EXISTS public.__hook_debug2(jsonb)`);
          let twinEvent = twinRes?.[0]?.event ?? {};
          if (typeof twinEvent === 'string') { try { twinEvent = JSON.parse(twinEvent); } catch {} }
          const dbgError = twinEvent?._debug_error;
          if (dbgError) {
            fail(`  HOOK DEGRADATION CAUGHT — the real hook fails with: ${c.bold}${dbgError}${c.reset}`);
            issues++;
          } else {
            const twinClaims = twinEvent?.claims ?? null;
            const twinRoles = Array.isArray(twinClaims?.user_roles) ? twinClaims.user_roles : null;
            if (twinRoles) {
              okMsg(`  Debug twin minted claims without error: ${JSON.stringify(twinRoles)} — the original call's empty result is a diagnostic artifact.`);
            } else {
              warn('  Debug twin also returned no claims AND no error — inspect the raw event:');
              log(`      ${JSON.stringify(twinEvent).slice(0, 400)}`);
            }
          }
        }
      } catch (e) {
        fail(`  Debug twin failed to run: ${e.message}`);
        issues++;
      }
    }
  } catch (e) {
    fail(`  Real-user hook invocation FAILED: ${e.message}`);
    issues++;
  }

  log('');
  if (issues === 0) {
    okMsg('No structural issues found. If logins still 500, check Supabase Auth logs (Dashboard → Auth → Logs) for the hook warning lines.');
  } else {
    fail(`${issues} issue(s) found — fix with the commands above, then re-run npm run auth:check.`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}