'use client';

import { FC, useState } from 'react';

/**
 * Avatar for the account-selection dialogs.
 *
 * The URL these dialogs render comes straight from the provider's API and is
 * not the copy Postaryx stores — the local copy only exists after the channel
 * is saved. Provider CDN URLs are signed and short-lived, and the field can be
 * absent entirely, so `<img src={undefined}>` renders a broken image with no
 * indication of which account it belongs to.
 *
 * Falls back to the account's initial rather than a shipped placeholder, which
 * keeps the accounts distinguishable when several are listed.
 */
export const ProviderAvatar: FC<{
  url?: string;
  name?: string;
  className?: string;
}> = ({ url, name, className = 'w-full' }) => {
  const [failed, setFailed] = useState(false);
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();

  if (!url || failed) {
    return (
      <div
        className={`${className} aspect-square rounded-full bg-sixth flex items-center justify-center`}
        role="img"
        aria-label={name ? `${name} avatar` : 'avatar'}
        data-testid="provider-avatar-fallback"
      >
        <span>{initial}</span>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={url}
      alt={name ? `${name} profile` : 'profile'}
      // An expired or blocked URL is indistinguishable from a missing one as
      // far as the user is concerned, so both land on the same fallback.
      onError={() => setFailed(true)}
      data-testid="provider-avatar-image"
    />
  );
};
