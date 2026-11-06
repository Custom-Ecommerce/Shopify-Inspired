import os
import zipfile

def create_zip():
    zip_filename = "project_clean.zip"
    
    # In folders aur files ko zip main shamil NAHI karna
    exclude_dirs = {'.git', 'node_modules', '.next', '.turbo', 'dist', 'build', 'out', 'coverage'}
    exclude_exts = {'.env', '.env.local', '.env.development'}

    print("Creating clean zip file. Please wait...")
    
    with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk('.'):
            # Exclude specified directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            
            for file in files:
                # Exclude specific extensions and the python script / zip file itself
                if any(file.endswith(ext) for ext in exclude_exts) or file == zip_filename or file == "zip_project.py":
                    continue
                
                file_path = os.path.join(root, file)
                zipf.write(file_path, os.path.relpath(file_path, '.'))
                
    print(f"Successfully created: {zip_filename}")

if __name__ == "__main__":
    create_zip()