const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const Store = require('electron-store');
const fs = require('fs');
const store = new Store();

let mainWindow;
let backendProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // In development, load from React dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built React app
    mainWindow.loadFile(path.join(__dirname, '../ui/build/index.html'));
  }
}

function ensureBackendBinary() {
  const isDev = process.env.NODE_ENV === 'development';
  const sourcePath = path.join(__dirname, '../server/kaja');
  const targetDir = isDev ? path.join(__dirname, 'resources') : process.resourcesPath;
  const targetPath = path.join(targetDir, 'kaja');

  // Create resources directory if it doesn't exist
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Copy the binary if it doesn't exist in the target location
  if (!fs.existsSync(targetPath) && fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
    // Make the binary executable
    fs.chmodSync(targetPath, '755');
  }

  return targetPath;
}

function startBackend() {
  const backendPath = ensureBackendBinary();

  backendProcess = spawn(backendPath, [], {
    stdio: 'pipe',
    shell: true
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`Backend stdout: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`Backend stderr: ${data}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
}

// ... rest of the file remains the same ... 