// Stub commands — print "not yet implemented" for unbuilt commands

const STUB_COMMANDS = [
  'discover',
  'enrich',
  'score',
  'results',
  'runs',
  'candidates',
] as const;

export type StubCommand = (typeof STUB_COMMANDS)[number];

export function isStubCommand(command: string): command is StubCommand {
  return (STUB_COMMANDS as readonly string[]).includes(command);
}

export function runStub(command: string): void {
  console.log(`sourcerer ${command}: not yet implemented`);
}
