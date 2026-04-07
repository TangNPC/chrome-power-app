#include <napi.h>
#include <iostream>
#include <vector>
#include <string>
#include <algorithm>

#ifdef __APPLE__
#import <Foundation/Foundation.h>
#import <Cocoa/Cocoa.h>
#import <CoreFoundation/CoreFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#endif

#ifdef _WIN32
#include <windows.h>
#include <cstring>
#endif

// Error logging macro
#define LOG_ERROR(msg) \
    do { \
        std::cerr << "Error: " << msg << " (line: " << __LINE__ << ")" << std::endl; \
    } while (0)

#ifdef _WIN32
    #define CHECK_WINDOW_OPERATION(op, msg) \
        do { \
            if (!(op)) { \
                LOG_ERROR(msg << " (LastError: " << GetLastError() << ")"); \
            } \
        } while (0)
#endif

// 辅助函数：判断窗口标题是否属于 Chromium 系浏览器主窗口
// 兼容 Google Chrome, 百分浏览器 (Cent Browser), 以及普通的 Chromium
bool IsChromiumBrand(const char* title) {
    if (!title) return false;
    return (strstr(title, "Google Chrome") != nullptr || 
            strstr(title, "Cent Browser") != nullptr || 
            strstr(title, "Chromium") != nullptr);
}

// Platform specific window info structure
#ifdef _WIN32
struct WindowInfo {
    HWND hwnd;
    bool isExtension;
    int width;
    int height;
};
#elif __APPLE__
struct WindowInfo {
    AXUIElementRef window;
    pid_t pid;
    bool isExtension;
    int width;
    int height;
};
#endif

// Monitor info structure
#ifdef _WIN32
struct MonitorInfo {
    HMONITOR handle;
    RECT rect;
    bool isPrimary;
};
#elif __APPLE__
struct MonitorInfo {
    CGDirectDisplayID id;
    CGRect bounds;
    bool isPrimary;
};
#else
struct MonitorInfo {
    int id;
    bool isPrimary;
    int x, y, width, height;
};
#endif

class WindowManager : public Napi::ObjectWrap<WindowManager> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "WindowManager", {
            InstanceMethod("arrangeWindows", &WindowManager::ArrangeWindows),
            InstanceMethod("sendMouseEvent", &WindowManager::SendMouseEvent),
            InstanceMethod("sendMouseEventWithPopupMatching", &WindowManager::SendMouseEventWithPopupMatching),
            InstanceMethod("sendKeyboardEvent", &WindowManager::SendKeyboardEvent),
            InstanceMethod("sendWheelEvent", &WindowManager::SendWheelEvent),
            InstanceMethod("getWindowBounds", &WindowManager::GetWindowBounds),
            InstanceMethod("setWindowBounds", &WindowManager::SetWindowBounds),
            InstanceMethod("getAllWindows", &WindowManager::GetAllWindows),
            InstanceMethod("getMonitors", &WindowManager::GetMonitorsJS),
            InstanceMethod("isProcessWindowActive", &WindowManager::IsProcessWindowActive)
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("WindowManager", func);
        return exports;
    }

    WindowManager(const Napi::CallbackInfo& info) : Napi::ObjectWrap<WindowManager>(info) {}

