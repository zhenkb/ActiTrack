import os

def generate_tree(startpath, exclude_dirs=None):
    if exclude_dirs is None:
        exclude_dirs = ['__pycache__', '.git', '.venv', '.idea', '.vscode']
    
    output =""
    project_name = os.path.basename(os.path.abspath(startpath))
    output += f"{project_name}/\n"

    def _build_tree(dir_path, prefix=""):
        nonlocal output
        
        # 取得該目錄下的所有檔案與資料夾
        try:
            items = sorted(os.listdir(dir_path))
        except PermissionError:
            return

        # 過濾掉排除名單
        items = [item for item in items if item not in exclude_dirs]
        
        for i, item in enumerate(items):
            path = os.path.join(dir_path, item)
            is_last = (i == len(items) - 1)
            
            # 決定線條符號
            connector = "└── " if is_last else "├── "
            
            if os.path.isdir(path):
                output += f"{prefix}{connector}{item}/\n"
                # 遞迴進入子目錄
                new_prefix = prefix + ("    " if is_last else "│   ")
                _build_tree(path, new_prefix)
            else:
                # 檔案，可以在這裡手動加入註解邏輯，目前先輸出檔名
                output += f"{prefix}{connector}{item}\n"

    _build_tree(startpath)
    return output

if __name__ == "__main__":
    # 設定當前路徑
    current_dir = os.getcwd()
    
    # 執行生成
    # 你可以在這裡增加想要排除的資料夾，例如 ['HTML', 'user_data']
    tree_content = generate_tree(current_dir, exclude_dirs=['__pycache__', '.git', 'node_modules',])
    
    # 輸出到終端機
    print(tree_content)
    
    # 同時儲存成檔案方便複製
    with open("project_structure.txt", "w", encoding="utf-8") as f:
        f.write(tree_content)
        
    print(f"\n[成功] 結構圖已生成並儲存至 project_structure.txt")