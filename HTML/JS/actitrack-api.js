/**
 * ActiTrack API 客戶端
 * 負責與 server.py 溝通，統一管理影像串流與數據更新
 */
const API_CONFIG = {
    statusEndpoint: '/api/status',
    videoEndpoint: '/video_feed',
    skeletonEndpoint: '/api/toggle_skeleton',
    stopEndpoint: '/api/stop',
    menuEndpoint: '/api/sports_menu',
    updateInterval: 50,
};

class ActiTrackAPI {
    constructor() {
        this.intervalId = null;
        this.isSwitching = false;
        window.addEventListener('beforeunload', () => this.forceStop());
        window.addEventListener('pagehide', () => this.forceStop());
    }

    async loadSportsMenu(containerId) {
        try {
            const container = document.getElementById(containerId);
            if (!container) return;
            
            const res = await fetch(API_CONFIG.menuEndpoint);
            if (!res.ok) return;
            const menuData = await res.json();
            
            const urlParams = new URLSearchParams(window.location.search);
            const currentMode = urlParams.get('mode') || 'auto';
            // 判斷當前是否在 Detect 頁面
            const isDetectPage = window.location.pathname.includes('ActiTrack_Detect.html');
            
            let html = '';

            // 只有在 Detect 頁面時，才會加上 active (深色樣式)
            const autoActiveClass = (isDetectPage && currentMode === 'auto') ? ' active' : '';
            html += `<div class="submenu-item${autoActiveClass}" onclick="startSpecificSport('auto')">自動偵測模式</div>`;
            
            menuData.forEach(item => {
                const activeClass = (isDetectPage && currentMode === item.class_name) ? ' active' : '';
                html += `<div class="submenu-item${activeClass}" onclick="startSpecificSport('${item.class_name}')">${item.display_name}</div>`;
            });
            container.innerHTML = html;

            const savedState = localStorage.getItem('actitrack_' + containerId);
            if (savedState === 'open') {
                container.style.transition = 'none'; 
                container.classList.remove('collapsed');
                void container.offsetHeight; 
                container.style.transition = 'max-height 0.3s ease-in-out'; 
            }        
        } catch (e) {
            console.error("載入選單失敗", e);
        }
    }

    startMonitoring(elements) {
        this.currentElements = elements;
        if (this.intervalId) clearInterval(this.intervalId);
        
        const videoEl = document.getElementById(elements.videoId);
        if (videoEl) {
            videoEl.src = `${API_CONFIG.videoEndpoint}?t=${new Date().getTime()}`;
        }

        this.intervalId = setInterval(async () => {
            try {
                const res = await fetch(API_CONFIG.statusEndpoint);
                if (!res.ok) return;
                const data = await res.json();
                this._updateUI(data, elements);
            } catch (e) {
                // 忽略網路小錯誤
            }
        }, API_CONFIG.updateInterval);
    }

    _updateUI(data, elements) {
        if (elements.modeId) {
            const modeEl = document.getElementById(elements.modeId);
            if (modeEl) modeEl.textContent = data.locked_mode;
        }
        if (elements.countId) {
            const countEl = document.getElementById(elements.countId);
            if (countEl) countEl.textContent = data.main_count;
        }
        if (elements.badCountId) {
            const badCountEl = document.getElementById(elements.badCountId);
            if (badCountEl) badCountEl.textContent = data.main_wrong;
        }
        if (elements.panelId) {
            const panelEl = document.getElementById(elements.panelId);
            if (panelEl) panelEl.innerHTML = this._buildPanel(data.details);
        }
    }

    _buildPanel(details) {
        const urlParams = new URLSearchParams(window.location.search);
        const currentMode = urlParams.get('mode') || 'auto';
        
        const filteredDetails = details.filter(item => {
            if (currentMode === 'auto') return true;
            return item.class_name === currentMode;
        });

        if (filteredDetails.length === 0) {
            return '<div class="loading-text">載入偵測模組中...</div>';
        }

        let html = `<div class="param-list">
            <div class="param-row header">
                <div class="param-name">運動項目</div>
                <div class="param-correct">正確</div>
                <div class="param-wrong">錯誤</div>
            </div>`;

        filteredDetails.forEach(item => {
            let rowClass = 'param-row';
            if (item.locked) {
                rowClass += ' locked';
            } else if (!item.active) {
                rowClass += ' inactive';
            }

            const correctDisplay = item.is_running ? `${item.value}m` : item.correct;
            const wrongDisplay = item.is_running ? '-' : item.wrong;

            html += `
                <div class="${rowClass}">
                    <div class="param-name" title="${item.label}">${item.label}</div>
                    <div class="param-correct">${correctDisplay}</div>
                    <div class="param-wrong">${wrongDisplay}</div>
                </div>`;
        });
        
        return html + '</div>';
    }

    toggleSkeleton(enable) {
        fetch(`${API_CONFIG.skeletonEndpoint}?enable=${enable}`, { method: 'POST' }).catch(()=>{});
    }

    stopMonitoring() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.forceStop();
    }

    forceStop() {
        try { navigator.sendBeacon(API_CONFIG.stopEndpoint); } 
        catch (e) { fetch(API_CONFIG.stopEndpoint, { method: 'POST', keepalive: true }).catch(()=>{}); }
    }
}

window.ActiTrackAPI = ActiTrackAPI;
if (!window.actiTrack) {
    window.actiTrack = new ActiTrackAPI();
}