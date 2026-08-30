@echo off
REM install_vision.bat — Installe les dépendances pour le module de vision Zentara
REM Lance ce fichier en double-cliquant ou depuis une invite de commande

echo ========================================
echo Zentara Vision — Installation
echo ========================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo ERREUR: Python non installe. Telecharge Python 3.10+ sur python.org
    pause
    exit /b 1
)

echo Installation des dependances...
pip install -r "%~dp0..\requirements-vision.txt"

echo.
echo Installation terminee !
echo Pour analyser une image :
echo   python vision_module.py --image "chemin\vers\image.jpg"
echo.
pause
