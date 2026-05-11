// popup 弹窗脚本
// 检测历史存储在 chrome.storage.local，格式为 [{id, url, type, vendor, time, request, response}]

const historyList = document.getElementById('history-list');
const noHistory = document.getElementById('no-history');
const clearBtn = document.getElementById('clear-history');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalClose = document.getElementById('modal-close');

// 示例数据
const demoHistory = [
    // {
    //     id: 1,
    //     url: "https://oss-example-bucket.oss-cn-beijing.aliyuncs.com/secret.txt",
    //     type: "未授权读取",
    //     vendor: "阿里云",
    //     time: 1718000000000,
    //     request: `GET /secret.txt HTTP/1.1\nHost: oss-example-bucket.oss-cn-beijing.aliyuncs.com\nUser-Agent: Mozilla/5.0 ...`,
    //     response: `HTTP/1.1 200 OK\nContent-Type: text/plain\n\nsecret=flag{example}`
    // },
    // {
    //     id: 2,
    //     url: "https://mybucket-1250000000.cos.ap-shanghai.myqcloud.com/test.jpg",
    //     type: "ACL过宽",
    //     vendor: "腾讯云",
    //     time: 1718003600000,
    //     request: `GET /test.jpg HTTP/1.1\nHost: mybucket-1250000000.cos.ap-shanghai.myqcloud.com\nUser-Agent: Mozilla/5.0 ...`,
    //     response: `HTTP/1.1 200 OK\nContent-Type: image/jpeg\n\xff\xd8\xff...`
    // },
    // {
    //     id: 3,
    //     url: "https://obs-bucket.obs.cn-north-4.myhuaweicloud.com/config.json",
    //     type: "未授权写入",
    //     vendor: "华为云",
    //     time: 1718007200000,
    //     request: `PUT /config.json HTTP/1.1\nHost: obs-bucket.obs.cn-north-4.myhuaweicloud.com\nContent-Type: application/json\n\n{"test":true}`,
    //     response: `HTTP/1.1 204 No Content\n\n`
    // }
];

// 加载历史
function loadHistory() {
    chrome.storage.local.get(['bucketVulHistory'], (result) => {
        let history = result.bucketVulHistory || [];
        if (!history.length) {
            // 没有历史时自动写入示例数据
            chrome.storage.local.set({ bucketVulHistory: demoHistory }, () => {
                renderHistory(demoHistory);
            });
        } else {
            renderHistory(history);
        }
    });
}

