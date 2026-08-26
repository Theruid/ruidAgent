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
  const [selectedModelIdx, setSelectedModelIdx] = useState(0);

  const rawModels = step.t === "models" && step.models ? step.models : [];
  const query = step.t === "models" ? input.trim().toLowerCase() : "";
  const isNumericQuery = /^\d+$/.test(query);

  const filteredModels =
    step.t === "models" && rawModels.length > 0
      ? query && !isNumericQuery
        ? rawModels.filter((m) => m.toLowerCase().includes(query))
        : rawModels
      : [];

  const maxVisibleModels = 10;
  const totalModels = filteredModels.length;
  const clampedModelIdx = Math.min(Math.max(0, selectedModelIdx), Math.max(0, totalModels - 1));
  const modelStartIdx = Math.max(
    0,
    Math.min(clampedModelIdx - Math.floor(maxVisibleModels / 2), totalModels - maxVisibleModels),
  );
  const visibleModels = filteredModels.slice(modelStartIdx, modelStartIdx + maxVisibleModels);
  const modelsAbove = modelStartIdx;
  const modelsBelow = Math.max(0, totalModels - (modelStartIdx + visibleModels.length));

  useInput((data, key) => {
    if (step.t === "models" && totalModels > 0) {
      if (key.upArrow) {
        setSelectedModelIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedModelIdx((i) => Math.min(totalModels - 1, i + 1));
        return;
      }
      if (key.pageUp) {
        setSelectedModelIdx((i) => Math.max(0, i - maxVisibleModels));
        return;
      }
      if (key.pageDown) {
        setSelectedModelIdx((i) => Math.min(totalModels - 1, i + maxVisibleModels));
        return;
      }
    } else {
      if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) return;
    }

    if (key.escape) {
      if (step.t === "models" && input.length > 0) {
        setInput("");
        setSelectedModelIdx(0);
        return;
      }
      if (step.t === "menu") onDone();
      else setStep({ t: "menu" });
      setInput("");
      setSelectedModelIdx(0);
      return;
    }

    if (key.backspace || key.delete) {
      setInput((v) => {
        const next = v.slice(0, -1);
        if (step.t === "models") setSelectedModelIdx(0);
        return next;
      });
      return;
    }

    if (key.return) {
      const line = input.trim();
      setInput("");
      void advance(step, line);
      return;
    }

    if (key.ctrl) return;
    setInput((v) => {
      const next = v + data.replace(/\r?\n/g, "");
      if (step.t === "models") setSelectedModelIdx(0);
      return next;
    });
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
        if (/^\d+$/.test(line) && rawModels.length > 0) {
          const num = parseInt(line, 10);
          if (num >= 1 && num <= rawModels.length) {
            modelId = rawModels[num - 1];
          }
        } else if (filteredModels.length > 0) {
          modelId = filteredModels[clampedModelIdx];
        } else if (rawModels.length > 0) {
          modelId = rawModels[0];
        }
        if (!modelId) return;
        const config = loadConfigFile();
        addProvider(config, {
          name: cur.name!,
          baseUrl: cur.url,
          apiKey: cur.key,
          apiKeyEnv: stepState.envName,
          defaultModel: modelId,
          models: rawModels,
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
        return `Type to filter · ↑↓ scroll · Enter pick highlighted · or number (1-${rawModels.length}):`;
      case "done":
        return "Press Enter to continue";
      default:
        return "";
    }
  })();

  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Provider setup
        </Text>
        {step.t === "models" && rawModels.length > 0 && (
          <Text dimColor>
            {query && !isNumericQuery
              ? `Showing ${visibleModels.length} of ${totalModels} matching '${query}' (${rawModels.length} total)`
              : `Showing ${modelStartIdx + 1}-${modelStartIdx + visibleModels.length} of ${rawModels.length}`}
          </Text>
        )}
      </Box>
      <Text dimColor>{promptText}</Text>
      {step.t === "models" && filteredModels.length > 0 && (
        <Box flexDirection="column" paddingLeft={1}>
          {modelsAbove > 0 && (
            <Text dimColor> ↑ {modelsAbove} more model{modelsAbove > 1 ? "s" : ""} above (↑/PgUp)</Text>
          )}
          {visibleModels.map((m, i) => {
            const actualIdx = modelStartIdx + i;
            const isSelected = actualIdx === clampedModelIdx;
            const originalIdx = rawModels.indexOf(m) + 1;
            return (
              <Text key={m} color={isSelected ? "cyanBright" : undefined} bold={isSelected}>
                {isSelected ? "> " : "  "}
                {originalIdx > 0 ? `${originalIdx}) ` : ""}{m}
              </Text>
            );
          })}
          {modelsBelow > 0 && (
            <Text dimColor> ↓ {modelsBelow} more model{modelsBelow > 1 ? "s" : ""} below (↓/PgDn)</Text>
          )}
        </Box>
      )}
      {step.t === "models" && !step.loading && !step.error && filteredModels.length === 0 && (
        <Box paddingLeft={1}>
          <Text color="yellow">No models matching &quot;{query}&quot;</Text>
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
