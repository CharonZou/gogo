// 后台进程共享 store：模块级单例，配合 useSyncExternalStore 消费。
// 设计要点：
// 1. ChatApp 这类巨型组件只需把订阅逻辑放进小组件（芯片/面板），避免整体重渲染；
// 2. 第一个订阅者出现时启动轮询，最后一个订阅者离开时停止；
// 3. 轮询节奏：有运行中进程每 3s，否则每 10s 慢轮询（保证 AI 后续启动的进程能被发现）；
// 4. 单次拉取失败不中断循环：保留上次数据，仅记录 error；
// 5. 快照对象引用只在数据（进程列表/错误）真正变化时更换，减少订阅方无效重渲染。

import { listBgProcesses, stopBgProcess } from './bg-processes.js'

const POLL_INTERVAL_BUSY_MS = 3000
const POLL_INTERVAL_IDLE_MS = 10000

/** 进程列表（running === true 的条目才是"运行中"） */
let processes = []
let runningCount = 0
let error = null
let lastFetchedAt = 0

/** 对外快照：引用仅在数据变化时更换 */
let snapshot = { processes, runningCount, error, lastFetchedAt }

/** @type {Set<() => void>} */
const listeners = new Set()
let polling = false
let pollTimer = null
let fetching = false

function sameProcesses(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function commitSnapshot() {
  const next = { processes, runningCount, error, lastFetchedAt }
  const changed = !sameProcesses(next.processes, snapshot.processes) || next.error !== snapshot.error
  if (changed) {
    snapshot = next
    for (const fn of listeners) {
      try {
        fn()
      } catch {
        /* 单个订阅者异常不影响其它订阅者 */
      }
    }
  }
}

async function pollOnce(force = false) {
  if (fetching && !force) return
  fetching = true
  try {
    const data = await listBgProcesses()
    processes = Array.isArray(data?.processes) ? data.processes : []
    runningCount = processes.reduce((n, p) => (p && p.running === true ? n + 1 : n), 0)
    error = null
    lastFetchedAt = Date.now()
  } catch (e) {
    // 失败不中断轮询：保留上次数据，仅记录错误
    error = (e && e.message) || String(e)
    lastFetchedAt = Date.now()
  } finally {
    fetching = false
    commitSnapshot()
  }
}

function scheduleNext() {
  if (!polling || listeners.size === 0) {
    stopPolling()
    return
  }
  if (pollTimer !== null) clearTimeout(pollTimer)
  const interval = runningCount > 0 ? POLL_INTERVAL_BUSY_MS : POLL_INTERVAL_IDLE_MS
  pollTimer = setTimeout(() => {
    void pollOnce().then(scheduleNext)
  }, interval)
}

function startPolling() {
  if (polling) return
  polling = true
  void pollOnce().then(scheduleNext)
}

function stopPolling() {
  polling = false
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

/**
 * 订阅后台进程快照变化；第一个订阅者启动轮询，最后一个退订时停止。
 * @param {() => void} fn
 * @returns {() => void} 退订函数
 */
export function subscribeBgProcesses(fn) {
  listeners.add(fn)
  if (listeners.size === 1) startPolling()
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) stopPolling()
  }
}

/** 获取当前快照（供 useSyncExternalStore 使用） */
export function getBgProcessesSnapshot() {
  return snapshot
}

/** 立即刷新一次（stop 成功后由 stopBgProcessById 自动调用） */
export function refreshBgProcessesNow() {
  return pollOnce(true)
}

/**
 * 停止指定后台进程，并立即刷新列表。
 * @param {string} id - 后台进程 ID
 */
export async function stopBgProcessById(id) {
  try {
    return await stopBgProcess(id)
  } finally {
    void refreshBgProcessesNow()
  }
}
