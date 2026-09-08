'use client';
import { FC, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import Link from 'next/link';

export const MenuItem: FC<{ label: string; icon: ReactNode; path: string; onClick?: () => void }> = ({
  label,
  icon,
  path,
  onClick,
}) => {
  const currentPath = usePathname();
  const isActive = currentPath.indexOf(path) === 0;

  const className = clsx(
    'w-[64px] custom:w-full py-[8px] px-[6px] gap-[4px] flex flex-col custom:flex-row text-[10px] font-[500] items-center justify-center rounded-[10px] transition-colors hover:bg-railItemActiveBg hover:text-railItemActive',
    isActive ? 'bg-railItemActiveBg text-railItemActive' : 'text-railItem'
  );

  if (onClick) {
    return (
      <button onClick={onClick} className={className}>
        <div className="custom:hidden">{icon}</div>
        <div className="text-[10px] leading-[1.2]">{label}</div>
      </button>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      {...path.indexOf('http') === 0 && { target: '_blank' }}
      className={className}
    >
      <div className="custom:hidden">{icon}</div>
      <div className="text-[10px] leading-[1.2]">{label}</div>
    </Link>
  );
};

/** Mono group heading in the rail (WORK / GROW / ACCOUNT). */
export const MenuGroupLabel: FC<{ label: string }> = ({ label }) => (
  <div className="ds-mono text-[8px] leading-none text-railLabel uppercase mt-[14px] mb-[6px] custom:hidden">
    {label}
  </div>
);
