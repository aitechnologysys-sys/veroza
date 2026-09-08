import React from 'react';

/**
 * Full wordmark for wide surfaces (auth, first-billing): the PX mark in an
 * ember tile next to the product name. Drawn in `currentColor` so it works on
 * both paper and ink.
 */
export const LogoTextComponent = () => {
  return (
    <div className="flex items-center gap-[10px] select-none">
      <div className="w-[34px] h-[34px] rounded-[10px] bg-btnPrimary text-white flex items-center justify-center">
        <span className="px-h1 text-[16px] leading-none tracking-[0.01em]">
          PX
        </span>
      </div>
      <span className="px-h1 text-[22px] leading-none">Postaryx</span>
    </div>
  );
};
