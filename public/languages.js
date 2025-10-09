// languages.js - Multilingual support
const translations = {
    en: {
        waitingPartner: "Waiting for partner...",
        you: "You",
        auto: "Auto",
        connecting: "Connecting...",
        connected: "Connected",
        reconnecting: "Reconnecting...",
        controls: "Controls",
        mute: "Mute",
        unmute: "Unmute",
        selfMute: "Self Mute",
        selfUnmute: "Self Unmute",
        stopVideo: "Stop Video",
        startVideo: "Start Video",
        quality: "Quality",
        balanced: "Balanced",
        highQuality: "High Quality",
        lowBandwidth: "Low Bandwidth",
        copyLink: "Copy Link",
        statistics: "Statistics",
        bitrate: "Bitrate",
        resolution: "Resolution",
        fps: "FPS",
        packets: "Packets",
        chat: "Chat",
        typeMessage: "Type a message...",
        send: "Send",
        partner: "Partner",
        partnerDisconnected: "Partner disconnected",
        linkCopied: "Link copied to clipboard!",
        audioMuted: "Audio muted",
        audioUnmuted: "Audio unmuted",
        videoStopped: "Video stopped",
        videoStarted: "Video started",
        errorMediaAccess: "Error: Could not access camera/microphone. Please refresh and allow permissions."
    },
    ru: {
        waitingPartner: "Ожидание собеседника...",
        you: "Вы",
        auto: "Авто",
        connecting: "Подключение...",
        connected: "Подключено",
        reconnecting: "Переподключение...",
        controls: "Управление",
        mute: "Выкл. звук",
        unmute: "Вкл. звук",
        selfMute: "Заглушить себя",
        selfUnmute: "Включить себя",
        stopVideo: "Выкл. видео",
        startVideo: "Вкл. видео",
        quality: "Качество",
        balanced: "Сбалансир.",
        highQuality: "Высокое",
        lowBandwidth: "Экономный",
        copyLink: "Копировать ссылку",
        statistics: "Статистика",
        bitrate: "Битрейт",
        resolution: "Разрешение",
        fps: "Кадры/сек",
        packets: "Пакеты",
        chat: "Чат",
        typeMessage: "Введите сообщение...",
        send: "Отправить",
        partner: "Собеседник",
        partnerDisconnected: "Собеседник отключился",
        linkCopied: "Ссылка скопирована!",
        audioMuted: "Звук отключен",
        audioUnmuted: "Звук включен",
        videoStopped: "Видео остановлено",
        videoStarted: "Видео запущено",
        errorMediaAccess: "Ошибка: Не удалось получить доступ к камере/микрофону. Обновите страницу и разрешите доступ."
    },
    tr: {
        waitingPartner: "Partner bekleniyor...",
        you: "Siz",
        auto: "Otomatik",
        connecting: "Bağlanıyor...",
        connected: "Bağlandı",
        reconnecting: "Yeniden bağlanıyor...",
        controls: "Kontroller",
        mute: "Sesi Kapat",
        unmute: "Sesi Aç",
        selfMute: "Kendimi Sustur",
        selfUnmute: "Kendimi Aç",
        stopVideo: "Videoyu Durdur",
        startVideo: "Videoyu Başlat",
        quality: "Kalite",
        balanced: "Dengeli",
        highQuality: "Yüksek Kalite",
        lowBandwidth: "Düşük Bant",
        copyLink: "Linki Kopyala",
        statistics: "İstatistikler",
        bitrate: "Bit hızı",
        resolution: "Çözünürlük",
        fps: "FPS",
        packets: "Paketler",
        chat: "Sohbet",
        typeMessage: "Mesaj yazın...",
        send: "Gönder",
        partner: "Partner",
        partnerDisconnected: "Partner bağlantısı kesildi",
        linkCopied: "Link kopyalandı!",
        audioMuted: "Ses kapatıldı",
        audioUnmuted: "Ses açıldı",
        videoStopped: "Video durduruldu",
        videoStarted: "Video başlatıldı",
        errorMediaAccess: "Hata: Kameraya/mikrofona erişilemedi. Sayfayı yenileyin ve izin verin."
    },
    es: {
        waitingPartner: "Esperando al compañero...",
        you: "Tú",
        auto: "Auto",
        connecting: "Conectando...",
        connected: "Conectado",
        reconnecting: "Reconectando...",
        controls: "Controles",
        mute: "Silenciar",
        unmute: "Activar sonido",
        selfMute: "Silenciarme",
        selfUnmute: "Activar mi sonido",
        stopVideo: "Detener video",
        startVideo: "Iniciar video",
        quality: "Calidad",
        balanced: "Equilibrado",
        highQuality: "Alta calidad",
        lowBandwidth: "Bajo ancho de banda",
        copyLink: "Copiar enlace",
        statistics: "Estadísticas",
        bitrate: "Tasa de bits",
        resolution: "Resolución",
        fps: "FPS",
        packets: "Paquetes",
        chat: "Chat",
        typeMessage: "Escribe un mensaje...",
        send: "Enviar",
        partner: "Compañero",
        partnerDisconnected: "Compañero desconectado",
        linkCopied: "¡Enlace copiado!",
        audioMuted: "Audio silenciado",
        audioUnmuted: "Audio activado",
        videoStopped: "Video detenido",
        videoStarted: "Video iniciado",
        errorMediaAccess: "Error: No se pudo acceder a la cámara/micrófono. Actualice la página y permita el acceso."
    },
    fr: {
        waitingPartner: "En attente du partenaire...",
        you: "Vous",
        auto: "Auto",
        connecting: "Connexion...",
        connected: "Connecté",
        reconnecting: "Reconnexion...",
        controls: "Contrôles",
        mute: "Muet",
        unmute: "Activer le son",
        selfMute: "Me couper",
        selfUnmute: "M'activer",
        stopVideo: "Arrêter la vidéo",
        startVideo: "Démarrer la vidéo",
        quality: "Qualité",
        balanced: "Équilibré",
        highQuality: "Haute qualité",
        lowBandwidth: "Faible bande passante",
        copyLink: "Copier le lien",
        statistics: "Statistiques",
        bitrate: "Débit binaire",
        resolution: "Résolution",
        fps: "FPS",
        packets: "Paquets",
        chat: "Chat",
        typeMessage: "Tapez un message...",
        send: "Envoyer",
        partner: "Partenaire",
        partnerDisconnected: "Partenaire déconnecté",
        linkCopied: "Lien copié !",
        audioMuted: "Audio coupé",
        audioUnmuted: "Audio activé",
        videoStopped: "Vidéo arrêtée",
        videoStarted: "Vidéo démarrée",
        errorMediaAccess: "Erreur : Impossible d'accéder à la caméra/au microphone. Actualisez la page et autorisez l'accès."
    }
};

