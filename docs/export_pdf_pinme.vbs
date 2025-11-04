Dim shell
Set shell = CreateObject("WScript.Shell")
' 0 隐藏窗口，True 等待执行完成
shell.Run "powershell -ExecutionPolicy Bypass -File """ & Replace(WScript.ScriptFullName, "export_pdf_pinme.vbs", "export_pdf_pinme.ps1") & """", 0, True
Set shell = Nothing