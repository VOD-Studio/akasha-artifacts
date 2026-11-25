/** 显式留在 Hub；地址只选择工作区来源，不携带凭据或授予作品权限。 */
export function hubArtifactPath(publicId: string): string {
  return `/a/${encodeURIComponent(publicId)}?shared=1`
}
