// ActiTrack_Exercise_Record.js

let globalExerciseData = null; // 儲存整理後的資料
let globalDynamicExNameMap = {};
let globalDefaultExNameMap = {

};
// ActiTrack_Exercise_Record.js 最上方加入這個函式
function cleanStringForMatch(str) {
    if (!str) return "";
    // 轉小寫 -> 去掉 detector -> 去掉所有非英數字元 (完美防呆)
    return str.toLowerCase().replace(/detector/g, "").replace(/[^a-z0-9]/g, "");
}

document.addEventListener('DOMContentLoaded', () => {
    ActiTrackUI.init();
    setupSortListener();
    fetchAndRenderRecords();
});

function setupSortListener() {
    const sortSelect = document.getElementById('sort-order');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            if (globalExerciseData) {
                renderRecords(globalExerciseData, e.target.value);
            }
        });
    }
}

async function fetchAndRenderRecords() {
    const container = document.getElementById('records-container');
    try {
        // 1. 動態建立翻譯字典
        try {
            if (menuRes.ok) {
                const menuData = await menuRes.json();
                menuData.forEach(item => {
                    // 原本的精準對應保留
                    globalDynamicExNameMap[item.class_name] = item.display_name;
                    //新增：加入版的金鑰！ (例如: PushUpDetector -> pushup)
                    if (item.class_name) {
                        const cleanKey = cleanStringForMatch(item.class_name);
                        globalDynamicExNameMap[cleanKey] = item.display_name;
                    }
                });
            }
        } catch (e) {
            console.warn("無法取得動態語言對應表，將使用預設名稱", e);
        }

        // 2. 請求歷史紀錄
        const response = await fetch('/api/get_history_records');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const rawData = await response.json();
        
        if (!rawData || rawData.length === 0) {
            container.innerHTML = '<div class="loading-text">目前尚無歷史運動紀錄。</div>';
            return;
        }

        // 3. 攤平並重新整理 JSON 陣列
        let processedData = [];
        
        rawData.forEach(fileData => {
            // 因為你的每個檔案的最外層可能是一個陣列 (Array)，先把它統一轉成陣列處理
            let sessionList = Array.isArray(fileData) ? fileData : [fileData];
            
            sessionList.forEach(session => {
                // 確保裡面有 exercise_records
                if (session.exercise_records && Array.isArray(session.exercise_records)) {
                    session.exercise_records.forEach(rec => {
                        // 解析 timestamp (例如: "2026/02/13 15:06:07")
                        const timeStr = rec.timestamp || "";
                        const parts = timeStr.split(" ");
                        const datePart = parts[0] || "未知日期";
                        const timePart = parts[1] || "未知時間";
                        
                        // 轉換成毫秒數方便後續精準排序
                        const parsedTimeMs = new Date(timeStr).getTime() || 0;

                        processedData.push({
                            date: datePart,
                            time: timePart,
                            parsedTimeMs: parsedTimeMs,
                            exerciseName: rec.exercise_name || "未知運動",
                            totalCount: rec.total_count || 0,
                            correctCount: rec.correct_count || 0,
                            wrongCount: rec.wrong_count || 0,
                            accuracy: rec.accuracy !== undefined ? rec.accuracy : null,
                            distanceM: rec.distance_m !== undefined ? rec.distance_m : null,
                            durationSec: rec.duration_sec !== undefined ? rec.duration_sec : null
                        });
                    });
                }
            });
        });

        globalExerciseData = processedData;

        // 如果整理後沒有紀錄
        if (globalExerciseData.length === 0) {
            container.innerHTML = '<div class="loading-text">目前尚無有效的歷史運動紀錄。</div>';
            return;
        }

        // 取得目前選單的排序方式並渲染 (預設 desc: 新到舊)
        const sortSelect = document.getElementById('sort-order');
        const sortOrder = sortSelect ? sortSelect.value : 'desc';
        renderRecords(globalExerciseData, sortOrder);

    } catch (error) {
        console.error("載入紀錄失敗:", error);
        container.innerHTML = '<div class="loading-text" style="color:red;">資料解析失敗，請確認開發者工具 Console 的錯誤訊息。</div>';
    }
}

function renderRecords(data, sortOrder) {
    const container = document.getElementById('records-container');
    
    // 將資料按日期分組
    const groupedRecords = {};
    data.forEach(record => {
        if (!groupedRecords[record.date]) groupedRecords[record.date] = [];
        groupedRecords[record.date].push(record);
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
            // 翻譯運動名稱
            let exName = globalDynamicExNameMap[record.exerciseName] || globalDefaultExNameMap[record.exerciseName] || record.exerciseName;
            
            let statsHtml = '';

            // 如果有總次數或正確次數的資料，顯示出來
            if (record.correctCount !== undefined && record.wrongCount !== undefined) {
                statsHtml += `
                    <div class="stat-item"><span class="stat-label">正確次數</span><span class="stat-val" style="color:#27ae60;">${record.correctCount}</span></div>
                    <div class="stat-item"><span class="stat-label">錯誤次數</span><span class="stat-val" style="${(record.wrongCount > 0) ? 'color:#e74c3c;' : ''}">${record.wrongCount}</span></div>
                `;
            } else {
                statsHtml += `<div class="stat-item"><span class="stat-label">總次數</span><span class="stat-val">${record.totalCount}</span></div>`;
            }

            // 準確率顯示 (如果是 86.67 就直接補 %，因為你 JSON 裡面已經是百分比了)
            const accuracyDisplay = record.accuracy !== null ? `${record.accuracy}%` : '0%';
            statsHtml += `<div class="stat-item"><span class="stat-label">準確率</span><span class="stat-val">${accuracyDisplay}</span></div>`;

            // 運動時長 (秒)
            const durationDisplay = record.durationSec !== null ? `${record.durationSec} 秒` : "未知";
            statsHtml += `<div class="stat-item"><span class="stat-label">運動時長</span><span class="stat-val">${durationDisplay}</span></div>`;
            
            // 移動距離 (公尺) - 只有當有這筆資料時才顯示 (如跑步)
            if (record.distanceM !== null) {
                statsHtml += `<div class="stat-item"><span class="stat-label">移動距離</span><span class="stat-val">${record.distanceM} 公尺</span></div>`;
            }

            html += `
                    <div class="record-card">
                        <div class="record-header">
                            <span class="time-badge">🕒 ${record.time}</span>
                            <span class="ex-name">${exName}</span>
                        </div>
                        <div class="record-body">
                            ${statsHtml}
                        </div>
                    </div>
            `;
        });
        html += `</div></div>`;
    });
    
    container.innerHTML = html;
}