/**
 * /ide 路由模块：IDE 工作台（全屏沉浸，隐藏全局侧栏）
 * 挂载到 body 下的 #ide-fullscreen-root，退出时恢复原布局
 */
let ideModulePromise = null

async function createIdeRouteModule() {
  if (ideModulePromise) return ideModulePromise
  ideModulePromise = (async () => {
    const { createRoot } = await import('react-dom/client')
    const React = await import('react')
    const IdeModule = await import('../react/ide/IdeApp.tsx')
    const IdeApp = IdeModule.default
    let ideReactRoot = null
    let originalAsideDisplay = null
    return {
      render: () => {
        const appShellAside = document.getElementById('app-shell-aside')
        const mainCol = document.getElementById('main-col')
        originalAsideDisplay = appShellAside?.style.display
        if (appShellAside) appShellAside.style.display = 'none'
        if (mainCol) mainCol.style.display = 'none'
        document.body.classList.add('ide-fullscreen-mode')

        document.getElementById('ide-fullscreen-root')?.remove()
        if (ideReactRoot) {
          try {
            ideReactRoot.unmount()
          } catch {
            /* ignore */
          }
          ideReactRoot = null
        }
        const container = document.createElement('div')
        container.id = 'ide-fullscreen-root'
        Object.assign(container.style, {
          position: 'fixed',
          inset: '0',
          zIndex: '9998',
          overflow: 'hidden',
        })
        document.body.appendChild(container)
        ideReactRoot = createRoot(container)
        ideReactRoot.render(React.createElement(IdeApp))
      },
      cleanup: () => {
        const appShellAside = document.getElementById('app-shell-aside')
        const mainCol = document.getElementById('main-col')
        if (appShellAside && originalAsideDisplay !== null) {
          appShellAside.style.display = originalAsideDisplay
        }
        if (mainCol) mainCol.style.display = ''
        document.body.classList.remove('ide-fullscreen-mode')
        document.getElementById('ide-fullscreen-root')?.remove()
        if (!ideReactRoot) return
        try {
          ideReactRoot.unmount()
        } catch {
          /* ignore */
        }
        ideReactRoot = null
      },
    }
  })()
  try {
    return await ideModulePromise
  } catch (e) {
    ideModulePromise = null
    throw e
  }
}

export default createIdeRouteModule
