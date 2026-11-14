// Shared by the simulator UI tests: headless Chrome driven over CDP, plus a
// small client for the app's API. Needs the server on :8000.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

export const APP = 'http://localhost:8000'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const api = async (method, path, body) => {
  const res = await fetch(APP + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`)
  return res.json()
}

// Page-side expressions for elements.
export const button = (scope, text) => `[...${scope}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`
export const pane = (i) => `document.querySelectorAll('.sim-pane')[${i}]`
export const scenarioRow = (name) => `[...document.querySelectorAll('.chartpat-tree-row')].find((r) => r.textContent.includes(${JSON.stringify(name)}))`

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.method === 'Runtime.exceptionThrown') console.log('PAGE EXCEPTION:', JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') console.log('PAGE console.error:', msg.params.args.map((a) => a.value ?? a.description).join(' '))
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.rej(new Error(msg.error.message))
    else p.res(msg.result)
  }
  return (method, params = {}) =>
    new Promise((res, rej) => {
      const mine = ++id
      pending.set(mine, { res, rej })
      ws.send(JSON.stringify({ id: mine, method, params }))
      setTimeout(() => {
        if (pending.delete(mine)) rej(new Error(`CDP ${method} timed out`))
      }, 20000).unref()
    })
}

/**
 * Starts headless Chrome with its profile and screenshots under `dir`.
 * `extraArgs` are added to the command line. Returns `openPage` and `close`.
 */
export async function launch(dir, port, extraArgs = []) {
  const chrome = spawn(
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}/chrome-profile`,
      '--window-size=1600,950',
      '--no-first-run',
      ...extraArgs,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  // wait for the debugger endpoint
  for (let i = 0; ; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`)
      break
    } catch (e) {
      if (i > 50) {
        chrome.kill()
        throw e
      }
      await sleep(200)
    }
  }

  async function openPage(url, width, height) {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    const target = await res.json()
    const send = await connect(target.webSocketDebuggerUrl)
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(`${expression}\n${JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails)}`)
      return r.result.value
    }
    const waitFor = async (expression, what, timeout = 10000) => {
      const end = Date.now() + timeout
      for (;;) {
        if (await ev(`!!(${expression})`)) return
        if (Date.now() > end) throw new Error(`timeout waiting for ${what}`)
        await sleep(100)
      }
    }
    const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra })
    const clickAt = async (x, y) => {
      await mouse('mouseMoved', x, y, { button: 'none' })
      await mouse('mousePressed', x, y, { clickCount: 1 })
      await mouse('mouseReleased', x, y, { clickCount: 1 })
    }
    const rectOf = async (elExpr) => {
      const r = await ev(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
      if (!r) throw new Error(`element not found: ${elExpr}`)
      return r
    }
    const click = async (elExpr) => {
      const r = await rectOf(elExpr)
      await clickAt(r.x + r.w / 2, r.y + r.h / 2)
      await sleep(150)
    }
    // `modifiers` is the CDP bit field (8 = Shift).
    const key = async (k, code, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, modifiers })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code, modifiers })
      await sleep(60)
    }
    const shot = async (name) => {
      await send('Page.bringToFront')
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(`${dir}/${name}.png`, Buffer.from(data, 'base64'))
    }
    return { send, ev, waitFor, mouse, clickAt, rectOf, click, key, shot }
  }

  /** The app on the Virtual Simul tab, once the scenario sidebar is up. */
  async function openApp() {
    const app = await openPage(APP, 1600, 950)
    await app.waitFor(`document.querySelector('.top-tabs')`, 'app shell')
    await app.ev(`localStorage.setItem('poctrader:activeTab', 'virtualsim')`)
    await app.send('Page.reload')
    await sleep(500)
    await app.waitFor(`document.querySelector('.chartpat-sidebar-head')`, 'scenario list')
    return app
  }

  return { openPage, openApp, close: () => chrome.kill() }
}
