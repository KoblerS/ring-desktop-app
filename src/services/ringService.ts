import { RingApi, RingCamera } from "ring-client-api";
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import { StreamingSession } from "ring-client-api/lib/streaming/streaming-session";

interface LoginResult {
  success: boolean;
  requiresTwoFactor?: boolean;
  refreshToken?: string;
  error?: string;
}

interface OAuthResponse {
  refresh_token?: string;
  access_token?: string;
  error_description?: string;
}

interface CameraInfo {
  id: string;
  name: string;
  deviceType: string;
  batteryLevel: number | null;
  hasBattery: boolean;
  isOnline: boolean;
  hasLight: boolean;
  hasSiren: boolean;
}

type DingCallback = (ding: any) => void;
type MotionCallback = (motion: any) => void;

// Store active streaming sessions
const activeStreams: Map<string, StreamingSession> = new Map();

export class RingService {
  private ringApi: RingApi | null = null;
  private cameras: RingCamera[] = [];
  private dingCallbacks: DingCallback[] = [];
  private motionCallbacks: MotionCallback[] = [];

  constructor(private refreshToken: string) {}

  async initialize(): Promise<void> {
    this.ringApi = new RingApi({
      refreshToken: this.refreshToken,
      cameraStatusPollingSeconds: 20,
    });

    this.cameras = await this.ringApi.getCameras();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.cameras.forEach((camera) => {
      // Subscribe to camera events to enable push notifications
      // This is required for onDoorbellPressed and onMotionDetected to work
      camera.subscribeToMotionEvents().catch((err: Error) => {
        console.error(`Failed to subscribe to motion events for ${camera.name}:`, err);
      });

      camera.subscribeToDingEvents().catch((err: Error) => {
        console.error(`Failed to subscribe to ding events for ${camera.name}:`, err);
      });

      // Subscribe to doorbell presses
      camera.onDoorbellPressed?.subscribe(() => {
        console.log(`Doorbell pressed: ${camera.name}`);
        const dingData = {
          deviceId: camera.id.toString(),
          deviceName: camera.name,
          type: "ding",
          timestamp: new Date().toISOString(),
        };
        this.dingCallbacks.forEach((cb) => cb(dingData));
      });

      // Subscribe to motion events
      camera.onMotionDetected?.subscribe((motionDetected: boolean) => {
        if (motionDetected) {
          console.log(`Motion detected: ${camera.name}`);
          const motionData = {
            deviceId: camera.id.toString(),
            deviceName: camera.name,
            timestamp: new Date().toISOString(),
          };
          this.motionCallbacks.forEach((cb) => cb(motionData));
        }
      });
    });
  }

  static async login(email: string, password: string): Promise<LoginResult> {
    try {
      const response = await fetch("https://oauth.ring.com/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Ring Desktop App/1.0",
          "2fa-support": "true",
          "2fa-code": "",
          hardware_id: generateHardwareId(),
        },
        body: JSON.stringify({
          client_id: "ring_official_android",
          grant_type: "password",
          username: email,
          password: password,
          scope: "client",
        }),
      });

