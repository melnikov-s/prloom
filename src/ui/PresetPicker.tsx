import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";

interface PresetPickerProps {
  presets: string[];
  onSelect: (preset: string) => void;
  onCancel: () => void;
}

/**
 * Interactive preset picker for selecting configuration presets during plan creation.
 */
export function PresetPicker({
  presets,
  onSelect,
  onCancel,
}: PresetPickerProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(presets.length - 1, i + 1));
    }
    if (key.return) {
      const preset = presets[selectedIndex];
      if (preset !== undefined) {
        onSelect(preset);
      }
    }
    if (input === "q" || key.escape) {
      onCancel();
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Select configuration preset:</Text>
      <Box marginTop={1} flexDirection="column">
        {presets.map((preset, idx) => (
          <Box key={preset}>
            <Text color={idx === selectedIndex ? "cyan" : undefined}>
              {idx === selectedIndex ? "▸ " : "  "}
              {preset}
              {preset === "default" && (
                <Text dimColor> (standard workflow)</Text>
              )}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>(↑/↓ to navigate, Enter to select, q to cancel)</Text>
      </Box>
    </Box>
  );
}

/**
 * Render the preset picker and wait for user selection.
 * Returns the selected preset name, or undefined if cancelled.
 */
export async function selectPreset(
  presets: string[]
): Promise<string | undefined> {
  const { render } = await import("ink");

  return new Promise((resolve) => {
    const { unmount } = render(
      <PresetPicker
        presets={presets}
        onSelect={(preset) => {
          unmount();
          resolve(preset);
        }}
        onCancel={() => {
          unmount();
          resolve(undefined);
        }}
      />
    );
  });
}
