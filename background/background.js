// 浏览器扩展后台脚本基础模板
// 后续可在此添加事件监听、消息通信等逻辑 
import { detectVendor, detectBucketVul } from '../lib/index.js';

// 漏洞类型常量
const TYPE = {
    TRAVERSABLE: '存储桶可遍历',
    UPLOAD: 'put文件上传',
    ACL_READ: 'ACL可读',
    ACL_WRITE: 'ACL可写',
    POLICY_WRITE: 'policy可写',
};

function getHostFromUrl(url) {
    try {
        // 只返回完整 host，不做后缀归一化，保证不同 bucket 独立
        return new URL(url).host;
    } catch {
        return url;
    }
}

function matchBlacklistHost(host, list) {
    if (!Array.isArray(list)) return false;
    const h = String(host || '').toLowerCase();
    return list.some(item => {
        const e = String(item || '').trim().toLowerCase();
        if (!e) return false;
        if (e.startsWith('*.')) {
            return h.endsWith(e.slice(1));
        }
        return h === e || h.endsWith('.' + e);
    });
}

// 被动检测
chrome.webRequest.onCompleted.addListener(
    async (details) => {
        const url = details.url;
        // 跳过扩展自身和非 http/https 请求
        if (!url.startsWith('http://') && !url.startsWith('https://')) return;
        if (details.tabId < 0) return;
        chrome.storage.local.get(['bucketVulHistory', 'flagEnable', 'flagAcl', 'flagPolicy', 'flagTraversable', 'flagUpload', 'flagDelete', 'flagTakeover', 'flagMultipart', 'detectBlacklist'], async (res) => {
            // 检查是否启用检测
            const enableFlag = res.flagEnable ?? true;
            if (!enableFlag) return;
            
            let history = res.bucketVulHistory || [];
            const aclFlag = res.flagAcl ?? true;
            const policyFlag = res.flagPolicy ?? true;
            const traversableFlag = res.flagTraversable ?? true;
            const uploadFlag = res.flagUpload ?? true;
            const deleteFlag = res.flagDelete ?? true;
            const takeoverFlag = res.flagTakeover ?? true;
            const multipartFlag = res.flagMultipart ?? true;
            const bl = res.detectBlacklist || [];
            const host = getHostFromUrl(url);
            if (matchBlacklistHost(host, bl)) return;
            // 只检测未检测过的类型
            const vendor = detectVendor(url);
            const detectedTypes = new Set(
                history
                    .filter(item => getHostFromUrl(item.url) === getHostFromUrl(url) && item.vendor === vendor)
                    .map(item => item.type)
            );
            const resultArr = await detectBucketVul(url, { 
                checkAcl: aclFlag, 
                checkPolicy: policyFlag,
                checkTraversable: traversableFlag,
                checkUpload: uploadFlag,
                checkDelete: deleteFlag,
                checkTakeover: takeoverFlag,
                checkMultipart: multipartFlag
            });
            let newVulFound = false;
            for (const result of resultArr) {
                if (detectedTypes.has(result.type)) continue;
                const newItem = {
                    id: Date.now() + Math.random(),
                    url,
                    type: result.type,
                    vendor: result.vendor,
                    time: Date.now(),
                    request: result.request || '',
                    response: result.response || '',
                    source: '被动'
                };
                history.unshift(newItem);
                newVulFound = true;
            }
            chrome.storage.local.set({ bucketVulHistory: history }, () => {
                if (newVulFound && chrome && chrome.action && chrome.action.setBadgeText) {
                    chrome.action.setBadgeText({ text: '●' });
                    chrome.action.setBadgeBackgroundColor && chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
                }
            });
        });
    },
    { urls: ["<all_urls>"] }
);

// 注册右键菜单
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "bucketvul-detect",
        title: "用 Browser-BucketScan 检测",
        contexts: ["link", "selection", "page"]
    });
});

