type JsonRecord = Record<string, unknown>;

export interface McpRequestMetadata {
  operationName: string | null;
  toolName: string | null;
  schemaIdentifier: string | null;
}

export interface McpToolOutcome {
  failed: boolean;
  statusCode: number | null;
  error: string | null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function parseToolErrorText(content: unknown): { error: string | null; statusCode: number | null } {
  if (!Array.isArray(content)) return { error: null, statusCode: null };

  for (const item of content) {
    const record = asRecord(item);
    if (record?.type !== 'text' || typeof record.text !== 'string') continue;

    try {
      const parsed = asRecord(JSON.parse(record.text));
      if (!parsed) continue;
      const error = typeof parsed.error === 'string'
        ? parsed.error
        : typeof parsed.message === 'string' ? parsed.message : null;
      const statusCode = typeof parsed.http_status === 'number' && Number.isInteger(parsed.http_status)
        ? parsed.http_status
        : null;
      if (error) return { error, statusCode };
    } catch {
      // Most successful MCP tool responses are prose or non-error JSON.
    }
  }

  return { error: null, statusCode: null };
}

/** Extract a logical operation name and schema identifier from a JSON-RPC MCP request. */
export function extractMcpRequestMetadata(requestBody: unknown): McpRequestMetadata {
  const request = Array.isArray(requestBody) ? asRecord(requestBody[0]) : asRecord(requestBody);
  if (!request) return { operationName: null, toolName: null, schemaIdentifier: null };

  const method = typeof request.method === 'string' ? request.method : null;
  const params = asRecord(request.params);
  if (method === 'tools/call' && params && typeof params.name === 'string') {
    const argumentsValue = asRecord(params.arguments);
    const schemaIdentifier = argumentsValue
      ? (typeof argumentsValue.schema_slug === 'string'
        ? argumentsValue.schema_slug
        : typeof argumentsValue.slug === 'string' ? argumentsValue.slug : null)
      : null;
    return {
      operationName: `tools/call:${params.name}`,
      toolName: params.name,
      schemaIdentifier,
    };
  }

  return {
    operationName: method ? `mcp:${method}` : null,
    toolName: null,
    schemaIdentifier: null,
  };
}

/** Interpret inner MCP tool errors without confusing them with the HTTP transport result. */
export function extractMcpToolOutcome(responseBody: unknown): McpToolOutcome {
  const response = Array.isArray(responseBody) ? asRecord(responseBody[0]) : asRecord(responseBody);
  if (!response) return { failed: false, statusCode: null, error: null };

  const jsonRpcError = asRecord(response.error);
  if (jsonRpcError) {
    const message = typeof jsonRpcError.message === 'string' ? jsonRpcError.message : 'MCP JSON-RPC request failed.';
    return { failed: true, statusCode: 500, error: message };
  }

  const result = asRecord(response.result);
  if (!result) return { failed: false, statusCode: null, error: null };

  const structuredContent = asRecord(result.structuredContent);
  const structuredError = typeof structuredContent?.error === 'string' ? structuredContent.error : null;
  const structuredStatus = typeof structuredContent?.http_status === 'number'
    ? structuredContent.http_status
    : null;
  const textError = parseToolErrorText(result.content);
  const failed = result.isError === true || Boolean(structuredError || textError.error);

  return {
    failed,
    statusCode: failed ? structuredStatus ?? textError.statusCode ?? 500 : null,
    error: failed ? structuredError ?? textError.error ?? 'MCP tool call failed.' : null,
  };
}
