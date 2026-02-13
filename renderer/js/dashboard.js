// Dashboard page logic
const cameraGrid = document.getElementById('camera-grid');
const emptyState = document.getElementById('empty-state');
const refreshBtn = document.getElementById('refresh-btn');
const userMenu = document.getElementById('user-menu');
const userDropdown = document.getElementById('user-dropdown');
const logoutBtn = document.getElementById('logout-btn');
const streamModal = document.getElementById('stream-modal');
const closeStreamBtn = document.getElementById('close-stream');
const streamVideo = document.getElementById('stream-video');
const streamLoading = document.getElementById('stream-loading');
const streamCameraName = document.getElementById('stream-camera-name');
const toggleMuteBtn = document.getElementById('toggle-mute');
const toggleFullscreenBtn = document.getElementById('toggle-fullscreen');
const takeSnapshotBtn = document.getElementById('take-snapshot');
const settingsBtn = document.getElementById('settings-btn');

let cameras = [];
let currentStreamCameraId = null;
let isMuted = true;
let snapshotCache = {};
let isStreaming = false;
let peerConnection = null;
let mediaSource = null;
let sourceBuffer = null;
let videoDataQueue = [];

// Initialize dashboard
async function initialize() {
  await loadCameras();
  setupEventListeners();
  startSnapshotRefresh();
}

// Load cameras from Ring API
async function loadCameras() {
  try {
    const result = await window.ringAPI.getCameras();
    
    if (result.success) {
      cameras = result.cameras;
      renderCameras();
    } else {
      console.error('Failed to load cameras:', result.error);
      showError('Failed to load cameras. Please try again.');
    }
  } catch (error) {
    console.error('Error loading cameras:', error);
    showError('An error occurred while loading cameras.');
  }
}

// Render camera cards
function renderCameras() {
  if (cameras.length === 0) {
    cameraGrid.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  cameraGrid.style.display = 'grid';
  emptyState.style.display = 'none';

  cameraGrid.innerHTML = cameras.map(camera => `
    <div class="camera-card" data-camera-id="${camera.id}">
      <div class="camera-preview">
        <div class="placeholder" id="placeholder-${camera.id}">
          <svg viewBox="0 0 24 24">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
          <span>Loading preview...</span>
        </div>
        <img id="snapshot-${camera.id}" src="" alt="${camera.name}" style="display: none;">
        <div class="camera-status ${camera.isOnline ? '' : 'offline'}">
          <span class="dot"></span>
          <span>${camera.isOnline ? 'Online' : 'Offline'}</span>
        </div>
        <div class="camera-actions">
          <button class="camera-action-btn live-btn" data-camera-id="${camera.id}" title="Live View">
            <svg viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
          <button class="camera-action-btn refresh-snapshot-btn" data-camera-id="${camera.id}" title="Refresh Snapshot">
            <svg viewBox="0 0 24 24">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="camera-info">
        <div class="camera-name">${camera.name}</div>
        <div class="camera-details">
          <span class="device-type">${formatDeviceType(camera.deviceType)}</span>
          ${camera.hasBattery && camera.batteryLevel !== null ? `
            <span class="battery ${getBatteryClass(camera.batteryLevel)}">
              <svg viewBox="0 0 24 24">
                <path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z"/>
              </svg>
              ${camera.batteryLevel}%
            </span>
          ` : ''}
        </div>
      </div>
    </div>
  `).join('');

  // Load snapshots for all cameras
  cameras.forEach(camera => loadSnapshot(camera.id));
  
  // Add click handlers for camera cards
  document.querySelectorAll('.camera-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't open stream if clicking action buttons
      if (e.target.closest('.camera-action-btn')) return;
      const cameraId = card.dataset.cameraId;
      openLiveStream(cameraId);
    });
  });

  // Add click handlers for live view buttons
  document.querySelectorAll('.live-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cameraId = btn.dataset.cameraId;
      openLiveStream(cameraId);
    });
  });

  // Add click handlers for refresh snapshot buttons
  document.querySelectorAll('.refresh-snapshot-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cameraId = btn.dataset.cameraId;
      loadSnapshot(cameraId, true);
    });
  });
}