// 主动检测日志窗口管理
let logWindowId = null;
function openLogWindow() {
    return new Promise((resolve) => {
        if (logWindowId !== null) {
            // 如果窗口已打开，直接返回
            resolve(logWindowId);
            return;
        }
        chrome.windows.create({
            url: chrome.runtime.getURL('popup/log.html'),
            type: 'popup',
            width: 600,
            height: 500
        }, win => {
            logWindowId = win.id;
            resolve(win.id);
        });
    });
}
function sendLog(msg, result) {
    if (logWindowId) {
        chrome.windows.get(logWindowId, { populate: true }, win => {
            if (win && win.tabs && win.tabs.length > 0) {
                for (const tab of win.tabs) {
                    // 使用回调形式处理消息发送，避免Promise未处理的reject错误
                    chrome.tabs.sendMessage(tab.id, { type: 'bucketvul-log', msg, result }, () => {
                        // 检查并忽略发送失败的错误
                        if (chrome.runtime.lastError) {
                            // 静默处理错误，不输出到控制台
                        }
                    });
                }
            }
        });
    }
}

// 监听日志窗口关闭，重置 logWindowId
chrome.windows.onRemoved.addListener(function (windowId) {
    if (windowId === logWindowId) {
        logWindowId = null;
    }
});

// 右键菜单点击事件只打开日志窗口
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    await openLogWindow();
    sendLog('请在日志窗口中点击“开始检测”发起检测');
});

