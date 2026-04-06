export async function run(payload) {
  const delay = Number(payload?.delay ?? 0);

  await new Promise((resolve) => {
    setTimeout(resolve, delay);
  });

  return {
    ok: true,
  };
}
