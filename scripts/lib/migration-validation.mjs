/**
 * migration-validation.mjs
 *
 * Plugin migration validator shared by install-plugins.mjs and
 * update-plugins.mjs. Enforces: plugin-schema-only DDL (create/drop/alter of
 * tables, views, functions, types, sequences, policies, triggers, indexes),
 * matching down-migrations, and CREATE SCHEMA presence.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

export function normalizeIdentifierPart(part) {
  return part.replace(/^"+|"+$/g, '');
}

export function getAllowedPluginSchemas(slug) {
  return [...new Set([slug.replace(/-/g, '_'), slug])].filter(Boolean);
}

export function collectSqlFiles(dir, filePrefix) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
      .sort()
      .map((f) => ({
        name: f,
        file: `${filePrefix}/${f}`,
        sql: readFileSync(join(dir, f), 'utf8'),
      }));
  } catch {
    return [];
  }
}

export function validateScopedObjectTarget(identifier, allowedSchemas, file, statement, issues) {
  const parts = identifier.split('.');
  if (parts.length < 2) {
    issues.push(`${file}: ${statement} must target an explicit plugin schema, found "${identifier}".`);
    return;
  }

  const schema = normalizeIdentifierPart(parts[0]);
  if (!allowedSchemas.includes(schema)) {
    issues.push(
      `${file}: ${statement} targets schema "${schema}", expected one of: ${allowedSchemas.join(', ')}.`,
    );
  }
}

export function validateMigrationSchemaUsage(files, slug) {
  const allowedSchemas = getAllowedPluginSchemas(slug);
  const issues = [];
  const schemaChecks = [
    {
      statement: 'CREATE/ALTER/DROP TABLE',
      regex: /\b(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:ONLY\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE/ALTER/DROP VIEW',
      regex: /\b(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER|DROP)\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE/DROP FUNCTION',
      regex: /\b(?:CREATE(?:\s+OR\s+REPLACE)?|DROP)\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)\s*\(/gi,
    },
    {
      statement: 'CREATE/ALTER/DROP TYPE',
      regex: /\b(?:CREATE|ALTER|DROP)\s+TYPE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE/ALTER/DROP SEQUENCE',
      regex: /\b(?:CREATE|ALTER|DROP)\s+SEQUENCE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE/ALTER/DROP POLICY',
      regex: /\b(?:CREATE|ALTER|DROP)\s+POLICY\s+"?[\w-]+"?\s+ON\s+((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE/DROP TRIGGER',
      regex: /\b(?:CREATE(?:\s+OR\s+REPLACE)?|DROP)\s+TRIGGER\s+"?[\w-]+"?\s+ON\s+((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE INDEX',
      regex: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[\w-]+"?\s+)?ON\s+((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
  ];

  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    for (const check of schemaChecks) {
      for (const match of sql.matchAll(check.regex)) {
        validateScopedObjectTarget(match[1], allowedSchemas, file.file, check.statement, issues);
      }
    }
  }

  return issues;
}

export function validatePluginMigrations(pluginsDir, slug) {
  const upDir = join(pluginsDir, slug, 'migrations');
  const downDir = join(upDir, 'down');
  const upMigrations = collectSqlFiles(upDir, `src/plugins/${slug}/migrations`);

  if (!upMigrations.length) {
    return { ok: true, errors: [] };
  }

  const errors = [];
  const allowedSchemas = getAllowedPluginSchemas(slug);
  const downMigrations = collectSqlFiles(downDir, `src/plugins/${slug}/migrations/down`);

  if (!existsSync(downDir)) {
    errors.push(`src/plugins/${slug}/migrations/down/: missing directory; explicit down-migrations are required.`);
  }

  const downNames = new Set(downMigrations.map((migration) => migration.name));
  for (const migration of upMigrations) {
    if (!downNames.has(migration.name)) {
      errors.push(
        `${migration.file}: missing matching down-migration at src/plugins/${slug}/migrations/down/${migration.name}.`,
      );
    }
  }

  const schemaDefined = upMigrations.some((migration) => {
    const sql = stripSqlComments(migration.sql);
    return allowedSchemas.some((schema) => {
      const schemaPattern = new RegExp(
        `\\bCREATE\\s+SCHEMA\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:AUTHORIZATION\\s+)?"?${escapeRegExp(schema)}"?\\b`,
        'i',
      );
      return schemaPattern.test(sql);
    });
  });

  if (!schemaDefined) {
    errors.push(
      `plugins/${slug}/migrations/: missing CREATE SCHEMA for plugin schema (${allowedSchemas.join(' or ')}).`,
    );
  }

  errors.push(...validateMigrationSchemaUsage(upMigrations, slug));
  errors.push(...validateMigrationSchemaUsage(downMigrations, slug));

  return { ok: errors.length === 0, errors };
}
