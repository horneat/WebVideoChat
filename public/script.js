// Wait for language manager to be available
function initializeVideoChat() {
    if (window.languageManager) {
        new VideoChat();
    } else {
        // Retry after a short delay
        setTimeout(initializeVideoChat, 100);
    }
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeVideoChat);

class VideoChat {
    constructor() {
        // Ensure language manager is available
        if (!window.languageManager) {
            console.error('Language manager not available');
            return;
        }

        // Store instance globally for language manager access
        window.currentVideoChat = this;

        this.socket = io();
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;

        // Get room ID from URL path - FIXED
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
        this.maxReconnectionAttempts = 5;
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
            // First get media permissions
            await this.initializeMedia();
            this.mediaAccessGranted = true;

            // Then setup WebRTC connection
            this.createPeerConnection();
            this.socket.emit('join-room', this.roomId, this.userId);
            this.updateConnectionStatus('connecting');
            this.setupReconnectionHandling();
            this.setupLocalVideoDragAndResize();
            this.setupScreenSizeControls();
            this.updateControlTexts();

        } catch (error) {
            console.error('Error initiating connection:', error);
            this.displaySystemMessage(window.languageManager.translate('errorMediaAccess'));
        }
    }

    async initializeMedia() {
        try {
            console.log('Requesting camera and microphone access...');

            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

            // Simplified constraints for better compatibility
            const constraints = {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 24 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };

            // Mobile-specific optimizations
            if (isMobile) {
                constraints.video = {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 24 }
                };
            }

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

            console.log('Camera and microphone access granted');
            this.localVideo.srcObject = this.localStream;

        } catch (error) {
            console.error('Error accessing media devices:', error);

            try {
                console.log('Trying with basic constraints...');
                // Fallback with basic constraints
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });

                console.log('Camera and microphone access granted with basic constraints');
                this.localVideo.srcObject = this.localStream;

            } catch (fallbackError) {
                console.error('Fallback also failed:', fallbackError);
                throw new Error('Cannot access camera/microphone. Please check permissions.');
            }
        }
    }

    createPeerConnection() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10
        };

        this.peerConnection = new RTCPeerConnection(configuration);

        // Create remote stream early
        this.remoteStream = new MediaStream();
        this.remoteVideo.srcObject = this.remoteStream;

        // Add local tracks to peer connection
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log('Adding local track:', track.kind);
                this.peerConnection.addTrack(track, this.localStream);
            });
        }

        // Handle incoming remote tracks
        this.peerConnection.ontrack = (event) => {
            console.log('Received remote track:', event.track.kind);

            this.reconnectionAttempts = 0;

            // Add track to our remote stream
            if (event.streams && event.streams[0]) {
                this.remoteVideo.srcObject = event.streams[0];
            } else {
                this.remoteStream.addTrack(event.track);
                this.remoteVideo.srcObject = this.remoteStream;
            }

            // Ensure audio is not muted when new stream is received
            this.remoteVideo.muted = false;
            this.isRemoteAudioMuted = false;
            this.muteBtn.textContent = '🔇 ' + window.languageManager.translate('mute');
            this.muteBtn.classList.remove('active');

            // Set up track ended handler
            event.track.onended = () => {
                console.log('Remote track ended:', event.track.kind);
                this.handleRemoteDisconnect();
            };

            this.updateConnectionStatus('connected');
            this.updateRemoteLabel('partner');
            this.updateQualityIndicator('HD', 'quality-high');
            this.isConnected = true;

            // Start stats monitoring if stats are visible
            if (this.statsContent && this.statsContent.style.display !== 'none') {
                this.startStatsMonitoring();
            }
        };

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    roomId: this.roomId,
                    userId: this.userId
                });
            }
        };

        // Handle connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('Connection state:', state);

            if (state === 'connected') {
                this.reconnectionAttempts = 0;
                this.updateConnectionStatus('connected');
                this.updateRemoteLabel('partner');
                this.updateQualityIndicator('HD', 'quality-high');
                this.isConnected = true;
            } else if (state === 'disconnected' || state === 'failed') {
                this.updateConnectionStatus('reconnecting');
                this.updateRemoteLabel('waitingPartner');
                this.updateQualityIndicator('Offline', 'quality-low');
                this.isConnected = false;

                if (this.statsInterval) {
                    clearInterval(this.statsInterval);
                    this.statsInterval = null;
                }

                if (this.mediaAccessGranted) {
                    this.scheduleReconnection();
                }
            }
        };

        // Setup socket event listeners
        this.setupSocketEvents();
    }

    handleRemoteDisconnect() {
        console.log('Remote track disconnected');
        this.remoteVideo.srcObject = null;
        this.updateRemoteLabel('waitingPartner');
        this.updateQualityIndicator('Offline', 'quality-low');
        this.isConnected = false;

        // Reset mute state when partner disconnects
        this.isRemoteAudioMuted = false;
        this.muteBtn.textContent = '🔇 ' + window.languageManager.translate('mute');
        this.muteBtn.classList.remove('active');

        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }

    scheduleReconnection() {
        if (this.reconnectionAttempts < this.maxReconnectionAttempts) {
            this.reconnectionAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectionAttempts), 10000);

            console.log(`Scheduling reconnection attempt ${this.reconnectionAttempts} in ${delay}ms`);

            setTimeout(() => {
                if (!this.isConnected && this.mediaAccessGranted) {
                    this.reconnectWebRTC();
                }
            }, delay);
        } else {
            console.log('Max reconnection attempts reached');
            this.displaySystemMessage('Connection lost. Please refresh the page.');
        }
    }

    setupSocketEvents() {
        this.socket.on('user-connected', async (userId) => {
            console.log('User connected:', userId);
            if (!this.isConnected && this.mediaAccessGranted) {
                await this.createOffer();
            }

            // Reset mute state when new partner connects
            this.isRemoteAudioMuted = false;
            this.muteBtn.textContent = '🔇 ' + window.languageManager.translate('mute');
            this.muteBtn.classList.remove('active');

            this.displaySystemMessage('Partner connected');
        });

        this.socket.on('offer', async (data) => {
            if (this.mediaAccessGranted) {
                await this.handleOffer(data);
            }
        });

        this.socket.on('answer', async (data) => {
            await this.handleAnswer(data);
        });

        this.socket.on('ice-candidate', async (data) => {
            await this.handleIceCandidate(data);
        });

        this.socket.on('user-disconnected', (userId) => {
            console.log('User disconnected:', userId);
            this.handleRemoteDisconnect();
            this.displaySystemMessage(window.languageManager.translate('partnerDisconnected'));
        });

        this.socket.on('user-left', (userId) => {
            console.log('User left:', userId);
            this.handleRemoteDisconnect();
            this.displaySystemMessage(window.languageManager.translate('partnerDisconnected'));
        });

        this.socket.on('redirect-to-lounge', () => {
            window.location.href = '/lounge?success=conversationEnded';
        });

        this.socket.on('conversation-ended', (data) => {
            this.displaySystemMessage(data.message);
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
            console.log('Socket reconnected');
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

        this.socket.on('user-reconnected', (userId) => {
            console.log('User reconnected:', userId);
            // Reset mute state when partner reconnects
            this.isRemoteAudioMuted = false;
            this.muteBtn.textContent = '🔇 ' + window.languageManager.translate('mute');
            this.muteBtn.classList.remove('active');

            this.displaySystemMessage('Partner reconnected');
        });

        this.socket.on('remote-audio-toggle', (data) => {
            this.isRemoteAudioMuted = data.muted;
            const message = data.muted ? 'Partner muted audio' : 'Partner unmuted audio';
            this.displaySystemMessage(message);
        });
    }

    async reconnectWebRTC() {
        console.log('Attempting WebRTC reconnection...');
        try {
            if (this.peerConnection) {
                this.peerConnection.close();
            }

            this.createPeerConnection();

            this.socket.emit('user-reconnected', {
                roomId: this.roomId,
                userId: this.userId
            });

            setTimeout(async () => {
                await this.createOffer();
            }, 1000);

        } catch (error) {
            console.error('Reconnection failed:', error);
        }
    }

    async createOffer() {
        try {
            if (this.isConnected || !this.mediaAccessGranted) {
                return;
            }

            console.log('Creating offer...');
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            this.socket.emit('offer', {
                offer: offer,
                roomId: this.roomId,
                userId: this.userId
            });
            console.log('Offer sent');

        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    async handleOffer(data) {
        try {
            if (this.isConnected || !this.mediaAccessGranted) {
                return;
            }

            console.log('Handling offer...');
            await this.peerConnection.setRemoteDescription(data.offer);

            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            this.socket.emit('answer', {
                answer: answer,
                roomId: this.roomId,
                userId: this.userId
            });
            console.log('Answer sent');

            setTimeout(() => {
                if (this.peerConnection.connectionState === 'connected') {
                    this.updateConnectionStatus('connected');
                    this.updateRemoteLabel('partner');
                    this.isConnected = true;
                }
            }, 1000);

        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(data) {
        try {
            console.log('Handling answer...');
            await this.peerConnection.setRemoteDescription(data.answer);
            console.log('Answer handled successfully');

        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(data) {
        try {
            await this.peerConnection.addIceCandidate(data.candidate);
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
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
            this.displaySystemMessage(message);

            console.log(`Partner audio ${this.isRemoteAudioMuted ? 'muted' : 'unmuted'}`);
        } else {
            this.displaySystemMessage('No partner connected');
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
                this.displaySystemMessage(message);

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
                this.displaySystemMessage(window.languageManager.translate(message));
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
        this.displaySystemMessage(`${qualityText}: ${modeText}`);
    }

    applyQualitySettings() {
        if (!this.peerConnection) return;

        const senders = this.peerConnection.getSenders();
        senders.forEach(sender => {
            if (sender.track && sender.track.kind === 'video') {
                try {
                    const parameters = sender.getParameters();
                    if (!parameters.encodings) {
                        parameters.encodings = [{}];
                    }

                    switch (this.qualityMode) {
                        case 'quality':
                            parameters.encodings[0].maxBitrate = 2500000; // 2.5 Mbps
                            parameters.encodings[0].maxFramerate = 30;
                            this.updateQualityIndicator('HD+', 'quality-high');
                            break;
                        case 'balanced':
                            parameters.encodings[0].maxBitrate = 1500000; // 1.5 Mbps
                            parameters.encodings[0].maxFramerate = 24;
                            this.updateQualityIndicator('HD', 'quality-medium');
                            break;
                        case 'bandwidth':
                            parameters.encodings[0].maxBitrate = 500000; // 0.5 Mbps
                            parameters.encodings[0].maxFramerate = 15;
                            this.updateQualityIndicator('SD', 'quality-low');
                            break;
                    }

                    sender.setParameters(parameters);
                    console.log(`Quality mode set to: ${this.qualityMode}`);

                } catch (error) {
                    console.warn('Error applying quality settings:', error);
                }
            }
        });
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

    // Language detection method - IMPROVED VERSION
    detectMessageLanguage(message) {
        // Early return for very short messages
        if (message.length < 2) return 'en';

        // Clean the message for better detection
        const cleanMessage = message.replace(/[.,!?;:'"()\[\]{}]/g, '').toLowerCase().trim();

        // Language-specific word patterns (expanded list)
        const languagePatterns = {
            'ru': [
                /\b(привет|здравствуй|спасибо|пожалуйста|да|нет|как|что|где|когда|почему|хорошо|плохо|давай|пока)\b/,
                /[а-яё]/
            ],
            'tr': [
                /\b(merhaba|teşekkür|evet|hayır|lütfen|nasıl|ne|nerede|ne zaman|niçin|iyi|kötü|hadi|güle)\b/,
                /[çğıöşü]/
            ],
            'es': [
                /\b(hola|gracias|por favor|sí|no|cómo|qué|dónde|cuándo|por qué|bueno|malo|vamos|adiós)\b/,
                /[ñáéíóúü]/
            ],
            'fr': [
                /\b(bonjour|merci|s'il vous plaît|oui|non|comment|que|où|quand|pourquoi|bon|mauvais|allons|au revoir)\b/,
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

    // Enhanced displayMessage method - FIXED VERSION with dual translation buttons
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
      messageElement.className = 'chat-message';
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

  // Helper method to detect non-Latin characters
  hasNonLatinCharacters(text) {
      // Detect any non-Latin characters (Cyrillic, Arabic, Chinese, Japanese, Korean, etc.)
      const nonLatinPattern = /[^\u0000-\u007F\u00A0-\u00FF\u0100-\u017F\u0180-\u024F]/;
      return nonLatinPattern.test(text);
  }

  // Enhanced language detection method
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

  // Fixed Translation Method - Only disable the used service button
  async translateMessage(messageId, service, buttonElement) {
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
      if (!messageElement) return;

      const originalText = messageElement.querySelector('.original-message').textContent;
      const targetLang = window.languageManager.currentLanguage;

      // Disable only the clicked button during translation
      buttonElement.disabled = true;
      buttonElement.classList.add('translating');
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

          // ONLY disable the used button, keep the other one active
          buttonElement.disabled = true;
          buttonElement.classList.remove('translating');
          buttonElement.classList.add('translated');
          buttonElement.innerHTML = '<span class="translate-icon">✅</span>';
          buttonElement.title = `Translated with ${data.service}`;
          buttonElement.style.opacity = '0.6';

          // Mark which service was used
          messageElement.setAttribute('data-translated-service', service);
          messageElement.setAttribute('data-translated', 'true');

          // Keep the other button active if it exists
          const otherButton = messageElement.querySelector(`.translate-btn:not(.${service}-translate)`);
          if (otherButton && !otherButton.classList.contains('translated')) {
              otherButton.disabled = false;
              otherButton.style.opacity = '1';
          }

          // Add subtle animation to translated text
          translatedElement.style.animation = 'fadeInUp 0.5s ease-out';

          // Show success message
          this.displaySystemMessage(`Message translated with ${data.service}`);

      } catch (error) {
          console.error('Translation error:', error);

          // Re-enable the button on error
          buttonElement.disabled = false;
          buttonElement.classList.remove('translating');
          buttonElement.innerHTML = '<span class="translate-icon">❌</span>';
          buttonElement.title = 'Translation failed - Click to retry';
          buttonElement.classList.add('error');

          // Reset button after 3 seconds
          setTimeout(() => {
              if (messageElement.parentNode) {
                  buttonElement.disabled = false;
                  buttonElement.classList.remove('error');

                  // Reset button icon based on service
                  if (buttonElement.classList.contains('google-translate')) {
                      buttonElement.innerHTML = '<span class="translate-icon">🌐</span>';
                      buttonElement.title = 'Translate with Google';
                  } else {
                      buttonElement.innerHTML = '<span class="translate-icon">🤖</span>';
                      buttonElement.title = 'Translate with DeepSeek';
                  }
              }
          }, 3000);

          this.displaySystemMessage(`${service} translation failed. Please try again.`);
      }
  }

    // HTML escape function for safety
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Translation method with service selection
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

            // KEEP BUTTONS VISIBLE but disable them and show success state
            translateButtons.forEach(btn => {
                btn.disabled = true;
                btn.classList.remove('translating');
                btn.classList.add('translated');

                // Show checkmark on the clicked button
                if (btn === buttonElement) {
                    btn.innerHTML = '<span class="translate-icon">✅</span>';
                    btn.title = 'Translated';
                    btn.style.opacity = '0.7';
                } else {
                    // Show disabled state for other buttons
                    btn.style.opacity = '0.5';
                    btn.title = 'Already translated';
                }
            });

            // Add subtle animation to translated text
            translatedElement.style.animation = 'fadeInUp 0.5s ease-out';

            // Show success message
            this.displaySystemMessage(`Message translated with ${data.service}`);

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

            this.displaySystemMessage(`${service} translation failed. Please try again.`);
        }
    }
    // Debug method to check button visibility 
    debugButtonVisibility() {
        const messages = document.querySelectorAll('.chat-message');
        console.log(`=== BUTTON VISIBILITY DEBUG ===`);
        console.log(`Total messages: ${messages.length}`);

        messages.forEach((message, index) => {
            const buttons = message.querySelector('.translate-buttons');
            const buttonElements = message.querySelectorAll('.translate-btn');
            const isOwn = message.querySelector('.user').textContent.includes('You');
            const isTranslated = message.getAttribute('data-translated') === 'true';

            console.log(`Message ${index + 1}:`);
            console.log(`  - Buttons container exists: ${!!buttons}`);
            console.log(`  - Button elements found: ${buttonElements.length}`);
            console.log(`  - Is own message: ${isOwn}`);
            console.log(`  - Is translated: ${isTranslated}`);
            console.log(`  - Computed display: ${buttons ? window.getComputedStyle(buttons).display : 'N/A'}`);
            console.log(`  - Computed visibility: ${buttons ? window.getComputedStyle(buttons).visibility : 'N/A'}`);
            console.log(`  - Opacity: ${buttons ? window.getComputedStyle(buttons).opacity : 'N/A'}`);

            // Log individual button states
            buttonElements.forEach((btn, btnIndex) => {
                console.log(`  - Button ${btnIndex + 1}:`);
                console.log(`    * Class: ${btn.className}`);
                console.log(`    * Disabled: ${btn.disabled}`);
                console.log(`    * Computed display: ${window.getComputedStyle(btn).display}`);
                console.log(`    * Computed visibility: ${window.getComputedStyle(btn).visibility}`);
            });
        });
        console.log(`=== END DEBUG ===`);
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

    setupScreenSizeControls() {
        const sizeButtons = document.querySelectorAll('.size-btn');
        const videoContainer = document.querySelector('.video-container');

        // Handle size button clicks
        sizeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Remove active class from all buttons
                sizeButtons.forEach(b => b.classList.remove('active'));
                // Add active class to clicked button
                btn.classList.add('active');

                // Remove all ratio classes
                videoContainer.classList.remove('ratio-9-16', 'ratio-16-9', 'ratio-1-1', 'ratio-auto');
                // Add selected ratio class
                videoContainer.classList.add(`ratio-${btn.dataset.ratio}`);

                console.log(`Screen ratio set to: ${btn.dataset.ratio}`);
            });
        });

        // Set default ratio to AUTO instead of 9:16
        const autoBtn = document.querySelector('.size-btn[data-ratio="auto"]');
        if (autoBtn && videoContainer) {
            autoBtn.classList.add('active');
            videoContainer.classList.add('ratio-auto');

            // Remove active class from 9:16 button
            const nineSixteenBtn = document.querySelector('.size-btn[data-ratio="9-16"]');
            if (nineSixteenBtn) {
                nineSixteenBtn.classList.remove('active');
            }
        }
    }

    shareLink() {
        const url = window.location.href;
        navigator.clipboard.writeText(url).then(() => {
            this.displaySystemMessage(window.languageManager.translate('linkCopied'));
        }).catch(() => {
            const textArea = document.createElement('textarea');
            textArea.value = url;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.displaySystemMessage(window.languageManager.translate('linkCopied'));
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

    // System messages (separate from chat)
    displaySystemMessage(message) {
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
        systemMessage.textContent = message;

        systemContainer.appendChild(systemMessage);

        // Remove after animation completes
        setTimeout(() => {
            if (systemMessage.parentNode) {
                systemMessage.parentNode.removeChild(systemMessage);
            }
        }, 4000);
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
}
