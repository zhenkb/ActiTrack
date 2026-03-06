import cv2
import mediapipe as mp
import importlib
import json
import sys
import os
import time
import threading
import numpy as np
import logging
import glob
import shutil
import re

from fastapi import Request
from fastapi import FastAPI
from fastapi import UploadFile
from fastapi import File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware

from datetime import datetime

sys.path.append(os.path.join(os.path.dirname(__file__), 'modules'))

from modules.language_loader import LanguageLoader
from modules.model_loader import ModelLoader
from modules.jsonwriter import JsonWriter

class GlobalState:
    def __init__(self):
        self.frame_bytes = None
        self.is_running = False
        self.camera_active = False  # ★ 新增：精準追蹤底層鏡頭是否確實被佔用
        self.show_skeleton = True
        self.detectors = []
        self.locked_idx = -1
        self.user_info = {"username": "WebUser", "height": 170, "weight": 70}
        self.last_api_access = time.time()
        self.language = 'ZH_TW'  # 追蹤當前語言
        self.lock = threading.Lock() # 新增鎖

state = GlobalState()

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def get_current_username():
    config_path = os.path.join("HTML", "JS", "json", "user_config.json")
    try:
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                return cfg.get("username", "User")
    except:
        pass
    return "User"

def load_config():
    try:
        with open('detector_config.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"[Error] 設定檔讀取失敗: {e}")
        return {}


def auto_select_camera():
    for i in range(3):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW) if os.name == 'nt' else cv2.VideoCapture(i)
        if cap.isOpened():
            ret, _ = cap.read()
            cap.release()
            if ret: return i
    return None


def save_current_record():
    """ 儲存運動紀錄到 JSON，修正 Null 與欄位錯置問題 """
    if state.locked_idx != -1 and state.locked_idx < len(state.detectors):
        target_d = state.detectors[state.locked_idx]
    else:
        # 沒有鎖定時，尋找有次數的運動
        target_d = None
        best_count = 0
        for d in state.detectors:
            c = max(d['instance'].count, getattr(d['instance'], 'correct', 0))
            if c > best_count:
                best_count = c
                target_d = d
        if target_d is None:
            print("[Server] 無有效運動紀錄，略過存檔")
            return

    inst = state.detectors[state.locked_idx]['instance']
    is_running_sport = target_d['is_running']
    count = inst.count
    correct = getattr(inst, 'correct', 0)
    wrong = getattr(inst, 'wrong', 0)

    # 不管底層傳上來的是什麼，通通丟給翻譯器轉換成標準名稱
    raw_name = inst.__class__.__name__ 
    exercise_name = inst.lang.get_module_name()    
    
    if count == 0 and correct == 0:
        print("[Server] 次數為 0，略過存檔")
        return

    # 修正後：加入 "[Missing" 防呆攔截
    exercise_name = inst.lang.get_module_name()
    if hasattr(inst, 'lang') and inst.lang is not None:
        msg = inst.lang.get_message('module_name')
        if "[Missing" not in msg:
            exercise_name = msg

    extra_data = {}
    
    # 1. 判斷是否有距離 (跑步專用)
    if is_running_sport and hasattr(inst, 'total_distance_cm'):
        distance = round(getattr(inst, 'total_distance_cm', 0) / 100, 2)
        extra_data['distance_m'] = distance

    # 2. 判斷是否有精準運動時間 (所有運動共用)
    if callable(getattr(inst, 'get_total_time', None)):
        extra_data['duration_sec'] = round(inst.get_total_time(), 1)

    # 3. 如果字典是空的，則設為 None
    if not extra_data:
        extra_data = None

    # 寫入資料
    writer = JsonWriter(language=state.language)
    writer.log_exercise(
        user_info=state.user_info,
        exercise_name=exercise_name,
        count=count,
        correct=correct,
        wrong=wrong,
        base_folder='user_data',
        extra_data=extra_data
    )
    print(f"\n[Server] 💾 已成功寫入運動紀錄: {exercise_name} (正確:{correct} 錯誤:{wrong})\n")


