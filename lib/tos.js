// lib/tos.js

const TYPE = {
    TRAVERSABLE: '存储桶可遍历',
    UPLOAD: 'PUT文件上传',
    DELETE: 'DELETE文件删除',
    BUCKET_ACL_READ: '桶ACL可读',
    OBJECT_ACL_READ: '对象ACL可读',
    BUCKET_ACL_WRITE: '桶ACL可写',
    OBJECT_ACL_WRITE: '对象ACL可写',
    MULTIPART_UPLOAD: '分段上传',
    ABORT_MULTIPART_UPLOAD: '可删除分块上传',
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
 * 检测火山云 TOS 桶配置
 * @param {string} url 目标存储桶资源 URL
 * @param {Object} options { checkAcl: boolean, checkTraversable: boolean, checkUpload: boolean, checkDelete: boolean, checkMultipart: boolean }
 * @returns {Promise<Array>} 检测结果数组
 */
export async function checkTos(url, options = { checkAcl: true, checkTraversable: true, checkUpload: true, checkDelete: true, checkMultipart: true }) {
    const results = [];
    const { checkAcl, checkTraversable, checkUpload, checkDelete, checkMultipart } = options;
    // 定义baseUrl变量，确保在整个函数中都能访问
    const baseUrl = removeAllParameters(url);
    
    // 生成待检测的URL列表：根目录、当前目录、二级目录
    const urlsToCheck = generateUrlsToCheck(url);
    
    // 1. ACL 检查
    if (checkAcl) {
        // 1.1 桶ACL检查 - 使用根目录
        const rootUrl = urlsToCheck[0];
        const bucketAclUrl = buildAclUrl(rootUrl);
        
        // 桶ACL可写
        let bucketAclWriteFound = false;
        const putAclHeaders = {
            'x-tos-acl': 'public-read-write',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.5414.75 Safari/537.36'
        };
        let putAclResp, putAclRespBody, putAclRespHeaders;
        try {
            putAclResp = await fetch(bucketAclUrl, {
                method: 'PUT',
                headers: putAclHeaders
            });
            putAclRespBody = await putAclResp.text();
            putAclRespHeaders = Object.fromEntries(putAclResp.headers.entries());
            if (putAclResp.status >= 200 && putAclResp.status < 300 && putAclRespHeaders['x-tos-request-id'] && putAclRespBody.trim() === '') {
                bucketAclWriteFound = true;
            }
        } catch (e) { }
        if (bucketAclWriteFound) {
            results.push({
                type: TYPE.BUCKET_ACL_WRITE,
                vendor: '火山云TOS',
                url: bucketAclUrl,
                found: bucketAclWriteFound,
                request: buildBurpRequest('PUT', bucketAclUrl, putAclHeaders, undefined),
                response: putAclResp ? buildBurpResponse(putAclResp.status, putAclResp.statusText, putAclRespHeaders, putAclRespBody) : '',
                detail: '桶ACL可写'
            });
        }
        
        // 桶ACL可读
        let bucketAclReadFound = false;
        const getAclHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.5414.75 Safari/537.36'
        };
        let getAclResp, getAclText, getAclRespHeaders;
        try {
            getAclResp = await fetch(bucketAclUrl, {
                method: 'GET',
                headers: getAclHeaders
            });
            getAclText = await getAclResp.text();
            getAclRespHeaders = Object.fromEntries(getAclResp.headers.entries());
            if (getAclResp.status === 200 && getAclRespHeaders['x-tos-request-id']) {
                try {
                    // 火山云返回JSON格式的ACL
                    const aclData = JSON.parse(getAclText);
                    if (aclData.Owner && Array.isArray(aclData.Grants)) {
                        bucketAclReadFound = true;
                    }
                } catch (e) {
                    // JSON解析失败，不认为是ACL可读
                }
            }
        } catch (e) { }
        if (bucketAclReadFound) {
            results.push({
                type: TYPE.BUCKET_ACL_READ,
                vendor: '火山云TOS',
                url: bucketAclUrl,
                found: bucketAclReadFound,
                request: buildBurpRequest('GET', bucketAclUrl, getAclHeaders, undefined),
                response: getAclResp ? buildBurpResponse(getAclResp.status, getAclResp.statusText, getAclRespHeaders, getAclText) : '',
                detail: '桶ACL可读'
            });
        }

        // 1.2 对象ACL检查 - 直接在原始URL后加?acl
        let objectAclUrl;
        try {
            const u = new URL(baseUrl);
            u.search = '?acl';
            objectAclUrl = u.toString();
        } catch (e) {
            objectAclUrl = baseUrl + '?acl';
        }
        
        // 对象ACL可读
        let objectAclReadFound = false;
        let objectAclReadResp, objectAclReadText, objectAclReadRespHeaders;
        try {
            objectAclReadResp = await fetch(objectAclUrl, {
                method: 'GET',
                headers: getAclHeaders
            });
            objectAclReadText = await objectAclReadResp.text();
            objectAclReadRespHeaders = Object.fromEntries(objectAclReadResp.headers.entries());
            if (objectAclReadResp.status === 200 && objectAclReadRespHeaders['x-tos-request-id']) {
                try {
                    // 火山云返回JSON格式的ACL
                    const aclData = JSON.parse(objectAclReadText);
                    if (aclData.Owner && Array.isArray(aclData.Grants)) {
                        objectAclReadFound = true;
                    }
                } catch (e) {
                    // JSON解析失败，不认为是ACL可读
                }
            }
        } catch (e) { }
        if (objectAclReadFound) {
            results.push({
                type: TYPE.OBJECT_ACL_READ,
                vendor: '火山云TOS',
                url: objectAclUrl,
                found: objectAclReadFound,
                request: buildBurpRequest('GET', objectAclUrl, getAclHeaders, undefined),
                response: objectAclReadResp ? buildBurpResponse(objectAclReadResp.status, objectAclReadResp.statusText, objectAclReadRespHeaders, objectAclReadText) : '',
                detail: '对象ACL可读'
            });
        }

        // 对象ACL可写
        let objectAclWriteFound = false;
        // 使用火山云对象ACL的正确规则 - public-read-write
        const objectPutAclHeaders = {
            'x-tos-acl': 'public-read-write',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.5414.75 Safari/537.36'
        };
        let objectAclWriteResp, objectAclWriteBody, objectAclWriteRespHeaders;
        try {
            objectAclWriteResp = await fetch(objectAclUrl, {
                method: 'PUT',
                headers: objectPutAclHeaders
            });
            objectAclWriteBody = await objectAclWriteResp.text();
            objectAclWriteRespHeaders = Object.fromEntries(objectAclWriteResp.headers.entries());
            if (objectAclWriteResp.status >= 200 && objectAclWriteResp.status < 300 && objectAclWriteRespHeaders['x-tos-request-id'] && objectAclWriteBody.trim() === '') {
                objectAclWriteFound = true;
            }
        } catch (e) { }
        if (objectAclWriteFound) {
            results.push({
                type: TYPE.OBJECT_ACL_WRITE,
                vendor: '火山云TOS',
                url: objectAclUrl,
                found: objectAclWriteFound,
                request: buildBurpRequest('PUT', objectAclUrl, objectPutAclHeaders, undefined),
                response: objectAclWriteResp ? buildBurpResponse(objectAclWriteResp.status, objectAclWriteResp.statusText, objectAclWriteRespHeaders, objectAclWriteBody) : '',
                detail: '对象ACL可写'
            });
        }
    }

    // 2. 桶可遍历检测 - 测试所有待检测URL
    if (checkTraversable) {
        const getHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.5414.75 Safari/537.36'
        };
        
        // 用于记录已检测到可遍历的URL，避免重复记录
        const traversableUrls = new Set();
        
        for (const checkUrl of urlsToCheck) {
            let traverseFound = false;
            let getResp, getText, respHeaders;
            try {
                getResp = await fetch(checkUrl, { method: 'GET', headers: getHeaders });
                getText = await getResp.text();
                respHeaders = Object.fromEntries(getResp.headers.entries());
                if (
                getResp.status >= 200 && getResp.status < 300 &&
                respHeaders['x-tos-request-id']
            ) {
                try {
                    // 火山云返回JSON格式，检查是否包含Contents字段
                    const bucketData = JSON.parse(getText);
                    if (bucketData.Name && Array.isArray(bucketData.Contents)) {
                        traverseFound = true;
                    }
                } catch (e) {
                    // JSON解析失败，不认为是可遍历
                }
            }
            } catch (e) { }
            if (traverseFound && !traversableUrls.has(checkUrl)) {
                traversableUrls.add(checkUrl);
                results.push({
                    type: TYPE.TRAVERSABLE,
                    vendor: '火山云TOS',
                    url: checkUrl,
                    found: traverseFound,
                    request: buildBurpRequest('GET', checkUrl, getHeaders, undefined),
                    response: getResp ? buildBurpResponse(getResp.status, getResp.statusText, respHeaders, getText) : '',
                    detail: '存储桶可遍历'
                });
            }
        }
    }

    // 3. PUT文件上传 - 使用根目录进行上传检测
    if (checkUpload) {
        const rootUrl = urlsToCheck[0];
        let uploadFound = false;
        const fileName = 'testFileByExt.txt';
        const uploadUrl = buildUploadUrl(rootUrl, fileName);
        const reqHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.5414.75 Safari/537.36'
        };
        const reqBody = 'test fileUpload';
        let uploadResp, respBody, uploadRespHeaders;
        let getResp, getRespBody, getRespHeaders;
        try {
            // 1. 执行PUT上传
            uploadResp = await fetch(uploadUrl, {
                method: 'PUT',
                headers: reqHeaders,
                body: reqBody
            });
            respBody = await uploadResp.text();
            uploadRespHeaders = Object.fromEntries(uploadResp.headers.entries());
            
            // 2. 如果PUT成功，执行GET验证
            if (uploadResp.status >= 200 && uploadResp.status < 300 && uploadRespHeaders['x-tos-request-id']) {
                // 3. 发送GET请求验证上传内容
                getResp = await fetch(uploadUrl, { method: 'GET', headers: reqHeaders });
                getRespBody = await getResp.text();
                getRespHeaders = Object.fromEntries(getResp.headers.entries());
                
                // 4. 验证GET响应状态和内容
                if (getResp.status >= 200 && getResp.status < 300 && getRespBody === reqBody) {
                    uploadFound = true;
                }
            }
        } catch (e) { }
        if (uploadFound) {
            results.push({
                type: TYPE.UPLOAD,
                vendor: '火山云TOS',
                url: uploadUrl,
                found: uploadFound,
                request: buildBurpRequest('PUT', uploadUrl, reqHeaders, reqBody),
                response: uploadResp ? buildBurpResponse(uploadResp.status, uploadResp.statusText, uploadRespHeaders, respBody) : '',
                detail: 'PUT文件上传成功'
            });
        }
    }
    
    // 3.1 DELETE文件删除检测
    if (checkDelete) {
        const rootUrl = urlsToCheck[0];
        let deleteFound = false;
        // 先上传一个测试文件，然后尝试删除
        const deleteTestUrl = buildUploadUrl(rootUrl, 'deleteTestFile.txt');
        const deleteTestBody = 'test delete file';
        const deleteTestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.5414.75 Safari/537.36'
        };
        
        // 上传测试文件
        let deleteTestUploadResp;
        try {
            deleteTestUploadResp = await fetch(deleteTestUrl, {
                method: 'PUT',
                headers: deleteTestHeaders,
                body: deleteTestBody
            });
            // 无论上传是否成功，都尝试删除文件，因为有些桶可能允许删除但不允许上传
            const deleteResp = await fetch(deleteTestUrl, {
                method: 'DELETE',
                headers: deleteTestHeaders
            });
            const deleteRespHeaders = Object.fromEntries(deleteResp.headers.entries());
            
            if (deleteResp.status >= 200 && deleteResp.status < 300 && deleteRespHeaders['x-tos-request-id']) {
                deleteFound = true;
                results.push({
                    type: TYPE.DELETE,
                    vendor: '火山云TOS',
                    url: deleteTestUrl,
                    found: deleteFound,
                    request: buildBurpRequest('DELETE', deleteTestUrl, deleteTestHeaders, undefined),
                    response: deleteResp ? buildBurpResponse(deleteResp.status, deleteResp.statusText, deleteRespHeaders, undefined) : '',
                    detail: 'DELETE文件删除成功'
                });
            }
        } catch (e) { }
    }

    // 4. 分段上传检测 - 使用根目录
    if (checkMultipart) {
        const rootUrl = urlsToCheck[0];
        const getHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.5414.75 Safari/537.36'
        };
        
        // 4.1 分段上传检测
        let multipartUploadFound = false;
        let multipartUrl;
        try {
            const u = new URL(rootUrl);
            u.search = '?uploads';
            multipartUrl = u.toString();
        } catch (e) {
            multipartUrl = rootUrl + '?uploads';
        }
        
        let multipartResp, multipartText, multipartRespHeaders;
        try {
            multipartResp = await fetch(multipartUrl, { method: 'GET', headers: getHeaders });
            multipartText = await multipartResp.text();
            multipartRespHeaders = Object.fromEntries(multipartResp.headers.entries());
            if (multipartResp.status >= 200 && multipartResp.status < 300 && multipartRespHeaders['x-tos-request-id']) {
                try {
                    // 火山云返回JSON格式，检查是否包含UploadIdMarker字段
                    const multipartData = JSON.parse(multipartText);
                    if (multipartData.Bucket && multipartData.UploadIdMarker !== undefined) {
                        multipartUploadFound = true;
                    }
                } catch (e) {
                    // JSON解析失败，但状态码成功且包含request-id，也视为分段上传功能开启
                    multipartUploadFound = true;
                }
            }
        } catch (e) { }
        if (multipartUploadFound) {
            results.push({
                type: TYPE.MULTIPART_UPLOAD,
                vendor: '火山云TOS',
                url: multipartUrl,
                found: multipartUploadFound,
                request: buildBurpRequest('GET', multipartUrl, getHeaders, undefined),
                response: multipartResp ? buildBurpResponse(multipartResp.status, multipartResp.statusText, multipartRespHeaders, multipartText) : '',
                detail: '分段上传功能开启'
            });
        }

        // 4.2 可删除分块上传检测
        let abortMultipartUploadFound = false;
        let abortMultipartUrl;
        try {
            const u = new URL(baseUrl);
            u.pathname += u.pathname.endsWith('/') ? '1.apk' : '/1.apk';
            u.search = '?uploadId=1';
            abortMultipartUrl = u.toString();
        } catch (e) {
            // 处理URL解析失败的情况
            if (baseUrl.endsWith('/')) {
                abortMultipartUrl = baseUrl + '1.apk?uploadId=1';
            } else {
                abortMultipartUrl = baseUrl + '/1.apk?uploadId=1';
            }
        }
        let abortMultipartResp, abortMultipartRespBody, abortMultipartRespHeaders;
        try {
            abortMultipartResp = await fetch(abortMultipartUrl, {
                method: 'DELETE',
                headers: getHeaders
            });
            abortMultipartRespBody = await abortMultipartResp.text();
            abortMultipartRespHeaders = Object.fromEntries(abortMultipartResp.headers.entries());
            // 检查响应中是否包含NoSuchUpload且包含request-id，说明Abort Multipart Upload权限开启
            if (abortMultipartRespBody.includes('NoSuchUpload') && abortMultipartRespHeaders['x-tos-request-id']) {
                abortMultipartUploadFound = true;
            }
        } catch (e) { }
        if (abortMultipartUploadFound) {
            results.push({
                type: TYPE.ABORT_MULTIPART_UPLOAD,
                vendor: '火山云TOS',
                url: abortMultipartUrl,
                found: abortMultipartUploadFound,
                request: buildBurpRequest('DELETE', abortMultipartUrl, getHeaders, undefined),
                response: abortMultipartResp ? buildBurpResponse(abortMultipartResp.status, abortMultipartResp.statusText, abortMultipartRespHeaders, abortMultipartRespBody) : '',
                detail: '可删除分块上传'
            });
        }
    }

    return results;
}

