import { getT } from '@gitroom/react/translation/get.translation.service.backend';

export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import loadDynamic from 'next/dynamic';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
const ReturnUrlComponent = loadDynamic(() => import('./return.url.component'));
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const t = await getT();

  return (
    <div className="bg-newBackdrop relative flex flex-1 items-center justify-center p-[12px] min-h-screen w-screen text-white">
      {/*<style>{`html, body {overflow-x: hidden;}`}</style>*/}
      {/* Ambient brand halo centred on the card, so the warmth stays local
          and the corners fall back to the flat backdrop. A radial gradient
          rather than blurred blobs: the falloff is explicit and it costs no
          compositing layer. Defined as --auth-ambient in colors.scss. */}
      <div
        aria-hidden="true"
        className="auth-ambient pointer-events-none absolute inset-0"
      />
      <ReturnUrlComponent />
      <div className="relative flex flex-col py-[40px] px-[20px] flex-1 lg:w-[680px] lg:flex-none rounded-[12px] border border-cardAccentBorder text-white p-[12px] bg-newBgColorInner">
        <div className="w-full max-w-[500px] mx-auto justify-center gap-[20px] flex flex-col text-white">
          <LogoTextComponent />
          <div className="flex">{children}</div>
        </div>
      </div>
    </div>
  );
}
