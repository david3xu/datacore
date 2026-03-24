#!/usr/bin/env node

// server.ts — How does the server start?

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

const server = new McpServer({
  name: 'datacore',
  version: '0.2.0',
});

registerTools(server);

await server.connect(new StdioServerTransport());

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
