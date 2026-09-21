# Security Policy

## Introduction

Postaryx is operated by Lunark Dynamics LLC. We take the security of our
service and our users' data seriously, and we welcome reports from security
researchers.

This policy explains what is in scope, how to report a vulnerability to us,
and what to expect after you do.

## Scope

We accept vulnerability reports affecting:

- The Postaryx web application (`app.postaryx.com`)
- The Postaryx API (`api.postaryx.com`)
- The Postaryx source repository
  (`github.com/aitechnologysys-sys/veroza`)
- Official Postaryx container images published under
  `ghcr.io/aitechnologysys-sys`

The following are out of scope:

- Vulnerabilities in third-party dependencies, unless the issue is caused by
  how Postaryx uses them. Please report those upstream.
- Infrastructure you host and operate yourself. Self-hosted deployments are
  your responsibility to secure and update.
- Third-party platforms Postaryx integrates with, such as the social networks
  and payment providers. Report those to the platform concerned.
- Findings that require physical access, a compromised device, or social
  engineering of our staff or users.
- Volumetric denial of service, and automated scanner output submitted without
  analysis.

Please do not test against other people's accounts or data. If you need an
account to demonstrate an issue, create your own.

## Supported versions

Security fixes are applied to the hosted service and to the latest published
version of the source. Older versions do not receive backported fixes, so
self-hosted deployments should stay current.

## Reporting a vulnerability

Email **security@postaryx.com** with the details.

If you have access to the repository, you may instead open a private report
through GitHub Security Advisories, which keeps the discussion attached to the
code.

Please do not open a public issue, pull request, or discussion for a security
problem, and please give us a reasonable opportunity to fix it before
disclosing it publicly.

### What to include

The more of this you can provide, the faster we can act:

- A clear description of the vulnerability and its impact
- Steps to reproduce it
- A proof of concept, where one is possible
- Affected URLs, endpoints, versions, or configuration
- Any relevant logs, requests, or code references

If you believe the issue is being actively exploited, or that it exposes user
data, say so in the subject line.

### Reports containing AI-assisted analysis

Reports that include AI-assisted analysis are welcome, provided you have
validated the finding yourself and can supply reproduction steps and a proof
of concept. Unverified model output submitted without that validation is not
actionable and will be closed.

## What happens next

When we receive a report we will:

1. Acknowledge that we have it.
2. Investigate and confirm whether it is reproducible.
3. Tell you what we found, and whether we intend to fix it.
4. Develop and release a fix, prioritised by severity.
5. Keep you informed while that work is underway.

We handle reports under coordinated disclosure: we will not publish details of
a vulnerability until a fix is available, so that users are not left exposed.
If you intend to publish your own write-up, please coordinate the timing with
us first.

We are happy to credit reporters who want it. Tell us how you would like to be
named, or say if you would rather stay anonymous.

## Contact

**security@postaryx.com** — Lunark Dynamics LLC
