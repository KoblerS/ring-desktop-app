import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  nativeImage,
  protocol,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import { RingService } from "../services/ringService";
import { StorageService, AppSettings } from "../services/storageService";

let mainWindow: BrowserWindow | null = null;
let ringService: RingService | null = null;
const storageService = new StorageService();

// Request notification permission on macOS
async function requestNotificationPermission(): Promise<void> {
  if (Notification.isSupported()) {
    console.log("Notifications are supported");
  } else {
    console.log("Notifications are not supported on this platform");
  }
}

// Track active snapshot intervals for live view
const snapshotIntervals: Map<string, NodeJS.Timeout> = new Map();

function createWindow(): void {
  // Set app icon
  const iconPath = path.join(__dirname, "../../renderer/assets/app-logo.png");

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#1a1a2e",
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/preload.js"),
    },
  });

  // Set dock icon on macOS
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(iconPath);
  }

  // Check if we have saved credentials
  const savedToken = storageService.getRefreshToken();
  if (savedToken) {
    mainWindow.loadFile(path.join(__dirname, "../../renderer/loading.html"));
    initializeWithToken(savedToken);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../renderer/login.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    // Cleanup streams when window closes
    ringService?.cleanup();
  });
}

async function initializeWithToken(refreshToken: string): Promise<void> {
  try {
    ringService = new RingService(refreshToken);
    await ringService.initialize();
    setupRingEventListeners();
    mainWindow?.loadFile(path.join(__dirname, "../../renderer/dashboard.html"));
  } catch (error) {
    console.error("Failed to initialize with saved token:", error);
    storageService.clearCredentials();
    mainWindow?.loadFile(path.join(__dirname, "../../renderer/login.html"));
  }
}

function setupRingEventListeners(): void {
  if (!ringService) return;

  ringService.onDing((ding) => {
    showDingNotification(ding);
  });

  ringService.onMotion((motion) => {
    showMotionNotification(motion);
  });
}

async function showDingNotification(ding: any): Promise<void> {
  // Check notification settings
  const settings = storageService.getSettings();
  if (!settings.notificationsEnabled || !settings.doorbellAlerts) {
    return;
  }

  try {
    // Get snapshot for notification if enabled
    let snapshot: Buffer | undefined;
    if (settings.notificationSnapshot) {
      const result = await ringService?.getSnapshot(ding.deviceId);
      snapshot = result ?? undefined;
    }

    const notification = new Notification({
      title: "Ring Doorbell",
      body: `Someone is at ${ding.deviceName || "your door"}`,
      icon: snapshot ? nativeImage.createFromBuffer(snapshot) : undefined,
      silent: !settings.notificationSound,
      hasReply: false,
      urgency: "critical",
    });

    notification.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
      mainWindow?.webContents.send("open-camera", ding.deviceId);
    });

    notification.show();
  } catch (error) {
    console.error("Error showing ding notification:", error);
    // Show notification without image
    const notification = new Notification({
      title: "Ring Doorbell",
      body: `Someone is at ${ding.deviceName || "your door"}`,
      silent: !settings.notificationSound,
    });
    notification.show();
  }
}

async function showMotionNotification(motion: any): Promise<void> {
  // Check notification settings
  const settings = storageService.getSettings();
  if (!settings.notificationsEnabled || !settings.motionAlerts) {
    return;
  }

  try {
    // Get snapshot for notification if enabled
    let snapshot: Buffer | undefined;
    if (settings.notificationSnapshot) {
      const result = await ringService?.getSnapshot(motion.deviceId);
      snapshot = result ?? undefined;
    }

    const notification = new Notification({
      title: "Motion Detected",
      body: `Motion detected at ${motion.deviceName || "your camera"}`,
      icon: snapshot ? nativeImage.createFromBuffer(snapshot) : undefined,
      silent: !settings.notificationSound,
    });

    notification.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
      mainWindow?.webContents.send("open-camera", motion.deviceId);
    });

    notification.show();
  } catch (error) {
    console.error("Error showing motion notification:", error);
  }
}

