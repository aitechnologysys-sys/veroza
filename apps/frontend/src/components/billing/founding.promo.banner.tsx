'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFoundingPromo } from '@gitroom/frontend/components/billing/use.founding.promo';

const DISMISS_KEY = 'founding-promo-dismissed';

export const FoundingPromoBanner: FC = () => {
  const t = useT();
  const { data } = useFoundingPromo();
  const [dismissed, setDismissed] = useState(true);

  // Read after mount so the server and first client render agree.
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === 'true');
    } catch (err) {
      setDismissed(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch (err) {
      /* private mode — the banner just comes back next load */
    }
  }, []);

  // Members already have the rate; the pitch is for everyone else.
  if (!data?.active || data.member || dismissed) {
    return null;
  }

  return (
    <div className="flex items-center justify-center gap-[12px] px-[16px] py-[8px] rounded-[8px] text-[14px] font-[500] bg-[#AA0FA4] text-white">
      <Link href="/billing" className="hover:underline">
        {t('founding_promo_banner', 'Founding 100 —')}{' '}
        <span className="font-[700]">
          {data.discount.YEARLY}
          {t('founding_promo_yearly', '% off yearly, forever.')}
        </span>{' '}
        {data.slotsRemaining} {t('founding_promo_of', 'of')} {data.slotsTotal}{' '}
        {t('founding_promo_spots_left', 'spots left.')}
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismiss', 'Dismiss')}
        className="text-[16px] leading-none opacity-70 hover:opacity-100"
      >
        &times;
      </button>
    </div>
  );
};
