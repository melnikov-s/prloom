import * as readline from "readline";

interface PromptIO {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

let promptIO: PromptIO | null = null;

export function setPromptIO(io: PromptIO | null): void {
  promptIO = io;
}

function getPromptIO(): PromptIO {
  return promptIO ?? { input: process.stdin, output: process.stdout };
}

function askQuestion(message: string, io: PromptIO): Promise<string> {
  const rl = readline.createInterface({
    input: io.input,
    output: io.output,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Prompt the user for a yes/no confirmation.
 * Returns true for 'y' or 'yes', false otherwise.
 */
export async function confirm(message: string): Promise<boolean> {
  const io = getPromptIO();
  const answer = await askQuestion(`${message} (y/N) `, io);
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

interface PromptTextOptions {
  required?: boolean;
  requiredMessage?: string;
}

export async function promptText(
  message: string,
  options: PromptTextOptions = {}
): Promise<string> {
  const io = getPromptIO();
  const required = options.required ?? false;
  const requiredMessage = options.requiredMessage ?? "Input is required.";

  while (true) {
    const answer = await askQuestion(`${message}: `, io);
    const trimmed = answer.trim();
    if (!required || trimmed) {
      return trimmed;
    }
    io.output.write(`${requiredMessage}\n`);
  }
}
