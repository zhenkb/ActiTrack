/**
 * ActiTrack Settings API 客戶端
 * 負責處理教學文字載入、以及未來的 JSON 參數設定與修改 (Params Editor)
 */
class ActiTrackSettingsAPI {
    constructor() {
        // 設定教學文字檔的路徑
        this.textBasePath = 'text/';
    }

    /**
     * 動態載入教學說明的文字檔
     * @param {string} containerId - 裝載文字的 div ID
     */
    async loadTutorialText(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // 從網址列取得參數，例如 ActiTrack_Settings_Tutorial.html?topic=delete_bmi
        const urlParams = new URLSearchParams(window.location.search);
        // 如果沒有參數，預設載入 system_guide
        const topic = urlParams.get('topic') || 'system_guide'; 
        const helpTextUrl = `${this.textBasePath}${topic}.txt`;

        try {
            const response = await fetch(helpTextUrl);
            if (!response.ok) {
                throw new Error('找不到檔案');
            }
            const htmlContent = await response.text();
            container.innerHTML = htmlContent;
        } catch (error) {
            console.error('讀取教學檔發生錯誤:', error);
            container.innerHTML = `<span style="color: #e74c3c; font-weight: bold; font-size: 1.2rem;">無法載入教學文字。<br>請確認 📁 ${helpTextUrl} 檔案是否存在。</span>`;
        }
    }

    /**
     * 預留給 ActiTrack_Params_Editor.html 使用的方法
     */
    async loadSystemParams() {
        console.log("準備串接後端讀取 detector_config.json...");
        // TODO: 呼叫 server.py 取得 JSON
    }

    async saveSystemParams(jsonData) {
        console.log("準備串接後端儲存 detector_config.json...");
        // TODO: 呼叫 server.py 儲存 JSON
    }
}

// 綁定到全域變數
window.ActiTrackSettingsAPI = ActiTrackSettingsAPI;
if (!window.actiTrackSettings) {
    window.actiTrackSettings = new ActiTrackSettingsAPI();
}