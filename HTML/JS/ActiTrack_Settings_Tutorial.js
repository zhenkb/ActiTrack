document.addEventListener('DOMContentLoaded', () => {
    // 載入外部的教學說明檔
    const helpTextUrl = 'text/ActiTrack_Settings_Tutorial_help.txt';
    const container = document.getElementById('dynamic-tutorial-text');

    if (container) {
        fetch(helpTextUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error('找不到教學檔案或讀取失敗');
                }
                return response.text();
            })
            .then(htmlContent => {
                // 將讀取到的文字塞入容器
                container.innerHTML = htmlContent;
            })
            .catch(error => {
                console.error('讀取教學檔發生錯誤:', error);
                container.innerHTML = '<span style="color: red; font-weight: bold;">無法載入系統教學文字，請確認 text/ActiTrack_Settings_Tutorial_help.txt 檔案是否存在。</span>';
            });
    }
});