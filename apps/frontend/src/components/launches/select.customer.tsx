'use client';

import { uniqBy } from 'lodash';
import React, { FC, useCallback, useMemo, useRef, useState } from 'react';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';
import { useClickOutside } from '@mantine/hooks';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useShallow } from 'zustand/react/shallow';
import { UserIcon, DropdownArrowIcon } from '@gitroom/frontend/components/ui/icons';

export const SelectCustomer: FC<{
  onChange: (value: string) => void;
  integrations: Integrations[];
  customer?: string;
  // 'pill' is the calendar masthead trigger; 'icon-pill' is the Create Post
  // modal header trigger (icon + chevron, dropdown aligned to its end edge so
  // it stays on screen at the modal's right edge); 'default' is the original.
  variant?: 'default' | 'pill' | 'icon-pill';
}> = (props) => {
  const {
    onChange,
    integrations,
    customer: currentCustomer,
    variant = 'default',
  } = props;
  const { setCurrent } = useLaunchStore(
    useShallow((state) => ({
      setCurrent: state.setCurrent,
    }))
  );
  const toaster = useToaster();
  const t = useT();
  const [customer, setCustomer] = useState(currentCustomer || '');
  const [pos, setPos] = useState<any>({});
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => {
    if (open) {
      setOpen(false);
    }
  });

  const openClose = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }

    const { x, y, width, height } = ref.current?.getBoundingClientRect();
    setPos(
      variant === 'icon-pill'
        ? { top: y + height + 6, right: window.innerWidth - (x + width) }
        : { top: y + height, left: x }
    );
    setOpen(true);
  }, [open, variant]);

  const totalCustomers = useMemo(() => {
    return uniqBy(integrations, (i) => i?.customer?.id).length;
  }, [integrations]);
  const selectedCustomerName = useMemo(() => {
    return integrations.find((i) => customer && i?.customer?.id === customer)
      ?.customer?.name;
  }, [integrations, customer]);
  if (totalCustomers <= 1) {
    return null;
  }

  return (
    <div className="relative select-none z-[500]" ref={ref}>
      <div
        data-tooltip-id="tooltip"
        data-tooltip-content={t('select_customer_tooltip', 'Select Customer')}
        onClick={openClose}
        className={clsx(
          variant === 'pill'
            ? 'relative z-[20] cursor-pointer h-[40px] rounded-full ps-[14px] pe-[12px] gap-[8px] border flex items-center text-calInk text-[14px] whitespace-nowrap'
            : variant === 'icon-pill'
            ? 'relative z-[20] cursor-pointer h-[36px] rounded-full px-[12px] gap-[6px] border flex items-center text-calInk'
            : 'relative z-[20] cursor-pointer h-[42px] rounded-[8px] pl-[16px] pr-[12px] gap-[8px] border flex items-center',
          open
            ? 'border-[#c2410c]'
            : variant === 'pill' || variant === 'icon-pill'
            ? 'border-calInk'
            : 'border-newColColor'
        )}
      >
        <div>
          <UserIcon
            size={
              variant === 'pill' ? 16 : variant === 'icon-pill' ? 14 : undefined
            }
          />
        </div>
        {variant === 'pill' && (
          <div className="max-w-[160px] overflow-hidden text-ellipsis">
            {selectedCustomerName ||
              t('select_customer_label', 'Select Customer')}
          </div>
        )}
        <div>
          <DropdownArrowIcon rotated={open} />
        </div>
      </div>
      {open && (
        <div
          style={pos}
          className="flex flex-col fixed pt-[12px] bg-newBgColorInner menu-shadow min-w-[250px]"
        >
          <div className="text-[14px] font-[600] px-[12px] mb-[5px]">
            {t('customers', 'Customers')}
          </div>
          {uniqBy(integrations, (u) => u?.customer?.name)
            .filter((f) => f.customer?.name)
            .map((p) => (
              <div
                onClick={() => {
                  toaster.show(
                    t('customer_socials_selected', 'Customer socials selected'),
                    'success'
                  );
                  setCustomer(p.customer?.id);
                  onChange(p.customer?.id);
                  setOpen(false);
                  setCurrent('global')
                }}
                key={p.customer?.id}
                className="p-[12px] hover:bg-newBgColor text-[14px] font-[500] h-[32px] flex items-center"
              >
                {p.customer?.name}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
