export const dynamic = 'force-dynamic';
import { AdminErrorsComponent } from '@gitroom/frontend/components/admin/admin-errors.component';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';

export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postaryx' : 'Postaryx'} Admin Errors`,
  description: '',
};

export default async function Page() {
  return (
    <div className="ds-card flex-1 min-w-0 flex-col flex p-[20px] gap-[12px] overflow-y-auto">
      <AdminErrorsComponent />
    </div>
  );
}
