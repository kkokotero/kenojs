import type {
  ErrorHandler,
  HostPattern,
  HttpMethod,
  MaybePromise,
  NextFunction,
  RequestHandler,
  RouteParams,
  UseEntry,
  WebSocketHandler,
  WebSocketRouteOptions,
} from "../shared/types";
import type { KenoRequest } from "./request";
import type { KenoResponse } from "./response";

import { EMPTY_ROUTE_PARAMS } from "../shared/constants";
import { isPromiseLike } from "../shared/utils";
import { compileHostMatcher } from "./host";
import { compilePath, consumePath, joinPaths, matchPath, normalizePath } from "./path";
import { RouteTree } from "./route-tree";
import { getStaticService, matchesStaticMount, type StaticService } from "./static-service";

const NO_ERROR = Symbol("keno.no-error");

type DispatchError = typeof NO_ERROR | unknown;

interface DispatchState {
  baseUrl: string;
  method: string;
  params: RouteParams;
  pathname: string;
  request: KenoRequest;
  response: KenoResponse;
}

interface MiddlewareLayer {
  handler: ErrorHandler | RequestHandler;
  isErrorHandler: boolean;
  matcher: ReturnType<typeof compilePath>;
  path: string;
  type: "middleware";
}

interface RouteLayer {
  handler: RequestHandler;
  matcher: ReturnType<typeof compilePath>;
  method: HttpMethod | "ALL";
  path: string;
  type: "route";
}

interface RouterLayer {
  matcher: ReturnType<typeof compilePath>;
  path: string;
  router: KenoRouter;
  type: "router";
}

interface ScopeLayer {
  matcher: ReturnType<typeof compileHostMatcher>;
  router: KenoRouter;
  type: "scope";
}

interface StaticLayer {
  mountPath: string;
  path: string;
  service: StaticService;
  type: "static";
}

interface WebSocketLayer {
  handler: WebSocketHandler;
  matcher: ReturnType<typeof compilePath>;
  options: WebSocketRouteOptions;
  path: string;
  type: "ws";
}

type Layer = MiddlewareLayer | RouteLayer | RouterLayer | ScopeLayer | StaticLayer | WebSocketLayer;

export interface ResolvedWebSocketRoute {
  baseUrl: string;
  handler: WebSocketHandler;
  options: WebSocketRouteOptions;
  params: RouteParams;
  routePath: string;
}

function isRouter(entry: UseEntry): entry is KenoRouter {
  return entry instanceof KenoRouter;
}

function isMethodMatch(routeMethod: HttpMethod | "ALL", incomingMethod: string): boolean {
  if (routeMethod === "ALL" || routeMethod === incomingMethod) {
    return true;
  }

  return incomingMethod === "HEAD" && routeMethod === "GET";
}

export class KenoRouter {
  protected readonly layers: Layer[] = [];
  private readonly routeTree = new RouteTree();
  private routeTreeEnabled = true;

  use(...entries: [path: string, ...handlers: UseEntry[]] | UseEntry[]): this {
    this.disableRouteTree();
    const [path, handlers] = this.resolveUseArguments(entries);

    for (const handler of handlers) {
      if (isRouter(handler)) {
        this.layers.push({
          matcher: compilePath(path, false),
          path,
          router: handler,
          type: "router",
        });
        continue;
      }

      const staticService = getStaticService(handler as RequestHandler);

      if (staticService) {
        this.layers.push({
          mountPath: normalizePath(path),
          path,
          service: staticService,
          type: "static",
        });
        continue;
      }

      this.layers.push({
        handler,
        isErrorHandler: handler.length === 4,
        matcher: compilePath(path, false),
        path,
        type: "middleware",
      });
    }

    return this;
  }

  all<Path extends string>(path: Path, ...handlers: RequestHandler<Path>[]): this {
    return this.addRoute("ALL", path, handlers);
  }

  get<Path extends string>(path: Path, ...handlers: RequestHandler<Path>[]): this {
    return this.addRoute("GET", path, handlers);
  }

