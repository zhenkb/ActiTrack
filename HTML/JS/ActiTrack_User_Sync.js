// 瞬間套用資料的獨立函式
function applyUserData(username, avatarShape, cacheTime, fontScale) {
    // 1. 同步名字
    document.querySelectorAll('.user-name').forEach(el => { el.innerText = username; });
    const nameInput = document.getElementById('user-name-input');
    if (nameInput && nameInput.value !== username) nameInput.value = username;

    // 2. 同步設定頁面的下拉選單
    const shapeSelect = document.getElementById('avatar-shape-select');
    if (shapeSelect) shapeSelect.value = avatarShape;

    // 3. 同步頭貼圖片與形狀
    const avatarUrl = `/Photo/user_avatar.jpg?t=${cacheTime}`;
    const borderRadius = (avatarShape === 'circle') ? '50%' : '10px';
    
    const avatarIds = ['sidebar-user-avatar', 'current-avatar'];
    const placeholderIds = ['sidebar-user-placeholder', 'avatar-placeholder'];

    avatarIds.forEach((id, index) => {
        const imgEl = document.getElementById(id);
        const placeholderEl = document.getElementById(placeholderIds[index]);
        
        if (imgEl) {
            imgEl.style.borderRadius = borderRadius;
            imgEl.style.objectFit = 'cover';
            if (placeholderEl) placeholderEl.style.borderRadius = borderRadius;

            // 圖片失效才顯示「無圖」
            imgEl.onerror = () => {
                imgEl.style.display = 'none';
                if (placeholderEl) placeholderEl.style.display = 'block';
            };

            imgEl.src = avatarUrl;
            imgEl.style.display = 'block';
            if (placeholderEl) placeholderEl.style.display = 'none';
        }
    });

    // 4. 同步並套用字體大小
    if (fontScale) {
        document.documentElement.style.setProperty('--font-scale', fontScale);
        localStorage.setItem('actitrack_font_scale', fontScale);
        
        // 如果在設定頁面，同步更新下拉選單或自訂義輸入框
        const select = document.getElementById('font-scale-select');
        const customWrapper = document.getElementById('custom-scale-wrapper');
        const customInput = document.getElementById('font-scale-custom');
        if (select && customWrapper && customInput) {
            const presetValues = ["0.8", "1", "1.2", "1.5"];
            if (presetValues.includes(fontScale.toString())) {
                select.value = fontScale.toString();
                customWrapper.style.display = 'none';
            } else {
                select.value = 'custom';
                customWrapper.style.display = 'flex';
                customInput.value = Math.round(fontScale * 100);
            }
        }
    }
}

// 主要同步函式
async function syncUsernameAndAvatar() {
    // 取得目前的快取設定與時間
    let localCacheTime = localStorage.getItem('actitrack_avatar_time') || new Date().getTime();
    const cachedData = JSON.parse(localStorage.getItem('actitrack_user_config') || '{}');
    const savedScale = localStorage.getItem('actitrack_font_scale') || 1;
    
    // 1. 瞬間套用本機快取 (解決切換頁面閃爍問題)
    applyUserData(
        cachedData.username || "User", 
        cachedData.avatar_shape || "circle", 
        localCacheTime, 
        cachedData.font_scale || savedScale
    );

    // 2. 背景偷偷跟後端比對資料是否最新
    try {
        const response = await fetch('/api/get_user_config?t=' + new Date().getTime());
        const config = await response.json();
        
        // 抓出後端的更新時間 vs 本機快取的更新時間
        const serverUpdateTime = config.last_update || 0;
        const localUpdateTime = cachedData.last_update || 0;

        // 如果發現後端資料有更新 (例如從其他頁面更改了名字、圖片或字體大小)
        if (config.username !== cachedData.username || 
            config.avatar_shape !== cachedData.avatar_shape || 
            config.font_scale != (cachedData.font_scale || savedScale) || 
            serverUpdateTime !== localUpdateTime) {
            
            console.log("偵測到遠端資料有更新，重新同步...");
            
            // 更新本機快取
            localStorage.setItem('actitrack_user_config', JSON.stringify(config));
            
            // 刷新圖片快取時間 (迫使瀏覽器重新下載圖片)
            localCacheTime = new Date().getTime();
            localStorage.setItem('actitrack_avatar_time', localCacheTime);

            // 再次瞬間套用最新資料
            applyUserData(
                config.username || "User", 
                config.avatar_shape || "circle", 
                localCacheTime, 
                config.font_scale || 1
            );
        }
    } catch (e) {
        console.error("同步失敗:", e);
    }
}

// 在每個頁面載入時讀取設定，預設為 1 (100%)
const savedScale = localStorage.getItem('actitrack_font_scale') || 1;
document.documentElement.style.setProperty('--font-scale', savedScale);
document.addEventListener('DOMContentLoaded', syncUsernameAndAvatar);
window.syncUsernameAndAvatar = syncUsernameAndAvatar;