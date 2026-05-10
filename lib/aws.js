// lib/aws.js

const TYPE = {
    TRAVERSABLE: '存储桶可遍历',
    UPLOAD: 'PUT文件上传',
    DELETE: 'DELETE文件删除',
    ACL_READ: 'ACL可读',
    ACL_WRITE: 'ACL可写',
    BUCKET_ACL_READ: '桶ACL可读',
    BUCKET_ACL_WRITE: '桶ACL可写',
    OBJECT_ACL_READ: '对象ACL可读',
    OBJECT_ACL_WRITE: '对象ACL可写',
    COMPLETE_MULTIPART_UPLOAD: '可合并分块上传',
    ABORT_MULTIPART_UPLOAD: '可删除分块上传',
    BUCKET_TAKEOVER: '桶接管',
    MULTIPART_UPLOAD: '分段上传', // 新增分段上传检测类型
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
 * 检测 AWS S3 桶配置
 * @param {string} url
 * @param {Object} options { checkAcl: boolean, checkTraversable: boolean, checkUpload: boolean, checkDelete: boolean, checkMultipart: boolean, checkTakeover: boolean }
 * @returns {Promise<Array>} 检测结果数组
 */
export async function checkAWS(url, options = { checkAcl: true, checkTraversable: true, checkUpload: true, checkDelete: true, checkMultipart: true, checkTakeover: true }) {
    const results = [];
    const { checkAcl, checkTraversable, checkUpload, checkDelete, checkMultipart, checkTakeover } = options;
    const listUrl = removeAllParameters(url);
    
    // 1. 生成所有可能的目录层级，用于多级目录列桶检测
    const directoriesToCheck = generateDirectoryHierarchy(listUrl);
    
    // 2. 遍历目录层级，进行列桶检测，记录所有成功的目录
    let successfulTraverseUrls = [];
    let successfulTraverseResp = null;
    let successfulTraverseRespText = '';
    let successfulTraverseRespStatus = 0;
    let successfulTraverseRespStatusText = '';
    let successfulTraverseRespHeaders = {};
    
    if (checkTraversable) {
        for (const dirUrl of directoriesToCheck) {
            let traverseFound = false;
            let traverseUrl;
            let traverseResp, traverseRespText, traverseRespStatus, traverseRespStatusText, traverseRespHeaders;
            
            // 尝试多种列桶方式
            const listMethods = [
                '?list-type=2',  // ListObjectsV2
                ''  // 旧版ListObjects
            ];
            
            for (const listMethod of listMethods) {
                try {
                    const u = new URL(dirUrl);
                    u.search = listMethod;
                    traverseUrl = u.toString();
                } catch (e) {
                    traverseUrl = dirUrl + listMethod;
                }
                
                try {
                    traverseResp = await fetch(traverseUrl, { method: 'GET' });
                    traverseRespText = await traverseResp.text();
                    traverseRespStatus = traverseResp.status;
                    traverseRespStatusText = traverseResp.statusText;
                    traverseRespHeaders = Object.fromEntries(traverseResp.headers.entries());
                    
                    // 放宽列桶检测条件，只要返回200-299状态码且包含XML标签和AWS request-id，就认为列桶成功
                    if (
                        traverseResp.status >= 200 && traverseResp.status < 300 &&
                        (traverseRespText.includes('<ListBucketResult') || traverseRespText.includes('<Contents') || traverseRespText.includes('<Bucket>')) &&
                        traverseRespHeaders['x-amz-request-id']
                    ) {
                        traverseFound = true;
                        
                        // 记录所有成功的目录
                        successfulTraverseUrls.push(dirUrl);
                        
                        // 保存第一个成功的响应信息
                        if (!successfulTraverseResp) {
                            successfulTraverseResp = traverseResp;
                            successfulTraverseRespText = traverseRespText;
                            successfulTraverseRespStatus = traverseRespStatus;
                            successfulTraverseRespStatusText = traverseRespStatusText;
                            successfulTraverseRespHeaders = traverseRespHeaders;
                        }
                        
                        // 记录列桶结果
                        results.push({
                            type: TYPE.TRAVERSABLE,
                            vendor: 'AmazonS3',
                            url: dirUrl,
                            found: traverseFound,
                            request: buildBurpRequest('GET', traverseUrl, {}, undefined),
                            response: buildBurpResponse(traverseRespStatus, traverseRespStatusText, traverseRespHeaders, traverseRespText),
                            detail: '存储桶可遍历'
                        });
                        
                        break;
                    }
                } catch (e) { }
            }
        }
    }
    
    // 3. 选择最顶层的成功目录作为操作目录（优先选择根目录）
    let successfulTraverseUrl = null;
    if (successfulTraverseUrls.length > 0) {
        // 按目录层级排序，根目录优先
        successfulTraverseUrls.sort((a, b) => {
            // 根目录排在最前面
            if (a.endsWith('/') && b.endsWith('/')) {
                return a.split('/').length - b.split('/').length;
            }
            return a.length - b.length;
        });
        successfulTraverseUrl = successfulTraverseUrls[0];
    }
    
    // 如果列桶检测失败，仍尝试在根目录进行基本操作检测
    if (!successfulTraverseUrl) {
        successfulTraverseUrl = listUrl;
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
                        vendor: 'AmazonS3',
                        url: uploadUrl,
                        found: uploadFound,
                        request: buildBurpRequest('PUT', uploadUrl, {}, uploadBody),
                        response: uploadResp ? buildBurpResponse(uploadResp.status, uploadResp.statusText, uploadRespHeaders, uploadRespText) : '',
                        detail: 'PUT文件上传成功'
                    });
                }
            }
        } catch (e) { }
        
        // 3.2 DELETE object 删除检测（删除刚刚上传的文件）
        if (checkDelete) {
            let deleteFound = false;
            let deleteResp, deleteRespText, deleteRespStatus, deleteRespStatusText, deleteRespHeaders;
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
                        vendor: 'AmazonS3',
                        url: uploadUrl,
                        found: deleteFound,
                        request: buildBurpRequest('DELETE', uploadUrl, {}, undefined),
                        response: deleteResp ? buildBurpResponse(deleteResp.status, deleteResp.statusText, deleteRespHeaders, deleteRespText) : '',
                        detail: 'DELETE文件删除成功'
                    });
                }
            } catch (e) { }
        }
    }
    
    // 3.3 /?uploads 分段上传检测
    if (checkMultipart) {
        let multipartUploadFound = false;
        let multipartUrl;
        // 确定分段上传检测URL
        if (successfulTraverseUrl) {
            try {
                const u = new URL(successfulTraverseUrl);
                u.search = '?uploads';
                multipartUrl = u.toString();
            } catch (e) {
                multipartUrl = successfulTraverseUrl + '/?uploads';
            }
        } else {
            // 如果列桶检测失败，在根目录进行分段上传检测
            try {
                const u = new URL(listUrl);
                u.search = '?uploads';
                multipartUrl = u.toString();
            } catch (e) {
                multipartUrl = listUrl + '/?uploads';
            }
        }
        
        let multipartResp, multipartText, multipartRespStatus, multipartRespStatusText, multipartRespHeaders;
        try {
            multipartResp = await fetch(multipartUrl, { method: 'GET' });
            multipartText = await multipartResp.text();
            multipartRespStatus = multipartResp.status;
            multipartRespStatusText = multipartResp.statusText;
            multipartRespHeaders = Object.fromEntries(multipartResp.headers.entries());
            // 检查状态码和响应内容，减少误报
        if (multipartResp.status >= 200 && multipartResp.status < 300 && 
                multipartText.includes('ListMultipartUploadsResult') &&
                multipartRespHeaders['x-amz-request-id']) {
            multipartUploadFound = true;
            results.push({
                type: TYPE.MULTIPART_UPLOAD,
                vendor: 'AmazonS3',
                url: multipartUrl,
                found: multipartUploadFound,
                request: buildBurpRequest('GET', multipartUrl, {}, undefined),
                response: buildBurpResponse(multipartRespStatus, multipartRespStatusText, multipartRespHeaders, multipartText),
                detail: '分段上传功能开启'
            });
        }
        } catch (e) { }
    }
    
    // 4. ACL 检测
    if (checkAcl) {
        // 定义ACL检测函数
        async function checkAclType(aclUrl, isBucketAcl = true) {
            let aclReadFound = false;
            let aclWriteFound = false;
            
            // GET ACL 检测
            let aclResp, aclReadRespText, aclReadRespStatus, aclReadRespStatusText, aclReadRespHeaders;
            try {
                aclResp = await fetch(aclUrl, { method: 'GET' });
                aclReadRespText = await aclResp.text();
                aclReadRespStatus = aclResp.status;
                aclReadRespStatusText = aclResp.statusText;
                aclReadRespHeaders = Object.fromEntries(aclResp.headers.entries());
                // 同时匹配200状态码、Permission关键字和AWS request-id，才认为ACL可读
                if (aclResp.status === 200 && aclReadRespText.includes('Permission') && aclReadRespHeaders['x-amz-request-id']) {
                    aclReadFound = true;
                    results.push({
                        type: isBucketAcl ? TYPE.BUCKET_ACL_READ : TYPE.OBJECT_ACL_READ,
                        vendor: 'AmazonS3',
                        url: aclUrl,
                        found: aclReadFound,
                        request: buildBurpRequest('GET', aclUrl, {}, undefined),
                        response: buildBurpResponse(aclReadRespStatus, aclReadRespStatusText, aclReadRespHeaders, aclReadRespText),
                        detail: isBucketAcl ? '桶ACL可读' : '对象ACL可读'
                    });
                }
            } catch (e) { }
            
            // PUT ACL 可写检测
            let aclWriteReq = buildBurpRequest('PUT', aclUrl, { 'x-amz-acl': 'public-read-write' }, undefined);
            let putAclResp, aclWriteRespText, aclWriteRespStatus, aclWriteRespStatusText, aclWriteRespHeaders;
            try {
                const putAclHeaders = { 'x-amz-acl': 'public-read-write' };
                putAclResp = await fetch(aclUrl, {
                    method: 'PUT',
                    headers: putAclHeaders
                });
                aclWriteRespText = await putAclResp.text();
                aclWriteRespStatus = putAclResp.status;
                aclWriteRespStatusText = putAclResp.statusText;
                aclWriteRespHeaders = Object.fromEntries(putAclResp.headers.entries());
                // 同时匹配200状态码、空白响应体和AWS request-id，才认为ACL可写
                if (putAclResp.status === 200 && aclWriteRespText.trim() === '' && aclWriteRespHeaders['x-amz-request-id']) {
                    aclWriteFound = true;
                    results.push({
                        type: isBucketAcl ? TYPE.BUCKET_ACL_WRITE : TYPE.OBJECT_ACL_WRITE,
                        vendor: 'AmazonS3',
                        url: aclUrl,
                        found: aclWriteFound,
                        request: aclWriteReq,
                        response: buildBurpResponse(aclWriteRespStatus, aclWriteRespStatusText, aclWriteRespHeaders, aclWriteRespText),
                        detail: isBucketAcl ? '桶ACL可写' : '对象ACL可写'
                    });
                }
            } catch (e) { }
            
            return { aclReadFound, aclWriteFound };
        }
        
        // 4.1 桶ACL检测（在根目录或成功列桶的目录）
        let bucketAclUrl;
        if (successfulTraverseUrl) {
            // 如果有成功列桶的目录，在该目录检测桶ACL
            try {
                const u = new URL(successfulTraverseUrl);
                u.search = '?acl';
                bucketAclUrl = u.toString();
            } catch (e) {
                bucketAclUrl = successfulTraverseUrl + '?acl';
            }
        } else {
            // 否则在根目录检测桶ACL
            let rootUrl;
            try {
                const u = new URL(listUrl);
                u.pathname = '/';
                rootUrl = u.toString();
                u.search = '?acl';
                bucketAclUrl = u.toString();
            } catch (e) {
                rootUrl = listUrl;
                bucketAclUrl = rootUrl + '?acl';
            }
        }
        await checkAclType(bucketAclUrl, true);
        
        // 4.2 对象ACL检测（在原链接上检测）
        let objectAclUrl;
        try {
            const u = new URL(url);
            u.search = '?acl';
            objectAclUrl = u.toString();
        } catch (e) {
            objectAclUrl = url + '?acl';
        }
        await checkAclType(objectAclUrl, false);
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
            // 检查响应中是否包含NoSuchUpload且包含request-id，说明CompleteMultipartUpload权限开启
            if (completeMultipartRespBody.includes('NoSuchUpload') && completeMultipartRespHeaders['x-amz-request-id']) {
                completeMultipartUploadFound = true;
            }
        } catch (e) { }
        if (completeMultipartUploadFound) {
            results.push({
                type: TYPE.COMPLETE_MULTIPART_UPLOAD,
                vendor: 'AmazonS3',
                url: completeMultipartUrl,
                found: completeMultipartUploadFound,
                request: buildBurpRequest('POST', completeMultipartUrl, {}, ''),
                response: completeMultipartResp ? buildBurpResponse(completeMultipartResp.status, completeMultipartResp.statusText, completeMultipartRespHeaders, completeMultipartRespBody) : '',
                detail: '可合并分块上传'
            });
        }

        // 6. 可删除分块上传检测
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
                method: 'DELETE'
            });
            abortMultipartRespBody = await abortMultipartResp.text();
            abortMultipartRespHeaders = Object.fromEntries(abortMultipartResp.headers.entries());
            // 检查响应中是否包含NoSuchUpload且包含request-id，说明Abort Multipart Upload权限开启
            if (abortMultipartRespBody.includes('NoSuchUpload') && abortMultipartRespHeaders['x-amz-request-id']) {
                abortMultipartUploadFound = true;
            }
        } catch (e) { }
        if (abortMultipartUploadFound) {
            results.push({
                type: TYPE.ABORT_MULTIPART_UPLOAD,
                vendor: 'AmazonS3',
                url: abortMultipartUrl,
                found: abortMultipartUploadFound,
                request: buildBurpRequest('DELETE', abortMultipartUrl, {}, undefined),
                response: abortMultipartResp ? buildBurpResponse(abortMultipartResp.status, abortMultipartResp.statusText, abortMultipartRespHeaders, abortMultipartRespBody) : '',
                detail: '可删除分块上传'
            });
        }
    }

    // 7. 桶接管检测
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
                vendor: 'AmazonS3',
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