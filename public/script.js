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
        this.roomId = window.location.pathname.split('/').pop();
        this.userId = this.generateUserId();
        this.isConnected = false;
        this.qualityMode = 'balanced';
        this.statsInterval = null;
        this.reconnectionAttempts = 0;
        this.maxReconnectionAttempts = 5;
        this.isRemoteAudioMuted = false;
        this.isLocalAudioMuted = false;
        this.mediaAccessGranted = false;
        
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
        this.chatInput = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.chatMessages = document.getElementById('chatMessages');
        this.remoteLabel = document.getElementById('remoteLabel');
        this.qualityIndicator = document.getElementById('qualityIndicator');
        this.statsPanel = document.getElementById('statsPanel');
        this.connectionStatus = document.getElementById('connectionStatus');
    }

    setupEventListeners() {
        this.muteBtn.addEventListener('click', () => this.toggleRemoteAudio());
        this.selfMuteBtn.addEventListener('click', () => this.toggleLocalAudio());
        this.videoBtn.addEventListener('click', () => this.toggleVideo());
        this.qualityBtn.addEventListener('click', () => this.toggleQualityMode());
        this.shareBtn.addEventListener('click', () => this.shareLink());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
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
            
        } catch (error) {
            console.error('Error initiating connection:', error);
            this.displayMessage('System', window.languageManager.translate('errorMediaAccess'), new Date().toLocaleTimeString());
        }
    }

    async initializeMedia() {
        try {
            console.log('Requesting camera and microphone access...');
            
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            
            // Optimized video constraints for better quality/bandwidth balance
            const videoConstraints = {
                // Resolution - balance between quality and bandwidth
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                
                // Frame rate - crucial for bandwidth
                frameRate: { ideal: 30, max: 30 },
                
                // Device selection
                facingMode: 'user',
                
                // Bitrate control through constraints
                aspectRatio: 16/9
            };

            // Mobile-specific optimizations
            if (isMobile) {
                videoConstraints.width = { ideal: 640, max: 1280 };
                videoConstraints.height = { ideal: 480, max: 720 };
                videoConstraints.frameRate = { ideal: 24, max: 30 };
            }

            // High-quality audio constraints
            const audioConstraints = {
                // Audio quality settings
                channelCount: 2, // Stereo for better quality
                sampleRate: 48000, // Higher sample rate for better quality
                sampleSize: 16,
                
                // Noise processing
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                
                // Latency optimization
                latency: 0.01,
                volume: 1.0
            };

            const constraints = {
                video: videoConstraints,
                audio: audioConstraints
            };
            
            console.log('Using constraints:', constraints);
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            console.log('Camera and microphone access granted');
            this.localVideo.srcObject = this.localStream;
            
            // Log the actual settings obtained
            const videoTrack = this.localStream.getVideoTracks()[0];
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (videoTrack) {
                const settings = videoTrack.getSettings();
                console.log('Actual video settings:', settings);
            }
            if (audioTrack) {
                const settings = audioTrack.getSettings();
                console.log('Actual audio settings:', settings);
            }
            
        } catch (error) {
            console.error('Error accessing media devices:', error);
            
            try {
                console.log('Trying with simpler constraints...');
                // Fallback with still decent quality
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        frameRate: { ideal: 24 }
                    },
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true
                    }
                });
                
                console.log('Camera and microphone access granted with fallback constraints');
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
            iceCandidatePoolSize: 10,
            iceTransportPolicy: 'all'
        };

        this.peerConnection = new RTCPeerConnection(configuration);

        // Create remote stream early
        this.remoteStream = new MediaStream();
        this.remoteVideo.srcObject = this.remoteStream;

        // Add local tracks to peer connection only if media is granted
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log('Adding local track:', track.kind);
                const sender = this.peerConnection.addTrack(track, this.localStream);
                
                // Configure video sender for better quality/bandwidth balance
                if (track.kind === 'video') {
                    this.configureVideoSender(sender);
                }
            });
        }

        // Handle incoming remote tracks - FIXED VERSION
        this.peerConnection.ontrack = (event) => {
            console.log('Received remote track:', event.track.kind, event.track.id);
            
            // Reset reconnection attempts on successful connection
            this.reconnectionAttempts = 0;
            
            // Add track to our remote stream
            if (event.streams && event.streams[0]) {
                console.log('Using stream from event:', event.streams[0].id);
                this.remoteVideo.srcObject = event.streams[0];
            } else {
                console.log('Adding track to remote stream');
                this.remoteStream.addTrack(event.track);
                this.remoteVideo.srcObject = this.remoteStream;
            }
            
            // Set up track ended handler
            event.track.onended = () => {
                console.log('Remote track ended:', event.track.kind);
                this.handleRemoteDisconnect();
            };

            this.updateConnectionStatus('connected');
            this.updateRemoteLabel('partner');
            this.updateQualityIndicator('HD', 'quality-high');
            this.isConnected = true;
            
            // Start stats monitoring
            this.startStatsMonitoring();
        };

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    roomId: this.roomId
                });
            }
        };

        // Handle connection state changes for better reconnection
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
                
                // Stop stats monitoring
                if (this.statsInterval) {
                    clearInterval(this.statsInterval);
                    this.statsInterval = null;
                }
                
                // Attempt reconnection only if media was granted
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
        
        // Stop stats monitoring
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }

    scheduleReconnection() {
        if (this.reconnectionAttempts < this.maxReconnectionAttempts) {
            this.reconnectionAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectionAttempts), 10000); // Exponential backoff
            
            console.log(`Scheduling reconnection attempt ${this.reconnectionAttempts} in ${delay}ms`);
            
            setTimeout(() => {
                if (!this.isConnected && this.mediaAccessGranted) {
                    this.reconnectWebRTC();
                }
            }, delay);
        } else {
            console.log('Max reconnection attempts reached');
            this.displayMessage('System', 'Connection lost. Please refresh the page.', new Date().toLocaleTimeString());
        }
    }

    configureVideoSender(sender) {
        // Wait for negotiation to complete
        setTimeout(() => {
            try {
                const parameters = sender.getParameters();
                if (!parameters.encodings) {
                    parameters.encodings = [{}];
                }
                
                // Optimized video encoding parameters
                parameters.encodings[0] = {
                    // Adaptive bitrate settings
                    maxBitrate: 1500000, // 1.5 Mbps - good quality within reasonable bandwidth
                    maxFramerate: 30,
                    
                    // Scale resolution - 1.0 means full resolution
                    scaleResolutionDownBy: 1.0,
                    
                    // Adaptive settings
                    adaptivePtime: false,
                    priority: 'high',
                    networkPriority: 'high'
                };
                
                // Codec preferences - prefer H.264 for better compression
                parameters.codecs = [
                    {
                        mimeType: 'video/H264',
                        clockRate: 90000,
                        // H.264 profile for better compression
                        profileLevelId: '42e01f' // Baseline profile, level 3.1
                    },
                    {
                        mimeType: 'video/VP8',
                        clockRate: 90000
                    },
                    {
                        mimeType: 'video/VP9',
                        clockRate: 90000
                    }
                ];
                
                sender.setParameters(parameters);
                console.log('Video sender configured with optimized settings');
                
            } catch (error) {
                console.warn('Could not configure video sender parameters:', error);
            }
        }, 1000);
    }

    setupReconnectionHandling() {
        // Handle page refresh/beforeunload
        window.addEventListener('beforeunload', () => {
            if (this.socket) {
                this.socket.emit('user-leaving', {
                    roomId: this.roomId,
                    userId: this.userId
                });
            }
        });

        // Handle page visibility change (tab switch)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Page hidden');
            } else {
                console.log('Page visible - checking connection');
                this.checkAndReconnect();
            }
        });
    }

    checkAndReconnect() {
        if (this.peerConnection && 
            this.peerConnection.connectionState === 'disconnected' && 
            !this.isConnected &&
            this.reconnectionAttempts < this.maxReconnectionAttempts &&
            this.mediaAccessGranted) {
            console.log('Attempting to reconnect...');
            this.reconnectWebRTC();
        }
    }

    startStatsMonitoring() {
        if (this.statsInterval) clearInterval(this.statsInterval);
        
        this.statsInterval = setInterval(async () => {
            if (this.peerConnection && this.peerConnection.connectionState === 'connected') {
                try {
                    const stats = await this.peerConnection.getStats();
                    this.updateStatsDisplay(stats);
                } catch (error) {
                    console.log('Stats error:', error);
                }
            }
        }, 2000);
    }

    updateStatsDisplay(stats) {
        let inboundVideo = null;
        let outboundVideo = null;
        
        stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
                inboundVideo = report;
            }
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
                outboundVideo = report;
            }
        });
        
        // Update stats panel
        if (inboundVideo) {
            const bitrate = Math.round((inboundVideo.bytesReceived / 1024) * 8) + ' kbps';
            const resolution = `${inboundVideo.frameWidth || 0}x${inboundVideo.frameHeight || 0}`;
            const fps = inboundVideo.framesPerSecond || 0;
            const packets = inboundVideo.packetsReceived || 0;
            
            document.getElementById('bitrateStat').textContent = bitrate;
            document.getElementById('resolutionStat').textContent = resolution;
            document.getElementById('fpsStat').textContent = fps;
            document.getElementById('packetsStat').textContent = packets;
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

    setupSocketEvents() {
        this.socket.on('user-connected', async (userId) => {
            console.log('User connected:', userId);
            // Only create offer if we're not already connected and media is granted
            if (!this.isConnected && this.mediaAccessGranted) {
                await this.createOffer();
            }
        });

        this.socket.on('offer', async (data) => {
            // Only handle offer if media is granted
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
            this.displayMessage('System', window.languageManager.translate('partnerDisconnected'), new Date().toLocaleTimeString());
        });

        this.socket.on('user-left', (userId) => {
            console.log('User left:', userId);
            this.displayMessage('System', window.languageManager.translate('partnerDisconnected'), new Date().toLocaleTimeString());
        });

        this.socket.on('reconnect-user', (userId) => {
            console.log('Reconnect requested for:', userId);
            if (!this.isConnected && this.mediaAccessGranted) {
                this.reconnectWebRTC();
            }
        });

        this.socket.on('user-reconnected', (userId) => {
            console.log('User reconnected:', userId);
            if (!this.isConnected && this.mediaAccessGranted) {
                this.createOffer();
            }
        });

        // Fix for duplicate chat messages - use message IDs
        this.socket.on('chat-message', (data) => {
            // Only display if the message is from another user AND has a different messageId
            if (data.userId !== this.userId) {
                const displayName = window.languageManager.translate('partner');
                this.displayMessage(displayName, data.message, data.timestamp, data.messageId);
            }
            // If it's our own message, we already displayed it locally
        });

        // Handle page refresh/reconnection
        this.socket.on('connect', () => {
            console.log('Socket reconnected');
            // Rejoin the room when socket reconnects only if media was granted
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

        // Handle mute/unmute commands from partner
        this.socket.on('remote-audio-toggle', (data) => {
            this.isRemoteAudioMuted = data.muted;
            const message = data.muted ? 'Partner muted audio' : 'Partner unmuted audio';
            this.displayMessage('System', message, new Date().toLocaleTimeString());
        });
    }

    async reconnectWebRTC() {
        console.log('Attempting WebRTC reconnection...');
        try {
            // Clean up old connection
            if (this.peerConnection) {
                this.peerConnection.close();
            }
            
            // Create new connection
            this.createPeerConnection();
            
            // Notify other user about reconnection
            this.socket.emit('user-reconnected', {
                roomId: this.roomId,
                userId: this.userId
            });
            
            // Wait a bit before creating offer
            setTimeout(async () => {
                await this.createOffer();
            }, 1000);
            
        } catch (error) {
            console.error('Reconnection failed:', error);
        }
    }

    async createOffer() {
        try {
            // Don't create offer if already connected or media not granted
            if (this.isConnected || !this.mediaAccessGranted) {
                return;
            }
            
            console.log('Creating offer...');
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('offer', {
                offer: offer,
                roomId: this.roomId
            });
            console.log('Offer sent');
            
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    async handleOffer(data) {
        try {
            // Don't handle offer if already connected or media not granted
            if (this.isConnected || !this.mediaAccessGranted) {
                return;
            }
            
            console.log('Handling offer...');
            await this.peerConnection.setRemoteDescription(data.offer);
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('answer', {
                answer: answer,
                roomId: this.roomId
            });
            console.log('Answer sent');
            
            // Force connection state update
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

    // Mute partner's audio (toggle remote audio)
    toggleRemoteAudio() {
        if (this.remoteStream) {
            const audioTracks = this.remoteStream.getAudioTracks();
            if (audioTracks.length > 0) {
                audioTracks.forEach(track => {
                    track.enabled = !track.enabled;
                });
                this.isRemoteAudioMuted = !audioTracks[0].enabled;
                this.muteBtn.textContent = this.isRemoteAudioMuted ? '🔊 Unmute Partner' : '🔇 Mute Partner';
                this.muteBtn.classList.toggle('active', this.isRemoteAudioMuted);
                
                const message = this.isRemoteAudioMuted ? 'Partner audio muted' : 'Partner audio unmuted';
                this.displayMessage('System', message, new Date().toLocaleTimeString());
            }
        }
    }

    // Mute own audio (prevent transmission to partner)
    toggleLocalAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isLocalAudioMuted = !audioTrack.enabled;
                this.selfMuteBtn.textContent = this.isLocalAudioMuted ? '🎤 Unmute Self' : '🤫 Mute Self';
                this.selfMuteBtn.classList.toggle('active', this.isLocalAudioMuted);
                
                const message = this.isLocalAudioMuted ? 'Your microphone muted' : 'Your microphone unmuted';
                this.displayMessage('System', message, new Date().toLocaleTimeString());

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
                this.videoBtn.textContent = isStopped ? '📹 ' + window.languageManager.translate('startVideo') : '📹 ' + window.languageManager.translate('stopVideo');
                this.videoBtn.classList.toggle('active', isStopped);
                const message = isStopped ? 'videoStopped' : 'videoStarted';
                this.displayMessage('System', window.languageManager.translate(message), new Date().toLocaleTimeString());
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
        this.displayMessage('System', `${qualityText}: ${modeText}`, new Date().toLocaleTimeString());
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
            this.displayMessage('System', window.languageManager.translate('linkCopied'), new Date().toLocaleTimeString());
        }).catch(() => {
            const textArea = document.createElement('textarea');
            textArea.value = url;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.displayMessage('System', window.languageManager.translate('linkCopied'), new Date().toLocaleTimeString());
        });
    }

    sendMessage() {
        const message = this.chatInput.value.trim();
        if (message) {
            // Generate unique message ID
            const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            // Clear input immediately
            this.chatInput.value = '';
            
            // Display the message locally immediately with ID
            this.displayMessage(
                window.languageManager.translate('you'), 
                message, 
                new Date().toLocaleTimeString(),
                messageId
            );
            
            // Send to other users with ID
            this.socket.emit('chat-message', {
                message: message,
                roomId: this.roomId,
                userId: this.userId,
                messageId: messageId,
                timestamp: new Date().toLocaleTimeString()
            });
        }
    }

    displayMessage(user, message, timestamp, messageId = null) {
        // Generate ID if not provided
        const id = messageId || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Check if message with this ID already exists (prevent duplicates)
        const existingMessage = document.querySelector(`[data-message-id="${id}"]`);
        if (existingMessage) {
            return; // Message already displayed
        }
        
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        messageElement.setAttribute('data-message-id', id);
        messageElement.innerHTML = `
            <span class="user">${user}:</span>
            <span class="message">${message}</span>
            <span class="time">${timestamp}</span>
        `;
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
}
