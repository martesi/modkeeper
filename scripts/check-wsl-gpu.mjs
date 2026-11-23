import { chromium } from '@playwright/test'

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2')
  const info = gl?.getExtension('WEBGL_debug_renderer_info')
  return info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
})
await browser.close()
console.log(`WebGL2 renderer: ${renderer || 'unavailable'}`)
if (
  !renderer ||
  !/D3D12/i.test(renderer) ||
  /swiftshader|llvmpipe/i.test(renderer)
) {
  throw new Error('WSL GPU acceleration is not available')
}
