// ActiTrack_Settings_Body.js

let User_data_profile = {};

async function saveBodySettings() {
    const heightVal = document.getElementById('input-height').value;
    const weightVal = document.getElementById('input-weight').value;

    // 必填檢查：如果不完整，直接中斷執行 (不跳出 alert)
    if (!heightVal || !weightVal) {
        return; 
    }

    const ageVal = document.getElementById('input-age').value;
    const dobVal = document.getElementById('input-dob').value;
    const bfVal = document.getElementById('input-bf').value;
    const muscleVal = document.getElementById('input-muscle').value;
    const bmrVal = document.getElementById('input-bmr').value;

    // 彙整成 JSON 格式
    User_data_profile = {
        "basic_info": {
            "height_cm": parseFloat(heightVal),
            "weight_kg": parseFloat(weightVal)
        },
        "optional_info": {
            "age": ageVal ? parseInt(ageVal) : null,
            "dob": dobVal || null, 
            "body_fat_percent": bfVal ? parseFloat(bfVal) : null,
            "skeletal_muscle_kg": muscleVal ? parseFloat(muscleVal) : null,
            "bmr_kcal": bmrVal ? parseInt(bmrVal) : null
        },
        "last_updated": new Date().toLocaleString()
    };

    // 傳送給後端 server.py 進行實體存檔
    try {
        const response = await fetch('/api/save_profile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(User_data_profile)
        });

        if (response.ok) {
            // 無聲提示：將按鈕文字暫時改成「已儲存 ✔」
            const saveBtn = document.querySelector('.btn-save');
            if (saveBtn) {
                const originalText = saveBtn.innerText;
                saveBtn.innerText = "已儲存 ✔";
                saveBtn.style.backgroundColor = "#219150"; // 稍微加深顏色
                
                setTimeout(() => {
                    saveBtn.innerText = originalText;
                    saveBtn.style.backgroundColor = ""; // 恢復原色
                }, 2000);
            }
        }
    } catch (error) {
        // 發生錯誤時靜默處理，不干擾使用者
    }
}