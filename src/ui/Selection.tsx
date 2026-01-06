import React, { useState, useEffect } from "react";
import { Box, Text, useInput, render } from "ink";

export interface SelectionOption {
  id: string;
  label: string;
  metadata?: string;
  color?: string;
}

interface SelectionProps {
  title: string;
  options: SelectionOption[];
  onSelect: (option: SelectionOption) => void;
}

export function Selection({
  title,
  options,
  onSelect,
}: SelectionProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
    }
    if (key.return) {
      onSelect(options[selectedIndex]!);
    }
    if (input === "q" || key.escape) {
      process.exit(0);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Box key={option.id}>
              <Text color={isSelected ? "cyan" : undefined}>
                {isSelected ? "▸ " : "  "}
              </Text>
              <Box width={20}>
                <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                  {option.label}
                </Text>
              </Box>
              {option.metadata && (
                <Box marginLeft={2}>
                  <Text dimColor={!isSelected} color={option.color}>
                    {option.metadata}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>(↑/↓ to navigate, Enter to select, q to quit)</Text>
      </Box>
    </Box>
  );
}

/**
 * Helper to prompt the user to select an item from a list.
 */
export async function promptSelection(
  title: string,
  options: SelectionOption[]
): Promise<string> {
  if (options.length === 0) {
    console.log("No items available to select.");
    process.exit(0);
  }

  // If only one option, maybe just return it?
  // But usually it's better to show it to the user for confirmation or just proceed.
  // The user said "if they just type that command out without an ID, I want to provide a list of all of them".

  return new Promise((resolve) => {
    const { unmount } = render(
      <Selection
        title={title}
        options={options}
        onSelect={(option) => {
          unmount();
          resolve(option.id);
        }}
      />
    );
  });
}
