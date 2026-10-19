import { FC, useCallback } from 'react';
import clsx from 'clsx';
import { ChevronUpIcon } from '@gitroom/frontend/components/ui/icons';

const Arrow: FC<{
  flip: boolean;
}> = (props) => {
  const { flip } = props;
  return (
    <ChevronUpIcon
      style={{
        transform: !flip ? 'rotate(180deg)' : '',
      }}
    />
  );
};
export const UpDownArrow: FC<{
  isUp: boolean;
  isDown: boolean;
  onChange: (type: 'up' | 'down') => void;
}> = (props) => {
  const { isUp, isDown, onChange } = props;
  const changePosition = useCallback(
    (type: 'up' | 'down') => () => {
      onChange(type);
    },
    []
  );
  return (
    <div className="flex flex-col gap-[4px] pt-[4px]">
      <button
        onClick={changePosition('up')}
        className={clsx(
          'outline-none w-[30px] h-[26px] rounded-[8px] flex justify-center items-center',
          isUp
            ? 'cursor-pointer hover:bg-calModalCell hover:text-calInk'
            : 'pointer-events-none opacity-40'
        )}
      >
        <Arrow flip={true} />
      </button>
      <button
        onClick={changePosition('down')}
        className={clsx(
          'outline-none w-[30px] h-[26px] rounded-[8px] flex justify-center items-center',
          isDown
            ? 'cursor-pointer hover:bg-calModalCell hover:text-calInk'
            : 'pointer-events-none opacity-40'
        )}
      >
        <Arrow flip={false} />
      </button>
    </div>
  );
};
