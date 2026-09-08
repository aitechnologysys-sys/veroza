'use client';

import { FC } from 'react';
import clsx from 'clsx';

/**
 * The PX mark. Set in Fraunces and drawn in `currentColor`, so it picks up
 * the surrounding text colour — white on the dark rail, ink on paper.
 */
export const Logo: FC<{ className?: string }> = ({ className }) => {
  return (
    <div
      aria-label="Postaryx"
      className={clsx(
        'ds-h1 select-none leading-none tracking-[0.01em]',
        !className && 'text-[19px]',
        className
      )}
    >
      PX
    </div>
  );
};
