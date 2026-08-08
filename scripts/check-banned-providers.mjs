#!/usr/bin/env node
/**
 * Guard against banned social providers silently returning to the product.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repo is a fork of gitroomhq/postiz-app and we merge upstream regularly.
 * `socialIntegrationList` (integration.manager.ts) and the frontend provider
 * registry are exactly the kind of long literal arrays where a rebase quietly
 * restores a deleted line. Without this check, a banned provider comes back in
 * a merge commit nobody reads closely and ships to production.
 *
 * VK was removed deliberately: VK Company was added to the EU sanctions list on
 * 13 July 2026. We do not want a sanctioned platform in the product surface of a
 * US LLC that is onboarding with a bank, Stripe, and eventually acquirers.
 * See ops/platform-approvals.html in the landing repo for the full rationale.
 *
 * This is a static source check, not a runtime import: importing the real
 * modules would drag in the whole NestJS/Prisma graph and fail for reasons
 * unrelated to what we are asserting.
 *
 * Run: pnpm check:providers
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Provider identifiers that must never appear in the product.
 * `identifier` matches the SocialProvider.identifier value used across the app.
 */
const BANNED = [
  {
    identifier: 'vk',
    label: 'VK / VKontakte',
    reason: 'VK Company is EU-sanctioned (13 Jul 2026)',
  },
  // Odnoklassniki (ok.ru) and Mail.ru share VK Company as parent. They are not
  // in upstream today; listed so that if upstream ever adds them, this fails.
  {
    identifier: 'odnoklassniki',
    label: 'Odnoklassniki',
    reason: 'VK Company subsidiary',
  },
  { identifier: 'mailru', label: 'Mail.ru', reason: 'VK Company subsidiary' },
];

/** Directories worth scanning — source only, no build output or deps. */
const SCAN_DIRS = ['libraries', 'apps'];

const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  '.next',
  'build',
  'coverage',
  '.nx',
  '.turbo',
]);

const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Patterns that indicate a real registration, not an incidental substring.
 *
 * A naive substring search for "vk" false-positives on real content in this
 * repo: cloudinary asset URLs in hashnode.tags.ts and ".vladikavkaz.ru" in the
 * subdomain list. So we only match structural forms.
 */
function patternsFor(identifier) {
  const id = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const Pascal = identifier.charAt(0).toUpperCase() + identifier.slice(1);
  return [
    // quoted identifier: 'vk' / "vk" / `vk`
    { re: new RegExp(`['"\`]${id}['"\`]`), what: `quoted identifier '${identifier}'` },
    // class / component name: VkProvider
    { re: new RegExp(`\\b${Pascal}Provider\\b`), what: `${Pascal}Provider symbol` },
    // module path: .../vk.provider  or  providers/vk/
    { re: new RegExp(`[/\\\\]${id}\\.provider\\b`), what: `import of ${identifier}.provider` },
    { re: new RegExp(`providers[/\\\\]${id}[/\\\\]`), what: `providers/${identifier}/ path` },
  ];
}

const violations = [];

// 1. No source file may reference a banned provider structurally.
for (const dirName of SCAN_DIRS) {
  const dir = join(ROOT, dirName);
  try {
    if (!statSync(dir).isDirectory()) continue;
  } catch {
    continue;
  }

  for (const file of walk(dir)) {
    if (!SCAN_EXT.test(file)) continue;

    const rel = relative(ROOT, file);
    let lines;
    try {
      lines = readFileSync(file, 'utf8').split('\n');
    } catch {
      continue;
    }

    lines.forEach((line, i) => {
      // Our own deliberate breadcrumb comments are allowed.
      if (/removed deliberately/i.test(line)) return;

      for (const banned of BANNED) {
        for (const { re, what } of patternsFor(banned.identifier)) {
          if (re.test(line)) {
            violations.push({
              file: rel,
              line: i + 1,
              banned,
              what,
              text: line.trim().slice(0, 120),
            });
          }
        }
      }
    });
  }
}

// 2. No provider implementation file may exist on disk.
for (const banned of BANNED) {
  for (const candidate of [
    join(
      ROOT,
      'libraries/nestjs-libraries/src/integrations/social',
      `${banned.identifier}.provider.ts`,
    ),
    join(
      ROOT,
      'apps/frontend/src/components/new-launch/providers',
      banned.identifier,
    ),
  ]) {
    try {
      statSync(candidate);
      violations.push({
        file: relative(ROOT, candidate),
        line: 0,
        banned,
        what: 'provider file/directory exists',
        text: '(file present on disk)',
      });
    } catch {
      /* absent — good */
    }
  }
}

if (violations.length > 0) {
  console.error('\n✗ Banned social provider(s) found in the source tree.\n');
  for (const v of violations) {
    const where = v.line ? `${v.file}:${v.line}` : v.file;
    console.error(`  ${v.banned.label}  (${v.banned.reason})`);
    console.error(`    ${where}  — ${v.what}`);
    console.error(`    ${v.text}\n`);
  }
  console.error(
    'These providers were removed deliberately. If this fired after an upstream\n' +
      'merge, re-remove the lines above rather than deleting this check.\n' +
      'Rationale: ops/platform-approvals.html (landing repo), Part 18.\n',
  );
  process.exit(1);
}

console.log(
  `✓ No banned providers present (checked: ${BANNED.map((b) => b.identifier).join(', ')})`,
);
