'use client';

export const Logo = () => {
  return (
    <div className="mt-[8px] min-w-[60px] min-h-[60px] w-[60px] h-[60px]">
      {/* Theme-matched, same convention as the wordmark in
          logo-text.component.tsx: the asset named for a theme renders in it.
          Both are the transparent derivatives, 03 and 04 minus their tiles, so
          the mark sits straight on the sidebar in either theme. 03 and 04
          themselves stay intact as the real app icons, for the favicon, PWA
          and store listings, where the tile is the point. */}
      <img
        src="/logos/08_Postaryx_App_Icon_Light_Transparent.svg"
        alt="Postaryx"
        width={60}
        height={60}
        className="w-full h-full dark:hidden"
      />
      <img
        src="/logos/07_Postaryx_App_Icon_Dark_Transparent.svg"
        alt="Postaryx"
        width={60}
        height={60}
        className="w-full h-full hidden dark:block"
      />
    </div>
  );
};

// Full Postaryx lockup for the top bar, 361:68 native ratio at 28px high.
// Theme-matched like Logo above: the dark wordmark on the light theme and the
// light wordmark on the dark theme.
export const LogoLockup = () => {
  return (
    <div className="flex-none h-[28px] w-[149px]">
      <img
        src="/logos/02_Postaryx_Main_Logo_Light.svg"
        alt="Postaryx"
        width={149}
        height={28}
        className="w-full h-full dark:hidden"
      />
      <img
        src="/logos/01_Postaryx_Main_Logo_Dark.svg"
        alt="Postaryx"
        width={149}
        height={28}
        className="w-full h-full hidden dark:block"
      />
    </div>
  );
};
