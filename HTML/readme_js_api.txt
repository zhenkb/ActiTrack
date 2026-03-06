ActiTrack Web API 說明文件
=========================

本系統使用 Python FastAPI 提供後端服務，前端 HTML 透過以下方式串接：

1. 顯示即時影像
   在 HTML 任何地方加入：
   <img src="/video_feed" style="width: 100%; height: auto; border-radius: 8px;">

2. 取得運動數據 (JS 範例)
   將以下程式碼加入 HTML 底部：
   
   <script>
   setInterval(async () => {
       try {
           const response = await fetch('/api/status');
           const data = await response.json();
           
           // data 結構: { "count": 10, "feedback": "深蹲: 10 (O:5 X:5)", "distance": 0 }
           
           // 更新畫面 (請確保 HTML 有對應的 ID)
           if(document.getElementById('count-display')) {
               document.getElementById('count-display').innerText = data.count;
           }
           if(document.getElementById('feedback-display')) {
               document.getElementById('feedback-display').innerText = data.feedback;
           }
       } catch (e) {
           console.error("API Error:", e);
       }
   }, 1000); // 每 1000 毫秒 (1秒) 更新一次
   </script>

3. 檔案結構
   /server.py          -> 啟動這個檔 (取代 main_V9.py)
   /HTML/              -> 放所有 .html, .css
   /modules/           -> 原本的 Python 邏輯 (不動)
