const input = document.getElementById('blacklist-input');
const addBtn = document.getElementById('blacklist-add');
const listEl = document.getElementById('blacklist-list');
const exportBtn = document.getElementById('blacklist-export');
const importBtn = document.getElementById('blacklist-import-btn');
const importFile = document.getElementById('blacklist-import');

function normalizeEntry(str) {
    const s = String(str || '').trim();
    if (!s) return '';
    try {
        const u = new URL(s);
        return u.host.toLowerCase();
    } catch {
        return s.toLowerCase();
    }
}

function render(list) {
    listEl.innerHTML = '';
    (list || []).forEach((item, idx) => {
        const li = document.createElement('li');
        li.style = 'display:flex;align-items:center;justify-content:space-between;background:rgba(10, 25, 47, 0.9);margin:6px 0;padding:12px 16px;border-radius:8px;border:1px solid rgba(45, 123, 229, 0.4);color:#e0e6ed;box-shadow:0 2px 8px rgba(0, 0, 0, 0.2);';
        li.innerHTML = `<span>${item}</span><button data-idx="${idx}" class="del-btn" style="padding:6px 14px;background:rgba(239, 68, 68, 0.15);border-color:rgba(239, 68, 68, 0.4);font-size:13px;margin-left:12px;flex-shrink:0;color:#fca5a5;">删除</button>`;
        listEl.appendChild(li);
    });
}

function load() {
    chrome.storage.local.get(['detectBlacklist'], (res) => {
        render(res.detectBlacklist || []);
    });
}

function save(list) {
    chrome.storage.local.set({ detectBlacklist: list }, () => {});
}

addBtn.addEventListener('click', () => {
    const v = normalizeEntry(input.value);
    if (!v) return;
    chrome.storage.local.get(['detectBlacklist'], (res) => {
        const cur = (res.detectBlacklist || []).slice();
        if (cur.includes(v)) {
            alert('该域名已存在于黑名单中');
            return;
        }
        cur.push(v);
        save(cur);
        render(cur);
        input.value = '';
    });
});

listEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('del-btn')) {
        const idx = Number(e.target.getAttribute('data-idx'));
        chrome.storage.local.get(['detectBlacklist'], (res) => {
            const cur = (res.detectBlacklist || []).slice();
            if (idx >= 0 && idx < cur.length) cur.splice(idx, 1);
            save(cur);
            render(cur);
        });
    }
});

// 导出黑名单到文件
exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(['detectBlacklist'], (res) => {
        const list = res.detectBlacklist || [];
        if (list.length === 0) {
            alert('黑名单为空，无需导出');
            return;
        }
        
        // 创建文本内容，每行一个条目
        const content = list.join('\n');
        
        // 创建Blob对象
        const blob = new Blob([content], { type: 'text/plain' });
        
        // 创建下载链接
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'bucketscan-blacklist.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // 释放URL对象
        URL.revokeObjectURL(a.href);
    });
});

// 点击导入按钮，触发文件选择
importBtn.addEventListener('click', () => {
    importFile.click();
});

// 处理文件导入
importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        const content = event.target.result;
        // 按行分割，过滤空行，去重，归一化
        const newEntries = content.split(/[\r\n]+/)
            .map(normalizeEntry)
            .filter((entry) => entry !== '')
            .filter((entry, index, self) => self.indexOf(entry) === index);
        
        if (newEntries.length === 0) {
            alert('文件中没有有效的黑名单条目');
            return;
        }
        
        // 合并现有黑名单和导入的黑名单，去重
        chrome.storage.local.get(['detectBlacklist'], (res) => {
            const existingList = res.detectBlacklist || [];
            const mergedList = [...new Set([...existingList, ...newEntries])];
            save(mergedList);
            render(mergedList);
            alert(`成功导入 ${newEntries.length} 个黑名单条目，当前总数：${mergedList.length}`);
        });
    };
    reader.readAsText(file);
    
    // 重置文件输入，允许重复选择同一文件
    e.target.value = '';
});

document.addEventListener('DOMContentLoaded', load);
