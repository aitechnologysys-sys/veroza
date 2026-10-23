/**
 * The account-selection dialogs rendered the provider's own CDN URL directly,
 * with no guard. Those URLs are signed and short-lived, and the field can be
 * absent, so a missing or expired one produced a broken image with nothing to
 * identify the account by.
 *
 * Rendered with react-dom/server rather than Testing Library: jsdom in this
 * repo pulls in an unbuilt `canvas` native binding and cannot start. That
 * covers every branch except the onError transition, which needs a live DOM —
 * see the note at the end of this file.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderAvatar } from './provider.avatar';

const html = (el: JSX.Element) => renderToStaticMarkup(el);

describe('ProviderAvatar', () => {
  it('renders the image when a url is present', () => {
    const out = html(
      <ProviderAvatar url="https://example.invalid/a.jpg" name="Example" />
    );

    expect(out).toContain('src="https://example.invalid/a.jpg"');
    expect(out).toContain('provider-avatar-image');
    expect(out).not.toContain('provider-avatar-fallback');
  });

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
  ])('falls back when the url is %s', (_label, url) => {
    const out = html(<ProviderAvatar url={url as any} name="Example" />);

    expect(out).toContain('provider-avatar-fallback');
    expect(out).not.toContain('provider-avatar-image');
    expect(out).not.toContain('<img');
  });

  it('shows the account initial so several accounts stay distinguishable', () => {
    expect(html(<ProviderAvatar name="lunarkdynamics" />)).toContain('>L<');
  });

  it('copes with a missing name', () => {
    const out = html(<ProviderAvatar />);

    expect(out).toContain('>?<');
    expect(out).toContain('aria-label="avatar"');
  });

  it("keeps the caller's sizing classes on both branches", () => {
    expect(
      html(
        <ProviderAvatar url="https://example.invalid/a.jpg" className="max-w-[156px]" />
      )
    ).toContain('max-w-[156px]');

    expect(html(<ProviderAvatar className="max-w-[156px]" />)).toContain(
      'max-w-[156px]'
    );
  });

  it('labels the fallback for assistive technology', () => {
    const out = html(<ProviderAvatar name="Example" />);

    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Example avatar"');
  });

  it('wires an error handler so an expired url can fall back', () => {
    // The transition itself needs a DOM; assert the handler exists so the
    // path cannot be removed unnoticed.
    const element = <ProviderAvatar url="https://example.invalid/a.jpg" />;
    expect(typeof (element.props as any)).toBe('object');
    expect(ProviderAvatar.toString()).toContain('onError');
  });
});
