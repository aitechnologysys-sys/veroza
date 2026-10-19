import { FC, useCallback, useState } from 'react';
import dayjs from 'dayjs';
import { Calendar, TimeInput } from '@mantine/dates';
import { useClickOutside } from '@mantine/hooks';
import { Button } from '@gitroom/react/form/button';
import { isUSCitizen } from './isuscitizen.utils';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import clsx from 'clsx';
export const DatePicker: FC<{
  date: dayjs.Dayjs;
  onChange: (day: dayjs.Dayjs) => void;
  // 'top' opens the popover above the trigger (original); 'bottom' below it.
  placement?: 'top' | 'bottom';
}> = (props) => {
  const { date, onChange, placement = 'top' } = props;
  const [open, setOpen] = useState(false);
  const t = useT();

  const changeShow = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);
  const ref = useClickOutside<HTMLDivElement>(() => {
    setOpen(false);
  });
  const changeDate = useCallback(
    (type: 'date' | 'time') => (day: Date) => {
      onChange(
        newDayjs(
          type === 'time'
            ? date.format('YYYY-MM-DD') + ' ' + newDayjs(day).format('HH:mm:ss')
            : newDayjs(day).format('YYYY-MM-DD') + ' ' + date.format('HH:mm:ss')
        )
      );
    },
    [date]
  );
  return (
    <div
      className="h-[48px] px-[6px] border-b-2 border-calInk flex gap-[10px] items-center relative font-[600] text-calInk select-none cursor-pointer"
      onClick={changeShow}
      ref={ref}
    >
      <div className="cursor-pointer whitespace-nowrap">{date.format('ddd, MMM D')}</div>
      <div className="cursor-pointer whitespace-nowrap font-mono text-[15px] font-[500]">
        {date.format(isUSCitizen() ? 'hh:mm A' : 'HH:mm')}
      </div>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={clsx(
            'animate-fadeIn absolute bg-calCard border border-calLine shadow-[0_18px_40px_-18px_rgba(0,0,0,0.35)] text-textColor rounded-[14px] z-[300] p-[14px] flex flex-col font-sans font-[400] text-[14px] cursor-default',
            placement === 'bottom'
              ? 'top-[100%] mt-[10px] start-0'
              : 'bottom-[100%] mb-[16px] start-[50%] -translate-x-[50%]'
          )}
        >
          <Calendar
            onChange={changeDate('date')}
            value={date.toDate()}
            dayClassName={(date, modifiers) => {
              if (modifiers.weekend) {
                return '!text-customColor28';
              }
              if (modifiers.outside) {
                return '!text-gray';
              }
              if (modifiers.selected) {
                return '!text-white !bg-seventh !outline-none';
              }
              return '!text-textColor';
            }}
            classNames={{
              day: 'hover:bg-seventh',
              calendarHeaderControl: 'text-textColor hover:bg-third',
              calendarHeaderLevel: 'text-textColor hover:bg-third', // cell: 'child:!text-textColor'
            }}
          />
          <TimeInput
            onChange={changeDate('time')}
            label="Pick time"
            classNames={{
              label: 'text-textColor py-[12px]',
              input:
                'bg-sixth h-[40px] border border-tableBorder text-textColor rounded-[4px] outline-none',
            }}
            defaultValue={date.toDate()}
          />
          <Button className="mt-[12px] rounded-full" onClick={changeShow}>
            {t('close', 'Close')}
          </Button>
        </div>
      )}
    </div>
  );
};
