/** Browser-side collab DAG diagnostics. Enable: localStorage.setItem('gogo_COLLAB_DAG_DEBUG', '1') */

export function isCollabDagDebugEnabled() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('gogo_COLLAB_DAG_DEBUG') === '1'
  } catch {
    return false
  }
}

/** @param {...unknown} args */
export function collabDagDebug(...args) {
  if (!isCollabDagDebugEnabled()) return
   
  console.info('[collab-dag]', ...args)
}

export function collabDagDebugBannerOnce() {
  if (!isCollabDagDebugEnabled()) return
  if (typeof window === 'undefined') return
  if (window.__gogoCollabDagBanner) return
  window.__gogoCollabDagBanner = true
   
  console.info(
    '[collab-dag] 前端调试已开启。后端专用日志：~/.gogo/logs/collab-dag.trace.log；子任务走马灯：~/.gogo/logs/subtask-stream.trace.log',
  )
}
