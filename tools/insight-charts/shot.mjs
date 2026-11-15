// Screenshots a chart page made by insight_chart.py at its exact size, with the UI tests' headless Chrome.
//   node tools/insight-charts/shot.mjs <work dir> <page.html> <width> <height> <name>   -> <work dir>/<name>.png
// The work dir also gets Chrome's profile folder, so use a temporary one.
import { pathToFileURL } from 'node:url'
import { launch } from '../sim-tests/harness.mjs'

const [dir, page, width, height, name] = process.argv.slice(2)
const chrome = await launch(dir, 9377)
try {
  const tab = await chrome.openPage(pathToFileURL(page).href, Number(width), Number(height))
  await tab.waitFor(`document.querySelector('svg')`, 'chart')
  await new Promise((r) => setTimeout(r, 300))
  await tab.shot(name)
} finally {
  chrome.close()
}
