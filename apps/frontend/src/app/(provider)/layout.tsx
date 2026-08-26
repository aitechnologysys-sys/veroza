import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';

export const dynamic = 'force-dynamic';
import '../global.scss';
import 'react-tooltip/dist/react-tooltip.css';
import '@copilotkit/react-ui/styles.css';
import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { ReactNode } from 'react';
import { Fraunces, Geist, Geist_Mono } from 'next/font/google';
import clsx from 'clsx';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import UtmSaver from '@gitroom/helpers/utils/utm.saver';
import { isBillingEnabled } from '@gitroom/helpers/utils/is.billing.enabled';

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
});

const genericOauthEnabled =
  process.env.POSTARYX_GENERIC_OAUTH ?? process.env.POSTIZ_GENERIC_OAUTH;
const oauthLogoUrl =
  process.env.NEXT_PUBLIC_POSTARYX_OAUTH_LOGO_URL ||
  process.env.NEXT_PUBLIC_POSTIZ_OAUTH_LOGO_URL;
const oauthDisplayName =
  process.env.NEXT_PUBLIC_POSTARYX_OAUTH_DISPLAY_NAME ||
  process.env.NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME;

export default async function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body
        className={clsx(
          geist.variable,
          geistMono.variable,
          fraunces.variable,
          'dark font-sans text-primary !bg-primary'
        )}
      >
        <VariableContextComponent
          language="en"
          storageProvider={
            process.env.STORAGE_PROVIDER! as 'local' | 'cloudflare'
          }
          stripeClient=""
          environment={process.env.NODE_ENV!}
          backendUrl={process.env.NEXT_PUBLIC_BACKEND_URL!}
          plontoKey={process.env.NEXT_PUBLIC_POLOTNO!}
          billingEnabled={isBillingEnabled()}
          discordUrl={process.env.NEXT_PUBLIC_DISCORD_SUPPORT!}
          frontEndUrl={process.env.FRONTEND_URL!}
          isGeneral={!!process.env.IS_GENERAL}
          genericOauth={!!genericOauthEnabled}
          oauthLogoUrl={oauthLogoUrl!}
          oauthDisplayName={oauthDisplayName!}
          uploadDirectory={process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY!}
          cloudflareUrl={process.env.CLOUDFLARE_BUCKET_URL || ''}
          mainUrl={process.env.MAIN_URL || ''}
          mcpUrl={process.env.MCP_URL}
          dub={false}
          facebookPixel={process.env.NEXT_PUBLIC_FACEBOOK_PIXEL!}
          telegramBotName={process.env.TELEGRAM_BOT_NAME!}
          neynarClientId={process.env.NEYNAR_CLIENT_ID!}
          isSecured={!process.env.NOT_SECURED}
          disableImageCompression={!!process.env.DISABLE_IMAGE_COMPRESSION}
          disableXAnalytics={!!process.env.DISABLE_X_ANALYTICS}
          sentryDsn={process.env.NEXT_PUBLIC_SENTRY_DSN!}
          extensionId={process.env.EXTENSION_ID || ''}
          transloadit={
            process.env.TRANSLOADIT_AUTH && process.env.TRANSLOADIT_TEMPLATE
              ? [
                  process.env.TRANSLOADIT_AUTH!,
                  process.env.TRANSLOADIT_TEMPLATE!,
                ]
              : []
          }
        >
          <MantineWrapper>
            <LayoutContext>
              <UtmSaver />
              {children}
            </LayoutContext>
          </MantineWrapper>
        </VariableContextComponent>
      </body>
    </html>
  );
}
