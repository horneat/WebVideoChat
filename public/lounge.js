class Lounge {
    constructor() {
        this.currentLanguage = 'en';
        this.lastRoomId = localStorage.getItem('lastRoomId');
        this.socket = io();
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadLanguage();
        this.loadStats();
        this.checkPreviousRoom();
        this.clearUrlParams();
    }

    setupEventListeners() {
        const createRoomBtn = document.getElementById('createRoomBtn');
        const rejoinRoomBtn = document.getElementById('rejoinRoomBtn');
        const joinRoomBtn = document.getElementById('joinRoomBtn');
        const roomIdInput = document.getElementById('roomIdInput');
        const languageSelect = document.getElementById('languageSelect');
        const confirmCreateRoom = document.getElementById('confirmCreateRoom');
        const cancelCreateRoom = document.getElementById('cancelCreateRoom');

        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', () => this.showCreateRoomModal());
        }

        if (rejoinRoomBtn) {
            rejoinRoomBtn.addEventListener('click', () => this.showRejoinSection());
        }

        if (joinRoomBtn) {
            joinRoomBtn.addEventListener('click', () => this.joinExistingRoom());
        }

        if (roomIdInput) {
            roomIdInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.joinExistingRoom();
                }
            });
        }

        if (languageSelect) {
            languageSelect.addEventListener('change', (e) => this.changeLanguage(e.target.value));
        }

        if (confirmCreateRoom) {
            confirmCreateRoom.addEventListener('click', () => this.createNewRoom());
        }

        if (cancelCreateRoom) {
            cancelCreateRoom.addEventListener('click', () => this.hideCreateRoomModal());
        }
    }

    showCreateRoomModal() {
        const modal = document.getElementById('createRoomModal');
        if (modal) {
            modal.style.display = 'flex';
            document.getElementById('roomNameInput').focus();
        }
    }

    hideCreateRoomModal() {
        const modal = document.getElementById('createRoomModal');
        if (modal) {
            modal.style.display = 'none';
            // Reset form
            document.getElementById('roomNameInput').value = '';
            document.getElementById('secretRoomCheckbox').checked = false;
        }
    }

    async createNewRoom() {
        const roomNameInput = document.getElementById('roomNameInput');
        const secretCheckbox = document.getElementById('secretRoomCheckbox');

        const roomName = roomNameInput.value.trim();
        const isSecret = secretCheckbox.checked;

        if (!roomName) {
            this.showError('Please enter a room name');
            return;
        }

        try {
            const response = await fetch('/api/rooms/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    roomName: roomName,
                    isSecret: isSecret
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to create room');
            }

            localStorage.setItem('lastRoomId', data.roomId);
            localStorage.setItem('lastRoomName', data.roomName);

            this.hideCreateRoomModal();
            window.location.href = `/chat/${data.roomId}`;

        } catch (error) {
            console.error('Error creating room:', error);
            this.showError('Failed to create room. Please try again.');
        }
    }

    clearUrlParams() {
        if (window.location.search.includes('error=') || window.location.search.includes('success=')) {
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }
    }

    async loadStats() {
        try {
            const response = await fetch('/api/rooms');
            const data = await response.json();

            document.getElementById('roomCount').textContent = data.totalRooms;
            document.getElementById('userCount').textContent = data.activeUsers;

            this.updateRoomList(data.rooms);

        } catch (error) {
            console.error('Error loading stats:', error);
            document.getElementById('roomCount').textContent = '0';
            document.getElementById('userCount').textContent = '0';
        }
    }

    updateRoomList(rooms) {
        const roomList = document.getElementById('roomList');
        if (!roomList) return;

        if (!rooms || Object.keys(rooms).length === 0) {
            roomList.innerHTML = '<div class="no-rooms" data-i18n="noRoomsAvailable">No active rooms available. Create one!</div>';
            return;
        }

        roomList.innerHTML = '';

        Object.entries(rooms).forEach(([roomId, roomData]) => {
            // Skip secret rooms in public list
            if (roomData.isSecret) return;

            const roomItem = document.createElement('div');
            roomItem.className = 'room-item';
            if (roomData.isSecret) {
                roomItem.classList.add('secret-room');
            }

            roomItem.innerHTML = `
                <div class="room-name">
                    ${this.escapeHtml(roomData.roomName)}
                    ${roomData.isSecret ? '<span class="secret-badge">Secret</span>' : ''}
                </div>
                <div class="room-id">ID: ${roomId}</div>
                <div class="room-stats">
                    ${roomData.userCount} user(s) -
                    Created: ${new Date(roomData.createdAt).toLocaleTimeString()}
                </div>
            `;

            roomItem.addEventListener('click', () => {
                this.joinRoom(roomId);
            });

            roomList.appendChild(roomItem);
        });

        // If no visible rooms after filtering secrets
        if (roomList.children.length === 0) {
            roomList.innerHTML = '<div class="no-rooms" data-i18n="noRoomsAvailable">No active rooms available. Create one!</div>';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    checkPreviousRoom() {
        if (this.lastRoomId) {
            const rejoinSection = document.getElementById('rejoinSection');
            if (rejoinSection) {
                rejoinSection.style.display = 'block';
            }

            const roomIdInput = document.getElementById('roomIdInput');
            if (roomIdInput) {
                roomIdInput.value = this.lastRoomId;
            }
        }
    }

    showRejoinSection() {
        const rejoinSection = document.getElementById('rejoinSection');
        const roomIdInput = document.getElementById('roomIdInput');

        if (rejoinSection) {
            rejoinSection.style.display = 'block';
        }

        if (roomIdInput) {
            if (this.lastRoomId) {
                roomIdInput.value = this.lastRoomId;
            }
            roomIdInput.focus();
        }
    }

    joinExistingRoom() {
        const roomIdInput = document.getElementById('roomIdInput');
        if (!roomIdInput) return;

        const roomId = roomIdInput.value.trim();
        this.joinRoom(roomId);
    }

    joinRoom(roomId) {
        if (!roomId) {
            this.showError('Please enter a room ID');
            return;
        }

        // Validate room ID format (now shorter alphanumeric)
        if (!/^[a-zA-Z0-9]{6,8}$/.test(roomId)) {
            this.showError('Invalid room ID format. Room ID should be 6-8 characters long and contain only letters and numbers.');
            return;
        }

        console.log('Checking room:', roomId);

        // Check if room exists via socket
        this.socket.emit('check-room', roomId, (response) => {
            console.log('Room check response:', response);
            if (response.exists) {
                localStorage.setItem('lastRoomId', roomId);
                window.location.href = `/chat/${roomId}`;
            } else {
                this.showError('Room not found. Please check the room ID or create a new room.');
            }
        });
    }

    showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';

            const successDiv = document.getElementById('successMessage');
            if (successDiv) {
                successDiv.style.display = 'none';
            }

            setTimeout(() => {
                errorDiv.style.display = 'none';
            }, 5000);
        }
    }

    showSuccess(message) {
        const successDiv = document.getElementById('successMessage');
        if (successDiv) {
            successDiv.textContent = message;
            successDiv.style.display = 'block';

            const errorDiv = document.getElementById('errorMessage');
            if (errorDiv) {
                errorDiv.style.display = 'none';
            }

            setTimeout(() => {
                successDiv.style.display = 'none';
            }, 5000);
        }
    }

    loadLanguage() {
        const savedLanguage = localStorage.getItem('preferredLanguage') || 'en';
        this.changeLanguage(savedLanguage);

        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            languageSelect.value = savedLanguage;
        }
    }

    changeLanguage(lang) {
        this.currentLanguage = lang;
        localStorage.setItem('preferredLanguage', lang);

        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(element => {
            const key = element.getAttribute('data-i18n');
            if (languages[lang] && languages[lang][key]) {
                element.textContent = languages[lang][key];
            }
        });

        // Update placeholders
        const roomIdInput = document.getElementById('roomIdInput');
        if (roomIdInput) {
            roomIdInput.placeholder = this.translate('enterRoomId');
        }

        const roomNameInput = document.getElementById('roomNameInput');
        if (roomNameInput) {
            roomNameInput.placeholder = this.translate('enterRoomName');
        }
    }

    translate(key) {
        return languages[this.currentLanguage]?.[key] || key;
    }
}

// Initialize lounge when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.loungeInstance = new Lounge();
});
