# Epic 22: Emergent Workflow Composition (NIP-XX5)

## Executive Summary

Epic 22 implements NIP-XX5 (Emergent Workflow Composition), defining how agents compose multi-step workflows dynamically. Rather than hardcoding workflows, agents can define, share, and execute declarative workflow definitions that orchestrate multiple agents in sequence or parallel. This enables complex task pipelines like data processing, multi-modal transformations, approval workflows, and conditional branching.

This epic is **LOW** priority as it builds advanced orchestration capabilities on top of the foundational agent communication patterns.

## Architecture

### Workflow Composition Pattern

```
Workflow Definition (Kind 30920)
├─ Steps: [translate, summarize, format]
├─ Edges: translate→summarize→format
├─ Inputs: text, target_lang
└─ Outputs: formatted

Workflow Execution Request (Kind 5920)
├─ References workflow definition
├─ Provides input values
├─ Sets total budget
└─ Sets timeout

Orchestrator Agent
├─ Parses workflow definition
├─ Topologically sorts steps
├─ For each ready step:
│   ├─ Resolves input mappings
│   ├─ Discovers capable agent
│   ├─ Delegates task (NIP-XX2)
│   └─ Records result in context
├─ Evaluates edge conditions
├─ Publishes status updates (Kind 7920)
└─ Returns final output
```

### Event Kinds

| Kind  | Purpose                    | Type        |
| ----- | -------------------------- | ----------- |
| 30920 | Workflow Definition        | Addressable |
| 5920  | Workflow Execution Request | Regular     |
| 6920  | Workflow Step Result       | Regular     |
| 7920  | Workflow Status            | Regular     |

### Workflow Structure

```json
{
  "kind": 30920,
  "tags": [
    ["d", "translate-and-summarize-v1"],
    ["name", "Translate and Summarize"],
    ["version", "1.0.0"],
    ["step", "translate", "5100", "input:$input.text", "output:translated"],
    ["step", "summarize", "5200", "input:$translated", "output:summary"],
    ["edge", "translate", "summarize", "always"],
    ["input", "text", "string", "true"],
    ["output", "summary", "string"]
  ],
  "content": "Translate input text and summarize the result"
}
```

## Package Structure

```
packages/connector/src/agent/
├── workflow/
│   ├── index.ts
│   ├── definition.ts            # Parse Kind 30920
│   ├── execution.ts             # Parse Kind 5920
│   ├── step-result.ts           # Parse Kind 6920
│   ├── status.ts                # Parse Kind 7920
│   ├── orchestrator.ts          # Execute workflows
│   ├── context.ts               # Workflow context/state
│   ├── edge-evaluator.ts        # Evaluate edge conditions
│   └── types.ts
├── ai/skills/
│   ├── define-workflow-skill.ts
│   ├── execute-workflow-skill.ts
│   └── ...
└── __tests__/
    └── workflow/
        ├── definition.test.ts
        ├── orchestrator.test.ts
        └── workflow-integration.test.ts
```

## Configuration

```yaml
agent:
  workflow:
    enabled: true
    maxSteps: 20 # Max steps per workflow
    maxConcurrentWorkflows: 5 # Parallel workflow executions
    defaultTimeout: 300 # 5 minute default
    budgetEnforcement: true # Strict budget limits
    publishDefinitions: true # Share workflow definitions
```

## Stories

| Story | Description                             | Status      |
| ----- | --------------------------------------- | ----------- |
| 22.1  | Workflow Types & Schemas                | Not Started |
| 22.2  | Workflow Definition Parser (Kind 30920) | Not Started |
| 22.3  | Workflow Execution Request (Kind 5920)  | Not Started |
| 22.4  | Step Execution Engine                   | Not Started |
| 22.5  | Edge Condition Evaluation               | Not Started |
| 22.6  | Context & Input Mapping                 | Not Started |
| 22.7  | Error Handling Policies                 | Not Started |
| 22.8  | Workflow Budget Management              | Not Started |
| 22.9  | define_workflow Skill                   | Not Started |
| 22.10 | execute_workflow Skill                  | Not Started |
| 22.11 | Workflow Status Tracking (Kind 7920)    | Not Started |
| 22.12 | Integration Tests                       | Not Started |

---

## Story 22.1: Workflow Types & Schemas

