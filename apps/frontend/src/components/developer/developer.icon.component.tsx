'use client';

import { FC } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { DeveloperComponent } from '@gitroom/frontend/components/developer/developer.component';

// The developer portal is not exposed publicly yet, so this header entry
// point is hidden. Flip to true to bring it back. Guarding here rather than
// at the call site keeps it hidden in every layout that mounts the component,
// including any added later. Nothing else is affected: the modal below,
// DeveloperComponent, the public API routes and the Developers tab in
// Settings are all untouched.
const SHOW_DEVELOPER_PORTAL = false;

export const DeveloperIconComponent: FC = () => {
  const modals = useModals();
  const t = useT();

  if (!SHOW_DEVELOPER_PORTAL) {
    return null;
  }

  return (
    <div
      className="hover:text-newTextColor cursor-pointer"
      data-tooltip-id="tooltip"
      data-tooltip-content={t('developer', 'Developer')}
      onClick={() => {
        modals.openModal({
          title: t('developer', 'Developer'),
          size: '80%',
          children: <DeveloperComponent />,
        });
      }}
    >
      Developers
    </div>
  );
};
