import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { initDb } from './db/client'
import { registerIpc } from './ipc'
import { appPaths } from './paths'
import { registerMediaSchemePrivileges, registerMediaProtocol } from './media'
import { startScheduler } from './scheduler'

registerMediaSchemePrivileges()

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'TikTokClip',
    backgroundColor: '#0f0f12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // En dev, electron-vite sert le renderer via un serveur HMR.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Si le renderer n'arrive pas à charger, on le voit dans la console du terminal.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[renderer] échec de chargement', code, desc)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process terminé', details)
  })

  return mainWindow
}

app.whenReady().then(() => {
  const paths = appPaths()
  for (const dir of [paths.downloads, paths.clips, paths.bin, paths.models]) {
    mkdirSync(dir, { recursive: true })
  }
  initDb(paths.data)
  registerMediaProtocol(paths)
  registerIpc(paths)
  startScheduler(paths)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
