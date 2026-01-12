import React, { useState } from "react";
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

interface SelectionWithConfirmProps {
  title: string;
  options: SelectionOption[];
  confirmMessage: (option: SelectionOption) => string;
  onConfirm: (option: SelectionOption) => void;
  onCancel: () => void;
}

function SelectionWithConfirm({
  title,
  options,
  confirmMessage,
  onConfirm,
  onCancel,
}: SelectionWithConfirmProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirming, setConfirming] = useState<SelectionOption | null>(null);

  useInput((input, key) => {
    if (confirming) {
      // In confirmation mode
      if (input === "y" || input === "Y") {
        onConfirm(confirming);
      } else if (input === "n" || input === "N" || key.escape) {
        setConfirming(null); // Go back to selection
      }
    } else {
      // In selection mode
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
      }
      if (key.return) {
        setConfirming(options[selectedIndex]!);
      }
      if (input === "q" || key.escape) {
        onCancel();
      }
    }
  });

  if (confirming) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">{confirmMessage(confirming)}</Text>
        <Box marginTop={1}>
          <Text dimColor>(y to confirm, n or Esc to go back)</Text>
        </Box>
      </Box>
    );
  }

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

/**
 * Helper to prompt the user to select an item and then confirm.
 * Everything stays in ink - no readline needed.
 */
export async function promptSelectionWithConfirm(
  title: string,
  options: SelectionOption[],
  confirmMessage: (option: SelectionOption) => string
): Promise<string | null> {
  if (options.length === 0) {
    console.log("No items available to select.");
    process.exit(0);
  }

  return new Promise((resolve) => {
    const { unmount } = render(
      <SelectionWithConfirm
        title={title}
        options={options}
        confirmMessage={confirmMessage}
        onConfirm={(option) => {
          unmount();
          resolve(option.id);
        }}
        onCancel={() => {
          unmount();
          resolve(null);
        }}
      />
    );
  });
}
