const FORBIDDEN_PROTO_KEY = "__proto__";
const FORBIDDEN_CONSTRUCTOR_KEY = "constructor";
const FORBIDDEN_PROTOTYPE_KEY = "prototype";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function containsForbiddenPrototypeKeys(value: unknown): boolean {
  if (!isObjectRecord(value)) {
    return false;
  }

  const queue: unknown[] = [value];

  while (queue.length > 0) {
    const current = queue.pop();

    if (!isObjectRecord(current)) {
      continue;
    }

    if (Array.isArray(current)) {
      for (const entry of current) {
        queue.push(entry);
      }

      continue;
    }

    if (hasOwn(current, FORBIDDEN_PROTO_KEY)) {
      return true;
    }

    const constructorValue = current[FORBIDDEN_CONSTRUCTOR_KEY];

    if (
      hasOwn(current, FORBIDDEN_CONSTRUCTOR_KEY) &&
      isObjectRecord(constructorValue) &&
      hasOwn(constructorValue, FORBIDDEN_PROTOTYPE_KEY)
    ) {
      return true;
    }

    for (const entry of Object.values(current)) {
      queue.push(entry);
    }
  }

  return false;
}

export function safeJsonParse<T>(text: string): T {
  const value = JSON.parse(text) as T;

  if (containsForbiddenPrototypeKeys(value)) {
    throw new SyntaxError("JSON payload contains forbidden prototype keys");
  }

  return value;
}
