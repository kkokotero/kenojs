import type { HttpMethod, RequestHandler, RouteParams } from "../shared/types";

import { EMPTY_ROUTE_PARAMS } from "../shared/constants";
import { decodeComponent } from "../shared/utils";
import { normalizePath } from "./path";

type RouteMethod = HttpMethod | "ALL";

interface TreeRouteEntry {
  handlers: RequestHandler[];
  path: string;
}

interface TreeNode {
  children: Map<string, TreeNode>;
  methods: Map<RouteMethod, TreeRouteEntry>;
  parameterChild: {
    key: string;
    node: TreeNode;
  } | undefined;
  wildcardChild: {
    key: string;
    node: TreeNode;
  } | undefined;
}

export interface ResolvedRouteTreeMatch {
  handlers: RequestHandler[];
  params: RouteParams;
  path: string;
}

export class RouteTree {
  private readonly exactRoutes = new Map<RouteMethod, Map<string, TreeRouteEntry>>();
  private readonly root = createTreeNode();

  add(method: RouteMethod, path: string, handlers: RequestHandler[]): void {
    const normalizedPath = normalizePath(path);
    const isExactRoute = !normalizedPath.includes(":") && !normalizedPath.includes("*");

    if (isExactRoute) {
      const exactBucket = getOrCreateMethodBucket(this.exactRoutes, method);
      const existing = exactBucket.get(normalizedPath);

      if (existing) {
        existing.handlers.push(...handlers);
      } else {
        exactBucket.set(normalizedPath, {
          handlers: [...handlers],
          path,
        });
      }
    }

    const segments = getSegments(normalizedPath);
    let node = this.root;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];

      if (!segment) {
        continue;
      }

      if (segment.startsWith(":")) {
        const key = segment.slice(1);

        if (!node.parameterChild) {
          node.parameterChild = {
            key,
            node: createTreeNode(),
          };
        }

        node = node.parameterChild.node;
        continue;
      }

      if (segment === "*" || segment.startsWith("*")) {
        const key = segment.slice(1) || "wildcard";

        if (!node.wildcardChild) {
          node.wildcardChild = {
            key,
            node: createTreeNode(),
          };
        }

        node = node.wildcardChild.node;
        break;
      }

      let child = node.children.get(segment);

      if (!child) {
        child = createTreeNode();
        node.children.set(segment, child);
      }

      node = child;
    }

    const existing = node.methods.get(method);

    if (existing) {
      existing.handlers.push(...handlers);
      return;
    }

    node.methods.set(method, {
      handlers: [...handlers],
      path,
    });
  }

  clear(): void {
    this.exactRoutes.clear();
    this.root.children.clear();
    this.root.methods.clear();
    this.root.parameterChild = undefined;
    this.root.wildcardChild = undefined;
  }

  resolve(method: string, pathname: string): ResolvedRouteTreeMatch | undefined {
    const normalizedPath = normalizeIncomingPath(pathname);
    const exact = resolveExactRoute(
      this.exactRoutes.get(method as HttpMethod),
      this.exactRoutes.get("GET"),
      this.exactRoutes.get("ALL"),
      method,
      normalizedPath,
    );

    if (exact) {
      return {
        handlers: exact.handlers,
        params: EMPTY_ROUTE_PARAMS,
        path: exact.path,
      };
    }

    const segments = getSegments(normalizedPath);
    return this.resolveNode(this.root, segments, 0, method, EMPTY_ROUTE_PARAMS);
  }

  private resolveNode(
    node: TreeNode,
    segments: readonly string[],
    index: number,
    method: string,
    params: RouteParams,
  ): ResolvedRouteTreeMatch | undefined {
    if (index === segments.length) {
      const route = resolveNodeRoute(node.methods, method);

      if (!route) {
        return undefined;
      }

      return {
        handlers: route.handlers,
        params,
        path: route.path,
      };
    }

    const segment = segments[index];

    if (segment === undefined) {
      return undefined;
    }

    const staticChild = node.children.get(segment);

    if (staticChild) {
      const resolved = this.resolveNode(staticChild, segments, index + 1, method, params);

      if (resolved) {
        return resolved;
      }
    }

    if (node.parameterChild) {
      const resolved = this.resolveNode(
        node.parameterChild.node,
        segments,
        index + 1,
        method,
        {
          ...params,
          [node.parameterChild.key]: decodeComponent(segment),
        },
      );

      if (resolved) {
        return resolved;
      }
    }

    if (node.wildcardChild) {
      const route = resolveNodeRoute(node.wildcardChild.node.methods, method);

      if (!route) {
        return undefined;
      }

      return {
        handlers: route.handlers,
        params: {
          ...params,
          [node.wildcardChild.key]: decodeComponent(segments.slice(index).join("/")),
        },
        path: route.path,
      };
    }

    return undefined;
  }
}

function createTreeNode(): TreeNode {
  return {
    children: new Map<string, TreeNode>(),
    methods: new Map<RouteMethod, TreeRouteEntry>(),
    parameterChild: undefined,
    wildcardChild: undefined,
  };
}

function getSegments(pathname: string): string[] {
  if (pathname === "/" || pathname === "") {
    return [];
  }

  return pathname.slice(1).split("/");
}

function resolveExactRoute(
  directMethods: ReadonlyMap<string, TreeRouteEntry> | undefined,
  getMethods: ReadonlyMap<string, TreeRouteEntry> | undefined,
  allMethods: ReadonlyMap<string, TreeRouteEntry> | undefined,
  method: string,
  pathname: string,
): TreeRouteEntry | undefined {
  const direct = directMethods?.get(pathname) ?? allMethods?.get(pathname);

  if (direct) {
    return direct;
  }

  if (method === "HEAD") {
    return getMethods?.get(pathname) ?? allMethods?.get(pathname);
  }

  return undefined;
}

function resolveNodeRoute(
  methods: ReadonlyMap<RouteMethod, TreeRouteEntry>,
  method: string,
): TreeRouteEntry | undefined {
  const direct = methods.get(method as HttpMethod) ?? methods.get("ALL");

  if (direct) {
    return direct;
  }

  if (method === "HEAD") {
    return methods.get("GET") ?? methods.get("ALL");
  }

  return undefined;
}

function getOrCreateMethodBucket(
  methods: Map<RouteMethod, Map<string, TreeRouteEntry>>,
  method: RouteMethod,
): Map<string, TreeRouteEntry> {
  let bucket = methods.get(method);

  if (!bucket) {
    bucket = new Map<string, TreeRouteEntry>();
    methods.set(method, bucket);
  }

  return bucket;
}

function normalizeIncomingPath(pathname: string): string {
  if (pathname === "" || pathname === "/") {
    return "/";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
