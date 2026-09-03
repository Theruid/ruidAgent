import { describe, it } from "node:test";
import assert from "node:assert";
import { AgentUIStore } from "./store.js";

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
    assert.strictEqual(store.getState().lastTurnDurationMs, 800);
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
});
