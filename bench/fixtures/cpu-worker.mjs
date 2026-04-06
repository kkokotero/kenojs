function fibonacci(value) {
  if (value <= 1) {
    return value;
  }

  return fibonacci(value - 1) + fibonacci(value - 2);
}

export async function run(payload) {
  return {
    value: fibonacci(Number(payload?.value ?? 0)),
  };
}
