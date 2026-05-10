// lib/huawei.js

const TYPE = {
    TRAVERSABLE: '存储桶可遍历',
    UPLOAD: 'PUT文件上传',
    DELETE: 'DELETE文件删除', // 新增文件删除检测类型
    ACL_READ: 'ACL可读',
    ACL_WRITE: 'ACL可写',
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
 * 检测华为云 OBS 桶配置
 * @param {string} url
 * @param {Object} options { checkAcl: boolean, checkTraversable: boolean, checkUpload: boolean, checkDelete: boolean, checkMultipart: boolean }
 * @returns {Promise<Array>} 检测结果数组
 */
export async function checkHuawei(url, options = { checkAcl: true, checkTraversable: true, checkUpload: true, checkDelete: true, checkMultipart: true }) {
    const results = [];
    const { checkAcl, checkTraversable, checkUpload, checkDelete, checkMultipart } = options;
    const listUrl = removeAllParameters(url);
    
    // 确保ACL检测在根目录进行
    let rootUrl;
    try {
        const u = new URL(listUrl);
        u.pathname = '/';
        rootUrl = u.toString();
    } catch (e) {
        // 如果URL解析失败，使用原始URL作为根目录
        rootUrl = listUrl;
    }

    // 1. PUT文件上传
    if (checkUpload) {
        let uploadFound = false;
        let uploadUrl;
        try {
            const u = new URL(listUrl);
            u.pathname += u.pathname.endsWith('/') ? 'testFileByExt.txt' : '/testFileByExt.txt';
            uploadUrl = u.toString();
        } catch (e) {
            // 手动处理，避免双斜杠
            uploadUrl = listUrl.endsWith('/') ? listUrl + 'testFileByExt.txt' : listUrl + '/testFileByExt.txt';
        }
        const reqHeaders = {};
        const reqBody = 'test';
        let uploadResp, respBody, uploadRespHeaders;
        let getResp, getRespBody, getRespHeaders;
        try {
            // 1. 执行PUT上传
            uploadResp = await fetch(uploadUrl, {
                method: 'PUT',
                body: reqBody
            });
            respBody = await uploadResp.text();
            uploadRespHeaders = Object.fromEntries(uploadResp.headers.entries());
            
            // 2. 如果PUT成功，执行GET验证
            if (uploadResp.status >= 200 && uploadResp.status < 300 && uploadRespHeaders['x-obs-request-id']) {
                // 3. 发送GET请求验证上传内容
                getResp = await fetch(uploadUrl, { method: 'GET' });
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
                vendor: '华为云',
                url: uploadUrl,
                found: uploadFound,
                request: buildBurpRequest('PUT', uploadUrl, reqHeaders, reqBody),
                response: uploadResp ? buildBurpResponse(uploadResp.status, uploadResp.statusText, uploadRespHeaders, respBody) : '',
                detail: 'PUT文件上传成功'
            });
        }
    }
    
    // 1.1 DELETE文件删除检测
    if (checkDelete) {
        let deleteFound = false;
        // 先上传一个测试文件，然后尝试删除
        // 使用根目录URL生成测试文件URL，确保上传到根目录
        let deleteTestUrl;
        try {
            const u = new URL(rootUrl);
            u.pathname += 'deleteTestFile.txt';
            deleteTestUrl = u.toString();
        } catch (e) {
            deleteTestUrl = rootUrl + 'deleteTestFile.txt';
        }
        const deleteTestBody = 'test delete file';
        const deleteTestHeaders = {};
        
        // 上传测试文件
        let deleteTestUploadResp;
        try {
            deleteTestUploadResp = await fetch(deleteTestUrl, {
                method: 'PUT',
                body: deleteTestBody
            });
            // 无论上传是否成功，都尝试删除文件，因为有些桶可能允许删除但不允许上传
            const deleteResp = await fetch(deleteTestUrl, { method: 'DELETE' });
            const deleteRespHeaders = Object.fromEntries(deleteResp.headers.entries());
            
            if (deleteResp.status >= 200 && deleteResp.status < 300 && deleteRespHeaders['x-obs-request-id']) {
                deleteFound = true;
                results.push({
                    type: TYPE.DELETE,
                    vendor: '华为云',
                    url: deleteTestUrl,
                    found: deleteFound,
                    request: buildBurpRequest('DELETE', deleteTestUrl, deleteTestHeaders, undefined),
                    response: deleteResp ? buildBurpResponse(deleteResp.status, deleteResp.statusText, deleteRespHeaders, undefined) : '',
                    detail: 'DELETE文件删除成功'
                });
            }
        } catch (e) { }
    }

    // 2. 桶可遍历 - 在根目录进行检测
    if (checkTraversable) {
        let traverseFound = false;
        let getResp, getText, respHeaders;
        try {
            // 使用根目录URL进行列桶检测
            getResp = await fetch(rootUrl, { method: 'GET' });
            getText = await getResp.text();
            respHeaders = Object.fromEntries(getResp.headers.entries());
            if (
                getResp.status >= 200 && getResp.status < 300 &&
                getText.includes('<Name>') && getText.includes('<Contents>') &&
                respHeaders['x-obs-request-id']
            ) {
                traverseFound = true;
            }
        } catch (e) { }
        if (traverseFound) {
            results.push({
                type: TYPE.TRAVERSABLE,
                vendor: '华为云',
                url: rootUrl, // 使用根目录URL作为检测结果的URL
                found: traverseFound,
                request: buildBurpRequest('GET', rootUrl, {}, undefined),
                response: getResp ? buildBurpResponse(getResp.status, getResp.statusText, respHeaders, getText) : '',
                detail: '存储桶可遍历'
            });
        }
    }

    // 3. ACL可读/可写
    if (checkAcl) {
        // 构建ACL URL，避免双斜杠问题，使用根目录URL
        let aclUrl;
        try {
            const u = new URL(rootUrl);
            u.search = '?acl';
            aclUrl = u.toString();
        } catch (e) {
            // 手动处理，避免双斜杠
            if (rootUrl.endsWith('/')) {
                aclUrl = rootUrl + '?acl';
            } else {
                aclUrl = rootUrl + '/?acl';
            }
        }
        
        // ACL可读
        let aclReadFound = false;
        let aclResp, aclText, aclRespHeaders;
        try {
            aclResp = await fetch(aclUrl, { method: 'GET' });
            aclText = await aclResp.text();
            aclRespHeaders = Object.fromEntries(aclResp.headers.entries());
            if (
                aclResp.status >= 200 && aclResp.status < 300 &&
                aclText.includes('<Owner>') && aclText.includes('<AccessControlList>') &&
                aclRespHeaders['x-obs-request-id']
            ) {
                aclReadFound = true;
            }
        } catch (e) { }
        if (aclReadFound) {
            results.push({
                type: TYPE.ACL_READ,
                vendor: '华为云',
                url: aclUrl,
                found: aclReadFound,
                request: buildBurpRequest('GET', aclUrl, {}, undefined),
                response: aclResp ? buildBurpResponse(aclResp.status, aclResp.statusText, aclRespHeaders, aclText) : '',
                detail: 'ACL可读'
            });
        }
        // ACL可写
        let aclWriteFound = false;
        const putAclHeaders = { 'x-obs-acl': 'public-read-write-delivered' };
        let putAclResp, putAclRespBody, putAclRespHeaders;
        try {
            putAclResp = await fetch(aclUrl, {
                method: 'PUT',
                headers: putAclHeaders
            });
            putAclRespBody = await putAclResp.text();
            putAclRespHeaders = Object.fromEntries(putAclResp.headers.entries());
            if (putAclResp.status >= 200 && putAclResp.status < 300 && putAclRespHeaders['x-obs-request-id'] && putAclRespBody.trim() === '') {
                aclWriteFound = true;
            }
        } catch (e) { }
        if (aclWriteFound) {
            results.push({
                type: TYPE.ACL_WRITE,
                vendor: '华为云',
                url: aclUrl,
                found: aclWriteFound,
                request: buildBurpRequest('PUT', aclUrl, putAclHeaders, undefined),
                response: putAclResp ? buildBurpResponse(putAclResp.status, putAclResp.statusText, putAclRespHeaders, putAclRespBody) : '',
                detail: 'ACL可写'
            });
        }
    }

    // 4. 分段上传检测
    if (checkMultipart) {
        let multipartUploadFound = false;
        let multipartUrl;
        try {
            const u = new URL(rootUrl);
            u.search = '?uploads';
            multipartUrl = u.toString();
        } catch (e) {
            multipartUrl = rootUrl + '/?uploads';
        }
        
        let multipartResp, multipartText, multipartRespHeaders;
        try {
            multipartResp = await fetch(multipartUrl, { method: 'GET' });
            multipartText = await multipartResp.text();
            multipartRespHeaders = Object.fromEntries(multipartResp.headers.entries());
            if (
                multipartResp.status >= 200 && multipartResp.status < 300 &&
                (multipartText.includes('<ListMultipartUploadsResult') || multipartText.includes('<ListMultipartUploadsResult>')) &&
                multipartRespHeaders['x-obs-request-id']
            ) {
                multipartUploadFound = true;
            }
        } catch (e) { }
        if (multipartUploadFound) {
            results.push({
                type: TYPE.MULTIPART_UPLOAD,
                vendor: '华为云',
                url: multipartUrl,
                found: multipartUploadFound,
                request: buildBurpRequest('GET', multipartUrl, {}, undefined),
                response: multipartResp ? buildBurpResponse(multipartResp.status, multipartResp.statusText, multipartRespHeaders, multipartText) : '',
                detail: '分段上传功能开启'
            });
        }
    }

    return results;
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