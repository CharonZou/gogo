/** 设置中心 → 行程地图：数据源 / 高德 Key / 月度上限 / 连通性测试 */

const ACCENT = '#d9a406'

let _timer = null

export function cleanup() {
  if (_timer) { clearTimeout(_timer); _timer = null }
}

export async function mountMapInto(container) {
  container.classList.add('settings-modal-pane--map')
  container.innerHTML = `
    <div class="settings-map-page" style="max-width:720px;margin:0 auto;padding:20px 8px;">
      <div class="settings-map-card" style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px 22px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <span style="width:10px;height:10px;border-radius:50%;background:${ACCENT};"></span>
          <h3 style="margin:0;font-size:16px;font-weight:600;color:#1f2328;">行程卡地图</h3>
        </div>
        <p style="margin:0 0 16px;font-size:13px;color:#57606a;line-height:1.6;">
          聊天里的「行程卡」会按地点名查坐标、照片并画成地图卡片。国内推荐高德（要填 Key，瓦片/路线更稳定）；
          不填 Key 时退回 OpenStreetMap（海外可用，国内网络通常很慢）。Key 只存在本机，用于查地点与路线。
        </p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <label style="font-size:13px;color:#444;">
            <div style="margin-bottom:6px;">数据源</div>
            <select id="geo-provider" style="width:100%;padding:8px 10px;border:1px solid #d0d7de;border-radius:8px;background:#fff;font-size:14px;">
              <option value="auto">自动（优先高德）</option>
              <option value="amap">只用高德</option>
              <option value="osm">只用 OpenStreetMap</option>
            </select>
          </label>
          <label style="font-size:13px;color:#444;">
            <div style="margin-bottom:6px;">高德 Web 服务 Key（amap_key）</div>
            <input id="geo-amap-key" type="password" placeholder="留空则用 OpenStreetMap" autocomplete="off"
              style="width:100%;padding:8px 10px;border:1px solid #d0d7de;border-radius:8px;background:#fff;font-size:14px;" />
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">
          <label style="font-size:13px;color:#444;">
            <div style="margin-bottom:6px;">搜索次数 / 月</div>
            <input id="geo-search-cap" type="number" min="0" step="500" style="width:100%;padding:8px 10px;border:1px solid #d0d7de;border-radius:8px;font-size:14px;" />
          </label>
          <label style="font-size:13px;color:#444;">
            <div style="margin-bottom:6px;">路线次数 / 月</div>
            <input id="geo-route-cap" type="number" min="0" step="5000" style="width:100%;padding:8px 10px;border:1px solid #d0d7de;border-radius:8px;font-size:14px;" />
          </label>
        </div>

        <div id="geo-usage-line" style="margin-top:14px;font-size:13px;color:#57606a;"></div>

        <div style="display:flex;gap:10px;margin-top:18px;align-items:center;flex-wrap:wrap;">
          <button id="geo-save" style="background:${ACCENT};color:#1f2328;border:none;border-radius:8px;padding:9px 22px;font-size:14px;font-weight:600;cursor:pointer;">保存</button>
          <button id="geo-test" style="background:#fff;color:#1f2328;border:1px solid #d0d7de;border-radius:8px;padding:9px 16px;font-size:14px;cursor:pointer;">测一下</button>
          <span id="geo-msg" style="font-size:13px;color:#57606a;"></span>
        </div>
      </div>
    </div>
  `

  const q = (id) => container.querySelector(id)
  const msg = q('#geo-msg')
  const usageLine = q('#geo-usage-line')

  async function load() {
    let cfg
    try {
      const r = await fetch('/api/geo/config')
      cfg = await r.json()
    } catch (e) { cfg = {} }
    let st = { provider: 'auto', amap_key: '', amap_search_cap: null, amap_route_cap: null }
    try {
      const r = await fetch('/api/geo/settings')
      const j = await r.json()
      if (j && j.ok) st = { ...st, ...(j.settings || {}) }
    } catch (e) { /* 保持默认 */ }
    q('#geo-provider').value = st.provider || 'auto'
    if (st.amap_key) {
      q('#geo-amap-key').placeholder = st.amap_key
      q('#geo-amap-key').dataset.hasKey = '1'
      q('#geo-amap-key').title = '已保存一个 Key（掩码：' + st.amap_key + '）；输入新值会替换它'
    }
    const caps = (cfg.usage && cfg.usage.caps) || {}
    q('#geo-search-cap').value = caps.search || (st.amap_search_cap ?? '')
    q('#geo-route-cap').value = caps.route || (st.amap_route_cap ?? '')
    const u = (cfg.usage && cfg.usage.used) || {}
    usageLine.textContent = `本月高德用量：搜索 ${u.search || 0} / ${caps.search || 0}，路线 ${u.route || 0} / ${caps.route || 0}`
  }

  function setMsg(text, ok) {
    msg.textContent = text
    msg.style.color = ok ? '#1a7f37' : '#cf222e'
    if (_timer) clearTimeout(_timer)
    _timer = setTimeout(() => { msg.textContent = '' }, 12000)
  }

  q('#geo-save').addEventListener('click', async () => {
    const body = { provider: q('#geo-provider').value }
    const keyRaw = q('#geo-amap-key').value.trim()
    if (keyRaw) body.amap_key = keyRaw
    const sc = parseInt(q('#geo-search-cap').value, 10)
    const rc = parseInt(q('#geo-route-cap').value, 10)
    if (Number.isFinite(sc) && sc >= 0) body.amap_search_cap = sc
    if (Number.isFinite(rc) && rc >= 0) body.amap_route_cap = rc
    try {
      const r = await fetch('/api/geo/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      q('#geo-amap-key').value = ''
      q('#geo-amap-key').dataset.hasKey = '1'
      setMsg('已保存；页面上的行程卡会按新设置重新查。', true)
      if (typeof window.TripCard === 'object' && typeof window.TripCard.resetConfig === 'function') {
        window.TripCard.resetConfig()
      }
      await load()
    } catch (e) {
      setMsg('保存失败：' + e.message, false)
    }
  })

  q('#geo-test').addEventListener('click', async () => {
    setMsg('正在测试…', true)
    const body = {}
    const keyRaw = q('#geo-amap-key').value.trim()
    if (keyRaw) body.key = keyRaw
    try {
      const r = await fetch('/api/geo/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      setMsg((j && j.msg) || '测试完成', !!(j && j.ok))
    } catch (e) {
      setMsg('测试失败：' + e.message, false)
    }
  })

  await load()
}
