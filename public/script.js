// Wait for language manager to be available
function initializeVideoChat() {
    if (window.languageManager) {
        // Detect mobile device
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const isSlowConnection = navigator.connection ?
            (navigator.connection.downlink < 2 || navigator.connection.effectiveType === 'slow-2g' || navigator.connection.effectiveType === '2g') :
            false;

        console.log(`Device: Mobile=${isMobile}, SlowConnection=${isSlowConnection}`);

        new VideoChat(isMobile, isSlowConnection);
    } else {
        // Retry after a short delay
        setTimeout(initializeVideoChat, 100);
    }
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeVideoChat);

// Enhanced notification system with rate limiting
class NotificationManager {
    constructor() {
        this.lastNotificationTime = 0;
        this.notificationCooldown = 3000; // 3 seconds between similar notifications
        this.pendingNotifications = new Map();
        this.connectionNotificationState = {
            lastConnectionTime: 0,
            lastDisconnectionTime: 0,
            consecutiveDisconnections: 0
        };
    }

    canShowNotification(type, message) {
        const now = Date.now();

        // Rate limit connection/disconnection notifications
        if (type === 'connection' || type === 'disconnection') {
            const lastTime = type === 'connection' ?
                this.connectionNotificationState.lastConnectionTime :
                this.connectionNotificationState.lastDisconnectionTime;

            if (now - lastTime < 10000) { // 10 second cooldown for connection events
                console.log(`Suppressing ${type} notification (rate limit)`);
                return false;
            }

            // Update state
            if (type === 'connection') {
                this.connectionNotificationState.lastConnectionTime = now;
                this.connectionNotificationState.consecutiveDisconnections = 0;
            } else {
                this.connectionNotificationState.lastDisconnectionTime = now;
                this.connectionNotificationState.consecutiveDisconnections++;

                // Suppress repeated disconnection notifications
                if (this.connectionNotificationState.consecutiveDisconnections > 2) {
                    console.log('Suppressing repeated disconnection notification');
                    return false;
                }
            }
        }

        // General cooldown for all notifications
        if (now - this.lastNotificationTime < this.notificationCooldown) {
            // Check if this is a different message type
            const isDifferentMessage = !this.pendingNotifications.has(message);
            if (!isDifferentMessage) {
                console.log('Suppressing duplicate notification:', message);
                return false;
            }
        }

        this.lastNotificationTime = now;
        this.pendingNotifications.set(message, now);

        // Clean up old pending notifications
        setTimeout(() => {
            this.pendingNotifications.delete(message);
        }, this.notificationCooldown);

        return true;
    }
}

// Initialize notification manager
window.notificationManager = new NotificationManager();

class VideoChat {
    constructor(isMobile = false, isSlowConnection = false) {
        this.isMobile = isMobile;
        this.isSlowConnection = isSlowConnection;
        this.notificationManager = window.notificationManager;

        // Enhanced connection settings for better stability
        this.connectionConfig = {
            iceServers: [
                // Comprehensive STUN servers list
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stun.services.mozilla.com:3478' },
                { urls: 'stun:stun.stunprotocol.org:3478' },
                { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
            ],
            iceCandidatePoolSize: isMobile ? 10 : 15, // More candidates for better connectivity
            iceTransportPolicy: 'all', // Use all for maximum compatibility
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            // Enhanced timeout settings
            iceCheckingTimeout: isMobile ? 10000 : 8000, // Longer timeout for mobile
            iceConnectionTimeout: isMobile ? 30000 : 25000, // Much longer connection timeout
            // Better ICE candidate gathering
            iceCandidatePoolSize: 10
        };

        // More aggressive but smarter reconnection
        if (this.isMobile) {
            this.maxReconnectionAttempts = 8;
            this.reconnectionBaseDelay = 2000;
        } else {
            this.maxReconnectionAttempts = 6;
            this.reconnectionBaseDelay = 1500;
        }

        // Connection quality monitoring
        this.connectionQuality = 'good';
        this.lastIceState = '';
        this.pingInterval = null;
        this.healthCheckInterval = null;
        this.iceRestartTimeout = null; 

        // Ensure language manager is available
        if (!window.languageManager) {
            console.error('Language manager not available');
            return;
        }

        // Store instance globally for language manager access
        window.currentVideoChat = this;

        // Enhanced socket connection with better options
        this.socket = io({
            transports: ['websocket', 'polling'],
            upgrade: true,
            rememberUpgrade: true,
            timeout: 45000,
            // Better reconnection settings
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            randomizationFactor: 0.5
        });

        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.audioContext = null;
        this.audioAnalyser = null;

        // Get room ID from URL path
        const pathParts = window.location.pathname.split('/');
        this.roomId = pathParts[pathParts.length - 1];

        // Validate room ID
        if (!this.roomId || this.roomId === 'chat') {
            console.error('Invalid room ID, redirecting to lounge');
            window.location.href = '/lounge?error=InvalidRoom';
            return;
        }

        this.userId = this.generateUserId();
        this.isConnected = false;
        this.qualityMode = 'balanced';
        this.statsInterval = null;
        this.reconnectionAttempts = 0;
        this.isRemoteAudioMuted = false;
        this.isLocalAudioMuted = false;
        this.mediaAccessGranted = false;

        console.log('Initializing video chat for room:', this.roomId);

        this.initializeElements();
        this.setupEventListeners();

        if (!this.checkBrowserSupport()) {
            return;
        }

        this.initiateConnection();
    }

    checkBrowserSupport() {
        // Better browser detection that includes iOS
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const isChromeIOS = /CriOS/.test(navigator.userAgent);
        const isFirefoxIOS = /FxiOS/.test(navigator.userAgent);

        // iOS Safari, Chrome iOS, and Firefox iOS all support WebRTC
        if (isIOS && (isSafari || isChromeIOS || isFirefoxIOS)) {
            return true;
        }

        // Standard WebRTC check for other browsers
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showBrowserError();
            return false;
        }

        if (!window.RTCPeerConnection) {
            this.showBrowserError();
            return false;
        }

        return true;
    }

    showBrowserError() {
        const errorHtml = `
            <div style="text-align: center; padding: 20px; color: white;">
                <h2>Browser Compatibility Issue</h2>
                <p>Your browser should support video calling, but there might be a permission issue.</p>
                <p>Please make sure:</p>
                <ul style="text-align: left; display: inline-block;">
                    <li>You've allowed camera and microphone access</li>
                    <li>You're using HTTPS (required for video)</li>
                    <li>Try refreshing the page</li>
                </ul>
                <button onclick="window.location.reload()" style="padding: 10px 20px; margin: 10px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    Try Again
                </button>
            </div>
        `;
        document.body.innerHTML = errorHtml;
    }

    generateUserId() {
        return 'user-' + Math.random().toString(36).substr(2, 9);
    }

    initializeElements() {
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.muteBtn = document.getElementById('muteBtn');
        this.selfMuteBtn = document.getElementById('selfMuteBtn');
        this.videoBtn = document.getElementById('videoBtn');
        this.qualityBtn = document.getElementById('qualityBtn');
        this.shareBtn = document.getElementById('shareBtn');
        this.leaveBtn = document.getElementById('leaveBtn');
        this.endCallBtn = document.getElementById('endCallBtn');
        this.chatInput = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.chatMessages = document.getElementById('chatMessages');
        this.remoteLabel = document.getElementById('remoteLabel');
        this.qualityIndicator = document.getElementById('qualityIndicator');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.languageSelect = document.getElementById('languageSelect');
        this.statsPanel = document.getElementById('statsPanel');
        this.statsHeader = document.getElementById('statsHeader');
        this.statsContent = document.getElementById('statsContent');

        // NEW: Get the preview video wrapper to hide/show it
        this.previewVideoWrapper = document.querySelector('.video-wrapper.preview-video');

        // Setup language selector if it exists
        if (this.languageSelect) {
            this.languageSelect.value = window.languageManager.currentLanguage;
            this.languageSelect.addEventListener('change', (e) => {
                window.languageManager.changeLanguage(e.target.value);
            });
        }

        // Setup stats header click for toggle
        if (this.statsHeader) {
            this.statsHeader.addEventListener('click', () => this.toggleStats());
            this.statsHeader.style.cursor = 'pointer';
        }

        // Hide stats content by default
        if (this.statsContent) {
            this.statsContent.style.display = 'none';
        }

        // Remove stats toggle button if it exists
        const statsToggleBtn = document.getElementById('statsToggleBtn');
        if (statsToggleBtn) {
            statsToggleBtn.style.display = 'none';
        }
    }