private:
    #ifdef _WIN32
    bool ArrangeWindow(HWND hwnd, int x, int y, int width, int height, bool preserveSize = false) {
        if (!hwnd) return false;
        
        if (IsIconic(hwnd)) {
            ShowWindow(hwnd, SW_RESTORE);
        }
        SetForegroundWindow(hwnd);
        
        LONG style = GetWindowLong(hwnd, GWL_STYLE);
        if (style == 0) {
            LOG_ERROR("Failed to get window style");
            return false;
        }
        
        style &= ~(WS_MAXIMIZE | WS_MINIMIZE);
        if (SetWindowLong(hwnd, GWL_STYLE, style) == 0) {
            LOG_ERROR("Failed to set window style");
            return false;
        }
        
        UINT flags = SWP_SHOWWINDOW | SWP_FRAMECHANGED;
        if (preserveSize) {
            flags |= SWP_NOSIZE;
        }
        
        if (!SetWindowPos(hwnd, HWND_TOPMOST, x, y, width, height, flags)) {
            LOG_ERROR("Failed to set window position");
            return false;
        }
        
        if (!SetWindowPos(hwnd, HWND_NOTOPMOST, x, y, width, height, flags)) {
            LOG_ERROR("Failed to reset window z-order");
            return false;
        }
        
        return true;
    }

    bool IsExtensionWindow(const char* title, const char* className) {
        // 关键修复：使用 IsChromiumBrand 替代硬编码的 "Google Chrome"
        return title != nullptr &&
               strlen(title) > 0 &&
               !IsChromiumBrand(title);
    }

    std::vector<WindowInfo> FindWindowsByPid(DWORD processId) {
        std::vector<WindowInfo> windows;
        HWND hwnd = nullptr;

        while ((hwnd = FindWindowEx(nullptr, hwnd, nullptr, nullptr)) != nullptr) {
            DWORD pid = 0;
            GetWindowThreadProcessId(hwnd, &pid);

            if (pid == processId && IsWindowVisible(hwnd) && !IsIconic(hwnd)) {
                char className[256] = {0};
                GetClassNameA(hwnd, className, sizeof(className));

                char title[256] = {0};
                GetWindowTextA(hwnd, title, sizeof(title));

                RECT rect;
                GetWindowRect(hwnd, &rect);

                bool isExtension = IsExtensionWindow(title, className);
                // 关键修复：主窗口识别逻辑同步更新
                bool isMainWindow = IsChromiumBrand(title) &&
                                  (GetWindowLong(hwnd, GWL_STYLE) & WS_OVERLAPPEDWINDOW);

                if (isMainWindow || isExtension) {
                    WindowInfo info;
                    info.hwnd = hwnd;
                    info.isExtension = isExtension;
                    info.width = rect.right - rect.left;
                    info.height = rect.bottom - rect.top;
                    windows.push_back(info);
                }
            }
        }
        return windows;
    }

    std::vector<HWND> FindPopupWindows(DWORD processId) {
        std::vector<HWND> popups;
        HWND hwnd = nullptr;

        while ((hwnd = FindWindowEx(nullptr, hwnd, nullptr, nullptr)) != nullptr) {
            DWORD pid = 0;
            GetWindowThreadProcessId(hwnd, &pid);

            if (pid == processId && IsWindowVisible(hwnd)) {
                LONG style = GetWindowLong(hwnd, GWL_STYLE);
                if (style & WS_POPUP) {
                    char className[256] = {0};
                    GetClassNameA(hwnd, className, sizeof(className));
                    if (strcmp(className, "#32768") == 0 ||
                        strstr(className, "Chrome_WidgetWin") != nullptr) {
                        popups.push_back(hwnd);
                    }
                }
            }
        }
        return popups;
    }

    HWND FindMatchingPopup(HWND masterMainWindow, HWND masterPopup,
                          HWND slaveMainWindow, const std::vector<HWND>& slavePopups) {
        if (slavePopups.empty()) return nullptr;

        RECT masterMainRect, masterPopupRect;
        GetWindowRect(masterMainWindow, &masterMainRect);
        GetWindowRect(masterPopup, &masterPopupRect);

        int masterRelX = masterPopupRect.left - masterMainRect.left;
        int masterRelY = masterPopupRect.top - masterMainRect.top;

        RECT slaveMainRect;
        GetWindowRect(slaveMainWindow, &slaveMainRect);

        HWND bestMatch = nullptr;
        int minDistance = INT_MAX;

        for (HWND slavePopup : slavePopups) {
            RECT slavePopupRect;
            GetWindowRect(slavePopup, &slavePopupRect);

            int slaveRelX = slavePopupRect.left - slaveMainRect.left;
            int slaveRelY = slavePopupRect.top - slaveMainRect.top;

            int distance = abs(masterRelX - slaveRelX) + abs(masterRelY - slaveRelY);

            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = slavePopup;
            }
        }
        return bestMatch;
    }
    #elif __APPLE__
    bool IsExtensionWindow(AXUIElementRef window) {
        CFStringRef titleRef;
        if (AXUIElementCopyAttributeValue(window, kAXTitleAttribute, (CFTypeRef*)&titleRef) == kAXErrorSuccess) {
            char buffer[256];
            CFStringGetCString(titleRef, buffer, sizeof(buffer), kCFStringEncodingUTF8);
            CFRelease(titleRef);
            if (!IsChromiumBrand(buffer)) {
                return true;
            }
        }
        return false;
    }

    bool IsMainWindow(AXUIElementRef window) {
        CFStringRef titleRef;
        if (AXUIElementCopyAttributeValue(window, kAXTitleAttribute, (CFTypeRef*)&titleRef) == kAXErrorSuccess) {
            char buffer[256];
            CFStringGetCString(titleRef, buffer, sizeof(buffer), kCFStringEncodingUTF8);
            CFRelease(titleRef);
            if (IsChromiumBrand(buffer)) {
                CFStringRef subroleRef;
                if (AXUIElementCopyAttributeValue(window, kAXSubroleAttribute, (CFTypeRef*)&subroleRef) == kAXErrorSuccess) {
                    char subroleBuffer[256];
                    CFStringGetCString(subroleRef, subroleBuffer, sizeof(subroleBuffer), kCFStringEncodingUTF8);
                    CFRelease(subroleRef);
                    return strcmp(subroleBuffer, "AXStandardWindow") == 0;
                }
            }
        }
        return false;
    }

    std::vector<WindowInfo> GetWindowsForPid(pid_t pid) {
        std::vector<WindowInfo> windows;
        AXUIElementRef app = AXUIElementCreateApplication(pid);
        if (!app) return windows;

        CFArrayRef windowArray;
        if (AXUIElementCopyAttributeValue(app, kAXWindowsAttribute, (CFTypeRef*)&windowArray) == kAXErrorSuccess) {
            CFIndex count = CFArrayGetCount(windowArray);
            for (CFIndex i = 0; i < count; i++) {
                AXUIElementRef window = (AXUIElementRef)CFArrayGetValueAtIndex(windowArray, i);
                CFBooleanRef isMinimizedRef;
                bool isVisible = true;
                if (AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute, (CFTypeRef*)&isMinimizedRef) == kAXErrorSuccess) {
                    isVisible = !CFBooleanGetValue(isMinimizedRef);
                    CFRelease(isMinimizedRef);
                }

                if (isVisible) {
                    CGSize size = {0, 0};
                    AXValueRef sizeRef;
                    if (AXUIElementCopyAttributeValue(window, kAXSizeAttribute, (CFTypeRef*)&sizeRef) == kAXErrorSuccess) {
                        AXValueGetValue(sizeRef, (AXValueType)kAXValueCGSizeType, &size);
                        CFRelease(sizeRef);
                        bool isExtension = IsExtensionWindow(window);
                        bool isMain = IsMainWindow(window);
                        if (isMain || isExtension) {
                            WindowInfo info;
                            info.window = (AXUIElementRef)CFRetain(window);
                            info.pid = pid;
                            info.isExtension = isExtension;
                            info.width = static_cast<int>(size.width);
                            info.height = static_cast<int>(size.height);
                            windows.push_back(info);
                        }
                    }
                }
            }
            CFRelease(windowArray);
        }
        CFRelease(app);
        return windows;
    }
    #endif

    std::vector<MonitorInfo> GetMonitors() {
        std::vector<MonitorInfo> monitors;
#ifdef _WIN32
        EnumDisplayMonitors(NULL, NULL, [](HMONITOR hMonitor, HDC, LPRECT, LPARAM lParam) -> BOOL {
            auto& monitors = *reinterpret_cast<std::vector<MonitorInfo>*>(lParam);
            MONITORINFOEX monitorInfo;
            monitorInfo.cbSize = sizeof(MONITORINFOEX);
            if (GetMonitorInfo(hMonitor, &monitorInfo)) {
                MonitorInfo info;
                info.handle = hMonitor;
                info.rect = monitorInfo.rcWork;
                info.isPrimary = (monitorInfo.dwFlags & MONITORINFOF_PRIMARY) != 0;
                monitors.push_back(info);
            }
            return TRUE;
        }, reinterpret_cast<LPARAM>(&monitors));
#elif __APPLE__
        uint32_t displayCount;
        CGDirectDisplayID displays[32];
        if (CGGetActiveDisplayList(32, displays, &displayCount) == kCGErrorSuccess) {
            CGDirectDisplayID mainDisplay = CGMainDisplayID();
            for (uint32_t i = 0; i < displayCount; i++) {
                MonitorInfo info;
                info.id = displays[i];
                info.bounds = CGDisplayBounds(displays[i]);
                info.isPrimary = (displays[i] == mainDisplay);
                monitors.push_back(info);
            }
        }
#endif
        std::sort(monitors.begin(), monitors.end(), [](const MonitorInfo& a, const MonitorInfo& b) {
            return a.isPrimary < b.isPrimary;
        });
        return monitors;
    }

    Napi::Value GetMonitorsJS(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        Napi::Array result = Napi::Array::New(env);
        auto monitors = GetMonitors();
        for (size_t i = 0; i < monitors.size(); i++) {
            Napi::Object monitorObj = Napi::Object::New(env);
#ifdef _WIN32
            monitorObj.Set("x", Napi::Number::New(env, monitors[i].rect.left));
            monitorObj.Set("y", Napi::Number::New(env, monitors[i].rect.top));
            monitorObj.Set("width", Napi::Number::New(env, monitors[i].rect.right - monitors[i].rect.left));
            monitorObj.Set("height", Napi::Number::New(env, monitors[i].rect.bottom - monitors[i].rect.top));
#elif __APPLE__
            monitorObj.Set("x", Napi::Number::New(env, monitors[i].bounds.origin.x));
            monitorObj.Set("y", Napi::Number::New(env, monitors[i].bounds.origin.y));
            monitorObj.Set("width", Napi::Number::New(env, monitors[i].bounds.size.width));
            monitorObj.Set("height", Napi::Number::New(env, monitors[i].bounds.size.height));
#endif
            monitorObj.Set("isPrimary", Napi::Boolean::New(env, monitors[i].isPrimary));
            monitorObj.Set("index", Napi::Number::New(env, i));
            result[i] = monitorObj;
        }
        return result;
    }

    Napi::Value ArrangeWindows(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 5) return env.Null();

        int mainPid = info[0].As<Napi::Number>().Int32Value();
        Napi::Array childPidsArray = info[1].As<Napi::Array>();
        int columns = info[2].As<Napi::Number>().Int32Value();
        Napi::Object size = info[3].As<Napi::Object>();
        int spacing = info[4].As<Napi::Number>().Int32Value();
        int monitorIndex = (info.Length() >= 6) ? info[5].As<Napi::Number>().Int32Value() : 0;

        int width = size.Get("width").As<Napi::Number>().Int32Value();
        int height = size.Get("height").As<Napi::Number>().Int32Value();

        std::vector<int> childPids;
        for (uint32_t i = 0; i < childPidsArray.Length(); i++) {
            childPids.push_back(childPidsArray.Get(i).As<Napi::Number>().Int32Value());
        }

        auto monitors = GetMonitors();
        if (monitors.empty() || monitorIndex >= (int)monitors.size()) return env.Null();