### Description

Define TypeScript types and schemas for workflow events.

### Acceptance Criteria

1. `WorkflowDefinition` interface with steps and edges
2. `WorkflowStep` interface with kind, inputs, outputs
3. `WorkflowEdge` interface with conditions
4. `WorkflowExecution` interface for execution state
5. `WorkflowContext` for runtime variable storage
6. Zod schemas for validation
7. JSONPath expression types

### Technical Notes

```typescript
interface WorkflowStep {
  id: string; // Unique step ID
  agentKind: number; // Event kind for task (e.g., 5100)
  inputMapping: InputMapping[]; // How to populate inputs
  outputName: string; // Name to store result
  timeout?: number; // Step-specific timeout
  errorPolicy?: 'retry' | 'skip' | 'abort';
  maxRetries?: number;
}

interface InputMapping {
  paramName: string;
  source: string; // JSONPath expression (e.g., "$input.text", "$translated")
}

interface WorkflowEdge {
  from: string; // Step ID
  to: string; // Step ID
  condition: string; // "always" or JSONPath condition
}

interface WorkflowDefinition {
  kind: 30920;
  id: string; // d tag
  name: string;
  version: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  inputs: WorkflowInput[];
  outputs: WorkflowOutput[];
  content: string;
  event: NostrEvent;
}

interface WorkflowInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required: boolean;
}

interface WorkflowOutput {
  name: string;
  type: string;
}

interface WorkflowExecution {
  kind: 5920;
  workflowId: string;
  executionId: string; // d tag
  inputs: Map<string, any>;
  budget: bigint;
  timeout: number;
  event: NostrEvent;
}

interface WorkflowContext {
  executionId: string;
  inputs: Map<string, any>;
  stepResults: Map<string, any>;
  budget: { total: bigint; spent: bigint };
  startTime: number;
}
```

---

## Story 22.2: Workflow Definition Parser (Kind 30920)

### Description

Implement parsing of workflow definition events.

### Acceptance Criteria

1. Parse `d`, `name`, `version` tags
2. Parse `step` tags into WorkflowStep[]
3. Parse `edge` tags into WorkflowEdge[]
4. Parse `input` and `output` tags
5. Validate step IDs are unique
6. Validate edges reference valid steps
7. Validate no orphan steps
8. Validate no cycles (DAG requirement)
9. Return typed `WorkflowDefinition`

### Technical Notes

```typescript
class WorkflowDefinitionParser {
  parse(event: NostrEvent): WorkflowDefinition {
    this.validateKind(event, 30920);

    const id = this.getRequiredTag(event.tags, 'd');
    const name = this.getRequiredTag(event.tags, 'name');
    const version = this.getTagValue(event.tags, 'version') ?? '1.0.0';

    const steps = this.parseSteps(event.tags);
    const edges = this.parseEdges(event.tags);

    this.validateUniqueStepIds(steps);
    this.validateEdgesReferenceSteps(edges, steps);
    this.validateNoOrphanSteps(steps, edges);
    this.validateNoCycles(steps, edges);

    return {
      kind: 30920,
      id,
      name,
      version,
      steps,
      edges,
      inputs: this.parseInputs(event.tags),
      outputs: this.parseOutputs(event.tags),
      content: event.content,
      event,
    };
  }

  private parseSteps(tags: string[][]): WorkflowStep[] {
    return tags
      .filter((t) => t[0] === 'step')
      .map((t) => ({
        id: t[1],
        agentKind: parseInt(t[2]),
        inputMapping: this.parseInputMapping(t[3]),
        outputName: t[4].replace('output:', ''),
      }));
  }

  private validateNoCycles(steps: WorkflowStep[], edges: WorkflowEdge[]): void {
    // Topological sort - if it fails, there's a cycle
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const step of steps) {
      inDegree.set(step.id, 0);
      adjacency.set(step.id, []);
    }

    for (const edge of edges) {
      adjacency.get(edge.from)!.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }

    const queue = steps.filter((s) => inDegree.get(s.id) === 0).map((s) => s.id);
    let processed = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      processed++;

      for (const next of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(next) ?? 0) - 1;
        inDegree.set(next, newDegree);
        if (newDegree === 0) queue.push(next);
      }
    }

    if (processed !== steps.length) {
      throw new WorkflowCycleError('Workflow contains a cycle');
    }
  }
}
```