    setupEventListeners() {
        this.muteBtn.addEventListener('click', () => this.toggleRemoteAudio());
        this.selfMuteBtn.addEventListener('click', () => this.toggleLocalAudio());
        this.videoBtn.addEventListener('click', () => this.toggleVideo());
        this.qualityBtn.addEventListener('click', () => this.toggleQualityMode());
        this.shareBtn.addEventListener('click', () => this.shareLink());
        this.leaveBtn.addEventListener('click', () => this.leaveRoom());
        this.endCallBtn.addEventListener('click', () => this.endCall());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    }

    updateControlTexts() {
        if (!window.languageManager) return;

        // Update mute buttons
        this.muteBtn.textContent = this.isRemoteAudioMuted ?
            '🔊 ' + window.languageManager.translate('unmute') :
            '🔇 ' + window.languageManager.translate('mute');

        this.selfMuteBtn.textContent = this.isLocalAudioMuted ?
            '🎤 ' + window.languageManager.translate('unmuteSelf') :
            '🤫 ' + window.languageManager.translate('muteSelf');

        // Update video button
        const videoTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;
        const isVideoStopped = videoTrack ? !videoTrack.enabled : false;
        this.videoBtn.textContent = isVideoStopped ?
            '📹 ' + window.languageManager.translate('startVideo') :
            '📹 ' + window.languageManager.translate('stopVideo');

        // Update other buttons
        this.leaveBtn.textContent = '🚪 ' + window.languageManager.translate('leaveRoom');
        this.endCallBtn.textContent = '📞 ' + window.languageManager.translate('endCall');
        this.shareBtn.textContent = '🔗 ' + window.languageManager.translate('copyLink');

        // Update quality button
        const modeNames = {
            'balanced': 'balanced',
            'quality': 'highQuality',
            'bandwidth': 'lowBandwidth'
        };
        const qualityText = window.languageManager.translate('quality');
        const modeText = window.languageManager.translate(modeNames[this.qualityMode]);
        this.qualityBtn.textContent = `⚡ ${qualityText}: ${modeText}`;

        // Update labels
        this.updateRemoteLabel(this.isConnected ? 'partner' : 'waitingPartner');
    }

    async initiateConnection() {
        try {
            console.log('Starting connection initialization...');

            // First get media permissions
            await this.initializeMedia();
            this.mediaAccessGranted = true;

            // NEW: Hide local preview initially to prevent audio feedback
            this.hideLocalPreview();

            // Then setup WebRTC connection
            this.createPeerConnection();

            // Join room with callback for confirmation
            this.socket.emit('join-room', this.roomId, this.userId, (response) => {
                console.log('Join room response:', response);
                if (response && response.success) {
                    this.updateConnectionStatus('connecting');
                    this.setupReconnectionHandling();
                    this.setupLocalVideoDragAndResize();
                    this.setupScreenSizeControls();
                    this.updateControlTexts();

                    // If there are other users, try to connect immediately
                    if (response.otherUsers && response.otherUsers.length > 0) {
                        console.log('Other users in room, attempting connection...');
                        setTimeout(() => {
                            this.createOffer();
                        }, 1000);
                    }
                } else {
                    console.error('Failed to join room');
                    this.displaySystemMessage('Failed to join room. Please try again.', false, 'connection');
                }
            });

        } catch (error) {
            console.error('Error initiating connection:', error);
            this.displaySystemMessage(window.languageManager.translate('errorMediaAccess'), false, 'connection');
        }
    }

    // NEW: Method to hide local preview video
    hideLocalPreview() {
        if (this.previewVideoWrapper) {
            this.previewVideoWrapper.style.display = 'none';
            console.log('Local preview video hidden to prevent audio feedback');
        }
    }

    // NEW: Method to show local preview video
    showLocalPreview() {
        if (this.previewVideoWrapper) {
            this.previewVideoWrapper.style.display = 'block';
            console.log('Local preview video shown');
        }
    }

