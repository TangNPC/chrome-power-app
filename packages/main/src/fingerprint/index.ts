import {join} from 'path';
import {ProxyDB} from '../db/proxy';
import {WindowDB} from '../db/window';
// import {getChromePath} from './device';
import {BrowserWindow} from 'electron';
import puppeteer, {Browser} from 'puppeteer';
import {execSync, spawn} from 'child_process';
import * as portscanner from 'portscanner';
import {sleep} from '../utils/sleep';
import SocksServer from '../proxy-server/socks-server';
import type {DB} from '../../../shared/types/db';
import {type IncomingMessage, type Server, type ServerResponse} from 'http';
import {createLogger} from '../../../shared/utils/logger';
import {WINDOW_LOGGER_LABEL} from '../constants';
import {db} from '../db';
import {getProxyInfo} from './prepare';
import * as ProxyChain from 'proxy-chain';
import {getSettings} from '../utils/get-settings';
// import {randomFingerprint} from '../services/window-service';
import {bridgeMessageToUI, getClientPort, getMainWindow} from '../mainWindow';
import {Mutex} from 'async-mutex';
// import {presetCookie} from '../puppeteer/helpers';
import {existsSync, mkdirSync} from 'fs';
import api from '../../../shared/api/api';
import {ExtensionDB} from '../db/extension';
import { getPort } from '../server';

const mutex = new Mutex();

const logger = createLogger(WINDOW_LOGGER_LABEL);

const HOST = '127.0.0.1';

// async function connectBrowser(
//   port: number,
//   ipInfo: IP,
//   windowId: number,
//   openStartPage: boolean = true,
// ) {
//   // const windowData = await WindowDB.getById(windowId);
//   const settings = getSettings();
//   const browserURL = `http://${HOST}:${port}`;
//   const {data} = await api.get(browserURL + '/json/version');
//   if (data.webSocketDebuggerUrl) {
//     const browser = await puppeteer.connect({
//       browserWSEndpoint: data.webSocketDebuggerUrl,
//       defaultViewport: null,
//     });

//     // if (!windowData.opened_at) {
//     //   await presetCookie(windowId, browser);
//     // }
//     await WindowDB.update(windowId, {
//       status: 2,
//       port: port,
//       opened_at: db.fn.now() as unknown as string,
//     });

//     browser.on('targetcreated', async target => {
//       const newPage = await target.page();
//       if (newPage) {
//         await newPage.waitForNavigation({waitUntil: 'networkidle0'});
//         if (!settings.useLocalChrome) {
//           await modifyPageInfo(windowId, newPage, ipInfo);
//         }
//       }
//     });
//     const pages = await browser.pages();
//     const page =
//       pages.length &&
//       (pages?.[0]?.url() === 'about:blank' ||
//         !pages?.[0]?.url() ||
//         pages?.[0]?.url() === 'chrome://new-tab-page/')
//         ? pages?.[0]
//         : await browser.newPage();
//     try {
//       if (!settings.useLocalChrome) {
//         await modifyPageInfo(windowId, page, ipInfo);
//       }
//       if (getClientPort() && openStartPage) {
//         await page.goto(
//           `http://localhost:${getClientPort()}/#/start?windowId=${windowId}&serverPort=${getPort()}`,
//         );
//       }
//     } catch (error) {
//       logger.error(error);
//     }
//     return data;
//   }
// }

const getDriverPath = (windowData?: DB.Window) => {
  const settings = getSettings();

  // 如果窗口填写了本地Chrome路径，自动使用
  if (windowData?.localChromePath) {
    return windowData.localChromePath;
  }
  
  // 如果窗口填写了chromium路径
  if (windowData?.chromiumBinPath) {
    return windowData.chromiumBinPath;
  }

  // 否则使用全局设置
  if (settings.useLocalChrome) {
    return settings.localChromePath;
  } else {
    return settings.chromiumBinPath;
  }
};