// Format device type for display
function formatDeviceType(deviceType) {
  const types = {
    'doorbell': 'Doorbell',
    'doorbell_v3': 'Doorbell Pro',
    'doorbell_v4': 'Doorbell Pro 2',
    'doorbell_v5': 'Doorbell Plus',
    'doorbell_scallop': 'Doorbell Wired',
    'doorbell_scallop_lite': 'Video Doorbell',
    'lpd_v1': 'Doorbell Elite',
    'lpd_v2': 'Doorbell Pro',
    'stickup_cam': 'Stick Up Cam',
    'stickup_cam_v3': 'Stick Up Cam Battery',
    'stickup_cam_elite': 'Stick Up Cam Elite',
    'stickup_cam_lunar': 'Stick Up Cam Plugin',
    'spotlightw_v2': 'Spotlight Cam',
    'hp_cam_v1': 'Floodlight Cam',
    'hp_cam_v2': 'Floodlight Cam Pro'
  };
  return types[deviceType] || deviceType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Get battery class based on level
function getBatteryClass(level) {
  if (level <= 10) return 'critical';
  if (level <= 30) return 'low';
  return '';
}

// Load snapshot for a camera
async function loadSnapshot(cameraId, forceRefresh = false) {
  // Use cache if available and not forcing refresh
  if (!forceRefresh && snapshotCache[cameraId]) {
    displaySnapshot(cameraId, snapshotCache[cameraId]);
    return;
  }

  try {
    const result = await window.ringAPI.getSnapshot(cameraId);
    
    if (result.success && result.snapshot) {
      snapshotCache[cameraId] = result.snapshot;
      displaySnapshot(cameraId, result.snapshot);
    }
  } catch (error) {
    console.error(`Error loading snapshot for camera ${cameraId}:`, error);
  }
}

// Display snapshot image
function displaySnapshot(cameraId, base64Data) {
  const placeholder = document.getElementById(`placeholder-${cameraId}`);
  const img = document.getElementById(`snapshot-${cameraId}`);
  
  if (placeholder && img) {
    img.src = `data:image/jpeg;base64,${base64Data}`;
    img.style.display = 'block';
    placeholder.style.display = 'none';
  }
}

// Start periodic snapshot refresh
function startSnapshotRefresh() {
  setInterval(() => {
    cameras.forEach(camera => loadSnapshot(camera.id));
  }, 60000); // Refresh every minute
}

// Open live stream modal
async function openLiveStream(cameraId) {
  const camera = cameras.find(c => c.id === cameraId);
  if (!camera) return;

  currentStreamCameraId = cameraId;
  streamCameraName.textContent = camera.name;
  streamModal.classList.add('visible');
  
  // Reset state
  isMuted = true;
  toggleMuteBtn.classList.remove('active');
  
  // Show loading state
  streamLoading.style.display = 'flex';
  streamLoading.innerHTML = `
    <div class="loading-spinner"></div>
    <p class="loading-text">Connecting to ${camera.name}...</p>
  `;
  
  // Hide any existing live image
  const existingLiveImg = document.getElementById('live-stream-img');
  if (existingLiveImg) {
    existingLiveImg.style.display = 'none';
  }
  
  // Show video element
  streamVideo.style.display = 'block';
  streamVideo.muted = true;

  const liveIndicator = document.getElementById('live-indicator');

  try {
    // Try real live streaming via startLiveCall + ffmpeg
    console.log('Starting real live stream...');
    const realStreamSuccess = await startRealLiveStream(cameraId);
    
    if (realStreamSuccess) {
      isStreaming = true;
      streamLoading.style.display = 'none';
      if (liveIndicator) liveIndicator.style.display = 'flex';
    } else {
      // Fallback to snapshot streaming
      console.log('Real live stream failed, falling back to snapshot streaming');
      await startSnapshotFallback(cameraId, camera.name);
    }
  } catch (error) {
    console.error('Error opening live stream:', error);
    // Try snapshot fallback
    await startSnapshotFallback(cameraId, camera.name);
  }
}

// Start WebRTC stream
async function startWebRTCStream(cameraId) {
  try {
    // Create WebRTC session on the main process
    const createResult = await window.ringAPI.createWebRtcSession(cameraId);
    if (!createResult.success) {
      console.error('Failed to create WebRTC session:', createResult.error);
      return false;
    }

    console.log('WebRTC session created:', createResult.sessionId);

    // Create peer connection - Ring provides ICE candidates in SDP
    peerConnection = new RTCPeerConnection({
      iceServers: [] // Ring includes ICE candidates directly in SDP
    });

    // Create a MediaStream to collect tracks
    const mediaStream = new MediaStream();

    // Handle incoming tracks
    peerConnection.ontrack = (event) => {
      console.log('Received track:', event.track.kind, 'readyState:', event.track.readyState);
      
      // Add track to our stream
      mediaStream.addTrack(event.track);
      console.log('MediaStream now has', mediaStream.getTracks().length, 'tracks');
      
      // Set srcObject if not already set
      if (!streamVideo.srcObject) {
        streamVideo.srcObject = mediaStream;
      }
      
      // Try to play when we have video
      if (event.track.kind === 'video') {
        streamVideo.play().catch(e => console.error('Error playing video:', e));
      }
      
      // Monitor track state
      event.track.onmute = () => console.log('Track muted:', event.track.kind);
      event.track.onunmute = () => console.log('Track unmuted:', event.track.kind);
      event.track.onended = () => console.log('Track ended:', event.track.kind);
    };

    // Log ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnection.iceConnectionState);
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
    };

    peerConnection.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', peerConnection.iceGatheringState);
    };

    // Add transceivers for receiving audio and video
    peerConnection.addTransceiver('audio', { direction: 'recvonly' });
    peerConnection.addTransceiver('video', { direction: 'recvonly' });

    // Create offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    console.log('Local SDP offer created');
    console.log('SDP Offer preview:', offer.sdp.substring(0, 300));

    // Send offer to Ring and get answer
    const startResult = await window.ringAPI.startWebRtcSession(cameraId, offer.sdp);

    if (!startResult.success) {
      console.error('Failed to start WebRTC session:', startResult.error);
      peerConnection.close();
      peerConnection = null;
      return false;
    }

    console.log('Received SDP answer from Ring');
    console.log('SDP Answer preview:', startResult.sdpAnswer.substring(0, 300));

    // Set remote description
    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: startResult.sdpAnswer
    });

    console.log('Remote description set');

    // Wait for connection or timeout
    const success = await waitForConnection(10000);
    
    if (!success) {
      console.log('WebRTC connection failed or timed out');
      peerConnection.close();
      peerConnection = null;
      return false;
    }

    console.log('WebRTC stream started successfully');
    return true;
  } catch (error) {
    console.error('WebRTC streaming error:', error);
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    return false;
  }
}

