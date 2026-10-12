import type { ToolSet } from 'ai'
import type { ToolExecutionContext } from '../core/types.ts'
import { createAskUserTool } from './AskUserTool/AskUserTool.ts'
import { createBashTool } from './BashTool/BashTool.ts'
import { createDeleteFileTool } from './DeleteFileTool/DeleteFileTool.ts'
import { createEditFileTool } from './EditFileTool/EditFileTool.ts'
import { createGrepTool } from './GrepTool/GrepTool.ts'
import { createListDirTool } from './ListDirTool/ListDirTool.ts'
import { createReadFileTool } from './ReadFileTool/ReadFileTool.ts'
import { createWriteFileTool } from './WriteFileTool/WriteFileTool.ts'

export function buildTools(context: ToolExecutionContext): ToolSet {
  const tools: ToolSet = {
    // AskUser is always exposed
    AskUser: createAskUserTool(context),
  }

  // Read tools (requires fs.read)
  if (context.grants.has('fs.read')) {
    tools.ReadFile = createReadFileTool(context)
    tools.ListDir = createListDirTool(context)
    tools.Grep = createGrepTool(context)
  }

  // Write tools (requires fs.write)
  if (context.grants.has('fs.write')) {
    tools.WriteFile = createWriteFileTool(context)
    tools.EditFile = createEditFileTool(context)
    tools.DeleteFile = createDeleteFileTool(context)
  }

  // Shell tools (requires shell.run)
  if (context.grants.has('shell.run')) {
    tools.Bash = createBashTool(context)
  }

  return tools
}
