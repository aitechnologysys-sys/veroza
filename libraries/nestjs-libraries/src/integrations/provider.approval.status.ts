/**
 * Platform app-review status for the providers whose APIs require Postaryx
 * itself to be approved by the platform before end users can connect a
 * channel (Meta, Google, TikTok, LinkedIn, ...).
 *
 * This is *our* review status with the platform — it is identical for every
 * organization, which is why it lives in code rather than in the database.
 * Update this map (and deploy) as an application moves along; there is no
 * admin UI for it on purpose.
 *
 * Providers that are absent from the map need no review at all (self-hosted
 * API keys, webhooks, browser extension, ...) and are reported as
 * `not_required`.
 */
export type ProviderApprovalStatus =
  | 'not_required'
  | 'not_applied'
  | 'pending'
  | 'approved'
  | 'rejected';

export interface ProviderApproval {
  /** Where the application currently stands. */
  status: ProviderApprovalStatus;
  /** The platform the application is filed with, for grouping in the UI. */
  platform?: string;
  /** ISO date (YYYY-MM-DD) the application was submitted. */
  appliedAt?: string;
  /** ISO date (YYYY-MM-DD) the platform last changed the decision. */
  decidedAt?: string;
  /** Short, user-facing explanation. Shown as-is, so keep it plain. */
  note?: string;
}

const APPROVALS: Record<string, ProviderApproval> = {
  facebook: {
    status: 'not_applied',
    platform: 'Meta',
  },
  instagram: {
    status: 'not_applied',
    platform: 'Meta',
  },
  'instagram-standalone': {
    status: 'not_applied',
    platform: 'Meta',
  },
  threads: {
    status: 'not_applied',
    platform: 'Meta',
  },
  youtube: {
    status: 'not_applied',
    platform: 'Google',
  },
  gmb: {
    status: 'not_applied',
    platform: 'Google',
  },
  tiktok: {
    status: 'not_applied',
    platform: 'TikTok',
  },
  linkedin: {
    status: 'not_applied',
    platform: 'LinkedIn',
  },
  'linkedin-page': {
    status: 'not_applied',
    platform: 'LinkedIn',
  },
};

export const NOT_REQUIRED: ProviderApproval = { status: 'not_required' };

export const getProviderApproval = (identifier: string): ProviderApproval =>
  APPROVALS[identifier] || NOT_REQUIRED;

export const getProviderApprovals = (): Record<string, ProviderApproval> => ({
  ...APPROVALS,
});
