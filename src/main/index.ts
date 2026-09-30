import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { join } from 'node:path';
import { PixelApp } from '@core/app/pixel';
import { KeychainCredentialStore, MemoryCredentialStore } from '@core/security/credentials';
import { INVOKE_CHANNEL, type Envelope } from '../shared/channels';
import { createApi } from './api';

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
let pixel: PixelApp | null = null;
let mainWindow: BrowserWindow | null = null;

function dataDir() {
  return process.env.PIXEL_DATA_DIR || join(app.getPath('userData'), 'data');
}

function migrationsFolder() {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: 'PIXEL',
    backgroundColor: '#F3EFE6',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => (mainWindow = null));
  if (isDev) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

function hardenSessions() {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => {
      const allowed = isDev ? url.startsWith(process.env.ELECTRON_RENDERER_URL!) : url.startsWith('file://');
      if (!allowed) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

async function bootstrap() {
  const credentials = process.env.PIXEL_CREDENTIAL_STORE === 'memory' ? new MemoryCredentialStore() : new KeychainCredentialStore();
  const latency = Number(process.env.PIXEL_MOCK_LATENCY ?? '1');
  const dir = dataDir();
  pixel = await PixelApp.open({ dataDir: dir, migrationsFolder: migrationsFolder(), credentials, latencyScale: Number.isFinite(latency) ? latency : 1 });

  const api = createApi(pixel, {
    version: app.getVersion(),
    dataDir: dir,
    pickFolder: async () => {
      const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'], title: 'Choose a project folder' });
      return res.canceled ? null : (res.filePaths[0] ?? null);
    },
  });

  ipcMain.handle(INVOKE_CHANNEL, async (event, channel: string, input: unknown): Promise<Envelope<unknown>> => {
    // Only our own renderer may call in.
    const origin = event.senderFrame?.url ?? '';
    if (!(isDev ? origin.startsWith(process.env.ELECTRON_RENDERER_URL!) : origin.startsWith('file://'))) return { ok: false, error: 'Forbidden' };
    const def = (api as Record<string, { schema: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: { issues: { path: PropertyKey[]; message: string }[] } } }; fn(i: unknown): unknown }>)[channel];
    if (!def) return { ok: false, error: `Unknown channel ${channel}` };
    const parsed = def.schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
    try {
      return { ok: true, data: await def.fn(parsed.data) };
    } catch (err) {
      return { ok: false, error: pixel!.redactor.redactString((err as Error).message) };
    }
  });

  pixel.bus.subscribe((e) => broadcast('run:event', e));
  pixel.runStatus.subscribe((r) => broadcast('run:status', { id: r.id, status: r.status, outcome: r.outcome, error: r.error, finishedAt: r.finishedAt }));
  pixel.approvals.changes.subscribe((a) => broadcast('approval:changed', a));
}

app.setName('PIXEL');
// Scope Electron's own profile (and the single-instance lock) to the data directory in use.
if (process.env.PIXEL_DATA_DIR) app.setPath('userData', join(process.env.PIXEL_DATA_DIR, 'electron'));

// One writer per database: a second instance would mistake the first one's live runs for
// interrupted ones and fail them. Focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  hardenSessions();
  try {
    await bootstrap();
  } catch (err) {
    dialog.showErrorBox('PIXEL failed to start', (err as Error).stack ?? String(err));
    app.exit(1);
    return;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => pixel?.close());
