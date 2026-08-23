'use client';

import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import {
  FoundingPeriod,
  FoundingPromoStatus,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/founding.promo';

export interface FoundingMemberInfo {
  slotNumber: number;
  period: FoundingPeriod;
  discountPercent: number;
  forfeited: boolean;
}

export interface FoundingPromo extends FoundingPromoStatus {
  member: FoundingMemberInfo | null;
}

/**
 * Founding-100 promo state.
 *
 * The server owns `active` — it accounts for the env flag, whether billing is
 * enforced, and how many slots are left — so there is no NEXT_PUBLIC_ mirror to
 * drift out of sync with it.
 */
export const useFoundingPromo = () => {
  const fetch = useFetch();

  return useSWR<FoundingPromo>(
    '/billing/founding-promo',
    async () => (await fetch('/billing/founding-promo')).json(),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};
