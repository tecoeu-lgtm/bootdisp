const { app, BrowserWindow, Menu, shell } = require('electron')
const path = require('node:path')

const defaultUrl = 'https://project-hu1sk.vercel.app'
const appUrl = process.env.JUSPREV_APP_URL || defaultUrl

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    title: 'JusPrevConecta',
    icon: path.join(__dirname, '..', 'public', 'logo-cropped.png'),
    backgroundColor: '#edf3f9',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.loadURL(appUrl)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
