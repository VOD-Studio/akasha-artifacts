export function ParseErrorCard({ typeLabel, error }: { typeLabel: string; error: string }) {
  return (
    <div
      role="alert"
      data-ak-renderer="kit-error"
      className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-semibold">{typeLabel} 模板解析失败</p>
      <p className="mt-1 font-mono text-xs">{error}</p>
    </div>
  )
}
