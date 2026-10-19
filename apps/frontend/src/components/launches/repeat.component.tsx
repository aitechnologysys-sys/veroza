'use client';

import { FC, useMemo, useState } from 'react';
import { Select } from '@gitroom/react/form/select';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useClickOutside } from '@mantine/hooks';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import clsx from 'clsx';
import { DropdownArrowIcon } from '@gitroom/frontend/components/ui/icons';
const getList = (t: (key: string, fallback: string) => string) => [
  {
    value: 1,
    label: t('day', 'Day'),
  },
  {
    value: 2,
    label: t('two_days', 'Two Days'),
  },
  {
    value: 3,
    label: t('three_days', 'Three Days'),
  },
  {
    value: 4,
    label: t('four_days', 'Four Days'),
  },
  {
    value: 5,
    label: t('five_days', 'Five Days'),
  },
  {
    value: 6,
    label: t('six_days', 'Six Days'),
  },
  {
    value: 7,
    label: t('week', 'Week'),
  },
  {
    value: 14,
    label: t('two_weeks', 'Two Weeks'),
  },
  {
    value: 30,
    label: t('month', 'Month'),
  },
  {
    value: null,
    label: t('cancel', 'Cancel'),
  },
];
export const RepeatComponent: FC<{
  repeat: number | null;
  onChange: (newVal: number) => void;
  // 'top' opens the list above the trigger (original); 'bottom' below it.
  placement?: 'top' | 'bottom';
}> = (props) => {
  const { repeat, placement = 'top' } = props;
  const t = useT();
  const list = getList(t);
  const [isOpen, setIsOpen] = useState(false);

  const ref = useClickOutside(() => {
    if (!isOpen) {
      return;
    }
    setIsOpen(false);
  });

  const everyLabel = useMemo(() => {
    if (!repeat) {
      return '';
    }
    return list.find((p) => p.value === repeat)?.label;
  }, [repeat, list]);

  return (
    <div
      ref={ref}
      className={clsx(
        'border-b-2 flex items-center relative h-[48px] italic select-none',
        isOpen
          ? 'border-btnPrimary'
          : repeat
          ? 'border-calInk'
          : 'border-calLineStrong',
        repeat ? 'text-calInk' : 'text-calMuted'
      )}
    >
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="px-[4px] flex gap-[8px] items-center h-full select-none flex-1"
      >
        <div className="cursor-pointer whitespace-nowrap">
          {repeat
            ? `${t('repeat_post_every_label', 'Repeat Post Every')} ${everyLabel}`
            : t('repeat_post_every', 'Repeat Post Every...')}
        </div>
        <div className="cursor-pointer">
          <DropdownArrowIcon rotated={isOpen} />
        </div>
      </div>
      {isOpen && (
        <div
          className={clsx(
            'z-[300] absolute start-0 w-[240px] bg-calCard border border-calLine rounded-[14px] p-[6px] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.35)] flex flex-col font-sans not-italic text-[14px] font-[500] text-calInk',
            placement === 'bottom'
              ? 'top-[100%] translate-y-[10px]'
              : 'bottom-[100%] -translate-y-[10px]'
          )}
        >
          {list.map((p) => (
            <div
              onClick={() => {
                props.onChange(Number(p.value));
                setIsOpen(false);
              }}
              key={p.label}
              className={clsx(
                'h-[38px] px-[12px] rounded-[10px] flex items-center cursor-pointer hover:bg-calModalCell',
                !!repeat &&
                  repeat === p.value &&
                  'bg-calEmberSoft text-calEmberText'
              )}
            >
              {p.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
