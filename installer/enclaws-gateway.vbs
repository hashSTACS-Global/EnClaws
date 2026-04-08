Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the directory where this script lives
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Build paths
nodeExe = scriptDir & "\node\enclaws.exe"
appEntry = scriptDir & "\app\enclaws.mjs"
loadingPage = scriptDir & "\loading.html"

' Open loading page in browser immediately
WshShell.Run """" & loadingPage & """", 1, False

' Start gateway in background (hidden window, don't wait)
' Use --no-open because loading.html already redirects to dashboard.
WshShell.Run """" & nodeExe & """ """ & appEntry & """ gateway --no-open", 0, False
