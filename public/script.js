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
        
        // Setup language selector if it exists
        if (this.languageSelect) {
            this.languageSelect.value = window.languageManager.currentLanguage;
            this.languageSelect.addEventListener('change', (e) => {
                window.languageManager.changeLanguage(e.target.value);
            });
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
            this.displayMessage('System', window.languageManager.translate('errorMediaAccess'), new Date().toLocaleTimeString());
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
            
            // Start stats monitoring
            this.startStatsMonitoring();
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
            this.displayMessage('System', 'Connection lost. Please refresh the page.', new Date().toLocaleTimeString());
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
            this.displayMessage('System', window.languageManager.translate('partnerDisconnected'), new Date().toLocaleTimeString());
        });

        this.socket.on('user-left', (userId) => {
            console.log('User left:', userId);
            this.handleRemoteDisconnect();
            this.displayMessage('System', window.languageManager.translate('partnerDisconnected'), new Date().toLocaleTimeString());
        });

        this.socket.on('redirect-to-lounge', () => {
            window.location.href = '/lounge?success=conversationEnded';
        });

        this.socket.on('conversation-ended', (data) => {
            this.displayMessage('System', data.message, new Date().toLocaleTimeString());
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
        });

        this.socket.on('remote-audio-toggle', (data) => {
            this.isRemoteAudioMuted = data.muted;
            const message = data.muted ? 'Partner muted audio' : 'Partner unmuted audio';
            this.displayMessage('System', message, new Date().toLocaleTimeString());
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
            this.displayMessage('System', message, new Date().toLocaleTimeString());
            
            console.log(`Partner audio ${this.isRemoteAudioMuted ? 'muted' : 'unmuted'}`);
        } else {
            this.displayMessage('System', 'No partner connected', new Date().toLocaleTimeString());
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
                this.videoBtn.textContent = isStopped ? 
                    '📹 ' + window.languageManager.translate('startVideo') : 
                    '📹 ' + window.languageManager.translate('stopVideo');
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

    startStatsMonitoring() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }

        this.statsInterval = setInterval(async () => {
            if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') {
                return;
            }

            try {
                const stats = await this.peerConnection.getStats();
                let videoStats = { framesPerSecond: 0, packetsLost: 0 };
                let audioStats = { packetsLost: 0 };

                stats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        videoStats.framesPerSecond = report.framesPerSecond || 0;
                        videoStats.packetsLost = report.packetsLost || 0;
                    }
                    if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                        audioStats.packetsLost = report.packetsLost || 0;
                    }
                });

                // Update quality indicator based on stats
                let qualityLevel = 'quality-medium';
                let qualityText = 'SD';

                if (videoStats.framesPerSecond >= 20 && videoStats.packetsLost < 10) {
                    qualityLevel = 'quality-high';
                    qualityText = 'HD';
                } else if (videoStats.framesPerSecond < 10 || videoStats.packetsLost > 50) {
                    qualityLevel = 'quality-low';
                    qualityText = 'Low';
                }

                this.updateQualityIndicator(qualityText, qualityLevel);

            } catch (error) {
                console.error('Error getting stats:', error);
            }
        }, 2000);
    }
}
