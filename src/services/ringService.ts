import { RingApi, RingCamera } from "ring-client-api";
import * as path from "path";
import * as fs from "fs";
import { app, BrowserWindow } from "electron";
import { StreamingSession } from "ring-client-api/lib/streaming/streaming-session";
import { SimpleWebRtcSession } from "ring-client-api/lib/streaming/simple-webrtc-session";
import { spawn, ChildProcess } from "child_process";

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
const activeHlsSessions: Map<string, { session: StreamingSession; hlsPath: string }> = new Map();
const activeWebRtcSessions: Map<string, SimpleWebRtcSession> = new Map();

// Store active live stream sessions with ffmpeg for browser streaming
interface LiveStreamSession {
  streamingSession: StreamingSession;
  ffmpegProcess: ChildProcess | null;
  isActive: boolean;
}
const activeLiveStreams: Map<string, LiveStreamSession> = new Map();

export class RingService {
  private ringApi: RingApi | null = null;
  private cameras: RingCamera[] = [];
  private dingCallbacks: DingCallback[] = [];
  private motionCallbacks: MotionCallback[] = [];
  private eventPollingInterval: NodeJS.Timeout | null = null;
  private lastEventTimestamps: Map<string, number> = new Map();

  constructor(private refreshToken: string) {}

  async initialize(): Promise<void> {
    this.ringApi = new RingApi({
      refreshToken: this.refreshToken,
      cameraStatusPollingSeconds: 20,
    });

    this.cameras = await this.ringApi.getCameras();
    console.log(`Initialized ${this.cameras.length} camera(s)`);
    this.setupEventListeners();
    this.startEventPolling();
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
          console.log(`Motion detected (push): ${camera.name}`);
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

  // Poll for events as a fallback when push notifications don't work
  private startEventPolling(): void {
    // Initialize last event timestamps to now
    const now = Date.now();
    this.cameras.forEach(camera => {
      this.lastEventTimestamps.set(camera.id.toString(), now);
    });

    // Poll every 2 seconds for faster notifications
    this.eventPollingInterval = setInterval(() => {
      this.pollForEvents();
    }, 2000);
  }

  private async pollForEvents(): Promise<void> {
    for (const camera of this.cameras) {
      try {
        const response = await camera.getEvents({ limit: 5 });
        const events = response?.events;
        if (!events || !events.length) continue;

        const cameraId = camera.id.toString();
        const lastTimestamp = this.lastEventTimestamps.get(cameraId) || 0;

        for (const event of events) {
          const eventTime = new Date(event.created_at).getTime();
          
          // Only process events newer than our last seen timestamp
          if (eventTime > lastTimestamp) {
            // Update the last timestamp
            this.lastEventTimestamps.set(cameraId, Math.max(eventTime, this.lastEventTimestamps.get(cameraId) || 0));

            if (event.kind === 'ding') {
              console.log(`Doorbell pressed (polled): ${camera.name}`);
              const dingData = {
                deviceId: cameraId,
                deviceName: camera.name,
                type: "ding",
                timestamp: event.created_at,
              };
              this.dingCallbacks.forEach((cb) => cb(dingData));
            } else if (event.kind === 'motion') {
              console.log(`Motion detected (polled): ${camera.name}`);
              const motionData = {
                deviceId: cameraId,
                deviceName: camera.name,
                timestamp: event.created_at,
              };
              this.motionCallbacks.forEach((cb) => cb(motionData));
            }
          }
        }
      } catch (error) {
        // Silently ignore polling errors
      }
    }
  }

  private stopEventPolling(): void {
    if (this.eventPollingInterval) {
      clearInterval(this.eventPollingInterval);
      this.eventPollingInterval = null;
    }
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

  async getProfile(): Promise<any> {
    if (!this.ringApi) {
      throw new Error("Ring API not initialized");
    }
    return await this.ringApi.getProfile();
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

  // Start HLS streaming session using ffmpeg
  async startHlsStream(deviceId: string): Promise<{ success: boolean; hlsUrl?: string; error?: string }> {
    const camera = this.cameras.find((c) => c.id.toString() === deviceId);
    if (!camera) {
      return { success: false, error: "Camera not found" };
    }

    try {
      // Stop any existing HLS session for this camera
      await this.stopHlsStream(deviceId);

      // Create output directory for HLS files
      const userDataPath = app.getPath("userData");
      const hlsDir = path.join(userDataPath, "hls", deviceId);

      // Ensure HLS directory exists
      if (!fs.existsSync(hlsDir)) {
        fs.mkdirSync(hlsDir, { recursive: true });
      }

      // Clean up any existing files
      const existingFiles = fs.readdirSync(hlsDir);
      for (const file of existingFiles) {
        fs.unlinkSync(path.join(hlsDir, file));
      }

      const playlistPath = path.join(hlsDir, "stream.m3u8");

      // Starting HLS stream

      // Start the live stream with HLS output
      const streamingSession = await camera.streamVideo({
        output: [
          // HLS output settings
          "-f", "hls",
          "-hls_time", "2",
          "-hls_list_size", "5",
          "-hls_flags", "delete_segments+append_list",
          "-hls_segment_type", "mpegts",
          "-hls_segment_filename", path.join(hlsDir, "segment%03d.ts"),
          playlistPath
        ],
      });

      // Waiting for ffmpeg to produce segments

      // Store the session
      activeHlsSessions.set(deviceId, { session: streamingSession, hlsPath: hlsDir });

      // Handle stream end
      streamingSession.onCallEnded.subscribe(() => {
        activeHlsSessions.delete(deviceId);
      });

      // Poll for playlist file creation with timeout
      const maxWaitMs = 15000;
      const pollIntervalMs = 500;
      let waited = 0;

      while (waited < maxWaitMs) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;

        if (fs.existsSync(playlistPath)) {
          // Check if there's at least one segment
          const files = fs.readdirSync(hlsDir);
          const segments = files.filter(f => f.endsWith('.ts'));
          
          if (segments.length > 0) {
            return { success: true, hlsUrl: playlistPath };
          }
        }
      }

      // Timeout - cleanup and fail
      console.error(`HLS playlist not created after ${maxWaitMs}ms`);
      streamingSession.stop();
      activeHlsSessions.delete(deviceId);
      return { success: false, error: "Failed to create HLS stream - timeout waiting for ffmpeg" };
    } catch (error: any) {
      console.error("Error starting HLS stream:", error);
      return { success: false, error: error.message };
    }
  }

  // Stop HLS streaming session
  async stopHlsStream(deviceId: string): Promise<void> {
    const hlsSession = activeHlsSessions.get(deviceId);
    if (hlsSession) {
      try {
        hlsSession.session.stop();
        
        // Clean up HLS files
        if (fs.existsSync(hlsSession.hlsPath)) {
          const files = fs.readdirSync(hlsSession.hlsPath);
          for (const file of files) {
            try {
              fs.unlinkSync(path.join(hlsSession.hlsPath, file));
            } catch (e) {
              // Ignore cleanup errors
            }
          }
        }
      } catch (error) {
        console.error("Error stopping HLS stream:", error);
      }
      activeHlsSessions.delete(deviceId);
    }
  }

  // Get HLS directory path for serving files
  getHlsPath(deviceId: string): string | null {
    const hlsSession = activeHlsSessions.get(deviceId);
    return hlsSession?.hlsPath || null;
  }

  // Get live HLS directory path
  getLiveHlsPath(deviceId: string): string | null {
    const liveSession = activeLiveStreams.get(deviceId);
    if (liveSession && liveSession.isActive) {
      const userDataPath = app.getPath("userData");
      return path.join(userDataPath, "live-hls", deviceId);
    }
    return null;
  }

  // Create a WebRTC session for browser-based streaming
  createWebRtcSession(deviceId: string): SimpleWebRtcSession | null {
    const camera = this.cameras.find((c) => c.id.toString() === deviceId);
    if (!camera) {
      return null;
    }

    // Stop any existing session for this camera
    const existingSession = activeWebRtcSessions.get(deviceId);
    if (existingSession) {
      existingSession.end().catch(() => {});
      activeWebRtcSessions.delete(deviceId);
    }

    const session = camera.createSimpleWebRtcSession();
    activeWebRtcSessions.set(deviceId, session);
    return session;
  }

  // Start WebRTC session with SDP offer - returns SDP answer
  async startWebRtcSession(deviceId: string, sdpOffer: string): Promise<{ success: boolean; sdpAnswer?: string; error?: string }> {
    try {
      const session = activeWebRtcSessions.get(deviceId);
      if (!session) {
        return { success: false, error: "No WebRTC session found. Create one first." };
      }

      const sdpAnswer = await session.start(sdpOffer);
      
      return { success: true, sdpAnswer };
    } catch (error: any) {
      console.error("Error starting WebRTC session:", error);
      return { success: false, error: error.message };
    }
  }

  // Activate camera speaker for two-way audio
  async activateCameraSpeaker(deviceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const session = activeWebRtcSessions.get(deviceId);
      if (!session) {
        return { success: false, error: "No active WebRTC session" };
      }

      await session.activateCameraSpeaker();
      return { success: true };
    } catch (error: any) {
      console.error("Error activating camera speaker:", error);
      return { success: false, error: error.message };
    }
  }

  // Stop WebRTC session
  async stopWebRtcSession(deviceId: string): Promise<void> {
    const session = activeWebRtcSessions.get(deviceId);
    if (session) {
      try {
        await session.end();
      } catch (error) {
        console.error("Error ending WebRTC session:", error);
      }
      activeWebRtcSessions.delete(deviceId);
    }
  }

  // Start a real live stream using streamVideo() with ffmpeg transcoding to HLS
  async startRealLiveStream(
    deviceId: string,
    onVideoData: (data: Buffer) => void
  ): Promise<{ success: boolean; hlsUrl?: string; error?: string }> {
    const camera = this.cameras.find((c) => c.id.toString() === deviceId);
    if (!camera) {
      return { success: false, error: "Camera not found" };
    }

    try {
      // Stop any existing live stream for this camera
      await this.stopRealLiveStream(deviceId);

      // Starting live stream

      // Create HLS output directory
      const userDataPath = app.getPath("userData");
      const hlsDir = path.join(userDataPath, "live-hls", deviceId);
      if (!fs.existsSync(hlsDir)) {
        fs.mkdirSync(hlsDir, { recursive: true });
      }

      // Clean up existing files
      const existingFiles = fs.readdirSync(hlsDir);
      for (const file of existingFiles) {
        try {
          fs.unlinkSync(path.join(hlsDir, file));
        } catch (e) {}
      }

      const playlistPath = path.join(hlsDir, "stream.m3u8");

      // Use streamVideo which handles the full WebRTC + ffmpeg pipeline
      // Output to HLS format for browser playback
      const streamingSession = await camera.streamVideo({
        video: ["-vcodec", "copy"], // Keep H264 as-is
        audio: ["-acodec", "aac", "-b:a", "128k"],
        output: [
          "-f", "hls",
          "-hls_time", "1",
          "-hls_list_size", "3",
          "-hls_flags", "delete_segments+append_list+omit_endlist",
          "-hls_segment_type", "mpegts",
          "-hls_segment_filename", path.join(hlsDir, "segment%03d.ts"),
          playlistPath
        ]
      });

      // Store the session
      const liveSession: LiveStreamSession = {
        streamingSession,
        ffmpegProcess: null,
        isActive: true,
      };
      activeLiveStreams.set(deviceId, liveSession);

      // Handle stream end
      streamingSession.onCallEnded.subscribe(() => {
        liveSession.isActive = false;
      });

      // Wait for HLS playlist to be created
      const maxWaitMs = 20000;
      const pollIntervalMs = 500;
      let waited = 0;

      while (waited < maxWaitMs && liveSession.isActive) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;

        if (fs.existsSync(playlistPath)) {
          const files = fs.readdirSync(hlsDir);
          const segments = files.filter(f => f.endsWith('.ts'));
          
          if (segments.length > 0) {
            return { success: true, hlsUrl: playlistPath };
          }
        }
      }

      // Timeout
      console.error(`HLS stream not ready after ${maxWaitMs}ms`);
      await this.stopRealLiveStream(deviceId);
      return { success: false, error: "Timeout waiting for video stream" };

    } catch (error: any) {
      console.error("Error starting real live stream:", error);
      await this.stopRealLiveStream(deviceId);
      return { success: false, error: error.message };
    }
  }

  // Stop a real live stream
  async stopRealLiveStream(deviceId: string): Promise<void> {
    const liveSession = activeLiveStreams.get(deviceId);
    if (liveSession) {
      // Stopping live stream
      liveSession.isActive = false;

      if (liveSession.ffmpegProcess) {
        try {
          liveSession.ffmpegProcess.kill("SIGTERM");
        } catch (e) {
          // Ignore
        }
      }

      if (liveSession.streamingSession) {
        try {
          liveSession.streamingSession.stop();
        } catch (e) {
          console.error("Error stopping streaming session:", e);
        }
      }

      activeLiveStreams.delete(deviceId);
    }
  }

  // Cleanup all active streams
  async cleanup(): Promise<void> {
    this.stopEventPolling();
    for (const [deviceId] of activeStreams) {
      await this.stopLiveStream(deviceId);
    }
    for (const [deviceId] of activeHlsSessions) {
      await this.stopHlsStream(deviceId);
    }
    for (const [deviceId] of activeWebRtcSessions) {
      await this.stopWebRtcSession(deviceId);
    }
    for (const [deviceId] of activeLiveStreams) {
      await this.stopRealLiveStream(deviceId);
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