// 生成待检测的URL列表：根目录、当前目录、二级目录
function generateUrlsToCheck(url) {
    const urls = new Set();
    const baseUrl = removeAllParameters(url);
    
    try {
        const u = new URL(baseUrl);
        
        // 添加根目录
        u.pathname = '/';
        urls.add(u.toString());
        
        // 添加当前目录
        urls.add(baseUrl);
        
        // 添加二级目录检测（如果路径包含多级目录）
        const pathParts = u.pathname.split('/').filter(part => part);
        if (pathParts.length > 1) {
            // 只保留第一级子目录
            u.pathname = `/${pathParts[0]}/`;
            urls.add(u.toString());
        }
    } catch (e) {
        // 如果URL解析失败，至少添加原始URL
        urls.add(baseUrl);
    }
    
    return Array.from(urls);
}

// 构建ACL URL，避免双斜杠问题
function buildAclUrl(url) {
    try {
        const u = new URL(url);
        u.search = '?acl';
        return u.toString();
    } catch (e) {
        // 手动处理URL，避免双斜杠
        if (url.endsWith('/')) {
            return url + '?acl';
        } else {
            return url + '/?acl';
        }
    }
}

// 构建上传URL，避免双斜杠问题
function buildUploadUrl(baseUrl, fileName) {
    try {
        const u = new URL(baseUrl);
        // 确保路径以/结尾
        if (!u.pathname.endsWith('/')) {
            u.pathname += '/';
        }
        u.pathname += fileName;
        return u.toString();
    } catch (e) {
        // 手动处理URL，避免双斜杠
        if (baseUrl.endsWith('/')) {
            return baseUrl + fileName;
        } else {
            return baseUrl + '/' + fileName;
        }
    }
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
