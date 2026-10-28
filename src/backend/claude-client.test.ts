// @vitest-environment node

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeAgentClient, planUsageWindows, rateLimitWindows } from "./claude-client";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("ClaudeAgentClient", () => {
  it("discovers future SDK models without sending a prompt and retains them offline", async () => {
    const close = vi.fn();
    const supportedModels = vi
      .fn()
      .mockResolvedValueOnce([
        { value: "sonnet", resolvedModel: "claude-future", displayName: "Future Claude" },
      ])
      .mockRejectedValueOnce(new Error("offline"));
    const query = vi.fn(
      (_params: Parameters<NonNullable<ConstructorParameters<typeof ClaudeAgentClient>[1]>>[0]) =>
        ({ supportedModels, close }) as unknown as Query,
    );
    const client = new ClaudeAgentClient({ executable: "unused", version: "test" }, query);
    client.start();
    const result = await client.request("model/list", {});
    expect(result).toMatchObject({
      data: [{ model: "claude-future", displayName: "Future Claude" }],
    });
    expect(await client.request("model/list", {})).toEqual(result);
    expect(close).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toMatchObject({
      options: { tools: [], mcpServers: {}, persistSession: false },
    });
    await client.stop();
  });

  it("reads the plan limits without sending a prompt when no chat is open", async () => {
    const close = vi.fn();
    const usage = vi
      .fn()
      .mockResolvedValueOnce({
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 14, resets_at: "2026-10-28T14:00:00Z" },
          seven_day: { utilization: 77, resets_at: "2026-10-29T17:00:00Z" },
        },
      })
      .mockRejectedValueOnce(new Error("offline"));
    const query = vi.fn(
      (_params: Parameters<NonNullable<ConstructorParameters<typeof ClaudeAgentClient>[1]>>[0]) =>
        ({
          usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage,
          close,
        }) as unknown as Query,
    );
    const client = new ClaudeAgentClient({ executable: "unused", version: "test" }, query);
    client.start();
    expect(await client.request("sahkarmi/planLimits/read", {})).toEqual({
      limits: [
        expect.objectContaining({ id: "five_hour", usedPercent: 14, status: "ok" }),
        expect.objectContaining({ id: "seven_day", usedPercent: 77, status: "warning" }),
      ],
    });
    expect(await client.request("sahkarmi/planLimits/read", {})).toEqual({ limits: null });
    expect(close).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toMatchObject({
      options: { tools: [], mcpServers: {}, persistSession: false },
    });
    await client.stop();
  });

  it("streams a Claude SDK turn through the App Server event contract", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-claude-client-"));
    const executable =
      process.platform === "win32" ? join(root, "claude.cmd") : join(root, "claude");
    if (process.platform === "win32") {
      await writeFile(
        executable,
        `@if "%1"=="auth" (
  @echo {"loggedIn":true,"email":"claude@example.com","subscriptionType":"max"}
)
`,
      );
    } else {
      await writeFile(
        executable,
        `#!/bin/sh
if [ "$1" = "auth" ]; then
  printf '%s' '{"loggedIn":true,"email":"claude@example.com","subscriptionType":"max"}'
fi
`,
      );
      await chmod(executable, 0o755);
    }

    const output = new TestQueue<SDKMessage>();
    let prompt: AsyncIterable<SDKUserMessage> | null = null;
    const generator = output[Symbol.asyncIterator]() as Query;
    Object.assign(generator, {
      [Symbol.asyncIterator]: () => generator,
      interrupt: async () => undefined,
      setModel: async () => undefined,
      setMaxThinkingTokens: async () => undefined,
      close: () => output.close(),
    });
    const client = new ClaudeAgentClient({ executable, version: "2.1.231" }, (params) => {
      prompt = params.prompt as AsyncIterable<SDKUserMessage>;
      return generator;
    });
    const notifications: Array<{ method: string; params: unknown }> = [];
    client.on("notification", (notification) => notifications.push(notification));
    client.start();

    await expect(client.request("account/read", {})).resolves.toMatchObject({
      account: { type: "claude", email: "claude@example.com", planType: "max" },
    });
    const thread = await client.request<{ thread: { id: string } }>("thread/start", {
      cwd: root,
      model: "claude-sonnet-5",
      developerInstructions: "Be concise.",
      runtimeWorkspaceRoots: [root],
    });
    const deliveryId = "8bf58506-96a8-4d96-837c-3ab807b79d1f";
    await client.request("turn/start", {
      threadId: thread.thread.id,
      clientUserMessageId: deliveryId,
      input: [{ type: "text", text: "Hello" }],
    });

    expect(prompt).not.toBeNull();
    const sent = await (prompt as unknown as AsyncIterable<SDKUserMessage>)
      [Symbol.asyncIterator]()
      .next();
    expect(sent?.value).toMatchObject({ uuid: deliveryId, message: { content: "Hello" } });
    output.push({
      type: "stream_event",
      parent_tool_use_id: null,
      session_id: thread.thread.id,
      uuid: deliveryId,
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
    } as SDKMessage);
    output.push({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Hi",
      terminal_reason: "completed",
      errors: [],
      session_id: thread.thread.id,
      uuid: deliveryId,
    } as unknown as SDKMessage);
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "turn/started" }),
        expect.objectContaining({
          method: "item/agentMessage/delta",
          params: expect.objectContaining({ turnId: deliveryId, delta: "Hi" }),
        }),
        expect.objectContaining({
          method: "turn/completed",
          params: expect.objectContaining({ turn: { id: deliveryId, status: "completed" } }),
        }),
      ]),
    );
    await client.stop();
  });

  it("forwards the SDK's api_retry as a real retry signal", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "22222222-2222-4222-8222-222222222222";
    await startTurn(client, threadId, turnId);
    output.push({
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 10,
      retry_delay_ms: 1500,
      error_status: 529,
      error: "overloaded",
      uuid: turnId,
      session_id: threadId,
    } as unknown as SDKMessage);
    await waitFor(() => notifications.some((event) => event.method === "sahkarmi/retrying"));
    expect(notifications.find((event) => event.method === "sahkarmi/retrying")?.params).toEqual({
      threadId,
      attempt: 2,
      maxRetries: 10,
      delayMs: 1500,
    });
    await client.stop();
  });

  it("uses a complete assistant message when Claude omits stream deltas", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "11111111-1111-4111-8111-111111111111";
    await startTurn(client, threadId, turnId);

    output.push(assistantMessage(threadId, "child-message", "Hidden child response", "tool-use-1"));
    output.push(assistantMessage(threadId, "main-message", "Visible without a refresh"));
    output.push(resultMessage(threadId, turnId, ""));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(notificationDeltas(notifications)).toEqual(["Visible without a refresh"]);
    expect(completedText(notifications)).toBe("Visible without a refresh");
    expect(JSON.stringify(notifications)).not.toContain("Hidden child response");
    await client.stop();
  });

  it("gives Claude the owner's MCP servers beside Sahkarmi's own", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-claude-client-"));
    const output = new TestQueue<SDKMessage>();
    const generator = output[Symbol.asyncIterator]() as Query;
    Object.assign(generator, {
      [Symbol.asyncIterator]: () => generator,
      interrupt: async () => undefined,
      close: () => output.close(),
    });
    let options: Record<string, unknown> = {};
    const client = new ClaudeAgentClient(
      { executable: "/bin/true", version: "2.1.231" },
      (params) => {
        options = params.options as Record<string, unknown>;
        return generator;
      },
    );
    client.start();
    await client.request("thread/start", {
      cwd: root,
      developerInstructions: "",
      customMcpServers: [
        { name: "notion", transport: "http", url: "https://mcp.notion.test/mcp", headers: {} },
        { name: "sahkarmi", transport: "stdio", command: "evil" },
      ],
    });
    const servers = options.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.notion).toEqual({
      type: "http",
      url: "https://mcp.notion.test/mcp",
      headers: {},
    });
    expect(servers.sahkarmi_browser).toBeDefined();
    // A server cannot take the name of Sahkarmi's own tools.
    expect(servers.sahkarmi?.command).toBeUndefined();
    await client.stop();
  });

  it("adds only the missing suffix from a complete assistant message", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "22222222-2222-4222-8222-222222222222";
    await startTurn(client, threadId, turnId);

    output.push(streamDelta(threadId, turnId, "Hel"));
    output.push(assistantMessage(threadId, "main-message", "Hello"));
    output.push(resultMessage(threadId, turnId, "Hello"));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(notificationDeltas(notifications)).toEqual(["Hel", "lo"]);
    expect(completedText(notifications)).toBe("Hello");
    await client.stop();
  });

  it("starts a new text item after each tool call, so text and steps interleave", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "66666666-6666-4666-8666-666666666666";
    await startTurn(client, threadId, turnId);
    const toolUse = (uuid: string, id: string) =>
      ({
        type: "assistant",
        parent_tool_use_id: null,
        session_id: threadId,
        uuid,
        message: {
          content: [{ type: "tool_use", id, name: "mcp__sahkarmi_browser__act", input: {} }],
        },
      }) as unknown as SDKMessage;

    output.push(streamDelta(threadId, turnId, "Let me add a row."));
    output.push(assistantMessage(threadId, "m1", "Let me add a row."));
    output.push(toolUse("m2", "t1"));
    output.push(streamDelta(threadId, turnId, "Fields confirmed."));
    output.push(assistantMessage(threadId, "m3", "Fields confirmed."));
    output.push(toolUse("m4", "t2"));
    output.push(streamDelta(threadId, turnId, "Done."));
    output.push(assistantMessage(threadId, "m5", "Done."));
    output.push(resultMessage(threadId, turnId, "Done."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    const order = notifications.flatMap((event) => {
      const params = event.params as { itemId?: string; item?: { id: string; text?: string } };
      if (event.method === "item/agentMessage/delta") return [`delta ${params.itemId}`];
      if (event.method === "item/started") return [`tool ${params.item?.id}`];
      if (event.method === "item/completed" && params.item?.text !== undefined) {
        return [`text ${params.item.id}: ${params.item.text}`];
      }
      return [];
    });
    expect(order).toEqual([
      `delta ${turnId}:assistant`,
      "tool tool:t1",
      `text ${turnId}:assistant: Let me add a row.`,
      `delta ${turnId}:assistant:1`,
      "tool tool:t2",
      `text ${turnId}:assistant:1: Fields confirmed.`,
      `delta ${turnId}:assistant:2`,
      `text ${turnId}:assistant:2: Done.`,
    ]);
    await client.stop();
  });

  it("turns Claude's TodoWrite list into the turn's live plan", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "44444444-4444-4444-8444-444444444444";
    await startTurn(client, threadId, turnId);

    output.push({
      type: "assistant",
      parent_tool_use_id: null,
      session_id: threadId,
      uuid: "todo-message",
      message: {
        content: [
          {
            type: "tool_use",
            id: "todo-1",
            name: "TodoWrite",
            input: {
              todos: [
                { content: "Read the invoices", status: "completed", activeForm: "Reading" },
                { content: "Total by vendor", status: "in_progress", activeForm: "Totalling" },
                { content: "Write the summary", status: "pending", activeForm: "Writing" },
              ],
            },
          },
        ],
      },
    } as unknown as SDKMessage);
    output.push(resultMessage(threadId, turnId, "Done"));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(notifications).toContainEqual({
      method: "turn/plan/updated",
      params: {
        threadId,
        turnId,
        explanation: null,
        plan: [
          { step: "Read the invoices", status: "completed" },
          { step: "Total by vendor", status: "in_progress" },
          { step: "Write the summary", status: "pending" },
        ],
      },
    });
    await client.stop();
  });

  it("follows newer Claude CLIs' TaskCreate and TaskUpdate as the live plan", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "55555555-5555-4555-8555-555555555555";
    await startTurn(client, threadId, turnId);
    const toolUse = (id: string, name: string, input: unknown) =>
      ({
        type: "assistant",
        parent_tool_use_id: null,
        session_id: threadId,
        uuid: `use-${id}`,
        message: { content: [{ type: "tool_use", id, name, input }] },
      }) as unknown as SDKMessage;
    const toolResult = (id: string, text: string) =>
      ({
        type: "user",
        parent_tool_use_id: null,
        session_id: threadId,
        uuid: `result-${id}`,
        message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] },
      }) as unknown as SDKMessage;

    output.push(toolUse("c1", "TaskCreate", { subject: "Read the invoices", description: "" }));
    output.push(toolResult("c1", "Task #1 created successfully: Read the invoices"));
    output.push(toolUse("c2", "TaskCreate", { subject: "Write the summary", description: "" }));
    output.push(toolResult("c2", "Task #2 created successfully: Write the summary"));
    output.push(toolUse("u1", "TaskUpdate", { taskId: "1", status: "in_progress" }));
    output.push(resultMessage(threadId, turnId, "Done"));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    const plans = notifications.filter((event) => event.method === "turn/plan/updated");
    expect(plans.at(-1)?.params).toEqual({
      threadId,
      turnId,
      explanation: null,
      plan: [
        { step: "Read the invoices", status: "in_progress" },
        { step: "Write the summary", status: "pending" },
      ],
    });
    await client.stop();
  });

  it("keys usage by session and flags only the first total after a resume", async () => {
    const { client, notifications, output, threadId } = await createHarness(
      "33333333-3333-4333-8333-333333333333",
    );
    const usageResult = (turnId: string, total: number, turn: number) =>
      ({
        ...(resultMessage(threadId, turnId, "ok") as object),
        total_cost_usd: total / 1_000_000,
        modelUsage: {
          "claude-sonnet-5": {
            inputTokens: total - 100,
            outputTokens: 100,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        },
        usage: {
          input_tokens: turn - 10,
          output_tokens: 10,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }) as unknown as SDKMessage;

    const first = "44444444-4444-4444-8444-444444444444";
    await startTurn(client, threadId, first);
    output.push(usageResult(first, 72_645, 25_191));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));
    const second = "55555555-5555-4555-8555-555555555555";
    await startTurn(client, threadId, second);
    output.push(usageResult(second, 99_748, 27_103));
    await waitFor(
      () => notifications.filter((event) => event.method === "sahkarmi/usage").length === 2,
    );

    expect(
      notifications.filter((event) => event.method === "sahkarmi/usage").map((e) => e.params),
    ).toEqual([
      expect.objectContaining({
        sessionKey: `thread:claude:${threadId}`,
        persistent: true,
        resumed: true,
        tokens: 72_645,
        turnTokens: 25_191,
      }),
      expect.objectContaining({
        sessionKey: `thread:claude:${threadId}`,
        resumed: false,
        tokens: 99_748,
        turnTokens: 27_103,
      }),
    ]);
    await client.stop();
  });

  it("reads every plan window and its real percentage from a rate_limit_event", () => {
    // As Claude Code 2.1.312 sent it on 28 Oct 2026.
    expect(
      rateLimitWindows({
        status: "allowed_warning",
        resetsAt: 1793293200,
        rateLimitType: "seven_day",
        utilization: 0.76,
        surpassedThreshold: 0.75,
        unifiedWindows: {
          five_hour: { utilization: 0.13, resetsAt: 1793196000, status: "allowed" },
          seven_day: { utilization: 0.76, resetsAt: 1793293200, status: "allowed_warning" },
        },
      }),
    ).toEqual([
      {
        id: "five_hour",
        label: null,
        usedPercent: 13,
        resetsAt: "2026-10-28T14:00:00.000Z",
        status: "ok",
      },
      {
        id: "seven_day",
        label: null,
        usedPercent: 76,
        resetsAt: "2026-10-29T17:00:00.000Z",
        status: "warning",
      },
    ]);
    expect(rateLimitWindows({ status: "rejected", rateLimitType: "five_hour" })).toEqual([
      { id: "five_hour", label: null, usedPercent: null, resetsAt: null, status: "limited" },
    ]);
  });

  it("reads the /usage plan windows, including per-model weekly limits", () => {
    expect(
      planUsageWindows({
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 14, resets_at: "2026-10-28T14:00:00.204923+00:00" },
          seven_day: { utilization: 77, resets_at: "2026-10-29T17:00:00.204947+00:00" },
          seven_day_opus: null,
          model_scoped: [
            { display_name: "Fable", utilization: 30, resets_at: "2026-10-29T17:00:00Z" },
          ],
        },
      }),
    ).toEqual([
      expect.objectContaining({ id: "five_hour", usedPercent: 14, status: "ok" }),
      expect.objectContaining({ id: "seven_day", usedPercent: 77, status: "warning" }),
      expect.objectContaining({ id: "model:fable", label: "Weekly (Fable)", usedPercent: 30 }),
    ]);
    expect(planUsageWindows({ rate_limits_available: false, rate_limits: null })).toBeNull();
  });

  it("does not duplicate a fully streamed assistant message", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "33333333-3333-4333-8333-333333333333";
    await startTurn(client, threadId, turnId);

    output.push(streamDelta(threadId, turnId, "Hello"));
    output.push(assistantMessage(threadId, "main-message", "Hello"));
    output.push(resultMessage(threadId, turnId, "Hello"));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(notificationDeltas(notifications)).toEqual(["Hello"]);
    expect(completedText(notifications)).toBe("Hello");
    await client.stop();
  });
});