/**
 * 根据窗口索引自动设置窗口位置，实现层叠排列
 */
const setWindowBounds = async (browser: Browser, windowIndex: number) => {
  try {
    const page = (await browser.pages())[0];
    if (!page) return;

    // 通过 CDP 获取窗口信息
    const client = await page.createCDPSession();
    const { windowId } = await client.send('Browser.getWindowForTarget', {
      targetId: (page.target() as any)._targetId,
    });

    // 窗口尺寸
    const windowWidth = 450;
    const windowHeight = 600;
    // 层叠偏移量
    const cascadeOffset = 20;

    // 计算层叠位置
    const left = windowIndex * cascadeOffset;
    const top = windowIndex * cascadeOffset;

    await client.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        left: left,
        top: top,
        width: windowWidth,
        height: windowHeight,
      },
    });

    logger.info(`Window positioned at (${left}, ${top}) with size ${windowWidth}x${windowHeight}`);
    await client.detach();
  } catch (error) {
    logger.error('Failed to set window bounds:', error);
  }
};

/**
 * 通过 CDP 设置书签栏显示并添加书签
 */
const setupBookmarksBar = async (browser: Browser, bookmarks: Array<{title: string; url: string}>) => {
  try {
    const page = (await browser.pages())[0];
    if (!page) return;

    const isMac = process.platform === 'darwin';
    
    // 1. 尝试通过快捷键打开书签栏
    // Ctrl+Shift+B 是 Windows/Linux 切换书签栏显示的快捷键
    // Cmd+Shift+B 是 Mac 的快捷键
    if (isMac) {
      await page.keyboard.down('Meta');
      await page.keyboard.down('Shift');
      await page.keyboard.press('b');
      await page.keyboard.up('Shift');
      await page.keyboard.up('Meta');
    } else {
      await page.keyboard.down('Control');
      await page.keyboard.down('Shift');
      await page.keyboard.press('b');
      await page.keyboard.up('Shift');
      await page.keyboard.up('Control');
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 2. 如果有书签需要添加，导航到第一个页面后添加书签
    if (bookmarks.length > 0) {
      // 先导航到第一个书签的URL
      await page.goto(bookmarks[0].url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // 使用快捷键添加书签 Ctrl+D / Cmd+D
      if (isMac) {
        await page.keyboard.down('Meta');
        await page.keyboard.press('d');
        await page.keyboard.up('Meta');
      } else {
        await page.keyboard.down('Control');
        await page.keyboard.press('d');
        await page.keyboard.up('Control');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await page.keyboard.press('Escape');
    }
    
    logger.info('Bookmarks bar configured successfully');
  } catch (error) {
    logger.error('Failed to setup bookmarks bar:', error);
  }
};

const getAvailablePort = async () => {
  for (let attempts = 0; attempts < 10; attempts++) {
    try {
      const port = await portscanner.findAPortNotInUse(9222, 40222);
      return port; // 成功绑定后返回
    } catch (error) {
      console.log('Port already in use, retrying...');
    }
  }
  throw new Error('Failed to find a free port after multiple attempts');
};

const waitForChromeReady = async (chromePort: number, id: number, maxAttempts = 30) => {
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      // 尝试连接 CDP
      const response = await api.get(`http://${HOST}:${chromePort}/json/version`, {
        timeout: 1000,
      });
      if (response.status === 200) {
        return true;
      }
    } catch (error) {
      logger.error('连接失败', (error as Error).message);
      // 连接失败，继续等待
    }

    attempts++;
    await sleep(0.5);
  }

  throw new Error('Chrome instance failed to start within the timeout period');
};

export async function openFingerprintWindow(id: number, headless = false) {
  const release = await mutex.acquire();
  try {
    const windowData = await WindowDB.getById(id);
    
    // 检查窗口是否已经打开
    if (windowData.status === 2 && windowData.port) {
      logger.info(`Window ${id} is already running on port ${windowData.port}`);
      try {
        const browserURL = `http://${HOST}:${windowData.port}`;
        const {data} = await api.get(browserURL + '/json/version');
        
        // 如果能成功获取到浏览器信息，说明窗口仍然可用
        if (data) {
          logger.info(`Window ${id} is already running on port ${windowData.port}`);
          // 获取浏览器实例，把窗口放到最前面
          const browser = await puppeteer.connect({
            browserWSEndpoint: data.webSocketDebuggerUrl,
            defaultViewport: null,
          });
          const pages = await browser.pages();
          if (pages.length > 0) {
            await pages[0].bringToFront();
            // 取消连接
            await browser.disconnect();
          }
          return {
            ...data,
          };
        }
      } catch (error) {
        // 如果获取失败，说明窗口虽然标记为打开但实际已关闭
        logger.warn(`Window ${id} marked as running but not accessible, will reopen`);
        await WindowDB.update(id, {
          ...windowData,
          status: 1,
          port: null,
          pid: null,
        });
      }
    }

    const extensionData = await ExtensionDB.getExtensionsByWindowId(id);
    const proxyData = await ProxyDB.getById(windowData.proxy_id);
    const proxyType = proxyData?.proxy_type?.toLowerCase();
    const settings = getSettings();

    const cachePath = settings.profileCachePath;

    const win = BrowserWindow.getAllWindows()[0];
    // 优先使用窗口级别的 Chrome 设置，否则使用全局设置
    // 如果窗口填写了 localChromePath，使用本地 Chrome 模式
    const useLocalChrome = windowData?.localChromePath ? true : (windowData.useLocalChrome ?? settings.useLocalChrome);
    const windowDataDir = join(
      cachePath,
      windowData?.localChromePath ? 'chrome' : (useLocalChrome ? 'chrome' : 'chromium'),
      windowData.profile_id,
    );
    logger.info(`Opening window with profile_id: ${windowData.profile_id}, userDataDir: ${windowDataDir}`);

    // 确保目录存在并设置正确权限
    if (!existsSync(windowDataDir)) {
      try {
        mkdirSync(windowDataDir, {recursive: true, mode: 0o755});
      } catch (error) {
        logger.error(`Failed to create directory: ${error}`);
        return null;
      }
    }

    // 确保目录有正确的权限
    const isMac = process.platform === 'darwin';
    if (isMac) {
      try {
        execSync(`chmod -R 755 "${windowDataDir}"`);
      } catch (error) {
        logger.error(`Failed to set permissions: ${error}`);
        return null;
      }
    }

    const driverPath = getDriverPath(windowData);
    let ipInfo = {timeZone: '', ip: '', ll: [], country: ''};
    if (windowData.proxy_id && proxyData.ip) {
      ipInfo = await getProxyInfo(proxyData);
      if (!ipInfo?.ip) {
        logger.error('ipInfo is empty');
      }
    }

    // const fingerprint =
    //   windowData.fingerprint && windowData.fingerprint !== '{}'
    //     ? JSON.parse(windowData.fingerprint)
    //     : randomFingerprint();
    // if (!windowData.fingerprint || windowData.fingerprint === '{}') {
    //   await WindowDB.update(id, {
    //     ...windowData,
    //     fingerprint,
    //   });
    // }

    if (driverPath) {
      const chromePort = await getAvailablePort();
      let finalProxy;
      let proxyServer: Server<typeof IncomingMessage, typeof ServerResponse> | ProxyChain.Server;
      if (proxyData && proxyType === 'socks5' && proxyData.proxy) {
        const proxyInstance = await createSocksProxy(proxyData);
        finalProxy = proxyInstance.proxyUrl;
        proxyServer = proxyInstance.proxyServer;
      } else if (proxyData && proxyType === 'http' && proxyData.proxy) {
        const proxyInstance = await createHttpProxy(proxyData);
        finalProxy = proxyInstance.proxyUrl;
        proxyServer = proxyInstance.proxyServer;
      }

      const isMac = process.platform === 'darwin';
      const launchParamter = useLocalChrome
        ? [
            `--remote-debugging-port=${chromePort}`,
            `--user-data-dir=${windowDataDir}`,
            '--no-first-run',
          ]
        : [
            // Mac 特定参数
            ...(isMac ? ['--args'] : []),

            // `--extended-parameters=${btoa(JSON.stringify(fingerprint))}`,
            '--force-color-profile=srgb',
            '--no-first-run',
            '--no-default-browser-check',
            '--metrics-recording-only',
            '--disable-background-mode',
            `--remote-debugging-port=${chromePort}`,
            `--user-data-dir=${windowDataDir}`,
            // `--user-agent=${fingerprint?.ua}`,
            '--unhandled-rejections=strict',

            // Mac 特定安全参数
            ...(isMac ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
          ];

      if (finalProxy) {
        launchParamter.push(`--proxy-server=${finalProxy}`);
      }
      if (ipInfo?.timeZone && !settings.useLocalChrome) {
        launchParamter.push(`--timezone=${ipInfo.timeZone}`);
        launchParamter.push(`--tz=${ipInfo.timeZone}`);
      }
      if (extensionData.length > 0) {
        launchParamter.push(`--load-extension=${extensionData.map(e => e.path).join(',')}`);
      }
      if (headless) {
        launchParamter.push('--headless=new'); // 使用新版 headless 模式
        if (!isMac) {
          launchParamter.push('--disable-gpu'); // 在 Mac 上不需要这个参数
        }
      } else {
        launchParamter.push('--new-window');
      }

      // 添加调试参数（如果需要）
      if (process.env.NODE_ENV === 'development') {
        // launchParamter.push(
        //   '--enable-logging',
        //   '--v=1',
        //   '--enable-blink-features=IdleDetection',
        // );
      }
      // const iconPath = await generateChromeIcon(windowDataDir, id);


      let chromeInstance;
      try {
        // if (isMac) {
        //   chromeInstance = spawn(driverPath, launchParamter);
        // } else {
        //   try {
        //     const shortcutPath = path.join(windowDataDir, `chrome-${windowData.id}.lnk`);
        //     await createShortcutWithIcon(driverPath, launchParamter, iconPath, shortcutPath);
        //     console.log('shortcutPath', shortcutPath);
        //     console.log('driverPath', driverPath);
        //     chromeInstance = spawn('cmd.exe', ['/c', 'start', '', shortcutPath]);
        //     console.log('chromeInstance', chromeInstance);
        //   } catch (error) {
        //     logger.error(error);
        //     chromeInstance = spawn(driverPath, launchParamter);
        //   }
        // }
        logger.info(`Launching Chrome: ${driverPath} ${launchParamter.join(' ')}`);
        chromeInstance = spawn(driverPath, launchParamter);
      } catch (error) {
        logger.error(error);
      }
      if (!chromeInstance) {
        return;
      }
      await sleep(1);
      win.webContents.send('window-opened', id);
      chromeInstance.stdout.on('data', _chunk => {
        // const str = _chunk.toString();
        // console.error('stderr: ', str);
      });
      // 这个地方需要监听 stderr，否则在某些网站会出现卡死的情况
      chromeInstance.stderr.on('data', _chunk => {
        // const str = _chunk.toString();
        // console.error('stderr: ', str);
      });

      chromeInstance.on('close', async () => {
        logger.info(`Chrome process exited at port ${chromePort}, closed time: ${new Date()}`);
        logger.info(`Chrome user-data-dir: ${windowDataDir}`);
        logger.info(`Chrome PID was: ${chromeInstance.pid}`);
        if (proxyType === 'socks5') {
          (proxyServer as Server<typeof IncomingMessage, typeof ServerResponse>)?.close(() => {
            logger.info('Socks5 Proxy server was closed.');
          });
        } else if (proxyType === 'http') {
          (proxyServer as ProxyChain.Server).close(true, () => {
            logger.info('Http Proxy server was closed.');
          });
        }
        await closeFingerprintWindow(id, false);
      });

      await waitForChromeReady(chromePort, id, 30);

      try {
        const browserURL = `http://${HOST}:${chromePort}`;
        const {data} = await api.get(browserURL + '/json/version');
        
        // 设置窗口位置，避免堆叠，并显示书签栏
        try {
          const browser = await puppeteer.connect({
            browserWSEndpoint: data.webSocketDebuggerUrl,
            defaultViewport: null,
          });
          // 获取当前已打开的窗口数量，作为当前窗口的索引
          const openWindows = (await WindowDB.all()) as DB.Window[];
          const openCount = openWindows.filter((w: DB.Window) => w.status === 2 && w.id !== windowData.id).length;
          await setWindowBounds(browser, openCount);
          
          // 设置书签栏
          const bookmarks = windowData.bookmarks || [];
          if (bookmarks.length > 0) {
            await setupBookmarksBar(browser, bookmarks);
          } else {
            // 即使没有预设书签，也显示书签栏
            await setupBookmarksBar(browser, []);
          }
          
          await browser.disconnect();
        } catch (boundsError) {
          logger.error('Failed to set window bounds:', boundsError);
        }
        
        const now = new Date().toISOString();
        logger.info(`Updating window ${windowData.id} with opened_at: ${now}`);
        const updateResult = await WindowDB.update(windowData.id, {
          ...windowData,
          status: 2,
          pid: chromeInstance.pid,
          port: chromePort,
          opened_at: now,
        });
        if (!updateResult.success) {
          logger.error(`Failed to update window: ${updateResult.message}`);
        } else {
          logger.info(`Window ${windowData.id} opened_at updated successfully`);
        }
        return {
          ...data,
        };
      } catch (error) {
        logger.error('open window failed', error);

        // 检查进程是否存在并终止
        if (chromeInstance.pid) {
          try {
            if (process.platform === 'win32') {
              try {
                // 使用 chcp 65001 设置控制台代码页为 UTF-8
                execSync('chcp 65001', {stdio: 'ignore'});

                // 检查进程是否存在
                execSync(`tasklist /FI "PID eq ${chromeInstance.pid}" /NH /FO CSV`, {
                  encoding: 'utf8',
                  stdio: ['ignore', 'pipe', 'ignore'],
                });

                // 进程存在，终止它
                execSync(`taskkill /PID ${chromeInstance.pid} /F /T`, {
                  encoding: 'utf8',
                  stdio: ['ignore', 'pipe', 'ignore'],
                });

                logger.info(`Successfully terminated process ${chromeInstance.pid}`);
              } catch (err) {
                if ((err as {status: number}).status === 128) {
                  logger.info(`Process ${chromeInstance.pid} does not exist`);
                } else {
                  throw err;
                }
              }
            } else {
              // Unix系统的处理保持不变
              try {
                process.kill(chromeInstance.pid, 0);
                execSync(`kill -9 ${chromeInstance.pid}`);
              } catch (err) {
                logger.info(`Process ${chromeInstance.pid} does not exist`);
              }
            }
          } catch (killError) {
            logger.error(`Failed to kill process ${chromeInstance.pid}:`, killError);
          }
        }
        await closeFingerprintWindow(id, true);
        return null;
      }
    } else {
      bridgeMessageToUI({
        type: 'error',
        text: 'Driver path is empty',
      });
      logger.error('Driver path is empty');
      return null;
    }
  } finally {
    release();
  }
}

async function createHttpProxy(proxyData: DB.Proxy) {
  const listenPort = await portscanner.findAPortNotInUse(30000, 40000);
  const [httpHost, httpPort, username, password] = proxyData.proxy!.split(':');

  const oldProxyUrl = `http://${username}:${password}@${httpHost}:${httpPort}`;
  const newProxyUrl = await ProxyChain.anonymizeProxy({
    url: oldProxyUrl,
    port: listenPort,
  });
  const proxyServer = new ProxyChain.Server({
    port: listenPort,
  });

  return {
    proxyServer,
    proxyUrl: newProxyUrl,
  };
}

async function createSocksProxy(proxyData: DB.Proxy) {
  const listenHost = HOST;
  const listenPort = await portscanner.findAPortNotInUse(30000, 40000);
  const [socksHost, socksPort, socksUsername, socksPassword] = proxyData.proxy!.split(':');

  const proxyServer = SocksServer({
    listenHost,
    listenPort,
    socksHost,
    socksPort: +socksPort,
    socksUsername,
    socksPassword,
  });

  // 添加更多错误处理
  proxyServer.on('error', err => {
    logger.error('Socks server error:', err);
  });

  proxyServer.on('connect:error', err => {
    logger.error('Socks connect error:', err);
  });

  proxyServer.on('request:error', err => {
    logger.error('Socks request error:', err);
  });

  // 添加连接关闭处理
  proxyServer.on('close', () => {
    logger.info('Socks server closed');
  });

  return {
    proxyServer,
    proxyUrl: `http://${listenHost}:${listenPort}`,
  };
}

export async function resetWindowStatus(id: number) {
  const window = await WindowDB.getById(id);
  await WindowDB.update(id, {...window, status: 1, port: null, pid: null});
}

export async function closeFingerprintWindow(id: number, force = false) {
  const window = await WindowDB.getById(id);
  const port = window.port;
  if (force && port) {
    try {
      const browserURL = `http://${HOST}:${port}`;
      const {data} = await api.get(browserURL + '/json/version');
      const browser = await puppeteer.connect({
        browserWSEndpoint: data.webSocketDebuggerUrl,
        defaultViewport: null,
      });
      logger.info('close browser', browserURL);
      await browser?.close();
    } catch (error) {
      logger.error(error);
    }
  }
  await WindowDB.update(id, {...window, status: 1, port: null, pid: null});
  const win = getMainWindow();
  if (win) {
    win.webContents.send('window-closed', id);
  }
}

/**
 * 将指定窗口聚焦并置顶到最前面
 */
export async function focusFingerprintWindow(id: number) {
  const windowData = await WindowDB.getById(id);
  
  if (!windowData || windowData.status !== 2 || !windowData.port) {
    logger.warn(`Window ${id} is not running, cannot focus`);
    return { success: false, message: 'Window is not running' };
  }

  try {
    const browserURL = `http://${HOST}:${windowData.port}`;
    const {data} = await api.get(browserURL + '/json/version');
    
    if (data) {
      const browser = await puppeteer.connect({
        browserWSEndpoint: data.webSocketDebuggerUrl,
        defaultViewport: null,
      });
      const pages = await browser.pages();
      if (pages.length > 0) {
        const page = pages[0];
        
        // 使用 CDP 获取窗口 ID
        const client = await page.createCDPSession();
        const { windowId } = await client.send('Browser.getWindowForTarget', {
          targetId: (page.target() as any)._targetId,
        });
        
        // 先最小化再恢复，确保窗口置顶
        await client.send('Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'minimized' },
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        await client.send('Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'normal' },
        });
        
        await client.detach();
        logger.info(`Window ${id} focused and brought to top`);
      }
      await browser.disconnect();
      return { success: true };
    }
  } catch (error) {
    logger.error(`Failed to focus window ${id}:`, error);
    return { success: false, message: String(error) };
  }

  return { success: false, message: 'Window not accessible' };
}

export default {
  openFingerprintWindow,

  closeFingerprintWindow,
  
  focusFingerprintWindow,
};

