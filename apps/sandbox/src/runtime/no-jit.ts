import { z } from 'zod'

// 必须先于协议和渲染器模块求值：首次解析就会缓存 Zod 的 eval 能力探测结果。
z.config({ jitless: true })
