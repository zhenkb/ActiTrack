/**
 * ActiTrack 使用者資料同步模組
 */
const USER_CONFIG_URL = '/api/user_config'; // 假設後端有提供此 API 讀取 JSON

class UserSync {
    constructor() {
        this.username = "WebUser"; // 預設值
    }

    // 初始化：從 Server 獲取最新的使用者名稱
    async init() {
        try {
            const res = await fetch(USER_CONFIG_URL);
            const data = await res.json();
            this.username = data.username;
            this.updateUI();
        } catch (e) {
            console.error("無法載入使用者設定:", e);
        }
    }

    // 更新 HTML 中所有標註要顯示使用者名稱的地方
    updateUI() {
        const elements = document.querySelectorAll('[data-user-field="username"]');
        elements.forEach(el => {
            el.textContent = this.username;
        });
    }

    // 提供給儲存紀錄功能使用
    getCurrentUsername() {
        return this.username;
    }
}

// 建立全域實例
window.userSync = new UserSync();
document.addEventListener('DOMContentLoaded', () => window.userSync.init());