import type { PublicId } from '@akasha/protocol'
import type { WorkspaceComponent } from '../../domain/ports.js'
import type { SqlStatement } from './cloud/types.js'

/** 只保存作者显式回传的入口；预览接口和版本历史列表不读取工程源文件。 */
export const workspaceComponentTable = `CREATE TABLE IF NOT EXISTS workspace_components (
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  path TEXT NOT NULL,
  export_name TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (artifact_id, version),
  FOREIGN KEY (artifact_id, version) REFERENCES versions (artifact_id, version) ON DELETE CASCADE
)`

export const selectWorkspaceComponent = `SELECT path, export_name AS "exportName", source
  FROM workspace_components WHERE artifact_id = ? AND version = ?`

export function insertWorkspaceComponent(
  id: PublicId,
  version: number,
  entry: WorkspaceComponent,
): SqlStatement {
  return [
    'INSERT INTO workspace_components (artifact_id, version, path, export_name, source) VALUES (?, ?, ?, ?, ?)',
    id,
    version,
    entry.path,
    entry.exportName,
    entry.source,
  ]
}
