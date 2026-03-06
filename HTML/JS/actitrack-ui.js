/**
 * ActiTrack UI 控制器
 * 專門處理網頁的視覺特效、側邊欄拖曳、以及選單狀態記憶
 */
class ActiTrackUI {
    static init() {
        this.initSidebarResizer();
        
        // 確保 API 已經載入，並動態生成選單
        if (!window.actiTrack) {
            window.actiTrack = new ActiTrackAPI();
        }
        if (document.getElementById('submenu1')) {
            window.actiTrack.loadSportsMenu('submenu1');
        }
    }

    static toggleSidebar() {
        const sidebar = document.getElementById('sidebar'); 
        const restoreBtn = document.getElementById('restore-btn'); 
        if (!sidebar || !restoreBtn) return;

        sidebar.classList.toggle('hidden'); 
        if (sidebar.classList.contains('hidden')) { 
            setTimeout(() => restoreBtn.classList.add('visible'), 300); 
        } else { 
            restoreBtn.classList.remove('visible'); 
        } 
    }

    // 子選單展開與收合 (包含狀態寫入與恢復動畫)
    static toggleSubmenu(id) {
        const sm = document.getElementById(id); 
        const icon = document.getElementById(id === 'submenu1' ? 'icon1' : 'icon2'); 
        if (!sm || !icon) return;
        
        // ★ 關鍵：只有在使用者「手動點擊」時，才賦予滑動動畫
        sm.style.transition = 'max-height 0.3s ease-in-out';
        
        sm.classList.toggle('collapsed');
        
        if(sm.classList.contains('collapsed')) { 
            icon.classList.remove('rotated'); 
            localStorage.setItem('actitrack_' + id, 'closed'); // 寫入記憶：關閉
        } else { 
            icon.classList.add('rotated'); 
            localStorage.setItem('actitrack_' + id, 'open');   // 寫入記憶：打開
        } 
    }

    static initSidebarResizer() {
        const resizer = document.getElementById('resizer');
        const sidebar = document.getElementById('sidebar'); 
        if (!resizer || !sidebar) return;

        let isResizing = false;
        
        resizer.addEventListener('mousedown', () => { 
            isResizing = true; 
            document.body.style.cursor = 'col-resize'; 
            sidebar.style.transition = 'none'; 
            resizer.classList.add('active'); 
        });
        document.addEventListener('mousemove', (e) => { 
            if(!isResizing) return; 
            let p = (e.clientX / window.innerWidth) * 100; 
            if(p < 10) p = 10; 
            if(p > 50) p = 50; 
            sidebar.style.flex = `0 0 ${p}%`; 
            sidebar.style.width = `${p}%`; 
        });
        document.addEventListener('mouseup', () => { 
            if(!isResizing) return; 
            isResizing = false; 
            document.body.style.cursor = 'default'; 
            sidebar.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'; 
            resizer.classList.remove('active'); 
        });
    }
}

// 綁定到全域環境
window.toggleSidebar = () => ActiTrackUI.toggleSidebar();
window.toggleSubmenu = (id) => ActiTrackUI.toggleSubmenu(id);
window.startSpecificSport = (modeName) => {
    window.location.href = `ActiTrack_Detect.html?mode=${modeName}`;
};

// ==========================================
// ★ 終極防閃爍機制：瞬間還原狀態 (Instant Restore)
// ==========================================
(function instantRestore() {
    // 1. 先從快取把選單印出來，撐開高度
    const submenu1 = document.getElementById('submenu1');
    if (submenu1) {
        const cachedString = localStorage.getItem('actitrack_sports_menu_cache');
        if (cachedString) {
            try {
                const menuData = JSON.parse(cachedString);
                const isDetectPage = window.location.pathname.includes('ActiTrack_Detect.html');
                const currentMode = new URLSearchParams(window.location.search).get('mode') || 'auto';
                
                let html = '';
                menuData.forEach(item => {
                    let activeClass = (isDetectPage && item.class_name === currentMode) ? 'active' : '';
                    html += `<div class="submenu-item ${activeClass}" onclick="startSpecificSport('${item.class_name}')">${item.display_name}</div>`;
                });
                submenu1.innerHTML = html;
            } catch (e) { console.error("選單快取解析失敗", e); }
        }
    }

    // 2. 處理展開/收合狀態
    ['submenu1', 'submenu2'].forEach(id => {
        const savedState = localStorage.getItem('actitrack_' + id);
        const sm = document.getElementById(id);
        const icon = document.getElementById(id === 'submenu1' ? 'icon1' : 'icon2');
        
        if (sm && icon) {
            sm.style.transition = 'none'; // 徹底關閉動畫防止跳動
            
            if (savedState === 'open') {
                sm.classList.remove('collapsed');
                icon.classList.add('rotated');
            } else {
                sm.classList.add('collapsed');
                icon.classList.remove('rotated');
            }
            
            setTimeout(() => { sm.style.transition = 'max-height 0.3s ease'; }, 50);
        }
    });
})();

// 當網頁其他元素載入完畢後，啟動剩餘的 UI 控制器 (如側邊欄拖曳)
document.addEventListener('DOMContentLoaded', () => {
    ActiTrackUI.init();
});