// ActiTrack_BMI_Record.js

let globalBodyData = null; // 儲存抓取到的原始資料

document.addEventListener('DOMContentLoaded', () => {
    setupSortListener();
    fetchAndRenderBodyRecords();
});

function setupSortListener() {
    const sortSelect = document.getElementById('sort-order');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            if (globalBodyData) {
                renderBodyRecords(globalBodyData, e.target.value);
            }
        });
    }
}

// 輔助函式：將 Python 給的 "2026/2/24 上午5:15:00" 轉為可用於比較的毫秒數
function parseTaiwanTime(dateStr) {
    if (!dateStr) return 0;
    const parts = dateStr.split(' ');
    if (parts.length < 2) return new Date(dateStr).getTime() || 0;
    
    const dPart = parts[0];
    const tPart = parts[1];
    let h = 0, m = 0, s = 0;
    
    let isPM = tPart.includes('下午');
    let cleanTime = tPart.replace('上午', '').replace('下午', '');
    let tSplits = cleanTime.split(':');
    
    if (tSplits.length >= 2) {
        h = parseInt(tSplits[0]);
        m = parseInt(tSplits[1]);
        s = parseInt(tSplits[2] || 0);
    }
    
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    
    return new Date(`${dPart} ${h}:${m}:${s}`).getTime();
}

async function fetchAndRenderBodyRecords() {
    const container = document.getElementById('records-container');
    try {
        const response = await fetch('/api/get_body_records');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        globalBodyData = await response.json();
        
        if (!globalBodyData || globalBodyData.length === 0) {
            container.innerHTML = '<div class="loading-text">目前尚無歷史BMI數值紀錄。</div>';
            return;
        }

        const sortSelect = document.getElementById('sort-order');
        const sortOrder = sortSelect ? sortSelect.value : 'desc';
        renderBodyRecords(globalBodyData, sortOrder);

    } catch (error) {
        console.error("載入紀錄失敗:", error);
        container.innerHTML = '<div class="loading-text" style="color:#e74c3c;">資料載入失敗，請確認伺服器連線與 API 設定。</div>';
    }
}

function renderBodyRecords(data, sortOrder) {
    const container = document.getElementById('records-container');
    const groupedRecords = {};
    
    data.forEach(record => {
        const dateStr = record.last_updated || "";
        const parts = dateStr.split(' ');
        const datePart = parts[0] || "未知日期";
        const timePart = parts.slice(1).join(' ') || "";

        record.displayTime = timePart;
        record.parsedTimeMs = parseTaiwanTime(dateStr); // 存入解析後的毫秒數供排序使用

        if (!groupedRecords[datePart]) {
            groupedRecords[datePart] = [];
        }
        groupedRecords[datePart].push(record);
    });

    // 依據 sortOrder 進行日期排序
    const sortedDates = Object.keys(groupedRecords).sort((a, b) => {
        const dateA = new Date(a).getTime() || 0;
        const dateB = new Date(b).getTime() || 0;
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    let html = '';

    sortedDates.forEach(date => {
        html += `<div class="date-group">
                    <div class="date-title">📅 ${date}</div>
                    <div class="record-grid">`;
        
        let dailyRecords = groupedRecords[date];

        // 依據 sortOrder 進行每日內的時間排序
        dailyRecords.sort((a, b) => {
            return sortOrder === 'desc' ? b.parsedTimeMs - a.parsedTimeMs : a.parsedTimeMs - b.parsedTimeMs;
        });

        dailyRecords.forEach(record => {
            const basic = record.basic_info || {};
            const opt = record.optional_info || {};
            const height = basic.height_cm || 0;
            const weight = basic.weight_kg || 0;
            
            let bmiDisplay = "-";
            if (height > 0 && weight > 0) {
                const heightInMeter = height / 100;
                const bmi = weight / (heightInMeter * heightInMeter);
                bmiDisplay = bmi.toFixed(1);
            }

            const bodyFat = opt.body_fat_percent !== null && opt.body_fat_percent !== undefined ? `${opt.body_fat_percent}%` : "-";
            const muscle = opt.skeletal_muscle_kg !== null && opt.skeletal_muscle_kg !== undefined ? `${opt.skeletal_muscle_kg} kg` : "-";
            const age = opt.age !== null && opt.age !== undefined ? `${opt.age} 歲` : "-";

            html += `
                <div class="record-card">
                    <div class="record-header">
                        <span class="time-badge">🕒 ${record.displayTime}</span>
                        <span class="ex-name">身體數值紀錄</span>
                    </div>
                    <div class="record-body">
                        <div class="stat-item"><span class="stat-label">身高</span><span class="stat-val">${height} cm</span></div>
                        <div class="stat-item"><span class="stat-label">體重</span><span class="stat-val">${weight} kg</span></div>
                        <div class="stat-item"><span class="stat-label">BMI</span><span class="stat-val">${bmiDisplay}</span></div>
                        <div class="stat-item"><span class="stat-label">年齡</span><span class="stat-val">${age}</span></div>
                        <div class="stat-item"><span class="stat-label">體脂率</span><span class="stat-val">${bodyFat}</span></div>
                        <div class="stat-item"><span class="stat-label">骨骼肌</span><span class="stat-val">${muscle}</span></div>
                    </div>
                </div>
            `;
        });
        html += `</div></div>`;
    });

    container.innerHTML = html;
}