// Wait for WebRTC connection to establish
function waitForConnection(timeoutMs) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const checkConnection = () => {
      if (!peerConnection) {
        resolve(false);
        return;
      }

      const iceState = peerConnection.iceConnectionState;
      const connState = peerConnection.connectionState;
      
      // Check for successful connection
      if (iceState === 'connected' || iceState === 'completed') {
        resolve(true);
        return;
      }
      
      // Check for failure
      if (iceState === 'failed' || connState === 'failed') {
        resolve(false);
        return;
      }
      
      // Check for timeout
      if (Date.now() - startTime > timeoutMs) {
        console.log('Connection timeout. Final ICE state:', iceState);
        resolve(false);
        return;
      }
      
      // Keep checking
      setTimeout(checkConnection, 100);
    };
    
    checkConnection();
  });
}

// Start real live stream using Node.js WebRTC + ffmpeg transcoding to HLS
async function startRealLiveStream(cameraId) {
  try {
    // Start the stream on the main process
    console.log('Starting real live stream on main process...');
    const result = await window.ringAPI.startRealLiveStream(cameraId);

    if (!result.success) {
      console.error('Failed to start real live stream:', result.error);
      return false;
    }

    console.log('Real live stream started, HLS URL:', result.hlsUrl);

    // Load HLS.js dynamically if not already loaded
    if (!window.Hls) {
      await loadHlsJs();
    }

    if (window.Hls && Hls.isSupported()) {
      // Use HLS.js for playback
      if (window.hlsPlayer) {
        window.hlsPlayer.destroy();
      }

      window.hlsPlayer = new Hls({
        liveDurationInfinity: true,
        liveBackBufferLength: 0,
        maxBufferLength: 5,
        maxMaxBufferLength: 10,
        lowLatencyMode: true,
      });

      // Use custom protocol for HLS files
      const hlsUrl = `hls://${cameraId}/stream.m3u8`;
      
      window.hlsPlayer.loadSource(hlsUrl);
      window.hlsPlayer.attachMedia(streamVideo);

      window.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed, starting playback...');
        streamVideo.play().catch(e => console.log('Autoplay blocked:', e));
      });

      window.hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('Network error, trying to recover...');
              window.hlsPlayer.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('Media error, trying to recover...');
              window.hlsPlayer.recoverMediaError();
              break;
            default:
              console.error('Fatal HLS error, cannot recover');
              break;
          }
        }
      });
    } else if (streamVideo.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      streamVideo.src = `hls://${cameraId}/stream.m3u8`;
      streamVideo.play().catch(e => console.log('Autoplay blocked:', e));
    } else {
      console.error('HLS not supported in this browser');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error starting real live stream:', error);
    return false;
  }
}

