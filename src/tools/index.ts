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
import { createMcpTool } from './McpTool/McpTool.ts'


export function buildTools(context: ToolExecutionContext, settings?: Settings): ToolSet {
  const tools: ToolSet = {}

  const isExposed = (toolName: ToolName): boolean => {
    if (!context.effectivePermissions.exposedTools.includes(toolName)) {
      return false
    }
    return settings?.tools?.[toolName]?.enabled ?? true
  }

  // File read/search tools
  if (isExposed('ReadFile')) tools.ReadFile = createReadFileTool(context)
  if (isExposed('ListDir')) tools.ListDir = createListDirTool(context)
  if (isExposed('Grep')) tools.Grep = createGrepTool(context)

  // File write/edit tools
  if (isExposed('WriteFile')) tools.WriteFile = createWriteFileTool(context)
  if (isExposed('EditFile')) tools.EditFile = createEditFileTool(context)
  if (isExposed('DeleteFile')) tools.DeleteFile = createDeleteFileTool(context)

  // Shell tools
  if (isExposed('Bash')) tools.Bash = createBashTool(context)
  if (isExposed('TaskManager') && context.tasks) tools.TaskManager = createTaskManagerTool(context)

  // Web tools (public informational web access)
  if (isExposed('WebSearch')) tools.WebSearch = createWebSearchTool(context)
  if (isExposed('WebFetch')) tools.WebFetch = createWebFetchTool(context)

  // MCP meta-tool
  if (isExposed('McpTool')) tools.McpTool = createMcpTool(context)

  return tools
}
