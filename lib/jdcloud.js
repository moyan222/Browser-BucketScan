// lib/jdcloud.js

const TYPE = {
    TRAVERSABLE: '存储桶可遍历',
    UPLOAD: 'PUT文件上传',
    DELETE: 'DELETE文件删除',
    ACL_READ: 'ACL可读',
    ACL_WRITE: 'ACL可写',
    COMPLETE_MULTIPART_UPLOAD: '可合并分块上传',
    BUCKET_TAKEOVER: '桶接管',
    MULTIPART_UPLOAD: '分段上传',
};

function buildBurpRequest(method, url, headers, body) {
    const u = new URL(url);
    let req = `${method} ${u.pathname}${u.search} HTTP/1.1\r\n`;
    req += `Host: ${u.host}\r\n`;
    for (const [k, v] of Object.entries(headers || {})) {
        if (k.toLowerCase() !== 'host') req += `${k}: ${v}\r\n`;
    }
    req += '\r\n';
    if (body) req += body;
    return req;
}

function buildBurpResponse(status, statusText, headers, body) {
    let resp = `HTTP/1.1 ${status} ${statusText}\r\n`;
    for (const [k, v] of Object.entries(headers || {})) {
        resp += `${k}: ${v}\r\n`;
    }
    resp += '\r\n';
    if (body) resp += body;
    return resp;
}

/**
 * 检测京东云存储桶配置
 * @param {string} url
 * @param {Object} options { checkAcl: boolean, checkTraversable: boolean, checkUpload: boolean, checkDelete: boolean, checkMultipart: boolean, checkTakeover: boolean }
 * @returns {Promise<Array>} 检测结果数组
 */