def web_camera_loop(target_mode="auto"):
    print(f"[Server] 啟動核心偵測引擎 (模式: {target_mode})...")
    state.last_api_access = time.time()

    config_data = load_config()
    sys_cfg = config_data.get('system_settings', {})
    global_language = sys_cfg.get('language', 'ZH_TW')
    state.language = global_language

    model_loader = ModelLoader(language=global_language)
    model_path = model_loader.get_model_path_silent()
    if not model_path: model_path = model_loader.download_model_silent(2)

    detectors = []
    for d_cfg in config_data.get('detectors', []):
        if not d_cfg.get('enabled', False): continue
        if target_mode != "auto" and d_cfg['class'] != target_mode:
            continue
        try:
            module = importlib.import_module(d_cfg['module'])
            cls = getattr(module, d_cfg['class'])
            final_cfg = d_cfg.get('config', {}).copy()
            final_cfg['language'] = global_language
            final_cfg['human_height'] = state.user_info['height']
            instance = cls(config=final_cfg, language=global_language) if d_cfg.get('use_custom_config') else cls(language=global_language)
            
            # 從 lang 模組取得多國語言標籤名稱 (供 UI 顯示)
            display_label = d_cfg['class'].replace("Detector", "")
            if hasattr(instance, 'lang') and instance.lang:
                msg = instance.lang.get_message('module_name')
                if "[Missing" not in msg:
                    display_label = msg

            detectors.append({
                "label": display_label,
                "class_name": d_cfg['class'],
                "instance": instance,
                "active": True,
                "locked": False,
                "target_count": d_cfg.get('target_count', 10),
                "max_wrong": d_cfg.get('max_wrong', 5),
                "is_running": hasattr(instance, 'total_distance_cm'),
            })
            print(f" + {d_cfg['class']} 載入成功")
        except Exception as e:
            print(f" [Error] {d_cfg['class']} 載入失敗: {e}")

    state.detectors = detectors

    if target_mode != "auto" and len(state.detectors) == 1:
        state.locked_idx = 0
        state.detectors[0]['locked'] = True
        print(f"[Info] 單一模式啟動，直接鎖定: {state.detectors[0]['label']}")

    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=model_path),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    detector_engine = mp.tasks.vision.PoseLandmarker.create_from_options(options)

    cam_id = sys_cfg.get('camera_id', 0)
    cap = cv2.VideoCapture(cam_id, cv2.CAP_DSHOW) if os.name == 'nt' else cv2.VideoCapture(cam_id)
    
    if not cap.isOpened():
        new_id = auto_select_camera()
        if new_id is not None: cap = cv2.VideoCapture(new_id, cv2.CAP_DSHOW) if os.name == 'nt' else cv2.VideoCapture(new_id)
        else: 
            state.camera_active = False # 防呆
            return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    # 核心迴圈：使用 try...finally 保證資源釋放
    try:
        while state.is_running and cap.isOpened():
            # 看門狗機制：如果超過 5 秒沒收到 /api/status 請求，視為關閉網頁/跳轉
            if time.time() - state.last_api_access > 5.0:
                print("[Server] ⚠️ 偵測到前端斷線或跳轉頁面，準備自動存檔並關閉鏡頭...")
                break

            ret, frame = cap.read()
            if not ret:
                time.sleep(0.1)
                continue

            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
            timestamp_ms = int(time.time() * 1000)
            results = detector_engine.detect_for_video(mp_img, timestamp_ms)

            display_frame = frame.copy()

            if results.pose_landmarks:
                landmarks = results.pose_landmarks[0]
                if state.show_skeleton:
                    h, w, _ = display_frame.shape
                    for conn in mp.solutions.pose.POSE_CONNECTIONS:
                        if conn[0] > 10 and conn[1] > 10:
                            cv2.line(display_frame, (int(landmarks[conn[0]].x * w), int(landmarks[conn[0]].y * h)), (int(landmarks[conn[1]].x * w), int(landmarks[conn[1]].y * h)), (0, 255, 0), 2)
                            cv2.circle(display_frame, (int(landmarks[conn[0]].x * w), int(landmarks[conn[0]].y * h)), 4, (0, 0, 255), -1)

                for idx, d in enumerate(state.detectors):
                    if not d['active']: continue
                    dummy = np.zeros_like(frame)
                    _, info = d['instance'].process_frame(dummy, landmarks)

                    if target_mode == "auto" and not d['is_running']:
                        wrong = getattr(d['instance'], 'wrong', 0)
                        if wrong > d['max_wrong'] and state.locked_idx == -1:
                            d['active'] = False
                            continue

                    metric = d['instance'].count if d['is_running'] else getattr(d['instance'], 'correct', 0)

                    if target_mode == "auto" and metric >= d['target_count'] and state.locked_idx == -1:
                        state.locked_idx = idx
                        d['locked'] = True
                        for i, other in enumerate(state.detectors):
                            if i != idx: other['active'] = False

            ret, buffer = cv2.imencode('.jpg', display_frame)
            if ret: state.frame_bytes = buffer.tobytes()
            time.sleep(0.03)

    except Exception as e:
        print(f"[Server] 核心迴圈發生例外: {e}")

    finally:
        # 無論如何都會進來這裡，確保存檔與資源釋放
        save_current_record()
        if 'cap' in locals() and cap is not None:
            cap.release()
        try:
            if 'detector_engine' in locals() and detector_engine is not None:
                detector_engine.close()
        except:
            pass
        
        # ★ 關鍵修復：不要在這裡把 state.is_running 設為 False！(會誤殺新執行緒)
        # 只告訴系統這個執行緒的「相機資源已經釋放乾淨」
        state.camera_active = False 
        state.frame_bytes = None
        print("[Server] 🛑 鏡頭已釋放，引擎完全停止")


