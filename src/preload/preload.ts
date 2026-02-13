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
      getDeviceHealth: (deviceId: string) => Promise<any>;
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<any>;
      getAppVersion: () => Promise<any>;
      onOpenCamera: (callback: (deviceId: string) => void) => void;
      onCameraUpdate: (callback: (data: any) => void) => void;
      onLiveSnapshot: (callback: (data: { deviceId: string; snapshot: string }) => void) => void;
      removeLiveSnapshotListener: () => void;
    };
  }
}
