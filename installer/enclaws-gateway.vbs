Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the directory where this script lives
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Build paths
nodeExe = scriptDir & "\node\node.exe"
appEntry = scriptDir & "\app\enclaws.mjs"
loadingPage = scriptDir & "\loading.html"

' Open loading page in browser immediately
WshShell.Run """" & loadingPage & """", 1, False

' Start gateway in background (hidden window, don't wait)
WshShell.Run """" & nodeExe & """ """ & appEntry & """ gateway", 0, False