def load_user_config():
    config_path = os.path.join("HTML", "JS", "json", "user_config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except: pass
    return {"username": "User"}

def save_movement_record(exercise_name, count, correct, wrong):
    # 這裡介入：從 config 檔案或 state 確保名稱同步
    current_config = load_user_config()
    state.user_info["username"] = current_config.get("username", "User")
    
    real_name = get_localized_exercise_name(exercise_name, state.language)

    # 呼叫你提供的 jsonwriter.py
    writer = JsonWriter(language=state.language)
    writer.log_exercise(
        user_info=state.user_info, 
        exercise_name=real_name,
        count=count,
        correct=correct,
        wrong=wrong,
        extra_data=None 
    )

def get_localized_exercise_name(raw_name, language):
    """
    【終極無敵防呆翻譯器】
    解決所有大小寫、空白、底線、Detector變形的問題！
    """
    if not raw_name: return "Unknown"
    
    # 1. 降維打擊：全部強制轉小寫，並用正則表達式殺掉所有空白和特殊符號
    # 範例: "Push Up DETECTOR " -> "pushupdetector"
    clean_name = re.sub(r'[^a-zA-Z0-9]', '', raw_name).lower()
    
    # 2. 拔除雜質：這時候 detector 一定是全小寫，絕對拔得掉！
    # 範例: "pushupdetector" -> "pushup"
    clean_name = clean_name.replace("detector", "")
    
    config_data = load_config()
    target_module = None
    
    # 3. 設定檔也做一模一樣的降維打擊
    for d_cfg in config_data.get('detectors', []):
        cfg_class = d_cfg.get('class', '')
        # 一樣：去符號 -> 轉小寫 -> 拔 detector
        cfg_clean = re.sub(r'[^a-zA-Z0-9]', '', cfg_class).lower()
        cfg_clean = cfg_clean.replace("detector", "")
        
        # 4. 終極比對 (此時雙方都已經是最乾淨的靈魂狀態)
        if clean_name == cfg_clean:
            target_module = d_cfg.get('module', '').split('.')[-1]
            break
            
    # 5. 抓取多國語言
    if target_module:
        try:
            loader = LanguageLoader(target_module, language)
            name = loader.get_module_name()
            if "[Missing" not in name:  # 確保真的有抓到翻譯
                return name
        except Exception as e:
            print(f"語言載入失敗 ({target_module}): {e}")
            
    # 如果真的找不到，回傳原本的名字(去掉 Detector)
    return raw_name.replace("Detector", "").replace("detector", "")



# ==========================================
# API 路由
# ==========================================

@app.get("/")
def redirect_to_home():
    return RedirectResponse(url="/ActiTrack_Interface.html")


@app.get("/api/sports_menu")
def get_sports_menu():
    """ 供前端動態生成左側 HTML 選單 """
    config_data = load_config()
    
    # 【修正 1】跟隨當前伺服器狀態的語言，而不是死板的 config 預設值
    global_language = state.language 
    
    menu = []
    for d_cfg in config_data.get('detectors', []):
        if d_cfg.get('enabled', False):
            module_name = d_cfg['module'].split('.')[-1]
            display_name = get_localized_exercise_name(d_cfg['class'], state.language)            
            
            # 【修正 2】直接重複利用已經寫好的 LanguageLoader 工具
            try:
                # 實例化語言載入器 (它會自動處理正確的絕對路徑)
                lang_loader = LanguageLoader(module_name, global_language)
                # 取得該模組在 json 裡面的 "module_name"
                display_name = lang_loader.get_module_name()
            except Exception as e:
                # 如果找不到語言檔或發生錯誤，則保持預設的 display_name (容錯處理)
                print(f"選單語言載入失敗 ({module_name}): {e}")
                    
            menu.append({
                "class_name": d_cfg['class'],
                "display_name": display_name
            })
            
    # 【修正 3】明確指定 content 參數
    return JSONResponse(content=menu)

@app.post("/api/start")
def start_detection(mode: str = "auto"):
    with state.lock: # 確保同一時間只有一個啟動程序
        if state.camera_active:
            state.is_running = False  # 通知舊迴圈停止
            # ★ 關鍵修復：智慧輪詢，確實等待舊相機資源完全釋放 (最多等3秒)
            wait_time = 0
            while state.camera_active and wait_time < 3.0:
                time.sleep(0.1)
                wait_time += 0.1
            if state.camera_active:
                print("[Server] ⚠️ 警告: 舊鏡頭未能在3秒內釋放，強制重啟可能會報錯")
        
        state.is_running = True
        state.camera_active = True
        state.locked_idx = -1
        state.detectors = []
        # 啟動前清除舊的緩存圖，避免前端看到上一場運動的殘留畫面
        state.frame_bytes = None 
        
        t = threading.Thread(target=web_camera_loop, args=(mode,), daemon=True)
        t.start()
        return {"status": "started", "mode": mode}


@app.post("/api/stop")
def stop_detection():
    state.is_running = False
    # 後端迴圈會自己優雅關閉，無需 time.sleep 卡死 API 回應
    return {"status": "stopped_and_saved"}


@app.post("/api/set_user")
def set_user(username: str = "WebUser", height: int = 170, weight: int = 70):
    state.user_info = {"username": username, "height": height, "weight": weight}
    return {"status": "ok", "user_info": state.user_info}


@app.get("/video_feed")
def video_feed():
    def iter_frames():
        while state.is_running:
            if state.frame_bytes:
                yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + state.frame_bytes + b'\r\n')
            time.sleep(0.04)
        black_frame = cv2.imencode('.jpg', np.zeros((480, 640, 3), dtype=np.uint8))[1].tobytes()
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + black_frame + b'\r\n')

    return StreamingResponse(iter_frames(), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/api/status")
def get_status():
    state.last_api_access = time.time() 
    if not state.is_running:
        return JSONResponse({"locked_mode": "尚未啟動", "main_count": 0, "main_wrong": 0, "details": []})

    all_stats = []
    locked_name = "偵測中..."
    main_count = 0
    main_wrong = 0

    for idx, d in enumerate(state.detectors):
        is_running = d['is_running']
        correct = getattr(d['instance'], 'correct', 0)
        wrong = getattr(d['instance'], 'wrong', 0)
        val = round(d['instance'].total_distance_cm / 100, 1) if is_running else d['instance'].count
        is_locked = (idx == state.locked_idx)

        if is_locked:
            locked_name = d['label']
            main_count = val if is_running else correct
            main_wrong = 0 if is_running else wrong

        all_stats.append({
            "class_name": d['class_name'],  # ★ 加上這行，讓前端知道這是哪個運動
            "label": d['label'],
            "value": val,
            "correct": 0 if is_running else correct,
            "wrong": 0 if is_running else wrong,
            "is_running": is_running,
            "active": d['active'],
            "locked": is_locked,
        })


    return JSONResponse({"locked_mode": locked_name, "main_count": main_count, "main_wrong": main_wrong, "details": all_stats})


@app.post("/api/save_profile")
async def save_profile(request: Request):
    data = await request.json()
    
    # 取得當前時間
    now = datetime.now()
    year = now.strftime("%Y")
    month = now.strftime("%m")
    day = now.strftime("%d")
    time_str = now.strftime("%H-%M-%S")
    
    # 動態建立多層資料夾路徑：HTML/JS/json/User_data_profile/YYYY/MM/DD
    save_dir = os.path.join("HTML", "JS", "json", "User_data_profile", year, month, day)
    os.makedirs(save_dir, exist_ok=True)  # 自動建立所有不存在的父資料夾
    
    # 檔案名稱設為 HH-MM-SS.json
    file_path = os.path.join(save_dir, f"{time_str}.json")
    
    # 將接收到的資料寫入 JSON 檔案
    import json 
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
        
    return {"status": "success", "file_path": file_path}


@app.get("/api/get_records")
def get_records():
    records = []
    # 掃描 user_data 資料夾下所有的 json 檔案
    # 路徑結構: user_data/YYYY/MM/DD/HH-MM-SS.json
    for filepath in glob.glob("user_data/*/*/*/*.json"):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    records.extend(data)
                else:
                    records.append(data)
        except Exception:
            continue
    return records

@app.post("/api/toggle_skeleton")
def toggle_skeleton(enable: bool):
    state.show_skeleton = enable
    return {"status": "ok", "enabled": enable}

@app.get("/api/get_user_config")
def get_user_config():
    config_path = os.path.join("HTML", "JS", "json", "user_config.json")
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"username": "User"}

