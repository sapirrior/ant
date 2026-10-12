import type { ToolSet } from 'ai'
import type { ToolExecutionContext, ToolName } from '../core/types.ts'
import type { Settings } from '../settings.ts'
import { createBashTool } from './BashTool/BashTool.ts'
import { createDeleteFileTool } from './DeleteFileTool/DeleteFileTool.ts'
import { createEditFileTool } from './EditFileTool/EditFileTool.ts'
import { createGrepTool } from './GrepTool/GrepTool.ts'
import { createListDirTool } from './ListDirTool/ListDirTool.ts'
import { createReadFileTool } from './ReadFileTool/ReadFileTool.ts'
import { createWriteFileTool } from './WriteFileTool/WriteFileTool.ts'
import { createTaskManagerTool } from './TaskManagerTool/TaskManagerTool.ts'
import { createWebSearchTool } from './WebSearchTool/WebSearchTool.ts'
import { createWebFetchTool } from './WebFetchTool/WebFetchTool.ts'

export interface ToolDef {
  name: ToolName
  create(ctx: ToolExecutionContext): import('ai').Tool
}

export function buildTools(context: ToolExecutionContext, settings?: Settings): ToolSet {
  const tools: ToolSet = {}

  const isEnabled = (toolName: ToolName): boolean => {
    return settings?.tools?.[toolName]?.enabled ?? true
  }

  // Read tools (requires fs.read)
  if (context.grants.has('fs.read')) {
    if (isEnabled('ReadFile')) tools.ReadFile = createReadFileTool(context)
    if (isEnabled('ListDir')) tools.ListDir = createListDirTool(context)
    if (isEnabled('Grep')) tools.Grep = createGrepTool(context)
  }

  // Write tools (requires fs.write)
  if (context.grants.has('fs.write')) {
    if (isEnabled('WriteFile')) tools.WriteFile = createWriteFileTool(context)
    if (isEnabled('EditFile')) tools.EditFile = createEditFileTool(context)
    if (isEnabled('DeleteFile')) tools.DeleteFile = createDeleteFileTool(context)
  }

  // Shell tools (requires shell.run)
  const bashGranted = context.grants.has('shell.run') && isEnabled('Bash')
  if (bashGranted) {
    tools.Bash = createBashTool(context)
    // TaskManager only exposed if Bash is also enabled and exposed (Plan §8.7 coupling)
    if (isEnabled('TaskManager') && context.tasks) {
      tools.TaskManager = createTaskManagerTool(context)
    }
  }

  // Web tools (public informational web access)
  if (isEnabled('WebSearch')) {
    tools.WebSearch = createWebSearchTool(context)
  }
  if (isEnabled('WebFetch')) {
    tools.WebFetch = createWebFetchTool(context)
  }

  return tools
}
