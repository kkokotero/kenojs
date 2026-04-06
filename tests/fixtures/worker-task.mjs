import { threadId } from "node:worker_threads";

export async function run(payload) {
  const value = Number(payload?.value ?? 0);

  return {
    threadId,
    value: value * 2,
  };
}
