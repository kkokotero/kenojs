# Security Policy

## Supported Versions

`keno` is still evolving quickly.

At the moment, security fixes are only guaranteed for:

- the current `main` branch
- the latest released version

Older releases, historical commits, and unpublished snapshots should be considered unsupported unless stated otherwise.

## What To Report

Please report vulnerabilities involving:

- request parsing or body handling bugs
- static file serving or path traversal issues
- header, cookie, or redirect handling vulnerabilities
- WebSocket handshake, framing, masking, or compression issues
- HTTP/2 transport and upgrade-related issues
- denial-of-service vectors such as crashes, hangs, resource exhaustion, or unbounded parsing
- TLS, temporary certificate, or local-dev security issues that could affect real deployments
- security-relevant issues in `keno/client`

If you are unsure whether something is security-relevant, report it anyway.

## How To Report

Please do not open public issues for suspected vulnerabilities.

Instead, report them privately to:

- `is.kkokotero@gmail.com`

When possible, include:

- a clear description of the issue
- affected version, commit, or branch
- reproduction steps
- proof of concept or sample code
- expected impact
- any suggested remediation

## Response Expectations

The project will try to:

- acknowledge reports within 72 hours
- provide an initial assessment within 7 days when practical
- coordinate a fix before public disclosure

These are goals, not guarantees, especially while the project is still small.

## Disclosure

Please allow time for coordinated remediation before disclosing a vulnerability publicly.

Once a fix is available, the project may publish:

- a summary of the issue
- affected scope
- remediation guidance
- any compatibility notes

## Security Design Notes

`keno` tries to reduce risk by:

- keeping the runtime surface relatively small and dependency-light
- validating request and upgrade flows explicitly
- guarding static file serving against traversal issues
- keeping transport, routing, and WebSocket concerns modular
- failing fast on malformed protocol or request states where practical

That said, no network-facing runtime should be assumed to be risk-free. Responsible reports are appreciated.