// IPC Handlers
ipcMain.handle("login", async (_, email: string, password: string) => {
  try {
    const result = await RingService.login(email, password);
    return result;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "verify-2fa",
  async (_, email: string, password: string, code: string) => {
    try {
      const result = await RingService.verifyTwoFactor(email, password, code);
      if (result.success && result.refreshToken) {
        storageService.saveRefreshToken(result.refreshToken);
        ringService = new RingService(result.refreshToken);
        await ringService.initialize();
        setupRingEventListeners();
      }
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("get-cameras", async () => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }
    const cameras = await ringService.getCameras();
    return { success: true, cameras };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-snapshot", async (_, deviceId: string) => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }
    const snapshot = await ringService.getSnapshot(deviceId);
    return { success: true, snapshot: snapshot?.toString("base64") };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("start-live-stream", async (_, deviceId: string) => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }
    const result = await ringService.startLiveStream(deviceId);
    return result;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stop-live-stream", async (_, deviceId: string) => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }
    await ringService.stopLiveStream(deviceId);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Start rapid snapshot updates for live view (fallback when ffmpeg not available)
ipcMain.handle("start-snapshot-stream", async (_, deviceId: string) => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }

    console.log(`Starting snapshot stream for camera ${deviceId}`);

    // Stop any existing interval for this camera
    const existingInterval = snapshotIntervals.get(deviceId);
    if (existingInterval) {
      clearInterval(existingInterval);
      snapshotIntervals.delete(deviceId);
    }

    // Get first snapshot immediately to validate camera access
    console.log("Fetching initial snapshot...");
    const initialSnapshot = await ringService.getSnapshot(deviceId);

    if (!initialSnapshot) {
      console.log("Failed to get initial snapshot");
      return { success: false, error: "Camera may be offline or unavailable" };
    }

    console.log("Initial snapshot received, starting interval...");

    // Start sending snapshots every 2 seconds
    const interval = setInterval(async () => {
      try {
        const snapshot = await ringService?.getSnapshot(deviceId);
        if (snapshot && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("live-snapshot", {
            deviceId,
            snapshot: snapshot.toString("base64"),
          });
        }
      } catch (error) {
        console.error("Error getting live snapshot:", error);
      }
    }, 2000);

    snapshotIntervals.set(deviceId, interval);

    return {
      success: true,
      snapshot: initialSnapshot.toString("base64"),
    };
  } catch (error: any) {
    console.error("Error starting snapshot stream:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stop-snapshot-stream", async (_, deviceId: string) => {
  const interval = snapshotIntervals.get(deviceId);
  if (interval) {
    clearInterval(interval);
    snapshotIntervals.delete(deviceId);
  }
  return { success: true };
});

// WebRTC streaming handlers
ipcMain.handle("create-webrtc-session", async (_, deviceId: string) => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }
    const session = ringService.createWebRtcSession(deviceId);
    if (session) {
      return { success: true, sessionId: session.sessionId };
    }
    return { success: false, error: "Failed to create WebRTC session" };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "start-webrtc-session",
  async (_, deviceId: string, sdpOffer: string) => {
    try {
      if (!ringService) {
        return { success: false, error: "Not authenticated" };
      }
      return await ringService.startWebRtcSession(deviceId, sdpOffer);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("activate-camera-speaker", async (_, deviceId: string) => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }
    return await ringService.activateCameraSpeaker(deviceId);
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stop-webrtc-session", async (_, deviceId: string) => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }
    await ringService.stopWebRtcSession(deviceId);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Real live stream handlers using startLiveCall()
ipcMain.handle("start-real-live-stream", async (_, deviceId: string) => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }

    // Callback not used for HLS approach, but kept for API compatibility
    const onVideoData = (data: Buffer) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("live-video-data", {
          deviceId,
          data: data.toString("base64"),
        });
      }
    };

    return await ringService.startRealLiveStream(deviceId, onVideoData);
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stop-real-live-stream", async (_, deviceId: string) => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }
    await ringService.stopRealLiveStream(deviceId);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("logout", async () => {
  try {
    // Stop all snapshot streams
    for (const [, interval] of snapshotIntervals) {
      clearInterval(interval);
    }
    snapshotIntervals.clear();

    // Cleanup ring service
    await ringService?.cleanup();

    storageService.clearCredentials();
    ringService = null;
    mainWindow?.loadFile(path.join(__dirname, "../../renderer/login.html"));
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-device-health", async (_, deviceId: string) => {
  try {
    if (!ringService) {
      return { success: false, error: "Not authenticated" };
    }
    const health = await ringService.getDeviceHealth(deviceId);
    return { success: true, health };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Settings handlers
ipcMain.handle("get-settings", async () => {
  try {
    const settings = storageService.getSettings();
    return { success: true, settings };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-app-version", async () => {
  return { success: true, version: app.getVersion() };
});

ipcMain.handle("save-settings", async (_, settings: AppSettings) => {
  try {
    storageService.saveSettings(settings);

    // Apply launch at login setting
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtLogin,
      openAsHidden: settings.startMinimized,
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Register custom protocol for serving HLS files
function registerHlsProtocol(): void {
  protocol.handle("hls", async (request) => {
    try {
      const url = new URL(request.url);
      const deviceId = url.hostname;
      const filename = url.pathname.slice(1); // Remove leading slash

      if (!ringService) {
        return new Response("Not authenticated", { status: 401 });
      }

      // Try live HLS first, then fall back to regular HLS
      let hlsPath = ringService.getLiveHlsPath(deviceId);
      if (!hlsPath) {
        hlsPath = ringService.getHlsPath(deviceId);
      }

      if (!hlsPath) {
        // Stream not active or already stopped - return 404 silently
        return new Response("Stream not found", { status: 404 });
      }

      const filePath = path.join(hlsPath, filename);

      if (!fs.existsSync(filePath)) {
        console.log(`HLS file not found: ${filePath}`);
        return new Response("File not found", { status: 404 });
      }

      // Determine content type
      let contentType = "application/octet-stream";
      if (filename.endsWith(".m3u8")) {
        contentType = "application/vnd.apple.mpegurl";
      } else if (filename.endsWith(".ts")) {
        contentType = "video/mp2t";
      }

      const fileContent = fs.readFileSync(filePath);
      return new Response(fileContent, {
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        },
      });
    } catch (error) {
      console.error("Error serving HLS file:", error);
      return new Response("Internal server error", { status: 500 });
    }
  });
}

app.whenReady().then(async () => {
  registerHlsProtocol();
  await requestNotificationPermission();
  createWindow();
});

app.on("window-all-closed", () => {
  // Stop all snapshot streams
  for (const [, interval] of snapshotIntervals) {
    clearInterval(interval);
  }
  snapshotIntervals.clear();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", async () => {
  // Cleanup all streams before quitting
  await ringService?.cleanup();
});
