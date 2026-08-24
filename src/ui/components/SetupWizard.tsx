import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  loadConfigFile,
  saveConfigFile,
  fetchModels,
  addProvider,
  setDefault,
} from "../../configWizard.js";

type Step =
  | { t: "menu" }
  | { t: "url" }
  | { t: "key"; url: string }
  | { t: "name"; url: string; key?: string }
  | { t: "models"; url: string; key?: string; name?: string; loading: boolean; models?: string[]; error?: string }
  | { t: "confirm-default"; url: string; key?: string; name: string; modelId: string }
  | { t: "done"; msg: string };

export function SetupWizard({ onDone }: { onDone(): void }) {
  const [step, setStep] = useState<Step>({ t: "menu" });
  const [input, setInput] = useState("");

  useInput((data, key) => {
    if (key.upArrow || key.downArrow) return;

    if (key.escape) {
      if (step.t === "menu") onDone();
      else setStep({ t: "menu" });
      setInput("");
      return;
    }

    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }

    if (key.return) {
      const line = input.trim();
      setInput("");
      void advance(step, line);
      return;
    }

    if (key.ctrl) return;
    setInput((v) => v + data.replace(/\r?\n/g, ""));
  });

  async function advance(cur: Step, line: string): Promise<void> {
    switch (cur.t) {
      case "menu": {
        const choice = line || "";
        if (choice === "2") onDone();
        else if (choice === "1") setStep({ t: "url" });
        break;
      }
      case "url": {
        if (!line) return setStep({ t: "menu" });
        setStep({ t: "key", url: line });
        break;
      }
      case "key": {
        const env = line.startsWith("$") ? line.slice(1) : undefined;
        setStep({ t: "name", url: cur.url, key: env ? undefined : line || undefined });
        if (env) (stepState.envName = env);
        break;
      }
      case "name": {
        const name = line || `provider-${Date.now().toString(36)}`;
        setStep({ t: "models", url: cur.url, key: cur.key, name, loading: true });
        try {
          const models = await fetchModels(cur.url, cur.key);
          setStep({ t: "models", url: cur.url, key: cur.key, name, loading: false, models });
        } catch (e) {
          setStep({
            t: "models",
            url: cur.url,
            key: cur.key,
            name,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      case "models": {
        if (cur.loading) return;
        if (cur.error) return setStep({ t: "menu" });
        let modelId = line;
        if (/^\d+$/.test(line) && cur.models) modelId = cur.models[parseInt(line, 10) - 1];
        if (!modelId) return;
        const config = loadConfigFile();
        addProvider(config, {
          name: cur.name!,
          baseUrl: cur.url,
          apiKey: cur.key,
          apiKeyEnv: stepState.envName,
        });
        setDefault(config, cur.name!, modelId);
        stepState.envName = undefined;
        saveConfigFile(config);
        setStep({ t: "done", msg: `Saved "${cur.name}" — default model ${modelId}` });
        break;
      }
      case "done":
        onDone();
        break;
      case "confirm-default":
        onDone();
        break;
    }
  }

  const promptText = (() => {
    switch (step.t) {
      case "menu":
        return "[1] Add OpenAI-compatible provider · [2] Done";
      case "url":
        return "Base URL (e.g. https://api.deepseek.com or http://localhost:11434/v1):";
      case "key":
        return "API key (empty for local servers, $ENV_NAME to read from env var):";
      case "name":
        return "Provider name:";
      case "models":
        if (step.loading) return "Fetching models…";
        if (step.error) return `Fetch failed (${step.error}) — press Enter to go back`;
        return "Pick a model by number or type an ID:";
      case "done":
        return "Press Enter to continue";
      default:
        return "";
    }
  })();

  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text bold color="cyan">
        Provider setup
      </Text>
      <Text dimColor>{promptText}</Text>
      {step.t === "models" && step.models && (
        <Box flexDirection="column" paddingLeft={1}>
          {step.models.slice(0, 10).map((m, i) => (
            <Text key={m}>
              {" "}
              {i + 1}) {m}
            </Text>
          ))}
          {step.models.length > 10 && <Text dimColor> …and {step.models.length - 10} more</Text>}
        </Box>
      )}
      {step.t !== "models" || (!step.loading && !step.error) ? (
        <Box paddingLeft={1}>
          <Text color="cyan">{"> "} </Text>
          <Text>{input}</Text>
          <Text dimColor>▌</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// Scratch state across steps that doesn't need re-renders.
const stepState: { envName?: string } = {};
