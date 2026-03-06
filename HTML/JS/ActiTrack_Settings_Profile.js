document.addEventListener('DOMContentLoaded', () => {
    const avatarTrigger = document.getElementById('avatar-trigger');
    const avatarBtnTrigger = document.getElementById('avatar-btn-trigger');
    const fileInput = document.getElementById('file-input');
    const cropModal = document.getElementById('crop-modal');
    const imageToCrop = document.getElementById('image-to-crop');
    const cropCancel = document.getElementById('crop-cancel');
    const cropConfirm = document.getElementById('crop-confirm');
    
    let cropper = null;

    // --- 1. 系統通知 (Toast) ---
    function showNotification(msg, type = 'success') {
        let toast = document.getElementById('actitrack-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'actitrack-toast';
            document.body.appendChild(toast);
            toast.style.position = 'fixed';
            toast.style.bottom = '30px';
            toast.style.right = '30px';
            toast.style.padding = '15px 25px';
            toast.style.borderRadius = '10px';
            toast.style.color = '#fff';
            toast.style.fontSize = '16px';
            toast.style.fontWeight = 'bold';
            toast.style.zIndex = '9999';
            toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
            toast.style.transition = 'opacity 0.3s, transform 0.3s';
        }
        toast.style.backgroundColor = type === 'success' ? '#2ecc71' : '#e74c3c';
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
        toast.style.display = 'block';
        toast.innerText = msg;

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.style.display = 'none', 300);
        }, 2500);
    }

    // --- 2. 頭像裁切與上傳邏輯 ---
    function triggerFileInput() { if (fileInput) fileInput.click(); }
    if (avatarTrigger) avatarTrigger.addEventListener('click', triggerFileInput);
    if (avatarBtnTrigger) avatarBtnTrigger.addEventListener('click', triggerFileInput);

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    if (imageToCrop) imageToCrop.src = event.target.result;
                    if (cropModal) cropModal.style.display = 'flex';

                    if (cropper) cropper.destroy();
                    cropper = new Cropper(imageToCrop, {
                        aspectRatio: 1, viewMode: 1, dragMode: 'move', autoCropArea: 0.8,
                        restore: false, guides: false, center: false, highlight: false,
                        cropBoxMovable: false, cropBoxResizable: false, toggleDragModeOnDblclick: false,
                    });
                };
                reader.readAsDataURL(file);
            }
            fileInput.value = ''; 
        });
    }

    function closeCropModal() {
        if (cropModal) cropModal.style.display = 'none';
        if (cropper) { cropper.destroy(); cropper = null; }
    }
    if (cropCancel) cropCancel.addEventListener('click', closeCropModal);

    if (cropConfirm) {
        cropConfirm.addEventListener('click', () => {
            if (!cropper) return;
            const canvas = cropper.getCroppedCanvas({ width: 300, height: 300, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });

            canvas.toBlob(async (blob) => {
                const formData = new FormData();
                formData.append('file', blob, 'user_avatar.jpg');

                const originalBtnText = cropConfirm.innerText;
                cropConfirm.innerText = '上傳中...';
                cropConfirm.disabled = true;

                try {
                    const response = await fetch('/api/upload_avatar', { method: 'POST', body: formData });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'success') {
                            closeCropModal();
                            showNotification('✅ 頭貼更新成功！', 'success');
                            localStorage.setItem('actitrack_avatar_time', new Date().getTime());
                            if (typeof window.syncUsernameAndAvatar === 'function') window.syncUsernameAndAvatar();
                        } else {
                            showNotification('❌ 圖片上傳失敗，請稍後再試。', 'error');
                        }
                    } else {
                        throw new Error('網路請求失敗');
                    }
                } catch (error) {
                    showNotification('❌ 發生錯誤，無法連接到伺服器。', 'error');
                } finally {
                    cropConfirm.innerText = originalBtnText;
                    cropConfirm.disabled = false;
                }
            }, 'image/jpeg', 0.8);
        });
    }

    // --- 3. 暱稱與一般設定更新 ---
    async function updateUsername() {
        const nameInput = document.getElementById('user-name-input');
        const shapeSelect = document.getElementById('avatar-shape-select'); 
        if (!nameInput) return;
        
        const newName = nameInput.value;
        const newShape = shapeSelect ? shapeSelect.value : 'circle';
        const currentScale = localStorage.getItem('actitrack_font_scale') || 1;
        
        try {
            const response = await fetch('/api/save_user_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    username: newName, 
                    avatar_shape: newShape,
                    font_scale: parseFloat(currentScale) 
                })
            });
            
            if (response.ok) {
                showNotification('✅ 設定與字體更新成功！', 'success');
                localStorage.setItem('actitrack_avatar_time', new Date().getTime());
                
                // 更新本機的 cached config 防止下一次 sync 被洗掉
                const cachedData = JSON.parse(localStorage.getItem('actitrack_user_config') || '{}');
                cachedData.username = newName;
                cachedData.avatar_shape = newShape;
                cachedData.font_scale = parseFloat(currentScale);
                localStorage.setItem('actitrack_user_config', JSON.stringify(cachedData));
                
                if (typeof window.syncUsernameAndAvatar === 'function') window.syncUsernameAndAvatar();
            } else {
                showNotification('❌ 伺服器拒絕請求，儲存失敗。', 'error');
            }
        } catch (error) {
            showNotification('❌ 網路請求失敗。', 'error');
        }
    }

    // --- 4. 字體大小設定 (初始化載入) ---
    async function loadFontScale() {
        try {
            const response = await fetch('/api/get_user_config');
            const config = await response.json();
            
            const savedScale = config.font_scale || localStorage.getItem('actitrack_font_scale') || 1;
            document.documentElement.style.setProperty('--font-scale', savedScale);
            localStorage.setItem('actitrack_font_scale', savedScale);
            
            const select = document.getElementById('font-scale-select');
            const customWrapper = document.getElementById('custom-scale-wrapper');
            const customInput = document.getElementById('font-scale-custom');
            
            if(select && customWrapper && customInput) {
                const presetValues = ["0.8", "1", "1.2", "1.5"];
                if (presetValues.includes(savedScale.toString())) {
                    select.value = savedScale.toString();
                    customWrapper.style.display = 'none';
                } else {
                    select.value = 'custom';
                    customWrapper.style.display = 'flex';
                    customInput.value = Math.round(savedScale * 100);
                }
            }
        } catch (e) {
            console.error("讀取字體設定失敗:", e);
        }
    }
    // 改由 ActiTrack_User_Sync.js 統一負責載入，避免兩次 fetch 浪費資源與衝突
    // loadFontScale(); 

    // --- 5. 字體選單切換與儲存邏輯 (綁定到 Window) ---
    window.handleFontScaleChange = function() {
        const select = document.getElementById('font-scale-select');
        const customWrapper = document.getElementById('custom-scale-wrapper');
        const customInput = document.getElementById('font-scale-custom');
        if (!select) return;

        if (select.value === 'custom') {
            customWrapper.style.display = 'flex';
            if (!customInput.value) customInput.value = 100;
            window.applyCustomFontScale();
        } else {
            customWrapper.style.display = 'none';
            const scale = parseFloat(select.value);
            setFontScaleAndSave(scale);
        }
    };

    window.applyCustomFontScale = function() {
        const customInput = document.getElementById('font-scale-custom');
        if (!customInput) return;
        
        let percentage = parseInt(customInput.value);
        if (isNaN(percentage)) percentage = 100;
        if (percentage < 50) percentage = 50;
        if (percentage > 300) percentage = 300;
        
        customInput.value = percentage;
        setFontScaleAndSave(percentage / 100);
    };

    async function setFontScaleAndSave(scaleValue) {
        document.documentElement.style.setProperty('--font-scale', scaleValue);
        localStorage.setItem('actitrack_font_scale', scaleValue);

        try {
            const response = await fetch('/api/save_user_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ font_scale: scaleValue })
            });
            if (response.ok) {
                console.log(`✅ 字體大小 ${scaleValue} 已成功存入 user_config.json`);
                // 更新快取
                const cachedData = JSON.parse(localStorage.getItem('actitrack_user_config') || '{}');
                cachedData.font_scale = scaleValue;
                localStorage.setItem('actitrack_user_config', JSON.stringify(cachedData));
            }
        } catch (error) {
            console.error("❌ 網路請求失敗:", error);
        }
    }

    // 暴露更新暱稱的函數給 HTML
    window.updateUsername = updateUsername;
});