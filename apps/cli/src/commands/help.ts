// Help command — displays all available commands

export function showHelp(): void {
  console.log(`
sourcerer — AI-powered talent sourcing agent

Usage: sourcerer <command> [options]

Commands:
  init          Set up Sourcerer (API keys, adapters)
  config        View and manage configuration
  intake        Run the intake conversation
  run           Execute a full pipeline run
  discover      Run discovery phase only
  enrich        Run enrichment phase only
  score         Run scoring phase only
  results       View results from last run
  runs          List previous runs
  candidates    Manage candidate data

Options:
  --help, -h     Show this help message
  --version, -v  Show version number

Run sourcerer <command> --help for command-specific help.
`.trim());
}

export function showVersion(): void {
  console.log('sourcerer 0.0.0');
}

export function showUnknownCommand(command: string): void {
  console.error(`Unknown command: ${command}`);
  console.error('Run sourcerer --help to see available commands.');
  process.exitCode = 1;
}
