# 檔名: main_V9.py

import cv2
import mediapipe as mp
import importlib
import json
import sys
import os
import argparse
import numpy as np
from PIL import Image, ImageDraw, ImageFont # 用於繪製中文

# 確保 modules 資料夾被視為 package
sys.path.append(os.path.join(os.path.dirname(__file__), 'modules'))

# 載入自定義模組
from modules.jsonwriter import JsonWriter
from modules.language_loader import LanguageLoader
from modules.model_loader import ModelLoader

# ====================================================================
# 輔助函式: 中文繪圖
# ====================================================================
def cv2_draw_text(img, text, pos, text_color=(255, 255, 255), text_size=20):
    """
    在 OpenCV 圖片上繪製中文 (使用 Pillow)
    """
    if isinstance(img, np.ndarray):
        img_pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(img_pil)
        
        # 嘗試載入字體，如果失敗則使用預設
        font_paths = [
            "C:/Windows/Fonts/msjh.ttc",   # 微軟正黑體
            "C:/Windows/Fonts/simhei.ttf", # 黑體
            "C:/Windows/Fonts/arial.ttf"   # 英文 fallback
        ]
        
        font = None
        for font_path in font_paths:
            if os.path.exists(font_path):
                try:
                    font = ImageFont.truetype(font_path, text_size)
                    break
                except:
                    continue
        
        if font is None:
            font = ImageFont.load_default()
            
        draw.text(pos, text, font=font, fill=text_color)
        return cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
    return img

def parse_arguments():
    parser = argparse.ArgumentParser(description='AI Coach Main')
    parser.add_argument('--username', type=str, help='User Name')
    parser.add_argument('--height', type=int, help='Height (cm)')
    parser.add_argument('--weight', type=int, help='Weight (kg)')
    parser.add_argument('--debug', action='store_true', help='Enable Debug Mode')
    parser.add_argument('--manage-models', action='store_true', help='Open Model Manager UI')
    return parser.parse_args()

def load_config():
    try:
        with open('detector_config.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Config Error: {e}")
        sys.exit(1)

def select_camera_auto(lang_loader):
    print(f">> {lang_loader.get_message('camera_scanning')}")
    
    available_cams = []
    
    for i in range(5):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW) if os.name == 'nt' else cv2.VideoCapture(i)
        
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                available_cams.append((i, f"Camera {i} ({w}x{h})"))
            cap.release()
    
    if not available_cams:
        print(f"X {lang_loader.get_message('camera_not_found')}")
        return None
    
    if len(available_cams) == 1:
        print(f">> {lang_loader.get_message('camera_auto_select')}: {available_cams[0][1]}")
        return available_cams[0][0]
    
    print(f"\n{lang_loader.get_message('camera_multiple')}")
    for idx, name in available_cams:
        print(f" [{idx}] {name}")
    
    try:
        sel = input(f"{lang_loader.get_message('camera_select_prompt')}: ").strip()
        if sel == "": return available_cams[0][0]
        return int(sel)
    except:
        return available_cams[0][0]

