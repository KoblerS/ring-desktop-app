// Settings page logic
const backBtn = document.getElementById('back-btn');
const logoutBtn = document.getElementById('logout-btn');
const checkUpdatesBtn = document.getElementById('check-updates-btn');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Setting elements
const notificationsEnabled = document.getElementById('notifications-enabled');
const doorbellAlerts = document.getElementById('doorbell-alerts');
const motionAlerts = document.getElementById('motion-alerts');
const notificationSound = document.getElementById('notification-sound');
const notificationSnapshot = document.getElementById('notification-snapshot');
const launchAtLogin = document.getElementById('launch-at-login');
const startMinimized = document.getElementById('start-minimized');
const snapshotInterval = document.getElementById('snapshot-interval');
const liveViewQuality = document.getElementById('live-view-quality');

// Load settings on page load
async function loadSettings() {
  try {
    const result = await window.ringAPI.getSettings();
    if (result.success && result.settings) {
      const settings = result.settings;
      
      // Apply settings to UI
      notificationsEnabled.checked = settings.notificationsEnabled ?? true;
      doorbellAlerts.checked = settings.doorbellAlerts ?? true;
      motionAlerts.checked = settings.motionAlerts ?? true;
      notificationSound.checked = settings.notificationSound ?? true;
      notificationSnapshot.checked = settings.notificationSnapshot ?? true;
      launchAtLogin.checked = settings.launchAtLogin ?? false;
      startMinimized.checked = settings.startMinimized ?? false;
      snapshotInterval.value = settings.snapshotInterval?.toString() ?? '60';
      liveViewQuality.value = settings.liveViewQuality?.toString() ?? '2000';
      
      // Update dependent toggles state
      updateDependentToggles();
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Save settings
async function saveSettings() {
  const settings = {
    notificationsEnabled: notificationsEnabled.checked,
    doorbellAlerts: doorbellAlerts.checked,
    motionAlerts: motionAlerts.checked,
    notificationSound: notificationSound.checked,
    notificationSnapshot: notificationSnapshot.checked,
    launchAtLogin: launchAtLogin.checked,
    startMinimized: startMinimized.checked,
    snapshotInterval: parseInt(snapshotInterval.value),
    liveViewQuality: parseInt(liveViewQuality.value)
  };

  try {
    const result = await window.ringAPI.saveSettings(settings);
    if (result.success) {
      showToast('Settings saved');
    } else {
      showToast('Failed to save settings');
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    showToast('Error saving settings');
  }
}

// Update dependent toggles (disable sub-options when main toggle is off)
function updateDependentToggles() {
  const notificationsDisabled = !notificationsEnabled.checked;
  
  doorbellAlerts.disabled = notificationsDisabled;
  motionAlerts.disabled = notificationsDisabled;
  notificationSound.disabled = notificationsDisabled;
  notificationSnapshot.disabled = notificationsDisabled;
  
  // Visual feedback for disabled state
  const notificationItems = document.querySelectorAll('.settings-section:first-of-type .settings-item');
  notificationItems.forEach((item, index) => {
    if (index > 0) { // Skip the main toggle
      item.style.opacity = notificationsDisabled ? '0.5' : '1';
    }
  });
}

// Show toast notification
function showToast(message) {
  toastMessage.textContent = message;
  toast.classList.add('visible', 'success');
  
  setTimeout(() => {
    toast.classList.remove('visible', 'success');
  }, 3000);
}

// Setup event listeners
function setupEventListeners() {
  // Back button
  backBtn.addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });

  // Logout button
  logoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to sign out?')) {
      await window.ringAPI.logout();
      window.location.href = 'login.html';
    }
  });

  // Check for updates
  checkUpdatesBtn.addEventListener('click', () => {
    showToast('You\'re running the latest version');
  });

  // Auto-save on any setting change
  const allInputs = [
    notificationsEnabled,
    doorbellAlerts,
    motionAlerts,
    notificationSound,
    notificationSnapshot,
    launchAtLogin,
    startMinimized
  ];

  allInputs.forEach(input => {
    input.addEventListener('change', () => {
      if (input === notificationsEnabled) {
        updateDependentToggles();
      }
      saveSettings();
    });
  });

  // Select dropdowns
  snapshotInterval.addEventListener('change', saveSettings);
  liveViewQuality.addEventListener('change', saveSettings);

  // Keyboard shortcut to go back
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.location.href = 'dashboard.html';
    }
  });
}

// Load app version
async function loadAppVersion() {
  try {
    const result = await window.ringAPI.getAppVersion();
    if (result.success) {
      document.getElementById('app-version').textContent = `Ring Desktop v${result.version}`;
    }
  } catch (error) {
    console.error('Error loading app version:', error);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadAppVersion();
  setupEventListeners();
});
