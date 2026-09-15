'use client';

export const Logo = () => {
  return (
    <div className="mt-[8px] min-w-[60px] min-h-[60px] w-[60px] h-[60px]">
      {/* Dark tile for the light theme, light tile for the dark theme */}
      <img
        src="/logos/03_Postaryx_App_Icon_Dark.svg"
        alt="Postaryx"
        width={60}
        height={60}
        className="w-full h-full dark:hidden"
      />
      <img
        src="/logos/04_Postaryx_App_Icon_Light.svg"
        alt="Postaryx"
        width={60}
        height={60}
        className="w-full h-full hidden dark:block"
      />
    </div>
  );
};
