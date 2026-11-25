/** 浏览器的解码与字体 API 不接受 signal；取消后不继续排版或保留捕捉监听。 */
export async function waitForCaptureStep<T>(work: Promise<T>, signal?: AbortSignal) {
  if (!signal) return work
  signal.throwIfAborted()
  const stopped = Promise.withResolvers<never>()
  const abort = () => stopped.reject(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  try {
    return await Promise.race([work, stopped.promise])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

/** 两个动画帧给 Tailwind 提交样式；待本次排版使用的字体和图片就绪后再克隆。 */
export async function waitForCaptureResources(root: HTMLElement, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (!root.firstElementChild) throw new Error('画板尚未渲染，不能生成 PNG')
  await waitForCaptureStep(root.ownerDocument.fonts.ready, signal)
  signal?.throwIfAborted()
  const painted = Promise.withResolvers<void>()
  requestAnimationFrame(() => requestAnimationFrame(() => painted.resolve()))
  await waitForCaptureStep(painted.promise, signal)
  signal?.throwIfAborted()
  try {
    const images = [...root.querySelectorAll('img')].map((image) => image.decode())
    await waitForCaptureStep(Promise.all(images), signal)
  } catch (cause) {
    signal?.throwIfAborted()
    throw new Error('画板中有无法加载或解码的图片', { cause })
  }
  await waitForCaptureStep(root.ownerDocument.fonts.ready, signal)
  signal?.throwIfAborted()
}