  post<Path extends string>(path: Path, ...handlers: RequestHandler<Path>[]): this {
    return this.addRoute("POST", path, handlers);
  }

  put<Path extends string>(path: Path, ...handlers: RequestHandler<Path>[]): this {
    return this.addRoute("PUT", path, handlers);
  }

  patch<Path extends string>(path: Path, ...handlers: RequestHandler<Path>[]): this {
    return this.addRoute("PATCH", path, handlers);
  }

  delete<Path extends string>(path: Path, ...handlers: RequestHandler<Path>[]): this {
    return this.addRoute("DELETE", path, handlers);
  }

  head<Path extends string>(path: Path, ...handlers: RequestHandler<Path>[]): this {
    return this.addRoute("HEAD", path, handlers);
  }

  options<Path extends string>(path: Path, ...handlers: RequestHandler<Path>[]): this {
    return this.addRoute("OPTIONS", path, handlers);
  }

  ws<Path extends string>(
    path: Path,
    handlerOrOptions: WebSocketHandler<Path> | WebSocketRouteOptions<Path>,
    maybeHandler?: WebSocketHandler<Path>,
  ): this {
    this.disableRouteTree();
    const handler =
      typeof handlerOrOptions === "function"
        ? handlerOrOptions
        : maybeHandler;

    if (!handler) {
      throw new TypeError("A WebSocket handler is required");
    }

    const options =
      typeof handlerOrOptions === "function"
        ? {}
        : handlerOrOptions;

    this.layers.push({
      handler,
      matcher: compilePath(path, true),
      options,
      path,
      type: "ws",
    });

    return this;
  }

  host(pattern: HostPattern, ...entries: UseEntry[]): this {
    this.disableRouteTree();
    return this.addScopeLayer(pattern, entries);
  }

  domain(pattern: HostPattern, ...entries: UseEntry[]): this {
    return this.host(pattern, ...entries);
  }

  hasWebSocketRoutes(): boolean {
    return this.layers.some((layer) => {
      if (layer.type === "ws") {
        return true;
      }

      if (layer.type === "router") {
        return layer.router.hasWebSocketRoutes();
      }

      if (layer.type === "scope") {
        return layer.router.hasWebSocketRoutes();
      }

      return false;
    });
  }

  resolveWebSocketRoute(
    pathname: string,
    baseUrl = "",
    params: RouteParams = EMPTY_ROUTE_PARAMS,
    hostname = "",
  ): ResolvedWebSocketRoute | undefined {
    for (const layer of this.layers) {
      if (layer.type === "router") {
        const match = matchPath(layer.matcher, pathname);

        if (!match) {
          continue;
        }

        const resolved = layer.router.resolveWebSocketRoute(
          consumePath(pathname, match.matchedPath),
          joinPaths(baseUrl, match.matchedPath),
          { ...params, ...match.params },
          hostname,
        );

        if (resolved) {
          return resolved;
        }

        continue;
      }

      if (layer.type === "scope") {
        if (!layer.matcher.test(hostname)) {
          continue;
        }

        const resolved = layer.router.resolveWebSocketRoute(
          pathname,
          baseUrl,
          params,
          hostname,
        );

        if (resolved) {
          return resolved;
        }

        continue;
      }

      if (layer.type !== "ws") {
        continue;
      }

      const match = matchPath(layer.matcher, pathname);

      if (!match) {
        continue;
      }

      return {
        baseUrl,
        handler: layer.handler,
        options: layer.options,
        params: { ...params, ...match.params },
        routePath: layer.path,
      };
    }

    return undefined;
  }

  async dispatch(
    state: DispatchState,
    done: (error: DispatchError) => Promise<void>,
    error: DispatchError = NO_ERROR,
  ): Promise<void> {
    if (error === NO_ERROR) {
      const directRoute = this.resolveTreeRoute(state.method, state.pathname);

      if (directRoute) {
        await this.dispatchDirectRoute(state, directRoute, done);
        return;
      }
    }

    await this.dispatchLayer(0, state, done, error);
  }

  protected get noErrorToken(): symbol {
    return NO_ERROR;
  }

