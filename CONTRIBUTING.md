# Contributing

Thanks for your interest in Postaryx.

**Formal contribution guidelines are currently being prepared.** We do not yet
have a public contributor programme, a documentation site, or a community chat.
Until those exist, this page describes what is actually available today rather
than pointing you at things that are not ready.

If you want to contribute in the meantime, the best first step is to open a
GitHub issue describing what you have in mind, before writing any code.

## What you can do today

- **Open an issue** on the repository to report a bug, request a feature, or
  propose a change. This is the only discussion channel we currently run.
- **Report a security vulnerability** privately. Do not open an issue for
  this — follow [SECURITY.md](SECURITY.md) instead.

Please wait for a response on an issue before starting substantial work. We may
already be working on it, or have a reason to take a different approach, and we
would rather tell you that before you spend your time.

## Getting the project running

These are the working documents for this repository:

| Document | What it covers |
| --- | --- |
| [docs/LOCAL-DEVELOPMENT.md](docs/LOCAL-DEVELOPMENT.md) | Getting a local environment up |
| [docs/RUNNING-DEV-AND-PROD.md](docs/RUNNING-DEV-AND-PROD.md) | Differences between the dev and prod stacks |
| [CLAUDE.md](CLAUDE.md) | Repository layout, conventions, and constraints |

`CLAUDE.md` is the most useful one to read before changing anything. It explains
the monorepo structure, the backend layering, the styling system, and the parts
of the codebase that are deliberately kept close to their original upstream
shape.

## If you open a pull request

This project uses a fork, branch, pull request model:

1. **Fork the repository** to your own GitHub account.
2. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/veroza.git
   ```
3. **Create a branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Make your changes**, keeping them focused on one thing.
5. **Push to your fork:**
   ```bash
   git push -u origin feature/your-feature-name
   ```
6. **Open a pull request** against `main`, describing what changed and why.

Small, self-contained changes are much easier to review than large ones. If a
change is more than a few lines, raise an issue first.

## Types of contribution

- **Bug reports** — what you expected, what happened, and how to reproduce it
- **Bug fixes**
- **Documentation** — corrections and gaps in the documents above
- **Feature requests** — the problem you are trying to solve, not only the
  solution you have in mind

## AI-generated contributions

We do not accept pull requests generated primarily by AI tools. Contributions
must be your own work, and you must understand and be able to explain every
change you submit. Pull requests that appear to be unreviewed model output may
be closed without further review.

Using AI as an assistant is fine. Submitting its output unverified is not.

## Conduct

Participation is covered by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Licensing

This repository is licensed under [AGPL-3.0](LICENSE). By contributing, you
agree that your contribution is licensed under the same terms.

## Need help?

Open a GitHub issue. Once the documentation site and contributor programme are
ready, this page will be updated with those details.
