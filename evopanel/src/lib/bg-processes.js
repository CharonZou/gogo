// 后台进程 API 客户端：查询终端后台进程列表，并支持停止指定后台进程（GET/POST /api/bg-processes*）
import { apiUrl } from './api-client.js'

/**
 * 获取后台进程列表（GET /api/bg-processes）
 * @returns {Promise<{ processes: Array }>} 进程列表，元素含 id/command/thread_id/pid/start_time/elapsed_s/running/exited/exit_code/killed
 */
export async function listBgProcesses() {
  try {
    const response = await fetch(apiUrl('/bg-processes'))
    if (!response.ok) {
      throw new Error(`Failed to fetch background processes: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()
    return { processes: Array.isArray(data?.processes) ? data.processes : [] }
  } catch (error) {
    console.error('Error fetching background processes:', error)
    throw error
  }
}

/**
 * 停止指定后台进程（POST /api/bg-processes/{id}/stop）
 * 404 视为进程已不存在（幂等），返回 { ok: true }
 * @param {string} id - 后台进程 ID
 * @returns {Promise<Object>} 操作结果，如 { ok: true, id, command }
 */
export async function stopBgProcess(id) {
  const pid = String(id || '').trim()
  if (!pid) throw new Error('Background process id is required')
  try {
    const response = await fetch(apiUrl(`/bg-processes/${encodeURIComponent(pid)}/stop`), {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
    })
    if (response.status === 404) {
      return { ok: true }
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Failed to stop background process: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    console.error(`Error stopping background process ${pid}:`, error)
    throw error
  }
}
