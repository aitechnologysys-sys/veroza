'use client';

import { FC, useCallback } from 'react';
import clsx from 'clsx';
export const Slider: FC<{
  value: 'on' | 'off';
  fill?: boolean;
  variant?: 'default' | 'primary';
  onChange: (value: 'on' | 'off') => void;
}> = (props) => {
  const { value, onChange, fill, variant = 'default' } = props;
  const change = useCallback(() => {
    onChange(value === 'on' ? 'off' : 'on');
  }, [value]);
  return (
    <div
      className={clsx(
        'w-[57px] h-[34px] p-[4px] border-fifth border rounded-[100px]',
        value === 'on' &&
          fill &&
          (variant === 'primary' ? 'bg-btnPrimary border-btnPrimary' : 'bg-customColor4')
      )}
      onClick={change}
    >
      <div className="w-full h-full relative rounded-[100px]">
        <div
          className={clsx(
            'absolute left-0 top-0 w-[24px] h-[24px] bg-customColor5 rounded-full transition-all cursor-pointer',
            variant === 'primary' &&
              (value === 'on' ? 'bg-white' : 'bg-newTextColor'),
            value === 'on' ? 'left-[100%] -translate-x-[100%]' : 'left-0'
          )}
        />
      </div>
    </div>
  );
};
