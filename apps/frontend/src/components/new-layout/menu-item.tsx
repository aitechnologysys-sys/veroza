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

  // Horizontal tab in the top bar; text-only, so the icon is not displayed.
  const className = clsx(
    'flex-none h-[36px] px-[12px] flex items-center rounded-[8px] text-[14px] whitespace-nowrap transition-colors',
    isActive
      ? 'bg-calEmberSoft text-calEmberText font-[500]'
      : 'text-calMuted hover:text-calInk hover:bg-boxHover'
  );

  if (onClick) {
    return (
      <button onClick={onClick} className={className}>
        <div className="hidden">{icon}</div>
        <div>{label}</div>
      </button>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      {...path.indexOf('http') === 0 && { target: '_blank' }}
      className={className}
      {...(isActive ? { 'aria-current': 'page' as const } : {})}
    >
      <div className="hidden">{icon}</div>
      <div>{label}</div>
    </Link>
  );
};
