import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type RunnerCommand = {
  args: string[];
  command: string;
};

const DEFAULT_HOST = process.env.KENO_AUTOBAHN_HOST ?? "127.0.0.1";
const DEFAULT_PORT = Number.parseInt(process.env.KENO_AUTOBAHN_PORT ?? "9001", 10);
const DEFAULT_IMAGE = process.env.KENO_AUTOBAHN_IMAGE ?? "crossbario/autobahn-testsuite:25.10.1";

await main();

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const runDirectory = join(import.meta.dirname, "results", generatedAt.replaceAll(":", "-").replaceAll(".", "-"));
  const configDirectory = join(runDirectory, "config");
  const reportDirectory = join(runDirectory, "reports");
  const configPath = join(configDirectory, "fuzzingclient.json");

  await mkdir(configDirectory, { recursive: true });
  await mkdir(reportDirectory, { recursive: true });

  await writeFile(
    configPath,
    JSON.stringify(
      {
        cases: ["*"],
        "exclude-agent-cases": {},
        "exclude-cases": [],
        outdir: "./reports/servers",
        servers: [
          {
            agent: "keno",
            url: `ws://${DEFAULT_HOST}:${DEFAULT_PORT}`,
          },
        ],
      },
      null,
      2,
    ),
  );

  const runner = await resolveRunner(configDirectory, reportDirectory);
  const server = spawn(process.execPath, [join(import.meta.dirname, "..", "fixtures", "autobahn-server.mjs")], {
    env: {
      ...process.env,
      KENO_AUTOBAHN_HOST: DEFAULT_HOST,
      KENO_AUTOBAHN_PORT: String(DEFAULT_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServerReady(server);
    await runProcess(runner.command, runner.args, {
      cwd: join(import.meta.dirname, "..", ".."),
      env: process.env,
      stdio: "inherit",
    });

    console.log(`\nAutobahn reports: ${reportDirectory}`);
  } finally {
    server.kill("SIGTERM");
    await onceExit(server);
  }
}

async function resolveRunner(configDirectory: string, reportDirectory: string): Promise<RunnerCommand> {
  if (await commandExists("docker", ["--version"])) {
    return {
      args: [
        "run",
        "--rm",
        "--network",
        "host",
        "-v",
        `${configDirectory}:/config`,
        "-v",
        `${reportDirectory}:/reports`,
        DEFAULT_IMAGE,
        "wstest",
        "-m",
        "fuzzingclient",
        "-s",
        "/config/fuzzingclient.json",
      ],
      command: "docker",
    };
  }

  if (await commandExists("wstest", ["--help"])) {
    return {
      args: ["-m", "fuzzingclient", "-s", join(configDirectory, "fuzzingclient.json")],
      command: "wstest",
    };
  }

  throw new Error(
    "Autobahn runner not found. Install Docker or make `wstest` available on PATH before running `npm run autobahn`.",
  );
}

async function commandExists(command: string, args: string[]): Promise<boolean> {
  try {
    await runProcess(command, args, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForServerReady(server: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleStdout = (chunk: Buffer | string) => {
      if (chunk.toString("utf8").includes("AUTOBAHN_READY")) {
        cleanup();
        resolve();
      }
    };
    const handleStderr = (chunk: Buffer | string) => {
      process.stderr.write(chunk);
    };
    const handleExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Autobahn server exited before becoming ready (code ${code ?? "unknown"})`));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      server.off("error", handleError);
      server.off("exit", handleExit);
      server.stdout?.off("data", handleStdout);
      server.stderr?.off("data", handleStderr);
    };

    server.stdout?.on("data", handleStdout);
    server.stderr?.on("data", handleStderr);
    server.once("exit", handleExit);
    server.once("error", handleError);
  });
}

async function onceExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
}

async function runProcess(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio: "ignore" | "inherit";
  },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], options);

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed: ${command} ${args.join(" ")} (${code ?? "unknown"})`));
    });
  });
}