#ifdef _WIN32
        const auto& monitor = monitors[monitorIndex];
        int screenWidth = monitor.rect.right - monitor.rect.left;
        int screenHeight = monitor.rect.bottom - monitor.rect.top;
        int screenX = monitor.rect.left;
        int screenY = monitor.rect.top;

        int totalWindows = childPids.size() + 1;
        int rows = (totalWindows + columns - 1) / columns;
        int effectiveWidth = width > 0 ? width : (screenWidth - (spacing * (columns + 1))) / columns;
        int effectiveHeight = height > 0 ? height : (screenHeight - (spacing * (rows + 1))) / rows;

        auto mainWindows = FindWindowsByPid(mainPid);
        for (auto& win : mainWindows) {
            if (!win.isExtension) {
                ArrangeWindow(win.hwnd, screenX + spacing, screenY + spacing, effectiveWidth - spacing * 2, effectiveHeight - spacing * 2);
            }
        }

        for (size_t i = 0; i < childPids.size(); i++) {
            auto childWindows = FindWindowsByPid(childPids[i]);
            int row = (i + 1) / columns;
            int col = (i + 1) % columns;
            int x = screenX + (col * effectiveWidth) + (spacing * (col + 1));
            int y = screenY + (row * effectiveHeight) + (spacing * (row + 1));
            for (auto& win : childWindows) {
                if (!win.isExtension) ArrangeWindow(win.hwnd, x, y, effectiveWidth - spacing, effectiveHeight - spacing);
            }
        }
