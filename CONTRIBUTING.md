# Contributing to Keno

Thank you for contributing to `keno`.

The goal of this project is to keep a modern TypeScript-first HTTP and WebSocket toolkit small, understandable, fast, and pleasant to use. Contributions that improve correctness, documentation, examples, tests, performance, and API clarity are welcome.

## Ways To Contribute

You can help by:

- reporting bugs and regressions
- improving documentation and examples
- adding tests for edge cases and protocol behavior
- improving performance-sensitive code paths
- refining developer experience in the server or client APIs
- proposing API changes that stay aligned with the project's design goals

## Before You Start

For small fixes, feel free to open a pull request directly.

For larger changes, please open an issue first so we can align on scope, API shape, compatibility impact, and maintenance cost before implementation starts.

Changes that should usually be discussed first:

- new public subpath exports
- new middleware, plugins, or transport features
- behavioral changes in routing, body parsing, static files, or WebSocket handling
- retry, timeout, or prepared-request behavior in `keno/client`
- changes to worker pools, thread clustering, or HTTP/2 support
- anything that adds new runtime dependencies

## Local Setup

Install dependencies:

```bash
npm install
```

Run the main validation gate:

```bash
npm run check
```

Useful commands during development:

```bash
npm run typecheck
npm test
npm run build
```

If you touch performance-sensitive code, run the benchmark harness as well:

```bash
npm run bench:quick
```

If you change user-facing behavior, it is often helpful to run or update the relevant example:

```bash
npm run example:client-http
npm run example:websocket
```

## Contribution Guidelines

Please keep these project rules in mind:

- Use English for code comments, docs, issues, and pull requests.
- Keep the public API small and predictable.
- Prefer runtime-light designs and platform APIs before adding dependencies.
- Avoid breaking changes unless they are clearly justified and documented.
- Add or update tests when changing parsing, routing, middleware, static serving, transport behavior, or client semantics.
- Update documentation and examples when public behavior changes.
- Keep server and client ergonomics consistent where possible.

## Code Style

When contributing code:

- target the current Node baseline in `package.json`
- prefer readable and explicit TypeScript over clever abstractions
- keep modules focused and avoid parallel patterns that solve the same problem in different ways
- preserve existing naming and public import conventions when extending the library
- be especially careful in request parsing, WebSocket framing, compression, static file serving, and concurrency code
- treat performance regressions as real regressions in hot paths

## Pull Request Checklist

Before opening a pull request, please make sure:

- `npm run check` passes locally
- new behavior is covered by tests when practical
- docs are updated when public API or behavior changes
- examples are updated when they demonstrate the affected feature
- breaking changes or migration steps are called out clearly

If your change is performance-sensitive, include benchmark notes when practical.

## Commit Messages

Commit messages should be written in English.

Conventional Commits are welcome, but not required. Clear, imperative commit messages are preferred.

Good examples:

- `feat: add prepared HTTP client requests`
- `fix: reject invalid websocket compression settings`
- `docs: clarify host-aware routing behavior`

## Review Expectations

Reviews focus on:

- correctness
- API clarity
- backward compatibility
- documentation quality
- tests
- maintainability
- performance in hot paths

Feedback is meant to improve the project, not to discourage contributors. Questions, follow-up iterations, and design discussion are all welcome.

## Need Help?

If you are unsure whether an idea fits `keno`, open an issue and describe:

- the use case
- the proposed API or behavior
- alternatives you considered
- compatibility or performance concerns

That usually leads to the fastest path forward.