---

## Story 22.3: Workflow Execution Request (Kind 5920)

### Description

Implement workflow execution request parsing and creation.

### Acceptance Criteria

1. Parse Kind 5920 events
2. Reference workflow via `e` tag
3. Unique execution ID via `d` tag
4. Parse `input` tags for input values
5. Parse `bid` tag for total budget
6. Parse `timeout` tag
7. Create execution requests programmatically
8. Validate inputs match workflow definition

### Technical Notes

```typescript
interface CreateWorkflowExecutionParams {
  workflow: WorkflowDefinition;
  inputs: Map<string, any>;
  budget: bigint;
  timeout?: number;
}

class WorkflowExecutionParser {
  parse(event: NostrEvent): WorkflowExecution {
    this.validateKind(event, 5920);

    const workflowEventId = this.getETag(event.tags, 'workflow');
    const executionId = this.getRequiredTag(event.tags, 'd');
    const inputs = this.parseInputTags(event.tags);
    const budget = this.parseBid(event.tags);
    const timeout = this.parseTimeout(event.tags);

    return {
      kind: 5920,
      workflowId: workflowEventId,
      executionId,
      inputs,
      budget,
      timeout,
      event,
    };
  }

  create(params: CreateWorkflowExecutionParams): NostrEvent {
    const executionId = this.generateExecutionId();

    const tags = [
      ['e', params.workflow.event.id, '', 'workflow'],
      ['d', executionId],
      ['bid', params.budget.toString()],
      ['timeout', (params.timeout ?? 300).toString()],
    ];

    for (const [name, value] of params.inputs) {
      tags.push(['input', name, JSON.stringify(value)]);
    }

    return this.signer.createSignedEvent(5920, tags, '');
  }
}
```

---

## Story 22.4: Step Execution Engine

### Description

Implement the core workflow step execution engine.

### Acceptance Criteria

1. Topologically sort steps by edges
2. Execute steps in dependency order
3. Support parallel execution of independent steps
4. Delegate each step via NIP-XX2 task delegation
5. Discover capable agent for each step's kind
6. Record step results in workflow context
7. Handle step timeouts
8. Track execution metrics (time, cost)

### Technical Notes

```typescript
class WorkflowOrchestrator {
  async execute(
    workflow: WorkflowDefinition,
    execution: WorkflowExecution
  ): Promise<WorkflowResult> {
    const context = this.createContext(workflow, execution);
    const sortedSteps = this.topologicalSort(workflow);
    const completedSteps = new Set<string>();
    const stepResults: WorkflowStepResult[] = [];

    while (completedSteps.size < sortedSteps.length) {
      // Find ready steps (all dependencies completed)
      const readySteps = sortedSteps.filter(
        (step) =>
          !completedSteps.has(step.id) && this.dependenciesMet(step, workflow.edges, completedSteps)
      );

      if (readySteps.length === 0) {
        throw new WorkflowDeadlockError('No ready steps');
      }

      // Execute ready steps in parallel
      const results = await Promise.all(
        readySteps.map((step) => this.executeStep(step, context, workflow))
      );

      for (const result of results) {
        completedSteps.add(result.stepId);
        context.stepResults.set(result.outputName, result.content);
        context.budget.spent += result.cost;
        stepResults.push(result);

        await this.publishStepResult(execution, result);
      }

      // Check budget
      if (context.budget.spent > context.budget.total) {
        throw new BudgetExhaustedError();
      }
    }

    return this.createWorkflowResult(workflow, execution, stepResults, context);
  }

  private async executeStep(
    step: WorkflowStep,
    context: WorkflowContext,
    workflow: WorkflowDefinition
  ): Promise<WorkflowStepResult> {
    // Resolve inputs from context
    const inputs = this.resolveInputs(step.inputMapping, context);

    // Discover capable agent
    const agent = await this.discovery.discoverForKind(step.agentKind);
    if (!agent) {
      throw new NoCapableAgentError(step.agentKind);
    }

    // Delegate task
    const startTime = Date.now();
    const result = await this.taskDelegator.delegate(
      {
        content: JSON.stringify(inputs),
        targetKind: step.agentKind,
        bid: this.calculateStepBudget(step, context),
        timeout: step.timeout ?? 30,
      },
      agent.ilpAddress
    );

    return {
      stepId: step.id,
      outputName: step.outputName,
      content: result.content,
      status: result.status,
      cost: result.amount,
      runtime: Date.now() - startTime,
      agentPubkey: agent.pubkey,
    };
  }
}
```

