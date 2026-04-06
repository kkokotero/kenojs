import http from "node:http";
import { threadId } from "node:worker_threads";

console.log(`BOOT_LOG:${threadId}`);

export default {
  listen(options = {}) {
    const server = http.createServer((request, response) => {
      if (request.url === "/log") {
        console.log(`RUNTIME_LOG:${threadId}`);
      }

      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ threadId }));
    });

    return {
      address() {
        return server.address();
      },
      close() {
        return new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      },
      listen() {
        server.listen({
          host: options.host,
          port: options.port ?? 0,
          reusePort: options.reusePort,
        });
        return this;
      },
      ready() {
        return new Promise((resolve, reject) => {
          if (server.listening) {
            resolve(this);
            return;
          }

          server.once("listening", () => {
            resolve(this);
          });
          server.once("error", reject);
        });
      },
    }.listen();
  },
};
