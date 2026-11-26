/** 只读取调用方选定的单个文件；二进制返回不含 data URL 前缀的标准 base64。 */
export function readContent(file: File, binary: boolean): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => {
    const value = String(reader.result)
    resolve(binary ? value.slice(value.indexOf(',') + 1) : value)
  }
  if (binary) reader.readAsDataURL(file)
  else reader.readAsText(file)
  return promise
}