def main():
    args = parse_arguments()
    config_data = load_config()
    
    # 讀取全域語言設定 (預設 ZH_TW)
    sys_cfg = config_data.get('system_settings', {})
    global_language = sys_cfg.get('language', 'ZH_TW')
    
    # 初始化語言載入器
    lang = LanguageLoader('main', global_language)
    
    # 初始化模型載入器
    model_loader = ModelLoader(language=global_language)
    model_path = None
    
    # [優化] 模型檢查邏輯
    if args.manage_models:
        # 強制進入管理介面
        model_path = model_loader.check_and_download_model()
    else:
        # 安靜檢查
        model_path = model_loader.get_model_path_silent()
        # 如果失敗才強制下載
        if model_path is None:
            # 注意: 請確保 main.json 有 'model_missing_alert' 翻譯，否則會顯示 [Missing: ...]
            print(f">> {lang.get_message('model_missing_alert')}")
            model_path = model_loader.check_and_download_model()

    if not model_path or not os.path.exists(model_path):
        sys.exit("Critical Error: No model available.")
    
    # 初始化紀錄寫入器
    writer = JsonWriter(language=global_language)

    # 1. User Info
    user_info = {}
    if args.username and args.height and args.weight:
        print(f">> {lang.get_message('user_info_confirm')}: {args.username}, {args.height}cm, {args.weight}kg")
        user_info = { "username": args.username, "height": args.height, "weight": args.weight }
    else:
        print(f"\n{lang.get_message('user_info_prompt')}")
        try:
            u = input(f"{lang.get_message('user_name_input')}: ").strip()
            user_info['username'] = u if u else "User"
            
            h = input(f"{lang.get_message('height_input')}: ").strip()
            user_info['height'] = int(h) if h else 170
            
            w = input(f"{lang.get_message('weight_input')}: ").strip()
            user_info['weight'] = int(w) if w else 70
        except:
            user_info = {"username": "User", "height": 170, "weight": 70}
        
        print(f">> {lang.get_message('user_info_confirm')}: {user_info}\n")

    # 2. System Settings
    camera_id = sys_cfg.get('camera_id', 0)
    width = sys_cfg.get('video_width', 640)
    height = sys_cfg.get('video_height', 480)
    
    DEFAULT_TARGET = sys_cfg.get('default_target_count', 10)
    DEFAULT_MAX_WRONG = sys_cfg.get('default_max_wrong', 5)
    
    DEBUG_MODE = args.debug
    PAUSE_MODE = False

    # 3. Load Detectors
    detectors = []
    print(f"{lang.get_message('loading_modules')} (Language: {global_language})...")
    
    for d_cfg in config_data.get('detectors', []):
        if not d_cfg.get('enabled', False): continue
        
        try:
            module = importlib.import_module(d_cfg['module'])
            cls = getattr(module, d_cfg['class'])
            
            final_cfg = d_cfg.get('config', {}).copy()
            # 將全域語言設定注入到個別 Detector
            final_cfg['language'] = global_language
            
            # 部分運動需要身高資訊
            if 'human_height' in final_cfg:
                final_cfg['human_height'] = user_info['height']
            
            # 這裡傳入 language 參數，確保子模組也使用正確語言
            if d_cfg.get('use_custom_config'):
                instance = cls(config=final_cfg, language=global_language)
            else:
                instance = cls(language=global_language)
                
            target_count = d_cfg.get('target_count', DEFAULT_TARGET)
            max_wrong = d_cfg.get('max_wrong', DEFAULT_MAX_WRONG)
            
            detectors.append({
                "name": d_cfg['class'],
                "instance": instance,
                "label": d_cfg['class'].replace("Detector", ""),
                "active": True,
                "locked": False,
                "target_count": target_count,
                "max_wrong": max_wrong
            })
            print(f"- {d_cfg['class']} {lang.get_message('module_ok')} (Target: {target_count}, MaxWrong: {max_wrong})")
            
        except Exception as e:
            print(f"X {d_cfg['class']} {lang.get_message('module_failed')}: {e}")

    if not detectors: sys.exit(lang.get_message('module_failed'))

    # 4. Init MediaPipe & Camera
    cap = cv2.VideoCapture(camera_id)
    if not cap.isOpened():
        print(f"X {lang.get_message('camera_init_error')}: {camera_id}")
        new_id = select_camera_auto(lang)
        if new_id is not None:
            camera_id = new_id
            cap = cv2.VideoCapture(camera_id)
        else:
            sys.exit(lang.get_message('camera_init_error'))
            
    print(f">> {lang.get_message('camera_started')} (ID: {camera_id})\n")
    
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

    mp_pose = mp.solutions.pose
    mp_drawing = mp.solutions.drawing_utils
    mp_drawing_styles = mp.solutions.drawing_styles
    
    focused_detector_index = -1
    
    # 載入剛才下載/檢查過的模型
    base_options = mp.tasks.BaseOptions(model_asset_path=model_path)
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        min_pose_detection_confidence=sys_cfg['mediapipe_settings']['min_detection_confidence'],
        min_tracking_confidence=sys_cfg['mediapipe_settings']['min_tracking_confidence']
    )
    detector_engine = mp.tasks.vision.PoseLandmarker.create_from_options(options)

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break
            
            frame = cv2.resize(frame, (width, height))

            if PAUSE_MODE:
                display_frame = frame.copy()
                display_frame = cv2_draw_text(display_frame, lang.get_message('paused'), (width//2 - 60, height//2), (0, 0, 255), 40)
                cv2.imshow('AI Coach', display_frame)
                key = cv2.waitKey(5) & 0xFF
                if key == ord('p'): PAUSE_MODE = False
                elif key == ord('q'): break
                continue

            # MediaPipe 處理
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
            timestamp_ms = int(cv2.getTickCount() / cv2.getTickFrequency() * 1000)
            results = detector_engine.detect_for_video(mp_image, timestamp_ms)

            display_frame = frame.copy()

            if results.pose_landmarks:
                # 轉換為舊版格式以相容繪圖工具
                landmarks_list = results.pose_landmarks[0]
                
                if DEBUG_MODE:
                     from mediapipe.framework.formats import landmark_pb2
                     proto_landmarks = landmark_pb2.NormalizedLandmarkList()
                     proto_landmarks.landmark.extend([
                        landmark_pb2.NormalizedLandmark(x=lm.x, y=lm.y, z=lm.z) 
                        for lm in landmarks_list
                     ])
                     mp_drawing.draw_landmarks(
                        display_frame, proto_landmarks, mp_pose.POSE_CONNECTIONS,
                        landmark_drawing_spec=mp_drawing_styles.get_default_pose_landmarks_style()
                    )

                active_count = 0
                y_pos = 40
                
                # 半透明背景
                overlay = display_frame.copy()
                cv2.rectangle(overlay, (0, 0), (320, 20 + len(detectors)*30), (0, 0, 0), -1)
                display_frame = cv2.addWeighted(overlay, 0.4, display_frame, 0.6, 0)

                for idx, d in enumerate(detectors):
                    if not d['active']: continue
                    active_count += 1
                    
                    # 呼叫各個偵測器的處理邏輯
                    if DEBUG_MODE:
                        processed_frame, info = d['instance'].process_frame(display_frame, landmarks_list)
                        display_frame = processed_frame
                    else:
                        temp_frame = np.zeros_like(display_frame)
                        _, info = d['instance'].process_frame(temp_frame, landmarks_list)
                        
                    count = d['instance'].count
                    correct = getattr(d['instance'], 'correct', 0)
                    wrong = getattr(d['instance'], 'wrong', 0)
                    
                    # 顯示資訊 (使用中文繪圖)
                    label_name = d['instance'].lang.get_module_name()
                    
                    if 'distance_m' in info:
                        text = f"{label_name}: {info['distance_m']:.1f}m ({count})"
                    else:
                        text = f"{label_name}: {count} (O:{correct} X:{wrong})"

                    if info.get('form_correct') == False:
                        display_frame = cv2_draw_text(display_frame, f"{lang.get_message('wrong_alert')} {label_name}!", (10, height - 50), (0, 0, 255), 30)

                    display_frame = cv2_draw_text(display_frame, text, (10, y_pos), (255, 255, 255), 20)
                    y_pos += 30

                    # 1. 錯誤卸載
                    if wrong > d['max_wrong'] and focused_detector_index == -1:
                        print(f">> [System] {label_name} {lang.get_message('detector_unloaded')} (X:{wrong}/{d['max_wrong']})")
                        d['active'] = False
                        continue

                    # 2. 鎖定判定
                    metric_to_check = count if hasattr(d['instance'], 'total_distance_cm') else correct
                    
                    if metric_to_check >= d['target_count'] and focused_detector_index == -1:
                        print(f">> [System] {lang.get_message('detector_locked')}: {label_name}")
                        focused_detector_index = idx
                        d['locked'] = True
                        for i, other in enumerate(detectors):
                            if i != idx: other['active'] = False
            
                if active_count == 0:
                    display_frame = cv2_draw_text(display_frame, lang.get_message('no_active_detectors'), (10, 40), (0, 0, 255), 20)
            
            # 顯示介面提示
            tips = f"{lang.get_message('press_q_exit')} | {lang.get_message('press_p_pause')} | {lang.get_message('press_d_debug')}"
            display_frame = cv2_draw_text(display_frame, tips, (10, height - 20), (200, 200, 200), 12)
            
            if DEBUG_MODE:
                 display_frame = cv2_draw_text(display_frame, lang.get_message('debug_mode'), (width - 120, 20), (0, 255, 255), 16)

            cv2.imshow('AI Coach', display_frame)

            key = cv2.waitKey(5) & 0xFF
            if key == ord('q'): break
            elif key == ord('p'): PAUSE_MODE = not PAUSE_MODE
            elif key == ord('d'): 
                DEBUG_MODE = not DEBUG_MODE
                print(f">> Debug Mode: {'ON' if DEBUG_MODE else 'OFF'}")

    except Exception as e:
        import traceback
        print(f"Main Loop Error: {e}")
        traceback.print_exc()

    finally:
        cap.release()
        cv2.destroyAllWindows()

        # 結算
        print(f"\n{lang.get_message('summary_title')}")
        
        target_d = None
        if focused_detector_index != -1:
            target_d = detectors[focused_detector_index]
        
        if target_d and target_d['instance'].count > 0:
            label_name = target_d['instance'].lang.get_module_name()
            print(f"{lang.get_message('writing_record')}: {label_name}")
            
            final_count = target_d['instance'].count
            final_correct = getattr(target_d['instance'], 'correct', 0)
            final_wrong = getattr(target_d['instance'], 'wrong', 0)
            
            extra_data = {}
            instance = target_d['instance']
            
            if hasattr(instance, 'total_distance_cm'):
                dist_m = instance.total_distance_cm / 100
                extra_data['distance_m'] = round(dist_m, 2)
                print(f" ({lang.get_message('record_distance')}: {dist_m:.2f}m)")
                
            if hasattr(instance, 'get_total_time'):
                dur_s = instance.get_total_time()
                extra_data['duration_sec'] = round(dur_s, 1)
                print(f" ({lang.get_message('record_time')}: {dur_s:.1f}s)")
            
            if not extra_data: extra_data = None
            
            writer.log_exercise(
                user_info=user_info,
                exercise_name=label_name,
                count=final_count,
                correct=final_correct,
                wrong=final_wrong,
                base_folder='user_data',
                extra_data=extra_data
            )
        else:
            print(lang.get_message('no_valid_record'))

if __name__ == "__main__":
    main()
