'use client';

import React, { FC, useCallback, useMemo } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import clsx from 'clsx';
export const OrganizationSelector: FC<{ asOpenSelect?: boolean }> = ({
  asOpenSelect,
}) => {
  const fetch = useFetch();
  const user = useUser();
  const load = useCallback(async () => {
    return await (await fetch('/user/organizations')).json();
  }, []);
  const { isLoading, data } = useSWR('organizations', load, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
    revalidateOnReconnect: false,
  });
  const current = useMemo(() => {
    return data?.find((d: any) => d.id === user?.orgId);
  }, [data]);
  const withoutCurrent = useMemo(() => {
    return data?.filter((d: any) => d.id !== user?.orgId);
  }, [current, data]);
  const changeOrg = useCallback(
    (org: { name: string; id: string }) => async () => {
      await fetch('/user/change-org', {
        method: 'POST',
        body: JSON.stringify({
          id: org.id,
        }),
      });
      window.location.reload();
    },
    []
  );
  if (isLoading || (!isLoading && data?.length === 1)) {
    return null;
  }
  return (
    <>
      <div className="group text-[13px] relative">
        {asOpenSelect && (
          <div className="bg-btnPrimary text-white rounded-[10px] !flex !relative max-w-[500px] mx-auto py-[12px] px-[12px] justify-center font-[600]">
            Select Organization
          </div>
        )}
        {!asOpenSelect && (
          <div className="cursor-pointer flex items-center gap-[8px] py-[7px] px-[12px] bg-newBgColorInner border border-newBorder rounded-[10px] text-newTextColor font-[600] transition-colors group-hover:bg-boxHover">
            <div
              className={clsx(
                'w-[18px] h-[18px] rounded-[5px] bg-btnPrimary shrink-0',
                user?.tier.current === 'FREE' && 'animate-bounce'
              )}
            />
            <span className="max-w-[140px] truncate">
              {current?.name || 'Organization'}
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-textItemBlur shrink-0"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        )}
        {data?.length > 1 && (
          <div
            className={clsx(
              'hidden py-[6px] px-[6px] group-hover:flex absolute top-[100%] end-0 z-[10] min-w-[200px] bg-newBgColorInner border-newBorder border rounded-[12px] shadow-menu gap-[2px] cursor-pointer flex-col',
              asOpenSelect
                ? '!flex !relative max-w-[500px] mx-auto mb-[10px]'
                : ''
            )}
          >
            {data?.map((org: { name: string; id: string }) => (
              <div
                key={org.id}
                onClick={changeOrg(org)}
                className={clsx(
                  'px-[10px] py-[7px] rounded-[8px] text-[13px] transition-colors hover:bg-boxHover',
                  org.id === user?.orgId
                    ? 'text-textItemFocused font-[600]'
                    : 'text-newTextColor'
                )}
              >
                {org.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