export async function checkJdcloud(url, options = { checkAcl: true, checkTraversable: true, checkUpload: true, checkDelete: true, checkMultipart: true, checkTakeover: true }) {
    const results = [];
    const { checkAcl, checkTraversable, checkUpload, checkDelete, checkMultipart, checkTakeover } = options;
    const listUrl = removeAllParameters(url);
    
    // 1. 生成所有可能的目录层级，用于多级目录列桶检测
    const directoriesToCheck = generateDirectoryHierarchy(listUrl);
    
    // 2. 遍历目录层级，进行列桶检测，只在根目录进行
    let successfulTraverseUrl = null;
    let successfulTraverseResp = null;
    let successfulTraverseRespText = '';
    let successfulTraverseRespStatus = 0;
    let successfulTraverseRespStatusText = '';
    let successfulTraverseRespHeaders = {};
    
    if (checkTraversable) {
        // 只在根目录进行列桶检测
        let rootUrl;
        try {
            const u = new URL(listUrl);
            u.pathname = '/';
            u.search = '';
            rootUrl = u.toString();
        } catch (e) {
            rootUrl = listUrl;
        }
        
        let traverseFound = false;
        let traverseUrl;
        try {
            const u = new URL(rootUrl);
            u.search = '?list-type=2';
            traverseUrl = u.toString();
        } catch (e) {
            traverseUrl = rootUrl + '?list-type=2';
        }
        
        let traverseResp, traverseRespText, traverseRespStatus, traverseRespStatusText, traverseRespHeaders;
        try {
            traverseResp = await fetch(traverseUrl, { method: 'GET' });
            traverseRespText = await traverseResp.text();
            traverseRespStatus = traverseResp.status;
            traverseRespStatusText = traverseResp.statusText;
            traverseRespHeaders = Object.fromEntries(traverseResp.headers.entries());
            if (
                traverseResp.status >= 200 && traverseResp.status < 300 &&
                traverseRespHeaders['x-amz-request-id'] &&
                traverseRespText.includes('StorageClass')
            ) {
                // 列桶检测条件：状态码 + 响应头 + StorageClass关键字
                traverseFound = true;
                successfulTraverseUrl = rootUrl;
                successfulTraverseResp = traverseResp;
                successfulTraverseRespText = traverseRespText;
                successfulTraverseRespStatus = traverseRespStatus;
                successfulTraverseRespStatusText = traverseRespStatusText;
                successfulTraverseRespHeaders = traverseRespHeaders;
                
                // 记录列桶结果
                results.push({
                    type: TYPE.TRAVERSABLE,
                    vendor: '京东云',
                    url: rootUrl,
                    found: traverseFound,
                    request: buildBurpRequest('GET', traverseUrl, {}, undefined),
                    response: buildBurpResponse(traverseRespStatus, traverseRespStatusText, traverseRespHeaders, traverseRespText),
                    detail: '存储桶可遍历'
                });
            }
        } catch (e) { }
    }
    
    // 3.1 PUT object 上传检测
    if (checkUpload) {
        let uploadFound = false;
        let uploadUrl;
        try {
            const u = new URL(url);
            // 处理根目录情况，避免双斜杠
            if (u.pathname.endsWith('/')) {
                u.pathname += 'testFileByExt.txt';
            } else {
                u.pathname += '/testFileByExt.txt';
            }
            uploadUrl = u.toString();
        } catch (e) {
            // 处理URL解析失败的情况，避免双斜杠
            if (url.endsWith('/')) {
                uploadUrl = url + 'testFileByExt.txt';
            } else {
                uploadUrl = url + '/testFileByExt.txt';
            }
        }
        
        const uploadBody = 'test fileUpload';
        let uploadResp, uploadRespText, uploadRespStatus, uploadRespStatusText, uploadRespHeaders;
        let getResp, getRespText, getRespStatus, getRespStatusText, getRespHeaders;
        try {
            // 1. 执行PUT上传
            uploadResp = await fetch(uploadUrl, {
                method: 'PUT',
                body: uploadBody
            });
            uploadRespText = await uploadResp.text();
            uploadRespStatus = uploadResp.status;
            uploadRespStatusText = uploadResp.statusText;
            uploadRespHeaders = Object.fromEntries(uploadResp.headers.entries());
            
            // 2. 如果PUT成功，执行GET验证
            if (uploadResp.status >= 200 && uploadResp.status < 300 && uploadRespHeaders['x-amz-request-id']) {
                // 3. 发送GET请求验证上传内容
                getResp = await fetch(uploadUrl, { method: 'GET' });
                getRespText = await getResp.text();
                getRespStatus = getResp.status;
                getRespStatusText = getResp.statusText;
                getRespHeaders = Object.fromEntries(getResp.headers.entries());
                
                // 4. 验证GET响应状态和内容
                if (getResp.status >= 200 && getResp.status < 300 && getRespText === uploadBody) {
                    uploadFound = true;
                    results.push({
                        type: TYPE.UPLOAD,
                        vendor: '京东云',
                        url: uploadUrl,
                        found: uploadFound,
                        request: buildBurpRequest('PUT', uploadUrl, {}, uploadBody),
                        response: buildBurpResponse(uploadRespStatus, uploadRespStatusText, uploadRespHeaders, uploadRespText),
                        detail: 'PUT文件上传成功'
                    });
                }
            }
        } catch (e) { }
    }
    
    // 3.2 DELETE object 删除检测（删除刚刚上传的文件）
    if (checkDelete) {
        let deleteFound = false;
        let deleteResp, deleteRespText, deleteRespStatus, deleteRespStatusText, deleteRespHeaders;
        let uploadUrl;
        // 重新构建uploadUrl，确保DELETE检测能独立执行
        try {
            const u = new URL(url);
            // 处理根目录情况，避免双斜杠
            if (u.pathname.endsWith('/')) {
                u.pathname += 'testFileByExt.txt';
            } else {
                u.pathname += '/testFileByExt.txt';
            }
            uploadUrl = u.toString();
        } catch (e) {
            // 处理URL解析失败的情况，避免双斜杠
            if (url.endsWith('/')) {
                uploadUrl = url + 'testFileByExt.txt';
            } else {
                uploadUrl = url + '/testFileByExt.txt';
            }
        }
        try {
            deleteResp = await fetch(uploadUrl, { method: 'DELETE' });
            deleteRespText = await deleteResp.text();
            deleteRespStatus = deleteResp.status;
            deleteRespStatusText = deleteResp.statusText;
            deleteRespHeaders = Object.fromEntries(deleteResp.headers.entries());
            // 增强成功判断条件：200-299状态码 + 响应头包含x-amz-request-id
            if (deleteResp.status >= 200 && deleteResp.status < 300 && deleteRespHeaders['x-amz-request-id']) {
                deleteFound = true;
                results.push({
                    type: TYPE.DELETE,
                    vendor: '京东云',
                    url: uploadUrl,
                    found: deleteFound,
                    request: buildBurpRequest('DELETE', uploadUrl, {}, undefined),
                    response: buildBurpResponse(deleteRespStatus, deleteRespStatusText, deleteRespHeaders, deleteRespText),
                    detail: 'DELETE文件删除成功'
                });
            }
        } catch (e) { }
    }
    
    // 3.3 /?uploads 分段上传检测 - 只在根目录进行
    if (checkMultipart) {
        let multipartUploadFound = false;
        let multipartUrl;
        // 只在根目录进行分段上传检测
        let rootUrl;
        try {
            const u = new URL(listUrl);
            u.pathname = '/';
            u.search = '?uploads';
            multipartUrl = u.toString();
        } catch (e) {
            // 处理URL解析失败情况，直接在listUrl后添加参数
            rootUrl = listUrl;
            multipartUrl = rootUrl + (rootUrl.endsWith('/') ? '?uploads' : '/?uploads');
        }
        
        let multipartResp, multipartText, multipartRespStatus, multipartRespStatusText, multipartRespHeaders;
        try {
            multipartResp = await fetch(multipartUrl, { method: 'GET' });
            multipartText = await multipartResp.text();
            multipartRespStatus = multipartResp.status;
            multipartRespStatusText = multipartResp.statusText;
            multipartRespHeaders = Object.fromEntries(multipartResp.headers.entries());
            // 检查状态码、响应头和关键字，减少误报
            if (multipartResp.status >= 200 && multipartResp.status < 300 && 
                    multipartRespHeaders['x-amz-request-id'] &&
                    multipartText.includes('ListMultipartUploadsResult')) {
                multipartUploadFound = true;
                results.push({
                    type: TYPE.MULTIPART_UPLOAD,
                    vendor: '京东云',
                    url: multipartUrl,
                    found: multipartUploadFound,
                    request: buildBurpRequest('GET', multipartUrl, {}, undefined),
                    response: buildBurpResponse(multipartRespStatus, multipartRespStatusText, multipartRespHeaders, multipartText),
                    detail: '分段上传功能开启'
                });
            }
        } catch (e) { }
    }
    
    // 4. ACL 检测（独立进行，不依赖列桶结果）
    if (checkAcl) {
        let aclReadFound = false;
        let aclUrl;
        
        // 确定ACL检测URL - 直接使用baseUrl，不依赖列桶结果
        try {
            const u = new URL(listUrl);
            u.search = '?acl';
            aclUrl = u.toString();
        } catch (e) {
            aclUrl = listUrl + (listUrl.endsWith('/') ? '?acl' : '/?acl');
        }
        
        let aclResp, aclReadRespText, aclReadRespStatus, aclReadRespStatusText, aclReadRespHeaders;
        try {
            aclResp = await fetch(aclUrl, { method: 'GET' });
            aclReadRespText = await aclResp.text();
            aclReadRespStatus = aclResp.status;
            aclReadRespStatusText = aclResp.statusText;
            aclReadRespHeaders = Object.fromEntries(aclResp.headers.entries());
            // 简化ACL可读检测条件，只检查状态码和响应头
            if (aclResp.status === 200 && aclReadRespHeaders['x-amz-request-id']) {
                aclReadFound = true;
                results.push({
                    type: TYPE.ACL_READ,
                    vendor: '京东云',
                    url: aclUrl,
                    found: aclReadFound,
                    request: buildBurpRequest('GET', aclUrl, {}, undefined),
                    response: buildBurpResponse(aclReadRespStatus, aclReadRespStatusText, aclReadRespHeaders, aclReadRespText),
                    detail: 'ACL可读'
                });
            }
        } catch (e) { }
        
        // ACL 可写检测
        let aclWriteFound = false;
        let aclWriteReq = buildBurpRequest('PUT', aclUrl, { 'x-amz-acl': 'public-read-write' }, undefined);
        let putAclResp, aclWriteRespText, aclWriteRespStatus, aclWriteRespStatusText, aclWriteRespHeaders;
        try {
            const putAclHeaders = { 'x-amz-acl': 'public-read-write' };
            putAclResp = await fetch(aclUrl, { method: 'PUT', headers: putAclHeaders });
            aclWriteRespText = await putAclResp.text();
            aclWriteRespStatus = putAclResp.status;
            aclWriteRespStatusText = putAclResp.statusText;
            aclWriteRespHeaders = Object.fromEntries(putAclResp.headers.entries());
            // 简化ACL可写检测条件，检查状态码、响应头和响应体空白
            if (putAclResp.status === 200 && aclWriteRespHeaders['x-amz-request-id'] && aclWriteRespText.trim() === '') {
                aclWriteFound = true;
                results.push({
                    type: TYPE.ACL_WRITE,
                    vendor: '京东云',
                    url: aclUrl,
                    found: aclWriteFound,
                    request: aclWriteReq,
                    response: buildBurpResponse(aclWriteRespStatus, aclWriteRespStatusText, aclWriteRespHeaders, aclWriteRespText),
                    detail: 'ACL可写'
                });
            }
        } catch (e) { }
    }

    // 5. 可合并分块上传检测
    if (checkMultipart) {
        let completeMultipartUploadFound = false;
        const baseUrl = removeAllParameters(url);
        let completeMultipartUrl;
        try {
            const u = new URL(baseUrl);
            u.pathname += u.pathname.endsWith('/') ? '1.apk' : '/1.apk';
            u.search = '?uploadId=1';
            completeMultipartUrl = u.toString();
        } catch (e) {
            // 处理URL解析失败的情况
            if (baseUrl.endsWith('/')) {
                completeMultipartUrl = baseUrl + '1.apk?uploadId=1';
            } else {
                completeMultipartUrl = baseUrl + '/1.apk?uploadId=1';
            }
        }
        let completeMultipartResp, completeMultipartRespBody, completeMultipartRespHeaders;
        try {
            completeMultipartResp = await fetch(completeMultipartUrl, {
                method: 'POST',
                body: ''
            });
            completeMultipartRespBody = await completeMultipartResp.text();
            completeMultipartRespHeaders = Object.fromEntries(completeMultipartResp.headers.entries());
            // 检查响应中是否包含NoSuchUpload，说明CompleteMultipartUpload权限开启
            // 新增：添加x-amz-request-id响应头检测
            if (completeMultipartRespBody.includes('NoSuchUpload') && completeMultipartRespHeaders['x-amz-request-id']) {
                completeMultipartUploadFound = true;
            }
        } catch (e) { }
        if (completeMultipartUploadFound) {
            results.push({
                type: TYPE.COMPLETE_MULTIPART_UPLOAD,
                vendor: '京东云',
                url: completeMultipartUrl,
                found: completeMultipartUploadFound,
                request: buildBurpRequest('POST', completeMultipartUrl, {}, ''),
                response: completeMultipartResp ? buildBurpResponse(completeMultipartResp.status, completeMultipartResp.statusText, completeMultipartRespHeaders, completeMultipartRespBody) : '',
                detail: '可合并分块上传'
            });
        }
    }

    // 6. 桶接管检测
    if (checkTakeover) {
        let takeoverFound = false;
        let takeoverResp, takeoverText, takeoverRespHeaders;
        try {
            takeoverResp = await fetch(listUrl, { method: 'GET' });
            takeoverText = await takeoverResp.text();
            takeoverRespHeaders = Object.fromEntries(takeoverResp.headers.entries());
            if (takeoverText && takeoverText.includes('<Code>NoSuchBucket</Code>')) {
                takeoverFound = true;
            }
        } catch (e) { }
        if (takeoverFound) {
            results.push({
                type: TYPE.BUCKET_TAKEOVER,
                vendor: '京东云',
                url: listUrl,
                found: takeoverFound,
                request: buildBurpRequest('GET', listUrl, {}, undefined),
                response: takeoverResp ? buildBurpResponse(takeoverResp.status, takeoverResp.statusText, takeoverRespHeaders, takeoverText) : '',
                detail: '存在桶接管风险'
            });
        }
    }

    return results;
}