class LanguageManager {
    constructor() {
        this.currentLang = 'en';
        this.loadLanguage();
        this.setupLanguageSelector();
    }

    loadLanguage() {
        // Get saved language or browser language
        const savedLang = localStorage.getItem('videoChatLang');
        const browserLang = navigator.language.split('-')[0];
        
        this.currentLang = savedLang || (translations[browserLang] ? browserLang : 'en');
        this.applyTranslations();
    }

    setupLanguageSelector() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.initializeSelector();
            });
        } else {
            this.initializeSelector();
        }
    }

    initializeSelector() {
        const selector = document.getElementById('languageSelect');
        if (selector) {
            selector.value = this.currentLang;
            selector.addEventListener('change', (e) => {
                this.changeLanguage(e.target.value);
            });
        }
    }

    changeLanguage(lang) {
        if (translations[lang]) {
            this.currentLang = lang;
            localStorage.setItem('videoChatLang', lang);
            this.applyTranslations();
            
            // Update selector if it exists
            const selector = document.getElementById('languageSelect');
            if (selector) {
                selector.value = lang;
            }
            
            console.log('Language changed to:', lang);
        }
    }

    applyTranslations() {
        // Translate elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            if (translations[this.currentLang][key]) {
                element.textContent = translations[this.currentLang][key];
            }
        });

        // Translate placeholder attributes
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            if (translations[this.currentLang][key]) {
                element.placeholder = translations[this.currentLang][key];
            }
        });

        // Update button texts that are dynamically set
        this.updateDynamicTexts();
    }

    updateDynamicTexts() {
        // Update mute button if it exists
        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            const isMuted = muteBtn.classList.contains('active');
            muteBtn.textContent = isMuted ? '🔊 ' + this.translate('unmute') : '🔇 ' + this.translate('mute');
        }

        // Update self mute button if it exists
        const selfMuteBtn = document.getElementById('selfMuteBtn');
        if (selfMuteBtn) {
            const isMuted = selfMuteBtn.classList.contains('active');
            selfMuteBtn.textContent = isMuted ? '🎤 ' + this.translate('selfUnmute') : '🤫 ' + this.translate('selfMute');
        }

        // Update video button if it exists
        const videoBtn = document.getElementById('videoBtn');
        if (videoBtn) {
            const isStopped = videoBtn.classList.contains('active');
            videoBtn.textContent = isStopped ? '📹 ' + this.translate('startVideo') : '📹 ' + this.translate('stopVideo');
        }

        // Update quality button - use stored quality mode from video chat instance
        const qualityBtn = document.getElementById('qualityBtn');
        if (qualityBtn && window.currentVideoChat) {
            const qualityMode = window.currentVideoChat.qualityMode;
            const modeNames = {
                'balanced': 'balanced',
                'quality': 'highQuality', 
                'bandwidth': 'lowBandwidth'
            };
            
            const qualityText = this.translate('quality');
            const modeText = this.translate(modeNames[qualityMode] || 'balanced');
            qualityBtn.textContent = `⚡ ${qualityText}: ${modeText}`;
        }
    }

    translate(key) {
        return translations[this.currentLang][key] || translations['en'][key] || key;
    }
}

// Create global instance immediately
window.languageManager = new LanguageManager();
