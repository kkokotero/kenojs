# Examples

Each example is independent and can be run directly from the repo root with the included scripts.
If one of the default ports is already in use, override it per run with `PORT=...`.

## Core HTTP

- `npm run example:basic`
- `npm run example:client-http`
- `npm run example:crud`
- `npm run example:hosts`
- `npm run example:modular-imports`
- `npm run example:multi-server`
- `npm run example:content-negotiation`
- `npm run example:webhook-text`

## Files and Static Delivery

- `npm run example:static-site`
- `npm run example:download-center`

## WebSocket and Realtime

- `npm run example:client-websocket`
- `npm run example:websocket`
- `npm run example:realtime-chat`
- `npm run example:http2`

## Concurrency

- `npm run example:thread-cluster`
- `npm run example:threaded-endpoints`

Stateful examples such as `crud.ts`, `websocket.ts`, and `realtime-chat.ts` run with `threaded: false`
on purpose so their in-memory state stays coherent. The dedicated concurrency demos showcase clustering
and worker pools explicitly.

Highlights:

- `basic.ts` now shows plugin registration with heartbeat and OpenAPI plus request-id/security middlewares.
- `websocket.ts` and `realtime-chat.ts` now use the built-in socket room manager and heartbeat utility.
