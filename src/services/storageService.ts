import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';

export interface AppSettings {
  // Notifications
  notificationsEnabled: boolean;
  doorbellAlerts: boolean;
  motionAlerts: boolean;
  notificationSound: boolean;
  notificationSnapshot: boolean;
  // App behavior
  launchAtLogin: boolean;
  startMinimized: boolean;
  // Performance
  snapshotInterval: number; // seconds
  liveViewQuality: number; // milliseconds between frames
}

interface StoredData {
  refreshToken?: string;
  settings?: AppSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  notificationsEnabled: true,
  doorbellAlerts: true,
  motionAlerts: true,
  notificationSound: true,
  notificationSnapshot: true,
  launchAtLogin: false,
  startMinimized: false,
  snapshotInterval: 60,
  liveViewQuality: 2000
};

export class StorageService {
  private storagePath: string;
  private encryptionKey: Buffer;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.storagePath = path.join(userDataPath, 'ring-data.enc');
    // Use machine-specific key derivation
    this.encryptionKey = this.deriveKey();
  }

  private deriveKey(): Buffer {
    // Create a deterministic key based on machine info
    const machineId = process.env.USER || process.env.USERNAME || 'ring-desktop';
    return crypto.scryptSync(machineId + 'ring-desktop-salt', 'ring-salt', 32);
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(encryptedText: string): string {
    const [ivHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private readData(): StoredData {
    try {
      if (fs.existsSync(this.storagePath)) {
        const encryptedData = fs.readFileSync(this.storagePath, 'utf8');
        const decryptedData = this.decrypt(encryptedData);
        return JSON.parse(decryptedData);
      }
    } catch (error) {
      console.error('Error reading stored data:', error);
    }
    return {};
  }

  private writeData(data: StoredData): void {
    try {
      const jsonData = JSON.stringify(data);
      const encryptedData = this.encrypt(jsonData);
      fs.writeFileSync(this.storagePath, encryptedData, 'utf8');
    } catch (error) {
      console.error('Error writing stored data:', error);
    }
  }

  saveRefreshToken(token: string): void {
    const data = this.readData();
    data.refreshToken = token;
    this.writeData(data);
  }

  getRefreshToken(): string | null {
    const data = this.readData();
    return data.refreshToken || null;
  }

  clearCredentials(): void {
    const data = this.readData();
    delete data.refreshToken;
    this.writeData(data);
  }

  saveSettings(settings: AppSettings): void {
    const data = this.readData();
    data.settings = settings;
    this.writeData(data);
  }

  getSettings(): AppSettings {
    const data = this.readData();
    // Merge with defaults to ensure all fields exist
    return { ...DEFAULT_SETTINGS, ...data.settings };
  }
}
