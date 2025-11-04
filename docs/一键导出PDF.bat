@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%export_pdf_pinme.ps1"
if %errorlevel% neq 0 (
  echo 导出失败，请检查浏览器是否已安装（Edge/Chrome）或联系维护者。
  pause
) else (
  echo 已成功导出为 PDF：%SCRIPT_DIR%项目说明.pdf
  pause
)
endlocal