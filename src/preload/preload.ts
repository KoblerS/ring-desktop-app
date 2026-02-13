import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('ringAPI', {
  // Authentication
  login: (email: string, password: string) => 
    ipcRenderer.invoke('login', email, password),
  
  verifyTwoFactor: (email: string, password: string, code: string) => 
    ipcRenderer.invoke('verify-2fa', email, password, code),
  
  logout: () => ipcRenderer.invoke('logout'),

  // Camera operations
  getCameras: () => ipcRenderer.invoke('get-cameras'),
  
  getSnapshot: (deviceId: string) => 
    ipcRenderer.invoke('get-snapshot', deviceId),
  
  startLiveStream: (deviceId: string) => 
    ipcRenderer.invoke('start-live-stream', deviceId),
  
  stopLiveStream: (deviceId: string) => 
    ipcRenderer.invoke('stop-live-stream', deviceId),
  
  startSnapshotStream: (deviceId: string) => 
    ipcRenderer.invoke('start-snapshot-stream', deviceId),
  
  stopSnapshotStream: (deviceId: string) => 
    ipcRenderer.invoke('stop-snapshot-stream', deviceId),

  // WebRTC streaming
  createWebRtcSession: (deviceId: string) =>
    ipcRenderer.invoke('create-webrtc-session', deviceId),
  
  startWebRtcSession: (deviceId: string, sdpOffer: string) =>
    ipcRenderer.invoke('start-webrtc-session', deviceId, sdpOffer),
  
  activateCameraSpeaker: (deviceId: string) =>
    ipcRenderer.invoke('activate-camera-speaker', deviceId),
  
  stopWebRtcSession: (deviceId: string) =>
    ipcRenderer.invoke('stop-webrtc-session', deviceId),
  
  // Real live streaming using startLiveCall
  startRealLiveStream: (deviceId: string) =>
    ipcRenderer.invoke('start-real-live-stream', deviceId),
  
  stopRealLiveStream: (deviceId: string) =>
    ipcRenderer.invoke('stop-real-live-stream', deviceId),
  
  getDeviceHealth: (deviceId: string) => 
    ipcRenderer.invoke('get-device-health', deviceId),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  
  saveSettings: (settings: any) => 
    ipcRenderer.invoke('save-settings', settings),

  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Event listeners
  onOpenCamera: (callback: (deviceId: string) => void) => {
    ipcRenderer.on('open-camera', (_, deviceId) => callback(deviceId));
  },

  onCameraUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('camera-update', (_, data) => callback(data));
  },

  onLiveSnapshot: (callback: (data: { deviceId: string; snapshot: string }) => void) => {
    ipcRenderer.on('live-snapshot', (_, data) => callback(data));
  },

  removeLiveSnapshotListener: () => {
    ipcRenderer.removeAllListeners('live-snapshot');
  },

  // Real live video data from ffmpeg
  onLiveVideoData: (callback: (data: { deviceId: string; data: string }) => void) => {
    ipcRenderer.on('live-video-data', (_, data) => callback(data));
  },

  removeLiveVideoDataListener: () => {
    ipcRenderer.removeAllListeners('live-video-data');
  }
});

// Type definitions for the renderer
declare global {
  interface Window {
    ringAPI: {
      login: (email: string, password: string) => Promise<any>;
      verifyTwoFactor: (email: string, password: string, code: string) => Promise<any>;
      logout: () => Promise<any>;
      getCameras: () => Promise<any>;
      getSnapshot: (deviceId: string) => Promise<any>;
      startLiveStream: (deviceId: string) => Promise<any>;
      stopLiveStream: (deviceId: string) => Promise<any>;
      startSnapshotStream: (deviceId: string) => Promise<any>;
      stopSnapshotStream: (deviceId: string) => Promise<any>;
      createWebRtcSession: (deviceId: string) => Promise<any>;
      startWebRtcSession: (deviceId: string, sdpOffer: string) => Promise<any>;
      activateCameraSpeaker: (deviceId: string) => Promise<any>;
      stopWebRtcSession: (deviceId: string) => Promise<any>;
      startRealLiveStream: (deviceId: string) => Promise<any>;
      stopRealLiveStream: (deviceId: string) => Promise<any>;
      getDeviceHealth: (deviceId: string) => Promise<any>;
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<any>;
      getAppVersion: () => Promise<any>;
      onOpenCamera: (callback: (deviceId: string) => void) => void;
      onCameraUpdate: (callback: (data: any) => void) => void;
      onLiveSnapshot: (callback: (data: { deviceId: string; snapshot: string }) => void) => void;
      removeLiveSnapshotListener: () => void;
      onLiveVideoData: (callback: (data: { deviceId: string; data: string }) => void) => void;
      removeLiveVideoDataListener: () => void;
    };
  }
}
