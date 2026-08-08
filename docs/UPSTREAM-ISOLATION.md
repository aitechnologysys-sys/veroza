# Upstream Isolation — does anything of ours reach Postiz?

**Short answer: no.** Nothing you push, build, or run sends code or data to
`gitroomhq/postiz-app`. This document shows *why* that's true (with the commands
to re-verify it yourself), fixes the one real gap that existed, and lists the
places where we still *point at* Postiz — which is a different thing from
leaking to them.

---

## 1. Why nothing leaks — the four things that make this safe

### a. Our repo is NOT a GitHub fork

This is the big one, and it's easy to get wrong.

```bash
gh repo view aitechnologysys-sys/veroza --json isFork,parent
# → {"isFork":false,"parent":null}
```

`aitechnologysys-sys/veroza` was created as an **independent repository** that
happens to contain Postiz's code, not via GitHub's *Fork* button. That matters
more than it sounds:

| | A real GitHub fork | Us (independent repo) |
|---|---|---|
| Shares a commit store with upstream | **Yes** — commits you push to a public fork are readable from the upstream repo, even with no pull request, even after you delete the branch | **No** |
| "New pull request" defaults its base to | The **upstream** repo | Our own repo |
| Appears in upstream's fork list | Yes | No |

That first row is a real and frequently-surprising GitHub behaviour. Because we
are not a fork, it does not apply to us. **If we had been a fork, every branch
we pushed would have been readable from Postiz's repo.**

> ⚠️ Never re-create this repo using the Fork button, and never "fork" it into
> another account expecting privacy. Independence is a property we currently
> have and could accidentally give up.

### b. `git push` cannot reach upstream any more

There *was* one real gap: the `upstream` remote had a working push URL, so a
mistyped `git push upstream main` would have attempted a push to Postiz. It
would have been rejected (we have no write access there), but relying on "we
lack permission" is not a control — someone who *does* have upstream access
would have succeeded from this clone.

**Fixed.** The push URL is now disabled while fetch still works:

```bash
git remote set-url --push upstream DISABLED
```

Verify:

```bash
git remote -v
# upstream  git@github.com:gitroomhq/postiz-app.git (fetch)
# upstream  DISABLED                                (push)

git push --dry-run upstream main
# fatal: 'DISABLED' does not appear to be a git repository   ← correct
```

> 🔴 **This is a local setting, stored in `.git/config`. It is NOT committed and
> does NOT travel with the repo.** Every fresh clone gets a working upstream push
> URL again. Anyone who clones this repo and adds an `upstream` remote must run
> that command themselves. That is the main reason this document exists.

### c. There is no telemetry or phone-home

Checked, not assumed:

- `apps/frontend/scripts/fetch-gtm.mjs` (runs on `pnpm install`) contacts
  **only** `googletagmanager.com`, and exits immediately if
  `NEXT_PUBLIC_GTM_ID` is unset.
- `libraries/nestjs-libraries/src/track/track.service.ts` makes **no** outbound
  HTTP calls.
- No analytics, licence check, or usage ping to any Postiz-controlled host.

### d. CI never authenticates to anything of theirs

```bash
grep -rhoE "secrets\.[A-Z_]+" .github/workflows/ | sort -u
# → secrets.GITHUB_TOKEN
```

`GITHUB_TOKEN` is minted per workflow run and scoped to **our** repo. It cannot
touch upstream. Deleting the inherited extension workflows also removed the last
references to `NEXTCLOUD_*` and `CHROME_*` secrets, which pointed at Postiz's
own Chrome Web Store listing and file server.

---

## 2. Where we still *point at* Postiz

None of these send them our data. They send **our users** to *their* property,
or credit them. That's a branding and product problem, not a security one — but
you should know the list. Fix them per the rename policy in
[../CLAUDE.md](../CLAUDE.md), deliberately, not with a find-and-replace.

| Location | What it does | Priority |
|---|---|---|
| `.github/FUNDING.yaml` | `open_collective: postiz` — the **Sponsor** button on our repo collects money for Postiz | **High** — trivially fixable, and actively misleading |
| `apps/sdk/src/index.ts:18` | Published SDK's default base URL is `https://api.postiz.com` | **High** if we ever publish the SDK |
| `libraries/nestjs-libraries/src/database/prisma/agencies/agencies.service.ts` | Hardcodes `https://postiz.com/agencies/...` into outbound **emails** | Medium — real users would see these |
| UI links | `docs.postiz.com`, `postiz.com/terms`, `postiz.com/privacy`, `affiliate.postiz.com`, an `uploads.gitroom.com` image | Medium — terms/privacy pointing at another company is the worst of these |
| `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` | Reference the Postiz project and its contribution norms | Low |

---

## 3. What you cannot undo

Be aware of the asymmetry: **isolation protects the future, not the past.**

- Anything already pushed to our **public** repo is public, permanently.
  Removing a file in a later commit does not remove it from history, and GitHub
  caches commit objects independently of branches.
- This is exactly how `.env.prod` ended up readable in commit `1195455e`. The fix
  for that class of problem is always **rotate the credentials**, never "delete
  the commit."
- Turn on **Secret scanning** and **Push protection** (both free on public
  repos) so the next `.env` is blocked at push time instead of found later.

---

## 4. Re-verify anytime

Paste this whole block; every line should match the comment next to it.

```bash
# 1. Still not a fork?
gh repo view aitechnologysys-sys/veroza --json isFork,parent   # isFork:false, parent:null

# 2. Upstream push still disabled?
git remote -v | grep upstream                                  # push URL must be DISABLED

# 3. No secrets beyond the auto-issued one?
grep -rhoE "secrets\.[A-Z_]+" .github/workflows/ | sort -u      # only secrets.GITHUB_TOKEN

# 4. No env files tracked?
git ls-files | grep -i '\.env'                                  # only .env.example

# 5. Where does our code call out to Postiz hosts? (expect only the §2 list)
grep -rnoE "https?://[a-zA-Z0-9._-]*(postiz|gitroom)[^\"'\` )]*" \
  --include="*.ts" --include="*.tsx" apps libraries | grep -v node_modules
```

---

**Related:** [UPSTREAM-SYNC.md](./UPSTREAM-SYNC.md) — the other direction:
pulling *their* fixes into *our* code · [../CLAUDE.md](../CLAUDE.md) — rename
policy and the upstream-parity rule
