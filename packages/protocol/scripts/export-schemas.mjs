#!/usr/bin/env node
// 构建期导出协议 JSON Schema，供多语言客户端与 OpenAPI 生成复用。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import * as protocol from '../dist/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(__dirname, '../dist/schemas')
fs.mkdirSync(outDir, { recursive: true })

const SCHEMAS = {
  Project: protocol.ProjectSchema,
  Artifact: protocol.ArtifactSchema,
  Version: protocol.VersionSchema,
  StatePatch: protocol.StatePatchSchema,
  StateStreamSnapshot: protocol.StateStreamSnapshotSchema,
  ReviewRound: protocol.ReviewRoundSchema,
  Feedback: protocol.FeedbackSchema,
  ElementRef: protocol.ElementRefSchema,
  Receipt: protocol.ReceiptSchema,
  EditOp: protocol.EditOpSchema,
  CheckResult: protocol.CheckResultSchema,
  ErrorEnvelope: protocol.ErrorEnvelopeSchema,
  DaemonStatus: protocol.DaemonStatusSchema,
  HealthResponse: protocol.HealthResponseSchema,
  RealtimeServerEvent: protocol.RealtimeServerEventSchema,
  RealtimeClientMessage: protocol.RealtimeClientMessageSchema,
  ShellToSandboxMessage: protocol.ShellToSandboxMessageSchema,
  SandboxToShellMessage: protocol.SandboxToShellMessageSchema,
  ArtifactStorageOperation: protocol.ArtifactStorageOperationSchema,
  ArtifactPublishInput: protocol.ArtifactPublishInputSchema,
  ArtifactPublishOutput: protocol.ArtifactPublishOutputSchema,
  ArtifactUpdateInput: protocol.ArtifactUpdateInputSchema,
  ArtifactUpdateOutput: protocol.ArtifactUpdateOutputSchema,
  ArtifactCheckInput: protocol.ArtifactCheckInputSchema,
  ArtifactCheckOutput: protocol.ArtifactCheckOutputSchema,
  ArtifactSpecInput: protocol.ArtifactSpecInputSchema,
  ArtifactSpecOutput: protocol.ArtifactSpecOutputSchema,
  ArtifactPushStateInput: protocol.ArtifactPushStateInputSchema,
  ArtifactPushStateOutput: protocol.ArtifactPushStateOutputSchema,
  ArtifactGetInput: protocol.ArtifactGetInputSchema,
  ArtifactGetOutput: protocol.ArtifactGetOutputSchema,
  ArtifactReadHandoffInput: protocol.ArtifactReadHandoffInputSchema,
  ArtifactPullFeedbackInput: protocol.ArtifactPullFeedbackInputSchema,
  ArtifactPullFeedbackOutput: protocol.ArtifactPullFeedbackOutputSchema,
  ArtifactAckFeedbackInput: protocol.ArtifactAckFeedbackInputSchema,
  ArtifactAckFeedbackOutput: protocol.ArtifactAckFeedbackOutputSchema,
  ArtifactAwaitFeedbackInput: protocol.ArtifactAwaitFeedbackInputSchema,
  ArtifactAwaitFeedbackOutput: protocol.ArtifactAwaitFeedbackOutputSchema,
  ArtifactRecordVerdictInput: protocol.ArtifactRecordVerdictInputSchema,
  ArtifactRecordVerdictOutput: protocol.ArtifactRecordVerdictOutputSchema,
}

const exported = []
for (const [name, schema] of Object.entries(SCHEMAS)) {
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any' })
  const fileName = `${name}.schema.json`
  fs.writeFileSync(path.join(outDir, fileName), `${JSON.stringify(jsonSchema, null, 2)}\n`)
  exported.push(fileName)
}

fs.writeFileSync(
  path.join(outDir, 'index.json'),
  `${JSON.stringify({ protocolVersion: protocol.PROTOCOL_VERSION, schemas: exported }, null, 2)}\n`,
)
console.log(`已导出 ${exported.length} 份 JSON Schema 至 dist/schemas/`)
