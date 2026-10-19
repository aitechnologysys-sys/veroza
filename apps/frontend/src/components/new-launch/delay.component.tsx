'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import { DelayIcon, DropdownArrowIcon } from '@gitroom/frontend/components/ui/icons';
import clsx from 'clsx';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useClickOutside } from '@mantine/hooks';

const delayOptions = [
  { value: 1, label: '1m' },
  { value: 2, label: '2m' },
  { value: 5, label: '5m' },
  { value: 10, label: '10m' },
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
];

export const DelayComponent: FC<{
  currentIndex: number;
  currentDelay: number;
}> = ({ currentIndex, currentDelay }) => {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [customValue, setCustomValue] = useState('');
  
  const isCustomDelay = currentDelay > 0 && !delayOptions.some((opt) => opt.value === currentDelay);

  useEffect(() => {
    if (isOpen && isCustomDelay) {
      setCustomValue(String(currentDelay));
    } else if (isOpen && !isCustomDelay) {
      setCustomValue('');
    }
  }, [isOpen, isCustomDelay, currentDelay]);

  const { current, setInternalDelay, setGlobalDelay } = useLaunchStore(
    useShallow((state) => ({
      current: state.current,
      setGlobalDelay: state.setGlobalDelay,
      setInternalDelay: state.setInternalDelay,
    }))
  );

  const ref = useClickOutside(() => {
    if (!isOpen) {
      return;
    }
    setIsOpen(false);
  });

  const setDelay = useCallback(
    (index: number) => (minutes: number) => {
      if (current !== 'global') {
        return setInternalDelay(current, index, minutes);
      }

      return setGlobalDelay(index, minutes);
    },
    [currentIndex, current]
  );

  const handleSelectDelay = useCallback(
    (minutes: number) => {
      setDelay(currentIndex)(minutes);
      setIsOpen(false);
    },
    [currentIndex, setDelay]
  );

  const getCurrentDelayLabel = () => {
    if (!currentDelay) return null;
    const option = delayOptions.find((opt) => opt.value === currentDelay);
    return option?.label || `${currentDelay} min`;
  };

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setIsOpen(!isOpen)}
        data-tooltip-id="tooltip"
        data-tooltip-content={
          !currentDelay
            ? t('delay_comment', 'Delay comment')
            : `${t('delay_comment_by', 'Comment delayed by')} ${getCurrentDelayLabel()}`
        }
        className={clsx(
          'cursor-pointer flex items-center justify-center gap-[4px]',
          currentDelay > 0
            ? 'h-[22px] min-w-[30px] px-[6px] bg-btnPrimary text-white rounded-full font-mono text-[10px]'
            : 'w-[30px] h-[26px] rounded-[8px] hover:bg-calModalCell hover:text-calInk'
        )}
      >
        {currentDelay > 0 ? getCurrentDelayLabel() : <DelayIcon />}
      </div>
      {isOpen && (
        <div className="z-[300] absolute end-0 top-[100%] w-[260px] bg-calCard border border-calLine text-calInk p-[12px] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.3)] translate-y-[10px] flex flex-col rounded-[14px]">
          <div className="grid grid-cols-4 gap-[6px] font-mono">
            {delayOptions.map((option) => (
              <div
                onClick={() => handleSelectDelay(option.value)}
                key={option.value}
                className={clsx(
                  'h-[32px] flex items-center justify-center rounded-[8px] cursor-pointer text-[12px]',
                  currentDelay === option.value
                    ? 'bg-btnPrimary text-white'
                    : 'bg-calModalCell hover:opacity-80'
                )}
              >
                {option.label}
              </div>
            ))}
          </div>
          <div className="mt-[10px]">
            <div className="flex gap-[6px]">
              <input
                type="number"
                min="1"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Custom min"
                className={clsx(
                  'flex-1 w-full h-[34px] px-[10px] rounded-[8px] bg-transparent border text-[13px] outline-none focus:border-btnPrimary',
                  isCustomDelay ? 'border-btnPrimary' : 'border-calLineStrong'
                )}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const value = parseInt(customValue, 10);
                  if (value > 0) {
                    handleSelectDelay(value);
                    setCustomValue('');
                  }
                }}
                className="h-[34px] px-[14px] rounded-[8px] bg-calInk text-calInkInverse text-[12px] font-[600] hover:opacity-90"
              >
                Set
              </button>
            </div>
          </div>
          {currentDelay > 0 && (
            <button
              onClick={() => handleSelectDelay(0)}
              className="mt-[10px] h-[32px] w-full rounded-[8px] text-[13px] font-[500] bg-calDangerSoft text-calDanger hover:opacity-90"
            >
              Remove delay
            </button>
          )}
        </div>
      )}
    </div>
  );
};