  private addRoute<Path extends string>(
    method: HttpMethod | "ALL",
    path: Path,
    handlers: RequestHandler<Path>[],
  ): this {
    const matcher = compilePath(path, true);

    for (const handler of handlers) {
      this.layers.push({
        handler,
        matcher,
        method,
        path,
        type: "route",
      });
    }

    if (this.routeTreeEnabled) {
      this.routeTree.add(method, path, handlers);
    }

    return this;
  }

  private addScopeLayer(pattern: HostPattern, entries: UseEntry[]): this {
    const router = new KenoRouter();
    router.use(...entries);

    this.layers.push({
      matcher: compileHostMatcher(pattern),
      router,
      type: "scope",
    });

    return this;
  }

  private disableRouteTree(): void {
    if (!this.routeTreeEnabled) {
      return;
    }

    this.routeTreeEnabled = false;
    this.routeTree.clear();
  }

  protected resolveTreeRoute(method: string, pathname: string) {
    if (!this.routeTreeEnabled) {
      return undefined;
    }

    return this.routeTree.resolve(method, pathname);
  }

  protected tryDispatchDirectRoute(
    state: DispatchState,
    done: (error: DispatchError) => MaybePromise<void>,
  ): Promise<boolean> | boolean {
    const route = this.resolveTreeRoute(state.method, state.pathname);

    if (!route) {
      return false;
    }

    const dispatched = this.dispatchDirectRoute(state, route, done);

    if (isPromiseLike(dispatched)) {
      return dispatched.then(() => true);
    }

    return true;
  }

  protected dispatchDirectRoute(
    state: DispatchState,
    route: NonNullable<ReturnType<KenoRouter["resolveTreeRoute"]>>,
    done: (error: DispatchError) => MaybePromise<void>,
  ): Promise<void> | void {
    const params =
      state.params === EMPTY_ROUTE_PARAMS
        ? route.params
        : route.params === EMPTY_ROUTE_PARAMS
          ? state.params
          : { ...state.params, ...route.params };

    state.request.setScope({
      baseUrl: state.baseUrl,
      params,
      routePath: route.path,
    });

    for (let index = 0; index < route.handlers.length; index += 1) {
      const handler = route.handlers[index];

      if (!handler) {
        continue;
      }

      let nextCalled = false;
      let nextError: DispatchError = NO_ERROR;
      const next: NextFunction = (error) => {
        nextCalled = true;
        nextError = error ?? NO_ERROR;
      };

      try {
        const result = handler(
          state.request as never,
          state.response,
          next,
        );

        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(
            () => {
              if (!nextCalled) {
                return;
              }

              if (nextError !== NO_ERROR) {
                return done(nextError);
              }

              return this.dispatchDirectRoute(
                state,
                {
                  ...route,
                  handlers: route.handlers.slice(index + 1),
                },
                done,
              );
            },
            (error) => done(error),
          ) as Promise<void>;
        }
      } catch (error) {
        return done(error);
      }

      if (!nextCalled) {
        return;
      }

      if (nextError !== NO_ERROR) {
        return done(nextError);
      }
    }