// 生成目录层级，用于多级目录列桶检测
function generateDirectoryHierarchy(url) {
    const directories = new Set();
    
    try {
        const u = new URL(url);
        const pathname = u.pathname;
        
        // 确保路径以/结尾
        const normalizedPath = pathname.endsWith('/') ? pathname : pathname + '/';
        
        // 添加原始URL
        u.search = '';
        directories.add(u.toString());
        
        // 生成所有父目录
        const pathParts = normalizedPath.split('/').filter(part => part);
        
        // 从最长路径到最短路径生成所有父目录
        for (let i = pathParts.length; i > 0; i--) {
            const parentPath = '/' + pathParts.slice(0, i).join('/') + '/';
            const parentUrl = new URL(u);
            parentUrl.pathname = parentPath;
            directories.add(parentUrl.toString());
        }
        
        // 添加根目录
        const rootUrl = new URL(u);
        rootUrl.pathname = '/';
        directories.add(rootUrl.toString());
        
    } catch (e) {
        // 如果URL解析失败，至少添加原始URL
        directories.add(url);
    }
    
    return Array.from(directories);
}

// 工具函数：去除所有参数
function removeAllParameters(url) {
    try {
        const u = new URL(url);
        u.search = '';
        return u.toString();
    } catch {
        return url;
    }
}