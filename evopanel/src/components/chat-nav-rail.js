/**
 * 对话导航条：聊天区边缘一列横条，每根代表一轮对话
 * hover 变长变白 + 预览浮层，点击跳转，滚轮跟随
 *
 * 只在「会话内且确有消息」时显示：
 * - 新建对话 → 工作台是同路由状态切换（无 hashchange），rail 必须随之隐藏
 * - 切换会话 / 消息数量变化 → 重建横条
 */
let _bound = false
/** @type {{ rail: HTMLElement, tip: HTMLElement, bars: HTMLElement[], wrap: HTMLElement, lastPairCount: number, obs: MutationObserver } | null} */
let _state = null

function _ensureStyle() {
  if (document.getElementById('chat-nav-rail-style')) return
  const style = document.createElement('style')
  style.id = 'chat-nav-rail-style'
  style.textContent = `
    .chat-nav-rail {
      position: absolute;
      left: 4px;
      top: 0;
      bottom: 0;
      width: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      z-index: 50;
      pointer-events: auto;
    }
    .chat-nav-rail-bar {
      width: 20px;
      height: 3px;
      background: rgba(15,23,42,0.15);
      border-radius: 2px;
      transition: all 0.15s;
      cursor: pointer;
    }
    .chat-nav-rail-bar:hover,
    .chat-nav-rail-bar.active {
      width: 40px;
      height: 5px;
      background: rgba(15,23,42,0.6);
    }
    .chat-nav-rail-bar.nearby {
      width: 28px;
      background: rgba(15,23,42,0.3);
    }
    .chat-nav-rail-bar.latest {
      height: 4px;
      background: rgba(15,23,42,0.3);
    }
    .chat-nav-rail-tip {
      position: absolute;
      left: 32px;
      top: 50%;
      transform: translateY(-50%);
      width: 280px;
      background: #fff;
      border: 1px solid rgba(0,0,0,0.08);
      border-radius: 8px;
      padding: 10px 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
      display: none;
      z-index: 100;
      font-size: 12px;
      line-height: 1.5;
    }
    .chat-nav-rail-tip.show { display: block; }
    .chat-nav-rail-tip .tip-user {
      color: #333;
      font-weight: 500;
      margin-bottom: 6px;
    }
    .chat-nav-rail-tip .tip-ai {
      color: #888;
    }
  `
  document.head.appendChild(style)
}

function _teardownRail() {
  if (!_state) return
  try { _state.obs.disconnect() } catch { /* ignore */ }
  _state.rail.remove()
  _state = null
}

function _refreshBars() {
  if (!_state) return
  const { wrap, bars } = _state
  bars.forEach((b) => b.remove())
  bars.length = 0
  const msgs = wrap.querySelectorAll('.msg-user, .msg-ai')
  const pairs = Math.floor(msgs.length / 2)
  for (let i = 0; i < pairs; i++) {
    const bar = document.createElement('div')
    bar.className = 'chat-nav-rail-bar'
    if (i >= pairs - 3) bar.classList.add('latest')
    bar.dataset.idx = String(i)
    bar.addEventListener('mouseenter', () => {
      bars.forEach((b, j) => {
        b.classList.remove('active', 'nearby')
        const d = Math.abs(j - i)
        if (d === 0) b.classList.add('active')
        else if (d <= 2) b.classList.add('nearby')
      })
      const userMsg = msgs[i * 2]
      const aiMsg = msgs[i * 2 + 1]
      const aiBody = aiMsg?.querySelector('.msg-text, .markdown-body, .msg-ai-text')?.textContent?.trim() || ''
      _state.tip.innerHTML =
        '<div class="tip-user">' + (userMsg?.textContent?.slice(0, 80) || '') + '</div><div class="tip-ai">' + (aiBody.slice(0, 80) || '') + '</div>'
      _state.tip.classList.add('show')
    })
    bar.addEventListener('click', () => {
      // 虚拟列表滚动后 DOM 节点会变，重新查询
      const allMsgs = wrap.querySelectorAll('.msg-user, .msg-ai')
      const target = allMsgs[i * 2]
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      else wrap.scrollTo({ top: (wrap.scrollHeight / Math.floor(allMsgs.length / 2)) * i, behavior: 'smooth' })
    })
    _state.rail.appendChild(bar)
    bars.push(bar)
  }
  _state.lastPairCount = pairs
}

function _buildRail(wrap) {
  _ensureStyle()
  _teardownRail()
  const parent = wrap.parentElement
  if (!parent) return
  const rail = document.createElement('div')
  rail.className = 'chat-nav-rail'
  const tip = document.createElement('div')
  tip.className = 'chat-nav-rail-tip'
  rail.appendChild(tip)
  parent.style.position = 'relative'
  parent.appendChild(rail)

  _state = { rail, tip, bars: [], wrap, lastPairCount: 0, obs: null }
  _refreshBars()

  const obs = new MutationObserver(() => {
    if (!_state) return
    const msgs = wrap.querySelectorAll('.msg-user, .msg-ai')
    const pairs = Math.floor(msgs.length / 2)
    // 只在消息数量真正增加时立即刷新（虚拟列表滚动导致的减少交给 sync 节流处理）
    if (pairs > _state.lastPairCount) _refreshBars()
  })
  obs.observe(wrap, { childList: true, subtree: true })
  _state.obs = obs

  document.addEventListener('click', (e) => {
    if (_state && !_state.rail.contains(e.target)) _state.tip.classList.remove('show')
  })
}

/** 与界面状态同步：仅在会话内且有消息时显示（工作台态隐藏/移除） */
function _syncRail() {
  const wrap = document.querySelector('.react-vlist-scroll-wrap')
  // 无消息容器：工作台 / 非会话界面 → 移除 rail
  if (!wrap || !wrap.isConnected) {
    if (_state) _teardownRail()
    return
  }
  // 会话切换导致容器换新 DOM → 重建
  if (!_state || _state.wrap !== wrap) {
    _buildRail(wrap)
    return
  }
  const wrapVisible = wrap.offsetParent !== null
  const msgs = wrap.querySelectorAll('.msg-user, .msg-ai')
  const pairs = Math.floor(msgs.length / 2)
  if (!wrapVisible || pairs === 0) {
    // 工作台态 / 空会话：隐藏并收起预览浮层
    _state.rail.style.display = 'none'
    _state.tip.classList.remove('show')
    return
  }
  _state.rail.style.display = 'flex'
  const barCount = _state.bars.length
  if (barCount !== pairs) _refreshBars()
}

function _bindChatNavRail() {
  if (_bound) return
  _bound = true
  _ensureStyle()
  _syncRail()
  setInterval(_syncRail, 400)
}

export { _bindChatNavRail }
