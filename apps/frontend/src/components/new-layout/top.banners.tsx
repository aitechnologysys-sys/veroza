'use client';

import { FC, useEffect, useRef } from 'react';
import { AnnouncementBanner } from '@gitroom/frontend/components/layout/announcement.banner';
import { FoundingPromoBanner } from '@gitroom/frontend/components/billing/founding.promo.banner';

/**
 * Every banner that sits above the app chrome.
 *
 * #left-menu is `fixed top-0`, so anything in normal flow above it overlaps the
 * sidebar unless the sidebar is pushed down by exactly the banner stack's height.
 * This measures that stack and publishes it as --top-banners-height, which is the
 * single owner of the offset — previously AnnouncementBanner injected its own
 * <style> with a hardcoded 60/100px guess (and an unbalanced CSS string), which
 * could not account for a second banner.
 *
 * showAnnouncements is false on the paywall. Announcements are app-operational and
 * mean little to someone who cannot reach the app, which is why they were scoped to
 * the non-FREE branch before this component existed. The founding promo banner is
 * the opposite — the paywall is exactly its audience — so it always renders.
 */
export const TopBanners: FC<{ showAnnouncements: boolean }> = ({
  showAnnouncements,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const publish = () =>
      document.documentElement.style.setProperty(
        '--top-banners-height',
        `${element.offsetHeight}px`
      );

    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(element);

    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--top-banners-height');
    };
  }, []);

  return (
    <div ref={ref} className="flex flex-col gap-[8px] empty:hidden">
      <FoundingPromoBanner />
      {showAnnouncements && <AnnouncementBanner />}
    </div>
  );
};