// 新增：接收 log.html 发来的手动检测请求
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message && message.type === 'manual-detect') {
        let targetUrl = message.vulUrl;
        if (!targetUrl) {
            sendLog('未输入URL，检测取消');
            return;
        }
        const host = getHostFromUrl(targetUrl);
            chrome.storage.local.get(['flagEnable', 'flagAcl', 'flagPolicy', 'flagTraversable', 'flagUpload', 'flagDelete', 'flagTakeover', 'flagMultipart', 'bucketVulHistory', 'detectBlacklist'], async (res) => {
            // 检查是否启用检测
            const enableFlag = res.flagEnable ?? true;
            if (!enableFlag) {
                await openLogWindow();
                sendLog('检测已禁用，请在弹窗中开启检测');
                return;
            }
            
            const bl = res.detectBlacklist || [];
            if (matchBlacklistHost(host, bl)) {
                await openLogWindow();
                sendLog('目标在黑名单，跳过检测');
                return;
            }
            await openLogWindow();
            sendLog({ event: 'start', url: targetUrl });
            const aclFlag = res.flagAcl ?? true;
            const policyFlag = res.flagPolicy ?? true;
            const traversableFlag = res.flagTraversable ?? true;
            const uploadFlag = res.flagUpload ?? true;
            const deleteFlag = res.flagDelete ?? true;
            const takeoverFlag = res.flagTakeover ?? true;
            const multipartFlag = res.flagMultipart ?? true;
            sendLog({ event: 'params', acl: aclFlag, policy: policyFlag, traversable: traversableFlag, upload: uploadFlag, delete: deleteFlag, takeover: takeoverFlag, multipart: multipartFlag });
            try {
                const vendors = message.vendors && message.vendors.length ? message.vendors : ['aliyun', 'tencent', 'huawei', 'AmazonS3', '京东云', '百度云', 'tos', '火山云'];
                let history = res.bucketVulHistory || [];
                for (const v of vendors) {
                    let vendorName =
                        v === 'aliyun' ? '阿里云' :
                            v === 'tencent' ? '腾讯云' :
                                v === 'huawei' ? '华为云' :
                                    (v === 'aws' || v === 'amazon' || v === 'amazons3' || v === 'amazonaws' || v === 'AmazonS3') ? 'AmazonS3' :
                                        (v === 'jdcloud' || v === '京东云') ? '京东云' :
                                            (v === 'bcebos' || v === '百度云') ? '百度云' :
                                                (v === 'tos' || v === '火山云') ? '火山云' : v;
                    sendLog({ event: 'vendor-start', vendor: vendorName });
                    const resultArr = await detectBucketVul(targetUrl, { 
                        checkAcl: aclFlag, 
                        checkPolicy: policyFlag, 
                        checkTraversable: traversableFlag,
                        checkUpload: uploadFlag,
                        checkDelete: deleteFlag,
                        checkTakeover: takeoverFlag,
                        checkMultipart: multipartFlag,
                        vendors: [v] 
                    });
                    let foundAny = false;
                    for (const result of resultArr) {
                        let statusCode = undefined;
                        let path = '';
                        if (result.url) {
                            try { path = new URL(result.url).pathname + new URL(result.url).search; } catch { path = result.url; }
                        }
                        if (result.response) {
                            const m = result.response.match(/^HTTP\/1\.1 (\d{3})/);
                            if (m) statusCode = m[1];
                        }
                        sendLog({
                            event: 'detect',
                            vendor: result.vendor,
                            type: result.type,
                            path,
                            statusCode,
                            found: result.found,
                            detail: result.detail || '',
                            request: result.request,
                            response: result.response,
                            source: '主动'
                        });
                        if (result.found) {
                            foundAny = true;
                            const exists = history.some(item =>
                                getHostFromUrl(item.url) === getHostFromUrl(targetUrl) &&
                                item.type === result.type &&
                                item.vendor === result.vendor
                            );
                            if (!exists) {
                                const newItem = {
                                    id: Date.now() + Math.random(),
                                    url: targetUrl,
                                    type: result.type,
                                    vendor: result.vendor,
                                    time: Date.now(),
                                    request: result.request || '',
                                    response: result.response || '',
                                    source: '主动'
                                };
                                history.unshift(newItem);
                            }
                        }
                    }
                    if (!foundAny) {
                        sendLog({ event: 'vendor-result', vendor: vendorName, found: false });
                    }
                }
                chrome.storage.local.set({ bucketVulHistory: history }, () => {
                    if (history.length !== (res.bucketVulHistory || []).length && chrome && chrome.action && chrome.action.setBadgeText) {
                    chrome.action.setBadgeText({ text: '●' });
                    chrome.action.setBadgeBackgroundColor && chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
                }
                });
                sendLog({ event: 'finish' });
            } catch (e) {
                sendLog({ event: 'error', error: e + '' });
            }
        });
    }
    if (message && message.type === 'batch-manual-detect') {
        const targetUrls = message.urls || [];
        if (targetUrls.length === 0) {
            sendLog('未输入URL，检测取消');
            return;
        }
        chrome.storage.local.get(['flagEnable', 'flagAcl', 'flagPolicy', 'flagTraversable', 'flagUpload', 'flagDelete', 'flagTakeover', 'flagMultipart', 'bucketVulHistory', 'detectBlacklist'], async (res) => {
            const enableFlag = res.flagEnable ?? true;
            if (!enableFlag) {
                await openLogWindow();
                sendLog('检测已禁用，请在弹窗中开启检测');
                return;
            }
            const bl = res.detectBlacklist || [];
            const aclFlag = res.flagAcl ?? true;
            const policyFlag = res.flagPolicy ?? true;
            const traversableFlag = res.flagTraversable ?? true;
            const uploadFlag = res.flagUpload ?? true;
            const deleteFlag = res.flagDelete ?? true;
            const takeoverFlag = res.flagTakeover ?? true;
            const multipartFlag = res.flagMultipart ?? true;
            await openLogWindow();
            sendLog({ event: 'batch-start', total: targetUrls.length });
            sendLog({ event: 'params', acl: aclFlag, policy: policyFlag, traversable: traversableFlag, upload: uploadFlag, delete: deleteFlag, takeover: takeoverFlag, multipart: multipartFlag });
            const vendorKeys = message.vendors && message.vendors.length ? message.vendors : ['aliyun', 'tencent', 'huawei', 'AmazonS3', '京东云', '百度云', 'tos'];
            const vendorNameMap = {
                aliyun: '阿里云', tencent: '腾讯云', huawei: '华为云',
                'AmazonS3': 'AmazonS3', '京东云': '京东云', '百度云': '百度云', tos: '火山云'
            };
            let history = res.bucketVulHistory || [];
            let totalFound = 0;
            for (let i = 0; i < targetUrls.length; i++) {
                const targetUrl = targetUrls[i];
                const host = getHostFromUrl(targetUrl);
                if (matchBlacklistHost(host, bl)) {
                    sendLog({ event: 'batch-url-skip', url: targetUrl, index: i + 1, total: targetUrls.length, reason: '黑名单' });
                    continue;
                }
                sendLog({ event: 'batch-url-start', url: targetUrl, index: i + 1, total: targetUrls.length });
                // 自动识别厂商
                let detectedVendor = detectVendor(targetUrl);
                if (detectedVendor === '未知') {
                    try { detectedVendor = await detectVendorByServer(targetUrl); } catch {}
                }
                // 如果识别到厂商，只测对应厂商；否则测全部选中厂商
                const vendorKeyMap = { '阿里云': 'aliyun', '腾讯云': 'tencent', '华为云': 'huawei', 'AmazonS3': 'AmazonS3', '京东云': '京东云', '百度云': '百度云', '火山云': 'tos' };
                let vendorsToTest = [];
                if (detectedVendor !== '未知' && vendorKeyMap[detectedVendor]) {
                    const vk = vendorKeyMap[detectedVendor];
                    if (vendorKeys.includes(vk)) vendorsToTest = [vk];
                }
                if (vendorsToTest.length === 0) vendorsToTest = vendorKeys;
                let urlFound = 0;
                for (const v of vendorsToTest) {
                    const vendorName = vendorNameMap[v] || v;
                    sendLog({ event: 'vendor-start', vendor: vendorName });
                    try {
                        const resultArr = await detectBucketVul(targetUrl, {
                            checkAcl: aclFlag, checkPolicy: policyFlag, checkTraversable: traversableFlag,
                            checkUpload: uploadFlag, checkDelete: deleteFlag, checkTakeover: takeoverFlag,
                            checkMultipart: multipartFlag, vendors: [v]
                        });
                        for (const result of resultArr) {
                            let statusCode, path = '';
                            if (result.url) { try { path = new URL(result.url).pathname + new URL(result.url).search; } catch { path = result.url; } }
                            if (result.response) { const m = result.response.match(/^HTTP\/1\.1 (\d{3})/); if (m) statusCode = m[1]; }
                            sendLog({
                                event: 'detect', vendor: result.vendor, type: result.type,
                                path, statusCode, found: result.found, detail: result.detail || '',
                                request: result.request, response: result.response, source: '主动'
                            });
                            if (result.found) {
                                urlFound++;
                                const exists = history.some(item => getHostFromUrl(item.url) === host && item.type === result.type && item.vendor === result.vendor);
                                if (!exists) {
                                    history.unshift({ id: Date.now() + Math.random(), url: targetUrl, type: result.type, vendor: result.vendor, time: Date.now(), request: result.request || '', response: result.response || '', source: '主动' });
                                }
                            }
                        }
                    } catch (e) {
                        sendLog({ event: 'error', error: `${vendorName}: ${e}` });
                    }
                }
                sendLog({ event: 'batch-url-result', url: targetUrl, found: urlFound });
                totalFound += urlFound;
            }
            chrome.storage.local.set({ bucketVulHistory: history }, () => {
                if (history.length !== (res.bucketVulHistory || []).length && chrome && chrome.action && chrome.action.setBadgeText) {
                    chrome.action.setBadgeText({ text: '●' });
                    chrome.action.setBadgeBackgroundColor && chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
                }
            });
            sendLog({ event: 'batch-finish', total: targetUrls.length, found: totalFound });
        });
    }
    if (message && message.type === 'clear-badge') {
        if (chrome && chrome.action && chrome.action.setBadgeText) {
            chrome.action.setBadgeText({ text: '' });
        }
    }
});