#endif
        return env.Null();
    }

    Napi::Value GetWindowBounds(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        int pid = info[0].As<Napi::Number>().Int32Value();
        Napi::Object result = Napi::Object::New(env);
#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        for (auto& win : windows) {
            if (!win.isExtension) {
                RECT rect;
                if (GetWindowRect(win.hwnd, &rect)) {
                    result.Set("x", rect.left);
                    result.Set("y", rect.top);
                    result.Set("width", rect.right - rect.left);
                    result.Set("height", rect.bottom - rect.top);
                    result.Set("success", true);
                    return result;
                }
            }
        }
#endif
        result.Set("success", false);
        return result;
    }

    Napi::Value SetWindowBounds(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        int pid = info[0].As<Napi::Number>().Int32Value();
        int x = info[1].As<Napi::Number>().Int32Value();
        int y = info[2].As<Napi::Number>().Int32Value();
        int w = info[3].As<Napi::Number>().Int32Value();
        int h = info[4].As<Napi::Number>().Int32Value();
#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        for (auto& win : windows) {
            if (!win.isExtension) {
                bool success = ArrangeWindow(win.hwnd, x, y, w, h);
                return Napi::Boolean::New(env, success);
            }
        }
#endif
        return Napi::Boolean::New(env, false);
    }

    Napi::Value GetAllWindows(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        int pid = info[0].As<Napi::Number>().Int32Value();
        Napi::Array result = Napi::Array::New(env);
#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        for (uint32_t i = 0; i < windows.size(); i++) {
            Napi::Object obj = Napi::Object::New(env);
            RECT r; GetWindowRect(windows[i].hwnd, &r);
            char title[256]; GetWindowTextA(windows[i].hwnd, title, 256);
            obj.Set("title", title);
            obj.Set("x", r.left);
            obj.Set("y", r.top);
            obj.Set("width", r.right - r.left);
            obj.Set("height", r.bottom - r.top);
            obj.Set("isExtension", windows[i].isExtension);
            result[i] = obj;
        }