async function createHarness(resumeThreadId?: string): Promise<{
  client: ClaudeAgentClient;
  notifications: Array<{ method: string; params: unknown }>;
  output: TestQueue<SDKMessage>;
  threadId: string;
}> {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-claude-client-"));
  const output = new TestQueue<SDKMessage>();
  const generator = output[Symbol.asyncIterator]() as Query;
  Object.assign(generator, {
    [Symbol.asyncIterator]: () => generator,
    interrupt: async () => undefined,
    setModel: async () => undefined,
    setMaxThinkingTokens: async () => undefined,
    close: () => output.close(),
  });
  const client = new ClaudeAgentClient(
    { executable: "/bin/true", version: "2.1.231" },
    () => generator,
  );
  const notifications: Array<{ method: string; params: unknown }> = [];
  client.on("notification", (notification) => notifications.push(notification));
  client.start();
  const thread = await client.request<{ thread: { id: string } }>(
    resumeThreadId ? "thread/resume" : "thread/start",
    {
      ...(resumeThreadId ? { threadId: resumeThreadId } : {}),
      cwd: root,
      model: "claude-sonnet-5",
      developerInstructions: "Be concise.",
      runtimeWorkspaceRoots: [root],
    },
  );
  return { client, notifications, output, threadId: thread.thread.id };
}

