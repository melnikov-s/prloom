/**
 * Build plan markdown for tests with optional overrides.
 */
export function buildPlanContent(options: {
  title: string;
  summary?: string | string[];
  objective?: string;
  context?: string;
  scope?: string;
  successCriteria?: string | string[];
  constraints?: string;
  assumptions?: string;
  architectureNotes?: string;
  decisionLog?: string | string[];
  implementationNotes?: string;
  planSpecificChecks?: string;
  reviewFocus?: string;
  openQuestions?: string;
  todos: string[];
  progressLog?: string;
}): string {
  const section = (heading: string, body?: string | string[]) => {
    if (body === undefined) return "";
    const content = Array.isArray(body) ? body.join("\n") : body;
    return `## ${heading}\n\n${content}\n\n`;
  };

  const summary = options.summary ?? "-";
  const objective = options.objective ?? "None";
  const context = options.context ?? "None";
  const scope = options.scope ?? "In: none\nOut: none";
  const successCriteria = options.successCriteria ?? "None";
  const constraints = options.constraints ?? "None";
  const assumptions = options.assumptions ?? "None";
  const architectureNotes = options.architectureNotes ?? "None";
  const decisionLog = options.decisionLog ?? "None";
  const implementationNotes = options.implementationNotes ?? "None";
  const planSpecificChecks = options.planSpecificChecks ?? "None";
  const reviewFocus = options.reviewFocus ?? "None";
  const openQuestions = options.openQuestions ?? "None";

  const todoLines = options.todos.map((todo) => {
    if (todo.startsWith("- [")) return todo;
    return `- [ ] ${todo}`;
  }).join("\n");

  const body = (
    `## Title\n\n${options.title}\n\n` +
    section("Plan Summary", summary) +
    section("Objective", objective) +
    section("Context", context) +
    section("Scope (In/Out)", scope) +
    section("Success Criteria", successCriteria) +
    section("Constraints", constraints) +
    section("Assumptions", assumptions) +
    section("Architecture Notes", architectureNotes) +
    section("Decision Log", decisionLog) +
    section("Implementation Notes", implementationNotes) +
    section("Plan-Specific Checks", planSpecificChecks) +
    section("Review Focus", reviewFocus) +
    section("Open Questions", openQuestions) +
    `## TODO\n\n${todoLines}\n`
  );

  if (options.progressLog) {
    return body + `\n## Progress Log\n\n${options.progressLog}\n`;
  }

  return body + `\n## Progress Log\n`;
}
