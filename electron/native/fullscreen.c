/* Windows-only Node-API addon. Uses OS libraries and Electron's exported Node-API;
 * no Node ABI headers, third-party DLLs, helper processes or C++ runtime required. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

typedef void *napi_env;
typedef void *napi_value;
typedef void *napi_callback_info;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
typedef int (*get_boolean_fn)(napi_env, bool, napi_value *);
typedef int (*create_function_fn)(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
typedef int (*set_property_fn)(napi_env, napi_value, const char *, napi_value);
static get_boolean_fn get_boolean;

static bool foreground_fullscreen(void) {
  HWND win = GetForegroundWindow();
  if (!win || !IsWindowVisible(win) || IsIconic(win)) return false;
  HWND root = GetAncestor(win, GA_ROOTOWNER);
  if (root && IsWindowVisible(root)) win = root;
  wchar_t name[128];
  if (!GetClassNameW(win, name, 128)) return false;
  if (!lstrcmpW(name, L"Progman") || !lstrcmpW(name, L"WorkerW") ||
      !lstrcmpW(name, L"Shell_TrayWnd") || !lstrcmpW(name, L"Shell_SecondaryTrayWnd")) return false;
  HMONITOR monitor = MonitorFromWindow(win, MONITOR_DEFAULTTONULL);
  MONITORINFO info = {.cbSize = sizeof(MONITORINFO)};
  RECT client;
  if (!monitor || !GetMonitorInfoW(monitor, &info) || !GetClientRect(win, &client)) return false;
  POINT top = {client.left, client.top}, bottom = {client.right, client.bottom};
  if (!ClientToScreen(win, &top) || !ClientToScreen(win, &bottom)) return false;
  /* Client area excludes normal maximized title bars and window borders.
   * Physical coordinates share the host Electron process's DPI awareness. */
  return top.x <= info.rcMonitor.left + 1 && top.y <= info.rcMonitor.top + 1 &&
         bottom.x >= info.rcMonitor.right - 1 && bottom.y >= info.rcMonitor.bottom - 1;
}

static napi_value check(napi_env env, napi_callback_info info) {
  (void) info;
  napi_value result = NULL;
  get_boolean(env, foreground_fullscreen(), &result);
  return result;
}

__declspec(dllexport) int32_t node_api_module_get_api_version_v1(void) {return 8;}
__declspec(dllexport) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  HMODULE host = GetModuleHandleW(NULL);
  get_boolean = (get_boolean_fn)GetProcAddress(host, "napi_get_boolean");
  create_function_fn create_function = (create_function_fn)GetProcAddress(host, "napi_create_function");
  set_property_fn set_property = (set_property_fn)GetProcAddress(host, "napi_set_named_property");
  if (!get_boolean || !create_function || !set_property) return exports;
  napi_value fn;
  if (create_function(env, "isForegroundFullscreen", (size_t)-1, check, NULL, &fn) == 0)
    set_property(env, exports, "isForegroundFullscreen", fn);
  return exports;
}