#endif
        return result;
    }

    Napi::Value SendMouseEvent(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        int pid = info[0].As<Napi::Number>().Int32Value();
        int x = info[1].As<Napi::Number>().Int32Value();
        int y = info[2].As<Napi::Number>().Int32Value();
        std::string eventType = info[3].As<Napi::String>().Utf8Value();
#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        if (windows.empty()) return Napi::Boolean::New(env, false);
        HWND target = nullptr;
        for (auto& w : windows) if (!w.isExtension) { target = w.hwnd; break; }
        if (!target) return Napi::Boolean::New(env, false);

        for (auto& w : windows) {
            if (w.isExtension) {
                RECT r; GetWindowRect(w.hwnd, &r);
                if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                    target = w.hwnd;
                    break;
                }
            }
        }
        RECT tr; GetWindowRect(target, &tr);
        LPARAM lParam = MAKELPARAM(x - tr.left, y - tr.top);
        if (eventType == "mousemove") PostMessage(target, WM_MOUSEMOVE, 0, lParam);
        else if (eventType == "mousedown") PostMessage(target, WM_LBUTTONDOWN, MK_LBUTTON, lParam);
        else if (eventType == "mouseup") PostMessage(target, WM_LBUTTONUP, 0, lParam);
        else if (eventType == "rightdown") PostMessage(target, WM_RBUTTONDOWN, MK_RBUTTON, lParam);
        else if (eventType == "rightup") PostMessage(target, WM_RBUTTONUP, 0, lParam);