---

## Story 22.5: Edge Condition Evaluation

### Description

Implement edge condition evaluation for conditional workflows.

### Acceptance Criteria

1. Support "always" condition (unconditional)
2. Support JSONPath expressions for conditions
3. Evaluate conditions against workflow context
4. Boolean result determines if edge is traversed
5. Support comparison operators (==, !=, <, >, etc.)
6. Support logical operators (&&, ||, !)
7. Handle missing values gracefully

### Technical Notes

```typescript
class EdgeEvaluator {
  evaluate(condition: string, context: WorkflowContext): boolean {
    if (condition === 'always') {
      return true;
    }

    // Parse and evaluate JSONPath expression
    // e.g., "$.validation.passed == true"
    try {
      const result = this.evaluateExpression(condition, {
        input: Object.fromEntries(context.inputs),
        ...Object.fromEntries(context.stepResults),
      });
      return Boolean(result);
    } catch (error) {
      this.logger.warn('Edge condition evaluation failed', { condition, error });
      return false;
    }
  }

  private evaluateExpression(expr: string, data: any): any {
    // Parse expression: "$path.to.value == expected"
    const match = expr.match(/^\$(.+?)\s*(==|!=|<|>|<=|>=)\s*(.+)$/);
    if (!match) {
      // Simple JSONPath without comparison - check truthiness
      return jsonpath.value(data, expr);
    }

    const [, path, operator, expected] = match;
    const actual = jsonpath.value(data, `$.${path}`);
    const expectedValue = this.parseValue(expected.trim());

    switch (operator) {
      case '==':
        return actual === expectedValue;
      case '!=':
        return actual !== expectedValue;
      case '<':
        return actual < expectedValue;
      case '>':
        return actual > expectedValue;
      case '<=':
        return actual <= expectedValue;
      case '>=':
        return actual >= expectedValue;
      default:
        return false;
    }
  }
}
```

---

## Story 22.6: Context & Input Mapping

### Description

Implement workflow context management and input mapping resolution.

### Acceptance Criteria

1. Initialize context with execution inputs
2. Store step outputs in context
3. Resolve input mappings from context
4. Support JSONPath references ($input.text, $translated)
5. Support literal values
6. Support nested object access
7. Type coercion where needed

### Technical Notes

```typescript
class WorkflowContextManager {
  private context: WorkflowContext;

  initialize(execution: WorkflowExecution): void {
    this.context = {
      executionId: execution.executionId,
      inputs: new Map(execution.inputs),
      stepResults: new Map(),
      budget: { total: execution.budget, spent: 0n },
      startTime: Date.now(),
    };
  }

  resolveInputs(mappings: InputMapping[]): Map<string, any> {
    const resolved = new Map<string, any>();

    for (const mapping of mappings) {
      const value = this.resolveValue(mapping.source);
      resolved.set(mapping.paramName, value);
    }

    return resolved;
  }

  private resolveValue(source: string): any {
    if (!source.startsWith('$')) {
      // Literal value
      return this.parseValue(source);
    }

    const path = source.substring(1); // Remove $

    if (path.startsWith('input.')) {
      const inputName = path.substring(6);
      return this.context.inputs.get(inputName);
    }

    // Reference to step output
    const parts = path.split('.');
    let value = this.context.stepResults.get(parts[0]);

    // Navigate nested path
    for (let i = 1; i < parts.length && value != null; i++) {
      value = value[parts[i]];
    }

    return value;
  }

  storeStepResult(outputName: string, value: any): void {
    this.context.stepResults.set(outputName, value);
  }
}
```

---

## Story 22.7: Error Handling Policies

### Description

Implement configurable error handling for workflow steps.

### Acceptance Criteria

1. Support `retry` policy (retry with same or different agent)
2. Support `skip` policy (continue workflow, mark step skipped)
3. Support `abort` policy (stop workflow, return partial)
4. Configurable per-step error policies
5. Configurable max retries
6. Exponential backoff between retries
7. Log errors with context