// Load HLS.js library dynamically
async function loadHlsJs() {
  return new Promise((resolve, reject) => {
    if (window.Hls) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Fallback to snapshot-based streaming
async function startSnapshotFallback(cameraId, cameraName) {
  const liveIndicator = document.getElementById('live-indicator');
  
  // Hide video, show image element
  streamVideo.style.display = 'none';
  
  let liveImg = document.getElementById('live-stream-img');
  if (!liveImg) {
    liveImg = document.createElement('img');
    liveImg.id = 'live-stream-img';
    liveImg.style.cssText = 'width: 100%; height: 100%; object-fit: contain; display: none;';
    streamVideo.parentElement.appendChild(liveImg);
  }

  try {
    // Remove any existing listener
    window.ringAPI.removeLiveSnapshotListener();
    
    // Set up listener for live snapshots
    window.ringAPI.onLiveSnapshot((data) => {
      if (data.deviceId === currentStreamCameraId && data.snapshot) {
        liveImg.src = `data:image/jpeg;base64,${data.snapshot}`;
        liveImg.style.display = 'block';
        streamLoading.style.display = 'none';
        if (liveIndicator) liveIndicator.style.display = 'flex';
      }
    });

    // Start the snapshot stream
    const result = await window.ringAPI.startSnapshotStream(cameraId);
    
    if (result.success) {
      isStreaming = true;
      
      if (result.snapshot) {
        liveImg.src = `data:image/jpeg;base64,${result.snapshot}`;
        liveImg.style.display = 'block';
        streamLoading.style.display = 'none';
        if (liveIndicator) liveIndicator.style.display = 'flex';
      }
    } else {
      showStreamError(result.error);
    }
  } catch (error) {
    console.error('Snapshot fallback error:', error);
    showStreamError('Failed to connect to camera');
  }
}

// Show stream error
function showStreamError(message) {
  streamLoading.innerHTML = `
    <svg viewBox="0 0 24 24" style="width: 48px; height: 48px; fill: var(--text-muted); margin-bottom: 16px;">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
    </svg>
    <p class="loading-text">Unable to connect to camera</p>
    <p class="loading-text" style="font-size: 12px; margin-top: 8px; color: var(--text-muted);">${message || 'Please try again later.'}</p>
  `;
}

// Close live stream modal
async function closeLiveStream() {
  // Stop real live stream
  if (currentStreamCameraId) {
    try {
      await window.ringAPI.stopRealLiveStream(currentStreamCameraId);
    } catch (error) {
      console.error('Error stopping real live stream:', error);
    }
  }

  // Stop WebRTC connection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  // Stop WebRTC session on main process
  if (currentStreamCameraId) {
    try {
      await window.ringAPI.stopWebRtcSession(currentStreamCameraId);
    } catch (error) {
      console.error('Error stopping WebRTC session:', error);
    }
  }

  // Stop snapshot stream if it was used as fallback
  if (currentStreamCameraId && isStreaming) {
    try {
      await window.ringAPI.stopSnapshotStream(currentStreamCameraId);
    } catch (error) {
      console.error('Error stopping snapshot stream:', error);
    }
  }
  
  // Remove listeners
  window.ringAPI.removeLiveSnapshotListener();
  window.ringAPI.removeLiveVideoDataListener();
  
  // Clean up MediaSource
  if (mediaSource) {
    try {
      if (mediaSource.readyState === 'open') {
        mediaSource.endOfStream();
      }
    } catch (e) {}
    mediaSource = null;
    sourceBuffer = null;
    videoDataQueue = [];
  }
  
  streamModal.classList.remove('visible');
  currentStreamCameraId = null;
  isStreaming = false;
  
  // Reset video element
  streamVideo.srcObject = null;
  streamVideo.src = '';
  streamVideo.style.display = 'block';
  
  // Reset live image
  const liveImg = document.getElementById('live-stream-img');
  if (liveImg) {
    liveImg.style.display = 'none';
    liveImg.src = '';
  }
  
  // Hide live indicator
  const liveIndicator = document.getElementById('live-indicator');
  if (liveIndicator) {
    liveIndicator.style.display = 'none';
  }
}

// Toggle audio mute/unmute
async function toggleMute() {
  isMuted = !isMuted;
  streamVideo.muted = isMuted;
  toggleMuteBtn.classList.toggle('active', !isMuted);

  // If unmuting, activate camera speaker for two-way audio
  if (!isMuted && currentStreamCameraId) {
    try {
      await window.ringAPI.activateCameraSpeaker(currentStreamCameraId);
    } catch (error) {
      console.error('Error activating camera speaker:', error);
    }
  }
}

// Setup event listeners
function setupEventListeners() {
  // Refresh cameras
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    await loadCameras();
    refreshBtn.disabled = false;
  });

  // User menu dropdown
  userMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = userMenu.getBoundingClientRect();
    userDropdown.style.top = `${rect.bottom + 8}px`;
    userDropdown.style.right = `${window.innerWidth - rect.right}px`;
    userDropdown.style.display = userDropdown.style.display === 'none' ? 'block' : 'none';
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    userDropdown.style.display = 'none';
  });

  // Logout
  logoutBtn.addEventListener('click', async () => {
    await window.ringAPI.logout();
    window.location.href = 'login.html';
  });

  // Settings
  settingsBtn.addEventListener('click', () => {
    window.location.href = 'settings.html';
  });

  // Close stream modal
  closeStreamBtn.addEventListener('click', closeLiveStream);
  streamModal.addEventListener('click', (e) => {
    if (e.target === streamModal) {
      closeLiveStream();
    }
  });

  // Stream controls
  toggleMuteBtn.addEventListener('click', toggleMute);

  toggleFullscreenBtn.addEventListener('click', () => {
    const modalContent = streamModal.querySelector('.modal-content');
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      modalContent.requestFullscreen();
    }
  });

  takeSnapshotBtn.addEventListener('click', async () => {
    if (currentStreamCameraId) {
      // Get fresh snapshot and save to downloads
      const result = await window.ringAPI.getSnapshot(currentStreamCameraId);
      if (result.success && result.snapshot) {
        // Create download link
        const link = document.createElement('a');
        link.href = `data:image/jpeg;base64,${result.snapshot}`;
        link.download = `ring-snapshot-${currentStreamCameraId}-${Date.now()}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Update cache
        snapshotCache[currentStreamCameraId] = result.snapshot;
      }
    }
  });

  // Listen for camera open events from notifications
  window.ringAPI.onOpenCamera((cameraId) => {
    openLiveStream(cameraId);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && streamModal.classList.contains('visible')) {
      closeLiveStream();
    }
    // M key to toggle mute when stream is open
    if (e.key === 'm' && streamModal.classList.contains('visible')) {
      toggleMute();
    }
    // F key to toggle fullscreen when stream is open
    if (e.key === 'f' && streamModal.classList.contains('visible')) {
      toggleFullscreenBtn.click();
    }
  });

  // Handle window resize for responsive modal
  window.addEventListener('resize', handleModalResize);
}

// Handle modal resize for responsiveness
function handleModalResize() {
  // The CSS handles most of the responsiveness
  // This function can be used for additional JS-based adjustments if needed
}

// Show error message (could be improved with a toast notification)
function showError(message) {
  console.error(message);
  // For now, just log - could implement toast notifications
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initialize);
