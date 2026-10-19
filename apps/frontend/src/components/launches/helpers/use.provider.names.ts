'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { capitalize } from 'lodash';

// Display name of a platform ("Dev.to", "LinkedIn Page") by provider
// identifier, read once from the provider list behind GET /integrations.
// Falls back to the capitalised identifier until it loads.
export const useProviderNames = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    const data = await (await fetch('/integrations')).json();
    return Object.fromEntries(
      (data?.social || []).map((p: { identifier: string; name: string }) => [
        p.identifier,
        p.name,
      ])
    ) as Record<string, string>;
  }, []);

  const { data } = useSWR('provider-display-names', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });

  return useCallback(
    (identifier?: string) =>
      data?.[identifier || ''] ||
      capitalize((identifier || '').split('-')[0]),
    [data]
  );
};
