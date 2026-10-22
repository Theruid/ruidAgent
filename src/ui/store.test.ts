import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { AgentUIStore, NOTICE_TTL_MS } from "./store.js";

describe("AgentUIStore & State Transitions (store.ts)", () => {
  it("initializes with default state properly", () => {
    const store = new AgentUIStore("anthropic", "claude-sonnet-4", true, "code", {
      contextWindow: 200000,
      supportsThinking: true,
      supportsTools: true,
    });

    const state = store.getState();
    assert.strictEqual(state.phase, "idle");
    assert.strictEqual(state.mode, "code");
    assert.strictEqual(state.providerName, "anthropic");
    assert.strictEqual(state.model, "claude-sonnet-4");
    assert.strictEqual(state.connected, true);
    assert.strictEqual(state.thinkingEnabled, true);
    assert.strictEqual(state.turnCount, 0);
    assert.strictEqual(state.messages.length, 0);
  });

  it("cycles agent modes in code -> plan -> auto sequence", () => {
    const store = new AgentUIStore("openai", "gpt-4o", true, "code");
    assert.strictEqual(store.getState().mode, "code");

    assert.strictEqual(store.cycleMode(), "plan");
    assert.strictEqual(store.getState().mode, "plan");

    assert.strictEqual(store.cycleMode(), "auto");
    assert.strictEqual(store.getState().mode, "auto");

    assert.strictEqual(store.cycleMode(), "code");
    assert.strictEqual(store.getState().mode, "code");
  });

  it("manages scroll offset and clamping", () => {
    const store = new AgentUIStore("openai", "gpt-4o", true);
    assert.strictEqual(store.getState().scrollOffset, 0);

    store.scrollUp(10);
    assert.strictEqual(store.getState().scrollOffset, 10);

    store.scrollDown(4);
    assert.strictEqual(store.getState().scrollOffset, 6);

    store.scrollDown(20); // clamps to 0
    assert.strictEqual(store.getState().scrollOffset, 0);

    store.setScrollOffset(15);
    assert.strictEqual(store.getState().scrollOffset, 15);

    store.scrollToBottom();
    assert.strictEqual(store.getState().scrollOffset, 0);
  });

  it("never scrolls past the top once the message list reports its range", () => {
    const store = new AgentUIStore("openai", "gpt-4o", true);
    store.setMaxScroll(12);
    store.scrollUp(10);
    store.scrollUp(10);
    assert.strictEqual(store.getState().scrollOffset, 12);
    store.scrollDown(5);
    assert.strictEqual(store.getState().scrollOffset, 7);

    store.scrollToTop();
    assert.strictEqual(store.getState().scrollOffset, 12);

    // Content shrinking below the current offset pulls it back in range.
    store.setMaxScroll(4);
    assert.strictEqual(store.getState().scrollOffset, 4);
  });

  it("pairs parallel results of the same tool with their own rows by call id", () => {
    const store = new AgentUIStore("openai", "gpt-4o", true);
    store.beginTurn();
    store.applyLoopEvent({ type: "tool_start", name: "read_file", input: { path: "a.ts" }, toolCallId: "c1" });
    store.applyLoopEvent({ type: "tool_start", name: "read_file", input: { path: "b.ts" }, toolCallId: "c2" });
    // Results arrive in the opposite order.
    store.applyLoopEvent({ type: "tool_result", name: "read_file", content: "B contents", isError: false, toolCallId: "c2" });
    store.applyLoopEvent({ type: "tool_result", name: "read_file", content: "A failed", isError: true, toolCallId: "c1" });

    const rows = store.getState().messages.filter((m) => m.kind === "tool");
    const a = rows.find((m) => m.toolMeta?.input?.path === "a.ts");
    const b = rows.find((m) => m.toolMeta?.input?.path === "b.ts");
    assert.strictEqual(a?.text, "A failed");
    assert.strictEqual(a?.toolError, true);
    assert.strictEqual(b?.text, "B contents");
    assert.strictEqual(b?.toolError, false);
    assert.ok(rows.every((m) => !m.pending));
  });

  it("tracks streaming text, thought deltas, and commits assistant rows", () => {
    const store = new AgentUIStore("anthropic", "claude-sonnet-4", true);

    store.beginTurn();
    assert.strictEqual(store.getState().phase, "running");

    store.addUserMessage("Can you help me write code?");
    assert.strictEqual(store.getState().messages.length, 1);
    assert.strictEqual(store.getState().messages[0].kind, "user");

    // Thought delta
    store.applyLoopEvent({ type: "thought_delta", text: "I should analyze the request." });
    assert.strictEqual(store.getState().streamingThought, "I should analyze the request.");

    // Text delta
    store.applyLoopEvent({ type: "text_delta", text: "Sure, here is " });
    store.applyLoopEvent({ type: "text_delta", text: "your solution." });
    assert.strictEqual(store.getState().streamingText, "Sure, here is your solution.");

    store.endTurn([]);
    assert.strictEqual(store.getState().phase, "idle");

    const msgs = store.getState().messages;
    const assistantMsg = msgs.find((m) => m.kind === "assistant");
    assert.ok(assistantMsg);
    assert.strictEqual(assistantMsg.text, "Sure, here is your solution.");
    assert.strictEqual(assistantMsg.thought, "I should analyze the request.");
  });

  it("handles tool lifecycle, pending spinner, tool results, and turn receipt", () => {
    const store = new AgentUIStore("anthropic", "claude-sonnet-4", true);

    store.beginTurn();
    store.addUserMessage("Create a file called index.ts");

    // Tool start
    store.applyLoopEvent({
      type: "tool_start",
      name: "write_file",
      input: { path: "index.ts", content: "console.log('hello');" },
    });

    let msgs = store.getState().messages;
    let toolMsg = msgs.find((m) => m.kind === "tool");
    assert.ok(toolMsg);
    assert.strictEqual(toolMsg.pending, true);
    assert.strictEqual(toolMsg.toolName, "write_file");

    // Tool result
    store.applyLoopEvent({
      type: "tool_result",
      name: "write_file",
      content: "File written successfully",
      isError: false,
    });

    msgs = store.getState().messages;
    toolMsg = msgs.find((m) => m.kind === "tool");
    assert.strictEqual(toolMsg?.pending, false);
    assert.strictEqual(toolMsg?.toolError, false);

    // End turn and check TurnReceipt generated
    store.endTurn([]);
    msgs = store.getState().messages;
    const receiptMsg = msgs.find((m) => m.turnReceipt !== undefined);
    assert.ok(receiptMsg);
    assert.strictEqual(receiptMsg.turnReceipt?.filesChanged, 1);
    assert.strictEqual(receiptMsg.turnReceipt?.commandsRun, 0);
  });

  it("commits streamed text before appending the tool row that followed it", () => {
    const store = new AgentUIStore("deepseek", "deepseek-chat", true);
    store.beginTurn();

    store.applyLoopEvent({ type: "text_delta", text: "Let me check that file." });
    store.applyLoopEvent({ type: "tool_start", name: "read_file", input: { path: "a.ts" }, toolCallId: "c1" });

    const rows = store.getState().messages;
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].kind, "assistant");
    assert.strictEqual(rows[0].text, "Let me check that file.");
    assert.strictEqual(rows[1].kind, "tool");
    assert.strictEqual(rows[1].toolName, "read_file");

    store.endTurn([]);
  });

  it("handles permission request and callback resolution", () => {
    const store = new AgentUIStore("anthropic", "claude-sonnet-4", true);
    let resolvedAnswer: string | null = null;

    store.respondPermission = (ans) => {
      resolvedAnswer = ans;
    };

    store.applyLoopEvent({
      type: "permission_request",
      name: "bash",
      input: { command: "npm test" },
    });

    assert.ok(store.getState().pendingPermission);
    assert.strictEqual(store.getState().pendingPermission?.toolName, "bash");
    assert.strictEqual(store.getState().pendingPermission?.argsPreview, "npm test");

    // Respond permission
    assert.ok(store.respondPermission);
    store.respondPermission("y");

    assert.strictEqual(resolvedAnswer, "y");
    assert.strictEqual(store.getState().pendingPermission, null);
  });

  it("handles session usage updates and cost calculation", () => {
    const store = new AgentUIStore("anthropic", "claude-sonnet-4", true);

    store.applyLoopEvent({
      type: "usage",
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 300,
      durationMs: 800,
    });

    const usage = store.getState().sessionUsage;
    assert.strictEqual(usage.inputTokens, 1000);
    assert.strictEqual(usage.outputTokens, 500);
    assert.strictEqual(usage.cacheCreationInputTokens, 200);
    assert.strictEqual(usage.cacheReadInputTokens, 300);
    assert.ok(usage.totalCost > 0);
    assert.strictEqual(usage.contextTokens, 1000);
    assert.strictEqual(store.getState().lastTurnDurationMs, 800);
  });

  it("uses the latest request for context size and prices each request at its own model", () => {
    const store = new AgentUIStore("anthropic", "claude-opus-5", true);
    store.applyLoopEvent({ type: "usage", inputTokens: 1_000_000, outputTokens: 0 });
    const opusCost = store.getState().sessionUsage.totalCost;
    assert.strictEqual(opusCost, 15);

    store.setConnection("anthropic", "claude-haiku-4-5", true);
    store.applyLoopEvent({ type: "usage", inputTokens: 40_000, outputTokens: 0 });

    const usage = store.getState().sessionUsage;
    assert.strictEqual(usage.inputTokens, 1_040_000);
    // Context is the size of the last prompt, not the session total.
    assert.strictEqual(usage.contextTokens, 40_000);
    // The earlier Opus request is not repriced at Haiku rates.
    assert.ok(Math.abs(usage.totalCost - (15 + 0.04 * 0.8)) < 1e-9);
  });

  it("tracks live activity so the UI shows progress before the first token", () => {
    const store = new AgentUIStore("deepseek", "deepseek-chat", true);

    store.beginTurn();
    assert.strictEqual(store.getState().phase, "running");
    assert.strictEqual(store.getState().activeAction?.name, "Preparing context");
    assert.ok(store.getState().turnStartedAt > 0);

    store.applyLoopEvent({ type: "iteration", count: 1 });
    assert.strictEqual(store.getState().activeAction?.name, "Generating answer");

    store.applyLoopEvent({ type: "thought_delta", text: "Thinking about it" });
    assert.strictEqual(store.getState().activeAction?.name, "Thinking");

    store.applyLoopEvent({ type: "text_delta", text: "Hi!" });
    assert.strictEqual(store.getState().activeAction?.name, "Generating answer");

    // Tool activity names the exact tool being called.
    store.applyLoopEvent({ type: "tool_start", name: "bash", input: { command: "npm test" } });
    assert.strictEqual(store.getState().activeAction?.name, "Running bash");
    assert.strictEqual(store.getState().activeAction?.detail, "npm test");

    // A finished tool keeps the row alive until the next step reports in,
    // so the activity line does not flicker between tool calls.
    store.applyLoopEvent({ type: "tool_result", name: "bash", content: "ok", isError: false });
    assert.strictEqual(store.getState().activeAction?.name, "Running bash");

    // The follow-up request names the tools its answer is based on.
    store.applyLoopEvent({ type: "iteration", count: 2 });
    assert.strictEqual(store.getState().activeAction?.name, "Reviewing results");
    assert.strictEqual(store.getState().activeAction?.detail, "bash");

    store.endTurn([]);
    assert.strictEqual(store.getState().activeAction, null);
    assert.strictEqual(store.getState().turnStartedAt, 0);
  });

  it("aggregates parallel tool calls into one activity label", () => {
    const store = new AgentUIStore("deepseek", "deepseek-chat", true);
    store.beginTurn();

    store.applyLoopEvent({ type: "tool_start", name: "read_file", input: { path: "a.ts" }, toolCallId: "c1" });
    store.applyLoopEvent({ type: "tool_start", name: "grep", input: { pattern: "foo" }, toolCallId: "c2" });

    assert.strictEqual(store.getState().activeAction?.name, "Running 2 tools");
    assert.strictEqual(store.getState().activeAction?.detail, "read_file, grep");

    // One finishing leaves the survivor as the named activity.
    store.applyLoopEvent({ type: "tool_result", name: "read_file", content: "x", isError: false, toolCallId: "c1" });
    assert.strictEqual(store.getState().activeAction?.name, "Running grep");

    store.applyLoopEvent({ type: "tool_result", name: "grep", content: "y", isError: false, toolCallId: "c2" });
    store.endTurn([]);
    assert.strictEqual(store.getState().activeAction, null);
  });

  it("flags a pending permission prompt as the current activity", () => {
    const store = new AgentUIStore("anthropic", "claude-sonnet-4", true);
    store.beginTurn();
    store.applyLoopEvent({ type: "permission_request", name: "bash", input: { command: "rm -rf dist" } });

    assert.strictEqual(store.getState().activeAction?.name, "Awaiting your approval");
    assert.strictEqual(store.getState().activeAction?.detail, "bash");
  });

  it("clears chat and loads messages", () => {
    const store = new AgentUIStore("anthropic", "claude-sonnet-4", true);
    store.addUserMessage("hello");
    assert.strictEqual(store.getState().messages.length, 1);

    store.clearChat();
    assert.strictEqual(store.getState().messages.length, 0);
    assert.strictEqual(store.getState().turnCount, 0);

    store.loadMessages([
      { id: 10, kind: "user", text: "prev user" },
      { id: 11, kind: "assistant", text: "prev assistant" },
    ]);

    assert.strictEqual(store.getState().messages.length, 2);
    assert.strictEqual(store.getState().turnCount, 2);
  });
  it("queues prompts typed during a turn and hands them back for editing", () => {
    const store = new AgentUIStore("openai", "gpt-4o", true);
    store.enqueuePrompt("first");
    store.enqueuePrompt("second");
    assert.deepStrictEqual(store.getState().queuedPrompts, ["first", "second"]);
    assert.strictEqual(store.dequeuePrompt(), "first");
    store.enqueuePrompt("third");
    assert.strictEqual(store.takeQueue(), "second\n\nthird");
    assert.deepStrictEqual(store.getState().queuedPrompts, []);
    assert.strictEqual(store.takeQueue(), null);
    assert.strictEqual(store.dequeuePrompt(), undefined);
  });

  it("clears short notices after a while but keeps panels and errors", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const store = new AgentUIStore("openai", "gpt-4o", true);
      store.setNotice("Model switched");
      mock.timers.tick(NOTICE_TTL_MS + 1);
      assert.strictEqual(store.getState().notice, null);

      store.setNotice("Commands\n/help");
      mock.timers.tick(NOTICE_TTL_MS + 1);
      assert.strictEqual(store.getState().notice, "Commands\n/help");

      store.setNotice("Error: provider down");
      mock.timers.tick(NOTICE_TTL_MS + 1);
      assert.strictEqual(store.getState().notice, "Error: provider down");

      // A newer notice is not cleared by the older one's timer.
      store.setNotice("one");
      mock.timers.tick(NOTICE_TTL_MS - 10);
      store.setNotice("two");
      mock.timers.tick(20);
      assert.strictEqual(store.getState().notice, "two");
    } finally {
      mock.timers.reset();
    }
  });

  it("toggles the latest finished tool's full output (Ctrl+O)", () => {
    const store = new AgentUIStore("openai", "gpt-4o", true);
    assert.strictEqual(store.toggleLatestToolOutput(), false);
    store.beginTurn();
    store.applyLoopEvent({ type: "tool_start", name: "bash", input: { command: "ls" }, toolCallId: "b1" });
    store.applyLoopEvent({ type: "tool_result", name: "bash", content: "a\nb\nc", isError: false, toolCallId: "b1" });
    const row = store.getState().messages.find((m) => m.kind === "tool");
    assert.strictEqual(row?.toolMeta?.output, "a\nb\nc");
    assert.strictEqual(store.toggleLatestToolOutput(), true);
    assert.strictEqual(store.getState().expandedToolId, row?.id);
    assert.strictEqual(store.toggleLatestToolOutput(), false);
    assert.strictEqual(store.getState().expandedToolId, null);
  });

  it("hides a finished plan when the next turn starts, and shows it again on updates", () => {
    const store = new AgentUIStore("openai", "gpt-4o", true);
    const done = { id: "1", subject: "x", status: "completed" as const, createdAt: 0, updatedAt: 0 };
    store.setTasks([done]);
    assert.strictEqual(store.getState().taskPanelHidden, false);
    store.beginTurn();
    assert.strictEqual(store.getState().taskPanelHidden, true);
    store.applyLoopEvent({ type: "tasks_updated", tasks: [{ ...done, status: "pending" }] });
    assert.strictEqual(store.getState().taskPanelHidden, false);
  });

  it("starts a cleared conversation with fresh usage counters", () => {
    const store = new AgentUIStore("anthropic", "claude-sonnet-4", true);
    store.applyLoopEvent({ type: "usage", inputTokens: 1000, outputTokens: 10 });
    store.clearChat();
    const usage = store.getState().sessionUsage;
    assert.strictEqual(usage.inputTokens, 0);
    assert.strictEqual(usage.totalCost, 0);
    assert.strictEqual(usage.contextTokens, 0);
  });
});
