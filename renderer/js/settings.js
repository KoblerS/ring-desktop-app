// Settings page logic
const backBtn = document.getElementById('back-btn');
const logoutBtn = document.getElementById('logout-btn');
const checkUpdatesBtn = document.getElementById('check-updates-btn');
const downloadUpdateBtn = document.getElementById('download-update-btn');
const installUpdateBtn = document.getElementById('install-update-btn');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Update UI elements
const updateTitle = document.getElementById('update-title');
const updateDescription = document.getElementById('update-description');
const updateProgress = document.getElementById('update-progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

// Account elements
const accountName = document.getElementById('account-name');
const accountEmail = document.getElementById('account-email');

// Track update state
let pendingUpdateVersion = null;

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
  checkUpdatesBtn.addEventListener('click', checkForUpdates);

  // Download update
  downloadUpdateBtn.addEventListener('click', downloadUpdate);

  // Install update
  installUpdateBtn.addEventListener('click', installUpdate);

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

// Load user profile
async function loadProfile() {
  try {
    const result = await window.ringAPI.getProfile();
    if (result.success && result.profile) {
      const profile = result.profile;
      // Display the email
      if (profile.email) {
        accountEmail.textContent = profile.email;
      } else {
        accountEmail.textContent = 'Connected';
      }
      // Display name if available
      if (profile.first_name || profile.last_name) {
        accountName.textContent = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
      }
    } else {
      accountEmail.textContent = 'Connected';
    }
  } catch (error) {
    console.error('Error loading profile:', error);
    accountEmail.textContent = 'Connected';
  }
}

// Setup auto-update listeners
function setupUpdateListeners() {
  window.ringAPI.onUpdateStatus((data) => {
    console.log('Update status:', data);
    
    switch (data.status) {
      case 'checking':
        updateTitle.textContent = 'Checking for Updates';
        updateDescription.textContent = 'Looking for new versions...';
        checkUpdatesBtn.disabled = true;
        checkUpdatesBtn.textContent = 'Checking...';
        break;
        
      case 'available':
        pendingUpdateVersion = data.version;
        updateTitle.textContent = 'Update Available';
        updateDescription.textContent = `Version ${data.version} is available`;
        checkUpdatesBtn.style.display = 'none';
        downloadUpdateBtn.style.display = 'inline-block';
        break;
        
      case 'not-available':
        updateTitle.textContent = 'Up to Date';
        updateDescription.textContent = 'You\'re running the latest version';
        checkUpdatesBtn.disabled = false;
        checkUpdatesBtn.textContent = 'Check Now';
        showToast('You\'re running the latest version');
        break;
        
      case 'downloading':
        updateTitle.textContent = 'Downloading Update';
        const percent = Math.round(data.percent || 0);
        updateDescription.textContent = `Downloading version ${pendingUpdateVersion}...`;
        updateProgress.style.display = 'flex';
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `${percent}%`;
        downloadUpdateBtn.style.display = 'none';
        break;
        
      case 'downloaded':
        updateTitle.textContent = 'Update Ready';
        updateDescription.textContent = `Version ${data.version || pendingUpdateVersion} is ready to install`;
        updateProgress.style.display = 'none';
        installUpdateBtn.style.display = 'inline-block';
        showToast('Update downloaded! Click "Install & Restart" to update.');
        break;
        
      case 'error':
        updateTitle.textContent = 'Update Error';
        updateDescription.textContent = data.error || 'Failed to check for updates';
        checkUpdatesBtn.disabled = false;
        checkUpdatesBtn.textContent = 'Try Again';
        checkUpdatesBtn.style.display = 'inline-block';
        downloadUpdateBtn.style.display = 'none';
        updateProgress.style.display = 'none';
        break;
    }
  });
}

// Check for updates
async function checkForUpdates() {
  try {
    checkUpdatesBtn.disabled = true;
    checkUpdatesBtn.textContent = 'Checking...';
    const result = await window.ringAPI.checkForUpdates();
    if (!result.success) {
      updateDescription.textContent = result.error || 'Failed to check for updates';
      checkUpdatesBtn.disabled = false;
      checkUpdatesBtn.textContent = 'Try Again';
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
    updateDescription.textContent = 'Failed to check for updates';
    checkUpdatesBtn.disabled = false;
    checkUpdatesBtn.textContent = 'Try Again';
  }
}

// Download update
async function downloadUpdate() {
  try {
    downloadUpdateBtn.disabled = true;
    downloadUpdateBtn.textContent = 'Starting...';
    const result = await window.ringAPI.downloadUpdate();
    if (!result.success) {
      showToast('Failed to download update');
      downloadUpdateBtn.disabled = false;
      downloadUpdateBtn.textContent = 'Download';
    }
  } catch (error) {
    console.error('Error downloading update:', error);
    showToast('Failed to download update');
    downloadUpdateBtn.disabled = false;
    downloadUpdateBtn.textContent = 'Download';
  }
}

// Install update
function installUpdate() {
  window.ringAPI.installUpdate();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadAppVersion();
  loadProfile();
  setupEventListeners();
  setupUpdateListeners();
});