@app.post("/api/save_user_config")
async def save_user_config(request: Request):
    try:
        data = await request.json()
        
        config_dir = os.path.join("HTML", "JS", "json")
        os.makedirs(config_dir, exist_ok=True)
        config_path = os.path.join(config_dir, "user_config.json")
        
        config_data = {}
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                try: config_data = json.load(f)
                except: pass
                
        # ✅ 安全更新：前端有傳來的資料才修改，沒傳來的保留原樣
        if "username" in data:
            config_data["username"] = data["username"]
            state.user_info["username"] = data["username"]
        if "avatar_shape" in data:
            config_data["avatar_shape"] = data["avatar_shape"]
            
        # 👇 新增這兩行：把字體大小寫入 config
        if "font_scale" in data:
            config_data["font_scale"] = data["font_scale"]
        # ✅ 加上這行：記錄最後修改時間
        config_data["last_update"] = time.time()
        
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f, ensure_ascii=False, indent=4)
            
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/upload_avatar")
async def upload_avatar(file: UploadFile = File(...)):
    base_dir = os.path.join("HTML", "Photo")
    save_dir = os.path.join(base_dir, "save")
    current_avatar_path = os.path.join(base_dir, "user_avatar.jpg")

    os.makedirs(save_dir, exist_ok=True)

    if os.path.exists(current_avatar_path):
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        archived_path = os.path.join(save_dir, f"{timestamp}.jpg")
        try:
            shutil.move(current_avatar_path, archived_path)
            print(f"[Server] 📦 舊頭像已歸檔至: {archived_path}")
        except Exception as e:
            print(f"[Server] ⚠️ 歸檔舊頭像失敗: {e}")

    try:
        with open(current_avatar_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # ✅ 加上這段：頭貼上傳成功後，也去更新 config 的時間
        try:
            config_dir = os.path.join("HTML", "JS", "json")
            config_path = os.path.join(config_dir, "user_config.json")
            if os.path.exists(config_path):
                with open(config_path, "r", encoding="utf-8") as f:
                    config_data = json.load(f)
                config_data["last_update"] = time.time()
                with open(config_path, "w", encoding="utf-8") as f:
                    json.dump(config_data, f, ensure_ascii=False, indent=4)
        except Exception as json_e:
            print(f"更新時間標記失敗: {json_e}")
            
        return {"status": "success", "image_url": f"/Photo/user_avatar.jpg?t={datetime.now().timestamp()}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        file.file.close()

@app.get("/api/get_body_records")
async def get_body_records():
    try:
        # 根據你的專案結構，對應到存放 BMI JSON 的路徑
        base_dir = os.path.join("HTML", "JS", "json", "User_data_profile")
        records = []
        
        if not os.path.exists(base_dir):
            return JSONResponse(content=[])
            
        # 遞迴搜尋該目錄下所有的 .json 檔案
        search_pattern = os.path.join(base_dir, "**", "*.json")
        for file_path in glob.glob(search_pattern, recursive=True):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    records.append(data)
            except Exception as file_e:
                print(f"讀取檔案失敗 {file_path}: {file_e}")
                
        return JSONResponse(content=records)
    except Exception as e:
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=500)

# ==========================================
# 補回：讀取歷史運動紀錄的 API
# ==========================================
@app.get("/api/get_history_records")
async def get_history_records():
    try:
        base_dir = "user_data"
        records = []
        if not os.path.exists(base_dir):
            return JSONResponse(content=[])
            
        # 🌟 1. 建立「全方位靜音翻譯字典」(只跑一次，不吵不鬧)
        import io, sys
        translation_map = {}
        try:
            with open("detector_config.json", "r", encoding="utf-8") as f:
                config = json.load(f)
            
            # 暫時把系統的 print 導向黑洞，避免語言載入器瘋狂洗版
            old_stdout = sys.stdout
            sys.stdout = io.StringIO() 
            
            for det in config.get("detectors", []):
                mod_name = det["module"].split(".")[-1]
                class_name = det["class"]
                
                try:
                    # 抓取三種語言的名稱 (目標語言、繁中、英文)
                    target_name = LanguageLoader(mod_name, state.language).get_module_name()
                    zh_name = LanguageLoader(mod_name, 'ZH_TW').get_module_name()
                    en_name = LanguageLoader(mod_name, 'EN').get_module_name()
                    
                    # 把所有可能的舊名字，全部指向「當前目標語言的名字」
                    translation_map[class_name] = target_name
                    translation_map[zh_name] = target_name
                    translation_map[en_name] = target_name
                except:
                    pass
                    
            # 建立完畢，恢復 print 功能
            sys.stdout = old_stdout 
        except Exception as e:
            sys.stdout = old_stdout # 確保出錯也能恢復聲音
            print(f"建立字典失敗: {e}")

        # 🌟 2. 讀取並清洗歷史紀錄
        search_pattern = os.path.join(base_dir, "**", "*.json")
        for file_path in glob.glob(search_pattern, recursive=True):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    
                    for user_data in data:
                        if "exercise_records" in user_data:
                            for ex_record in user_data["exercise_records"]:
                                raw_name = ex_record.get("exercise_name", "")
                                
                                # 多向翻譯：不管紀錄裡是「開合跳」、「Jumping Jack」還是「JumpingJackDetector」，統統洗成當前語言
                                if raw_name in translation_map:
                                    ex_record["exercise_name"] = translation_map[raw_name]
                                else:
                                    # 防呆模糊比對 (把空白和 Detector 拿掉再比對一次)
                                    clean_raw = raw_name.lower().replace("detector", "").replace(" ", "")
                                    for k, v in translation_map.items():
                                        if clean_raw == k.lower().replace("detector", "").replace(" ", ""):
                                            ex_record["exercise_name"] = v
                                            break

                    records.append(data)
            except Exception as file_e:
                print(f"讀取運動紀錄檔案失敗 {file_path}: {file_e}")
                
        return JSONResponse(content=records)
        
    except Exception as e:
        print(f"取得運動紀錄 API 發生錯誤: {e}")
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=500)
    
app.mount("/", StaticFiles(directory="HTML", html=True), name="static")



if __name__ == "__main__":
    import uvicorn
    class EndpointFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            if record.args and len(record.args) >= 3:
                if "/api/status" in record.args[2] or "/video_feed" in record.args[2]: return False
            return True

    logging.getLogger("uvicorn.access").addFilter(EndpointFilter())

    print("\n========================================")
    print(" 🚀 ActiTrack Server 啟動成功！")
    print(" 👉 請開啟瀏覽器: http://localhost:8000")
    print("========================================\n")

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")