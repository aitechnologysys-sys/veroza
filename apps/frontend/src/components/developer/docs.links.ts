/**
 * The "Docs" buttons in Settings → Public API / Developer.
 *
 * These sections exist in the landing repo (clientside-landing/content/docs)
 * but are not published yet — see the `files` glob in its source.config.ts.
 * Until they are, their URLs 404, so the buttons stay hidden rather than
 * sending customers to a dead page.
 *
 * When a section goes live on postaryx.com, flip its `published` to true.
 */
export const docsLinks = {
  mcp: {
    href: 'https://postaryx.com/docs/mcp/introduction',
    published: false,
  },
  cli: {
    href: 'https://postaryx.com/docs/cli/introduction',
    published: false,
  },
  publicApi: {
    href: 'https://postaryx.com/docs/public-api/introduction',
    published: false,
  },
  oauth: {
    href: 'https://postaryx.com/docs/public-api/oauth',
    published: false,
  },
} as const;
