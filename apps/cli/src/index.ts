#!/usr/bin/env node
// @sourcerer/cli — Interactive CLI application

import { showHelp, showVersion, showUnknownCommand } from './commands/help.js';
import { isStubCommand, runStub } from './commands/stubs.js';
import { configStatus } from './commands/config-status.js';
import { configShow } from './commands/config-show.js';
import { runInit } from './commands/init.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // No args or help flag
  if (!command || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  // Version flag
  if (command === '--version' || command === '-v') {
    showVersion();
    return;
  }

  // Config subcommands
  if (command === 'config') {
    const subcommand = args[1];
    if (subcommand === 'status') {
      await configStatus();
      return;
    }
    if (subcommand === 'show') {
      await configShow();
      return;
    }
    if (subcommand === 'reset') {
      await runInit();
      return;
    }
    // Default: show config help
    console.log('Usage: sourcerer config <subcommand>');
    console.log('');
    console.log('Subcommands:');
    console.log('  status    Show adapter connection status');
    console.log('  show      Display current configuration');
    console.log('  reset     Re-run configuration from scratch');
    return;
  }

  // Init command
  if (command === 'init') {
    await runInit();
    return;
  }

  // Stub commands
  if (isStubCommand(command)) {
    runStub(command);
    return;
  }

  // Unknown command
  showUnknownCommand(command);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
