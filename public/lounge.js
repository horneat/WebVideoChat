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
        this.clearUrlParams(); // Clear the error parameter from URL
    }

    setupEventListeners() {
        const createRoomBtn = document.getElementById('createRoomBtn');
        const rejoinRoomBtn = document.getElementById('rejoinRoomBtn');
        const joinRoomBtn = document.getElementById('joinRoomBtn');
        const roomIdInput = document.getElementById('roomIdInput');
        const languageSelect = document.getElementById('languageSelect');

        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', () => this.createNewRoom());
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
    }

    clearUrlParams() {
        // Remove error parameters from URL without reloading
        if (window.location.search.includes('error=')) {
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
            
            // Update room list
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
            const roomItem = document.createElement('div');
            roomItem.className = 'room-item';
            roomItem.innerHTML = `
                <div class="room-id">${roomId}</div>
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

    createNewRoom() {
        console.log('Creating new room...');
        window.location.href = '/chat';
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

        // Validate room ID format
        if (!/^[a-zA-Z0-9-]+$/.test(roomId)) {
            this.showError('Invalid room ID format');
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
                this.showError('Room not found. Please create a new room or check the room ID.');
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
            roomIdInput.placeholder = this.translate('roomIdPlaceholder');
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
