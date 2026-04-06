import type { KenoApplication } from "../http/application";
import type { AppListenOptions, MultiListenCallback, MultiServerEvents } from "../shared/types";

import { TypedEventEmitter } from "../shared/typed-emitter";
import { KenoServer } from "./server";

export class KenoMultiServer extends TypedEventEmitter<MultiServerEvents> {
  readonly servers: readonly KenoServer[];

  private listening = false;

  constructor(
    application: KenoApplication,
    optionsList: readonly AppListenOptions[],
  ) {
    super();
    this.servers = optionsList.map((options) => application.createServer(options));

    for (const server of this.servers) {
      server.on("error", (error) => {
        this.emit("error", error, server);
      });
    }
  }

  listen(callback?: MultiListenCallback): this {
    if (callback) {
      this.once("listening", callback);
    }

    if (this.listening) {
      return this;
    }

    this.listening = true;

    for (const server of this.servers) {
      server.listen();
    }

    void this.ready().then(() => {
      this.emit("listening", this.servers);
    });

    return this;
  }

  async ready(): Promise<this> {
    await Promise.all(this.servers.map((server) => server.ready()));
    return this;
  }

  addresses(): unknown[] {
    return this.servers.map((server) => server.address());
  }

  async close(): Promise<void> {
    await Promise.all(this.servers.map((server) => server.close()));
    this.emit("close");
  }
}
