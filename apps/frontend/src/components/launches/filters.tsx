'use client';

import { useCalendar, ListStateFilter } from '@gitroom/frontend/components/launches/calendar.context';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useCallback } from 'react';
import { SelectCustomer } from '@gitroom/frontend/components/launches/select.customer';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from 'i18next';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';

// Helper function to get start and end dates based on display type
function getDateRange(
  display: 'day' | 'week' | 'month' | 'list',
  referenceDate?: string
) {
  const date = referenceDate ? newDayjs(referenceDate) : newDayjs();

  switch (display) {
    case 'day':
      return {
        startDate: date.format('YYYY-MM-DD'),
        endDate: date.format('YYYY-MM-DD'),
      };
    case 'week':
      return {
        startDate: date.startOf('isoWeek').format('YYYY-MM-DD'),
        endDate: date.endOf('isoWeek').format('YYYY-MM-DD'),
      };
    case 'month':
      return {
        startDate: date.startOf('month').format('YYYY-MM-DD'),
        endDate: date.endOf('month').format('YYYY-MM-DD'),
      };
    case 'list':
      return {
        startDate: date.format('YYYY-MM-DD'),
        endDate: date.format('YYYY-MM-DD'),
      };
  }
}

export const Filters = () => {
  const calendar = useCalendar();
  const t = useT();

  // Set dayjs locale based on current language
  const currentLanguage = i18next.resolvedLanguage || 'en';
  dayjs.locale();

  // Masthead title and subtitle for the current range (display only)
  const getDisplayTitle = () => {
    const startDate = newDayjs(calendar.startDate);

    switch (calendar.display) {
      case 'day':
        return startDate.format('dddd');
      case 'week':
        return t('week_number', 'Week {{number}}', {
          number: startDate.isoWeek(),
        });
      case 'month':
        return startDate.format('MMMM');
      default:
        return t('all_posts', 'All posts');
    }
  };

  const getDisplayText = () => {
    const startDate = newDayjs(calendar.startDate);
    const endDate = newDayjs(calendar.endDate);

    switch (calendar.display) {
      case 'day':
        return startDate.format('LL');
      case 'week':
        return startDate.month() === endDate.month()
          ? `${startDate.format('MMMM D')} – ${endDate.format('D')}`
          : `${startDate.format('MMM D')} – ${endDate.format('MMM D')}`;
      case 'month':
        return startDate.format('YYYY');
      default:
        return `${t('page', 'Page')} ${calendar.listPage + 1} ${t(
          'of',
          'of'
        )} ${Math.max(1, calendar.listTotalPages)}`;
    }
  };

  const setToday = useCallback(() => {
    const today = newDayjs();
    const currentRange = getDateRange(
      calendar.display as 'day' | 'week' | 'month'
    );

    // Check if we're already showing today's range
    if (
      calendar.startDate === currentRange.startDate &&
      calendar.endDate === currentRange.endDate
    ) {
      return; // No need to set the same range
    }

    calendar.setFilters({
      startDate: currentRange.startDate,
      endDate: currentRange.endDate,
      display: calendar.display as 'day' | 'week' | 'month',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setDay = useCallback(() => {
    // If already in day view and showing today, don't change
    if (calendar.display === 'day') {
      const todayRange = getDateRange('day');
      if (calendar.startDate === todayRange.startDate) {
        return;
      }
    }

    const range = getDateRange('day');
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: 'day',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setWeek = useCallback(() => {
    // If already in week view and showing current week, don't change
    if (calendar.display === 'week') {
      const currentWeekRange = getDateRange('week');
      if (calendar.startDate === currentWeekRange.startDate) {
        return;
      }
    }

    const range = getDateRange('week');
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: 'week',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setMonth = useCallback(() => {
    // If already in month view and showing current month, don't change
    if (calendar.display === 'month') {
      const currentMonthRange = getDateRange('month');
      if (calendar.startDate === currentMonthRange.startDate) {
        return;
      }
    }

    const range = getDateRange('month');
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: 'month',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setList = useCallback(() => {
    if (calendar.display === 'list') {
      return;
    }

    const range = getDateRange('list');
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: 'list',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setCalendarView = useCallback(() => {
    if (calendar.display !== 'list') {
      return;
    }

    const range = getDateRange('week');
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: 'week',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setCustomer = useCallback(
    (customer: string) => {
      if (calendar.customer === customer) {
        return; // No need to set the same customer
      }
      calendar.setFilters({
        startDate: calendar.startDate,
        endDate: calendar.endDate,
        display: calendar.display as 'day' | 'week' | 'month',
        customer: customer,
      });
    },
    [calendar]
  );

  const next = useCallback(() => {
    const currentStart = newDayjs(calendar.startDate);
    let nextStart: dayjs.Dayjs;

    switch (calendar.display) {
      case 'day':
        nextStart = currentStart.add(1, 'day');
        break;
      case 'week':
        nextStart = currentStart.add(1, 'week');
        break;
      case 'month':
        nextStart = currentStart.add(1, 'month');
        break;
      default:
        nextStart = currentStart.add(1, 'week');
    }

    const range = getDateRange(
      calendar.display as 'day' | 'week' | 'month',
      nextStart.format('YYYY-MM-DD')
    );
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: calendar.display as 'day' | 'week' | 'month',
      customer: calendar.customer,
    });
  }, [calendar]);

  const previous = useCallback(() => {
    const currentStart = newDayjs(calendar.startDate);
    let prevStart: dayjs.Dayjs;

    switch (calendar.display) {
      case 'day':
        prevStart = currentStart.subtract(1, 'day');
        break;
      case 'week':
        prevStart = currentStart.subtract(1, 'week');
        break;
      case 'month':
        prevStart = currentStart.subtract(1, 'month');
        break;
      default:
        prevStart = currentStart.subtract(1, 'week');
    }

    const range = getDateRange(
      calendar.display as 'day' | 'week' | 'month',
      prevStart.format('YYYY-MM-DD')
    );
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: calendar.display as 'day' | 'week' | 'month',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setCurrent = useCallback(
    (type: 'day' | 'week' | 'month') => () => {
      if (type === 'day') {
        setDay();
      } else if (type === 'week') {
        setWeek();
      } else if (type === 'month') {
        setMonth();
      }
    },
    [setDay, setWeek, setMonth]
  );

  const isListView = calendar.display === 'list';

  const setListStateFilter = useCallback(
    (next: ListStateFilter) => () => {
      if (calendar.listState === next) return;
      calendar.setListState(next);
    },
    [calendar]
  );

  const listStateOptions: { value: ListStateFilter; label: string }[] = [
    { value: 'all', label: t('all', 'All') },
    { value: 'scheduled', label: t('scheduled', 'Scheduled') },
    { value: 'draft', label: t('draft', 'Draft') },
    { value: 'published', label: t('published', 'Published') },
  ];

  const previousPage = useCallback(() => {
    if (calendar.listPage > 0) {
      calendar.setListPage(calendar.listPage - 1);
    }
  }, [calendar]);

  const nextPage = useCallback(() => {
    if (calendar.listPage < calendar.listTotalPages - 1) {
      calendar.setListPage(calendar.listPage + 1);
    }
  }, [calendar]);

  const tabClass = (active: boolean) =>
    clsx(
      'py-[6px] border-b-2 bg-transparent cursor-pointer whitespace-nowrap transition-colors',
      active
        ? 'font-[600] text-calInk border-btnPrimary'
        : 'text-calMuted border-transparent hover:text-calInk'
    );

  const roundButtonClass = (enabled: boolean) =>
    clsx(
      'w-[40px] h-[40px] border border-calInk rounded-full bg-transparent text-calInk flex items-center justify-center transition-colors',
      enabled
        ? 'cursor-pointer hover:bg-calInk hover:text-calInkInverse'
        : 'opacity-50 cursor-not-allowed'
    );

  const chevronPrevious = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="rtl:rotate-180"
    >
      <path
        d="M10 3L5 8l5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const chevronNext = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="rtl:rotate-180"
    >
      <path
        d="M6 3l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <div className="text-calInk flex flex-col gap-[12px] border-t-[3px] border-b border-calInk pt-[12px] pb-[14px] select-none">
      <div className="flex items-center gap-[16px] flex-wrap font-mono text-[11px] text-calMuted uppercase">
        <span>
          Postaryx · {t('calendar', 'Calendar')}
        </span>
        <span
          aria-hidden="true"
          className="flex-1 h-[1px] bg-calLine min-w-[40px]"
        />
        <span>{newDayjs().format('dddd, LL')}</span>
      </div>
      <div className="flex items-end gap-x-[24px] gap-y-[12px] flex-wrap">
        <div className="flex items-baseline gap-x-[18px] gap-y-[4px] flex-wrap">
          <h1 className="m-0 font-serif font-[600] text-[48px] lg:text-[64px] xl:text-[76px] leading-[0.9] text-calInk">
            {getDisplayTitle()}
          </h1>
          <span className="font-serif italic font-[500] text-[22px] text-calMuted">
            {getDisplayText()}
          </span>
        </div>
        <span className="flex-1" />
        <div
          role="toolbar"
          aria-label={t('calendar', 'Calendar')}
          className="flex items-center gap-x-[18px] gap-y-[12px] flex-wrap"
        >
          {!isListView && (
            <div className="flex items-center gap-[4px]">
              <button
                type="button"
                onClick={previous}
                aria-label={t('previous', 'Previous')}
                className={roundButtonClass(true)}
              >
                {chevronPrevious}
              </button>
              <button
                type="button"
                onClick={next}
                aria-label={t('next', 'Next')}
                className={roundButtonClass(true)}
              >
                {chevronNext}
              </button>
              <button
                type="button"
                onClick={setToday}
                className="h-[40px] px-[16px] ms-[4px] rounded-full bg-calInk text-calInkInverse font-[500] text-[14px] cursor-pointer hover:opacity-90"
              >
                {t('today', 'Today')}
              </button>
            </div>
          )}
          {isListView && (
            <div className="flex items-center gap-[4px]">
              <button
                type="button"
                onClick={previousPage}
                aria-label={t('previous', 'Previous')}
                aria-disabled={!(calendar.listPage > 0)}
                className={roundButtonClass(calendar.listPage > 0)}
              >
                {chevronPrevious}
              </button>
              <button
                type="button"
                onClick={nextPage}
                aria-label={t('next', 'Next')}
                aria-disabled={
                  !(calendar.listPage < calendar.listTotalPages - 1)
                }
                className={roundButtonClass(
                  calendar.listPage < calendar.listTotalPages - 1
                )}
              >
                {chevronNext}
              </button>
            </div>
          )}
          <div
            role="group"
            className="flex items-stretch gap-x-[16px] gap-y-[4px] flex-wrap font-serif text-[18px]"
          >
            {!isListView && (
              <>
                <button
                  type="button"
                  aria-pressed={calendar.display === 'day'}
                  className={tabClass(calendar.display === 'day')}
                  onClick={setDay}
                >
                  {t('day', 'Day')}
                </button>
                <button
                  type="button"
                  aria-pressed={calendar.display === 'week'}
                  className={tabClass(calendar.display === 'week')}
                  onClick={setWeek}
                >
                  {t('week', 'Week')}
                </button>
                <button
                  type="button"
                  aria-pressed={calendar.display === 'month'}
                  className={tabClass(calendar.display === 'month')}
                  onClick={setMonth}
                >
                  {t('month', 'Month')}
                </button>
                <span aria-hidden="true" className="w-[1px] bg-calLineStrong" />
              </>
            )}
            <button
              type="button"
              aria-pressed={!isListView}
              className={tabClass(!isListView)}
              onClick={setCalendarView}
            >
              {t('calendar', 'Calendar')}
            </button>
            <button
              type="button"
              aria-pressed={isListView}
              className={tabClass(isListView)}
              onClick={setList}
            >
              {t('list', 'List')}
            </button>
            {isListView && (
              <>
                <span aria-hidden="true" className="w-[1px] bg-calLineStrong" />
                {listStateOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    aria-pressed={calendar.listState === option.value}
                    onClick={setListStateFilter(option.value)}
                    className={tabClass(calendar.listState === option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </>
            )}
          </div>
          <SelectCustomer
            variant="pill"
            customer={calendar.customer as string}
            onChange={(customer: string) => setCustomer(customer)}
            integrations={calendar.integrations}
          />
        </div>
      </div>
    </div>
  );
};