function startTurn(client: ClaudeAgentClient, threadId: string, turnId: string): Promise<unknown> {
  return client.request("turn/start", {
    threadId,
    clientUserMessageId: turnId,
    input: [{ type: "text", text: "Hello" }],
  });
}

function streamDelta(threadId: string, turnId: string, text: string): SDKMessage {
  return {
    type: "stream_event",
    parent_tool_use_id: null,
    session_id: threadId,
    uuid: turnId,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  } as SDKMessage;
}

function assistantMessage(
  threadId: string,
  messageId: string,
  text: string,
  parentToolUseId: string | null = null,
): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: parentToolUseId,
    session_id: threadId,
    uuid: messageId,
    message: { content: [{ type: "text", text }] },
  } as unknown as SDKMessage;
}

function resultMessage(threadId: string, turnId: string, result: string): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result,
    terminal_reason: "completed",
    errors: [],
    session_id: threadId,
    uuid: turnId,
  } as unknown as SDKMessage;
}

function notificationDeltas(notifications: Array<{ method: string; params: unknown }>): string[] {
  return notifications
    .filter((event) => event.method === "item/agentMessage/delta")
    .map((event) => (event.params as { delta: string }).delta);
}

function completedText(notifications: Array<{ method: string; params: unknown }>): string {
  const completed = notifications.find((event) => event.method === "item/completed");
  return (completed?.params as { item?: { text?: string } } | undefined)?.item?.text ?? "";
}

class TestQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = [];
  readonly #waiters: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.#closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Claude adapter events.");
}
