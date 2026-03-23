import process from "node:process";
import { getDatacoreHooksDir, getDatacoreServerLauncherPath } from "../src/paths.mjs";
import { readConfigFileSnapshot, writeConfigFile } from "../../../openclaw/src/config/io.ts";
import { validateConfigObjectWithPlugins } from "../../../openclaw/src/config/validation.ts";

const VALID_MODES = new Set(["server", "autolog", "all"]);

function parseMode(argv) {
  const raw = argv[2]?.trim().toLowerCase() || "all";
  if (!VALID_MODES.has(raw)) {
    throw new Error(`Unknown setup mode "${raw}". Use one of: server, autolog, all.`);
  }
  return raw;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function withDatacoreServer(nextConfig) {
  const bronzeDir =
    typeof process.env.DATACORE_BRONZE_DIR === "string" && process.env.DATACORE_BRONZE_DIR.trim()
      ? process.env.DATACORE_BRONZE_DIR.trim()
      : undefined;
  const currentServers =
    nextConfig.mcp && typeof nextConfig.mcp === "object" && nextConfig.mcp.servers
      ? nextConfig.mcp.servers
      : {};

  nextConfig.mcp = {
    ...nextConfig.mcp,
    servers: {
      ...currentServers,
      datacore: {
        command: "node",
        args: [getDatacoreServerLauncherPath()],
        ...(bronzeDir ? { env: { DATACORE_BRONZE_DIR: bronzeDir } } : {}),
      },
    },
  };
}

function withAutologHook(nextConfig) {
  const hooksDir = getDatacoreHooksDir();
  const internalHooks = nextConfig.hooks?.internal ?? {};
  const currentLoad = internalHooks.load ?? {};
  const currentEntries =
    internalHooks.entries && typeof internalHooks.entries === "object" ? internalHooks.entries : {};
  const extraDirs = uniqueStrings([...(currentLoad.extraDirs ?? []), hooksDir]);

  nextConfig.hooks = {
    ...nextConfig.hooks,
    internal: {
      ...internalHooks,
      enabled: true,
      load: {
        ...currentLoad,
        extraDirs,
      },
      entries: {
        ...currentEntries,
        "datacore-mcp-log": {
          ...(currentEntries["datacore-mcp-log"] ?? {}),
          enabled: true,
        },
      },
    },
  };
}

const mode = parseMode(process.argv);
const snapshot = await readConfigFileSnapshot();

if (!snapshot.valid) {
  throw new Error(`OpenClaw config is invalid at ${snapshot.path}. Fix it before setup.`);
}

const nextConfig = structuredClone(snapshot.resolved ?? {});

if (mode === "server" || mode === "all") {
  withDatacoreServer(nextConfig);
}

if (mode === "autolog" || mode === "all") {
  withAutologHook(nextConfig);
}

const validated = validateConfigObjectWithPlugins(nextConfig);
if (!validated.ok) {
  const issue = validated.issues[0];
  throw new Error(`Config invalid after datacore setup (${issue.path}: ${issue.message}).`);
}

await writeConfigFile(validated.config, { expectedConfigPath: snapshot.path });

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      mode,
      configPath: snapshot.path,
      datacoreServerPath: getDatacoreServerLauncherPath(),
      hooksDir: getDatacoreHooksDir(),
      hookName: "datacore-mcp-log",
    },
    null,
    2,
  )}\n`,
);
