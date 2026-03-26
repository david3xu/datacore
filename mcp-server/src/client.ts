// client.ts — How to connect programmatically?
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getDatacoreRepoRoot, getDatacoreServerEntryPath } from './paths.js';

interface LaunchConfig {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string> | undefined;
}

interface ClientOptions {
  command?: string;
  args?: string[];
  serverPath?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  bronzeDir?: string;
  shared?: boolean;
}

interface DatacoreSession {
  client: InstanceType<typeof Client>;
  transport: InstanceType<typeof StdioClientTransport>;
  launch: LaunchConfig;
}

function buildLaunchEnv(
  envOverrides?: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const entries = Object.entries(envOverrides ?? {}).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  if (entries.length === 0) return undefined;
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v;
  }
  return { ...base, ...Object.fromEntries(entries) };
}

function resolveLaunchConfig(options: ClientOptions = {}): LaunchConfig {
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

async function createDatacoreSession(options: ClientOptions = {}): Promise<DatacoreSession> {
  const launch = resolveLaunchConfig(options);
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: launch.env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'datacore-local-client', version: '0.1.0' }, {});
  await client.connect(transport);
  return { client, transport, launch };
}

async function disposeDatacoreSession(session: DatacoreSession): Promise<void> {
  await session.client.close().catch(() => {});
  await session.transport.close().catch(() => {});
}

let sharedSessionPromise: Promise<DatacoreSession> | null = null;

async function getSharedSession(options: ClientOptions = {}): Promise<DatacoreSession> {
  if (!sharedSessionPromise) {
    sharedSessionPromise = createDatacoreSession(options).catch((error) => {
      sharedSessionPromise = null;
      throw error;
    });
  }
  return await sharedSessionPromise;
}

interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function callDatacoreTool(
  params: ToolCallParams,
  options: ClientOptions = {},
): Promise<unknown> {
  const toolArguments = normalizeToolArguments(params.arguments);
  const shared = options.shared === true;
  const session = shared ? await getSharedSession(options) : await createDatacoreSession(options);
  try {
    return await session.client.callTool({ name: params.name, arguments: toolArguments });
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

export async function logEventViaMcp(
  event: Record<string, unknown>,
  options: ClientOptions = {},
): Promise<unknown> {
  return await callDatacoreTool({ name: 'log_event', arguments: event }, options);
}

export async function searchViaMcp(
  query: Record<string, unknown>,
  options: ClientOptions = {},
): Promise<unknown> {
  return await callDatacoreTool({ name: 'search', arguments: query }, options);
}

export async function closeSharedDatacoreSession(): Promise<void> {
  if (!sharedSessionPromise) return;
  const session = await sharedSessionPromise.catch(() => null);
  sharedSessionPromise = null;
  if (session) await disposeDatacoreSession(session);
}
