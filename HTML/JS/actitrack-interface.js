document.addEventListener('DOMContentLoaded', () => {
    // 設定文字檔的路徑 (假設你在 HTML 同層目錄建了一個 text 資料夾)
    const helpTextUrl = 'text/ActiTrack_Interface_help.txt';
    const container = document.getElementById('dynamic-help-text');

    if (container) {
        // 使用 fetch 抓取外部檔案
        fetch(helpTextUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error('找不到介紹檔案或讀取失敗');
                }
                return response.text();
            })
            .then(htmlContent => {
                // 將抓取到的文字 (包含 HTML 代碼) 渲染到畫面上
                container.innerHTML = htmlContent;
            })
            .catch(error => {
                console.error('讀取說明檔發生錯誤:', error);
                container.innerHTML = '<span style="color: red;">無法載入系統介紹文字，請確認 text/ActiTrack_Interface_help.txt 檔案是否存在。</span>';
            });
    }
});