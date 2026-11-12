import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { capitalize } from 'lodash';
import {
  redactDeep as scrub,
  redactSecretsInString as scrubUrlsInString,
} from '@gitroom/nestjs-libraries/helpers/redact';

/**
 * Server-side DSN.
 *
 * `SENTRY_DSN` is the correct name for a backend: `NEXT_PUBLIC_*` is a Next.js
 * convention meaning "inlined into the browser bundle", which this is not.
 * The old name is still honoured so existing deployments keep working.
 */
export const getSentryDsn = () =>
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

/**
 * Console levels forwarded to Sentry.
 *
 * Deliberately narrow. The previous value included `log`, `info`, `debug`,
 * `trace` and `assert`, which meant *every* console call in the app was
 * transmitted — including provider code that logs whole credential objects
 * (for example `console.log(body)` in the ListMonk and Threads providers,
 * where `body` holds a password or an OAuth payload).
 *
 * Structured error reporting is unaffected: `captureException`,
 * `captureMessage` and the Meta compliance alerts do not go through this
 * integration.
 */
const DEFAULT_CONSOLE_LEVELS = ['warn', 'error'] as const;

const consoleLevels = () => {
  const configured = process.env.SENTRY_CONSOLE_LEVELS;
  if (!configured) {
    return [...DEFAULT_CONSOLE_LEVELS];
  }

  return configured
    .split(',')
    .map((level) => level.trim())
    .filter(Boolean);
};

export const setSentryUserContext = (params: {
  userId?: string;
  email?: string;
  orgId?: string;
  paymentId?: string | null;
}) => {
  try {
    Sentry.setUser(
      params.userId
        ? { id: params.userId, ...(params.email ? { email: params.email } : {}) }
        : null
    );
    if (params.orgId) {
      Sentry.setTag('organization.id', params.orgId);
    }
    if (params.paymentId?.startsWith('cus_')) {
      Sentry.setTag('stripe.customer_id', params.paymentId);
    }
  } catch (err) {
    /* never let telemetry break a request */
  }
};

export const initializeSentry = (appName: string, allowLogs = false) => {
  const dsn = getSentryDsn();

  if (!dsn) {
    return null;
  }

  try {
    Sentry.init({
      initialScope: {
        tags: {
          service: appName,
          component: 'nestjs',
        },
        contexts: {
          app: {
            name: `Postaryx ${capitalize(appName)}`,
          },
        },
      },
      environment: process.env.NODE_ENV || 'development',
      dsn,
      spotlight: process.env.SENTRY_SPOTLIGHT === '1',
      integrations: [
        // Add our Profiling integration
        nodeProfilingIntegration(),
        Sentry.consoleLoggingIntegration({ levels: consoleLevels() as any }),
        Sentry.openAIIntegration({
          // Prompts and completions are user content. Off unless explicitly
          // enabled, so they are not shipped to a third party by default.
          recordInputs: process.env.SENTRY_RECORD_AI_IO === 'true',
          recordOutputs: process.env.SENTRY_RECORD_AI_IO === 'true',
        }),
      ],
      tracesSampler: ({ name, attributes, normalizedRequest, inheritOrSampleWith }) => {
        const path = String(
          normalizedRequest?.url || attributes?.['http.target'] || attributes?.['url.path'] || name || ''
        );
        const method = String(
          normalizedRequest?.method || attributes?.['http.request.method'] || attributes?.['http.method'] || ''
        );
        // MCP stream GETs are declined with 405; never trace them
        if (method === 'GET' && /^(https?:\/\/[^/]+)?\/mcp(\/|-oauth|\?|$)/.test(path)) {
          return 0;
        }
        if (name?.startsWith('prisma:')) {
          return 0;
        }
        return inheritOrSampleWith(
          path.includes('/public/v1/analytics/') ? 0.01 : 0.5
        );
      },
      ignoreSpans: [
        /^prisma:(client:serialize|engine:(query|serialize|response_json_serialization|connection))$/,
        { op: 'db', name: /^(BEGIN|COMMIT|DEALLOCATE ALL)$/ },
        { op: 'middleware.express' },
      ],
      enableLogs: true,

      // Last gate before transmission. Exception values and the top-level
      // message are scrubbed too: an error thrown by an HTTP client commonly
      // stringifies the failing URL, and that is the easiest way for a
      // credential to sidestep key-based redaction.
      beforeSend(event) {
        if (event.request) {
          event.request = scrub(event.request);
        }
        if (event.extra) {
          event.extra = scrub(event.extra);
        }
        if (event.contexts) {
          event.contexts = scrub(event.contexts);
        }
        if (event.exception) {
          event.exception = scrub(event.exception);
        }
        if (typeof event.message === 'string') {
          event.message = scrubUrlsInString(event.message);
        }
        if (event.breadcrumbs) {
          event.breadcrumbs = scrub(event.breadcrumbs);
        }
        return event;
      },

      // Profiling
      profileSessionSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.4,
      profileLifecycle: 'trace',
    });
  } catch (err) {
    console.log(err);
  }
  return true;
};
