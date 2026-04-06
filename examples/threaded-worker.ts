function fibonacci(value: number): number {
  if (value <= 1) {
    return value;
  }

  return fibonacci(value - 1) + fibonacci(value - 2);
}

export function run(payload: { value: number }): { durationMs: number; value: number; result: number } {
  const startedAt = performance.now();
  const result = fibonacci(payload.value);

  return {
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    result,
    value: payload.value,
  };
}