      if (response.status === 412) {
        // 2FA required
        return { success: false, requiresTwoFactor: true };
      }

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => ({}))) as OAuthResponse;
        throw new Error(errorData.error_description || "Login failed");
      }

      const data = (await response.json()) as OAuthResponse;
      return { success: true, refreshToken: data.refresh_token };
    } catch (error: any) {
      // Check if this is a 2FA requirement
      if (error.message?.includes("Verification Code")) {
        return { success: false, requiresTwoFactor: true };
      }
      return { success: false, error: error.message };
    }
  }

  static async verifyTwoFactor(
    email: string,
    password: string,
    code: string,
  ): Promise<LoginResult> {
    try {
      const response = await fetch("https://oauth.ring.com/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Ring Desktop App/1.0",
          "2fa-support": "true",
          "2fa-code": code,
          hardware_id: generateHardwareId(),
        },
        body: JSON.stringify({
          client_id: "ring_official_android",
          grant_type: "password",
          username: email,
          password: password,
          scope: "client",
        }),
      });

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => ({}))) as OAuthResponse;
        throw new Error(errorData.error_description || "Verification failed");
      }

      const data = (await response.json()) as OAuthResponse;
      return { success: true, refreshToken: data.refresh_token };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getCameras(): Promise<CameraInfo[]> {
    if (!this.ringApi) {
      throw new Error("Ring API not initialized");
    }

    return this.cameras.map((camera) => {
      // Check if camera actually has a battery (batteryLevel will be null for wired cameras)
      const hasBattery =
        camera.batteryLevel !== null && camera.batteryLevel !== undefined;

      return {
        id: camera.id.toString(),
        name: camera.name,
        deviceType: String(camera.deviceType),
        batteryLevel: camera.batteryLevel,
        hasBattery: hasBattery,
        isOnline: true, // Camera is online if we can retrieve it
        hasLight: camera.hasLight,
        hasSiren: camera.hasSiren,
      };
    });
  }

  async getSnapshot(deviceId: string): Promise<Buffer | null> {
    const camera = this.cameras.find((c) => c.id.toString() === deviceId);
    if (!camera) {
      return null;
    }

    try {
      const snapshot = await camera.getSnapshot();
      return snapshot;
    } catch (error) {
      console.error("Error getting snapshot:", error);
      return null;
    }
  }

  async startLiveStream(
    deviceId: string,
  ): Promise<{ success: boolean; streamPath?: string; error?: string }> {
    const camera = this.cameras.find((c) => c.id.toString() === deviceId);
    if (!camera) {
      return { success: false, error: "Camera not found" };
    }

    try {
      // Stop any existing stream for this camera
      await this.stopLiveStream(deviceId);

      // Create output path for the stream
      const userDataPath = app.getPath("userData");
      const streamDir = path.join(userDataPath, "streams");

      // Ensure stream directory exists
      if (!fs.existsSync(streamDir)) {
        fs.mkdirSync(streamDir, { recursive: true });
      }

      const streamPath = path.join(streamDir, `stream-${deviceId}.mp4`);

      // Start the live stream - this uses ffmpeg internally
      const streamingSession = await camera.streamVideo({
        output: [
          "-f",
          "mp4",
          "-movflags",
          "frag_keyframe+empty_moov+faststart",
          "-preset",
          "ultrafast",
          "-tune",
          "zerolatency",
          streamPath,
        ],
      });

      // Store the session for later cleanup
      activeStreams.set(deviceId, streamingSession);

      // Handle stream end
      streamingSession.onCallEnded.subscribe(() => {
        activeStreams.delete(deviceId);
      });

      return { success: true, streamPath };
    } catch (error: any) {
      console.error("Error starting live stream:", error);
      return {
        success: false,
        error: error.message || "Failed to start stream",
      };
    }
  }

  async stopLiveStream(deviceId: string): Promise<void> {
    const session = activeStreams.get(deviceId);
    if (session) {
      try {
        session.stop();
      } catch (error) {
        console.error("Error stopping stream:", error);
      }
      activeStreams.delete(deviceId);
    }
  }

  // Get a continuous stream of snapshots for "live" view fallback
  async *getSnapshotStream(
    deviceId: string,
    intervalMs: number = 1000,
  ): AsyncGenerator<Buffer | null> {
    const camera = this.cameras.find((c) => c.id.toString() === deviceId);
    if (!camera) {
      return;
    }

    while (true) {
      try {
        const snapshot = await camera.getSnapshot();
        yield snapshot;
      } catch (error) {
        yield null;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async getDeviceHealth(deviceId: string): Promise<any> {
    const camera = this.cameras.find((c) => c.id.toString() === deviceId);
    if (!camera) {
      return null;
    }

    try {
      const health = await camera.getHealth();
      return health;
    } catch (error) {
      console.error("Error getting device health:", error);
      return null;
    }
  }

  onDing(callback: DingCallback): void {
    this.dingCallbacks.push(callback);
  }

  onMotion(callback: MotionCallback): void {
    this.motionCallbacks.push(callback);
  }

  async setLight(deviceId: string, on: boolean): Promise<void> {
    const camera = this.cameras.find((c) => c.id.toString() === deviceId);
    if (camera && camera.hasLight) {
      await camera.setLight(on);
    }
  }

  async setSiren(deviceId: string, on: boolean): Promise<void> {
    const camera = this.cameras.find((c) => c.id.toString() === deviceId);
    if (camera && camera.hasSiren) {
      // Note: setSiren might not be available on all devices
    }
  }

  // Cleanup all active streams
  async cleanup(): Promise<void> {
    for (const [deviceId] of activeStreams) {
      await this.stopLiveStream(deviceId);
    }
  }
}

function generateHardwareId(): string {
  const chars = "abcdef0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
