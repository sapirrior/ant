import type { Capability } from '../types/config.ts'
import type { ToolName } from '../types/tools.ts'

export const TOOL_CAPABILITY_REQUIREMENTS: Readonly<Record<ToolName, Capability | undefined>> = {
  ReadFile: 'fs.read',
  ListDir: 'fs.read',
  Grep: 'fs.read',
  WriteFile: 'fs.write',
  EditFile: 'fs.write',
  DeleteFile: 'fs.write',
  Bash: 'shell.run',
  AskUser: undefined, // Always available
}

export function getRequiredCapabilityForTool(toolName: ToolName): Capability | undefined {
  return TOOL_CAPABILITY_REQUIREMENTS[toolName]
}
