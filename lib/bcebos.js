// lib/bcebos.js

const TYPE = {
    TRAVERSABLE: '存储桶可遍历',
    UPLOAD: 'PUT文件上传',
    DELETE: 'DELETE文件删除',
    BUCKET_ACL_READ: '桶ACL可读',
    OBJECT_ACL_READ: '对象ACL可读',
    BUCKET_ACL_WRITE: '桶ACL可写',
    OBJECT_ACL_WRITE: '对象ACL可写',
    FETCH_OBJECT: '抓取object存储成功',
    POLICY_WRITE: 'Policy可写',
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
 * 检测百度云 BOS 桶配置
 * @param {string} url
 * @param {Object} options { checkAcl: boolean, checkPolicy: boolean, checkTraversable: boolean, checkUpload: boolean, checkDelete: boolean, checkTakeover: boolean, checkMultipart: boolean }
 * @returns {Promise<Array>} 检测结果数组
 */
export async function checkBceBos(url, options = { checkAcl: true, checkPolicy: true, checkTraversable: true, checkUpload: true, checkDelete: true, checkTakeover: true, checkMultipart: true }) {
    const results = [];
    const { checkAcl, checkPolicy, checkTraversable, checkUpload, checkDelete, checkTakeover, checkMultipart } = options;
    const listUrl = removeAllParameters(url);
    
    // 确保所有检测在根目录进行
    let rootUrl;
    try {
        const u = new URL(listUrl);
        u.pathname = '/';
        rootUrl = u.toString();
    } catch (e) {
        // 如果URL解析失败，使用原始URL作为根目录
        rootUrl = listUrl;
    }

    // 1. 桶可遍历 - 在根目录进行检测
    if (checkTraversable) {
        let traversableFound = false;
        let traversableReqHeaders = {};
        let traversableReqBody = undefined;
        let traversableResp, traversableText, traversableRespHeaders;
        try {
            // 使用根目录URL进行列桶检测
            traversableResp = await fetch(rootUrl, { method: 'GET' });
            traversableText = await traversableResp.text();
            traversableRespHeaders = Object.fromEntries(traversableResp.headers.entries());
            if (
                traversableResp.status >= 200 && traversableResp.status < 300 &&
                traversableRespHeaders['x-bce-request-id']
            ) {
                try {
                    // 尝试解析JSON响应
                    const bucketData = JSON.parse(traversableText);
                    if (bucketData.name && Array.isArray(bucketData.contents)) {
                        traversableFound = true;
                    }
                } catch (e) {
                    // JSON解析失败，不认为是可遍历
                }
            }
        } catch (e) { }
        if (traversableFound) {
            results.push({
                type: TYPE.TRAVERSABLE,
                vendor: '百度云',
                url: rootUrl,
                found: traversableFound,
                request: buildBurpRequest('GET', rootUrl, traversableReqHeaders, traversableReqBody),
                response: traversableResp ? buildBurpResponse(traversableResp.status, traversableResp.statusText, traversableRespHeaders, traversableText) : '',
                detail: '存储桶可遍历'
            });
        }
    }

    // 2. 上传文件检测
    if (checkUpload) {
        let uploadFound = false;
        const fileName = 'testFileByExt.txt';
        let uploadUrl;
        try {
            const u = new URL(listUrl);
            u.pathname += u.pathname.endsWith('/') ? fileName : '/' + fileName;
            uploadUrl = u.toString();
        } catch (e) {
            // 处理URL解析失败的情况
            if (listUrl.endsWith('/')) {
                uploadUrl = listUrl + fileName;
            } else {
                uploadUrl = listUrl + '/' + fileName;
            }
        }
        let uploadReqHeaders = {};
        let uploadReqBody = 'test fileUpload';
        let uploadResp, uploadRespBody, uploadRespHeaders;
        let getResp, getRespBody, getRespHeaders;
        try {
            // 1. 执行PUT上传
            uploadResp = await fetch(uploadUrl, {
                method: 'PUT',
                body: uploadReqBody
            });
            uploadRespBody = await uploadResp.text();
            uploadRespHeaders = Object.fromEntries(uploadResp.headers.entries());
            
            // 2. 如果PUT成功，执行GET验证
            if (uploadResp.status >= 200 && uploadResp.status < 300 && uploadRespHeaders['x-bce-request-id']) {
                // 3. 发送GET请求验证上传内容
                getResp = await fetch(uploadUrl, { method: 'GET' });
                getRespBody = await getResp.text();
                getRespHeaders = Object.fromEntries(getResp.headers.entries());
                
                // 4. 验证GET响应状态和内容
                if (getResp.status >= 200 && getResp.status < 300 && getRespBody === uploadReqBody) {
                    uploadFound = true;
                }
            }
        } catch (e) { }
        if (uploadFound) {
            results.push({
                type: TYPE.UPLOAD,
                vendor: '百度云',
                url: uploadUrl,
                found: uploadFound,
                request: buildBurpRequest('PUT', uploadUrl, uploadReqHeaders, uploadReqBody),
                response: uploadResp ? buildBurpResponse(uploadResp.status, uploadResp.statusText, uploadRespHeaders, uploadRespBody) : '',
                detail: 'PUT文件上传成功'
            });
        }
    }
    
    // 3. DELETE文件删除检测
    if (checkDelete) {
        let deleteFound = false;
        // 使用根目录URL生成测试文件URL，确保上传到根目录
        let deleteTestUrl;
        try {
            const u = new URL(rootUrl);
            u.pathname += u.pathname.endsWith('/') ? 'deleteTestFile.txt' : '/deleteTestFile.txt';
            deleteTestUrl = u.toString();
        } catch (e) {
            // 处理URL解析失败的情况
            if (rootUrl.endsWith('/')) {
                deleteTestUrl = rootUrl + 'deleteTestFile.txt';
            } else {
                deleteTestUrl = rootUrl + '/deleteTestFile.txt';
            }
        }
        const deleteTestBody = 'test delete file';
        
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
            
            if (deleteResp.status >= 200 && deleteResp.status < 300 && deleteRespHeaders['x-bce-request-id']) {
                deleteFound = true;
                results.push({
                    type: TYPE.DELETE,
                    vendor: '百度云',
                    url: deleteTestUrl,
                    found: deleteFound,
                    request: buildBurpRequest('DELETE', deleteTestUrl, {}, undefined),
                    response: deleteResp ? buildBurpResponse(deleteResp.status, deleteResp.statusText, deleteRespHeaders, undefined) : '',
                    detail: 'DELETE文件删除成功'
                });
            }
        } catch (e) { }
    }

    // 4. ACL 检查
    if (checkAcl) {
        // 4.1 Bucket ACL 可读 - 在根目录进行检测
        let bucketAclReadFound = false;
        let bucketAclUrl;
        try {
            const u = new URL(rootUrl);
            u.search = '?acl';
            bucketAclUrl = u.toString();
        } catch (e) {
            bucketAclUrl = rootUrl + '?acl';
        }
        
        let bucketAclReadReqHeaders = {};
        let bucketAclReadReqBody = undefined;
        let bucketAclResp, bucketAclRespBody, bucketAclRespHeaders;
        try {
            bucketAclResp = await fetch(bucketAclUrl, { method: 'GET' });
            bucketAclRespBody = await bucketAclResp.text();
            bucketAclRespHeaders = Object.fromEntries(bucketAclResp.headers.entries());
            // 检查状态码和响应内容，添加百度云request-id检测
            if (bucketAclResp.status === 200 && bucketAclRespBody && bucketAclRespHeaders['x-bce-request-id']) {
                try {
                    const aclData = JSON.parse(bucketAclRespBody);
                    if (aclData.accessControlList || aclData.grants || aclData.acl) {
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
                vendor: '百度云',
                url: bucketAclUrl,
                found: bucketAclReadFound,
                request: buildBurpRequest('GET', bucketAclUrl, bucketAclReadReqHeaders, bucketAclReadReqBody),
                response: bucketAclResp ? buildBurpResponse(bucketAclResp.status, bucketAclResp.statusText, bucketAclRespHeaders, bucketAclRespBody) : '',
                detail: 'Bucket ACL可读'
            });
        }

        // 4.2 Object ACL 可读 - 直接在原始文件URL后加?acl进行检测
        let objectAclReadFound = false;
        let objectAclReadUrl;
        try {
            // 直接在原始URL后添加?acl参数
            const u = new URL(listUrl);
            u.search = '?acl';
            objectAclReadUrl = u.toString();
        } catch (e) {
            objectAclReadUrl = listUrl + '?acl';
        }
        
        let objectAclReadReqHeaders = {};
        let objectAclReadReqBody = undefined;
        let objectAclReadResp, objectAclReadRespBody, objectAclReadRespHeaders;
        try {
            objectAclReadResp = await fetch(objectAclReadUrl, { method: 'GET' });
            objectAclReadRespBody = await objectAclReadResp.text();
            objectAclReadRespHeaders = Object.fromEntries(objectAclReadResp.headers.entries());
            // 检查状态码、响应内容和百度云request-id
            if (objectAclReadResp.status === 200 && objectAclReadRespBody && objectAclReadRespHeaders['x-bce-request-id']) {
                try {
                    const aclData = JSON.parse(objectAclReadRespBody);
                    if (aclData.accessControlList || aclData.grants || aclData.acl) {
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
                vendor: '百度云',
                url: objectAclReadUrl,
                found: objectAclReadFound,
                request: buildBurpRequest('GET', objectAclReadUrl, objectAclReadReqHeaders, objectAclReadReqBody),
                response: objectAclReadResp ? buildBurpResponse(objectAclReadResp.status, objectAclReadResp.statusText, objectAclReadRespHeaders, objectAclReadRespBody) : '',
                detail: 'Object ACL可读'
            });
        }
        
        // 4.3 Bucket ACL 可写 - 在根目录进行检测
        let bucketAclWriteFound = false;
        const putAclHeaders = { 'Content-Type': 'application/json' };
        const putAclBody = JSON.stringify({
            "accessControlList": [
                {
                    "grantee": [{ "id": "*" }],
                    "permission": ["FULL_CONTROL"]
                }
            ]
        });
        let putAclResp, putAclRespBody, putAclRespHeaders;
        try {
            putAclResp = await fetch(bucketAclUrl, {
                method: 'PUT',
                headers: putAclHeaders,
                body: putAclBody
            });
            putAclRespBody = await putAclResp.text();
            putAclRespHeaders = Object.fromEntries(putAclResp.headers.entries());
            if (putAclResp.status >= 200 && putAclResp.status < 300 && putAclRespHeaders['x-bce-request-id'] && putAclRespBody.trim() === '') {
                bucketAclWriteFound = true;
            }
        } catch (e) { }
        if (bucketAclWriteFound) {
            results.push({
                type: TYPE.BUCKET_ACL_WRITE,
                vendor: '百度云',
                url: bucketAclUrl,
                found: bucketAclWriteFound,
                request: buildBurpRequest('PUT', bucketAclUrl, putAclHeaders, undefined),
                response: putAclResp ? buildBurpResponse(putAclResp.status, putAclResp.statusText, putAclRespHeaders, putAclRespBody) : '',
                detail: 'Bucket ACL可写'
            });
        }

        // 4.4 Object ACL 可写 - 直接在原始文件URL后加?acl进行检测
        let objectAclWriteFound = false;
        let objectAclUrl;
        try {
            // 直接在原始URL后添加?acl参数
            const u = new URL(listUrl);
            u.search = '?acl';
            objectAclUrl = u.toString();
        } catch (e) {
            objectAclUrl = listUrl + '?acl';
        }
        let objectPutAclResp, objectPutAclRespBody, objectPutAclRespHeaders;
        try {
            objectPutAclResp = await fetch(objectAclUrl, {
                method: 'PUT',
                headers: putAclHeaders,
                body: putAclBody
            });
            objectPutAclRespBody = await objectPutAclResp.text();
            objectPutAclRespHeaders = Object.fromEntries(objectPutAclResp.headers.entries());
            if (objectPutAclResp.status >= 200 && objectPutAclResp.status < 300 && objectPutAclRespHeaders['x-bce-request-id'] && objectPutAclRespBody.trim() === '') {
                objectAclWriteFound = true;
            }
        } catch (e) { }
        if (objectAclWriteFound) {
            results.push({
                type: TYPE.OBJECT_ACL_WRITE,
                vendor: '百度云',
                url: objectAclUrl,
                found: objectAclWriteFound,
                request: buildBurpRequest('PUT', objectAclUrl, putAclHeaders, undefined),
                response: objectPutAclResp ? buildBurpResponse(objectPutAclResp.status, objectPutAclResp.statusText, objectPutAclRespHeaders, objectPutAclRespBody) : '',
                detail: 'Object ACL可写'
            });
        }

        // 4.5 抓取object存储检测
        let fetchObjectFound = false;
        let fetchObjectUrl;
        try {
            // 构造抓取object URL
            const u = new URL(listUrl);
            u.pathname += u.pathname.endsWith('/') ? 'testFetchByExt.txt' : '/testFetchByExt.txt';
            u.search = '?fetch';
            fetchObjectUrl = u.toString();
        } catch (e) {
            // 处理URL解析失败的情况
            if (listUrl.endsWith('/')) {
                fetchObjectUrl = listUrl + 'testFetchByExt.txt?fetch';
            } else {
                fetchObjectUrl = listUrl + '/testFetchByExt.txt?fetch';
            }
        }
        const fetchHeaders = {
            'x-bce-fetch-source': 'https://www.baidu.com/robots.txt',
            'x-bce-fetch-mode': 'sync'
        };
        let fetchResp, fetchRespBody, fetchRespHeaders;
        try {
            fetchResp = await fetch(fetchObjectUrl, {
                method: 'POST',
                headers: fetchHeaders
            });
            fetchRespBody = await fetchResp.text();
            fetchRespHeaders = Object.fromEntries(fetchResp.headers.entries());
            // 添加x-bce-request-id响应头检查，确保只有真正的百度云BOS响应才会被检测到
            if (fetchResp.status >= 200 && fetchResp.status < 300 && fetchRespHeaders['x-bce-request-id']) {
                // 尝试解析JSON响应，检查是否成功
                try {
                    const fetchData = JSON.parse(fetchRespBody);
                    if (fetchData.code === 'success' && fetchData.message === 'success') {
                        fetchObjectFound = true;
                    }
                } catch (e) {
                    // JSON解析失败，但状态码成功且包含request-id，也视为检测通过
                    fetchObjectFound = true;
                }
            }
        } catch (e) { }
        if (fetchObjectFound) {
            results.push({
                type: TYPE.FETCH_OBJECT,
                vendor: '百度云',
                url: fetchObjectUrl,
                found: fetchObjectFound,
                request: buildBurpRequest('POST', fetchObjectUrl, fetchHeaders, undefined),
                response: fetchResp ? buildBurpResponse(fetchResp.status, fetchResp.statusText, fetchRespHeaders, fetchRespBody) : '',
                detail: '抓取object存储成功'
            });
        }
    }
    
    // 5. Policy 检查
    if (checkPolicy) {
        // 构建Policy URL，使用根目录URL
        let policyUrl;
        try {
            const u = new URL(rootUrl);
            u.search = '?policy';
            policyUrl = u.toString();
        } catch (e) {
            policyUrl = rootUrl + '/?policy';
        }
        
        let policyFound = false;
        const policyBody = JSON.stringify({
            Version: '2015-06-01',
            Statement: [{
                Effect: 'Allow',
                Principal: ['*'],
                Action: ['*'],
                Resource: ['*']
            }]
        });
        let policyReqHeaders = {};
        let policyResp, policyRespBody, policyRespHeaders;
        try {
            policyResp = await fetch(policyUrl, {
                method: 'PUT',
                body: policyBody
            });
            policyRespBody = await policyResp.text();
            policyRespHeaders = Object.fromEntries(policyResp.headers.entries());
            if (policyResp.status >= 200 && policyResp.status < 300 && policyRespHeaders['x-bce-request-id'] && policyRespBody.trim() === '') {
                policyFound = true;
            }
        } catch (e) { }
        if (policyFound) {
            results.push({
                type: TYPE.POLICY_WRITE,
                vendor: '百度云',
                url: policyUrl,
                found: policyFound,
                request: buildBurpRequest('PUT', policyUrl, policyReqHeaders, policyBody),
                response: policyResp ? buildBurpResponse(policyResp.status, policyResp.statusText, policyRespHeaders, policyRespBody) : '',
                detail: 'Policy可写'
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
            // 百度云桶不存在时通常返回404，响应体可能包含"BucketNotFound"或类似信息
            if (takeoverResp.status === 404 && (takeoverText.includes('BucketNotFound') || takeoverText.includes('bucket not found'))) {
                takeoverFound = true;
            }
        } catch (e) { }
        if (takeoverFound) {
            results.push({
                type: TYPE.BUCKET_TAKEOVER,
                vendor: '百度云',
                url: listUrl,
                found: takeoverFound,
                request: buildBurpRequest('GET', listUrl, {}, undefined),
                response: takeoverResp ? buildBurpResponse(takeoverResp.status, takeoverResp.statusText, takeoverRespHeaders, takeoverText) : '',
                detail: '存在桶接管风险'
            });
        }
    }
    
    // 7. 分段上传检测
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
                multipartRespHeaders['x-bce-request-id']
            ) {
                try {
                    // 尝试解析JSON响应
                    const multipartData = JSON.parse(multipartText);
                    if (multipartData.uploadIdMarker !== undefined) {
                        multipartUploadFound = true;
                    }
                } catch (e) {
                    // JSON解析失败，不认为是分段上传功能开启
                }
            }
        } catch (e) { }
        if (multipartUploadFound) {
            results.push({
                type: TYPE.MULTIPART_UPLOAD,
                vendor: '百度云',
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
