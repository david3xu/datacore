import { logEventViaMcp } from "../../mcp-server/src/client.mjs";

function readString(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBoolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

function compactRecord(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
  );
}

function buildInboundPayload(event) {
  const content = readString(event.context.bodyForAgent) ?? readString(event.context.body);
  if (!content) {
    return null;
  }
  return {
    source: "openclaw",
    type: "message_preprocessed",
    content,
    context: compactRecord({
      app: "openclaw",
      direction: "inbound",
      hookAction: event.action,
      sessionKey: event.sessionKey,
      observedAt: event.timestamp.toISOString(),
      channelId: readString(event.context.channelId),
      conversationId: readString(event.context.conversationId),
      messageId: readString(event.context.messageId),
      from: readString(event.context.from),
      to: readString(event.context.to),
      transcript: readString(event.context.transcript),
      provider: readString(event.context.provider),
      surface: readString(event.context.surface),
      mediaType: readString(event.context.mediaType),
      isGroup: readBoolean(event.context.isGroup),
      groupId: readString(event.context.groupId),
    }),
  };
}

function buildOutboundPayload(event) {
  const content = readString(event.context.content);
  if (!content) {
    return null;
  }
  return {
    source: "openclaw",
    type: "message_sent",
    content,
    context: compactRecord({
      app: "openclaw",
      direction: "outbound",
      hookAction: event.action,
      sessionKey: event.sessionKey,
      observedAt: event.timestamp.toISOString(),
      channelId: readString(event.context.channelId),
      conversationId: readString(event.context.conversationId),
      messageId: readString(event.context.messageId),
      to: readString(event.context.to),
      success: readBoolean(event.context.success),
      error: readString(event.context.error),
      isGroup: readBoolean(event.context.isGroup),
      groupId: readString(event.context.groupId),
    }),
  };
}

function toPayload(event) {
  if (event.type !== "message") {
    return null;
  }
  if (event.action === "preprocessed") {
    return buildInboundPayload(event);
  }
  if (event.action === "sent") {
    return buildOutboundPayload(event);
  }
  return null;
}

export default async function datacoreMcpLog(event) {
  const payload = toPayload(event);
  if (!payload) {
    return;
  }

  try {
    await logEventViaMcp(payload, { shared: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[datacore-mcp-log] Failed to log ${payload.type}: ${detail}`);
  }
}
