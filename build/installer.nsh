!undef APP_FILENAME
!define APP_FILENAME "Duefold"

!ifndef BUILD_UNINSTALLER
!include nsDialogs.nsh

Var shortcutStartMenuCheckbox
Var shortcutDesktopCheckbox
Var shortcutStartMenuSelected
Var shortcutDesktopSelected

Function shortcutOptionsCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 18u "选择要创建的快捷方式："
  Pop $0
  ${NSD_CreateCheckbox} 0 24u 100% 12u "添加到开始菜单"
  Pop $shortcutStartMenuCheckbox
  ${NSD_SetState} $shortcutStartMenuCheckbox ${BST_CHECKED}
  ${NSD_CreateCheckbox} 0 44u 100% 12u "添加桌面快捷方式"
  Pop $shortcutDesktopCheckbox
  ${NSD_SetState} $shortcutDesktopCheckbox ${BST_CHECKED}
  nsDialogs::Show
FunctionEnd

Function shortcutOptionsLeave
  ${NSD_GetState} $shortcutStartMenuCheckbox $shortcutStartMenuSelected
  ${NSD_GetState} $shortcutDesktopCheckbox $shortcutDesktopSelected
FunctionEnd

!macro customPageAfterChangeDir
  Page custom shortcutOptionsCreate shortcutOptionsLeave
!macroend

!macro customInstall
  ${If} $shortcutStartMenuSelected == "0"
    Delete "$newStartMenuLink"
  ${EndIf}
  ${If} $shortcutDesktopSelected == "0"
    Delete "$newDesktopLink"
  ${EndIf}
!macroend
!endif

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
