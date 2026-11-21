import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = resolve(root, 'package.json')
const windowsDir = resolve(root, 'build/windows')
const nsisDir = resolve(windowsDir, 'nsis')

const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
  version?: unknown
}

if (
  typeof packageJson.version !== 'string' ||
  !/^\d+\.\d+\.\d+$/.test(packageJson.version)
) {
  throw new Error(
    `package.json must contain a stable semver version, got ${String(packageJson.version)}`,
  )
}

const version = packageJson.version
const windowsVersion = `${version}.0`
const companyName = 'Martes'
const productName = 'Modkeeper'
const description = 'Game mod management and development'
const copyright = '© 2026 Martes'

const manifest = await readFile(
  resolve(windowsDir, 'wails.exe.manifest'),
  'utf8',
)
const manifestVersion = manifest.match(
  /<assemblyIdentity[^>]*version="([^"]+)"/,
)?.[1]
if (manifestVersion !== windowsVersion) {
  throw new Error(
    `build/windows/wails.exe.manifest has version ${manifestVersion ?? '<missing>'}; expected ${windowsVersion}`,
  )
}

const info = {
  fixed: {
    file_version: version,
    product_version: version,
  },
  info: {
    '0409': {
      FileVersion: version,
      ProductVersion: version,
      CompanyName: companyName,
      FileDescription: description,
      LegalCopyright: copyright,
      ProductName: productName,
      Comments: description,
    },
  },
}

const nsisVersion = [
  '!define INFO_PROJECTNAME "modkeeper"',
  `!define INFO_COMPANYNAME "${companyName}"`,
  `!define INFO_PRODUCTNAME "${productName}"`,
  `!define INFO_PRODUCTVERSION "${version}"`,
  `!define INFO_COPYRIGHT "${copyright}"`,
  `!define INFO_DESCRIPTION "${description}"`,
  '!define PRODUCT_EXECUTABLE "modkeeper.exe"',
  '!define UNINST_KEY_NAME "MartesModkeeper"',
  '',
].join('\n')

await mkdir(nsisDir, { recursive: true })
await writeFile(
  resolve(windowsDir, 'info.json'),
  `${JSON.stringify(info, null, 2)}\n`,
  'utf8',
)
await writeFile(resolve(nsisDir, 'version.nsh'), nsisVersion, 'utf8')

console.log(`Generated Wails Windows metadata for Modkeeper ${version}`)
