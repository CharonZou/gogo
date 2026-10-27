import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, highlightActiveLine, lineNumbers, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { LSPClient, languageServerExtensions, serverCompletion, hoverTooltips, signatureHelp } from '@codemirror/lsp-client'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { yaml } from '@codemirror/lang-yaml'
import { sql } from '@codemirror/lang-sql'
import { markdown } from '@codemirror/lang-markdown'
import { xml } from '@codemirror/lang-xml'
import { go } from '@codemirror/lang-go'
import { rust } from '@codemirror/lang-rust'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { properties } from '@codemirror/legacy-modes/mode/properties'

type Props = {
  value: string
  onChange: (value: string) => void
  fileName?: string
}

// 根据文件后缀获取对应的 LSP 语言类型
function getLspLanguage(fileName: string): string | null {
  const ext = fileName?.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'py':
    case 'pyw':
      return 'python'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'json':
      return 'json'
    default:
      return null
  }
}

// 根据文件后缀获取对应的语言扩展
function getLanguageExtension(fileName: string) {
  const ext = fileName?.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'py':
    case 'pyw':
      return python()
    case 'js':
    case 'jsx':
    case 'mjs':
      return javascript({ jsx: true })
    case 'ts':
    case 'tsx':
      return javascript({ typescript: true, jsx: ext === 'tsx' })
    case 'json':
    case 'lock':
      return json()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'html':
    case 'htm':
      return html()
    case 'yaml':
    case 'yml':
      return yaml()
    case 'sql':
      return sql()
    case 'md':
    case 'markdown':
      return markdown()
    case 'xml':
      return xml()
    case 'go':
      return go()
    case 'rs':
      return rust()
    case 'java':
      return java()
    case 'c':
    case 'h':
    case 'cpp':
    case 'hpp':
    case 'cc':
      return cpp()
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'bashrc':
    case 'zshrc':
      return StreamLanguage.define(shell)
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'env':
    case 'gitignore':
    case 'dockerignore':
      return StreamLanguage.define(properties)
    default:
      return []
  }
}

export function CodeEditor({ value, onChange, fileName = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const lspClientRef = useRef<LSPClient | null>(null)
  const [scrollInfo, setScrollInfo] = useState({ ratio: 0, viewportRatio: 1 })

  // 初始化编辑器
  useEffect(() => {
    if (!containerRef.current) return

    const lspLanguage = getLspLanguage(fileName)
    let lspClient: LSPClient | null = null
    let ws: WebSocket | null = null

    // 如果有 LSP 支持，创建 LSP 客户端
    if (lspLanguage) {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//localhost:8012/api/lsp/ws/${lspLanguage}`
        
        lspClient = new LSPClient({
          rootUri: 'file:///workspace',
          extensions: [
            ...languageServerExtensions(),
            serverCompletion(),
            hoverTooltips(),
            signatureHelp(),
          ],
        })

        ws = new WebSocket(wsUrl)
        
        ws.onopen = () => {
          lspClient!.connect({
            send: (message: string) => {
              if (ws?.readyState === WebSocket.OPEN) {
                ws.send(message)
              }
            },
            subscribe: (handler: (value: string) => void) => {
              if (ws) {
                ws.onmessage = (event) => handler(event.data)
              }
            },
            unsubscribe: () => {},
          })
        }

        ws.onerror = (e) => {
          console.warn('[LSP] WebSocket error:', e)
        }

        lspClientRef.current = lspClient
      } catch (e) {
        console.warn('[LSP] Failed to create LSP client:', e)
      }
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        autocompletion(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        syntaxHighlighting(defaultHighlightStyle),
        getLanguageExtension(fileName),
        lspClient ? lspClient.plugin(`file:///workspace/${fileName}`, lspLanguage || undefined) : [],
        EditorView.theme({
          '&': {
            fontSize: '12px',
            height: '100%',
          },
          '.cm-content': {
            fontFamily: "'Consolas', 'Monaco', monospace",
            lineHeight: '1.6',
            padding: '8px 0',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--bg-secondary, #fafafa)',
            borderRight: '1px solid var(--border-default, #e6e8ec)',
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    // 监听滚动，更新 minimap
    const scrollDom = view.scrollDOM
    const onScroll = () => {
      const max = scrollDom.scrollHeight - scrollDom.clientHeight
      const ratio = max > 0 ? scrollDom.scrollTop / max : 0
      const viewportRatio = scrollDom.scrollHeight > 0 ? scrollDom.clientHeight / scrollDom.scrollHeight : 1
      setScrollInfo({ ratio, viewportRatio })
    }
    scrollDom.addEventListener('scroll', onScroll)

    return () => {
      scrollDom.removeEventListener('scroll', onScroll)
      if (lspClient) {
        lspClient.disconnect()
      }
      if (ws) {
        ws.close()
      }
      view.destroy()
      viewRef.current = null
      lspClientRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName])

  // 外部 value 变化时同步（只在不是用户输入时同步）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      })
    }
  }, [value])

  // minimap 点击定位
  const onMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const view = viewRef.current
    const map = minimapRef.current
    if (!view || !map) return
    const rect = map.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    const scrollDom = view.scrollDOM
    const max = scrollDom.scrollHeight - scrollDom.clientHeight
    scrollDom.scrollTop = Math.max(0, Math.min(max, ratio * max))
  }

  return (
    <div className="react-chat-info-rail-codewrap">
      <div ref={containerRef} className="react-chat-info-rail-codemirror" />
      <div ref={minimapRef} className="react-chat-info-rail-minimap" onClick={onMinimapClick}>
        <div
          className="react-chat-info-rail-minimap-viewport"
          style={{
            top: `${scrollInfo.ratio * (100 - scrollInfo.viewportRatio * 100)}%`,
            height: `${scrollInfo.viewportRatio * 100}%`,
          }}
        />
        <div className="react-chat-info-rail-minimap-text">
          {value}
        </div>
      </div>
    </div>
  )
}
