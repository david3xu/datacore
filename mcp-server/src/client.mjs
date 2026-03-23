import process from 'node:process';
import { Client, StdioClientTransport } from './runtime-deps.mjs';
import { getDatacoreRepoRoot, getDatacoreServerEntryPath } from './paths.mjs';

function buildLaunchEnv(envOverrides) {
  const entries = Object.entries(envOverrides ?? {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return undefined;
  }
  return {
    ...process.env,
    ...Object.fromEntries(entries.map(([key, value]) => [key, String(value)])),
  };
}

function resolveLaunchConfig(options = {}) {
  const bronzeDir =
    typeof options.bronzeDir === 'string' && options.bronzeDir.trim().length > 0
      ? options.bronzeDir.trim()
      : typeof process.env.DATACORE_BRONZE_DIR === 'string' &&
          process.env.DATACORE_BRONZE_DIR.trim().length > 0
        ? process.env.DATACORE_BRONZE_DIR.trim()
        : undefined;

  return {
    command: options.command ?? process.execPath,
    args: options.args ?? [options.serverPath ?? getDatacoreServerEntryPath()],
    cwd: options.cwd ?? getDatacoreRepoRoot(),
    env: buildLaunchEnv({
      ...(options.env ?? {}),
      ...(bronzeDir ? { DATACORE_BRONZE_DIR: bronzeDir } : {}),
    }),
  };
}

async function createDatacoreSession(options = {}) {
  const launch = resolveLaunchConfig(options);
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: launch.env,
    stderr: 'pipe',
  });
  const client = new Client(
    {
      name: 'datacore-local-client',
      version: '0.1.0',
    },
    {},
  );
  await client.connect(transport);
  return { client, transport, launch };
}

async function disposeDatacoreSession(session) {
  await session.client.close().catch(() => {});
  await session.transport.close().catch(() => {});
}

let sharedSessionPromise = null;

async function getSharedSession(options = {}) {
  if (!sharedSessionPromise) {
    sharedSessionPromise = createDatacoreSession(options).catch((error) => {
      sharedSessionPromise = null;
      throw error;
    });
  }
  return await sharedSessionPromise;
}

function normalizeToolArguments(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function callDatacoreTool(params, options = {}) {
  const toolArguments = normalizeToolArguments(params.arguments);
  const shared = options.shared === true;
  const session = shared ? await getSharedSession(options) : await createDatacoreSession(options);

  try {
    return await session.client.callTool({
      name: params.name,
      arguments: toolArguments,
    });
  } catch (error) {
    if (shared) {
      sharedSessionPromise = null;
      await disposeDatacoreSession(session).catch(() => {});
    }
    throw error;
  } finally {
    if (!shared) {
      await disposeDatacoreSession(session);
    }
  }
}

export async function logEventViaMcp(event, options = {}) {
  return await callDatacoreTool(
    {
      name: 'log_event',
      arguments: event,
    },
    options,
  );
}

export async function searchViaMcp(query, options = {}) {
  return await callDatacoreTool(
    {
      name: 'search',
      arguments: query,
    },
    options,
  );
}

export async function closeSharedDatacoreSession() {
  if (!sharedSessionPromise) {
    return;
  }
  const session = await sharedSessionPromise.catch(() => null);
  sharedSessionPromise = null;
  if (session) {
    await disposeDatacoreSession(session);
  }
}