### Technical Notes

```typescript
type ErrorPolicy = 'retry' | 'skip' | 'abort';

interface ErrorConfig {
  policy: ErrorPolicy;
  maxRetries: number;
  backoffMs: number;
}

class StepErrorHandler {
  async handleError(
    step: WorkflowStep,
    error: Error,
    context: WorkflowContext,
    attempt: number
  ): Promise<ErrorHandlerResult> {
    const policy = step.errorPolicy ?? 'abort';
    const maxRetries = step.maxRetries ?? 3;

    this.logger.error('Step execution failed', {
      stepId: step.id,
      attempt,
      error: error.message,
      policy,
    });

    switch (policy) {
      case 'retry':
        if (attempt < maxRetries) {
          await this.sleep(this.backoffMs(attempt));
          return { action: 'retry', attempt: attempt + 1 };
        }
        return { action: 'abort', reason: `Max retries (${maxRetries}) exceeded` };

      case 'skip':
        return {
          action: 'skip',
          result: {
            stepId: step.id,
            outputName: step.outputName,
            content: null,
            status: 'skipped',
            cost: 0n,
            runtime: 0,
            error: error.message,
          },
        };

      case 'abort':
      default:
        return { action: 'abort', reason: error.message };
    }
  }

  private backoffMs(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 30000);
  }
}
```

---

## Story 22.8: Workflow Budget Management

### Description

Implement budget tracking and enforcement for workflow execution.

### Acceptance Criteria

1. Track total budget from execution request
2. Track spent budget as steps complete
3. Allocate per-step budgets
4. Fail workflow when budget exhausted
5. Return remaining budget on completion
6. Support budget caps per step
7. Log budget utilization

### Technical Notes

```typescript
class WorkflowBudgetManager {
  private budget: { total: bigint; spent: bigint; reserved: bigint };

  initialize(totalBudget: bigint): void {
    this.budget = { total: totalBudget, spent: 0n, reserved: 0n };
  }

  allocateForStep(step: WorkflowStep, workflow: WorkflowDefinition): bigint {
    const remainingSteps = this.countRemainingSteps(workflow);
    const available = this.budget.total - this.budget.spent - this.budget.reserved;

    // Allocate proportionally, with cap if specified
    let allocation = available / BigInt(remainingSteps);

    if (step.maxBudget) {
      allocation = allocation > step.maxBudget ? step.maxBudget : allocation;
    }

    this.budget.reserved += allocation;
    return allocation;
  }

  recordSpend(stepId: string, amount: bigint): void {
    this.budget.spent += amount;
    this.budget.reserved -= amount;

    if (this.budget.spent > this.budget.total) {
      throw new BudgetExhaustedError(
        `Workflow budget exhausted: spent ${this.budget.spent}, total ${this.budget.total}`
      );
    }
  }

  getRemainingBudget(): bigint {
    return this.budget.total - this.budget.spent;
  }
}
```

---

## Story 22.9: define_workflow Skill

### Description

Create AI skill enabling agents to define workflows.

### Acceptance Criteria

1. Skill registered as `define_workflow`
2. Parameters: name, steps, edges, inputs, outputs
3. Validates workflow structure
4. Creates and publishes Kind 30920
5. Returns workflow ID for reference
6. Supports workflow versioning

### Technical Notes

```typescript
const defineWorkflowSkill: AgentSkill<typeof schema> = {
  name: 'define_workflow',
  description: 'Define a new workflow with multiple steps',
  parameters: z.object({
    name: z.string().describe('Human-readable workflow name'),
    version: z.string().optional().describe('Semantic version'),
    steps: z
      .array(
        z.object({
          id: z.string(),
          agentKind: z.number(),
          inputMapping: z.string(),
          outputName: z.string(),
        })
      )
      .describe('Workflow steps'),
    edges: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          condition: z.string(),
        })
      )
      .describe('Step connections'),
    inputs: z
      .array(
        z.object({
          name: z.string(),
          type: z.string(),
          required: z.boolean(),
        })
      )
      .describe('Workflow inputs'),
    description: z.string().optional(),
  }),
  execute: async (params, context) => {
    const definition = await context.workflow.createDefinition({
      name: params.name,
      version: params.version ?? '1.0.0',
      steps: params.steps,
      edges: params.edges,
      inputs: params.inputs,
      outputs: this.inferOutputs(params.steps),
      description: params.description ?? '',
    });

    return {
      workflowId: definition.id,
      eventId: definition.event.id,
      version: definition.version,
      stepCount: params.steps.length,
    };
  },
};
```

