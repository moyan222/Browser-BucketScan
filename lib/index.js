// lib/index.js
// 存储桶检测主入口，自动判断厂商并分发到对应检测逻辑
import { checkAliyun } from './aliyun.js';
import { checkTencent } from './tencent.js';
import { checkHuawei } from './huawei.js';
import { checkAWS } from './aws.js';
import { checkJdcloud } from './jdcloud.js';
import { checkBceBos } from './bcebos.js';
import { checkTos } from './tos.js';

/**
 * 检测入口
 * @param {string} url 目标存储桶资源 URL
 * @param {object} options
 * @returns {Promise<Array>}  // 统一返回数组
 */
export async function detectBucketVul(url, options) {
    // 主动检测：有 options.vendors 且长度>0，按用户选择
    if (options && Array.isArray(options.vendors) && options.vendors.length > 0) {
        let results = [];
        for (const v of options.vendors) {
            if (v === 'aliyun') {
                results = results.concat(await checkAliyun(url, options));
            } else if (v === 'tencent') {
                results = results.concat(await checkTencent(url, options));
            } else if (v === 'huawei') {
                results = results.concat(await checkHuawei(url, options));
            } else if (v === 'AmazonS3') {
                results = results.concat(await checkAWS(url, options));
            } else if (v === '京东云') {
                results = results.concat(await checkJdcloud(url, options));
            } else if (v === 'bcebos' || v === '百度云') {
                results = results.concat(await checkBceBos(url, options));
            } else if (v === 'tos' || v === '火山云') {
                results = results.concat(await checkTos(url, options));
            }
        }
        if (!Array.isArray(results)) return [];
        return results;
    }
    // 被动检测：自动判断厂商
    let vendor = detectVendor(url);
        if (vendor === '未知') {
            vendor = await detectVendorByServer(url);
        }
        let results = [];
            if (vendor === '阿里云') {
                results = await checkAliyun(url, options);
            } else if (vendor === '腾讯云') {
                results = await checkTencent(url, options);
            } else if (vendor === '华为云') {
                results = await checkHuawei(url, options);
            } else if (vendor === 'AmazonS3') {
                results = await checkAWS(url, options);
            } else if (vendor === '京东云') {
                results = await checkJdcloud(url, options);
            } else if (vendor === '百度云') {
                results = await checkBceBos(url, options);
            } else if (vendor === '火山云') {
                results = await checkTos(url, options);
            }
    if (!Array.isArray(results)) return [];

    return results;
}

/**
 * 简单根据域名判断厂商
 * @param {string} url
 * @returns {'阿里云'|'腾讯云'|'华为云'|'未知'}
 */
export function detectVendor(url) {
    try {
        const u = new URL(url);
        const host = u.hostname;
        if (host.includes('aliyuncs.com')) return '阿里云';
        if (host.includes('myqcloud.com')) return '腾讯云';
        if (host.includes('myhuaweicloud.com')) return '华为云';
        if (host.includes('amazonaws.com') || host.includes('s3.amazonaws.com.cn')) return 'AmazonS3';
        if (host.includes('jdcloud.com')) return '京东云';
        if (host.includes('bdstatic.com') || host.includes('bcebos.com')) return '百度云';
        if (host.includes('volces.com')) return '火山云';
        return '未知';
    } catch {
        return '未知';
    }
}

/**
 * 根据响应 Server 头判断厂商
 * @param {Response} resp fetch返回的Response对象
 * @returns {'阿里云'|'腾讯云'|'华为云'|'AmazonS3'|'京东云'|null}
 */
export function detectVendorByServerHeader(resp) {
    const server = resp.headers.get('server');
    // 检查是否有X-Amz-Request-Id头，支持MinIO检测
    const xAmzRequestId = resp.headers.get('x-amz-request-id');
    // 检查是否有x-obs-request-id头，支持华为云检测
    const xObsRequestId = resp.headers.get('x-obs-request-id');
    // 检查是否有X-Jss-Request-Id头，支持京东云检测
    const xJssRequestId = resp.headers.get('x-jss-request-id');
    // 检查是否有x-bce-request-id头，支持百度云检测
    const xBceRequestId = resp.headers.get('x-bce-request-id');
    // 检查是否有x-tos-request-id头，支持火山云TOS检测
    const xTosRequestId = resp.headers.get('x-tos-request-id');
    
    // 京东云优先检测，因为Server: jfe是京东云特有的
    if (server === 'jfe' || xJssRequestId) return '京东云';
    if (server === 'AliyunOSS') return '阿里云';
    if (server === 'tencent-cos') return '腾讯云';
    if (server === 'OBS' || xObsRequestId) return '华为云';
    if (server === 'AmazonS3' || xAmzRequestId) return 'AmazonS3';
    if (server === 'BceBos' || xBceRequestId) return '百度云';
    if (server === 'TosServer' || xTosRequestId) return '火山云';
    return null;
}

/**
 * 若域名未识别，则fetch一次用Server头判断
 * @param {string} url
 * @returns {Promise<'阿里云'|'腾讯云'|'华为云'|'未知'>}
 */
export async function detectVendorByServer(url) {
    try {
        const resp = await fetch(url, { method: 'HEAD' });
        const vendor = detectVendorByServerHeader(resp);
        return vendor || '未知';
    } catch {
        return '未知';
    }
} 