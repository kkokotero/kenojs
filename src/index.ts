export { HttpError } from "./internal/shared/errors";
export { KenoApplication, createApp, createMultiServer, createServer } from "./internal/http/application";
export { KenoMultiServer } from "./internal/transport/multi-server";
export { KenoRequest } from "./internal/http/request";
export { KenoResponse } from "./internal/http/response";
export { KenoRouter } from "./internal/http/router";
export { KenoServer } from "./internal/transport/server";
export { clearTemporaryTlsCache, createTemporaryTlsOptions, temporaryTls } from "./internal/certificates/temporary";
export { KenoThreadCluster, createThreadCluster } from "./internal/concurrency/thread-cluster";
export { KenoWorkerPool, createWorkerPool, threaded } from "./internal/concurrency/worker-pool";
export { definePlugin } from "./internal/plugins/define";
export { heartbeatPlugin } from "./internal/plugins/heartbeat";
export { openApiPlugin } from "./internal/plugins/openapi";
export { requestLoggerPlugin } from "./internal/plugins/request-logger";
export { cors } from "./middleware/cors";
export { json } from "./middleware/json";
export { requestId } from "./middleware/request-id";
export { securityHeaders } from "./middleware/security-headers";
export { serveStatic, serveStatic as static } from "./middleware/static";
export { text } from "./middleware/text";
export { KenoWebSocket } from "./internal/websocket/connection";
export { KenoWebSocketHeartbeat, createWebSocketHeartbeat } from "./internal/websocket/heartbeat";
export { KenoWebSocketRooms, createWebSocketRooms } from "./internal/websocket/rooms";
export type * from "./internal/shared/types";

import { KenoApplication } from "./internal/http/application";
import { clearTemporaryTlsCache, createTemporaryTlsOptions, temporaryTls } from "./internal/certificates/temporary";
import { definePlugin } from "./internal/plugins/define";
import { heartbeatPlugin } from "./internal/plugins/heartbeat";
import { openApiPlugin } from "./internal/plugins/openapi";
import { requestLoggerPlugin } from "./internal/plugins/request-logger";
import { KenoRouter } from "./internal/http/router";
import { createThreadCluster } from "./internal/concurrency/thread-cluster";
import { createWorkerPool, threaded } from "./internal/concurrency/worker-pool";
import { cors } from "./middleware/cors";
import { json } from "./middleware/json";
import { requestId } from "./middleware/request-id";
import { securityHeaders } from "./middleware/security-headers";
import { serveStatic } from "./middleware/static";
import { text } from "./middleware/text";
import { createWebSocketHeartbeat, KenoWebSocketHeartbeat } from "./internal/websocket/heartbeat";
import { createWebSocketRooms, KenoWebSocketRooms } from "./internal/websocket/rooms";
import type { AppListenOptions } from "./types";
import type { KenoMultiServer } from "./internal/transport/multi-server";

type KenoFactory = {
  (): KenoApplication;
  clearTemporaryTlsCache: typeof clearTemporaryTlsCache;
  cors: typeof cors;
  createTemporaryTlsOptions: typeof createTemporaryTlsOptions;
  createWebSocketHeartbeat: typeof createWebSocketHeartbeat;
  createWebSocketRooms: typeof createWebSocketRooms;
  definePlugin: typeof definePlugin;
  heartbeatPlugin: typeof heartbeatPlugin;
  KenoWebSocketHeartbeat: typeof KenoWebSocketHeartbeat;
  KenoWebSocketRooms: typeof KenoWebSocketRooms;
  openApiPlugin: typeof openApiPlugin;
  requestId: typeof requestId;
  requestLoggerPlugin: typeof requestLoggerPlugin;
  Router: () => KenoRouter;
  createApp: () => KenoApplication;
  createMultiServer: (
    application: KenoApplication,
    optionsList: readonly AppListenOptions[],
  ) => KenoMultiServer;
  createThreadCluster: typeof createThreadCluster;
  createWorkerPool: typeof createWorkerPool;
  json: typeof json;
  securityHeaders: typeof securityHeaders;
  static: typeof serveStatic;
  temporaryTls: typeof temporaryTls;
  threaded: typeof threaded;
  text: typeof text;
};

const keno = Object.assign(
  () => new KenoApplication(),
  {
    clearTemporaryTlsCache,
    cors,
    createTemporaryTlsOptions,
    createWebSocketHeartbeat,
    createWebSocketRooms,
    definePlugin,
    heartbeatPlugin,
    KenoWebSocketHeartbeat,
    KenoWebSocketRooms,
    openApiPlugin,
    requestId,
    requestLoggerPlugin,
    Router: () => new KenoRouter(),
    createApp: () => new KenoApplication(),
    createMultiServer: (
      application: KenoApplication,
      optionsList: readonly AppListenOptions[],
    ) => application.createMultiServer(optionsList),
    createThreadCluster,
    createWorkerPool,
    json,
    securityHeaders,
    static: serveStatic,
    temporaryTls,
    threaded,
    text,
  },
) as KenoFactory;

export default keno;
