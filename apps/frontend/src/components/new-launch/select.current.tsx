'use client';

import { FC, RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  SelectedIntegrations,
  useLaunchStore,
} from '@gitroom/frontend/components/new-launch/store';
import clsx from 'clsx';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useShallow } from 'zustand/react/shallow';
import { GlobalIcon } from '@gitroom/frontend/components/ui/icons';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useProviderNames } from '@gitroom/frontend/components/launches/helpers/use.provider.names';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import {
  useDecisionModal,
  useModals,
} from '@gitroom/frontend/components/layout/new-modal';

export function useHasScroll(ref: RefObject<HTMLElement | null>): boolean {
  const [hasHorizontalScroll, setHasHorizontalScroll] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const checkScroll = () => {
      const el = ref.current;
      if (el) {
        setHasHorizontalScroll(el.scrollWidth > el.clientWidth);
      }
    };

    checkScroll(); // initial check

    const resizeObserver = new ResizeObserver(checkScroll);
    resizeObserver.observe(ref.current);

    const mutationObserver = new MutationObserver(checkScroll);
    mutationObserver.observe(ref.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [ref]);

  return hasHorizontalScroll;
}

export const SelectCurrent: FC = () => {
  const t = useT();
  const modals = useDecisionModal();
  const providerName = useProviderNames();
  const {
    selectedIntegrations,
    current,
    setCurrent,
    locked,
    setHide,
    addOrRemoveSelectedIntegration,
  } = useLaunchStore(
    useShallow((state) => ({
      selectedIntegrations: state.selectedIntegrations,
      addOrRemoveSelectedIntegration: state.addOrRemoveSelectedIntegration,
      current: state.current,
      setCurrent: state.setCurrent,
      locked: state.locked,
      setHide: state.setHide,
    }))
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const hasScroll = useHasScroll(contentRef);

  const removeSocial = useCallback(
    (sIntegration: Integrations) => async (e: any) => {
      e.stopPropagation();
      e.preventDefault();
      const open = await modals.open({
        title: 'Remove Social Account',
        description:
          'Are you sure you want to remove this social from scheduling?',
      });

      if (!open) {
        return;
      }

      addOrRemoveSelectedIntegration(sIntegration, {});
    },
    []
  );

  const tabClass = (active: boolean) =>
    clsx(
      'flex-none flex items-center gap-[6px] pb-[9px] border-b-2 -mb-[1px] whitespace-nowrap transition-colors',
      active
        ? 'border-btnPrimary text-calInk font-[600]'
        : 'border-transparent text-calMuted hover:text-calInk'
    );

  return (
    <div
      ref={contentRef}
      role="tablist"
      className={clsx(
        'select-none flex-none flex items-end gap-[22px] border-b border-calLine font-serif text-[17px] w-full overflow-x-auto overflow-y-hidden scrollbar scrollbar-thumb-tableBorder scrollbar-track-secondary',
        hasScroll && 'pb-[4px]',
        locked && 'opacity-50 pointer-events-none'
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={current === 'global'}
        onClick={() => {
          setHide(true);
          setCurrent('global');
        }}
        className={clsx(tabClass(current === 'global'), 'cursor-pointer')}
      >
        <GlobalIcon size={15} />
        {t('global', 'Global')}
      </button>
      {selectedIntegrations.map(({ integration }) => (
        <div
          key={integration.id}
          className={clsx(tabClass(current === integration.id), 'relative')}
        >
          <button
            type="button"
            role="tab"
            aria-selected={current === integration.id}
            onClick={() => {
              setHide(true);
              setCurrent(integration.id);
            }}
            {...{
              'data-tooltip-id': 'tooltip',
              'data-tooltip-content': `${integration.name} · ${providerName(
                integration.identifier
              )}`,
            }}
            className="flex items-center gap-[6px] cursor-pointer"
          >
            <span className="relative flex-none w-[18px] h-[18px]">
              <SafeImage
                src={integration.picture || '/no-picture.jpg'}
                className="rounded-full w-[18px] h-[18px] min-w-[18px] object-cover"
                alt={integration.identifier}
                width={18}
                height={18}
                onError={(e) => {
                  e.currentTarget.src = '/no-picture.jpg';
                  e.currentTarget.srcset = '/no-picture.jpg';
                }}
              />
              {integration.identifier === 'youtube' ? (
                <img
                  src="/icons/platforms/youtube.svg"
                  className="absolute z-10 -bottom-[3px] -end-[4px] min-w-[10px]"
                  width={10}
                />
              ) : (
                <SafeImage
                  src={`/icons/platforms/${integration.identifier}.png`}
                  className="min-w-[10px] min-h-[10px] rounded-full absolute z-10 -bottom-[3px] -end-[3px]"
                  alt={integration.identifier}
                  width={10}
                  height={10}
                />
              )}
            </span>
            <span className="max-w-[160px] overflow-hidden text-ellipsis">
              {integration.name}
            </span>
          </button>
          <IsGlobal id={integration.id} />
          <button
            type="button"
            onClick={removeSocial(integration)}
            aria-label={`${t('remove', 'Remove')} ${integration.name}`}
            className="w-[18px] h-[18px] rounded-full bg-calModalCell text-calMuted hover:text-calInk flex items-center justify-center cursor-pointer"
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
};

export const IsGlobal: FC<{ id: string }> = ({ id }) => {
  const t = useT();
  const { isInternal } = useLaunchStore(
    useShallow((state) => ({
      isInternal: !!state.internal.find((p) => p.integration.id === id),
    }))
  );

  if (!isInternal) {
    return null;
  }

  return (
    <div
      data-tooltip-id="tooltip"
      data-tooltip-content={t(
        'no_longer_global_mode',
        'No longer in global mode'
      )}
      className="flex-none w-[7px] h-[7px] bg-btnPrimary rounded-full"
    />
  );
};
