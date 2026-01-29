# Claude Credit Burner

An autonomous task execution CLI that processes queued development tasks from Linear using Claude API while you're AFK.

## Features

- **Autonomous Execution**: Fetches tasks from Linear and executes them using Claude API
- **DAG-Based Dependencies**: Handles task dependencies via directed acyclic graph execution
- **Intelligent Rate Limiting**: Token bucket algorithm with exponential backoff
- **State Persistence**: Checkpoint system for crash recovery and session resumption
- **Parallel Execution**: Configurable parallel task processing

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   CLI Controller                            │
│  - Parse arguments                                          │
│  - Initialize components                                    │
│  - Main execution loop                                      │
└──────────┬──────────────────────────────────────────────────┘
           │
           ├──────► MCP Client Manager (Linear integration)
           ├──────► Task Selection Engine (DAG + topological sort)
           ├──────► Task Executor (Claude API)
           ├──────► Rate Limit Manager (token bucket + backoff)
           ├──────► State Manager (checkpoints + recovery)
           └──────► Logger & Metrics
```

## Installation

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- Linear API key
- Anthropic API key

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/claude-credit-burner.git
   cd claude-credit-burner
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Create environment file:
   ```bash
   cp config/.env.example .env
   ```

4. Configure your API keys in `.env`:
   ```env
   LINEAR_API_KEY=lin_api_xxx
   ANTHROPIC_API_KEY=sk-ant-xxx
   LINEAR_TEAM_ID=your-team-id
   ```

## Usage

### Basic Usage

```bash
# Run with team ID
bun run start --team <team-id>

# Dry run (no actual API calls)
bun run start --team <team-id> --dry-run

# Resume from checkpoint
bun run start --team <team-id> --resume latest

# With verbose logging
bun run start --team <team-id> --verbose
```

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --team <id>` | Linear team ID | From env/config |
| `-r, --resume <checkpoint>` | Resume from checkpoint (or 'latest') | - |
| `-d, --dry-run` | Dry run mode (no API calls) | `false` |
| `-p, --max-parallel <n>` | Maximum parallel tasks | `3` |
| `-c, --config <path>` | Path to config file | `config/default.yaml` |
| `-v, --verbose` | Enable verbose logging | `false` |

### Configuration

Create a `config/default.yaml` file:

```yaml
linear:
  mcp_url: "https://mcp.linear.app/mcp"
  team_id: null  # Set via CLI or env

claude:
  model: "claude-sonnet-4-20250514"
  max_tokens: 8000
  temperature: 0.3

execution:
  max_parallel: 3
  checkpoint_interval: 1

rate_limits:
  rpm: 50
  itpm: 40000
  otpm: 8000
  backoff_base: 1.0
  backoff_max: 60.0
  max_retries: 10
```

## Task Dependencies

Tasks can specify dependencies in their descriptions using these patterns:

```
depends on: PROJ-123, PROJ-456
blocked by: PROJ-789
after: PROJ-101
```

The system builds a dependency graph and executes tasks in topological order.

## Development

### Project Structure

```
src/
├── main.ts                 # Entry point, CLI
├── config.ts               # Configuration management
├── types.ts                # TypeScript interfaces
├── core/
│   ├── task-graph.ts       # DAG construction
│   ├── executor.ts         # Claude API execution
│   ├── prompt-builder.ts   # Prompt generation
│   └── validator.ts        # Output validation
├── mcp/
│   ├── client.ts           # MCP client wrapper
│   └── linear-adapter.ts   # Linear operations
├── rate-limit/
│   ├── manager.ts          # Rate limit orchestration
│   ├── token-bucket.ts     # Token bucket algorithm
│   └── backoff.ts          # Exponential backoff
├── state/
│   ├── checkpoint.ts       # State persistence
│   └── recovery.ts         # Crash recovery
└── utils/
    ├── logger.ts           # Structured logging
    └── metrics.ts          # Performance tracking
```

### Scripts

```bash
# Development mode with watch
bun run dev

# Run tests
bun test

# Type checking
bun run typecheck

# Linting
bun run lint

# Formatting
bun run format

# Build
bun run build
```

### Testing

```bash
# Run all tests
bun test

# Watch mode
bun test --watch

# Specific test file
bun test tests/test_task_graph.ts
```

## How It Works

1. **Initialization**: Loads configuration, connects to Linear via MCP
2. **Task Discovery**: Fetches tasks, builds dependency graph
3. **Execution Loop**:
   - Find tasks with satisfied dependencies
   - Check rate limits
   - Execute via Claude API
   - Update Linear status
   - Save checkpoint
4. **Recovery**: On failure, resumes from last checkpoint

## Rate Limiting

The system tracks three rate limits:
- **RPM**: Requests per minute
- **ITPM**: Input tokens per minute
- **OTPM**: Output tokens per minute

When limits are hit, it uses exponential backoff with jitter.

## Checkpoints

Checkpoints are saved after each task completion:

```json
{
  "checkpointId": "2026-01-29T14-30-22",
  "timestamp": "2026-01-29T14:30:22Z",
  "completedTasks": ["PROJ-1", "PROJ-2"],
  "failedTasks": [],
  "totalTokensUsed": 45231,
  "executionTimeMs": 3821000
}
```

## Error Handling

| Error | Action |
|-------|--------|
| 429 Rate Limited | Wait with exponential backoff |
| 529 Overloaded | Exponential backoff |
| Task Validation Failed | Mark failed, continue |
| MCP Connection Lost | Abort execution |
| Unknown Error | Mark task failed, save checkpoint |

## License

MIT
