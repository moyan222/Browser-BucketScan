// lib/aliyun.js

const TYPE = {
    TRAVERSABLE: '存储桶可遍历',
    UPLOAD: 'PUT文件上传',
    DELETE: 'DELETE文件删除', // 新增文件删除检测类型
    ACL_READ: 'ACL可读',
    ACL_WRITE: 'ACL可写',
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
 * 检测阿里云 OSS 桶配置
 * @param {string} url
 * @param {Object} options { checkAcl: boolean, checkPolicy: boolean, checkTraversable: boolean, checkUpload: boolean, checkDelete: boolean, checkTakeover: boolean, checkMultipart: boolean }
 * @returns {Promise<Array>} 检测结果数组
 */
export async function checkAliyun(url, options = { checkAcl: true, checkPolicy: true, checkTraversable: true, checkUpload: true, checkDelete: true, checkTakeover: true, checkMultipart: true }) {
    const results = [];
    const { checkAcl, checkPolicy, checkTraversable, checkUpload, checkDelete, checkTakeover, checkMultipart } = options;
    const listUrl = removeAllParameters(url);
    
    // 确保ACL和Policy检测在根目录进行
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
                traversableText.includes('<ListBucketResult>') && traversableText.includes('<Name>') &&
                traversableRespHeaders['x-oss-request-id']
            ) {
                traversableFound = true;
            }
        } catch (e) { }
        if (traversableFound) {
            results.push({
                type: TYPE.TRAVERSABLE,
                vendor: '阿里云',
                url: rootUrl, // 使用根目录URL作为检测结果的URL
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
            // 手动处理，避免双斜杠
            uploadUrl = listUrl.endsWith('/') ? listUrl + fileName : listUrl + '/' + fileName;
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
            if (uploadResp.status >= 200 && uploadResp.status < 300 && uploadRespHeaders['x-oss-request-id']) {
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
                vendor: '阿里云',
                url: uploadUrl,
                found: uploadFound,
                request: buildBurpRequest('PUT', uploadUrl, uploadReqHeaders, uploadReqBody),
                response: uploadResp ? buildBurpResponse(uploadResp.status, uploadResp.statusText, uploadRespHeaders, uploadRespBody) : '',
                detail: 'PUT文件上传成功'
            });
        }
    }
    
    // 2.1 DELETE文件删除检测
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
            
            if (deleteResp.status >= 200 && deleteResp.status < 300 && deleteRespHeaders['x-oss-request-id']) {
                deleteFound = true;
                results.push({
                    type: TYPE.DELETE,
                    vendor: '阿里云',
                    url: deleteTestUrl,
                    found: deleteFound,
                    request: buildBurpRequest('DELETE', deleteTestUrl, {}, undefined),
                    response: deleteResp ? buildBurpResponse(deleteResp.status, deleteResp.statusText, deleteRespHeaders, undefined) : '',
                    detail: 'DELETE文件删除成功'
                });
            }
        } catch (e) { }
    }

    // 3. ACL 检查
    if (checkAcl) {
        // 3.1 Bucket ACL 可读 - 在根目录进行检测
        let aclReadFound = false;
        let bucketAclUrl;
        try {
            const u = new URL(rootUrl);
            u.search = '?acl';
            bucketAclUrl = u.toString();
        } catch (e) {
            bucketAclUrl = rootUrl + '?acl';
        }
        
        let aclReadReqHeaders = {};
        let aclReadReqBody = undefined;
        let aclResp, aclRespBody, aclRespHeaders;
        try {
            aclResp = await fetch(bucketAclUrl, { method: 'GET' });
            aclRespBody = await aclResp.text();
            aclRespHeaders = Object.fromEntries(aclResp.headers.entries());
            // 同时匹配200状态码、AccessControlPolicy或Grant关键字和阿里云request-id，才认为ACL可读
            if (aclResp.status === 200 && (aclRespBody.includes('AccessControlPolicy') || aclRespBody.includes('Grant')) && aclRespHeaders['x-oss-request-id']) {
                aclReadFound = true;
            }
        } catch (e) { }
        if (aclReadFound) {
            results.push({
                type: TYPE.ACL_READ,
                vendor: '阿里云',
                url: bucketAclUrl,
                found: aclReadFound,
                request: buildBurpRequest('GET', bucketAclUrl, aclReadReqHeaders, aclReadReqBody),
                response: aclResp ? buildBurpResponse(aclResp.status, aclResp.statusText, aclRespHeaders, aclRespBody) : '',
                detail: 'Bucket ACL可读'
            });
        }
        
        // 3.2 Object ACL 可写 - 在原有对象URL上进行检测（X-Oss-Object-Acl用于单个对象）
        let aclWriteFound = false;
        // 使用原有URL（可能是具体对象）进行Object ACL检测
        const objectAclUrl = listUrl + '?acl';
        
        const putAclHeaders = { 'x-oss-object-acl': 'public-read-write' };
        let putAclResp, putAclRespBody, putAclRespHeaders;
        try {
            putAclResp = await fetch(objectAclUrl, {
                method: 'PUT',
                headers: putAclHeaders
            });
            putAclRespBody = await putAclResp.text();
            putAclRespHeaders = Object.fromEntries(putAclResp.headers.entries());
            if (putAclResp.status >= 200 && putAclResp.status < 300 && putAclRespHeaders['x-oss-request-id'] && putAclRespBody.trim() === '') {
                aclWriteFound = true;
            }
        } catch (e) { }
        if (aclWriteFound) {
            results.push({
                type: TYPE.ACL_WRITE,
                vendor: '阿里云',
                url: objectAclUrl,
                found: aclWriteFound,
                request: buildBurpRequest('PUT', objectAclUrl, putAclHeaders, undefined),
                response: putAclResp ? buildBurpResponse(putAclResp.status, putAclResp.statusText, putAclRespHeaders, putAclRespBody) : '',
                detail: 'Object ACL可写'
            });
        }
    }
    // 4. Policy 检查
    if (checkPolicy) {
        // 构建Policy URL，避免双斜杠问题，使用根目录URL
        let policyUrl;
        try {
            const u = new URL(rootUrl);
            u.search = '?policy';
            policyUrl = u.toString();
        } catch (e) {
            // 手动处理，避免双斜杠
            policyUrl = rootUrl + '/?policy';
        }
        
        let policyFound = false;
        const policyBody = JSON.stringify({
            Version: '1',
            Statement: [{
                Action: ['oss:*'], // 授予所有权限
                Effect: 'Allow',
                Principal: ['*'], // 允许所有用户访问
                Resource: [
                    'acs:oss:*:*:*', // 存储桶本身的权限
                    'acs:oss:*:*:*/*' // 存储桶内所有对象的权限
                ]
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
            if (policyResp.status >= 200 && policyResp.status < 300 && policyRespHeaders['x-oss-request-id'] && policyRespBody.trim() === '') {
                policyFound = true;
            }
        } catch (e) { }
        if (policyFound) {
            results.push({
                type: TYPE.POLICY_WRITE,
                vendor: '阿里云',
                url: policyUrl,
                found: policyFound,
                request: buildBurpRequest('PUT', policyUrl, policyReqHeaders, policyBody),
                response: policyResp ? buildBurpResponse(policyResp.status, policyResp.statusText, policyRespHeaders, policyRespBody) : '',
                detail: 'Policy可写'
            });
        }
    }
    //5.桶接管检测
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
                vendor: '阿里云',
                url: listUrl,
                found: takeoverFound,
                request: buildBurpRequest('GET', listUrl, {}, undefined),
                response: takeoverResp ? buildBurpResponse(takeoverResp.status, takeoverResp.statusText, takeoverRespHeaders, takeoverText) : '',
                detail: '存在桶接管风险'
            });
        }
    }
    
    // 6. 分段上传检测
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
                multipartText.includes('ListMultipartUploadsResult') &&
                multipartRespHeaders['x-oss-request-id']
            ) {
                multipartUploadFound = true;
            }
        } catch (e) { }
        if (multipartUploadFound) {
            results.push({
                type: TYPE.MULTIPART_UPLOAD,
                vendor: '阿里云',
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