    // Enhanced media initialization with proper front camera selection
    async initializeMedia() {
        try {
            console.log('Requesting camera and microphone access with mobile optimization...');

            // Get device capabilities to choose the correct camera
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');

            // Prefer FRONT camera on mobile (user-facing)
            let preferredCamera = null;
            if (this.isMobile && videoDevices.length > 1) {
                // Look for front camera (usually labeled or we can detect by facingMode)
                for (const device of videoDevices) {
                    // Try to find front-facing camera
                    if (device.label.toLowerCase().includes('front') ||
                        device.label.toLowerCase().includes('face') ||
                        device.label.toLowerCase().includes('user')) {
                        preferredCamera = device.deviceId;
                        console.log('Found front camera:', device.label);
                        break;
                    }
                }
                // If no front camera found by label, use the first one (usually front on mobile)
                if (!preferredCamera && videoDevices.length > 0) {
                    preferredCamera = videoDevices[0].deviceId;
                    console.log('Using first available camera as front camera');
                }
            }

            // Enhanced constraints for mobile with front camera preference
            const constraints = {
                video: {
                    width: {
                        min: 320,
                        ideal: this.isMobile ? 640 : 1280,
                        max: this.isMobile ? 1920 : 3840
                    },
                    height: {
                        min: 240,
                        ideal: this.isMobile ? 480 : 720,
                        max: this.isMobile ? 1080 : 2160
                    },
                    frameRate: {
                        ideal: this.isMobile ? 20 : 24,
                        max: 30
                    },
                    aspectRatio: this.isMobile ? { ideal: 4/3 } : { ideal: 16/9 },
                    // FIX: Use 'user' for front camera, 'environment' for rear camera
                    facingMode: this.isMobile ? 'user' : 'user' // Always prefer front camera
                },
                audio: {
                    echoCancellation: { exact: true },
                    noiseSuppression: { exact: true },
                    autoGainControl: { exact: true },
                    channelCount: 1,
                    sampleRate: 48000,
                    sampleSize: 16,
                    volume: 0.7 // Slightly higher volume since we fixed feedback
                }
            };

            // Use preferred camera if available
            if (preferredCamera) {
                constraints.video.deviceId = { exact: preferredCamera };
                console.log('Using specific front camera:', preferredCamera);
            }

            // Further reduce quality for slow connections
            if (this.isSlowConnection) {
                constraints.video = {
                    width: { ideal: 480 },
                    height: { ideal: 360 },
                    frameRate: { ideal: 15 },
                    aspectRatio: this.isMobile ? { ideal: 4/3 } : { ideal: 16/9 },
                    facingMode: this.isMobile ? 'user' : 'user'
                };
            }

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('Camera and microphone access granted');

            // Verify which camera we're using
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                const settings = videoTrack.getSettings();
                console.log('Active camera settings:', settings);
                console.log('Camera label:', videoTrack.label);
            }

            // Apply mobile-specific video optimizations
            if (this.isMobile) {
                this.applyMobileVideoOptimizations();
            }

            // Apply audio feedback prevention
            this.applyAudioFeedbackPrevention();

            // NEW: Only set local video source, don't show it in remote section
            this.localVideo.srcObject = this.localStream;

            // NEW: Show waiting message in remote video section
            this.showWaitingForPartner();

        } catch (error) {
            console.error('Error accessing media devices:', error);

            // Fallback with simpler constraints but ensure front camera
            try {
                console.log('Trying with simpler front camera constraints...');
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: this.isMobile ? 640 : 1280 },
                        height: { ideal: this.isMobile ? 480 : 720 },
                        aspectRatio: this.isMobile ? { ideal: 4/3 } : { ideal: 16/9 },
                        facingMode: 'user' // Ensure front camera in fallback
                    },
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });

                if (this.isMobile) {
                    this.applyMobileVideoOptimizations();
                }

                this.applyAudioFeedbackPrevention();

                // NEW: Only set local video source, don't show it in remote section
                this.localVideo.srcObject = this.localStream;

                // NEW: Show waiting message in remote video section
                this.showWaitingForPartner();

                console.log('Camera and microphone access granted with fallback constraints');

            } catch (fallbackError) {
                console.error('Fallback also failed:', fallbackError);
                throw new Error('Cannot access camera/microphone. Please check permissions.');
            }
        }
    }

    // NEW: Method to show waiting message in remote video section
    showWaitingForPartner() {
        if (this.remoteVideo) {
            this.remoteVideo.srcObject = null;
            this.updateRemoteLabel('waitingPartner');
            this.updateQualityIndicator('Waiting', 'quality-medium');
            console.log('Showing waiting message in remote section');
        }
    }

    // Apply mobile-specific video optimizations to fix zoom issue
    applyMobileVideoOptimizations() {
        if (!this.localStream) return;

        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            console.log('Applying mobile video optimizations');

            // Get current settings to understand the camera capabilities
            const settings = videoTrack.getSettings();
            console.log('Mobile camera settings:', settings);

            // Try to apply constraints that prevent excessive zoom
            const optimizationConstraints = {
                // These constraints help prevent digital zoom on mobile
                width: { ideal: Math.min(640, settings.width || 640) },
                height: { ideal: Math.min(480, settings.height || 480) },
                frameRate: { ideal: 20 },
                aspectRatio: { ideal: 4/3 } // Most mobile cameras native aspect ratio
            };

            if (typeof videoTrack.applyConstraints === 'function') {
                videoTrack.applyConstraints(optimizationConstraints)
                    .then(() => {
                        console.log('Mobile video optimization constraints applied');
                    })
                    .catch(err => {
                        console.warn('Could not apply mobile video constraints:', err);
                    });
            }

            // Set CSS to prevent any additional zooming
            if (this.localVideo) {
                this.localVideo.style.objectFit = 'cover';
                this.localVideo.style.transform = 'scale(1.0)';
            }
        }
    }

    // New method to prevent audio feedback loops
    applyAudioFeedbackPrevention() {
        if (!this.localStream) return;

        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length > 0) {
            const audioTrack = audioTracks[0];

            // Apply audio constraints to reduce feedback
            const audioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                googEchoCancellation: true,
                googAutoGainControl: true,
                googNoiseSuppression: true,
                googHighpassFilter: true
            };

            // Try to apply advanced constraints if supported
            if (typeof audioTrack.applyConstraints === 'function') {
                audioTrack.applyConstraints({ advanced: [audioConstraints] })
                    .then(() => {
                        console.log('Audio feedback prevention constraints applied');
                    })
                    .catch(err => {
                        console.warn('Could not apply audio constraints:', err);
                    });
            }

            // Monitor audio levels and adjust if feedback is detected
            this.setupAudioLevelMonitoring();
        }
    }

    // Audio level monitoring to detect and prevent feedback
    setupAudioLevelMonitoring() {
        if (!this.localStream) return;

        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const analyser = audioContext.createAnalyser();
            const microphone = audioContext.createMediaStreamSource(this.localStream);
            const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

            analyser.smoothingTimeConstant = 0.8;
            analyser.fftSize = 1024;

            microphone.connect(analyser);
            analyser.connect(javascriptNode);
            javascriptNode.connect(audioContext.destination);

            let feedbackDetectionCount = 0;
            const feedbackThreshold = 5; // Number of consecutive high levels to trigger feedback detection

            javascriptNode.onaudioprocess = () => {
                const array = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(array);

                let values = 0;
                for (let i = 0; i < array.length; i++) {
                    values += array[i];
                }

                const average = values / array.length;

                // Detect potential feedback (consistently high audio levels)
                if (average > 200) { // High level threshold
                    feedbackDetectionCount++;
                    if (feedbackDetectionCount > feedbackThreshold) {
                        console.log('Potential audio feedback detected, applying countermeasures');
                        this.reduceAudioVolume();
                        feedbackDetectionCount = 0;
                    }
                } else {
                    feedbackDetectionCount = Math.max(0, feedbackDetectionCount - 1);
                }
            };

            // Store references for cleanup
            this.audioContext = audioContext;
            this.audioAnalyser = analyser;
        } catch (error) {
            console.warn('Audio level monitoring not supported:', error);
        }
    }

    // Reduce audio volume to prevent feedback
    reduceAudioVolume() {
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length > 0) {
            // This is a simple approach - in a real app you might use a GainNode
            console.log('Reducing audio volume to prevent feedback');
            this.displaySystemMessage('Adjusting audio to prevent echo', false, 'general');
        }
    }

    // Clean up audio monitoring
    cleanupAudioMonitoring() {
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        if (this.audioAnalyser) {
            this.audioAnalyser.disconnect();
            this.audioAnalyser = null;
        }
    }

    // Enhanced peer connection creation with better stability
    createPeerConnection() {
        console.log('Creating optimized peer connection');

        // Use server-provided ICE servers if available, otherwise fallback
        const iceServers = this.getIceServers();
        this.connectionConfig.iceServers = iceServers;

        this.peerConnection = new RTCPeerConnection(this.connectionConfig);

        // Create remote stream
        this.remoteStream = new MediaStream();

        // Apply mobile video styling to remote video as well
        if (this.isMobile && this.remoteVideo) {
            this.remoteVideo.style.objectFit = 'cover';
            this.remoteVideo.style.transform = 'scale(1.0)';
        }

        // Show waiting message instead of self video
        this.showWaitingForPartner();

        // Add local tracks to peer connection
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log('Adding local track to peer connection:', track.kind, track.id);
                this.peerConnection.addTrack(track, this.localStream);
            });
        } else {
            console.warn('No local stream available when creating peer connection');
        }

        // Enhanced remote track handling with better error recovery
        this.peerConnection.ontrack = (event) => {
            console.log('Received remote track event:', event);

            this.reconnectionAttempts = 0;
            this.connectionQuality = 'good';

            // Handle the remote stream with better error handling
            try {
                if (event.streams && event.streams[0]) {
                    console.log('Using remote stream from event:', event.streams[0].id);
                    this.remoteVideo.srcObject = event.streams[0];
                    this.remoteStream = event.streams[0];
                } else if (event.track) {
                    console.log('Adding remote track to remote stream:', event.track.kind, event.track.id);
                    // Clear existing tracks and add new ones
                    this.remoteStream.getTracks().forEach(track => this.remoteStream.removeTrack(track));
                    this.remoteStream.addTrack(event.track);
                    this.remoteVideo.srcObject = this.remoteStream;
                }

                // Apply mobile optimization to remote video
                if (this.isMobile && this.remoteVideo) {
                    this.remoteVideo.style.objectFit = 'cover';
                    this.remoteVideo.style.transform = 'scale(1.0)';
                }

                // Set up track event handlers
                event.track.onended = () => {
                    console.log('Remote track ended:', event.track.kind);
                    this.handleRemoteDisconnect();
                };

                event.track.onmute = () => {
                    console.log('Remote track muted:', event.track.kind);
                };

                event.track.onunmute = () => {
                    console.log('Remote track unmuted:', event.track.kind);
                };

                // Update UI
                this.remoteVideo.muted = false;
                this.isRemoteAudioMuted = false;
                this.muteBtn.textContent = '🔇 ' + window.languageManager.translate('mute');
                this.muteBtn.classList.remove('active');

                this.updateConnectionStatus('connected');
                this.updateRemoteLabel('partner');
                this.updateQualityIndicator('HD', 'quality-high');
                this.isConnected = true;

                // Show local preview only when partner is connected
                this.showLocalPreview();

                console.log('Successfully connected to partner video');

                // Start enhanced monitoring
                this.startEnhancedMonitoring();

            } catch (error) {
                console.error('Error handling remote track:', error);
                this.scheduleReconnection();
            }
        };

        // Enhanced ICE connection state handling with better recovery
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('Connection state changed:', state);

            switch (state) {
                case 'connected':
                    this.reconnectionAttempts = 0;
                    this.connectionQuality = 'good';
                    this.updateConnectionStatus('connected');
                    this.updateRemoteLabel('partner');
                    this.updateQualityIndicator('HD', 'quality-high');
                    this.isConnected = true;

                    // Ensure local preview is shown when connected
                    this.showLocalPreview();

                    // Report good connection quality
                    this.reportConnectionQuality('good');
                    break;

                case 'disconnected':
                    this.connectionQuality = 'poor';
                    this.updateConnectionStatus('reconnecting');
                    this.updateRemoteLabel('waitingPartner');
                    this.updateQualityIndicator('Reconnecting', 'quality-low');
                    this.isConnected = false;

                    // Hide local preview when disconnected
                    this.hideLocalPreview();

                    if (this.statsInterval) {
                        clearInterval(this.statsInterval);
                        this.statsInterval = null;
                    }

                    if (this.mediaAccessGranted) {
                        // Use smarter reconnection timing
                        this.scheduleReconnection();
                    }
                    break;

                case 'failed':
                    console.log('Peer connection failed, attempting recovery...');
                    this.connectionQuality = 'poor';
                    this.updateConnectionStatus('reconnecting');
                    this.updateQualityIndicator('Failed', 'quality-low');
                    this.isConnected = false;

                    this.hideLocalPreview();
                    this.reportConnectionQuality('poor', 'Connection failed, attempting recovery');

                    if (this.mediaAccessGranted) {
                        this.scheduleReconnection();
                    }
                    break;

                case 'connecting':
                    this.updateConnectionStatus('connecting');
                    this.updateQualityIndicator('Connecting', 'quality-medium');
                    break;

                case 'new':
                    console.log('Peer connection in new state');
                    break;
            }
        };

        // Enhanced ICE candidate handling with better logging
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Generated ICE candidate:', event.candidate.type, event.candidate.protocol);
                this.socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    roomId: this.roomId,
                    userId: this.userId
                });
            } else {
                console.log('All ICE candidates have been generated');
                this.reportConnectionQuality('good', 'ICE gathering complete');
            }
        };

        // ICE connection state monitoring for better diagnostics
        this.peerConnection.oniceconnectionstatechange = () => {
            const iceState = this.peerConnection.iceConnectionState;
            console.log('ICE connection state:', iceState);
            this.lastIceState = iceState;

            // Report connection quality based on ICE state
            switch (iceState) {
                case 'connected':
                case 'completed':
                    this.connectionQuality = 'good';
                    this.reportConnectionQuality('good', 'ICE connected');
                    break;
                case 'disconnected':
                    this.connectionQuality = 'poor';
                    this.reportConnectionQuality('poor', 'ICE disconnected');
                    // ADDED: Trigger ICE restart on disconnect
                    this.scheduleIceRestart();
                    break;
                case 'failed':
                    this.connectionQuality = 'poor';
                    this.reportConnectionQuality('poor', 'ICE failed');
                    // ADDED: Immediate ICE restart on failure
                    console.log('ICE failed, initiating immediate restart...');
                    this.initiateIceRestart();
                    break;
                case 'checking':
                    this.connectionQuality = 'fair';
                    this.reportConnectionQuality('fair', 'ICE checking');
                    break;
            }
        };

        // ICE gathering state monitoring
        this.peerConnection.onicegatheringstatechange = () => {
            console.log('ICE gathering state:', this.peerConnection.iceGatheringState);
        };

        // Signaling state monitoring
        this.peerConnection.onsignalingstatechange = () => {
            console.log('Signaling state:', this.peerConnection.signalingState);
        };

        // Setup socket events
        this.setupSocketEvents();
    }

    // Enhanced offer creation with better error handling and retry
    async createOffer() {
        try {
            if (this.isConnected || !this.mediaAccessGranted) {
                console.log('Skipping offer creation - already connected or no media access');
                return;
            }

            console.log('Creating offer...');

            // Ensure we have local tracks
            if (!this.localStream || this.localStream.getTracks().length === 0) {
                console.error('No local tracks available for offer creation');
                return;
            }

            // Ensure peer connection exists
            if (!this.peerConnection) {
                console.error('No peer connection available');
                return;
            }

            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
                iceRestart: this.reconnectionAttempts > 0 || data?.iceRestart // Restart ICE on reconnection attempts or explicit restart
            });

            console.log('Created offer, setting local description...');
            await this.peerConnection.setLocalDescription(offer);

            this.socket.emit('offer', {
                offer: offer,
                roomId: this.roomId,
                userId: this.userId,
                attempt: this.reconnectionAttempts + 1
            });
            console.log('Offer sent to signaling server');

        } catch (error) {
            console.error('Error creating offer:', error);
            this.displaySystemMessage('Failed to establish connection. Please try again.', false, 'connection');

            // Retry offer creation after a delay
            if (this.reconnectionAttempts < this.maxReconnectionAttempts) {
                setTimeout(() => {
                    this.createOffer();
                }, 2000);
            }
        }
    }

    // Enhanced offer handling
    async handleOffer(data) {
        try {
            if (this.isConnected || !this.mediaAccessGranted) {
                console.log('Skipping offer handling - already connected or no media access');
                return;
            }

            console.log('Handling offer from partner...');

            // Ensure we have local tracks
            if (!this.localStream || this.localStream.getTracks().length === 0) {
                console.error('No local tracks available for answer creation');
                return;
            }

            await this.peerConnection.setRemoteDescription(data.offer);
            console.log('Remote description set');

            const answer = await this.peerConnection.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });

            console.log('Created answer, setting local description...');
            await this.peerConnection.setLocalDescription(answer);

            this.socket.emit('answer', {
                answer: answer,
                roomId: this.roomId,
                userId: this.userId
            });
            console.log('Answer sent to signaling server');

            // Set a timeout to check if connection succeeds
            setTimeout(() => {
                if (this.peerConnection.connectionState === 'connected') {
                    this.updateConnectionStatus('connected');
                    this.updateRemoteLabel('partner');
                    this.isConnected = true;

                    // NEW: Show local preview when connection succeeds
                    this.showLocalPreview();
                }
            }, 2000);

        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    // Enhanced answer handling
    async handleAnswer(data) {
        try {
            console.log('Handling answer from partner...');
            await this.peerConnection.setRemoteDescription(data.answer);
            console.log('Remote description set from answer');

        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    // Enhanced ICE candidate handling
    async handleIceCandidate(data) {
        try {
            await this.peerConnection.addIceCandidate(data.candidate);
            console.log('Added ICE candidate');
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    handleRemoteDisconnect() {
        console.log('Remote track disconnected');
        this.remoteVideo.srcObject = null;
        this.updateRemoteLabel('waitingPartner');
        this.updateQualityIndicator('Offline', 'quality-low');
        this.isConnected = false;

        // NEW: Hide local preview when partner disconnects
        this.hideLocalPreview();

        // Reset mute state when partner disconnects
        this.isRemoteAudioMuted = false;
        this.muteBtn.textContent = '🔇 ' + window.languageManager.translate('mute');
        this.muteBtn.classList.remove('active');

        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }

    // Enhanced reconnection with exponential backoff and quality-based delays
    scheduleReconnection() {
        if (this.reconnectionAttempts < this.maxReconnectionAttempts) {
            this.reconnectionAttempts++;

            // Use exponential backoff with jitter
            const baseDelay = this.reconnectionBaseDelay;
            const maxDelay = this.isMobile ? 30000 : 25000;
            const delay = Math.min(
                baseDelay * Math.pow(1.8, this.reconnectionAttempts - 1) * (0.8 + Math.random() * 0.4),
                maxDelay
            );

            console.log(`Scheduling reconnection attempt ${this.reconnectionAttempts} in ${Math.round(delay)}ms`);

            // Only show reconnection message for first few attempts
            if (this.reconnectionAttempts <= 3) {
                this.displaySystemMessage(`Reconnecting... (${this.reconnectionAttempts}/${this.maxReconnectionAttempts})`, false, 'connection');
            }

            setTimeout(() => {
                if (!this.isConnected && this.mediaAccessGranted) {
                    this.reconnectWebRTC();
                }
            }, delay);
        } else {
            console.log('Max reconnection attempts reached');

            // Only show final failure message
            this.displaySystemMessage('Connection lost. Please refresh the page.', false, 'disconnection');

            // Ensure local preview is hidden when connection fails
            this.hideLocalPreview();
        }
    }

    // Enhanced WebRTC reconnection with better cleanup
    async reconnectWebRTC() {
        console.log('Attempting WebRTC reconnection...');
        try {
            // Clean up previous connection properly
            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }

            // Clean up audio monitoring
            this.cleanupAudioMonitoring();

            // Stop enhanced monitoring
            this.stopEnhancedMonitoring();

            // Reinitialize media with optimized settings
            await this.initializeMedia();

            // Create new peer connection with fresh configuration
            this.createPeerConnection();

            // Rejoin the room
            this.socket.emit('rejoin-room', {
                roomId: this.roomId,
                userId: this.userId,
                reconnection: true
            });

            console.log('WebRTC reconnection initiated');

            // Attempt to create offer after a short delay
            setTimeout(async () => {
                if (!this.isConnected) {
                    await this.createOffer();
                }
            }, 1000);

        } catch (error) {
            console.error('Reconnection failed:', error);
            this.displaySystemMessage('Reconnection failed. Please refresh the page.', false, 'disconnection');
        }
    }

    // NEW: ICE restart functionality
    initiateIceRestart() {
        console.log('Initiating ICE restart...');

        // Request ICE restart from the other peer
        this.socket.emit('ice-restart-request', {
            roomId: this.roomId,
            userId: this.userId,
            reason: 'ICE connection failed'
        });

        // Restart ICE on our side
        this.restartIce();
    }

    // NEW: Schedule ICE restart with delay
    scheduleIceRestart() {
        if (this.iceRestartTimeout) {
            clearTimeout(this.iceRestartTimeout);
        }

        this.iceRestartTimeout = setTimeout(() => {
            if (this.peerConnection && this.peerConnection.iceConnectionState === 'disconnected') {
                console.log('ICE still disconnected after delay, initiating restart...');
                this.initiateIceRestart();
            }
        }, 3000); // Wait 3 seconds before restarting
    }

    // NEW: Restart ICE process
    async restartIce() {
        try {
            if (!this.peerConnection || !this.localStream) {
                console.log('Cannot restart ICE - no peer connection or local stream');
                return;
            }

            console.log('Restarting ICE connection...');

            // Create new offer with iceRestart flag
            const offer = await this.peerConnection.createOffer({ iceRestart: true });
            await this.peerConnection.setLocalDescription(offer);

            this.socket.emit('offer', {
                offer: offer,
                roomId: this.roomId,
                userId: this.userId,
                iceRestart: true
            });

            console.log('ICE restart offer sent');

        } catch (error) {
            console.error('Error during ICE restart:', error);
            // Fallback to full reconnection if ICE restart fails
            this.scheduleReconnection();
        }
    }
    // Enhanced socket events with connection optimization
    setupSocketEvents() {
        // Connection optimization event
        this.socket.on('connection-optimization', (data) => {
            console.log('Received connection optimization settings:', data);
            this.applyConnectionOptimization(data);
        });

        this.socket.on('connection-optimized', (data) => {
            console.log('Received optimized connection settings:', data);
            this.connectionConfig.iceServers = data.iceServers;
        });

        // Enhanced user connection events
        this.socket.on('user-connected', async (data) => {
            console.log('User connected event received:', data);
            if (!this.isConnected && this.mediaAccessGranted) {
                console.log('Attempting to create offer for new user...');
                // Smarter delay based on connection quality
                const delay = this.connectionQuality === 'good' ? 500 : 1500;
                setTimeout(() => {
                    this.createOffer();
                }, delay);
            }

            // Reset mute state when new partner connects
            this.isRemoteAudioMuted = false;
            this.muteBtn.textContent = '🔇 ' + window.languageManager.translate('mute');
            this.muteBtn.classList.remove('active');

            // Only show connection message if we're not already connected
            if (!this.isConnected) {
                this.displaySystemMessage('Partner connected', false, 'connection');
            }
        });

        // ICE restart event from other peer
        this.socket.on('ice-restart-required', (data) => {
            console.log('ICE restart required by partner:', data);
            this.displaySystemMessage('Reconnecting video...', false, 'connection');
            this.restartIce();
        });

        // Enhanced existing users handling
        this.socket.on('existing-users', (data) => {
            console.log('Existing users in room:', data.users);
            if (data.users.length > 0 && !this.isConnected && this.mediaAccessGranted) {
                console.log('Creating offer for existing users...');
                const delay = this.connectionQuality === 'good' ? 800 : 2000;
                setTimeout(() => {
                    this.createOffer();
                }, delay);
            }
        });

        // Enhanced signaling with better error handling
        this.socket.on('offer', async (data) => {
            console.log('Received offer from partner, attempt:', data.attempt);
            if (this.mediaAccessGranted) {
                await this.handleOffer(data);
            }
        });

        this.socket.on('answer', async (data) => {
            console.log('Received answer from partner');
            await this.handleAnswer(data);
        });

        this.socket.on('ice-candidate', async (data) => {
            console.log('Received ICE candidate from partner');
            await this.handleIceCandidate(data);
        });

        // Enhanced connection quality events
        this.socket.on('partner-connection-quality', (data) => {
            console.log('Partner connection quality:', data);
            if (data.quality === 'poor') {
                this.displaySystemMessage(`Partner connection: ${data.suggestion}`, false, 'connection');
            }
        });

        // Connection health monitoring
        this.socket.on('connection-health-response', (data) => {
            console.log('Connection health response:', data);
            this.updateConnectionHealth(data);
        });

        // Enhanced socket reconnection
        this.socket.on('reconnect', (attempt) => {
            console.log('Socket reconnected, attempt:', attempt);
            if (this.mediaAccessGranted) {
                this.socket.emit('rejoin-room', {
                    roomId: this.roomId,
                    userId: this.userId,
                    reconnection: true
                });

                if (this.peerConnection && this.peerConnection.connectionState === 'disconnected') {
                    this.reconnectWebRTC();
                }
            }
        });

        this.socket.on('reconnect_attempt', (attempt) => {
            console.log('Socket reconnection attempt:', attempt);
        });

        this.socket.on('reconnect_error', (error) => {
            console.log('Socket reconnection error:', error);
        });

        this.socket.on('reconnect_failed', () => {
            console.log('Socket reconnection failed');
            this.displaySystemMessage('Connection lost. Please refresh the page.', false, 'disconnection');
        });

        this.socket.on('user-disconnected', (data) => {
            console.log('User disconnected:', data);
            this.handleRemoteDisconnect();
            // Use rate-limited disconnection notification
            this.displaySystemMessage(window.languageManager.translate('partnerDisconnected'), false, 'disconnection');
        });

        this.socket.on('user-left', (data) => {
            console.log('User left:', data);
            this.handleRemoteDisconnect();
            this.displaySystemMessage(window.languageManager.translate('partnerDisconnected'), false, 'disconnection');
        });

        this.socket.on('redirect-to-lounge', () => {
            window.location.href = '/lounge?success=conversationEnded';
        });

        this.socket.on('conversation-ended', (data) => {
            this.displaySystemMessage(data.message, false, 'general');
            setTimeout(() => {
                window.location.href = '/lounge?success=conversationEnded';
            }, 2000);
        });

        this.socket.on('chat-message', (data) => {
            if (data.userId !== this.userId) {
                const displayName = window.languageManager.translate('partner');
                this.displayMessage(displayName, data.message, data.timestamp, data.messageId);
            }
        });

        this.socket.on('connect', () => {
            console.log('Socket connected');
            if (this.mediaAccessGranted) {
                this.socket.emit('rejoin-room', {
                    roomId: this.roomId,
                    userId: this.userId
                });

                if (this.peerConnection && this.peerConnection.connectionState === 'disconnected') {
                    this.reconnectWebRTC();
                }
            }
        });

        this.socket.on('user-reconnected', (data) => {
            console.log('User reconnected:', data);
            // Reset mute state when partner reconnects
            this.isRemoteAudioMuted = false;
            this.muteBtn.textContent = '🔇 ' + window.languageManager.translate('mute');
            this.muteBtn.classList.remove('active');

            // Only show reconnection message if we had a previous disconnection
            if (!this.isConnected) {
                this.displaySystemMessage('Partner reconnected', false, 'connection');
            }
        });

        this.socket.on('remote-audio-toggle', (data) => {
            this.isRemoteAudioMuted = data.muted;
            const message = data.muted ? 'Partner muted audio' : 'Partner unmuted audio';
            this.displaySystemMessage(message, false, 'general');
        });

        // Mobile-specific optimized events
        this.socket.on('mobile-optimized-settings', (settings) => {
            if (this.isMobile) {
                console.log('Applying mobile-optimized settings:', settings);
                // Apply mobile-specific settings from server
                this.connectionConfig.iceTransportPolicy = settings.iceTransportPolicy;
            }
        });

        this.socket.on('connection-quality-update', (data) => {
            if (this.isMobile) {
                console.log('Connection quality update:', data);
                if (data.quality === 'poor') {
                    this.displaySystemMessage(`Network connection weak. ${data.suggestion}`, false, 'connection');
                }
            }
        });

        this.socket.on('connection-health-check', (data) => {
            if (this.isMobile) {
                console.log('Connection health check:', data);
                // Simply respond to keep connection alive, no notification
                this.socket.emit('connection-health-ack', { timestamp: Date.now() });
            }
        });

        // Enhanced mobile keep-alive
        this.socket.on('mobile-keep-alive', (data) => {
            if (this.isMobile) {
                // Respond without logging to reduce noise
                this.socket.emit('mobile-keep-alive-ack', { timestamp: Date.now() });
            }
        });

        this.socket.on('mobile-user-disconnected', (data) => {
            console.log('Mobile user disconnected:', data);
            if (data.userId !== this.userId) {
                this.displaySystemMessage('Partner disconnected (mobile device)', false, 'disconnection');
            }
        });
    }

    // New methods for enhanced connection management

    getIceServers() {
        // Return optimized ICE servers
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:stun.services.mozilla.com:3478' },
            { urls: 'stun:stun.stunprotocol.org:3478' },
            { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
        ];
    }

    applyConnectionOptimization(settings) {
        console.log('Applying connection optimization:', settings);
        if (settings.iceServers) {
            this.connectionConfig.iceServers = settings.iceServers;
        }
    }

    startEnhancedMonitoring() {
        // Start ping monitoring for connection quality
        this.startPingMonitoring();

        // Start health checks
        this.startHealthChecks();

        // Start connection quality reporting
        this.startQualityReporting();
    }

    stopEnhancedMonitoring() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    startPingMonitoring() {
        this.pingInterval = setInterval(() => {
            if (this.socket.connected) {
                const pingData = {
                    clientTime: Date.now(),
                    connectionId: this.socket.id,
                    roomId: this.roomId
                };
                this.socket.emit('ping', pingData);
            }
        }, this.isMobile ? 15000 : 20000);
    }

    startHealthChecks() {
        this.healthCheckInterval = setInterval(() => {
            if (this.socket.connected && this.isConnected) {
                this.socket.emit('connection-health-check', {
                    timestamp: Date.now(),
                    roomId: this.roomId,
                    connectionQuality: this.connectionQuality
                });
            }
        }, 30000); // Every 30 seconds
    }

    startQualityReporting() {
        // Report initial connection quality
        this.reportConnectionQuality('good', 'Connection established');
    }

    reportConnectionQuality(quality, details = '') {
        this.connectionQuality = quality;
        this.socket.emit('connection-quality-report', {
            quality: quality,
            details: details,
            roomId: this.roomId,
            timestamp: Date.now(),
            iceState: this.lastIceState
        });
    }

    updateConnectionHealth(data) {
        // Update UI based on connection health
        if (data.serverLoad && data.serverLoad.memory > 200) {
            console.warn('Server under heavy load:', data.serverLoad);
        }
    }

    // Enhanced system message with rate limiting
    displaySystemMessage(message, clickable = false, type = 'general') {
        // Check if we should show this notification
        if (!this.notificationManager.canShowNotification(type, message)) {
            return;
        }

        // Create system messages container if it doesn't exist
        let systemContainer = document.getElementById('systemMessages');
        if (!systemContainer) {
            systemContainer = document.createElement('div');
            systemContainer.id = 'systemMessages';
            systemContainer.className = 'system-messages';
            document.body.appendChild(systemContainer);
        }

        const systemMessage = document.createElement('div');
        systemMessage.className = 'system-message';
        if (clickable) {
            systemMessage.classList.add('clickable');
        }
        // Add type-specific class for styling
        systemMessage.classList.add(`${type}-notification`);
        systemMessage.textContent = message;

        systemContainer.appendChild(systemMessage);

        // Remove after animation completes
        setTimeout(() => {
            if (systemMessage.parentNode) {
                systemMessage.parentNode.removeChild(systemMessage);
            }
        }, 4000);
    }

    // Mute partner's audio (toggle remote audio) - FIXED VERSION
    toggleRemoteAudio() {
        if (this.remoteVideo && this.remoteVideo.srcObject) {
            // Toggle the muted state of the remote video element
            this.remoteVideo.muted = !this.remoteVideo.muted;
            this.isRemoteAudioMuted = this.remoteVideo.muted;

            // Update button text using language manager
            this.muteBtn.textContent = this.isRemoteAudioMuted ?
                '🔊 ' + window.languageManager.translate('unmute') :
                '🔇 ' + window.languageManager.translate('mute');
            this.muteBtn.classList.toggle('active', this.isRemoteAudioMuted);

            const message = this.isRemoteAudioMuted ?
                'Partner audio muted' :
                'Partner audio unmuted';
            this.displaySystemMessage(message, false, 'general');

            console.log(`Partner audio ${this.isRemoteAudioMuted ? 'muted' : 'unmuted'}`);
        } else {
            this.displaySystemMessage('No partner connected', false, 'general');
        }
    }

    // Mute own audio (prevent transmission to partner)
    toggleLocalAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isLocalAudioMuted = !audioTrack.enabled;

                // Update button text using language manager
                this.selfMuteBtn.textContent = this.isLocalAudioMuted ?
                    '🎤 ' + window.languageManager.translate('unmuteSelf') :
                    '🤫 ' + window.languageManager.translate('muteSelf');
                this.selfMuteBtn.classList.toggle('active', this.isLocalAudioMuted);

                const message = this.isLocalAudioMuted ? 'Your microphone muted' : 'Your microphone unmuted';
                this.displaySystemMessage(message, false, 'general');

                // Notify partner about mute state
                this.socket.emit('remote-audio-toggle', {
                    roomId: this.roomId,
                    userId: this.userId,
                    muted: this.isLocalAudioMuted
                });
            }
        }
    }

    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                const isStopped = !videoTrack.enabled;
                this.videoBtn.textContent = isStopped ?
                    '📹 ' + window.languageManager.translate('startVideo') :
                    '📹 ' + window.languageManager.translate('stopVideo');
                this.videoBtn.classList.toggle('active', isStopped);
                const message = isStopped ? 'videoStopped' : 'videoStarted';
                this.displaySystemMessage(window.languageManager.translate(message), false, 'general');
            }
        }
    }

    toggleQualityMode() {
        const modes = ['balanced', 'quality', 'bandwidth'];
        const modeNames = {
            'balanced': 'balanced',
            'quality': 'highQuality',
            'bandwidth': 'lowBandwidth'
        };

        const currentIndex = modes.indexOf(this.qualityMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        this.qualityMode = modes[nextIndex];

        // Update the button text immediately
        const qualityText = window.languageManager.translate('quality');
        const modeText = window.languageManager.translate(modeNames[this.qualityMode]);
        this.qualityBtn.textContent = `⚡ ${qualityText}: ${modeText}`;

        this.applyQualitySettings();
        this.displaySystemMessage(`${qualityText}: ${modeText}`, false, 'general');
    }

    applyQualitySettings() {
        if (!this.peerConnection || !this.localStream) return;

        const senders = this.peerConnection.getSenders();
        const videoTrack = this.localStream.getVideoTracks()[0];

        if (!videoTrack) return;

        senders.forEach(sender => {
            if (sender.track && sender.track.kind === 'video') {
                try {
                    const parameters = sender.getParameters();
                    if (!parameters.encodings) {
                        parameters.encodings = [{}];
                    }

                    // Get actual video constraints for logging
                    const constraints = videoTrack.getSettings();
                    console.log('Current video constraints:', constraints);

                    let newConstraints = {};

                    switch (this.qualityMode) {
                        case 'quality':
                            parameters.encodings[0].maxBitrate = 2500000; // 2.5 Mbps
                            parameters.encodings[0].maxFramerate = 30;
                            parameters.encodings[0].scaleResolutionDownBy = 1;
                            newConstraints = {
                                width: { ideal: 1280 },
                                height: { ideal: 720 },
                                frameRate: { ideal: 30 }
                            };
                            this.updateQualityIndicator('HD+', 'quality-high');
                            break;
                        case 'balanced':
                            parameters.encodings[0].maxBitrate = 1500000; // 1.5 Mbps
                            parameters.encodings[0].maxFramerate = 24;
                            parameters.encodings[0].scaleResolutionDownBy = 1.5;
                            newConstraints = {
                                width: { ideal: 854 },
                                height: { ideal: 480 },
                                frameRate: { ideal: 24 }
                            };
                            this.updateQualityIndicator('HD', 'quality-medium');
                            break;
                        case 'bandwidth':
                            parameters.encodings[0].maxBitrate = 500000; // 0.5 Mbps
                            parameters.encodings[0].maxFramerate = 15;
                            parameters.encodings[0].scaleResolutionDownBy = 2;
                            newConstraints = {
                                width: { ideal: 640 },
                                height: { ideal: 360 },
                                frameRate: { ideal: 15 }
                            };
                            this.updateQualityIndicator('SD', 'quality-low');
                            break;
                    }

                    // Apply the parameters
                    sender.setParameters(parameters)
                        .then(() => {
                            console.log(`Quality mode applied: ${this.qualityMode}`, parameters.encodings[0]);

                            // Update stats display with quality info
                            if (this.statsContent && this.statsContent.style.display !== 'none') {
                                this.updateQualityStats();
                            }
                        })
                        .catch(error => {
                            console.warn('Error applying quality settings:', error);
                        });

                    // Also try to reapply media constraints for better quality control
                    if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
                        videoTrack.applyConstraints(newConstraints)
                            .then(() => {
                                console.log('Video constraints applied:', newConstraints);
                            })
                            .catch(err => {
                                console.warn('Error applying video constraints:', err);
                            });
                    }

                } catch (error) {
                    console.warn('Error in quality settings:', error);
                }
            }
        });
    }

    // Add method to update quality stats display
    updateQualityStats() {
        if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') return;

        const qualityInfo = document.getElementById('qualityStat');
        if (qualityInfo) {
            const modeNames = {
                'balanced': 'Balanced',
                'quality': 'High Quality',
                'bandwidth': 'Low Bandwidth'
            };
            qualityInfo.textContent = modeNames[this.qualityMode];
        }
    }

    // Statistics toggle functionality
    toggleStats() {
        if (this.statsContent && this.statsHeader) {
            const isVisible = this.statsContent.style.display !== 'none';
            this.statsContent.style.display = isVisible ? 'none' : 'block';

            // Update header text with arrow indicator
            const arrow = isVisible ? '▼' : '▲';
            this.statsHeader.innerHTML = `Statistics ${arrow}`;

            // Start stats monitoring if showing
            if (!isVisible && this.isConnected) {
                this.startStatsMonitoring();
            } else if (isVisible && this.statsInterval) {
                clearInterval(this.statsInterval);
                this.statsInterval = null;
            }
        }
    }

    startStatsMonitoring() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }

        // Only start if stats content is visible and connected
        if (!this.statsContent || this.statsContent.style.display === 'none' || !this.isConnected) {
            return;
        }

        this.statsInterval = setInterval(async () => {
            if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') {
                // Stop monitoring if not connected
                if (this.statsInterval) {
                    clearInterval(this.statsInterval);
                    this.statsInterval = null;
                }
                return;
            }

            try {
                const stats = await this.peerConnection.getStats();
                let inboundVideo = null;

                stats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        inboundVideo = report;
                    }
                });

                // Update stats display with proper error handling
                if (inboundVideo) {
                    const bitrate = inboundVideo.bytesReceived ?
                        Math.round((inboundVideo.bytesReceived / 1024) * 8) + ' kbps' : '0 kbps';
                    const resolution = `${inboundVideo.frameWidth || 0}x${inboundVideo.frameHeight || 0}`;
                    const fps = inboundVideo.framesPerSecond || 0;
                    const packets = inboundVideo.packetsReceived || 0;

                    // Update DOM elements only if they exist
                    const bitrateElement = document.getElementById('bitrateStat');
                    const resolutionElement = document.getElementById('resolutionStat');
                    const fpsElement = document.getElementById('fpsStat');
                    const packetsElement = document.getElementById('packetsStat');

                    if (bitrateElement) bitrateElement.textContent = bitrate;
                    if (resolutionElement) resolutionElement.textContent = resolution;
                    if (fpsElement) fpsElement.textContent = fps;
                    if (packetsElement) packetsElement.textContent = packets;
                }

            } catch (error) {
                console.error('Error getting stats:', error);
            }
        }, 2000); // Update every 2 seconds
    }

    // FIXED: Screen size controls - hide on mobile
    setupScreenSizeControls() {
        const sizeButtons = document.querySelectorAll('.size-btn');
        const videoContainer = document.querySelector('.video-container');
        const screenSizeControls = document.querySelector('.screen-size-controls');

        // Hide screen size controls on mobile
        if (this.isMobile && screenSizeControls) {
            screenSizeControls.style.display = 'none';
            return; // Don't setup controls on mobile
        }

        if (!videoContainer) return;

        // Desktop controls setup
        sizeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                sizeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const ratio = btn.dataset.ratio;

                videoContainer.classList.remove('ratio-9-16', 'ratio-16-9', 'ratio-1-1', 'ratio-auto');

                setTimeout(() => {
                    videoContainer.classList.add(`ratio-${ratio}`);

                    videoContainer.style.display = 'none';
                    videoContainer.offsetHeight;
                    videoContainer.style.display = 'block';

                    console.log(`Screen ratio set to: ${ratio}`);

                    if (this.remoteVideo && this.remoteVideo.srcObject) {
                        this.remoteVideo.style.objectFit = ratio === '1-1' ? 'contain' : 'cover';
                    }
                }, 10);
            });
        });

        // Set default ratio to AUTO
        const autoBtn = document.querySelector('.size-btn[data-ratio="auto"]');
        if (autoBtn) {
            autoBtn.classList.add('active');
            videoContainer.classList.add('ratio-auto');
        }
    }

    setupLocalVideoDragAndResize() {
        const localVideoWrapper = document.querySelector('.video-wrapper.preview-video');
        if (!localVideoWrapper) return;

        let isDragging = false;
        let isResizing = false;
        let startX, startY, startWidth, startHeight, startLeft, startTop;

        // Mouse events for desktop
        localVideoWrapper.addEventListener('mousedown', (e) => {
            const isResizeHandle = e.offsetX > localVideoWrapper.offsetWidth - 20 &&
                                 e.offsetY > localVideoWrapper.offsetHeight - 20;

            if (isResizeHandle) {
                isResizing = true;
            } else {
                isDragging = true;
            }

            startX = e.clientX;
            startY = e.clientY;
            startWidth = parseInt(document.defaultView.getComputedStyle(localVideoWrapper).width, 10);
            startHeight = parseInt(document.defaultView.getComputedStyle(localVideoWrapper).height, 10);
            startLeft = parseInt(document.defaultView.getComputedStyle(localVideoWrapper).left, 10) || 0;
            startTop = parseInt(document.defaultView.getComputedStyle(localVideoWrapper).top, 10) || 0;

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                localVideoWrapper.style.left = (startLeft + dx) + 'px';
                localVideoWrapper.style.top = (startTop + dy) + 'px';
                localVideoWrapper.style.right = 'auto';
                localVideoWrapper.style.bottom = 'auto';
            } else if (isResizing) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                const newWidth = Math.max(120, Math.min(400, startWidth + dx));
                const newHeight = Math.max(90, Math.min(300, startHeight + dy));

                localVideoWrapper.style.width = newWidth + 'px';
                localVideoWrapper.style.height = newHeight + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            isResizing = false;
        });

        // Touch events for mobile
        localVideoWrapper.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            isDragging = true;
            startX = touch.clientX;
            startY = touch.clientY;
            startLeft = parseInt(document.defaultView.getComputedStyle(localVideoWrapper).left, 10) || 0;
            startTop = parseInt(document.defaultView.getComputedStyle(localVideoWrapper).top, 10) || 0;

            e.preventDefault();
        });

        document.addEventListener('touchmove', (e) => {
            if (isDragging && e.touches.length === 1) {
                const touch = e.touches[0];
                const dx = touch.clientX - startX;
                const dy = touch.clientY - startY;

                localVideoWrapper.style.left = (startLeft + dx) + 'px';
                localVideoWrapper.style.top = (startTop + dy) + 'px';
                localVideoWrapper.style.right = 'auto';
                localVideoWrapper.style.bottom = 'auto';
            }
        });

        document.addEventListener('touchend', () => {
            isDragging = false;
        });
    }

    // Language detection method - IMPROVED VERSION
    detectMessageLanguage(message) {
        // Early return for very short messages
        if (message.length < 2) return 'en';

        // Clean the message for better detection
        const cleanMessage = message.replace(/[.,!?;:'"()\[\]{}]/g, '').toLowerCase().trim();

        // Language-specific word patterns (expanded list)
        const languagePatterns = {
            'ru': [
                /\b(привет|здравствуй|спасибо|пожалуйста|да|нет|как|что|где|когда|почему|хорошо|плохо|давай|пока|здравствуйте|до свидания|извините)\b/,
                /[а-яё]/
            ],
            'tr': [
                /\b(merhaba|teşekkür|evet|hayır|lütfen|nasıl|ne|nerede|ne zaman|niçin|iyi|kötü|hadi|güle|selam|hoşça kal|özür dilerim)\b/,
                /[çğıöşü]/
            ],
            'es': [
                /\b(hola|gracias|por favor|sí|no|cómo|qué|dónde|cuándo|por qué|bueno|malo|vamos|adiós|hasta luego|perdón|lo siento)\b/,
                /[ñáéíóúü]/
            ],
            'fr': [
                /\b(bonjour|merci|s'il vous plaît|oui|non|comment|que|où|quand|pourquoi|bon|mauvais|allons|au revoir|salut|à bientôt|désolé)\b/,
                /[àâäçéèêëîïôöùûüÿ]/
            ]
        };

        // Check for specific language patterns
        for (const [lang, patterns] of Object.entries(languagePatterns)) {
            for (const pattern of patterns) {
                if (pattern.test(cleanMessage)) {
                    console.log(`Detected ${lang} language in message: "${message.substring(0, 30)}..."`);
                    return lang;
                }
            }
        }

        // If no specific patterns found, check character ranges
        const hasCyrillic = /[\u0400-\u04FF]/.test(message); // Russian, etc.
        const hasTurkishChars = /[çğıöşüÇĞİÖŞÜ]/.test(message);
        const hasSpanishChars = /[ñáéíóúüÑÁÉÍÓÚÜ]/.test(message);
        const hasFrenchChars = /[àâäçéèêëîïôöùûüÿÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ]/.test(message);

        if (hasCyrillic) return 'ru';
        if (hasTurkishChars) return 'tr';
        if (hasSpanishChars) return 'es';
        if (hasFrenchChars) return 'fr';

        // Default to English for Latin script without specific patterns
        return 'en';
    }

    // Helper method to detect non-Latin characters
    hasNonLatinCharacters(text) {
        // Detect any non-Latin characters (Cyrillic, Arabic, Chinese, Japanese, Korean, etc.)
        const nonLatinPattern = /[^\u0000-\u007F\u00A0-\u00FF\u0100-\u017F\u0180-\u024F]/;
        return nonLatinPattern.test(text);
    }

    // Enhanced displayMessage method - FIXED VERSION with different styles for self/partner
    displayMessage(user, message, timestamp, messageId = null, isSystem = false) {
        if (isSystem) {
            this.displaySystemMessage(message);
            return;
        }

        // Generate ID if not provided
        const id = messageId || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Check if message with this ID already exists
        const existingMessage = document.querySelector(`[data-message-id="${id}"]`);
        if (existingMessage) {
            return;
        }

        // Detect message language
        const messageLang = this.detectMessageLanguage(message);
        const currentLang = window.languageManager.currentLanguage;
        const isOwnMessage = user === window.languageManager.translate('you');

        console.log(`Message language: ${messageLang}, Current UI language: ${currentLang}, User: ${user}, Is own: ${isOwnMessage}`);

        // Show translate buttons if:
        // 1. Message is from another user (not yourself)
        // 2. AND message is not in current UI language
        // 3. OR message contains non-Latin characters (for broader detection)
        const needsTranslation = !isOwnMessage &&
                               (messageLang !== currentLang || this.hasNonLatinCharacters(message));

        console.log(`Needs translation: ${needsTranslation}, Has non-Latin: ${this.hasNonLatinCharacters(message)}`);

        const messageElement = document.createElement('div');

        // Apply different styles for self vs partner messages
        if (isOwnMessage) {
            messageElement.className = 'chat-message self-message';
        } else {
            messageElement.className = 'chat-message partner-message';
        }

        messageElement.setAttribute('data-message-id', id);
        messageElement.setAttribute('data-original-lang', messageLang);
        messageElement.setAttribute('data-translated', 'false');

        // Build message HTML with dual translation buttons
        let messageHTML = `
            <div class="message-header">
                <span class="user">${user}:</span>
        `;

        if (needsTranslation) {
            messageHTML += `
                <div class="translate-buttons">
                    <button class="translate-btn google-translate" onclick="window.currentVideoChat.translateMessage('${id}', 'google', this)" title="Translate with Google">
                        <span class="translate-icon">🌐</span>
                    </button>
                    <button class="translate-btn deepseek-translate" onclick="window.currentVideoChat.translateMessage('${id}', 'deepseek', this)" title="Translate with DeepSeek">
                        <span class="translate-icon">🤖</span>
                    </button>
                </div>
            `;
            console.log(`Added dual translate buttons for message: "${message.substring(0, 30)}..."`);
        }

        messageHTML += `
            </div>
            <div class="original-message">${this.escapeHtml(message)}</div>
            <div class="translated-message" id="translated-${id}" style="display: none;"></div>
            <div class="translation-service" id="service-${id}" style="display: none; font-size: 10px; color: #888; margin-top: 2px;"></div>
            <span class="time">${timestamp}</span>
        `;

        messageElement.innerHTML = messageHTML;
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    // HTML escape function for safety
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Translation method with service selection - FIXED VERSION (Keep buttons)
    async translateMessage(messageId, service, buttonElement) {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageElement) return;

        const originalText = messageElement.querySelector('.original-message').textContent;
        const targetLang = window.languageManager.currentLanguage;

        // Disable all translate buttons for this message during translation
        const translateButtons = messageElement.querySelectorAll('.translate-btn');
        translateButtons.forEach(btn => {
            btn.disabled = true;
            btn.classList.add('translating');
        });

        // Update clicked button to show loading state
        buttonElement.innerHTML = '<span class="translate-icon">🔄</span>';
        buttonElement.title = 'Translating...';

        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: originalText,
                    targetLang: targetLang,
                    messageId: messageId,
                    service: service
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Translation failed');
            }

            // Show translation
            const translatedElement = document.getElementById(`translated-${messageId}`);
            const serviceElement = document.getElementById(`service-${messageId}`);

            translatedElement.textContent = data.translatedText;
            translatedElement.style.display = 'block';

            // Show which service was used
            serviceElement.textContent = `Translated with ${data.service}`;
            serviceElement.style.display = 'block';

            // KEEP BUTTONS but disable them and show success state
            translateButtons.forEach(btn => {
                btn.disabled = true;
                btn.classList.remove('translating');
                btn.classList.add('translated');
                btn.style.opacity = '0.6';
                btn.title = 'Already translated';

                // Show checkmark on successfully used button
                if (btn === buttonElement) {
                    btn.innerHTML = '<span class="translate-icon">✅</span>';
                }
            });

            // Mark message as translated
            messageElement.setAttribute('data-translated', 'true');

            // Add subtle animation to translated text
            translatedElement.style.animation = 'fadeInUp 0.5s ease-out';

            // Show success message
            this.displaySystemMessage(`Message translated with ${data.service}`, false, 'general');

        } catch (error) {
            console.error('Translation error:', error);

            // Re-enable buttons on error
            translateButtons.forEach(btn => {
                btn.disabled = false;
                btn.classList.remove('translating');
            });

            // Show error state on the clicked button
            buttonElement.innerHTML = '<span class="translate-icon">❌</span>';
            buttonElement.title = 'Translation failed - Click to retry';
            buttonElement.classList.add('error');

            // Reset button after 3 seconds
            setTimeout(() => {
                if (messageElement.parentNode) {
                    buttonElement.disabled = false;
                    buttonElement.classList.remove('error');

                    // Reset button icons based on service
                    if (buttonElement.classList.contains('google-translate')) {
                        buttonElement.innerHTML = '<span class="translate-icon">🌐</span>';
                        buttonElement.title = 'Translate with Google';
                    } else {
                        buttonElement.innerHTML = '<span class="translate-icon">🤖</span>';
                        buttonElement.title = 'Translate with DeepSeek';
                    }
                }
            }, 3000);

            this.displaySystemMessage(`${service} translation failed. Please try again.`, false, 'general');
        }
    }

    // Room control functions
    leaveRoom() {
        if (confirm('Are you sure you want to leave the room?')) {
            this.socket.emit('leave-room', {
                roomId: this.roomId,
                userId: this.userId
            });
            window.location.href = '/lounge';
        }
    }

    endCall() {
        if (confirm('Are you sure you want to end the conversation for everyone?')) {
            this.socket.emit('end-conversation', {
                roomId: this.roomId,
                userId: this.userId
            });
            window.location.href = '/lounge?success=conversationEnded';
        }
    }

    shareLink() {
        const url = window.location.href;
        navigator.clipboard.writeText(url).then(() => {
            this.displaySystemMessage(window.languageManager.translate('linkCopied'), false, 'general');
        }).catch(() => {
            const textArea = document.createElement('textarea');
            textArea.value = url;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.displaySystemMessage(window.languageManager.translate('linkCopied'), false, 'general');
        });
    }

    sendMessage() {
        const message = this.chatInput.value.trim();
        if (message) {
            const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            this.chatInput.value = '';

            // Detect language for own message (for future features)
            const messageLang = this.detectMessageLanguage(message);

            // Display the message locally
            this.displayMessage(
                window.languageManager.translate('you'),
                message,
                new Date().toLocaleTimeString(),
                messageId
            );

            // Send to other users
            this.socket.emit('chat-message', {
                message: message,
                roomId: this.roomId,
                userId: this.userId,
                messageId: messageId,
                timestamp: new Date().toLocaleTimeString(),
                detectedLang: messageLang // Optional: send detected language for optimization
            });
        }
    }

    updateConnectionStatus(statusKey) {
        if (this.connectionStatus) {
            const statusText = window.languageManager.translate(statusKey);
            this.connectionStatus.textContent = statusText;
            this.connectionStatus.style.display = statusKey !== 'connected' ? 'block' : 'none';
            this.connectionStatus.className = `status ${statusKey}`;
        }
    }

    updateRemoteLabel(labelKey) {
        if (this.remoteLabel) {
            this.remoteLabel.textContent = window.languageManager.translate(labelKey);
        }
    }

    updateQualityIndicator(text, className) {
        if (this.qualityIndicator) {
            this.qualityIndicator.textContent = text;
            this.qualityIndicator.className = `quality-indicator ${className}`;
        }
    }

    setupReconnectionHandling() {
        window.addEventListener('beforeunload', () => {
            if (this.socket) {
                this.socket.emit('user-leaving', {
                    roomId: this.roomId,
                    userId: this.userId
                });
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Page hidden');
            } else {
                console.log('Page visible');
                if (!this.isConnected && this.mediaAccessGranted) {
                    this.reconnectWebRTC();
                }
            }
        });
    }

    // Enhanced cleanup
    cleanup() {
        // Stop all monitoring
        this.stopEnhancedMonitoring();

        if (this.peerConnection) {
            this.peerConnection.close();
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        this.cleanupAudioMonitoring();
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }
        if (this.iceRestartTimeout) {
            clearTimeout(this.iceRestartTimeout);
            this.iceRestartTimeout = null;
        }
        // Report disconnection
        this.reportConnectionQuality('disconnected', 'User left');
    }
}

// Add cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.currentVideoChat) {
        window.currentVideoChat.cleanup();
    }
});

// Add page visibility change handling for better resource management
document.addEventListener('visibilitychange', () => {
    if (window.currentVideoChat) {
        if (document.hidden) {
            // Page is hidden, reduce monitoring frequency
            window.currentVideoChat.stopEnhancedMonitoring();
        } else {
            // Page is visible, resume monitoring if connected
            if (window.currentVideoChat.isConnected) {
                window.currentVideoChat.startEnhancedMonitoring();
            }
        }
    }
});
