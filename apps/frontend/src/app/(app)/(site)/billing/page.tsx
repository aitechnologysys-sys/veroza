export const dynamic = 'force-dynamic';
import { BillingComponent } from '@gitroom/frontend/components/billing/billing.component';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postaryx' : 'Postaryx'} Billing`,
  description: '',
};
export default async function Page() {
  return (
    <div className="px-card flex-1 min-w-0 flex-col flex p-[20px] gap-[12px] overflow-y-auto">
      <BillingComponent />
    </div>
  );
}