#endif
        return Napi::Boolean::New(env, true);
    }

    Napi::Value SendKeyboardEvent(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        int pid = info[0].As<Napi::Number>().Int32Value();
        int keyCode = info[1].As<Napi::Number>().Int32Value();
        std::string eventType = info[2].As<Napi::String>().Utf8Value();
#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        HWND target = nullptr;
        for (auto& w : windows) if (!w.isExtension) { target = w.hwnd; break; }
        if (!target) return Napi::Boolean::New(env, false);

        if (eventType == "keydown") PostMessage(target, WM_KEYDOWN, keyCode, 1);
        else if (eventType == "keyup") PostMessage(target, WM_KEYUP, keyCode, 1 | (1 << 30) | (1 << 31));
#endif
        return Napi::Boolean::New(env, true);
    }

    Napi::Value SendWheelEvent(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        int pid = info[0].As<Napi::Number>().Int32Value();
        int dy = info[2].As<Napi::Number>().Int32Value();
#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        for (auto& w : windows) if (!w.isExtension) {
            SendMessage(w.hwnd, WM_MOUSEWHEEL, MAKEWPARAM(0, dy), 0);
            break;
        }
#endif
        return Napi::Boolean::New(env, true);
    }

    Napi::Value IsProcessWindowActive(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        int pid = info[0].As<Napi::Number>().Int32Value();
#ifdef _WIN32
        HWND fw = GetForegroundWindow();
        DWORD fpid; GetWindowThreadProcessId(fw, &fpid);
        return Napi::Boolean::New(env, (DWORD)pid == fpid);
#endif
        return Napi::Boolean::New(env, false);
    }

    Napi::Value SendMouseEventWithPopupMatching(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        int masterPid = info[0].As<Napi::Number>().Int32Value();
        int slavePid = info[1].As<Napi::Number>().Int32Value();
        int x = info[2].As<Napi::Number>().Int32Value();
        int y = info[3].As<Napi::Number>().Int32Value();
        std::string eventType = info[4].As<Napi::String>().Utf8Value();
#ifdef _WIN32
        auto mWins = FindWindowsByPid(masterPid);
        auto sWins = FindWindowsByPid(slavePid);
        if (mWins.empty() || sWins.empty()) return Napi::Boolean::New(env, false);

        HWND mMain = nullptr, sMain = nullptr;
        for (auto& w : mWins) if (!w.isExtension) mMain = w.hwnd;
        for (auto& w : sWins) if (!w.isExtension) sMain = w.hwnd;
        if (!mMain || !sMain) return Napi::Boolean::New(env, false);

        auto mPops = FindPopupWindows(masterPid);
        auto sPops = FindPopupWindows(slavePid);

        HWND mClickedPop = nullptr;
        for (HWND p : mPops) {
            RECT pr; GetWindowRect(p, &pr);
            if (x >= pr.left && x <= pr.right && y >= pr.top && y <= pr.bottom) { mClickedPop = p; break; }
        }

        HWND target = sMain;
        int tx = x, ty = y;

        if (mClickedPop) {
            HWND sMatch = FindMatchingPopup(mMain, mClickedPop, sMain, sPops);
            if (sMatch) {
                target = sMatch;
                RECT mpr, spr;
                GetWindowRect(mClickedPop, &mpr);
                GetWindowRect(sMatch, &spr);
                tx = spr.left + (x - mpr.left);
                ty = spr.top + (y - mpr.top);
            }
        } else {
            RECT mr, sr;
            GetWindowRect(mMain, &mr); GetWindowRect(sMain, &sr);
            double rx = (double)(x - mr.left) / (mr.right - mr.left);
            double ry = (double)(y - mr.top) / (mr.bottom - mr.top);
            tx = sr.left + (int)(rx * (sr.right - sr.left));
            ty = sr.top + (int)(ry * (sr.bottom - sr.top));
        }

        RECT tr; GetWindowRect(target, &tr);
        LPARAM lp = MAKELPARAM(tx - tr.left, ty - tr.top);
        if (eventType == "rightdown" || eventType == "rightup") {
            POINT op; GetCursorPos(&op);
            SetCursorPos(tx, ty);
            Sleep(15);
            if (eventType == "rightdown") SendMessage(target, WM_RBUTTONDOWN, MK_RBUTTON, lp);
            else { SendMessage(target, WM_RBUTTONUP, 0, lp); Sleep(50); }
            SetCursorPos(op.x, op.y);
        } else {
            PostMessage(target, (eventType == "mousemove" ? WM_MOUSEMOVE : (eventType == "mousedown" ? WM_LBUTTONDOWN : WM_LBUTTONUP)), 0, lp);
        }
#endif
        return Napi::Boolean::New(env, true);
    }
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return WindowManager::Init(env, exports);
}

NODE_API_MODULE(window_addon, Init)