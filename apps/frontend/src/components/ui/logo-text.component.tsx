import React from 'react';

// Postaryx lockup, 361:68 native ratio kept at the previous 33px logo height.
export const LogoTextComponent = () => {
  return (
    <div className="h-[33px] w-[175px]">
      {/* Dark wordmark for the light theme, light wordmark for the dark theme */}
      <img
        src="/logos/02_Postaryx_Main_Logo_Light.svg"
        alt="Postaryx"
        width={175}
        height={33}
        className="w-full h-full dark:hidden"
      />
      <img
        src="/logos/01_Postaryx_Main_Logo_Dark.svg"
        alt="Postaryx"
        width={175}
        height={33}
        className="w-full h-full hidden dark:block"
      />
    </div>
  );
};