---

## Story 22.10: execute_workflow Skill

### Description

Create AI skill enabling agents to execute workflows.

### Acceptance Criteria

1. Skill registered as `execute_workflow`
2. Parameters: workflowId, inputs, budget, timeout
3. Fetches workflow definition
4. Validates inputs match definition
5. Executes workflow orchestration
6. Returns final outputs and metrics
7. Supports async execution with status polling

### Technical Notes

```typescript
const executeWorkflowSkill: AgentSkill<typeof schema> = {
  name: 'execute_workflow',
  description: 'Execute a defined workflow with provided inputs',
  parameters: z.object({
    workflowId: z.string().describe('Workflow definition ID (d-tag)'),
    inputs: z.record(z.any()).describe('Input values for the workflow'),
    budget: z.number().describe('Total budget in msats'),
    timeout: z.number().optional().describe('Total timeout in seconds'),
  }),
  execute: async (params, context) => {
    const workflow = await context.workflow.getDefinition(params.workflowId);
    if (!workflow) {
      throw new WorkflowNotFoundError(params.workflowId);
    }

    // Validate inputs
    context.workflow.validateInputs(workflow, params.inputs);

    // Execute
    const result = await context.workflow.execute(workflow, {
      inputs: new Map(Object.entries(params.inputs)),
      budget: BigInt(params.budget),
      timeout: params.timeout ?? 300,
    });

    return {
      executionId: result.executionId,
      status: result.status,
      outputs: result.outputs,
      stepsCompleted: result.stepsCompleted,
      totalCost: Number(result.totalCost),
      runtime: result.runtime,
    };
  },
};
```

---

## Story 22.11: Workflow Status Tracking (Kind 7920)

### Description

Implement workflow execution status events.

### Acceptance Criteria

1. Create Kind 7920 for workflow status updates
2. Status values: running, completed, failed, cancelled
3. Include execution ID reference
4. Include progress (completed/total steps)
5. Include current step ID
6. Include total cost so far
7. Publish on status changes
8. Enable status subscription

### Technical Notes

```typescript
interface WorkflowStatusUpdate {
  executionId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: { completed: number; total: number };
  currentStep?: string;
  cost: bigint;
  message?: string;
}

class WorkflowStatusPublisher {
  async publish(update: WorkflowStatusUpdate): Promise<NostrEvent> {
    const tags = [
      ['e', update.executionId, '', 'execution'],
      ['status', update.status],
      ['progress', update.progress.completed.toString(), update.progress.total.toString()],
      ['cost', update.cost.toString()],
    ];

    if (update.currentStep) {
      tags.push(['step', update.currentStep]);
    }

    const event = this.signer.createSignedEvent(7920, tags, update.message ?? '');
    await this.store.saveEvent(event);
    return event;
  }
}
```

---

## Story 22.12: Integration Tests

### Description

Comprehensive integration tests for workflow composition.

### Acceptance Criteria

1. Test linear workflow execution
2. Test parallel step execution
3. Test conditional branching
4. Test error handling policies
5. Test budget enforcement
6. Test timeout handling
7. Test workflow definition validation
8. Test with real agent delegation

---

## Dependencies

- **Epic 16** (AI Agent Node) — Skills
- **Epic 17** (NIP-90 DVM) — Task patterns
- **Epic 18** (Capability Discovery) — Agent discovery for steps
- **Epic 19** (Task Delegation) — Step execution

## Risk Mitigation

| Risk                          | Mitigation                     |
| ----------------------------- | ------------------------------ |
| Workflow complexity explosion | Max step limits, validation    |
| Cascading failures            | Error policies, step isolation |
| Budget overruns               | Strict enforcement, allocation |
| Deadlocks                     | Cycle detection, timeouts      |

## Success Metrics

- Workflow completion rate > 95%
- Average step overhead < 100ms
- Budget utilization within 10% of allocation
- Zero undetected cycles in definitions
