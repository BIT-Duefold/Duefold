!undef APP_FILENAME
!define APP_FILENAME "Duefold"

!define UNINSTALL_SECTION_NAME "卸载归序"

!macro customUnInstallSection
  Section /o "un.删除本机用户数据"
    IfSilent done
    ${IfNot} ${isUpdated}
      SetShellVarContext current
      ${If} $APPDATA != ""
        Push "$APPDATA\duefold"
        Call un.removeDuefoldProfile
        IfFileExists "$APPDATA\duefold\*.*" 0 +2
        MessageBox MB_OK|MB_ICONEXCLAMATION "部分本机用户数据未能删除：$APPDATA\duefold"
      ${EndIf}
    ${EndIf}
    done:
  SectionEnd

  Function un.removeDuefoldProfile
    Exch $0
    Push $1
    Push $2
    Push $3
    System::Call 'kernel32::GetFileAttributesW(w r0) i.r3'
    ${If} $3 != -1
      IntOp $2 $3 & 0x10
      ${If} $2 == 0
        Delete "$0"
      ${Else}
        IntOp $2 $3 & 0x400
        ${If} $2 == 0
          FindFirst $1 $2 "$0\*.*"
          ${While} $2 != ""
            ${If} $2 != "."
            ${AndIf} $2 != ".."
              Push "$0\$2"
              Call un.removeDuefoldProfile
            ${EndIf}
            FindNext $1 $2
          ${EndWhile}
          FindClose $1
        ${EndIf}
        RMDir "$0"
      ${EndIf}
    ${EndIf}
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd
!macroend
