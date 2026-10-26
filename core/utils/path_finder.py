import os

def find_incogniton_path():
    """Attempts to find the Incogniton executable on Windows."""
    
    # Common installation paths for Incogniton
    appdata_local = os.environ.get('LOCALAPPDATA', '')
    
    possible_paths = [
        os.path.join(appdata_local, 'Programs', 'Incogniton', 'Incogniton.exe'),
        os.path.join(appdata_local, 'Incogniton', 'Incogniton.exe'),
        r"C:\Program Files\Incogniton\Incogniton.exe",
        r"C:\Program Files (x86)\Incogniton\Incogniton.exe"
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            return path
            
    # If not found in standard paths, return None
    return None