    return done(NO_ERROR);
  }

  private async dispatchLayer(
    index: number,
    state: DispatchState,
    done: (error: DispatchError) => Promise<void>,
    error: DispatchError,
  ): Promise<void> {
    if (index >= this.layers.length) {
      await done(error);
      return;
    }

    const layer = this.layers[index];

    if (!layer) {
      await done(error);
      return;
    }

    if (layer.type === "ws") {
      await this.dispatchLayer(index + 1, state, done, error);
      return;
    }

    if (layer.type === "scope") {
      if (!layer.matcher.test(state.request.hostname)) {
        await this.dispatchLayer(index + 1, state, done, error);
        return;
      }

      await layer.router.dispatch(
        state,
        async (nextError: DispatchError) => {
          await this.dispatchLayer(index + 1, state, done, nextError);
        },
        error,
      );
      return;
    }

    if (layer.type === "static") {
      if (error !== NO_ERROR || !matchesStaticMount(state.pathname, layer.mountPath)) {
        await this.dispatchLayer(index + 1, state, done, error);
        return;
      }

      const snapshot = state.request.snapshot();
      let nextCalled = false;

      state.request.setScope({
        baseUrl: state.baseUrl,
        params: state.params,
        routePath: layer.path,
      });

      const next: NextFunction = async (nextError) => {
        nextCalled = true;
        state.request.restore(snapshot);
        await this.dispatchLayer(index + 1, state, done, nextError ?? NO_ERROR);
      };

      try {
        await layer.service.handle(state.request, state.response, next, {
          mountPath: layer.mountPath,
          pathname: state.pathname,
        });
      } catch (caught) {
        state.request.restore(snapshot);
        await this.dispatchLayer(index + 1, state, done, caught);
        return;
      }

      if (!nextCalled) {
        state.request.restore(snapshot);
      }

      return;
    }

    if (layer.type === "router") {
      const match = matchPath(layer.matcher, state.pathname);

      if (!match) {
        await this.dispatchLayer(index + 1, state, done, error);
        return;
      }

      const nextState: DispatchState = {
        ...state,
        baseUrl: joinPaths(state.baseUrl, match.matchedPath),
        params: { ...state.params, ...match.params },
        pathname: consumePath(state.pathname, match.matchedPath),
      };

      await layer.router.dispatch(
        nextState,
        async (nextError: DispatchError) => {
          await this.dispatchLayer(index + 1, state, done, nextError);
        },
        error,
      );
      return;
    }

    const match = matchPath(layer.matcher, state.pathname);

    if (!match) {
      await this.dispatchLayer(index + 1, state, done, error);
      return;
    }

    const mergedParams = { ...state.params, ...match.params };

    if (layer.type === "route") {
      if (error !== NO_ERROR || !isMethodMatch(layer.method, state.method)) {
        await this.dispatchLayer(index + 1, state, done, error);
        return;
      }

      await this.invokeHandler(
        layer.handler,
        state,
        mergedParams,
        layer.path,
        async (nextError) => {
          await this.dispatchLayer(
            index + 1,
            {
              ...state,
              params: mergedParams,
            },
            done,
            nextError,
          );
        },
      );
      return;
    }

    if (layer.isErrorHandler !== (error !== NO_ERROR)) {
      await this.dispatchLayer(index + 1, state, done, error);
      return;
    }

    await this.invokeHandler(
      layer.handler,
      state,
      mergedParams,
      layer.path,
      async (nextError) => {
        await this.dispatchLayer(
          index + 1,
          {
            ...state,
            params: mergedParams,
          },
          done,
          nextError,
        );
      },
      error,
    );
  }

  private async invokeHandler(
    handler: ErrorHandler | RequestHandler,
    state: DispatchState,
    params: RouteParams,
    routePath: string,
    next: NextFunction,
    error: DispatchError = NO_ERROR,
  ): Promise<void> {
    const snapshot = state.request.snapshot();
    let nextCalled = false;

    state.request.setScope({
      baseUrl: state.baseUrl,
      params,
      routePath,
    });

    const wrappedNext: NextFunction = async (nextError) => {
      nextCalled = true;
      state.request.restore(snapshot);
      await next(nextError ?? NO_ERROR);
    };

    try {
      if (error === NO_ERROR) {
        await (handler as RequestHandler)(state.request as never, state.response, wrappedNext);
      } else {
        await (handler as ErrorHandler)(error, state.request, state.response, wrappedNext);
      }
    } catch (caught) {
      state.request.restore(snapshot);
      await next(caught);
      return;
    }

    if (!nextCalled) {
      state.request.restore(snapshot);
    }
  }

  private resolveUseArguments(entries: [path: string, ...handlers: UseEntry[]] | UseEntry[]): [string, UseEntry[]] {
    if (typeof entries[0] === "string") {
      const [path, ...handlers] = entries as [string, ...UseEntry[]];
      return [path, handlers];
    }

    return ["/", entries as UseEntry[]];
  }
}