// 渲染历史
function renderHistory(history) {
    currentHistory = history; // 渲染时同步缓存
    historyList.innerHTML = '';
    if (!history.length) {
        noHistory.style.display = 'block';
        // 没有漏洞时移除红点
        if (chrome && chrome.action && chrome.action.setBadgeText) {
            chrome.action.setBadgeText({ text: '' });
        }
        return;
    }
    noHistory.style.display = 'none';
    // 有漏洞时不再设置红点，由检测逻辑控制
    history.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
      <span class="seq">${idx + 1}</span>
      <span class="host" title="${escapeHtml(getHost(item))}">${escapeHtml(getHost(item))}</span>
      <span class="type">${escapeHtml(item.type || '未知类型')}</span>
      <span class="vendor">${escapeHtml(item.vendor || '未知厂商')}</span>
      <span class="time">${formatTime(item.time)}</span>
      <span class="source-tag" style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;margin-left:6px;${item.source === '主动' ? 'background:#eaf6ff;color:#2d7be5;' : 'background:#fbeee6;color:#c0392b;'}">${item.source || '未知'}</span>
      <button class="reqresp-btn" data-idx="${idx}">展示细节</button>
      <button class="delete-btn" title="删除" data-id="${item.id}">✕</button>
    `;
        historyList.appendChild(li);
    });
}

function updateReqRespScroll() {
    const expanded = document.querySelectorAll('.reqresp-row');
    const list = document.getElementById('history-list');
    if (expanded.length >= 3) {
        list.classList.add('show-scroll');
    } else {
        list.classList.remove('show-scroll');
    }
}

// 修改展开/收起逻辑，插入/移除时都调用 updateReqRespScroll
historyList.addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-btn')) {
        const id = e.target.getAttribute('data-id');
        chrome.storage.local.get(['bucketVulHistory'], (result) => {
            let history = result.bucketVulHistory || [];
            history = history.filter(item => String(item.id) !== String(id));
            chrome.storage.local.set({ bucketVulHistory: history }, loadHistory);
        });
    }
    if (e.target.classList.contains('reqresp-btn')) {
        const idx = e.target.getAttribute('data-idx');
        const item = currentHistory[idx];
        let next = e.target.parentElement.nextElementSibling;
        if (next && next.classList.contains('reqresp-row')) {
            next.remove();
            updateReqRespScroll();
            return;
        }
        const row = document.createElement('li');
        row.className = 'reqresp-row';
        row.innerHTML = `
          <div class="reqresp-flex">
            <div class="reqresp-block">
              <div class="reqresp-title-row"><span class="reqresp-title">请求</span><button class="copy-btn" data-type="request" data-idx="${idx}">复制</button></div>
              <pre class="reqresp-pre">${escapeHtml(item.request || '(无内容)')}</pre>
            </div>
            <div class="reqresp-block">
              <div class="reqresp-title-row"><span class="reqresp-title">响应</span><button class="copy-btn" data-type="response" data-idx="${idx}">复制</button></div>
              <pre class="reqresp-pre">${escapeHtml(item.response || '(无内容)')}</pre>
            </div>
          </div>
        `;
        e.target.parentElement.after(row);
        updateReqRespScroll();
    }
    if (e.target.classList.contains('copy-btn')) {
        const idx = e.target.getAttribute('data-idx');
        const type = e.target.getAttribute('data-type');
        const item = currentHistory[idx];
        const text = type === 'request' ? item.request : item.response;
        navigator.clipboard.writeText(text || '').then(() => {
            e.target.textContent = '已复制!';
            setTimeout(() => { e.target.textContent = '复制'; }, 1200);
        });
    }
    // 每次点击后都检查滚动条
    updateReqRespScroll();
});

function getHistoryByIdxAsync(idx, field, cb) {
    chrome.storage.local.get(['bucketVulHistory'], (result) => {
        let history = result.bucketVulHistory;
        // 如果没有数据，优先用 demoHistory
        if (!history || !history.length) history = demoHistory;
        const val = history[idx] && history[idx][field] ? history[idx][field] : '(无内容)';
        cb(val);
    });
}

function getHost(item) {
    try {
        const host = new URL(item.url).host;
        // 去掉云厂商后缀
        return host
            .replace(/\.oss(-[a-z0-9-]+)?\.aliyuncs\.com$/, '')
            .replace(/\.cos(-[a-z0-9-]+)?\.myqcloud\.com$/, '')
            .replace(/\.obs\.[a-z0-9-]+\.myhuaweicloud\.com$/, '');
    } catch {
        return item.url || '';
    }
}

// 弹窗相关
function showModal(title, body) {
    modalTitle.textContent = title;
    modalBody.textContent = body;
    modal.style.display = 'flex';
    // 添加复制按钮
    addCopyButton();
}

function addCopyButton() {
    let oldBtn = document.getElementById('copy-btn');
    if (oldBtn) oldBtn.remove();
    const btn = document.createElement('button');
    btn.id = 'copy-btn';
    btn.textContent = '复制';
    btn.style = 'position:absolute;right:60px;top:10px;padding:2px 10px;font-size:13px;cursor:pointer;';
    btn.onclick = function () {
        navigator.clipboard.writeText(modalBody.textContent).then(() => {
            btn.textContent = '已复制!';
            setTimeout(() => { btn.textContent = '复制'; }, 1200);
        });
    };
    modal.querySelector('.modal-content').appendChild(btn);
}
modalClose.onclick = function () {
    modal.style.display = 'none';
};
window.onclick = function (event) {
    if (event.target === modal) {
        modal.style.display = 'none';
    }
};

// 清空全部
clearBtn.addEventListener('click', () => {
    if (confirm('确定要清空所有检测历史吗？')) {
        chrome.storage.local.set({ bucketVulHistory: [] }, loadHistory);
    }
});

// 工具函数
function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString();
}
function escapeHtml(str) {
    return String(str).replace(/[&<>"']|'/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[s]));
}
function ellipsisUrl(url) {
    if (!url) return '';
    const max = 22;
    if (url.length <= max) return escapeHtml(url);
    return escapeHtml(url.slice(0, max - 3)) + '...';
}

// 初始化
function clearBadge() {
    if (chrome && chrome.action && chrome.action.setBadgeText) {
        chrome.action.setBadgeText({ text: '' });
    }
}

// 导出功能
let currentHistory = [];

// 导出按钮点击事件
document.querySelectorAll('.export-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const format = e.target.getAttribute('data-format');
        exportHistory(format);
    });
});

// 导出历史记录
function exportHistory(format) {
    chrome.storage.local.get(['bucketVulHistory'], (result) => {
        const history = result.bucketVulHistory || [];
        if (!history.length) {
            alert('暂无检测历史可导出');
            return;
        }
        
        let content = '';
        let filename = `bucketscan-export-${new Date().toISOString().slice(0, 10)}`;
        let mimeType = 'text/plain';
        
        switch (format) {
            case 'md':
                content = convertToMD(history);
                filename += '.md';
                mimeType = 'text/markdown';
                break;
            case 'csv':
                content = convertToCSV(history);
                filename += '.csv';
                mimeType = 'text/csv';
                break;
            case 'html':
                content = convertToHTML(history);
                filename += '.html';
                mimeType = 'text/html';
                break;
        }
        
        downloadFile(content, filename, mimeType);
    });
}

// JSON转CSV
function convertToCSV(data) {
    if (!data.length) return '';
    
    // CSV表头
    const headers = ['序号', 'URL', '漏洞类型', '云厂商', '检测时间', '来源', '请求', '响应'];
    const csv = [headers.join(',')];
    
    // CSV内容行
    data.forEach((item, index) => {
        const row = [
            index + 1,
            `"${item.url || ''}"`,
            `"${item.type || ''}"`,
            `"${item.vendor || ''}"`,
            `"${formatTime(item.time) || ''}"`,
            `"${item.source || ''}"`,
            `"${(item.request || '').replace(/"/g, '""') || ''}"`,
            `"${(item.response || '').replace(/"/g, '""') || ''}"`
        ];
        csv.push(row.join(','));
    });
    
    return csv.join('\n');
}

