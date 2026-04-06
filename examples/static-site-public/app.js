async function main() {
  const metricsNode = document.querySelector("#metrics");
  const response = await fetch("/api/metrics");
  const payload = await response.json();
  metricsNode.textContent = JSON.stringify(payload, null, 2);
}

main().catch((error) => {
  const metricsNode = document.querySelector("#metrics");
  metricsNode.textContent = String(error);
});
