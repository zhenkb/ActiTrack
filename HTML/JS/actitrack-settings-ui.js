function toggleSidebar() {
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

function toggleSubmenu(id) {
    const sm = document.getElementById(id);
    const icon = document.getElementById(id === 'submenu1' ? 'icon1' : 'icon2');
    if (!sm || !icon) return;

    if (sm.style.display === 'none' || sm.style.display === '') {
        sm.style.display = 'block';
        icon.classList.add('rotated');
        localStorage.setItem('actitrack_' + id, 'open');
    } else {
        sm.style.display = 'none';
        icon.classList.remove('rotated');
        localStorage.setItem('actitrack_' + id, 'closed');
    }
}

// 頁面載入時：自動還原狀態 & 綁定拖曳事件
document.addEventListener('DOMContentLoaded', () => {
    // 1. 還原選單狀態
    ['submenu1', 'submenu2'].forEach(id => {
        const savedState = localStorage.getItem('actitrack_' + id);
        const sm = document.getElementById(id);
        const icon = document.getElementById(id === 'submenu1' ? 'icon1' : 'icon2');
        
        if (sm && icon) {
            if (savedState === 'open') {
                sm.style.display = 'block';
                icon.classList.add('rotated');
            } else if (savedState === 'closed') {
                sm.style.display = 'none';
                icon.classList.remove('rotated');
            }
        }
    });

    // 2. 側邊欄拖曳
    const resizer = document.getElementById('resizer');
    const sidebar = document.getElementById('sidebar');
    if (resizer && sidebar) {
        let isResizing = false;
        resizer.addEventListener('mousedown', () => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            sidebar.style.transition = 'none';
            resizer.classList.add('active');
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            let p = (e.clientX / window.innerWidth) * 100;
            if (p < 10) p = 10;
            if (p > 50) p = 50;
            sidebar.style.flex = `0 0 ${p}%`;
            sidebar.style.width = `${p}%`;
        });
        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            document.body.style.cursor = 'default';
            sidebar.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            resizer.classList.remove('active');
        });
    }
});