// JSON转HTML
function convertToHTML(data) {
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Browser-BucketScan检测历史导出</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
            color: #333;
        }
        h1 {
            color: #2d7be5;
            border-bottom: 2px solid #2d7be5;
            padding-bottom: 10px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background-color: white;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin: 20px 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }
        th {
            background-color: #f0f4ff;
            color: #2d7be5;
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        tr:hover {
            background-color: #f5f8ff;
        }
        .meta {
            background-color: white;
            padding: 15px;
            border-radius: 5px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin: 10px 0;
        }
        .request-response {
            background-color: #f8f8f8;
            padding: 10px;
            border-left: 3px solid #2d7be5;
            font-family: monospace;
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
            margin: 5px 0;
        }
        .source-tag {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: bold;
        }
        .source-active {
            background-color: #eaf6ff;
            color: #2d7be5;
        }
        .source-passive {
            background-color: #fbeee6;
            color: #c0392b;
        }
    </style>
</head>
<body>
    <h1>Browser-BucketScan检测历史导出</h1>
    <div class="meta">
        <p>导出时间: ${new Date().toLocaleString()}</p>
        <p>检测历史总数: ${data.length}</p>
    </div>
    <table>
        <thead>
            <tr>
                <th>序号</th>
                <th>URL</th>
                <th>漏洞类型</th>
                <th>云厂商</th>
                <th>检测时间</th>
                <th>来源</th>
                <th>请求</th>
                <th>响应</th>
            </tr>
        </thead>
        <tbody>
            ${data.map((item, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(item.url || '')}</td>
                <td>${escapeHtml(item.type || '')}</td>
                <td>${escapeHtml(item.vendor || '')}</td>
                <td>${formatTime(item.time) || ''}</td>
                <td>
                    <span class="source-tag ${item.source === '主动' ? 'source-active' : 'source-passive'}">
                        ${item.source || ''}
                    </span>
                </td>
                <td>
                    <div class="request-response">${escapeHtml(item.request || '')}</div>
                </td>
                <td>
                    <div class="request-response">${escapeHtml(item.response || '')}</div>
                </td>
            </tr>
            `).join('')}
        </tbody>
    </table>
</body>
</html>
    `;
    return html;
}

// 转MD
function convertToMD(data) {
    if (!data.length) return '';
    let md = `# Browser-BucketScan 检测历史导出\n\n`;
    md += `- 导出时间: ${new Date().toLocaleString()}\n`;
    md += `- 检测历史总数: ${data.length}\n\n`;
    md += `| 序号 | URL | 漏洞类型 | 云厂商 | 检测时间 | 来源 |\n`;
    md += `| --- | --- | --- | --- | --- | --- |\n`;
    data.forEach((item, index) => {
        const url = (item.url || '').replace(/\|/g, '\\|');
        const type = (item.type || '').replace(/\|/g, '\\|');
        const vendor = (item.vendor || '').replace(/\|/g, '\\|');
        const time = formatTime(item.time) || '';
        const source = (item.source || '').replace(/\|/g, '\\|');
        md += `| ${index + 1} | ${url} | ${type} | ${vendor} | ${time} | ${source} |\n`;
    });
    md += `\n---\n\n`;
    data.forEach((item, index) => {
        md += `### ${index + 1}. ${item.type || '未知'}\n\n`;
        md += `- **URL**: \`${(item.url || '').replace(/\|/g, '\\|')}\`\n`;
        md += `- **云厂商**: ${item.vendor || '未知'}\n`;
        md += `- **检测时间**: ${formatTime(item.time)}\n`;
        md += `- **来源**: ${item.source || '未知'}\n\n`;
        if (item.request) {
            md += `**请求数据包：**\n\`\`\`\n${item.request}\n\`\`\`\n\n`;
        }
        if (item.response) {
            md += `**响应数据包：**\n\`\`\`\n${item.response}\n\`\`\`\n\n`;
        }
        md += `---\n\n`;
    });
    return md;
}

// 下载文件
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 加载配置
function loadConfig() {
    chrome.storage.local.get(['flagEnable', 'flagAcl', 'flagPolicy', 'flagTraversable', 'flagUpload', 'flagDelete', 'flagTakeover', 'flagMultipart'], (result) => {
        document.getElementById('flag-enable').checked = result.flagEnable ?? true;
        document.getElementById('flag-acl').checked = result.flagAcl ?? true;
        document.getElementById('flag-policy').checked = result.flagPolicy ?? true;
        document.getElementById('flag-traversable').checked = result.flagTraversable ?? true;
        document.getElementById('flag-upload').checked = result.flagUpload ?? true;
        document.getElementById('flag-delete').checked = result.flagDelete ?? true;
        document.getElementById('flag-takeover').checked = result.flagTakeover ?? true;
        document.getElementById('flag-multipart').checked = result.flagMultipart ?? true;
    });
}

// 保存配置
function saveConfig() {
    const flagEnable = document.getElementById('flag-enable').checked;
    const flagAcl = document.getElementById('flag-acl').checked;
    const flagPolicy = document.getElementById('flag-policy').checked;
    const flagTraversable = document.getElementById('flag-traversable').checked;
    const flagUpload = document.getElementById('flag-upload').checked;
    const flagDelete = document.getElementById('flag-delete').checked;
    const flagTakeover = document.getElementById('flag-takeover').checked;
    const flagMultipart = document.getElementById('flag-multipart').checked;
    chrome.storage.local.set({ 
        flagEnable, 
        flagAcl, 
        flagPolicy, 
        flagTraversable, 
        flagUpload, 
        flagDelete, 
        flagTakeover, 
        flagMultipart 
    });
}

// 配置变更监听
document.addEventListener('DOMContentLoaded', () => {
    // 直接清除 badge，兼容所有场景
    if (chrome && chrome.action && chrome.action.setBadgeText) {
        chrome.action.setBadgeText({ text: '' });
    }
    loadHistory();
    loadConfig();
    
    // 配置变更监听
    document.getElementById('flag-enable').addEventListener('change', saveConfig);
    document.getElementById('flag-acl').addEventListener('change', saveConfig);
    document.getElementById('flag-policy').addEventListener('change', saveConfig);
    document.getElementById('flag-traversable').addEventListener('change', saveConfig);
    document.getElementById('flag-upload').addEventListener('change', saveConfig);
    document.getElementById('flag-delete').addEventListener('change', saveConfig);
    document.getElementById('flag-takeover').addEventListener('change', saveConfig);
    document.getElementById('flag-multipart').addEventListener('change', saveConfig);
    
    // 仍保留向 background 发送 clear-badge 消息，兼容 service worker
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'clear-badge' });
    }
}); 