import keno from "keno";

const app = keno() as unknown as { sourceEntryUrl?: string };

console.log(app.sourceEntryUrl ?? "undefined");
